import { beforeEach, describe, expect, it } from "vitest";
import { createBrowserProjectClient } from "./projectClient";
import { defaultExportSettings } from "./projectExport";

const file = (name: string, size = 1024, lastModified = 1000, path?: string) => ({
  name,
  size,
  lastModified,
  webkitRelativePath: path
});

describe("projectClient", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes explicit Phase 1 command names", () => {
    const client = createBrowserProjectClient(localStorage);

    expect(client.commands).toEqual([
      "project.create",
      "project.loadActive",
      "project.saveSnapshot",
      "analysis.enqueue",
      "metadata.refresh",
      "selection.goalSet",
      "review.next",
      "decision.set",
      "tag.apply",
      "group.open",
      "export.preview",
      "export.commit"
    ]);
  });

  it("creates a project through the command-shaped browser adapter", () => {
    const client = createBrowserProjectClient(localStorage);
    const response = client.create({
      name: "Command test",
      roots: ["FridayFinals"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [{ ...file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg"), previewDataUrl: "data:image/jpeg;base64,abc" }]
    });

    expect(response.project.name).toBe("Command test");
    expect(response.project.total).toBe(1);
    expect(response.persisted.sourceFolder).toBe("FridayFinals");
    expect(response.persisted.assets[0].fileFingerprint).toBe("shoot/frame-001.jpg::2000::1");
    expect(client.loadActive().project?.id).toBe(response.persisted.id);
  });

  it("lists and opens prior browser projects through the project client", () => {
    const client = createBrowserProjectClient(localStorage);
    const first = client.create({
      name: "First project",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [file("first.jpg")]
    }).persisted;
    const second = client.create({
      name: "Second project",
      roots: ["browser-selected-files"],
      preset: "motorsport",
      settings: { keepOriginalsUntouched: true },
      files: [file("second.jpg")]
    }).persisted;

    expect(client.listProjects().map((project) => project.id)).toEqual([second.id, first.id]);
    expect(client.loadProject(first.id).project).toMatchObject({ id: first.id, name: "First project" });
    expect(client.loadActive().project?.id).toBe(first.id);
  });

  it("returns a decision event and persists the updated project", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Decision command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [file("frame-001.jpg")]
    });

    const response = client.setDecision(persisted, {
      assetId: persisted.assets[0].id,
      humanDisposition: "select",
      assetRevision: 0
    });

    expect(response.event).toMatchObject({
      assetId: persisted.assets[0].id,
      humanDisposition: "select",
      revision: 1,
      actor: "human"
    });
    expect(client.loadActive().project?.assets[0].humanDisposition).toBe("select");
  });

  it("enqueues a browser analysis run and persists queue progress", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Analysis command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [{ ...file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg"), previewDataUrl: "data:image/jpeg;base64,abc" }]
    });

    const response = client.enqueueAnalysis(persisted, { projectId: persisted.id });

    expect(response.run).toMatchObject({
      projectId: persisted.id,
      status: "completed",
      totalAssets: 1,
      previewsReady: 1,
      progress: 1,
      backend: "browser"
    });
    expect(client.loadActive().project?.analysisRuns).toHaveLength(1);
  });

  it("rejects analysis enqueue for a different project id", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Analysis conflict",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [file("frame-001.jpg")]
    });

    expect(() => client.enqueueAnalysis(persisted, { projectId: "other-project" })).toThrow("Analysis enqueue project id mismatch.");
  });

  it("returns review.next queue state through the browser adapter", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Review command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [
        { ...file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg"), previewDataUrl: "data:image/jpeg;base64,abc" },
        file("frame-002.cr2", 4000, 2, "shoot/frame-002.cr2")
      ]
    });

    const response = client.reviewNext(persisted, {
      projectId: persisted.id,
      cursor: 0,
      direction: "next"
    });

    expect(response).toMatchObject({
      cursor: 1,
      queueLength: 2,
      asset: { fileName: "frame-002.cr2" }
    });
  });

  it("rejects stale decision revisions", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Conflict command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [file("frame-001.jpg")]
    });

    expect(() =>
      client.setDecision(persisted, {
        assetId: persisted.assets[0].id,
        humanDisposition: "select",
        assetRevision: 2
      })
    ).toThrow("Decision revision conflict.");
  });

  it("applies manual tags through the command-shaped browser adapter", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Tag command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [{ ...file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg"), previewDataUrl: "data:image/jpeg;base64,abc" }]
    });

    const response = client.applyTag(persisted, {
      assetIds: [persisted.assets[0].id],
      tag: "Portfolio Pick",
      mutation: "add"
    });

    expect(response.event).toMatchObject({
      assetIds: [persisted.assets[0].id],
      tag: "manual:portfolio-pick",
      mutation: "add",
      actor: "human"
    });
    expect(response.project.assets[0].tags).toContain("manual:portfolio-pick");
    expect(client.loadActive().project?.tagEvents).toHaveLength(1);
  });

  it("opens grouped assets through the browser adapter", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Group command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [
        { ...file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg"), previewDataUrl: "data:image/jpeg;base64,abc" },
        file("frame-001.cr2", 4000, 2, "shoot/frame-001.cr2")
      ]
    });
    const groupedProject = {
      ...persisted,
      assets: persisted.assets.map((asset) => ({ ...asset, groupId: "burst-browser" }))
    };

    const response = client.openGroup(groupedProject, {
      projectId: groupedProject.id,
      groupId: "burst-browser",
      focusAssetId: groupedProject.assets[1].id
    });

    expect(response.assets).toHaveLength(2);
    expect(response.focusIndex).toBe(1);
    expect(response.evidence[0]).toMatchObject({ label: "Group size" });
  });

  it("returns an XMP-safe export preview through the browser adapter", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Export command",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [
        file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg"),
        file("frame-001.cr2", 4000, 1, "shoot/frame-001.cr2")
      ]
    });
    const selected = client.setDecision(persisted, {
      assetId: persisted.assets[0].id,
      humanDisposition: "select",
      assetRevision: 0
    }).project;

    const preview = client.exportPreview(selected, {
      projectId: selected.id,
      settings: {
        ...defaultExportSettings,
        destinationDir: "D:\\Retouch\\Friday-finals",
        media: "proxies"
      }
    });

    expect(preview).toMatchObject({
      projectId: selected.id,
      originalFilesModified: 0,
      xmpFilesToWrite: 1
    });
    expect(preview.targets[0]).toMatchObject({
      sidecarPath: "shoot/frame-001.xmp",
      humanDisposition: "select",
      rating: 5,
      colorLabel: "Green"
    });
    expect(preview.filesToCopy).toEqual([expect.objectContaining({
      sourcePath: "shoot/frame-001.jpg",
      destinationPath: "D:\\Retouch\\Friday-finals/selected/frame-001.jpg",
      kind: "proxy"
    })]);
  });

  it("refuses export.commit in the browser adapter without writing sidecars", () => {
    const client = createBrowserProjectClient(localStorage);
    const { persisted } = client.create({
      name: "Export commit boundary",
      roots: ["browser-selected-files"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true },
      files: [file("frame-001.jpg", 2000, 1, "shoot/frame-001.jpg")]
    });
    const selected = client.setDecision(persisted, {
      assetId: persisted.assets[0].id,
      humanDisposition: "select",
      assetRevision: 0
    }).project;
    const preview = client.exportPreview(selected, { projectId: selected.id });

    const response = client.exportCommit(selected, {
      projectId: selected.id,
      preview,
      settings: preview.settings,
      explicitConfirmation: true
    });

    expect(response).toEqual({
      projectId: selected.id,
      committed: false,
      reason: "native-export-not-wired",
      originalFilesModified: 0,
      xmpFilesWritten: 0,
      filesCopied: 0,
      rawFilesCopied: 0
    });
  });
});
