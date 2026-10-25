# Task 6 Report

## Status

Implemented. Local and cloud perception now produce standard signals that are evaluated by the Python strategy policy before persistence. Cloud providers are asked for normalized visual observations only, and Rust does not author a final AI disposition.

## Behavior Delivered

- Local `Analyzer.analyze` returns `strategyId`, `strategyVersion`, `aiDisposition`, reasons, normalized tags, evidence, and standard signals.
- The newline-delimited worker protocol accepts `evaluate` requests with `preset` and normalized `signals`.
- `--policy-only serve` loads strategy JSON without constructing `Analyzer`, ONNX Runtime, CUDA, a detector, or image pixels.
- Raw detections are filtered against the selected strategy in Python. An unavailable detector remains unavailable and can never become a confirmed empty frame.
- Unknown strategies and invalid policy inputs resolve in Python to `review` with explicit evidence.
- Cloud prompts request only readability, subjects, objects, contexts, intentional-motion cues, and confidence values.
- Rust validates an exact `visualObservations` JSON shape, normalizes labels and confidences, and rejects provider-authored decision fields.
- Invalid/missing provider observations and provider request failures become unavailable signals that Python evaluates to `review`.
- Cloud runs use one long-lived policy-only Python worker. A Python-authored review fallback is cached before provider work and reused if that worker later fails.
- Persistence rejects missing or invalid evaluator dispositions instead of inventing a Rust-side default.
- Human dispositions and manual tags are not updated by AI persistence; only AI dispositions and AI-source tags are replaced.

## RED Evidence

- Focused Python protocol/provenance tests initially failed with three missing `strategyId`/`handle_request` behaviors.
- Rust cloud tests initially failed to compile because `cloud_analysis_prompt`, `parse_cloud_observations`, `cloud_signals_or_unavailable`, and `policy_evaluation_request` did not exist.
- The unavailable-detector regression failed because local empty detections incorrectly became `no_allowed_subject`.
- The strict provider-schema regression failed because extra provider decision fields were accepted.
- The untrusted observation-only marker test failed with `keep` instead of `review`.
- The persistence and worker-fallback tests initially failed because their fail-closed helpers did not exist.

## GREEN Evidence

```text
Focused Python Task 6 tests
5 passed in 0.16s

cargo test -p framescout-local-service cloud_ -- --nocapture
6 passed; 0 failed

cargo test -p framescout-local-service policy_worker_failure_uses_a_python_evaluated_fallback -- --nocapture
1 passed; 0 failed

npm run test:ai
148 passed in 0.32s

cargo test -p framescout-local-service -- --skip local_ai_analysis_persists_evidence_without_mutating_proxy
13 passed; 0 failed; 1 filtered out

cargo fmt -p framescout-local-service -- --check
passed
```

Policy-only subprocess smoke check used a nonexistent model path and returned:

```text
policyOnly=true; detector.status=not-initialized
strategyId=motorsport; strategyVersion=1; aiDisposition=keep
```

## Checkpoint Files

- `apps/ai-worker/src/framescout_ai/worker.py`
- `apps/ai-worker/src/framescout_ai/strategy.py`
- `apps/ai-worker/tests/test_quality.py`
- `apps/ai-worker/tests/test_strategy.py`
- `apps/local-service/src/main.rs`
- `.superpowers/sdd/task-6-report.md`

## Safety Checks

- No network or cloud API calls were executed.
- No source photos or RAW files were used or written.
- The cloud proxy safety test confirms generated JPEG re-encoding does not mutate its synthetic input.
- No dependency changes and no Git operations were performed.

## Concerns

- The live cloud HTTP/provider path was not exercised because Task 6 explicitly forbids network/API calls. Its prompt, schema normalization, fallback, and evaluator routing are covered with local unit tests.
- The model-backed local integration test remains excluded by the required command because it needs the local ONNX bundle and a photo fixture. Policy-only startup was independently smoke-tested with a nonexistent model path to prove model initialization is bypassed.
