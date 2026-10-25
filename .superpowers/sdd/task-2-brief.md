# Task 2: AI Review Status and Review Modes

## Role In FrameScout

Create the pure UI-state boundary that distinguishes a persisted AI result from a default disposition, and add three non-destructive review modes. This task does not render controls and does not run inference.

## Global Constraints

- `全选` remains independent from AI and human decisions.
- AI never overwrites a human disposition or manual tag.
- An asset is AI-reviewed only when persisted evidence exists; missing evidence is `pending` even if `aiDisposition` has a default value.
- Assisted mode hides AI rejects unless a human disposition has rescued the asset.
- Full re-review includes every asset. Reject audit includes only persisted AI rejects.
- Source photos and RAW files remain read-only.
- Do not add dependencies, persistence changes, or UI controls.
- The workspace has no `.git` directory. Do not initialize one.

## Ownership

- Create: `apps/desktop/src/features/review/aiReview.ts`
- Modify: `apps/desktop/src/features/review/reviewState.ts`
- Test: `apps/desktop/src/features/review/reviewState.test.ts`
- Do not edit any other file.

## Interfaces

```ts
export type AiReviewStatus = "pending" | AiDisposition;
export type ReviewMode = "assisted" | "all" | "reject-audit";
export function aiReviewStatus(asset: ReviewAsset): AiReviewStatus;
export function matchesReviewMode(asset: ReviewAsset, mode: ReviewMode): boolean;
```

- Add `reviewMode: ReviewMode` to `ReviewState`.
- Add `{ type: "setReviewMode"; mode: ReviewMode }` to `ReviewAction`.
- Initialize `reviewMode` as `"assisted"`.
- `setReviewMode` resets `cursor` to zero and leaves selection, decisions, tags, and assets unchanged.
- Update `visibleAssets` to use `matchesReviewMode` in addition to existing filters.

## Required TDD Cycle

1. Add a failing test proving an asset with `aiDisposition: "keep"` and empty evidence is `pending`, while an asset with persisted evidence returns its disposition.
2. Add failing mode tests proving assisted returns keep/review/pending plus human-rescued rejects, all returns every asset, and reject-audit returns only persisted AI rejects.
3. Assert changing modes resets the cursor but does not change `gridSelection`, assets, dispositions, or tags.
4. Run `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts` and record RED.
5. Implement `aiReview.ts` as pure functions. `aiReviewStatus` must tolerate only the contract shape; do not invent a second analyzed flag.
6. Integrate `reviewMode` into reducer state/action and `visibleAssets` while preserving all existing human-rescue and filter behavior.
7. Re-run the focused test and record GREEN.
8. Self-review type imports, state immutability, cursor reset, and absence of persistence/source-file effects.

## Report Contract

Write `.superpowers/sdd/task-2-report.md` with status, exact files, RED evidence, GREEN command/test count/result, self-review, and concerns. Return only status, one-line test summary, and concerns.
