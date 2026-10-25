# Task 3 Review Package

## Implementer Report

# Task 3 Report: Selection Toolbar, AI Marks, and Keyboard Behavior

## Status

DONE_WITH_CONCERNS

## Changed Files

- `apps/desktop/src/features/review/SelectionToolbar.tsx` (new): localized shared-mark toolbar with full-result select and current-result clear actions.
- `apps/desktop/src/features/review/AiReviewMark.tsx` (new): persisted AI-status star with localized accessible name and title; pending emits no DOM.
- `apps/desktop/src/features/review/ReviewDesk.tsx`: toolbar integration, shared selection shortcuts, and filmstrip metadata AI marks.
- `apps/desktop/src/features/grid/GridView.tsx`: logical-result IDs before the 240-item render cap, toolbar integration, scoped shortcuts, and grid metadata AI marks.
- `apps/desktop/src/App.tsx`: language wiring for Grid and editable-target / modified-review-shortcut guarding.
- `apps/desktop/src/styles/app.css`: compact responsive toolbar and non-overlay AI metadata styles.
- `apps/desktop/src/features/grid/GridView.test.ts`: 241-result test proving selection passes every logical ID without dispatching a decision.
- `tests/e2e/review-desk.spec.ts`: select-all/shared-mark/Escape coverage and accessible keep/review mark coverage.

## RED Evidence

1. `npm --workspace @framescout/desktop test -- src/features/grid/GridView.test.ts src/features/review/reviewState.test.ts`
   - Failed as expected: the new Grid test could not find an accessible `Select all` button.
   - Existing reducer suite passed: 19 tests.
2. `npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "select all|AI marks"`
   - Failed as expected before implementation: `Select all` was absent and `AI keep` / `AI review` accessible marks were absent.

## GREEN Evidence

1. `npm --workspace @framescout/desktop test -- src/features/grid/GridView.test.ts src/features/review/reviewState.test.ts`
   - Passed: 2 files, 22 tests.
2. `npm --workspace @framescout/desktop run build`
   - Passed: TypeScript and Vite production build completed successfully.
3. `npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "select all|AI marks"`
   - First post-implementation run: AI marks test passed; shared-selection test failed only because it expected `2 marked` while the Grid's default logical result contains 3 unseen assets.
   - The assertion was corrected to `3 marked` and the selection action was changed to `Ctrl+A` to cover the required shortcut. The follow-up Playwright run did not complete after extended waits and was not restarted on recovery instruction.

## Viewport Results / Blocker

- Build and unit coverage are green.
- Desktop browser execution confirmed accessible AI keep/review marks at 1440x900 before the final selection-count assertion correction.
- Final post-correction Playwright completion, screenshot updates, and explicit 1280x800 overlap validation are blocked by the prior long-running Playwright wait. No snapshots were changed.

## Self-Review

- Grid selection remains separate from human dispositions: toolbar and shortcuts dispatch only `selectAssets`, `clearSelectedAssets`, or `clearGridSelection`.
- Grid scope is derived from all filtered assets before the 240-item render slice; the displayed count uses the complete shared marked set.
- `Ctrl+A` is scoped to each surface's logical result and `Escape` clears the session-wide marked set. Input, select, textarea, and contenteditable targets are ignored; Alt/Meta are ignored by the new surface handlers.
- AI stars use `aiReviewStatus`, render no pending DOM, have localized accessible labels/titles, and sit in filmstrip/grid metadata rather than the image or human-selection position.
- No persistence, source-photo, RAW, AI-runtime, dependency, migration, or Git changes were made.

## Concerns

- Explicit 1280x800 overlap validation and screenshot updates were not part of this focused locator fix; the required targeted E2E grep now passes.

## Locator Fix

- Scoped both `3 marked` assertions in `tests/e2e/review-desk.spec.ts` to the accessible `Marked frames` toolbar region and its status output, avoiding the duplicate top-summary text while preserving the `0 selected` and Escape checks.
- Required verification command: `npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "select all|AI marks" --reporter=line`
- Result: passed, 2 tests in 1.3 minutes.

## Viewport Resolution

- Ran both `chromium-desktop` (1440x900) and `chromium-compact` (1280x800) for Review Desk, Grid, select-all, and AI-mark scenarios. All four behavior scenarios passed; the four visual assertions failed only because the intentional toolbar/star changes made the prior snapshots stale.
- Inspected all four actual screenshots. The selection toolbar did not cover the photo, decision bar, filmstrip, or action rail; compact text did not overlap or stack incoherently.
- Regenerated Review Desk and Grid snapshots for both projects with `--update-snapshots`; result: 4 tests passed.
- Remaining concerns: none.

## P2 Review Fix

### Files

- `tests/e2e/review-desk.spec.ts`: added Review Desk and Grid shortcut guard coverage for input, select, textarea, contenteditable, Alt, and Meta events, plus normal Ctrl+A/Escape controls.
- `apps/desktop/src/features/review/AiReviewMark.test.tsx` (new): added direct pending-no-DOM and persisted keep/review/reject localized accessibility, title, and status-class coverage.
- `.superpowers/sdd/task-3-report.md`: appended this recovery record.

### Verification

1. `npm --workspace @framescout/desktop test -- src/features/review/AiReviewMark.test.tsx src/features/grid/GridView.test.ts src/features/review/reviewState.test.ts`
   - Passed: 3 files, 25 tests, 0 failures.
2. `npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "select all|AI marks|shortcuts ignore" --reporter=line`
   - First run: failed, 2 passed and 1 failed. The new guard test expected `2 marked` after its initial Ctrl+A but received `0 marked`; temporary editable fixture setup had been injected before the normal shortcut baseline.
   - Second run: failed, 2 passed and 1 failed. The same initial Review Desk Ctrl+A baseline received `0 marked`; the test was updated to enter Review Desk through Grid before that baseline, matching the existing shortcut-test interaction path.
   - Final rerun of the exact command was interrupted before completion. No pass/fail count is available for that run, and it was not restarted per recovery instruction.

### Blocker

- Required expanded Task 3 Playwright verification is incomplete because the final retry was interrupted before producing output. The current test edits are preserved; no production code was modified.

### P2 Verification Resolution

- Re-ran the new shortcut-guard scenario alone with `npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "shortcuts ignore" --reporter=line`.
- Result: 1 test passed in 1.3 minutes. The earlier missing final result was caused by interrupted agent waiting, not a current assertion failure.
- Combined focused Vitest evidence remains 3 files and 25 tests passed. Remaining concerns: none.

## Diff: apps/desktop/src/features/grid/GridView.test.ts
```diff
diff --git a/.superpowers/sdd/task-3-before/apps__desktop__src__features__grid__GridView.test.ts b/apps/desktop/src/features/grid/GridView.test.ts
index 5238fc8..402421a 100644
--- a/.superpowers/sdd/task-3-before/apps__desktop__src__features__grid__GridView.test.ts
+++ b/apps/desktop/src/features/grid/GridView.test.ts
@@ -1,5 +1,9 @@
-import { describe, expect, it } from "vitest";
-import { moveGalleryCursor } from "./GridView";
+import { createElement } from "react";
+import { fireEvent, render, screen } from "@testing-library/react";
+import { describe, expect, it, vi } from "vitest";
+import { assets } from "../../data/fixtures";
+import { GridView, moveGalleryCursor } from "./GridView";
+import { createInitialReviewState } from "../review/reviewState";
 
 describe("moveGalleryCursor", () => {
   it("moves within rows without wrapping across row edges", () => {
@@ -13,4 +17,36 @@ describe("moveGalleryCursor", () => {
     expect(moveGalleryCursor(1, "s", 4, 3)).toBe(1);
     expect(moveGalleryCursor(5, "w", 4, 8)).toBe(1);
   });
+
+  it("selects every logical filtered result beyond the 240-tile render cap without changing decisions", () => {
+    const logicalAssets = Array.from({ length: 241 }, (_, index) => ({
+      ...assets[0],
+      id: `logical-${index}`,
+      humanDisposition: "unseen" as const,
+      previewState: "fixture" as const
+    }));
+    const baseline = structuredClone(logicalAssets);
+    const dispatch = vi.fn();
+
+    render(createElement(GridView, {
+      language: "en",
+      state: createInitialReviewState(logicalAssets),
+      dispatch,
+      exportPreview: null,
+      onExportPreview: vi.fn(),
+      manualTagDraft: "",
+      onManualTagDraftChange: vi.fn(),
+      onApplyManualTag: vi.fn(),
+      onOpenDuel: vi.fn()
+    }));
+
+    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
+
+    expect(dispatch).toHaveBeenCalledWith({
+      type: "selectAssets",
+      assetIds: logicalAssets.map((asset) => asset.id)
+    });
+    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setDecisionForMany" }));
+    expect(logicalAssets).toEqual(baseline);
+  });
 });
```

## Diff: apps/desktop/src/App.tsx
```diff
diff --git a/.superpowers/sdd/task-3-before/apps__desktop__src__App.tsx b/apps/desktop/src/App.tsx
index a90740f..052469a 100644
--- a/.superpowers/sdd/task-3-before/apps__desktop__src__App.tsx
+++ b/apps/desktop/src/App.tsx
@@ -77,6 +77,13 @@ function shortcutFromEvent(event: KeyboardEvent): string | null {
   return [...parts, key].join("+");
 }
 
+function isEditableTarget(target: EventTarget | null): boolean {
+  return target instanceof HTMLInputElement
+    || target instanceof HTMLSelectElement
+    || target instanceof HTMLTextAreaElement
+    || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("[contenteditable=true]"))));
+}
+
 const nav = [
   { screen: "projects" as const, label: { zh: "项目", en: "Projects" }, icon: FolderOpen },
   { screen: "import" as const, label: { zh: "导入", en: "Import" }, icon: Import },
@@ -277,7 +284,7 @@ export function App({ runtimeProjectClient }: { runtimeProjectClient: RuntimePro
 
   useEffect(() => {
     const onKeyDown = (event: KeyboardEvent) => {
-      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
+      if (isEditableTarget(event.target)) return;
       const key = event.key.toLowerCase();
       if (event.key === "?") {
         setShortcutOverlay(true);
@@ -336,12 +343,12 @@ export function App({ runtimeProjectClient }: { runtimeProjectClient: RuntimePro
         dispatch({ type: "toggleInspector" });
         return;
       }
-      if (screen === "review" && key === "a") {
+      if (screen === "review" && key === "a" && !event.ctrlKey && !event.altKey && !event.metaKey) {
         event.preventDefault();
         dispatch({ type: "previous" });
         return;
       }
-      if (screen === "review" && key === "d") {
+      if (screen === "review" && key === "d" && !event.ctrlKey && !event.altKey && !event.metaKey) {
         event.preventDefault();
         dispatch({ type: "next" });
         return;
@@ -779,6 +786,7 @@ export function App({ runtimeProjectClient }: { runtimeProjectClient: RuntimePro
       {screen === "review" && <ReviewDesk language={language} state={state} dispatch={dispatch} projectPreset={project.preset} selectionTargetCount={selectionTargetCount} onProjectPresetChange={updateProjectPolicy} onSelectionTargetChange={updateSelectionTarget} onMarkMissing={markAssetMissing} onRelinkAsset={relinkAsset} onOpenDuel={openDuel} onApplyManualTag={applyManualTag} />}
       {screen === "grid" && (
         <GridView
+          language={language}
           state={state}
           dispatch={dispatch}
           exportPreview={exportPreview}
```

## Diff: apps/desktop/src/styles/app.css
```diff
diff --git a/.superpowers/sdd/task-3-before/apps__desktop__src__styles__app.css b/apps/desktop/src/styles/app.css
index 3d251c9..eb34f1c 100644
--- a/.superpowers/sdd/task-3-before/apps__desktop__src__styles__app.css
+++ b/apps/desktop/src/styles/app.css
@@ -2966,6 +2966,96 @@ summary {
   display: inline !important;
 }
 
+/* Session marks are deliberately separate from editorial decisions. */
+.selection-toolbar {
+  min-width: 0;
+  display: flex;
+  align-items: center;
+  gap: 6px;
+  padding: 5px 10px;
+  border-top: 1px solid var(--fs-line);
+  border-bottom: 1px solid var(--fs-line);
+  background: var(--fs-surface-1);
+  color: var(--fs-text-muted);
+}
+
+.selection-toolbar-label,
+.selection-toolbar-count {
+  overflow: hidden;
+  font-size: 11px;
+  text-overflow: ellipsis;
+  white-space: nowrap;
+}
+
+.selection-toolbar-label { color: var(--fs-text-primary); font-weight: 700; }
+.selection-toolbar-count { margin-left: auto; font-family: "JetBrains Mono", Consolas, monospace; }
+
+.selection-toolbar-command {
+  min-height: 26px;
+  min-width: 0;
+  display: inline-flex;
+  align-items: center;
+  gap: 5px;
+  padding: 0 7px;
+  border: 1px solid var(--fs-line);
+  border-radius: var(--fs-radius-control);
+  background: var(--fs-canvas);
+  color: var(--fs-text-primary);
+  cursor: pointer;
+  font-size: 11px;
+  white-space: nowrap;
+}
+
+.selection-toolbar-command:hover:not(:disabled) { border-color: var(--fs-focus); color: var(--fs-brand); }
+.selection-toolbar-command:disabled { cursor: not-allowed; opacity: 0.45; }
+.selection-toolbar-command:focus-visible { outline: 2px solid var(--fs-focus); outline-offset: 2px; }
+
+.review-shell .stage-column { grid-template-rows: 54px minmax(0, 1fr) 38px 68px 106px; }
+.review-shell .thumb { height: 82px; display: grid; grid-template-rows: minmax(0, 1fr) 20px; }
+.review-shell .thumb img { grid-row: 1; min-height: 0; }
+.review-shell .thumb .filmstrip-meta {
+  position: static;
+  grid-row: 2;
+  min-width: 0;
+  display: flex;
+  align-items: center;
+  gap: 5px;
+  padding: 0 5px;
+  background: #080A0D;
+  color: var(--fs-text-muted);
+  font-size: 10px;
+  overflow: hidden;
+}
+.filmstrip-meta > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
+
+.ai-review-mark { width: 16px; height: 16px; display: inline-grid; flex: 0 0 auto; place-items: center; }
+.ai-review-mark.keep { color: var(--fs-keep); }
+.ai-review-mark.review { color: var(--fs-review); }
+.ai-review-mark.reject { color: var(--fs-reject); }
+
+.grid-thumb-meta {
+  min-width: 0;
+  display: grid;
+  grid-template-columns: 16px minmax(0, 1fr) auto;
+  align-items: center;
+  gap: 6px;
+  padding: 0 8px;
+  background: #080A0D;
+  color: var(--fs-text-muted);
+}
+.grid-thumb-meta > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
+.grid-thumb-meta small { color: var(--fs-text-muted); font-size: 10px; white-space: nowrap; }
+.contact-thumb .grid-thumb-meta { position: static; min-height: 28px; }
+
+.bulk-actions > .selection-toolbar { align-items: stretch; flex-direction: column; gap: 5px; padding: 7px; }
+.bulk-actions .selection-toolbar-label { overflow: visible; }
+.bulk-actions .selection-toolbar-command { justify-content: flex-start; }
+.bulk-actions .selection-toolbar-count { margin-left: 0; }
+
+@container (max-width: 980px) {
+  .selection-toolbar-label { display: none; }
+}
+
 @container (max-width: 720px) {
   .topbar-meta { gap: 5px; }
   .analysis-profile-trigger { padding-inline: 7px; }
```

## Diff: apps/desktop/src/features/review/ReviewDesk.tsx
```diff
diff --git a/.superpowers/sdd/task-3-before/apps__desktop__src__features__review__ReviewDesk.tsx b/apps/desktop/src/features/review/ReviewDesk.tsx
index 813d6f1..328fe28 100644
--- a/.superpowers/sdd/task-3-before/apps__desktop__src__features__review__ReviewDesk.tsx
+++ b/apps/desktop/src/features/review/ReviewDesk.tsx
@@ -22,8 +22,8 @@ import {
 } from "lucide-react";
 import type { ReviewAction, ReviewState } from "./reviewState";
 import { hasReviewPreview, visibleAssets } from "./reviewState";
-
-type UiLanguage = "zh" | "en";
+import { AiReviewMark } from "./AiReviewMark";
+import { SelectionToolbar, type UiLanguage } from "./SelectionToolbar";
 
 const reviewCopy = {
   zh: {
@@ -78,6 +78,13 @@ function localizedSignal(language: UiLanguage, label: string, value: string) {
   return { label: translation?.label ?? label, value: translation?.values?.[value] ?? value };
 }
 
+function isEditableTarget(target: EventTarget | null): boolean {
+  return target instanceof HTMLInputElement
+    || target instanceof HTMLSelectElement
+    || target instanceof HTMLTextAreaElement
+    || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("[contenteditable=true]"))));
+}
+
 function AiEvidencePanel({ asset, language }: { asset: ReviewAsset; language: UiLanguage }) {
   const text = reviewCopy[language];
   const confidences = asset.evidence.flatMap((signal) => signal.confidence == null ? [] : [signal.confidence]);
@@ -265,6 +272,7 @@ export function ReviewDesk({
 }) {
   const text = reviewCopy[language];
   const queue = visibleAssets(state);
+  const resultIds = queue.map((item) => item.id);
   const asset = queue[state.cursor] ?? queue[0];
   const filmstripStart = Math.max(0, Math.min(queue.length - 48, state.cursor - 24));
   const filmstripAssets = queue.slice(filmstripStart, filmstripStart + 48);
@@ -279,6 +287,23 @@ export function ReviewDesk({
     recommended: reviewableAssets.filter((item) => item.aiRecommended).length
   };
 
+  useEffect(() => {
+    const onKeyDown = (event: KeyboardEvent) => {
+      if (isEditableTarget(event.target) || event.altKey || event.metaKey) return;
+      if (event.ctrlKey && event.key.toLowerCase() === "a") {
+        event.preventDefault();
+        dispatch({ type: "selectAssets", assetIds: resultIds });
+        return;
+      }
+      if (event.key === "Escape") {
+        event.preventDefault();
+        dispatch({ type: "clearGridSelection" });
+      }
+    };
+    window.addEventListener("keydown", onKeyDown);
+    return () => window.removeEventListener("keydown", onKeyDown);
+  }, [dispatch, resultIds]);
+
   if (!asset) return <section className="review-desk empty-review" aria-label="Review Desk">{text.noMatch}</section>;
 
   const displayUrl = asset.displayUrl ?? asset.previewUrl;
@@ -322,6 +347,7 @@ export function ReviewDesk({
           {state.loupeOpen && <div className="loupe"><ScanSearch size={16} /><img src={displayUrl} alt="" /><span>{text.focus}</span></div>}
           {!state.showAiRejects && <div className="recoverable-note"><EyeOff size={14} /> {text.rejectsHidden}</div>}
         </div>
+        <SelectionToolbar language={language} resultIds={resultIds} selectedIds={state.gridSelection} dispatch={dispatch} />
         <div className="decision-bar" aria-label={text.setDecision}>
           <button className={`decision candidate${asset.humanDisposition === "candidate" ? " active" : ""}`} aria-pressed={asset.humanDisposition === "candidate"} onClick={() => decide("candidate")}><Bookmark size={18} /><span>{text.decision.candidate}</span><kbd>1</kbd></button>
           <button className={`decision select${asset.humanDisposition === "select" ? " active" : ""}`} aria-pressed={asset.humanDisposition === "select"} onClick={() => decide("select")}><Check size={19} /><span>{text.decision.select}</span><kbd>2</kbd></button>
@@ -333,7 +359,8 @@ export function ReviewDesk({
           <div className="filmstrip-frames">
             {filmstripAssets.map((item, index) => (
               <button className={item.id === asset.id ? "thumb active" : "thumb"} key={item.id} onClick={() => dispatch({ type: "setCursor", cursor: filmstripStart + index })} title={item.fileName}>
-                <img loading="lazy" src={item.previewUrl} alt={item.fileName} /><span>{text.human[item.humanDisposition]}</span>
+                <img loading="lazy" src={item.previewUrl} alt={item.fileName} />
+                <span className="filmstrip-meta"><AiReviewMark asset={item} language={language} /><span>{text.human[item.humanDisposition]}</span></span>
               </button>
             ))}
           </div>
```

## Diff: apps/desktop/src/features/grid/GridView.tsx
```diff
diff --git a/.superpowers/sdd/task-3-before/apps__desktop__src__features__grid__GridView.tsx b/apps/desktop/src/features/grid/GridView.tsx
index ef09c7b..a832b39 100644
--- a/.superpowers/sdd/task-3-before/apps__desktop__src__features__grid__GridView.tsx
+++ b/apps/desktop/src/features/grid/GridView.tsx
@@ -1,6 +1,8 @@
 import { type CSSProperties, type Dispatch, useEffect, useMemo, useState } from "react";
 import type { ExportPreviewResponse } from "@framescout/contracts";
-import { Check, CircleAlert, Search, Tag, X } from "lucide-react";
+import { Search, Tag } from "lucide-react";
+import { AiReviewMark } from "../review/AiReviewMark";
+import { SelectionToolbar, type UiLanguage } from "../review/SelectionToolbar";
 import { hasReviewPreview, type ReviewAction, type ReviewState } from "../review/reviewState";
 
 type GridFilter = "needs-review" | "no-athlete" | "soft-focus" | "selected" | "matchday-story";
@@ -22,6 +24,13 @@ function matchesFilter(asset: ReviewState["assets"][number], filter: GridFilter)
   return asset.humanDisposition === "unseen";
 }
 
+function isEditableTarget(target: EventTarget | null): boolean {
+  return target instanceof HTMLInputElement
+    || target instanceof HTMLSelectElement
+    || target instanceof HTMLTextAreaElement
+    || (target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("[contenteditable=true]"))));
+}
+
 export function moveGalleryCursor(current: number, key: "w" | "a" | "s" | "d", columns: number, length: number): number {
   const rowStart = Math.floor(current / columns) * columns;
   const rowEnd = Math.min(rowStart + columns - 1, length - 1);
@@ -33,6 +42,7 @@ export function moveGalleryCursor(current: number, key: "w" | "a" | "s" | "d", c
 }
 
 export function GridView({
+  language,
   state,
   dispatch,
   exportPreview,
@@ -42,6 +52,7 @@ export function GridView({
   onApplyManualTag,
   onOpenDuel
 }: {
+  language: UiLanguage;
   state: ReviewState;
   dispatch: Dispatch<ReviewAction>;
   exportPreview: ExportPreviewResponse | null;
@@ -62,6 +73,7 @@ export function GridView({
     const query = tagQuery.trim().toLowerCase();
     return state.assets.filter((asset) => hasReviewPreview(asset) && matchesFilter(asset, activeFilter) && (!query || asset.tags.some((tag) => tag.toLowerCase().includes(query)) || asset.reasons.some((reason) => reason.toLowerCase().includes(query))));
   }, [activeFilter, state.assets, tagQuery]);
+  const resultIds = filteredAssets.map((asset) => asset.id);
 
   useEffect(() => {
     setKeyboardCursor((current) => Math.min(current, Math.max(filteredAssets.length - 1, 0)));
@@ -75,8 +87,19 @@ export function GridView({
 
   useEffect(() => {
     const onKeyDown = (event: KeyboardEvent) => {
-      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
+      if (isEditableTarget(event.target) || event.altKey || event.metaKey) return;
       const key = event.key.toLowerCase();
+      if (event.ctrlKey && key === "a") {
+        event.preventDefault();
+        dispatch({ type: "selectAssets", assetIds: resultIds });
+        return;
+      }
+      if (event.key === "Escape") {
+        event.preventDefault();
+        dispatch({ type: "clearGridSelection" });
+        return;
+      }
+      if (event.ctrlKey) return;
       if (!["w", "a", "s", "d"].includes(key) || renderedAssets.length === 0) return;
       event.preventDefault();
       setKeyboardCursor((current) => {
@@ -91,7 +114,7 @@ export function GridView({
     };
     window.addEventListener("keydown", onKeyDown);
     return () => window.removeEventListener("keydown", onKeyDown);
-  }, [renderedAssets.length, state.gridDensity]);
+  }, [dispatch, renderedAssets.length, resultIds, state.gridDensity]);
   const applyManualTag = () => {
     onApplyManualTag(selectedAssetIds, manualTagDraft);
     onManualTagDraftChange("");
@@ -118,7 +141,6 @@ export function GridView({
       </aside>
       <div className="contact-sheet" style={{ "--grid-columns": state.gridDensity } as CSSProperties}>
         {renderedAssets.map((asset, index) => {
-          const Icon = asset.aiDisposition === "keep" ? Check : asset.aiDisposition === "review" ? CircleAlert : X;
           return (
             <button
               className={`contact-thumb ${asset.aiDisposition} ${selectedAssetIds.includes(asset.id) ? "selected" : ""} ${keyboardCursor === index ? "keyboard-current" : ""}`}
@@ -129,8 +151,11 @@ export function GridView({
               aria-pressed={selectedAssetIds.includes(asset.id)}
             >
               <img loading="lazy" src={asset.previewUrl} alt="" />
-              <span><Icon size={14} /> {asset.fileName}</span>
-              <small>{asset.humanDisposition}</small>
+              <div className="grid-thumb-meta">
+                <AiReviewMark asset={asset} language={language} />
+                <span>{asset.fileName}</span>
+                <small>{asset.humanDisposition}</small>
+              </div>
             </button>
           );
         })}
@@ -143,6 +168,7 @@ export function GridView({
       </div>
       <aside className="bulk-actions">
         <strong>Actions</strong>
+        <SelectionToolbar language={language} resultIds={resultIds} selectedIds={selectedAssetIds} dispatch={dispatch} />
         <span className="grid-density"><kbd>[</kbd><kbd>]</kbd> {state.gridDensity} columns</span>
         <label className="bulk-decision-control">
           <span>Decision</span>
```

## Diff: tests/e2e/review-desk.spec.ts
```diff
diff --git a/.superpowers/sdd/task-3-before/tests__e2e__review-desk.spec.ts b/tests/e2e/review-desk.spec.ts
index 02b52c2..4c1010b 100644
--- a/.superpowers/sdd/task-3-before/tests__e2e__review-desk.spec.ts
+++ b/tests/e2e/review-desk.spec.ts
@@ -83,6 +83,80 @@ test("grid batch decision changes only explicitly marked frames", async ({ page
   await expect(page.locator("button.contact-thumb")).toContainText("6D2_7423.CR2");
 });
 
+test("select all shares marked frames across Grid and Review Desk without changing human picks", async ({ page }) => {
+  await page.goto("/");
+  await page.getByRole("button", { name: "Grid" }).click();
+
+  await page.keyboard.press("Control+A");
+  const selectionToolbar = page.getByRole("region", { name: "Marked frames" });
+  await expect(selectionToolbar.getByRole("status")).toHaveText("3 marked");
+  await expect(page.getByText("0 selected")).toBeVisible();
+
+  await page.getByRole("button", { name: "Review Desk" }).click();
+  await expect(selectionToolbar.getByRole("status")).toHaveText("3 marked");
+  await expect(page.getByText("0 selected")).toBeVisible();
+
+  await page.keyboard.press("Escape");
+  await expect(page.getByText("0 marked")).toBeVisible();
+  await expect(page.getByText("0 selected")).toBeVisible();
+});
+
+test("select-all and clear shortcuts ignore editable and modified events on Review Desk and Grid", async ({ page }) => {
+  await page.goto("/");
+  await page.getByRole("button", { name: "Grid" }).click();
+  await page.getByRole("button", { name: "Review Desk" }).click();
+  const markedCount = page.getByRole("region", { name: "Marked frames" }).getByRole("status");
+
+  await page.keyboard.press("Control+A");
+  await expect(markedCount).toHaveText("2 marked");
+  await page.keyboard.press("Escape");
+  await expect(markedCount).toHaveText("0 marked");
+  await page.keyboard.press("Control+A");
+  await expect(markedCount).toHaveText("2 marked");
+
+  await page.evaluate(() => {
+    document.body.insertAdjacentHTML("beforeend", `
+      <input id="task-3-input" />
+      <select id="task-3-select"><option>Option</option></select>
+      <textarea id="task-3-textarea"></textarea>
+      <div id="task-3-contenteditable" contenteditable="true"></div>
+    `);
+  });
+
+  const assertShortcutGuards = async (count: string) => {
+    for (const target of ["#task-3-input", "#task-3-select", "#task-3-textarea", "#task-3-contenteditable"]) {
+      for (const shortcut of ["Control+A", "Escape", "Alt+Control+A", "Alt+Escape", "Meta+A", "Meta+Escape"]) {
+        await page.locator(target).press(shortcut);
+        await expect(markedCount).toHaveText(count);
+      }
+    }
+  };
+
+  await assertShortcutGuards("2 marked");
+  await page.getByRole("button", { name: "Review Desk" }).click();
+  await page.keyboard.press("Escape");
+  await expect(markedCount).toHaveText("0 marked");
+
+  await page.getByRole("button", { name: "Grid" }).click();
+  await page.keyboard.press("Control+A");
+  await expect(markedCount).toHaveText("3 marked");
+  await assertShortcutGuards("3 marked");
+  await page.getByRole("button", { name: "Grid" }).click();
+  await page.keyboard.press("Escape");
+  await expect(markedCount).toHaveText("0 marked");
+});
+
+test("AI marks expose persisted keep and review states", async ({ page }) => {
+  await page.goto("/");
+
+  await expect(page.getByLabel("AI keep").first()).toHaveAttribute("title", "AI keep");
+  await expect(page.getByLabel("AI review").first()).toHaveAttribute("title", "AI review");
+
+  await page.getByRole("button", { name: "Grid" }).click();
+  await expect(page.getByLabel("AI keep").first()).toBeVisible();
+  await expect(page.getByLabel("AI review").first()).toBeVisible();
+});
+
 test("grid density responds to bracket shortcuts within the supported range", async ({ page }) => {
   await page.goto("/");
   await page.getByRole("button", { name: "Grid" }).click();
```

## New file: apps/desktop/src/features/review/SelectionToolbar.tsx
```diff
diff --git a/apps/desktop/src/features/review/SelectionToolbar.tsx b/apps/desktop/src/features/review/SelectionToolbar.tsx
new file mode 100644
index 0000000..a6ebc2c
--- /dev/null
+++ b/apps/desktop/src/features/review/SelectionToolbar.tsx
@@ -0,0 +1,36 @@
+import type { Dispatch } from "react";
+import { CheckCheck, Eraser } from "lucide-react";
+import type { ReviewAction } from "./reviewState";
+
+export type UiLanguage = "zh" | "en";
+export type ReviewDispatch = Dispatch<ReviewAction>;
+
+const selectionCopy = {
+  zh: { group: "\u5df2\u6807\u8bb0\u9879\u76ee", selectAll: "\u5168\u9009", clearCurrentResult: "\u6e05\u9664\u5f53\u524d\u7ed3\u679c", marked: "\u5df2\u6807\u8bb0" },
+  en: { group: "Marked frames", selectAll: "Select all", clearCurrentResult: "Clear current result", marked: "marked" }
+} as const;
+
+export function SelectionToolbar({ language, resultIds, selectedIds, dispatch }: {
+  language: UiLanguage;
+  resultIds: string[];
+  selectedIds: string[];
+  dispatch: ReviewDispatch;
+}) {
+  const text = selectionCopy[language];
+  const resultIdSet = new Set(resultIds);
+  const selectedResultCount = selectedIds.filter((assetId) => resultIdSet.has(assetId)).length;
+  const allResultsMarked = resultIds.length > 0 && resultIds.every((assetId) => selectedIds.includes(assetId));
+
+  return (
+    <section className="selection-toolbar" aria-label={text.group}>
+      <span className="selection-toolbar-label">{text.group}</span>
+      <button type="button" className="selection-toolbar-command" onClick={() => dispatch({ type: "selectAssets", assetIds: resultIds })} disabled={resultIds.length === 0 || allResultsMarked}>
+        <CheckCheck size={15} aria-hidden="true" /><span>{text.selectAll}</span>
+      </button>
+      <button type="button" className="selection-toolbar-command" onClick={() => dispatch({ type: "clearSelectedAssets", assetIds: resultIds })} disabled={selectedResultCount === 0}>
+        <Eraser size={14} aria-hidden="true" /><span>{text.clearCurrentResult}</span>
+      </button>
+      <output className="selection-toolbar-count" aria-live="polite">{selectedIds.length} {text.marked}</output>
+    </section>
+  );
+}
```

## New file: apps/desktop/src/features/review/AiReviewMark.tsx
```diff
diff --git a/apps/desktop/src/features/review/AiReviewMark.tsx b/apps/desktop/src/features/review/AiReviewMark.tsx
new file mode 100644
index 0000000..0c1bdaf
--- /dev/null
+++ b/apps/desktop/src/features/review/AiReviewMark.tsx
@@ -0,0 +1,16 @@
+import { Star } from "lucide-react";
+import type { ReviewAsset } from "@framescout/contracts";
+import { aiReviewStatus } from "./aiReview";
+import type { UiLanguage } from "./SelectionToolbar";
+
+const aiMarkCopy = {
+  zh: { keep: "AI \u4fdd\u7559", review: "AI \u590d\u6838", reject: "AI \u6dd8\u6c70" },
+  en: { keep: "AI keep", review: "AI review", reject: "AI reject" }
+} as const;
+
+export function AiReviewMark({ asset, language }: { asset: ReviewAsset; language: UiLanguage }) {
+  const status = aiReviewStatus(asset);
+  if (status === "pending") return null;
+  const label = aiMarkCopy[language][status];
+  return <span className={`ai-review-mark ${status}`} role="img" aria-label={label} title={label}><Star size={14} fill="currentColor" aria-hidden="true" /></span>;
+}
```

## New file: apps/desktop/src/features/review/AiReviewMark.test.tsx
```diff
diff --git a/apps/desktop/src/features/review/AiReviewMark.test.tsx b/apps/desktop/src/features/review/AiReviewMark.test.tsx
new file mode 100644
index 0000000..5741f2f
--- /dev/null
+++ b/apps/desktop/src/features/review/AiReviewMark.test.tsx
@@ -0,0 +1,34 @@
+import { createElement } from "react";
+import { render, screen } from "@testing-library/react";
+import { describe, expect, it } from "vitest";
+import { assets } from "../../data/fixtures";
+import { AiReviewMark } from "./AiReviewMark";
+
+describe("AiReviewMark", () => {
+  it("renders no mark for an asset without persisted AI evidence", () => {
+    const { container } = render(createElement(AiReviewMark, {
+      asset: { ...assets[0], evidence: [] },
+      language: "en"
+    }));
+
+    expect(screen.queryByRole("img")).not.toBeInTheDocument();
+    expect(container.querySelector(".ai-review-mark")).toBeNull();
+  });
+
+  it.each([
+    ["en", ["AI keep", "AI review", "AI reject"]],
+    ["zh", ["AI \u4fdd\u7559", "AI \u590d\u6838", "AI \u6dd8\u6c70"]]
+  ] as const)("renders localized persisted marks in %s", (language, labels) => {
+    const { unmount } = render(createElement("div", null,
+      ...assets.map((asset) => createElement(AiReviewMark, { key: asset.id, asset, language }))
+    ));
+
+    assets.forEach((asset, index) => {
+      const mark = screen.getByRole("img", { name: labels[index] });
+      expect(mark).toHaveAttribute("title", labels[index]);
+      expect(mark).toHaveClass("ai-review-mark", asset.aiDisposition);
+    });
+
+    unmount();
+  });
+});
```

## Updated visual baselines
- grid-chromium-compact-win32.png: B7DC0FE046FFA5DDB3EF11294CCBD866DDE187E75554F2D47EF431C73A34B773
- grid-chromium-desktop-win32.png: AC2384C356C7C3233549338FF6DB049A6F9285090CA2CD439941C068183CCAD3
- review-desk-chromium-compact-win32.png: 75524F1BA05281A31E6359F0D843B8D8EEBBCFDA2227F54EC5C359E58824FCF8
- review-desk-chromium-desktop-win32.png: B39A994C0C17030F488941306689D1719ED4B0043E050337829437F359A76B17
