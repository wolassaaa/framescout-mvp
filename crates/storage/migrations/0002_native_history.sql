CREATE TABLE IF NOT EXISTS tag_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_ids_json TEXT NOT NULL,
  tag TEXT NOT NULL,
  mutation TEXT NOT NULL CHECK (mutation IN ('add', 'remove')),
  changed_at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor = 'human')
);

CREATE INDEX IF NOT EXISTS idx_tag_events_project ON tag_events(project_id, id);
