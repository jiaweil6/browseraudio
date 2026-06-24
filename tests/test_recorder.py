"""Tests for browseraudio.Recorder / record — the capture data path."""

from __future__ import annotations

import base64
import sys
import types

import numpy as np
import pytest

from browseraudio import Recorder, record


def _b64(samples) -> str:
    """Encode float32 samples the way the JS frontend would."""
    return base64.b64encode(np.asarray(samples, dtype="<f4").tobytes()).decode("ascii")


def test_recorder_defaults():
    r = Recorder()
    assert r.duration == 3.0
    assert r.sample_rate == 0
    assert r.samples is None
    assert r.error is None


def test_recorder_custom_duration():
    assert Recorder(duration=5.0).duration == 5.0


def test_incoming_pcm_becomes_mono_float32():
    r = Recorder()
    r.sample_rate = 48000
    r._pcm_b64 = _b64([0.1, -0.2, 0.3, 0.4])  # setting the trait fires the observer
    s = r.samples
    assert s is not None
    assert s.dtype == np.float32
    assert s.shape == (4, 1)
    assert np.allclose(s[:, 0], [0.1, -0.2, 0.3, 0.4])


def test_empty_pcm_is_ignored():
    r = Recorder()
    r._pcm_b64 = ""
    assert r.samples is None


def test_samples_are_writable():
    # frombuffer yields a read-only view; the code .astype-copies so callers
    # can mutate. Guard that contract.
    r = Recorder()
    r._pcm_b64 = _b64([1.0, 2.0])
    r.samples[0, 0] = 9.0  # must not raise


def test_new_recording_clears_previous_error():
    r = Recorder()
    r._error = "boom"
    assert r.error == "boom"
    r._pcm_b64 = _b64([0.0])
    assert r.error is None


def test_error_trait_maps_to_error_attr():
    r = Recorder()
    r._error = "no microphone"
    assert r.error == "no microphone"
    r._error = ""
    assert r.error is None


def test_to_pyquist_before_recording_raises():
    with pytest.raises(RuntimeError):
        Recorder().to_pyquist()


def test_to_pyquist_builds_audio(monkeypatch):
    captured = {}

    class Audio:
        def __init__(self, samples, sample_rate):
            captured["samples"] = samples
            captured["sample_rate"] = sample_rate

    fake_pyquist = types.ModuleType("pyquist")
    fake_pyquist.Audio = Audio
    monkeypatch.setitem(sys.modules, "pyquist", fake_pyquist)

    r = Recorder()
    r.sample_rate = 16000
    r._pcm_b64 = _b64([0.0, 0.5, 1.0])
    audio = r.to_pyquist()

    assert isinstance(audio, Audio)
    assert captured["sample_rate"] == 16000
    assert captured["samples"].shape == (3, 1)


def test_record_displays_and_returns_recorder(captured_display):
    r = record(2.5)
    assert isinstance(r, Recorder)
    assert r.duration == 2.5
    assert captured_display == [r]


# --- public result/error API (so consumers don't poke the private traits) ---


def test_on_result_fires_with_recorder_once_samples_arrive():
    r = Recorder()
    seen = []
    r.on_result(seen.append)
    r._pcm_b64 = _b64([0.1, 0.2])
    assert seen == [r]
    assert seen[0].samples.shape == (2, 1)


def test_on_result_ignores_empty_pcm():
    r = Recorder()
    seen = []
    r.on_result(seen.append)
    r._pcm_b64 = ""
    assert seen == []


def test_on_error_fires_with_message():
    r = Recorder()
    seen = []
    r.on_error(seen.append)
    r._error = "permission denied"
    assert seen == ["permission denied"]
    # Clearing the error trait shouldn't fire the callback again.
    r._error = ""
    assert seen == ["permission denied"]


def test_result_resolves_on_capture():
    import asyncio

    r = Recorder()

    async def go():
        task = asyncio.ensure_future(r.result())
        await asyncio.sleep(0)  # let result() register its observers
        r.sample_rate = 16000
        r._pcm_b64 = _b64([0.0, 1.0])
        return await task

    out = asyncio.run(go())
    assert out is r
    assert r.samples.shape == (2, 1)


def test_result_raises_on_error():
    import asyncio

    r = Recorder()

    async def go():
        task = asyncio.ensure_future(r.result())
        await asyncio.sleep(0)
        r._error = "no microphone"
        return await task

    with pytest.raises(RuntimeError, match="no microphone"):
        asyncio.run(go())


def test_result_raises_immediately_in_worker(monkeypatch):
    import asyncio

    import browseraudio._recorder as recorder_mod

    monkeypatch.setattr(recorder_mod, "in_worker", lambda: True)
    with pytest.raises(RuntimeError, match="two-cell"):
        asyncio.run(Recorder().result())
