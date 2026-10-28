# browseraudio

[![PyPI](https://img.shields.io/pypi/v/browseraudio.svg)](https://pypi.org/project/browseraudio/)
[![Python](https://img.shields.io/pypi/pyversions/browseraudio.svg)](https://pypi.org/project/browseraudio/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Audio I/O for in-browser Python ([Pyodide](https://pyodide.org),
[JupyterLite](https://jupyterlite.readthedocs.io), [thebe](https://github.com/jupyter-book/thebe)):
record, play, and synthesize in real time, to and from NumPy.

Browser kernels usually run in a Web Worker, which can't reach the Web Audio API.
browseraudio does the audio on the page's main thread through small
[anywidget](https://anywidget.dev) frontends and moves the samples over the widget comm.

**[Live demo →](https://jiaweil6.github.io/browseraudio/)**

## Install

```sh
pip install browseraudio
```

In a browser kernel: `import micropip; await micropip.install("browseraudio")`.
Needs a widget-capable kernel (JupyterLite, thebe, Jupyter, marimo) and, for the
microphone, a secure context (`https://` or `localhost`).

## Quickstart

```python
from browseraudio import record, play, keyboard, stream

rec = record(3.0)                 # click Record; read rec.samples in the NEXT cell
play(rec.samples, rec.sample_rate)
```

Recording finishes after the cell returns (a Web-Worker kernel can't receive the
take mid-cell), so read `rec.samples` in a later cell.

**Keyboard**: design a sound, then play it on the computer keyboard (`A W S E D …`,
`Z`/`X` for octaves). Notes are voiced in the page, polyphonic, with no kernel round trip:

```python
import numpy as np
sr = 22050
t = np.arange(sr) / sr
kb = keyboard(lambda f: np.sin(2 * np.pi * f * t) * np.exp(-4 * t), sr)
```

**Stream**: real-time synthesis. The browser pulls blocks from your callback:

```python
class Sine:
    def __init__(self):
        self.pitch, self.phase, self.on, self.amp = 60, 0.0, False, 0.0

    def callback(self, block):                     # (B, 1) with .sample_rate
        B = len(block)
        f = 440 * 2 ** ((self.pitch - 69) / 12)
        target = 0.3 if self.on else 0.0
        amp = np.linspace(self.amp, target, B, endpoint=False)  # glide: no clicks
        d = 2 * np.pi * f / block.sample_rate
        block[:, 0] = amp * np.sin(self.phase + d * np.arange(B))
        self.phase, self.amp = (self.phase + d * B) % (2 * np.pi), target

synth = Sine()
def on_note(midi, on):
    if on: synth.pitch, synth.on = midi, True
    elif midi == synth.pitch: synth.on = False

s = stream(synth.callback, sample_rate=44100, block_size=512, on_note=on_note)
```

The widget shows block size, queue, round trip, callback load, dropouts and
key-to-sound latency. For chords, keep one voice per held key (see the demo).

**Genie mode**: pass `input="genie"` to `keyboard` or `stream`, or use the widget's
Keys | Genie switch. Eight buttons (`1`–`8` or `A S D F J K L ;`) become piano music
via [Piano Genie](#credits).

**sounddevice code** runs unchanged once the facade is registered:

```python
import sys, browseraudio.sounddevice
sys.modules["sounddevice"] = browseraudio.sounddevice
```

## API

| Call | What it does |
|---|---|
| `record(duration=3.0)` → `Recorder` | Mic capture. `.samples` (float32 `(n, 1)`), `.sample_rate`, `.error`, `on_result(cb)`, `on_error(cb)`, `await result()` (main thread only), `to_pyquist()`. Stopping early keeps the take. |
| `play(samples, sample_rate=None, *, autoplay=True)` → `Player` | Plays `(n,)` or `(n, ch)`; `sample_rate` may come from `samples.sample_rate`. `.play()`, `.stop()`, `.playing`. |
| `keyboard(render=None, sample_rate=None, *, wavetable=None, …)` → `Keyboard` | `render(freq) -> ndarray` per note, or a looped `wavetable`. Options: `attack/decay/sustain/release`, `gain`, `one_shot`, `max_voices`, `keymap`, `input`, `genie_temperature`, `genie_checkpoint`. `.events`, `.render()`, `.on_note(cb)`, `.clear()`. |
| `stream(callback, sample_rate=44100, block_size=512, *, …)` → `Stream` | `callback(block)` per block. Options: `channels`, `lookahead` (seconds, default 0.04), `on_note(midi, on)`, `keymap`, `input`, `genie_range`, `genie_temperature`, `genie_checkpoint`. `.start()`, `.stop()`, `.playing`, `.error`, `.dropouts`. |
| `KeyMap(keys, table, start=0, labels=None)` | Key codes → MIDI through a state machine: `table[state][i] = (midi or None, next_state)`. `KeyMap.musical_typing(base=60)`. |
| `browseraudio.sounddevice` | `play`, `wait`, `OutputStream` (callback mode), `query_devices`, `default`, `CallbackStop`/`CallbackAbort`, `CallbackFlags`. `rec` raises; use `record`. |

## How it works

Widgets render in a Shadow DOM. They follow the JupyterLab theme, or the host
page's text colour and font elsewhere. Audio crosses the comm as base64 float32.
For streams the browser is the clock: an AudioWorklet plays a short queue and asks
the kernel for each next block. A kernel answers whenever no cell is running, even
in a Web Worker, so a control change is heard after the queue plus one round trip
(about 50–100 ms). Dropouts and Stop fade out rather than click.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No widget | Use a widget-capable kernel (JupyterLite, thebe, Jupyter). |
| No mic prompt, or denied | Needs `https://` or `localhost` and a click; re-allow the mic in site settings. |
| `rec.samples` is `None` | Read it in a later cell, after recording. |
| Stream crackles | A cell is running, the callback is too slow (see "% of budget"), or `lookahead` is too short. |
| Stream started from code is silent | Click **Enable audio** (browser autoplay policy). |
| Keys don't play | Click the widget first. |
| Genie can't load | `storage.googleapis.com` must be reachable; or self-host and pass `genie_checkpoint=`. |

## Development

```sh
pip install -e ".[test]" && pytest     # genie tests also need node
python -m build && python -m twine check dist/*
```

Python is in `browseraudio/`, frontends in `browseraudio/static/` (`ui.js` is shared;
`genie.js` and `controls.js` are added for keyboard widgets), and the demo site in `demo/`.

## Credits

Genie mode is [Piano Genie](https://magenta.tensorflow.org/pianogenie). It runs
[Magenta](https://magenta.tensorflow.org/)'s published model (Apache-2.0) with
inference ported from [Magenta.js](https://github.com/magenta/magenta-js) (Apache-2.0).
Please cite:

```bibtex
@inproceedings{donahue2019pianogenie,
  title     = {Piano Genie},
  author    = {Donahue, Chris and Simon, Ian and Dieleman, Sander},
  booktitle = {Proceedings of the 24th International Conference on Intelligent User Interfaces},
  pages     = {160--164},
  year      = {2019},
  doi       = {10.1145/3301275.3302288}
}
```

## License

[MIT](LICENSE)
