# Cloud-First Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let FrameScout use a cloud visual model as the primary culling engine when local compute is limited, while keeping RAW files local, limiting spend, and preserving resumable review work.

**Architecture:** The terminal-hosted Rust service remains the sole cloud caller and secret holder. The UI exposes honest local or cloud analysis lanes; legacy `hybrid` configuration values normalize to cloud until a real two-model cascade exists. Cloud calls use compressed generated proxy images, strict structured observations, a service-wide concurrency cap, and a project/model request ledger. Final Top-N selection remains a local deterministic pass over persisted evidence and burst diversity.

**Tech Stack:** Rust, Axum, Tokio, Reqwest, SQLite, React, TypeScript, Vitest.

## Global Constraints

- Never upload, mutate, move, or delete source photos, RAW files, or existing XMP files during analysis.
- Send only FrameScout-generated proxy JPEGs capped by the service-side pixel and byte limits.
- Keep API keys only in the terminal environment; the browser must never receive, persist, or log a key.
- Keep cloud work bounded by an explicit project budget and a conservative concurrency limit.
- A cloud failure must leave affected assets in `review`, never silently reject them.
- Retain Chinese UI labels and English technical identifiers for search/export.

---

### Task 1: Define cloud execution and cost contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/local-service/src/main.rs`
- Test: `apps/desktop/src/features/project/tauriProjectClient.test.ts`

**Interfaces:**
- Keeps `AnalysisExecutionMode = "local" | "cloud" | "hybrid"` for persisted compatibility, while the UI exposes only implemented `local` and `cloud` behavior.
- Extends `AnalysisConfigSetRequest` with `executionMode`, `cloudBudgetCents`, and `cloudConcurrency`.
- Extends `AnalysisConfigResponse` with the selected non-secret mode and limits.

- [ ] **Step 1: Write failing contract/client tests**

```ts
await client.setAnalysisConfig({
  profileId: "qwen-cloud",
  executionMode: "cloud",
  cloudBudgetCents: 500,
  cloudConcurrency: 2
});
expect(invoke).toHaveBeenCalledWith("analysis_config_set", {
  input: expect.objectContaining({ executionMode: "cloud", cloudBudgetCents: 500 })
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the request fields do not exist.**

Run: `npm --workspace @framescout/desktop run test -- tauriProjectClient.test.ts`

- [ ] **Step 3: Add the typed fields and validate service limits.**

Accept only execution modes above, `cloudBudgetCents` from 0 to 100000, and `cloudConcurrency` from 1 to 4. Persist only these non-secret routing preferences in `analysis-profile.json`.

- [ ] **Step 4: Run the focused test and then the desktop test suite.**

Run: `npm --workspace @framescout/desktop run test`

### Task 2: Make cloud processing resumable, bounded, and fail-closed

**Files:**
- Modify: `apps/local-service/src/main.rs`
- Test: `apps/local-service/src/main.rs` module tests

**Interfaces:**
- Produces `CloudWorkPlan` with eligible proxy asset ids, per-asset estimated budget, and a capped concurrency.
- `run_cloud_analysis` persists a successful result after each asset and resumes only assets without a signal from the active run.
- A rejected request is retried only for transient HTTP status codes and never changes an asset to `reject` without a policy result.

- [ ] **Step 1: Write failing pure-function tests**

```rust
#[test]
fn cloud_plan_caps_work_at_the_configured_budget() {
    let plan = cloud_work_plan(10, 12, 30, 2).unwrap();
    assert_eq!(plan.asset_limit, 2);
    assert_eq!(plan.concurrency, 2);
}

#[test]
fn unavailable_cloud_result_is_review_not_reject() {
    assert_eq!(cloud_failure_disposition(), "review");
}
```

- [ ] **Step 2: Run the focused Rust tests and verify they fail.**

Run: `cargo test -p framescout-local-service cloud_plan`

- [ ] **Step 3: Add budget planning, a semaphore-limited worker pool, retry classification, and per-result persistence.**

Use a proxy-only work plan. Mark budget-excluded assets with an explicit run error/status rather than processing them invisibly. Resume a stopped or failed run only for assets that lack persisted signals.

- [ ] **Step 4: Run all service tests.**

Run: `cargo test -p framescout-local-service`

### Task 3: Add a cloud semantic culling contract and policy-compatible result

**Files:**
- Modify: `apps/local-service/src/main.rs`
- Modify: `apps/ai-worker/src/framescout_ai/policy.py`
- Test: `apps/local-service/src/main.rs` module tests
- Test: `apps/ai-worker/tests/test_policy.py`

**Interfaces:**
- Cloud response contains only validated `visualObservations`, composition/subject state, quality signals, and bilingual-ready short labels.
- Local policy remains the authority that converts observations into `keep`, `review`, or `reject` and reason codes.

- [ ] **Step 1: Write failing parser/policy tests for a portrait and a non-readable image.**

```rust
assert_eq!(parse_cloud_observations(PORTRAIT_JSON)?.pointer("/portrait/eyesOpen"), Some(&json!(true)));
```

```python
assert evaluate("portrait", unreadable_signals)["disposition"] == "review"
```

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `cargo test -p framescout-local-service cloud_observation`

- [ ] **Step 3: Extend the strict schema and policy mapping without allowing a model-generated decision to bypass policy.**

Use the cloud model for facts: subject, people, face/eyes state where supplied, composition, sharpness/readability, exposure, motion, scene, objects, and editorial context. Keep the user policy document as the decision authority.

- [ ] **Step 4: Run the Rust and Python tests.**

Run: `cargo test -p framescout-local-service; .\\apps\\ai-worker\\.venv\\Scripts\\python.exe -m pytest apps/ai-worker/tests -q`

### Task 4: Add project-level Top-N ranking as a local deterministic pass

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/local-service/src/main.rs`
- Modify: `apps/desktop/src/features/analysis/AnalysisQueueView.tsx`
- Test: `apps/local-service/src/main.rs` module tests

**Interfaces:**
- The project selection goal supplies `targetCount`.
- Persisted evidence and burst diversity rank eligible `keep`/`review` assets without another paid upload and without overwriting human decisions.

- [ ] **Step 1: Write a failing ranking test.**

```rust
assert_eq!(rank_top_candidates(&[("a", 0.9), ("b", 0.7)], 1), vec!["a"]);
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cargo test -p framescout-local-service rank_top_candidates`

- [ ] **Step 3: Persist recommendation rank as AI evidence and expose it in run progress/UI.**

The final ranking is local and deterministic. Assets outside the requested Top-N remain reviewable and are not automatically human-rejected.

- [ ] **Step 4: Run focused UI tests and all tests.**

Run: `npm --workspace @framescout/desktop run test; cargo test -p framescout-local-service`

### Task 5: Surface cloud-first controls without overwhelming the Review Desk

**Files:**
- Modify: `apps/desktop/src/features/analysis/AnalysisProfileSwitcher.tsx`
- Modify: `apps/desktop/src/i18n/uiCopy.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles.css`
- Test: `apps/desktop/src/features/analysis/AnalysisProfileSwitcher.test.tsx`

**Interfaces:**
- The switcher displays `云端识别 / 本机识别`, the selected provider/model, proxy-only privacy rule, a project budget cap, and a concurrency selector.
- It never renders or requests a secret.

- [ ] **Step 1: Write a failing component test for mode selection and disabled unavailable cloud profiles.**

```tsx
expect(screen.getByRole("radio", { name: "云端优先" })).toBeChecked();
expect(screen.getByText("仅发送代理图，RAW 始终留在本机")).toBeVisible();
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npm --workspace @framescout/desktop run test -- AnalysisProfileSwitcher.test.tsx`

- [ ] **Step 3: Implement accessible segmented controls and localized status/cost copy.**

Preserve narrow-screen layout: controls wrap within the profile panel; no new top-bar text overlaps project status.

- [ ] **Step 4: Verify desktop tests, production build, and a browser screenshot at desktop and narrow widths.**

Run: `npm --workspace @framescout/desktop run test; npm --workspace @framescout/desktop run build`

### Task 6: Validate with a real, bounded cloud calibration run

**Files:**
- Modify: `docs/AI_CLOUD_CALIBRATION.md`

- [ ] **Step 1: Document terminal-only secret setup and a 20-image calibration command.**

Include `DASHSCOPE_API_KEY` setup, proxy-only assurance, expected progress events, budget limit, and how to remove the terminal environment variable.

- [ ] **Step 2: Run a local mock-provider integration test before any paid call.**

The mock must assert each request contains a `data:image/jpeg` proxy and no source path or RAW extension.

- [ ] **Step 3: Ask the user to supply/configure their own API key before performing a paid provider call.**

No paid call is made with guessed credentials.

## Review Checklist

- [ ] The browser cannot obtain an API key from any API response, local storage, logs, or HTML.
- [ ] Source proxies/RAW bytes are unchanged after every test.
- [ ] An interrupted cloud run resumes missing items and reports visible progress.
- [ ] Invalid provider JSON fails closed to review, not reject.
- [ ] Budget, concurrency, cancellation, and top-N logic are observable in the UI.
- [ ] `cargo test -p framescout-local-service`, desktop tests, and desktop production build pass.
