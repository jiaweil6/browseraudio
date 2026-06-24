"""Tests for browseraudio._env — runtime environment detection."""

from __future__ import annotations

import browseraudio._env as env


def test_in_browser_false_on_native():
    # The test suite runs on CPython, never under Emscripten.
    assert env.in_browser() is False


def test_in_worker_false_off_browser(monkeypatch):
    monkeypatch.setattr(env, "in_browser", lambda: False)
    assert env.in_worker() is False


def test_in_worker_false_when_js_missing(monkeypatch):
    # Pretend we're in the browser, but there's no Pyodide `js` module to import
    # (as in any non-Pyodide environment) — detection must stay safe, not crash.
    monkeypatch.setattr(env, "in_browser", lambda: True)
    assert env.in_worker() is False
