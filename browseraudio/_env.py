"""Runtime environment detection.

browseraudio behaves differently depending on *where* the Python kernel runs:

* **Native** (CPython on your OS) — there is no browser; libraries should use
  ``sounddevice`` directly. browseraudio still imports cleanly so its data-path
  code can be unit-tested headlessly.
* **Browser, main thread** (a bare Pyodide page) — the Web Audio API is
  reachable and the asyncio event loop can service widget-comm replies, so an
  ``await``-based capture *can* complete.
* **Browser, Web Worker** (JupyterLite / thebe-lite) — the kernel can't touch
  Web Audio, *and* it can't process a widget-comm reply while the same cell is
  still running. Single-cell ``await record()`` therefore can't complete; the
  two-cell flow is the only one that works.

These helpers let the rest of the library pick the right strategy — and, just as
importantly, fail loudly with a clear message instead of hanging forever.
"""

from __future__ import annotations

import sys


def in_browser() -> bool:
    """Return True under a browser WASM runtime (Pyodide / Emscripten).

    Pyodide compiles CPython to WebAssembly via Emscripten, so ``sys.platform``
    reports ``"emscripten"``. Off-browser this is always False.
    """
    return sys.platform == "emscripten"


def in_worker() -> bool:
    """Return True when the kernel runs in a Web Worker (no DOM main thread).

    The page's main thread has a global ``window``; a Web Worker does not. We
    read that through Pyodide's ``js`` bridge. Returns False off-browser (where
    the distinction doesn't apply) and also if ``js`` is unavailable, so this is
    safe to call from headless tests and native code.
    """
    if not in_browser():
        return False
    try:
        import js  # type: ignore[import-not-found]  # provided by Pyodide
    except ImportError:
        return False
    return not hasattr(js, "window")
