// keyboard.js — anywidget frontend for browseraudio.Keyboard.
// (Python prepends keys.js, which provides createKeys / fromBase64 / midiToHz.)
//
// Runs on the MAIN thread, where the Web Audio API lives. Python designs the
// sound once (a bank of rendered notes, or one wavetable cycle) and ships it
// here as base64 float32; from then on every key press is voiced right here
// with no round-trip to the kernel, which may be in a Web Worker (JupyterLite
// / thebe-lite) and only services widget messages between cells. That keeps
// key-to-sound latency down to the AudioContext's own output latency.
//
// Played notes are batched back to Python as (t, midi, on) events for
// analysis / offline rendering. The envelope maths mirrors _envelope() in
// _keyboard.py.

const FLUSH_MS = 250; // how often played notes are batched back to Python
const STEAL_RELEASE = 0.01; // fade for a voice stolen past max_voices

// Linear ADSR level while a key is held, t seconds after note-on.
function heldGain(t, a, d, s) {
  if (t < a) return t / a;
  if (t < a + d) return 1 + ((s - 1) * (t - a)) / d;
  return s;
}

function render({ model, el }) {
  let ctx = null;
  let out = null;
  let buffers = new Map(); // midi -> AudioBuffer (bank mode)
  let wavetable = null; // AudioBuffer holding one cycle (wavetable mode)
  let active = []; // sounding voices, oldest first, for voice stealing
  let t0 = null; // AudioContext time of the first note since load / clear()
  let pending = [];
  let flushTimer = null;

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
  // gesture and the autoplay policy lets it run. Built on focus rather than
  // on the first note: setup takes ~100+ ms and would make that note late.
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
    ensureContext();
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
    if (voice.stopped) return;
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

  const keys = createKeys(model, el, {
    onNoteOn: startVoice,
    onNoteOff: (voice) => stopVoice(voice, model.get("release")),
    onFocus: ensureContext,
  });

  model.on("change:_pcm_b64", () => {
    if (ctx) buildSound();
  });
  model.on("msg:custom", (msg) => {
    if (msg && msg.type === "clear") {
      t0 = null;
      pending = [];
    }
  });

  return () => {
    keys.destroy();
    flush();
    if (ctx) ctx.close();
  };
}

export default { render };
