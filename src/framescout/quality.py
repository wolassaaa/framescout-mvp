"""Fast, deterministic quality signals calculated from an image preview."""

from __future__ import annotations

import numpy as np
from PIL import Image

from .models import QualityMetrics


def _luminance(image: Image.Image, max_edge: int = 1600) -> np.ndarray:
    image = image.convert("RGB")
    image.thumbnail((max_edge, max_edge))
    rgb = np.asarray(image, dtype=np.float32) / 255.0
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def laplacian_variance(gray: np.ndarray) -> float:
    """Variance of a four-neighbour Laplacian; higher normally means sharper."""
    if min(gray.shape) < 3:
        return 0.0
    laplacian = (
        -4 * gray[1:-1, 1:-1]
        + gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
    )
    return float(np.var(laplacian))


def measure_quality(path: str) -> QualityMetrics:
    with Image.open(path) as image:
        gray = _luminance(image)
    return QualityMetrics(
        sharpness=laplacian_variance(gray),
        shadow_clip_ratio=float(np.mean(gray <= 0.02)),
        highlight_clip_ratio=float(np.mean(gray >= 0.98)),
        mean_luminance=float(np.mean(gray)),
    )
