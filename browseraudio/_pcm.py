"""The float32 PCM wire format shared by the widgets.

Audio crosses the widget comm as base64-encoded little-endian float32 — the
layout a JS ``Float32Array`` reads directly on every browser we target.
"""

from __future__ import annotations

import base64

import numpy as np


def encode_f32(samples) -> str:
    """Flatten ``samples`` (C order) to little-endian float32 and base64 it."""
    flat = np.ascontiguousarray(samples, dtype="<f4")
    return base64.b64encode(flat.tobytes()).decode("ascii")


def decode_f32(b64: str) -> np.ndarray:
    """Decode a base64 float32 payload into a writable 1-D float32 array."""
    # `astype` makes a writable copy (frombuffer is read-only).
    return np.frombuffer(base64.b64decode(b64), dtype="<f4").astype(np.float32)
