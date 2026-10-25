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
