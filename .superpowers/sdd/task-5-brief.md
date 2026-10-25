# Task 5 Brief

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


### Task 5: Strategy Catalog and Deterministic Python Evaluator

**Files:**
- Create the four strategy JSON files listed above.
- Create: `apps/ai-worker/src/framescout_ai/strategy.py`
- Modify: `apps/ai-worker/src/framescout_ai/policy.py`
- Test: `apps/ai-worker/tests/test_strategy.py`
- Test: `tests/contracts/reviewStrategySchema.test.ts`

**Interfaces:**
- `load_strategy(preset: str, strategy_root: Path) -> dict[str, Any]`.
- `evaluate_strategy(signals: dict[str, Any], strategy: dict[str, Any]) -> tuple[str, list[str], list[dict[str, Any]]]`.

- [ ] **Step 1: Write failing policy tests**

```py
def test_same_empty_scene_depends_on_strategy(strategy_root):
    signals = {
        "readable": True,
        "detectorStatus": "ready",
        "allowedSubjects": [],
        "protectedContexts": ["venue"],
        "subjectFocus": None,
        "quality": {"laplacianVariance": 100, "shadowClipRatio": 0, "highlightClipRatio": 0}
    }
    matchday = load_strategy("matchday-story", strategy_root)
    portrait = load_strategy("portrait", strategy_root)
    assert evaluate_strategy(signals, matchday)[0] == "keep"
    assert evaluate_strategy(signals, portrait)[0] in {"review", "reject"}

def test_missing_detector_can_never_hard_reject(strategy_root):
    signals = {"readable": True, "detectorStatus": "unavailable", "allowedSubjects": []}
    strategy = load_strategy("action-coverage", strategy_root)
    disposition, reasons, _ = evaluate_strategy(signals, strategy)
    assert disposition == "review"
    assert "subject_detector_unavailable" in reasons
```

- [ ] **Step 2: Verify RED**

Run: `apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q`  
Expected: FAIL because `framescout_ai.strategy` does not exist.

- [ ] **Step 3: Create exact preset mappings**

```py
STRATEGY_FILES = {
    "action-coverage": "action-coverage.strategy.json",
    "matchday-story": "matchday-story.strategy.json",
    "motorsport": "motorsport.strategy.json",
    "esports-stage": "esports-stage.strategy.json",
    "portrait": "portrait.strategy.json",
    "custom": "base.strategy.json",
}
```

Strategy-specific values:

| Preset | Allowed subjects | Protected contexts | No subject | Intentional motion |
|---|---|---|---|---|
| action-coverage | person | none | reject only with working detector plus readable sharp frame | false |
| matchday-story | person | crowd, venue, trophy | review; keep protected context | false |
| motorsport | person, car, motorcycle, bus, truck | pit, track, crowd | review | true |
| esports-stage | person, tv, laptop | stage, screen, crowd, trophy | review; keep protected context | false |

Each JSON must validate against `review-strategy.schema.json`, keep `humanDecisionWins: true`, `ambiguousAction: review`, `rawUploadAllowed: false`, and include five concrete acceptance examples.

- [ ] **Step 4: Implement deterministic evaluation**

```py
def evaluate_strategy(signals, strategy):
    if not signals.get("readable", True):
        return strategy["decisionPolicy"]["unreadablePreview"], ["unreadable_preview"], []
    if signals.get("detectorStatus") != "ready":
        return "review", ["subject_detector_unavailable"], capability_evidence("subject detector")
    if signals.get("protectedContexts"):
        return "keep", ["protected_context"], context_evidence(signals["protectedContexts"])
    if not signals.get("allowedSubjects"):
        action = strategy["decisionPolicy"]["noAllowedSubject"]
        return action, ["no_allowed_subject"], subject_evidence(0, action)
    return evaluate_quality_rules(signals, strategy)
```

`evaluate_quality_rules` must use strategy thresholds, protect intentional motion when configured, and only return `reject` when every key in `hardRejectRequires` is present. Otherwise downgrade to `review`.

- [ ] **Step 5: Verify schema and Python GREEN**

Run:

- `npm run test:contracts -- reviewStrategySchema.test.ts`
- `npm run test:ai`

Expected: every strategy validates and all Python tests PASS.

- [ ] **Step 6: Checkpoint**

Record four JSON strategies, evaluator/policy changes, and test output.

---


## Execution Contract
Read AGENTS.md and master spec fully. Follow TDD. Preserve Tasks 1-4 and source-photo immutability. Use apply_patch. No Git initialization. Write `.superpowers/sdd/task-5-report.md` with exact RED/GREEN commands, test counts, self-review, and concerns.
