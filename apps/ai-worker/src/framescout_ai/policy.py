from __future__ import annotations

from pathlib import Path
from typing import Any

from .quality import QualitySignals
from .strategy import evaluate_strategy, load_strategy


DEFAULT_STRATEGY_ROOT = Path(__file__).resolve().parents[4] / "strategies"


def _quality_signals(quality: QualitySignals) -> dict[str, float]:
    return {
        "laplacianVariance": quality.laplacian_variance,
        "tenengrad": quality.tenengrad,
        "luminanceMean": quality.luminance_mean,
        "contrast": quality.contrast,
        "shadowClipRatio": quality.shadow_clip_ratio,
        "highlightClipRatio": quality.highlight_clip_ratio,
    }


def decide(
    quality: QualitySignals,
    subjects: list[dict[str, Any]] | None,
    subject_focus: QualitySignals | None,
    preset: str,
    detector_status: str,
) -> tuple[str, list[str], list[dict[str, Any]]]:
    strategy = load_strategy(preset, DEFAULT_STRATEGY_ROOT)
    signals: dict[str, Any] = {
        "readable": True,
        "detectorStatus": detector_status,
        "allowedSubjects": subjects,
        "subjectFocus": (
            {"laplacianVariance": subject_focus.laplacian_variance}
            if subject_focus is not None
            else None
        ),
        "quality": _quality_signals(quality),
    }
    return evaluate_strategy(signals, strategy)
