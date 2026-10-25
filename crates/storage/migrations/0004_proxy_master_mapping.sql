ALTER TABLE assets ADD COLUMN display_cache_path TEXT;

CREATE TABLE IF NOT EXISTS asset_mappings (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  master_path TEXT,
  mapping_status TEXT NOT NULL CHECK (
    mapping_status IN ('mapped', 'proxy_only', 'ambiguous', 'missing_master', 'manually_mapped')
  ),
  mapping_method TEXT NOT NULL CHECK (
    mapping_method IN ('same_folder', 'mirrored_tree', 'manifest', 'manual', 'none')
  ),
  mapping_confidence TEXT NOT NULL CHECK (
    mapping_confidence IN ('exact', 'probable', 'unresolved')
  ),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_mappings_status ON asset_mappings(mapping_status);
