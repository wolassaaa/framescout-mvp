use async_trait::async_trait;
use chrono::{SecondsFormat, Utc};
use std::path::Path;

use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};

use crate::models::{
    AssetRecord, AssetSnapshot, DecisionEventRecord, HumanDisposition, NewAsset, NewProject,
    ProjectPreset, ProjectRecord, TagEventRecord, TagRecord,
};
use crate::repository::{ProjectRepository, StorageError, StorageResult};
use uuid::Uuid;

// Keep every database schema change compiled into the embedded migration bundle.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct SqliteProjectRepository {
    pool: SqlitePool,
}

impl SqliteProjectRepository {
    pub async fn connect(database_url: &str) -> StorageResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await?;
        Ok(Self { pool })
    }

    pub async fn connect_file(path: impl AsRef<Path>) -> StorageResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        Ok(Self { pool })
    }

    pub fn from_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[async_trait]
impl ProjectRepository for SqliteProjectRepository {
    async fn migrate(&self) -> StorageResult<()> {
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    async fn create_project(&self, project: NewProject) -> StorageResult<ProjectRecord> {
        let mut transaction = self.pool.begin().await?;
        let now = rfc3339_timestamp();
        let source_roots_json = serde_json::to_string(&project.source_roots)?;
        let settings_json = serde_json::to_string(&project.settings_json)?;

        sqlx::query(
            r#"
            INSERT INTO projects (
              id, name, preset, source_roots_json, settings_json,
              created_at, updated_at, app_version, indexing_state
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&project.id)
        .bind(&project.name)
        .bind(project.preset.as_str())
        .bind(source_roots_json)
        .bind(settings_json)
        .bind(&now)
        .bind(&now)
        .bind(&project.app_version)
        .bind(&project.indexing_state)
        .execute(&mut *transaction)
        .await?;

        for asset in &project.assets {
            sqlx::query(
                r#"
                INSERT INTO assets (
                  id, project_id, source_path, file_fingerprint, preview_state,
                  exif_json, preview_cache_path, display_cache_path, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&asset.id)
            .bind(&project.id)
            .bind(&asset.source_path)
            .bind(&asset.file_fingerprint)
            .bind(&asset.preview_state)
            .bind(serde_json::to_string(&asset.exif_json)?)
            .bind(&asset.thumbnail_cache_path)
            .bind(&asset.display_cache_path)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;

            sqlx::query(
                r#"
                INSERT INTO asset_mappings (
                  asset_id, master_path, mapping_status, mapping_method,
                  mapping_confidence, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&asset.id)
            .bind(&asset.mapped_master_path)
            .bind(&asset.mapping_status)
            .bind(&asset.mapping_method)
            .bind(&asset.mapping_confidence)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;

            sqlx::query(
                r#"
                INSERT INTO decisions (
                  asset_id, ai_disposition, human_disposition, reasons_json,
                  revision, changed_at, actor
                )
                VALUES (?, 'keep', 'unseen', '[]', 0, ?, 'system')
                "#,
            )
            .bind(&asset.id)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }

        transaction.commit().await?;
        self.load_project(&project.id).await?.ok_or_else(|| {
            StorageError::Conflict("created project could not be reloaded".to_string())
        })
    }

    async fn load_project(&self, project_id: &str) -> StorageResult<Option<ProjectRecord>> {
        let row = sqlx::query(
            r#"
            SELECT id, name, preset, source_roots_json, settings_json,
                    created_at, updated_at, policy_version, app_version, snapshot_revision, indexing_state
            FROM projects
            WHERE id = ?
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(ProjectRecord {
                id: row.get("id"),
                name: row.get("name"),
                preset: row.get("preset"),
                source_roots_json: serde_json::from_str(
                    row.get::<String, _>("source_roots_json").as_str(),
                )?,
                settings_json: serde_json::from_str(
                    row.get::<String, _>("settings_json").as_str(),
                )?,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                policy_version: row.get("policy_version"),
                app_version: row.get("app_version"),
                snapshot_revision: row.get("snapshot_revision"),
                indexing_state: row.get("indexing_state"),
            })
        })
        .transpose()
    }

    async fn load_most_recent_project(&self) -> StorageResult<Option<ProjectRecord>> {
        let row = sqlx::query(
            r#"
            SELECT id, name, preset, source_roots_json, settings_json,
                    created_at, updated_at, policy_version, app_version, snapshot_revision, indexing_state
            FROM projects
            ORDER BY updated_at DESC, created_at DESC, id DESC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(ProjectRecord {
                id: row.get("id"),
                name: row.get("name"),
                preset: row.get("preset"),
                source_roots_json: serde_json::from_str(
                    row.get::<String, _>("source_roots_json").as_str(),
                )?,
                settings_json: serde_json::from_str(
                    row.get::<String, _>("settings_json").as_str(),
                )?,
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                policy_version: row.get("policy_version"),
                app_version: row.get("app_version"),
                snapshot_revision: row.get("snapshot_revision"),
                indexing_state: row.get("indexing_state"),
            })
        })
        .transpose()
    }

    async fn save_project_snapshot(
        &self,
        project_id: &str,
        name: &str,
        preset: &str,
        source_roots: &[String],
        assets: &[AssetSnapshot],
        optimistic_revision: i64,
    ) -> StorageResult<ProjectRecord> {
        if ProjectPreset::parse(preset).is_none() {
            return Err(StorageError::Conflict(
                "unsupported project preset".to_string(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let now = rfc3339_timestamp();
        let result = sqlx::query(
            r#"
            UPDATE projects
            SET name = ?, preset = ?, source_roots_json = ?, updated_at = ?,
                snapshot_revision = snapshot_revision + 1
            WHERE id = ? AND snapshot_revision = ?
            "#,
        )
        .bind(name)
        .bind(preset)
        .bind(serde_json::to_string(source_roots)?)
        .bind(&now)
        .bind(project_id)
        .bind(optimistic_revision)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StorageError::Conflict(
                "project snapshot revision conflict".to_string(),
            ));
        }

        for asset in assets {
            let result = sqlx::query(
                r#"
                UPDATE assets
                SET source_path = ?, file_fingerprint = ?, preview_state = ?,
                    missing_state = ?, updated_at = ?
                WHERE id = ? AND project_id = ?
                "#,
            )
            .bind(&asset.source_path)
            .bind(&asset.file_fingerprint)
            .bind(&asset.preview_state)
            .bind(&asset.missing_state)
            .bind(&now)
            .bind(&asset.id)
            .bind(project_id)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() != 1 {
                return Err(StorageError::Conflict(format!(
                    "snapshot asset does not belong to project: {}",
                    asset.id
                )));
            }
        }

        transaction.commit().await?;
        self.load_project(project_id).await?.ok_or_else(|| {
            StorageError::Conflict("saved project could not be reloaded".to_string())
        })
    }

    async fn set_selection_target(
        &self,
        project_id: &str,
        target_count: u64,
    ) -> StorageResult<ProjectRecord> {
        if !(1..=100_000).contains(&target_count) {
            return Err(StorageError::Conflict(
                "selection target must be between 1 and 100000".to_string(),
            ));
        }
        let project = self
            .load_project(project_id)
            .await?
            .ok_or_else(|| StorageError::Conflict("project does not exist".to_string()))?;
        let mut settings = project.settings_json;
        settings
            .as_object_mut()
            .ok_or_else(|| {
                StorageError::Conflict("project settings are not an object".to_string())
            })?
            .insert(
                "selectionTargetCount".to_string(),
                serde_json::json!(target_count),
            );
        let now = rfc3339_timestamp();
        sqlx::query(
            "UPDATE projects SET settings_json = ?, updated_at = ?, snapshot_revision = snapshot_revision + 1 WHERE id = ?",
        )
        .bind(serde_json::to_string(&settings)?)
        .bind(now)
        .bind(project_id)
        .execute(&self.pool)
        .await?;
        self.load_project(project_id).await?.ok_or_else(|| {
            StorageError::Conflict("updated project could not be reloaded".to_string())
        })
    }

    async fn update_asset_metadata(
        &self,
        project_id: &str,
        asset_id: &str,
        capture_at: Option<&str>,
        exif_json: &serde_json::Value,
    ) -> StorageResult<()> {
        let result = sqlx::query(
            "UPDATE assets SET capture_at = ?, exif_json = ?, updated_at = ? WHERE id = ? AND project_id = ?",
        )
        .bind(capture_at)
        .bind(serde_json::to_string(exif_json)?)
        .bind(rfc3339_timestamp())
        .bind(asset_id)
        .bind(project_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StorageError::Conflict(
                "asset does not belong to project".to_string(),
            ));
        }
        Ok(())
    }

    async fn list_assets(&self, project_id: &str) -> StorageResult<Vec<AssetRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT assets.id, assets.project_id, assets.source_path, assets.file_fingerprint,
                   assets.capture_at, assets.exif_json,
                   assets.preview_state, assets.missing_state, decisions.ai_disposition,
                   decisions.human_disposition, decisions.reasons_json, decisions.revision,
                   assets.preview_cache_path, assets.display_cache_path,
                   asset_mappings.master_path, asset_mappings.mapping_status,
                   asset_mappings.mapping_method, asset_mappings.mapping_confidence
            FROM assets
            INNER JOIN decisions ON decisions.asset_id = assets.id
            LEFT JOIN asset_mappings ON asset_mappings.asset_id = assets.id
            WHERE assets.project_id = ?
            ORDER BY assets.capture_at, assets.source_path
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| -> StorageResult<AssetRecord> {
                Ok(AssetRecord {
                    id: row.get("id"),
                    project_id: row.get("project_id"),
                    source_path: row.get("source_path"),
                    file_fingerprint: row.get("file_fingerprint"),
                    capture_at: row.get("capture_at"),
                    exif_json: serde_json::from_str(row.get::<String, _>("exif_json").as_str())?,
                    preview_state: row.get("preview_state"),
                    missing_state: row.get("missing_state"),
                    ai_disposition: row.get("ai_disposition"),
                    human_disposition: HumanDisposition::parse(
                        row.get::<String, _>("human_disposition").as_str(),
                    )
                    .ok_or_else(|| {
                        StorageError::Conflict("invalid stored human disposition".to_string())
                    })?,
                    reasons_json: serde_json::from_str(
                        row.get::<String, _>("reasons_json").as_str(),
                    )?,
                    revision: row.get("revision"),
                    thumbnail_cache_path: row.get("preview_cache_path"),
                    display_cache_path: row.get("display_cache_path"),
                    mapped_master_path: row.get("master_path"),
                    mapping_status: row
                        .get::<Option<String>, _>("mapping_status")
                        .unwrap_or_else(|| "proxy_only".to_string()),
                    mapping_method: row
                        .get::<Option<String>, _>("mapping_method")
                        .unwrap_or_else(|| "none".to_string()),
                    mapping_confidence: row
                        .get::<Option<String>, _>("mapping_confidence")
                        .unwrap_or_else(|| "unresolved".to_string()),
                })
            })
            .collect()
    }

    async fn append_assets(&self, project_id: &str, assets: &[NewAsset]) -> StorageResult<u32> {
        let mut transaction = self.pool.begin().await?;
        let now = rfc3339_timestamp();
        let mut inserted = 0_u32;
        for asset in assets {
            let result = sqlx::query(
                r#"
                INSERT INTO assets (
                  id, project_id, source_path, file_fingerprint, preview_state,
                  exif_json, preview_cache_path, display_cache_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, source_path) DO NOTHING
                "#,
            )
            .bind(&asset.id)
            .bind(project_id)
            .bind(&asset.source_path)
            .bind(&asset.file_fingerprint)
            .bind(&asset.preview_state)
            .bind(serde_json::to_string(&asset.exif_json)?)
            .bind(&asset.thumbnail_cache_path)
            .bind(&asset.display_cache_path)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() == 0 {
                continue;
            }
            inserted += 1;
            sqlx::query(
                r#"
                INSERT INTO asset_mappings (
                  asset_id, master_path, mapping_status, mapping_method,
                  mapping_confidence, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(&asset.id)
            .bind(&asset.mapped_master_path)
            .bind(&asset.mapping_status)
            .bind(&asset.mapping_method)
            .bind(&asset.mapping_confidence)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                r#"
                INSERT INTO decisions (
                  asset_id, ai_disposition, human_disposition, reasons_json,
                  revision, changed_at, actor
                ) VALUES (?, 'keep', 'unseen', '[]', 0, ?, 'system')
                "#,
            )
            .bind(&asset.id)
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        if inserted > 0 {
            sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
                .bind(&now)
                .bind(project_id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(inserted)
    }

    async fn set_project_indexing_state(&self, project_id: &str, state: &str) -> StorageResult<()> {
        if !matches!(state, "indexing" | "complete" | "failed") {
            return Err(StorageError::Conflict("invalid indexing state".to_string()));
        }
        let result =
            sqlx::query("UPDATE projects SET indexing_state = ?, updated_at = ? WHERE id = ?")
                .bind(state)
                .bind(rfc3339_timestamp())
                .bind(project_id)
                .execute(&self.pool)
                .await?;
        if result.rows_affected() != 1 {
            return Err(StorageError::Conflict("project was not found".to_string()));
        }
        Ok(())
    }

    async fn set_asset_mapping(
        &self,
        project_id: &str,
        asset_id: &str,
        master_path: Option<&str>,
        mapping_status: &str,
        mapping_method: &str,
        mapping_confidence: &str,
    ) -> StorageResult<()> {
        let valid_status = matches!(
            mapping_status,
            "mapped" | "proxy_only" | "ambiguous" | "missing_master" | "manually_mapped"
        );
        let valid_method = matches!(
            mapping_method,
            "same_folder" | "mirrored_tree" | "manifest" | "manual" | "none"
        );
        let valid_confidence = matches!(mapping_confidence, "exact" | "probable" | "unresolved");
        if !valid_status || !valid_method || !valid_confidence {
            return Err(StorageError::Conflict("invalid mapping state".to_string()));
        }
        let mut transaction = self.pool.begin().await?;
        let now = rfc3339_timestamp();
        let owns_asset = sqlx::query("SELECT 1 FROM assets WHERE id = ? AND project_id = ?")
            .bind(asset_id)
            .bind(project_id)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();
        if !owns_asset {
            return Err(StorageError::Conflict(
                "mapping asset does not belong to project".to_string(),
            ));
        }
        sqlx::query(
            r#"
            INSERT INTO asset_mappings (
              asset_id, master_path, mapping_status, mapping_method,
              mapping_confidence, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
              master_path = excluded.master_path,
              mapping_status = excluded.mapping_status,
              mapping_method = excluded.mapping_method,
              mapping_confidence = excluded.mapping_confidence,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(asset_id)
        .bind(master_path)
        .bind(mapping_status)
        .bind(mapping_method)
        .bind(mapping_confidence)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE projects SET updated_at = ?, snapshot_revision = snapshot_revision + 1 WHERE id = ?",
        )
        .bind(&now)
        .bind(project_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn update_asset_cache(
        &self,
        project_id: &str,
        asset_id: &str,
        thumbnail_cache_path: Option<&str>,
        display_cache_path: Option<&str>,
        preview_state: &str,
    ) -> StorageResult<()> {
        if !matches!(preview_state, "ready" | "failed") {
            return Err(StorageError::Conflict(
                "invalid cache preview state".to_string(),
            ));
        }
        let now = rfc3339_timestamp();
        let result = sqlx::query(
            r#"
            UPDATE assets
            SET preview_cache_path = ?, display_cache_path = ?, preview_state = ?, updated_at = ?
            WHERE id = ? AND project_id = ?
            "#,
        )
        .bind(thumbnail_cache_path)
        .bind(display_cache_path)
        .bind(preview_state)
        .bind(&now)
        .bind(asset_id)
        .bind(project_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(StorageError::Conflict(
                "cache asset does not belong to project".to_string(),
            ));
        }
        Ok(())
    }

    async fn set_human_decision(
        &self,
        project_id: &str,
        asset_id: &str,
        disposition: HumanDisposition,
        asset_revision: i64,
    ) -> StorageResult<DecisionEventRecord> {
        let mut transaction = self.pool.begin().await?;
        let now = rfc3339_timestamp();
        let result = sqlx::query(
            r#"
            UPDATE decisions
            SET human_disposition = ?,
                revision = revision + 1,
                changed_at = ?,
                actor = 'human'
            WHERE asset_id = ?
              AND revision = ?
              AND EXISTS (
                SELECT 1
                FROM assets
                WHERE assets.id = decisions.asset_id
                  AND assets.project_id = ?
              )
            "#,
        )
        .bind(disposition.as_str())
        .bind(&now)
        .bind(asset_id)
        .bind(asset_revision)
        .bind(project_id)
        .execute(&mut *transaction)
        .await?;

        if result.rows_affected() != 1 {
            return Err(StorageError::Conflict(
                "decision revision conflict, missing asset, or project ownership mismatch"
                    .to_string(),
            ));
        }

        sqlx::query(
            "UPDATE projects SET updated_at = ?, snapshot_revision = snapshot_revision + 1 WHERE id = ?",
        )
            .bind(&now)
            .bind(project_id)
            .execute(&mut *transaction)
            .await?;

        let event = sqlx::query(
            r#"
            SELECT previous_human_disposition, next_human_disposition, revision, changed_at
            FROM decision_events
            WHERE asset_id = ?
            ORDER BY id DESC
            LIMIT 1
            "#,
        )
        .bind(asset_id)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(DecisionEventRecord {
            asset_id: asset_id.to_string(),
            previous_human_disposition: parse_disposition(event.get("previous_human_disposition"))?,
            human_disposition: parse_disposition(event.get("next_human_disposition"))?,
            revision: event.get("revision"),
            changed_at: event.get("changed_at"),
        })
    }

    async fn list_decision_events(
        &self,
        project_id: &str,
    ) -> StorageResult<Vec<DecisionEventRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT decision_events.asset_id, decision_events.previous_human_disposition,
                   decision_events.next_human_disposition, decision_events.revision,
                   decision_events.changed_at
            FROM decision_events
            INNER JOIN assets ON assets.id = decision_events.asset_id
            WHERE assets.project_id = ?
            ORDER BY decision_events.id
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(DecisionEventRecord {
                    asset_id: row.get("asset_id"),
                    previous_human_disposition: parse_disposition(
                        row.get("previous_human_disposition"),
                    )?,
                    human_disposition: parse_disposition(row.get("next_human_disposition"))?,
                    revision: row.get("revision"),
                    changed_at: row.get("changed_at"),
                })
            })
            .collect()
    }

    async fn list_tags(&self, project_id: &str) -> StorageResult<Vec<TagRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT tags.asset_id, tags.namespace, tags.name
            FROM tags
            INNER JOIN assets ON assets.id = tags.asset_id
            WHERE assets.project_id = ?
            ORDER BY tags.created_at, tags.id
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| TagRecord {
                asset_id: row.get("asset_id"),
                tag: format!(
                    "{}:{}",
                    row.get::<String, _>("namespace"),
                    row.get::<String, _>("name")
                ),
            })
            .collect())
    }

    async fn list_tag_events(&self, project_id: &str) -> StorageResult<Vec<TagEventRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT asset_ids_json, tag, mutation, changed_at
            FROM tag_events
            WHERE project_id = ?
            ORDER BY id
            "#,
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(TagEventRecord {
                    asset_ids: serde_json::from_str(
                        row.get::<String, _>("asset_ids_json").as_str(),
                    )?,
                    tag: row.get("tag"),
                    mutation: row.get("mutation"),
                    changed_at: row.get("changed_at"),
                })
            })
            .collect()
    }

    async fn apply_tag(
        &self,
        project_id: &str,
        asset_ids: &[String],
        tag: &str,
        mutation: &str,
    ) -> StorageResult<TagEventRecord> {
        if asset_ids.is_empty() {
            return Err(StorageError::Conflict(
                "tag mutation needs at least one asset".to_string(),
            ));
        }
        if mutation != "add" && mutation != "remove" {
            return Err(StorageError::Conflict(
                "tag mutation must be add or remove".to_string(),
            ));
        }
        let (namespace, name) = tag
            .split_once(':')
            .ok_or_else(|| StorageError::Conflict("tag must include a namespace".to_string()))?;
        if namespace.is_empty() || name.is_empty() {
            return Err(StorageError::Conflict(
                "tag namespace and name must be non-empty".to_string(),
            ));
        }

        let mut transaction = self.pool.begin().await?;
        for asset_id in asset_ids {
            let belongs_to_project = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM assets WHERE id = ? AND project_id = ?",
            )
            .bind(asset_id)
            .bind(project_id)
            .fetch_one(&mut *transaction)
            .await?;
            if belongs_to_project != 1 {
                return Err(StorageError::Conflict(
                    "tag asset is missing or belongs to another project".to_string(),
                ));
            }
        }

        let now = rfc3339_timestamp();
        for asset_id in asset_ids {
            if mutation == "add" {
                sqlx::query(
                    r#"
                    INSERT OR IGNORE INTO tags (id, asset_id, name, namespace, source, created_at)
                    VALUES (?, ?, ?, ?, 'human', ?)
                    "#,
                )
                .bind(Uuid::new_v4().to_string())
                .bind(asset_id)
                .bind(name)
                .bind(namespace)
                .bind(&now)
                .execute(&mut *transaction)
                .await?;
            } else {
                sqlx::query(
                    "DELETE FROM tags WHERE asset_id = ? AND namespace = ? AND name = ? AND source = 'human'",
                )
                .bind(asset_id)
                .bind(namespace)
                .bind(name)
                .execute(&mut *transaction)
                .await?;
            }
        }

        sqlx::query(
            r#"
            INSERT INTO tag_events (project_id, asset_ids_json, tag, mutation, changed_at, actor)
            VALUES (?, ?, ?, ?, ?, 'human')
            "#,
        )
        .bind(project_id)
        .bind(serde_json::to_string(asset_ids)?)
        .bind(tag)
        .bind(mutation)
        .bind(&now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE projects SET updated_at = ?, snapshot_revision = snapshot_revision + 1 WHERE id = ?",
        )
            .bind(&now)
            .bind(project_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;

        Ok(TagEventRecord {
            asset_ids: asset_ids.to_vec(),
            tag: tag.to_string(),
            mutation: mutation.to_string(),
            changed_at: now,
        })
    }
}

fn parse_disposition(value: String) -> StorageResult<HumanDisposition> {
    HumanDisposition::parse(&value)
        .ok_or_else(|| StorageError::Conflict(format!("invalid stored human disposition: {value}")))
}

fn rfc3339_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NewAsset, NewProject, ProjectPreset};
    use crate::repository::ProjectRepository;
    use tempfile::tempdir;

    fn project(id: &str, asset_ids: &[&str]) -> NewProject {
        NewProject {
            id: id.to_string(),
            name: format!("Project {id}"),
            preset: ProjectPreset::MatchdayStory,
            source_roots: vec!["C:\\Pictures\\Finals".to_string()],
            settings_json: serde_json::json!({ "keepOriginalsUntouched": true }),
            app_version: "test".to_string(),
            indexing_state: "complete".to_string(),
            assets: asset_ids
                .iter()
                .map(|asset_id| NewAsset {
                    id: (*asset_id).to_string(),
                    source_path: format!("C:\\Pictures\\Finals\\{asset_id}.CR2"),
                    file_fingerprint: format!("{asset_id}::1::2"),
                    preview_state: "raw-placeholder".to_string(),
                    exif_json: serde_json::json!({}),
                    thumbnail_cache_path: None,
                    display_cache_path: None,
                    mapped_master_path: None,
                    mapping_status: "proxy_only".to_string(),
                    mapping_method: "none".to_string(),
                    mapping_confidence: "unresolved".to_string(),
                })
                .collect(),
        }
    }

    #[tokio::test]
    async fn persists_independent_asset_revisions_and_rfc3339_history() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        let created = repository
            .create_project(project("project-native", &["asset-one", "asset-two"]))
            .await
            .unwrap();

        let first = repository
            .set_human_decision(&created.id, "asset-one", HumanDisposition::Select, 0)
            .await
            .unwrap();
        let second = repository
            .set_human_decision(&created.id, "asset-two", HumanDisposition::Hold, 0)
            .await
            .unwrap();
        let assets = repository.list_assets(&created.id).await.unwrap();
        let events = repository.list_decision_events(&created.id).await.unwrap();
        let latest = repository
            .load_most_recent_project()
            .await
            .unwrap()
            .unwrap();

        assert_eq!(first.previous_human_disposition, HumanDisposition::Unseen);
        assert_eq!(second.previous_human_disposition, HumanDisposition::Unseen);
        assert_eq!(
            assets
                .iter()
                .map(|asset| asset.revision)
                .collect::<Vec<_>>(),
            vec![1, 1]
        );
        assert_eq!(events.len(), 2);
        assert!(chrono::DateTime::parse_from_rfc3339(&first.changed_at).is_ok());
        assert!(chrono::DateTime::parse_from_rfc3339(&latest.updated_at).is_ok());
        assert_eq!(latest.id, created.id);
    }

    #[tokio::test]
    async fn persists_selection_target_without_replacing_other_project_settings() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        let created = repository
            .create_project(project("selection-goal", &["asset-one"]))
            .await
            .unwrap();

        let updated = repository
            .set_selection_target(&created.id, 50)
            .await
            .unwrap();

        assert_eq!(updated.settings_json["selectionTargetCount"], 50);
        assert_eq!(updated.settings_json["keepOriginalsUntouched"], true);
        assert_eq!(updated.snapshot_revision, created.snapshot_revision + 1);
        assert!(repository
            .set_selection_target(&created.id, 0)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn appends_ingest_batches_idempotently_and_tracks_indexing_state() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        let created = repository
            .create_project(project("background-ingest", &[]))
            .await
            .unwrap();
        repository
            .set_project_indexing_state(&created.id, "indexing")
            .await
            .unwrap();
        let asset = NewAsset {
            id: "proxy-one".to_string(),
            source_path: "C:\\Pictures\\Finals\\proxy-one.jpg".to_string(),
            file_fingerprint: "proxy-one::1::2".to_string(),
            preview_state: "pending".to_string(),
            exif_json: serde_json::json!({}),
            thumbnail_cache_path: None,
            display_cache_path: None,
            mapped_master_path: None,
            mapping_status: "proxy_only".to_string(),
            mapping_method: "none".to_string(),
            mapping_confidence: "unresolved".to_string(),
        };

        assert_eq!(
            repository
                .append_assets(&created.id, &[asset.clone()])
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            repository
                .append_assets(&created.id, &[asset])
                .await
                .unwrap(),
            0
        );
        repository
            .set_project_indexing_state(&created.id, "complete")
            .await
            .unwrap();

        assert_eq!(repository.list_assets(&created.id).await.unwrap().len(), 1);
        assert_eq!(
            repository
                .load_project(&created.id)
                .await
                .unwrap()
                .unwrap()
                .indexing_state,
            "complete"
        );
    }

    #[tokio::test]
    async fn rejects_cross_project_decisions_and_restores_tag_history_after_reconnect() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("framescout.db");
        let repository = SqliteProjectRepository::connect_file(&database)
            .await
            .unwrap();
        repository.migrate().await.unwrap();
        let project_a = repository
            .create_project(project("project-a", &["asset-a"]))
            .await
            .unwrap();
        let project_b = repository
            .create_project(project("project-b", &["asset-b"]))
            .await
            .unwrap();

        assert!(chrono::DateTime::parse_from_rfc3339(&project_a.created_at).is_ok());

        let cross_project = repository
            .set_human_decision(&project_a.id, "asset-b", HumanDisposition::Select, 0)
            .await;
        assert!(matches!(cross_project, Err(StorageError::Conflict(_))));
        assert_eq!(
            repository.list_assets(&project_b.id).await.unwrap()[0].human_disposition,
            HumanDisposition::Unseen
        );

        repository
            .set_human_decision(&project_a.id, "asset-a", HumanDisposition::Select, 0)
            .await
            .unwrap();

        let tag_event = repository
            .apply_tag(
                &project_a.id,
                &["asset-a".to_string()],
                "manual:portfolio-pick",
                "add",
            )
            .await
            .unwrap();
        assert!(chrono::DateTime::parse_from_rfc3339(&tag_event.changed_at).is_ok());
        drop(repository);

        let reconnected = SqliteProjectRepository::connect_file(&database)
            .await
            .unwrap();
        reconnected.migrate().await.unwrap();
        let tags = reconnected.list_tags(&project_a.id).await.unwrap();
        let tag_events = reconnected.list_tag_events(&project_a.id).await.unwrap();
        let restored_assets = reconnected.list_assets(&project_a.id).await.unwrap();
        let decision_events = reconnected
            .list_decision_events(&project_a.id)
            .await
            .unwrap();

        assert_eq!(
            restored_assets[0].human_disposition,
            HumanDisposition::Select
        );
        assert_eq!(restored_assets[0].revision, 1);
        assert_eq!(decision_events.len(), 1);
        assert_eq!(
            decision_events[0].human_disposition,
            HumanDisposition::Select
        );
        assert_eq!(tags[0].tag, "manual:portfolio-pick");
        assert_eq!(tag_events[0].asset_ids, vec!["asset-a"]);
        assert_eq!(tag_events[0].tag, "manual:portfolio-pick");
    }

    #[tokio::test]
    async fn project_snapshot_revision_is_independent_and_rejects_stale_writes() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        let created = repository
            .create_project(project("snapshot-project", &["snapshot-asset"]))
            .await
            .unwrap();
        let asset = repository.list_assets(&created.id).await.unwrap().remove(0);
        let snapshot = AssetSnapshot {
            id: asset.id,
            source_path: asset.source_path,
            file_fingerprint: asset.file_fingerprint,
            preview_state: asset.preview_state,
            missing_state: "missing".to_string(),
        };

        let saved = repository
            .save_project_snapshot(
                &created.id,
                "Renamed project",
                "matchday-story",
                &["C:\\Pictures\\Finals".to_string()],
                &[snapshot.clone()],
                0,
            )
            .await
            .unwrap();
        let stale = repository
            .save_project_snapshot(
                &created.id,
                "Stale project",
                "matchday-story",
                &["C:\\Pictures\\Finals".to_string()],
                &[snapshot],
                0,
            )
            .await;

        assert_eq!(saved.snapshot_revision, 1);
        assert!(matches!(stale, Err(StorageError::Conflict(_))));
        assert_eq!(
            repository.list_assets(&created.id).await.unwrap()[0].revision,
            0
        );
        assert_eq!(
            repository
                .load_project(&created.id)
                .await
                .unwrap()
                .unwrap()
                .name,
            "Renamed project"
        );
    }

    #[tokio::test]
    async fn manual_proxy_mapping_persists_across_reconnect() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("framescout.db");
        let repository = SqliteProjectRepository::connect_file(&database)
            .await
            .unwrap();
        repository.migrate().await.unwrap();
        let created = repository
            .create_project(project("mapping-project", &["proxy-asset"]))
            .await
            .unwrap();

        repository
            .set_asset_mapping(
                &created.id,
                "proxy-asset",
                Some("C:\\RAW\\frame-001.CR3"),
                "manually_mapped",
                "manual",
                "exact",
            )
            .await
            .unwrap();
        drop(repository);

        let reconnected = SqliteProjectRepository::connect_file(&database)
            .await
            .unwrap();
        reconnected.migrate().await.unwrap();
        let asset = reconnected
            .list_assets(&created.id)
            .await
            .unwrap()
            .remove(0);

        assert_eq!(asset.mapping_status, "manually_mapped");
        assert_eq!(asset.mapping_method, "manual");
        assert_eq!(asset.mapping_confidence, "exact");
        assert_eq!(
            asset.mapped_master_path.as_deref(),
            Some("C:\\RAW\\frame-001.CR3")
        );
    }

    #[tokio::test]
    async fn portrait_preset_migration_preserves_existing_project_assets() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("portrait.db"))
                .await
                .unwrap();
        sqlx::raw_sql(
            r#"
            CREATE TABLE projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              preset TEXT NOT NULL CHECK (preset IN ('matchday-story', 'custom')),
              source_roots_json TEXT NOT NULL DEFAULT '[]',
              settings_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              policy_version TEXT NOT NULL DEFAULT 'phase-1',
              app_version TEXT NOT NULL,
              snapshot_revision INTEGER NOT NULL DEFAULT 0,
              indexing_state TEXT NOT NULL DEFAULT 'complete'
            );
            CREATE TABLE assets (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
            );
            INSERT INTO projects (id, name, preset, created_at, updated_at, app_version)
            VALUES ('existing', 'Existing project', 'matchday-story', 'now', 'now', 'test');
            INSERT INTO assets (id, project_id) VALUES ('asset-one', 'existing');
            "#,
        )
        .execute(repository.pool())
        .await
        .unwrap();

        sqlx::raw_sql(include_str!(
            "../migrations/0006_portrait_project_preset.sql"
        ))
        .execute(repository.pool())
        .await
        .unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM assets WHERE project_id = 'existing'"
            )
            .fetch_one(repository.pool())
            .await
            .unwrap(),
            1
        );
        sqlx::query("UPDATE projects SET preset = 'portrait' WHERE id = 'existing'")
            .execute(repository.pool())
            .await
            .unwrap();
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(repository.pool())
            .await
            .unwrap()
            .is_empty());
    }
}
