# browseraudio

[![PyPI](https://img.shields.io/pypi/v/browseraudio.svg)](https://pypi.org/project/browseraudio/)
[![Python](https://img.shields.io/pypi/pyversions/browseraudio.svg)](https://pypi.org/project/browseraudio/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Microphone capture for in-browser Python** — record from the mic in
[Pyodide](https://pyodide.org), [JupyterLite](https://jupyterlite.readthedocs.io),
and [thebe](https://github.com/jupyter-book/thebe), straight into a NumPy array.

In the browser, Python usually runs in a Web Worker with no access to
`getUserMedia` or the Web Audio API — so the usual `sounddevice` → PortAudio
stack can't run. `browseraudio` captures audio on the page's main thread (via a
tiny [anywidget](https://anywidget.dev) frontend) and hands the float32 samples
back to the kernel, so recording works even from a worker.

> **Status:** recording only — the foundation. Playback and a drop-in
> `sounddevice` replacement are on the [roadmap](#roadmap).

## Contents

- [Requirements](#requirements)
- [Install](#install)
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
| **Permission** | The user must grant the microphone permission prompt, triggered by clicking the Record button. |

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

## API reference

### `record(duration=3.0)`

Create a [`Recorder`](#recorder), display it, and return it. Convenience wrapper
for the common case. Click **Record**, then read the result (see
[`Recorder`](#recorder)) in a later cell.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `duration` | `float` | `3.0` | Length to record, in seconds. |

**Returns** a `Recorder`.

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
   your Python kernel. An [anywidget](https://anywidget.dev) frontend lives here
   and does the actual capture, then encodes the float32 samples.
2. **The worker** runs your Python kernel (this is how Pyodide/JupyterLite keep
   the page responsive), but it can't reach those audio APIs. It receives the
   encoded samples and decodes them into a NumPy array as `rec.samples`.

The two contexts talk over the **standard Jupyter widget comm channel** — the
same mechanism any `ipywidgets` widget uses — so browseraudio works wherever
widgets do: JupyterLite, thebe-lite, classic Jupyter, and marimo.

Under the hood the frontend uses a `ScriptProcessorNode` to accumulate audio for
`duration` seconds, base64-encodes the float32 buffer, and sends it over the
comm; the Python side decodes it with `numpy.frombuffer`. (Both are deliberately
simple — see the [roadmap](#roadmap) for the planned `AudioWorklet` upgrade.)

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
pip install -e ".[pyquist]"     # editable install with the optional extra
python -m build                 # build the wheel + sdist into dist/
python -m twine check dist/*    # validate package metadata
```

Project layout:

| Path | Purpose |
|---|---|
| `browseraudio/__init__.py` | Public API (`Recorder`, `record`) and version. |
| `browseraudio/_recorder.py` | The `Recorder` widget and `record()` (Python side). |
| `browseraudio/static/recorder.js` | The anywidget frontend (Web Audio capture). |
| `pyproject.toml` | Packaging metadata; `static/*.js` is shipped as package data. |

There is no automated test suite yet — the recording round-trip is exercised
end-to-end (headless Chrome with a fake media stream) in the consuming project.
Contributions, issues, and a proper test harness are welcome.

## Roadmap

- **Playback** — push a buffer to a main-thread `AudioContext`.
- **AudioWorklet backend** — replace the deprecated `ScriptProcessorNode`.
- **`sounddevice`-compatible facade** — `play` / `rec` / `wait` so libraries
  like [pyquist](https://github.com/gclef-cmu/pyquist) run in the browser
  unchanged (a real replacement, not a stub).
- **Binary comm transport** — send raw buffers instead of base64.
- **Streaming** (stretch) — generator → ring buffer → AudioWorklet. Bounded by
  the browser: Python can't run in the audio thread, and `SharedArrayBuffer`
  needs cross-origin-isolation (COOP/COEP) headers.

## License

[MIT](LICENSE)
