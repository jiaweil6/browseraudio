"""browseraudio — microphone capture for in-browser Python (Pyodide / JupyterLite).

A small, framework-agnostic bridge from the browser's Web Audio API to Python
running in a WebAssembly kernel. The kernel often lives in a Web Worker, where
Web Audio and ``getUserMedia`` are unavailable; this library does the capture
(and playback) on the main thread (via an ``anywidget`` frontend) and ships
the samples across.

Recording, playback, and a ``sounddevice``-compatible facade
(:mod:`browseraudio.sounddevice`) so libraries like pyquist can fall back to it
in the browser. On the page's main thread, ``await Recorder.result()`` resolves
a take in one cell; in a Web-Worker kernel use the two-cell flow. See the README
for the roadmap (e.g. an AudioWorklet backend).
"""

from ._player import Player, play
from ._recorder import Recorder, record

__all__ = ["Recorder", "record", "Player", "play"]
__version__ = "0.3.0"
