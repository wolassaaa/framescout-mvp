import { createBrowserProjectClient, type PhaseOneProjectClient } from "./projectClient";
import { createLocalWebProjectClient } from "./localWebProjectClient";
import { createTauriProjectClient, type TauriInvoke, type TauriProjectClient } from "./tauriProjectClient";
import type { PersistedProject } from "@framescout/contracts";

export type RuntimeProjectClient =
  | { kind: "browser"; client: PhaseOneProjectClient; activeProject: PersistedProject | null }
  | { kind: "web"; client: TauriProjectClient; activeProject: PersistedProject | null }
  | { kind: "tauri"; client: TauriProjectClient; activeProject: PersistedProject | null }
  | { kind: "offline"; activeProject: null; apiUrl: string; message: string };

export type ConnectedRuntimeProjectClient = Exclude<RuntimeProjectClient, { kind: "offline" }>;
export type ServiceRuntimeProjectClient = Extract<RuntimeProjectClient, { kind: "tauri" | "web" }>;

export function isServiceRuntime(client: RuntimeProjectClient): client is ServiceRuntimeProjectClient {
  return client.kind === "web" || client.kind === "tauri";
}

export interface RuntimeProjectClientOptions {
  storage: Storage;
  runtime?: unknown;
  localWebApiUrl?: string;
  allowBrowserFixture?: boolean;
}

type TauriRuntime = {
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvoke;
  };
};

function getTauriInvoke(runtime: unknown): TauriInvoke | undefined {
  if (!runtime || typeof runtime !== "object") return undefined;
  const invoke = (runtime as TauriRuntime).__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke : undefined;
}

/**
 * Chooses the native command client only when the Tauri invoke bridge is present.
 * Browser and Playwright runtimes have no bridge and keep their local-storage adapter.
 */
export async function createRuntimeProjectClient({
  storage,
  runtime = globalThis,
  localWebApiUrl = import.meta.env.VITE_FRAMESCOUT_API_URL || "http://127.0.0.1:4310",
  allowBrowserFixture = false
}: RuntimeProjectClientOptions): Promise<RuntimeProjectClient> {
  let serviceError: unknown;
  if (localWebApiUrl) {
    const client = createLocalWebProjectClient(localWebApiUrl);
    try {
      const { project } = await client.loadActive();
      return { kind: "web", client, activeProject: project };
    } catch (error) {
      serviceError = error;
    }
  }
  const invoke = getTauriInvoke(runtime);
  if (invoke) {
    const client = createTauriProjectClient(invoke);
    const { project } = await client.loadActive();
    return { kind: "tauri", client, activeProject: project };
  }
  if (allowBrowserFixture) {
    const client = createBrowserProjectClient(storage);
    return { kind: "browser", client, activeProject: client.loadActive().project };
  }
  return {
    kind: "offline",
    activeProject: null,
    apiUrl: localWebApiUrl,
    message: serviceError instanceof Error ? serviceError.message : "FrameScout local service is unavailable."
  };
}
