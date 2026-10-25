use std::{
    collections::{HashMap, HashSet},
    fs,
    io::BufReader,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
};

use exif::{In, Reader as ExifReader, Tag as ExifTag};
use framescout_storage::{AssetSnapshot, NewAsset, NewProject, ProjectPreset, ProjectRepository};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::NativeProjectState;

const EAGER_PROXY_CACHES: usize = 16;
const DEFAULT_PROXY_CACHE_LIMIT_MB: u64 = 4_096;
const INGEST_BATCH_SIZE: usize = 32;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub keep_originals_untouched: bool,
    pub thumbnail_cache_path: Option<String>,
    pub cache_limit_mb: Option<u64>,
    pub backend: Option<String>,
    pub selection_target_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateRequest {
    pub name: String,
    pub roots: Vec<String>,
    pub raw_roots: Option<Vec<String>>,
    pub mapping_manifest_path: Option<String>,
    pub preset: String,
    pub settings: Option<ProjectSettings>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub preset: String,
    pub source_folder: String,
    pub cover_url: String,
    pub reviewed: u32,
    pub selected: u32,
    pub ai_rejects: u32,
    pub total: u32,
    pub last_opened: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateResponse {
    pub project: ProjectSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLoadActiveResponse {
    pub project: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveSnapshotRequest {
    pub project: serde_json::Value,
    pub optimistic_revision: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveSnapshotResponse {
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionGoalSetRequest {
    pub target_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionGoalSetResponse {
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRefreshRequest {
    pub project_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRefreshResponse {
    pub project: serde_json::Value,
    pub started: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingSetManualRequest {
    pub asset_id: String,
    pub master_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingSetManualResponse {
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSetRequest {
    pub asset_id: String,
    pub human_disposition: String,
    pub asset_revision: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisEnqueueRequest {
    pub project_id: String,
    pub priority: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisEnqueueResponse {
    pub run: serde_json::Value,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNextRequest {
    pub project_id: String,
    pub cursor: i32,
    pub direction: Option<String>,
    pub show_ai_rejects: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewNextResponse {
    pub asset: Option<serde_json::Value>,
    pub cursor: u32,
    pub queue_length: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionEvent {
    pub asset_id: String,
    pub human_disposition: String,
    pub revision: u32,
    pub changed_at: String,
    pub actor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSetResponse {
    pub event: DecisionEvent,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSetBatchRequest {
    pub changes: Vec<DecisionSetRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionSetBatchResponse {
    pub events: Vec<DecisionEvent>,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagApplyRequest {
    pub asset_ids: Vec<String>,
    pub tag: String,
    pub mutation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagApplyResponse {
    pub event: serde_json::Value,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagApplyBatchRequest {
    pub mutations: Vec<TagApplyRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagApplyBatchResponse {
    pub events: Vec<serde_json::Value>,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupOpenRequest {
    pub project_id: String,
    pub group_id: String,
    pub focus_asset_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupOpenResponse {
    pub group_id: String,
    pub assets: Vec<serde_json::Value>,
    pub focus_index: u32,
    pub evidence: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewRequest {
    pub project_id: String,
    pub include_ai_reason_keywords: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewResponse {
    pub project_id: String,
    pub original_files_modified: u8,
    pub xmp_files_to_write: u32,
    pub targets: Vec<serde_json::Value>,
    pub skipped: Vec<serde_json::Value>,
    pub metadata_records: Vec<serde_json::Value>,
    pub csv_preview: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCommitRequest {
    pub project_id: String,
    pub preview: serde_json::Value,
    pub dry_run: Option<bool>,
    pub explicit_confirmation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCommitResponse {
    pub project_id: String,
    pub committed: bool,
    pub reason: String,
    pub original_files_modified: u8,
    pub xmp_files_written: u32,
}

#[tauri::command]
pub async fn project_create(
    app: AppHandle,
    state: State<'_, NativeProjectState>,
    input: ProjectCreateRequest,
) -> Result<ProjectCreateResponse, String> {
    if input.roots.is_empty() {
        return Err("project.create needs at least one root folder.".to_string());
    }
    if input
        .settings
        .as_ref()
        .map(|settings| settings.keep_originals_untouched)
        == Some(false)
    {
        return Err("FrameScout projects must keep originals untouched.".to_string());
    }
    let cache_limit_bytes = input
        .settings
        .as_ref()
        .and_then(|settings| settings.cache_limit_mb)
        .unwrap_or(DEFAULT_PROXY_CACHE_LIMIT_MB)
        .saturating_mul(1024 * 1024);
    let (project, ingest_plan) = build_background_project(input)?;
    for root in &project.source_roots {
        app.asset_protocol_scope()
            .allow_directory(root, true)
            .map_err(|error| format!("Unable to allow proxy assets: {error}"))?;
    }
    let created_project_id = project.id.clone();
    let stored = state
        .repository
        .create_project(project)
        .await
        .map_err(|error| error.to_string())?;
    start_project_ingestion(
        state.repository.clone(),
        state.cache_dir.clone(),
        state.ingest_jobs.clone(),
        state.cache_jobs.clone(),
        created_project_id,
        ingest_plan,
        cache_limit_bytes,
    );
    let source_folder = stored
        .source_roots_json
        .as_array()
        .and_then(|roots| roots.first())
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();

    Ok(ProjectCreateResponse {
        project: ProjectSummary {
            id: stored.id,
            name: stored.name,
            preset: stored.preset,
            source_folder,
            cover_url: native_placeholder_preview().to_string(),
            reviewed: 0,
            selected: 0,
            ai_rejects: 0,
            total: 0,
            last_opened: stored.updated_at,
        },
    })
}

async fn native_project_projection(
    state: &NativeProjectState,
    project_id: &str,
) -> Result<serde_json::Value, String> {
    let project = state
        .repository
        .load_project(project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Project was not found.".to_string())?;
    let assets = state
        .repository
        .list_assets(project_id)
        .await
        .map_err(|error| error.to_string())?;
    let decision_events = state
        .repository
        .list_decision_events(project_id)
        .await
        .map_err(|error| error.to_string())?;
    let tags = state
        .repository
        .list_tags(project_id)
        .await
        .map_err(|error| error.to_string())?;
    let tag_events = state
        .repository
        .list_tag_events(project_id)
        .await
        .map_err(|error| error.to_string())?;
    let source_folder = project
        .source_roots_json
        .as_array()
        .and_then(|roots| roots.first())
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let decision_revision = decision_events.len() as i64;
    let mut tags_by_asset: HashMap<String, Vec<String>> = HashMap::new();
    for tag in tags {
        tags_by_asset.entry(tag.asset_id).or_default().push(tag.tag);
    }
    let projected_assets = assets
        .into_iter()
        .map(|asset| {
            let file_name = Path::new(&asset.source_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&asset.source_path);
            let thumbnail_cache_path = asset
                .thumbnail_cache_path
                .filter(|path| Path::new(path).is_file());
            let display_cache_path = asset
                .display_cache_path
                .filter(|path| Path::new(path).is_file());
            serde_json::json!({
                "id": asset.id,
                "fileName": file_name,
                "sourcePath": asset.source_path,
                "fileFingerprint": asset.file_fingerprint,
                "mappedMasterPath": asset.mapped_master_path,
                "mappingStatus": asset.mapping_status,
                "mappingMethod": asset.mapping_method,
                "mappingConfidence": asset.mapping_confidence,
                "thumbnailCachePath": thumbnail_cache_path,
                "displayCachePath": display_cache_path,
                "previewState": asset.preview_state,
                "decisionRevision": asset.revision,
                "missingState": asset.missing_state,
                "captureTime": asset.capture_at.unwrap_or_default(),
                "camera": asset.exif_json["camera"].as_str().unwrap_or("Metadata not read"),
                "lens": asset.exif_json["lens"].as_str().unwrap_or("Metadata not read"),
                "exposure": asset.exif_json["exposure"].as_str().unwrap_or(""),
                "iso": asset.exif_json["iso"].as_u64().unwrap_or(0),
                "previewUrl": native_placeholder_preview(),
                "aiDisposition": asset.ai_disposition,
                "humanDisposition": asset.human_disposition.as_str(),
                "reasons": asset.reasons_json,
                "tags": tags_by_asset.remove(&asset.id).unwrap_or_default(),
                "evidence": []
            })
        })
        .collect::<Vec<_>>();

    let target_count = project.settings_json["selectionTargetCount"]
        .as_u64()
        .unwrap_or(50)
        .clamp(1, 100_000);
    Ok(serde_json::json!({
        "id": project.id,
        "name": project.name,
        "preset": project.preset,
        "sourceFolder": source_folder,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
        "assets": projected_assets,
        "analysisRuns": [],
        "decisionRevision": decision_revision,
        "snapshotRevision": project.snapshot_revision,
        "indexingState": project.indexing_state,
        "decisionEvents": decision_events.into_iter().map(|event| serde_json::json!({
            "assetId": event.asset_id,
            "previousHumanDisposition": event.previous_human_disposition.as_str(),
            "humanDisposition": event.human_disposition.as_str(),
            "revision": event.revision,
            "changedAt": event.changed_at,
            "actor": "human"
        })).collect::<Vec<_>>(),
        "tagEvents": tag_events.into_iter().map(|event| serde_json::json!({
            "assetIds": event.asset_ids,
            "tag": event.tag,
            "mutation": event.mutation,
            "changedAt": event.changed_at,
            "actor": "human"
        })).collect::<Vec<_>>(),
        "selectionGoal": {
            "targetCount": target_count,
            "mode": "exact",
            "diversity": "burst-aware",
            "preserveHumanDecisions": true
        }
    }))
}

fn native_placeholder_preview() -> &'static str {
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%2313171c'/%3E%3C/svg%3E"
}

fn read_camera_metadata(paths: &[PathBuf]) -> Option<(Option<String>, serde_json::Value)> {
    for path in paths {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(_) => continue,
        };
        let exif = match ExifReader::new().read_from_container(&mut BufReader::new(file)) {
            Ok(exif) => exif,
            Err(_) => continue,
        };
        let display = |tag| {
            exif.get_field(tag, In::PRIMARY)
                .map(|field| field.display_value().with_unit(&exif).to_string())
                .filter(|value| !value.is_empty())
        };
        let capture_at = display(ExifTag::DateTimeOriginal).or_else(|| display(ExifTag::DateTime));
        let camera = display(ExifTag::Model);
        let lens = display(ExifTag::LensModel);
        let exposure = display(ExifTag::ExposureTime);
        let aperture = display(ExifTag::FNumber);
        let iso = exif
            .get_field(ExifTag::PhotographicSensitivity, In::PRIMARY)
            .and_then(|field| field.value.get_uint(0))
            .map(u64::from)
            .unwrap_or(0);
        let exposure = match (exposure, aperture) {
            (Some(exposure), Some(aperture)) => Some(format!("{exposure} | {aperture}")),
            (Some(exposure), None) => Some(exposure),
            (None, Some(aperture)) => Some(aperture),
            (None, None) => None,
        };
        return Some((
            capture_at.clone(),
            serde_json::json!({
                "camera": camera.unwrap_or_else(|| "Unknown camera".to_string()),
                "lens": lens.unwrap_or_else(|| "Unknown lens".to_string()),
                "captureTime": capture_at,
                "exposure": exposure.unwrap_or_default(),
                "iso": iso,
                "metadataSource": path.to_string_lossy(),
            }),
        ));
    }
    None
}

#[derive(Clone)]
struct IngestPlan {
    source_roots: Vec<String>,
    raw_roots: Vec<String>,
    manifest_mappings: HashMap<PathBuf, PathBuf>,
}

#[derive(Clone)]
struct CacheWorkItem {
    id: String,
    source_path: String,
}

fn build_background_project(
    input: ProjectCreateRequest,
) -> Result<(NewProject, IngestPlan), String> {
    let preset = ProjectPreset::parse(&input.preset)
        .ok_or_else(|| format!("Unsupported project preset: {}", input.preset))?;
    let settings = input.settings.as_ref();
    let source_roots = input
        .roots
        .iter()
        .map(|root| canonical_directory(root))
        .collect::<Result<Vec<_>, _>>()?;
    let raw_roots = input
        .raw_roots
        .unwrap_or_default()
        .iter()
        .map(|root| canonical_directory(root))
        .collect::<Result<Vec<_>, _>>()?;
    let manifest_master_roots = if raw_roots.is_empty() {
        source_roots.clone()
    } else {
        raw_roots.clone()
    };
    let manifest_mappings = load_manifest_mappings(
        input.mapping_manifest_path.as_deref(),
        &source_roots,
        &manifest_master_roots,
    )?;
    let project = NewProject {
        id: Uuid::new_v4().to_string(),
        name: input.name.trim().to_string(),
        preset,
        source_roots: source_roots.clone(),
        settings_json: serde_json::json!({
            "keepOriginalsUntouched": settings.map(|value| value.keep_originals_untouched).unwrap_or(true),
            "thumbnailCachePath": settings.and_then(|value| value.thumbnail_cache_path.as_deref()),
            "cacheLimitMb": settings.and_then(|value| value.cache_limit_mb),
            "backend": settings.and_then(|value| value.backend.as_deref()),
            "selectionTargetCount": settings.and_then(|value| value.selection_target_count).unwrap_or(50),
            "rawRoots": raw_roots.clone(),
            "mappingManifestPath": input.mapping_manifest_path,
        }),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        indexing_state: "indexing".to_string(),
        assets: Vec::new(),
    };
    Ok((
        project,
        IngestPlan {
            source_roots,
            raw_roots,
            manifest_mappings,
        },
    ))
}

fn ingest_plan_from_project(
    project: &framescout_storage::ProjectRecord,
) -> Result<IngestPlan, String> {
    let source_roots = project
        .source_roots_json
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let raw_roots = project.settings_json["rawRoots"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let manifest_master_roots = if raw_roots.is_empty() {
        source_roots.clone()
    } else {
        raw_roots.clone()
    };
    let manifest_mappings = load_manifest_mappings(
        project.settings_json["mappingManifestPath"].as_str(),
        &source_roots,
        &manifest_master_roots,
    )?;
    Ok(IngestPlan {
        source_roots,
        raw_roots,
        manifest_mappings,
    })
}

fn project_cache_limit_bytes(project: &framescout_storage::ProjectRecord) -> u64 {
    project.settings_json["cacheLimitMb"]
        .as_u64()
        .unwrap_or(DEFAULT_PROXY_CACHE_LIMIT_MB)
        .saturating_mul(1024 * 1024)
}

#[allow(dead_code)]
fn build_native_project(
    input: ProjectCreateRequest,
    cache_dir: &Path,
    eager_cache_count: usize,
) -> Result<NewProject, String> {
    let preset = ProjectPreset::parse(&input.preset)
        .ok_or_else(|| format!("Unsupported project preset: {}", input.preset))?;
    let settings = input.settings.as_ref();
    let source_roots = input
        .roots
        .iter()
        .map(|root| canonical_directory(root))
        .collect::<Result<Vec<_>, _>>()?;
    let raw_roots = input
        .raw_roots
        .unwrap_or_default()
        .iter()
        .map(|root| canonical_directory(root))
        .collect::<Result<Vec<_>, _>>()?;
    let manifest_master_roots = if raw_roots.is_empty() {
        source_roots.clone()
    } else {
        raw_roots.clone()
    };
    let manifest_mappings = load_manifest_mappings(
        input.mapping_manifest_path.as_deref(),
        &source_roots,
        &manifest_master_roots,
    )?;
    let project_id = Uuid::new_v4().to_string();
    let assets = collect_proxy_assets(
        &source_roots,
        &raw_roots,
        &manifest_mappings,
        cache_dir,
        &project_id,
        eager_cache_count,
    )?;

    Ok(NewProject {
        id: project_id,
        name: input.name.trim().to_string(),
        preset,
        source_roots,
        settings_json: serde_json::json!({
            "keepOriginalsUntouched": settings.map(|value| value.keep_originals_untouched).unwrap_or(true),
            "thumbnailCachePath": settings.and_then(|value| value.thumbnail_cache_path.as_deref()),
            "cacheLimitMb": settings.and_then(|value| value.cache_limit_mb),
            "backend": settings.and_then(|value| value.backend.as_deref()),
            "selectionTargetCount": settings.and_then(|value| value.selection_target_count).unwrap_or(50),
            "rawRoots": raw_roots,
            "mappingManifestPath": input.mapping_manifest_path,
        }),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        indexing_state: "complete".to_string(),
        assets,
    })
}

fn canonical_directory(root: &str) -> Result<String, String> {
    let path = Path::new(root);
    if !path.is_absolute() {
        return Err(format!(
            "Project root must be an absolute folder path: {root}"
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Unable to open project root {root}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Project root is not a folder: {}",
            canonical.display()
        ));
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[allow(dead_code)]
fn collect_proxy_assets(
    proxy_roots: &[String],
    raw_roots: &[String],
    manifest_mappings: &HashMap<PathBuf, PathBuf>,
    cache_dir: &Path,
    project_id: &str,
    eager_cache_count: usize,
) -> Result<Vec<NewAsset>, String> {
    let mut proxies = Vec::new();
    let mut raw_candidates = Vec::new();
    for root in proxy_roots {
        collect_files(Path::new(root), &mut proxies, is_supported_proxy)?;
        collect_files(Path::new(root), &mut raw_candidates, is_supported_raw)?;
    }
    for root in raw_roots {
        collect_files(Path::new(root), &mut raw_candidates, is_supported_raw)?;
    }
    raw_candidates.sort();
    raw_candidates.dedup();

    let indexes = build_raw_indexes(&raw_candidates, raw_roots);
    let plan = IngestPlan {
        source_roots: proxy_roots.to_vec(),
        raw_roots: raw_roots.to_vec(),
        manifest_mappings: manifest_mappings.clone(),
    };

    proxies
        .into_iter()
        .enumerate()
        .map(|(index, proxy)| {
            let metadata = fs::metadata(&proxy)
                .map_err(|error| format!("Unable to read {}: {error}", proxy.display()))?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or_default();
            let source_path = proxy.to_string_lossy().to_string();
            let (mapped_master_path, mapping_status, mapping_method, mapping_confidence) =
                mapping_for_proxy(&proxy, &plan, &indexes);
            let id = Uuid::new_v4().to_string();
            let (thumbnail_cache_path, display_cache_path, preview_state) =
                if index < eager_cache_count {
                    generate_proxy_caches(&proxy, cache_dir, project_id, &id)
                } else {
                    (None, None, "pending".to_string())
                };
            Ok(NewAsset {
                id,
                source_path: source_path.clone(),
                file_fingerprint: format!("{source_path}::{}::{modified}", metadata.len()),
                preview_state,
                exif_json: serde_json::json!({ "nativeScan": true }),
                thumbnail_cache_path,
                display_cache_path,
                mapped_master_path,
                mapping_status,
                mapping_method,
                mapping_confidence,
            })
        })
        .collect()
}

#[derive(Default)]
struct RawIndexes {
    by_sibling_key: HashMap<String, Vec<PathBuf>>,
    by_relative_key: HashMap<String, Vec<PathBuf>>,
}

fn build_raw_indexes(raw_candidates: &[PathBuf], raw_roots: &[String]) -> RawIndexes {
    let mut indexes = RawIndexes::default();
    for raw in raw_candidates {
        indexes
            .by_sibling_key
            .entry(sibling_key(raw))
            .or_default()
            .push(raw.clone());
        for root in raw_roots {
            if let Ok(relative) = raw.strip_prefix(root) {
                indexes
                    .by_relative_key
                    .entry(relative_key(relative))
                    .or_default()
                    .push(raw.clone());
            }
        }
    }
    indexes
}

fn unique_candidates(candidates: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn mapping_for_proxy(
    proxy: &Path,
    plan: &IngestPlan,
    indexes: &RawIndexes,
) -> (Option<String>, String, String, String) {
    if let Some(master) = plan.manifest_mappings.get(proxy) {
        return (
            Some(master.to_string_lossy().to_string()),
            "mapped".to_string(),
            "manifest".to_string(),
            "exact".to_string(),
        );
    }
    let relative_candidates = unique_candidates(plan.source_roots.iter().flat_map(|root| {
        proxy
            .strip_prefix(root)
            .ok()
            .into_iter()
            .flat_map(|relative| {
                indexes
                    .by_relative_key
                    .get(&relative_key(relative))
                    .cloned()
                    .unwrap_or_default()
            })
    }));
    match relative_candidates.as_slice() {
        [master] => {
            return (
                Some(master.to_string_lossy().to_string()),
                "mapped".to_string(),
                "mirrored_tree".to_string(),
                "exact".to_string(),
            )
        }
        [] => {}
        _ => {
            return (
                None,
                "ambiguous".to_string(),
                "none".to_string(),
                "unresolved".to_string(),
            )
        }
    }
    let sibling_candidates = unique_candidates(
        indexes
            .by_sibling_key
            .get(&sibling_key(proxy))
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|raw| raw.parent() == proxy.parent()),
    );
    match sibling_candidates.as_slice() {
        [master] => (
            Some(master.to_string_lossy().to_string()),
            "mapped".to_string(),
            "same_folder".to_string(),
            "exact".to_string(),
        ),
        [] => (
            None,
            "proxy_only".to_string(),
            "none".to_string(),
            "unresolved".to_string(),
        ),
        _ => (
            None,
            "ambiguous".to_string(),
            "none".to_string(),
            "unresolved".to_string(),
        ),
    }
}

fn new_proxy_asset(
    proxy: &Path,
    plan: &IngestPlan,
    indexes: &RawIndexes,
    cache_dir: &Path,
    project_id: &str,
    eager_generated: &mut usize,
) -> Result<NewAsset, String> {
    let metadata = fs::metadata(proxy)
        .map_err(|error| format!("Unable to read {}: {error}", proxy.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let source_path = proxy.to_string_lossy().to_string();
    let id = Uuid::new_v4().to_string();
    let (thumbnail_cache_path, display_cache_path, preview_state) =
        if *eager_generated < EAGER_PROXY_CACHES {
            *eager_generated += 1;
            generate_proxy_caches(proxy, cache_dir, project_id, &id)
        } else {
            (None, None, "pending".to_string())
        };
    let (mapped_master_path, mapping_status, mapping_method, mapping_confidence) =
        mapping_for_proxy(proxy, plan, indexes);
    Ok(NewAsset {
        id,
        source_path: source_path.clone(),
        file_fingerprint: format!("{source_path}::{}::{modified}", metadata.len()),
        preview_state,
        exif_json: serde_json::json!({ "nativeScan": true }),
        thumbnail_cache_path,
        display_cache_path,
        mapped_master_path,
        mapping_status,
        mapping_method,
        mapping_confidence,
    })
}

fn walk_files(
    root: &Path,
    accepts: fn(&Path) -> bool,
    visit: &mut impl FnMut(PathBuf) -> Result<(), String>,
) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("Unable to read {}: {error}", root.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Unable to read an entry in {}: {error}", root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Unable to inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk_files(&entry.path(), accepts, visit)?;
        } else if file_type.is_file() && accepts(&entry.path()) {
            visit(entry.path())?;
        }
    }
    Ok(())
}

fn start_project_ingestion(
    repository: framescout_storage::SqliteProjectRepository,
    cache_dir: PathBuf,
    ingest_jobs: Arc<Mutex<HashSet<String>>>,
    cache_jobs: Arc<Mutex<HashSet<String>>>,
    project_id: String,
    plan: IngestPlan,
    cache_limit_bytes: u64,
) {
    if !ingest_jobs
        .lock()
        .is_ok_and(|mut jobs| jobs.insert(project_id.clone()))
    {
        return;
    }
    thread::spawn(move || {
        let result = run_project_ingestion(
            &repository,
            &cache_dir,
            &cache_jobs,
            &project_id,
            &plan,
            cache_limit_bytes,
        );
        let state = if result.is_ok() { "complete" } else { "failed" };
        let _ = tauri::async_runtime::block_on(
            repository.set_project_indexing_state(&project_id, state),
        );
        if let Ok(mut jobs) = ingest_jobs.lock() {
            jobs.remove(&project_id);
        }
    });
}

fn run_project_ingestion(
    repository: &framescout_storage::SqliteProjectRepository,
    cache_dir: &Path,
    cache_jobs: &Arc<Mutex<HashSet<String>>>,
    project_id: &str,
    plan: &IngestPlan,
    cache_limit_bytes: u64,
) -> Result<(), String> {
    let mut raw_candidates = Vec::new();
    for root in plan.source_roots.iter().chain(plan.raw_roots.iter()) {
        collect_files(Path::new(root), &mut raw_candidates, is_supported_raw)?;
    }
    raw_candidates.sort();
    raw_candidates.dedup();
    let indexes = build_raw_indexes(&raw_candidates, &plan.raw_roots);
    let existing_paths = tauri::async_runtime::block_on(repository.list_assets(project_id))
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|asset| asset.source_path)
        .collect::<HashSet<_>>();
    let mut batch = Vec::with_capacity(INGEST_BATCH_SIZE);
    let mut eager_generated = 0;
    let persist = |batch: &mut Vec<NewAsset>| -> Result<(), String> {
        if batch.is_empty() {
            return Ok(());
        }
        let deferred = batch
            .iter()
            .filter(|asset| asset.display_cache_path.is_none())
            .map(|asset| CacheWorkItem {
                id: asset.id.clone(),
                source_path: asset.source_path.clone(),
            })
            .collect::<Vec<_>>();
        tauri::async_runtime::block_on(repository.append_assets(project_id, batch))
            .map_err(|error| error.to_string())?;
        enqueue_proxy_cache_generation(
            repository.clone(),
            cache_dir.to_path_buf(),
            cache_jobs.clone(),
            project_id.to_string(),
            deferred,
            cache_limit_bytes,
        );
        batch.clear();
        Ok(())
    };
    for root in &plan.source_roots {
        walk_files(Path::new(root), is_supported_proxy, &mut |proxy| {
            if existing_paths.contains(&proxy.to_string_lossy().to_string()) {
                return Ok(());
            }
            batch.push(new_proxy_asset(
                &proxy,
                plan,
                &indexes,
                cache_dir,
                project_id,
                &mut eager_generated,
            )?);
            if batch.len() >= INGEST_BATCH_SIZE {
                persist(&mut batch)?;
            }
            Ok(())
        })?;
    }
    persist(&mut batch)?;
    enforce_cache_limit(cache_dir, cache_limit_bytes);
    Ok(())
}

#[derive(Debug, Deserialize)]
struct MappingManifest {
    schema_version: u32,
    pairs: Vec<ManifestPair>,
}

#[derive(Debug, Deserialize)]
struct ManifestPair {
    proxy: String,
    master: String,
}

fn load_manifest_mappings(
    configured_path: Option<&str>,
    proxy_roots: &[String],
    raw_roots: &[String],
) -> Result<HashMap<PathBuf, PathBuf>, String> {
    let manifest_path = match configured_path {
        Some(path) => Some(PathBuf::from(path)),
        None => proxy_roots
            .iter()
            .map(|root| Path::new(root).join("framescout-map.json"))
            .find(|path| path.is_file()),
    };
    let Some(manifest_path) = manifest_path else {
        return Ok(HashMap::new());
    };
    let manifest_path = manifest_path
        .canonicalize()
        .map_err(|error| format!("Unable to open mapping manifest: {error}"))?;
    let content = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Unable to read mapping manifest: {error}"))?;
    let manifest: MappingManifest = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid mapping manifest: {error}"))?;
    if manifest.schema_version != 1 {
        return Err("Unsupported mapping manifest schema version.".to_string());
    }
    let mut mappings = HashMap::new();
    for pair in manifest.pairs {
        let proxy = resolve_manifest_file(&pair.proxy, proxy_roots, is_supported_proxy)?;
        let master = resolve_manifest_file(&pair.master, raw_roots, is_supported_raw)?;
        if mappings.insert(proxy.clone(), master).is_some() {
            return Err(format!(
                "Mapping manifest defines more than one master for {}.",
                proxy.display()
            ));
        }
    }
    Ok(mappings)
}

fn resolve_manifest_file(
    value: &str,
    roots: &[String],
    accepts: fn(&Path) -> bool,
) -> Result<PathBuf, String> {
    let declared = Path::new(value);
    if !declared.is_absolute()
        && declared
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!(
            "Mapping manifest path traversal is not allowed: {value}"
        ));
    }
    let candidates = if declared.is_absolute() {
        vec![declared.to_path_buf()]
    } else {
        roots
            .iter()
            .map(|root| Path::new(root).join(declared))
            .collect()
    };
    for candidate in candidates {
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        if canonical.is_file()
            && accepts(&canonical)
            && roots.iter().any(|root| canonical.starts_with(root))
        {
            return Ok(canonical);
        }
    }
    Err(format!(
        "Mapping manifest path is missing, unsupported, or outside selected roots: {value}"
    ))
}

fn generate_proxy_caches(
    proxy: &Path,
    cache_dir: &Path,
    project_id: &str,
    asset_id: &str,
) -> (Option<String>, Option<String>, String) {
    let asset_cache_dir = cache_dir.join(project_id).join(asset_id);
    if fs::create_dir_all(&asset_cache_dir).is_err() {
        return (None, None, "failed".to_string());
    }
    let image = match image::open(proxy) {
        Ok(image) => image,
        Err(_) => return (None, None, "failed".to_string()),
    };
    let thumbnail_path = asset_cache_dir.join("thumbnail.jpg");
    let display_path = asset_cache_dir.join("display.jpg");
    let thumbnail = image.thumbnail(512, 512);
    let display = image.thumbnail(2560, 2560);
    if thumbnail
        .save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
        .is_err()
        || display
            .save_with_format(&display_path, image::ImageFormat::Jpeg)
            .is_err()
    {
        let _ = fs::remove_dir_all(&asset_cache_dir);
        return (None, None, "failed".to_string());
    }
    (
        Some(thumbnail_path.to_string_lossy().to_string()),
        Some(display_path.to_string_lossy().to_string()),
        "ready".to_string(),
    )
}

fn enqueue_proxy_cache_generation(
    repository: framescout_storage::SqliteProjectRepository,
    cache_dir: PathBuf,
    cache_jobs: Arc<Mutex<HashSet<String>>>,
    project_id: String,
    assets: Vec<CacheWorkItem>,
    cache_limit_bytes: u64,
) {
    let assets = assets
        .into_iter()
        .filter(|asset| {
            cache_jobs
                .lock()
                .is_ok_and(|mut jobs| jobs.insert(format!("{project_id}:{}", asset.id)))
        })
        .collect::<Vec<_>>();
    if assets.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        for asset in assets {
            let source_path = PathBuf::from(&asset.source_path);
            let asset_id = asset.id.clone();
            let cache_dir = cache_dir.clone();
            let cache_dir_for_generation = cache_dir.clone();
            let project_id_for_cache = project_id.clone();
            let generated = tauri::async_runtime::spawn_blocking(move || {
                generate_proxy_caches(
                    &source_path,
                    &cache_dir_for_generation,
                    &project_id_for_cache,
                    &asset_id,
                )
            })
            .await
            .unwrap_or_else(|_| (None, None, "failed".to_string()));
            let _ = repository
                .update_asset_cache(
                    &project_id,
                    &asset.id,
                    generated.0.as_deref(),
                    generated.1.as_deref(),
                    &generated.2,
                )
                .await;
            enforce_cache_limit(&cache_dir, cache_limit_bytes);
            if let Ok(mut jobs) = cache_jobs.lock() {
                jobs.remove(&format!("{project_id}:{}", asset.id));
            }
        }
    });
}

#[derive(Debug)]
struct CacheEntry {
    path: PathBuf,
    bytes: u64,
    modified_at: std::time::SystemTime,
}

fn enforce_cache_limit(cache_dir: &Path, limit_bytes: u64) {
    let Ok(project_entries) = fs::read_dir(cache_dir) else {
        return;
    };
    let mut entries = Vec::new();
    for project in project_entries.flatten() {
        let Ok(project_type) = project.file_type() else {
            continue;
        };
        if !project_type.is_dir() {
            continue;
        }
        let Ok(asset_entries) = fs::read_dir(project.path()) else {
            continue;
        };
        for asset in asset_entries.flatten() {
            let Ok(asset_type) = asset.file_type() else {
                continue;
            };
            if !asset_type.is_dir() {
                continue;
            }
            let (bytes, modified_at) = cache_directory_metadata(&asset.path());
            entries.push(CacheEntry {
                path: asset.path(),
                bytes,
                modified_at,
            });
        }
    }
    let mut total_bytes = entries.iter().map(|entry| entry.bytes).sum::<u64>();
    if total_bytes <= limit_bytes {
        return;
    }
    entries.sort_by_key(|entry| entry.modified_at);
    for entry in entries {
        if total_bytes <= limit_bytes {
            break;
        }
        if fs::remove_dir_all(&entry.path).is_ok() {
            total_bytes = total_bytes.saturating_sub(entry.bytes);
        }
    }
}

fn cache_directory_metadata(directory: &Path) -> (u64, std::time::SystemTime) {
    let mut total_bytes = 0;
    let mut latest = std::time::UNIX_EPOCH;
    let Ok(entries) = fs::read_dir(directory) else {
        return (total_bytes, latest);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                let (nested_bytes, nested_latest) = cache_directory_metadata(&path);
                total_bytes = total_bytes.saturating_add(nested_bytes);
                latest = latest.max(nested_latest);
            } else if file_type.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    total_bytes = total_bytes.saturating_add(metadata.len());
                    if let Ok(modified_at) = metadata.modified() {
                        latest = latest.max(modified_at);
                    }
                }
            }
        }
    }
    (total_bytes, latest)
}

fn collect_files(
    root: &Path,
    files: &mut Vec<PathBuf>,
    accepts: fn(&Path) -> bool,
) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("Unable to read {}: {error}", root.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Unable to read an entry in {}: {error}", root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Unable to inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_files(&entry.path(), files, accepts)?;
            continue;
        }
        if !file_type.is_file() || !accepts(&entry.path()) {
            continue;
        }
        let path = entry
            .path()
            .canonicalize()
            .map_err(|error| format!("Unable to resolve {}: {error}", entry.path().display()))?;
        files.push(path);
    }
    Ok(())
}

fn is_supported_proxy(path: &Path) -> bool {
    matches!(
        extension(path).as_deref(),
        Some("jpg" | "jpeg" | "png" | "tif" | "tiff" | "webp")
    )
}

fn is_supported_raw(path: &Path) -> bool {
    matches!(
        extension(path).as_deref(),
        Some("cr2" | "cr3" | "nef" | "arw" | "dng" | "raf" | "orf" | "rw2")
    )
}

fn sibling_key(path: &Path) -> String {
    let directory = path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_string_lossy();
    format!("{}::{}", directory, stem(path)).to_ascii_lowercase()
}

fn relative_key(path: &Path) -> String {
    let directory = path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_string_lossy();
    format!("{}::{}", directory, stem(path))
        .replace('\\', "/")
        .to_ascii_lowercase()
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string()
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use framescout_storage::SqliteProjectRepository;
    use tempfile::tempdir;

    #[test]
    fn native_project_scan_keeps_proxy_assets_and_exact_same_folder_mapping() {
        let temp = tempdir().unwrap();
        let nested = temp.path().join("nested");
        fs::create_dir(&nested).unwrap();
        fs::write(temp.path().join("frame-001.JPG"), b"jpeg").unwrap();
        fs::write(temp.path().join("frame-001.cr2"), b"raw").unwrap();
        fs::write(nested.join("frame-002.cr2"), b"raw").unwrap();
        fs::write(temp.path().join("notes.txt"), b"ignore").unwrap();

        let project = build_native_project(
            ProjectCreateRequest {
                name: "Native scan".to_string(),
                roots: vec![temp.path().to_string_lossy().to_string()],
                raw_roots: None,
                mapping_manifest_path: None,
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            usize::MAX,
        )
        .unwrap();

        assert_eq!(project.assets.len(), 1);
        assert!(project
            .assets
            .iter()
            .all(|asset| Path::new(&asset.source_path).is_absolute()));
        assert_eq!(project.assets[0].mapping_status, "mapped");
        assert_eq!(project.assets[0].mapping_method, "same_folder");
        assert!(project.assets[0]
            .mapped_master_path
            .as_deref()
            .is_some_and(|path| path.ends_with("frame-001.cr2")));
    }

    #[test]
    fn native_project_mapping_uses_mirrored_roots_and_refuses_ambiguous_candidates() {
        let temp = tempdir().unwrap();
        let proxies = temp.path().join("proxies");
        let raw_a = temp.path().join("raw-a");
        let raw_b = temp.path().join("raw-b");
        fs::create_dir_all(proxies.join("day-1")).unwrap();
        fs::create_dir_all(raw_a.join("day-1")).unwrap();
        fs::create_dir_all(raw_b.join("day-1")).unwrap();
        fs::write(proxies.join("day-1").join("IMG_0001.jpg"), b"jpeg").unwrap();
        fs::write(proxies.join("day-1").join("IMG_0002.jpg"), b"jpeg").unwrap();
        fs::write(raw_a.join("day-1").join("IMG_0001.ARW"), b"raw").unwrap();
        fs::write(raw_a.join("day-1").join("IMG_0002.ARW"), b"raw").unwrap();
        fs::write(raw_b.join("day-1").join("IMG_0002.NEF"), b"raw").unwrap();

        let project = build_native_project(
            ProjectCreateRequest {
                name: "Mirrored map".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: Some(vec![
                    raw_a.to_string_lossy().to_string(),
                    raw_b.to_string_lossy().to_string(),
                ]),
                mapping_manifest_path: None,
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            usize::MAX,
        )
        .unwrap();

        let exact = project
            .assets
            .iter()
            .find(|asset| asset.source_path.ends_with("IMG_0001.jpg"))
            .unwrap();
        let ambiguous = project
            .assets
            .iter()
            .find(|asset| asset.source_path.ends_with("IMG_0002.jpg"))
            .unwrap();
        assert_eq!(exact.mapping_status, "mapped");
        assert_eq!(exact.mapping_method, "mirrored_tree");
        assert_eq!(ambiguous.mapping_status, "ambiguous");
        assert!(ambiguous.mapped_master_path.is_none());
    }

    #[test]
    fn mirrored_path_wins_over_duplicate_stems_in_other_folders() {
        let temp = tempdir().unwrap();
        let proxies = temp.path().join("proxies");
        let raw = temp.path().join("raw");
        fs::create_dir_all(proxies.join("day-1")).unwrap();
        fs::create_dir_all(raw.join("day-1")).unwrap();
        fs::create_dir_all(raw.join("day-2")).unwrap();
        fs::write(proxies.join("day-1").join("IMG_0001.jpg"), b"jpeg").unwrap();
        fs::write(raw.join("day-1").join("IMG_0001.ARW"), b"raw").unwrap();
        fs::write(raw.join("day-2").join("IMG_0001.ARW"), b"raw").unwrap();

        let project = build_native_project(
            ProjectCreateRequest {
                name: "Relative priority".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: Some(vec![raw.to_string_lossy().to_string()]),
                mapping_manifest_path: None,
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            0,
        )
        .unwrap();

        assert_eq!(project.assets[0].mapping_status, "mapped");
        assert_eq!(project.assets[0].mapping_method, "mirrored_tree");
        assert!(project.assets[0]
            .mapped_master_path
            .as_deref()
            .is_some_and(|path| path.contains("day-1")));
    }

    #[test]
    fn native_proxy_scan_writes_bounded_thumbnail_and_display_caches() {
        let temp = tempdir().unwrap();
        let proxies = temp.path().join("proxies");
        let cache = temp.path().join("cache");
        fs::create_dir(&proxies).unwrap();
        let image = image::RgbImage::from_pixel(3200, 1800, image::Rgb([10, 30, 50]));
        image.save(proxies.join("frame.jpg")).unwrap();

        let project = build_native_project(
            ProjectCreateRequest {
                name: "Cached proxies".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: None,
                mapping_manifest_path: None,
                preset: "matchday-story".to_string(),
                settings: None,
            },
            &cache,
            usize::MAX,
        )
        .unwrap();
        let asset = project.assets.first().unwrap();
        let thumbnail = asset.thumbnail_cache_path.as_deref().unwrap();
        let display = asset.display_cache_path.as_deref().unwrap();

        assert_eq!(asset.preview_state, "ready");
        assert!(Path::new(thumbnail).is_file());
        assert!(Path::new(display).is_file());
        assert!(image::image_dimensions(thumbnail).unwrap().0 <= 512);
        assert!(image::image_dimensions(display).unwrap().0 <= 2560);
    }

    #[test]
    fn proxy_scan_makes_an_initial_reviewable_batch_without_caching_every_asset() {
        let temp = tempdir().unwrap();
        let proxies = temp.path().join("proxies");
        fs::create_dir(&proxies).unwrap();
        for index in 0..3 {
            image::RgbImage::from_pixel(1200, 800, image::Rgb([index, 20, 30]))
                .save(proxies.join(format!("frame-{index}.jpg")))
                .unwrap();
        }

        let project = build_native_project(
            ProjectCreateRequest {
                name: "Streaming proxies".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: None,
                mapping_manifest_path: None,
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            1,
        )
        .unwrap();

        assert_eq!(
            project
                .assets
                .iter()
                .filter(|asset| asset.preview_state == "ready")
                .count(),
            1
        );
        assert_eq!(
            project
                .assets
                .iter()
                .filter(|asset| asset.preview_state == "pending")
                .count(),
            2
        );
    }

    #[test]
    fn proxy_scan_indexes_a_thousand_assets_while_only_caching_the_initial_batch() {
        let temp = tempdir().unwrap();
        let proxies = temp.path().join("proxies");
        fs::create_dir(&proxies).unwrap();
        let seed = proxies.join("seed.jpg");
        image::RgbImage::from_pixel(32, 24, image::Rgb([12, 34, 56]))
            .save(&seed)
            .unwrap();
        for index in 0..1_000 {
            fs::copy(&seed, proxies.join(format!("frame-{index:04}.jpg"))).unwrap();
        }
        fs::remove_file(seed).unwrap();

        let project = build_native_project(
            ProjectCreateRequest {
                name: "One thousand proxies".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: None,
                mapping_manifest_path: None,
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            EAGER_PROXY_CACHES,
        )
        .unwrap();

        assert_eq!(project.assets.len(), 1_000);
        assert_eq!(
            project
                .assets
                .iter()
                .filter(|asset| asset.preview_state == "ready")
                .count(),
            EAGER_PROXY_CACHES
        );
        assert_eq!(
            project
                .assets
                .iter()
                .filter(|asset| asset.preview_state == "pending")
                .count(),
            1_000 - EAGER_PROXY_CACHES
        );
    }

    #[test]
    fn cache_cleanup_removes_only_oldest_derived_asset_directories() {
        let temp = tempdir().unwrap();
        let cache = temp.path().join("cache");
        let oldest = cache.join("project-a").join("oldest");
        let newest = cache.join("project-a").join("newest");
        fs::create_dir_all(&oldest).unwrap();
        fs::write(oldest.join("display.jpg"), vec![1_u8; 256]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::create_dir_all(&newest).unwrap();
        fs::write(newest.join("display.jpg"), vec![2_u8; 256]).unwrap();

        enforce_cache_limit(&cache, 300);

        assert!(!oldest.exists());
        assert!(newest.exists());
    }

    #[test]
    fn manifest_mapping_is_exact_and_rejects_path_traversal() {
        let temp = tempdir().unwrap();
        let proxies = temp.path().join("proxies");
        let raws = temp.path().join("raws");
        fs::create_dir(&proxies).unwrap();
        fs::create_dir(&raws).unwrap();
        fs::write(proxies.join("frame.jpg"), b"jpeg").unwrap();
        fs::write(raws.join("different-name.CR3"), b"raw").unwrap();
        fs::write(
            proxies.join("framescout-map.json"),
            r#"{"schema_version":1,"pairs":[{"proxy":"frame.jpg","master":"different-name.CR3"}]}"#,
        )
        .unwrap();

        let project = build_native_project(
            ProjectCreateRequest {
                name: "Manifest map".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: Some(vec![raws.to_string_lossy().to_string()]),
                mapping_manifest_path: Some(
                    proxies
                        .join("framescout-map.json")
                        .to_string_lossy()
                        .to_string(),
                ),
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            usize::MAX,
        )
        .unwrap();
        assert_eq!(project.assets[0].mapping_method, "manifest");
        assert_eq!(project.assets[0].mapping_status, "mapped");

        fs::write(
            proxies.join("unsafe-map.json"),
            r#"{"schema_version":1,"pairs":[{"proxy":"../outside.jpg","master":"different-name.CR3"}]}"#,
        )
        .unwrap();
        let unsafe_result = build_native_project(
            ProjectCreateRequest {
                name: "Unsafe map".to_string(),
                roots: vec![proxies.to_string_lossy().to_string()],
                raw_roots: Some(vec![raws.to_string_lossy().to_string()]),
                mapping_manifest_path: Some(
                    proxies
                        .join("unsafe-map.json")
                        .to_string_lossy()
                        .to_string(),
                ),
                preset: "matchday-story".to_string(),
                settings: None,
            },
            temp.path(),
            usize::MAX,
        );
        assert!(unsafe_result.is_err());
    }

    #[tokio::test]
    async fn native_projection_restores_asset_revisions_events_and_tags() {
        let temp = tempdir().unwrap();
        let repository = SqliteProjectRepository::connect_file(temp.path().join("framescout.db"))
            .await
            .unwrap();
        repository.migrate().await.unwrap();
        let state = NativeProjectState {
            repository,
            cache_dir: temp.path().join("cache"),
            ingest_jobs: Arc::new(Mutex::new(HashSet::new())),
            cache_jobs: Arc::new(Mutex::new(HashSet::new())),
        };
        let created = state
            .repository
            .create_project(NewProject {
                id: "native-project".to_string(),
                name: "Native project".to_string(),
                preset: ProjectPreset::MatchdayStory,
                source_roots: vec!["C:\\Pictures".to_string()],
                settings_json: serde_json::json!({ "keepOriginalsUntouched": true }),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![NewAsset {
                    id: "native-asset".to_string(),
                    source_path: "C:\\Pictures\\frame.CR2".to_string(),
                    file_fingerprint: "native-frame".to_string(),
                    preview_state: "raw-placeholder".to_string(),
                    exif_json: serde_json::json!({}),
                    thumbnail_cache_path: None,
                    display_cache_path: None,
                    mapped_master_path: None,
                    mapping_status: "proxy_only".to_string(),
                    mapping_method: "none".to_string(),
                    mapping_confidence: "unresolved".to_string(),
                }],
            })
            .await
            .unwrap();
        state
            .repository
            .set_human_decision(
                &created.id,
                "native-asset",
                framescout_storage::HumanDisposition::Select,
                0,
            )
            .await
            .unwrap();
        state
            .repository
            .apply_tag(
                &created.id,
                &["native-asset".to_string()],
                "manual:hero",
                "add",
            )
            .await
            .unwrap();

        let projection = native_project_projection(&state, &created.id)
            .await
            .unwrap();
        let asset = projection["assets"].as_array().unwrap().first().unwrap();

        assert_eq!(asset["decisionRevision"], 1);
        assert_eq!(asset["tags"], serde_json::json!(["manual:hero"]));
        assert_eq!(projection["decisionEvents"].as_array().unwrap().len(), 1);
        assert_eq!(projection["tagEvents"].as_array().unwrap().len(), 1);
    }
}

#[tauri::command]
pub async fn project_load_active(
    app: AppHandle,
    state: State<'_, NativeProjectState>,
) -> Result<ProjectLoadActiveResponse, String> {
    let project = state
        .repository
        .load_most_recent_project()
        .await
        .map_err(|error| error.to_string())?;
    let project = match project {
        Some(project) => {
            let source_roots = project
                .source_roots_json
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str);
            for root in source_roots {
                app.asset_protocol_scope()
                    .allow_directory(root, true)
                    .map_err(|error| format!("Unable to allow proxy assets: {error}"))?;
            }
            let cache_limit_bytes = project_cache_limit_bytes(&project);
            if project.indexing_state == "indexing" {
                start_project_ingestion(
                    state.repository.clone(),
                    state.cache_dir.clone(),
                    state.ingest_jobs.clone(),
                    state.cache_jobs.clone(),
                    project.id.clone(),
                    ingest_plan_from_project(&project)?,
                    cache_limit_bytes,
                );
            }
            let pending = state
                .repository
                .list_assets(&project.id)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .filter(|asset| asset.preview_state == "pending")
                .map(|asset| CacheWorkItem {
                    id: asset.id,
                    source_path: asset.source_path,
                })
                .collect::<Vec<_>>();
            enqueue_proxy_cache_generation(
                state.repository.clone(),
                state.cache_dir.clone(),
                state.cache_jobs.clone(),
                project.id.clone(),
                pending,
                cache_limit_bytes,
            );
            Some(native_project_projection(&state, &project.id).await?)
        }
        None => None,
    };
    Ok(ProjectLoadActiveResponse { project })
}

#[tauri::command]
pub async fn project_save_snapshot(
    state: State<'_, NativeProjectState>,
    input: ProjectSaveSnapshotRequest,
) -> Result<ProjectSaveSnapshotResponse, String> {
    let project_id = input.project["id"]
        .as_str()
        .ok_or_else(|| "project.saveSnapshot needs a project id.".to_string())?;
    let name = input.project["name"]
        .as_str()
        .ok_or_else(|| "project.saveSnapshot needs a project name.".to_string())?;
    let preset = input.project["preset"]
        .as_str()
        .ok_or_else(|| "project.saveSnapshot needs a project preset.".to_string())?;
    let stored_project = state
        .repository
        .load_project(project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Project was not found.".to_string())?;
    let source_roots = stored_project
        .source_roots_json
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let assets = input.project["assets"]
        .as_array()
        .ok_or_else(|| "project.saveSnapshot needs assets.".to_string())?
        .iter()
        .map(|asset| {
            Ok(AssetSnapshot {
                id: required_string(asset, "id")?,
                source_path: required_string(asset, "sourcePath")?,
                file_fingerprint: required_string(asset, "fileFingerprint")?,
                preview_state: required_string(asset, "previewState")?,
                missing_state: required_string(asset, "missingState")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    state
        .repository
        .save_project_snapshot(
            project_id,
            name,
            preset,
            &source_roots,
            &assets,
            input.optimistic_revision as i64,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(ProjectSaveSnapshotResponse {
        project: native_project_projection(&state, project_id).await?,
    })
}

#[tauri::command]
pub async fn selection_goal_set(
    project_id: String,
    input: SelectionGoalSetRequest,
    state: State<'_, NativeProjectState>,
) -> Result<SelectionGoalSetResponse, String> {
    if project_id.is_empty() || !(1..=100_000).contains(&input.target_count) {
        return Err("Selection target must be between 1 and 100000.".to_string());
    }
    state
        .repository
        .set_selection_target(&project_id, input.target_count)
        .await
        .map_err(|error| error.to_string())?;
    Ok(SelectionGoalSetResponse {
        project: native_project_projection(&state, &project_id).await?,
    })
}

#[tauri::command]
pub async fn metadata_refresh(
    project_id: String,
    input: MetadataRefreshRequest,
    state: State<'_, NativeProjectState>,
) -> Result<MetadataRefreshResponse, String> {
    if project_id.is_empty() || input.project_id.is_empty() || project_id != input.project_id {
        return Err("metadata.refresh needs a matching project id.".to_string());
    }
    let assets = state
        .repository
        .list_assets(&project_id)
        .await
        .map_err(|error| error.to_string())?;
    for asset in assets {
        let mut paths = Vec::with_capacity(2);
        if let Some(master_path) = asset.mapped_master_path.as_ref() {
            paths.push(PathBuf::from(master_path));
        }
        paths.push(PathBuf::from(&asset.source_path));
        if let Some((capture_at, metadata)) = read_camera_metadata(&paths) {
            state
                .repository
                .update_asset_metadata(&project_id, &asset.id, capture_at.as_deref(), &metadata)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(MetadataRefreshResponse {
        project: native_project_projection(&state, &project_id).await?,
        started: true,
    })
}

#[tauri::command]
pub async fn mapping_set_manual(
    project_id: String,
    input: MappingSetManualRequest,
    state: State<'_, NativeProjectState>,
) -> Result<MappingSetManualResponse, String> {
    if project_id.is_empty() || input.asset_id.is_empty() {
        return Err("mapping.setManual needs a project id and asset id.".to_string());
    }
    let project = state
        .repository
        .load_project(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Project was not found.".to_string())?;
    let mut raw_roots = project.settings_json["rawRoots"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if raw_roots.is_empty() {
        raw_roots = project
            .source_roots_json
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(PathBuf::from)
            .collect();
    }
    let mapping = match input.master_path {
        Some(master_path) => {
            let master = PathBuf::from(master_path)
                .canonicalize()
                .map_err(|error| format!("Unable to open RAW master: {error}"))?;
            if !master.is_file() || !is_supported_raw(&master) {
                return Err("Manual mapping target must be a supported RAW file.".to_string());
            }
            if raw_roots.is_empty() || !raw_roots.iter().any(|root| master.starts_with(root)) {
                return Err("Manual mapping target is outside the selected RAW roots.".to_string());
            }
            (
                Some(master.to_string_lossy().to_string()),
                "manually_mapped",
                "manual",
                "exact",
            )
        }
        None => (None, "proxy_only", "manual", "unresolved"),
    };
    state
        .repository
        .set_asset_mapping(
            &project_id,
            &input.asset_id,
            mapping.0.as_deref(),
            mapping.1,
            mapping.2,
            mapping.3,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(MappingSetManualResponse {
        project: native_project_projection(&state, &project_id).await?,
    })
}

fn required_string(value: &serde_json::Value, field: &str) -> Result<String, String> {
    value[field]
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| format!("project.saveSnapshot asset needs {field}."))
}

#[tauri::command]
pub async fn analysis_enqueue(
    project_id: String,
    input: AnalysisEnqueueRequest,
    state: State<'_, NativeProjectState>,
) -> Result<AnalysisEnqueueResponse, String> {
    if project_id.is_empty() || input.project_id.is_empty() {
        return Err("analysis.enqueue needs a project id.".to_string());
    }
    if project_id != input.project_id {
        return Err("analysis.enqueue project id mismatch.".to_string());
    }
    if !matches!(input.priority.as_deref(), None | Some("normal" | "high")) {
        return Err("analysis.enqueue priority must be normal or high.".to_string());
    }
    let indexing_state = state
        .repository
        .load_project(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Project was not found.".to_string())?
        .indexing_state;
    let mut project = native_project_projection(&state, &project_id).await?;
    let total = project["assets"].as_array().map_or(0, Vec::len) as u32;
    let previews_ready = project["assets"].as_array().map_or(0, |assets| {
        assets
            .iter()
            .filter(|asset| asset["previewState"] == "ready")
            .count() as u32
    });
    let complete = indexing_state == "complete";
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let run = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "projectId": project_id,
        "status": if indexing_state == "failed" { "failed" } else if complete { "completed" } else { "running" },
        "totalAssets": total,
        "previewsReady": previews_ready,
        "rawPlaceholders": project["assets"].as_array().map_or(0, |assets| assets.iter().filter(|asset| asset["previewState"] == "raw-placeholder").count()),
        "missingAssets": project["assets"].as_array().map_or(0, |assets| assets.iter().filter(|asset| asset["missingState"] == "missing").count()),
        "progress": if total == 0 { 1.0 } else { previews_ready as f32 / total as f32 },
        "backend": "cpu",
        "queuedAt": now,
        "completedAt": if complete { serde_json::Value::String(now.clone()) } else { serde_json::Value::Null }
    });
    project["analysisRuns"] = serde_json::json!([run.clone()]);
    Ok(AnalysisEnqueueResponse { run, project })
}

#[tauri::command]
pub async fn review_next(
    project_id: String,
    input: ReviewNextRequest,
    state: State<'_, NativeProjectState>,
) -> Result<ReviewNextResponse, String> {
    if project_id.is_empty() || input.project_id.is_empty() {
        return Err("review.next needs a project id.".to_string());
    }
    if project_id != input.project_id {
        return Err("review.next project id mismatch.".to_string());
    }
    if input.cursor < 0 {
        return Err("review.next cursor must be non-negative.".to_string());
    }
    if let Some(direction) = input.direction.as_deref() {
        if direction != "next" && direction != "previous" {
            return Err("review.next direction must be next or previous.".to_string());
        }
    }
    let project = native_project_projection(&state, &project_id).await?;
    let queue = project["assets"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|asset| {
            input.show_ai_rejects.unwrap_or(false)
                || asset["aiDisposition"] != "reject"
                || asset["humanDisposition"] != "unseen"
        })
        .collect::<Vec<_>>();
    let last = queue.len().saturating_sub(1);
    let cursor = match input.direction.as_deref() {
        Some("previous") => (input.cursor as usize).saturating_sub(1),
        _ => (input.cursor as usize).saturating_add(1).min(last),
    };
    Ok(ReviewNextResponse {
        asset: queue.get(cursor).cloned(),
        cursor: cursor as u32,
        queue_length: queue.len() as u32,
    })
}

#[tauri::command]
pub async fn decision_set(
    project_id: String,
    input: DecisionSetRequest,
    state: State<'_, NativeProjectState>,
) -> Result<DecisionSetResponse, String> {
    if project_id.is_empty() {
        return Err("decision.set needs a project id.".to_string());
    }
    if input.asset_id.is_empty() {
        return Err("decision.set needs an asset id.".to_string());
    }
    let disposition = framescout_storage::HumanDisposition::parse(&input.human_disposition)
        .filter(|value| !matches!(value, framescout_storage::HumanDisposition::Unseen))
        .ok_or_else(|| "decision.set needs a supported human disposition.".to_string())?;
    let event = state
        .repository
        .set_human_decision(
            &project_id,
            &input.asset_id,
            disposition.clone(),
            input.asset_revision as i64,
        )
        .await
        .map_err(|error| error.to_string())?;
    let project = native_project_projection(&state, &project_id).await?;
    Ok(DecisionSetResponse {
        event: DecisionEvent {
            asset_id: event.asset_id,
            human_disposition: event.human_disposition.as_str().to_string(),
            revision: event.revision as u32,
            changed_at: event.changed_at,
            actor: "human".to_string(),
        },
        project,
    })
}

#[tauri::command]
pub async fn decision_set_batch(
    project_id: String,
    input: DecisionSetBatchRequest,
    state: State<'_, NativeProjectState>,
) -> Result<DecisionSetBatchResponse, String> {
    if input.changes.is_empty() || input.changes.len() > 500 {
        return Err("decision.setBatch needs between 1 and 500 changes.".to_string());
    }
    let mut events = Vec::with_capacity(input.changes.len());
    for change in input.changes {
        let disposition = framescout_storage::HumanDisposition::parse(&change.human_disposition)
            .filter(|value| !matches!(value, framescout_storage::HumanDisposition::Unseen))
            .ok_or_else(|| "decision.setBatch needs supported human dispositions.".to_string())?;
        let event = state
            .repository
            .set_human_decision(
                &project_id,
                &change.asset_id,
                disposition,
                change.asset_revision as i64,
            )
            .await
            .map_err(|error| error.to_string())?;
        events.push(DecisionEvent {
            asset_id: event.asset_id,
            human_disposition: event.human_disposition.as_str().to_string(),
            revision: event.revision as u32,
            changed_at: event.changed_at,
            actor: "human".to_string(),
        });
    }
    let project = native_project_projection(&state, &project_id).await?;
    Ok(DecisionSetBatchResponse { events, project })
}

#[tauri::command]
pub async fn tag_apply(
    project_id: String,
    input: TagApplyRequest,
    state: State<'_, NativeProjectState>,
) -> Result<TagApplyResponse, String> {
    if project_id.is_empty() {
        return Err("tag.apply needs a project id.".to_string());
    }
    if input.asset_ids.is_empty() {
        return Err("tag.apply needs at least one asset id.".to_string());
    }
    let tag = normalize_manual_tag(&input.tag)?;
    let event = state
        .repository
        .apply_tag(&project_id, &input.asset_ids, &tag, &input.mutation)
        .await
        .map_err(|error| error.to_string())?;
    let project = native_project_projection(&state, &project_id).await?;
    Ok(TagApplyResponse {
        event: serde_json::json!({
            "assetIds": event.asset_ids,
            "tag": event.tag,
            "mutation": event.mutation,
            "changedAt": event.changed_at,
            "actor": "human"
        }),
        project,
    })
}

#[tauri::command]
pub async fn tag_apply_batch(
    project_id: String,
    input: TagApplyBatchRequest,
    state: State<'_, NativeProjectState>,
) -> Result<TagApplyBatchResponse, String> {
    if input.mutations.is_empty() || input.mutations.len() > 100 {
        return Err("tag.applyBatch needs between 1 and 100 mutations.".to_string());
    }
    let mut events = Vec::with_capacity(input.mutations.len());
    for mutation in input.mutations {
        let tag = normalize_manual_tag(&mutation.tag)?;
        let event = state
            .repository
            .apply_tag(&project_id, &mutation.asset_ids, &tag, &mutation.mutation)
            .await
            .map_err(|error| error.to_string())?;
        events.push(serde_json::json!({
            "assetIds": event.asset_ids,
            "tag": event.tag,
            "mutation": event.mutation,
            "changedAt": event.changed_at,
            "actor": "human"
        }));
    }
    let project = native_project_projection(&state, &project_id).await?;
    Ok(TagApplyBatchResponse { events, project })
}

fn normalize_manual_tag(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    if normalized.is_empty() {
        return Err("tag.apply needs a non-empty tag.".to_string());
    }
    Ok(if normalized.contains(':') {
        normalized
    } else {
        format!("manual:{normalized}")
    })
}

#[tauri::command]
pub async fn group_open(
    project_id: String,
    input: GroupOpenRequest,
    state: State<'_, NativeProjectState>,
) -> Result<GroupOpenResponse, String> {
    if project_id.is_empty() || input.project_id.is_empty() {
        return Err("group.open needs a project id.".to_string());
    }
    if project_id != input.project_id {
        return Err("group.open project id mismatch.".to_string());
    }
    if input.group_id.trim().is_empty() {
        return Err("group.open needs a group id.".to_string());
    }
    let project = native_project_projection(&state, &project_id).await?;
    let assets = project["assets"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|asset| asset["groupId"].as_str() == Some(input.group_id.as_str()))
        .collect::<Vec<_>>();
    if assets.is_empty() {
        return Err("group.open group was not found.".to_string());
    }
    let focus_index = input
        .focus_asset_id
        .as_deref()
        .and_then(|id| {
            assets
                .iter()
                .position(|asset| asset["id"].as_str() == Some(id))
        })
        .unwrap_or_default() as u32;
    Ok(GroupOpenResponse {
        group_id: input.group_id,
        assets,
        focus_index,
        evidence: Vec::new(),
    })
}

#[tauri::command]
pub async fn export_preview(
    project_id: String,
    input: ExportPreviewRequest,
    state: State<'_, NativeProjectState>,
) -> Result<ExportPreviewResponse, String> {
    if project_id.is_empty() || input.project_id.is_empty() {
        return Err("export.preview needs a project id.".to_string());
    }
    if project_id != input.project_id {
        return Err("export.preview project id mismatch.".to_string());
    }
    let project = native_project_projection(&state, &project_id).await?;
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let mut targets = Vec::new();
    let mut skipped = Vec::new();
    let mut metadata_records = Vec::new();
    for asset in assets {
        let id = asset["id"].as_str().unwrap_or_default();
        let file_name = asset["fileName"].as_str().unwrap_or_default();
        let disposition = asset["humanDisposition"].as_str().unwrap_or("unseen");
        let source_path = asset["sourcePath"].as_str().unwrap_or_default();
        let tags = asset["tags"].as_array().cloned().unwrap_or_default();
        let reasons = if input.include_ai_reason_keywords.unwrap_or(true) {
            asset["reasons"].as_array().cloned().unwrap_or_default()
        } else {
            Vec::new()
        };
        metadata_records.push(serde_json::json!({
            "assetId": id,
            "fileName": file_name,
            "sourcePath": source_path,
            "humanDisposition": disposition,
            "aiDisposition": asset["aiDisposition"],
            "tags": tags,
            "reasons": reasons,
            "modelVersion": "native-phase-1"
        }));
        if disposition == "unseen" {
            skipped.push(
                serde_json::json!({ "assetId": id, "fileName": file_name, "reason": "unseen" }),
            );
            continue;
        }
        if asset["missingState"] == "missing" {
            skipped.push(serde_json::json!({ "assetId": id, "fileName": file_name, "reason": "missing-source" }));
            continue;
        }
        let sidecar_path = Path::new(source_path)
            .with_extension("xmp")
            .to_string_lossy()
            .to_string();
        let (rating, color_label) = match disposition {
            "select" => (5, "Green"),
            "candidate" => (3, "Yellow"),
            "hold" => (2, "Blue"),
            "reject" => (1, "Red"),
            _ => (0, "None"),
        };
        targets.push(serde_json::json!({
            "assetId": id,
            "sourceAssetId": id,
            "fileName": file_name,
            "sidecarPath": sidecar_path,
            "humanDisposition": disposition,
            "rating": rating,
            "colorLabel": color_label,
            "keywords": tags,
            "operation": "add-or-update"
        }));
    }
    let csv_preview = "assetId,fileName,humanDisposition\n".to_string()
        + &metadata_records
            .iter()
            .map(|record| {
                format!(
                    "{},{},{}",
                    record["assetId"].as_str().unwrap_or_default(),
                    record["fileName"].as_str().unwrap_or_default(),
                    record["humanDisposition"].as_str().unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
    Ok(ExportPreviewResponse {
        project_id,
        original_files_modified: 0,
        xmp_files_to_write: targets.len() as u32,
        targets,
        skipped,
        metadata_records,
        csv_preview,
    })
}

#[tauri::command]
pub fn export_commit(
    project_id: String,
    input: ExportCommitRequest,
) -> Result<ExportCommitResponse, String> {
    if project_id.is_empty() || input.project_id.is_empty() {
        return Err("export.commit needs a project id.".to_string());
    }
    if project_id != input.project_id {
        return Err("export.commit project id mismatch.".to_string());
    }
    if !input.explicit_confirmation {
        return Err("export.commit requires explicit confirmation.".to_string());
    }
    let _ = (&input.preview, input.dry_run);
    Ok(ExportCommitResponse {
        project_id,
        committed: false,
        reason: "native-export-not-wired".to_string(),
        original_files_modified: 0,
        xmp_files_written: 0,
    })
}
