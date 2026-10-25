# Task 5 Final Collection Review Package

## Report

# Task 5 Report

## Status

DONE_WITH_CONCERNS

Task 5 now provides the four binding strategy presets, a deterministic Python loader/evaluator, the existing policy adapter, schema contract coverage, and focused false-reject safety tests. No model was loaded, no photo or RAW file was read or written, no cloud or persistence path was added, no dependency was introduced, and no Git operation was run.

## Checkpoint Files

- `strategies/action-coverage.strategy.json` (new)
- `strategies/matchday-story.strategy.json` (new)
- `strategies/motorsport.strategy.json` (new)
- `strategies/esports-stage.strategy.json` (new)
- `apps/ai-worker/src/framescout_ai/strategy.py` (new)
- `apps/ai-worker/src/framescout_ai/policy.py`
- `apps/ai-worker/tests/test_strategy.py` (new)
- `tests/contracts/reviewStrategySchema.test.ts`
- `.superpowers/sdd/task-5-report.md` (new)

The pre-existing `review-strategy.schema.json`, `base.strategy.json`, and `portrait.strategy.json` remain byte-identical to their Task 5 before-snapshots.

## Implementation

- Added the exact six-preset `STRATEGY_FILES` allowlist, including `custom -> base.strategy.json`; unknown presets cannot become paths.
- Added runtime enforcement for `humanDecisionWins: true`, `ambiguousAction: review`, and `rawUploadAllowed: false`.
- Evaluates in a deterministic order: unreadable proxy, detector capability, strategy-specific protected context, empty-subject policy, then strategy threshold rules.
- Detector status other than `ready` always returns `review` with `subject_detector_unavailable`; it never fabricates `no_allowed_subject`.
- Protected contexts are intersected with the active strategy, so `venue` is protected for Matchday Story but not Portrait.
- Subject focus takes priority over global focus. Motorsport intentional motion and esports low light are protected when their configured supporting evidence is present.
- Every proposed quality or empty-subject `reject` passes through `hardRejectRequires`; missing prerequisites deterministically downgrade it to `review` with explicit evidence.
- Added a dependency-free validator for every JSON Schema keyword currently used by `review-strategy.schema.json`.

## RED Evidence

Exact Python RED command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: collection ERROR with `ModuleNotFoundError: No module named 'framescout_ai.strategy'` (1 collection error), proving the new evaluator tests failed before implementation.

Exact contract RED command:

```text
npm run test:contracts -- reviewStrategySchema.test.ts
```

Result after correcting a test-only missing `boolean` validator branch: FAIL with 5 failed and 21 passed. All five failures were the missing four catalog files: one complete-catalog assertion and four binding preset-mapping assertions. Existing base and portrait strategies already passed schema validation.

## GREEN Evidence

Focused Python command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: PASS, 12/12 tests.

Exact contract command:

```text
npm run test:contracts -- reviewStrategySchema.test.ts
```

Result: PASS, 4/4 files and 34/34 tests. `reviewStrategySchema.test.ts` contributed 18 passing cases across all six strategies.

Exact full AI command:

```text
npm run test:ai
```

Result: PASS, 16/16 tests.

## Self-Review

- Exact allowed-subject and protected-context arrays match the binding Task 5 table.
- Action Coverage rejects an empty frame only with a readable proxy, ready detector, confirmed zero subjects, and sharp global frame.
- Matchday, Motorsport, and Esports empty frames remain `review`; configured protected contexts return `keep`.
- A panned race car and a sharp low-light esports subject are protected from false rejection.
- Hard-reject prerequisites are checked in configured order, and evidence/reason order is stable across identical inputs.
- AI output remains a separate tuple and has no write path to human decisions, manual tags, source files, RAW files, cloud services, or persistence.
- No files outside the assigned Task 5 implementation, tests, four strategies, and this report were edited.

## Concerns

- Focus and exposure thresholds are conservative seed values and still require camera, ISO, subject-size, event, and photographer calibration on a licensed local evaluation corpus before production hard rejects are enabled broadly.
- The compatibility `policy.decide` adapter loads its small strategy JSON on each call. A later worker integration should load the selected strategy once per analysis run after profiling, while preserving the pure evaluator and immutable run configuration.

## Review Fix

### Status

REVIEW_FINDINGS_RESOLVED

All three findings from `task-5-review.md` were repaired within Task 5 files. No photo, RAW, model, provider, cloud, persistence, dependency, runtime service, or Git path was added or changed.

### Exact Changes

- `apps/ai-worker/src/framescout_ai/strategy.py` now consumes normalized Portrait observations only when `signals.face.mode != off`: `faceModelStatus`, `faceSizePixels`, `eyesOpen`, `expression`, `faceFocus`, and `subjectFocus`.
- Missing or unavailable face capability, undersized faces, missing eye/expression/focus observations, closed eyes, and unusual expression deterministically produce stable reasons and evidence. Generic presets with face mode `off` ignore these inputs.
- Focus selection follows each strategy's `regionPriority`. Portrait uses valid face focus before subject/global focus; a sharp subject prevents a face-only hard reject, while explicit unusable face and subject focus can satisfy the configured all-key gate.
- `strategies/portrait.strategy.json` now uses readable/ready/face-and-subject evidence for quality hard rejects. Its environmental-context example expects the binding protected-context `keep`, and its small-face example requires only the measured `face_size` signal.
- Every non-empty allowed-subject result now begins with deterministic `Allowed subjects` evidence containing count, maximum available confidence, and `keep` tone, restoring prior policy compatibility.
- Exposure metrics preserve missing, malformed, partial, NaN, and infinity as unknown. Unknown exposure returns `review`, `exposure_signal_unavailable`, null confidence, and neutral capability evidence. Genuine measured zero clipping remains distinct and produces usable exposure evidence.
- `apps/ai-worker/tests/test_strategy.py` now executes all five Portrait acceptance examples and covers ready/unavailable/missing face capability, minimum face size, open/closed/missing eyes, usable/unusual/missing expression, face/subject focus priority and gating, generic-preset isolation, subject evidence shape, intentional-motion evidence, and missing/malformed/non-finite/zero exposure branches.

### TDD Evidence

Initial focused RED command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: FAIL, 20 failed and 13 passed. Failures reproduced all three review findings. The first implementation run then exposed a misplaced `_subject_evidence` return (26 failed, 7 passed); restoring that return isolated and cleared the intended behavior tests.

Acceptance-contract RED command after the evaluator was GREEN:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: FAIL, 1 failed and 32 passed. The remaining failure proved Portrait's small-face example still declared unsupported `face_model_skipped` evidence. Updating it to measured `face_size` made the example executable.

Focused GREEN command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: PASS, 33/33 tests.

Full AI GREEN command:

```text
npm run test:ai
```

Result: PASS, 37/37 tests.

Contract GREEN command:

```text
npm run test:contracts -- reviewStrategySchema.test.ts
```

Result: PASS, 4/4 files and 34/34 tests; the strategy contract file contributed 18 passing cases.

### Review-Fix Self-Review

- Detector-unavailable ordering and exact review evidence remain unchanged.
- Protected contexts still intersect per strategy and return in strategy order.
- Motorsport intentional-motion and esports low-light protections remain intact.
- Empty-subject and quality rejects still require every configured hard-reject key.
- Subject evidence is emitted before face, focus, and exposure evidence in stable order.
- Missing capability never fabricates a zero detection, open eyes, usable expression, focus value, zero clipping, or high-confidence keep evidence.
- Existing threshold calibration remains the only production concern. The review measured per-call strategy loading as non-blocking; loading once per immutable analysis run remains an optional later cleanup rather than a Task 5 defect.

## Second Review Fix

### Status

SECOND_REVIEW_FINDINGS_RESOLVED

Both safety paths from the second Task 5 re-review were repaired within `strategy.py`, `test_strategy.py`, and this report. No strategy mapping, photo, RAW, model, provider, cloud, persistence, dependency, runtime service, or Git scope changed.

### Exact Changes

- Hard-reject gating no longer imports arbitrary top-level `True` signal keys or re-parses raw face/subject focus values.
- Quality evaluation now produces an internal `validated_requirements` set. `face_and_subject_unusable` enters that set only when face capability is ready, face size meets `minimumFacePixels`, and both finite face and subject focus measurements are below the active reject threshold.
- Missing/unavailable face capability and undersized faces can still evaluate trusted subject focus for review evidence, but their raw `faceFocus` is ignored and cannot satisfy any reject prerequisite.
- A trusted joint-focus hard reject now emits deterministic Face focus and Subject focus evidence rows so every contributing measurement is visible.
- Added `_ratio_metric`, which accepts only non-boolean finite numbers in the inclusive range `[0, 1]`. Negative, greater-than-one, NaN, infinity, string, boolean, missing, and partial clipping inputs all use the existing conservative unknown-exposure path.
- Numeric boundary values `0` and `1` remain valid measurements. Zero clipping can keep with measured confidence; ratio one produces clipping review evidence with bounded confidence.

### TDD Evidence

Focused RED command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: FAIL, 8 failed and 46 passed. Failures reproduced unavailable, missing, and undersized face capability leaking into hard reject; absent joint Subject focus evidence; and negative/greater-than-one exposure ratios being treated as measured values.

Focused GREEN command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: PASS, 54/54 tests.

Full AI GREEN command:

```text
npm run test:ai
```

Result: PASS, 58/58 tests.

Contract GREEN command:

```text
npm run test:contracts -- reviewStrategySchema.test.ts
```

Result: PASS, 4/4 files and 34/34 tests; `reviewStrategySchema.test.ts` contributed 18 passing cases.

### Second-Fix Self-Review

- Three low raw face/subject-focus regressions prove unavailable, missing, and undersized face capability remain `review` and emit no Face focus evidence.
- A valid ready/large-face joint-focus case still hard rejects and now exposes both contributing focus measurements.
- Both exposure fields are tested against negative, greater-than-one, NaN, infinity, string, `True`, and `False` values.
- All four numeric `0`/`1` boundary combinations are tested as valid measurements.
- Detector fallback, context ordering, subject evidence, intentional motion, low light, human-decision/raw-upload invariants, and all-key hard-reject ordering remain covered and unchanged.

## Final Input Trust Fix

### Status

FINAL_REVIEW_FINDING_RESOLVED

The remaining negative-focus trust-boundary finding is repaired within `strategy.py`, `test_strategy.py`, and this report. No strategy mapping, face capability policy, motion/context protection, photo, RAW, model, provider, cloud, persistence, dependency, runtime service, or Git scope changed.

### Exact Changes

- Added one reusable `_numeric_observation` validator for numeric signal trust. It accepts only non-boolean finite integers/floats and applies explicit inclusive domain bounds supplied by each observation type.
- Scalar and nested `faceFocus`, `subjectFocus`, and quality `laplacianVariance` observations all use the same focus path with a minimum of `0`. Negative, NaN, infinity, string, boolean, and missing values are unavailable rather than measured failures.
- Exposure clipping observations use the same validator with the inclusive `[0, 1]` ratio domain; the prior ratio behavior and `0`/`1` boundaries remain unchanged.
- Face evaluation returns the validated focus value instead of a boolean availability sentinel, so the hard-reject prerequisite consumes the exact trusted observation and never re-parses raw face input.
- Invalid or missing focus emits neutral unknown evidence. Portrait also emits `subject_focus_unavailable` evidence when a valid fallback focus exists but the subject observation needed for joint rejection is unavailable.
- `face_and_subject_unusable` is still added only when both validated nonnegative face and subject observations are below the active reject threshold. Valid zero remains a measured value and can satisfy Matchday and Portrait hard-reject gates.

### TDD Evidence

Focused RED command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: FAIL, 12 failed and 72 passed. The failures reproduced scalar and nested negative subject/face hard rejects, negative quality focus being treated as measured, and missing unknown evidence for invalid Portrait subject focus.

Focused GREEN command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: PASS, 84/84 tests.

Full AI GREEN command:

```text
npm run test:ai
```

Result: PASS, 88/88 tests.

Contract GREEN command:

```text
npm run test:contracts
```

Result: PASS, 4/4 files and 34/34 tests.

### Final Self-Review

- Parameterized Matchday and Portrait coverage includes negative scalar and nested focus values, NaN, infinity, strings, booleans, missing observations, and valid zero boundaries for subject and face focus.
- Invalid focus values cannot add `subject_out_of_focus`, `face_out_of_focus`, or `face_and_subject_unusable` from the invalid observation and cannot satisfy `hardRejectRequires`.
- Quality/global focus uses the same nonnegative validator and unknown-evidence path as face and subject focus.
- Detector ordering, face capability trust, protected contexts, Motorsport intentional motion, Esports low-light protection, exposure behavior, evidence ordering for valid inputs, and deterministic evaluation remain covered by the passing suites.
- Threshold calibration on a licensed local evaluation corpus remains the only production concern.

## Final Collection Trust Fix

### Status

FINAL_COLLECTION_TRUST_FIX_RESOLVED

The final allowed-subject collection trust finding is repaired within `strategy.py`, `policy.py`, the AI tests, and this report. No strategy mapping, numeric threshold, face policy, motion/context protection, photo, RAW, model, provider, cloud, persistence, dependency, runtime service, or Git scope changed.

### Exact Changes

- Added one `_normalize_allowed_subjects` boundary in `strategy.py`. Only an explicitly supplied list or tuple whose every entry has a nonblank string label and a finite numeric confidence in `[0, 1]` is known.
- Optional detector fields are validated when present: `class_id` must be a non-boolean nonnegative integer, and `box` must contain four finite nonnegative coordinates in non-reversed order. Any malformed element invalidates the entire collection instead of preserving a trusted subset.
- Missing, `None`, mapping, string, scalar, malformed-element, invalid-field, and mixed valid/malformed collections now return `review` with `allowed_subject_signal_unavailable` and one neutral `Allowed subjects: signal unavailable` evidence row. This check occurs before protected-context, no-subject, focus, exposure, and hard-reject evaluation.
- Valid empty list and tuple collections are the only confirmed zero observations. They retain each preset's configured no-subject action and emit measured count `0` with unknown confidence rather than the prior synthetic `1.0` sentinel.
- Valid non-empty collections are normalized once and reused by subject evidence, quality evaluation, and hard-reject requirement checks. Evidence count is the actual normalized collection length and confidence is the maximum real observation confidence.
- The compatibility policy adapter now preserves `subjects=None`; it no longer coerces missing subject output into `[]` for a ready detector.
- Added parameterized Action Coverage and Matchday coverage for 24 unknown collection/element/field shapes, valid empty list/tuple controls, valid non-empty list/tuple controls including the worker detection shape, and a ready-detector adapter regression.

### TDD Evidence

Focused RED command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: FAIL, 52 failed and 86 passed. Forty-eight failures reproduced unknown collections entering empty/context/quality paths, and four valid-empty controls exposed synthetic `1.0` confidence.

Adapter RED command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_quality.py::test_ready_detector_with_missing_subject_result_remains_unknown -q
```

Result: FAIL, 1 failed. `subjects=None` became `no_allowed_subject` plus hard-reject gate evidence.

Focused GREEN command:

```text
apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q
```

Result: PASS, 138/138 tests.

Full AI GREEN command:

```text
npm run test:ai
```

Result: PASS, 143/143 tests.

Contract GREEN command:

```text
npm run test:contracts
```

Result: PASS, 4/4 files and 34/34 tests; `reviewStrategySchema.test.ts` contributed 18 passing cases.

### Final Collection Self-Review

- Detector-unavailable and unreadable-preview precedence remain unchanged.
- A ready detector with unknown subject output cannot reach protected-context keep, no-subject policy, quality rejection, or the hard-reject gate.
- Confirmed empty results still follow preset policy and can hard reject only when all existing readable/ready/sharp requirements are satisfied.
- Numeric focus and clipping validation, face capability provenance, protected contexts for known collections, Motorsport intentional motion, Esports low-light protection, evidence ordering, safety invariants, and fixed-input determinism remain covered by passing tests.
- Threshold calibration on a licensed local evaluation corpus remains a production concern. Contract verification also continues to print the existing Vite CJS deprecation warning without test failures.

## Current: apps/ai-worker/src/framescout_ai/strategy.py
```
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
```

## Current: apps/ai-worker/src/framescout_ai/policy.py
```
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
```

## Current: apps/ai-worker/tests/test_strategy.py
```
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from framescout_ai.strategy import evaluate_strategy, load_strategy


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
```

## Current: apps/ai-worker/tests/test_quality.py
```
from pathlib import Path

import numpy as np
from PIL import Image

from framescout_ai.detector import _decode_yolox
from framescout_ai.policy import decide
from framescout_ai.quality import load_proxy, measure_quality
from framescout_ai.worker import allowed_subject_labels


def test_quality_pipeline_reads_without_mutating_source(tmp_path: Path) -> None:
    path = tmp_path / "proxy.jpg"
    Image.new("RGB", (120, 80), (128, 128, 128)).save(path)
    before = path.read_bytes()

    quality = measure_quality(load_proxy(path))

    assert quality.width == 120
    assert quality.height == 80
    assert path.read_bytes() == before


def test_missing_detector_never_infers_empty_frame() -> None:
    quality = measure_quality(Image.new("RGB", (120, 80), (128, 128, 128)))
    disposition, reasons, evidence = decide(
        quality,
        subjects=None,
        subject_focus=None,
        preset="action-coverage",
        detector_status="unavailable",
    )

    assert "no_allowed_subject" not in reasons
    assert "subject_detector_unavailable" in reasons
    assert disposition in {"keep", "review"}
    assert any(item["value"] == "detector unavailable" for item in evidence)


def test_ready_detector_with_missing_subject_result_remains_unknown() -> None:
    quality = measure_quality(Image.new("RGB", (120, 80), (128, 128, 128)))

    disposition, reasons, evidence = decide(
        quality,
        subjects=None,
        subject_focus=None,
        preset="action-coverage",
        detector_status="ready",
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


def test_motorsport_allows_vehicles_as_subjects() -> None:
    assert allowed_subject_labels("motorsport") == {"person", "car", "motorcycle", "bus", "truck"}
    assert allowed_subject_labels("matchday-story") == {"person"}
    assert allowed_subject_labels("portrait") == {"person"}


def test_yolox_output_is_decoded_to_input_pixel_coordinates() -> None:
    prediction = np.zeros((3549, 85), dtype=np.float32)
    decoded = _decode_yolox(prediction, (416, 416))

    assert decoded.shape == prediction.shape
    assert decoded[1, 0] == 8
    assert decoded[0, 2] == 8
```
