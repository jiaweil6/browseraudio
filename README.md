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

## Roadmap

- **Playback** — push a buffer to a main-thread `AudioContext`.
- **AudioWorklet backend** — replace the deprecated `ScriptProcessorNode`.
- **`sounddevice`-compatible facade** — `play` / `rec` / `wait` so libraries
  like [pyquist](https://github.com/gclef-cmu/pyquist) run in the browser
  unchanged (a real replacement, not a stub).
- **Streaming** (stretch) — generator → ring buffer → AudioWorklet.

## Caveats

- Needs **HTTPS** (or `localhost`), a **user gesture** (the button), and the
  browser's microphone-permission prompt.
- Transfers samples as base64 over the comm (simple and robust; binary buffers
  would be leaner) and uses `ScriptProcessorNode` (deprecated but universal).

## License

[MIT](LICENSE)
