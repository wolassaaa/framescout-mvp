# Task 6 Brief

## Global Constraints

- Browser-first UI remains at `http://127.0.0.1:5173/`; Rust remains a localhost terminal service.
- `全选` changes only the temporary marked-ID set. It never changes `humanDisposition`, tags, files, or AI results.
- Selection scope is every asset in the current logical session/filter result, including assets beyond the 240 rendered thumbnails.
- AI never overwrites a human disposition or manual tag.
- Missing model capability becomes `review`, never a fabricated zero detection or hard reject.
- Source photos and RAW files remain read-only; cloud providers receive only generated proxies after explicit configuration.
- Machine tag keys remain stable English identifiers; Chinese is the default display language and English remains complete.
- No new frontend state-management or localization dependency is introduced.
- The workspace has no `.git` directory. Do not initialize one; replace commit steps with explicit checkpoint file lists.


### Task 6: Worker and Cloud Providers Emit Standard Signals

**Files:**
- Modify: `apps/ai-worker/src/framescout_ai/worker.py`
- Modify: `apps/ai-worker/src/framescout_ai/strategy.py`
- Modify: `apps/local-service/src/main.rs`
- Test: `apps/ai-worker/tests/test_quality.py`
- Test: `apps/ai-worker/tests/test_strategy.py`
- Test: Rust unit tests in `apps/local-service/src/main.rs`

**Interfaces:**
- Local worker response adds `strategyId` and `strategyVersion`.
- Cloud providers return normalized observations only.
- The Python worker accepts an `evaluate` request containing `preset` and normalized `signals`; both local and cloud paths use this request before persistence.
- Policy-only worker mode loads strategy files but does not initialize ONNX/CUDA perception models.

- [ ] **Step 1: Write failing provider tests**

Python assertion:

```py
result = analyzer.analyze(str(proxy), "motorsport")
assert result["strategyId"] == "motorsport"
assert "detections" in result["signals"]
assert result["aiDisposition"] in {"keep", "review", "reject"}
```

Rust prompt assertion:

```rs
#[test]
fn cloud_prompt_requests_observations_not_an_unchecked_verdict() {
    let prompt = cloud_analysis_prompt("motorsport", "motorsport", 1);
    assert!(prompt.contains("visual observations"));
    assert!(!prompt.contains("decide the final human selection"));
}
```

Python policy-only assertion:

```py
response = handle_request({
    "command": "evaluate",
    "preset": "motorsport",
    "signals": {"readable": True, "detections": [{"label": "car", "confidence": 0.94}]},
})
assert response["strategyId"] == "motorsport"
assert response["aiDisposition"] == "keep"
assert detector_factory_calls == 0
```

- [ ] **Step 2: Verify RED**

Run focused Python and Rust tests.  
Expected: FAIL because provenance and prompt helper do not exist.

- [ ] **Step 3: Route local signals through the evaluator**

In `Analyzer.analyze`, create the standard signal dictionary first, load the selected strategy, call `evaluate_strategy`, and return:

```py
return {
    "modelBundleVersion": self.model_bundle_version,
    "backend": self.detector.provider if self.detector else "cpu",
    "strategyId": strategy["id"],
    "strategyVersion": strategy["version"],
    "aiDisposition": disposition,
    "reasons": reasons,
    "tags": normalized_tags(signals),
    "evidence": evidence,
    "signals": signals,
}
```

- [ ] **Step 4: Add the shared policy-only worker request**

Add an `evaluate` command to the existing newline-delimited worker protocol:

```json
{"command":"evaluate","preset":"motorsport","signals":{"readable":true,"detections":[]}}
```

It returns `strategyId`, `strategyVersion`, `aiDisposition`, `reasons`, `tags`, and evidence. Start this protocol in policy-only mode for cloud runs so it loads strategy JSON but never loads ONNX Runtime, CUDA, or image pixels. Local analysis calls the same `evaluate_strategy` function in-process after perception.

- [ ] **Step 5: Restrict cloud prompting to observations**

The prompt must request concrete subjects, objects, contexts, image readability, intentional motion cues, and confidence. It must not ask the cloud provider for a final keep/review/reject decision. Rust validates the JSON shape, converts it to normalized `signals`, then sends one `evaluate` request to the long-lived policy-only Python worker. Invalid provider JSON, missing observations, worker failure, or unknown strategy produces `review`, never `reject`.

- [ ] **Step 6: Verify GREEN**

Run focused Python/Rust tests, then `npm run test:ai` and `cargo test -p framescout-local-service -- --skip local_ai_analysis_persists_evidence_without_mutating_proxy`.

Expected: PASS without network calls or source writes.

- [ ] **Step 7: Checkpoint**

Record worker, service, and provider test changes.

---


## Execution Contract
Read AGENTS.md and master spec. Follow TDD. Preserve Tasks 1-5. No network calls, no cloud calls, no photos/RAW writes, no model initialization in policy-only mode, no Git. Use apply_patch. Write `.superpowers/sdd/task-6-report.md` with RED/GREEN commands, changed files, test counts, and concerns.
