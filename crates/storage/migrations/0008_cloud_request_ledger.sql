-- Reserve cloud work before network I/O so project budgets survive restarts and
-- an ambiguous timeout is never retried automatically as a fresh paid request.
CREATE TABLE IF NOT EXISTS cloud_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'sent', 'completed', 'failed')),
  estimated_cents INTEGER NOT NULL CHECK (estimated_cents > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, asset_id, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_cloud_requests_budget
ON cloud_requests(project_id, provider, model, state);
