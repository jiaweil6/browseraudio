// stream.js — anywidget frontend for browseraudio.Stream.
// (Python prepends keys.js, which provides createKeys / fromBase64.)
//
// Real-time synthesis with the browser as the clock. An AudioWorklet on the
// audio thread plays a small FIFO of blocks; each time it finishes one, this
// main-thread code asks the kernel for another ("need"), and Python answers by
// running the user's callback(block) ("blocks"). Pulling like this means
// Python never has to keep time or run a loop: it only reacts to widget
// messages, which a kernel — even one in a Web Worker (JupyterLite / thebe) —
// processes whenever no cell is running. Key presses go to Python straight
// away ("note"), so a control change is heard from the next block rendered:
// about the queued audio plus one round trip later.
//
// Blocks travel in batches (one message, several blocks back to back, each
// planar) so tiny block sizes don't mean one message per block.

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
        for (const ch of out) ch.fill(0, i);
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
        out[c].set(batch.subarray(from, from + take), i);
      }
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
  let ctx = null;
  let node = null;
  let running = false;
  let queued = 0; // blocks in the worklet's FIFO (including the one playing)
  let inflight = 0; // blocks requested from Python, not yet arrived
  let nextId = 0;
  const sentAt = new Map(); // request id -> performance.now() when sent
  let rtt = null; // smoothed request -> blocks round trip, ms
  let load = null; // smoothed callback time / real time of the audio it made
  let dropouts = 0;

  // The panel: with the computer-keyboard control surface, or (for a plain
  // sounddevice-style OutputStream) just the transport and stats.
  let keys = null;
  let root;
  if (model.get("keyboard")) {
    keys = createKeys(model, el, {
      onNoteOn: (midi) => {
        model.send({ type: "note", midi, on: 1 });
        return midi;
      },
      onNoteOff: (midi) => model.send({ type: "note", midi, on: 0 }),
    });
    root = keys.root;
  } else {
    const style = document.createElement("style");
    style.textContent = KEYS_STYLE;
    root = document.createElement("div");
    root.className = "ba-kb";
    el.append(style, root);
  }
  const bar = document.createElement("div");
  bar.className = "ba-kb-bar";
  const button = document.createElement("button");
  button.className = "jupyter-button";
  // Shown when the browser's autoplay policy kept the AudioContext suspended
  // (a stream started from Python, with no click on the page to allow it).
  const unmute = document.createElement("button");
  unmute.className = "jupyter-button";
  unmute.textContent = "🔈 Click to enable audio";
  unmute.style.display = "none"; // (not `hidden`: .jupyter-button sets display)
  const stats = document.createElement("span");
  stats.className = "ba-kb-stats";
  bar.append(button, unmute, stats);
  const errorBox = document.createElement("div");
  errorBox.className = "ba-kb-error";
  if (keys) {
    root.insertBefore(bar, keys.keysRow);
    root.insertBefore(errorBox, keys.keysRow);
  } else {
    root.append(bar, errorBox);
  }

  const smooth = (prev, x) => (prev === null ? x : 0.8 * prev + 0.2 * x);

  const blockSeconds = () => model.get("block_size") / model.get("sample_rate");
  // Blocks to keep queued or on their way: `lookahead` seconds, and always at
  // least two (one playing, one ready) or every block would end in a gap.
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

  const showUnmute = () => {
    unmute.style.display = running && ctx && ctx.state === "suspended" ? "" : "none";
  };
  unmute.addEventListener("click", () => {
    if (ctx) ctx.resume();
  });

  async function start() {
    const sr = model.get("sample_rate");
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    // From the Start button this runs inside the click, so autoplay allows it;
    // started from Python it may come up suspended (see `unmute`).
    ctx = new AudioCtx({ sampleRate: sr, latencyHint: "interactive" });
    ctx.onstatechange = showUnmute;
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    running = true;
    queued = inflight = dropouts = 0;
    rtt = load = null;
    sentAt.clear();
    errorBox.textContent = "";
    button.textContent = "■ Stop";
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
    node.connect(ctx.destination);
    showUnmute();
    request();
  }

  function stop() {
    running = false;
    button.textContent = "▶ Start";
    if (node) node.disconnect();
    if (ctx) ctx.close();
    node = ctx = null;
    showUnmute();
    model.send({ type: "stop" });
  }

  // `playing` is the single source of truth, set from either side: the
  // Start/Stop button here, or start()/stop() in Python.
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
        errorBox.textContent = "couldn't start audio: " + err;
      });
    } else if (!want && running) {
      stop();
    }
  }
  model.on("change:playing", sync);

  button.textContent = "▶ Start";
  button.addEventListener("click", () => setPlaying(!model.get("playing")));

  // The worklet and AudioContext are built for one block size / channel count
  // / rate; a change mid-stream needs a fresh start.
  model.on("change:block_size change:channels change:sample_rate", () => {
    if (!running) return;
    setPlaying(false);
    errorBox.textContent = "settings changed — press ▶ Start again";
  });

  model.on("change:error", () => {
    errorBox.textContent = model.get("error");
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
      parts.push((keys ? "key→sound ≈ " : "control→sound ≈ ") + ms(queueMs + rtt + out));
    }
    stats.textContent = parts.join(" · ");
  }
  const statsTimer = setInterval(showStats, STATS_MS);
  showStats();
  errorBox.textContent = model.get("error");
  sync(); // started from Python before this view existed

  return () => {
    clearInterval(statsTimer);
    if (running) stop();
    if (keys) keys.destroy();
  };
}

export default { render };
