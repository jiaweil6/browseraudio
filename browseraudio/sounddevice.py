"""A :mod:`sounddevice`-shaped facade for in-browser Python.

In the browser there is no PortAudio and no OS audio devices, so the usual
``sounddevice`` stack can't run. This module mimics the small slice of the
``sounddevice`` surface that audio libraries actually reach for — ``play``,
``wait``, ``query_devices``, and ``default`` — backed by the Web Audio API via
browseraudio's widgets. The goal is that a library can do::

    try:
        import sounddevice as sd
    except (OSError, ModuleNotFoundError):
        import browseraudio.sounddevice as sd

and keep working in JupyterLite / thebe / Pyodide.

**What's drop-in and what isn't.** Playback is genuinely fire-and-forget, so
:func:`play` / :func:`wait` behave like the real thing. Recording is *not*
drop-in: :func:`sounddevice.rec` + :func:`wait` is a *blocking* call, but a
browser kernel can't fill a buffer synchronously within one cell (in a Web
Worker it can't process the comm reply mid-cell at all, and even on the main
thread the AudioContext — not the caller — chooses the sample rate and frame
count). So :func:`rec` raises with guidance toward the two-cell
:func:`browseraudio.record` flow rather than silently returning garbage or
hanging. See the project README's roadmap for details.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

import numpy as np

from ._env import in_worker

__all__ = ["default", "query_devices", "play", "wait", "rec"]

# The browser's AudioContext picks the true rate at capture time; until then we
# can only advertise a nominal default. 48 kHz is the common Chromium/Firefox
# rate. Callers that need the real rate should read it off the recording after
# the fact (``Recorder.sample_rate``).
NOMINAL_SAMPLERATE = 48000

# A synthetic two-entry device table: one input (the mic) and one output (the
# speakers). Shaped like sounddevice's device dicts so callers that inspect
# ``name`` / channel counts / ``default_samplerate`` keep working.
_DEVICES: List[Dict[str, Any]] = [
    {
        "name": "Browser microphone",
        "index": 0,
        "max_input_channels": 1,
        "max_output_channels": 0,
        "default_samplerate": float(NOMINAL_SAMPLERATE),
    },
    {
        "name": "Browser speakers",
        "index": 1,
        "max_input_channels": 0,
        "max_output_channels": 2,
        "default_samplerate": float(NOMINAL_SAMPLERATE),
    },
]


class _Default:
    """A stand-in for ``sounddevice.default``.

    Only the ``device`` slot is modelled — a ``[input_index, output_index]``
    pair that callers read (``default.device[0]``) and reassign
    (``default.device = (in, out)``), just like the real thing.
    """

    def __init__(self) -> None:
        self.device: Any = [0, 1]
        self.samplerate: Optional[int] = None
        self.channels: List[Optional[int]] = [None, None]


default = _Default()


def query_devices(
    device: Optional[int] = None, kind: Optional[str] = None
) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
    """Return the synthetic browser device table, or a single device dict.

    Mirrors ``sounddevice.query_devices``: with no argument it returns the full
    list; with an integer index it returns that one device. ``kind`` is accepted
    for signature compatibility and ignored.
    """
    if device is None:
        return [dict(d) for d in _DEVICES]
    return dict(_DEVICES[device])


def play(data, samplerate: Optional[int] = None, **kwargs) -> Any:
    """Play ``data`` through the page's speakers (delegates to :func:`browseraudio.play`).

    Drop-in for ``sounddevice.play``: playback is fire-and-forget, so this works
    in a single cell. Extra keyword arguments are forwarded to
    :func:`browseraudio.play` (e.g. ``autoplay``).
    """
    from . import play as _play

    return _play(data, samplerate, **kwargs)


def wait(ignore_errors: bool = True) -> None:
    """No-op: browser playback is fire-and-forget, so there's nothing to await.

    Present so that the common ``sd.play(...); sd.wait()`` idiom keeps working.
    """
    return None


def rec(
    frames: Optional[int] = None,
    samplerate: Optional[int] = None,
    channels: Optional[int] = None,
    dtype: Any = None,
    out: Optional[np.ndarray] = None,
    mapping=None,
    blocking: bool = False,
    **kwargs,
) -> np.ndarray:
    """Not supported in the browser — use the two-cell :func:`browseraudio.record`.

    ``sounddevice.rec`` returns a buffer that fills in the background and is read
    after :func:`wait`. A browser kernel can't honor that: capture finishes only
    after a user gesture, the AudioContext (not the caller) decides the sample
    rate and length, and a Web-Worker kernel can't even process the result
    mid-cell. Rather than hang or hand back silence, we raise with guidance.
    """
    where = (
        "a Web-Worker kernel (JupyterLite / thebe)"
        if in_worker()
        else "the browser"
    )
    raise RuntimeError(
        f"sd.rec() + sd.wait() can't run in {where}: capture is interactive and "
        "the browser picks the sample rate, so it can't fill a buffer "
        "synchronously in one cell. Use the two-cell flow instead — "
        "`rec = browseraudio.record(duration)`, click Record, then read "
        "`rec.samples` / `rec.to_pyquist()` in a later cell."
    )
