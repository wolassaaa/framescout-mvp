# Session Selection and Strategy-Aware AI Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-wide filtered selection, visible AI review marks and review modes, complete Chinese/English UI copy, and one deterministic strategy evaluator shared by local and cloud analysis.

**Architecture:** Keep batch selection as an in-memory set of asset IDs that is independent from human dispositions and shared by Review Desk and Grid. Derive AI mark state from durable evidence, while adding analysis provenance to the project projection for tooltips. Split inference into provider-produced visual signals followed by a strategy evaluator that owns keep/review/reject policy.

**Tech Stack:** React 18, TypeScript, Vitest, Playwright, Rust/Axum/SQLite, Python 3, pytest, JSON Schema, existing YOLOX ONNX worker.

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

---

## File Structure

**Create**

- `apps/desktop/src/features/review/aiReview.ts`: derive AI reviewed/pending state and review-mode matching.
- `apps/desktop/src/features/review/AiReviewMark.tsx`: reusable colored star and accessible provenance tooltip.
- `apps/desktop/src/features/review/SelectionToolbar.tsx`: shared select-all/clear/count controls.
- `apps/desktop/src/i18n/uiCopy.ts`: bilingual labels shared across screens.
- `apps/desktop/src/i18n/tagLabels.ts`: stable machine-tag localization with fallback.
- `apps/desktop/src/i18n/uiCopy.test.ts`: catalog parity and tag fallback tests.
- `apps/ai-worker/src/framescout_ai/strategy.py`: strategy loading, validation boundary, and deterministic evaluation.
- `apps/ai-worker/tests/test_strategy.py`: policy examples and capability-fallback tests.
- `strategies/action-coverage.strategy.json`
- `strategies/matchday-story.strategy.json`
- `strategies/motorsport.strategy.json`
- `strategies/esports-stage.strategy.json`
- `crates/storage/migrations/0008_analysis_provenance.sql`: durable strategy/model metadata.

**Modify**

- `apps/desktop/src/features/review/reviewState.ts` and `.test.ts`
- `apps/desktop/src/features/review/ReviewDesk.tsx`
- `apps/desktop/src/features/grid/GridView.tsx` and `.test.ts`
- `apps/desktop/src/features/coverage/CoverageView.tsx`
- `apps/desktop/src/features/projects/ProjectsView.tsx`
- `apps/desktop/src/features/analysis/AnalysisQueueView.tsx`
- `apps/desktop/src/features/import/ImportView.tsx`
- `apps/desktop/src/features/duel/DuelView.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles/app.css`
- `packages/contracts/src/index.ts`
- `apps/ai-worker/src/framescout_ai/policy.py`
- `apps/ai-worker/src/framescout_ai/worker.py`
- `apps/local-service/src/main.rs`
- `crates/storage/src/sqlite.rs`
- `tests/contracts/storageMigration.test.ts`
- `tests/e2e/review-desk.spec.ts` and visual baselines
- `docs/ai-runtime.md`

---

### Task 1: Shared Session Selection Reducer

**Files:**
- Modify: `apps/desktop/src/features/review/reviewState.ts`
- Test: `apps/desktop/src/features/review/reviewState.test.ts`

**Interfaces:**
- Produces action `{ type: "selectAssets"; assetIds: string[] }`.
- Produces action `{ type: "clearSelectedAssets"; assetIds?: string[] }`.
- Continues to expose `ReviewState.gridSelection` as the shared marked-ID collection to avoid a storage migration.

- [x] **Step 1: Write failing reducer tests**

```ts
it("marks every logical result without changing decisions or tags", () => {
  const many = Array.from({ length: 1000 }, (_, index) => ({
    ...assets[0], id: `asset-${index}`, humanDisposition: "unseen" as const
  }));
  const state = createInitialReviewState(many);
  const next = reviewReducer(state, { type: "selectAssets", assetIds: many.map((asset) => asset.id) });

  expect(next.gridSelection).toHaveLength(1000);
  expect(next.assets.every((asset) => asset.humanDisposition === "unseen")).toBe(true);
  expect(next.assets.map((asset) => asset.tags)).toEqual(many.map((asset) => asset.tags));
});

it("clears only the supplied filtered result when ids are provided", () => {
  const selected = reviewReducer(createInitialReviewState(assets), {
    type: "selectAssets", assetIds: assets.map((asset) => asset.id)
  });
  const next = reviewReducer(selected, { type: "clearSelectedAssets", assetIds: [assets[0].id] });
  expect(next.gridSelection).toEqual(assets.slice(1).map((asset) => asset.id));
});
```

- [x] **Step 2: Verify RED**

Run: `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts`  
Expected: FAIL because `selectAssets` and `clearSelectedAssets` are not valid actions.

- [x] **Step 3: Add minimal reducer actions**

```ts
export type ReviewAction =
  | { type: "selectAssets"; assetIds: string[] }
  | { type: "clearSelectedAssets"; assetIds?: string[] }
  // existing actions

case "selectAssets": {
  const validIds = new Set(state.assets.map((asset) => asset.id));
  const selected = new Set(state.gridSelection);
  action.assetIds.forEach((id) => { if (validIds.has(id)) selected.add(id); });
  return { ...state, gridSelection: Array.from(selected) };
}
case "clearSelectedAssets": {
  if (!action.assetIds) return { ...state, gridSelection: [] };
  const clearIds = new Set(action.assetIds);
  return { ...state, gridSelection: state.gridSelection.filter((id) => !clearIds.has(id)) };
}
```

- [x] **Step 4: Verify GREEN**

Run the Task 1 command.  
Expected: all reducer tests PASS.

- [x] **Step 5: Checkpoint**

Record that only `reviewState.ts` and `reviewState.test.ts` changed and that no project persistence code changed.

---

### Task 2: AI Review Status and Review Modes

**Files:**
- Create: `apps/desktop/src/features/review/aiReview.ts`
- Modify: `apps/desktop/src/features/review/reviewState.ts`
- Test: `apps/desktop/src/features/review/reviewState.test.ts`

**Interfaces:**
- Produces `type AiReviewStatus = "pending" | AiDisposition`.
- Produces `type ReviewMode = "assisted" | "all" | "reject-audit"`.
- Produces `aiReviewStatus(asset: ReviewAsset): AiReviewStatus`.
- Adds `reviewMode` to `ReviewState` and `setReviewMode` to `ReviewAction`.

- [x] **Step 1: Write failing status and mode tests**

```ts
it("does not call an asset AI-reviewed without persisted evidence", () => {
  expect(aiReviewStatus({ ...assets[0], aiDisposition: "keep", evidence: [] })).toBe("pending");
  expect(aiReviewStatus(assets[0])).toBe("keep");
});

it("supports assisted, full re-review, and reject audit queues", () => {
  const base = createInitialReviewState(assets);
  expect(visibleAssets(base).map((asset) => asset.aiDisposition)).toEqual(["keep", "review"]);
  const all = reviewReducer(base, { type: "setReviewMode", mode: "all" });
  expect(visibleAssets(all)).toHaveLength(3);
  const audit = reviewReducer(all, { type: "setReviewMode", mode: "reject-audit" });
  expect(visibleAssets(audit).map((asset) => asset.aiDisposition)).toEqual(["reject"]);
});
```

- [x] **Step 2: Verify RED**

Run the reducer test command.  
Expected: FAIL because the helper and review mode do not exist.

- [x] **Step 3: Implement the pure status boundary**

```ts
import type { AiDisposition, ReviewAsset } from "@framescout/contracts";

export type AiReviewStatus = "pending" | AiDisposition;
export type ReviewMode = "assisted" | "all" | "reject-audit";

export function aiReviewStatus(asset: ReviewAsset): AiReviewStatus {
  return asset.evidence.length > 0 ? asset.aiDisposition : "pending";
}

export function matchesReviewMode(asset: ReviewAsset, mode: ReviewMode): boolean {
  const status = aiReviewStatus(asset);
  if (mode === "all") return true;
  if (mode === "reject-audit") return status === "reject";
  return status !== "reject" || asset.humanDisposition !== "unseen";
}
```

Update `visibleAssets` to call `matchesReviewMode`, initialize `reviewMode: "assisted"`, and reset the cursor to zero on `setReviewMode`.

- [x] **Step 4: Verify GREEN**

Run the reducer tests.  
Expected: PASS with existing human-rescued reject behavior preserved.

- [x] **Step 5: Checkpoint**

Record `aiReview.ts`, `reviewState.ts`, and test changes.

---

### Task 3: Selection Toolbar, AI Marks, and Keyboard Behavior

**Files:**
- Create: `apps/desktop/src/features/review/SelectionToolbar.tsx`
- Create: `apps/desktop/src/features/review/AiReviewMark.tsx`
- Modify: `apps/desktop/src/features/review/ReviewDesk.tsx`
- Modify: `apps/desktop/src/features/grid/GridView.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles/app.css`
- Test: `apps/desktop/src/features/grid/GridView.test.ts`
- Test: `tests/e2e/review-desk.spec.ts`

**Interfaces:**
- `SelectionToolbar({ language, resultIds, selectedIds, dispatch })`.
- `AiReviewMark({ asset, language })` renders nothing for pending assets.

- [x] **Step 1: Add failing E2E coverage**

```ts
test("select all marks the complete current result without applying a decision", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Grid" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("1 marked")).toBeVisible();
  await expect(page.getByText("0 selected")).toBeVisible();
  await page.getByRole("button", { name: "Review Desk" }).click();
  await expect(page.getByText("1 marked")).toBeVisible();
});

test("AI marks distinguish reviewed verdicts from pending assets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page.getByLabel("AI reviewed: suggested keep")).toBeVisible();
  await expect(page.getByLabel("AI reviewed: needs review")).toBeVisible();
});
```

- [x] **Step 2: Verify RED**

Run: `npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "select all|AI marks"`  
Expected: FAIL because the toolbar and mark labels do not exist.

- [x] **Step 3: Implement reusable controls**

```tsx
export function SelectionToolbar({ language, resultIds, selectedIds, dispatch }: Props) {
  const selected = new Set(selectedIds);
  const allSelected = resultIds.length > 0 && resultIds.every((id) => selected.has(id));
  return <div className="selection-toolbar" aria-label={language === "zh" ? "批量选择" : "Batch selection"}>
    <button disabled={resultIds.length === 0 || allSelected}
      onClick={() => dispatch({ type: "selectAssets", assetIds: resultIds })}>
      <CheckSquare size={15} />{language === "zh" ? "全选" : "Select all"}
    </button>
    <button disabled={!resultIds.some((id) => selected.has(id))}
      onClick={() => dispatch({ type: "clearSelectedAssets", assetIds: resultIds })}>
      {language === "zh" ? "取消全选" : "Clear selection"}
    </button>
    <span>{selectedIds.length} {language === "zh" ? "张已勾选" : "marked"}</span>
  </div>;
}
```

`ReviewDesk` passes every `visibleAssets(state)` ID. `GridView` passes every `filteredAssets` ID before slicing to 240.

```tsx
export function AiReviewMark({ asset, language }: { asset: ReviewAsset; language: UiLanguage }) {
  const status = aiReviewStatus(asset);
  if (status === "pending") return null;
  const label = aiMarkCopy[language][status];
  return <span className={`ai-review-mark ${status}`} aria-label={label} title={label}>
    <Star size={13} fill="currentColor" />
  </span>;
}
```

Place the mark in both filmstrip and grid thumbnail metadata rows. Do not use the same position as the human selection check.

- [x] **Step 4: Add scoped keyboard handlers**

In both `ReviewDesk` and `GridView`, when no input/select/textarea is focused:

```ts
if (event.ctrlKey && event.key.toLowerCase() === "a") {
  event.preventDefault();
  dispatch({ type: "selectAssets", assetIds: resultIds });
}
if (event.key === "Escape") dispatch({ type: "clearSelectedAssets" });
```

- [x] **Step 5: Verify GREEN and visual stability**

Run the Task 3 E2E command, then:

`npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --update-snapshots`  
Expected: behavior PASS; only intentional toolbar/star visual baselines change.

- [x] **Step 6: Checkpoint**

Record the two new components, Review/Grid/App/CSS edits, E2E changes, and snapshot files.

---

### Task 4: Review-Mode Controls and Complete Bilingual UI

**Files:**
- Create: `apps/desktop/src/i18n/uiCopy.ts`
- Create: `apps/desktop/src/i18n/tagLabels.ts`
- Create: `apps/desktop/src/i18n/uiCopy.test.ts`
- Modify the UI files listed in File Structure.

**Interfaces:**
- Produces `type UiLanguage = "zh" | "en"` from one module.
- Produces `uiCopy[language]` with equal nested keys.
- Produces `localizedTag(tag: string, language: UiLanguage): string`.

- [x] **Step 1: Write failing catalog tests**

```ts
it("keeps Chinese and English catalogs structurally identical", () => {
  expect(flattenKeys(uiCopy.zh)).toEqual(flattenKeys(uiCopy.en));
});

it("localizes stable machine tags and preserves manual or unknown tags", () => {
  expect(localizedTag("subject:person", "zh")).toBe("人物");
  expect(localizedTag("subject:person", "en")).toBe("Person");
  expect(localizedTag("manual:portfolio-pick", "zh")).toBe("portfolio pick");
  expect(localizedTag("object:unknown", "zh")).toBe("object:unknown");
});
```

- [x] **Step 2: Verify RED**

Run: `npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts`  
Expected: FAIL because the catalog does not exist.

- [x] **Step 3: Build the catalog and tag map**

```ts
export const machineTagLabels: Record<string, Record<UiLanguage, string>> = {
  "subject:person": { zh: "人物", en: "Person" },
  "object:car": { zh: "汽车", en: "Car" },
  "scene:empty": { zh: "空镜", en: "Empty scene" },
  "quality:soft": { zh: "模糊", en: "Soft focus" },
  "ai:reviewed": { zh: "AI 已审", en: "AI reviewed" }
};

export function localizedTag(tag: string, language: UiLanguage): string {
  const known = machineTagLabels[tag]?.[language];
  if (known) return known;
  if (tag.startsWith("manual:")) return tag.slice(7).replace(/-/g, " ");
  return tag;
}
```

The UI catalog must include every visible string now hardcoded in Grid, Coverage, Projects, Analysis, Import, Duel, Review, Export, settings, and shortcuts. Move the existing component-local bilingual copy into this catalog without changing semantic labels.

- [x] **Step 4: Add the three review-mode buttons**

Use a segmented control in Review Desk and Grid:

```tsx
{(["assisted", "all", "reject-audit"] as const).map((mode) =>
  <button key={mode} aria-pressed={state.reviewMode === mode}
    onClick={() => dispatch({ type: "setReviewMode", mode })}>
    {copy.reviewMode[mode]}
  </button>
)}
```

Also add AI-reviewed and awaiting-AI filters using `aiReviewStatus`, without changing assets.

- [x] **Step 5: Verify catalog and bilingual E2E**

Run the catalog test, then add an E2E test that switches `中`/`EN` and checks the selection toolbar, review modes, Grid filters, Tags headings, and Export heading in both languages.

Expected: all catalog and E2E checks PASS; no hardcoded English remains in the named screens.

- [x] **Step 6: Checkpoint**

Record the catalog, tag map, tests, and migrated component list.

---

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

- [x] **Step 1: Write failing policy tests**

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

- [x] **Step 2: Verify RED**

Run: `apps\ai-worker\.venv\Scripts\python.exe -m pytest apps\ai-worker\tests\test_strategy.py -q`  
Expected: FAIL because `framescout_ai.strategy` does not exist.

- [x] **Step 3: Create exact preset mappings**

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

- [x] **Step 4: Implement deterministic evaluation**

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

- [x] **Step 5: Verify schema and Python GREEN**

Run:

- `npm run test:contracts -- reviewStrategySchema.test.ts`
- `npm run test:ai`

Expected: every strategy validates and all Python tests PASS.

- [x] **Step 6: Checkpoint**

Record four JSON strategies, evaluator/policy changes, and test output.

---

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

### Task 7: Persist and Project AI Provenance

**Files:**
- Create: `crates/storage/migrations/0008_analysis_provenance.sql`
- Modify: `crates/storage/src/sqlite.rs`
- Modify: `apps/local-service/src/main.rs`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/contracts/storageMigration.test.ts`
- Test: Rust projection tests.

**Interfaces:**
- Optional `ReviewAsset` fields: `aiBackend`, `aiModelVersion`, `aiStrategyId`, `aiStrategyVersion`, `aiAnalyzedAt`.

- [ ] **Step 1: Write failing migration and projection tests**

```ts
expect(sql).toContain("strategy_id TEXT");
expect(sql).toContain("strategy_version INTEGER");
expect(sql).toContain("model_version TEXT");
```

Rust projection assertion:

```rs
assert_eq!(asset["aiStrategyId"], "motorsport");
assert_eq!(asset["aiModelVersion"], "framescout-quality-v1+yolox_s");
```

- [ ] **Step 2: Verify RED**

Run contract and focused Rust tests.  
Expected: FAIL because migration 0008 and projected fields are absent.

- [ ] **Step 3: Add the migration**

```sql
ALTER TABLE analysis_runs ADD COLUMN strategy_id TEXT;
ALTER TABLE analysis_runs ADD COLUMN strategy_version INTEGER;
ALTER TABLE analysis_runs ADD COLUMN model_version TEXT;
```

Persist these fields when the first valid worker/cloud result arrives. Project the latest signal-bearing run for each asset without changing existing human decision joins.

- [ ] **Step 4: Extend the TypeScript contract**

```ts
export interface ReviewAsset {
  // existing fields
  aiBackend?: string;
  aiModelVersion?: string;
  aiStrategyId?: string;
  aiStrategyVersion?: number;
  aiAnalyzedAt?: string;
}
```

Update `AiReviewMark` tooltip to show only fields that exist; missing provenance uses localized “Legacy analysis”.

- [ ] **Step 5: Verify GREEN**

Run storage contracts, Rust tests, frontend tests, and `npm run build`.  
Expected: PASS; migration remains additive and restart-safe.

- [ ] **Step 6: Checkpoint**

Record migration, storage, service, contract, and tooltip changes.

---

### Task 8: Full Verification and Bounded Real-Image Check

**Files:**
- Modify: `docs/ai-runtime.md`
- Update: Playwright snapshots only after behavior passes.

**Interfaces:** None; this task verifies the integrated system.

- [ ] **Step 1: Document the final data flow**

Add the exact flow: proxy -> perception provider -> normalized signals -> strategy evaluator -> durable evidence/provenance -> AI mark -> human review. State that AI marks are not Lightroom ratings and that selection remains temporary UI state.

- [ ] **Step 2: Run the complete automated matrix**

Run:

```powershell
npm test
npm run test:ai
cargo check -p framescout-local-service
cargo test -p framescout-local-service -- --skip local_ai_analysis_persists_evidence_without_mutating_proxy
npm run build
npx playwright test tests/e2e/review-desk.spec.ts
```

Expected: 0 failures in frontend, contracts, Python, Rust, build, desktop E2E, and compact E2E.

- [ ] **Step 3: Verify zoom and bilingual screenshots**

Use Playwright at 1440x900 and 1280x800, then set UI scale to 120%. Verify no overlap among selection toolbar, review-mode control, AI marks, decision bar, and topbar progress. Verify Chinese and English separately.

- [ ] **Step 4: Run a bounded real-image test**

Use 500 proxy images from the existing read-only G-drive test folder. Before and after the run, capture source file count, total bytes, newest modification timestamp, and a sampled SHA-256 set. Confirm:

- all 500 IDs can be selected without decoding additional images;
- memory remains bounded by the existing thumbnail batch/cache rules;
- at least one standard signal and strategy result persists for each successfully analyzed proxy;
- no source count, size, timestamp, or sampled hash changes.

Do not start a 6396-image full AI rerun during verification.

- [ ] **Step 5: Restart the release service and verify recovery**

Build `framescout-local-service --release`, restart port 4310 only after confirming no analysis is running, load the active project, and verify selection UI, AI marks, review modes, and provenance after restart.

- [ ] **Step 6: Final checkpoint**

Report exact test counts, bounded-image measurements, service URL, modified file list, and the explicit fact that the 6396-image full AI job was not rerun.
