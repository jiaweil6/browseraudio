// keyboard.js — anywidget frontend for browseraudio.Keyboard.
//
// Runs on the MAIN thread, where the Web Audio API lives. Python designs the
// sound once (a bank of rendered notes, or one wavetable cycle) and ships it
// here as base64 float32; from then on every key press is voiced right here
// with no round-trip to the kernel, which may be in a Web Worker (JupyterLite
// / thebe-lite) and only services widget messages between cells. That keeps
// key-to-sound latency down to the AudioContext's own output latency.
//
// Keys map to notes through a small state machine synced from Python
// (`keymap`): pressing keys[i] looks up table[state][i] -> [midi, next] and
// plays midi (unless null), then moves to state `next`. Played notes are
// batched back to Python as (t, midi, on) events for analysis / offline
// rendering. The envelope maths mirrors _envelope() in _keyboard.py.

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const PUNCT = {
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-",
  Equal: "=", Backquote: "`", Space: "␣",
};
const FLUSH_MS = 250; // how often played notes are batched back to Python
const STEAL_RELEASE = 0.01; // fade for a voice stolen past max_voices

const STYLE = `
.ba-kb { font: 13px/1.4 var(--jp-ui-font-family, system-ui, sans-serif);
  border: 1px solid var(--jp-border-color1, #ccc); border-radius: 6px;
  padding: 8px; outline: none; user-select: none; -webkit-user-select: none;
  background: var(--jp-layout-color1, #fff); color: var(--jp-ui-font-color1, #222); }
.ba-kb:focus { border-color: var(--jp-brand-color1, #1976d2);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--jp-brand-color1, #1976d2) 25%, transparent); }
.ba-kb-status { margin-bottom: 6px; opacity: 0.8; }
.ba-kb-keys { display: flex; flex-wrap: wrap; gap: 3px; align-items: flex-start; }
.ba-kb-key { min-width: 34px; height: 64px; padding: 4px 2px; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: space-between; align-items: center;
  border: 1px solid var(--jp-border-color1, #bbb); border-radius: 4px; cursor: pointer;
  background: #fafafa; color: #222; touch-action: none; }
.ba-kb-key.black { background: #2b2b2b; color: #eee; height: 48px; }
.ba-kb-key.ctl { background: transparent; color: inherit; height: 40px; border-style: dashed; }
.ba-kb-key.down { background: var(--jp-brand-color1, #1976d2); color: #fff; }
.ba-kb-key b { font-size: 14px; }
.ba-kb-key small { font-size: 10px; opacity: 0.75; }
`;

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

const keyLabel = (code) =>
  code.startsWith("Key") ? code.slice(3)
  : code.startsWith("Digit") ? code.slice(5)
  : PUNCT[code] || code;

const noteName = (midi) => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Linear ADSR level while a key is held, t seconds after note-on.
function heldGain(t, a, d, s) {
  if (t < a) return t / a;
  if (t < a + d) return 1 + ((s - 1) * (t - a)) / d;
  return s;
}

function render({ model, el }) {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "ba-kb";
  root.tabIndex = 0; // focusable: key events go to the focused widget only
  // JupyterLab: keep our key presses from firing notebook shortcuts.
  root.dataset.lmSuppressShortcuts = "true";
  const status = document.createElement("div");
  status.className = "ba-kb-status";
  const keysRow = document.createElement("div");
  keysRow.className = "ba-kb-keys";
  root.append(status, keysRow);
  el.append(style, root);

  let ctx = null;
  let out = null;
  let buffers = new Map(); // midi -> AudioBuffer (bank mode)
  let wavetable = null; // AudioBuffer holding one cycle (wavetable mode)
  let keymap, codeIndex, state, tiles;
  const held = new Map(); // key index -> voice (or null if it played nothing)
  let active = []; // sounding voices, oldest first, for voice stealing
  let t0 = null; // AudioContext time of the first note since load / clear()
  let pending = [];
  let flushTimer = null;

  const setStatus = () => {
    status.textContent = document.activeElement === root
      ? "● listening — play with your computer keyboard"
      : "Click here, then play with your computer keyboard";
  };

  // ----- sound -----------------------------------------------------------

  function buildSound() {
    const pcm = fromBase64(model.get("_pcm_b64"));
    buffers = new Map();
    wavetable = null;
    if (model.get("mode") === "wavetable") {
      wavetable = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
      wavetable.copyToChannel(pcm, 0);
    } else {
      const sr = model.get("sample_rate");
      for (const [midi, start, length] of model.get("_notes")) {
        const buf = ctx.createBuffer(1, length, sr); // resampled on playback
        buf.copyToChannel(pcm.subarray(start, start + length), 0);
        buffers.set(midi, buf);
      }
    }
  }

  // Created lazily from a focus/key/pointer handler, so it's born from a user
  // gesture and the autoplay policy lets it run.
  function ensureContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx({ latencyHint: "interactive" });
      out = ctx.createGain();
      out.connect(ctx.destination);
      buildSound();
    }
    if (ctx.state !== "running") ctx.resume();
  }

  function log(t, midi, on) {
    if (t0 === null) t0 = t;
    pending.push([t - t0, midi, on]);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    flushTimer = null;
    if (!pending.length) return;
    model.send({ type: "events", events: pending });
    pending = [];
  }

  function startVoice(midi) {
    let source;
    if (model.get("mode") === "wavetable") {
      source = ctx.createBufferSource();
      source.buffer = wavetable;
      source.loop = true;
      // One cycle per `length` samples, so this rate sounds at midi's pitch.
      source.playbackRate.value = (midiToHz(midi) * wavetable.length) / ctx.sampleRate;
    } else {
      const buf = buffers.get(midi);
      if (!buf) return null;
      source = ctx.createBufferSource();
      source.buffer = buf;
    }
    while (active.length >= model.get("max_voices")) stopVoice(active[0], STEAL_RELEASE);

    const now = ctx.currentTime;
    const a = model.get("attack");
    const d = model.get("decay");
    const s = model.get("sustain");
    const gain = model.get("gain");
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain * heldGain(0, a, d, s), now);
    if (a > 0) amp.gain.linearRampToValueAtTime(gain, now + a);
    if (d > 0) amp.gain.linearRampToValueAtTime(gain * s, now + a + d);
    else if (a > 0) amp.gain.setValueAtTime(gain * s, now + a);
    source.connect(amp).connect(out);
    source.start(now);

    const voice = { midi, source, amp, t: now, stopped: false };
    active.push(voice);
    source.onended = () => {
      active = active.filter((v) => v !== voice);
    };
    log(now, midi, 1);
    return voice;
  }

  // Release a voice: from its current envelope level down to 0.
  function stopVoice(voice, release) {
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    const now = ctx.currentTime;
    log(now, voice.midi, 0);
    // One-shots ring out to their end (and keep counting toward max_voices).
    if (model.get("one_shot") && release !== STEAL_RELEASE) return;
    active = active.filter((v) => v !== voice);
    const level = model.get("gain") * heldGain(
      now - voice.t, model.get("attack"), model.get("decay"), model.get("sustain"));
    const g = voice.amp.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(level, now);
    if (release > 0) g.linearRampToValueAtTime(0, now + release);
    else g.setValueAtTime(0, now);
    voice.source.stop(now + release + 0.02);
  }

  // ----- keys --------------------------------------------------------------

  function press(idx) {
    if (held.has(idx)) return; // already down (auto-repeat, or key + pointer)
    ensureContext();
    const [midi, next] = keymap.table[state][idx];
    state = next;
    held.set(idx, midi === null ? null : startVoice(midi));
    tiles[idx].classList.add("down");
    labelTiles();
  }

  function lift(idx) {
    if (!held.has(idx)) return;
    stopVoice(held.get(idx), model.get("release"));
    held.delete(idx);
    tiles[idx].classList.remove("down");
  }

  function liftAll() {
    for (const idx of Array.from(held.keys())) lift(idx);
  }

  function labelTiles() {
    keymap.keys.forEach((code, i) => {
      const [midi, next] = keymap.table[state][i];
      const tile = tiles[i];
      tile.className = "ba-kb-key" + (held.has(i) ? " down" : "");
      let text;
      if (midi === null) {
        tile.classList.add("ctl");
        text = next < state ? "oct −" : next > state ? "oct +" : "·";
      } else {
        if (BLACK.has(midi % 12)) tile.classList.add("black");
        text = noteName(midi);
      }
      tile.querySelector("small").textContent = text;
    });
  }

  function buildKeys() {
    liftAll();
    keymap = model.get("keymap");
    codeIndex = new Map(keymap.keys.map((code, i) => [code, i]));
    state = keymap.start;
    tiles = keymap.keys.map((code, i) => {
      const tile = document.createElement("div");
      const label = document.createElement("b");
      label.textContent = keyLabel(code);
      tile.append(label, document.createElement("small"));
      tile.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        root.focus();
        tile.setPointerCapture(e.pointerId);
        press(i);
      });
      const up = () => lift(i);
      tile.addEventListener("pointerup", up);
      tile.addEventListener("pointercancel", up);
      return tile;
    });
    keysRow.replaceChildren(...tiles);
    labelTiles();
  }

  const isPlayKey = (e) =>
    codeIndex.has(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey;

  root.addEventListener("keydown", (e) => {
    if (!isPlayKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) press(codeIndex.get(e.code));
  });
  root.addEventListener("keyup", (e) => {
    if (!codeIndex.has(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    lift(codeIndex.get(e.code));
  });
  // Build the AudioContext + note buffers as soon as the widget is focused
  // (by a click or Tab — both user gestures), not on the first note: that
  // setup takes ~100+ ms and would make the first key press late.
  root.addEventListener("focus", () => {
    ensureContext();
    setStatus();
  });
  // No stuck notes: a key released while we weren't focused never reaches us.
  root.addEventListener("blur", () => {
    liftAll();
    setStatus();
  });
  const onHidden = () => {
    if (document.hidden) liftAll();
  };
  document.addEventListener("visibilitychange", onHidden);

  model.on("change:keymap", buildKeys);
  model.on("change:_pcm_b64", () => {
    if (ctx) buildSound();
  });
  model.on("msg:custom", (msg) => {
    if (msg && msg.type === "clear") {
      t0 = null;
      pending = [];
    }
  });

  buildKeys();
  setStatus();

  return () => {
    liftAll();
    flush();
    document.removeEventListener("visibilitychange", onHidden);
    if (ctx) ctx.close();
  };
}

export default { render };
