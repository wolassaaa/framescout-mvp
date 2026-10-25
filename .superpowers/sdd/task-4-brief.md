# Task 4 Brief

## Binding Global Constraints

- Browser-first UI remains at `http://127.0.0.1:5173/`; Rust remains a localhost terminal service.
- `全选` changes only the temporary marked-ID set. It never changes `humanDisposition`, tags, files, or AI results.
- Selection scope is every asset in the current logical session/filter result, including assets beyond the 240 rendered thumbnails.
- AI never overwrites a human disposition or manual tag.
- Missing model capability becomes `review`, never a fabricated zero detection or hard reject.
- Source photos and RAW files remain read-only; cloud providers receive only generated proxies after explicit configuration.
- Machine tag keys remain stable English identifiers; Chinese is the default display language and English remains complete.
- No new frontend state-management or localization dependency is introduced.
- The workspace has no `.git` directory. Do not initialize one; replace commit steps with explicit checkpoint file lists.


## Binding Task Requirements
### Task 4: Review-Mode Controls and Complete Bilingual UI

**Files:**
- Create: `apps/desktop/src/i18n/uiCopy.ts`
- Create: `apps/desktop/src/i18n/tagLabels.ts`
- Create: `apps/desktop/src/i18n/uiCopy.test.ts`
- Modify the UI files listed in File Structure.

**Interfaces:**
- Produces `type UiLanguage = "zh" | "en"` from one module.
- Produces `uiCopy[language]` with equal nested keys.
- Produces `localizedTag(tag: string, language: UiLanguage): string`.

- [ ] **Step 1: Write failing catalog tests**

```ts
it("keeps Chinese and English catalogs structurally identical", () => {
  expect(flattenKeys(uiCopy.zh)).toEqual(flattenKeys(uiCopy.en));
});

it("localizes stable machine tags and preserves manual or unknown tags", () => {
  expect(localizedTag("subject:person", "zh")).toBe("人物");
  expect(localizedTag("subject:person", "en")).toBe("Person");
  expect(localizedTag("manual:portfolio-pick", "zh")).toBe("portfolio pick");
  expect(localizedTag("object:unknown", "zh")).toBe("object:unknown");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm --workspace @framescout/desktop test -- src/i18n/uiCopy.test.ts`  
Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Build the catalog and tag map**

```ts
export const machineTagLabels: Record<string, Record<UiLanguage, string>> = {
  "subject:person": { zh: "人物", en: "Person" },
  "object:car": { zh: "汽车", en: "Car" },
  "scene:empty": { zh: "空镜", en: "Empty scene" },
  "quality:soft": { zh: "模糊", en: "Soft focus" },
  "ai:reviewed": { zh: "AI 已审", en: "AI reviewed" }
};

export function localizedTag(tag: string, language: UiLanguage): string {
  const known = machineTagLabels[tag]?.[language];
  if (known) return known;
  if (tag.startsWith("manual:")) return tag.slice(7).replace(/-/g, " ");
  return tag;
}
```

The UI catalog must include every visible string now hardcoded in Grid, Coverage, Projects, Analysis, Import, Duel, Review, Export, settings, and shortcuts. Move the existing component-local bilingual copy into this catalog without changing semantic labels.

- [ ] **Step 4: Add the three review-mode buttons**

Use a segmented control in Review Desk and Grid:

```tsx
{(["assisted", "all", "reject-audit"] as const).map((mode) =>
  <button key={mode} aria-pressed={state.reviewMode === mode}
    onClick={() => dispatch({ type: "setReviewMode", mode })}>
    {copy.reviewMode[mode]}
  </button>
)}
```

Also add AI-reviewed and awaiting-AI filters using `aiReviewStatus`, without changing assets.

- [ ] **Step 5: Verify catalog and bilingual E2E**

Run the catalog test, then add an E2E test that switches `中`/`EN` and checks the selection toolbar, review modes, Grid filters, Tags headings, and Export heading in both languages.

Expected: all catalog and E2E checks PASS; no hardcoded English remains in the named screens.

- [ ] **Step 6: Checkpoint**

Record the catalog, tag map, tests, and migrated component list.

---


## Execution Contract
Read AGENTS.md and docs/framescout-master-spec.md fully. Follow TDD. Preserve Tasks 1-3 and all unrelated edits. Do not initialize Git or touch source photos. Write `.superpowers/sdd/task-4-report.md` with RED/GREEN commands, exact files, E2E results, self-review, and concerns.
