# Task 4 Review Package

Current-state package for non-Git workspace. Inspect every listed file against brief and prior review.

## Implementer Report

# Task 4 Report

## Status

DONE_WITH_CONCERNS

Task 4 was started with test-first catalog coverage and the initial Review/Grid controls, but the desktop TypeScript build is currently blocked by the type-level shape of the new catalog. No source-photo, persistence, or AI-runtime files were changed. No Git repository was initialized.

## Changed Files

- `apps/desktop/src/i18n/uiCopy.ts` (new): bilingual UI catalog, `UiLanguage`, and interpolation helper.
- `apps/desktop/src/i18n/tagLabels.ts` (new): stable machine-tag display labels and `localizedTag`.
- `apps/desktop/src/i18n/uiCopy.test.ts` (new): catalog-key parity and tag-localization tests.
- `apps/desktop/src/features/grid/GridView.tsx`: Review-mode segmented control; AI-reviewed and awaiting-AI filters driven by `aiReviewStatus`; Grid copy reads from the catalog.
- `apps/desktop/src/features/grid/GridView.test.ts`: control coverage and test cleanup.
- `apps/desktop/src/features/review/SelectionToolbar.tsx`: selection copy reads from the catalog.
- `apps/desktop/src/features/review/AiReviewMark.tsx`: AI-status labels read from the catalog.
- `apps/desktop/src/features/review/ReviewDesk.tsx`: initial catalog use, localized tags, and Review-mode segmented control.
- `apps/desktop/src/styles/app.css`: compact segmented-control styling.

## RED / GREEN Evidence

RED command:

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts
```

Observed failure: Vite could not resolve `./tagLabels` because the i18n catalog/tag modules did not yet exist.

GREEN command:

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts
```

Result: PASS, 1 test file and 2 tests.

Additional focused GREEN command run before recovery:

```text
npm --workspace @framescout/desktop test -- src/features/grid/GridView.test.ts
```

Result: PASS, 1 test file and 4 tests. This includes the 241-result selection cap safeguard and the new control-presence test.

## Build Result

Command:

```text
npm --workspace @framescout/desktop run build
```

Result: FAIL. `tsc` reports that `Localized<T, Language>` in `uiCopy.ts` widens nested catalog properties to unions containing `string`. The affected consumers are the migrated Grid, Review Desk, AI mark, and selection-toolbar references. The first recursive-constraint error was corrected; the remaining error requires tightening the mapped type without intersecting each nested key with `CopyTree`.

## E2E Status

Not run in this recovery pass, by instruction. No Playwright job was restarted. The requested bilingual E2E coverage has not been added, so language switching across the selection toolbar, review modes, Grid filters, Tags headings, and Export heading remains unverified.

## Self-Review

- Review modes reuse the existing reducer action and `aiReviewStatus`; no state-management dependency was added.
- Grid selection still acts on the logical filtered result rather than only the 240 rendered thumbnails.
- The new tag map preserves `manual:` and unknown machine tags as required.
- Other Task 1-3 work and unrelated files were preserved.

## Concerns

- The build must be repaired before this task can be considered fully complete.
- The catalog migration is incomplete in the named screens: several existing component-local copy blocks remain, including Export, Coverage, Projects, Analysis, Import, Duel, App settings/shortcuts, and the legacy Review Desk copy block.
- No Task 4 bilingual Playwright assertions or visual regression baselines were completed.

## Recovery Slice A

### Exact Change

- Updated `apps/desktop/src/i18n/uiCopy.ts` only. `Localized<T>` now tests an inline `readonly [string, string]` bilingual tuple before the object branch, returning `string` for a leaf and recursively mapping `keyof T` for object nodes. This keeps catalog literal keys intact and avoids carrying the recursive `CopyTree` union into the leaf test. No catalog entries, localized components, imports, or runtime localization code changed.

### Validation Results

- `npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts`: PASS, 1 file and 3 tests.
- `npm --workspace @framescout/desktop test -- src/features/grid/GridView.test.ts`: PASS, 1 file and 4 tests.
- `npm --workspace @framescout/desktop test -- src/features/review/reviewState.test.ts`: PASS, 1 file and 19 tests.
- `npm --workspace @framescout/desktop test -- src/features/review/AiReviewMark.test.tsx`: PASS, 1 file and 3 tests.
- Targeted strict TypeScript check of `uiCopy`, `tagLabels`, `GridView`, `AiReviewMark`, and `reviewState`: PASS.
- `npm --workspace @framescout/desktop run build`: BLOCKED by pre-existing Task 4 migration wiring in `apps/desktop/src/App.tsx`: `ProjectsView`, `CoverageView`, and `DuelView` are rendered without their required `language` prop (TS2741 at lines 764, 800, and 801). No `uiCopy` type errors were reported.

### Concerns

- The requested desktop build cannot pass until the three omitted `language` props in `App.tsx` are supplied. That file is outside this recovery slice's allowed ownership, so it was intentionally not changed.
- No page migration or E2E work was continued in this recovery slice.

## Recovery Slice B

### Status

DONE_WITH_CONCERNS

### Exact Files Changed

- `apps/desktop/src/App.tsx`: supplied the required `language` prop to `ProjectsView`, `CoverageView`, and `DuelView`.
- `apps/desktop/src/features/export/ExportView.tsx`: removed the component-local bilingual `exportCopy` block and now reads all visible and accessible export copy from `uiCopy[language].export`.
- `tests/e2e/task-4-bilingual.spec.ts`: corrected the catalog-backed Chinese Grid filter expectation from `无人物主体` to `无人主体`; added Projects, Import, Duel, and display-settings/shortcut assertions around the existing Chinese/English coverage.

### Migration Audit

- Catalog-bound before or during this slice: Grid, Coverage, Projects, Analysis queue, Analysis profile switcher, Import, Duel, Review Desk, selection toolbar, AI review mark, and Export.
- Stable tag keys remain handled by `localizedTag`; preset and AI-evidence display values remain at their justified data-localization boundaries.
- Still incomplete: `App.tsx` navigation, runtime/status text, display-settings controls, shortcut settings, and bottom shortcut rails still contain component-local bilingual blocks or direct language ternaries. Review Desk also retains the hardcoded `Top` rank label.
- No source-photo, RAW, persistence, AI-runtime, or Git files were changed. No Git repository was initialized.

### Commands And Results

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts
PASS: 1 file, 3 tests.

npm --workspace @framescout/desktop run build
PASS: tsc and Vite production build completed.
```

### Prior E2E Evidence

Playwright was intentionally not restarted after the user's recovery-status instruction.

- Initial `task-4-bilingual.spec.ts` RED: the test expected Chinese `无人物主体`, while the unified catalog rendered `无人主体`. The assertion was updated to the actual catalog label.
- Revised `task-4-bilingual.spec.ts` RED: with Chinese active, the test expected the export region `交付导出`, but `ExportView` still had the static English `aria-label="Export hand-off"`. That binding has now been migrated to `uiCopy[language].export.region`, but the focused E2E was not rerun.

### Remaining Requirements

- Complete the App-level settings, navigation, runtime-status, and shortcut-rail catalog bindings; remove the remaining local bilingual blocks and the Review Desk `Top` literal.
- Run the focused bilingual Playwright test in both configured browser projects after that migration, then record the results.
- Run the remaining requested focused UI tests after the final binding changes and update this report with GREEN evidence.

## Recovery Slice C

### Status

DONE

### Exact Files Changed

- `apps/desktop/src/i18n/uiCopy.ts`: added catalog entries for App language controls, progress titles, shortcut rail, all shortcut-setting actions, and the Review Desk AI rank badge.
- `apps/desktop/src/i18n/uiCopy.test.ts`: added a source-level regression assertion that App consumes the shared `UiLanguage` type and has no App-local bilingual navigation, shortcut, or language-ternary copy; it also guards the Review Desk rank binding. The test uses Vite raw imports so the desktop TypeScript build does not require Node typings.
- `apps/desktop/src/App.tsx`: imports `UiLanguage`, `uiCopy`, and `formatCopy` from the catalog module; removed the duplicate `UiLanguage` declaration and local bilingual navigation/shortcut tables; bound navigation, runtime status, display settings, shortcut settings, shortcut rail, and overlay text to the catalog.
- `apps/desktop/src/features/review/ReviewDesk.tsx`: bound the former `Top` AI-rank literal to `uiCopy[language].review.topRank`.
- `.superpowers/sdd/task-4-report.md`: appended this recovery record.

### Named-Screen Migration Audit

- Confirmed catalog-backed visible Task 4 copy in Grid, Coverage, Projects, Analysis queue/profile switcher, Import, Duel, Review Desk, Selection Toolbar, AI Review Mark, and Export.
- No remaining component-local bilingual blocks were found in those named screens. `ReviewDesk.localizedSignal` retains the justified runtime-data boundary for AI evidence labels and values; it does not own a UI-copy catalog.
- `UiLanguage` has one source: `apps/desktop/src/i18n/uiCopy.ts`.
- No source-photo, RAW, persistence, AI-runtime, CSS, dependency, or Git files were changed. No Git repository was initialized.

### RED / GREEN Evidence

RED command:

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts
```

Observed expected failure: `App.tsx` still contained `type UiLanguage = "zh" | "en"`.

GREEN commands and exact results:

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts
PASS: 1 file, 4 tests.

npm --workspace @framescout/desktop test -- src/App.runtime.test.tsx src/features/grid/GridView.test.ts src/features/review/AiReviewMark.test.tsx src/features/review/reviewState.test.ts
PASS: 4 files, 27 tests.

npm --workspace @framescout/desktop run build
PASS: tsc and Vite production build completed.

npx playwright test tests/e2e/task-4-bilingual.spec.ts
PASS: 2 tests in 2 configured projects (chromium-desktop and chromium-compact).
```

### Final Checkpoint

- Build and dedicated bilingual E2E both pass.
- App-level navigation, settings, status, shortcut overlay, and shortcut rail are bound to `uiCopy`.
- The Review Desk rank label and all audited named-screen visible Task 4 copy are catalog-bound or are data-localization boundaries.

## Task 4 Review Fix

### Status

DONE_WITH_CONCERNS

All five authoritative findings in `task-4-review.md` are mapped to implemented changes below. The catalog/source tests, relevant focused UI tests, and desktop build pass. The expanded bilingual Playwright file was started but interrupted before it produced a result; per recovery instruction it was not restarted. The previously recorded narrower bilingual run remains PASS at 2/2 configured projects, but it does not certify the newly added assertions.

### Finding Map

1. **Initial and changed document language**
   - `apps/desktop/index.html` now starts with `lang="zh-CN"`, matching the default UI before React mounts.
   - `apps/desktop/src/i18n/uiCopy.ts` exports typed `documentLanguage` mapping `zh` to `zh-CN` and `en` to `en`.
   - `apps/desktop/src/App.tsx` synchronizes `document.documentElement.lang` from initialized and changed language state in an effect.
   - `tests/e2e/task-4-bilingual.spec.ts` asserts `zh-CN` on first load and `en` after switching.

2. **Static visible copy bypassing `uiCopy`**
   - `apps/desktop/src/i18n/uiCopy.ts` now owns every reviewed save/config/analysis/import/export fallback, localized export-error wrapper, clipboard status, count-formatted copied-path status, native dialog title/filter, default project example, and destination example.
   - `apps/desktop/src/App.tsx` consumes those entries, preserves runtime `Error.message` as data, uses `formatCopy` for export errors and copied-path counts, and accepts the selected language in `copySelectedPaths`.
   - `apps/desktop/src/features/import/ImportView.tsx` initializes and language-syncs the untouched example project name from `uiCopy`.
   - `apps/desktop/src/features/export/ExportView.tsx` reads the destination placeholder from `uiCopy`, passes the selected language to the copied-path callback, and clears stale utility status when language changes.

3. **Duplicate preset localization catalog**
   - `apps/desktop/src/data/presets.ts` now contains only stable `ProjectPreset` IDs and typed `PresetCopyKey` values; it contains no localized names or notes.
   - `apps/desktop/src/features/import/ImportView.tsx`, `apps/desktop/src/features/analysis/AnalysisQueueView.tsx`, and `apps/desktop/src/features/review/ReviewDesk.tsx` render preset names and notes exclusively from `uiCopy[language].presets` through those stable keys.
   - `apps/desktop/src/i18n/uiCopy.test.ts` guards the data module and all three consumers against duplicate preset copy.

4. **Raw machine tags shown in Export**
   - `apps/desktop/src/features/export/ExportView.tsx` renders `localizedTag(tag, language)` while retaining raw `tag` values for React keys, selected arrays, and callbacks.
   - `apps/desktop/src/features/export/ExportView.test.tsx` proves Chinese `人物` display and raw `subject:person` settings mutation.
   - `tests/e2e/task-4-bilingual.spec.ts` adds Chinese `人物` and English `Person` Export assertions.

5. **Narrow regression coverage**
   - `apps/desktop/src/i18n/uiCopy.test.ts` now raw-imports App, index HTML, preset data, and every named-screen source (Analysis, Coverage, Duel, Export, Grid, Import, Projects, Review). It guards the exact reviewed literals, component-local bilingual maps, preset ownership/consumers, document default, formatted statuses, and Export tag binding.
   - `apps/desktop/src/features/export/ExportView.test.tsx` adds behavior coverage for localized display with stable raw keys.
   - `tests/e2e/task-4-bilingual.spec.ts` now covers document language, preset names/notes, localized Export tags, settings and shortcut controls in both languages, metadata-started status, and a deterministic clipboard-unavailable error in both languages.

### Exact Files Changed

- `apps/desktop/index.html`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/i18n/uiCopy.ts`
- `apps/desktop/src/i18n/uiCopy.test.ts`
- `apps/desktop/src/data/presets.ts`
- `apps/desktop/src/features/import/ImportView.tsx`
- `apps/desktop/src/features/analysis/AnalysisQueueView.tsx`
- `apps/desktop/src/features/review/ReviewDesk.tsx`
- `apps/desktop/src/features/export/ExportView.tsx`
- `apps/desktop/src/features/export/ExportView.test.tsx` (new)
- `tests/e2e/task-4-bilingual.spec.ts`
- `.superpowers/sdd/task-4-report.md`

No source-photo, RAW, persistence, local-service, AI-runtime, dependency, CSS, or Git files were changed. The workspace still has no Git metadata.

### RED / GREEN Evidence

RED command:

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts src/features/export/ExportView.test.tsx
```

Expected RED result: FAIL, 2 files; 4 failed and 4 passed of 8 tests. Failures reproduced the wrong initial HTML language, duplicate preset copy, absent localized status entries, and raw Export tag display.

Intermediate checks after minimal implementation found one existing App source-guard failure, then one expanded named-screen source-guard failure. Both were resolved by moving document-language mapping into the i18n module rather than weakening either guard.

Focused GREEN command:

```text
npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts src/features/export/ExportView.test.tsx
```

Result: PASS, 2 files and 8/8 tests (`uiCopy.test.ts` 7, `ExportView.test.tsx` 1).

Relevant focused GREEN command:

```text
npm --workspace @framescout/desktop test -- src/App.runtime.test.tsx src/features/grid/GridView.test.ts src/features/review/AiReviewMark.test.tsx src/features/review/reviewState.test.ts src/features/export/ExportView.test.tsx src/i18n/uiCopy.test.ts
```

Result: PASS, 6 files and 35/35 tests (`App.runtime` 1, Grid 4, AI mark 3, review state 19, Export 1, UI copy 7).

Desktop build:

```text
npm --workspace @framescout/desktop run build
```

Result: PASS. TypeScript and Vite completed; Vite transformed 1,612 modules and emitted the production bundle.

### Bilingual E2E Evidence And Concern

Previously recorded baseline command/result:

```text
npx playwright test tests/e2e/task-4-bilingual.spec.ts
PASS: 2 tests in 2 configured projects (chromium-desktop and chromium-compact).
```

That result predates this review-fix expansion. The expanded dedicated command was started in this recovery pass but interrupted before Playwright returned a result. No Node/Chrome process remains, and the command was not restarted per instruction. Therefore the new document-language, preset/tag, bilingual settings/shortcuts, and status/error E2E assertions are present but not freshly certified; this is the only remaining concern.

## E2E Locator Fix

### Exact Changes

- `tests/e2e/task-4-bilingual.spec.ts`: scoped the Chinese Select action to the localized `aria-label="设置决定"` container with `getByLabel`, asserted that scope remains visible, and selected the decision button by role with `/^精选\s+2$/` so its shortcut remains part of the accessibility contract. After the run advanced, the test now closes the already-asserted English `Display scale` dialog through its accessible toggle before clicking the Export metadata action, preventing the dialog from intercepting pointer events.
- `.superpowers/sdd/task-4-report.md`: appended this exact E2E evidence.

No product code was modified.

### RED Evidence

The reproduced failure was the exact-name locator at the former line 28: expected `精选`, actual accessible name `精选 2` because the visible shortcut `<kbd>2</kbd>` participates in the button name.

The first scoped revision used `getByRole("group")`; both projects failed because the localized container has `aria-label="设置决定"` but no explicit `role="group"`. Replacing that scope with `getByLabel("设置决定")` preserved the localized container assertion without adding a CSS-only selector.

The next run passed the decision locator in both projects and reached the English metadata action, where the open settings dialog intercepted pointer events. The test now closes that dialog through `getByRole("button", { name: "Display scale" })` after completing its bilingual settings/shortcut assertions.

### GREEN Evidence

Command:

```text
npx playwright test tests/e2e/task-4-bilingual.spec.ts --reporter=line
```

Exact final result:

```text
Running 2 tests using 2 workers
2 passed (1.3m)
```

Projects passed: `chromium-desktop` and `chromium-compact`. Concerns: none.

## Current File Manifest
- apps/desktop/index.html | 300 bytes | SHA256 CAF93006E949728D946F011C5B3660E4B04B7BDE122C3AEDE8E164F32304DF9F
- apps/desktop/src/i18n/uiCopy.ts | 24178 bytes | SHA256 EA7B9C4133D912CDDD48B1B215A10EBCB064C4F55523E93440B204285C3A3C28
- apps/desktop/src/i18n/tagLabels.ts | 2661 bytes | SHA256 BF12E19B3C3D4BDC3B636321C71BC2DEE632882E25983BE51FC68493AEE7FF0F
- apps/desktop/src/i18n/uiCopy.test.ts | 4730 bytes | SHA256 3D11DF47C6E5453D298D0E69A5F2AE81DA5807539659A4D8F4B09187910CCE3B
- apps/desktop/src/App.tsx | 40800 bytes | SHA256 CEF8C86814D099E88AC081F034A150A490E455D2ABAE756E862E0DD76AB3D10F
- apps/desktop/src/features/projects/ProjectsView.tsx | 1577 bytes | SHA256 CEAADAD71C6BB466775572312DCDF9D1C13069BA25698029CF7F148BC59BEE3E
- apps/desktop/src/features/import/ImportView.tsx | 6428 bytes | SHA256 06A674CC8922A05189C0855E197CABFA94FF350AFF056A51F1F1142429733CBD
- apps/desktop/src/features/analysis/AnalysisQueueView.tsx | 4364 bytes | SHA256 10A25BEB827B05214D55C158129C055CF1FA64CC7E2DB9DCDBC6BA9B2E626580
- apps/desktop/src/features/analysis/AnalysisProfileSwitcher.tsx | 5488 bytes | SHA256 E124063DBEE18C7C25AB3BB2445B473F1928A5FA203B3E5751D089F8C9625ED2
- apps/desktop/src/features/review/ReviewDesk.tsx | 18302 bytes | SHA256 8654CC58F2DB92562857AA803456B2DC4C188E37CEE7E9237C862FA04AAC548F
- apps/desktop/src/features/review/SelectionToolbar.tsx | 1649 bytes | SHA256 752AB8385FBCEDB5D2FC713ABFB7873FDDCB252621178A27D23C7AB0ADFAFB0E
- apps/desktop/src/features/review/AiReviewMark.tsx | 596 bytes | SHA256 396A5E1F96DCD47C03E3A5697ADE80849D5A7EBC888B5D08AB39BA1128B1568C
- apps/desktop/src/features/grid/GridView.tsx | 10631 bytes | SHA256 7FB7ED4B181EF1B6EB37F4532C310BE27BDED1A82A4495C2D48E7869CABF588D
- apps/desktop/src/features/grid/GridView.test.ts | 2892 bytes | SHA256 C9E38BFA79F5F274D96F83C2BE1FE1F586E508C3E1F29F5736D0462E2AA3E2CB
- apps/desktop/src/features/coverage/CoverageView.tsx | 7059 bytes | SHA256 100359F2327CD9CB1414B8BA39853D0D9613B3019F1A70095F9F94A293A8F687
- apps/desktop/src/features/duel/DuelView.tsx | 4773 bytes | SHA256 9E1C3AE6F0CF2487A62493BD6FD56CBDF3FF212B82B96369EAFE1362AA7B72E2
- apps/desktop/src/features/export/ExportView.tsx | 12324 bytes | SHA256 198860C0E636EB7439562486849DACC782C0F8EA41411853E8DD1C581F10D35F
- apps/desktop/src/features/export/ExportView.test.tsx | 1260 bytes | SHA256 BB240D916DB4DB97A85C068E7506736CD333E902911CEE7F0666BE209236E3CE
- apps/desktop/src/data/presets.ts | 775 bytes | SHA256 0F69B41FDA3945B04BA4F970A70F36CDFB254F592550B7621FE3AA2F77F4ABF2
- tests/e2e/task-4-bilingual.spec.ts | 6804 bytes | SHA256 DBFCDBC283821F592558D876ECCDA8B85353D488772ED40C6B825F823703296A
