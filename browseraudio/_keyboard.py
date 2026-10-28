"""The real-time Keyboard synth widget."""

from __future__ import annotations

from typing import Callable, Dict, List, Optional, Sequence, Tuple

import anywidget
import numpy as np
import traitlets

from ._assets import GENIE_CHECKPOINT, INPUTS, _bundle, _check_input
from ._pcm import encode_f32

# Ableton-style "musical typing": the home row plays the white keys and the row
# above it the black keys, as (KeyboardEvent.code, semitones above the base).
# Physical key codes, so the layout is the same on QWERTY, AZERTY, ...
_MUSICAL_TYPING: List[Tuple[str, int]] = [
    ("KeyA", 0), ("KeyW", 1), ("KeyS", 2), ("KeyE", 3), ("KeyD", 4),
    ("KeyF", 5), ("KeyT", 6), ("KeyG", 7), ("KeyY", 8), ("KeyH", 9),
    ("KeyU", 10), ("KeyJ", 11), ("KeyK", 12), ("KeyO", 13), ("KeyL", 14),
    ("KeyP", 15), ("Semicolon", 16),
]

# Used for the offline render() of a wavetable keyboard, where the browser's
# AudioContext rate isn't known on the Python side.
NOMINAL_SAMPLERATE = 48000

Event = Tuple[float, int, str]


def midi_to_hz(midi: float) -> float:
    """Equal-tempered frequency of a MIDI note number (A4 = 69 = 440 Hz)."""
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


class KeyMap:
    """Maps computer keys to MIDI notes through a small state machine.

    Each press of ``keys[i]`` looks up ``table[state][i] -> (midi, next_state)``:
    it plays ``midi`` (unless ``None``) and moves to ``next_state``. A plain
    piano is a single state; octave-shift keys are entries that play nothing
    and only change state. The same table can express context-dependent
    mappings (e.g. Piano-Genie-style few-buttons-to-many-pitches), and the
    browser evaluates it per key press with no round-trip to Python.

    Args:
        keys: ``KeyboardEvent.code`` names (e.g. ``"KeyA"``, ``"Semicolon"``).
        table: One row per state, each with one ``(midi, next_state)`` entry
            per key.
        start: The initial state.
    """

    def __init__(
        self,
        keys: Sequence[str],
        table: Sequence[Sequence[Tuple[Optional[int], int]]],
        start: int = 0,
    ):
        keys = [str(k) for k in keys]
        if not keys:
            raise ValueError("a KeyMap needs at least one key")
        if len(set(keys)) != len(keys):
            raise ValueError("KeyMap keys must be unique")
        if not table:
            raise ValueError("a KeyMap needs at least one state")
        n_states = len(table)
        rows = []
        for s, row in enumerate(table):
            if len(row) != len(keys):
                raise ValueError(
                    f"state {s} has {len(row)} entries, expected one per key ({len(keys)})"
                )
            entries = []
            for midi, nxt in row:
                if midi is not None and not 0 <= int(midi) <= 127:
                    raise ValueError(f"MIDI note {midi} is outside 0..127")
                if not 0 <= int(nxt) < n_states:
                    raise ValueError(f"next state {nxt} is outside 0..{n_states - 1}")
                entries.append((None if midi is None else int(midi), int(nxt)))
            rows.append(entries)
        if not 0 <= int(start) < n_states:
            raise ValueError(f"start state {start} is outside 0..{n_states - 1}")
        self.keys: List[str] = keys
        self.table: List[List[Tuple[Optional[int], int]]] = rows
        self.start: int = int(start)

    @classmethod
    def musical_typing(
        cls,
        base: int = 60,
        octaves: Sequence[int] = (-1, 0, 1),
        down: str = "KeyZ",
        up: str = "KeyX",
    ) -> "KeyMap":
        """The DAW-style computer keyboard: ``A`` plays ``base`` (middle C).

        ``A S D F G H J K L ;`` are the white keys and ``W E T Y U O P`` the
        black keys, spanning ``base`` to ``base + 16``; ``down`` / ``up`` step
        through ``octaves`` (one state per octave offset, starting at 0).
        """
        octaves = list(octaves)
        if 0 not in octaves:
            raise ValueError("octaves must include 0 (the starting octave)")
        last = len(octaves) - 1
        table = []
        for s, octave in enumerate(octaves):
            row: List[Tuple[Optional[int], int]] = [
                (base + 12 * octave + offset, s) for _, offset in _MUSICAL_TYPING
            ]
            row.append((None, max(s - 1, 0)))
            row.append((None, min(s + 1, last)))
            table.append(row)
        keys = [code for code, _ in _MUSICAL_TYPING] + [down, up]
        return cls(keys, table, start=octaves.index(0))

    def notes(self) -> List[int]:
        """Every MIDI note this map can play, ascending."""
        return sorted({m for row in self.table for m, _ in row if m is not None})

    def to_dict(self) -> dict:
        """The JSON form synced to the browser."""
        return {
            "keys": list(self.keys),
            "table": [[[m, n] for m, n in row] for row in self.table],
            "start": self.start,
        }


def _envelope(
    n: int,
    n_hold: Optional[int],
    sample_rate: int,
    attack: float,
    decay: float,
    sustain: float,
    release: float,
) -> np.ndarray:
    """Linear ADSR gain curve, ``n`` samples long, released at ``n_hold``.

    Mirrors the ``GainNode`` automation in ``keyboard.js`` so that
    :meth:`Keyboard.render` reproduces what was heard. ``n_hold=None`` means
    never released (one-shot voices).
    """
    t = np.arange(n) / sample_rate

    def held(t):
        g = np.full_like(t, sustain, dtype=np.float64)
        if decay > 0:
            in_decay = (t >= attack) & (t < attack + decay)
            g[in_decay] = 1.0 + (sustain - 1.0) * (t[in_decay] - attack) / decay
        else:
            g[t < attack] = 1.0
        if attack > 0:
            in_attack = t < attack
            g[in_attack] = t[in_attack] / attack
        return g

    g = held(t)
    if n_hold is not None and n_hold < n:
        t_off = n_hold / sample_rate
        g_off = held(np.array([t_off]))[0]
        after = t[n_hold:] - t_off
        g[n_hold:] = g_off * np.clip(1.0 - after / release, 0.0, None) if release > 0 else 0.0
    return g


class Keyboard(anywidget.AnyWidget):
    """A synth you play live with the computer keyboard, voiced in the browser.

    You design the sound in Python — either a ``render(freq) -> ndarray``
    function, called once per playable note to build a note bank, or a single
    cycle ``wavetable`` that the browser loops at any pitch. The sound is
    shipped to the page once; after that every key press is handled on the
    browser's main thread by the Web Audio API, so playing has no round-trip
    to the Python kernel (which may be in a Web Worker) and feels immediate.

    Play it with musical typing (``input="keys"``) or in **genie mode**
    (``input="genie"``): 8 buttons whose notes are chosen by Piano Genie
    (Donahue, Simon & Dieleman, IUI 2019), limited to the notes this keyboard
    can play. Switch any time with the widget's Keys | Genie control.

    The notes you play are sent back to Python as :attr:`events`, so a later
    cell can analyse the performance or :meth:`render` it offline::

        from browseraudio import keyboard
        kb = keyboard(pluck, sample_rate=22050)   # click it, then play A W S E D ...

        # ...then, in a later cell:
        kb.events                                 # [(t, midi, "on"|"off"), ...]
        play(kb.render(), kb.sample_rate)

    Attributes:
        mode: ``"bank"`` (rendered notes) or ``"wavetable"`` (looped cycle).
        sample_rate: Rate of the rendered notes / of :meth:`render`.
        attack, decay, sustain, release: Linear ADSR applied in the browser
            (seconds, except ``sustain``, a level in ``[0, 1]``).
        gain: Output level per voice.
        one_shot: Bank mode only — play each note to its end, ignoring key-up.
        max_voices: Polyphony limit; the oldest voice is stolen beyond it.
        input: ``"keys"`` (musical typing) or ``"genie"`` (genie mode).
        genie_temperature: Genie mode's sampling temperature, 0 (always the
            likeliest note) to 1; 0.25 as in the Piano Genie demo.
        genie_checkpoint: URL of the Piano Genie model (Magenta's by default).
        events: Notes played so far, as ``(seconds, midi, "on" | "off")``.
    """

    _esm = _bundle("ui.js", "genie.js", "controls.js", "keyboard.js")

    mode = traitlets.Unicode("bank").tag(sync=True)
    sample_rate = traitlets.Int(0).tag(sync=True)
    keymap = traitlets.Dict().tag(sync=True)
    attack = traitlets.Float(0.005).tag(sync=True)
    decay = traitlets.Float(0.0).tag(sync=True)
    sustain = traitlets.Float(1.0).tag(sync=True)
    release = traitlets.Float(0.05).tag(sync=True)
    gain = traitlets.Float(0.5).tag(sync=True)
    one_shot = traitlets.Bool(False).tag(sync=True)
    max_voices = traitlets.Int(16).tag(sync=True)
    input = traitlets.Enum(INPUTS, "keys").tag(sync=True)
    genie_temperature = traitlets.Float(0.25).tag(sync=True)
    genie_checkpoint = traitlets.Unicode(GENIE_CHECKPOINT).tag(sync=True)
    # The sound, as base64 float32 over the comm: the concatenated note bank
    # (located by `_notes` rows of [midi, start, length]) or the wavetable.
    _pcm_b64 = traitlets.Unicode("").tag(sync=True)
    _notes = traitlets.List().tag(sync=True)

    def __init__(
        self,
        render: Optional[Callable[[float], np.ndarray]] = None,
        sample_rate: Optional[int] = None,
        *,
        wavetable=None,
        keymap: Optional[KeyMap] = None,
        attack: float = 0.005,
        decay: float = 0.0,
        sustain: float = 1.0,
        release: float = 0.05,
        gain: float = 0.5,
        one_shot: bool = False,
        max_voices: int = 16,
        input: str = "keys",
        genie_temperature: float = 0.25,
        genie_checkpoint: str = GENIE_CHECKPOINT,
        **kwargs,
    ):
        if (render is None) == (wavetable is None):
            raise ValueError("pass exactly one of render (a function) or wavetable (an array)")
        for name, value in (("attack", attack), ("decay", decay), ("release", release)):
            if value < 0:
                raise ValueError(f"{name} must be >= 0, got {value}")
        if not 0.0 <= sustain <= 1.0:
            raise ValueError(f"sustain must be in [0, 1], got {sustain}")
        if max_voices < 1:
            raise ValueError(f"max_voices must be >= 1, got {max_voices}")
        _check_input(input, genie_temperature)
        keymap = keymap if keymap is not None else KeyMap.musical_typing()

        self._bank: Dict[int, np.ndarray] = {}
        self._table: Optional[np.ndarray] = None
        if render is not None:
            if not sample_rate:
                raise ValueError("sample_rate is required with a render function")
            # The range every browser's AudioContext.createBuffer accepts.
            if not 3000 <= sample_rate <= 768000:
                raise ValueError(f"sample_rate must be in 3000..768000 Hz, got {sample_rate}")
            mode = "bank"
            notes, chunks, start = [], [], 0
            for midi in keymap.notes():
                y = np.asarray(render(midi_to_hz(midi)), dtype=np.float32)
                if y.ndim == 2 and y.shape[1] == 1:
                    y = y[:, 0]
                if y.ndim != 1 or y.size == 0:
                    raise ValueError(
                        f"render({midi_to_hz(midi):.2f}) must return a non-empty "
                        f"mono array, got shape {y.shape}"
                    )
                self._bank[midi] = y
                notes.append([midi, start, int(y.size)])
                chunks.append(y)
                start += y.size
            payload = np.concatenate(chunks)
        else:
            if one_shot:
                raise ValueError("one_shot needs a render function (a looped wavetable never ends)")
            mode = "wavetable"
            table = np.asarray(wavetable, dtype=np.float32).reshape(-1)
            if table.size < 2:
                raise ValueError("wavetable must hold at least 2 samples (one cycle)")
            self._table = table
            sample_rate = sample_rate or NOMINAL_SAMPLERATE
            notes, payload = [], table

        super().__init__(
            mode=mode,
            sample_rate=int(sample_rate),
            keymap=keymap.to_dict(),
            attack=float(attack),
            decay=float(decay),
            sustain=float(sustain),
            release=float(release),
            gain=float(gain),
            one_shot=bool(one_shot),
            max_voices=int(max_voices),
            input=input,
            genie_temperature=float(genie_temperature),
            genie_checkpoint=genie_checkpoint,
            _notes=notes,
            _pcm_b64=encode_f32(payload),
            **kwargs,
        )
        self.events: List[Event] = []
        self._note_callbacks: List[Callable[[Event], None]] = []
        self.on_msg(self._on_frontend_msg)

    def _on_frontend_msg(self, widget, content, buffers) -> None:
        if not isinstance(content, dict) or content.get("type") != "events":
            return
        for t, midi, on in content.get("events", []):
            event = (float(t), int(midi), "on" if on else "off")
            self.events.append(event)
            for callback in list(self._note_callbacks):
                callback(event)

    def on_note(self, callback: Callable[[Event], None], remove: bool = False) -> None:
        """Run ``callback((t, midi, "on" | "off"))`` for each note played.

        Notes reach the kernel in small batches shortly after they're played
        (in a Web-Worker kernel, once no cell is running). Pass
        ``remove=True`` to detach a callback.
        """
        if remove:
            self._note_callbacks.remove(callback)
        else:
            self._note_callbacks.append(callback)

    def clear(self) -> None:
        """Forget the recorded :attr:`events` and restart the clock at 0."""
        self.events.clear()
        self.send({"type": "clear"})

    def render(self) -> np.ndarray:
        """Re-synthesise the performance in :attr:`events` offline.

        Returns float32 ``(n_frames, 1)`` at :attr:`sample_rate` — the same
        voices and envelopes the browser played, mixed sample-accurately (the
        browser's voice stealing aside), ready for :func:`browseraudio.play`
        or ``pyquist``. Notes still held at the end are released at the last
        event.
        """
        sr = self.sample_rate
        voices = self._voices()
        n_release = int(round(self.release * sr))
        spans = []
        for midi, t_on, t_off in voices:
            start = int(round(t_on * sr))
            n_hold = None if self.one_shot else int(round((t_off - t_on) * sr))
            if self.mode == "bank":
                buf = self._bank.get(midi)
                if buf is None:
                    continue
                n = buf.size if n_hold is None else min(buf.size, n_hold + n_release)
                wave = buf[:n]
            else:
                n = n_hold + n_release
                wave = self._wavetable_wave(midi, n)
            spans.append((start, n_hold, wave))

        total = max((start + wave.size for start, _, wave in spans), default=0)
        out = np.zeros(total, dtype=np.float64)
        for start, n_hold, wave in spans:
            env = _envelope(
                wave.size, n_hold, sr, self.attack, self.decay, self.sustain, self.release
            )
            out[start : start + wave.size] += self.gain * wave * env
        return out.astype(np.float32).reshape(-1, 1)

    def _voices(self) -> List[Tuple[int, float, float]]:
        """Pair note-ons with note-offs (first in, first out per pitch)."""
        events = sorted(self.events, key=lambda e: e[0])
        end = events[-1][0] if events else 0.0
        held: Dict[int, List[float]] = {}
        voices = []
        for t, midi, kind in events:
            if kind == "on":
                held.setdefault(midi, []).append(t)
            elif held.get(midi):
                voices.append((midi, held[midi].pop(0), t))
        for midi, ons in held.items():
            voices.extend((midi, t_on, end) for t_on in ons)
        return sorted(voices, key=lambda v: v[1])

    def _wavetable_wave(self, midi: int, n: int) -> np.ndarray:
        """``n`` samples of the looped wavetable at ``midi``'s pitch."""
        table = self._table
        size = table.size
        # One cycle per `size` samples at the table's own rate, so the read
        # step for frequency f is f * size / sample_rate (playbackRate in JS).
        pos = (np.arange(n) * (midi_to_hz(midi) * size / self.sample_rate)) % size
        i = pos.astype(np.int64)
        frac = pos - i
        return table[i] * (1.0 - frac) + table[(i + 1) % size] * frac


def keyboard(
    render: Optional[Callable[[float], np.ndarray]] = None,
    sample_rate: Optional[int] = None,
    **kwargs,
) -> Keyboard:
    """Create, display, and return a :class:`Keyboard`.

    Click the widget, then play with your computer keyboard. Pass either a
    ``render(freq) -> ndarray`` function (with ``sample_rate``) or
    ``wavetable=`` one cycle of a waveform; see :class:`Keyboard` for the
    envelope and polyphony options.
    """
    from IPython.display import display

    kb = Keyboard(render, sample_rate, **kwargs)
    display(kb)
    return kb
