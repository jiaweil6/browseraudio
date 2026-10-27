"""Tests for browseraudio.sounddevice — the sounddevice-shaped facade."""

from __future__ import annotations

import base64

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


# ----- query_devices: pairs, kinds, names -------------------------------------


def test_query_devices_resolves_default_pair_by_kind():
    # pyquist / course support code: sd.query_devices(sd.default.device, "output")
    out = sd.query_devices(sd.default.device, "output")
    assert out["max_output_channels"] > 0
    assert sd.query_devices(sd.default.device, "input")["max_input_channels"] > 0
    assert sd.query_devices(kind="output") == out


def test_query_devices_by_name_substring():
    assert sd.query_devices("speakers")["max_output_channels"] > 0


@pytest.mark.parametrize(
    "args",
    [((0, 1),), (0, "output"), (99,), ("no such device",), (None, "sideways")],
)
def test_query_devices_rejects_bad_requests(args):
    with pytest.raises(ValueError):
        sd.query_devices(*args)


def test_device_table_prints_like_sounddevice():
    text = repr(sd.query_devices())
    assert "Browser microphone" in text and "(0 in, 2 out)" in text
    assert text.splitlines()[0].startswith(">")


# ----- CallbackFlags -----------------------------------------------------------


def test_callback_flags():
    assert not sd.CallbackFlags()
    flags = sd.CallbackFlags(output_underflow=True)
    assert flags and flags.output_underflow and str(flags) == "output underflow"
    with pytest.raises(TypeError):
        sd.CallbackFlags(bogus=True)


# ----- OutputStream ------------------------------------------------------------


def _pull(stream, n=1, dropouts=0):
    """Have the browser ask the stream's widget for `n` blocks; return the PCM."""
    sent = []
    stream.widget.send = sent.append
    stream.widget._on_frontend_msg(
        stream.widget, {"type": "need", "n": n, "id": 0, "dropouts": dropouts}, []
    )
    return np.frombuffer(base64.b64decode(sent[0]["pcm"]), "<f4") if sent else None


def test_output_stream_runs_a_sounddevice_callback(captured_display):
    calls = []

    def callback(outdata, frames, time, status):
        calls.append((outdata.shape, frames, bool(status)))
        outdata[:, 0] = 1.0
        outdata[:, 1] = -1.0

    stream = sd.OutputStream(samplerate=8000.0, blocksize=4, channels=2, callback=callback)
    assert stream.stopped and not stream.closed
    stream.start()
    assert stream.active
    assert captured_display == [stream.widget]
    assert stream.widget.keyboard is False

    pcm = _pull(stream, n=2)
    assert calls == [((4, 2), 4, False)] * 2
    assert np.allclose(pcm, [1, 1, 1, 1, -1, -1, -1, -1] * 2)  # planar per block
    assert 0 <= stream.cpu_load


def test_output_stream_reports_underflow_once(captured_display):
    seen = []
    stream = sd.OutputStream(
        samplerate=8000, blocksize=4, channels=1,
        callback=lambda outdata, frames, time, status: seen.append(status.output_underflow),
    )
    stream.start()
    _pull(stream, n=2, dropouts=1)
    _pull(stream, n=1, dropouts=1)
    assert seen == [True, False, False]


@pytest.mark.parametrize("exc", [sd.CallbackAbort, sd.CallbackStop])
def test_output_stream_callback_exceptions_stop_it(captured_display, exc):
    finished = []

    def callback(outdata, frames, time, status):
        raise exc

    stream = sd.OutputStream(
        samplerate=8000, blocksize=4, channels=1, callback=callback,
        finished_callback=lambda: finished.append(True),
    )
    stream.start()
    _pull(stream)
    assert not stream.active
    assert stream.widget.error == ""  # a requested stop, not an error
    assert finished == [True]


def test_output_stream_other_errors_show_in_the_widget(captured_display):
    def callback(outdata, frames, time, status):
        raise ZeroDivisionError("oops")

    stream = sd.OutputStream(samplerate=8000, blocksize=4, channels=1, callback=callback)
    stream.start()
    _pull(stream)
    assert not stream.active
    assert "ZeroDivisionError" in stream.widget.error


def test_output_stream_stop_start_close(captured_display):
    stream = sd.OutputStream(samplerate=8000, blocksize=4, channels=1,
                             callback=lambda *a: None)
    stream.start()
    stream.stop()
    assert stream.stopped
    stream.start()
    assert stream.active
    assert captured_display == [stream.widget]  # displayed once
    stream.close()
    assert stream.closed and not stream.active
    with pytest.raises(RuntimeError):
        stream.start()


def test_output_stream_as_context_manager(captured_display):
    with sd.OutputStream(samplerate=8000, blocksize=4, channels=1,
                         callback=lambda *a: None) as stream:
        assert stream.active
    assert stream.closed


def test_output_stream_defaults_and_latency():
    stream = sd.OutputStream(callback=lambda *a: None)
    assert stream.blocksize == sd.DEFAULT_BLOCKSIZE
    assert stream.samplerate == sd.NOMINAL_SAMPLERATE
    assert stream.channels == 2
    assert sd.OutputStream(callback=lambda *a: None, latency="high").latency == 0.1
    assert sd.OutputStream(callback=lambda *a: None, latency=0.07).widget.lookahead == 0.07


@pytest.mark.parametrize(
    "kwargs",
    [{}, {"callback": lambda *a: None, "dtype": "int16"},
     {"callback": lambda *a: None, "latency": "medium"}],
)
def test_output_stream_rejects_unsupported_setups(kwargs):
    with pytest.raises(ValueError):
        sd.OutputStream(**kwargs)
