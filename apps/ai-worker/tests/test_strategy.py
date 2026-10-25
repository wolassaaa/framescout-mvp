from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from framescout_ai.strategy import evaluate_strategy, load_strategy
from framescout_ai.worker import handle_request


_MISSING = object()


@pytest.fixture
def strategy_root() -> Path:
    return Path(__file__).resolve().parents[3] / "strategies"


def _portrait_signals(**overrides: object) -> dict[str, object]:
    signals: dict[str, object] = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.94}],
        "faceModelStatus": "ready",
        "faceSizePixels": 120,
        "eyesOpen": True,
        "expression": "usable",
        "faceFocus": 82,
        "subjectFocus": 74,
        "quality": {
            "laplacianVariance": 70,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }
    signals.update(overrides)
    return signals


def _acceptance_example(strategy: dict[str, object], case: str) -> dict[str, object]:
    examples = strategy["acceptanceExamples"]
    assert isinstance(examples, list)
    return next(item for item in examples if item["case"] == case)


def test_same_empty_scene_depends_on_strategy(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [],
        "protectedContexts": ["venue"],
        "subjectFocus": None,
        "quality": {
            "laplacianVariance": 100,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }

    matchday = load_strategy("matchday-story", strategy_root)
    portrait = load_strategy("portrait", strategy_root)

    assert evaluate_strategy(signals, matchday)[0] == "keep"
    assert evaluate_strategy(signals, portrait)[0] in {"review", "reject"}


def test_missing_detector_can_never_hard_reject(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "unavailable",
        "allowedSubjects": [],
    }
    strategy = load_strategy("action-coverage", strategy_root)

    disposition, reasons, evidence = evaluate_strategy(signals, strategy)

    assert disposition == "review"
    assert reasons == ["subject_detector_unavailable"]
    assert evidence == [
        {
            "label": "Allowed subjects",
            "value": "detector unavailable",
            "confidence": None,
            "tone": "neutral",
        }
    ]


@pytest.mark.parametrize("preset", ["action-coverage", "matchday-story"])
@pytest.mark.parametrize(
    "allowed_subjects",
    [
        pytest.param(_MISSING, id="missing"),
        pytest.param(None, id="none"),
        pytest.param({"label": "person", "confidence": 0.9}, id="mapping"),
        pytest.param("person", id="string"),
        pytest.param(1, id="scalar"),
        pytest.param([{}], id="empty-observation"),
        pytest.param(["not-a-detection"], id="string-observation"),
        pytest.param([{"label": "", "confidence": 0.9}], id="empty-label"),
        pytest.param([{"label": 1, "confidence": 0.9}], id="non-string-label"),
        pytest.param([{"label": "person"}], id="missing-confidence"),
        pytest.param([{"label": "person", "confidence": None}], id="none-confidence"),
        pytest.param([{"label": "person", "confidence": "0.9"}], id="string-confidence"),
        pytest.param([{"label": "person", "confidence": True}], id="boolean-confidence"),
        pytest.param([{"label": "person", "confidence": float("nan")}], id="nan-confidence"),
        pytest.param([{"label": "person", "confidence": float("inf")}], id="infinite-confidence"),
        pytest.param([{"label": "person", "confidence": -0.01}], id="negative-confidence"),
        pytest.param([{"label": "person", "confidence": 1.01}], id="confidence-over-one"),
        pytest.param(
            [{"label": "person", "confidence": 0.9, "class_id": True}],
            id="boolean-class-id",
        ),
        pytest.param(
            [{"label": "person", "confidence": 0.9, "class_id": -1}],
            id="negative-class-id",
        ),
        pytest.param(
            [{"label": "person", "confidence": 0.9, "box": "bad"}],
            id="non-collection-box",
        ),
        pytest.param(
            [{"label": "person", "confidence": 0.9, "box": [0, 0, 10]}],
            id="short-box",
        ),
        pytest.param(
            [{"label": "person", "confidence": 0.9, "box": [0, 0, True, 10]}],
            id="boolean-box-coordinate",
        ),
        pytest.param(
            [{"label": "person", "confidence": 0.9, "box": [10, 0, 5, 10]}],
            id="reversed-box",
        ),
        pytest.param(
            [
                {"label": "person", "confidence": 0.9},
                {"label": "person", "confidence": None},
            ],
            id="mixed-valid-and-malformed",
        ),
    ],
)
def test_ready_detector_with_unknown_subject_collection_reviews(
    strategy_root: Path, preset: str, allowed_subjects: object
) -> None:
    signals: dict[str, object] = {
        "readable": True,
        "detectorStatus": "ready",
        "protectedContexts": ["venue"],
        "subjectFocus": 0,
        "quality": {
            "laplacianVariance": 100,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }
    if allowed_subjects is not _MISSING:
        signals["allowedSubjects"] = allowed_subjects

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy(preset, strategy_root)
    )

    assert disposition == "review"
    assert reasons == ["allowed_subject_signal_unavailable"]
    assert evidence == [
        {
            "label": "Allowed subjects",
            "value": "signal unavailable",
            "confidence": None,
            "tone": "neutral",
        }
    ]
    assert "no_allowed_subject" not in reasons
    assert "subject_out_of_focus" not in reasons
    assert "hard_reject_requirements_missing" not in reasons


@pytest.mark.parametrize(
    ("preset", "expected_disposition"),
    [("action-coverage", "reject"), ("matchday-story", "review")],
)
@pytest.mark.parametrize("allowed_subjects", [[], ()], ids=["list", "tuple"])
def test_valid_empty_subject_collection_is_the_only_confirmed_zero(
    strategy_root: Path,
    preset: str,
    expected_disposition: str,
    allowed_subjects: list[object] | tuple[()],
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": allowed_subjects,
            "quality": {
                "laplacianVariance": 100,
                "shadowClipRatio": 0,
                "highlightClipRatio": 0,
            },
        },
        load_strategy(preset, strategy_root),
    )

    assert disposition == expected_disposition
    assert reasons == ["no_allowed_subject"]
    assert evidence == [
        {
            "label": "Allowed subjects",
            "value": "0 detected",
            "confidence": None,
            "tone": expected_disposition,
        }
    ]


@pytest.mark.parametrize("collection_type", [list, tuple])
def test_valid_nonempty_subject_collection_emits_only_observed_count_and_confidence(
    strategy_root: Path, collection_type: type[list] | type[tuple]
) -> None:
    subjects = collection_type(
        [
            {"label": "person", "confidence": 0.81},
            {
                "class_id": 0,
                "label": "person",
                "confidence": 0.93,
                "box": (1, 2, 30, 40),
            },
        ]
    )

    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": subjects,
            "subjectFocus": 80,
            "quality": {
                "laplacianVariance": 80,
                "shadowClipRatio": 0,
                "highlightClipRatio": 0,
            },
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == "keep"
    assert reasons == []
    assert evidence[0] == {
        "label": "Allowed subjects",
        "value": "2 detected",
        "confidence": 0.93,
        "tone": "keep",
    }


def test_action_empty_reject_requires_a_readable_sharp_frame(strategy_root: Path) -> None:
    strategy = load_strategy("action-coverage", strategy_root)
    base_signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [],
        "quality": {
            "laplacianVariance": 100,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }

    assert evaluate_strategy(base_signals, strategy)[0] == "reject"

    soft_signals = deepcopy(base_signals)
    soft_signals["quality"]["laplacianVariance"] = 10
    disposition, reasons, _ = evaluate_strategy(soft_signals, strategy)

    assert disposition == "review"
    assert reasons == ["no_allowed_subject", "hard_reject_requirements_missing"]


def test_motorsport_protects_intentional_motion(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "car", "confidence": 0.93}],
        "intentionalMotion": True,
        "subjectFocus": {"laplacianVariance": 5},
        "quality": {
            "laplacianVariance": 5,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("motorsport", strategy_root)
    )

    assert disposition == "keep"
    assert reasons == ["intentional_motion_protected"]
    assert evidence[0] == {
        "label": "Allowed subjects",
        "value": "1 detected",
        "confidence": 0.93,
        "tone": "keep",
    }


def test_sharp_subject_wins_over_soft_global_frame(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.91}],
        "subjectFocus": {"laplacianVariance": 95},
        "quality": {
            "laplacianVariance": 4,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }

    disposition, reasons, _ = evaluate_strategy(
        signals, load_strategy("matchday-story", strategy_root)
    )

    assert disposition == "keep"
    assert reasons == ["subject_is_sharp"]


@pytest.mark.parametrize(
    "invalid_focus",
    [
        pytest.param(-1, id="negative"),
        pytest.param({"laplacianVariance": -1}, id="nested-negative"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="infinity"),
        pytest.param("5", id="string"),
        pytest.param(True, id="boolean"),
        pytest.param(_MISSING, id="missing"),
    ],
)
def test_matchday_invalid_subject_focus_is_unknown_and_cannot_hard_reject(
    strategy_root: Path, invalid_focus: object
) -> None:
    signals: dict[str, object] = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.91}],
        "quality": {"shadowClipRatio": 0, "highlightClipRatio": 0},
    }
    if invalid_focus is not _MISSING:
        signals["subjectFocus"] = invalid_focus

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("matchday-story", strategy_root)
    )

    assert disposition == "review"
    assert reasons == ["focus_signal_unavailable"]
    assert evidence[1] == {
        "label": "Focus",
        "value": "signal unavailable",
        "confidence": None,
        "tone": "neutral",
    }


def test_matchday_zero_subject_focus_is_a_valid_hard_reject_measurement(
    strategy_root: Path,
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.91}],
            "subjectFocus": 0,
            "quality": {"shadowClipRatio": 0, "highlightClipRatio": 0},
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == "reject"
    assert reasons == ["subject_out_of_focus"]
    assert evidence[1]["label"] == "Subject focus"
    assert evidence[1]["value"] == "0.0"


@pytest.mark.parametrize(
    "invalid_focus",
    [
        pytest.param(-1, id="negative"),
        pytest.param({"laplacianVariance": -1}, id="nested-negative"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="infinity"),
        pytest.param("5", id="string"),
        pytest.param(True, id="boolean"),
        pytest.param(_MISSING, id="missing"),
    ],
)
def test_invalid_quality_focus_is_unknown(
    strategy_root: Path, invalid_focus: object
) -> None:
    quality: dict[str, object] = {
        "shadowClipRatio": 0,
        "highlightClipRatio": 0,
    }
    if invalid_focus is not _MISSING:
        quality["laplacianVariance"] = invalid_focus

    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.91}],
            "quality": quality,
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == "review"
    assert reasons == ["focus_signal_unavailable"]
    assert evidence[1]["value"] == "signal unavailable"
    assert evidence[1]["confidence"] is None


def test_non_empty_subject_evidence_is_stable_and_first(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [
            {"label": "person", "confidence": 0.81},
            {"label": "person", "confidence": 0.93},
        ],
        "subjectFocus": 80,
        "quality": {
            "laplacianVariance": 80,
            "shadowClipRatio": 0,
            "highlightClipRatio": 0,
        },
    }

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("matchday-story", strategy_root)
    )

    assert disposition == "keep"
    assert reasons == []
    assert evidence[0] == {
        "label": "Allowed subjects",
        "value": "2 detected",
        "confidence": 0.93,
        "tone": "keep",
    }


def test_exposure_thresholds_are_strategy_driven(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.88}],
        "subjectFocus": 80,
        "quality": {
            "laplacianVariance": 80,
            "shadowClipRatio": 0.7,
            "highlightClipRatio": 0,
        },
    }

    disposition, reasons, _ = evaluate_strategy(
        signals, load_strategy("action-coverage", strategy_root)
    )

    assert disposition == "review"
    assert reasons == ["shadow_clipping"]


def test_esports_low_light_is_protected_when_subject_is_sharp(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.9}],
        "lowLight": True,
        "subjectFocus": 70,
        "quality": {
            "laplacianVariance": 25,
            "shadowClipRatio": 0.8,
            "highlightClipRatio": 0,
        },
    }

    disposition, reasons, _ = evaluate_strategy(
        signals, load_strategy("esports-stage", strategy_root)
    )

    assert disposition == "keep"
    assert reasons == ["low_light_protected"]


def test_missing_exposure_metrics_are_unknown_and_review(strategy_root: Path) -> None:
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.88}],
        "subjectFocus": 80,
        "quality": {"laplacianVariance": 80},
    }

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("matchday-story", strategy_root)
    )

    assert disposition == "review"
    assert reasons == ["exposure_signal_unavailable"]
    assert evidence[-1] == {
        "label": "Exposure",
        "value": "signal unavailable",
        "confidence": None,
        "tone": "neutral",
    }


@pytest.mark.parametrize(
    "quality",
    [
        {"laplacianVariance": 80, "shadowClipRatio": "bad", "highlightClipRatio": 0},
        {"laplacianVariance": 80, "shadowClipRatio": 0, "highlightClipRatio": float("nan")},
        {"laplacianVariance": 80, "shadowClipRatio": float("inf"), "highlightClipRatio": 0},
        {"laplacianVariance": 80, "shadowClipRatio": 0},
    ],
)
def test_malformed_or_partial_exposure_metrics_remain_unknown(
    strategy_root: Path, quality: dict[str, object]
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.88}],
            "subjectFocus": 80,
            "quality": quality,
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == "review"
    assert reasons == ["exposure_signal_unavailable"]
    assert evidence[-1]["value"] == "signal unavailable"
    assert evidence[-1]["confidence"] is None


def test_measured_zero_exposure_metrics_remain_usable(strategy_root: Path) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.88}],
            "subjectFocus": 80,
            "quality": {
                "laplacianVariance": 80,
                "shadowClipRatio": 0,
                "highlightClipRatio": 0,
            },
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == "keep"
    assert reasons == []
    assert evidence[-1] == {
        "label": "Exposure",
        "value": "usable",
        "confidence": 0.99,
        "tone": "keep",
    }


@pytest.mark.parametrize("field", ["shadowClipRatio", "highlightClipRatio"])
@pytest.mark.parametrize(
    "invalid_value",
    [-0.01, 1.01, float("nan"), float("inf"), "0.5", True, False],
)
def test_out_of_domain_exposure_ratios_are_unknown(
    strategy_root: Path, field: str, invalid_value: object
) -> None:
    quality: dict[str, object] = {
        "laplacianVariance": 80,
        "shadowClipRatio": 0,
        "highlightClipRatio": 0,
    }
    quality[field] = invalid_value

    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.88}],
            "subjectFocus": 80,
            "quality": quality,
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == "review"
    assert reasons == ["exposure_signal_unavailable"]
    assert evidence[-1] == {
        "label": "Exposure",
        "value": "signal unavailable",
        "confidence": None,
        "tone": "neutral",
    }


@pytest.mark.parametrize(
    ("shadow_clip", "highlight_clip", "expected_reasons", "expected_value", "confidence"),
    [
        (0, 0, [], "usable", 0.99),
        (1, 0, ["shadow_clipping"], "needs review", 0.05),
        (0, 1, ["highlight_clipping"], "needs review", 0.05),
        (1, 1, ["shadow_clipping", "highlight_clipping"], "needs review", 0.05),
    ],
)
def test_exposure_ratio_boundaries_are_valid_measurements(
    strategy_root: Path,
    shadow_clip: int,
    highlight_clip: int,
    expected_reasons: list[str],
    expected_value: str,
    confidence: float,
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.88}],
            "subjectFocus": 80,
            "quality": {
                "laplacianVariance": 80,
                "shadowClipRatio": shadow_clip,
                "highlightClipRatio": highlight_clip,
            },
        },
        load_strategy("matchday-story", strategy_root),
    )

    assert disposition == ("review" if expected_reasons else "keep")
    assert reasons == expected_reasons
    assert evidence[-1]["value"] == expected_value
    assert evidence[-1]["confidence"] == confidence


def test_generic_preset_ignores_face_capability_signals(strategy_root: Path) -> None:
    signals = _portrait_signals(faceModelStatus="unavailable", eyesOpen=False)

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("matchday-story", strategy_root)
    )

    assert disposition == "keep"
    assert reasons == []
    assert all(not item["label"].startswith("Face") for item in evidence)


def test_portrait_sharp_face_acceptance_example_keeps(strategy_root: Path) -> None:
    strategy = load_strategy("portrait", strategy_root)
    example = _acceptance_example(strategy, "sharp face")

    disposition, reasons, evidence = evaluate_strategy(_portrait_signals(), strategy)

    assert disposition == example["expected"] == "keep"
    assert reasons == []
    assert [item["label"] for item in evidence] == [
        "Allowed subjects",
        "Face capability",
        "Face size",
        "Eyes",
        "Expression",
        "Face focus",
        "Exposure",
    ]


def test_portrait_closed_eyes_follow_policy_and_cannot_keep(strategy_root: Path) -> None:
    strategy = load_strategy("portrait", strategy_root)
    example = _acceptance_example(strategy, "closed eyes")

    disposition, reasons, evidence = evaluate_strategy(
        _portrait_signals(eyesOpen=False), strategy
    )

    assert disposition == example["expected"] == strategy["signals"]["face"]["closedEyesAction"] == "review"
    assert reasons == ["eyes_closed"]
    assert next(item for item in evidence if item["label"] == "Eyes")["value"] == "closed"


def test_portrait_small_face_acceptance_example_reviews(strategy_root: Path) -> None:
    strategy = load_strategy("portrait", strategy_root)
    example = _acceptance_example(strategy, "small face")

    disposition, reasons, evidence = evaluate_strategy(
        _portrait_signals(faceSizePixels=40), strategy
    )

    assert disposition == example["expected"] == "review"
    assert example["requiredSignals"] == ["face_size"]
    assert reasons == ["face_too_small"]
    assert next(item for item in evidence if item["label"] == "Face size")["tone"] == "review"
    assert all(item["label"] not in {"Eyes", "Expression", "Face focus"} for item in evidence)


def test_portrait_environmental_context_acceptance_example_keeps(strategy_root: Path) -> None:
    strategy = load_strategy("portrait", strategy_root)
    example = next(
        item for item in strategy["acceptanceExamples"] if item["case"] == "environmental portrait"
    )

    disposition, reasons, _ = evaluate_strategy(
        {
            "readable": True,
            "detectorStatus": "ready",
            "allowedSubjects": [{"label": "person", "confidence": 0.4}],
            "protectedContexts": ["environmental portrait"],
        },
        strategy,
    )

    assert example["expected"] == "keep"
    assert disposition == "keep"
    assert reasons == ["protected_context"]


@pytest.mark.parametrize("face_status", ["unavailable", None])
def test_portrait_unavailable_or_missing_face_model_reviews(
    strategy_root: Path, face_status: str | None
) -> None:
    signals = _portrait_signals(faceModelStatus=face_status)
    strategy = load_strategy("portrait", strategy_root)
    example = _acceptance_example(strategy, "face model unavailable")

    disposition, reasons, evidence = evaluate_strategy(
        signals, strategy
    )

    assert disposition == example["expected"] == "review"
    assert reasons == ["face_model_unavailable"]
    assert next(item for item in evidence if item["label"] == "Face capability") == {
        "label": "Face capability",
        "value": "face model unavailable",
        "confidence": None,
        "tone": "neutral",
    }


@pytest.mark.parametrize(
    ("missing_key", "expected_reason", "expected_label"),
    [
        ("faceSizePixels", "face_size_unavailable", "Face size"),
        ("eyesOpen", "eyes_signal_unavailable", "Eyes"),
        ("expression", "expression_signal_unavailable", "Expression"),
        ("faceFocus", "face_focus_unavailable", "Face focus"),
    ],
)
def test_portrait_missing_required_face_observation_reviews(
    strategy_root: Path, missing_key: str, expected_reason: str, expected_label: str
) -> None:
    signals = _portrait_signals()
    signals.pop(missing_key)

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("portrait", strategy_root)
    )

    assert disposition == "review"
    assert expected_reason in reasons
    assert next(item for item in evidence if item["label"] == expected_label)["confidence"] is None


def test_portrait_unusual_expression_reviews(strategy_root: Path) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        _portrait_signals(expression="unusual"),
        load_strategy("portrait", strategy_root),
    )

    assert disposition == "review"
    assert reasons == ["expression_needs_review"]
    assert next(item for item in evidence if item["label"] == "Expression")["value"] == "unusual"


def test_portrait_face_focus_has_priority_but_sharp_subject_prevents_reject(
    strategy_root: Path,
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        _portrait_signals(faceFocus=5, subjectFocus=90),
        load_strategy("portrait", strategy_root),
    )

    assert disposition == "review"
    assert reasons == ["face_out_of_focus", "hard_reject_requirements_missing"]
    assert next(item for item in evidence if item["label"] == "Face focus")["tone"] == "reject"


def test_portrait_face_and_subject_focus_can_satisfy_hard_reject_gate(
    strategy_root: Path,
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        _portrait_signals(faceFocus=5, subjectFocus=6),
        load_strategy("portrait", strategy_root),
    )

    assert disposition == "reject"
    assert reasons == ["face_out_of_focus"]
    assert [item["label"] for item in evidence].count("Face focus") == 1
    assert [item["label"] for item in evidence].count("Subject focus") == 1


@pytest.mark.parametrize("focus_field", ["faceFocus", "subjectFocus"])
@pytest.mark.parametrize(
    "invalid_focus",
    [
        pytest.param(-1, id="negative"),
        pytest.param({"laplacianVariance": -1}, id="nested-negative"),
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="infinity"),
        pytest.param("5", id="string"),
        pytest.param(True, id="boolean"),
        pytest.param(_MISSING, id="missing"),
    ],
)
def test_portrait_invalid_focus_is_unknown_and_cannot_hard_reject(
    strategy_root: Path, focus_field: str, invalid_focus: object
) -> None:
    signals = _portrait_signals(faceFocus=0, subjectFocus=0)
    if invalid_focus is _MISSING:
        signals.pop(focus_field)
    else:
        signals[focus_field] = invalid_focus

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("portrait", strategy_root)
    )

    unavailable_reason = (
        "face_focus_unavailable"
        if focus_field == "faceFocus"
        else "subject_focus_unavailable"
    )
    unavailable_label = "Face focus" if focus_field == "faceFocus" else "Subject focus"
    assert disposition == "review"
    assert unavailable_reason in reasons
    assert reasons[-1] == "hard_reject_requirements_missing"
    assert next(item for item in evidence if item["label"] == unavailable_label) == {
        "label": unavailable_label,
        "value": "signal unavailable",
        "confidence": None,
        "tone": "neutral",
    }


def test_portrait_zero_face_and_subject_focus_are_valid_hard_reject_measurements(
    strategy_root: Path,
) -> None:
    disposition, reasons, evidence = evaluate_strategy(
        _portrait_signals(faceFocus=0, subjectFocus=0),
        load_strategy("portrait", strategy_root),
    )

    assert disposition == "reject"
    assert reasons == ["face_out_of_focus"]
    assert next(item for item in evidence if item["label"] == "Face focus")["value"] == "0.0"
    assert next(item for item in evidence if item["label"] == "Subject focus")["value"] == "0.0"


@pytest.mark.parametrize(
    ("overrides", "capability_reason"),
    [
        ({"faceModelStatus": "unavailable"}, "face_model_unavailable"),
        ({"faceModelStatus": None}, "face_model_unavailable"),
        ({"faceSizePixels": 40}, "face_too_small"),
    ],
)
def test_untrusted_raw_face_focus_cannot_satisfy_portrait_hard_reject(
    strategy_root: Path,
    overrides: dict[str, object],
    capability_reason: str,
) -> None:
    signals = _portrait_signals(faceFocus=5, subjectFocus=6, **overrides)

    disposition, reasons, evidence = evaluate_strategy(
        signals, load_strategy("portrait", strategy_root)
    )

    assert disposition == "review"
    assert reasons[0] == capability_reason
    assert "subject_out_of_focus" in reasons
    assert reasons[-1] == "hard_reject_requirements_missing"
    assert all(item["label"] != "Face focus" for item in evidence)


@pytest.mark.parametrize(
    ("path", "unsafe_value"),
    [
        (("decisionPolicy", "humanDecisionWins"), False),
        (("decisionPolicy", "ambiguousAction"), "reject"),
        (("fallbackPolicy", "rawUploadAllowed"), True),
    ],
)
def test_evaluator_refuses_unsafe_strategy_invariants(
    strategy_root: Path, path: tuple[str, str], unsafe_value: object
) -> None:
    strategy = load_strategy("matchday-story", strategy_root)
    strategy[path[0]][path[1]] = unsafe_value

    with pytest.raises(ValueError, match="unsafe strategy invariant"):
        evaluate_strategy(
            {
                "readable": True,
                "detectorStatus": "ready",
                "allowedSubjects": [{"label": "person"}],
            },
            strategy,
        )


def test_evaluation_is_deterministic(strategy_root: Path) -> None:
    strategy = load_strategy("esports-stage", strategy_root)
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [{"label": "person", "confidence": 0.87}],
        "subjectFocus": 18,
        "quality": {
            "laplacianVariance": 12,
            "shadowClipRatio": 0.1,
            "highlightClipRatio": 0.4,
        },
    }

    first = evaluate_strategy(signals, strategy)
    second = evaluate_strategy(deepcopy(signals), deepcopy(strategy))

    assert first == second


def test_unknown_preset_is_rejected_without_path_fallback(strategy_root: Path) -> None:
    with pytest.raises(ValueError, match="unknown strategy preset"):
        load_strategy("../action-coverage", strategy_root)


def test_policy_protocol_fails_unknown_strategy_closed_to_review() -> None:
    result = handle_request(
        {
            "command": "evaluate",
            "preset": "not-a-strategy",
            "signals": {"readable": True, "detections": []},
        }
    )

    assert result["strategyId"] == "not-a-strategy"
    assert result["strategyVersion"] == 0
    assert result["aiDisposition"] == "review"
    assert result["reasons"] == ["strategy_unavailable"]


def test_policy_protocol_does_not_trust_an_external_observation_only_marker() -> None:
    result = handle_request(
        {
            "command": "evaluate",
            "preset": "motorsport",
            "signals": {
                "readable": True,
                "detectorStatus": "ready",
                "allowedSubjects": [{"label": "car", "confidence": 0.94}],
                "observationOnly": True,
            },
        }
    )

    assert result["aiDisposition"] == "review"
    assert "focus_signal_unavailable" in result["reasons"]


def test_cloud_composition_observation_contributes_to_ranking_without_deciding() -> None:
    result = handle_request(
        {
            "command": "evaluate",
            "preset": "matchday-story",
            "signals": {
                "readable": True,
                "detections": [{"label": "person", "confidence": 0.96}],
                "subjectFocus": 82,
                "quality": {
                    "laplacianVariance": 80,
                    "shadowClipRatio": 0.05,
                    "highlightClipRatio": 0.02,
                },
                "compositionScore": 0.91,
                "compositionIssues": ["centered-subject"],
            },
        }
    )

    composition = next(item for item in result["evidence"] if item["label"] == "Composition")
    assert composition == {
        "label": "Composition",
        "value": "91%",
        "confidence": 0.91,
        "tone": "keep",
    }
    assert "composition:centered-subject" in result["tags"]
