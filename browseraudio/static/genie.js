// genie.js — genie mode: Piano Genie in plain JS (no TensorFlow.js).
// Donahue, Simon & Dieleman, "Piano Genie", IUI 2019. https://arxiv.org/abs/1810.03226
// Inference ported from Magenta.js piano_genie/model.ts (Apache-2.0, Google LLC);
// runs Magenta's published checkpoint (Apache-2.0).

const GENIE_CHECKPOINT =
  "https://storage.googleapis.com/magentadata/js/checkpoints/piano_genie/model/epiano/stp_iq_auto_contour_dt_166006";
const GENIE_BUTTONS = 8;
const GENIE_KEYS = 88; // piano keys A0..C8; key k is MIDI k + GENIE_LOWEST_MIDI
const GENIE_LOWEST_MIDI = 21;
const GENIE_UNITS = 128;
const GENIE_LAYERS = 2;
const GENIE_DT_RATE = 31.25; // delta-time bins per second
const GENIE_DT_MAX = 32; // longest delta-time bin
const GENIE_INPUT = 1 + (GENIE_KEYS + 1) + (GENIE_DT_MAX + 1); // 123 features
const GENIE_PREFIX = "phero_model/decoder/";

// tf.round: half to even.
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// out = bias + x @ kernel (kernel row-major [n, m]).
function dense(x, kernel, bias, m) {
  const out = Float32Array.from(bias);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = i * m;
    for (let j = 0; j < m; j++) out[j] += xi * kernel[row + j];
  }
  return out;
}

// tf.basicLSTMCell: gates [i, j, f, o] from concat(input, h); forget bias 1.
function lstmCell(input, c, h, kernel, bias) {
  const n = GENIE_UNITS;
  const z = dense(Float32Array.from([...input, ...h]), kernel, bias, 4 * n);
  const c2 = new Float32Array(n);
  const h2 = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    c2[k] = c[k] * sigmoid(z[2 * n + k] + 1) + sigmoid(z[k]) * Math.tanh(z[n + k]);
    h2[k] = Math.tanh(c2[k]) * sigmoid(z[3 * n + k]);
  }
  return [c2, h2];
}

// Load a tfjs weights manifest into named Float32Arrays.
async function loadGenieWeights(url) {
  const res = await fetch(url + "/weights_manifest.json");
  if (!res.ok) throw new Error("couldn't load the Piano Genie model (" + res.status + ")");
  const manifest = await res.json();
  const vars = {};
  for (const group of manifest) {
    const parts = await Promise.all(group.paths.map(async (p) => {
      const r = await fetch(url + "/" + p);
      if (!r.ok) throw new Error("couldn't load the Piano Genie model (" + r.status + ")");
      return new Uint8Array(await r.arrayBuffer());
    }));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    let offset = 0;
    for (const w of group.weights) {
      if (w.dtype !== "float32" || w.quantization) {
        throw new Error("unsupported Piano Genie weights: " + w.name);
      }
      const size = w.shape.reduce((a, b) => a * b, 1);
      vars[w.name] = new Float32Array(bytes.buffer.slice(offset, offset + 4 * size));
      offset += 4 * size;
    }
  }
  return vars;
}

// One download per page.
function genieWeights(url) {
  const cache = (globalThis.__browseraudioGenie = globalThis.__browseraudioGenie || new Map());
  if (!cache.has(url)) {
    const load = loadGenieWeights(url);
    load.catch(() => cache.delete(url)); // allow a retry after a failure
    cache.set(url, load);
  }
  return cache.get(url);
}

class Genie {
  constructor(vars) {
    const v = (name) => {
      const value = vars[GENIE_PREFIX + name];
      if (!value) throw new Error("Piano Genie weights are missing " + name);
      return value;
    };
    this.inKernel = v("rnn_input/dense/kernel");
    this.inBias = v("rnn_input/dense/bias");
    this.cells = [0, 1].map((i) => ({
      kernel: v(`rnn/rnn/multi_rnn_cell/cell_${i}/lstm_cell/kernel`),
      bias: v(`rnn/rnn/multi_rnn_cell/cell_${i}/lstm_cell/bias`),
    }));
    this.outKernel = v("pitches/dense/kernel");
    this.outBias = v("pitches/dense/bias");
    this.reset();
  }

  static async load(url = GENIE_CHECKPOINT) {
    return new Genie(await genieWeights(url));
  }

  reset() {
    this.c = Array.from({ length: GENIE_LAYERS }, () => new Float32Array(GENIE_UNITS));
    this.h = Array.from({ length: GENIE_LAYERS }, () => new Float32Array(GENIE_UNITS));
    this.lastKey = -1; // "no previous note"
    this.lastTime = null; // first press counts as a long pause
  }

  // One press -> 88 logits; deltaTime defaults to the time since the last press.
  step(button, deltaTime) {
    const now = performance.now();
    let dt = deltaTime;
    if (dt === undefined) dt = this.lastTime === null ? 1e5 : (now - this.lastTime) / 1000;
    this.lastTime = now;

    const x = new Float32Array(GENIE_INPUT);
    x[0] = (2 * button) / (GENIE_BUTTONS - 1) - 1;
    x[1 + this.lastKey + 1] = 1;
    // float32, as the original.
    const bin = Math.min(roundHalfEven(Math.fround(Math.fround(dt) * GENIE_DT_RATE)), GENIE_DT_MAX);
    x[1 + GENIE_KEYS + 1 + bin] = 1;

    let input = dense(x, this.inKernel, this.inBias, GENIE_UNITS);
    for (let l = 0; l < GENIE_LAYERS; l++) {
      [this.c[l], this.h[l]] = lstmCell(input, this.c[l], this.h[l], this.cells[l].kernel, this.cells[l].bias);
      input = this.h[l];
    }
    return dense(this.h[GENIE_LAYERS - 1], this.outKernel, this.outBias, GENIE_KEYS);
  }

  // Press button 0..7 -> piano key 0..87. temperature 0 is greedy; `keys` restricts.
  next(button, { temperature = 0.25, keys = null, deltaTime } = {}) {
    const logits = this.step(button, deltaTime);
    const choices = keys && keys.length ? keys : null;
    const scores = choices ? choices.map((k) => logits[k]) : Array.from(logits);
    let pick;
    if (temperature <= 0) {
      pick = scores.indexOf(Math.max(...scores));
    } else {
      const t = Math.min(temperature, 1);
      const top = Math.max(...scores);
      const weights = scores.map((s) => Math.exp((s - top) / t));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      pick = 0;
      while (pick < weights.length - 1 && (r -= weights[pick]) > 0) pick++;
    }
    const key = choices ? choices[pick] : pick;
    this.lastKey = key;
    return key;
  }
}
