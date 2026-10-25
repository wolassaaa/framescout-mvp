# Unified Tag Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project every photo's content, AI, human, organization, and technical state into stable categorized tags across FrameScout.

**Architecture:** Add a pure tag projection module that derives non-authored tags from `ReviewAsset` fields. Coverage, review, grid, and export consume that projection instead of inventing their own tag rules. Authored content tags remain in `ReviewAsset.tags`; derived tags are read-only project metadata.

**Tech Stack:** React, TypeScript, Vitest, existing `@framescout/contracts` types.

## Global Constraints

- Do not modify source photos, RAW files, or XMP during review.
- Preserve `ReviewAsset.tags` as authored content tags only.
- Keep Chinese labels and English keys searchable.
- Reuse `ReviewState.gridSelection` across all workspaces.

---

### Task 1: Create the derived tag projection

**Files:**
- Create: `apps/desktop/src/features/coverage/tagProjection.ts`
- Create: `apps/desktop/src/features/coverage/tagProjection.test.ts`

**Interfaces:**
- Produces `projectAssetTags(asset: ReviewAsset): ProjectedTag[]`.
- `ProjectedTag` contains `key`, `category`, `source`, `value`, and `exportableByDefault`.

- [ ] **Step 1: Write the failing test**

```ts
expect(projectAssetTags(asset).map((tag) => tag.key)).toEqual(expect.arrayContaining([
  "subject:person",
  "workflow:ai:keep",
  "workflow:human:select",
  "organization:raw:mapped",
  "technical:camera:Canon EOS R5"
]));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @framescout/desktop run test -- tagProjection.test.ts`
Expected: FAIL because `tagProjection.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function projectAssetTags(asset: ReviewAsset): ProjectedTag[] {
  return [...contentTags(asset), ...workflowTags(asset), ...organizationTags(asset), ...technicalTags(asset)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @framescout/desktop run test -- tagProjection.test.ts`
Expected: PASS.

### Task 2: Group every tag in the coverage workspace

**Files:**
- Modify: `apps/desktop/src/features/coverage/CoverageView.tsx`
- Modify: `apps/desktop/src/features/coverage/CoverageView.test.tsx`

**Interfaces:**
- Consumes `projectAssetTags` and `ProjectedTag` from Task 1.
- Produces category-filtered rows and matching asset lists.

- [ ] **Step 1: Write the failing test**

```ts
fireEvent.click(screen.getByRole("button", { name: "AI 工作流" }));
expect(screen.getByRole("button", { name: "AI 建议保留 1 0" })).toBeVisible();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @framescout/desktop run test -- CoverageView.test.tsx`
Expected: FAIL because the category filter and projected workflow rows are absent.

- [ ] **Step 3: Write minimal implementation**

```tsx
const projected = assets.flatMap((asset) => projectAssetTags(asset));
const categoryRows = categories.map((category) => countProjectedTags(projected, category));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @framescout/desktop run test -- CoverageView.test.tsx`
Expected: PASS.

### Task 3: Reuse projected tags in review and grid search

**Files:**
- Modify: `apps/desktop/src/features/review/ReviewDesk.tsx`
- Modify: `apps/desktop/src/features/grid/GridView.tsx`
- Modify: `apps/desktop/src/features/grid/GridView.test.ts`

**Interfaces:**
- Consumes Task 1's `projectAssetTags`.
- Inspector renders all layers; Grid search matches each projected tag key and value.

- [ ] **Step 1: Write the failing test**

```ts
expect(matchesSearch(asset, "workflow:ai:keep")).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @framescout/desktop run test -- GridView.test.ts`
Expected: FAIL because grid search currently checks only `asset.tags` and reasons.

- [ ] **Step 3: Write minimal implementation**

```ts
const matchesTagQuery = projectAssetTags(asset).some((tag) =>
  `${tag.key} ${tag.value}`.toLowerCase().includes(query)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @framescout/desktop run test -- GridView.test.ts`
Expected: PASS.

### Task 4: Keep export keyword policy explicit

**Files:**
- Modify: `apps/desktop/src/features/export/ExportView.tsx`
- Modify: `apps/desktop/src/features/project/projectExport.ts`
- Modify: `apps/desktop/src/features/export/ExportView.test.tsx`

**Interfaces:**
- Consumes Task 1's category and default-export metadata.
- Shows operational tags in export filters but excludes them from default delivery keywords.

- [ ] **Step 1: Write the failing test**

```ts
expect(keywordsFor(asset, false)).not.toContain("workflow:ai:keep");
expect(availableExportTags(assets)).toContainEqual(expect.objectContaining({ key: "workflow:ai:keep" }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @framescout/desktop run test -- ExportView.test.tsx projectExport.test.ts`
Expected: FAIL because export only enumerates authored tags.

- [ ] **Step 3: Write minimal implementation**

```ts
const deliveryTags = projectAssetTags(asset).filter((tag) => tag.exportableByDefault).map((tag) => tag.key);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @framescout/desktop run test -- ExportView.test.tsx projectExport.test.ts`
Expected: PASS.

### Task 5: Verify the complete application

**Files:**
- Modify: `apps/desktop/src/i18n/uiCopy.ts`
- Modify: `apps/desktop/src/i18n/tagLabels.ts`

- [ ] **Step 1: Add Chinese labels for every projected tag category and workflow state.**
- [ ] **Step 2: Run `npm --workspace @framescout/desktop run test`.**
Expected: all tests pass.
- [ ] **Step 3: Run `npm --workspace @framescout/desktop run build`.**
Expected: TypeScript and Vite production build pass.
- [ ] **Step 4: Verify in `http://127.0.0.1:5173/` that AI workflow category, human workflow category, and technical category each open an asset list.**
