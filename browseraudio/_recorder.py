"""The microphone Recorder widget."""

from __future__ import annotations

import base64
import pathlib
from typing import Optional

import anywidget
import numpy as np
import traitlets

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
