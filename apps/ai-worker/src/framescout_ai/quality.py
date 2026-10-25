from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


@dataclass(frozen=True)
class QualitySignals:
    width: int
    height: int
    laplacian_variance: float
    tenengrad: float
    luminance_mean: float
    contrast: float
    shadow_clip_ratio: float
    highlight_clip_ratio: float

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


def load_proxy(path: str | Path, max_dimension: int = 1600) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    return image


def measure_quality(image: Image.Image) -> QualitySignals:
    rgb = np.asarray(image, dtype=np.float32)
    gray = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    if min(gray.shape) < 3:
        raise ValueError("preview is too small to analyze")

    center = gray[1:-1, 1:-1]
    laplacian = (
        gray[:-2, 1:-1]
        + gray[2:, 1:-1]
        + gray[1:-1, :-2]
        + gray[1:-1, 2:]
        - 4.0 * center
    )
    gx = gray[1:-1, 2:] - gray[1:-1, :-2]
    gy = gray[2:, 1:-1] - gray[:-2, 1:-1]

    return QualitySignals(
        width=image.width,
        height=image.height,
        laplacian_variance=float(np.var(laplacian)),
        tenengrad=float(np.mean(gx * gx + gy * gy)),
        luminance_mean=float(np.mean(gray)),
        contrast=float(np.std(gray)),
        shadow_clip_ratio=float(np.mean(gray <= 5.0)),
        highlight_clip_ratio=float(np.mean(gray >= 250.0)),
    )


def measure_crop(image: Image.Image, box: tuple[float, float, float, float]) -> QualitySignals | None:
    left, top, right, bottom = box
    left = max(0, min(round(left), image.width - 1))
    top = max(0, min(round(top), image.height - 1))
    right = max(left + 1, min(round(right), image.width))
    bottom = max(top + 1, min(round(bottom), image.height))
    crop = image.crop((left, top, right, bottom))
    if min(crop.size) < 24:
        return None
    return measure_quality(crop)

