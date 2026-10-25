from __future__ import annotations

from typing import Any

from .quality import QualitySignals


def _focus_confidence(value: float) -> float:
    return max(0.05, min(0.99, value / 240.0))


def decide(
    quality: QualitySignals,
    subjects: list[dict[str, Any]] | None,
    subject_focus: QualitySignals | None,
    preset: str,
    detector_status: str,
) -> tuple[str, list[str], list[dict[str, Any]]]:
    evidence: list[dict[str, Any]] = []
    reasons: list[str] = []

    focus_value = subject_focus.laplacian_variance if subject_focus else quality.laplacian_variance
    focus_label = "subject crop" if subject_focus else "global frame"
    focus_tone = "keep" if focus_value >= 70 else "neutral" if focus_value >= 30 else "review"
    evidence.append({
        "label": "Subject focus" if subject_focus else "Global focus",
        "value": f"{focus_label} {focus_value:.1f}",
        "confidence": _focus_confidence(focus_value),
        "tone": focus_tone,
    })

    severe_under = quality.luminance_mean < 20 and quality.shadow_clip_ratio > 0.45
    severe_over = quality.luminance_mean > 238 or quality.highlight_clip_ratio > 0.35
    exposure_usable = not severe_under and not severe_over
    evidence.append({
        "label": "Exposure",
        "value": "usable" if exposure_usable else "needs review",
        "confidence": max(0.5, min(0.98, 1.0 - max(quality.shadow_clip_ratio, quality.highlight_clip_ratio))),
        "tone": "keep" if exposure_usable else "review",
    })

    if detector_status == "ready":
        subject_count = len(subjects or [])
        best_confidence = max((item["confidence"] for item in subjects or []), default=0.5)
        evidence.append({
            "label": "Allowed subjects",
            "value": f"{subject_count} detected",
            "confidence": best_confidence,
            "tone": "keep" if subject_count else "review",
        })
        if subject_count == 0:
            reasons.append("no_allowed_subject")
    else:
        evidence.append({
            "label": "Allowed subjects",
            "value": "detector unavailable",
            "confidence": None,
            "tone": "neutral",
        })
        reasons.append("subject_detector_unavailable")

    if focus_value < 30:
        reasons.append("subject_out_of_focus" if subject_focus else "global_soft_focus")
    if not exposure_usable:
        reasons.append("exposure_needs_review")

    # Until thresholds are calibrated on the user's event-level corpus, only an
    # unreadable image may be auto-rejected. Ambiguous technical failures review.
    review_reasons = {
        "subject_out_of_focus",
        "global_soft_focus",
        "exposure_needs_review",
        "no_allowed_subject",
    }
    disposition = "review" if review_reasons.intersection(reasons) else "keep"
    if preset != "action-coverage" and reasons == ["no_allowed_subject"]:
        disposition = "review"
    return disposition, reasons, evidence
