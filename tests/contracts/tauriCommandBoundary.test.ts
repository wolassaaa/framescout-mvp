import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const libRs = readFileSync(resolve("apps/desktop/src-tauri/src/lib.rs"), "utf8");
const projectRs = readFileSync(resolve("apps/desktop/src-tauri/src/commands/project.rs"), "utf8");
const productionProjectRs = projectRs.split("#[cfg(test)]")[0];
const adapterTs = readFileSync(
  resolve("apps/desktop/src/features/project/tauriProjectClient.ts"),
  "utf8"
);
const mainTsx = readFileSync(resolve("apps/desktop/src/main.tsx"), "utf8");
const appTsx = readFileSync(resolve("apps/desktop/src/App.tsx"), "utf8");

const tauriCommands = [
  "project_create",
  "project_load_active",
  "project_save_snapshot",
  "mapping_set_manual",
  "analysis_enqueue",
  "metadata_refresh",
  "selection_goal_set",
  "review_next",
  "decision_set",
  "tag_apply",
  "group_open",
  "export_preview",
  "export_commit"
];

describe("tauri command boundary", () => {
  it("registers the Phase 1 project commands in the Tauri invoke handler", () => {
    for (const command of tauriCommands) {
      expect(libRs).toContain(`commands::project::${command}`);
    }
  });

  it("keeps frontend adapter mappings aligned with Rust command names", () => {
    for (const command of tauriCommands) {
      expect(adapterTs).toContain(`"${command}"`);
      expect(projectRs).toMatch(new RegExp(`pub (?:async )?fn ${command}\\b`));
    }
  });

  it("keeps native project persistence non-mutating for originals while export is unwired", () => {
    expect(projectRs).toContain("keep_originals_untouched");
    expect(projectRs).toContain("create_project");
    expect(projectRs).toContain("set_human_decision");
    expect(productionProjectRs).not.toMatch(/write_xmp|remove_file\(|rename\(/i);
    expect(productionProjectRs).toContain("generate_proxy_caches");
  });

  it("keeps the native export-preview response aligned with the metadata-map contract", () => {
    expect(projectRs).toContain("pub metadata_records: Vec<serde_json::Value>");
    expect(projectRs).toContain("pub csv_preview: String");
  });

  it("boots React through the asynchronous runtime factory", () => {
    expect(mainTsx).toContain("<RuntimeRoot />");
    const runtimeRoot = readFileSync("apps/desktop/src/RuntimeRoot.tsx", "utf8");
    expect(runtimeRoot).toContain("createRuntimeProjectClient({");
    expect(runtimeRoot).toContain("<App runtimeProjectClient=");
    expect(appTsx).toContain('runtimeProjectClient.kind === "tauri"');
    expect(appTsx).toContain("runtimeProjectClient.client.setDecision");
    expect(appTsx).not.toContain("createBrowserProjectClient(window.localStorage)");
  });
});
