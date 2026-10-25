mod commands;

use std::{
    collections::HashSet,
    fs,
    sync::{Arc, Mutex},
};

use framescout_storage::{ProjectRepository, SqliteProjectRepository};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

pub struct NativeProjectState {
    pub repository: SqliteProjectRepository,
    pub cache_dir: std::path::PathBuf,
    pub ingest_jobs: Arc<Mutex<HashSet<String>>>,
    pub cache_jobs: Arc<Mutex<HashSet<String>>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let (mut service_output, _service) = app
                .shell()
                .sidecar("framescout-local-service")
                .expect("bundled local service is unavailable")
                .spawn()
                .expect("failed to start bundled local service");
            tauri::async_runtime::spawn(
                async move { while service_output.recv().await.is_some() {} },
            );
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;
            let cache_dir = app_data_dir.join("proxy-cache");
            fs::create_dir_all(&cache_dir)?;
            app.asset_protocol_scope()
                .allow_directory(&cache_dir, true)?;
            let database_path = app_data_dir.join("framescout.db");
            let repository = tauri::async_runtime::block_on(
                SqliteProjectRepository::connect_file(database_path),
            )?;
            tauri::async_runtime::block_on(repository.migrate())?;
            app.manage(NativeProjectState {
                repository,
                cache_dir,
                ingest_jobs: Arc::new(Mutex::new(HashSet::new())),
                cache_jobs: Arc::new(Mutex::new(HashSet::new())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::project_create,
            commands::project::project_load_active,
            commands::project::project_save_snapshot,
            commands::project::mapping_set_manual,
            commands::project::analysis_enqueue,
            commands::project::selection_goal_set,
            commands::project::metadata_refresh,
            commands::project::review_next,
            commands::project::decision_set,
            commands::project::decision_set_batch,
            commands::project::tag_apply,
            commands::project::tag_apply_batch,
            commands::project::group_open,
            commands::project::export_preview,
            commands::project::export_commit
        ])
        .run(tauri::generate_context!())
        .expect("error while running FrameScout");
}
