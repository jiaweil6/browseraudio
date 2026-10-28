"""Genie mode's model: ``static/genie.js`` checked against a NumPy reference.

genie.js runs Piano Genie (Donahue, Simon & Dieleman, IUI 2019) in plain
JavaScript. Here it runs under Node on small random weights of the real
shapes, and every step's logits must match an independent NumPy
implementation of the same network. (It was also checked against Magenta.js
+ TensorFlow.js on the published checkpoint: identical choices over 200
presses, logits within 1.2e-5.) Skipped where Node isn't installed.
"""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess

import numpy as np
import pytest

import browseraudio

GENIE_JS = pathlib.Path(browseraudio.__file__).parent / "static" / "genie.js"
PREFIX = "phero_model/decoder/"
SHAPES = {
    "rnn_input/dense/kernel": (123, 128),
    "rnn_input/dense/bias": (128,),
    "rnn/rnn/multi_rnn_cell/cell_0/lstm_cell/kernel": (256, 512),
    "rnn/rnn/multi_rnn_cell/cell_0/lstm_cell/bias": (512,),
    "rnn/rnn/multi_rnn_cell/cell_1/lstm_cell/kernel": (256, 512),
    "rnn/rnn/multi_rnn_cell/cell_1/lstm_cell/bias": (512,),
    "pitches/dense/kernel": (128, 88),
    "pitches/dense/bias": (88,),
}

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


def _weights(seed=0):
    rng = np.random.default_rng(seed)
    return {name: (0.15 * rng.standard_normal(shape)).astype(np.float32) for name, shape in SHAPES.items()}


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def _reference(weights, presses):
    """Piano Genie's decoder, step by step: logits and greedy keys."""
    w = {k: v.astype(np.float64) for k, v in weights.items()}
    c = [np.zeros(128), np.zeros(128)]
    h = [np.zeros(128), np.zeros(128)]
    last_key = -1
    out = []
    for button, dt in presses:
        x = np.zeros(123)
        x[0] = 2 * button / 7 - 1
        x[1 + last_key + 1] = 1
        bin_ = min(int(np.round(np.float32(dt) * np.float32(31.25))), 32)  # half to even
        x[90 + bin_] = 1
        inp = x @ w["rnn_input/dense/kernel"] + w["rnn_input/dense/bias"]
        for layer in range(2):
            cell = f"rnn/rnn/multi_rnn_cell/cell_{layer}/lstm_cell/"
            z = np.concatenate([inp, h[layer]]) @ w[cell + "kernel"] + w[cell + "bias"]
            i, j, f, o = np.split(z, 4)
            c[layer] = c[layer] * _sigmoid(f + 1.0) + _sigmoid(i) * np.tanh(j)
            h[layer] = np.tanh(c[layer]) * _sigmoid(o)
            inp = h[layer]
        logits = h[1] @ w["pitches/dense/kernel"] + w["pitches/dense/bias"]
        last_key = int(np.argmax(logits))
        out.append((logits, last_key))
    return out


def _run_node(tmp_path, weights, script):
    """Run genie.js + `script` under Node with `weights` loaded as `vars`."""
    names = list(weights)
    (tmp_path / "w.bin").write_bytes(b"".join(weights[n].astype("<f4").tobytes() for n in names))
    shapes = {n: list(weights[n].shape) for n in names}
    harness = GENIE_JS.read_text(encoding="utf-8") + f"""
const fs = require("fs");
const raw = fs.readFileSync({json.dumps(str(tmp_path / "w.bin"))});
const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice();
const shapes = {json.dumps(shapes)};
const vars = {{}};
let offset = 0;
for (const name of {json.dumps(names)}) {{
  const size = shapes[name].reduce((a, b) => a * b, 1);
  vars[{json.dumps(PREFIX)} + name] = new Float32Array(bytes.buffer.slice(offset, offset + 4 * size));
  offset += 4 * size;
}}
{script}
"""
    path = tmp_path / "harness.js"
    path.write_text(harness)
    result = subprocess.run(["node", str(path)], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


# Buttons with delta times, including exact bin boundaries ((k + 0.5) / 31.25)
# and a long pause past the last bin.
PRESSES = [(0, 1e5), (3, 0.0), (7, 0.016), (7, 0.048), (2, 0.08), (5, 0.112),
           (1, 1.0), (6, 5.0), (4, 0.25), (4, 0.5), (0, 0.75), (7, 1.008)]


def test_logits_match_numpy_reference(tmp_path):
    weights = _weights()
    got = _run_node(tmp_path, weights, f"""
const g = new Genie(vars);
const out = [];
for (const [b, dt] of {json.dumps(PRESSES)}) {{
  const logits = g.step(b, dt);
  let k = 0; for (let i = 1; i < 88; i++) if (logits[i] > logits[k]) k = i;
  g.lastKey = k;
  out.push([Array.from(logits), k]);
}}
console.log(JSON.stringify(out));
""")
    expected = _reference(weights, PRESSES)
    assert len(got) == len(expected)
    for (logits, key), (ref_logits, ref_key) in zip(got, expected):
        assert np.allclose(logits, ref_logits, atol=1e-4)
        assert key == ref_key


def test_next_greedy_and_key_subset(tmp_path):
    got = _run_node(tmp_path, _weights(1), """
const g = new Genie(vars);
const greedy = [0, 3, 7].map((b) => g.next(b, { temperature: 0, deltaTime: 0.2 }));
const allowed = [27, 31, 34, 39, 46];
const sub = Array.from({ length: 40 }, (_, i) => g.next(i % 8, { keys: allowed }));
const sampled = Array.from({ length: 40 }, (_, i) => g.next(i % 8, { temperature: 1 }));
g.reset();
console.log(JSON.stringify({ greedy, sub, sampled, lastKey: g.lastKey }));
""")
    assert all(0 <= k < 88 for k in got["greedy"] + got["sampled"])
    assert set(got["sub"]) <= {27, 31, 34, 39, 46}
    assert got["lastKey"] == -1  # reset() forgets the previous note


def test_greedy_matches_reference_choices(tmp_path):
    weights = _weights(2)
    presses = [(b % 8, 0.1 * (b % 5)) for b in range(30)]
    got = _run_node(tmp_path, weights, f"""
const g = new Genie(vars);
console.log(JSON.stringify({json.dumps(presses)}.map(([b, dt]) => g.next(b, {{ temperature: 0, deltaTime: dt }}))));
""")
    assert got == [key for _, key in _reference(weights, presses)]
