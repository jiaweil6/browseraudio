"""Frontend assets: the widgets' JavaScript, and where genie mode's model lives."""

from __future__ import annotations

import pathlib

STATIC = pathlib.Path(__file__).parent / "static"

# Piano Genie (Donahue, Simon & Dieleman, IUI 2019): the trained model Magenta
# publishes, used by genie mode. Override per widget with ``genie_checkpoint``
# to self-host it (e.g. for offline use).
GENIE_CHECKPOINT = (
    "https://storage.googleapis.com/magentadata/js/checkpoints/piano_genie/"
    "model/epiano/stp_iq_auto_contour_dt_166006"
)


INPUTS = ("keys", "genie")


def _check_input(input: str, genie_temperature: float) -> None:
    """Validate the keyboard widgets' ``input`` mode and genie temperature."""
    if input not in INPUTS:
        raise ValueError(f"input must be 'keys' or 'genie', got {input!r}")
    if not 0.0 <= genie_temperature <= 1.0:
        raise ValueError(f"genie_temperature must be in [0, 1], got {genie_temperature}")


def _bundle(*names: str) -> str:
    """Concatenate frontend sources into one anywidget module.

    The widgets share ``ui.js`` (the look and common controls) and the keyboard
    widgets also ``genie.js`` and ``controls.js``. Those aren't modules of their
    own: they are prepended, so their functions are in scope for the widget
    source that follows (which holds the ``export default``).
    """
    return "\n".join((STATIC / name).read_text(encoding="utf-8") for name in names)
