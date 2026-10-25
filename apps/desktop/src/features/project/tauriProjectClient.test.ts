import { describe, expect, it, vi } from "vitest";
import { createTauriProjectClient } from "./tauriProjectClient";
import type { PersistedProject } from "@framescout/contracts";

const project: PersistedProject = {
  id: "project-1",
  name: "Native project",
  preset: "matchday-story",
  sourceFolder: "D:/shoot",
  createdAt: "2026-07-11T00:00:00Z",
  updatedAt: "2026-07-11T00:00:00Z",
  assets: [],
  decisionRevision: 3,
  decisionEvents: []
};

describe("tauriProjectClient", () => {
  it("polls lightweight analysis status without loading the full project", async () => {
    const invoke = vi.fn().mockResolvedValue({ run: null });
    const client = createTauriProjectClient(invoke);

    await client.getAnalysisStatus("project-1");

    expect(invoke).toHaveBeenCalledWith("analysis_status", { projectId: "project-1" });
  });

  it("polls lightweight indexing counters without loading asset payloads", async () => {
    const invoke = vi.fn().mockResolvedValue({
      projectId: "project-1",
      state: "indexing",
      discovered: 120,
      indexed: 96,
      previewsReady: 64,
      failed: 1
    });
    const client = createTauriProjectClient(invoke);

    await client.getIndexStatus("project-1");

    expect(invoke).toHaveBeenCalledWith("project_index_status", { projectId: "project-1" });
  });

  it("preserves localhost media URLs returned by the Web service", async () => {
    const invoke = vi.fn().mockResolvedValue({
      project: {
        ...project,
        assets: [{
          id: "asset-1", fileName: "frame.jpg", captureTime: "", camera: "", lens: "", exposure: "", iso: 0,
          previewUrl: "http://127.0.0.1:4310/api/media/asset-1", previewState: "ready",
          aiDisposition: "keep", humanDisposition: "unseen", reasons: [], tags: [], evidence: [],
          sourcePath: "G:/f1/frame.jpg", displayCachePath: "C:/proxy/display.jpg"
        }]
      }
    });
    const client = createTauriProjectClient(invoke);

    const response = await client.loadActive();

    expect(response.project?.assets[0]?.previewUrl).toBe("http://127.0.0.1:4310/api/media/asset-1");
  });

  it("exposes the spec command names while invoking Tauri-safe command ids", async () => {
    const invoke = vi.fn().mockResolvedValue({ project: null });
    const client = createTauriProjectClient(invoke);

    expect(client.commands).toEqual([
      "project.create",
      "project.loadActive",
      "project.indexStatus",
      "project.saveSnapshot",
      "mapping.setManual",
      "analysis.configGet",
      "analysis.configSet",
      "analysis.enqueue",
      "analysis.status",
      "metadata.refresh",
      "selection.goalSet",
      "review.next",
      "decision.set",
      "decision.setBatch",
      "tag.apply",
      "tag.applyBatch",
      "group.open",
      "export.preview",
      "export.commit"
    ]);

    await client.loadActive();
    expect(invoke).toHaveBeenCalledWith("project_load_active");
  });

  it("keeps cloud-first routing preferences behind localhost commands", async () => {
    const config = {
      activeProfileId: "local-gpu-fast",
      profiles: [],
      secretStorage: "terminal-environment",
      maxCloudProxyPixels: 2560000,
      executionMode: "local",
      cloudBudgetCents: 500,
      cloudConcurrency: 2
    };
    const invoke = vi.fn().mockResolvedValue(config);
    const client = createTauriProjectClient(invoke);

    await client.getAnalysisConfig();
    await client.setAnalysisConfig({
      profileId: "custom-cloud",
      endpoint: "https://example.test/v1/chat/completions",
      model: "vision-test",
      executionMode: "cloud",
      cloudBudgetCents: 500,
      cloudConcurrency: 2
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "analysis_config_get");
    expect(invoke).toHaveBeenNthCalledWith(2, "analysis_config_set", {
      input: {
        profileId: "custom-cloud",
        endpoint: "https://example.test/v1/chat/completions",
        model: "vision-test",
        executionMode: "cloud",
        cloudBudgetCents: 500,
        cloudConcurrency: 2
      }
    });
  });

  it("sends a manual RAW mapping through the project-scoped native command", async () => {
    const invoke = vi.fn().mockResolvedValue({ project });
    const client = createTauriProjectClient(invoke);

    await client.setManualMapping(project, {
      assetId: "proxy-1",
      masterPath: "D:/raw/IMG_0001.CR2"
    });

    expect(invoke).toHaveBeenCalledWith("mapping_set_manual", {
      projectId: "project-1",
      input: {
        assetId: "proxy-1",
        masterPath: "D:/raw/IMG_0001.CR2"
      }
    });
  });

  it("passes project.create through as an explicit request object", async () => {
    const invoke = vi.fn().mockResolvedValue({
      project: {
        id: "project-1",
        name: "Native project",
        preset: "matchday-story",
        sourceFolder: "D:/shoot",
        coverUrl: "",
        reviewed: 0,
        selected: 0,
        aiRejects: 0,
        total: 0,
        lastOpened: "now"
      }
    });
    const client = createTauriProjectClient(invoke);

    await client.create({
      name: "Native project",
      roots: ["D:/shoot"],
      preset: "matchday-story",
      settings: { keepOriginalsUntouched: true }
    });

    expect(invoke).toHaveBeenCalledWith("project_create", {
      input: {
        name: "Native project",
        roots: ["D:/shoot"],
        preset: "matchday-story",
        settings: { keepOriginalsUntouched: true }
      }
    });
  });

  it("sends decision.set with a project id and optimistic revision", async () => {
    const invoke = vi.fn().mockResolvedValue({
      project,
      event: {
        assetId: "asset-1",
        humanDisposition: "select",
        revision: 4,
        changedAt: "2026-07-11T00:01:00Z",
        actor: "human"
      }
    });
    const client = createTauriProjectClient(invoke);

    await client.setDecision(project, {
      assetId: "asset-1",
      humanDisposition: "select",
      assetRevision: 3
    });

    expect(invoke).toHaveBeenCalledWith("decision_set", {
      projectId: "project-1",
      input: {
        assetId: "asset-1",
        humanDisposition: "select",
        assetRevision: 3
      }
    });
  });

  it("sends changed decisions as one batch", async () => {
    const invoke = vi.fn().mockResolvedValue({ project, events: [] });
    const client = createTauriProjectClient(invoke);
    const changes = [{
      assetId: "asset-1",
      humanDisposition: "select" as const,
      assetRevision: 3
    }];

    await client.setDecisions(project, { changes });

    expect(invoke).toHaveBeenCalledWith("decision_set_batch", {
      projectId: "project-1",
      input: { changes }
    });
  });

  it("sends analysis.enqueue with a project id and priority", async () => {
    const invoke = vi.fn().mockResolvedValue({
      run: {
        id: "run-1",
        projectId: "project-1",
        status: "queued",
        totalAssets: 0,
        previewsReady: 0,
        rawPlaceholders: 0,
        missingAssets: 0,
        progress: 0,
        backend: "cpu",
        queuedAt: "2026-07-11T00:00:00Z"
      },
      project
    });
    const client = createTauriProjectClient(invoke);

    await client.enqueueAnalysis(project, {
      projectId: "project-1",
      priority: "normal"
    });

    expect(invoke).toHaveBeenCalledWith("analysis_enqueue", {
      projectId: "project-1",
      input: {
        projectId: "project-1",
        priority: "normal"
      }
    });
  });

  it("sends review.next with a project id and cursor", async () => {
    const invoke = vi.fn().mockResolvedValue({
      asset: null,
      cursor: 0,
      queueLength: 0
    });
    const client = createTauriProjectClient(invoke);

    await client.reviewNext(project, {
      projectId: "project-1",
      cursor: 1,
      direction: "previous",
      showAiRejects: false
    });

    expect(invoke).toHaveBeenCalledWith("review_next", {
      projectId: "project-1",
      input: {
        projectId: "project-1",
        cursor: 1,
        direction: "previous",
        showAiRejects: false
      }
    });
  });

  it("sends tag.apply with a project id and tag mutation", async () => {
    const invoke = vi.fn().mockResolvedValue({
      event: {
        assetIds: ["asset-1"],
        tag: "manual:portfolio-pick",
        mutation: "add",
        changedAt: "2026-07-11T00:02:00Z",
        actor: "human"
      },
      project
    });
    const client = createTauriProjectClient(invoke);

    await client.applyTag(project, {
      assetIds: ["asset-1"],
      tag: "Portfolio Pick",
      mutation: "add"
    });

    expect(invoke).toHaveBeenCalledWith("tag_apply", {
      projectId: "project-1",
      input: {
        assetIds: ["asset-1"],
        tag: "Portfolio Pick",
        mutation: "add"
      }
    });
  });

  it("sends group.open with a project id and group id", async () => {
    const invoke = vi.fn().mockResolvedValue({
      groupId: "burst-74",
      assets: [],
      focusIndex: 0,
      evidence: []
    });
    const client = createTauriProjectClient(invoke);

    await client.openGroup(project, {
      projectId: "project-1",
      groupId: "burst-74",
      focusAssetId: "asset-1"
    });

    expect(invoke).toHaveBeenCalledWith("group_open", {
      projectId: "project-1",
      input: {
        projectId: "project-1",
        groupId: "burst-74",
        focusAssetId: "asset-1"
      }
    });
  });

  it("sends export.preview with a project id and request body", async () => {
    const invoke = vi.fn().mockResolvedValue({
      projectId: "project-1",
      originalFilesModified: 0,
      xmpFilesToWrite: 0,
      targets: [],
      skipped: []
    });
    const client = createTauriProjectClient(invoke);

    await client.exportPreview(project, {
      projectId: "project-1",
      includeAiReasonKeywords: false
    });

    expect(invoke).toHaveBeenCalledWith("export_preview", {
      projectId: "project-1",
      input: {
        projectId: "project-1",
        includeAiReasonKeywords: false
      }
    });
  });

  it("sends export.commit only after an explicit preview and confirmation", async () => {
    const invoke = vi.fn().mockResolvedValue({
      projectId: "project-1",
      committed: false,
      reason: "native-export-not-wired",
      originalFilesModified: 0,
      xmpFilesWritten: 0,
      filesCopied: 0,
      rawFilesCopied: 0
    });
    const client = createTauriProjectClient(invoke);
    const preview = {
      projectId: "project-1",
      originalFilesModified: 0 as const,
      settings: {
        destinationDir: "D:/Retouch",
        selectionScope: "selected" as const,
        includedFolderGroups: [],
        includedTags: [],
        excludedTags: [],
        filterMatch: "all" as const,
        media: "proxies-and-raw" as const,
        rawLayout: "raw-subfolder" as const,
        preserveFolderStructure: true,
        includeXmp: true,
        includeCsv: true,
        collision: "rename" as const
      },
      filesToCopy: [],
      xmpFilesToWrite: 0,
      targets: [],
      skipped: [],
      metadataRecords: [],
      csvPreview: ""
    };

    await client.exportCommit(project, {
      projectId: "project-1",
      preview,
      settings: preview.settings,
      explicitConfirmation: true
    });

    expect(invoke).toHaveBeenCalledWith("export_commit", {
      projectId: "project-1",
      input: {
        projectId: "project-1",
        preview,
        settings: preview.settings,
        explicitConfirmation: true
      }
    });
  });
});
