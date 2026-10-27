"""Tests for browseraudio.Keyboard / keyboard / KeyMap — the synth data path."""

from __future__ import annotations

import base64

import numpy as np
import pytest

from browseraudio import Keyboard, KeyMap, keyboard
from browseraudio._keyboard import _envelope, midi_to_hz

SR = 8000


def _decode(b64: str) -> np.ndarray:
    """Decode the widget's base64 little-endian float32 payload."""
    return np.frombuffer(base64.b64decode(b64), dtype="<f4")


def _ones(n):
    """A render function returning `n` ones regardless of pitch."""
    return lambda freq: np.ones(n, dtype=np.float32)


def _send(kb, *events):
    """Deliver an events batch the way keyboard.js's model.send() does."""
    kb._on_frontend_msg(kb, {"type": "events", "events": [list(e) for e in events]}, [])


# ----- KeyMap -----------------------------------------------------------------


def test_musical_typing_layout():
    km = KeyMap.musical_typing()
    assert km.keys[:4] == ["KeyA", "KeyW", "KeyS", "KeyE"]
    assert km.keys[-2:] == ["KeyZ", "KeyX"]
    row = km.table[km.start]
    assert row[0] == (60, km.start)  # A = middle C
    assert row[16] == (76, km.start)  # ; = E5
    assert km.notes() == list(range(48, 77 + 12))  # 3 octaves of 17 keys


def test_musical_typing_octave_keys_move_state():
    km = KeyMap.musical_typing(octaves=(-1, 0, 1))
    down, up = km.table[1][-2], km.table[1][-1]
    assert down == (None, 0) and up == (None, 2)
    assert km.table[0][0] == (48, 0)
    assert km.table[0][-2] == (None, 0)  # clamps at the lowest octave
    assert km.table[2][-1] == (None, 2)  # and the highest


def test_musical_typing_needs_octave_zero():
    with pytest.raises(ValueError):
        KeyMap.musical_typing(octaves=(1, 2))


def test_keymap_to_dict_is_json_shaped():
    km = KeyMap(["KeyA", "KeyB"], [[(60, 0), (None, 0)]])
    assert km.to_dict() == {"keys": ["KeyA", "KeyB"], "table": [[[60, 0], [None, 0]]], "start": 0}


@pytest.mark.parametrize(
    "keys, table, start",
    [
        ([], [[]], 0),  # no keys
        (["KeyA", "KeyA"], [[(60, 0), (61, 0)]], 0),  # duplicate key
        (["KeyA"], [], 0),  # no states
        (["KeyA", "KeyB"], [[(60, 0)]], 0),  # row too short
        (["KeyA"], [[(128, 0)]], 0),  # MIDI out of range
        (["KeyA"], [[(60, 1)]], 0),  # next state out of range
        (["KeyA"], [[(60, 0)]], 1),  # start out of range
    ],
)
def test_keymap_validation(keys, table, start):
    with pytest.raises(ValueError):
        KeyMap(keys, table, start)


def test_genie_style_state_machine_is_expressible():
    # Two buttons whose pitch depends on the previous note: a stateful table.
    km = KeyMap(["KeyA", "KeyB"], [[(60, 1), (62, 1)], [(64, 0), (65, 0)]])
    assert km.notes() == [60, 62, 64, 65]


# ----- construction -----------------------------------------------------------


def test_bank_renders_each_reachable_note_once():
    seen = []

    def render(freq):
        seen.append(freq)
        return np.full(3, freq, dtype=np.float32)

    km = KeyMap(["KeyA", "KeyB"], [[(69, 0), (81, 0)]])
    kb = Keyboard(render, SR, keymap=km)
    assert kb.mode == "bank"
    assert seen == pytest.approx([440.0, 880.0])
    assert kb._notes == [[69, 0, 3], [81, 3, 3]]
    assert np.allclose(_decode(kb._pcm_b64), [440, 440, 440, 880, 880, 880])
    assert kb.keymap == km.to_dict()


def test_bank_notes_may_differ_in_length():
    km = KeyMap(["KeyA", "KeyB"], [[(60, 0), (72, 0)]])
    kb = Keyboard(lambda f: np.zeros(int(f // 100)), SR, keymap=km)
    lengths = [n[2] for n in kb._notes]
    assert lengths == [int(midi_to_hz(60) // 100), int(midi_to_hz(72) // 100)]
    assert kb._notes[1][1] == lengths[0]


def test_bank_accepts_column_vectors():
    km = KeyMap(["KeyA"], [[(60, 0)]])
    kb = Keyboard(lambda f: np.ones((4, 1)), SR, keymap=km)
    assert kb._notes == [[60, 0, 4]]


@pytest.mark.parametrize("bad", [np.zeros(0), np.zeros((3, 2)), np.zeros((2, 2, 2))])
def test_bank_rejects_bad_render_output(bad):
    with pytest.raises(ValueError):
        Keyboard(lambda f: bad, SR, keymap=KeyMap(["KeyA"], [[(60, 0)]]))


def test_bank_requires_a_valid_sample_rate():
    with pytest.raises(ValueError):
        Keyboard(_ones(4))
    with pytest.raises(ValueError):
        Keyboard(_ones(4), 1000)


def test_wavetable_mode():
    table = np.sin(2 * np.pi * np.arange(64) / 64)
    kb = Keyboard(wavetable=table)
    assert kb.mode == "wavetable"
    assert kb._notes == []
    assert kb.sample_rate == 48000  # nominal, for render()
    assert np.allclose(_decode(kb._pcm_b64), table, atol=1e-6)


def test_needs_exactly_one_sound_source():
    with pytest.raises(ValueError):
        Keyboard()
    with pytest.raises(ValueError):
        Keyboard(_ones(4), SR, wavetable=np.zeros(8))


def test_wavetable_validation():
    with pytest.raises(ValueError):
        Keyboard(wavetable=np.zeros(1))
    with pytest.raises(ValueError):
        Keyboard(wavetable=np.zeros(8), one_shot=True)


@pytest.mark.parametrize(
    "kwargs",
    [{"attack": -1}, {"decay": -1}, {"release": -1}, {"sustain": 1.5}, {"max_voices": 0}],
)
def test_envelope_and_voice_validation(kwargs):
    with pytest.raises(ValueError):
        Keyboard(wavetable=np.zeros(8), **kwargs)


def test_keyboard_displays_once(captured_display):
    kb = keyboard(wavetable=np.zeros(8))
    assert isinstance(kb, Keyboard)
    assert captured_display == [kb]


# ----- events from the browser -------------------------------------------------


def test_events_arrive_and_fire_callbacks():
    kb = Keyboard(wavetable=np.zeros(8))
    seen = []
    kb.on_note(seen.append)
    _send(kb, (0.0, 60, 1), (0.5, 60, 0))
    assert kb.events == [(0.0, 60, "on"), (0.5, 60, "off")]
    assert seen == kb.events

    kb.on_note(seen.append, remove=True)
    _send(kb, (1.0, 62, 1))
    assert len(seen) == 2 and len(kb.events) == 3


def test_unrelated_messages_are_ignored():
    kb = Keyboard(wavetable=np.zeros(8))
    kb._on_frontend_msg(kb, {"type": "something-else"}, [])
    kb._on_frontend_msg(kb, "not a dict", [])
    assert kb.events == []


def test_clear_forgets_events():
    kb = Keyboard(wavetable=np.zeros(8))
    _send(kb, (0.0, 60, 1))
    kb.clear()
    assert kb.events == []


# ----- envelope + offline render -----------------------------------------------


def test_envelope_shape():
    # attack 0.1 s, decay 0.1 s to 0.5, released at 0.4 s over 0.2 s, at 10 Hz.
    g = _envelope(10, 4, 10, attack=0.1, decay=0.1, sustain=0.5, release=0.2)
    assert np.allclose(g, [0, 1, 0.5, 0.5, 0.5, 0.25, 0, 0, 0, 0])


def test_envelope_without_release_holds():
    g = _envelope(4, None, 10, attack=0.0, decay=0.0, sustain=0.8, release=0.1)
    assert np.allclose(g, 0.8)


def test_render_places_notes_sample_accurately():
    km = KeyMap(["KeyA", "KeyB"], [[(60, 0), (62, 0)]])
    kb = Keyboard(_ones(100), SR, keymap=km, attack=0.0, release=0.0, gain=1.0)
    kb.events = [(0.0, 60, "on"), (0.001, 60, "off"), (0.002, 62, "on"), (0.003, 62, "off")]
    y = kb.render()
    assert y.dtype == np.float32 and y.shape == (24, 1)
    expected = np.zeros(24)
    expected[0:8] = 1.0  # 1 ms at 8 kHz
    expected[16:24] = 1.0
    assert np.allclose(y[:, 0], expected)


def test_render_applies_release_and_buffer_end():
    km = KeyMap(["KeyA"], [[(60, 0)]])
    kb = Keyboard(_ones(12), SR, keymap=km, attack=0.0, release=0.001, gain=0.5)
    kb.events = [(0.0, 60, "on"), (0.001, 60, "off")]
    y = kb.render()[:, 0]
    assert y.size == 12  # 8 held + 8 release, cut at the 12-sample buffer
    assert np.allclose(y[:8], 0.5)
    assert np.allclose(y[8:], 0.5 * (1 - np.arange(4) / 8))


def test_render_one_shot_ignores_key_up():
    km = KeyMap(["KeyA"], [[(60, 0)]])
    kb = Keyboard(_ones(40), SR, keymap=km, attack=0.0, gain=1.0, one_shot=True)
    kb.events = [(0.0, 60, "on"), (0.001, 60, "off")]
    assert np.allclose(kb.render()[:, 0], np.ones(40))


def test_render_releases_notes_still_held_at_the_end():
    km = KeyMap(["KeyA", "KeyB"], [[(60, 0), (62, 0)]])
    kb = Keyboard(_ones(100), SR, keymap=km, attack=0.0, release=0.0, gain=1.0)
    kb.events = [(0.0, 60, "on"), (0.002, 62, "on"), (0.002, 62, "off")]
    assert kb.render().shape == (16, 1)  # 60 held until the last event


def test_render_wavetable_pitch():
    n = 64
    kb = Keyboard(
        wavetable=np.sin(2 * np.pi * np.arange(n) / n),
        sample_rate=SR,
        attack=0.0,
        release=0.0,
        gain=1.0,
    )
    kb.events = [(0.0, 69, "on"), (0.5, 69, "off")]  # A4 for half a second
    y = kb.render()[:, 0]
    assert y.size == SR // 2
    spectrum = np.abs(np.fft.rfft(y))
    peak_hz = np.argmax(spectrum) * SR / y.size
    assert peak_hz == pytest.approx(440, abs=2)


def test_render_with_no_events_is_empty():
    assert Keyboard(wavetable=np.zeros(8)).render().shape == (0, 1)
