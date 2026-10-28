"""Frontend bundling and genie-mode settings."""

from __future__ import annotations

import pathlib

STATIC = pathlib.Path(__file__).parent / "static"

# Piano Genie (Donahue, Simon & Dieleman, IUI 2019), as published by Magenta.
GENIE_CHECKPOINT = (
    "https://storage.googleapis.com/magentadata/js/checkpoints/piano_genie/"
    "model/epiano/stp_iq_auto_contour_dt_166006"
)


INPUTS = ("keys", "genie")


def _check_input(input: str, genie_temperature: float) -> None:
    """Validate ``input`` and ``genie_temperature``."""
    if input not in INPUTS:
        raise ValueError(f"input must be 'keys' or 'genie', got {input!r}")
    if not 0.0 <= genie_temperature <= 1.0:
        raise ValueError(f"genie_temperature must be in [0, 1], got {genie_temperature}")


def _bundle(*names: str) -> str:
    """Concatenate static JS files into one module (shared files first)."""
    return "\n".join((STATIC / name).read_text(encoding="utf-8") for name in names)
