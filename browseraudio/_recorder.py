"""The microphone Recorder widget."""

from __future__ import annotations

import base64
import pathlib
from typing import Callable, Optional

import anywidget
import numpy as np
import traitlets

from ._env import in_worker

_STATIC = pathlib.Path(__file__).parent / "static"


class Recorder(anywidget.AnyWidget):
    """A microphone recorder for in-browser Python (Pyodide / JupyterLite).

    The audio is captured on the browser's main thread (where the Web Audio
    API and ``getUserMedia`` live) and handed back to the Python kernel — so
    it works even when the kernel runs in a Web Worker, as it does under
    JupyterLite and thebe-lite.

    Because the recording finishes *after* you click the button, read the
    result in a separate cell from the one that displays the widget::

        from browseraudio import Recorder
        rec = Recorder(duration=3.0)
        rec                       # shows a "Record" button — click it

        # ...then, in a later cell:
        rec.samples               # float32 ndarray, shape (n_frames, 1)
        rec.sample_rate           # e.g. 48000

    Attributes:
        duration: Length to record, in seconds (default 3.0).
        sample_rate: The browser AudioContext's rate; set after recording.
        error: A message if the last attempt failed, else ``None``.
    """

    _esm = _STATIC / "recorder.js"

    duration = traitlets.Float(3.0).tag(sync=True)
    sample_rate = traitlets.Int(0).tag(sync=True)
    # Internal sync state (the transport is base64 float32 over the comm).
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
        raw = base64.b64decode(change["new"])
        # `astype` makes a writable copy (frombuffer is read-only).
        self._samples = np.frombuffer(raw, dtype="<f4").astype(np.float32).reshape(-1, 1)
        self.error = None

    def _on_error(self, change) -> None:
        self.error = change["new"] or None

    @property
    def samples(self) -> Optional[np.ndarray]:
        """The most recent recording as float32 ``(n_frames, 1)``, or ``None``."""
        return self._samples

    def on_result(self, callback: Callable[["Recorder"], None]) -> Callable:
        """Run ``callback(self)`` when a recording arrives from the browser.

        A clean, public alternative to observing the internal ``_pcm_b64``
        trait: the callback fires once samples have been captured (i.e. after
        the user clicks **Record** and the audio crosses the comm), with this
        :class:`Recorder` so you can read ``.samples`` / ``.sample_rate`` /
        ``.to_pyquist()``. Returns the underlying handler so you can later pass
        it to :meth:`unobserve` if you need to detach.
        """

        def _handler(change) -> None:
            # ``_on_pcm`` is registered first (in __init__), so by the time this
            # runs ``self._samples`` already reflects the new capture.
            if self._samples is not None:
                callback(self)

        self.observe(_handler, names="_pcm_b64")
        return _handler

    def on_error(self, callback: Callable[[str], None]) -> Callable:
        """Run ``callback(message)`` when a recording attempt fails.

        Surfaces the same failures as the :attr:`error` attribute (permission
        denied, no input device, nothing captured, …) as they happen, instead
        of being silently dropped. Returns the underlying handler for
        :meth:`unobserve`.
        """

        def _handler(change) -> None:
            if change["new"]:
                callback(change["new"])

        self.observe(_handler, names="_error")
        return _handler

    async def result(self) -> "Recorder":
        """Await the next completed recording, then return this recorder.

        Resolves once samples arrive (read them via ``.samples`` /
        ``.to_pyquist()``), or raises :class:`RuntimeError` if the attempt
        fails. **Main-thread only:** in a Web-Worker kernel (JupyterLite /
        thebe) the comm reply can't be processed while this coroutine's cell is
        still running, so awaiting would hang forever — we detect that and raise
        immediately, pointing you at the two-cell flow instead.
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
        """Return the recording as a :class:`pyquist.Audio` (requires pyquist)."""
        if self._samples is None:
            raise RuntimeError("Nothing recorded yet — click Record first.")
        import pyquist as pq

        return pq.Audio(self._samples, sample_rate=self.sample_rate)


def record(duration: float = 3.0) -> Recorder:
    """Create, display, and return a :class:`Recorder`.

    Click **Record**, then read ``.samples`` (or ``.to_pyquist()``) in a
    *later* cell. (A single-cell ``await`` flow can't work in Jupyter/thebe:
    the kernel doesn't process the widget-comm reply while the same cell is
    still running, so the recording would never arrive — hence two cells.)
    """
    from IPython.display import display

    rec = Recorder(duration=duration)
    display(rec)
    return rec
