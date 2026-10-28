"""Stream: a block callback played in real time, paced by the browser."""

from __future__ import annotations

import time
from typing import Callable, Optional

import anywidget
import numpy as np
import traitlets

from ._assets import GENIE_CHECKPOINT, INPUTS, _bundle, _check_input
from ._keyboard import KeyMap
from ._pcm import encode_f32


class Block(np.ndarray):
    """Zeroed float32 ``(block_size, channels)`` with ``.sample_rate`` (pyquist-shaped)."""

    sample_rate: int

    def __new__(cls, frames: int, channels: int, sample_rate: int) -> "Block":
        block = np.zeros((frames, channels), dtype=np.float32).view(cls)
        block.sample_rate = sample_rate
        return block

    def __array_finalize__(self, obj) -> None:
        self.sample_rate = getattr(obj, "sample_rate", 0)


class Stream(anywidget.AnyWidget):
    """Real-time synthesis: the browser pulls blocks from ``callback(block)``.

    An AudioWorklet keeps ~``lookahead`` seconds queued and asks the kernel for
    each next block, so a control change (``on_note``, any widget) is heard
    after the queue plus one round trip. Blocks are only made while no cell
    runs. ``input="genie"`` plays via Piano Genie.

    Attributes:
        callback: ``callback(block)`` fills a zeroed :class:`Block` (or returns one).
        on_note: ``on_note(midi, is_on)`` per key press / release.
        sample_rate, block_size, channels: The stream's format.
        lookahead: Seconds queued in the browser (whole blocks, at least two).
        playing: Synced with the Start/Stop button; see :meth:`start` / :meth:`stop`.
        keyboard: Show the key surface.
        input: ``"keys"`` or ``"genie"``.
        genie_temperature, genie_range, genie_checkpoint: Genie-mode settings.
        error: Last callback error (stops the stream), else ``""``.
        blocks_rendered, busy, dropouts: Counters since the last start.
    """

    _esm = _bundle("ui.js", "genie.js", "controls.js", "stream.js")

    sample_rate = traitlets.Int(44100).tag(sync=True)
    block_size = traitlets.Int(512).tag(sync=True)
    channels = traitlets.Int(1).tag(sync=True)
    lookahead = traitlets.Float(0.04).tag(sync=True)
    keymap = traitlets.Dict().tag(sync=True)
    playing = traitlets.Bool(False).tag(sync=True)
    keyboard = traitlets.Bool(True).tag(sync=True)
    input = traitlets.Enum(INPUTS, "keys").tag(sync=True)
    genie_temperature = traitlets.Float(0.25).tag(sync=True)
    genie_range = traitlets.List([21, 108]).tag(sync=True)
    genie_checkpoint = traitlets.Unicode(GENIE_CHECKPOINT).tag(sync=True)
    error = traitlets.Unicode("").tag(sync=True)

    def __init__(
        self,
        callback: Callable[[Block], Optional[np.ndarray]],
        sample_rate: int = 44100,
        block_size: int = 512,
        *,
        channels: int = 1,
        lookahead: float = 0.04,
        keymap: Optional[KeyMap] = None,
        on_note: Optional[Callable[[int, bool], None]] = None,
        input: str = "keys",
        genie_temperature: float = 0.25,
        genie_range=(21, 108),
        genie_checkpoint: str = GENIE_CHECKPOINT,
        **kwargs,
    ):
        if not callable(callback):
            raise TypeError("callback must be callable, as callback(block)")
        # What every browser's AudioContext accepts.
        if not 3000 <= sample_rate <= 768000:
            raise ValueError(f"sample_rate must be in 3000..768000 Hz, got {sample_rate}")
        if block_size < 1:
            raise ValueError(f"block_size must be >= 1, got {block_size}")
        if channels < 1:
            raise ValueError(f"channels must be >= 1, got {channels}")
        if lookahead < 0:
            raise ValueError(f"lookahead must be >= 0 seconds, got {lookahead}")
        _check_input(input, genie_temperature)
        lo, hi = (int(m) for m in genie_range)
        if not 21 <= lo <= hi <= 108:
            raise ValueError(f"genie_range must lie within the piano, 21..108, got {genie_range}")
        keymap = keymap if keymap is not None else KeyMap.musical_typing()
        super().__init__(
            sample_rate=int(sample_rate),
            block_size=int(block_size),
            channels=int(channels),
            lookahead=float(lookahead),
            keymap=keymap.to_dict(),
            input=input,
            genie_temperature=float(genie_temperature),
            genie_range=[lo, hi],
            genie_checkpoint=genie_checkpoint,
            **kwargs,
        )
        self.callback = callback
        self.on_note = on_note
        self.blocks_rendered = 0
        self.busy = 0.0
        self.dropouts = 0
        self.on_msg(self._on_frontend_msg)

    def start(self) -> None:
        """Start playback."""
        self.error = ""
        self.playing = True

    def stop(self) -> None:
        """Stop playback."""
        self.playing = False

    def _fail(self, message: str) -> None:
        self.error = message
        self.playing = False

    def _on_frontend_msg(self, widget, content, buffers) -> None:
        if not isinstance(content, dict):
            return
        kind = content.get("type")
        if kind == "start":
            self.error = ""
            self.blocks_rendered = 0
            self.busy = 0.0
            self.dropouts = 0
        elif kind == "need":
            self.dropouts = int(content.get("dropouts", self.dropouts))
            self._send_blocks(int(content.get("n", 1)), content.get("id"))
        elif kind == "note" and self.on_note is not None:
            try:
                self.on_note(int(content["midi"]), bool(content["on"]))
            except Exception as err:  # surface it in the widget, don't crash the comm
                self._fail(f"on_note: {type(err).__name__}: {err}")

    def render_block(self) -> np.ndarray:
        """Run the callback once; return float32 ``(block_size, channels)``."""
        block = Block(self.block_size, self.channels, self.sample_rate)
        out = self.callback(block)
        arr = np.asarray(block if out is None else out, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr.reshape(-1, 1)
        expected = (self.block_size, self.channels)
        if arr.shape != expected:
            raise ValueError(f"callback produced a block of shape {arr.shape}, expected {expected}")
        return arr

    def _send_blocks(self, n: int, request_id) -> None:
        if self.error or not self.playing or n < 1:
            return
        start = time.perf_counter()
        try:
            # Blocks back to back, each planar (what the worklet reads).
            blocks = np.stack([self.render_block().T for _ in range(n)])
        except Exception as err:
            self._fail(f"callback: {type(err).__name__}: {err}")
            return
        busy = time.perf_counter() - start
        self.blocks_rendered += n
        self.busy += busy
        self.send(
            {"type": "blocks", "id": request_id, "n": n, "pcm": encode_f32(blocks), "busy": busy}
        )


def stream(
    callback: Callable[[Block], Optional[np.ndarray]],
    sample_rate: int = 44100,
    block_size: int = 512,
    **kwargs,
) -> Stream:
    """Display a :class:`Stream` for ``callback`` and return it."""
    from IPython.display import display

    s = Stream(callback, sample_rate, block_size, **kwargs)
    display(s)
    return s
