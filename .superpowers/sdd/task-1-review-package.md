# Task 1 Review Package

## Implementer Report

# Task 1 Report

status: DONE

## Exact files changed

- `apps/desktop/src/features/review/reviewState.ts`
- `apps/desktop/src/features/review/reviewState.test.ts`
- `.superpowers/sdd/task-1-report.md`

## RED

Command: `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts`

The new tests failed as expected: 2 failed and 13 passed. Both failures showed that the new selection actions left `gridSelection` empty.

## GREEN

Command: `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts`

Result: 1 test file passed; 15 tests passed, 0 failed.

## Self-review findings

- Added only the requested `selectAssets` and `clearSelectedAssets` action variants and reducer branches.
- `selectAssets` filters absent IDs, preserves existing marked IDs, removes duplicates, and leaves `assets` untouched.
- `clearSelectedAssets` removes only requested IDs when provided and clears the complete marked set when omitted.
- Selection changes do not update human dispositions, tags, AI results, history, future state, or source files.
- Existing selection behavior remains available through `gridSelection` and the prior actions.

## Concerns

none

## Review Fix

Exact change: Updated the 1,000-asset `selectAssets` test to capture an independent `structuredClone` baseline before dispatch, then assert both `selected.assets` and the input `state.assets` remain equal to that baseline. The existing complete-selection, absent-ID, and duplicate-ID semantics assertion remains unchanged.

Command: `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts`

Result: 1 test file passed; 15 tests passed, 0 failed.

Self-review: The baseline is independent of the fixture and reducer state references, so an in-place mutation of a human disposition, tag array, or other asset field would fail against it. Both output and input state are checked, and no production code or unrelated test behavior changed.

## Diff: reviewState.ts
```diff
diff --git a/.superpowers/sdd/task-1-before/reviewState.ts b/apps/desktop/src/features/review/reviewState.ts
index 3fea54f..6bb1f03 100644
--- a/.superpowers/sdd/task-1-before/reviewState.ts
+++ b/apps/desktop/src/features/review/reviewState.ts
@@ -33,6 +33,8 @@ export type ReviewAction =
   | { type: "setDecisionForMany"; assetIds: string[]; disposition: Exclude<HumanDisposition, "unseen"> }
   | { type: "toggleGridSelection"; assetId: string }
   | { type: "clearGridSelection" }
+  | { type: "selectAssets"; assetIds: string[] }
+  | { type: "clearSelectedAssets"; assetIds?: string[] }
   | { type: "adjustGridDensity"; delta: -1 | 1 }
   | { type: "applyManualTag"; assetIds: string[]; tag: string }
   | { type: "removeManualTag"; assetIds: string[]; tag: string }
@@ -181,6 +183,24 @@ export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewS
     }
     case "clearGridSelection":
       return state.gridSelection.length === 0 ? state : { ...state, gridSelection: [] };
+    case "selectAssets": {
+      const assetIds = new Set(state.assets.map((asset) => asset.id));
+      const selected = new Set(state.gridSelection);
+      for (const assetId of action.assetIds) {
+        if (assetIds.has(assetId)) selected.add(assetId);
+      }
+      const gridSelection = Array.from(selected);
+      return gridSelection.length === state.gridSelection.length
+        && gridSelection.every((assetId, index) => assetId === state.gridSelection[index])
+        ? state
+        : { ...state, gridSelection };
+    }
+    case "clearSelectedAssets": {
+      if (!action.assetIds) return state.gridSelection.length === 0 ? state : { ...state, gridSelection: [] };
+      const idsToClear = new Set(action.assetIds);
+      const gridSelection = state.gridSelection.filter((assetId) => !idsToClear.has(assetId));
+      return gridSelection.length === state.gridSelection.length ? state : { ...state, gridSelection };
+    }
     case "adjustGridDensity":
       return { ...state, gridDensity: Math.max(3, Math.min(8, state.gridDensity + action.delta)) };
     case "applyManualTag": {
```

## Diff: reviewState.test.ts
```diff
diff --git a/.superpowers/sdd/task-1-before/reviewState.test.ts b/apps/desktop/src/features/review/reviewState.test.ts
index d64027d..4d30ed0 100644
--- a/.superpowers/sdd/task-1-before/reviewState.test.ts
+++ b/apps/desktop/src/features/review/reviewState.test.ts
@@ -94,6 +94,44 @@ describe("reviewReducer", () => {
     expect(reviewReducer(decided, { type: "clearGridSelection" }).gridSelection).toEqual([]);
   });
 
+  it("marks every logical session asset without changing decisions or tags", () => {
+    const sessionAssets = Array.from({ length: 1000 }, (_, index) => ({
+      ...assets[0],
+      id: `session-${index}`,
+      humanDisposition: index % 2 === 0 ? "select" as const : "hold" as const,
+      tags: [`tag-${index}`]
+    }));
+    const assetBaseline = structuredClone(sessionAssets);
+    const state = createInitialReviewState(sessionAssets);
+    const selected = reviewReducer(state, {
+      type: "selectAssets",
+      assetIds: [...sessionAssets.map((asset) => asset.id), "absent", "session-1"]
+    });
+
+    expect(selected.gridSelection).toEqual(sessionAssets.map((asset) => asset.id));
+    expect(selected.assets).toEqual(assetBaseline);
+    expect(state.assets).toEqual(assetBaseline);
+  });
+
+  it("clears only requested marked assets or the whole marked set", () => {
+    const sessionAssets = Array.from({ length: 1000 }, (_, index) => ({ ...assets[0], id: `session-${index}` }));
+    const state = createInitialReviewState(sessionAssets);
+    const selected = reviewReducer(state, {
+      type: "selectAssets",
+      assetIds: sessionAssets.map((asset) => asset.id)
+    });
+    const partiallyCleared = reviewReducer(selected, {
+      type: "clearSelectedAssets",
+      assetIds: ["session-417", "absent"]
+    });
+
+    expect(partiallyCleared.gridSelection).toHaveLength(999);
+    expect(partiallyCleared.gridSelection).not.toContain("session-417");
+    expect(partiallyCleared.gridSelection[416]).toBe("session-416");
+    expect(partiallyCleared.gridSelection[417]).toBe("session-418");
+    expect(reviewReducer(partiallyCleared, { type: "clearSelectedAssets" }).gridSelection).toEqual([]);
+  });
+
   it("clamps Grid density to the supported three-to-eight column range", () => {
     let state = createInitialReviewState(assets);
     for (let index = 0; index < 8; index += 1) state = reviewReducer(state, { type: "adjustGridDensity", delta: 1 });
```
