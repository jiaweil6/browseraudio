"""The audio Player widget."""

from __future__ import annotations

import base64
import pathlib
from typing import Optional

import anywidget
import numpy as np
import traitlets

_STATIC = pathlib.Path(__file__).parent / "static"


class Player(anywidget.AnyWidget):
    """Play a NumPy audio buffer through the browser's speakers.

    Like :class:`Recorder`, the audio lives on the browser's main thread,
    where the Web Audio API lives — so playback works even when the Python
    kernel runs in a Web Worker (JupyterLite / thebe-lite).

    Unlike recording, playback is fire-and-forget: nothing needs to come
    back to the kernel, so it works in a *single* cell::

        from browseraudio import play
        play(samples, sample_rate=48000)   # ▶ button; autoplays if allowed

    Browsers block audio that starts without a user gesture, so if autoplay
    is refused the **▶ Play** button always works.

    Attributes:
        sample_rate: Sample rate of the buffer, in Hz.
        n_channels: Number of channels (1 = mono, 2 = stereo).
        autoplay: Try to start playback as soon as the widget renders.
    """

    _esm = _STATIC / "player.js"

    sample_rate = traitlets.Int(0).tag(sync=True)
    n_channels = traitlets.Int(1).tag(sync=True)
    autoplay = traitlets.Bool(True).tag(sync=True)
    # Channel-major (planar) float32 samples, base64 over the comm.
    _pcm_b64 = traitlets.Unicode("").tag(sync=True)


def play(samples, sample_rate: Optional[int] = None, *, autoplay: bool = True) -> Player:
    """Create, display, and return a :class:`Player` for ``samples``.

    A drop-in shape for ``sounddevice.play`` / ``pyquist.play``: pass a NumPy
    array (or a :class:`pyquist.Audio`, whose ``sample_rate`` is read
    automatically) and it plays through the page's speakers.

    Args:
        samples: Audio as ``(n_frames,)`` or ``(n_frames, n_channels)``,
            values in ``[-1, 1]``.
        sample_rate: Sample rate in Hz. If ``None``, taken from
            ``samples.sample_rate`` (e.g. a ``pyquist.Audio``).
        autoplay: Try to start playback immediately (falls back to the
            **▶ Play** button if the browser blocks autoplay).

    Returns:
        The :class:`Player` widget (call it again or click ▶ to replay).
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
    # Channel-major (planar) layout: all of channel 0, then channel 1, ...
    # — that's what Web Audio's AudioBuffer.copyToChannel expects.
    planar = np.ascontiguousarray(arr.T, dtype="<f4")

    player = Player(
        sample_rate=int(sample_rate),
        n_channels=int(n_channels),
        autoplay=autoplay,
    )
    player._pcm_b64 = base64.b64encode(planar.tobytes()).decode("ascii")
    display(player)
    return player
