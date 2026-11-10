"""A ``sounddevice``-shaped facade for the browser.

``play``, ``wait``, ``OutputStream``, ``query_devices`` and ``default`` work
as in sounddevice. ``rec`` raises: a browser kernel can't fill a buffer
synchronously — use :func:`browseraudio.record`. ``InputStream`` and ``Stream``
raise too: there is no real-time input.
"""

from __future__ import annotations

import time as _time
import warnings
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Union

import numpy as np

from ._env import in_worker

__all__ = [
    "default",
    "query_devices",
    "play",
    "wait",
    "rec",
    "OutputStream",
    "InputStream",
    "Stream",
    "CallbackFlags",
    "CallbackStop",
    "CallbackAbort",
]

# Advertised rate; the AudioContext decides the real one.
NOMINAL_SAMPLERATE = 48000

# The mic and the speakers, shaped like sounddevice's device dicts.
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
    """Stand-in for ``sounddevice.default`` (``device``, ``samplerate``, ``channels``)."""

    def __init__(self) -> None:
        self.device: Any = [0, 1]
        self.samplerate: Optional[int] = None
        self.channels: List[Optional[int]] = [None, None]


default = _Default()


class DeviceList(list):
    """The device table; prints like sounddevice's."""

    def __repr__(self) -> str:
        default_in, default_out = default.device
        lines = []
        for d in self:
            mark = (
                ">" if d["index"] == default_in else "<" if d["index"] == default_out else " "
            )
            lines.append(
                f"{mark} {d['index']} {d['name']}, Web Audio "
                f"({d['max_input_channels']} in, {d['max_output_channels']} out)"
            )
        return "\n".join(lines)


def _device_index(device: Any, kind: Optional[str]) -> int:
    """Resolve a device index, name substring, or (input, output) pair."""
    if isinstance(device, (list, tuple)):
        if kind is None:
            raise ValueError("a device pair needs kind='input' or kind='output'")
        device = device[0 if kind == "input" else 1]
    if isinstance(device, str):
        matches = [d["index"] for d in _DEVICES if device.lower() in d["name"].lower()]
        if len(matches) != 1:
            raise ValueError(f"no unique device matching {device!r}")
        return matches[0]
    index = int(device)
    if not 0 <= index < len(_DEVICES):
        raise ValueError(f"no device with index {index}")
    return index


def query_devices(
    device: Any = None, kind: Optional[str] = None
) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
    """The device table, or one device by index, name, or ``(in, out)`` pair with ``kind``."""
    if kind not in (None, "input", "output"):
        raise ValueError(f"kind must be 'input' or 'output', got {kind!r}")
    if device is None and kind is None:
        return DeviceList(dict(d) for d in _DEVICES)
    if device is None:
        device = default.device
    info = dict(_DEVICES[_device_index(device, kind)])
    if kind is not None and info[f"max_{kind}_channels"] == 0:
        raise ValueError(f"{info['name']!r} is not an {kind} device")
    return info


def play(data, samplerate: Optional[int] = None, **kwargs) -> Any:
    """``sounddevice.play``: delegates to :func:`browseraudio.play`."""
    from . import play as _play

    return _play(data, samplerate, **kwargs)


def wait(ignore_errors: bool = True) -> None:
    """No-op: browser playback doesn't block."""
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
    """Not supported in the browser: raises, pointing to :func:`browseraudio.record`."""
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


# ----- real-time output ------------------------------------------------------


class CallbackStop(Exception):
    """Raise in a callback to stop the stream."""


class CallbackAbort(Exception):
    """Raise in a callback to abort the stream."""


class CallbackFlags:
    """A callback's ``status``; ``output_underflow`` means the browser ran dry."""

    _NAMES = (
        "input_underflow",
        "input_overflow",
        "output_underflow",
        "output_overflow",
        "priming_output",
    )

    def __init__(self, **flags: bool) -> None:
        for name in self._NAMES:
            setattr(self, name, bool(flags.pop(name, False)))
        if flags:
            raise TypeError(f"unknown flags: {sorted(flags)}")

    def __bool__(self) -> bool:
        return any(getattr(self, name) for name in self._NAMES)

    def __str__(self) -> str:
        return ", ".join(name.replace("_", " ") for name in self._NAMES if getattr(self, name))

    def __repr__(self) -> str:
        return f"<sounddevice.CallbackFlags: {str(self) or 'no flags set'}>"


# sounddevice latency -> seconds queued.
_LATENCY = {"low": 0.04, "high": 0.1}

# For blocksize 0 / None.
DEFAULT_BLOCKSIZE = 512


class OutputStream:
    """``sounddevice.OutputStream`` (callback mode) on a :class:`browseraudio.Stream`.

    ``callback(outdata, frames, time, status)`` as in sounddevice. ``device`` is
    ignored, only float32 is supported, ``time`` holds estimates, and blocks are
    only made while no cell runs. :meth:`start` shows the engine widget.
    """

    def __init__(
        self,
        samplerate: Optional[float] = None,
        blocksize: Optional[int] = None,
        device: Any = None,
        channels: Optional[int] = None,
        dtype: Any = None,
        latency: Union[str, float, None] = None,
        extra_settings: Any = None,
        callback: Optional[Callable] = None,
        finished_callback: Optional[Callable[[], None]] = None,
        clip_off: Any = None,
        dither_off: Any = None,
        never_drop_input: Any = None,
        prime_output_buffers_using_stream_callback: Any = None,
    ) -> None:
        from ._stream import Stream as Engine

        if callback is None:
            raise ValueError(
                "browseraudio's OutputStream needs a callback (blocking write() "
                "can't run in a browser kernel)"
            )
        if dtype not in (None, "float32", np.float32):
            raise ValueError(f"only dtype='float32' is supported, got {dtype!r}")
        if isinstance(latency, str):
            if latency not in _LATENCY:
                raise ValueError(f"latency must be 'low', 'high' or seconds, got {latency!r}")
            lookahead = _LATENCY[latency]
        else:
            lookahead = _LATENCY["low"] if latency is None else float(latency)

        self._callback = callback
        self._finished_callback = finished_callback
        self.device = device
        self.samplerate = float(samplerate or default.samplerate or NOMINAL_SAMPLERATE)
        self.blocksize = int(blocksize or DEFAULT_BLOCKSIZE)
        self.channels = int(channels or default.channels[1] or 2)
        self.dtype = "float32"
        self.latency = lookahead
        self._closed = False
        self._started = False
        self._displayed = False
        self._dropouts_seen = 0
        self._t0 = _time.perf_counter()
        self._frames_done = 0

        self._widget = Engine(
            self._render,
            int(round(self.samplerate)),
            self.blocksize,
            channels=self.channels,
            lookahead=lookahead,
            keyboard=False,
        )
        self._widget.observe(self._on_playing, names="playing")

    # -- the callback adapter --------------------------------------------------

    def _render(self, block) -> None:
        if not self._widget.playing:  # stopped mid-batch: rest of it is silence
            return
        dropouts = self._widget.dropouts
        status = CallbackFlags(output_underflow=dropouts > self._dropouts_seen)
        self._dropouts_seen = dropouts
        now = self._frames_done / self.samplerate
        time_info = SimpleNamespace(
            currentTime=now,
            outputBufferDacTime=now + self.latency,
            inputBufferAdcTime=0.0,
        )
        try:
            self._callback(block, self.blocksize, time_info, status)
        except CallbackStop:
            self._widget.stop()
        except CallbackAbort as abort:
            block[:] = 0
            cause = abort.__cause__  # `raise CallbackAbort from err`, as pyquist does
            if cause is None:
                self._widget.stop()
            else:  # a traceback printed here reaches no cell, so show it
                self._widget._fail(f"callback: {type(cause).__name__}: {cause}")
        self._frames_done += self.blocksize

    def _on_playing(self, change) -> None:
        if not change["new"] and self._finished_callback is not None:
            self._finished_callback()

    def _ended(self) -> None:
        """Warn if the browser never asked for audio between start and stop."""
        if self._started and self._frames_done == 0:
            warnings.warn(
                "stream stopped before the browser asked for any audio. Blocks are "
                "only made while no cell runs, so start the stream in one cell and "
                "stop it in a later one (a `with` block around time.sleep() is silent).",
                RuntimeWarning,
                stacklevel=3,
            )
        self._started = False

    # -- sounddevice's stream API -----------------------------------------------

    @property
    def active(self) -> bool:
        """True while playing."""
        return not self._closed and self._widget.playing

    @property
    def stopped(self) -> bool:
        """True while not playing."""
        return not self.active

    @property
    def closed(self) -> bool:
        """True after :meth:`close`."""
        return self._closed

    @property
    def cpu_load(self) -> float:
        """Callback time / audio time since the last start."""
        made = self._widget.blocks_rendered * self.blocksize / self.samplerate
        return self._widget.busy / made if made else 0.0

    @property
    def widget(self):
        """The engine :class:`browseraudio.Stream`."""
        return self._widget

    def start(self) -> None:
        """Start playback (shows the widget the first time)."""
        if self._closed:
            raise RuntimeError("stream is closed")
        self._dropouts_seen = 0
        self._frames_done = 0
        self._started = True
        if not self._displayed:
            from IPython.display import display

            display(self._widget)
            self._displayed = True
        self._widget.start()

    def stop(self, ignore_errors: bool = True) -> None:
        """Stop playback."""
        self._ended()
        self._widget.stop()

    def abort(self, ignore_errors: bool = True) -> None:
        """Same as :meth:`stop`."""
        self._ended()
        self._widget.stop()

    def close(self, ignore_errors: bool = True) -> None:
        """Stop and remove the widget."""
        if self._closed:
            return
        self._ended()
        self._widget.stop()
        self._widget.close()
        self._closed = True

    def __enter__(self) -> "OutputStream":
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()
        self.close()


class _NoInput:
    """Real-time input: not available in the browser."""

    def __init__(self, *args, **kwargs) -> None:
        raise RuntimeError(
            f"sd.{type(self).__name__} can't run in the browser: browseraudio has "
            "no real-time input, only OutputStream. To capture the mic, use "
            "`rec = browseraudio.record(duration)`, click Record, then read "
            "`rec.samples` in a later cell."
        )


class InputStream(_NoInput):
    """Not supported in the browser: raises (no real-time input)."""


class Stream(_NoInput):
    """Not supported in the browser: raises (no real-time input)."""
