// demo.js — runs browseraudio's own frontend modules directly in the page.
//
// In a real notebook, the Python record()/play() widgets drive these exact
// ES modules (recorder.js / player.js) over the Jupyter comm channel. Here we
// drive them with a tiny stand-in "model" so the demo works with zero setup —
// it's the same library code doing the same Web Audio work, just without a
// WebAssembly kernel in the loop.

const RECORDER = "../vendor/browseraudio/recorder.js";
const PLAYER = "../vendor/browseraudio/player.js";

// A minimal stand-in for an anywidget model: get/set traits + change events.
function makeModel(initial) {
  const values = new Map(Object.entries(initial || {}));
  const listeners = new Map();
  return {
    get: (k) => values.get(k),
    set(k, v) {
      values.set(k, v);
      (listeners.get("change:" + k) || []).forEach((cb) => cb());
    },
    on(ev, cb) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(cb);
    },
    off(ev, cb) {
      const s = listeners.get(ev);
      if (s) s.delete(cb);
    },
    save_changes() {}, // no kernel to sync to
  };
}

// Encode float32 samples as base64 — the same transport the library uses.
function floatToB64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const outEl = (id) => document.querySelector('[data-out="' + id + '"]');

function setStatus(text, busy) {
  const s = document.querySelector("#kstat");
  const d = document.querySelector("#kdot");
  if (s) s.textContent = text;
  if (d) d.classList.toggle("busy", !!busy);
}

let recModel = null; // shared so the "inspect" cell can read the last take

async function mountPlayer(id, planar, sr, nch) {
  const el = outEl(id);
  el.hidden = false;
  el.innerHTML = "";
  const model = makeModel({
    _pcm_b64: floatToB64(planar),
    sample_rate: sr,
    n_channels: nch,
    autoplay: true,
  });
  const { default: player } = await import(PLAYER);
  await player.render({ model, el });
}

const handlers = {
  // --- record.html ---
  async record() {
    const el = outEl("record");
    el.hidden = false;
    el.innerHTML = "";
    recModel = makeModel({ duration: 3.0, sample_rate: 0, _pcm_b64: "", _error: "" });
    const { default: recorder } = await import(RECORDER);
    await recorder.render({ model: recModel, el });
  },
  async inspect() {
    const el = outEl("inspect");
    el.hidden = false;
    if (!recModel || !recModel.get("_pcm_b64")) {
      el.innerHTML = '<span class="muted">Record something in the cell above first.</span>';
      return;
    }
    const frames = atob(recModel.get("_pcm_b64")).length / 4; // float32 mono
    const sr = recModel.get("sample_rate");
    el.innerHTML =
      '<pre class="result">samples.shape = (' + frames + ', 1)\nsample_rate   = ' + sr + " Hz</pre>";
  },

  // --- play.html ---
  async ["play-tone"]() {
    const sr = 44100;
    const n = sr; // one second
    const tone = new Float32Array(n);
    for (let i = 0; i < n; i++) tone[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr);
    await mountPlayer("play-tone", tone, sr, 1);
  },
  async ["play-stereo"]() {
    const sr = 44100;
    const n = sr;
    const planar = new Float32Array(2 * n); // channel-major: all L, then all R
    for (let i = 0; i < n; i++) {
      planar[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr);
      planar[n + i] = 0.2 * Math.sin((2 * Math.PI * 442 * i) / sr);
    }
    await mountPlayer("play-stereo", planar, sr, 2);
  },
};

async function runCell(id) {
  setStatus("running " + id + "…", true);
  try {
    await handlers[id]();
    setStatus("ready", false);
  } catch (err) {
    console.error("[browseraudio demo]", err);
    setStatus("error: " + (err && err.message ? err.message : err), false);
  }
}

document.querySelectorAll(".run[data-run]").forEach((btn) => {
  btn.addEventListener("click", () => runCell(btn.getAttribute("data-run")));
});

const runAll = document.querySelector("#run-all");
if (runAll) {
  runAll.addEventListener("click", async () => {
    const ids = [...document.querySelectorAll(".run[data-run]")].map((b) =>
      b.getAttribute("data-run")
    );
    for (const id of ids) await runCell(id);
  });
}

setStatus("ready", false);
