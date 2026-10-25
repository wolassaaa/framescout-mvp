import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const migrationsDirectory = resolve("crates/storage/migrations");
const migration = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationsDirectory, name), "utf8"))
  .join("\n");

const requiredTables = [
  "projects",
  "assets",
  "analysis_runs",
  "signals",
  "burst_groups",
  "burst_group_assets",
  "decisions",
  "decision_events",
  "tags",
  "tag_events",
  "asset_mappings",
  "export_runs",
  "cloud_requests"
];

describe("storage migration", () => {
  it("declares the master-spec project tables", () => {
    for (const table of requiredTables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("keeps original file identity unique inside a project", () => {
    expect(migration).toContain("source_path TEXT NOT NULL");
    expect(migration).toContain("file_fingerprint TEXT NOT NULL");
    expect(migration).toContain("UNIQUE(project_id, file_fingerprint)");
  });

  it("separates human decisions from AI disposition and preserves history", () => {
    expect(migration).toContain("ai_disposition TEXT NOT NULL DEFAULT 'keep'");
    expect(migration).toContain("human_disposition TEXT NOT NULL DEFAULT 'unseen'");
    expect(migration).toContain("trg_decisions_append_human_history");
    expect(migration).toContain("trg_decisions_reanalysis_preserves_human");
  });

  it("models XMP and CSV output as export projections only", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS export_runs");
    expect(migration).not.toMatch(/UPDATE\s+assets\s+SET\s+source_path/i);
  });

  it("keeps tag mutation history scoped to the owning project", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS tag_events");
    expect(migration).toContain("project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE");
  });

  it("models proxy-to-master mapping without treating a RAW as a review asset", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS asset_mappings");
    expect(migration).toContain("mapping_status IN ('mapped', 'proxy_only', 'ambiguous', 'missing_master', 'manually_mapped')");
    expect(migration).toContain("mapping_method IN ('same_folder', 'mirrored_tree', 'manifest', 'manual', 'none')");
  });
});
