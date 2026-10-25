-- Each analysis run owns a stable work-set size.  Cache eviction may remove
-- derived proxies after a run begins, but must not make progress regress.
ALTER TABLE analysis_runs ADD COLUMN total_assets INTEGER NOT NULL DEFAULT 0;
