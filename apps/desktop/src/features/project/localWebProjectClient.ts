import type { TauriInvoke, TauriProjectClient } from "./tauriProjectClient";
import { createTauriProjectClient } from "./tauriProjectClient";

function commandUrl(baseUrl: string, command: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/commands/${command}`;
}

export async function chooseLocalServiceFolder(baseUrl: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const response = await fetcher(commandUrl(baseUrl, "project_choose_folder"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error("The local folder picker could not be opened.");
  const result = await response.json() as { path?: string | null };
  return result.path ?? null;
}

/**
 * Adapts the existing command contract to the terminal-hosted local Web API.
 * The Rust service will own the endpoint; React keeps one typed project client.
 */
export function createLocalWebProjectClient(baseUrl: string, fetcher: typeof fetch = fetch): TauriProjectClient {
  const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
    const response = await fetcher(commandUrl(baseUrl, command), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args ?? {})
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Local FrameScout service returned ${response.status}.`);
    }
    return response.json() as Promise<T>;
  };
  return createTauriProjectClient(invoke);
}
