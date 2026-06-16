"""Package-level invariants: exports, version, shipped assets."""

from __future__ import annotations

import pathlib
import re

import pytest

import browseraudio


def test_public_exports():
    assert set(browseraudio.__all__) == {"Recorder", "record", "Player", "play"}
    for name in browseraudio.__all__:
        assert hasattr(browseraudio, name)


def test_version_looks_like_semver():
    assert isinstance(browseraudio.__version__, str)
    assert re.match(r"^\d+\.\d+\.\d+", browseraudio.__version__)


def test_version_matches_pyproject():
    root = pathlib.Path(browseraudio.__file__).resolve().parent.parent
    pyproject = root / "pyproject.toml"
    if not pyproject.is_file():
        pytest.skip("pyproject.toml not alongside package (non-editable install)")
    text = pyproject.read_text(encoding="utf-8")
    match = re.search(r'^version = "([^"]+)"', text, re.MULTILINE)
    assert match, "no version found in pyproject.toml"
    assert match.group(1) == browseraudio.__version__


def test_frontend_assets_are_packaged():
    static = pathlib.Path(browseraudio.__file__).parent / "static"
    assert (static / "recorder.js").is_file()
    assert (static / "player.js").is_file()
