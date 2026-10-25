use async_trait::async_trait;
use thiserror::Error;

use crate::models::{
    AssetRecord, AssetSnapshot, DecisionEventRecord, HumanDisposition, NewAsset, NewProject,
    ProjectRecord, TagEventRecord, TagRecord,
};

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("conflict: {0}")]
    Conflict(String),
}

pub type StorageResult<T> = Result<T, StorageError>;

#[async_trait]
pub trait ProjectRepository: Send + Sync {
    async fn migrate(&self) -> StorageResult<()>;

    async fn create_project(&self, project: NewProject) -> StorageResult<ProjectRecord>;

    async fn load_project(&self, project_id: &str) -> StorageResult<Option<ProjectRecord>>;

    async fn load_most_recent_project(&self) -> StorageResult<Option<ProjectRecord>>;

    async fn save_project_snapshot(
        &self,
        project_id: &str,
        name: &str,
        preset: &str,
        source_roots: &[String],
        assets: &[AssetSnapshot],
        optimistic_revision: i64,
    ) -> StorageResult<ProjectRecord>;

    async fn set_selection_target(
        &self,
        project_id: &str,
        target_count: u64,
    ) -> StorageResult<ProjectRecord>;

    async fn update_asset_metadata(
        &self,
        project_id: &str,
        asset_id: &str,
        capture_at: Option<&str>,
        exif_json: &serde_json::Value,
    ) -> StorageResult<()>;

    async fn list_assets(&self, project_id: &str) -> StorageResult<Vec<AssetRecord>>;

    async fn append_assets(&self, project_id: &str, assets: &[NewAsset]) -> StorageResult<u32>;

    async fn set_project_indexing_state(&self, project_id: &str, state: &str) -> StorageResult<()>;

    async fn set_asset_mapping(
        &self,
        project_id: &str,
        asset_id: &str,
        master_path: Option<&str>,
        mapping_status: &str,
        mapping_method: &str,
        mapping_confidence: &str,
    ) -> StorageResult<()>;

    async fn update_asset_cache(
        &self,
        project_id: &str,
        asset_id: &str,
        thumbnail_cache_path: Option<&str>,
        display_cache_path: Option<&str>,
        preview_state: &str,
    ) -> StorageResult<()>;

    async fn list_decision_events(
        &self,
        project_id: &str,
    ) -> StorageResult<Vec<DecisionEventRecord>>;

    async fn list_tags(&self, project_id: &str) -> StorageResult<Vec<TagRecord>>;

    async fn list_tag_events(&self, project_id: &str) -> StorageResult<Vec<TagEventRecord>>;

    async fn set_human_decision(
        &self,
        project_id: &str,
        asset_id: &str,
        disposition: HumanDisposition,
        asset_revision: i64,
    ) -> StorageResult<DecisionEventRecord>;

    async fn apply_tag(
        &self,
        project_id: &str,
        asset_ids: &[String],
        tag: &str,
        mutation: &str,
    ) -> StorageResult<TagEventRecord>;
}
