"""Tests for browseraudio.sounddevice — the sounddevice-shaped facade."""

from __future__ import annotations

import numpy as np
import pytest

from browseraudio import Player
from browseraudio import sounddevice as sd

_DEVICE_KEYS = {"name", "max_input_channels", "max_output_channels", "default_samplerate"}


def test_query_devices_lists_input_and_output():
    devs = sd.query_devices()
    assert isinstance(devs, list)
    assert any(d["max_input_channels"] > 0 for d in devs)   # a mic
    assert any(d["max_output_channels"] > 0 for d in devs)  # speakers
    for d in devs:
        assert _DEVICE_KEYS <= set(d)


def test_query_devices_single_returns_dict():
    d = sd.query_devices(0)
    assert isinstance(d, dict)
    assert _DEVICE_KEYS <= set(d)


def test_query_devices_returns_copies():
    # Mutating a returned dict must not corrupt the shared table.
    sd.query_devices(0)["name"] = "tampered"
    assert sd.query_devices(0)["name"] != "tampered"


def test_default_device_is_indexable_and_assignable():
    cur = list(sd.default.device)
    sd.default.device = (cur[0], cur[1])  # the pyquist set-slot idiom
    assert sd.default.device[0] == cur[0]
    assert sd.default.device[1] == cur[1]


def test_wait_is_a_noop():
    assert sd.wait() is None


def test_play_delegates_to_browseraudio_play(captured_display):
    player = sd.play(np.zeros((10, 1), dtype=np.float32), 48000)
    assert isinstance(player, Player)
    assert captured_display == [player]


def test_rec_raises_with_two_cell_guidance():
    with pytest.raises(RuntimeError, match="two-cell"):
        sd.rec(frames=4800, samplerate=48000, channels=1, dtype="float32")
