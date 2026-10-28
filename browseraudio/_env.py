"""Where the kernel runs: native, browser main thread, or browser Web Worker."""

from __future__ import annotations

import sys


def in_browser() -> bool:
    """True under Pyodide / Emscripten."""
    return sys.platform == "emscripten"


def in_worker() -> bool:
    """True when the kernel runs in a Web Worker (no ``window``)."""
    if not in_browser():
        return False
    try:
        import js  # type: ignore[import-not-found]  # provided by Pyodide
    except ImportError:
        return False
    return not hasattr(js, "window")
