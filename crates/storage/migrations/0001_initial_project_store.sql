-- FrameScout project database schema.
-- Source photos are never copied or mutated by this database; it stores only
-- project state, analysis evidence, decisions, tags and export projections.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  preset TEXT NOT NULL CHECK (
    preset IN ('action-coverage', 'matchday-story', 'motorsport', 'esports-stage', 'custom')
  ),
  source_roots_json TEXT NOT NULL DEFAULT '[]',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  policy_version TEXT NOT NULL DEFAULT 'phase-1',
  app_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  file_fingerprint TEXT NOT NULL,
  raw_partner_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  capture_at TEXT,
  exif_json TEXT NOT NULL DEFAULT '{}',
  preview_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    preview_state IN ('pending', 'ready', 'raw-placeholder', 'failed', 'needs-relink')
  ),
  preview_cache_path TEXT,
  missing_state TEXT NOT NULL DEFAULT 'present' CHECK (
    missing_state IN ('present', 'missing', 'relinked')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, file_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_assets_project_capture ON assets(project_id, capture_at);
CREATE INDEX IF NOT EXISTS idx_assets_missing_state ON assets(project_id, missing_state);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_bundle_version TEXT NOT NULL DEFAULT 'none',
  backend TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value REAL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  region_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(asset_id, run_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_signals_asset ON signals(asset_id);
CREATE INDEX IF NOT EXISTS idx_signals_run ON signals(run_id);

CREATE TABLE IF NOT EXISTS burst_groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  capture_range_start TEXT,
  capture_range_end TEXT,
  grouping_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS burst_group_assets (
  group_id TEXT NOT NULL REFERENCES burst_groups(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY(group_id, asset_id),
  UNIQUE(group_id, position)
);

CREATE TABLE IF NOT EXISTS decisions (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  ai_disposition TEXT NOT NULL DEFAULT 'keep' CHECK (ai_disposition IN ('keep', 'review', 'reject')),
  human_disposition TEXT NOT NULL DEFAULT 'unseen' CHECK (
    human_disposition IN ('unseen', 'candidate', 'select', 'hold', 'reject')
  ),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  changed_at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system' CHECK (actor IN ('system', 'human'))
);

CREATE TABLE IF NOT EXISTS decision_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  previous_human_disposition TEXT NOT NULL,
  next_human_disposition TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor = 'human'),
  revision INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_events_asset ON decision_events(asset_id, revision);

CREATE TRIGGER IF NOT EXISTS trg_decisions_append_human_history
AFTER UPDATE OF human_disposition ON decisions
WHEN OLD.human_disposition <> NEW.human_disposition
BEGIN
  INSERT INTO decision_events (
    asset_id,
    previous_human_disposition,
    next_human_disposition,
    changed_at,
    actor,
    revision
  )
  VALUES (
    NEW.asset_id,
    OLD.human_disposition,
    NEW.human_disposition,
    NEW.changed_at,
    'human',
    NEW.revision
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_decisions_reanalysis_preserves_human
BEFORE UPDATE OF ai_disposition ON decisions
WHEN OLD.human_disposition <> 'unseen' AND NEW.human_disposition <> OLD.human_disposition
BEGIN
  SELECT RAISE(ABORT, 'reanalysis cannot overwrite a human disposition');
END;

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'manual',
  source TEXT NOT NULL CHECK (source IN ('ai', 'human', 'import')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TEXT NOT NULL,
  UNIQUE(asset_id, namespace, name, source)
);

CREATE INDEX IF NOT EXISTS idx_tags_lookup ON tags(namespace, name);

CREATE TABLE IF NOT EXISTS export_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('xmp', 'csv', 'paths')),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'committed', 'failed')),
  staged_items_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  report_path TEXT,
  created_at TEXT NOT NULL
);
