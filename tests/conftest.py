"""Shared test fixtures.

The library renders in a browser, but its Python side is pure data plumbing —
base64 PCM, NumPy shapes, traitlets — which we can test headlessly. The only
browser/Jupyter touchpoint in pure Python is ``IPython.display.display`` (called
by ``record()`` / ``play()``); we stub it so the suite needs no IPython.
"""

from __future__ import annotations

import sys
import types

import pytest


@pytest.fixture
def captured_display(monkeypatch):
    """Replace ``IPython.display.display`` with a capture list.

    Returns the list that displayed objects are appended to, so a test can
    assert the widget was displayed exactly once.
    """
    captured: list = []

    display_mod = types.ModuleType("IPython.display")
    display_mod.display = captured.append  # display(obj) -> captured.append(obj)

    ipython_mod = types.ModuleType("IPython")
    ipython_mod.display = display_mod

    monkeypatch.setitem(sys.modules, "IPython", ipython_mod)
    monkeypatch.setitem(sys.modules, "IPython.display", display_mod)
    return captured
