# browseraudio

[![PyPI](https://img.shields.io/pypi/v/browseraudio.svg)](https://pypi.org/project/browseraudio/)
[![Python](https://img.shields.io/pypi/pyversions/browseraudio.svg)](https://pypi.org/project/browseraudio/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Audio I/O for in-browser Python** — record from the mic *and* play audio back in
[Pyodide](https://pyodide.org), [JupyterLite](https://jupyterlite.readthedocs.io),
and [thebe](https://github.com/jupyter-book/thebe), straight to and from a NumPy array.

In the browser, Python usually runs in a Web Worker with no access to
`getUserMedia` or the Web Audio API — so the usual `sounddevice` → PortAudio
stack can't run. `browseraudio` does the capture *and* playback on the page's main
thread (via a tiny [anywidget](https://anywidget.dev) frontend) and ferries the
float32 samples across, so it works even when the kernel runs in a worker.

> **Status:** recording, playback, **real-time synthesis** (a block callback
> played live, controlled from the computer keyboard or any widget), and a
> `sounddevice`-compatible facade (`browseraudio.sounddevice`, including
> `OutputStream`). See the [roadmap](#roadmap) for what's next.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Live demo](#live-demo)
- [Quickstart](#quickstart)
- [API reference](#api-reference)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

## Requirements

| | |
|---|---|
| **Python** | 3.9+ |
| **Runtime** | A browser Python kernel that supports Jupyter widgets — JupyterLite, thebe-lite, classic Jupyter, or marimo. (Also works on a native kernel, but native code should just use `sounddevice`.) |
| **Browser** | Any current Chromium, Firefox, or Safari (needs the Web Audio API + `getUserMedia`). |
| **Context** | A **secure context** — `https://` or `http://localhost`. Browsers block microphone access on plain `http://`. |
| **Permission** | Recording needs the microphone-permission prompt (triggered by clicking **Record**). Playback needs no permission. |

Runtime dependencies: [`anywidget`](https://anywidget.dev) and `numpy`.
[`pyquist`](https://github.com/gclef-cmu/pyquist) is optional (only for
`Recorder.to_pyquist()`).

## Install

```sh
pip install browseraudio
```

In a browser kernel (JupyterLite / thebe), install at runtime with micropip:

```python
import micropip
await micropip.install("browseraudio")
```

## Live demo

**[Try it live → jiaweil6.github.io/browseraudio](https://jiaweil6.github.io/browseraudio/)**
— a static site that runs browseraudio's own frontend (record + playback) right in your
browser, no install. Or serve the [`demo/`](demo/) folder locally:

```sh
cd demo && python -m http.server 8000   # then visit http://localhost:8000
```

## Quickstart

Recording finishes *after* you click, so display the recorder in one cell and
read the result in the next.

```python
from browseraudio import record

rec = record(3.0)          # shows "● Record 3s" — click it, allow the mic, speak
```

An inline player appears so you can hear the take. Then, **in a new cell**:

```python
rec.samples                # float32 ndarray, shape (n_frames, 1)
rec.sample_rate            # e.g. 48000
rec.to_pyquist()           # a pyquist.Audio, if pyquist is installed
```

> **Why two cells?** A single-cell `await record()` can't work in Jupyter/thebe:
> the kernel doesn't process the widget's reply while that same cell is still
> running, so the recording would never arrive.

### Playback

Playback is *fire-and-forget* — nothing has to return to the kernel — so it
works in a **single cell**:

```python
from browseraudio import play

play(rec.samples, rec.sample_rate)   # ▶ plays through the speakers
play(rec.to_pyquist())               # sample_rate read from the pyquist.Audio
```

> **Autoplay.** Browsers block audio that starts without a user gesture, so
> playback may not start on its own — just click the **▶ Play** button the
> widget shows.

### Real-time synthesis

Write the audio callback a sound card would call — fill one block, keep your
state (here the phase) between blocks — and play it live. Press **▶ Start**,
click the widget, and hold keys on the computer keyboard (`A W S E D F …`,
`Z`/`X` for octaves):

```python
import numpy as np
from browseraudio import stream

class Sinusoid:
    def __init__(self):
        self.pitch, self.phase = None, 0.0     # None: no key held

    def callback(self, block):                  # block: (B, channels), .sample_rate
        if self.pitch is None:
            return                              # blocks start zeroed: silence
        f = 440 * 2 ** ((self.pitch - 69) / 12)
        dphase = 2 * np.pi * f / block.sample_rate
        block[:] = 0.3 * np.sin(self.phase + dphase * np.arange(len(block)))[:, None]
        self.phase = (self.phase + dphase * len(block)) % (2 * np.pi)

synth = Sinusoid()

def on_note(midi, on):
    if on:
        synth.pitch = midi                      # a new key: glide, keep the phase
    elif midi == synth.pitch:                   # the sounding key was released
        synth.pitch = None

s = stream(synth.callback, sample_rate=44100, block_size=512, on_note=on_note)
```

The widget shows the block size, the queue, the kernel round trip, how much of
the time budget your callback uses, dropouts, and the resulting key-to-sound
latency — try `block_size=1` and `block_size=16384`. Existing
`sounddevice.OutputStream` code runs too, via
[`browseraudio.sounddevice`](#browseraudiosounddevice).

## API reference

### `record(duration=3.0)`

Create a [`Recorder`](#recorder), display it, and return it. Convenience wrapper
for the common case. Click **Record**, then read the result (see
[`Recorder`](#recorder)) in a later cell.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `duration` | `float` | `3.0` | Length to record, in seconds. |

**Returns** a `Recorder`.

### `play(samples, sample_rate=None, *, autoplay=True)`

Create a [`Player`](#player), display it, and return it — playing `samples`
through the page's speakers on the browser's main thread. A drop-in shape for
`sounddevice.play` / `pyquist.play`.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `samples` | array-like | — | Audio as `(n_frames,)` or `(n_frames, n_channels)`, values in `[-1, 1]`. |
| `sample_rate` | `int` | `None` | Sample rate in Hz. If `None`, read from `samples.sample_rate` (e.g. a `pyquist.Audio`). |
| `autoplay` | `bool` | `True` | Try to start immediately; falls back to the **▶ Play** button if the browser blocks autoplay. |

**Returns** a `Player`. **Raises** `ValueError` if `samples` isn't 1-D/2-D or no
sample rate can be determined.

### `Player`

An [anywidget](https://anywidget.dev) that plays a NumPy audio buffer through
the browser's `AudioContext` — so playback works even when the kernel runs in a
Web Worker. Multi-channel buffers are sent channel-major; the `AudioContext`
resamples to its own rate, so any `sample_rate` is fine. Use
[`play()`](#playsamples-sample_rate--autoplaytrue) rather than constructing it
directly.

### `stream(callback, sample_rate=44100, block_size=512, **kwargs)`

Create a [`Stream`](#stream), display it, and return it — real-time synthesis
from a block callback, played live in the browser.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `callback` | callable | — | `callback(block)` fills `block`, a zeroed float32 `(block_size, channels)` array with a `.sample_rate` (the shape of a pyquist block), in place — or returns an array of that shape. |
| `sample_rate` | `int` | `44100` | The `AudioContext` rate, in Hz. |
| `block_size` | `int` | `512` | Frames per block (B). |
| `channels` | `int` | `1` | Output channels. |
| `lookahead` | `float` | `0.04` | Seconds of audio kept queued in the browser (rounded up to whole blocks, at least two). Below the kernel round trip, the stream drops out. |
| `on_note` | callable | `None` | `on_note(midi, is_on)` for each key press / release on the widget. |
| `keymap` | `KeyMap` | musical typing | Which computer keys play which notes (see [`KeyMap`](#keymap)). |

### `Stream`

The widget behind `stream()`. **How it works:** the browser keeps the clock. An
`AudioWorklet` plays a small queue of blocks, and each time it finishes one the
page asks the kernel for another; Python answers by calling your `callback`. So
Python never keeps time or runs a loop — it only answers widget messages, which
even a Web-Worker kernel (JupyterLite / thebe) handles **whenever no cell is
running**. A long-running cell therefore makes the stream drop out, and a
control change (a key, a slider) is heard after the queued audio plus one round
trip.

| Member | Description |
|---|---|
| `start()` / `stop()` | Start or stop playback (the **▶ Start** / **■ Stop** button does the same). |
| `playing` | Whether the stream is running. |
| `callback`, `on_note` | Reassignable at any time; the next block uses the new one. |
| `error` | The last callback / `on_note` error (the stream stops on one), else `""`. |
| `blocks_rendered`, `busy`, `dropouts` | Blocks made, seconds spent in `callback`, and browser dropouts since the last start. |

### `keyboard(render=None, sample_rate=None, **kwargs)`

Create, display, and return a [`Keyboard`](#keyboard): a synth whose sound you
design in NumPy *ahead of time* and then play with the computer keyboard, voiced
entirely in the browser — the lowest-latency option, since nothing goes back to
the kernel while you play. Pass either `render(freq) -> ndarray` (called once
per playable note, with `sample_rate`) or `wavetable=` one cycle of a waveform
(looped at any pitch).

| Parameter | Default | Description |
|---|---|---|
| `attack`, `decay`, `sustain`, `release` | `0.005`, `0`, `1`, `0.05` | Linear ADSR envelope (seconds; `sustain` is a level). |
| `gain` | `0.5` | Level per voice. |
| `one_shot` | `False` | Note-bank mode: play each note to its end, ignoring key-up. |
| `max_voices` | `16` | Polyphony; the oldest voice is stolen beyond it. |
| `keymap` | musical typing | See [`KeyMap`](#keymap). |

### `Keyboard`

| Member | Description |
|---|---|
| `events` | Notes played, as `(seconds, midi, "on" \| "off")`; they reach the kernel in small batches shortly after playing. |
| `render()` | Re-synthesise the performance offline: float32 `(n_frames, 1)` at `sample_rate`. |
| `on_note(cb, remove=False)` | Run `cb(event)` for each note played. |
| `clear()` | Forget `events` and restart the clock. |

### `KeyMap`

Maps computer keys to MIDI notes through a small state machine: pressing
`keys[i]` looks up `table[state][i] -> (midi, next_state)`, plays `midi` (unless
`None`) and moves to `next_state` — so octave keys are entries that only change
state, and context-dependent (Piano-Genie-style) mappings fit the same table.
Keys are `KeyboardEvent.code` names (`"KeyA"`, `"Semicolon"`), so the physical
layout is the same on QWERTY and AZERTY. `KeyMap.musical_typing(base=60,
octaves=(-1, 0, 1))` is the DAW-style default.

### `Recorder`

An [anywidget](https://anywidget.dev) that records from the microphone. Display
it (or use [`record()`](#record-duration30)), click **Record**, then read its
attributes in a *separate* cell once capture finishes.

```python
from browseraudio import Recorder

rec = Recorder(duration=5.0)
rec                        # display it; click Record
```

**Constructor**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `duration` | `float` | `3.0` | Length to record, in seconds. |

**Attributes**

| Attribute | Type | Description |
|---|---|---|
| `samples` | `numpy.ndarray \| None` | The latest take as float32, shape `(n_frames, 1)`; `None` before anything is recorded. |
| `sample_rate` | `int` | The browser `AudioContext` rate (e.g. `48000`); `0` before recording. |
| `duration` | `float` | The requested recording length, in seconds. |
| `error` | `str \| None` | A message if the last attempt failed (permission denied, no input, …), else `None`. |

**Methods**

| Method | Returns | Description |
|---|---|---|
| `to_pyquist()` | `pyquist.Audio` | The take as a `pyquist.Audio`. Raises `RuntimeError` if nothing has been recorded, and `ImportError` if `pyquist` isn't installed. |
| `on_result(cb)` | handler | Register `cb(recorder)` to run when a capture arrives — a public alternative to observing the internal `_pcm_b64` trait. |
| `on_error(cb)` | handler | Register `cb(message)` to run when a capture attempt fails. |
| `await result()` | `Recorder` | Awaitable that resolves with the recorder once capture completes (raising on failure). **Main-thread kernels only** — in a Web-Worker kernel it raises immediately rather than hanging; use the two-cell flow there. |

### `browseraudio.sounddevice`

A [`sounddevice`](https://python-sounddevice.readthedocs.io)-shaped facade, so a
library can fall back to it in the browser without code changes:

```python
try:
    import sounddevice as sd
except (OSError, ModuleNotFoundError):
    import browseraudio.sounddevice as sd
```

| Name | Status | Notes |
|---|---|---|
| `play(data, samplerate=None, **kw)` | drop-in | Delegates to [`play()`](#playsamples-sample_rate--autoplaytrue); fire-and-forget, single cell. |
| `wait(ignore_errors=True)` | drop-in | No-op — browser playback doesn't block. |
| `OutputStream(samplerate, blocksize, device, channels, callback=..., ...)` | drop-in (callback mode) | Runs `callback(outdata, frames, time, status)` in real time through a [`Stream`](#stream): `start()` shows a compact engine widget; `stop()` / `close()` / `abort()`, `active` / `stopped` / `closed`, `finished_callback`, `cpu_load`, `with` blocks. Browser dropouts arrive as `status.output_underflow`. `device` is ignored, only `float32`, and `time` holds estimates. Start the stream and let the cell finish — don't `sd.sleep()` in it (blocks are made only while no cell runs). |
| `CallbackStop`, `CallbackAbort`, `CallbackFlags` | drop-in | Raise either to end a stream; `CallbackFlags` is the `status` object. |
| `query_devices(device=None, kind=None)` | drop-in | A synthetic two-device table (browser mic + speakers), printed like sounddevice's; resolves indices, name substrings, and `(input, output)` pairs with `kind`. |
| `default` | drop-in | Mimics `sd.default`; its `device` slot is indexable and assignable. |
| `rec(...)` | **not supported** | Raises with guidance toward the two-cell [`record()`](#record-duration30): the browser picks the sample rate and can't fill a buffer synchronously in one cell. |

Code written against `sounddevice` — including course support modules with
their own widgets — can run unchanged by registering the facade under that name
before anything imports `sounddevice`:

```python
import sys, browseraudio.sounddevice
sys.modules["sounddevice"] = browseraudio.sounddevice
```

## How it works

A browser tab has two Python-relevant execution contexts, and browseraudio uses
both:

1. **The page (main thread)** has the Web Audio API and `getUserMedia`, but not
   your Python kernel. An [anywidget](https://anywidget.dev) frontend lives here:
   for recording it captures and encodes the float32 samples; for playback it
   decodes a buffer into an `AudioContext` and plays it through the speakers.
2. **The worker** runs your Python kernel (this is how Pyodide/JupyterLite keep
   the page responsive), but it can't reach those audio APIs. `record()` receives
   the captured samples as `rec.samples`; `play()` ships a NumPy buffer the other
   way for the page to sound.

The two contexts talk over the **standard Jupyter widget comm channel** — the
same mechanism any `ipywidgets` widget uses — so browseraudio works wherever
widgets do: JupyterLite, thebe-lite, classic Jupyter, and marimo.

Under the hood, audio crosses the comm as base64-encoded float32. Recording uses a
`ScriptProcessorNode` to accumulate `duration` seconds before sending it up;
playback hands a buffer to a one-shot `AudioBufferSourceNode`.

Real-time synthesis turns the flow around: the **browser is the clock**. An
`AudioWorklet` plays a short queue of blocks and, as each finishes, the page asks
the kernel for the next; the kernel answers by running your callback. Because
the kernel only *reacts* to messages, this works in a Web-Worker kernel too —
the same reason widget values (a key, a slider) reach your callback between
blocks.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **No Record button appears** | The frontend needs a Jupyter-widget-capable runtime. In a bare Pyodide page without the widget manager, widgets don't render — use JupyterLite, thebe-lite, or Jupyter. |
| **Permission denied / no prompt** | The mic needs a **secure context** (`https://` or `localhost`) and a user gesture. Click the button; if you previously blocked the mic, re-allow it in the browser's site settings. |
| **`rec.samples` is `None`** | You haven't recorded yet, or you read it in the *same* cell that created the recorder. Click **Record**, then read it in a **new** cell. |
| **Recorded, but silent** | Check `rec.error`, and that the right input device is selected and unmuted at the OS/browser level. |
| **`await record()` hangs** | In a Web-Worker kernel (JupyterLite / thebe) the kernel can't process the widget reply mid-cell — use the two-cell flow. On the page's main thread, `await rec.result()` works in one cell. |
| **`to_pyquist()` raises `ImportError`** | Install pyquist (`pip install pyquist`), or use `rec.samples` / `rec.sample_rate` directly. |
| **A stream crackles (dropouts)** | The kernel didn't answer in time: a cell is running (blocks are only made while the kernel is idle), the callback is slower than real time (see "% of budget"), or the queue is shorter than the round trip — raise `lookahead`. |
| **A stream started from code is silent** | The browser's autoplay policy kept audio off; click **🔈 Click to enable audio** on the widget. |
| **Keys don't play** | Click the widget first — it only listens while focused (so typing in cells never plays notes). |

## Development

```sh
git clone https://github.com/jiaweil6/browseraudio
cd browseraudio
pip install -e ".[test,pyquist]"   # editable install with test + optional extras
pytest                             # run the test suite
python -m build                    # build the wheel + sdist into dist/
python -m twine check dist/*       # validate package metadata
```

Project layout:

| Path | Purpose |
|---|---|
| `browseraudio/__init__.py` | Public API and version. |
| `browseraudio/_recorder.py` | The `Recorder` widget and `record()` (Python side). |
| `browseraudio/_player.py` | The `Player` widget and `play()` (Python side). |
| `browseraudio/_stream.py` | The `Stream` widget and `stream()` — real-time block synthesis. |
| `browseraudio/_keyboard.py` | The `Keyboard` widget, `keyboard()`, and `KeyMap`. |
| `browseraudio/sounddevice.py` | The `sounddevice`-shaped facade, including `OutputStream`. |
| `browseraudio/_pcm.py` | The base64 float32 wire format. |
| `browseraudio/static/recorder.js` | Recorder frontend — Web Audio capture. |
| `browseraudio/static/player.js` | Player frontend — Web Audio playback. |
| `browseraudio/static/stream.js` | Stream frontend — the AudioWorklet and block requests. |
| `browseraudio/static/keyboard.js` | Keyboard frontend — note voicing. |
| `browseraudio/static/keys.js` | The computer-keyboard control surface shared by Stream and Keyboard. |
| `tests/` | The `pytest` suite (Python side, headless). |
| `demo/` | Static demo site, published to [GitHub Pages](https://jiaweil6.github.io/browseraudio/). |
| `pyproject.toml` | Packaging metadata; `static/*.js` is shipped as package data. |

The [`tests/`](tests) suite covers the Python side headlessly — the base64↔NumPy
transport, array shapes, validation, and version sync — and runs in CI on every
push and pull request across Python 3.9–3.13. (The browser frontend's Web Audio
path isn't unit-tested yet.) Contributions and issues are welcome.

## Roadmap

- ✅ **Playback** — push a buffer to a main-thread `AudioContext`. _(0.2.0)_
- ✅ **`sounddevice`-compatible facade** — `browseraudio.sounddevice` exposes
  `play` / `wait` / `query_devices` / `default` so libraries like
  [pyquist](https://github.com/gclef-cmu/pyquist) can fall back to it in the
  browser. `play` is genuinely drop-in; the catch is `sd.rec` + `sd.wait`, which
  is *blocking* — a Web-Worker kernel can't honor that in one cell, so `rec`
  raises with guidance toward the two-cell `record()` flow (and
  `Recorder.result()` offers an `await` path on the main thread). _(Unreleased)_
- ✅ **Real-time synthesis** — `stream()` and `sounddevice.OutputStream`: an
  `AudioWorklet` pulls blocks from a Python callback. Control latency is the
  queue plus a kernel round trip (~50–100 ms). _(Unreleased)_
- ✅ **Keyboard synth** — `keyboard()`: sounds designed in NumPy, voiced in the
  browser with no kernel round trip. _(Unreleased)_
- **Piano-Genie-style mappings** — context-dependent `KeyMap` tables from a
  Python function.
- **AudioWorklet capture** — replace the deprecated `ScriptProcessorNode` in
  `Recorder`.
- **Binary comm transport** — send raw buffers instead of base64.

## License

[MIT](LICENSE)
