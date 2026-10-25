# Task 1: Shared Session Selection Reducer

## Role In FrameScout

Implement the state foundation for one-click selection across every asset in the current logical session/filter result. Selection is a temporary marked-ID collection shared by Review Desk and Grid; it must remain independent from AI results, human dispositions, tags, persistence, and source files.

## Global Constraints

- Browser-first UI remains at `http://127.0.0.1:5173/`; Rust remains a localhost terminal service.
- `全选` changes only the temporary marked-ID set. It never changes `humanDisposition`, tags, files, or AI results.
- Selection scope is every asset in the current logical session/filter result, including assets beyond the 240 rendered thumbnails.
- AI never overwrites a human disposition or manual tag.
- Missing model capability becomes `review`, never a fabricated zero detection or hard reject.
- Source photos and RAW files remain read-only; cloud providers receive only generated proxies after explicit configuration.
- Machine tag keys remain stable English identifiers; Chinese is the default display language and English remains complete.
- No new frontend state-management or localization dependency is introduced.
- The workspace has no `.git` directory. Do not initialize one.

## Ownership

- Modify: `apps/desktop/src/features/review/reviewState.ts`
- Test: `apps/desktop/src/features/review/reviewState.test.ts`
- Do not edit any other file.

## Interfaces

- Produce action `{ type: "selectAssets"; assetIds: string[] }`.
- Produce action `{ type: "clearSelectedAssets"; assetIds?: string[] }`.
- Continue to expose `ReviewState.gridSelection` as the shared marked-ID collection to avoid a storage migration.

## Required TDD Cycle

1. Add a failing reducer test that creates 1,000 logical assets, dispatches `selectAssets`, and proves all 1,000 IDs are marked while every human disposition and tag remains unchanged.
2. Add a failing reducer test that selects all fixture assets, dispatches `clearSelectedAssets` with one ID, and proves only that ID is removed.
3. Run `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts` and record the expected RED result before implementation.
4. Add the two actions to `ReviewAction` and implement minimal reducer branches.
5. `selectAssets` must ignore IDs absent from `state.assets`, preserve existing selection, avoid duplicate IDs, and preserve asset order/state.
6. `clearSelectedAssets` with no `assetIds` must clear the whole marked set; with IDs, it must remove only those IDs.
7. Re-run the focused command and record the GREEN result.
8. Self-review both changed files for scope, immutability, and accidental decision/tag mutation.

## Report Contract

Write the full report to `.superpowers/sdd/task-1-report.md`. Include:

- status: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`;
- exact files changed;
- RED command and failure summary;
- GREEN command, test count, and result;
- self-review findings;
- concerns or `none`.

Return only the status, one-line test summary, and concerns in the agent response.
