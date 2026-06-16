"""Tests for browseraudio.play / Player — the playback data path."""

from __future__ import annotations

import base64

import numpy as np
import pytest

from browseraudio import Player, play


def _decode(b64: str) -> np.ndarray:
    """Decode the widget's base64 little-endian float32 payload."""
    return np.frombuffer(base64.b64decode(b64), dtype="<f4")


def test_play_returns_player_and_displays_once(captured_display):
    p = play(np.zeros(4, dtype=np.float32), 8000)
    assert isinstance(p, Player)
    assert captured_display == [p]


def test_play_mono_1d_is_reshaped(captured_display):
    p = play(np.array([0.1, -0.2, 0.3], dtype=np.float32), 8000, autoplay=False)
    assert p.n_channels == 1
    assert p.sample_rate == 8000
    assert p.autoplay is False
    assert np.allclose(_decode(p._pcm_b64), [0.1, -0.2, 0.3])


def test_play_stereo_is_channel_major(captured_display):
    # play() must ship planar (all of ch0, then all of ch1) — that's what
    # player.js's copyToChannel expects.
    arr = np.array([[1.0, -1.0], [0.5, -0.5], [0.25, -0.25]], dtype=np.float32)
    p = play(arr, 48000)
    assert p.n_channels == 2
    flat = _decode(p._pcm_b64)
    frames = len(flat) // 2
    assert np.allclose(flat[:frames], arr[:, 0])
    assert np.allclose(flat[frames:], arr[:, 1])


def test_play_reads_sample_rate_from_object(captured_display):
    # Mirrors a pyquist.Audio: an ndarray subclass carrying .sample_rate.
    class FakeAudio(np.ndarray):
        sample_rate = 44100

    a = np.zeros((4, 1), dtype=np.float32).view(FakeAudio)
    p = play(a)  # no explicit sample_rate
    assert p.sample_rate == 44100


def test_play_casts_float64_to_float32(captured_display):
    p = play(np.array([0.5, 0.25], dtype=np.float64), 8000)
    decoded = _decode(p._pcm_b64)
    assert decoded.dtype == np.float32
    assert np.allclose(decoded, [0.5, 0.25])


def test_play_autoplay_defaults_true(captured_display):
    assert play(np.zeros(2, dtype=np.float32), 8000).autoplay is True


def test_play_without_sample_rate_raises(captured_display):
    with pytest.raises(ValueError):
        play(np.zeros(4, dtype=np.float32))


def test_play_zero_sample_rate_raises(captured_display):
    with pytest.raises(ValueError):
        play(np.zeros(4, dtype=np.float32), 0)


def test_play_rejects_3d(captured_display):
    with pytest.raises(ValueError):
        play(np.zeros((2, 2, 2), dtype=np.float32), 8000)


def test_player_defaults():
    p = Player()
    assert p.sample_rate == 0
    assert p.n_channels == 1
    assert p.autoplay is True
    assert p._pcm_b64 == ""
