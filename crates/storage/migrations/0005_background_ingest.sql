ALTER TABLE projects ADD COLUMN indexing_state TEXT NOT NULL DEFAULT 'complete'
  CHECK (indexing_state IN ('indexing', 'complete', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_source_path
  ON assets(project_id, source_path);
