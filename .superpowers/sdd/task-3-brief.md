# Task 3: Selection Toolbar, AI Marks, and Keyboard Behavior

## Role In FrameScout

Expose the approved session-wide marked set and persisted AI review status in both Review Desk and Grid. This is a compact work-surface change, not a redesign: images remain dominant and controls must fit existing responsive layout.

## Global Constraints

- `全选` only changes `gridSelection`; it never applies a human decision, tag, AI result, persistence write, or file operation.
- Scope is every ID in the current logical result. In Grid, compute IDs before the existing 240-item render slice.
- Review Desk and Grid share the same marked set.
- AI star: keep green, review yellow, reject red, pending renders no star. Color is accompanied by accessible text.
- AI star must not occupy the same visual position as the human selection indicator.
- Chinese remains the default and English is complete.
- `Ctrl+A` selects the current logical result only; `Escape` clears the shared marked set. Shortcuts do nothing when input, select, textarea, or contenteditable is focused.
- No source photo/RAW writes, inference, persistence migrations, or new dependencies.
- UI must remain usable at 1440x900, 1280x800, and existing UI scale behavior.
- No Git initialization.

## Ownership

- Create `apps/desktop/src/features/review/SelectionToolbar.tsx`
- Create `apps/desktop/src/features/review/AiReviewMark.tsx`
- Modify `apps/desktop/src/features/review/ReviewDesk.tsx`
- Modify `apps/desktop/src/features/grid/GridView.tsx`
- Modify `apps/desktop/src/App.tsx`
- Modify `apps/desktop/src/styles/app.css`
- Test `apps/desktop/src/features/grid/GridView.test.ts`
- Test `tests/e2e/review-desk.spec.ts`
- Modify only directly affected screenshot snapshots when the behavior test passes.

## Interfaces

```ts
SelectionToolbar({ language, resultIds, selectedIds, dispatch })
AiReviewMark({ asset, language })
```

- Reuse `ReviewDispatch`, `UiLanguage`, `ReviewAsset`, `aiReviewStatus`, and Lucide icons from existing project conventions.
- `SelectionToolbar` has localized accessible group label, select-all, clear-current-result, and total marked count.
- Disable select-all for an empty result or when every result ID is already marked.
- Disable clear-current-result when none of its IDs are marked.
- The displayed count is the complete shared `selectedIds.length`, not merely selected IDs inside the current filter.
- `AiReviewMark` renders no DOM for pending. Persisted statuses render a filled star with localized `aria-label` and `title`.

## Required TDD Cycle

1. Add failing component/unit coverage proving Grid passes and selects all logical filtered IDs beyond the 240-render cap without changing human dispositions.
2. Add failing E2E coverage for select all, shared marked count across Grid/Desk, no change to human selected count, clear selection, and accessible keep/review AI marks.
3. Record RED commands and failure summaries.
4. Implement the two focused components and integrate them into both surfaces.
5. Put AI marks in grid thumbnails and Review Desk filmstrip metadata without covering filenames, human selection glyphs, or image content.
6. Add scoped `Ctrl+A` and `Escape` handlers using the surface's complete logical result IDs. Ignore modified Alt/Meta shortcuts and editable targets.
7. Add restrained CSS using existing tokens, stable dimensions, wrapping/overflow rules, visible focus, and no new card nesting.
8. Run focused frontend tests, desktop build, and the Task 3 Playwright grep. Update snapshots only after behavior passes.
9. At 1440x900 and 1280x800, confirm toolbar, star, decision bar, filmstrip, and side rails do not overlap. Record any environment blocker honestly.
10. Self-review for full-result selection, selection/decision separation, accessibility, localization, and source-file safety.

## Exact Commands

```powershell
npm --workspace @framescout/desktop test -- src/features/grid/GridView.test.ts src/features/review/reviewState.test.ts
npm --workspace @framescout/desktop run build
npx playwright test tests/e2e/review-desk.spec.ts --project=chromium-desktop --grep "select all|AI marks"
```

## Report Contract

Write `.superpowers/sdd/task-3-report.md` with status, exact changed files, RED evidence, GREEN commands/counts, viewport results or blockers, self-review, and concerns. Return only status, one-line test summary, and concerns.
