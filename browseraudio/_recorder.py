"""Microphone recording."""

from __future__ import annotations

from typing import Callable, Optional

import anywidget
import numpy as np
import traitlets

from ._assets import _bundle
from ._env import in_worker
from ._pcm import decode_f32


class Recorder(anywidget.AnyWidget):
    """Records the microphone in the page and hands the samples to Python.

    The take arrives after the cell finishes, so read it in a later cell::

        rec = Recorder(duration=3.0); rec   # click Record
        rec.samples                         # next cell: float32 (n_frames, 1)

    Attributes:
        duration: Seconds to record.
        sample_rate: The AudioContext rate; set after recording.
        error: Message from the last failed attempt, else ``None``.
    """

    _esm = _bundle("ui.js", "recorder.js")

    duration = traitlets.Float(3.0).tag(sync=True)
    sample_rate = traitlets.Int(0).tag(sync=True)
    # Synced from the browser.
    _pcm_b64 = traitlets.Unicode("").tag(sync=True)
    _error = traitlets.Unicode("").tag(sync=True)

    def __init__(self, duration: float = 3.0, **kwargs):
        super().__init__(duration=duration, **kwargs)
        self._samples: Optional[np.ndarray] = None
        self.error: Optional[str] = None
        self.observe(self._on_pcm, names="_pcm_b64")
        self.observe(self._on_error, names="_error")

    def _on_pcm(self, change) -> None:
        if not change["new"]:
            return
        self._samples = decode_f32(change["new"]).reshape(-1, 1)
        self.error = None

    def _on_error(self, change) -> None:
        self.error = change["new"] or None

    @property
    def samples(self) -> Optional[np.ndarray]:
        """The most recent recording as float32 ``(n_frames, 1)``, or ``None``."""
        return self._samples

    def on_result(self, callback: Callable[["Recorder"], None]) -> Callable:
        """Call ``callback(self)`` when a take arrives; returns the handler."""

        def _handler(change) -> None:
            # _on_pcm (registered first) has already decoded the take.
            if self._samples is not None:
                callback(self)

        self.observe(_handler, names="_pcm_b64")
        return _handler

    def on_error(self, callback: Callable[[str], None]) -> Callable:
        """Call ``callback(message)`` when a take fails; returns the handler."""

        def _handler(change) -> None:
            if change["new"]:
                callback(change["new"])

        self.observe(_handler, names="_error")
        return _handler

    async def result(self) -> "Recorder":
        """Await the next take and return ``self``; raise ``RuntimeError`` on failure.

        Main-thread kernels only: in a Web Worker it raises at once rather than hang.
        """
        if in_worker():
            raise RuntimeError(
                "await result() can't complete in a Web-Worker kernel "
                "(JupyterLite / thebe): the widget reply isn't processed while "
                "the cell is still running. Use the two-cell flow instead — "
                "display the recorder, click Record, then read .samples in a "
                "later cell."
            )

        import asyncio

        future: "asyncio.Future[Recorder]" = asyncio.get_running_loop().create_future()

        def _resolved(change) -> None:
            if self._samples is not None and not future.done():
                future.set_result(self)

        def _failed(change) -> None:
            if change["new"] and not future.done():
                future.set_exception(RuntimeError(change["new"]))

        self.observe(_resolved, names="_pcm_b64")
        self.observe(_failed, names="_error")
        try:
            return await future
        finally:
            self.unobserve(_resolved, names="_pcm_b64")
            self.unobserve(_failed, names="_error")

    def to_pyquist(self):
        """The take as a ``pyquist.Audio``."""
        if self._samples is None:
            raise RuntimeError("Nothing recorded yet — click Record first.")
        import pyquist as pq

        return pq.Audio(self._samples, sample_rate=self.sample_rate)


def record(duration: float = 3.0) -> Recorder:
    """Display a :class:`Recorder` and return it. Read ``.samples`` in a later cell."""
    from IPython.display import display

    rec = Recorder(duration=duration)
    display(rec)
    return rec
