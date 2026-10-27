"""Tests for browseraudio.Stream / stream / Block — the real-time block path."""

from __future__ import annotations

import base64

import numpy as np
import pytest

from browseraudio import Block, Stream, stream

SR = 8000


def _decode(b64: str) -> np.ndarray:
    """Decode the widget's base64 little-endian float32 payload."""
    return np.frombuffer(base64.b64decode(b64), dtype="<f4")


def _capture(s: Stream) -> list:
    """Start `s` and collect what the widget would send to the browser."""
    sent: list = []
    s.send = sent.append
    s.start()
    return sent


def _msg(s: Stream, **content):
    """Deliver a message the way stream.js's model.send() does."""
    s._on_frontend_msg(s, content, [])


class Sinusoid:
    """The pyquist-style callback from the course notes."""

    def __init__(self, pitch: float = 69.0):
        self.pitch, self.phase = pitch, 0.0

    def callback(self, block) -> None:
        f = 440.0 * 2 ** ((self.pitch - 69) / 12)
        B = len(block)
        dphase = 2.0 * np.pi * f / block.sample_rate
        block[:] = np.sin(self.phase + dphase * np.arange(B))[:, np.newaxis]
        self.phase = (self.phase + dphase * B) % (2.0 * np.pi)


# ----- Block ------------------------------------------------------------------


def test_block_is_a_zeroed_writable_float32_buffer():
    b = Block(4, 2, SR)
    assert b.shape == (4, 2) and b.dtype == np.float32
    assert b.sample_rate == SR and len(b) == 4
    assert not b.any()
    b[:] = 1.0  # must not raise


def test_block_slices_keep_sample_rate():
    assert Block(4, 1, SR)[:2].sample_rate == SR


# ----- construction -----------------------------------------------------------


def test_stream_defaults():
    s = Stream(lambda block: None)
    assert (s.sample_rate, s.block_size, s.channels) == (44100, 512, 1)
    assert s.lookahead == pytest.approx(0.04)
    assert s.keymap["keys"][0] == "KeyA"
    assert s.error == ""


@pytest.mark.parametrize(
    "kwargs",
    [
        {"sample_rate": 1000},
        {"block_size": 0},
        {"channels": 0},
        {"lookahead": -0.1},
    ],
)
def test_stream_validation(kwargs):
    with pytest.raises(ValueError):
        Stream(lambda block: None, **kwargs)


def test_stream_needs_a_callable():
    with pytest.raises(TypeError):
        Stream("not callable")


def test_stream_displays_once(captured_display):
    s = stream(lambda block: None, SR, 16)
    assert isinstance(s, Stream)
    assert captured_display == [s]


# ----- the block request loop ----------------------------------------------------


def test_need_renders_and_sends_a_batch():
    synth = Sinusoid()
    s = Stream(synth.callback, SR, 16)
    sent = _capture(s)
    _msg(s, type="need", n=3, id=7)
    assert len(sent) == 1
    reply = sent[0]
    assert reply["type"] == "blocks" and reply["id"] == 7 and reply["n"] == 3
    assert reply["busy"] >= 0
    assert s.blocks_rendered == 3

    # Phase is carried across blocks: the batch is one continuous sine.
    pcm = _decode(reply["pcm"])
    expected = np.sin(2 * np.pi * 440 * np.arange(48) / SR)
    assert np.allclose(pcm, expected, atol=1e-5)


def test_blocks_are_planar_per_block():
    def stereo(block):
        block[:, 0] = np.arange(len(block))
        block[:, 1] = -np.arange(len(block))

    s = Stream(stereo, SR, 3, channels=2)
    sent = _capture(s)
    _msg(s, type="need", n=2, id=0)
    pcm = _decode(sent[0]["pcm"])
    # block 0: L0 L1 L2 R0 R1 R2, then block 1 the same.
    assert np.allclose(pcm, [0, 1, 2, 0, -1, -2] * 2)


def test_callback_may_return_a_new_array():
    s = Stream(lambda block: np.full(len(block), 0.5), SR, 4)
    sent = _capture(s)
    _msg(s, type="need", n=1, id=0)
    assert np.allclose(_decode(sent[0]["pcm"]), 0.5)


def test_need_for_zero_blocks_sends_nothing():
    s = Stream(lambda block: None, SR, 4)
    sent = _capture(s)
    _msg(s, type="need", n=0, id=0)
    assert sent == []


def test_wrong_shape_stops_the_stream_until_restart():
    s = Stream(lambda block: np.zeros(3), SR, 4)
    sent = _capture(s)
    _msg(s, type="need", n=1, id=0)
    assert sent == []
    assert "shape" in s.error

    assert not s.playing  # an error stops the stream

    s.callback = lambda block: None
    _msg(s, type="need", n=1, id=1)
    assert sent == []  # still stopped
    s.start()
    assert s.error == "" and s.playing
    _msg(s, type="need", n=1, id=2)
    assert len(sent) == 1


def test_callback_exception_is_reported():
    def boom(block):
        raise RuntimeError("oops")

    s = Stream(boom, SR, 4)
    sent = _capture(s)
    _msg(s, type="need", n=2, id=0)
    assert sent == []
    assert s.error == "callback: RuntimeError: oops"


# ----- notes from the keyboard ----------------------------------------------------


def test_notes_reach_on_note_and_steer_the_next_block():
    synth = Sinusoid(pitch=69)
    s = Stream(
        synth.callback,
        SR,
        8000,
        on_note=lambda midi, on: setattr(synth, "pitch", midi) if on else None,
    )
    sent = _capture(s)
    _msg(s, type="note", midi=81, on=1)  # A5
    _msg(s, type="note", midi=81, on=0)
    assert synth.pitch == 81
    _msg(s, type="need", n=1, id=0)
    pcm = _decode(sent[0]["pcm"])
    peak_hz = np.argmax(np.abs(np.fft.rfft(pcm))) * SR / pcm.size
    assert peak_hz == pytest.approx(880, abs=2)


def test_notes_without_on_note_are_ignored():
    s = Stream(lambda block: None, SR, 4)
    _msg(s, type="note", midi=60, on=1)
    assert s.error == ""


def test_on_note_exception_is_reported():
    def bad(midi, on):
        raise KeyError(midi)

    s = Stream(lambda block: None, SR, 4, on_note=bad)
    s.start()
    _msg(s, type="note", midi=60, on=1)
    assert s.error.startswith("on_note: KeyError")
    assert not s.playing


def test_start_and_stop_drive_playing():
    s = Stream(lambda block: None, SR, 4)
    assert not s.playing
    s.start()
    assert s.playing
    s.stop()
    assert not s.playing


def test_no_blocks_while_stopped():
    s = Stream(lambda block: None, SR, 4)
    sent: list = []
    s.send = sent.append
    _msg(s, type="need", n=2, id=0)  # e.g. a request still in flight at Stop
    assert sent == [] and s.blocks_rendered == 0


def test_need_reports_dropouts():
    s = Stream(lambda block: None, SR, 4)
    _capture(s)
    _msg(s, type="need", n=1, id=0, dropouts=3)
    assert s.dropouts == 3


def test_start_resets_counters():
    s = Stream(lambda block: None, SR, 4)
    _capture(s)
    _msg(s, type="need", n=2, id=0)
    assert s.blocks_rendered == 2
    _msg(s, type="start")
    assert s.blocks_rendered == 0 and s.busy == 0.0 and s.dropouts == 0
