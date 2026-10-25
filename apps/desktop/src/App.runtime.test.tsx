import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedProject } from "@framescout/contracts";
import { App } from "./App";
import { createTauriProjectClient, type TauriInvoke } from "./features/project/tauriProjectClient";
import { createBrowserProjectClient } from "./features/project/projectClient";

afterEach(cleanup);

const project: PersistedProject = {
  id: "native-project",
  name: "Native review",
  preset: "matchday-story",
  sourceFolder: "C:\\Pictures",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  decisionRevision: 0,
  snapshotRevision: 0,
  decisionEvents: [],
  tagEvents: [],
  assets: [{
    id: "native-asset",
    fileName: "frame.jpg",
    sourcePath: "C:\\Pictures\\frame.jpg",
    fileFingerprint: "frame::1::2",
    decisionRevision: 0,
    previewState: "ready",
    missingState: "present",
    captureTime: "",
    camera: "Native scan",
    lens: "Pending metadata",
    exposure: "Pending preview",
    iso: 0,
    previewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    aiDisposition: "keep",
    humanDisposition: "unseen",
    reasons: [],
    tags: [],
    evidence: []
  }]
};

describe("App native runtime", () => {
  it("opens the manual tag dialog from the left-hand F shortcut", () => {
    const client = createBrowserProjectClient(window.localStorage);
    const view = render(<App runtimeProjectClient={{ kind: "browser", client, activeProject: null }} />);

    fireEvent.keyDown(window, { key: "f", code: "KeyF" });

    expect(view.getByRole("dialog", { name: "添加标签" })).toBeTruthy();
  });

  it("shows a real empty projects screen when the service has no active project", async () => {
    const invoke = vi.fn().mockImplementation(async (command: string) => {
      if (command === "analysis_config_get") return { profiles: [], selectedProfileId: "local-gpu-quality" };
      throw new Error(`Unexpected native command: ${command}`);
    });

    const view = render(<App runtimeProjectClient={{ kind: "tauri", client: createTauriProjectClient(invoke as TauriInvoke), activeProject: null }} />);

    expect(view.getByRole("button", { name: "新建审阅" })).toBeTruthy();
    expect(view.queryByText("Friday night finals")).toBeNull();
    expect(view.queryByText("Fixture data")).toBeNull();
  });

  it("polls lightweight analysis status instead of re-enqueueing the full project", async () => {
    const running = {
      ...project,
      analysisRuns: [{
        id: "run-1",
        projectId: project.id,
        status: "running" as const,
        totalAssets: 1,
        previewsReady: 0,
        rawPlaceholders: 0,
        missingAssets: 0,
        progress: 0,
        backend: "gpu" as const,
        queuedAt: "2026-07-12T00:00:00.000Z"
      }]
    };
    const invoke = vi.fn().mockImplementation(async (command: string) => {
      if (command === "analysis_config_get") return { profiles: [], selectedProfileId: "local-gpu-quality" };
      if (command === "analysis_status") return { run: running.analysisRuns[0] };
      throw new Error(`Unexpected native command: ${command}`);
    });

    render(<App runtimeProjectClient={{ kind: "tauri", client: createTauriProjectClient(invoke as TauriInvoke), activeProject: running }} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("analysis_status", { projectId: "native-project" }), { timeout: 2_000 });
    expect(invoke).not.toHaveBeenCalledWith("analysis_enqueue", expect.anything());
  });

  it("polls lightweight indexing counters instead of loading every asset", async () => {
    const indexing = { ...project, indexingState: "indexing" as const };
    const invoke = vi.fn().mockImplementation(async (command: string) => {
      if (command === "analysis_config_get") return { profiles: [], selectedProfileId: "local-gpu-quality" };
      if (command === "project_index_status") {
        return { projectId: project.id, state: "indexing", discovered: 1000, indexed: 64, previewsReady: 32, failed: 0 };
      }
      throw new Error(`Unexpected native command: ${command}`);
    });

    render(<App runtimeProjectClient={{ kind: "tauri", client: createTauriProjectClient(invoke as TauriInvoke), activeProject: indexing }} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("project_index_status", { projectId: "native-project" }));
    expect(invoke).not.toHaveBeenCalledWith("project_load_active");
  });

  it("persists a review decision through the Tauri client", async () => {
    const selected: PersistedProject = {
      ...project,
      snapshotRevision: 1,
      decisionRevision: 1,
      assets: project.assets.map((asset) => ({ ...asset, humanDisposition: "select", decisionRevision: 1 }))
    };
    const invoke = vi.fn().mockImplementation(async (command: string) => {
      if (command === "decision_set_batch") {
        return { project: selected, events: selected.decisionEvents } as never;
      }
      throw new Error(`Unexpected native command: ${command}`);
    });

    render(<App runtimeProjectClient={{ kind: "tauri", client: createTauriProjectClient(invoke as TauriInvoke), activeProject: project }} />);
    fireEvent.keyDown(window, { key: "2" });

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("decision_set_batch", {
      projectId: "native-project",
      input: {
        changes: [{
          assetId: "native-asset",
          humanDisposition: "select",
          assetRevision: 0
        }]
      }
    }));
  });
});
