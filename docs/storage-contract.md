# FrameScout Storage Contract

This document maps `docs/framescout-master-spec.md` persistence requirements to the SQLite migration sequence.

## Source Of Truth

Production persistence is SQLite through the native core. Browser local storage in Phase 1 is a temporary adapter for UI validation only.

Migration:

- `crates/storage/migrations/0001_initial_project_store.sql`
- `crates/storage/migrations/0002_native_history.sql`
- `crates/storage/migrations/0003_project_snapshot_revision.sql`

Rust boundary:

- `crates/storage/src/models.rs`
- `crates/storage/src/repository.rs`
- `crates/storage/src/sqlite.rs`

## Requirement Mapping

| Requirement | Storage evidence |
| --- | --- |
| FR-01 project opens after restart | `projects`, `assets`, `decisions` persist project metadata, original paths and decisions |
| FR-01 immutable file identity | `assets.file_fingerprint` with `UNIQUE(project_id, file_fingerprint)` |
| FR-03 RAW+JPEG pairing | `assets.raw_partner_id` self-reference |
| FR-04 resume/crash-safe progress | `analysis_runs.status`, durable `signals`, current `decisions`, append-only `decision_events` |
| FR-05 moved/missing source files | `assets.missing_state` and `preview_state = 'needs-relink'` |
| Human decision survives re-analysis | `trg_decisions_reanalysis_preserves_human` |
| Every human decision appends history | `trg_decisions_append_human_history` |
| Every tag mutation survives restart | project-scoped `tag_events` with cascade on project deletion |
| XMP is export projection | `export_runs`, no source image writes in project tables |

## Invariants

- Originals are referenced by path and fingerprint only.
- Asset identity is unique per project.
- Analysis runs are immutable records; a new run receives a new `analysis_runs.id`.
- Human editorial state is separate from AI technical disposition.
- Decision concurrency uses `decisions.revision` per asset. `PersistedProject.decisionRevision` is the cumulative decision-event count, while `PersistedProject.snapshotRevision` independently protects whole-project snapshots.
- A native decision update joins its asset to the supplied project id in the same SQL statement, so a project cannot modify another project's asset.
- Native timestamps use UTC RFC 3339 and decision/tag writes advance `projects.updated_at`.
- Re-analysis may update AI evidence and AI disposition, but must not overwrite a non-`unseen` human disposition.
- XMP output is represented as an export run, not as primary project state.
- The browser adapter mirrors `assets.missing_state` as `ReviewAsset.missingState` for UI validation until native file checks exist.
- Relink updates the existing asset record's source path and fingerprint; it must not create a duplicate asset for the restored file.
- Browser `export.preview` is a read-only projection: it calculates sidecar targets, ratings, labels and keywords, and reports `originalFilesModified: 0`.
- Browser `export.preview` also carries a reversible metadata-map preview with file, decision, tags, reasons, timestamps and model version; it is not a file write.
- Browser `export.preview` rejects source paths containing `.` or `..` segments before producing a sidecar target; valid Windows separators are normalized for preview only.
- Browser `export.commit` is a typed non-mutating refusal until native XMP sidecar read/merge/write is implemented behind explicit confirmation.
- Browser `analysis.enqueue` mirrors `analysis_runs` as project-local metadata for UI validation until the native queue is wired.
- Browser `tag.apply` mirrors tag mutation history as `PersistedProject.tagEvents`; native persistence records durable tags in `tags` and tag history in `tag_events`.

## Still Needed

- Path traversal tests for the native thumbnail cache once its on-disk implementation exists.

## Runtime Selection

- `main.tsx` asynchronously creates the runtime client before rendering React.
- Tauri's invoke bridge selects `createTauriProjectClient`, restores the active SQLite project, and uses native commands for project creation, snapshots, decisions, tags, review navigation and export projections.
- Browser and Playwright runtimes have no invoke bridge and continue to use the local-storage adapter.
- The native folder picker supplies an absolute source root; native scans never receive browser-only pseudo paths.
- `export.commit` remains an explicit non-mutating refusal and reports zero original files modified.

## Current Runtime Verification

`tests/test_storage_migration.py` executes every migration against an in-memory SQLite database and verifies:

- Core tables are created.
- Project-local `file_fingerprint` uniqueness is enforced.
- Human decision updates append `decision_events`.
- Re-analysis cannot overwrite an existing human disposition.
- Deleting a project cascades stored project state without operating on source paths.
- Tag history is project-scoped and cascades with its project.
