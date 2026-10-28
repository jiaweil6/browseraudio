// stream.js — Stream frontend. The browser is the clock: an AudioWorklet plays a
// queue of blocks and requests each next one from Python ("need" -> "blocks", in
// batches). Dropouts and Stop fade instead of clicking.

const STATS_MS = 250;
const MIN_BATCH_S = 0.005; // don't ask Python for less than ~5 ms of audio at once

const WORKLET = `
class BrowseraudioStream extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.B = options.processorOptions.blockSize;
    this.queue = []; // Float32Array batches of planar blocks
    this.pos = 0; // frames already played from queue[0]
    this.started = false; // first block arrived; silence before it isn't a dropout
    this.dry = false;
    this.dropouts = 0;
    this.g = 0; // fade-in gain of the stream's own samples
    this.tail = []; // per channel: a decaying echo of the last value after a gap
    this.last = []; // per channel: the last sample written
    this.fadeStep = 1 / Math.round(0.004 * sampleRate); // 4 ms fade-in
    this.decay = Math.exp(-1 / (0.004 * sampleRate)); // ~4 ms decay
    this.port.onmessage = (e) => {
      this.queue.push(e.data);
      this.started = true;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const channels = out.length;
    const n = out[0].length;
    const B = this.B;
    let i = 0;
    let consumed = 0;
    while (i < n) {
      const batch = this.queue[0];
      if (!batch) {
        // Ran dry: let the last value decay instead of jumping to 0.
        for (let c = 0; c < channels; c++) {
          let t = this.dry ? this.tail[c] || 0 : this.last[c] || 0;
          const dst = out[c];
          for (let k = i; k < n; k++) {
            dst[k] = t;
            t *= this.decay;
          }
          this.tail[c] = Math.abs(t) < 1e-6 ? 0 : t;
          this.last[c] = dst[n - 1];
        }
        this.g = 0;
        if (this.started && !this.dry) {
          this.dry = true;
          this.dropouts++;
          this.port.postMessage({ dropouts: this.dropouts });
        }
        break;
      }
      this.dry = false;
      const offset = this.pos % B; // frame within the current block
      const base = Math.floor(this.pos / B) * B * channels; // the block's start
      const take = Math.min(n - i, B - offset);
      for (let c = 0; c < channels; c++) {
        const from = base + c * B + offset;
        const dst = out[c];
        let g = this.g;
        let t = this.tail[c] || 0;
        for (let k = 0; k < take; k++) {
          if (g < 1) g = Math.min(1, g + this.fadeStep);
          dst[i + k] = g * batch[from + k] + t; // fade in over any decaying tail
          t *= this.decay;
        }
        this.tail[c] = Math.abs(t) < 1e-6 ? 0 : t;
        this.last[c] = dst[i + take - 1];
      }
      this.g = Math.min(1, this.g + take * this.fadeStep);
      i += take;
      this.pos += take;
      if (this.pos % B === 0) {
        consumed++;
        if (this.pos * channels >= batch.length) {
          this.queue.shift();
          this.pos = 0;
        }
      }
    }
    if (consumed) this.port.postMessage({ consumed });
    return true;
  }
}
registerProcessor("browseraudio-stream", BrowseraudioStream);
`;

function render({ model, el }) {
  const keyboard = model.get("keyboard");
  const ui = mountUI(el, keyboard ? "Stream" : "Output stream");
  let ctx = null;
  let node = null;
  let master = null; // output gain, so Stop can fade out instead of cutting
  let running = false;
  let queued = 0; // blocks in the worklet's FIFO (including the one playing)
  let inflight = 0; // blocks requested from Python, not yet arrived
  let nextId = 0;
  const sentAt = new Map(); // request id -> performance.now() when sent
  let rtt = null; // smoothed request -> blocks round trip, ms
  let load = null; // smoothed callback time / real time of the audio it made
  let dropouts = 0;

  const button = uiButton({ icon: "play", label: "Start" });
  // Shown if autoplay kept the context suspended.
  const unmute = uiButton({ label: "🔈 Enable audio", secondary: true });
  unmute.style.display = "none";
  ui.actions.append(unmute, button);

  // Key surface, unless this is a plain OutputStream.
  const controls = keyboard
    ? createControls(model, ui, {
        onNoteOn: (midi) => {
          model.send({ type: "note", midi, on: 1 });
          return midi;
        },
        onNoteOff: (midi) => model.send({ type: "note", midi, on: 0 }),
        genieKeys: () => {
          const [lo, hi] = model.get("genie_range");
          const keys = [];
          for (let m = Math.max(lo, GENIE_LOWEST_MIDI); m <= Math.min(hi, GENIE_LOWEST_MIDI + GENIE_KEYS - 1); m++) {
            keys.push(m - GENIE_LOWEST_MIDI);
          }
          return keys;
        },
      })
    : null;

  const smooth = (prev, x) => (prev === null ? x : 0.8 * prev + 0.2 * x);

  const blockSeconds = () => model.get("block_size") / model.get("sample_rate");
  // Blocks to keep queued: `lookahead` s, at least two.
  const target = () => Math.max(2, Math.ceil(model.get("lookahead") / blockSeconds()));

  function request() {
    if (!running) return;
    const want = target() - queued - inflight;
    const minBatch = Math.max(1, Math.min(target() - 1, Math.floor(MIN_BATCH_S / blockSeconds())));
    if (want < minBatch && (want <= 0 || queued + inflight > 0)) return;
    const id = nextId++;
    sentAt.set(id, performance.now());
    inflight += want;
    model.send({ type: "need", n: want, id, dropouts });
  }

  model.on("msg:custom", (msg) => {
    if (!msg || msg.type !== "blocks" || !sentAt.has(msg.id)) return; // stale run
    rtt = smooth(rtt, performance.now() - sentAt.get(msg.id));
    sentAt.delete(msg.id);
    load = smooth(load, msg.busy / (msg.n * blockSeconds()));
    inflight -= msg.n;
    const batch = fromBase64(msg.pcm);
    node.port.postMessage(batch, [batch.buffer]);
    queued += msg.n;
    request();
  });

  function showState() {
    button.set(running ? { icon: "stop", label: "Stop" } : { icon: "play", label: "Start" });
    unmute.style.display = running && ctx && ctx.state === "suspended" ? "" : "none";
    if (model.get("error")) ui.status("error", "error");
    else if (!running) ui.status("idle", "stopped");
    else if (rtt === null) ui.status("load", "starting…");
    else ui.status("live", "streaming");
  }
  unmute.addEventListener("click", () => {
    if (ctx) ctx.resume();
  });

  async function start() {
    const sr = model.get("sample_rate");
    // Autoplay allows this from a click; from Python it may stay suspended.
    ctx = newAudioContext({ sampleRate: sr, latencyHint: "interactive" });
    ctx.onstatechange = showState;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    running = true;
    queued = inflight = dropouts = 0;
    rtt = load = null;
    sentAt.clear();
    ui.note("");
    showState();
    model.send({ type: "start" });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!running) return; // stopped while loading
    node = new AudioWorkletNode(ctx, "browseraudio-stream", {
      numberOfInputs: 0,
      outputChannelCount: [model.get("channels")],
      processorOptions: { blockSize: model.get("block_size") },
    });
    node.port.onmessage = (e) => {
      if (e.data.consumed) {
        queued -= e.data.consumed;
        request();
      }
      if (e.data.dropouts) dropouts = e.data.dropouts;
    };
    master = ctx.createGain();
    node.connect(master).connect(ctx.destination);
    showState();
    request();
  }

  function stop() {
    running = false;
    const [c, n, m] = [ctx, node, master];
    node = ctx = master = null;
    if (c) {
      // Fade out, then tear down.
      if (m) m.gain.setTargetAtTime(0, c.currentTime, 0.008);
      setTimeout(() => {
        if (n) n.disconnect();
        c.close();
      }, m ? 80 : 0);
    }
    showState();
    model.send({ type: "stop" });
  }

  // `playing` is the source of truth (button or Python).
  function setPlaying(value) {
    if (model.get("playing") === value) return;
    model.set("playing", value);
    model.save_changes();
  }

  function sync() {
    const want = model.get("playing");
    if (want && !running) {
      start().catch((err) => {
        stop();
        setPlaying(false);
        ui.note("Couldn't start audio: " + err);
      });
    } else if (!want && running) {
      stop();
    }
  }
  model.on("change:playing", sync);
  button.addEventListener("click", () => setPlaying(!model.get("playing")));

  // Format changes need a fresh start.
  model.on("change:block_size change:channels change:sample_rate", () => {
    if (!running) return;
    setPlaying(false);
    ui.note("Settings changed — press Start again.", "info");
  });

  model.on("change:error", () => {
    ui.note(model.get("error"));
    showState();
  });

  function showStats() {
    const B = model.get("block_size");
    const sr = model.get("sample_rate");
    const ms = (x) => x.toFixed(1) + " ms";
    const blockMs = (1000 * B) / sr;
    const queueMs = target() * blockMs;
    const parts = [
      "B = " + B + " (" + ms(blockMs) + ")",
      "queue " + target() + " block" + (target() > 1 ? "s" : "") + " (" + ms(queueMs) + ")",
    ];
    if (running && rtt !== null) {
      const out = ctx ? 1000 * ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) : 0;
      parts.push("round trip " + ms(rtt));
      parts.push("callback " + (100 * load).toFixed(1) + "% of budget");
      parts.push("dropouts " + dropouts);
      parts.push((keyboard ? "key→sound ≈ " : "control→sound ≈ ") + ms(queueMs + rtt + out));
    }
    ui.stats(parts.join(" · "));
    if (running) showState();
  }
  const statsTimer = setInterval(showStats, STATS_MS);
  showStats();
  showState();
  if (model.get("error")) ui.note(model.get("error"));
  sync(); // started from Python before this view existed

  return () => {
    clearInterval(statsTimer);
    if (running) stop();
    if (controls) controls.destroy();
    ui.destroy();
  };
}

export default { render };
