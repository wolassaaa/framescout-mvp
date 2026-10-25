# FrameScout Phase 1 Progress Record

Status: partial vertical slice in progress.

Date: 2026-07-12

## Implemented This Slice

This slice advances Phase 1 without introducing ML, XMP writes or source-file mutation.

- Browser-side local project creation supports directory selection with preserved relative source paths and stores the selected root in the project summary; the individual-file picker remains available for small ad-hoc imports. Native folder selection with absolute paths remains required for full FR-01 parity.
- The working surface has a persisted 80% to 160% display-scale control, so photographers can calibrate interface density without hiding shortcut affordances.
- Supported Phase 1 asset filtering for JPEG/PNG/WebP/GIF previews and Canon CR2 placeholders.
- Browser-side JPEG/PNG/WebP/GIF preview data URLs are persisted as `previewState: ready`.
- Same-folder, same-stem browser preview assets record `rawPartnerId` when paired with a Canon CR2.
- Stable file identity from source path/name, size and last modified timestamp.
- Review assets carry `sourcePath`, `fileFingerprint`, `previewState`, `missingState` and optional `rawPartnerId`.
- Browser project metadata can mark assets `missing` and move their preview state to `needs-relink` without changing human decisions.
- Review Desk exposes source health controls for marking an asset missing and relinking it to a newly selected file.
- Browser relink preserves the existing asset id, human decision state and decision event ledger while updating source path, fingerprint and preview metadata.
- Human decisions persist to local storage and reload into the Review Desk.
- Browser project storage keeps a recent-project index; the Projects strip can reopen a prior local project and restore it as the active review.
- Browser-side decision changes append `decisionEvents` with previous state, next state, revision, timestamp and actor.
- Review Desk can switch the persisted project policy and recompute only AI disposition for frames with explicit no-allowed-subject evidence; human picks, tags and evidence remain intact.
- Human-rescued AI Reject frames remain visible in the normal review queue even when AI Rejects are hidden.
- Review Desk filters now actively narrow the queue by AI disposition, selected state, no-athlete and soft-focus evidence, without mutating any photo decision.
- Browser `review.next` returns queue asset, cursor and queue length while preserving AI Reject rescue rules.
- Browser `group.open` returns ordered assets, focus index and comparison evidence for assets that already carry a shared `groupId`.
- Existing browser burst groups can now open a dedicated Burst Duel from Review Desk or Grid. Left/right choices, pin-both and reject-weaker decisions use the same reversible human-decision ledger and return to the prior review position.
- Grid filters for `Needs review`, `Selected`, `No athlete`, `Soft focus` and `Matchday story` now constrain the contact sheet.
- Grid density is adjustable from 3 to 8 columns with `[` and `]`, while thumbnail metadata truncates safely at higher density.
- Grid thumbnails support explicit multi-selection; its constrained bulk actions now set a chosen decision, apply a manual tag, open a selected burst, or request an export preview without accidental decision changes on click.
- Grid can apply additive `manual:*` tags to selected assets without overwriting system or preview tags.
- Tags & coverage now provides a filterable player/coach/crowd/stage/screen/trophy/venue matrix plus project-discovered tags, with separate all-frame and human-selected counts and browsable tagged frames.
- Browser `tag.apply` records append-only `tagEvents` for manual tag add/remove mutations.
- `T` opens a focused manual-tag editor in Review Desk for the current frame; submit reuses `tag.apply` and dismissing it makes no project change.
- Browser `analysis.enqueue` records a durable local analysis run with total assets, previews ready, RAW placeholders, missing assets, progress and backend.
- Import now opens a dedicated Analysis Queue using that durable run record; it shows discovered images, preview readiness, RAW placeholders, backend and a real preview mosaic before entry to Review Desk.
- Local project creation immediately enqueues the browser-safe analysis projection so restart can restore queue progress metadata.
- Browser `export.preview` produces an XMP-safe sidecar summary without writing files or modifying originals.
- Browser `export.commit` is explicitly typed and refuses to write sidecars until native export is wired.
- A dedicated Export hand-off view shows XMP targets, skipped records and metadata-map CSV before requiring an explicit confirmation; browser confirmation visibly returns the non-mutating native-export boundary.
- Export hand-off can download the previewed CSV report and copy selected source paths without touching source images or invoking XMP commit.
- Export preview resolves same-stem JPEG decisions through `rawPartnerId` to the paired RAW sidecar target.
- Export preview includes a read-only reversible metadata map and CSV preview with file, decision, tags, reasons, timestamps and model version.
- Export preview refuses source paths with `.` or `..` segments, so browser preview never projects a traversal-based XMP target; valid Windows separators are normalized only for the preview.
- CR2 assets are recorded as `raw-placeholder` until native embedded preview extraction exists.
- Fixture project remains available when no persisted project exists.
- Initial SQLite schema migration for the production project store.
- Storage contract mapping master-spec persistence requirements to migration tables and invariants.
- Runtime SQLite migration verification using Python's built-in SQLite engine.
- Typed browser project client that mirrors the future UI/native command boundary for `project.create`, `project.loadActive`, `project.saveSnapshot`, `analysis.enqueue`, `review.next`, `decision.set`, `tag.apply`, `group.open`, `export.preview` and `export.commit`.
- Tauri project client adapter mapping spec command names to Tauri command ids.
- Rust Tauri command skeleton for `project_create`, `project_load_active`, `project_save_snapshot`, `analysis_enqueue`, `review_next`, `decision_set`, `tag_apply`, `group_open`, `export_preview` and `export_commit`.
- Native app startup now opens and migrates a per-user SQLite database through `framescout-storage`.
- Native `project.create` validates absolute roots, avoids symlink traversal, recursively discovers supported Phase 1 files, and persists absolute source paths, stable fingerprints and raw-placeholder state through SQLx.
- Native `project.loadActive` restores the most recently opened SQLite project as a transparent pending-preview projection.
- Native `decision.set` uses SQLite optimistic revisions and preserves append-only decision history through the migration trigger.
- Rust workspace compilation and tests now verify the native directory scan plus actual SQLite migration, project creation, decision write and reload behavior.
- Rust workspace manifest including the desktop shell and `crates/storage`.
- `framescout-storage` crate skeleton with SQLx SQLite repository boundary, migration runner, storage models and repository trait.

## Verification

Unit tests:

- `apps/desktop/src/features/project/projectStore.test.ts`
- `apps/desktop/src/features/project/projectClient.test.ts`
- `apps/desktop/src/features/project/projectExport.test.ts`
- `apps/desktop/src/features/review/reviewState.test.ts`
- `tests/contracts/storageMigration.test.ts`
- `tests/contracts/tauriCommandBoundary.test.ts`
- `tests/contracts/storageCrateBoundary.test.ts`
- `tests/test_storage_migration.py`

E2E tests:

- `tests/e2e/review-desk.spec.ts`
- Scenario: fixture AI Reject is manually selected and remains visible after hiding AI Rejects again.
- Scenario: fixture Grid soft-focus filter narrows the contact sheet to the soft-focus AI Reject.
- Scenario: fixture burst opens Duel, accepts a keyboard right-side choice, then returns to its review context.
- Scenario: a selected frame reaches Export hand-off, previews its XMP sidecar, confirms the preview, and verifies that browser export writes no files.
- Scenario: import a same-stem JPEG and CR2 placeholder, verify durable `analysisRuns` progress, JPEG `previewState: ready`, CR2 `raw-placeholder`, both assets `missingState: present`, JPEG `rawPartnerId`, mark the current asset missing, relink it without increasing project asset count, press `2` to select, apply a manual Grid tag to the selected frame, verify `decisionEvents` and `tagEvents`, preview one RAW-targeted XMP sidecar with zero originals modified, verify metadata-map rows, reload, and verify the decision is restored.

Storage artifacts:

- `crates/storage/migrations/0001_initial_project_store.sql`
- `crates/storage/src/`
- `docs/storage-contract.md`

## Not Yet Complete

These are still required before Phase 1 can be marked complete against the master specification:

- Native file-dialog wiring and frontend runtime selection of the Tauri client. The current React app remains on the browser adapter while the native command slice is brought to parity.
- Native JPEG thumbnail cache on disk.
- Canon CR2 embedded preview extraction without full RAW decode.
- Native XMP sidecar read/merge/write implementation behind explicit Export preview.
- Native CSV/JSON metadata map file export.
- Real burst grouping plus merge/split remain later-phase work. Browser Duel operates only on existing `groupId` values; native grouping persistence and analysis are still required.
- Native crash-safe Tokio/SQLx analysis queue and restart test with hundreds of real files.
- SQLx-backed `tag.apply` implementation and SQLite tag event persistence.
- Native missing/moved source file detection and relink file-dialog wiring.

Local environment note: Rust stable MSVC was installed through Rustup on 2026-07-12. `cargo check --workspace` and `cargo test --workspace` now run locally.

## Safety Notes

- The browser adapter stores metadata and decisions only.
- It does not delete, move, rename, overwrite or write sidecars for originals.
- `export.commit` currently returns a non-mutating refusal boundary; real XMP sidecar writes remain native-only future work.
- CR2 handling is deliberately a visible placeholder, not a fake decode.
