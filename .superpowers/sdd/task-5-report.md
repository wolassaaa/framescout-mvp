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
