"""The real-time Stream widget: a block callback driven by the browser's clock."""

from __future__ import annotations

import time
from typing import Callable, Optional

import anywidget
import numpy as np
import traitlets

from ._keyboard import KeyMap, _bundle
from ._pcm import encode_f32


class Block(np.ndarray):
    """A zeroed ``(block_size, channels)`` float32 buffer with a ``.sample_rate``.

    Shaped like a ``pyquist.Audio`` block, so a pyquist-style callback that
    reads ``len(block)`` / ``block.sample_rate`` and fills ``block[:]`` works
    unchanged.
    """

    sample_rate: int

    def __new__(cls, frames: int, channels: int, sample_rate: int) -> "Block":
        block = np.zeros((frames, channels), dtype=np.float32).view(cls)
        block.sample_rate = sample_rate
        return block

    def __array_finalize__(self, obj) -> None:
        self.sample_rate = getattr(obj, "sample_rate", 0)


class Stream(anywidget.AnyWidget):
    """Real-time synthesis: the browser asks Python for audio, block by block.

    ``callback(block)`` fills one block of ``block_size`` frames — the
    pyquist audio-callback contract. Press **Start** (or call :meth:`start`)
    and the page's audio
    thread pulls blocks as it plays them, keeping about ``lookahead`` seconds
    of audio queued (at least two blocks); each block is synthesised by your
    callback in the kernel at that moment. Key presses on the widget call ``on_note(midi, is_on)`` right
    away, so a change of control (e.g. ``synth.pitch``) is heard from the
    next block Python renders::

        synth = Sinusoid()
        stream(synth.callback, sample_rate=44100, block_size=512,
               on_note=lambda midi, on: setattr(synth, "pitch", midi) if on else None)

    The control-to-sound latency is about the queued audio (``lookahead``,
    rounded up to whole blocks) plus one kernel round trip; the widget shows
    the live numbers. Small blocks cost more callback calls per second (the
    "time budget"), big blocks more latency — B = 1 and B = 16384 both run,
    and both show why. Blocks are produced only while the kernel is idle (no cell
    running), so a long-running cell makes the stream drop out.

    Attributes:
        callback: Called as ``callback(block)`` with a zeroed :class:`Block`;
            fill it in place (or return an array of the same shape).
        on_note: Called as ``on_note(midi, is_on)`` for each key press/release.
        sample_rate: The AudioContext's rate, in Hz.
        block_size: Frames per block (B).
        channels: Output channels.
        lookahead: Seconds of audio kept queued in the browser (rounded up
            to whole blocks, minimum two). Below the kernel round trip, the
            stream drops out.
        playing: Whether the stream is running; set by the Start/Stop button
            or by :meth:`start` / :meth:`stop`.
        keyboard: Show the computer-keyboard control surface.
        error: The last callback error (the stream stops on one), else ``""``.
        blocks_rendered: Blocks synthesised since the last start.
        busy: Seconds spent in ``callback`` since the last start.
        dropouts: Times the browser ran out of audio since the last start.
    """

    _esm = _bundle("keys.js", "stream.js")

    sample_rate = traitlets.Int(44100).tag(sync=True)
    block_size = traitlets.Int(512).tag(sync=True)
    channels = traitlets.Int(1).tag(sync=True)
    lookahead = traitlets.Float(0.04).tag(sync=True)
    keymap = traitlets.Dict().tag(sync=True)
    playing = traitlets.Bool(False).tag(sync=True)
    keyboard = traitlets.Bool(True).tag(sync=True)
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
        **kwargs,
    ):
        if not callable(callback):
            raise TypeError("callback must be callable, as callback(block)")
        # The range every browser's AudioContext constructor accepts.
        if not 3000 <= sample_rate <= 768000:
            raise ValueError(f"sample_rate must be in 3000..768000 Hz, got {sample_rate}")
        if block_size < 1:
            raise ValueError(f"block_size must be >= 1, got {block_size}")
        if channels < 1:
            raise ValueError(f"channels must be >= 1, got {channels}")
        if lookahead < 0:
            raise ValueError(f"lookahead must be >= 0 seconds, got {lookahead}")
        keymap = keymap if keymap is not None else KeyMap.musical_typing()
        super().__init__(
            sample_rate=int(sample_rate),
            block_size=int(block_size),
            channels=int(channels),
            lookahead=float(lookahead),
            keymap=keymap.to_dict(),
            **kwargs,
        )
        self.callback = callback
        self.on_note = on_note
        self.blocks_rendered = 0
        self.busy = 0.0
        self.dropouts = 0
        self.on_msg(self._on_frontend_msg)

    def start(self) -> None:
        """Start (or resume) playback, as if Start were pressed."""
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
        """Run the callback once; return its block as float32 ``(B, channels)``."""
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
            # Each block planar (channel-major), like Player — what the
            # worklet reads — and the blocks back to back in one payload.
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
    """Create, display, and return a :class:`Stream` for ``callback``.

    Press **Start** on the widget to begin real-time playback, and play the
    keys to send ``on_note(midi, is_on)`` to Python. See :class:`Stream`.
    """
    from IPython.display import display

    s = Stream(callback, sample_rate, block_size, **kwargs)
    display(s)
    return s
