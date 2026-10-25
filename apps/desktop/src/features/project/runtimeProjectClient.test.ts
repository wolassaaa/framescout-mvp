import { describe, expect, it, vi } from "vitest";
import { createRuntimeProjectClient } from "./runtimeProjectClient";

describe("createRuntimeProjectClient", () => {
  it("uses the browser fixture only when it is explicitly enabled", async () => {
    const runtime = await createRuntimeProjectClient({
      storage: window.localStorage,
      runtime: {},
      localWebApiUrl: "",
      allowBrowserFixture: true
    });

    expect(runtime.kind).toBe("browser");
    if (runtime.kind === "browser") {
      expect(runtime.activeProject).toBeNull();
    }
  });

  it("uses the native adapter when Tauri exposes its invoke bridge and no Web API is configured", async () => {
    const invoke = vi.fn().mockResolvedValue({ project: null });
    const runtime = await createRuntimeProjectClient({
      storage: window.localStorage,
      runtime: { __TAURI_INTERNALS__: { invoke } },
      localWebApiUrl: ""
    });

    expect(runtime.kind).toBe("tauri");
    if (runtime.kind === "tauri") {
      expect(runtime.activeProject).toBeNull();
      expect(invoke).toHaveBeenCalledWith("project_load_active");
    }
  });

  it("prefers the localhost Web API over the legacy Tauri bridge", async () => {
    const invoke = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ project: null }) });
    vi.stubGlobal("fetch", fetcher);
    const runtime = await createRuntimeProjectClient({
      storage: window.localStorage,
      runtime: { __TAURI_INTERNALS__: { invoke } },
      localWebApiUrl: "http://127.0.0.1:4310"
    });

    expect(runtime.kind).toBe("web");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the terminal-hosted Web API when configured", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ project: null }) });
    vi.stubGlobal("fetch", fetcher);
    const runtime = await createRuntimeProjectClient({
      storage: window.localStorage,
      runtime: {},
      localWebApiUrl: "http://127.0.0.1:4310"
    });

    expect(runtime.kind).toBe("web");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:4310/api/commands/project_load_active",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns an explicit offline state when the local service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const runtime = await createRuntimeProjectClient({
      storage: window.localStorage,
      runtime: {},
      localWebApiUrl: "http://127.0.0.1:4310"
    });

    expect(runtime).toMatchObject({
      kind: "offline",
      activeProject: null,
      apiUrl: "http://127.0.0.1:4310",
      message: "offline"
    });
  });

  it("does not expose fixture data in a normal browser without a service", async () => {
    const runtime = await createRuntimeProjectClient({
      storage: window.localStorage,
      runtime: {},
      localWebApiUrl: ""
    });

    expect(runtime.kind).toBe("offline");
  });
});
