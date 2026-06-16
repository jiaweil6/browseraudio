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

> **Status:** recording *and* playback. A drop-in `sounddevice`
> replacement is on the [roadmap](#roadmap).

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
playback hands a buffer to a one-shot `AudioBufferSourceNode`. (Both are
deliberately simple — see the [roadmap](#roadmap) for the planned `AudioWorklet`
upgrade.)

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **No Record button appears** | The frontend needs a Jupyter-widget-capable runtime. In a bare Pyodide page without the widget manager, widgets don't render — use JupyterLite, thebe-lite, or Jupyter. |
| **Permission denied / no prompt** | The mic needs a **secure context** (`https://` or `localhost`) and a user gesture. Click the button; if you previously blocked the mic, re-allow it in the browser's site settings. |
| **`rec.samples` is `None`** | You haven't recorded yet, or you read it in the *same* cell that created the recorder. Click **Record**, then read it in a **new** cell. |
| **Recorded, but silent** | Check `rec.error`, and that the right input device is selected and unmuted at the OS/browser level. |
| **`await record()` hangs** | Not supported — the kernel can't process the widget reply mid-cell. Use the two-cell flow. |
| **`to_pyquist()` raises `ImportError`** | Install pyquist (`pip install pyquist`), or use `rec.samples` / `rec.sample_rate` directly. |

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
| `browseraudio/__init__.py` | Public API (`Recorder`, `record`, `Player`, `play`) and version. |
| `browseraudio/_recorder.py` | The `Recorder` widget and `record()` (Python side). |
| `browseraudio/_player.py` | The `Player` widget and `play()` (Python side). |
| `browseraudio/static/recorder.js` | Recorder frontend — Web Audio capture. |
| `browseraudio/static/player.js` | Player frontend — Web Audio playback. |
| `tests/` | The `pytest` suite (Python side, headless). |
| `demo/` | Static demo site, published to [GitHub Pages](https://jiaweil6.github.io/browseraudio/). |
| `pyproject.toml` | Packaging metadata; `static/*.js` is shipped as package data. |

The [`tests/`](tests) suite covers the Python side headlessly — the base64↔NumPy
transport, array shapes, validation, and version sync — and runs in CI on every
push and pull request across Python 3.9–3.13. (The browser frontend's Web Audio
path isn't unit-tested yet.) Contributions and issues are welcome.

## Roadmap

- ✅ **Playback** — push a buffer to a main-thread `AudioContext`. _(0.2.0)_
- **`sounddevice`-compatible facade** — a `browseraudio.sounddevice` shim
  exposing `play` / `rec` / `wait` / `query_devices` so libraries like
  [pyquist](https://github.com/gclef-cmu/pyquist) run in the browser unchanged
  (a real replacement, not a stub). Note the catch: `sd.rec` + `sd.wait` is
  *blocking*, which a Web-Worker kernel can't honor in one cell — so record
  stays two-cell (or async), while `play` is genuinely drop-in.
- **AudioWorklet backend** — replace the deprecated `ScriptProcessorNode`.
- **Binary comm transport** — send raw buffers instead of base64.
- **Streaming** (stretch) — generator → ring buffer → AudioWorklet. Bounded by
  the browser: Python can't run in the audio thread, and `SharedArrayBuffer`
  needs cross-origin-isolation (COOP/COEP) headers.

## License

[MIT](LICENSE)
