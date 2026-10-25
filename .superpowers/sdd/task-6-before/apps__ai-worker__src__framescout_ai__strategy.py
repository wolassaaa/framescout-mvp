from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


STRATEGY_FILES = {
    "action-coverage": "action-coverage.strategy.json",
    "matchday-story": "matchday-story.strategy.json",
    "motorsport": "motorsport.strategy.json",
    "esports-stage": "esports-stage.strategy.json",
    "portrait": "portrait.strategy.json",
    "custom": "base.strategy.json",
}


def _validate_safety_invariants(strategy: dict[str, Any]) -> None:
    decision_policy = strategy.get("decisionPolicy", {})
    fallback_policy = strategy.get("fallbackPolicy", {})
    if (
        decision_policy.get("humanDecisionWins") is not True
        or decision_policy.get("ambiguousAction") != "review"
        or fallback_policy.get("rawUploadAllowed") is not False
    ):
        raise ValueError("unsafe strategy invariant")


def load_strategy(preset: str, strategy_root: Path) -> dict[str, Any]:
    try:
        filename = STRATEGY_FILES[preset]
    except KeyError as error:
        raise ValueError(f"unknown strategy preset: {preset}") from error

    with (strategy_root / filename).open("r", encoding="utf-8") as source:
        strategy = json.load(source)
    if not isinstance(strategy, dict):
        raise ValueError(f"strategy must be a JSON object: {filename}")
    _validate_safety_invariants(strategy)
    return strategy


def _numeric_observation(
    value: Any,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    normalized = float(value)
    if not math.isfinite(normalized):
        return None
    if minimum is not None and normalized < minimum:
        return None
    if maximum is not None and normalized > maximum:
        return None
    return normalized


def _numeric_metric(
    container: Any,
    camel_name: str,
    snake_name: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    if not isinstance(container, dict):
        return None
    return _numeric_observation(
        container.get(camel_name, container.get(snake_name)),
        minimum=minimum,
        maximum=maximum,
    )


def _focus_value(value: Any) -> float | None:
    direct = _numeric_observation(value, minimum=0.0)
    if direct is not None:
        return direct
    return _numeric_metric(
        value,
        "laplacianVariance",
        "laplacian_variance",
        minimum=0.0,
    )


def _normalize_allowed_subjects(
    signals: dict[str, Any],
) -> list[dict[str, Any]] | None:
    raw_subjects = signals.get("allowedSubjects")
    if not isinstance(raw_subjects, (list, tuple)):
        return None

    normalized_subjects: list[dict[str, Any]] = []
    for raw_subject in raw_subjects:
        if not isinstance(raw_subject, dict):
            return None

        label = raw_subject.get("label")
        confidence = _numeric_observation(
            raw_subject.get("confidence"), minimum=0.0, maximum=1.0
        )
        if not isinstance(label, str) or not label.strip() or confidence is None:
            return None

        subject: dict[str, Any] = {
            "label": label.strip(),
            "confidence": confidence,
        }
        if "class_id" in raw_subject:
            class_id = raw_subject["class_id"]
            if isinstance(class_id, bool) or not isinstance(class_id, int) or class_id < 0:
                return None
            subject["class_id"] = class_id

        if "box" in raw_subject:
            raw_box = raw_subject["box"]
            if not isinstance(raw_box, (list, tuple)) or len(raw_box) != 4:
                return None
            box_values = [
                _numeric_observation(coordinate, minimum=0.0)
                for coordinate in raw_box
            ]
            if any(coordinate is None for coordinate in box_values):
                return None
            x1, y1, x2, y2 = box_values
            if x1 > x2 or y1 > y2:
                return None
            subject["box"] = tuple(box_values)

        normalized_subjects.append(subject)

    return normalized_subjects


def _focus_confidence(value: float) -> float:
    return max(0.05, min(0.99, value / 240.0))


def _capability_evidence() -> list[dict[str, Any]]:
    return [
        {
            "label": "Allowed subjects",
            "value": "detector unavailable",
            "confidence": None,
            "tone": "neutral",
        }
    ]


def _context_evidence(contexts: list[str]) -> list[dict[str, Any]]:
    return [
        {
            "label": "Protected context",
            "value": ", ".join(contexts),
            "confidence": None,
            "tone": "keep",
        }
    ]


def _subject_evidence(
    subjects: list[dict[str, Any]], action: str
) -> list[dict[str, Any]]:
    confidences = [subject["confidence"] for subject in subjects]
    return [
        {
            "label": "Allowed subjects",
            "value": f"{len(subjects)} detected",
            "confidence": max(confidences) if confidences else None,
            "tone": action,
        }
    ]


def _more_severe(current: str, proposed: str) -> str:
    severity = {"keep": 0, "review": 1, "reject": 2}
    return proposed if severity[proposed] > severity[current] else current


def _unknown_evidence(label: str, value: str) -> dict[str, Any]:
    return {
        "label": label,
        "value": value,
        "confidence": None,
        "tone": "neutral",
    }


def _evaluate_face_rules(
    signals: dict[str, Any], strategy: dict[str, Any]
) -> tuple[str, list[str], list[dict[str, Any]], float | None]:
    face_policy = strategy["signals"]["face"]
    if face_policy["mode"] == "off":
        return "keep", [], [], None

    if signals.get("faceModelStatus") != "ready":
        return (
            "review",
            ["face_model_unavailable"],
            [_unknown_evidence("Face capability", "face model unavailable")],
            None,
        )

    evidence: list[dict[str, Any]] = [
        {
            "label": "Face capability",
            "value": "face model ready",
            "confidence": None,
            "tone": "keep",
        }
    ]
    face_size = _numeric_observation(signals.get("faceSizePixels"))
    if face_size is None:
        evidence.append(_unknown_evidence("Face size", "signal unavailable"))
        return "review", ["face_size_unavailable"], evidence, None

    face_size_usable = face_size >= face_policy["minimumFacePixels"]
    evidence.append(
        {
            "label": "Face size",
            "value": f"{face_size:.0f} px",
            "confidence": None,
            "tone": "keep" if face_size_usable else "review",
        }
    )
    if not face_size_usable:
        return "review", ["face_too_small"], evidence, None

    action = "keep"
    reasons: list[str] = []
    if face_policy["checkEyes"]:
        eyes_open = signals.get("eyesOpen")
        if eyes_open is True:
            evidence.append(
                {
                    "label": "Eyes",
                    "value": "open",
                    "confidence": None,
                    "tone": "keep",
                }
            )
        elif eyes_open is False:
            closed_action = face_policy["closedEyesAction"]
            action = _more_severe(action, closed_action)
            reasons.append("eyes_closed")
            evidence.append(
                {
                    "label": "Eyes",
                    "value": "closed",
                    "confidence": None,
                    "tone": closed_action,
                }
            )
        else:
            action = _more_severe(action, "review")
            reasons.append("eyes_signal_unavailable")
            evidence.append(_unknown_evidence("Eyes", "signal unavailable"))

    if face_policy["checkExpression"]:
        expression = signals.get("expression")
        if expression == "usable":
            evidence.append(
                {
                    "label": "Expression",
                    "value": "usable",
                    "confidence": None,
                    "tone": "keep",
                }
            )
        elif expression == "unusual":
            action = _more_severe(action, "review")
            reasons.append("expression_needs_review")
            evidence.append(
                {
                    "label": "Expression",
                    "value": "unusual",
                    "confidence": None,
                    "tone": "review",
                }
            )
        else:
            action = _more_severe(action, "review")
            reasons.append("expression_signal_unavailable")
            evidence.append(_unknown_evidence("Expression", "signal unavailable"))

    face_focus = _focus_value(signals.get("faceFocus"))
    if face_focus is None:
        action = _more_severe(action, "review")
        reasons.append("face_focus_unavailable")
        evidence.append(_unknown_evidence("Face focus", "signal unavailable"))

    return action, reasons, evidence, face_focus


def _present_requirements(
    signals: dict[str, Any],
    strategy: dict[str, Any],
    reasons: list[str],
    validated_requirements: set[str] | None = None,
) -> set[str]:
    present = set(reasons)
    present.update(validated_requirements or ())

    readable = signals.get("readable", True)
    if readable:
        present.add("readable_preview")
    else:
        present.add("unreadable_preview")
    if signals.get("detectorStatus") == "ready":
        present.add("subject_detector_ready")
    if not signals["allowedSubjects"]:
        present.add("no_allowed_subject")

    focus_policy = strategy["signals"]["focus"]
    quality = signals.get("quality", {})
    global_focus = _focus_value(quality)
    if global_focus is not None and global_focus >= focus_policy["reviewBelow"]:
        present.add("sharp_global_frame")

    return present


def _gate_hard_reject(
    action: str,
    reasons: list[str],
    evidence: list[dict[str, Any]],
    signals: dict[str, Any],
    strategy: dict[str, Any],
    validated_requirements: set[str] | None = None,
) -> tuple[str, list[str], list[dict[str, Any]]]:
    if action != "reject":
        return action, reasons, evidence

    required = strategy["decisionPolicy"]["hardRejectRequires"]
    present = _present_requirements(
        signals, strategy, reasons, validated_requirements
    )
    missing = [key for key in required if key not in present]
    if not missing:
        return action, reasons, evidence

    return (
        "review",
        [*reasons, "hard_reject_requirements_missing"],
        [
            *evidence,
            {
                "label": "Hard reject gate",
                "value": f"missing: {', '.join(missing)}",
                "confidence": None,
                "tone": "review",
            },
        ],
    )


def evaluate_quality_rules(
    signals: dict[str, Any], strategy: dict[str, Any]
) -> tuple[str, list[str], list[dict[str, Any]]]:
    quality = signals.get("quality", {})
    focus_policy = strategy["signals"]["focus"]
    exposure_policy = strategy["signals"]["exposure"]
    subjects = signals["allowedSubjects"]
    face_action, face_reasons, face_evidence, face_focus = _evaluate_face_rules(
        signals, strategy
    )
    evidence: list[dict[str, Any]] = [
        *_subject_evidence(subjects, "keep"),
        *face_evidence,
    ]
    reasons = list(face_reasons)
    action = face_action

    global_focus = _focus_value(quality)
    subject_focus = _focus_value(signals.get("subjectFocus"))
    validated_requirements: set[str] = set()
    joint_focus_unusable = (
        face_focus is not None
        and subject_focus is not None
        and face_focus < focus_policy["rejectBelow"]
        and subject_focus < focus_policy["rejectBelow"]
    )
    if joint_focus_unusable:
        validated_requirements.add("face_and_subject_unusable")
    focus_values = {
        "face": face_focus,
        "subject": subject_focus,
        "global": global_focus,
    }
    focus_region, focus_value = next(
        (
            (region, focus_values[region])
            for region in focus_policy["regionPriority"]
            if focus_values[region] is not None
        ),
        ("global", None),
    )

    if focus_policy["enabled"]:
        if (
            "subject" in focus_policy["regionPriority"]
            and subject_focus is None
            and focus_value is not None
        ):
            action = _more_severe(action, "review")
            reasons.append("subject_focus_unavailable")
            evidence.append(_unknown_evidence("Subject focus", "signal unavailable"))
        if focus_value is None:
            action = "review"
            reasons.append("focus_signal_unavailable")
            evidence.append(
                {
                    "label": "Focus",
                    "value": "signal unavailable",
                    "confidence": None,
                    "tone": "neutral",
                }
            )
        else:
            intentional_motion = bool(signals.get("intentionalMotion"))
            motion_protected = focus_policy["protectIntentionalMotion"] and intentional_motion
            if motion_protected:
                reasons.append("intentional_motion_protected")
            elif focus_value < focus_policy["rejectBelow"]:
                action = _more_severe(action, "reject")
                reasons.append({
                    "face": "face_out_of_focus",
                    "subject": "subject_out_of_focus",
                    "global": "global_soft_focus",
                }[focus_region])
            elif focus_value < focus_policy["reviewBelow"]:
                action = _more_severe(action, "review")
                reasons.append({
                    "face": "face_out_of_focus",
                    "subject": "subject_out_of_focus",
                    "global": "global_soft_focus",
                }[focus_region])
            elif (
                focus_region in {"face", "subject"}
                and global_focus is not None
                and global_focus < focus_policy["reviewBelow"]
            ):
                reasons.append("face_is_sharp" if focus_region == "face" else "subject_is_sharp")

            focus_tone = (
                "keep"
                if motion_protected or focus_value >= focus_policy["reviewBelow"]
                else "review"
                if focus_value >= focus_policy["rejectBelow"]
                else "reject"
            )
            evidence.append(
                {
                    "label": {
                        "face": "Face focus",
                        "subject": "Subject focus",
                        "global": "Global focus",
                    }[focus_region],
                    "value": f"{focus_value:.1f}",
                    "confidence": _focus_confidence(focus_value),
                    "tone": focus_tone,
                }
            )
            if joint_focus_unusable and focus_region == "face":
                evidence.append(
                    {
                        "label": "Subject focus",
                        "value": f"{subject_focus:.1f}",
                        "confidence": _focus_confidence(subject_focus),
                        "tone": "reject",
                    }
                )

    if exposure_policy["enabled"]:
        shadow_clip = _numeric_metric(
            quality,
            "shadowClipRatio",
            "shadow_clip_ratio",
            minimum=0.0,
            maximum=1.0,
        )
        highlight_clip = _numeric_metric(
            quality,
            "highlightClipRatio",
            "highlight_clip_ratio",
            minimum=0.0,
            maximum=1.0,
        )
        if shadow_clip is None or highlight_clip is None:
            action = "review"
            reasons.append("exposure_signal_unavailable")
            evidence.append(_unknown_evidence("Exposure", "signal unavailable"))
            return _gate_hard_reject(
                action,
                reasons,
                evidence,
                signals,
                strategy,
                validated_requirements,
            )

        low_light_protected = (
            exposure_policy["protectLowLight"]
            and bool(signals.get("lowLight"))
            and subject_focus is not None
            and subject_focus >= focus_policy["reviewBelow"]
            and shadow_clip > exposure_policy["shadowClipReviewAbove"]
        )
        if low_light_protected:
            reasons.append("low_light_protected")
        elif shadow_clip > exposure_policy["shadowClipReviewAbove"]:
            action = "review" if action == "keep" else action
            reasons.append("shadow_clipping")
        if highlight_clip > exposure_policy["highlightClipReviewAbove"]:
            action = "review" if action == "keep" else action
            reasons.append("highlight_clipping")

        exposure_usable = (
            low_light_protected
            or shadow_clip <= exposure_policy["shadowClipReviewAbove"]
        ) and highlight_clip <= exposure_policy["highlightClipReviewAbove"]
        evidence.append(
            {
                "label": "Exposure",
                "value": "usable" if exposure_usable else "needs review",
                "confidence": max(0.05, min(0.99, 1.0 - max(shadow_clip, highlight_clip))),
                "tone": "keep" if exposure_usable else "review",
            }
        )

    return _gate_hard_reject(
        action,
        reasons,
        evidence,
        signals,
        strategy,
        validated_requirements,
    )


def evaluate_strategy(
    signals: dict[str, Any], strategy: dict[str, Any]
) -> tuple[str, list[str], list[dict[str, Any]]]:
    _validate_safety_invariants(strategy)

    if not signals.get("readable", True):
        action = strategy["decisionPolicy"]["unreadablePreview"]
        return action, ["unreadable_preview"], [
            {
                "label": "Preview",
                "value": "unreadable",
                "confidence": 1.0,
                "tone": action,
            }
        ]

    if signals.get("detectorStatus") != "ready":
        return "review", ["subject_detector_unavailable"], _capability_evidence()

    subjects = _normalize_allowed_subjects(signals)
    if subjects is None:
        return "review", ["allowed_subject_signal_unavailable"], [
            _unknown_evidence("Allowed subjects", "signal unavailable")
        ]
    normalized_signals = {**signals, "allowedSubjects": subjects}

    detected_contexts = {
        context for context in signals.get("protectedContexts", []) if isinstance(context, str)
    }
    protected_contexts = [
        context
        for context in strategy["subjects"]["protectedContexts"]
        if context in detected_contexts
    ]
    if protected_contexts:
        return "keep", ["protected_context"], _context_evidence(protected_contexts)

    if not subjects:
        action = strategy["decisionPolicy"]["noAllowedSubject"]
        return _gate_hard_reject(
            action,
            ["no_allowed_subject"],
            _subject_evidence([], action),
            normalized_signals,
            strategy,
        )

    return evaluate_quality_rules(normalized_signals, strategy)
