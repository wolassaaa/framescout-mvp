import { expect, test } from "@playwright/test";

const previewFixture = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#182733"/>
    <rect y="520" width="1200" height="280" fill="#11171D"/>
    <circle cx="720" cy="300" r="106" fill="#DCE8FF" opacity=".3"/>
    <rect x="420" y="214" width="146" height="320" rx="62" fill="#F3F5F7" opacity=".82"/>
    <path d="M80 646 C350 550 540 700 820 600 C970 550 1070 560 1160 630" fill="none" stroke="#7BA7FF" stroke-width="10" opacity=".5"/>
  </svg>
`);

const importFiles = () => [
  { name: "frame-001.jpg", mimeType: "image/svg+xml", buffer: previewFixture },
  { name: "frame-001.cr2", mimeType: "application/octet-stream", buffer: Buffer.from("cr2-preview-fixture") }
];

// Product defaults to Chinese for local users. Keep visual and accessibility
// assertions deterministic without changing the user's persisted preference.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("framescout.ui-language", "en"));
});

test("review desk renders the working surface", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "FrameScout" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Review Desk" })).toBeVisible();
  await expect(page.getByText("Suggested keep").first()).toBeVisible();
  await expect(page.getByText("AI analysis").first()).toBeVisible();
  await expect(page).toHaveScreenshot("review-desk.png", {
    animations: "disabled",
    fullPage: true
  });
});

test("display scale stays within the documented working range and persists locally", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Display scale" }).click();
  const scalePanel = page.getByRole("dialog", { name: "Display scale" });
  await expect(scalePanel).toContainText("100%");
  await scalePanel.getByRole("slider", { name: "Interface scale" }).fill("120");
  await expect(scalePanel).toContainText("120%");
  await expect(page.locator(".shell")).toHaveCSS("transform", "matrix(1.2, 0, 0, 1.2, 0, 0)");
  await page.reload();
  await page.getByRole("button", { name: "Display scale" }).click();
  await expect(page.getByRole("dialog", { name: "Display scale" })).toContainText("120%");
  await page.getByRole("button", { name: "Reset scale" }).click();
  await expect(page.locator(".shell")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
});

test("grid hero screen keeps contact sheet and constrained actions visible", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Grid" }).click();

  await expect(page.getByRole("region", { name: "Grid" })).toBeVisible();
  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(page.getByText("Export preview")).toBeVisible();
  await page.getByRole("button", { name: "Soft focus" }).click();
  await expect(page.locator("button.contact-thumb")).toHaveCount(1);
  await expect(page.locator("button.contact-thumb")).toContainText("6D2_7423.CR2");
  await page.getByRole("button", { name: "Needs review" }).click();
  await expect(page).toHaveScreenshot("grid.png", {
    animations: "disabled",
    fullPage: true
  });
});

test("grid batch decision changes only explicitly marked frames", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Grid" }).click();

  await page.locator("button.contact-thumb").nth(0).click();
  await page.locator("button.contact-thumb").nth(1).click();
  const marked = page.getByRole("region", { name: "Marked frames" }).getByRole("status");
  await expect(marked).toHaveText("2 marked");
  await page.getByLabel("Bulk decision").selectOption("hold");
  await page.getByRole("button", { name: "Set decision" }).click();

  await expect(marked).toHaveText("0 marked");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator("button.contact-thumb")).toHaveCount(1);
  await expect(page.locator("button.contact-thumb")).toContainText("6D2_7423.CR2");
});

test("select all shares marked frames across Grid and Review Desk without changing human picks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Grid" }).click();

  await page.keyboard.press("Control+A");
  const selectionToolbar = page.getByRole("region", { name: "Marked frames" });
  await expect(selectionToolbar.getByRole("status")).toHaveText("3 marked");
  await expect(page.getByText("0 selected")).toBeVisible();

  await page.getByRole("button", { name: "Review Desk" }).click();
  await expect(selectionToolbar.getByRole("status")).toHaveText("3 marked");
  await expect(page.getByText("0 selected")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(selectionToolbar.getByRole("status")).toHaveText("0 marked");
  await expect(page.getByText("0 selected")).toBeVisible();
});

test("select-all and clear shortcuts ignore editable and modified events on Review Desk and Grid", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Grid" }).click();
  await page.getByRole("button", { name: "Review Desk" }).click();
  const markedCount = page.getByRole("region", { name: "Marked frames" }).getByRole("status");

  await page.keyboard.press("Control+A");
  await expect(markedCount).toHaveText("3 marked");
  await page.keyboard.press("Escape");
  await expect(markedCount).toHaveText("0 marked");
  await page.keyboard.press("Control+A");
  await expect(markedCount).toHaveText("3 marked");

  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `
      <input id="task-3-input" />
      <select id="task-3-select"><option>Option</option></select>
      <textarea id="task-3-textarea"></textarea>
      <div id="task-3-contenteditable" contenteditable="true"></div>
    `);
  });

  const assertShortcutGuards = async (count: string) => {
    for (const target of ["#task-3-input", "#task-3-select", "#task-3-textarea", "#task-3-contenteditable"]) {
      for (const shortcut of ["Control+A", "Escape", "Alt+Control+A", "Alt+Escape", "Meta+A", "Meta+Escape"]) {
        await page.locator(target).press(shortcut);
        await expect(markedCount).toHaveText(count);
      }
    }
  };

  await assertShortcutGuards("3 marked");
  await page.getByRole("button", { name: "Review Desk" }).click();
  await page.keyboard.press("Escape");
  await expect(markedCount).toHaveText("0 marked");

  await page.getByRole("button", { name: "Grid" }).click();
  await page.keyboard.press("Control+A");
  await expect(markedCount).toHaveText("3 marked");
  await assertShortcutGuards("3 marked");
  await page.getByRole("button", { name: "Grid" }).click();
  await page.keyboard.press("Escape");
  await expect(markedCount).toHaveText("0 marked");
});

test("AI marks expose persisted keep and review states", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("AI keep").first()).toHaveAttribute("title", "AI keep");
  await expect(page.getByLabel("AI review").first()).toHaveAttribute("title", "AI review");

  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page.getByLabel("AI keep").first()).toBeVisible();
  await expect(page.getByLabel("AI review").first()).toBeVisible();
});

test("grid density responds to bracket shortcuts within the supported range", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Grid" }).click();
  await expect(page.getByText("4 columns")).toBeVisible();
  await page.keyboard.press("]");
  await expect(page.getByText("5 columns")).toBeVisible();
  await page.keyboard.press("[");
  await expect(page.getByText("4 columns")).toBeVisible();
});

test("human-rescued AI rejects remain visible in the normal review queue", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Likely reject/ }).click();
  await page.locator("button[title='6D2_7423.CR2']").click();
  await page.keyboard.press("2");
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.getByRole("button", { name: /All frames/ }).click();
  await expect(page.locator("button[title='6D2_7423.CR2']")).toBeVisible();
  await expect(page.getByRole("region", { name: "Review Desk" })).toContainText("1 of 3");
});

test("review desk filter rail narrows the queue without changing decisions", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Needs review/ }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toContainText("6D2_7422.CR2");
  await page.getByRole("button", { name: /Suggested keep/ }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toContainText("6D2_7421.CR2");
  await page.getByRole("button", { name: /All frames/ }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toContainText("6D2_7421.CR2");
});

test("project policy recomputes AI disposition without overriding a human pick", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Needs review/ }).click();
  await page.keyboard.press("2");
  await page.getByRole("button", { name: /All frames/ }).click();
  await page.getByLabel("Project policy").selectOption("action-coverage");

  await expect(page.getByText("Likely reject").first()).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible();
  const projectState = await page.evaluate(() => {
    const projectId = window.localStorage.getItem("framescout.activeProjectId");
    return JSON.parse(window.localStorage.getItem(`framescout.project.${projectId}`) ?? "{}");
  });
  expect(projectState.preset).toBe("action-coverage");
  expect(projectState.assets.find((asset: { reasons: string[] }) => asset.reasons.includes("no_allowed_subject_preserved_by_matchday"))).toMatchObject({
    aiDisposition: "reject",
    humanDisposition: "select"
  });
});

test("review desk applies a manual tag through the F shortcut", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Review Desk" }).click({ position: { x: 500, y: 180 } });
  await page.keyboard.press("f");
  await expect(page.getByRole("dialog", { name: "Add a tag" })).toBeVisible();
  await page.getByRole("dialog", { name: "Add a tag" }).getByRole("textbox").fill("Editor Pick");
  await page.getByRole("dialog", { name: "Add a tag" }).getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.locator(".inspector")).toContainText("editor pick");
  const tagEvents = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    return project.tagEvents ?? [];
  });
  expect(tagEvents).toHaveLength(1);
  expect(tagEvents[0]).toMatchObject({ tag: "manual:editor-pick", mutation: "add", actor: "human" });
});

test("tags and coverage shows selected tag coverage and filters the matrix", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("2");
  await page.getByRole("button", { name: "Tags" }).click();

  await expect(page.getByRole("region", { name: "Tags and coverage" })).toBeVisible();
  await expect(page.getByText("selected frames")).toBeVisible();
  await page.getByRole("button", { name: /player/ }).click();
  await expect(page.getByRole("complementary", { name: "Tagged frames" })).toContainText("6D2_7421.CR2");
  await expect(page).toHaveScreenshot("tags-coverage.png", {
    animations: "disabled",
    fullPage: true
  });
  await page.getByLabel("Filter tags").fill("venue");
  await expect(page.getByRole("button", { name: /venue/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /player/ })).toHaveCount(0);
});

test("burst duel selects a frame and returns to the original review desk", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Compare burst" }).click();
  await expect(page.getByRole("region", { name: "Burst Duel" })).toBeVisible();
  await expect(page).toHaveScreenshot("burst-duel.png", {
    animations: "disabled",
    fullPage: true
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Back to review" }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toBeVisible();
});

test("export hand-off previews sidecars and refuses browser writes after confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Select 2" }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();

  await expect(page.getByRole("region", { name: "Export hand-off" })).toBeVisible();
  await page.getByLabel("Destination").fill("D:\\Retouch\\Friday-finals");
  await page.getByRole("button", { name: "Generate copy preview" }).click();
  await expect(page.locator(".export-summary")).toContainText("Proxy copies");
  await expect(page.locator(".export-summary")).toContainText("XMP sidecars");
  await expect(page.getByRole("region", { name: "Copy targets" })).toContainText("6D2_7421.CR2");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV preview" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("friday-night-finals.csv");
  await page.getByRole("button", { name: "Copy selected source paths" }).click();
  await expect(page.getByRole("region", { name: "Export utilities" })).toContainText(/selected source path|Clipboard access/);
  await expect(page).toHaveScreenshot("export-hand-off.png", {
    animations: "disabled",
    fullPage: true
  });
  await page.getByLabel("I checked the destination and copy manifest").check();
  await page.getByRole("button", { name: "Run copy export" }).click();
  await expect(page.getByText("This runtime cannot write files, so no export was performed.")).toBeVisible();
});

test("projects view reopens a prior local review with its decisions", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Import" }).click();
  await page.getByLabel("Project name").fill("Morning review");
  await page.setInputFiles("input[data-testid=import-file-input]", importFiles());
  await page.getByRole("button", { name: "Start local project" }).click();
  await page.getByRole("button", { name: "Enter Review Desk" }).click();
  await page.keyboard.press("2");
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.getByRole("button", { name: "Import" }).click();
  await page.getByLabel("Project name").fill("Evening review");
  await page.setInputFiles("input[data-testid=import-file-input]", importFiles());
  await page.getByRole("button", { name: "Start local project" }).click();
  await page.getByRole("button", { name: "Enter Review Desk" }).click();
  await expect(page.locator(".topbar-meta")).toContainText("Evening review");

  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("region", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: /Morning review/ }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toBeVisible();
  await expect(page.locator(".topbar-meta")).toContainText("Morning review");
  await expect(page.getByText("1 selected")).toBeVisible();
});

test("browser Phase 1 adapter creates a project and restores human decisions", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Import" }).click();
  await page.getByLabel("Project name").fill("Trackside qualifying");
  await page.getByRole("button", { name: /motorsport/i }).click();
  await page.setInputFiles("input[data-testid=import-file-input]", importFiles());
  await expect(page.getByText("2 supported Phase 1 assets discovered")).toBeVisible();

  await page.getByRole("button", { name: "Start local project" }).click();
  await expect(page.getByRole("region", { name: "Analysis queue" })).toBeVisible();
  await expect(page.getByText("images discovered")).toBeVisible();
  await expect(page.getByText("RAW placeholders")).toBeVisible();
  await expect(page).toHaveScreenshot("analysis-queue.png", {
    animations: "disabled",
    fullPage: true
  });
  await page.getByRole("button", { name: "Enter Review Desk" }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toBeVisible();
  await expect(page.getByText("2/2 previews")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
        if (!activeProjectId) return 0;
        const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
        return project.assets?.length ?? 0;
      })
    )
    .toBe(2);

  const analysisRun = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    if (!activeProjectId) return null;
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    return project.analysisRuns?.at(-1) ?? null;
  });
  expect(analysisRun).toMatchObject({
    status: "completed",
    totalAssets: 2,
    previewsReady: 2,
    rawPlaceholders: 1,
    missingAssets: 0,
    progress: 1,
    backend: "browser"
  });

  const assetState = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    if (!activeProjectId) return { previewStates: [], missingStates: [], rawPartnerMatches: false };
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    const assets = project.assets ?? [];
    const previewStates = assets
      .map((asset: { fileName: string; previewState: string }) => [asset.fileName, asset.previewState])
      .sort((left: string[], right: string[]) => left[0].localeCompare(right[0]));
    const missingStates = assets
      .map((asset: { fileName: string; missingState: string }) => [asset.fileName, asset.missingState])
      .sort((left: string[], right: string[]) => left[0].localeCompare(right[0]));
    const jpeg = assets.find((asset: { fileName: string }) => asset.fileName === "frame-001.jpg");
    const raw = assets.find((asset: { fileName: string }) => asset.fileName === "frame-001.cr2");
    return {
      previewStates,
      missingStates,
      rawPartnerMatches: Boolean(jpeg?.rawPartnerId && raw?.id && jpeg.rawPartnerId === raw.id)
    };
  });
  expect(assetState.previewStates).toEqual([
    ["frame-001.cr2", "raw-placeholder"],
    ["frame-001.jpg", "ready"]
  ]);
  expect(assetState.missingStates).toEqual([
    ["frame-001.cr2", "present"],
    ["frame-001.jpg", "present"]
  ]);
  expect(assetState.rawPartnerMatches).toBe(true);

  const importedProjectSettings = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    return { name: project.name, preset: project.preset };
  });
  expect(importedProjectSettings).toEqual({ name: "Trackside qualifying", preset: "motorsport" });

  await expect(page.getByRole("region", { name: "Source status" })).toContainText("Original source available");
  await page.getByRole("button", { name: "Mark missing" }).click();
  await expect(page.getByRole("region", { name: "Source status" })).toContainText("Source needs relinking");

  const missingState = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    const missingAssets = (project.assets ?? []).filter((asset: { missingState: string }) => asset.missingState === "missing");
    return {
      assetCount: project.assets?.length ?? 0,
      missingCount: missingAssets.length,
      missingAssetId: missingAssets[0]?.id
    };
  });
  expect(missingState.assetCount).toBe(2);
  expect(missingState.missingCount).toBe(1);

  await page.locator("input[type=file]").setInputFiles(importFiles()[0]);
  await expect(page.getByRole("region", { name: "Source status" })).toContainText("Original source available");

  const relinkState = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    const relinkedAsset = (project.assets ?? []).find((asset: { missingState: string }) => asset.missingState === "relinked");
    return {
      assetCount: project.assets?.length ?? 0,
      relinkedAssetId: relinkedAsset?.id,
      relinkedSourcePath: relinkedAsset?.sourcePath,
      relinkedPreviewState: relinkedAsset?.previewState
    };
  });
  expect(relinkState).toMatchObject({
    assetCount: 2,
    relinkedAssetId: missingState.missingAssetId,
    relinkedSourcePath: "frame-001.jpg",
    relinkedPreviewState: "ready"
  });

  await page.keyboard.press("2");
  await expect(page.getByText("1 selected")).toBeVisible();

  const decisionLedger = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    if (!activeProjectId) return [];
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    return project.decisionEvents ?? [];
  });
  expect(decisionLedger).toHaveLength(1);
  expect(decisionLedger[0]).toMatchObject({
    previousHumanDisposition: "unseen",
    humanDisposition: "select",
    revision: 1,
    actor: "human"
  });

  await page.getByRole("button", { name: "Grid" }).click();
  await page.getByRole("button", { name: "Selected" }).click();
  await expect(page.locator("button.contact-thumb")).toHaveCount(1);
  await expect(page.locator("button.contact-thumb")).toContainText("frame-001.jpg");
  await page.locator("button.contact-thumb").click();
  await expect(page.getByRole("region", { name: "Marked frames" }).getByRole("status")).toHaveText("1 marked");
  await page.getByLabel("Manual tag").fill("Portfolio Pick");
  await page.getByRole("button", { name: "Apply manual tag" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
        if (!activeProjectId) return [];
        const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
        const selected = (project.assets ?? []).find((asset: { humanDisposition: string }) => asset.humanDisposition === "select");
        return selected?.tags ?? [];
      })
    )
    .toContain("manual:portfolio-pick");
  const tagEvents = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    if (!activeProjectId) return [];
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    return project.tagEvents ?? [];
  });
  expect(tagEvents).toHaveLength(1);
  expect(tagEvents[0]).toMatchObject({
    tag: "manual:portfolio-pick",
    mutation: "add",
    actor: "human"
  });

  await page.getByRole("button", { name: "Export preview" }).click();
  await expect(page.getByRole("region", { name: "Export preview" })).toContainText("1 XMP files");
  await expect(page.getByRole("region", { name: "Export preview" })).toContainText("0 originals modified");
  await expect(page.getByRole("region", { name: "Export preview" })).toContainText("2 metadata rows");
  await expect(page.getByRole("region", { name: "Export preview" })).toContainText("frame-001.xmp");
  const exportMetadata = await page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem("framescout.activeProjectId");
    if (!activeProjectId) return null;
    const project = JSON.parse(window.localStorage.getItem(`framescout.project.${activeProjectId}`) ?? "{}");
    const selected = (project.assets ?? []).find((asset: { humanDisposition: string }) => asset.humanDisposition === "select");
    return {
      selectedTags: selected?.tags ?? [],
      decisionEvents: project.decisionEvents ?? [],
      tagEvents: project.tagEvents ?? []
    };
  });
  expect(exportMetadata?.selectedTags).toContain("manual:portfolio-pick");
  expect(exportMetadata?.decisionEvents).toHaveLength(1);
  expect(exportMetadata?.tagEvents).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole("region", { name: "Review Desk" })).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible();
});
