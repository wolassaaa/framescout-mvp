use std::{
    collections::{BTreeSet, HashMap, HashSet},
    io::BufReader as StdBufReader,
    io::Cursor,
    net::SocketAddr,
    path::{Path as FilePath, PathBuf},
    process::Stdio,
    sync::{mpsc, Arc},
    thread,
};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{SecondsFormat, Utc};
use exif::{In, Reader as ExifReader, Tag as ExifTag};
use framescout_storage::{
    NewAsset, NewProject, ProjectPreset, ProjectRepository, SqliteProjectRepository,
};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, GenericImageView};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex, RwLock, Semaphore},
    task::JoinSet,
};
use tokio_util::io::ReaderStream;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::{info, Level};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const DEFAULT_BIND: &str = "127.0.0.1:4310";
const MAX_COMMAND_BYTES: usize = 64 * 1024;
const INGEST_BATCH_SIZE: usize = 32;
const THUMBNAIL_QUEUE_CAPACITY: usize = 16;
const DEFAULT_PROXY_CACHE_LIMIT_MB: u64 = 4_096;
const THUMBNAIL_MAX_EDGE: u32 = 512;
const DISPLAY_MAX_EDGE: u32 = 2_560;

#[derive(Clone)]
struct AppState {
    repository: Option<SqliteProjectRepository>,
    media: Arc<RwLock<HashMap<String, CachedMedia>>>,
    cache_dir: PathBuf,
    ingest_jobs: Arc<Mutex<HashSet<String>>>,
    running_analysis: Arc<Mutex<HashSet<String>>>,
    running_metadata: Arc<Mutex<HashSet<String>>>,
    preview_requests: Arc<Semaphore>,
    ai: AiConfig,
    analysis_profile: Arc<RwLock<AnalysisProfileSelection>>,
    cloud_requests: Arc<Semaphore>,
    public_base_url: String,
    trusted_web_origin: Option<String>,
}

#[derive(Clone)]
struct CachedMedia {
    thumbnail: PathBuf,
    display: Option<PathBuf>,
}

#[derive(Clone)]
struct AiConfig {
    python: PathBuf,
    quality_model: PathBuf,
    fast_model: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProfileSelection {
    profile_id: String,
    endpoint: Option<String>,
    model: Option<String>,
    #[serde(default = "default_execution_mode")]
    execution_mode: String,
    #[serde(default)]
    cloud_budget_cents: u64,
    #[serde(default = "default_cloud_concurrency")]
    cloud_concurrency: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CloudExecutionPreferences {
    execution_mode: String,
    cloud_budget_cents: u64,
    cloud_concurrency: u8,
}

#[cfg(test)]
#[derive(Clone, Debug, PartialEq, Eq)]
struct CloudWorkPlan {
    asset_limit: usize,
    estimated_budget_cents: u64,
    concurrency: usize,
    budget_exhausted: bool,
}

const MAX_CLOUD_PROXY_PIXELS: u64 = 1_600 * 1_600;
const MAX_CLOUD_PROXY_BYTES: u64 = 12 * 1024 * 1024;
const MAX_CLOUD_BUDGET_CENTS: u64 = 100_000;
const MAX_CLOUD_CONCURRENCY: u8 = 4;
const TRUSTED_CLOUD_OBSERVATION_CONFIDENCE: f64 = 0.72;

fn default_execution_mode() -> String {
    "local".to_string()
}

fn default_cloud_concurrency() -> u8 {
    2
}

#[cfg(test)]
fn cloud_work_plan(
    asset_count: usize,
    estimated_cents_per_asset: u64,
    budget_cents: u64,
    requested_concurrency: u8,
) -> Result<CloudWorkPlan, String> {
    if estimated_cents_per_asset == 0 {
        return Err("cloud cost estimate must be greater than zero".to_string());
    }
    if budget_cents == 0 {
        return Err(
            "cloud budget is zero; set a budget before starting cloud analysis".to_string(),
        );
    }
    let affordable =
        usize::try_from(budget_cents / estimated_cents_per_asset).unwrap_or(usize::MAX);
    let asset_limit = asset_count.min(affordable);
    if asset_limit == 0 {
        return Err("cloud budget is below the estimated cost of one proxy".to_string());
    }
    let concurrency = usize::from(requested_concurrency.clamp(1, MAX_CLOUD_CONCURRENCY));
    Ok(CloudWorkPlan {
        asset_limit,
        estimated_budget_cents: (asset_limit as u64).saturating_mul(estimated_cents_per_asset),
        concurrency,
        budget_exhausted: asset_limit < asset_count,
    })
}

fn is_transient_cloud_status(status: u16) -> bool {
    matches!(status, 408 | 425 | 429) || (500..=599).contains(&status)
}

fn is_trusted_browser_origin(origin: Option<&str>, configured_origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some("http://127.0.0.1:5173" | "http://localhost:5173") => true,
        Some(origin) => configured_origin.is_some_and(|configured| origin == configured),
    }
}

fn remaining_cloud_asset_slots(
    budget_cents: u64,
    estimated_cents_per_asset: u64,
    prior_sent_requests: u64,
) -> Result<usize, String> {
    if budget_cents == 0 {
        return Err(
            "cloud budget is zero; set a budget before starting cloud analysis".to_string(),
        );
    }
    if estimated_cents_per_asset == 0 {
        return Err("cloud cost estimate must be greater than zero".to_string());
    }
    let total_slots = budget_cents / estimated_cents_per_asset;
    Ok(usize::try_from(total_slots.saturating_sub(prior_sent_requests)).unwrap_or(usize::MAX))
}

fn cloud_failure_disposition() -> &'static str {
    "review"
}

fn validate_execution_profile(execution_mode: &str, provider: &str) -> Result<(), String> {
    let compatible = match execution_mode {
        "local" => provider == "local",
        "cloud" | "hybrid" => provider != "local",
        _ => false,
    };
    if compatible {
        Ok(())
    } else {
        Err(format!(
            "analysis execution mode '{execution_mode}' is incompatible with provider '{provider}'"
        ))
    }
}

fn resumable_cloud_run_id(
    provider: &str,
    model_bundle_version: &str,
    latest: Option<(&str, &str, &str)>,
) -> Option<String> {
    let (run_id, status, stored_version) = latest?;
    (provider != "local"
        && matches!(status, "running" | "failed")
        && stored_version == model_bundle_version)
        .then(|| run_id.to_string())
}

#[cfg(test)]
fn pending_cloud_asset_ids(
    ordered_asset_ids: &[String],
    completed_ids: &HashSet<String>,
    asset_limit: usize,
) -> Vec<String> {
    ordered_asset_ids
        .iter()
        .take(asset_limit)
        .filter(|asset_id| !completed_ids.contains(*asset_id))
        .cloned()
        .collect()
}

async fn cloud_request_ledger(
    repository: &SqliteProjectRepository,
    project_id: &str,
    provider: &str,
    model: &str,
) -> Result<HashMap<String, String>, String> {
    let rows = sqlx::query(
        "SELECT asset_id, state FROM cloud_requests WHERE project_id = ? AND provider = ? AND model = ?",
    )
    .bind(project_id)
    .bind(provider)
    .bind(model)
    .fetch_all(repository.pool())
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("asset_id"),
                row.get::<String, _>("state"),
            )
        })
        .collect())
}

async fn reserve_cloud_request(
    repository: &SqliteProjectRepository,
    project_id: &str,
    asset_id: &str,
    run_id: &str,
    provider: &str,
    model: &str,
    estimated_cents: u64,
) -> Result<bool, String> {
    let now = timestamp();
    let result = sqlx::query(
        r#"
        INSERT OR IGNORE INTO cloud_requests (
          id, project_id, asset_id, run_id, provider, model, state,
          estimated_cents, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, 0, ?, ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(project_id)
    .bind(asset_id)
    .bind(run_id)
    .bind(provider)
    .bind(model)
    .bind(i64::try_from(estimated_cents).unwrap_or(i64::MAX))
    .bind(&now)
    .bind(&now)
    .execute(repository.pool())
    .await
    .map_err(|error| error.to_string())?;
    Ok(result.rows_affected() == 1)
}

async fn update_cloud_request_state(
    repository: &SqliteProjectRepository,
    project_id: &str,
    asset_id: &str,
    provider: &str,
    model: &str,
    state: &str,
    error: Option<&str>,
    increment_attempt: bool,
) -> Result<(), String> {
    sqlx::query(
        r#"
        UPDATE cloud_requests
        SET state = ?, last_error = ?, updated_at = ?,
            attempt_count = attempt_count + ?
        WHERE project_id = ? AND asset_id = ? AND provider = ? AND model = ?
        "#,
    )
    .bind(state)
    .bind(error)
    .bind(timestamp())
    .bind(if increment_attempt { 1_i64 } else { 0_i64 })
    .bind(project_id)
    .bind(asset_id)
    .bind(provider)
    .bind(model)
    .execute(repository.pool())
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct WorkerResponse {
    id: Option<String>,
    ok: Option<bool>,
    result: Option<Value>,
    error: Option<String>,
}

struct PolicyWorker {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
}

impl PolicyWorker {
    async fn start(python: &FilePath) -> Result<Self, String> {
        let mut child = Command::new(python)
            .args(["-m", "framescout_ai.worker", "--policy-only", "serve"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("could not start policy worker: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or("policy worker stdin is unavailable")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("policy worker stdout is unavailable")?;
        let mut lines = BufReader::new(stdout).lines();
        let ready = lines
            .next_line()
            .await
            .map_err(|error| error.to_string())?
            .ok_or("policy worker exited before ready")?;
        let ready_payload: Value =
            serde_json::from_str(&ready).map_err(|error| error.to_string())?;
        if ready_payload.pointer("/capabilities/policyOnly") != Some(&Value::Bool(true)) {
            return Err("Python worker did not start in policy-only mode".to_string());
        }
        Ok(Self {
            child,
            stdin,
            lines,
        })
    }

    async fn evaluate(
        &mut self,
        request_id: &str,
        preset: &str,
        signals: Value,
    ) -> Result<Value, String> {
        let request = policy_evaluation_request(request_id, preset, signals);
        self.stdin
            .write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        self.stdin
            .flush()
            .await
            .map_err(|error| error.to_string())?;
        let line = self
            .lines
            .next_line()
            .await
            .map_err(|error| error.to_string())?
            .ok_or("policy worker exited during evaluation")?;
        let response: WorkerResponse =
            serde_json::from_str(&line).map_err(|error| error.to_string())?;
        if response.id.as_deref() != Some(request_id) {
            return Err("policy worker response id mismatch".to_string());
        }
        if response.ok != Some(true) {
            return Err(format!(
                "policy worker evaluation failed: {}",
                response.error.as_deref().unwrap_or("unknown policy error")
            ));
        }
        response
            .result
            .ok_or("policy worker result missing".to_string())
    }

    async fn shutdown(mut self) {
        drop(self.stdin);
        let _ = self.child.wait().await;
    }
}

#[derive(Clone, Debug)]
struct ActiveAnalysisProfile {
    id: String,
    provider: String,
    model: String,
    backend: String,
    model_path: Option<PathBuf>,
    endpoint: Option<String>,
    api_key: Option<String>,
    cloud_budget_cents: u64,
    cloud_concurrency: u8,
    estimated_cents_per_asset: u64,
    execution_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportSettingsPayload {
    destination_dir: String,
    selection_scope: String,
    included_folder_groups: Vec<String>,
    included_tags: Vec<String>,
    excluded_tags: Vec<String>,
    filter_match: String,
    media: String,
    raw_layout: String,
    preserve_folder_structure: bool,
    include_xmp: bool,
    include_csv: bool,
    collision: String,
}

#[derive(Clone, Debug)]
struct ExportCopyPlan {
    asset_id: String,
    source_path: PathBuf,
    destination_path: PathBuf,
    kind: &'static str,
}

#[derive(Clone, Debug)]
struct ExportSidecarPlan {
    destination_path: PathBuf,
    rating: u8,
    color_label: &'static str,
    keywords: Vec<String>,
}

#[derive(Clone, Debug)]
struct ExportPlan {
    settings: ExportSettingsPayload,
    copies: Vec<ExportCopyPlan>,
    sidecars: Vec<ExportSidecarPlan>,
    skipped: Vec<Value>,
    metadata_records: Vec<Value>,
    csv_preview: String,
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .compact()
        .init();

    let bind = std::env::var("FRAMESCOUT_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    let address: SocketAddr = bind.parse()?;
    let public_base_url = format!("http://{address}");
    let database_path = database_path();
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let repository = SqliteProjectRepository::connect_file(&database_path).await?;
    repository.migrate().await?;
    info!(path = %database_path.display(), "project database connected");
    let cache_dir = database_path
        .parent()
        .unwrap_or_else(|| FilePath::new("."))
        .join("proxy-cache");
    std::fs::create_dir_all(&cache_dir)?;
    let state = AppState {
        repository: Some(repository),
        media: Arc::new(RwLock::new(HashMap::new())),
        cache_dir,
        ingest_jobs: Arc::new(Mutex::new(HashSet::new())),
        running_analysis: Arc::new(Mutex::new(HashSet::new())),
        running_metadata: Arc::new(Mutex::new(HashSet::new())),
        preview_requests: Arc::new(Semaphore::new(2)),
        ai: ai_config(),
        analysis_profile: Arc::new(RwLock::new(load_analysis_profile())),
        cloud_requests: Arc::new(Semaphore::new(usize::from(MAX_CLOUD_CONCURRENCY))),
        public_base_url,
        trusted_web_origin: std::env::var("FRAMESCOUT_WEB_ORIGIN").ok(),
    };
    resume_pending_proxy_generation(&state);
    // Browser callers are restricted to the FrameScout localhost UI. Requests
    // without Origin remain available to the local terminal and test harness.
    let cors_origin = state.trusted_web_origin.clone();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            is_trusted_browser_origin(origin.to_str().ok(), cors_origin.as_deref())
        }))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([axum::http::header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/commands/{command}", post(command))
        .route("/api/media/{asset_id}", get(media))
        .layer(DefaultBodyLimit::max(MAX_COMMAND_BYTES))
        .layer(cors)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .with_state(state.clone());

    info!(%address, workers = 2, request_limit_kib = MAX_COMMAND_BYTES / 1024, "FrameScout local service ready");
    info!(python = %state.ai.python.display(), quality_model = %state.ai.quality_model.display(), fast_model = %state.ai.fast_model.display(), "AI worker configured");
    info!("Web UI: run `npm run dev` with VITE_FRAMESCOUT_API_URL=http://127.0.0.1:4310");

    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    info!("FrameScout local service stopped");
    Ok(())
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ready",
        "transport": "localhost-http",
        "version": env!("CARGO_PKG_VERSION"),
        "workerThreads": 2,
        "sourcePhotosMutable": false
    }))
}

async fn command(
    State(state): State<AppState>,
    Path(command): Path<String>,
    headers: HeaderMap,
    Json(arguments): Json<Value>,
) -> impl IntoResponse {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if !is_trusted_browser_origin(origin, state.trusted_web_origin.as_deref()) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "untrusted_browser_origin",
                "message": "FrameScout commands are only available to the local Web UI"
            })),
        );
    }
    info!(%command, "command received");
    match command.as_str() {
        "project_choose_folder" => match choose_folder().await {
            Ok(path) => (StatusCode::OK, Json(json!({ "path": path }))),
            Err(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "folder_picker_failed", "message": error })),
            ),
        },
        "project_create" => match create_project(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "project_create_invalid", "message": error })),
            ),
        },
        "project_load_active" => match load_active_project(&state).await {
            Ok(project) => (StatusCode::OK, Json(json!({ "project": project }))),
            Err(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "project_load_failed", "message": error })),
            ),
        },
        "project_index_status" => match project_index_status(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "project_index_status_failed", "message": error })),
            ),
        },
        "analysis_config_get" => (StatusCode::OK, Json(analysis_config_payload(&state).await)),
        "analysis_config_set" => match set_analysis_config(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "analysis_config_invalid", "message": error })),
            ),
        },
        "analysis_enqueue" => match enqueue_analysis(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "analysis_enqueue_failed", "message": error })),
            ),
        },
        "analysis_status" => match analysis_status(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "analysis_status_failed", "message": error })),
            ),
        },
        "decision_set" => match decision_set_batch(
            &state,
            &json!({
                "projectId": arguments.get("projectId"),
                "input": { "changes": [arguments.get("input").cloned().unwrap_or(Value::Null)] }
            }),
        )
        .await
        {
            Ok(payload) => {
                let event = payload["events"]
                    .as_array()
                    .and_then(|events| events.first())
                    .cloned()
                    .unwrap_or(Value::Null);
                (
                    StatusCode::OK,
                    Json(json!({ "event": event, "project": payload["project"] })),
                )
            }
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "decision_set_failed", "message": error })),
            ),
        },
        "decision_set_batch" => match decision_set_batch(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "decision_set_batch_failed", "message": error })),
            ),
        },
        "tag_apply" => match tag_apply_batch(
            &state,
            &json!({
                "projectId": arguments.get("projectId"),
                "input": { "mutations": [arguments.get("input").cloned().unwrap_or(Value::Null)] }
            }),
        )
        .await
        {
            Ok(payload) => {
                let event = payload["events"]
                    .as_array()
                    .and_then(|events| events.first())
                    .cloned()
                    .unwrap_or(Value::Null);
                (
                    StatusCode::OK,
                    Json(json!({ "event": event, "project": payload["project"] })),
                )
            }
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "tag_apply_failed", "message": error })),
            ),
        },
        "tag_apply_batch" => match tag_apply_batch(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "tag_apply_batch_failed", "message": error })),
            ),
        },
        "selection_goal_set" => match set_selection_goal(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "selection_goal_invalid", "message": error })),
            ),
        },
        "metadata_refresh" => match refresh_metadata(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "metadata_refresh_invalid", "message": error })),
            ),
        },
        "export_preview" => match export_preview(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "export_preview_invalid", "message": error })),
            ),
        },
        "export_commit" => match export_commit(&state, &arguments).await {
            Ok(payload) => (StatusCode::OK, Json(payload)),
            Err(error) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "export_commit_invalid", "message": error })),
            ),
        },
        _ => (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({
                "error": "command_not_migrated",
                "command": command,
                "message": "This command still belongs to the Tauri backend and has not moved to the localhost service yet."
            })),
        ),
    }
}

async fn decision_set_batch(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let project_id = arguments
        .get("projectId")
        .and_then(Value::as_str)
        .ok_or("projectId is required")?;
    let changes = arguments
        .pointer("/input/changes")
        .and_then(Value::as_array)
        .ok_or("changes are required")?;
    if changes.is_empty() || changes.len() > 500 {
        return Err("decision batch must contain between 1 and 500 changes".to_string());
    }
    let mut events = Vec::with_capacity(changes.len());
    for change in changes {
        let asset_id = change
            .get("assetId")
            .and_then(Value::as_str)
            .ok_or("assetId is required")?;
        let revision = change
            .get("assetRevision")
            .and_then(Value::as_i64)
            .ok_or("assetRevision is required")?;
        let disposition = change
            .get("humanDisposition")
            .and_then(Value::as_str)
            .and_then(framescout_storage::HumanDisposition::parse)
            .filter(|value| !matches!(value, framescout_storage::HumanDisposition::Unseen))
            .ok_or("humanDisposition is invalid")?;
        let event = repository
            .set_human_decision(project_id, asset_id, disposition, revision)
            .await
            .map_err(|error| error.to_string())?;
        events.push(json!({
            "assetId": event.asset_id,
            "previousHumanDisposition": event.previous_human_disposition.as_str(),
            "humanDisposition": event.human_disposition.as_str(),
            "revision": event.revision,
            "changedAt": event.changed_at,
            "actor": "human"
        }));
    }
    let project = load_active_project(state)
        .await?
        .ok_or("active project is unavailable")?;
    if project["id"] != project_id {
        return Err("active project changed while saving decisions".to_string());
    }
    Ok(json!({ "events": events, "project": project }))
}

async fn tag_apply_batch(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let project_id = arguments
        .get("projectId")
        .and_then(Value::as_str)
        .ok_or("projectId is required")?;
    let mutations = arguments
        .pointer("/input/mutations")
        .and_then(Value::as_array)
        .ok_or("mutations are required")?;
    if mutations.is_empty() || mutations.len() > 100 {
        return Err("tag batch must contain between 1 and 100 mutations".to_string());
    }
    let mut events = Vec::with_capacity(mutations.len());
    for mutation in mutations {
        let asset_ids = mutation
            .get("assetIds")
            .and_then(Value::as_array)
            .ok_or("assetIds are required")?;
        if asset_ids.is_empty() || asset_ids.len() > 2_000 {
            return Err("each tag mutation must contain between 1 and 2000 assets".to_string());
        }
        let asset_ids = asset_ids
            .iter()
            .map(|id| {
                id.as_str()
                    .map(str::to_string)
                    .ok_or("asset id must be a string")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let tag = mutation
            .get("tag")
            .and_then(Value::as_str)
            .ok_or("tag is required")?;
        let normalized = normalize_service_tag(tag)?;
        let operation = mutation
            .get("mutation")
            .and_then(Value::as_str)
            .ok_or("mutation is required")?;
        let event = repository
            .apply_tag(project_id, &asset_ids, &normalized, operation)
            .await
            .map_err(|error| error.to_string())?;
        events.push(json!({
            "assetIds": event.asset_ids,
            "tag": event.tag,
            "mutation": event.mutation,
            "changedAt": event.changed_at,
            "actor": "human"
        }));
    }
    let project = load_active_project(state)
        .await?
        .ok_or("active project is unavailable")?;
    if project["id"] != project_id {
        return Err("active project changed while saving tags".to_string());
    }
    Ok(json!({ "events": events, "project": project }))
}

fn normalize_service_tag(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    if normalized.is_empty() {
        return Err("tag must not be empty".to_string());
    }
    Ok(if normalized.contains(':') {
        normalized
    } else {
        format!("manual:{normalized}")
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebProjectCreateInput {
    name: String,
    roots: Vec<String>,
    raw_roots: Option<Vec<String>>,
    preset: String,
    settings: Option<WebProjectSettings>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebProjectSettings {
    keep_originals_untouched: bool,
    cache_limit_mb: Option<u64>,
    selection_target_count: Option<u64>,
}

async fn choose_folder() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("Choose a FrameScout source folder")
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn create_project(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let input: WebProjectCreateInput = serde_json::from_value(
        arguments
            .get("input")
            .cloned()
            .ok_or("project.create needs input")?,
    )
    .map_err(|error| error.to_string())?;
    if input.name.trim().is_empty() || input.roots.is_empty() {
        return Err("project name and at least one folder are required".to_string());
    }
    if input
        .settings
        .as_ref()
        .is_some_and(|settings| !settings.keep_originals_untouched)
    {
        return Err("FrameScout never modifies source photos during import".to_string());
    }
    let preset = ProjectPreset::parse(&input.preset)
        .ok_or_else(|| format!("unsupported project preset: {}", input.preset))?;
    let roots = input
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
    let project_id = Uuid::new_v4().to_string();
    let settings = input.settings.as_ref();
    let project = NewProject {
        id: project_id.clone(),
        name: input.name.trim().to_string(),
        preset,
        source_roots: roots.clone(),
        settings_json: json!({
            "keepOriginalsUntouched": true,
            "cacheLimitMb": settings.and_then(|value| value.cache_limit_mb).unwrap_or(DEFAULT_PROXY_CACHE_LIMIT_MB),
            "selectionTargetCount": settings.and_then(|value| value.selection_target_count).unwrap_or(50).clamp(1, 100_000),
            "rawRoots": raw_roots,
        }),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        indexing_state: "indexing".to_string(),
        assets: Vec::new(),
    };
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?
        .clone();
    let stored = repository
        .create_project(project)
        .await
        .map_err(|error| error.to_string())?;
    start_web_ingestion(
        repository,
        state.cache_dir.clone(),
        state.ingest_jobs.clone(),
        project_id.clone(),
        roots,
        stored.settings_json["cacheLimitMb"]
            .as_u64()
            .unwrap_or(DEFAULT_PROXY_CACHE_LIMIT_MB)
            .saturating_mul(1024 * 1024),
    );
    Ok(json!({ "project": {
        "id": stored.id, "name": stored.name, "preset": stored.preset,
        "sourceFolder": stored.source_roots_json.as_array().and_then(|roots| roots.first()).and_then(Value::as_str).unwrap_or_default(),
        "coverUrl": placeholder_preview(), "reviewed": 0, "selected": 0, "aiRejects": 0, "total": 0, "lastOpened": stored.updated_at
    }}))
}

fn canonical_directory(root: &str) -> Result<String, String> {
    let path = FilePath::new(root);
    if !path.is_absolute() {
        return Err("the selected folder must be an absolute path".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("the selected path is not a folder".to_string());
    }
    Ok(canonical.to_string_lossy().to_string())
}

fn start_web_ingestion(
    repository: SqliteProjectRepository,
    cache_dir: PathBuf,
    ingest_jobs: Arc<Mutex<HashSet<String>>>,
    project_id: String,
    roots: Vec<String>,
    cache_limit_bytes: u64,
) {
    let project_id_for_job = project_id.clone();
    tokio::spawn(async move {
        if !ingest_jobs.lock().await.insert(project_id_for_job.clone()) {
            return;
        }
        let task_repository = repository.clone();
        let task_cache_dir = cache_dir.clone();
        let completed_id = project_id_for_job.clone();
        let runtime = tokio::runtime::Handle::current();
        let result = tokio::task::spawn_blocking(move || {
            run_web_ingestion(
                &task_repository,
                &task_cache_dir,
                &completed_id,
                &roots,
                cache_limit_bytes,
                &runtime,
            )
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
        let state = if result.is_ok() { "complete" } else { "failed" };
        if let Err(error) = repository
            .set_project_indexing_state(&project_id_for_job, state)
            .await
        {
            tracing::error!(%project_id_for_job, %error, "unable to update indexing state");
        }
        ingest_jobs.lock().await.remove(&project_id_for_job);
    });
}

fn run_web_ingestion(
    repository: &SqliteProjectRepository,
    cache_dir: &FilePath,
    project_id: &str,
    roots: &[String],
    cache_limit_bytes: u64,
    runtime: &tokio::runtime::Handle,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::sync_channel::<(String, String)>(THUMBNAIL_QUEUE_CAPACITY);
    let cache_repository = repository.clone();
    let cache_project_id = project_id.to_string();
    let cache_root = cache_dir.to_path_buf();
    let cache_runtime = runtime.clone();
    let cache_worker = thread::spawn(move || {
        for (asset_id, source_path) in receiver {
            let (thumbnail, display) = generate_proxy_caches(
                FilePath::new(&source_path),
                &cache_root,
                &cache_project_id,
                &asset_id,
            );
            let _ = cache_runtime.block_on(cache_repository.update_asset_cache(
                &cache_project_id,
                &asset_id,
                thumbnail.as_deref(),
                display.as_deref(),
                if thumbnail.is_some() {
                    "ready"
                } else {
                    "failed"
                },
            ));
        }
    });
    let mut batch = Vec::with_capacity(INGEST_BATCH_SIZE);
    let import_limit = std::env::var("FRAMESCOUT_IMPORT_LIMIT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok());
    let mut indexed = 0usize;
    for root in roots {
        walk_supported_files(FilePath::new(root), &mut |path| {
            if import_limit.is_some_and(|limit| indexed >= limit) {
                return Ok(());
            }
            let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or_default();
            let source_path = path.to_string_lossy().to_string();
            let asset_id = Uuid::new_v4().to_string();
            batch.push(NewAsset {
                id: asset_id.clone(),
                source_path: source_path.clone(),
                file_fingerprint: format!("{source_path}::{}::{modified}", metadata.len()),
                preview_state: "pending".to_string(),
                exif_json: json!({ "nativeScan": true }),
                thumbnail_cache_path: None,
                display_cache_path: None,
                mapped_master_path: None,
                mapping_status: "proxy_only".to_string(),
                mapping_method: "none".to_string(),
                mapping_confidence: "unresolved".to_string(),
            });
            indexed += 1;
            if batch.len() >= INGEST_BATCH_SIZE {
                persist_ingest_batch(repository, project_id, &mut batch, &sender, runtime)?;
            }
            Ok(())
        })?;
    }
    persist_ingest_batch(repository, project_id, &mut batch, &sender, runtime)?;
    drop(sender);
    cache_worker
        .join()
        .map_err(|_| "proxy cache worker stopped unexpectedly".to_string())?;
    enforce_cache_limit(cache_dir, cache_limit_bytes);
    Ok(())
}

fn resume_pending_proxy_generation(state: &AppState) {
    let Some(repository) = state.repository.clone() else {
        return;
    };
    let cache_dir = state.cache_dir.clone();
    let ingest_jobs = state.ingest_jobs.clone();
    tokio::spawn(async move {
        let Ok(Some(project)) = repository.load_most_recent_project().await else {
            return;
        };
        let Ok(assets) = repository.list_assets(&project.id).await else {
            return;
        };
        let pending = assets
            .into_iter()
            .filter(|asset| {
                (asset.preview_state == "pending"
                    || asset
                        .thumbnail_cache_path
                        .as_ref()
                        .map(|path| !FilePath::new(path).is_file())
                        .unwrap_or(true))
                    && !is_resource_fork_path(FilePath::new(&asset.source_path))
                    && is_indexable_proxy(FilePath::new(&asset.source_path))
            })
            .map(|asset| (asset.id, asset.source_path))
            .collect::<Vec<_>>();
        if pending.is_empty() {
            return;
        }
        start_pending_proxy_job(
            repository,
            cache_dir,
            ingest_jobs,
            project.id,
            pending,
            project.settings_json["cacheLimitMb"]
                .as_u64()
                .unwrap_or(DEFAULT_PROXY_CACHE_LIMIT_MB)
                .saturating_mul(1024 * 1024),
        );
    });
}

fn start_pending_proxy_job(
    repository: SqliteProjectRepository,
    cache_dir: PathBuf,
    ingest_jobs: Arc<Mutex<HashSet<String>>>,
    project_id: String,
    pending: Vec<(String, String)>,
    cache_limit_bytes: u64,
) {
    let project_id_for_job = project_id.clone();
    tokio::spawn(async move {
        if !ingest_jobs.lock().await.insert(project_id_for_job.clone()) {
            return;
        }
        let task_repository = repository.clone();
        let task_cache_dir = cache_dir.clone();
        let completed_id = project_id_for_job.clone();
        let runtime = tokio::runtime::Handle::current();
        let result = tokio::task::spawn_blocking(move || {
            run_pending_proxy_generation(
                &task_repository,
                &task_cache_dir,
                &completed_id,
                pending,
                cache_limit_bytes,
                &runtime,
            )
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
        let state = if result.is_ok() { "complete" } else { "failed" };
        if let Err(error) = repository
            .set_project_indexing_state(&project_id_for_job, state)
            .await
        {
            tracing::error!(%project_id_for_job, %error, "unable to update resumed indexing state");
        }
        ingest_jobs.lock().await.remove(&project_id_for_job);
    });
}

fn run_pending_proxy_generation(
    repository: &SqliteProjectRepository,
    cache_dir: &FilePath,
    project_id: &str,
    pending: Vec<(String, String)>,
    cache_limit_bytes: u64,
    runtime: &tokio::runtime::Handle,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::sync_channel::<(String, String)>(THUMBNAIL_QUEUE_CAPACITY);
    let cache_repository = repository.clone();
    let cache_project_id = project_id.to_string();
    let cache_root = cache_dir.to_path_buf();
    let cache_runtime = runtime.clone();
    let cache_worker = thread::spawn(move || {
        for (asset_id, source_path) in receiver {
            let (thumbnail, display) = generate_proxy_caches(
                FilePath::new(&source_path),
                &cache_root,
                &cache_project_id,
                &asset_id,
            );
            let _ = cache_runtime.block_on(cache_repository.update_asset_cache(
                &cache_project_id,
                &asset_id,
                thumbnail.as_deref(),
                display.as_deref(),
                if thumbnail.is_some() {
                    "ready"
                } else {
                    "failed"
                },
            ));
        }
    });
    for asset in pending {
        sender
            .send(asset)
            .map_err(|_| "proxy cache worker stopped".to_string())?;
    }
    drop(sender);
    cache_worker
        .join()
        .map_err(|_| "proxy cache worker stopped unexpectedly".to_string())?;
    enforce_cache_limit(cache_dir, cache_limit_bytes);
    Ok(())
}

fn persist_ingest_batch(
    repository: &SqliteProjectRepository,
    project_id: &str,
    batch: &mut Vec<NewAsset>,
    sender: &mpsc::SyncSender<(String, String)>,
    runtime: &tokio::runtime::Handle,
) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }
    runtime
        .block_on(repository.append_assets(project_id, batch))
        .map_err(|error| error.to_string())?;
    for asset in batch.iter() {
        sender
            .send((asset.id.clone(), asset.source_path.clone()))
            .map_err(|_| "thumbnail worker stopped".to_string())?;
    }
    batch.clear();
    Ok(())
}

fn walk_supported_files(
    root: &FilePath,
    visit: &mut impl FnMut(PathBuf) -> Result<(), String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk_supported_files(&entry.path(), visit)?;
        } else if file_type.is_file() && is_indexable_proxy(&entry.path()) {
            visit(entry.path())?;
        }
    }
    Ok(())
}

fn is_supported_proxy(path: &FilePath) -> bool {
    !is_resource_fork_path(path)
        && matches!(
            path.extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("jpg" | "jpeg" | "png" | "webp" | "tif" | "tiff")
        )
}

fn is_indexable_proxy(path: &FilePath) -> bool {
    is_supported_proxy(path) && path.metadata().is_ok_and(|metadata| metadata.len() > 0)
}

fn is_resource_fork_path(path: &FilePath) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("._"))
}

fn generate_proxy_caches(
    source: &FilePath,
    cache_dir: &FilePath,
    project_id: &str,
    asset_id: &str,
) -> (Option<String>, Option<String>) {
    let directory = cache_dir.join(project_id).join(asset_id);
    if std::fs::create_dir_all(&directory).is_err() {
        return (None, None);
    }
    let display_path = directory.join("display.jpg");
    let thumbnail_path = directory.join("thumbnail.jpg");
    let display_edge = DISPLAY_MAX_EDGE.to_string();
    let vips_result = std::process::Command::new("vips.exe")
        .args([
            "thumbnail",
            &source.to_string_lossy(),
            &display_path.to_string_lossy(),
            &display_edge,
            "--size",
            "down",
        ])
        .status();
    if matches!(vips_result, Ok(status) if status.success()) {
        let thumbnail_edge = THUMBNAIL_MAX_EDGE.to_string();
        let thumbnail_result = std::process::Command::new("vips.exe")
            .args([
                "thumbnail",
                &display_path.to_string_lossy(),
                &thumbnail_path.to_string_lossy(),
                &thumbnail_edge,
                "--size",
                "down",
            ])
            .status();
        if matches!(thumbnail_result, Ok(status) if status.success()) {
            return (
                Some(thumbnail_path.to_string_lossy().to_string()),
                Some(display_path.to_string_lossy().to_string()),
            );
        }
    }
    // Portable fallback: only one worker reaches this full-resolution decode at a time.
    if let Ok(image) = image::open(source) {
        let display = image.thumbnail(DISPLAY_MAX_EDGE, DISPLAY_MAX_EDGE);
        if display
            .save_with_format(&display_path, image::ImageFormat::Jpeg)
            .is_ok()
            && display
                .thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)
                .save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
                .is_ok()
        {
            return (
                Some(thumbnail_path.to_string_lossy().to_string()),
                Some(display_path.to_string_lossy().to_string()),
            );
        }
    }
    (None, None)
}

fn enforce_cache_limit(cache_dir: &FilePath, limit_bytes: u64) {
    let mut files = Vec::new();
    collect_cache_files(cache_dir, &mut files);
    let mut total = files.iter().map(|(_, bytes, _)| *bytes).sum::<u64>();
    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, bytes, _) in files {
        if total <= limit_bytes {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            total = total.saturating_sub(bytes);
        }
    }
}

fn collect_cache_files(root: &FilePath, files: &mut Vec<(PathBuf, u64, std::time::SystemTime)>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_cache_files(&path, files);
        } else if let Ok(metadata) = entry.metadata() {
            files.push((
                path,
                metadata.len(),
                metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
            ));
        }
    }
}

async fn load_active_project(state: &AppState) -> Result<Option<Value>, String> {
    let Some(repository) = &state.repository else {
        return Ok(None);
    };
    let Some(project) = repository
        .load_most_recent_project()
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let assets = repository
        .list_assets(&project.id)
        .await
        .map_err(|error| error.to_string())?;
    let decision_events = repository
        .list_decision_events(&project.id)
        .await
        .map_err(|error| error.to_string())?;
    let tags = repository
        .list_tags(&project.id)
        .await
        .map_err(|error| error.to_string())?;
    let tag_events = repository
        .list_tag_events(&project.id)
        .await
        .map_err(|error| error.to_string())?;
    let analysis_runs = project_analysis_runs(repository, &project.id).await?;
    let evidence_rows = sqlx::query(
        r#"
        SELECT signals.asset_id, signals.evidence_json
        FROM signals
        WHERE signals.run_id = (
          SELECT id FROM analysis_runs
          WHERE project_id = ?
          ORDER BY started_at DESC
          LIMIT 1
        )
        AND signals.kind LIKE 'evidence.%'
        ORDER BY signals.created_at, signals.kind
        "#,
    )
    .bind(&project.id)
    .fetch_all(repository.pool())
    .await
    .map_err(|error| error.to_string())?;
    let mut evidence_by_asset: HashMap<String, Vec<Value>> = HashMap::new();
    for row in evidence_rows {
        let asset_id: String = row.get("asset_id");
        let evidence_json: String = row.get("evidence_json");
        if let Ok(evidence) = serde_json::from_str(&evidence_json) {
            evidence_by_asset
                .entry(asset_id)
                .or_default()
                .push(evidence);
        }
    }
    let mut tags_by_asset: HashMap<String, Vec<String>> = HashMap::new();
    for tag in tags {
        tags_by_asset.entry(tag.asset_id).or_default().push(tag.tag);
    }
    let mut media_paths = HashMap::new();
    let projected_assets = assets
        .into_iter()
        // Older imports could include macOS resource-fork sidecars. They are not photos.
        .filter(|asset| is_indexable_proxy(FilePath::new(&asset.source_path)))
        .map(|asset| {
            let metadata = &asset.exif_json;
            let file_name = FilePath::new(&asset.source_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&asset.source_path);
            let thumbnail_path = asset
                .thumbnail_cache_path
                .as_ref()
                .filter(|path| FilePath::new(path).is_file())
                .cloned();
            let display_path = asset
                .display_cache_path
                .as_ref()
                .filter(|path| FilePath::new(path).is_file())
                .cloned();
            let source_can_generate = {
                let source = FilePath::new(&asset.source_path);
                source.is_file() && is_indexable_proxy(source)
            };
            let has_cached_media = thumbnail_path.is_some();
            if let Some(path) = thumbnail_path {
                media_paths.insert(
                    asset.id.clone(),
                    CachedMedia {
                        thumbnail: PathBuf::from(path),
                        display: display_path.map(PathBuf::from),
                    },
                );
            }
            let preview_url = if has_cached_media || source_can_generate {
                format!("{}/api/media/{}", state.public_base_url, asset.id)
            } else {
                placeholder_preview().to_string()
            };
            let display_url = if has_cached_media || source_can_generate {
                format!(
                    "{}/api/media/{}?variant=display",
                    state.public_base_url, asset.id
                )
            } else {
                preview_url.clone()
            };
            json!({
                "id": asset.id,
                "fileName": file_name,
                "sourcePath": asset.source_path,
                "fileFingerprint": asset.file_fingerprint,
                "mappedMasterPath": asset.mapped_master_path,
                "mappingStatus": asset.mapping_status,
                "mappingMethod": asset.mapping_method,
                "mappingConfidence": asset.mapping_confidence,
                "thumbnailCachePath": asset.thumbnail_cache_path,
                "displayCachePath": asset.display_cache_path,
                "previewState": asset.preview_state,
                "decisionRevision": asset.revision,
                "missingState": asset.missing_state,
                "captureTime": metadata["captureTime"].as_str().unwrap_or("Metadata not read"),
                "camera": metadata["camera"].as_str().unwrap_or("Metadata not read"),
                "lens": metadata["lens"].as_str().unwrap_or("Metadata not read"),
                "exposure": metadata["exposure"].as_str().unwrap_or("Metadata not read"),
                "iso": metadata["iso"].as_u64().unwrap_or(0),
                "previewUrl": preview_url,
                "displayUrl": display_url,
                "aiDisposition": asset.ai_disposition,
                "humanDisposition": asset.human_disposition.as_str(),
                "reasons": asset.reasons_json,
                "tags": tags_by_asset.remove(&asset.id).unwrap_or_default(),
                "evidence": evidence_by_asset.remove(&asset.id).unwrap_or_default()
            })
        })
        .collect::<Vec<_>>();
    *state.media.write().await = media_paths;
    let source_folder = project
        .source_roots_json
        .as_array()
        .and_then(|roots| roots.first())
        .and_then(Value::as_str)
        .unwrap_or_default();
    info!(project_id = %project.id, assets = projected_assets.len(), indexing_state = %project.indexing_state, "active project projected");
    let target_count = project
        .settings_json
        .get("selectionTargetCount")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 100_000);
    Ok(Some(json!({
        "id": project.id,
        "name": project.name,
        "preset": project.preset,
        "sourceFolder": source_folder,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
        "indexingState": project.indexing_state,
        "assets": projected_assets,
        "analysisRuns": analysis_runs,
        "decisionRevision": decision_events.len(),
        "snapshotRevision": project.snapshot_revision,
        "decisionEvents": decision_events.into_iter().map(|event| json!({
            "assetId": event.asset_id,
            "previousHumanDisposition": event.previous_human_disposition.as_str(),
            "humanDisposition": event.human_disposition.as_str(),
            "revision": event.revision,
            "changedAt": event.changed_at,
            "actor": "human"
        })).collect::<Vec<_>>(),
        "tagEvents": tag_events.into_iter().map(|event| json!({
            "assetIds": event.asset_ids, "tag": event.tag, "mutation": event.mutation,
            "changedAt": event.changed_at, "actor": "human"
        })).collect::<Vec<_>>(),
        "selectionGoal": {
            "targetCount": target_count,
            "mode": "exact",
            "diversity": "burst-aware",
            "preserveHumanDecisions": true
        }
    })))
}

async fn set_selection_goal(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let project_id = arguments["projectId"]
        .as_str()
        .ok_or("selection goal needs a project id")?;
    let target_count = arguments["input"]["targetCount"]
        .as_u64()
        .ok_or("selection target must be a whole number")?;
    if !(1..=100_000).contains(&target_count) {
        return Err("selection target must be between 1 and 100000".to_string());
    }
    repository
        .set_selection_target(project_id, target_count)
        .await
        .map_err(|error| error.to_string())?;
    let project = load_active_project(state)
        .await?
        .ok_or("updated project could not be loaded")?;
    Ok(json!({ "project": project }))
}

async fn refresh_metadata(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let project_id = arguments["projectId"]
        .as_str()
        .ok_or("metadata refresh needs a project id")?
        .to_string();
    if repository
        .load_project(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Err("project does not exist".to_string());
    }
    let mut running = state.running_metadata.lock().await;
    let started = running.insert(project_id.clone());
    drop(running);
    if started {
        let repository = repository.clone();
        let running = state.running_metadata.clone();
        tokio::spawn(async move {
            let assets = match repository.list_assets(&project_id).await {
                Ok(assets) => assets,
                Err(error) => {
                    tracing::error!(%project_id, %error, "metadata refresh could not list assets");
                    running.lock().await.remove(&project_id);
                    return;
                }
            };
            let total = assets.len();
            let mut refreshed = 0usize;
            for asset in assets {
                let asset_id = asset.id;
                let source_paths = vec![asset.mapped_master_path, Some(asset.source_path)];
                let parsed =
                    tokio::task::spawn_blocking(move || read_camera_metadata(&source_paths))
                        .await
                        .ok()
                        .flatten();
                if let Some((capture_at, metadata)) = parsed {
                    if repository
                        .update_asset_metadata(
                            &project_id,
                            &asset_id,
                            capture_at.as_deref(),
                            &metadata,
                        )
                        .await
                        .is_ok()
                    {
                        refreshed += 1;
                    }
                }
                if refreshed == 1 || refreshed % 100 == 0 || refreshed == total {
                    info!(%project_id, refreshed, total, "camera metadata refresh progress");
                }
            }
            info!(%project_id, refreshed, total, "camera metadata refresh completed");
            running.lock().await.remove(&project_id);
        });
    }
    let project = load_active_project(state)
        .await?
        .ok_or("project could not be loaded")?;
    Ok(json!({ "project": project, "started": started }))
}

fn read_camera_metadata(paths: &[Option<String>]) -> Option<(Option<String>, Value)> {
    for candidate in paths.iter().flatten() {
        let path = FilePath::new(candidate);
        let Ok(file) = std::fs::File::open(path) else {
            continue;
        };
        let mut reader = StdBufReader::new(file);
        let Ok(exif) = ExifReader::new().read_from_container(&mut reader) else {
            continue;
        };
        let value = |tag| {
            exif.get_field(tag, In::PRIMARY)
                .map(|field| field.display_value().with_unit(&exif).to_string())
        };
        let Some(camera) = value(ExifTag::Model) else {
            continue;
        };
        let lens = value(ExifTag::LensModel).unwrap_or_else(|| "Lens unavailable".to_string());
        let capture_at = value(ExifTag::DateTimeOriginal).or_else(|| value(ExifTag::DateTime));
        let exposure_time = value(ExifTag::ExposureTime).unwrap_or_default();
        let aperture = value(ExifTag::FNumber).unwrap_or_default();
        let iso_text = value(ExifTag::PhotographicSensitivity).unwrap_or_default();
        let iso = iso_text
            .split(|character: char| !character.is_ascii_digit())
            .find(|part| !part.is_empty())
            .and_then(|part| part.parse::<u64>().ok())
            .unwrap_or(0);
        let exposure = [
            exposure_time,
            aperture,
            (iso > 0).then(|| format!("ISO {iso}")).unwrap_or_default(),
        ]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
        return Some((
            capture_at.clone(),
            json!({
                "camera": camera,
                "lens": lens,
                "captureTime": capture_at.unwrap_or_else(|| "Capture time unavailable".to_string()),
                "exposure": if exposure.is_empty() { "Exposure unavailable".to_string() } else { exposure },
                "iso": iso,
                "metadataSource": path.to_string_lossy()
            }),
        ));
    }
    None
}

async fn export_preview(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let project_id = command_project_id(arguments, "export.preview")?;
    let plan = build_export_plan(state, &project_id, export_settings(arguments)?).await?;
    Ok(export_preview_payload(&project_id, &plan))
}

async fn export_commit(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let project_id = command_project_id(arguments, "export.commit")?;
    if arguments["input"]["explicitConfirmation"] != Value::Bool(true) {
        return Err("export.commit requires explicit confirmation".to_string());
    }
    let plan = build_export_plan(state, &project_id, export_settings(arguments)?).await?;
    if plan.settings.destination_dir.trim().is_empty() {
        return Err("choose an absolute destination folder before exporting".to_string());
    }
    if arguments["input"]["dryRun"] == Value::Bool(true) {
        return Ok(json!({
            "projectId": project_id,
            "committed": false,
            "reason": "dry-run",
            "originalFilesModified": 0,
            "xmpFilesWritten": 0,
            "filesCopied": 0,
            "rawFilesCopied": 0,
            "destinationDir": plan.settings.destination_dir
        }));
    }

    let mut files_copied = 0usize;
    let mut raw_files_copied = 0usize;
    for (index, copy) in plan.copies.iter().enumerate() {
        let parent = copy
            .destination_path
            .parent()
            .ok_or("export destination has no parent folder")?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("could not create export folder: {error}"))?;
        tokio::fs::copy(&copy.source_path, &copy.destination_path)
            .await
            .map_err(|error| format!("could not copy {}: {error}", copy.source_path.display()))?;
        files_copied += 1;
        if copy.kind == "raw" {
            raw_files_copied += 1;
        }
        if index == 0 || (index + 1) % 100 == 0 || index + 1 == plan.copies.len() {
            info!(project_id = %project_id, copied = index + 1, total = plan.copies.len(), "export copy progress");
        }
    }

    let mut xmp_files_written = 0usize;
    for sidecar in &plan.sidecars {
        let parent = sidecar
            .destination_path
            .parent()
            .ok_or("sidecar destination has no parent folder")?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
        tokio::fs::write(&sidecar.destination_path, xmp_sidecar(sidecar))
            .await
            .map_err(|error| format!("could not write XMP sidecar: {error}"))?;
        xmp_files_written += 1;
    }
    if plan.settings.include_csv {
        let report = FilePath::new(&plan.settings.destination_dir).join("framescout-selection.csv");
        tokio::fs::write(report, &plan.csv_preview)
            .await
            .map_err(|error| format!("could not write export CSV: {error}"))?;
    }
    info!(project_id = %project_id, files_copied, raw_files_copied, xmp_files_written, "export completed without modifying source photos");
    Ok(json!({
        "projectId": project_id,
        "committed": true,
        "originalFilesModified": 0,
        "xmpFilesWritten": xmp_files_written,
        "filesCopied": files_copied,
        "rawFilesCopied": raw_files_copied,
        "destinationDir": plan.settings.destination_dir
    }))
}

fn command_project_id(arguments: &Value, command: &str) -> Result<String, String> {
    let outer = arguments["projectId"].as_str();
    let inner = arguments["input"]["projectId"].as_str();
    match (outer, inner) {
        (Some(outer), Some(inner)) if outer == inner && !outer.trim().is_empty() => {
            Ok(outer.to_string())
        }
        (Some(outer), None) if !outer.trim().is_empty() => Ok(outer.to_string()),
        _ => Err(format!("{command} needs a matching project id")),
    }
}

fn export_settings(arguments: &Value) -> Result<ExportSettingsPayload, String> {
    let settings: ExportSettingsPayload =
        serde_json::from_value(arguments["input"]["settings"].clone())
            .map_err(|_| "export settings are required".to_string())?;
    if !matches!(settings.selection_scope.as_str(), "selected" | "decided")
        || !matches!(settings.filter_match.as_str(), "all" | "any")
        || !matches!(
            settings.media.as_str(),
            "proxies" | "raw" | "proxies-and-raw"
        )
        || !matches!(
            settings.raw_layout.as_str(),
            "same-folder" | "raw-subfolder"
        )
        || settings.collision != "rename"
    {
        return Err("export settings contain an unsupported option".to_string());
    }
    if !settings.destination_dir.trim().is_empty()
        && !FilePath::new(&settings.destination_dir).is_absolute()
    {
        return Err("export destination must be an absolute local folder".to_string());
    }
    Ok(settings)
}

fn export_folder_group(path: &FilePath) -> String {
    path.parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

fn matches_export_filters(
    source_path: &FilePath,
    tags: &[String],
    settings: &ExportSettingsPayload,
) -> bool {
    if tags.iter().any(|tag| {
        settings
            .excluded_tags
            .iter()
            .any(|excluded| excluded == tag)
    }) {
        return false;
    }
    let folders_active = !settings.included_folder_groups.is_empty();
    let tags_active = !settings.included_tags.is_empty();
    if !folders_active && !tags_active {
        return true;
    }
    let folder_match = folders_active
        && settings
            .included_folder_groups
            .iter()
            .any(|group| group.replace('\\', "/") == export_folder_group(source_path));
    let tag_match = tags_active
        && tags.iter().any(|tag| {
            settings
                .included_tags
                .iter()
                .any(|selected| selected == tag)
        });
    if !folders_active {
        return tag_match;
    }
    if !tags_active {
        return folder_match;
    }
    if settings.filter_match == "all" {
        folder_match && tag_match
    } else {
        folder_match || tag_match
    }
}

async fn build_export_plan(
    state: &AppState,
    project_id: &str,
    settings: ExportSettingsPayload,
) -> Result<ExportPlan, String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let project = repository
        .load_project(project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("project does not exist")?;
    let assets = repository
        .list_assets(project_id)
        .await
        .map_err(|error| error.to_string())?;
    let tags = repository
        .list_tags(project_id)
        .await
        .map_err(|error| error.to_string())?;
    let roots = project
        .source_roots_json
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let mut tags_by_asset: HashMap<String, Vec<String>> = HashMap::new();
    for tag in tags {
        tags_by_asset.entry(tag.asset_id).or_default().push(tag.tag);
    }
    let mut copies = Vec::new();
    let mut sidecars = Vec::new();
    let mut skipped = Vec::new();
    let mut metadata_records = Vec::new();
    let destination_root = FilePath::new(&settings.destination_dir);
    let mut reserved_paths = BTreeSet::new();

    for asset in assets {
        let disposition = asset.human_disposition.as_str();
        let included = match settings.selection_scope.as_str() {
            "selected" => disposition == "select",
            "decided" => matches!(disposition, "candidate" | "select" | "hold"),
            _ => false,
        };
        let tags = tags_by_asset.remove(&asset.id).unwrap_or_default();
        metadata_records.push(json!({
            "assetId": asset.id,
            "fileName": FilePath::new(&asset.source_path).file_name().and_then(|name| name.to_str()).unwrap_or(""),
            "sourcePath": asset.source_path,
            "humanDisposition": disposition,
            "aiDisposition": asset.ai_disposition,
            "tags": tags,
            "reasons": asset.reasons_json,
            "modelVersion": "localhost-export-v1"
        }));
        if !included || !matches_export_filters(FilePath::new(&asset.source_path), &tags, &settings)
        {
            skipped.push(json!({ "assetId": asset.id, "fileName": FilePath::new(&asset.source_path).file_name().and_then(|name| name.to_str()).unwrap_or(""), "reason": "unseen" }));
            continue;
        }
        if asset.missing_state == "missing" {
            skipped.push(json!({ "assetId": asset.id, "fileName": FilePath::new(&asset.source_path).file_name().and_then(|name| name.to_str()).unwrap_or(""), "reason": "missing-source" }));
            continue;
        }
        let proxy_path = PathBuf::from(&asset.source_path);
        let raw_path = asset
            .mapped_master_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| path.is_file());
        let mut sidecar_base: Option<PathBuf> = None;
        if matches!(settings.media.as_str(), "proxies" | "proxies-and-raw") {
            if proxy_path.is_file() {
                let destination = reserve_export_path(
                    export_destination(
                        destination_root,
                        &proxy_path,
                        &roots,
                        "selected",
                        settings.preserve_folder_structure,
                    ),
                    &mut reserved_paths,
                );
                sidecar_base = Some(destination.clone());
                copies.push(ExportCopyPlan {
                    asset_id: asset.id.clone(),
                    source_path: proxy_path,
                    destination_path: destination,
                    kind: "proxy",
                });
            } else {
                skipped.push(
                    json!({ "assetId": asset.id, "fileName": "", "reason": "missing-source" }),
                );
            }
        }
        if matches!(settings.media.as_str(), "raw" | "proxies-and-raw") {
            if let Some(raw_path) = raw_path {
                let folder = if settings.raw_layout == "raw-subfolder" {
                    "RAW"
                } else {
                    "selected"
                };
                let destination = reserve_export_path(
                    export_destination(
                        destination_root,
                        &raw_path,
                        &roots,
                        folder,
                        settings.preserve_folder_structure,
                    ),
                    &mut reserved_paths,
                );
                sidecar_base = Some(destination.clone());
                copies.push(ExportCopyPlan {
                    asset_id: asset.id.clone(),
                    source_path: raw_path,
                    destination_path: destination,
                    kind: "raw",
                });
            } else if settings.media == "raw" {
                skipped.push(
                    json!({ "assetId": asset.id, "fileName": "", "reason": "no-source-path" }),
                );
            }
        }
        if settings.include_xmp {
            if let Some(base) = sidecar_base {
                let (rating, color_label) = export_rating(disposition);
                let keywords = metadata_records
                    .last()
                    .and_then(|record| record["tags"].as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect();
                sidecars.push(ExportSidecarPlan {
                    destination_path: base.with_extension("xmp"),
                    rating,
                    color_label,
                    keywords,
                });
            }
        }
    }
    let csv_preview = export_csv(&metadata_records);
    Ok(ExportPlan {
        settings,
        copies,
        sidecars,
        skipped,
        metadata_records,
        csv_preview,
    })
}

fn export_destination(
    destination_root: &FilePath,
    source_path: &FilePath,
    roots: &[PathBuf],
    folder: &str,
    preserve_structure: bool,
) -> PathBuf {
    let relative = if preserve_structure {
        roots
            .iter()
            .find_map(|root| source_path.strip_prefix(root).ok())
            .map(PathBuf::from)
    } else {
        None
    }
    .unwrap_or_else(|| PathBuf::from(source_path.file_name().unwrap_or_default()));
    destination_root.join(folder).join(relative)
}

fn reserve_export_path(path: PathBuf, reserved: &mut BTreeSet<PathBuf>) -> PathBuf {
    if reserved.insert(path.clone()) {
        return path;
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("frame");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let parent = path.parent().unwrap_or_else(|| FilePath::new(""));
    for index in 2..10_000 {
        let name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = parent.join(name);
        if reserved.insert(candidate.clone()) {
            return candidate;
        }
    }
    path
}

fn export_rating(disposition: &str) -> (u8, &'static str) {
    match disposition {
        "select" => (5, "Green"),
        "candidate" => (3, "Yellow"),
        "hold" => (2, "Blue"),
        _ => (0, "None"),
    }
}

fn export_preview_payload(project_id: &str, plan: &ExportPlan) -> Value {
    json!({
        "projectId": project_id,
        "originalFilesModified": 0,
        "settings": plan.settings,
        "filesToCopy": plan.copies.iter().map(|copy| json!({
            "assetId": copy.asset_id,
            "sourcePath": copy.source_path,
            "destinationPath": copy.destination_path,
            "kind": copy.kind
        })).collect::<Vec<_>>(),
        "xmpFilesToWrite": plan.sidecars.len(),
        "targets": plan.sidecars.iter().map(|sidecar| json!({
            "assetId": "",
            "sourceAssetId": "",
            "fileName": sidecar.destination_path.file_name().and_then(|name| name.to_str()).unwrap_or(""),
            "sidecarPath": sidecar.destination_path,
            "humanDisposition": "select",
            "rating": sidecar.rating,
            "colorLabel": sidecar.color_label,
            "keywords": sidecar.keywords,
            "operation": "add-or-update"
        })).collect::<Vec<_>>(),
        "skipped": plan.skipped,
        "metadataRecords": plan.metadata_records,
        "csvPreview": plan.csv_preview
    })
}

fn export_csv(records: &[Value]) -> String {
    let mut rows = vec!["file,source_path,human_decision,ai_disposition,tags,reasons".to_string()];
    for record in records {
        let cell = |value: String| format!("\"{}\"", value.replace('"', "\"\""));
        rows.push(
            [
                record["fileName"].as_str().unwrap_or_default().to_string(),
                record["sourcePath"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                record["humanDisposition"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                record["aiDisposition"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                record["tags"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(";"),
                record["reasons"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(Value::to_string)
                    .collect::<Vec<_>>()
                    .join(";"),
            ]
            .into_iter()
            .map(cell)
            .collect::<Vec<_>>()
            .join(","),
        );
    }
    rows.join("\n")
}

fn xmp_sidecar(sidecar: &ExportSidecarPlan) -> String {
    let keywords = sidecar
        .keywords
        .iter()
        .map(|keyword| format!("<rdf:li>{}</rdf:li>", xml_escape(keyword)))
        .collect::<String>();
    format!(
        "<?xpacket begin=\"﻿\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?><x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:photoshop=\"http://ns.adobe.com/photoshop/1.0/\" xmp:Rating=\"{}\" photoshop:ColorMode=\"{}\"><dc:subject xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><rdf:Bag>{}</rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>",
        sidecar.rating, xml_escape(sidecar.color_label), keywords
    )
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

async fn project_analysis_runs(
    repository: &SqliteProjectRepository,
    project_id: &str,
) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        r#"
        SELECT analysis_runs.id, analysis_runs.status, analysis_runs.backend,
               analysis_runs.started_at, analysis_runs.completed_at, analysis_runs.error_message,
               CASE WHEN analysis_runs.total_assets > 0 THEN analysis_runs.total_assets
                    ELSE (SELECT COUNT(*) FROM assets WHERE assets.project_id = analysis_runs.project_id AND assets.preview_state = 'ready')
               END AS total_assets,
               (SELECT COUNT(DISTINCT signals.asset_id) FROM signals WHERE signals.run_id = analysis_runs.id) AS analyzed_assets,
               (SELECT COUNT(*) FROM assets WHERE assets.project_id = analysis_runs.project_id AND assets.preview_state = 'raw-placeholder') AS raw_placeholders,
               (SELECT COUNT(*) FROM assets WHERE assets.project_id = analysis_runs.project_id AND assets.missing_state = 'missing') AS missing_assets
        FROM analysis_runs
        WHERE analysis_runs.project_id = ?
        ORDER BY analysis_runs.started_at ASC
        LIMIT 20
        "#,
    )
    .bind(project_id)
    .fetch_all(repository.pool())
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let total: i64 = row.get("total_assets");
            let analyzed: i64 = row.get("analyzed_assets");
            let stored_status: String = row.get("status");
            let status = if stored_status == "completed" && analyzed < total {
                "failed"
            } else {
                stored_status.as_str()
            };
            json!({
                "id": row.get::<String, _>("id"),
                "projectId": project_id,
                "status": status,
                "totalAssets": total,
                "previewsReady": analyzed,
                "rawPlaceholders": row.get::<i64, _>("raw_placeholders"),
                "missingAssets": row.get::<i64, _>("missing_assets"),
                "progress": if total == 0 { 1.0 } else { analyzed as f64 / total as f64 },
                "backend": row.get::<String, _>("backend"),
                "queuedAt": row.get::<String, _>("started_at"),
                "completedAt": row.get::<Option<String>, _>("completed_at"),
                "errorMessage": row.get::<Option<String>, _>("error_message")
            })
        })
        .collect())
}

fn analysis_status_payload(runs: Vec<Value>) -> Value {
    json!({ "run": runs.into_iter().last() })
}

fn index_status_payload<I, S>(project_id: &str, state: &str, preview_states: I) -> Value
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let states = preview_states
        .into_iter()
        .map(|value| value.as_ref().to_string())
        .collect::<Vec<_>>();
    let previews_ready = states
        .iter()
        .filter(|value| value.as_str() == "ready")
        .count();
    let failed = states
        .iter()
        .filter(|value| value.as_str() == "failed")
        .count();
    let indexed = states
        .iter()
        .filter(|value| value.as_str() != "pending")
        .count();
    json!({
        "projectId": project_id,
        "state": state,
        "discovered": states.len(),
        "indexed": indexed,
        "previewsReady": previews_ready,
        "failed": failed
    })
}

async fn analysis_status(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let project_id = command_project_id(arguments, "analysis.status")?;
    let repository = state
        .repository
        .as_ref()
        .ok_or_else(|| "project database is unavailable".to_string())?;
    if repository
        .load_project(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Err("analysis project does not exist".to_string());
    }
    Ok(analysis_status_payload(
        project_analysis_runs(repository, &project_id).await?,
    ))
}

async fn project_index_status(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let project_id = command_project_id(arguments, "project.indexStatus")?;
    let repository = state
        .repository
        .as_ref()
        .ok_or_else(|| "project database is unavailable".to_string())?;
    let project = repository
        .load_project(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "indexing project does not exist".to_string())?;
    let assets = repository
        .list_assets(&project_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(index_status_payload(
        &project_id,
        &project.indexing_state,
        assets.iter().map(|asset| asset.preview_state.as_str()),
    ))
}

async fn analysis_config_payload(state: &AppState) -> Value {
    let selected = state.analysis_profile.read().await.clone();
    let qwen_key_ready = std::env::var("DASHSCOPE_API_KEY").is_ok();
    let custom_key_ready = std::env::var("FRAMESCOUT_CLOUD_API_KEY").is_ok();
    let custom_endpoint = selected
        .endpoint
        .clone()
        .or_else(|| std::env::var("FRAMESCOUT_CLOUD_BASE_URL").ok());
    let custom_model = selected
        .model
        .clone()
        .or_else(|| std::env::var("FRAMESCOUT_CLOUD_MODEL").ok())
        .unwrap_or_else(|| "vision-model".to_string());
    json!({
        "activeProfileId": selected.profile_id,
        "secretStorage": "terminal-environment",
        "maxCloudProxyPixels": MAX_CLOUD_PROXY_PIXELS,
        "executionMode": selected.execution_mode,
        "cloudBudgetCents": selected.cloud_budget_cents,
        "cloudConcurrency": selected.cloud_concurrency,
        "profiles": [
            profile_json("local-gpu-quality", "local", "YOLOX-S + FrameScout Quality", "gpu", state.ai.quality_model.is_file(), None, false, None),
            profile_json("local-gpu-fast", "local", "YOLOX-Nano + FrameScout Quality", "gpu", state.ai.fast_model.is_file(), None, false, None),
            profile_json("local-cpu-fast", "local", "YOLOX-Nano + FrameScout Quality", "cpu", state.ai.fast_model.is_file(), None, false, None),
            profile_json("qwen-cloud", "qwen", "qwen3-vl-plus", "cloud", qwen_key_ready, Some("Set DASHSCOPE_API_KEY in the service terminal"), true, Some("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")),
            profile_json("custom-cloud", "openai-compatible", &custom_model, "cloud", custom_key_ready && custom_endpoint.is_some(), Some("Set FRAMESCOUT_CLOUD_API_KEY and an HTTPS endpoint"), true, custom_endpoint.as_deref())
        ]
    })
}

fn profile_json(
    id: &str,
    provider: &str,
    model: &str,
    backend: &str,
    available: bool,
    unavailable_reason: Option<&str>,
    sends_proxy: bool,
    endpoint: Option<&str>,
) -> Value {
    let mut value = json!({
        "id": id, "provider": provider, "model": model, "backend": backend,
        "available": available, "sendsProxyOffDevice": sends_proxy
    });
    if !available {
        value["unavailableReason"] = json!(unavailable_reason.unwrap_or("Profile is unavailable"));
    }
    if let Some(endpoint) = endpoint {
        value["endpoint"] = json!(endpoint);
    }
    value
}

async fn set_analysis_config(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let input = arguments.get("input").unwrap_or(arguments);
    let current_selection = state.analysis_profile.read().await.clone();
    let profile_id = input
        .get("profileId")
        .and_then(Value::as_str)
        .ok_or("profileId is required")?;
    if !matches!(
        profile_id,
        "local-gpu-quality" | "local-gpu-fast" | "local-cpu-fast" | "qwen-cloud" | "custom-cloud"
    ) {
        return Err("unknown analysis profile".to_string());
    }
    let endpoint = input
        .get("endpoint")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if let Some(value) = endpoint.as_deref() {
        let valid_https = value.starts_with("https://");
        let valid_local =
            value.starts_with("http://127.0.0.1:") || value.starts_with("http://localhost:");
        if !valid_https && !valid_local {
            return Err(
                "custom cloud endpoint must use HTTPS (localhost HTTP is allowed for tests)"
                    .to_string(),
            );
        }
    }
    let current_preferences = CloudExecutionPreferences {
        execution_mode: current_selection.execution_mode,
        cloud_budget_cents: current_selection.cloud_budget_cents,
        cloud_concurrency: current_selection.cloud_concurrency,
    };
    let preferences = merge_cloud_execution_preferences(input, &current_preferences)?;
    let selection = AnalysisProfileSelection {
        profile_id: profile_id.to_string(),
        endpoint,
        model: input
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        execution_mode: preferences.execution_mode,
        cloud_budget_cents: preferences.cloud_budget_cents,
        cloud_concurrency: preferences.cloud_concurrency,
    };
    save_analysis_profile(&selection).await?;
    *state.analysis_profile.write().await = selection;
    Ok(analysis_config_payload(state).await)
}

fn parse_cloud_execution_preferences(input: &Value) -> Result<CloudExecutionPreferences, String> {
    let execution_mode = input
        .get("executionMode")
        .and_then(Value::as_str)
        .unwrap_or("local");
    if !matches!(execution_mode, "local" | "cloud" | "hybrid") {
        return Err("executionMode must be local, cloud, or hybrid".to_string());
    }
    let cloud_budget_cents = input
        .get("cloudBudgetCents")
        .map(|value| {
            value
                .as_u64()
                .ok_or("cloudBudgetCents must be a whole number")
        })
        .transpose()?
        .unwrap_or(0);
    if cloud_budget_cents > MAX_CLOUD_BUDGET_CENTS {
        return Err(format!(
            "cloudBudgetCents must not exceed {MAX_CLOUD_BUDGET_CENTS}"
        ));
    }
    let cloud_concurrency = input
        .get("cloudConcurrency")
        .map(|value| {
            value
                .as_u64()
                .and_then(|value| u8::try_from(value).ok())
                .ok_or("cloudConcurrency must be a whole number")
        })
        .transpose()?
        .unwrap_or_else(default_cloud_concurrency);
    if !(1..=MAX_CLOUD_CONCURRENCY).contains(&cloud_concurrency) {
        return Err(format!(
            "cloudConcurrency must be between 1 and {MAX_CLOUD_CONCURRENCY}"
        ));
    }
    Ok(CloudExecutionPreferences {
        execution_mode: execution_mode.to_string(),
        cloud_budget_cents,
        cloud_concurrency,
    })
}

fn merge_cloud_execution_preferences(
    input: &Value,
    current: &CloudExecutionPreferences,
) -> Result<CloudExecutionPreferences, String> {
    let merged = json!({
        "executionMode": input
            .get("executionMode")
            .cloned()
            .unwrap_or_else(|| json!(current.execution_mode)),
        "cloudBudgetCents": input
            .get("cloudBudgetCents")
            .cloned()
            .unwrap_or_else(|| json!(current.cloud_budget_cents)),
        "cloudConcurrency": input
            .get("cloudConcurrency")
            .cloned()
            .unwrap_or_else(|| json!(current.cloud_concurrency)),
    });
    parse_cloud_execution_preferences(&merged)
}

fn resolve_analysis_profile(
    state: &AppState,
    selected: &AnalysisProfileSelection,
) -> Result<ActiveAnalysisProfile, String> {
    match selected.profile_id.as_str() {
        "local-gpu-quality" => Ok(ActiveAnalysisProfile {
            id: selected.profile_id.clone(),
            provider: "local".into(),
            model: "yolox_s".into(),
            backend: "gpu".into(),
            model_path: Some(state.ai.quality_model.clone()),
            endpoint: None,
            api_key: None,
            cloud_budget_cents: 0,
            cloud_concurrency: selected.cloud_concurrency,
            estimated_cents_per_asset: 1,
            execution_mode: selected.execution_mode.clone(),
        }),
        "local-gpu-fast" => Ok(ActiveAnalysisProfile {
            id: selected.profile_id.clone(),
            provider: "local".into(),
            model: "yolox_nano".into(),
            backend: "gpu".into(),
            model_path: Some(state.ai.fast_model.clone()),
            endpoint: None,
            api_key: None,
            cloud_budget_cents: 0,
            cloud_concurrency: selected.cloud_concurrency,
            estimated_cents_per_asset: 1,
            execution_mode: selected.execution_mode.clone(),
        }),
        "local-cpu-fast" => Ok(ActiveAnalysisProfile {
            id: selected.profile_id.clone(),
            provider: "local".into(),
            model: "yolox_nano".into(),
            backend: "cpu".into(),
            model_path: Some(state.ai.fast_model.clone()),
            endpoint: None,
            api_key: None,
            cloud_budget_cents: 0,
            cloud_concurrency: selected.cloud_concurrency,
            estimated_cents_per_asset: 1,
            execution_mode: selected.execution_mode.clone(),
        }),
        "qwen-cloud" => Ok(ActiveAnalysisProfile {
            id: selected.profile_id.clone(),
            provider: "qwen".into(),
            model: "qwen3-vl-plus".into(),
            backend: "cloud".into(),
            model_path: None,
            endpoint: Some(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions".into(),
            ),
            api_key: std::env::var("DASHSCOPE_API_KEY").ok(),
            cloud_budget_cents: selected.cloud_budget_cents,
            cloud_concurrency: selected.cloud_concurrency,
            estimated_cents_per_asset: 1,
            execution_mode: selected.execution_mode.clone(),
        }),
        "custom-cloud" => Ok(ActiveAnalysisProfile {
            id: selected.profile_id.clone(),
            provider: "openai-compatible".into(),
            model: selected
                .model
                .clone()
                .or_else(|| std::env::var("FRAMESCOUT_CLOUD_MODEL").ok())
                .unwrap_or_else(|| "vision-model".into()),
            backend: "cloud".into(),
            model_path: None,
            endpoint: selected
                .endpoint
                .clone()
                .or_else(|| std::env::var("FRAMESCOUT_CLOUD_BASE_URL").ok()),
            api_key: std::env::var("FRAMESCOUT_CLOUD_API_KEY").ok(),
            cloud_budget_cents: selected.cloud_budget_cents,
            cloud_concurrency: selected.cloud_concurrency,
            estimated_cents_per_asset: std::env::var("FRAMESCOUT_CLOUD_ESTIMATED_CENTS_PER_IMAGE")
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|value| *value > 0)
                .unwrap_or(2),
            execution_mode: selected.execution_mode.clone(),
        }),
        _ => Err("unknown analysis profile".to_string()),
    }
}

async fn enqueue_analysis(state: &AppState, arguments: &Value) -> Result<Value, String> {
    let project_id = arguments
        .get("projectId")
        .and_then(Value::as_str)
        .or_else(|| {
            arguments
                .pointer("/input/projectId")
                .and_then(Value::as_str)
        })
        .ok_or_else(|| "analysis.enqueue needs a project id".to_string())?
        .to_string();
    let explicitly_requested =
        arguments.pointer("/input/priority").and_then(Value::as_str) == Some("high");
    let repository = state
        .repository
        .as_ref()
        .ok_or_else(|| "project database is unavailable".to_string())?;
    if repository
        .load_project(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Err("analysis project does not exist".to_string());
    }
    // A ready asset remains eligible even when its derived cache was evicted.
    // The worker restores only the missing proxy before passing it to the model.
    let analysis_candidate_count = repository
        .list_assets(&project_id)
        .await
        .map_err(|error| error.to_string())?
        .iter()
        .filter(|asset| is_analysis_candidate(asset))
        .count();
    if analysis_candidate_count == 0 {
        return Err("no preview proxies are ready for AI analysis yet".to_string());
    }

    let mut running = state.running_analysis.lock().await;
    let latest_run = sqlx::query(
        "SELECT id, status, model_bundle_version FROM analysis_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
    )
    .bind(&project_id)
    .fetch_optional(repository.pool())
    .await
    .map_err(|error| error.to_string())?;
    let latest_status = latest_run
        .as_ref()
        .map(|row| row.get::<String, _>("status"));
    let profile = resolve_analysis_profile(state, &state.analysis_profile.read().await.clone())?;
    validate_execution_profile(&profile.execution_mode, &profile.provider)?;
    let model_bundle_version = format!("{}:{}", profile.id, profile.model);
    let latest_matches_profile = latest_run
        .as_ref()
        .is_some_and(|row| row.get::<String, _>("model_bundle_version") == model_bundle_version);
    // A completed cloud result is a paid project result. Repeated clicks with
    // the same provider/model return it instead of silently purchasing it again.
    let force_restart = explicitly_requested
        && !(profile.provider != "local"
            && latest_status.as_deref() == Some("completed")
            && latest_matches_profile);
    let should_start = !running.contains(&project_id)
        && (force_restart || latest_status.as_deref() != Some("completed"));
    if should_start {
        if profile.provider != "local" && (profile.endpoint.is_none() || profile.api_key.is_none())
        {
            return Err("selected cloud profile is not ready; configure its endpoint and API key in the service terminal".to_string());
        }
        if profile.provider == "local"
            && !profile
                .model_path
                .as_ref()
                .is_some_and(|path| path.is_file())
        {
            return Err("selected local model file is unavailable".to_string());
        }
        let latest_run_fields = latest_run.as_ref().map(|row| {
            (
                row.get::<String, _>("id"),
                row.get::<String, _>("status"),
                row.get::<String, _>("model_bundle_version"),
            )
        });
        let resumable_run_id = resumable_cloud_run_id(
            &profile.provider,
            &model_bundle_version,
            latest_run_fields
                .as_ref()
                .map(|(id, status, version)| (id.as_str(), status.as_str(), version.as_str())),
        );
        let run_id = if let Some(run_id) = resumable_run_id {
            sqlx::query(
                "UPDATE analysis_runs SET status = 'running', completed_at = NULL, error_message = NULL, total_assets = ? WHERE id = ?",
            )
            .bind(analysis_candidate_count as i64)
            .bind(&run_id)
            .execute(repository.pool())
            .await
            .map_err(|error| error.to_string())?;
            run_id
        } else {
            let run_id = Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO analysis_runs (
                  id, project_id, model_bundle_version, backend, status, started_at, total_assets
                ) VALUES (?, ?, ?, ?, 'running', ?, ?)
                "#,
            )
            .bind(&run_id)
            .bind(&project_id)
            .bind(&model_bundle_version)
            .bind(&profile.backend)
            .bind(timestamp())
            .bind(analysis_candidate_count as i64)
            .execute(repository.pool())
            .await
            .map_err(|error| error.to_string())?;
            run_id
        };
        running.insert(project_id.clone());
        tokio::spawn(run_analysis(
            state.clone(),
            project_id.clone(),
            run_id,
            profile,
        ));
    }
    drop(running);

    let project = load_active_project(state).await?;
    let run = project_analysis_runs(repository, &project_id)
        .await?
        .pop()
        .ok_or_else(|| "analysis run was not created".to_string())?;
    Ok(json!({ "run": run, "project": project }))
}

async fn run_analysis(
    state: AppState,
    project_id: String,
    run_id: String,
    profile: ActiveAnalysisProfile,
) {
    let outcome = run_analysis_inner(&state, &project_id, &run_id, &profile).await;
    if let Err(error) = &outcome {
        tracing::error!(%project_id, %run_id, %error, "AI analysis failed");
        if let Some(repository) = &state.repository {
            let _ = sqlx::query(
                "UPDATE analysis_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?",
            )
            .bind(timestamp())
            .bind(error)
            .bind(&run_id)
            .execute(repository.pool())
            .await;
        }
    }
    state.running_analysis.lock().await.remove(&project_id);
}

async fn run_analysis_inner(
    state: &AppState,
    project_id: &str,
    run_id: &str,
    profile: &ActiveAnalysisProfile,
) -> Result<(), String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let project = repository
        .load_project(project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("analysis project disappeared")?;
    let candidates = repository
        .list_assets(project_id)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(is_analysis_candidate)
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Err("no preview proxies are ready for AI analysis yet".to_string());
    }
    ensure_analysis_proxy_caches(repository, &state.cache_dir, project_id, &candidates).await?;
    let assets = repository
        .list_assets(project_id)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|asset| asset.preview_state == "ready" && analysis_image_path(asset).is_some())
        .collect::<Vec<_>>();
    if assets.is_empty() {
        return Err("no preview proxies are ready for AI analysis yet".to_string());
    }
    if profile.provider != "local" {
        return run_cloud_analysis(
            state,
            project.preset.as_str(),
            &assets,
            project_id,
            run_id,
            profile,
        )
        .await;
    }
    let model_path = profile
        .model_path
        .as_ref()
        .ok_or("local model path is unavailable")?;
    let mut child = Command::new(&state.ai.python)
        .args([
            "-m",
            "framescout_ai.worker",
            "--model",
            model_path.to_string_lossy().as_ref(),
            "--backend",
            &profile.backend,
            "serve",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("could not start AI worker: {error}"))?;
    let mut stdin = child.stdin.take().ok_or("AI worker stdin is unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("AI worker stdout is unavailable")?;
    let mut lines = BufReader::new(stdout).lines();
    let ready = lines
        .next_line()
        .await
        .map_err(|error| error.to_string())?
        .ok_or("AI worker exited before ready")?;
    let ready_payload: Value = serde_json::from_str(&ready).map_err(|error| error.to_string())?;
    if ready_payload
        .pointer("/capabilities/detector/status")
        .and_then(Value::as_str)
        != Some("ready")
    {
        return Err(format!(
            "AI detector is unavailable: {}",
            ready_payload
                .pointer("/capabilities/detector/error")
                .and_then(Value::as_str)
                .unwrap_or("unknown detector error")
        ));
    }
    info!(%project_id, %run_id, capabilities = %ready_payload, "AI worker ready");

    let total = assets.len();
    let mut analyzed = 0usize;
    for asset in assets {
        let Some(image_path) = analysis_image_path(&asset) else {
            continue;
        };
        let request = json!({
            "id": asset.id,
            "command": "analyze",
            "imagePath": image_path,
            "preset": project.preset
        });
        stdin
            .write_all(format!("{}\n", request).as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())?;
        let line = lines
            .next_line()
            .await
            .map_err(|error| error.to_string())?
            .ok_or("AI worker exited during analysis")?;
        let response: WorkerResponse =
            serde_json::from_str(&line).map_err(|error| error.to_string())?;
        if response.ok != Some(true) {
            tracing::warn!(asset_id = %asset.id, error = ?response.error, "AI asset analysis skipped");
            continue;
        }
        if response.id.as_deref() != Some(asset.id.as_str()) {
            return Err("AI worker response id mismatch".to_string());
        }
        persist_analysis_result(
            repository,
            project_id,
            run_id,
            &asset.id,
            response.result.as_ref().ok_or("AI worker result missing")?,
        )
        .await?;
        analyzed += 1;
        if analyzed == 1 || analyzed % 10 == 0 || analyzed == total {
            info!(%project_id, %run_id, analyzed, total, "AI analysis progress");
        }
    }
    drop(stdin);
    let _ = child.wait().await;
    validate_analysis_completion(analyzed, total)?;
    sqlx::query("UPDATE analysis_runs SET status = 'completed', completed_at = ? WHERE id = ?")
        .bind(timestamp())
        .bind(run_id)
        .execute(repository.pool())
        .await
        .map_err(|error| error.to_string())?;
    info!(%project_id, %run_id, analyzed, total, "AI analysis completed");
    Ok(())
}

fn validate_analysis_completion(analyzed: usize, total: usize) -> Result<(), String> {
    if analyzed == total {
        Ok(())
    } else {
        Err(format!(
            "AI analysis incomplete: analyzed {analyzed} of {total} assets"
        ))
    }
}

fn is_analysis_candidate(asset: &framescout_storage::AssetRecord) -> bool {
    asset.preview_state == "ready" && is_indexable_proxy(FilePath::new(&asset.source_path))
}

async fn ensure_analysis_proxy_caches(
    repository: &SqliteProjectRepository,
    cache_dir: &FilePath,
    project_id: &str,
    assets: &[framescout_storage::AssetRecord],
) -> Result<(), String> {
    for asset in assets
        .iter()
        .filter(|asset| analysis_image_path(asset).is_none())
    {
        let source = PathBuf::from(&asset.source_path);
        let cache_root = cache_dir.to_path_buf();
        let project_id = project_id.to_string();
        let cache_project_id = project_id.clone();
        let asset_id = asset.id.clone();
        let (thumbnail, display) = tokio::task::spawn_blocking(move || {
            generate_proxy_caches(&source, &cache_root, &cache_project_id, &asset_id)
        })
        .await
        .map_err(|error| error.to_string())?;
        repository
            .update_asset_cache(
                project_id.as_str(),
                &asset.id,
                thumbnail.as_deref(),
                display.as_deref(),
                if thumbnail.is_some() {
                    "ready"
                } else {
                    "failed"
                },
            )
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn analysis_image_path(asset: &framescout_storage::AssetRecord) -> Option<String> {
    asset
        .display_cache_path
        .as_ref()
        .or(asset.thumbnail_cache_path.as_ref())
        .filter(|path| {
            let file = FilePath::new(path);
            file.is_file()
                && matches!(
                    file.extension()
                        .and_then(|value| value.to_str())
                        .map(str::to_ascii_lowercase)
                        .as_deref(),
                    Some("jpg" | "jpeg" | "png" | "webp")
                )
        })
        .cloned()
}

async fn run_cloud_analysis(
    state: &AppState,
    preset: &str,
    assets: &[framescout_storage::AssetRecord],
    project_id: &str,
    run_id: &str,
    profile: &ActiveAnalysisProfile,
) -> Result<(), String> {
    let repository = state
        .repository
        .as_ref()
        .ok_or("project database is unavailable")?;
    let endpoint = profile
        .endpoint
        .as_deref()
        .ok_or("cloud endpoint is unavailable")?;
    let api_key = profile
        .api_key
        .as_deref()
        .ok_or("cloud API key is unavailable")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|error| error.to_string())?;
    let ledger =
        cloud_request_ledger(repository, project_id, &profile.provider, &profile.model).await?;
    let remaining_slots = remaining_cloud_asset_slots(
        profile.cloud_budget_cents,
        profile.estimated_cents_per_asset,
        ledger.len() as u64,
    )?;
    let completed_ids =
        sqlx::query_scalar::<_, String>("SELECT DISTINCT asset_id FROM signals WHERE run_id = ?")
            .bind(run_id)
            .fetch_all(repository.pool())
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .collect::<HashSet<_>>();
    let pending_assets = assets
        .iter()
        .filter(|asset| !completed_ids.contains(&asset.id) && !ledger.contains_key(&asset.id))
        .collect::<Vec<_>>();
    let affordable_count = pending_assets.len().min(remaining_slots);
    let affordable_assets = pending_assets
        .iter()
        .take(affordable_count)
        .copied()
        .collect::<Vec<_>>();
    let budget_exhausted = affordable_count < pending_assets.len();
    let concurrency = usize::from(profile.cloud_concurrency.clamp(1, MAX_CLOUD_CONCURRENCY));
    let mut policy_worker = PolicyWorker::start(&state.ai.python).await?;
    let policy_fallback_signals =
        unavailable_cloud_signals("cloud observations or policy worker unavailable");
    let policy_fallback_result = policy_worker
        .evaluate(
            "cloud-policy-fallback",
            preset,
            policy_fallback_signals.clone(),
        )
        .await?;
    if evaluated_disposition(&policy_fallback_result)? != cloud_failure_disposition() {
        return Err("Python policy fallback did not fail closed to review".to_string());
    }
    let mut analyzed = completed_ids.len();
    for asset in assets.iter().filter(|asset| {
        !completed_ids.contains(&asset.id)
            && ledger
                .get(&asset.id)
                .is_some_and(|state| state != "completed")
    }) {
        let error =
            "previous cloud request did not produce a trusted result; automatic retry disabled";
        let result = cloud_failure_result(
            &policy_fallback_result,
            &profile.provider,
            &profile.model,
            error,
        );
        persist_analysis_result(repository, project_id, run_id, &asset.id, &result).await?;
        update_cloud_request_state(
            repository,
            project_id,
            &asset.id,
            &profile.provider,
            &profile.model,
            "failed",
            Some(error),
            false,
        )
        .await?;
        analyzed += 1;
    }

    let run_semaphore = Arc::new(Semaphore::new(concurrency));
    let mut requests = JoinSet::new();
    for asset in affordable_assets {
        if !reserve_cloud_request(
            repository,
            project_id,
            &asset.id,
            run_id,
            &profile.provider,
            &profile.model,
            profile.estimated_cents_per_asset,
        )
        .await?
        {
            continue;
        }
        // Only generated cache paths enter the task. Source and mapped RAW paths are
        // deliberately unavailable to the cloud request closure.
        let proxy_path = asset
            .display_cache_path
            .as_ref()
            .or(asset.thumbnail_cache_path.as_ref())
            .ok_or_else(|| format!("asset {} has no cloud-safe proxy", asset.id))?
            .clone();
        let asset_id = asset.id.clone();
        let client = client.clone();
        let endpoint = endpoint.to_string();
        let api_key = api_key.to_string();
        let model = profile.model.clone();
        let provider = profile.provider.clone();
        let project_id = project_id.to_string();
        let prompt = cloud_analysis_prompt(preset, preset, 1);
        let run_semaphore = run_semaphore.clone();
        let global_semaphore = state.cloud_requests.clone();
        let repository = repository.clone();
        requests.spawn(async move {
            let result = async {
                let _run_permit = run_semaphore
                    .acquire_owned()
                    .await
                    .map_err(|_| "cloud request queue closed".to_string())?;
                let data_url = cloud_proxy_data_url(FilePath::new(&proxy_path)).await?;
                let _global_permit = global_semaphore
                    .acquire_owned()
                    .await
                    .map_err(|_| "global cloud request queue closed".to_string())?;
                update_cloud_request_state(
                    &repository,
                    &project_id,
                    &asset_id,
                    &provider,
                    &model,
                    "sent",
                    None,
                    true,
                )
                .await?;
                request_cloud_observations(&client, &endpoint, &api_key, &model, data_url, prompt)
                    .await
            }
            .await;
            (asset_id, result)
        });
    }

    let mut first_error = None;
    while let Some(outcome) = requests.join_next().await {
        let (asset_id, request_result) = match outcome {
            Ok(result) => result,
            Err(error) => {
                first_error.get_or_insert_with(|| format!("cloud request task failed: {error}"));
                continue;
            }
        };
        let content = match request_result {
            Ok(content) => content,
            Err(error) => {
                update_cloud_request_state(
                    repository,
                    project_id,
                    &asset_id,
                    &profile.provider,
                    &profile.model,
                    "failed",
                    Some(&error),
                    false,
                )
                .await?;
                let result = cloud_failure_result(
                    &policy_fallback_result,
                    &profile.provider,
                    &profile.model,
                    &error,
                );
                persist_analysis_result(repository, project_id, run_id, &asset_id, &result).await?;
                analyzed += 1;
                first_error.get_or_insert(error);
                continue;
            }
        };
        let signals = match parse_cloud_observations(&content) {
            Ok(signals) => signals,
            Err(error) => {
                update_cloud_request_state(
                    repository,
                    project_id,
                    &asset_id,
                    &profile.provider,
                    &profile.model,
                    "failed",
                    Some(&error),
                    false,
                )
                .await?;
                let result = cloud_failure_result(
                    &policy_fallback_result,
                    &profile.provider,
                    &profile.model,
                    &error,
                );
                persist_analysis_result(repository, project_id, run_id, &asset_id, &result).await?;
                analyzed += 1;
                first_error.get_or_insert(error);
                continue;
            }
        };
        let evaluation = policy_worker
            .evaluate(&asset_id, preset, signals.clone())
            .await;
        let policy_failed = evaluation.is_err();
        if let Err(error) = &evaluation {
            tracing::warn!(%asset_id, %error, "policy worker failed; using Python-evaluated review fallback");
        }
        let mut result = evaluated_result_or_fallback(evaluation, &policy_fallback_result);
        result["backend"] = json!("cloud");
        result["signals"] = if policy_failed {
            policy_fallback_signals.clone()
        } else {
            signals
        };
        result["signals"]["provider"] = json!(profile.provider);
        result["signals"]["model"] = json!(profile.model);
        persist_analysis_result(repository, project_id, run_id, &asset_id, &result).await?;
        update_cloud_request_state(
            repository,
            project_id,
            &asset_id,
            &profile.provider,
            &profile.model,
            "completed",
            None,
            false,
        )
        .await?;
        analyzed += 1;
        if analyzed == 1 || analyzed % 10 == 0 || analyzed == assets.len() {
            info!(%project_id, %run_id, analyzed, total = assets.len(), provider = %profile.provider, model = %profile.model, "cloud AI analysis progress");
        }
    }
    policy_worker.shutdown().await;
    if let Some(error) = first_error {
        return Err(error);
    }
    if budget_exhausted {
        return Err(format!(
            "cloud budget limit reached after {analyzed} of {} assets (estimated {} cents); increase the budget to resume this run",
            assets.len(),
            (ledger.len() + affordable_count).saturating_mul(profile.estimated_cents_per_asset as usize)
        ));
    }
    validate_analysis_completion(analyzed, assets.len())?;
    sqlx::query("UPDATE analysis_runs SET status = 'completed', completed_at = ? WHERE id = ?")
        .bind(timestamp())
        .bind(run_id)
        .execute(repository.pool())
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn request_cloud_observations(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    data_url: String,
    prompt: String,
) -> Result<String, String> {
    let mut last_error = "cloud request failed".to_string();
    for attempt in 0..3_u32 {
        let response = client
            .post(endpoint)
            .bearer_auth(api_key)
            .json(&json!({
                "model": model,
                "temperature": 0.1,
                "response_format": { "type": "json_object" },
                "messages": [{ "role": "user", "content": [
                    { "type": "image_url", "image_url": { "url": &data_url } },
                    { "type": "text", "text": &prompt }
                ]}]
            }))
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                // A transport timeout may have reached the provider and incurred
                // cost. Do not issue an ambiguous paid request a second time.
                return Err(format!("cloud request outcome is unknown: {error}"));
            }
        };
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("cloud response body could not be read: {error}"))?;
        if !status.is_success() {
            let provider_message = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|payload| {
                    payload
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| body.chars().take(240).collect::<String>());
            last_error = format!(
                "cloud provider returned {status}: {}",
                if provider_message.is_empty() {
                    "request failed"
                } else {
                    &provider_message
                }
            );
            if attempt < 2 && is_transient_cloud_status(status.as_u16()) {
                tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1) as u64))
                    .await;
                continue;
            }
            return Err(last_error);
        }
        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("cloud response was not JSON: {error}"))?;
        return payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or("cloud response did not contain message content".to_string());
    }
    Err(last_error)
}

async fn cloud_proxy_data_url(path: &FilePath) -> Result<String, String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| format!("cloud proxy unavailable: {error}"))?;
    if metadata.len() > MAX_CLOUD_PROXY_BYTES {
        return Err("cloud proxy exceeds the 12 MiB local safety limit".to_string());
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| error.to_string())?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("cloud proxy could not be decoded: {error}"))?;
    let (width, height) = image.dimensions();
    let scale = (MAX_CLOUD_PROXY_PIXELS as f64
        / (u64::from(width) * u64::from(height)).max(1) as f64)
        .sqrt()
        .min(1.0);
    let resized = if scale < 1.0 {
        image.resize(
            (width as f64 * scale).round() as u32,
            (height as f64 * scale).round() as u32,
            FilterType::Triangle,
        )
    } else {
        image
    };
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(Cursor::new(&mut jpeg), 84)
        .encode_image(&resized)
        .map_err(|error| error.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(jpeg)))
}

fn cloud_analysis_prompt(preset: &str, strategy_id: &str, strategy_version: u64) -> String {
    format!(
        "Return JSON only containing normalized visual observations for the FrameScout preset '{preset}' and strategy '{strategy_id}' version {strategy_version}. The single top-level key must be visualObservations. Required fields: image readability as readability {{readable, confidence}}; subjects, objects, and contexts as arrays of {{label, confidence}}; intentional motion as intentionalMotion {{present, confidence}}; quality {{globalSharpness: {{score, confidence}} or null, subjectSharpness: {{score, confidence}} or null, exposure: {{shadowClipRatio, highlightClipRatio, lowLight, confidence}}}}; portrait {{faceDetected, faceSizePixels integer or null, eyesOpen boolean or null, expression one of usable/unusual/unknown, faceSharpness: {{score, confidence}} or null}}; composition {{score, confidence, issues: string[]}}. Scores, ratios, and confidence values must be between 0 and 1. Labels and issue strings must be short lowercase English visual facts. Estimate quality from the visible proxy only and use null when a fact is not reliably visible. Do not return ratings, rankings, tags, policy reasons, or selection decisions."
    )
}

fn cloud_json(content: &str) -> Result<Value, String> {
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(trimmed)
        .map_err(|error| format!("cloud model returned invalid observation JSON: {error}"))
}

fn observation_confidence(value: &Value, field: &str) -> Result<f64, String> {
    let confidence = value
        .as_f64()
        .filter(|confidence| confidence.is_finite() && (0.0..=1.0).contains(confidence))
        .ok_or_else(|| format!("cloud observation {field} confidence is invalid"))?;
    Ok(confidence)
}

fn exact_object_fields(value: &Value, fields: &[&str], label: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("cloud observation {label} is invalid"))?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
        return Err(format!("cloud observation {label} has unexpected fields"));
    }
    Ok(())
}

fn observation_ratio(value: &Value, field: &str) -> Result<f64, String> {
    observation_confidence(value, field)
}

fn trusted_score(value: &Value, field: &str) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    exact_object_fields(value, &["score", "confidence"], field)?;
    let score = observation_ratio(&value["score"], field)?;
    let confidence = observation_confidence(&value["confidence"], field)?;
    Ok((confidence >= TRUSTED_CLOUD_OBSERVATION_CONFIDENCE).then_some(score))
}

fn observation_label(value: &Value, field: &str) -> Result<String, String> {
    let raw = value
        .as_str()
        .ok_or_else(|| format!("cloud observation {field} label is invalid"))?;
    let mut normalized = String::new();
    let mut pending_dash = false;
    for character in raw.trim().chars() {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !normalized.is_empty() {
                normalized.push('-');
            }
            normalized.push(character.to_ascii_lowercase());
            pending_dash = false;
        } else if matches!(character, ' ' | '-' | '_') {
            pending_dash = true;
        } else {
            return Err(format!(
                "cloud observation {field} label must be normalized English text"
            ));
        }
    }
    if normalized.is_empty() {
        return Err(format!("cloud observation {field} label is empty"));
    }
    Ok(normalized)
}

fn observation_array(observations: &Value, field: &str) -> Result<Vec<Value>, String> {
    observations
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("cloud visual observations are missing {field}"))?
        .iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| format!("cloud observation {field} item is invalid"))?;
            if object.len() != 2
                || !object.contains_key("label")
                || !object.contains_key("confidence")
            {
                return Err(format!(
                    "cloud observation {field} item has unexpected fields"
                ));
            }
            let label = observation_label(object.get("label").unwrap_or(&Value::Null), field)?;
            let confidence =
                observation_confidence(object.get("confidence").unwrap_or(&Value::Null), field)?;
            Ok(json!({ "label": label, "confidence": confidence }))
        })
        .collect()
}

fn parse_cloud_observations(content: &str) -> Result<Value, String> {
    let payload = cloud_json(content)?;
    let payload_object = payload
        .as_object()
        .ok_or("cloud response must be a JSON object")?;
    if payload_object.len() != 1 || !payload_object.contains_key("visualObservations") {
        return Err("cloud response must contain only visual observations".to_string());
    }
    let observations = payload
        .get("visualObservations")
        .filter(|value| value.is_object())
        .ok_or("cloud response is missing visual observations")?;
    let observation_object = observations.as_object().expect("object checked above");
    let required_observation_fields = [
        "readability",
        "subjects",
        "objects",
        "contexts",
        "intentionalMotion",
        "quality",
        "portrait",
        "composition",
    ];
    if observation_object.len() != required_observation_fields.len()
        || required_observation_fields
            .iter()
            .any(|field| !observation_object.contains_key(*field))
    {
        return Err("cloud visual observations have missing or unexpected fields".to_string());
    }
    let readability = observations
        .get("readability")
        .filter(|value| value.is_object())
        .ok_or("cloud visual observations are missing image readability")?;
    let readability_object = readability.as_object().expect("object checked above");
    if readability_object.len() != 2
        || !readability_object.contains_key("readable")
        || !readability_object.contains_key("confidence")
    {
        return Err("cloud image readability has unexpected fields".to_string());
    }
    let readable = readability
        .get("readable")
        .and_then(Value::as_bool)
        .ok_or("cloud image readability observation is invalid")?;
    let readability_confidence = observation_confidence(
        readability.get("confidence").unwrap_or(&Value::Null),
        "readability",
    )?;
    let mut detections = observation_array(observations, "subjects")?;
    detections.extend(observation_array(observations, "objects")?);
    let contexts = observation_array(observations, "contexts")?;
    let motion = observations
        .get("intentionalMotion")
        .filter(|value| value.is_object())
        .ok_or("cloud visual observations are missing intentional motion")?;
    let motion_object = motion.as_object().expect("object checked above");
    if motion_object.len() != 2
        || !motion_object.contains_key("present")
        || !motion_object.contains_key("confidence")
    {
        return Err("cloud intentional motion has unexpected fields".to_string());
    }
    let intentional_motion = motion
        .get("present")
        .and_then(Value::as_bool)
        .ok_or("cloud intentional motion observation is invalid")?;
    let motion_confidence = observation_confidence(
        motion.get("confidence").unwrap_or(&Value::Null),
        "intentional motion",
    )?;
    let quality = observations.get("quality").unwrap_or(&Value::Null);
    exact_object_fields(
        quality,
        &["globalSharpness", "subjectSharpness", "exposure"],
        "quality",
    )?;
    let global_sharpness = trusted_score(&quality["globalSharpness"], "global sharpness")?;
    let subject_sharpness = trusted_score(&quality["subjectSharpness"], "subject sharpness")?;
    let exposure = &quality["exposure"];
    exact_object_fields(
        exposure,
        &[
            "shadowClipRatio",
            "highlightClipRatio",
            "lowLight",
            "confidence",
        ],
        "exposure",
    )?;
    let shadow_clip = observation_ratio(&exposure["shadowClipRatio"], "shadow clipping")?;
    let highlight_clip = observation_ratio(&exposure["highlightClipRatio"], "highlight clipping")?;
    let low_light = exposure["lowLight"]
        .as_bool()
        .ok_or("cloud exposure lowLight is invalid")?;
    let exposure_confidence = observation_confidence(&exposure["confidence"], "exposure")?;

    let portrait = observations.get("portrait").unwrap_or(&Value::Null);
    exact_object_fields(
        portrait,
        &[
            "faceDetected",
            "faceSizePixels",
            "eyesOpen",
            "expression",
            "faceSharpness",
        ],
        "portrait",
    )?;
    let face_detected = portrait["faceDetected"]
        .as_bool()
        .ok_or("cloud portrait faceDetected is invalid")?;
    let face_size: Option<u64> = if portrait["faceSizePixels"].is_null() {
        None
    } else {
        Some(
            portrait["faceSizePixels"]
                .as_u64()
                .filter(|value| *value <= 100_000)
                .ok_or("cloud portrait faceSizePixels is invalid")?,
        )
    };
    if face_detected && face_size.is_none() {
        return Err("cloud portrait face size is required when a face is detected".to_string());
    }
    let eyes_open = if portrait["eyesOpen"].is_null() {
        None
    } else {
        Some(
            portrait["eyesOpen"]
                .as_bool()
                .ok_or("cloud portrait eyesOpen is invalid")?,
        )
    };
    let expression = portrait["expression"]
        .as_str()
        .filter(|value| matches!(*value, "usable" | "unusual" | "unknown"))
        .ok_or("cloud portrait expression is invalid")?;
    let face_sharpness = trusted_score(&portrait["faceSharpness"], "face sharpness")?;

    let composition = observations.get("composition").unwrap_or(&Value::Null);
    exact_object_fields(
        composition,
        &["score", "confidence", "issues"],
        "composition",
    )?;
    let composition_score = observation_ratio(&composition["score"], "composition score")?;
    let composition_confidence = observation_confidence(&composition["confidence"], "composition")?;
    let composition_issues = composition["issues"]
        .as_array()
        .ok_or("cloud composition issues are invalid")?
        .iter()
        .map(|issue| observation_label(issue, "composition issue"))
        .collect::<Result<Vec<_>, _>>()?;

    let readability_is_trusted = readability_confidence >= TRUSTED_CLOUD_OBSERVATION_CONFIDENCE;
    let mut signals = json!({
        "readable": if readability_is_trusted { readable } else { true },
        "readabilityConfidence": readability_confidence,
        "detections": detections,
        "contexts": contexts,
        "intentionalMotion": intentional_motion,
        "intentionalMotionConfidence": motion_confidence,
        "providerObservationStatus": if readability_is_trusted { "ready" } else { "low-confidence" },
        "faceModelStatus": "ready",
        "faceSizePixels": face_size,
        "eyesOpen": eyes_open,
        "expression": expression,
        "lowLight": low_light,
        "compositionScore": if composition_confidence >= TRUSTED_CLOUD_OBSERVATION_CONFIDENCE { Some(composition_score) } else { None },
        "compositionIssues": composition_issues,
        "quality": {}
    });
    if let Some(score) = global_sharpness {
        signals["quality"]["laplacianVariance"] = json!(score * 100.0);
    }
    if exposure_confidence >= TRUSTED_CLOUD_OBSERVATION_CONFIDENCE {
        signals["quality"]["shadowClipRatio"] = json!(shadow_clip);
        signals["quality"]["highlightClipRatio"] = json!(highlight_clip);
    }
    if let Some(score) = subject_sharpness {
        signals["subjectFocus"] = json!(score * 100.0);
    }
    if let Some(score) = face_sharpness {
        signals["faceFocus"] = json!(score * 100.0);
    }
    Ok(signals)
}

fn unavailable_cloud_signals(error: impl Into<String>) -> Value {
    json!({
        "detectorStatus": "unavailable",
        "providerObservationStatus": "unavailable",
        "providerObservationError": error.into()
    })
}

fn cloud_failure_result(
    python_evaluated_fallback: &Value,
    provider: &str,
    model: &str,
    error: &str,
) -> Value {
    let mut result = python_evaluated_fallback.clone();
    result["backend"] = json!("cloud");
    result["signals"] = unavailable_cloud_signals(error);
    result["signals"]["provider"] = json!(provider);
    result["signals"]["model"] = json!(model);
    result
}

#[cfg(test)]
fn cloud_signals_or_unavailable(content: &str) -> Value {
    parse_cloud_observations(content).unwrap_or_else(unavailable_cloud_signals)
}

fn policy_evaluation_request(request_id: &str, preset: &str, signals: Value) -> Value {
    json!({
        "id": request_id,
        "command": "evaluate",
        "preset": preset,
        "signals": signals
    })
}

async fn persist_analysis_result(
    repository: &SqliteProjectRepository,
    project_id: &str,
    run_id: &str,
    asset_id: &str,
    result: &Value,
) -> Result<(), String> {
    let disposition = evaluated_disposition(result)?;
    let reasons = serde_json::to_string(&result["reasons"]).map_err(|error| error.to_string())?;
    let mut transaction = repository
        .pool()
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let actual_backend = match result["backend"].as_str() {
        Some("cloud") => "cloud",
        Some(value) if value.contains("CUDA") => "gpu",
        _ => "cpu",
    };
    sqlx::query("UPDATE analysis_runs SET backend = ? WHERE id = ?")
        .bind(actual_backend)
        .bind(run_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query(
        r#"
        UPDATE decisions
        SET ai_disposition = ?, reasons_json = ?, changed_at = ?, actor = 'system'
        WHERE asset_id = ?
          AND EXISTS (SELECT 1 FROM assets WHERE id = ? AND project_id = ?)
        "#,
    )
    .bind(disposition)
    .bind(reasons)
    .bind(timestamp())
    .bind(asset_id)
    .bind(asset_id)
    .bind(project_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM tags WHERE asset_id = ? AND source = 'ai'")
        .bind(asset_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    for tag in automatic_tags(result) {
        sqlx::query(
            "INSERT OR IGNORE INTO tags (id, asset_id, name, namespace, source, confidence, created_at) VALUES (?, ?, ?, 'ai', 'ai', ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(asset_id)
        .bind(tag)
        .bind(0.72_f64)
        .bind(timestamp())
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    }
    sqlx::query("DELETE FROM signals WHERE run_id = ? AND asset_id = ?")
        .bind(run_id)
        .bind(asset_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(evidence) = result["evidence"].as_array() {
        for (index, signal) in evidence.iter().enumerate() {
            let kind = format!(
                "evidence.{index}.{}",
                signal["label"]
                    .as_str()
                    .unwrap_or("signal")
                    .to_ascii_lowercase()
                    .replace(' ', "-")
            );
            sqlx::query(
                r#"
                INSERT INTO signals (
                  id, asset_id, run_id, kind, confidence, region_json, evidence_json, created_at
                ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(asset_id)
            .bind(run_id)
            .bind(kind)
            .bind(signal["confidence"].as_f64())
            .bind(serde_json::to_string(signal).map_err(|error| error.to_string())?)
            .bind(timestamp())
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }
    }
    sqlx::query(
        r#"
        INSERT INTO signals (
          id, asset_id, run_id, kind, region_json, evidence_json, created_at
        ) VALUES (?, ?, ?, 'quality.metrics', '{}', ?, ?)
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(asset_id)
    .bind(run_id)
    .bind(serde_json::to_string(&result["signals"]).map_err(|error| error.to_string())?)
    .bind(timestamp())
    .execute(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn evaluated_disposition(result: &Value) -> Result<&str, String> {
    match result.get("aiDisposition").and_then(Value::as_str) {
        Some(disposition @ ("keep" | "review" | "reject")) => Ok(disposition),
        _ => Err("AI worker returned a missing or invalid disposition".to_string()),
    }
}

fn evaluated_result_or_fallback(
    result: Result<Value, String>,
    python_evaluated_fallback: &Value,
) -> Value {
    result.unwrap_or_else(|_| python_evaluated_fallback.clone())
}

fn automatic_tags(result: &Value) -> Vec<String> {
    let mut tags = BTreeSet::new();
    for raw in result["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .chain(
            result["reasons"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str),
        )
    {
        let normalized = raw
            .to_ascii_lowercase()
            .replace(':', "-")
            .replace('_', "-")
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
            .collect::<String>();
        let normalized = normalized.trim_matches('-');
        if !normalized.is_empty() {
            tags.insert(normalized.to_string());
        }
    }
    tags.into_iter().collect()
}

async fn recover_cached_media(state: &AppState, asset_id: &str) -> Option<CachedMedia> {
    let repository = state.repository.as_ref()?;
    let row = sqlx::query(
        "SELECT project_id, source_path, preview_cache_path, display_cache_path FROM assets WHERE id = ? LIMIT 1",
    )
    .bind(asset_id)
    .fetch_optional(repository.pool())
    .await
    .ok()??;
    let stored_thumbnail = row
        .get::<Option<String>, _>("preview_cache_path")
        .map(PathBuf::from);
    let stored_display = row
        .get::<Option<String>, _>("display_cache_path")
        .map(PathBuf::from);
    if let Some(thumbnail) = stored_thumbnail.filter(|path| path.is_file()) {
        let display = stored_display.filter(|path| path.is_file());
        let media = CachedMedia { thumbnail, display };
        state
            .media
            .write()
            .await
            .insert(asset_id.to_string(), media.clone());
        return Some(media);
    }

    let project_id = row.get::<String, _>("project_id");
    let source = PathBuf::from(row.get::<String, _>("source_path"));
    if !source.is_file() || !is_indexable_proxy(&source) {
        return None;
    }
    let _permit = state.preview_requests.acquire().await.ok()?;
    let cache_dir = state.cache_dir.clone();
    let asset_id_for_job = asset_id.to_string();
    let project_id_for_job = project_id.clone();
    let (thumbnail, display) = tokio::task::spawn_blocking(move || {
        generate_proxy_caches(&source, &cache_dir, &project_id_for_job, &asset_id_for_job)
    })
    .await
    .ok()?;
    repository
        .update_asset_cache(
            &project_id,
            asset_id,
            thumbnail.as_deref(),
            display.as_deref(),
            if thumbnail.is_some() {
                "ready"
            } else {
                "failed"
            },
        )
        .await
        .ok()?;
    let thumbnail = PathBuf::from(thumbnail?);
    let display = display.map(PathBuf::from).filter(|path| path.is_file());
    let media = CachedMedia { thumbnail, display };
    state
        .media
        .write()
        .await
        .insert(asset_id.to_string(), media.clone());
    Some(media)
}

async fn media(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response<Body> {
    let wants_display = query.get("variant").is_some_and(|value| value == "display");
    let cached = state.media.read().await.get(&asset_id).cloned();
    let cached = match cached {
        Some(media) => Some(media),
        None => recover_cached_media(&state, &asset_id).await,
    };
    let path = cached.map(|media| {
        if wants_display {
            media
                .display
                .clone()
                .unwrap_or_else(|| media.thumbnail.clone())
        } else {
            media.thumbnail.clone()
        }
    });
    let Some(path) = path else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .body(Body::from_stream(ReaderStream::new(file)))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn database_path() -> PathBuf {
    if let Ok(path) = std::env::var("FRAMESCOUT_DB") {
        return PathBuf::from(path);
    }
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.framescout.desktop")
        .join("framescout.db")
}

fn analysis_profile_path() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.framescout.desktop")
        .join("analysis-profile.json")
}

fn load_analysis_profile() -> AnalysisProfileSelection {
    std::fs::read(analysis_profile_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(AnalysisProfileSelection {
            profile_id: "local-gpu-quality".to_string(),
            endpoint: None,
            model: None,
            execution_mode: default_execution_mode(),
            cloud_budget_cents: 0,
            cloud_concurrency: default_cloud_concurrency(),
        })
}

async fn save_analysis_profile(selection: &AnalysisProfileSelection) -> Result<(), String> {
    let path = analysis_profile_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    // This file contains only non-secret routing preferences. API keys stay in the terminal environment.
    tokio::fs::write(
        path,
        serde_json::to_vec_pretty(selection).map_err(|error| error.to_string())?,
    )
    .await
    .map_err(|error| error.to_string())
}

fn ai_config() -> AiConfig {
    let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let python = std::env::var_os("FRAMESCOUT_AI_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("apps/ai-worker/.venv/Scripts/python.exe"));
    let quality_model = std::env::var_os("FRAMESCOUT_AI_MODEL")
        .map(PathBuf::from)
        .unwrap_or_else(|| model_directory(&root).join("yolox_s.onnx"));
    let fast_model = std::env::var_os("FRAMESCOUT_AI_FAST_MODEL")
        .map(PathBuf::from)
        .unwrap_or_else(|| model_directory(&root).join("yolox_nano.onnx"));
    AiConfig {
        python,
        quality_model,
        fast_model,
    }
}

fn model_directory(root: &FilePath) -> PathBuf {
    if let Some(path) = std::env::var_os("FRAMESCOUT_MODELS_DIR") {
        return PathBuf::from(path);
    }
    let installed = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FrameScout")
        .join("models");
    if installed.is_dir() {
        return installed;
    }
    root.join("models")
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn placeholder_preview() -> &'static str {
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%2313171c'/%3E%3C/svg%3E"
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use framescout_storage::{NewAsset, NewProject, ProjectPreset};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;

    #[tokio::test]
    async fn health_reports_bounded_web_service() {
        let Json(payload) = health().await;
        assert_eq!(payload["status"], "ready");
        assert_eq!(payload["workerThreads"], 2);
        assert_eq!(payload["sourcePhotosMutable"], false);
    }

    #[test]
    fn cloud_prompt_requests_observations_not_an_unchecked_verdict() {
        let prompt = cloud_analysis_prompt("motorsport", "motorsport", 1);

        assert!(prompt.contains("visual observations"));
        assert!(prompt.contains("subjects"));
        assert!(prompt.contains("objects"));
        assert!(prompt.contains("contexts"));
        assert!(prompt.contains("image readability"));
        assert!(prompt.contains("intentional motion"));
        assert!(prompt.contains("confidence"));
        assert!(!prompt.contains("aiDisposition"));
        assert!(!prompt.contains("decide the final human selection"));
    }

    #[test]
    fn cloud_observations_are_validated_and_normalized_without_a_disposition() {
        let signals = parse_cloud_observations(
            r#"```json
            {
              "visualObservations": {
                "readability": {"readable": true, "confidence": 0.99},
                "subjects": [{"label": "person", "confidence": 0.91}],
                "objects": [{"label": "car", "confidence": 0.94}],
                "contexts": [{"label": "track", "confidence": 0.88}],
                "intentionalMotion": {"present": true, "confidence": 0.86},
                "quality": {
                  "globalSharpness": null,
                  "subjectSharpness": null,
                  "exposure": {"shadowClipRatio": 0.1, "highlightClipRatio": 0.1, "lowLight": false, "confidence": 0.5}
                },
                "portrait": {"faceDetected": false, "faceSizePixels": null, "eyesOpen": null, "expression": "unknown", "faceSharpness": null},
                "composition": {"score": 0.5, "confidence": 0.5, "issues": []}
              }
            }
            ```"#,
        )
        .unwrap();

        assert_eq!(signals["readable"], true);
        assert_eq!(signals["detections"].as_array().unwrap().len(), 2);
        assert_eq!(signals["contexts"][0]["label"], "track");
        assert_eq!(signals["intentionalMotion"], true);
        assert!(signals.get("aiDisposition").is_none());
    }

    #[test]
    fn cloud_portrait_quality_observations_feed_strategy_signals() {
        let signals = parse_cloud_observations(
            r#"{
              "visualObservations": {
                "readability": {"readable": true, "confidence": 0.99},
                "subjects": [{"label": "person", "confidence": 0.96}],
                "objects": [],
                "contexts": [{"label": "environmental portrait", "confidence": 0.82}],
                "intentionalMotion": {"present": false, "confidence": 0.90},
                "quality": {
                  "globalSharpness": {"score": 0.84, "confidence": 0.92},
                  "subjectSharpness": {"score": 0.78, "confidence": 0.91},
                  "exposure": {"shadowClipRatio": 0.08, "highlightClipRatio": 0.02, "lowLight": false, "confidence": 0.88}
                },
                "portrait": {
                  "faceDetected": true,
                  "faceSizePixels": 180,
                  "eyesOpen": true,
                  "expression": "usable",
                  "faceSharpness": {"score": 0.81, "confidence": 0.90}
                },
                "composition": {"score": 0.76, "confidence": 0.80, "issues": []}
              }
            }"#,
        )
        .unwrap();

        assert_eq!(signals["quality"]["laplacianVariance"], 84.0);
        assert_eq!(signals["subjectFocus"], 78.0);
        assert_eq!(signals["faceModelStatus"], "ready");
        assert_eq!(signals["faceSizePixels"], 180);
        assert_eq!(signals["eyesOpen"], true);
        assert_eq!(signals["expression"], "usable");
        assert_eq!(signals["faceFocus"], 81.0);
        assert_eq!(signals["compositionScore"], 0.76);
        assert!(signals.get("aiDisposition").is_none());
    }

    #[test]
    fn invalid_or_verdict_only_cloud_json_becomes_unavailable_observations() {
        let signals =
            cloud_signals_or_unavailable(r#"{"aiDisposition":"reject","reasons":["motion_blur"]}"#);

        assert_eq!(signals["detectorStatus"], "unavailable");
        assert_eq!(signals["providerObservationStatus"], "unavailable");
        assert!(signals.get("aiDisposition").is_none());
        assert!(parse_cloud_observations("This photo looks usable.").is_err());
    }

    #[test]
    fn cloud_observations_reject_extra_provider_decision_fields() {
        let content = r#"{
          "visualObservations": {
            "readability": {"readable": true, "confidence": 0.99},
            "subjects": [],
            "objects": [],
            "contexts": [],
            "intentionalMotion": {"present": false, "confidence": 0.90},
            "quality": {
              "globalSharpness": null,
              "subjectSharpness": null,
              "exposure": {"shadowClipRatio": 0.1, "highlightClipRatio": 0.1, "lowLight": false, "confidence": 0.5}
            },
            "portrait": {"faceDetected": false, "faceSizePixels": null, "eyesOpen": null, "expression": "unknown", "faceSharpness": null},
            "composition": {"score": 0.5, "confidence": 0.5, "issues": []}
          },
          "decision": "reject"
        }"#;

        assert!(parse_cloud_observations(content).is_err());
    }

    #[test]
    fn cloud_signals_are_sent_to_the_python_policy_evaluator() {
        let request = policy_evaluation_request(
            "asset-1",
            "motorsport",
            json!({"readable": true, "detections": []}),
        );

        assert_eq!(request["id"], "asset-1");
        assert_eq!(request["command"], "evaluate");
        assert_eq!(request["preset"], "motorsport");
        assert!(request["signals"].is_object());
        assert!(request.get("aiDisposition").is_none());
    }

    #[test]
    fn persistence_requires_an_evaluator_disposition() {
        assert!(evaluated_disposition(&json!({})).is_err());
        assert!(evaluated_disposition(&json!({"aiDisposition": "maybe"})).is_err());
        assert_eq!(
            evaluated_disposition(&json!({"aiDisposition": "review"})).unwrap(),
            "review"
        );
    }

    #[test]
    fn policy_worker_failure_uses_a_python_evaluated_fallback() {
        let fallback = json!({
            "strategyId": "motorsport",
            "strategyVersion": 1,
            "aiDisposition": "review"
        });
        let evaluated = json!({
            "strategyId": "motorsport",
            "strategyVersion": 1,
            "aiDisposition": "keep"
        });

        assert_eq!(
            evaluated_result_or_fallback(Err("worker stopped".to_string()), &fallback),
            fallback
        );
        assert_eq!(
            evaluated_result_or_fallback(Ok(evaluated.clone()), &fallback),
            evaluated
        );
    }

    #[test]
    fn cloud_request_failure_becomes_an_explicit_review_result() {
        let fallback = json!({
            "strategyId": "portrait",
            "strategyVersion": 1,
            "aiDisposition": "review",
            "reasons": ["provider_unavailable"]
        });

        let result = cloud_failure_result(&fallback, "qwen", "qwen3-vl-plus", "timeout");

        assert_eq!(result["aiDisposition"], "review");
        assert_eq!(result["backend"], "cloud");
        assert_eq!(
            result["signals"]["providerObservationStatus"],
            "unavailable"
        );
        assert_eq!(result["signals"]["provider"], "qwen");
        assert_eq!(result["signals"]["model"], "qwen3-vl-plus");
    }

    #[test]
    fn cloud_execution_preferences_reject_invalid_limits_and_keep_safe_defaults() {
        assert_eq!(
            parse_cloud_execution_preferences(&json!({})).unwrap(),
            CloudExecutionPreferences {
                execution_mode: "local".to_string(),
                cloud_budget_cents: 0,
                cloud_concurrency: 2,
            }
        );
        assert!(parse_cloud_execution_preferences(&json!({ "executionMode": "remote" })).is_err());
        assert!(
            parse_cloud_execution_preferences(&json!({ "cloudBudgetCents": 100_001 })).is_err()
        );
        assert!(parse_cloud_execution_preferences(&json!({ "cloudConcurrency": 5 })).is_err());
    }

    #[test]
    fn partial_profile_update_preserves_existing_cloud_limits() {
        let current = CloudExecutionPreferences {
            execution_mode: "cloud".to_string(),
            cloud_budget_cents: 500,
            cloud_concurrency: 3,
        };

        assert_eq!(
            merge_cloud_execution_preferences(&json!({ "executionMode": "hybrid" }), &current)
                .unwrap(),
            CloudExecutionPreferences {
                execution_mode: "hybrid".to_string(),
                cloud_budget_cents: 500,
                cloud_concurrency: 3,
            }
        );
    }

    #[test]
    fn execution_mode_rejects_an_incompatible_model_provider() {
        assert!(validate_execution_profile("local", "local").is_ok());
        assert!(validate_execution_profile("cloud", "qwen").is_ok());
        assert!(validate_execution_profile("hybrid", "openai-compatible").is_ok());
        assert!(validate_execution_profile("cloud", "local").is_err());
        assert!(validate_execution_profile("local", "qwen").is_err());
    }

    #[test]
    fn cloud_plan_caps_work_at_the_configured_budget_and_concurrency() {
        let plan = cloud_work_plan(10, 12, 30, 8).unwrap();

        assert_eq!(plan.asset_limit, 2);
        assert_eq!(plan.estimated_budget_cents, 24);
        assert_eq!(plan.concurrency, 4);
        assert!(plan.budget_exhausted);
        assert!(cloud_work_plan(10, 12, 0, 2).is_err());
    }

    #[test]
    fn browser_commands_only_accept_the_framescout_web_origin() {
        assert!(is_trusted_browser_origin(None, None));
        assert!(is_trusted_browser_origin(
            Some("http://127.0.0.1:5173"),
            None
        ));
        assert!(is_trusted_browser_origin(
            Some("http://localhost:5173"),
            None
        ));
        assert!(!is_trusted_browser_origin(
            Some("https://attacker.example"),
            None
        ));
        assert!(is_trusted_browser_origin(
            Some("http://127.0.0.1:4400"),
            Some("http://127.0.0.1:4400")
        ));
    }

    #[test]
    fn project_cloud_budget_is_reduced_by_prior_sent_requests() {
        assert_eq!(remaining_cloud_asset_slots(500, 2, 120).unwrap(), 130);
        assert_eq!(remaining_cloud_asset_slots(500, 2, 250).unwrap(), 0);
        assert!(remaining_cloud_asset_slots(0, 2, 0).is_err());
    }

    #[test]
    fn low_confidence_unreadable_observation_cannot_trigger_rejection() {
        let signals = parse_cloud_observations(
            r#"{
              "visualObservations": {
                "readability": {"readable": false, "confidence": 0.2},
                "subjects": [], "objects": [], "contexts": [],
                "intentionalMotion": {"present": false, "confidence": 0.2},
                "quality": {
                  "globalSharpness": null, "subjectSharpness": null,
                  "exposure": {"shadowClipRatio": 0.0, "highlightClipRatio": 0.0, "lowLight": false, "confidence": 0.2}
                },
                "portrait": {"faceDetected": false, "faceSizePixels": null, "eyesOpen": null, "expression": "unknown", "faceSharpness": null},
                "composition": {"score": 0.5, "confidence": 0.2, "issues": []}
              }
            }"#,
        )
        .unwrap();

        assert_eq!(signals["readable"], true);
        assert_eq!(signals["providerObservationStatus"], "low-confidence");
    }

    #[test]
    fn cloud_retry_and_failure_rules_fail_closed() {
        assert!(is_transient_cloud_status(408));
        assert!(is_transient_cloud_status(429));
        assert!(is_transient_cloud_status(503));
        assert!(!is_transient_cloud_status(400));
        assert!(!is_transient_cloud_status(401));
        assert_eq!(cloud_failure_disposition(), "review");
    }

    #[test]
    fn cloud_resume_reuses_only_matching_failed_or_stale_runs() {
        assert_eq!(
            resumable_cloud_run_id(
                "qwen",
                "qwen-cloud:qwen3-vl-plus",
                Some(("run-1", "failed", "qwen-cloud:qwen3-vl-plus")),
            ),
            Some("run-1".to_string())
        );
        assert_eq!(
            resumable_cloud_run_id(
                "qwen",
                "qwen-cloud:qwen3-vl-plus",
                Some(("run-1", "completed", "qwen-cloud:qwen3-vl-plus")),
            ),
            None
        );
        assert_eq!(
            resumable_cloud_run_id(
                "local",
                "local-gpu-fast:yolox_nano",
                Some(("run-2", "failed", "local-gpu-fast:yolox_nano")),
            ),
            None
        );
    }

    #[test]
    fn cloud_resume_skips_persisted_assets_inside_the_budget_window() {
        let ids = vec![
            "a".to_string(),
            "b".to_string(),
            "c".to_string(),
            "d".to_string(),
        ];
        let completed = HashSet::from(["a".to_string(), "c".to_string()]);

        assert_eq!(pending_cloud_asset_ids(&ids, &completed, 3), vec!["b"]);
    }

    #[test]
    fn ignores_zero_byte_photo_candidates() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("empty.jpg");
        std::fs::write(&path, []).unwrap();

        assert!(is_supported_proxy(&path));
        assert!(!is_indexable_proxy(&path));
    }

    #[tokio::test]
    async fn media_route_regenerates_an_evicted_thumbnail_without_touching_source() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.png");
        let thumbnail = directory.path().join("evicted-thumbnail.jpg");
        image::RgbImage::from_pixel(24, 16, image::Rgb([24, 80, 140]))
            .save(&source)
            .unwrap();
        let source_before = std::fs::read(&source).unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        repository
            .create_project(NewProject {
                id: "media-project".to_string(),
                name: "Media recovery fixture".to_string(),
                preset: ProjectPreset::Custom,
                source_roots: vec![],
                settings_json: json!({}),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![NewAsset {
                    id: "media-asset".to_string(),
                    source_path: source.to_string_lossy().to_string(),
                    file_fingerprint: "media::1".to_string(),
                    preview_state: "ready".to_string(),
                    exif_json: json!({}),
                    thumbnail_cache_path: Some(thumbnail.to_string_lossy().to_string()),
                    display_cache_path: None,
                    mapped_master_path: None,
                    mapping_status: "proxy_only".to_string(),
                    mapping_method: "none".to_string(),
                    mapping_confidence: "unresolved".to_string(),
                }],
            })
            .await
            .unwrap();
        let state = AppState {
            repository: Some(repository),
            media: Arc::new(RwLock::new(HashMap::new())),
            cache_dir: directory.path().join("cache"),
            ingest_jobs: Arc::new(Mutex::new(HashSet::new())),
            running_analysis: Arc::new(Mutex::new(HashSet::new())),
            running_metadata: Arc::new(Mutex::new(HashSet::new())),
            preview_requests: Arc::new(Semaphore::new(2)),
            ai: ai_config(),
            analysis_profile: Arc::new(RwLock::new(AnalysisProfileSelection {
                profile_id: "local-gpu-quality".to_string(),
                endpoint: None,
                model: None,
                execution_mode: default_execution_mode(),
                cloud_budget_cents: 0,
                cloud_concurrency: default_cloud_concurrency(),
            })),
            cloud_requests: Arc::new(Semaphore::new(usize::from(MAX_CLOUD_CONCURRENCY))),
            public_base_url: "http://127.0.0.1:4310".to_string(),
            trusted_web_origin: None,
        };

        let response = media(
            State(state.clone()),
            Path("media-asset".to_string()),
            Query(HashMap::new()),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        let restored = state
            .repository
            .as_ref()
            .unwrap()
            .list_assets("media-project")
            .await
            .unwrap();
        assert!(restored[0]
            .thumbnail_cache_path
            .as_ref()
            .is_some_and(|path| FilePath::new(path).is_file()));
        assert_eq!(std::fs::read(&source).unwrap(), source_before);
    }

    #[tokio::test]
    async fn analysis_restores_an_evicted_proxy_without_touching_the_source() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.png");
        image::RgbImage::from_pixel(96, 64, image::Rgb([24, 80, 140]))
            .save(&source)
            .unwrap();
        let before = std::fs::read(&source).unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        repository
            .create_project(NewProject {
                id: "recovery-project".to_string(),
                name: "Recovery fixture".to_string(),
                preset: ProjectPreset::Custom,
                source_roots: vec![directory.path().to_string_lossy().to_string()],
                settings_json: json!({}),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![NewAsset {
                    id: "recovery-asset".to_string(),
                    source_path: source.to_string_lossy().to_string(),
                    file_fingerprint: "recovery::1".to_string(),
                    preview_state: "ready".to_string(),
                    exif_json: json!({}),
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
        let asset = repository
            .list_assets("recovery-project")
            .await
            .unwrap()
            .remove(0);
        ensure_analysis_proxy_caches(
            &repository,
            directory.path().join("cache").as_path(),
            "recovery-project",
            &[asset],
        )
        .await
        .unwrap();

        let restored = repository
            .list_assets("recovery-project")
            .await
            .unwrap()
            .remove(0);
        assert!(analysis_image_path(&restored).is_some());
        assert_eq!(std::fs::read(&source).unwrap(), before);
    }

    #[tokio::test]
    async fn analysis_progress_uses_the_run_snapshot_total() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        repository
            .create_project(NewProject {
                id: "progress-project".to_string(),
                name: "Progress fixture".to_string(),
                preset: ProjectPreset::Custom,
                source_roots: vec![],
                settings_json: json!({}),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![],
            })
            .await
            .unwrap();
        sqlx::query("INSERT INTO analysis_runs (id, project_id, backend, status, started_at, total_assets, error_message) VALUES ('run', 'progress-project', 'cpu', 'completed', ?, 17, 'analysis stopped early')")
            .bind(timestamp())
            .execute(repository.pool())
            .await
            .unwrap();

        let run = project_analysis_runs(&repository, "progress-project")
            .await
            .unwrap()
            .remove(0);
        assert_eq!(run["totalAssets"], 17);
        assert_eq!(run["previewsReady"], 0);
        assert_eq!(run["status"], "failed");
        assert_eq!(run["errorMessage"], "analysis stopped early");
    }

    #[test]
    fn lightweight_index_status_counts_without_serializing_assets() {
        let payload = index_status_payload(
            "project-1",
            "indexing",
            ["ready", "pending", "failed", "ready"].into_iter(),
        );

        assert_eq!(payload["projectId"], "project-1");
        assert_eq!(payload["state"], "indexing");
        assert_eq!(payload["discovered"], 4);
        assert_eq!(payload["indexed"], 3);
        assert_eq!(payload["previewsReady"], 2);
        assert_eq!(payload["failed"], 1);
        assert!(payload.get("assets").is_none());
    }

    #[test]
    fn lightweight_analysis_status_returns_only_the_latest_run() {
        let payload = analysis_status_payload(vec![
            json!({ "id": "older", "status": "completed" }),
            json!({ "id": "latest", "status": "running" }),
        ]);

        assert_eq!(payload["run"]["id"], "latest");
        assert!(payload.get("project").is_none());
    }

    #[test]
    fn incomplete_analysis_cannot_be_marked_complete() {
        assert!(validate_analysis_completion(16, 17).is_err());
        assert!(validate_analysis_completion(17, 17).is_ok());
    }

    #[tokio::test]
    async fn cloud_proxy_is_reencoded_without_touching_the_input() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("proxy.png");
        image::RgbImage::from_pixel(64, 32, image::Rgb([24, 80, 140]))
            .save(&path)
            .unwrap();
        let before = tokio::fs::read(&path).await.unwrap();

        let data_url = cloud_proxy_data_url(&path).await.unwrap();

        assert!(data_url.starts_with("data:image/jpeg;base64,"));
        assert_eq!(tokio::fs::read(&path).await.unwrap(), before);
    }

    #[tokio::test]
    async fn cloud_request_ledger_counts_each_project_asset_only_once() {
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        repository
            .create_project(NewProject {
                id: "ledger-project".to_string(),
                name: "Ledger fixture".to_string(),
                preset: ProjectPreset::Custom,
                source_roots: vec![],
                settings_json: json!({}),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![NewAsset {
                    id: "ledger-asset".to_string(),
                    source_path: "proxy.jpg".to_string(),
                    file_fingerprint: "ledger::1".to_string(),
                    preview_state: "ready".to_string(),
                    exif_json: json!({}),
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
        sqlx::query("INSERT INTO analysis_runs (id, project_id, backend, status, started_at, total_assets) VALUES ('ledger-run', 'ledger-project', 'cloud', 'running', ?, 1)")
            .bind(timestamp())
            .execute(repository.pool())
            .await
            .unwrap();

        assert!(reserve_cloud_request(
            &repository,
            "ledger-project",
            "ledger-asset",
            "ledger-run",
            "qwen",
            "qwen3-vl-plus",
            2,
        )
        .await
        .unwrap());
        assert!(!reserve_cloud_request(
            &repository,
            "ledger-project",
            "ledger-asset",
            "ledger-run",
            "qwen",
            "qwen3-vl-plus",
            2,
        )
        .await
        .unwrap());
        assert_eq!(
            cloud_request_ledger(&repository, "ledger-project", "qwen", "qwen3-vl-plus")
                .await
                .unwrap()
                .get("ledger-asset")
                .map(String::as_str),
            Some("reserved")
        );
    }

    #[tokio::test]
    async fn mock_cloud_provider_receives_only_a_proxy_and_retries_rate_limits() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let observed = attempts.clone();
        let app = Router::new().route(
            "/",
            post(move |Json(payload): Json<Value>| {
                let observed = observed.clone();
                async move {
                    let image_url = payload
                        .pointer("/messages/0/content/0/image_url/url")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    assert!(image_url.starts_with("data:image/jpeg;base64,"));
                    assert!(!image_url.contains(".CR2"));
                    assert!(!image_url.contains(":\\"));
                    let attempt = observed.fetch_add(1, Ordering::SeqCst);
                    if attempt == 0 {
                        return (
                            StatusCode::TOO_MANY_REQUESTS,
                            Json(json!({ "error": { "message": "slow down" } })),
                        );
                    }
                    (
                        StatusCode::OK,
                        Json(json!({
                            "choices": [{ "message": { "content": "{\"visualObservations\":{}}" } }]
                        })),
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();

        let response = request_cloud_observations(
            &client,
            &format!("http://{address}/"),
            "test-key",
            "test-model",
            "data:image/jpeg;base64,ZmFrZS1wcm94eQ==".to_string(),
            "return observations".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(response, "{\"visualObservations\":{}}");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn mock_cloud_provider_retries_plain_text_transient_failures() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let observed = attempts.clone();
        let app = Router::new().route(
            "/",
            post(move || {
                let observed = observed.clone();
                async move {
                    if observed.fetch_add(1, Ordering::SeqCst) == 0 {
                        return (StatusCode::SERVICE_UNAVAILABLE, "temporarily unavailable");
                    }
                    (
                        StatusCode::OK,
                        r#"{"choices":[{"message":{"content":"{\"visualObservations\":{}}"}}]}"#,
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let response = request_cloud_observations(
            &reqwest::Client::new(),
            &format!("http://{address}/"),
            "test-key",
            "test-model",
            "data:image/jpeg;base64,ZmFrZQ==".to_string(),
            "return observations".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(response, "{\"visualObservations\":{}}");
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn cloud_run_persists_policy_result_and_project_budget_ledger() {
        let observed_requests = Arc::new(AtomicUsize::new(0));
        let observed = observed_requests.clone();
        let app = Router::new().route(
            "/",
            post(move |headers: HeaderMap, Json(payload): Json<Value>| {
                let observed = observed.clone();
                async move {
                    observed.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(
                        headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok()),
                        Some("Bearer test-key")
                    );
                    let serialized = payload.to_string();
                    assert!(serialized.contains("data:image/jpeg;base64,"));
                    assert!(!serialized.contains("secret-master.CR2"));
                    (
                        StatusCode::OK,
                        Json(json!({
                            "choices": [{ "message": { "content": r#"{
                              "visualObservations": {
                                "readability": {"readable": true, "confidence": 0.99},
                                "subjects": [{"label": "person", "confidence": 0.92}],
                                "objects": [], "contexts": [],
                                "intentionalMotion": {"present": false, "confidence": 0.9},
                                "quality": {
                                  "globalSharpness": null, "subjectSharpness": null,
                                  "exposure": {"shadowClipRatio": 0.01, "highlightClipRatio": 0.01, "lowLight": false, "confidence": 0.9}
                                },
                                "portrait": {"faceDetected": false, "faceSizePixels": null, "eyesOpen": null, "expression": "unknown", "faceSharpness": null},
                                "composition": {"score": 0.7, "confidence": 0.8, "issues": []}
                              }
                            }"# } }]
                        })),
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let directory = tempdir().unwrap();
        let proxy = directory.path().join("proxy.jpg");
        image::RgbImage::from_pixel(64, 32, image::Rgb([24, 80, 140]))
            .save(&proxy)
            .unwrap();
        let source_before = std::fs::read(&proxy).unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        repository
            .create_project(NewProject {
                id: "cloud-project".to_string(),
                name: "Cloud fixture".to_string(),
                preset: ProjectPreset::Custom,
                source_roots: vec![],
                settings_json: json!({}),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![NewAsset {
                    id: "cloud-asset".to_string(),
                    source_path: proxy.to_string_lossy().to_string(),
                    file_fingerprint: "cloud::1".to_string(),
                    preview_state: "ready".to_string(),
                    exif_json: json!({}),
                    thumbnail_cache_path: Some(proxy.to_string_lossy().to_string()),
                    display_cache_path: None,
                    mapped_master_path: Some("G:\\private\\secret-master.CR2".to_string()),
                    mapping_status: "mapped".to_string(),
                    mapping_method: "same_folder".to_string(),
                    mapping_confidence: "exact".to_string(),
                }],
            })
            .await
            .unwrap();
        sqlx::query("INSERT INTO analysis_runs (id, project_id, model_bundle_version, backend, status, started_at, total_assets) VALUES ('cloud-run', 'cloud-project', 'custom-cloud:test-model', 'cloud', 'running', ?, 1)")
            .bind(timestamp())
            .execute(repository.pool())
            .await
            .unwrap();
        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let state = AppState {
            repository: Some(repository.clone()),
            media: Arc::new(RwLock::new(HashMap::new())),
            cache_dir: directory.path().join("cache"),
            ingest_jobs: Arc::new(Mutex::new(HashSet::new())),
            running_analysis: Arc::new(Mutex::new(HashSet::new())),
            running_metadata: Arc::new(Mutex::new(HashSet::new())),
            preview_requests: Arc::new(Semaphore::new(2)),
            ai: AiConfig {
                python: workspace_root.join("apps/ai-worker/.venv/Scripts/python.exe"),
                quality_model: workspace_root.join("models/yolox_s.onnx"),
                fast_model: workspace_root.join("models/yolox_nano.onnx"),
            },
            analysis_profile: Arc::new(RwLock::new(AnalysisProfileSelection {
                profile_id: "custom-cloud".to_string(),
                endpoint: Some(format!("http://{address}/")),
                model: Some("test-model".to_string()),
                execution_mode: "cloud".to_string(),
                cloud_budget_cents: 10,
                cloud_concurrency: 2,
            })),
            cloud_requests: Arc::new(Semaphore::new(4)),
            public_base_url: "http://127.0.0.1:4310".to_string(),
            trusted_web_origin: None,
        };
        let profile = ActiveAnalysisProfile {
            id: "custom-cloud".to_string(),
            provider: "openai-compatible".to_string(),
            model: "test-model".to_string(),
            backend: "cloud".to_string(),
            model_path: None,
            endpoint: Some(format!("http://{address}/")),
            api_key: Some("test-key".to_string()),
            cloud_budget_cents: 10,
            cloud_concurrency: 2,
            estimated_cents_per_asset: 2,
            execution_mode: "cloud".to_string(),
        };
        let assets = repository.list_assets("cloud-project").await.unwrap();

        run_cloud_analysis(
            &state,
            "custom",
            &assets,
            "cloud-project",
            "cloud-run",
            &profile,
        )
        .await
        .unwrap();

        assert_eq!(observed_requests.load(Ordering::SeqCst), 1);
        assert_eq!(std::fs::read(&proxy).unwrap(), source_before);
        assert_eq!(
            cloud_request_ledger(
                &repository,
                "cloud-project",
                "openai-compatible",
                "test-model"
            )
            .await
            .unwrap()
            .get("cloud-asset")
            .map(String::as_str),
            Some("completed")
        );
        let disposition: String = sqlx::query_scalar(
            "SELECT ai_disposition FROM decisions WHERE asset_id = 'cloud-asset'",
        )
        .fetch_one(repository.pool())
        .await
        .unwrap();
        assert!(matches!(disposition.as_str(), "keep" | "review"));
        server.abort();
    }

    #[tokio::test]
    #[ignore = "requires the local ONNX model bundle"]
    async fn local_ai_analysis_persists_evidence_without_mutating_proxy() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let proxy = root.join("apps/desktop/public/review-demo.jpg");
        let before = tokio::fs::read(&proxy).await.unwrap();
        let directory = tempdir().unwrap();
        let repository =
            SqliteProjectRepository::connect_file(directory.path().join("framescout.db"))
                .await
                .unwrap();
        repository.migrate().await.unwrap();
        repository
            .create_project(NewProject {
                id: "ai-project".to_string(),
                name: "AI fixture".to_string(),
                preset: ProjectPreset::Motorsport,
                source_roots: vec![proxy.parent().unwrap().to_string_lossy().to_string()],
                settings_json: json!({ "keepOriginalsUntouched": true, "backend": "gpu" }),
                app_version: "test".to_string(),
                indexing_state: "complete".to_string(),
                assets: vec![NewAsset {
                    id: "ai-asset".to_string(),
                    source_path: proxy.to_string_lossy().to_string(),
                    file_fingerprint: "ai-fixture::1".to_string(),
                    preview_state: "ready".to_string(),
                    exif_json: json!({}),
                    thumbnail_cache_path: None,
                    display_cache_path: Some(proxy.to_string_lossy().to_string()),
                    mapped_master_path: None,
                    mapping_status: "proxy_only".to_string(),
                    mapping_method: "none".to_string(),
                    mapping_confidence: "unresolved".to_string(),
                }],
            })
            .await
            .unwrap();
        let state = AppState {
            repository: Some(repository.clone()),
            media: Arc::new(RwLock::new(HashMap::new())),
            cache_dir: directory.path().join("proxy-cache"),
            ingest_jobs: Arc::new(Mutex::new(HashSet::new())),
            running_analysis: Arc::new(Mutex::new(HashSet::new())),
            running_metadata: Arc::new(Mutex::new(HashSet::new())),
            preview_requests: Arc::new(Semaphore::new(2)),
            ai: AiConfig {
                python: root.join("apps/ai-worker/.venv/Scripts/python.exe"),
                quality_model: root.join("models/yolox_s.onnx"),
                fast_model: root.join("models/yolox_nano.onnx"),
            },
            analysis_profile: Arc::new(RwLock::new(AnalysisProfileSelection {
                profile_id: "local-gpu-quality".to_string(),
                endpoint: None,
                model: None,
                execution_mode: default_execution_mode(),
                cloud_budget_cents: 0,
                cloud_concurrency: default_cloud_concurrency(),
            })),
            cloud_requests: Arc::new(Semaphore::new(usize::from(MAX_CLOUD_CONCURRENCY))),
            public_base_url: "http://127.0.0.1:4310".to_string(),
            trusted_web_origin: None,
        };

        enqueue_analysis(&state, &json!({ "projectId": "ai-project" }))
            .await
            .unwrap();
        for _ in 0..120 {
            let runs = project_analysis_runs(&repository, "ai-project")
                .await
                .unwrap();
            if runs.last().and_then(|run| run["status"].as_str()) == Some("completed") {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let project = load_active_project(&state).await.unwrap().unwrap();
        enqueue_analysis(&state, &json!({ "projectId": "ai-project" }))
            .await
            .unwrap();
        let runs_after_poll = project_analysis_runs(&repository, "ai-project")
            .await
            .unwrap();

        assert_eq!(project["analysisRuns"][0]["status"], "completed");
        assert_eq!(runs_after_poll.len(), 1);
        assert!(project["assets"][0]["evidence"].as_array().unwrap().len() >= 3);
        assert_eq!(project["assets"][0]["aiDisposition"], "keep");
        assert_eq!(tokio::fs::read(&proxy).await.unwrap(), before);
    }
}
