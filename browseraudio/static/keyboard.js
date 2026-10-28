// keyboard.js — Keyboard frontend: voices the note bank / wavetable in the page and
// reports played notes as events. The envelope mirrors _envelope() in _keyboard.py.

const FLUSH_MS = 250; // how often played notes are batched back to Python
const STEAL_RELEASE = 0.03; // fade for a voice stolen past max_voices

// Linear ADSR level while a key is held, t seconds after note-on.
function heldGain(t, a, d, s) {
  if (t < a) return t / a;
  if (t < a + d) return 1 + ((s - 1) * (t - a)) / d;
  return s;
}

function render({ model, el }) {
  const ui = mountUI(el, "Synth");
  let ctx = null;
  let out = null;
  let buffers = new Map(); // midi -> AudioBuffer (bank mode)
  let wavetable = null; // AudioBuffer holding one cycle (wavetable mode)
  let active = []; // sounding voices, oldest first, for voice stealing
  let t0 = null; // AudioContext time of the first note since load / clear()
  let pending = [];
  let flushTimer = null;

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

  // Started on focus (a gesture), so the first note isn't late.
  function start() {
    if (!ctx) {
      ctx = newAudioContext({ latencyHint: "interactive" });
      out = ctx.createGain();
      // Gentle limiter: chords don't hard-clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      out.connect(limiter).connect(ctx.destination);
      buildSound();
    }
    if (ctx.state !== "running") ctx.resume();
    showState();
  }

  // Release everything, fade out, close.
  function stop() {
    controls.liftAll();
    const [c, o] = [ctx, out];
    active = [];
    ctx = out = null;
    if (c) {
      o.gain.setTargetAtTime(0, c.currentTime, 0.008);
      setTimeout(() => c.close(), 100);
    }
    showState();
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
    start();
    let source;
    if (model.get("mode") === "wavetable") {
      source = ctx.createBufferSource();
      source.buffer = wavetable;
      source.loop = true;
      // `length` samples per cycle.
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

    const voice = { midi, source, amp, t: now, stopped: false, ctx };
    active.push(voice);
    source.onended = () => {
      active = active.filter((v) => v !== voice);
    };
    log(now, midi, 1);
    return voice;
  }

  // Release from the current envelope level.
  function stopVoice(voice, release) {
    if (voice.stopped || voice.ctx !== ctx) return; // already stopped by Stop
    voice.stopped = true;
    const now = ctx.currentTime;
    log(now, voice.midi, 0);
    // One-shots ring out (and still count toward max_voices).
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

  const power = uiButton({ icon: "play", label: "Start", onClick: () => (ctx ? stop() : start()) });
  ui.actions.append(power);

  const controls = createControls(model, ui, {
    onNoteOn: startVoice,
    onNoteOff: (voice) => stopVoice(voice, model.get("release")),
    onFocus: () => {
      start();
      showState();
    },
    onBlur: showState,
    // Genie picks among the bank's notes.
    genieKeys: () =>
      model.get("mode") === "bank" ? model.get("_notes").map(([midi]) => midi - GENIE_LOWEST_MIDI) : null,
  });

  function showState() {
    power.set(ctx ? { icon: "stop", label: "Stop" } : { icon: "play", label: "Start" });
    if (!ctx) ui.status("idle", "stopped");
    else if (controls && controls.listening()) ui.status("live", "listening");
    else ui.status("ready", "on — click to play");
  }

  const describe = () => {
    const notes = model.get("_notes");
    ui.stats(
      model.get("mode") === "wavetable"
        ? "wavetable · any pitch · ADSR " + [model.get("attack"), model.get("decay"), model.get("sustain"), model.get("release")].join(" / ")
        : "note bank · " + notes.length + " notes (" + noteName(notes[0][0]) + "–" + noteName(notes[notes.length - 1][0]) + ") · " + model.get("sample_rate") + " Hz",
    );
  };
  describe();
  showState();

  model.on("change:_pcm_b64", () => {
    if (ctx) buildSound();
    describe();
  });
  model.on("msg:custom", (msg) => {
    if (msg && msg.type === "clear") {
      t0 = null;
      pending = [];
    }
  });

  return () => {
    controls.destroy();
    flush();
    if (ctx) ctx.close();
    ui.destroy();
  };
}

export default { render };
