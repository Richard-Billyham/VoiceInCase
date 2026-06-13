use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use tauri::AppHandle;

use crate::db;
use crate::errors::{AppError, AppResult};

pub fn ensure_inside(base: &Path, candidate: &Path) -> AppResult<PathBuf> {
    let base = base.canonicalize()?;
    let candidate = if candidate.exists() {
        candidate.canonicalize()?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| AppError::Message("invalid path".to_string()))?
            .canonicalize()?;
        parent.join(candidate.file_name().unwrap_or_default())
    };
    if !candidate.starts_with(&base) {
        return Err(AppError::Message(
            "path is outside the IVIC data directory".to_string(),
        ));
    }
    Ok(candidate)
}

pub fn backup_database(app: &AppHandle) -> AppResult<String> {
    let data_dir = db::data_dir(app)?;
    let backup_dir = data_dir.join("backups");
    fs::create_dir_all(&backup_dir)?;
    let source = db::db_path(app)?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let target = ensure_inside(&data_dir, &backup_dir.join(format!("ivic-{stamp}.sqlite")))?;
    if source.exists() {
        fs::copy(source, &target)?;
    } else {
        fs::write(&target, [])?;
    }
    Ok(stamp)
}
