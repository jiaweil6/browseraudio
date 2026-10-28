"""Audio over the widget comm: base64 little-endian float32."""

from __future__ import annotations

import base64

import numpy as np


def encode_f32(samples) -> str:
    """Flatten ``samples`` (C order) to base64 float32."""
    flat = np.ascontiguousarray(samples, dtype="<f4")
    return base64.b64encode(flat.tobytes()).decode("ascii")


def decode_f32(b64: str) -> np.ndarray:
    """Base64 float32 -> writable 1-D array."""
    return np.frombuffer(base64.b64decode(b64), dtype="<f4").astype(np.float32)
