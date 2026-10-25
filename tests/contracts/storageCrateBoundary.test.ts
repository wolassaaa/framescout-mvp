import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceToml = readFileSync(resolve("Cargo.toml"), "utf8");
const storageToml = readFileSync(resolve("crates/storage/Cargo.toml"), "utf8");
const repositoryRs = readFileSync(resolve("crates/storage/src/repository.rs"), "utf8");
const sqliteRs = readFileSync(resolve("crates/storage/src/sqlite.rs"), "utf8");
const modelsRs = readFileSync(resolve("crates/storage/src/models.rs"), "utf8");

describe("storage crate boundary", () => {
  it("adds storage to the Rust workspace without removing the desktop shell", () => {
    expect(workspaceToml).toContain('"apps/desktop/src-tauri"');
    expect(workspaceToml).toContain('"crates/storage"');
    expect(workspaceToml).toContain('resolver = "2"');
  });

  it("declares the SQLx SQLite runtime and migration dependencies", () => {
    expect(storageToml).toContain('name = "framescout-storage"');
    expect(storageToml).toContain('"sqlite"');
    expect(storageToml).toContain('"migrate"');
    expect(storageToml).toContain("async-trait");
  });

  it("keeps repository operations explicit and phase-scoped", () => {
    expect(repositoryRs).toContain("pub trait ProjectRepository");
    expect(repositoryRs).toContain("async fn create_project");
    expect(repositoryRs).toContain("async fn load_project");
    expect(repositoryRs).toContain("async fn list_assets");
    expect(repositoryRs).toContain("async fn set_human_decision");
  });

  it("uses the checked migration directory and avoids source-file mutation APIs", () => {
    expect(sqliteRs).toContain('sqlx::migrate!("./migrations")');
    expect(sqliteRs).toContain("PRAGMA foreign_keys = ON");
    expect(sqliteRs).not.toMatch(/remove_file|rename\(|copy\(|std::fs::write|write_xmp/i);
  });

  it("models AI and human decisions separately", () => {
    expect(modelsRs).toContain("pub enum HumanDisposition");
    expect(modelsRs).toContain("pub struct DecisionEventRecord");
    expect(modelsRs).toContain("pub struct NewProject");
    expect(modelsRs).toContain("pub struct NewAsset");
  });
});
