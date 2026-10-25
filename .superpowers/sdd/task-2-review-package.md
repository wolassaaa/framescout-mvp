# Task 2 Review Package

## Implementer Report

# Task 2 Report

## Status

GREEN - Task 2 implemented.

## Exact files

- `apps/desktop/src/features/review/aiReview.ts`
- `apps/desktop/src/features/review/reviewState.ts`
- `apps/desktop/src/features/review/reviewState.test.ts`
- `.superpowers/sdd/task-2-report.md`

## RED evidence

Command:

```text
npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts
```

Before implementation, Vitest failed during collection because `./aiReview` did not exist. This was the expected missing-contract failure.

## GREEN evidence

Command:

```text
npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts
```

Result: 1 test file passed, 18 tests passed.

Additional verification: `npm --workspace @framescout/desktop run build` passed (`tsc` and Vite production build).

## Self-review

- `aiReviewStatus` uses non-empty persisted `evidence` as the only analyzed-state signal.
- Assisted mode includes keep, review, and pending assets plus human-rescued rejects.
- All mode includes every asset; reject-audit includes only persisted AI rejects.
- `setReviewMode` resets only the cursor and preserves assets, selection, decisions, and tags immutably.
- Type imports are type-only where appropriate; no dependencies, persistence, source-photo, RAW, inference, or UI changes were added.

## Concerns

The legacy `showAiRejects` state remains for compatibility, but review-mode matching is now authoritative for queue visibility as required by Task 2. No UI controls were changed.

## Review Fix

Status: GREEN - P1 findings resolved.

Exact changes:

- Disposition filters (`keep`, `review`, and `reject`) now compare `aiReviewStatus(asset)` instead of raw `aiDisposition`.
- Evidence-empty assets remain `pending`, including assets whose default `aiDisposition` is `reject`, and cannot enter reject-only results.
- `toggleRejects` now switches between `assisted` and `all`, synchronizes `showAiRejects`, resets the cursor, and restores the `all` filter when hiding a legacy reject-only queue.
- `setReviewFilter("reject")` now enters `reject-audit`, synchronizes `showAiRejects`, and returns only persisted rejects. Leaving that filter moves from `reject-audit` to `all`.
- `setReviewMode` and `replaceAssets` keep `reviewMode` and `showAiRejects` synchronized.
- Added focused regression coverage for pending default rejects through `visibleAssets` and for legacy reject toggling changing queue visibility in both directions.

Review-fix RED evidence:

```text
npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts
```

Result before the fix: 3 failed, 16 passed. Failures covered no-op reject toggling, unsynchronized reject filtering, and reject queue visibility.

Required verification:

```text
npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts
```

Result: 1 test file passed, 19 tests passed.

```text
npm --workspace @framescout/desktop run build
```

Result: passed (`tsc` and Vite production build; 1,608 modules transformed).

Review-fix concerns: none. Human-rescued persisted rejects remain visible in assisted mode, and no persistence, source-photo, RAW, inference, or UI files were changed.

## Diff: reviewState.ts
```diff
diff --git a/.superpowers/sdd/task-2-before/reviewState.ts b/apps/desktop/src/features/review/reviewState.ts
index 6bb1f03..805cb6e 100644
--- a/.superpowers/sdd/task-2-before/reviewState.ts
+++ b/apps/desktop/src/features/review/reviewState.ts
@@ -1,8 +1,10 @@
 import type { HumanDisposition, ReviewAsset } from "@framescout/contracts";
+import { aiReviewStatus, matchesReviewMode, type ReviewMode } from "./aiReview";
 
 export interface ReviewState {
   cursor: number;
   assets: ReviewAsset[];
+  reviewMode: ReviewMode;
   showAiRejects: boolean;
   reviewFilter: ReviewFilter;
   inspectorOpen: boolean;
@@ -24,6 +26,7 @@ export type ReviewAction =
   | { type: "setSelectionRanking"; assets: ReviewAsset[] }
   | { type: "toggleRejects" }
   | { type: "setReviewFilter"; filter: ReviewFilter }
+  | { type: "setReviewMode"; mode: ReviewMode }
   | { type: "toggleInspector" }
   | { type: "toggleLoupe" }
   | { type: "toggleTagEditor" }
@@ -44,7 +47,7 @@ export type ReviewAction =
 function matchesReviewFilter(asset: ReviewAsset, filter: ReviewFilter): boolean {
   if (filter === "all") return true;
   if (filter === "recommended") return asset.aiRecommended === true;
-  if (filter === "keep" || filter === "review" || filter === "reject") return asset.aiDisposition === filter;
+  if (filter === "keep" || filter === "review" || filter === "reject") return aiReviewStatus(asset) === filter;
   if (filter === "selected") return asset.humanDisposition === "select";
   if (filter === "no-athlete") return asset.reasons.includes("no_allowed_subject_preserved_by_matchday") || asset.tags.includes("venue");
   return asset.reasons.includes("subject_out_of_focus") || asset.tags.includes("soft-focus");
@@ -60,7 +63,7 @@ export const visibleAssets = (state: ReviewState) =>
   state.assets.filter(
     (asset) =>
       hasReviewPreview(asset) &&
-      (state.showAiRejects || asset.aiDisposition !== "reject" || asset.humanDisposition !== "unseen") &&
+      matchesReviewMode(asset, state.reviewMode) &&
       matchesReviewFilter(asset, state.reviewFilter)
   );
 
@@ -68,6 +71,7 @@ export function createInitialReviewState(assets: ReviewAsset[]): ReviewState {
   return {
     cursor: 0,
     assets,
+    reviewMode: "assisted",
     showAiRejects: false,
     reviewFilter: "all",
     inspectorOpen: true,
@@ -94,6 +98,7 @@ export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewS
         ...state,
         cursor: 0,
         assets: action.assets,
+        reviewMode: "assisted",
         showAiRejects: false,
         reviewFilter: "all",
         tagEditorOpen: false,
@@ -117,20 +122,32 @@ export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewS
       return { ...state, cursor: Math.max(state.cursor - 1, 0) };
     case "setCursor":
       return { ...state, cursor: Math.max(0, Math.min(action.cursor, Math.max(queue.length - 1, 0))) };
-    case "toggleRejects":
+    case "toggleRejects": {
+      const showAiRejects = state.reviewMode === "assisted";
       return {
         ...state,
-        showAiRejects: !state.showAiRejects,
-        reviewFilter: state.showAiRejects && state.reviewFilter === "reject" ? "all" : state.reviewFilter,
+        reviewMode: showAiRejects ? "all" : "assisted",
+        showAiRejects,
+        reviewFilter: !showAiRejects && state.reviewFilter === "reject" ? "all" : state.reviewFilter,
         cursor: 0
       };
-    case "setReviewFilter":
+    }
+    case "setReviewFilter": {
+      const reviewMode = action.filter === "reject"
+        ? "reject-audit"
+        : state.reviewMode === "reject-audit"
+          ? "all"
+          : state.reviewMode;
       return {
         ...state,
         reviewFilter: action.filter,
-        showAiRejects: action.filter === "reject" ? true : state.showAiRejects,
+        reviewMode,
+        showAiRejects: reviewMode !== "assisted",
         cursor: 0
       };
+    }
+    case "setReviewMode":
+      return { ...state, reviewMode: action.mode, showAiRejects: action.mode !== "assisted", cursor: 0 };
     case "toggleInspector":
       return { ...state, inspectorOpen: !state.inspectorOpen };
     case "toggleLoupe":
```

## Diff: reviewState.test.ts
```diff
diff --git a/.superpowers/sdd/task-2-before/reviewState.test.ts b/apps/desktop/src/features/review/reviewState.test.ts
index 4d30ed0..b4043a1 100644
--- a/.superpowers/sdd/task-2-before/reviewState.test.ts
+++ b/apps/desktop/src/features/review/reviewState.test.ts
@@ -1,8 +1,47 @@
 import { describe, expect, it } from "vitest";
 import { assets } from "../../data/fixtures";
+import { aiReviewStatus, matchesReviewMode } from "./aiReview";
 import { createInitialReviewState, normalizeManualTag, reviewReducer, visibleAssets } from "./reviewState";
 
 describe("reviewReducer", () => {
+  it("treats an AI disposition without persisted evidence as pending", () => {
+    const pending = { ...assets[0], id: "pending-ai", aiDisposition: "keep" as const, evidence: [] };
+    const reviewed = { ...assets[0], id: "reviewed-ai", evidence: [assets[0].evidence[0]] };
+
+    expect(aiReviewStatus(pending)).toBe("pending");
+    expect(aiReviewStatus(reviewed)).toBe("keep");
+  });
+
+  it("matches assisted, all, and reject-audit review modes", () => {
+    const modeAssets = [
+      { ...assets[0], id: "keep", aiDisposition: "keep" as const },
+      { ...assets[1], id: "review", aiDisposition: "review" as const },
+      { ...assets[0], id: "pending", aiDisposition: "keep" as const, evidence: [] },
+      { ...assets[2], id: "rescued", humanDisposition: "select" as const },
+      { ...assets[2], id: "reject", humanDisposition: "unseen" as const },
+      { ...assets[2], id: "pending-reject", aiDisposition: "reject" as const, evidence: [] }
+    ];
+
+    expect(modeAssets.filter((asset) => matchesReviewMode(asset, "assisted")).map((asset) => asset.id))
+      .toEqual(["keep", "review", "pending", "rescued", "pending-reject"]);
+    expect(modeAssets.filter((asset) => matchesReviewMode(asset, "all")).map((asset) => asset.id))
+      .toEqual(modeAssets.map((asset) => asset.id));
+    expect(modeAssets.filter((asset) => matchesReviewMode(asset, "reject-audit")).map((asset) => asset.id))
+      .toEqual(["rescued", "reject"]);
+  });
+
+  it("resets the cursor when changing review modes without changing review data", () => {
+    const state = createInitialReviewState(assets);
+    const selected = reviewReducer(state, { type: "selectAssets", assetIds: ["fs-001", "fs-002"] });
+    const positioned = { ...selected, cursor: 2 };
+    const changed = reviewReducer(positioned, { type: "setReviewMode", mode: "all" });
+
+    expect(changed.cursor).toBe(0);
+    expect(changed.reviewMode).toBe("all");
+    expect(changed.gridSelection).toEqual(positioned.gridSelection);
+    expect(changed.assets).toEqual(positioned.assets);
+  });
+
   it("keeps AI rejects recoverable but hidden by default", () => {
     const state = createInitialReviewState(assets);
 
@@ -10,6 +49,20 @@ describe("reviewReducer", () => {
 
     const withRejects = reviewReducer(state, { type: "toggleRejects" });
     expect(visibleAssets(withRejects).map((asset) => asset.aiDisposition)).toEqual(["keep", "review", "reject"]);
+    expect(withRejects).toMatchObject({ reviewMode: "all", showAiRejects: true, cursor: 0 });
+
+    const assisted = reviewReducer(withRejects, { type: "toggleRejects" });
+    expect(visibleAssets(assisted).map((asset) => asset.aiDisposition)).toEqual(["keep", "review"]);
+    expect(assisted).toMatchObject({ reviewMode: "assisted", showAiRejects: false, cursor: 0 });
+  });
+
+  it("never exposes an evidence-empty default reject through reject-only filtering", () => {
+    const pendingReject = { ...assets[2], id: "pending-reject", evidence: [] };
+    const state = createInitialReviewState([pendingReject, assets[2]]);
+    const rejects = reviewReducer(state, { type: "setReviewFilter", filter: "reject" });
+
+    expect(rejects).toMatchObject({ reviewFilter: "reject", reviewMode: "reject-audit", showAiRejects: true });
+    expect(visibleAssets(rejects).map((asset) => asset.id)).toEqual(["fs-003"]);
   });
 
   it("keeps pending and failed proxies out of the review queue", () => {
@@ -142,11 +195,11 @@ describe("reviewReducer", () => {
 
   it("keeps human-rescued AI rejects visible in the normal queue", () => {
     const state = createInitialReviewState(assets);
-    const withRejects = reviewReducer(state, { type: "toggleRejects" });
+    const withRejects = reviewReducer(state, { type: "setReviewMode", mode: "all" });
     const rejectCursor = visibleAssets(withRejects).findIndex((asset) => asset.aiDisposition === "reject");
     const focusedReject = reviewReducer(withRejects, { type: "setCursor", cursor: rejectCursor });
     const selectedReject = reviewReducer(focusedReject, { type: "setDecision", disposition: "select" });
-    const normalQueue = reviewReducer(selectedReject, { type: "toggleRejects" });
+    const normalQueue = reviewReducer(selectedReject, { type: "setReviewMode", mode: "assisted" });
 
     expect(visibleAssets(normalQueue).map((asset) => asset.id)).toContain("fs-003");
     expect(visibleAssets(normalQueue).find((asset) => asset.id === "fs-003")).toMatchObject({
```

## New file: aiReview.ts
```diff
diff --git a/apps/desktop/src/features/review/aiReview.ts b/apps/desktop/src/features/review/aiReview.ts
new file mode 100644
index 0000000..8f3f2c0
--- /dev/null
+++ b/apps/desktop/src/features/review/aiReview.ts
@@ -0,0 +1,16 @@
+import type { AiDisposition, ReviewAsset } from "@framescout/contracts";
+
+export type AiReviewStatus = "pending" | AiDisposition;
+export type ReviewMode = "assisted" | "all" | "reject-audit";
+
+export function aiReviewStatus(asset: ReviewAsset): AiReviewStatus {
+  return asset.evidence.length > 0 ? asset.aiDisposition : "pending";
+}
+
+export function matchesReviewMode(asset: ReviewAsset, mode: ReviewMode): boolean {
+  const status = aiReviewStatus(asset);
+
+  if (mode === "all") return true;
+  if (mode === "reject-audit") return status === "reject";
+  return status !== "reject" || asset.humanDisposition !== "unseen";
+}
```
