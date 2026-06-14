"""browseraudio — microphone capture for in-browser Python (Pyodide / JupyterLite).

A small, framework-agnostic bridge from the browser's Web Audio API to Python
running in a WebAssembly kernel. The kernel often lives in a Web Worker, where
Web Audio and ``getUserMedia`` are unavailable; this library does the capture
on the main thread (via an ``anywidget`` frontend) and ships the samples back.

v0: recording only. See the README for the roadmap (playback, an AudioWorklet
backend, an async ``await record()`` API, and a sounddevice-compatible facade
so libraries like pyquist work unchanged in the browser).
"""

from ._recorder import Recorder, record

__all__ = ["Recorder", "record"]
__version__ = "0.0.2"
