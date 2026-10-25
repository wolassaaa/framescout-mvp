-- no-transaction
-- SQLite cannot alter a CHECK constraint in place. Disable foreign-key
-- actions while rebuilding only the projects table, then verify them again.
PRAGMA foreign_keys = OFF;

CREATE TABLE projects_with_portrait (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  preset TEXT NOT NULL CHECK (
    preset IN ('action-coverage', 'matchday-story', 'motorsport', 'esports-stage', 'portrait', 'custom')
  ),
  source_roots_json TEXT NOT NULL DEFAULT '[]',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  policy_version TEXT NOT NULL DEFAULT 'phase-1',
  app_version TEXT NOT NULL,
  snapshot_revision INTEGER NOT NULL DEFAULT 0,
  indexing_state TEXT NOT NULL DEFAULT 'complete' CHECK (
    indexing_state IN ('indexing', 'complete', 'failed')
  )
);

INSERT INTO projects_with_portrait (
  id, name, preset, source_roots_json, settings_json, created_at, updated_at,
  policy_version, app_version, snapshot_revision, indexing_state
)
SELECT
  id, name, preset, source_roots_json, settings_json, created_at, updated_at,
  policy_version, app_version, snapshot_revision, indexing_state
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_with_portrait RENAME TO projects;

PRAGMA foreign_keys = ON;
