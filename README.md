# browseraudio

Microphone capture for **in-browser Python** — Pyodide, JupyterLite, thebe-lite —
via the browser's Web Audio API.

When Python runs in the browser it usually lives in a **Web Worker**, where the
Web Audio API and `getUserMedia` don't exist and the DOM is out of reach. So
the classic audio stack (`sounddevice` → PortAudio) can't run, and libraries
that depend on it fall back to "not available" stubs. `browseraudio` bridges
that gap: it captures audio on the browser's **main thread** (through a tiny
[`anywidget`](https://anywidget.dev) frontend) and hands the samples back to the
Python kernel over the widget comm channel.

> **Status: v0 — recording only, and a foundation to build on.** The full
> round-trip is proven end-to-end under thebe-lite (Pyodide 0.27.7): a 1-second
> capture returned a float32 array, shape `(48000, 1)` at 48 kHz, with real
> signal. See the roadmap for what's next.

## Install

```sh
pip install browseraudio          # in a normal environment
```

In a browser kernel, install at runtime with micropip:

```python
import micropip
await micropip.install("browseraudio")
```

## Use

The recording finishes *after* you click the button, so read the result in a
**separate cell** from the one that shows the widget:

```python
from browseraudio import Recorder

rec = Recorder(duration=3.0)
rec                      # shows a "● Record 3s" button — click it, then speak
```

After it captures, an inline player appears so you can hear the take. Then,
**in the next cell**, use the audio:

```python
rec.samples              # float32 ndarray, shape (n_frames, 1)
rec.sample_rate          # e.g. 48000
```

> Why two cells? A single-cell `await record()` can't work in Jupyter/thebe —
> the kernel doesn't process the widget's reply while that same cell is still
> running, so the recording would never arrive. Display in one cell, use it in
> the next.

With [pyquist](https://github.com/gclef-cmu/pyquist) installed, get an `Audio`
object directly:

```python
clip = rec.to_pyquist()  # pyquist.Audio
```

## How it works

```
 main thread (browser)                         worker (Python kernel)
 ─────────────────────                         ──────────────────────
 getUserMedia → AudioContext  ──comm (base64 float32)──►  numpy float32
 (anywidget frontend)                                     Recorder.samples
```

The kernel→page direction (displaying the widget) and the page→kernel direction
(sending samples back) both ride the standard Jupyter widget comm, which works
in JupyterLite and thebe-lite.

## Roadmap

- **Playback** — push a buffer to a main-thread `AudioContext` (`play`).
- **AudioWorklet backend** — replace the deprecated `ScriptProcessorNode` used
  in v0.
- **sounddevice-compatible facade** — expose `play` / `rec` / `wait` /
  `query_devices` so a library like pyquist works in the browser **unchanged**
  (a real `sounddevice` replacement, not a stub).
- **Streaming** (stretch) — generator → ring buffer → AudioWorklet. Bounded by
  the browser: Python can't run in the audio thread, and `SharedArrayBuffer`
  needs cross-origin-isolation (COOP/COEP) headers.

## Caveats

- Recording needs **HTTPS** (or `localhost`), a **user gesture** (the button),
  and the browser's microphone-permission prompt.
- v0 transfers samples as base64 over the comm — simple and robust; binary comm
  buffers would be more efficient.
- v0 uses `ScriptProcessorNode` (deprecated but universally supported).

## License

MIT
