pub mod migrations;

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::Settings;

const DATA_DIR_NAME: &str = "IVIC_DATA";
const DB_FILE_NAME: &str = "ivic.sqlite";
const ATTACHMENT_DIR_NAME: &str = "attachments";

pub fn data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = install_dir(app)?.join(DATA_DIR_NAME);
    fs::create_dir_all(&dir)?;
    fs::create_dir_all(dir.join(ATTACHMENT_DIR_NAME))?;
    Ok(dir)
}

pub fn db_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(data_dir(app)?.join(DB_FILE_NAME))
}

pub fn attachment_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = data_dir(app)?.join(ATTACHMENT_DIR_NAME);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn default_settings(app: &AppHandle) -> AppResult<Settings> {
    Ok(Settings {
        database_path: db_path(app)?.to_string_lossy().to_string(),
        attachment_dir: attachment_dir(app)?.to_string_lossy().to_string(),
        dark_mode: false,
        check_updates: false,
        hide_amounts: false,
        last_backup_at: None,
    })
}

pub fn connect(app: &AppHandle) -> AppResult<Connection> {
    let conn = Connection::open(db_path(app)?)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

fn install_dir(_app: &AppHandle) -> AppResult<PathBuf> {
    let exe = std::env::current_exe()?;
    exe.parent().map(PathBuf::from).ok_or_else(|| {
        AppError::Message("failed to resolve application install directory".to_string())
    })
}
