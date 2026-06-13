mod loaders;

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use chrono::Local;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db;
use crate::errors::{AppError, AppResult};
use crate::files;
use crate::models::{
    AppData, DroppedFilePayload, ExpenseGroup, FormMatchPair, FormRecord, OcrInvoiceResult,
    ReconciliationTransaction, ReimbursementBatch, Settings, UploadedAttachmentPayload,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    has_update: bool,
    current_version: String,
    latest_version: String,
    message: String,
}

#[tauri::command]
pub fn load_app_data(app: AppHandle) -> AppResult<AppData> {
    let conn = db::connect(&app)?;
    loaders::load_all(&conn)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> AppResult<AppData> {
    let conn = db::connect(&app)?;
    loaders::write_settings(&conn, &settings)?;
    load_app_data(app)
}

#[tauri::command]
pub fn pick_settings_path(kind: String, current_path: String) -> AppResult<Option<String>> {
    pick_native_settings_path(&kind, &current_path)
}

#[tauri::command]
pub fn check_for_updates() -> AppResult<UpdateCheckResult> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    Ok(UpdateCheckResult {
        has_update: false,
        current_version: current_version.clone(),
        latest_version: current_version,
        message: "已是最新版本".to_string(),
    })
}

#[tauri::command]
pub fn open_external_url(url: String) -> AppResult<()> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(AppError::Message(
            "只能打开 http 或 https 外部链接。".to_string(),
        ));
    }
    open_url_with_system_browser(trimmed)
}

#[cfg(target_os = "windows")]
fn open_url_with_system_browser(url: &str) -> AppResult<()> {
    Command::new("cmd").args(["/C", "start", "", url]).spawn()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_url_with_system_browser(url: &str) -> AppResult<()> {
    Command::new("open").arg(url).spawn()?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_with_system_browser(url: &str) -> AppResult<()> {
    Command::new("xdg-open").arg(url).spawn()?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn pick_native_settings_path(kind: &str, current_path: &str) -> AppResult<Option<String>> {
    let current_path = escape_powershell_single_quoted(current_path);
    let script = match kind {
        "databasePath" => format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             $dialog = New-Object System.Windows.Forms.OpenFileDialog; \
             $dialog.Title = '选择本地数据库文件'; \
             $dialog.Filter = 'SQLite 数据库 (*.sqlite;*.db)|*.sqlite;*.db|所有文件 (*.*)|*.*'; \
             $current = '{current_path}'; \
             if ($current) {{ \
                 $parent = Split-Path -Parent $current; \
                 if ($parent -and (Test-Path -LiteralPath $parent)) {{ $dialog.InitialDirectory = $parent; }} \
                 $name = Split-Path -Leaf $current; \
                 if ($name) {{ $dialog.FileName = $name; }} \
             }} \
             if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($dialog.FileName); }}"
        ),
        "attachmentDir" => format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
             $dialog.Description = '选择附件保存目录'; \
             $dialog.ShowNewFolderButton = $true; \
             $current = '{current_path}'; \
             if ($current -and (Test-Path -LiteralPath $current)) {{ $dialog.SelectedPath = $current; }} \
             if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($dialog.SelectedPath); }}"
        ),
        _ => {
            return Err(AppError::Message(
                "未知的设置路径类型，无法打开选择器。".to_string(),
            ))
        }
    };

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-STA")
        .arg("-Command")
        .arg(script)
        .output()
        .map_err(|error| AppError::Message(format!("打开系统路径选择器失败：{error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Message(format!(
            "打开系统路径选择器失败：{}",
            stderr.trim()
        )));
    }
    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

#[cfg(not(target_os = "windows"))]
fn pick_native_settings_path(_kind: &str, _current_path: &str) -> AppResult<Option<String>> {
    Err(AppError::Message(
        "当前系统暂未接入原生路径选择器，请手动输入路径。".to_string(),
    ))
}

fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

#[tauri::command]
pub fn save_group(app: AppHandle, group: ExpenseGroup) -> AppResult<AppData> {
    let conn = db::connect(&app)?;
    conn.execute(
        "INSERT INTO expense_group(group_id, group_name, owner_name, category, invoice_title_rule, quick_submit_template, attachment_rule_config, color, remark, is_active, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)
         ON CONFLICT(group_id) DO UPDATE SET
           group_name=excluded.group_name, owner_name=excluded.owner_name, category=excluded.category,
           invoice_title_rule=excluded.invoice_title_rule, quick_submit_template=excluded.quick_submit_template,
           attachment_rule_config=excluded.attachment_rule_config,
           color=excluded.color, remark=excluded.remark,
           is_active=excluded.is_active, updated_at=CURRENT_TIMESTAMP",
        params![
            group.id,
            group.name,
            group.owner_name,
            group.category,
            group.title_rule,
            group.quick_submit_template,
            group.attachment_rule_config,
            group.color,
            group.remark,
            group.is_active as i32
        ],
    )?;
    load_app_data(app)
}

fn upsert_form_record(conn: &rusqlite::Connection, record: &FormRecord) -> AppResult<()> {
    conn.execute(
        "INSERT INTO invoice(invoice_id, group_id, invoice_number, invoice_kind, issue_date, purchase_date, content_type, item_name, invoice_item_name, amount, tax_amount, description, raw_text, status, seller_name, seller_tax_no, buyer_name, buyer_tax_no, spec_model, unit, quantity, invoice_confirmed, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, CURRENT_TIMESTAMP)
         ON CONFLICT(invoice_id) DO UPDATE SET
           group_id=excluded.group_id, invoice_number=excluded.invoice_number, invoice_kind=excluded.invoice_kind, issue_date=excluded.issue_date,
           purchase_date=excluded.purchase_date, content_type=excluded.content_type,
           item_name=excluded.item_name, invoice_item_name=excluded.invoice_item_name, amount=excluded.amount, tax_amount=excluded.tax_amount,
           description=excluded.description, raw_text=excluded.raw_text, status=excluded.status,
           seller_name=excluded.seller_name, seller_tax_no=excluded.seller_tax_no,
           buyer_name=excluded.buyer_name, buyer_tax_no=excluded.buyer_tax_no,
           spec_model=excluded.spec_model, unit=excluded.unit, quantity=excluded.quantity,
           invoice_confirmed=excluded.invoice_confirmed,
           updated_at=CURRENT_TIMESTAMP",
        params![
            record.id,
            record.group_id,
            record.invoice_number,
            record.invoice_kind,
            record.issue_date,
            record.purchase_date,
            record.content_type,
            record.title,
            record.invoice_item_name,
            record.amount,
            record.tax_amount,
            record.remark,
            record.invoice_remark,
            record.status,
            record.seller_name,
            record.seller_tax_no,
            record.buyer_name,
            record.buyer_tax_no,
            record.item_spec_model,
            record.item_unit,
            record.item_quantity,
            record.invoice_confirmed as i32
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub fn save_form_record(app: AppHandle, record: FormRecord) -> AppResult<AppData> {
    let conn = db::connect(&app)?;
    upsert_form_record(&conn, &record)?;
    sync_batch_items_for_form(&conn, record.id, &record.status)?;
    load_app_data(app)
}

#[tauri::command]
pub fn save_form_with_attachments(
    app: AppHandle,
    record: FormRecord,
    attachments: Vec<UploadedAttachmentPayload>,
) -> AppResult<AppData> {
    let data_dir = db::data_dir(&app)?;
    let attachment_dir = db::attachment_dir(&app)?
        .join("imports")
        .join(record.id.to_string());
    fs::create_dir_all(&attachment_dir)?;

    let mut stored_files = Vec::new();
    let stamp = Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    for (index, attachment) in attachments.iter().enumerate() {
        let file_name = sanitize_file_name(&attachment.file_name);
        let stored_name = format!("{stamp}-{index}-{file_name}");
        let target = files::ensure_inside(&data_dir, &attachment_dir.join(&stored_name))?;
        fs::write(&target, &attachment.bytes)?;
        let relative_path = Path::new("attachments")
            .join("imports")
            .join(record.id.to_string())
            .join(&stored_name)
            .to_string_lossy()
            .replace('\\', "/");
        stored_files.push((attachment, relative_path));
    }

    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    upsert_form_record(&tx, &record)?;
    for (attachment, relative_path) in stored_files {
        tx.execute(
            "INSERT INTO attachment(owner_type, owner_id, file_name, file_type, relative_path, file_hash, remark, uploaded_at)
             VALUES('invoice', ?1, ?2, ?3, ?4, '', ?5, CURRENT_TIMESTAMP)",
            params![
                record.id,
                attachment.file_name,
                attachment.file_type,
                relative_path,
                attachment.remark
            ],
        )?;
    }
    sync_batch_items_for_form_tx(&tx, record.id, &record.status)?;
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn save_matched_forms(
    app: AppHandle,
    records: Vec<FormRecord>,
    pairs: Vec<FormMatchPair>,
) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    for record in &records {
        upsert_form_record(&tx, record)?;
        sync_batch_items_for_form_tx(&tx, record.id, &record.status)?;
    }
    for pair in pairs {
        if pair.order_id == pair.invoice_id {
            continue;
        }
        tx.execute(
            "UPDATE attachment SET owner_id = ?1 WHERE owner_type = 'invoice' AND owner_id = ?2",
            params![pair.order_id, pair.invoice_id],
        )?;
        tx.execute(
            "DELETE FROM invoice WHERE invoice_id = ?1",
            params![pair.invoice_id],
        )?;
    }
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn read_dropped_files(paths: Vec<String>) -> AppResult<Vec<DroppedFilePayload>> {
    let mut files = Vec::new();
    for path in paths {
        let source = PathBuf::from(&path);
        if !source.is_file() {
            continue;
        }
        let file_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment.bin")
            .to_string();
        let bytes = fs::read(&source)?;
        files.push(DroppedFilePayload {
            file_type: infer_file_type(&file_name),
            remark: String::new(),
            file_name,
            bytes,
            source_path: path,
        });
    }
    Ok(files)
}

#[tauri::command]
pub fn read_attachment_file(
    app: AppHandle,
    relative_path: String,
    file_name: String,
    file_type: String,
    remark: String,
) -> AppResult<UploadedAttachmentPayload> {
    let data_dir = db::data_dir(&app)?;
    let source = files::ensure_inside(&data_dir, &data_dir.join(relative_path))?;
    if !source.is_file() {
        return Err(AppError::Message("附件文件不存在或不可读取。".to_string()));
    }
    Ok(UploadedAttachmentPayload {
        file_name,
        file_type,
        remark,
        bytes: fs::read(source)?,
    })
}

#[tauri::command]
pub fn recognize_invoice_attachment(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> AppResult<OcrInvoiceResult> {
    let data_dir = db::data_dir(&app)?;
    let ocr_dir = data_dir.join("ocr-temp");
    fs::create_dir_all(&ocr_dir)?;
    let stamp = Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    let safe_name = sanitize_file_name(&file_name);
    let temp_path = files::ensure_inside(&data_dir, &ocr_dir.join(format!("{stamp}-{safe_name}")))?;
    fs::write(&temp_path, bytes)?;

    let runtime = resolve_ocr_runtime(&app)?;
    let code = r#"
import json
import os
import sys
from pathlib import Path

service_dir = Path(sys.argv[1])
file_path = Path(sys.argv[2])
tesseract_path = sys.argv[3] if len(sys.argv) > 3 else ""
if tesseract_path:
    tesseract = Path(tesseract_path)
    os.environ["PATH"] = str(tesseract.parent) + os.pathsep + os.environ.get("PATH", "")
    tessdata = tesseract.parent / "tessdata"
    if tessdata.exists():
        os.environ.setdefault("TESSDATA_PREFIX", str(tessdata))
sys.path.insert(0, str(service_dir))
from ivic_ocr.service import format_ocr_environment_status, parse_invoice_file
try:
    from ivic_invoice_layout import parse_invoice_layout_file
except Exception:
    def parse_invoice_layout_file(_file_path):
        return {}

def merge_layout_result(data, layout_data):
    for key, value in (layout_data or {}).items():
        if value in (None, ""):
            continue
        if key in {"buyer_name", "buyer_tax_no", "seller_name", "seller_tax_no", "description"}:
            data[key] = value
        elif data.get(key) in (None, ""):
            data[key] = value
    return data

try:
    data = parse_invoice_file(str(file_path))
    data = merge_layout_result(data, parse_invoice_layout_file(file_path))
    print(json.dumps({
        "ok": True,
        "message": "OCR completed",
        "rawText": data.get("raw_text") or "",
        "invoiceNumber": data.get("invoice_number") or "",
        "invoiceType": data.get("invoice_type") or "",
        "issueDate": data.get("issue_date") or "",
        "buyerName": data.get("buyer_name") or "",
        "buyerTaxNo": data.get("buyer_tax_no") or "",
        "sellerName": data.get("seller_name") or "",
        "sellerTaxNo": data.get("seller_tax_no") or "",
        "itemName": data.get("item_name") or "",
        "specModel": data.get("spec_model") or "",
        "unit": data.get("unit") or "",
        "quantity": "" if data.get("quantity") is None else str(data.get("quantity")),
        "subtotalAmount": "" if data.get("amount_without_tax") is None else str(data.get("amount_without_tax")),
        "taxAmount": "" if data.get("tax_amount") is None else str(data.get("tax_amount")),
        "totalWithTax": "" if data.get("amount") is None else str(data.get("amount")),
        "invoiceRemark": data.get("description") or "",
    }, ensure_ascii=True))
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "message": str(exc) + "\n" + format_ocr_environment_status(),
        "rawText": "",
        "invoiceNumber": "",
        "invoiceType": "",
        "issueDate": "",
        "buyerName": "",
        "buyerTaxNo": "",
        "sellerName": "",
        "sellerTaxNo": "",
        "itemName": "",
        "specModel": "",
        "unit": "",
        "quantity": "",
        "subtotalAmount": "",
        "taxAmount": "",
        "totalWithTax": "",
        "invoiceRemark": "",
    }, ensure_ascii=True))
"#;
    let tesseract_arg = runtime
        .tesseract
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let output = Command::new(&runtime.python)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg("-c")
        .arg(code)
        .arg(&runtime.service_dir)
        .arg(&temp_path)
        .arg(tesseract_arg)
        .output()
        .map_err(|error| AppError::Message(format!("Failed to start OCR: {error}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stdout.trim().is_empty() {
        return Err(AppError::Message(format!("OCR 未返回结果。{stderr}")));
    }
    let mut result: OcrInvoiceResult = serde_json::from_str(stdout.trim())?;
    if !stderr.trim().is_empty() && result.message.is_empty() {
        result.message = stderr.trim().to_string();
    }
    Ok(result)
}

#[tauri::command]
pub fn delete_form_records(app: AppHandle, ids: Vec<i64>) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    for id in ids {
        let batch_blocker = {
            let mut stmt = tx.prepare(
                "SELECT COALESCE(i.item_name, ri.item_name, '该订单'), r.reimbursement_no
                 FROM reimbursement_item ri
                 INNER JOIN reimbursement r ON r.reimbursement_id = ri.reimbursement_id
                 LEFT JOIN invoice i ON i.invoice_id = COALESCE(ri.invoice_id, ri.order_id)
                 WHERE ri.invoice_id = ?1 OR ri.order_id = ?2
                 ORDER BY r.apply_time DESC
                 LIMIT 1",
            )?;
            let rows = stmt
                .query_map(params![id, id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter().next()
        };
        if let Some((title, batch_no)) = batch_blocker {
            return Err(AppError::Message(format!(
                "订单 {title} 已在报销批次 {batch_no} 中。请先删除对应报销批次，再删除订单。"
            )));
        }
        tx.execute(
            "DELETE FROM reconciliation_match
             WHERE item_id IN (SELECT item_id FROM reimbursement_item WHERE invoice_id = ?1)",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM reimbursement_item WHERE invoice_id = ?1",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM attachment WHERE owner_type = 'invoice' AND owner_id = ?1",
            params![id],
        )?;
        tx.execute("DELETE FROM invoice WHERE invoice_id = ?1", params![id])?;
    }
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn delete_batch(app: AppHandle, id: i64) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let form_ids = {
        let mut stmt = tx.prepare(
            "SELECT COALESCE(invoice_id, order_id, 0) FROM reimbursement_item WHERE reimbursement_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![id], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    tx.execute(
        "DELETE FROM reimbursement_item WHERE reimbursement_id = ?1",
        params![id],
    )?;
    tx.execute(
        "DELETE FROM reimbursement WHERE reimbursement_id = ?1",
        params![id],
    )?;
    for form_id in form_ids {
        if form_id > 0 {
            tx.execute(
                "UPDATE invoice SET status = '待提交', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ?1",
                params![form_id],
            )?;
        }
    }
    tx.commit()?;
    load_app_data(app)
}

struct OcrRuntime {
    python: PathBuf,
    service_dir: PathBuf,
    tesseract: Option<PathBuf>,
}

fn resolve_ocr_runtime(app: &AppHandle) -> AppResult<OcrRuntime> {
    if let Some(runtime) = bundled_ocr_runtime(app) {
        return Ok(runtime);
    }
    if let Some(runtime) = development_ocr_runtime() {
        return Ok(runtime);
    }
    Err(AppError::Message(
        "OCR runtime was not found. Stage ivic_app/src-tauri/resources/ocr before release builds, or keep ivic_app/src-tauri/python/ivic_ocr for development.".to_string(),
    ))
}

fn bundled_ocr_runtime(app: &AppHandle) -> Option<OcrRuntime> {
    let resource_dir = app.path().resource_dir().ok()?;
    let ocr_root = resource_dir.join("resources").join("ocr");
    let service_dir = ocr_root.join("service");
    let script = service_dir.join("ivic_ocr").join("service.py");
    if !script.exists() {
        return None;
    }
    let python = bundled_python_executable(&ocr_root)?;
    Some(OcrRuntime {
        python,
        service_dir,
        tesseract: bundled_tesseract_executable(&ocr_root),
    })
}

fn bundled_python_executable(ocr_root: &Path) -> Option<PathBuf> {
    [
        ocr_root.join("python").join("python.exe"),
        ocr_root.join("python").join("Scripts").join("python.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn bundled_tesseract_executable(ocr_root: &Path) -> Option<PathBuf> {
    [
        ocr_root.join("tesseract").join("tesseract.exe"),
        ocr_root
            .join("tesseract")
            .join("Tesseract-OCR")
            .join("tesseract.exe"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn development_ocr_runtime() -> Option<OcrRuntime> {
    let workspace = workspace_root()?;
    Some(OcrRuntime {
        python: python_executable(&workspace),
        service_dir: workspace.join("ivic_app").join("src-tauri").join("python"),
        tesseract: None,
    })
}

fn workspace_root() -> Option<PathBuf> {
    let mut current = std::env::current_dir().ok()?;
    loop {
        if current
            .join("ivic_app")
            .join("src-tauri")
            .join("python")
            .join("ivic_ocr")
            .join("service.py")
            .exists()
        {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn python_executable(workspace: &Path) -> PathBuf {
    if let Ok(path) = std::env::var("IVIC_PYTHON") {
        return PathBuf::from(path);
    }
    let venv_python = workspace
        .join("ivic_app")
        .join(".ocr-runtime")
        .join("Scripts")
        .join("python.exe");
    if venv_python.exists() {
        return venv_python;
    }
    PathBuf::from("python")
}

fn infer_file_type(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".pdf")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".bmp")
        || lower.ends_with(".tif")
        || lower.ends_with(".tiff")
    {
        "发票".to_string()
    } else {
        "附件".to_string()
    }
}

fn sanitize_file_name(file_name: &str) -> String {
    let raw_name = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment.bin");
    let sanitized: String = raw_name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();
    let trimmed = sanitized.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        "attachment.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn save_batch(app: AppHandle, batch: ReimbursementBatch) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let existing_count: i64 = conn.query_row(
        "SELECT COUNT(1) FROM reimbursement WHERE reimbursement_id = ?1",
        params![batch.id],
        |row| row.get(0),
    )?;
    if existing_count == 0 && batch.items.is_empty() {
        return Err(AppError::Message(
            "请在订单页面选择订单后提交创建批次。".to_string(),
        ));
    }
    let tx = conn.transaction()?;
    let status_timeline = serde_json::to_string(&batch.status_timeline)?;
    let batch_status = batch.status.clone();
    let batch_updated_time = batch.updated_time.clone();
    tx.execute(
        "INSERT INTO reimbursement(reimbursement_id, reimbursement_no, group_id, total_amount, status, apply_time, completed_time, status_timeline, remark, quick_submit_text, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(reimbursement_id) DO UPDATE SET
           reimbursement_no=excluded.reimbursement_no, group_id=excluded.group_id, total_amount=excluded.total_amount,
           status=excluded.status, apply_time=excluded.apply_time, completed_time=excluded.completed_time,
           status_timeline=excluded.status_timeline, remark=excluded.remark,
           quick_submit_text=excluded.quick_submit_text, updated_at=excluded.updated_at",
        params![
            batch.id,
            batch.no,
            batch.group_id,
            batch.total_amount,
            batch.status,
            batch.apply_time,
            batch.completed_time,
            status_timeline,
            batch.remark,
            batch.quick_submit_text,
            batch.updated_time
        ],
    )?;
    tx.execute(
        "DELETE FROM reimbursement_item WHERE reimbursement_id = ?1",
        params![batch.id],
    )?;
    for item in batch.items {
        tx.execute(
            "INSERT INTO reimbursement_item(item_id, reimbursement_id, invoice_id, group_id, item_name, amount, reconciled_amount, status, exception_reason, remark)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![item.id, batch.id, item.form_id, batch.group_id, item.title, item.amount, item.reconciled_amount, item.status, item.exception_reason, item.remark],
        )?;
        tx.execute(
            "UPDATE invoice SET status = ?1, updated_at = ?2 WHERE invoice_id = ?3",
            params![
                form_status_for_batch_item(&batch_status, &item.status),
                batch_updated_time,
                item.form_id
            ],
        )?;
    }
    tx.commit()?;
    load_app_data(app)
}

fn form_status_for_batch_item(batch_status: &str, item_status: &str) -> &'static str {
    if batch_status == "已到账" || item_status == "已到账" {
        return "已到账";
    }
    if batch_status == "已报销" || item_status == "已报销" {
        return "已到账";
    }
    if batch_status == "异常处理" || batch_status == "已取消" || item_status == "报销失败"
    {
        return "报销失败";
    }
    if batch_status == "已提交" || batch_status == "部分到账" || item_status == "已提交" {
        return "已提交";
    }
    "批次创建"
}

fn batch_item_status_for_form_status(status: &str) -> &'static str {
    match status {
        "已到账" => "已到账",
        "已报销" => "已到账",
        "报销失败" => "报销失败",
        "已提交" => "已提交",
        "批次创建" | "待提交" => "批次创建",
        _ => "批次创建",
    }
}

fn sync_batch_items_for_form(
    conn: &rusqlite::Connection,
    form_id: i64,
    status: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE reimbursement_item
         SET status = ?1,
             reconciled_amount = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE invoice_id = ?2",
        params![batch_item_status_for_form_status(status), form_id],
    )?;
    Ok(())
}

fn sync_batch_items_for_form_tx(
    tx: &rusqlite::Transaction<'_>,
    form_id: i64,
    status: &str,
) -> AppResult<()> {
    tx.execute(
        "UPDATE reimbursement_item
         SET status = ?1,
             reconciled_amount = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE invoice_id = ?2",
        params![batch_item_status_for_form_status(status), form_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn save_transaction(
    app: AppHandle,
    transaction: ReconciliationTransaction,
) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    upsert_transaction_tx(&tx, &transaction)?;
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn save_transaction_with_attachments(
    app: AppHandle,
    transaction: ReconciliationTransaction,
    attachments: Vec<UploadedAttachmentPayload>,
) -> AppResult<AppData> {
    let data_dir = db::data_dir(&app)?;
    let attachment_dir = db::attachment_dir(&app)?
        .join("transactions")
        .join(transaction.id.to_string());
    fs::create_dir_all(&attachment_dir)?;

    let mut stored_files = Vec::new();
    let stamp = Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    for (index, attachment) in attachments.iter().enumerate() {
        let file_name = sanitize_file_name(&attachment.file_name);
        let stored_name = format!("{stamp}-{index}-{file_name}");
        let target = files::ensure_inside(&data_dir, &attachment_dir.join(&stored_name))?;
        fs::write(&target, &attachment.bytes)?;
        let relative_path = Path::new("attachments")
            .join("transactions")
            .join(transaction.id.to_string())
            .join(&stored_name)
            .to_string_lossy()
            .replace('\\', "/");
        stored_files.push((attachment, relative_path));
    }

    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    upsert_transaction_tx(&tx, &transaction)?;
    for (attachment, relative_path) in stored_files {
        tx.execute(
            "INSERT INTO attachment(owner_type, owner_id, file_name, file_type, relative_path, file_hash, remark, uploaded_at)
             VALUES('transaction', ?1, ?2, ?3, ?4, '', ?5, CURRENT_TIMESTAMP)",
            params![
                transaction.id,
                attachment.file_name,
                attachment.file_type,
                relative_path,
                attachment.remark
            ],
        )?;
    }
    tx.commit()?;
    load_app_data(app)
}

fn upsert_transaction_tx(
    tx: &rusqlite::Transaction<'_>,
    transaction: &ReconciliationTransaction,
) -> AppResult<()> {
    tx.execute(
        "INSERT INTO reconciliation_transaction(transaction_id, transaction_no, amount, transaction_time, category, direction, status, remark, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
         ON CONFLICT(transaction_id) DO UPDATE SET
           transaction_no=excluded.transaction_no, amount=excluded.amount, transaction_time=excluded.transaction_time,
           category=excluded.category, direction=excluded.direction, status=excluded.status, remark=excluded.remark,
           updated_at=CURRENT_TIMESTAMP",
        params![
            transaction.id,
            transaction.no,
            transaction.amount,
            transaction.transaction_time,
            transaction.category,
            transaction.direction,
            transaction.status,
            transaction.remark
        ],
    )?;
    tx.execute(
        "DELETE FROM reconciliation_match WHERE transaction_id = ?1",
        params![transaction.id],
    )?;
    let mut remaining_amount = transaction.amount;
    for item_id in &transaction.matched_item_ids {
        if remaining_amount <= 0.0 {
            break;
        }
        let item: Option<(i64, f64)> = tx
            .query_row(
                "SELECT reimbursement_id, amount FROM reimbursement_item WHERE item_id = ?1",
                params![item_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((batch_id, item_amount)) = item {
            let matched_amount = remaining_amount.min(item_amount).max(0.0);
            if matched_amount > 0.0 {
                tx.execute(
                    "INSERT INTO reconciliation_match(transaction_id, reimbursement_id, item_id, matched_amount, remark)
                     VALUES(?1, ?2, ?3, ?4, '')",
                    params![transaction.id, batch_id, item_id, matched_amount],
                )?;
                remaining_amount -= matched_amount;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn backup_now(app: AppHandle) -> AppResult<AppData> {
    let stamp = files::backup_database(&app)?;
    let mut settings = loaders::load_settings(&db::connect(&app)?)?;
    settings.last_backup_at = Some(stamp);
    save_settings(app, settings)
}
