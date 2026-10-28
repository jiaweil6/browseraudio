"""The audio Player widget."""

from __future__ import annotations

from typing import Optional

import anywidget
import numpy as np
import traitlets

from ._assets import _bundle
from ._pcm import encode_f32


class Player(anywidget.AnyWidget):
    """Plays a NumPy buffer through the page's Web Audio (works in Web-Worker kernels).

    Attributes:
        sample_rate: Hz.
        n_channels: 1 = mono, 2 = stereo.
        autoplay: Start on render (browsers may block it; Play always works).
        playing: Synced with the browser; see :meth:`play` / :meth:`stop`.
    """

    _esm = _bundle("ui.js", "player.js")

    sample_rate = traitlets.Int(0).tag(sync=True)
    n_channels = traitlets.Int(1).tag(sync=True)
    autoplay = traitlets.Bool(True).tag(sync=True)
    playing = traitlets.Bool(False).tag(sync=True)
    # Planar float32, base64.
    _pcm_b64 = traitlets.Unicode("").tag(sync=True)

    def play(self) -> None:
        """Start playback from the beginning."""
        self.playing = True

    def stop(self) -> None:
        """Stop playback."""
        self.playing = False


def play(samples, sample_rate: Optional[int] = None, *, autoplay: bool = True) -> Player:
    """Display a :class:`Player` for ``samples`` and return it.

    Args:
        samples: ``(n_frames,)`` or ``(n_frames, n_channels)`` in ``[-1, 1]``.
        sample_rate: Hz; defaults to ``samples.sample_rate`` (e.g. ``pyquist.Audio``).
        autoplay: Try to start immediately.
    """
    from IPython.display import display

    arr = np.asarray(samples, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    elif arr.ndim != 2:
        raise ValueError(f"samples must be 1-D or 2-D, got shape {arr.shape}")

    if sample_rate is None:
        sample_rate = getattr(samples, "sample_rate", None)
    if not sample_rate:
        raise ValueError(
            "sample_rate is required (or pass an object with a .sample_rate, "
            "e.g. a pyquist.Audio)."
        )

    n_frames, n_channels = arr.shape
    player = Player(
        sample_rate=int(sample_rate),
        n_channels=int(n_channels),
        autoplay=autoplay,
    )
    # Planar (channel-major), for AudioBuffer.copyToChannel.
    player._pcm_b64 = encode_f32(arr.T)
    display(player)
    return player
