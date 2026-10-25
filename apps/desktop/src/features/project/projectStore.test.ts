import { beforeEach, describe, expect, it } from "vitest";
import {
  assetFromFile,
  analysisRunForProject,
  createLocalProjectStore,
  fingerprintFile,
  isSupportedPhaseOneFile,
  pairRawPreviewAssets,
  projectWithMissingState,
  projectWithPolicy,
  projectWithRelinkedAsset,
  projectWithTagMutation
} from "./projectStore";

const file = (name: string, size = 1024, lastModified = 1000, path?: string) => ({
  name,
  size,
  lastModified,
  webkitRelativePath: path
});

const storeFixture = () =>
  createLocalProjectStore(localStorage).createProject({
    name: "Tag event fixture",
    preset: "matchday-story",
    files: [
      {
        ...file("frame-001.jpg", 2048, 1200, "shoot/frame-001.jpg"),
        previewDataUrl: "data:image/jpeg;base64,abc"
      }
    ]
  });

describe("projectStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("accepts Phase 1 preview and Canon CR2 files only", () => {
    expect(isSupportedPhaseOneFile(file("frame.jpg"))).toBe(true);
    expect(isSupportedPhaseOneFile(file("frame.png"))).toBe(true);
    expect(isSupportedPhaseOneFile(file("frame.CR2"))).toBe(true);
    expect(isSupportedPhaseOneFile(file("notes.txt"))).toBe(false);
  });

  it("creates stable file fingerprints without reading or mutating originals", () => {
    expect(fingerprintFile(file("frame.jpg", 4096, 1234, "shoot/frame.jpg"))).toBe("shoot/frame.jpg::4096::1234");
  });

  it("recomputes only the AI disposition when project policy changes", () => {
    const fixture = storeFixture();
    const project = {
      ...fixture,
      assets: [{
        ...fixture.assets[0],
        aiDisposition: "review" as const,
        humanDisposition: "select" as const,
        reasons: ["no_allowed_subject_preserved_by_matchday"],
        tags: ["venue"]
      }]
    };

    const updated = projectWithPolicy(project, "action-coverage", "2026-07-12T10:00:00.000Z");

    expect(updated.preset).toBe("action-coverage");
    expect(updated.assets[0]).toMatchObject({
      aiDisposition: "reject",
      humanDisposition: "select",
      reasons: ["no_allowed_subject_preserved_by_matchday"],
      tags: ["venue"]
    });
    expect(updated.decisionRevision).toBe(project.decisionRevision);
    expect(updated.decisionEvents).toEqual(project.decisionEvents);
  });

  it("persists project assets and human decisions across reload", () => {
    const store = createLocalProjectStore(localStorage);
    const project = store.createProject({
      name: "Restart test",
      preset: "matchday-story",
      files: [
        file("frame-001.jpg", 2048, 111, "restart/frame-001.jpg"),
        file("frame-002.cr2", 4096, 112, "restart/frame-002.cr2"),
        file("ignore.txt", 12, 113, "restart/ignore.txt")
      ]
    });

    expect(project.assets).toHaveLength(2);
    expect(project.assets.every((asset) => asset.missingState === "present")).toBe(true);
    expect(project.assets[1].previewState).toBe("raw-placeholder");

    const updated = store.updateDecision(project, project.assets[0].id, "select");
    const reloaded = createLocalProjectStore(localStorage).loadActiveProject();

    expect(updated.decisionRevision).toBe(1);
    expect(updated.decisionEvents).toHaveLength(1);
    expect(updated.decisionEvents[0]).toMatchObject({
      previousHumanDisposition: "unseen",
      humanDisposition: "select",
      revision: 1,
      actor: "human"
    });
    expect(reloaded?.assets[0].humanDisposition).toBe("select");
    expect(reloaded?.decisionEvents[0].humanDisposition).toBe("select");
    expect(reloaded?.assets[0].fileFingerprint).toBe("restart/frame-001.jpg::2048::111");
  });

  it("lists recent projects and restores a chosen project as active", () => {
    const store = createLocalProjectStore(localStorage);
    const first = store.createProject({ name: "Friday finals", preset: "matchday-story", files: [file("first.jpg")] });
    const second = store.createProject({ name: "Pit wall", preset: "motorsport", files: [file("second.jpg")] });

    expect(store.listProjects().map((project) => project.id)).toEqual([second.id, first.id]);
    expect(store.loadProject(first.id)).toMatchObject({ id: first.id, name: "Friday finals" });
    expect(store.loadActiveProject()).toMatchObject({ id: first.id, name: "Friday finals" });
    expect(store.listProjects().map((project) => project.id)[0]).toBe(first.id);
  });

  it("marks browser-readable previews ready while keeping CR2 as placeholder", () => {
    const jpeg = assetFromFile({
      ...file("frame.jpg", 2048, 1200, "shoot/frame.jpg"),
      previewDataUrl: "data:image/jpeg;base64,abc"
    });
    const cr2 = assetFromFile(file("frame.cr2", 4096, 1201, "shoot/frame.cr2"));

    expect(jpeg.previewState).toBe("ready");
    expect(jpeg.missingState).toBe("present");
    expect(jpeg.previewUrl).toBe("data:image/jpeg;base64,abc");
    expect(jpeg.tags).toContain("preview:ready");
    expect(cr2.previewState).toBe("raw-placeholder");
    expect(cr2.missingState).toBe("present");
    expect(cr2.tags).toContain("preview:raw-placeholder");
  });

  it("builds and persists browser analysis queue progress without decoding originals", () => {
    const store = createLocalProjectStore(localStorage);
    const project = store.createProject({
      name: "Analysis progress",
      preset: "matchday-story",
      files: [
        {
          ...file("frame-001.jpg", 2048, 1200, "shoot/frame-001.jpg"),
          previewDataUrl: "data:image/jpeg;base64,abc"
        },
        file("frame-001.cr2", 4096, 1201, "shoot/frame-001.cr2")
      ]
    });

    const run = analysisRunForProject(project, "2026-07-11T11:00:00.000Z");
    const updated = store.enqueueAnalysis(project);
    const reloaded = createLocalProjectStore(localStorage).loadActiveProject();

    expect(run).toMatchObject({
      projectId: project.id,
      status: "completed",
      totalAssets: 2,
      previewsReady: 2,
      rawPlaceholders: 1,
      missingAssets: 0,
      progress: 1,
      backend: "browser",
      completedAt: "2026-07-11T11:00:00.000Z"
    });
    expect(updated.analysisRuns).toHaveLength(1);
    expect(reloaded?.analysisRuns?.[0]).toMatchObject({
      totalAssets: 2,
      previewsReady: 2,
      rawPlaceholders: 1,
      backend: "browser"
    });
  });

  it("marks missing assets as relink-needed metadata without changing decisions", () => {
    const store = createLocalProjectStore(localStorage);
    const project = store.createProject({
      name: "Missing source test",
      preset: "matchday-story",
      files: [
        {
          ...file("frame-001.jpg", 2048, 1200, "shoot/frame-001.jpg"),
          previewDataUrl: "data:image/jpeg;base64,abc"
        }
      ]
    });

    const updated = projectWithMissingState(project, [project.assets[0].id], "missing", "2026-07-11T10:00:00.000Z");

    expect(updated.assets[0]).toMatchObject({
      sourcePath: "shoot/frame-001.jpg",
      missingState: "missing",
      previewState: "needs-relink"
    });
    expect(updated.decisionRevision).toBe(0);
    expect(updated.decisionEvents).toHaveLength(0);
    expect(updated.updatedAt).toBe("2026-07-11T10:00:00.000Z");
  });

  it("applies manual tag mutations with an append-only tag event", () => {
    const project = storeFixture();
    const result = projectWithTagMutation(project, [project.assets[0].id], "Portfolio Pick", "add", "2026-07-11T12:00:00.000Z");

    expect(result.event).toEqual({
      assetIds: [project.assets[0].id],
      tag: "manual:portfolio-pick",
      mutation: "add",
      changedAt: "2026-07-11T12:00:00.000Z",
      actor: "human"
    });
    expect(result.project.assets[0].tags).toContain("manual:portfolio-pick");
    expect(result.project.assets[0].tags).toContain("system:imported");
    expect(result.project.tagEvents).toEqual([result.event]);
  });

  it("persists missing-state updates through the local project store", () => {
    const store = createLocalProjectStore(localStorage);
    const project = store.createProject({
      name: "Relink metadata",
      preset: "matchday-story",
      files: [file("frame-001.cr2", 4096, 1201, "shoot/frame-001.cr2")]
    });

    store.updateMissingState(project, [project.assets[0].id], "missing");
    const reloaded = createLocalProjectStore(localStorage).loadActiveProject();

    expect(reloaded?.assets[0].missingState).toBe("missing");
    expect(reloaded?.assets[0].previewState).toBe("needs-relink");
    expect(reloaded?.assets[0].sourcePath).toBe("shoot/frame-001.cr2");
  });

  it("relinks a missing asset without creating a duplicate or changing human decisions", () => {
    const store = createLocalProjectStore(localStorage);
    const project = store.createProject({
      name: "Relink identity",
      preset: "matchday-story",
      files: [file("frame-001.jpg", 2048, 1200, "shoot/frame-001.jpg")]
    });
    const selected = store.updateDecision(project, project.assets[0].id, "select");
    const missing = projectWithMissingState(selected, [selected.assets[0].id], "missing", "2026-07-11T10:00:00.000Z");

    const relinked = projectWithRelinkedAsset(
      missing,
      missing.assets[0].id,
      {
        ...file("frame-001.jpg", 2048, 1300, "restored/frame-001.jpg"),
        previewDataUrl: "data:image/jpeg;base64,restored"
      },
      "2026-07-11T10:05:00.000Z"
    );

    expect(relinked.assets).toHaveLength(1);
    expect(relinked.assets[0]).toMatchObject({
      id: project.assets[0].id,
      humanDisposition: "select",
      sourcePath: "restored/frame-001.jpg",
      fileFingerprint: "restored/frame-001.jpg::2048::1300",
      missingState: "relinked",
      previewState: "ready",
      previewUrl: "data:image/jpeg;base64,restored"
    });
    expect(relinked.assets[0].tags).toContain("source:relinked");
    expect(relinked.assets[0].evidence.some((signal) => signal.label === "Relinked source")).toBe(true);
    expect(relinked.decisionRevision).toBe(1);
    expect(relinked.decisionEvents).toHaveLength(1);
  });

  it("pairs same-stem browser previews with Canon RAW assets", () => {
    const assets = pairRawPreviewAssets([
      assetFromFile({
        ...file("frame-001.jpg", 2048, 1200, "shoot/frame-001.jpg"),
        previewDataUrl: "data:image/jpeg;base64,abc"
      }),
      assetFromFile(file("frame-001.cr2", 4096, 1201, "shoot/frame-001.cr2")),
      assetFromFile(file("frame-002.jpg", 2048, 1202, "shoot/frame-002.jpg"))
    ]);

    expect(assets[0].rawPartnerId).toBe(assets[1].id);
    expect(assets[0].tags).toContain("pair:raw-sidecar-target");
    expect(assets[0].evidence.some((signal) => signal.label === "RAW pair" && signal.value === "frame-001.cr2")).toBe(true);
    expect(assets[2].rawPartnerId).toBeUndefined();
  });
});
