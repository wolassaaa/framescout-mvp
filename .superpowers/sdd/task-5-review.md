# Task 5 Final Collection-Trust Independent Re-review

## Verdicts

- Spec compliance: **APPROVED**
- Code quality: **APPROVED**

## Findings

No blocking, important, or minor findings.

## Collection Trust Verification

- `strategy.py:91-137` is the single allowed-subject observation boundary. It accepts only list/tuple collections whose every entry has a nonblank string label and a finite non-boolean confidence in `[0,1]`; optional `class_id` and `box` fields are likewise validated. One malformed entry invalidates the complete collection.
- `strategy.py:562-570` executes detector capability first, then returns the stable conservative `review/allowed_subject_signal_unavailable` result for missing, `None`, scalar, mapping, string, or malformed collections. Those inputs cannot reach protected-context keep, confirmed-empty handling, quality evaluation, or hard-reject gating.
- Only valid empty list/tuple observations reach `strategy.py:583-591`. Their evidence is actual count `0` with `None` confidence (`strategy.py:166-177`), not a fabricated certainty. Valid nonempty list/tuple observations produce deterministic actual count and maximum observed confidence.
- `policy.py:24-42` preserves `subjects=None` exactly. There is no remaining `subjects or []`-style coercion at the policy-to-evaluator boundary. The worker also passes `None` for an unavailable detector (`worker.py:63-69`).

## Prior Safety Guarantees

- Numeric inputs flow through `_numeric_observation` (`strategy.py:44-88`): focus requires finite non-boolean values `>= 0`; clipping ratios additionally require `[0,1]`. Invalid observations become unknown and cannot satisfy `face_and_subject_unusable` (`strategy.py:379-389`) or any hard-reject requirement.
- Face capability, size, eyes, expression, and focus use conservative review paths (`strategy.py:194-297`). Unavailable or undersized face data cannot supply trusted face focus.
- Detector-unavailable ordering remains an immediate review (`strategy.py:562-563`); protected contexts remain strategy-intersected and deterministic (`strategy.py:572-581`); intentional-motion and low-light coercions can only protect, never create a reject (`strategy.py:425-427`, `507-512`).
- All-key hard-reject gating still downgrades deterministically with explicit evidence (`strategy.py:328-359`). Schema/runtime invariants, fixed preset mapping, five acceptance examples per strategy, evidence order, and fixed-input determinism remain intact.

## Evidence

Recorded evidence was accepted without rerunning, as requested: strategy `138/138`, full AI `143/143`, and contracts `34/34`. The current test matrix directly covers unknown collection forms across Action Coverage and Matchday, valid empty list/tuple controls, valid nonempty list/tuple evidence, and the ready-detector adapter regression (`test_strategy.py:89-254`, `test_quality.py:40-60`).

Per-call strategy JSON loading remains a non-blocking performance cleanup, not a current behavior or correctness defect. Threshold calibration remains appropriately conservative and should be validated on a licensed local corpus before broad production hard rejects.
