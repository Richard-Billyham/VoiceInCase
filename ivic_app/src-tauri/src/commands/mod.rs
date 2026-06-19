mod loaders;

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Mutex, OnceLock},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use chrono::Local;
use rusqlite::{params, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

use crate::db;
use crate::domain;
use crate::errors::{AppError, AppResult};
use crate::files;
use crate::models::{
    AppData, DroppedFilePayload, ExpenseGroup, FormMatchPair, FormRecord,
    FormWithAttachmentsPayload, OcrIncomeResult, OcrInvoiceRequest, OcrInvoiceResult, PersonMember,
    ReconciliationTransaction, ReimbursementBatch, Settings, UploadedAttachmentPayload,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

fn resolve_member_name(
    conn: &rusqlite::Connection,
    member_id: Option<i64>,
    fallback: &str,
) -> AppResult<String> {
    if let Some(id) = member_id {
        let name = conn
            .query_row(
                "SELECT member_name FROM person_member WHERE member_id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(name) = name {
            return Ok(name);
        }
    }
    Ok(fallback.trim().to_string())
}

fn resolve_form_member(
    conn: &rusqlite::Connection,
    record: &FormRecord,
) -> AppResult<(Option<i64>, String)> {
    if record.member_id.is_some() {
        return Ok((
            record.member_id,
            resolve_member_name(conn, record.member_id, &record.member_name)?,
        ));
    }
    if !record.member_name.trim().is_empty() {
        return Ok((None, record.member_name.trim().to_string()));
    }
    if let Some(group_id) = record.group_id {
        let owner: Option<(Option<i64>, String)> = conn
            .query_row(
                "SELECT owner_id, owner_name FROM expense_group WHERE group_id = ?1",
                params![group_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((owner_id, owner_name)) = owner {
            return Ok((owner_id, resolve_member_name(conn, owner_id, &owner_name)?));
        }
    }
    Ok((None, String::new()))
}

#[tauri::command]
pub fn save_group(app: AppHandle, group: ExpenseGroup) -> AppResult<AppData> {
    let conn = db::connect(&app)?;
    let owner_name = resolve_member_name(&conn, group.owner_id, &group.owner_name)?;
    conn.execute(
        "INSERT INTO expense_group(group_id, group_name, owner_id, owner_name, category, invoice_title_rule, quick_submit_template, attachment_rule_config, color, remark, is_active, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, CURRENT_TIMESTAMP)
         ON CONFLICT(group_id) DO UPDATE SET
           group_name=excluded.group_name, owner_id=excluded.owner_id, owner_name=excluded.owner_name, category=excluded.category,
           invoice_title_rule=excluded.invoice_title_rule, quick_submit_template=excluded.quick_submit_template,
           attachment_rule_config=excluded.attachment_rule_config,
           color=excluded.color, remark=excluded.remark,
           is_active=excluded.is_active, updated_at=CURRENT_TIMESTAMP",
        params![
            group.id,
            group.name,
            group.owner_id,
            owner_name,
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

#[tauri::command]
pub fn save_member(app: AppHandle, member: PersonMember) -> AppResult<AppData> {
    let name = member.name.trim();
    if name.is_empty() {
        return Err(AppError::Message("人员名字不能为空。".to_string()));
    }
    let conn = db::connect(&app)?;
    conn.execute(
        "INSERT INTO person_member(member_id, member_name, phone, email, remark, is_active, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
         ON CONFLICT(member_id) DO UPDATE SET
           member_name=excluded.member_name, phone=excluded.phone, email=excluded.email,
           remark=excluded.remark, is_active=excluded.is_active, updated_at=CURRENT_TIMESTAMP",
        params![
            member.id,
            name,
            member.phone,
            member.email,
            member.remark,
            member.is_active as i32
        ],
    )?;
    conn.execute(
        "UPDATE expense_group SET owner_name = ?1 WHERE owner_id = ?2",
        params![name, member.id],
    )?;
    conn.execute(
        "UPDATE invoice SET member_name = ?1 WHERE member_id = ?2",
        params![name, member.id],
    )?;
    load_app_data(app)
}

#[tauri::command]
pub fn delete_group(app: AppHandle, id: i64) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE invoice
         SET group_id = NULL, member_id = NULL, member_name = '', updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ?1",
        params![id],
    )?;
    tx.execute(
        "UPDATE reimbursement
         SET group_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ?1",
        params![id],
    )?;
    tx.execute(
        "UPDATE reimbursement_item
         SET group_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ?1",
        params![id],
    )?;
    tx.execute(
        "UPDATE order_item
         SET group_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE group_id = ?1",
        params![id],
    )?;
    tx.execute("DELETE FROM expense_group WHERE group_id = ?1", params![id])?;
    insert_status_log_tx(&tx, "group", id, None, "已删除", "删除分组并解除关联")?;
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn delete_member(app: AppHandle, id: i64) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE expense_group
         SET owner_id = NULL, owner_name = '', updated_at = CURRENT_TIMESTAMP
         WHERE owner_id = ?1",
        params![id],
    )?;
    tx.execute(
        "UPDATE invoice
         SET member_id = (
             SELECT g.owner_id
             FROM expense_group g
             WHERE g.group_id = invoice.group_id
         ),
         member_name = COALESCE((
             SELECT COALESCE(NULLIF(g.owner_name, ''), pm.member_name, '')
             FROM expense_group g
             LEFT JOIN person_member pm ON pm.member_id = g.owner_id
             WHERE g.group_id = invoice.group_id
         ), ''),
         updated_at = CURRENT_TIMESTAMP
         WHERE member_id = ?1",
        params![id],
    )?;
    tx.execute(
        "DELETE FROM person_member WHERE member_id = ?1",
        params![id],
    )?;
    insert_status_log_tx(&tx, "member", id, None, "已删除", "删除人员并回退关联")?;
    tx.commit()?;
    load_app_data(app)
}

fn upsert_form_record(conn: &rusqlite::Connection, record: &FormRecord) -> AppResult<()> {
    let (member_id, member_name) = resolve_form_member(conn, record)?;
    conn.execute(
        "INSERT INTO invoice(invoice_id, group_id, member_id, member_name, invoice_number, invoice_kind, issue_date, purchase_date, content_type, item_name, invoice_item_name, amount, tax_amount, description, raw_text, status, seller_name, seller_tax_no, buyer_name, buyer_tax_no, spec_model, unit, quantity, invoice_confirmed, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, CURRENT_TIMESTAMP)
         ON CONFLICT(invoice_id) DO UPDATE SET
           group_id=excluded.group_id, member_id=excluded.member_id, member_name=excluded.member_name,
           invoice_number=excluded.invoice_number, invoice_kind=excluded.invoice_kind, issue_date=excluded.issue_date,
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
            member_id,
            member_name,
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
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let old_status = current_invoice_status(&tx, record.id)?;
    upsert_form_record(&tx, &record)?;
    sync_batch_items_for_form_tx(&tx, record.id, &record.status)?;
    insert_status_log_tx(
        &tx,
        "invoice",
        record.id,
        old_status.as_deref(),
        &record.status,
        "保存表单",
    )?;
    tx.commit()?;
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
    let old_status = current_invoice_status(&tx, record.id)?;
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
    insert_status_log_tx(
        &tx,
        "invoice",
        record.id,
        old_status.as_deref(),
        &record.status,
        "保存表单及附件",
    )?;
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn save_forms_with_attachments(
    app: AppHandle,
    items: Vec<FormWithAttachmentsPayload>,
) -> AppResult<AppData> {
    if items.is_empty() {
        return load_app_data(app);
    }

    let data_dir = db::data_dir(&app)?;
    let attachment_root = db::attachment_dir(&app)?.join("imports");
    let stamp = Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    let mut stored_files = Vec::new();

    for (item_index, item) in items.iter().enumerate() {
        let attachment_dir = attachment_root.join(item.record.id.to_string());
        fs::create_dir_all(&attachment_dir)?;
        for (attachment_index, attachment) in item.attachments.iter().enumerate() {
            let file_name = sanitize_file_name(&attachment.file_name);
            let stored_name = format!("{stamp}-{item_index}-{attachment_index}-{file_name}");
            let target = files::ensure_inside(&data_dir, &attachment_dir.join(&stored_name))?;
            fs::write(&target, &attachment.bytes)?;
            let relative_path = Path::new("attachments")
                .join("imports")
                .join(item.record.id.to_string())
                .join(&stored_name)
                .to_string_lossy()
                .replace('\\', "/");
            stored_files.push((item_index, attachment, relative_path));
        }
    }

    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    for (item_index, item) in items.iter().enumerate() {
        let old_status = current_invoice_status(&tx, item.record.id)?;
        upsert_form_record(&tx, &item.record)?;
        for (_, attachment, relative_path) in stored_files
            .iter()
            .filter(|(stored_item_index, _, _)| *stored_item_index == item_index)
        {
            tx.execute(
                "INSERT INTO attachment(owner_type, owner_id, file_name, file_type, relative_path, file_hash, remark, uploaded_at)
                 VALUES('invoice', ?1, ?2, ?3, ?4, '', ?5, CURRENT_TIMESTAMP)",
                params![
                    item.record.id,
                    attachment.file_name,
                    attachment.file_type,
                    relative_path,
                    attachment.remark
                ],
            )?;
        }
        sync_batch_items_for_form_tx(&tx, item.record.id, &item.record.status)?;
        insert_status_log_tx(
            &tx,
            "invoice",
            item.record.id,
            old_status.as_deref(),
            &item.record.status,
            "batch import save",
        )?;
    }
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
        let old_status = current_invoice_status(&tx, record.id)?;
        upsert_form_record(&tx, record)?;
        sync_batch_items_for_form_tx(&tx, record.id, &record.status)?;
        insert_status_log_tx(
            &tx,
            "invoice",
            record.id,
            old_status.as_deref(),
            &record.status,
            "保存匹配结果",
        )?;
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
pub async fn recognize_invoice_attachment(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> AppResult<OcrInvoiceResult> {
    tauri::async_runtime::spawn_blocking(move || {
        recognize_invoice_attachment_sync(app, file_name, bytes)
    })
    .await
    .map_err(|error| AppError::Message(format!("OCR task failed: {error}")))?
}

fn recognize_invoice_attachment_sync(
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
    log_ocr_runtime("invoice", &runtime);
    ocr_worker_request(
        &runtime,
        serde_json::json!({
            "action": "invoice",
            "path": temp_path.to_string_lossy(),
        }),
    )
}

#[tauri::command]
pub async fn recognize_invoice_attachments(
    app: AppHandle,
    items: Vec<OcrInvoiceRequest>,
) -> AppResult<Vec<OcrInvoiceResult>> {
    tauri::async_runtime::spawn_blocking(move || recognize_invoice_attachments_sync(app, items))
        .await
        .map_err(|error| AppError::Message(format!("Batch OCR task failed: {error}")))?
}

fn recognize_invoice_attachments_sync(
    app: AppHandle,
    items: Vec<OcrInvoiceRequest>,
) -> AppResult<Vec<OcrInvoiceResult>> {
    let data_dir = db::data_dir(&app)?;
    let ocr_dir = data_dir.join("ocr-temp");
    fs::create_dir_all(&ocr_dir)?;
    let stamp = Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    let mut manifest_items = Vec::new();

    for (index, item) in items.into_iter().enumerate() {
        let path = if !item.source_path.trim().is_empty() {
            let source = PathBuf::from(item.source_path.trim());
            if !source.is_file() {
                return Err(AppError::Message(format!(
                    "OCR source file is not readable: {}",
                    source.display()
                )));
            }
            source
        } else {
            let safe_name = sanitize_file_name(&item.file_name);
            let temp_path = files::ensure_inside(
                &data_dir,
                &ocr_dir.join(format!("{stamp}-{index}-{safe_name}")),
            )?;
            fs::write(&temp_path, item.bytes)?;
            temp_path
        };
        manifest_items.push(serde_json::json!({
            "fileName": item.file_name,
            "path": path.to_string_lossy(),
        }));
    }

    let manifest_path =
        files::ensure_inside(&data_dir, &ocr_dir.join(format!("{stamp}-manifest.json")))?;
    fs::write(&manifest_path, serde_json::to_vec(&manifest_items)?)?;

    let runtime = resolve_ocr_runtime(&app)?;
    log_ocr_runtime("batch invoice", &runtime);
    ocr_worker_request(
        &runtime,
        serde_json::json!({
            "action": "batch_invoice",
            "manifestPath": manifest_path.to_string_lossy(),
            "items": manifest_items,
        }),
    )
}

#[tauri::command]
pub async fn recognize_income_attachment(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> AppResult<OcrIncomeResult> {
    tauri::async_runtime::spawn_blocking(move || {
        recognize_income_attachment_sync(app, file_name, bytes)
    })
    .await
    .map_err(|error| AppError::Message(format!("Income OCR task failed: {error}")))?
}

fn recognize_income_attachment_sync(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> AppResult<OcrIncomeResult> {
    let data_dir = db::data_dir(&app)?;
    let ocr_dir = data_dir.join("ocr-temp");
    fs::create_dir_all(&ocr_dir)?;
    let stamp = Local::now().format("%Y%m%d%H%M%S%3f").to_string();
    let safe_name = sanitize_file_name(&file_name);
    let temp_path = files::ensure_inside(&data_dir, &ocr_dir.join(format!("{stamp}-{safe_name}")))?;
    fs::write(&temp_path, bytes)?;

    let runtime = resolve_ocr_runtime(&app)?;
    log_ocr_runtime("income", &runtime);
    ocr_worker_request(
        &runtime,
        serde_json::json!({
            "action": "income",
            "path": temp_path.to_string_lossy(),
        }),
    )
}

#[tauri::command]
pub fn delete_form_records(app: AppHandle, ids: Vec<i64>) -> AppResult<AppData> {
    let data_dir = db::data_dir(&app)?;
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let mut attachment_paths = Vec::new();
    for id in ids {
        let batch_blocker = {
            let mut stmt = tx.prepare(
                "SELECT COALESCE(i.item_name, ri.item_name, '该订单'), r.reimbursement_no
                 FROM reimbursement_item ri
                 INNER JOIN reimbursement r ON r.reimbursement_id = ri.reimbursement_id
                 LEFT JOIN invoice i ON i.invoice_id = COALESCE(ri.invoice_id, ri.order_id)
                 WHERE (ri.invoice_id = ?1 OR ri.order_id = ?2)
                   AND ri.is_released = 0
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
        attachment_paths.extend(load_attachment_paths_tx(&tx, "invoice", id)?);
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
        insert_status_log_tx(&tx, "invoice", id, None, "已删除", "删除表单")?;
    }
    tx.commit()?;
    remove_attachment_files(&data_dir, attachment_paths)?;
    load_app_data(app)
}

#[tauri::command]
pub fn delete_batch(app: AppHandle, id: i64) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let form_ids = {
        let mut stmt = tx.prepare(
            "SELECT COALESCE(invoice_id, order_id, 0) FROM reimbursement_item WHERE reimbursement_id = ?1 AND is_released = 0",
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
    insert_status_log_tx(&tx, "batch", id, None, "已删除", "删除批次")?;
    for form_id in form_ids {
        if form_id > 0 {
            let old_status = current_invoice_status(&tx, form_id)?;
            tx.execute(
                "UPDATE invoice SET status = '待提交', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ?1",
                params![form_id],
            )?;
            insert_status_log_tx(
                &tx,
                "invoice",
                form_id,
                old_status.as_deref(),
                "待提交",
                "删除批次后回退",
            )?;
        }
    }
    tx.commit()?;
    load_app_data(app)
}

struct OcrRuntime {
    python: PathBuf,
    service_dir: PathBuf,
}

struct OcrWorker {
    key: String,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

static OCR_WORKER: OnceLock<Mutex<Option<OcrWorker>>> = OnceLock::new();

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrWorkerEnvelope<T> {
    ok: bool,
    result: Option<T>,
    message: Option<String>,
}

fn ocr_worker_request<T: DeserializeOwned>(
    runtime: &OcrRuntime,
    request: serde_json::Value,
) -> AppResult<T> {
    let worker_lock = OCR_WORKER.get_or_init(|| Mutex::new(None));
    let mut worker_slot = worker_lock
        .lock()
        .map_err(|_| AppError::Message("OCR worker lock was poisoned".to_string()))?;
    let worker = ensure_ocr_worker(&mut worker_slot, runtime)?;
    match ocr_worker_request_once(worker, &request) {
        Ok(result) => Ok(result),
        Err(first_error) => {
            *worker_slot = None;
            let worker = ensure_ocr_worker(&mut worker_slot, runtime)?;
            ocr_worker_request_once(worker, &request).map_err(|second_error| {
                AppError::Message(format!(
                    "OCR worker failed after restart: {second_error}; previous error: {first_error}"
                ))
            })
        }
    }
}

fn ensure_ocr_worker<'a>(
    worker_slot: &'a mut Option<OcrWorker>,
    runtime: &OcrRuntime,
) -> AppResult<&'a mut OcrWorker> {
    let key = ocr_worker_key(runtime);
    let restart = match worker_slot {
        Some(worker) if worker.key == key => worker.child.try_wait()?.is_some(),
        Some(_) => true,
        None => true,
    };
    if restart {
        *worker_slot = Some(start_ocr_worker(runtime)?);
    }
    worker_slot
        .as_mut()
        .ok_or_else(|| AppError::Message("OCR worker was not available".to_string()))
}

fn start_ocr_worker(runtime: &OcrRuntime) -> AppResult<OcrWorker> {
    let worker_script = runtime.service_dir.join("ivic_ocr").join("worker.py");
    if !worker_script.exists() {
        return Err(AppError::Message(format!(
            "OCR worker script was not found: {}",
            worker_script.display()
        )));
    }
    let mut command = Command::new(&runtime.python);
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .arg(&worker_script)
        .arg(&runtime.service_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_command_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| AppError::Message(format!("Failed to start OCR worker: {error}")))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Message("Failed to open OCR worker stdin".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Message("Failed to open OCR worker stdout".to_string()))?;
    Ok(OcrWorker {
        key: ocr_worker_key(runtime),
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn ocr_worker_request_once<T: DeserializeOwned>(
    worker: &mut OcrWorker,
    request: &serde_json::Value,
) -> AppResult<T> {
    let request_line = serde_json::to_string(request)?;
    worker.stdin.write_all(request_line.as_bytes())?;
    worker.stdin.write_all(b"\n")?;
    worker.stdin.flush()?;

    let mut response_line = String::new();
    let read = worker.stdout.read_line(&mut response_line)?;
    if read == 0 {
        return Err(AppError::Message(
            "OCR worker exited unexpectedly".to_string(),
        ));
    }
    let envelope: OcrWorkerEnvelope<T> = serde_json::from_str(response_line.trim())?;
    if envelope.ok {
        envelope
            .result
            .ok_or_else(|| AppError::Message("OCR worker returned no result".to_string()))
    } else {
        Err(AppError::Message(
            envelope
                .message
                .unwrap_or_else(|| "OCR worker failed".to_string()),
        ))
    }
}

fn ocr_worker_key(runtime: &OcrRuntime) -> String {
    format!(
        "{}|{}",
        runtime.python.display(),
        runtime.service_dir.display()
    )
}

fn resolve_ocr_runtime(app: &AppHandle) -> AppResult<OcrRuntime> {
    if cfg!(debug_assertions) {
        if let Some(runtime) = development_ocr_runtime() {
            return Ok(runtime);
        }
        if let Some(runtime) = bundled_ocr_runtime(app) {
            return Ok(runtime);
        }
    } else {
        if let Some(runtime) = bundled_ocr_runtime(app) {
            return Ok(runtime);
        }
        if let Some(runtime) = development_ocr_runtime() {
            return Ok(runtime);
        }
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

fn development_ocr_runtime() -> Option<OcrRuntime> {
    let workspace = workspace_root()?;
    Some(OcrRuntime {
        python: python_executable(&workspace),
        service_dir: workspace.join("ivic_app").join("src-tauri").join("python"),
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

fn log_ocr_runtime(label: &str, runtime: &OcrRuntime) {
    #[cfg(debug_assertions)]
    eprintln!(
        "[ivic] {label} OCR runtime: python={}, service_dir={}",
        runtime.python.display(),
        runtime.service_dir.display()
    );
}

fn hide_command_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
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
    save_batch_tx(&tx, batch, existing_count == 0)?;
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn release_batch_item_for_retry(
    app: AppHandle,
    batch_id: i64,
    item_id: i64,
    target_status: Option<String>,
) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let (form_id, title, amount, reconciled_amount, status, is_released): (
        i64,
        String,
        f64,
        f64,
        String,
        i64,
    ) = tx
        .query_row(
            "SELECT COALESCE(invoice_id, order_id, 0), item_name, amount, reconciled_amount, status, is_released
             FROM reimbursement_item
             WHERE reimbursement_id = ?1 AND item_id = ?2",
            params![batch_id, item_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::Message("该子订单不在当前批次中，无法退回修改。".to_string()))?;
    if is_released == 1 {
        return Err(AppError::Message(
            "该子订单已经退回修改，请勿重复操作。".to_string(),
        ));
    }
    let wants_failure = target_status
        .as_deref()
        .map(domain::normalize_invoice_status)
        .is_some_and(|value| value == "报销失败");
    if status != "报销失败" && !wants_failure {
        return Err(AppError::Message(
            "只有报销失败的子订单可以退回修改。".to_string(),
        ));
    }
    let match_count: i64 = tx.query_row(
        "SELECT COUNT(1) FROM reconciliation_match WHERE item_id = ?1",
        params![item_id],
        |row| row.get(0),
    )?;
    if reconciled_amount > 0.01 && match_count > 0 {
        return Err(AppError::Message(
            "该子订单已有到账记录，请先处理对账记录后再退回修改。".to_string(),
        ));
    }
    let mut batch = load_batch_for_update_tx(&tx, batch_id)?;
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    for item in &mut batch.items {
        if item.id == item_id {
            item.status = "报销失败".to_string();
            item.reconciled_amount = 0.0;
            item.is_released = true;
            item.released_at = timestamp.clone();
            item.release_reason = "报销失败退回修改".to_string();
            item.remark = [item.remark.trim(), "已退回修改"]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("；");
        }
    }
    batch.total_amount = batch
        .items
        .iter()
        .filter(|item| !item.is_released)
        .map(|item| item.amount)
        .sum();
    batch.updated_time = timestamp.clone();
    batch.status_timeline.push(crate::models::BatchStatusEvent {
        status: batch.status.clone(),
        timestamp: timestamp.clone(),
        remark: format!(
            "子订单“{title}”因报销失败退回修改，释放金额 {amount:.2}，表单回到待提交。"
        ),
    });
    if !batch.items.iter().any(|item| !item.is_released) {
        batch.status = "已取消".to_string();
        batch.completed_time = Some(timestamp.clone());
        batch.status_timeline.push(crate::models::BatchStatusEvent {
            status: "已取消".to_string(),
            timestamp: timestamp.clone(),
            remark: "所有子订单已释放，批次自动取消。".to_string(),
        });
    }
    save_batch_tx(&tx, batch, false)?;
    let old_form_status = current_invoice_status(&tx, form_id)?;
    tx.execute(
        "UPDATE invoice SET status = '待提交', updated_at = ?1 WHERE invoice_id = ?2",
        params![timestamp, form_id],
    )?;
    insert_status_log_tx(
        &tx,
        "invoice",
        form_id,
        old_form_status.as_deref(),
        "待提交",
        "报销失败退回修改",
    )?;
    insert_status_log_tx(
        &tx,
        "batch_item",
        item_id,
        Some(&status),
        "已释放",
        "报销失败退回修改",
    )?;
    tx.commit()?;
    load_app_data(app)
}

fn save_batch_tx(
    tx: &rusqlite::Transaction<'_>,
    mut batch: ReimbursementBatch,
    is_new: bool,
) -> AppResult<()> {
    batch.status = domain::normalize_batch_status(&batch.status);
    for event in &mut batch.status_timeline {
        event.status = domain::normalize_batch_status(&event.status);
    }
    validate_batch_tx(tx, &batch, is_new)?;
    let item_details: Vec<(&str, f64)> = batch
        .items
        .iter()
        .filter(|item| !item.is_released)
        .map(|item| (item.status.as_str(), item.reconciled_amount))
        .collect();
    batch.status = domain::derive_batch_status_from_item_details(&batch.status, &item_details);
    let status_timeline = serde_json::to_string(&batch.status_timeline)?;
    let old_batch_status = current_batch_status(tx, batch.id)?;
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
    insert_status_log_tx(
        tx,
        "batch",
        batch.id,
        old_batch_status.as_deref(),
        &batch.status,
        "保存批次",
    )?;
    tx.execute(
        "DELETE FROM reimbursement_item WHERE reimbursement_id = ?1",
        params![batch.id],
    )?;
    for item in batch.items {
        tx.execute(
            "INSERT INTO reimbursement_item(item_id, reimbursement_id, invoice_id, group_id, item_name, amount, reconciled_amount, status, is_released, released_at, release_reason, exception_reason, remark)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                item.id,
                batch.id,
                item.form_id,
                batch.group_id,
                item.title,
                item.amount,
                item.reconciled_amount,
                item.status,
                item.is_released as i32,
                item.released_at,
                item.release_reason,
                item.exception_reason,
                item.remark
            ],
        )?;
        if item.is_released {
            continue;
        }
        let old_form_status = current_invoice_status(tx, item.form_id)?;
        let next_form_status = domain::form_status_for_batch_item(&batch_status, &item.status);
        tx.execute(
            "UPDATE invoice SET status = ?1, updated_at = ?2 WHERE invoice_id = ?3",
            params![next_form_status, batch_updated_time, item.form_id],
        )?;
        insert_status_log_tx(
            tx,
            "invoice",
            item.form_id,
            old_form_status.as_deref(),
            next_form_status,
            "批次状态同步",
        )?;
    }
    Ok(())
}

fn load_batch_for_update_tx(
    tx: &rusqlite::Transaction<'_>,
    batch_id: i64,
) -> AppResult<ReimbursementBatch> {
    let mut batch: ReimbursementBatch = tx
        .query_row(
            "SELECT r.reimbursement_id, r.reimbursement_no, r.group_id, COALESCE(g.group_name, ''),
                    r.total_amount, r.status, r.apply_time, r.completed_time, r.status_timeline,
                    r.remark, r.quick_submit_text, r.updated_at
             FROM reimbursement r
             LEFT JOIN expense_group g ON g.group_id = r.group_id
             WHERE r.reimbursement_id = ?1",
            params![batch_id],
            |row| {
                let timeline_json: String = row.get(8)?;
                Ok(ReimbursementBatch {
                    id: row.get(0)?,
                    no: row.get(1)?,
                    group_id: row.get(2)?,
                    group_name: row.get(3)?,
                    total_amount: row.get(4)?,
                    status: row.get(5)?,
                    apply_time: row.get(6)?,
                    completed_time: row.get(7)?,
                    status_timeline: serde_json::from_str(&timeline_json).unwrap_or_default(),
                    remark: row.get(9)?,
                    quick_submit_text: row.get(10)?,
                    updated_time: row.get(11)?,
                    items: Vec::new(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::Message("报销批次不存在，无法退回修改。".to_string()))?;
    let mut stmt = tx.prepare(
        "SELECT item_id, reimbursement_id, COALESCE(invoice_id, order_id, 0), item_name, amount,
                reconciled_amount, status, is_released, released_at, release_reason, exception_reason, remark
         FROM reimbursement_item
         WHERE reimbursement_id = ?1
         ORDER BY item_id",
    )?;
    batch.items = stmt
        .query_map(params![batch_id], |row| {
            Ok(crate::models::ReimbursementItem {
                id: row.get(0)?,
                batch_id: row.get(1)?,
                form_id: row.get(2)?,
                title: row.get(3)?,
                amount: row.get(4)?,
                reconciled_amount: row.get(5)?,
                status: row.get(6)?,
                is_released: row.get::<_, i64>(7)? == 1,
                released_at: row.get(8)?,
                release_reason: row.get(9)?,
                exception_reason: row.get(10)?,
                remark: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(batch)
}

fn validate_batch_tx(
    tx: &rusqlite::Transaction<'_>,
    batch: &ReimbursementBatch,
    is_new: bool,
) -> AppResult<()> {
    if is_new && !matches!(batch.status.as_str(), "待提交" | "已提交") {
        return Err(AppError::Message(
            "新建提交批次只能从“待提交”或“已提交”开始。".to_string(),
        ));
    }
    let mut group_id: Option<Option<i64>> = None;
    for item in &batch.items {
        if !matches!(
            item.status.as_str(),
            "批次创建" | "已提交" | "已到账" | "报销失败"
        ) {
            return Err(AppError::Message(format!(
                "批次内子订单“{}”只能保存为批次创建、已提交、已到账或报销失败。",
                item.title
            )));
        }
        if item.reconciled_amount < 0.0 || item.reconciled_amount > item.amount + 0.01 {
            return Err(AppError::Message(format!(
                "批次内子订单“{}”的到账金额不能小于 0 或超过应到账金额。",
                item.title
            )));
        }
        if is_new {
            let form: Option<(String, String, Option<i64>)> = tx
                .query_row(
                    "SELECT item_name, content_type, group_id FROM invoice WHERE invoice_id = ?1",
                    params![item.form_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let Some((title, content_type, item_group_id)) = form else {
                return Err(AppError::Message(format!(
                    "子订单“{}”对应的表单不存在，无法创建提交批次。",
                    item.title
                )));
            };
            if content_type != "订单+发票" {
                return Err(AppError::Message(format!(
                    "“{title}”的类型是“{content_type}”，只有“订单+发票”可以提交。"
                )));
            }
            let duplicate_count: i64 = tx.query_row(
                "SELECT COUNT(1) FROM reimbursement_item WHERE (invoice_id = ?1 OR order_id = ?1) AND is_released = 0",
                params![item.form_id],
                |row| row.get(0),
            )?;
            if duplicate_count > 0 {
                return Err(AppError::Message(format!(
                    "“{title}”已经在提交批次中，请不要重复提交。"
                )));
            }
            if let Some(existing_group_id) = group_id {
                if existing_group_id != item_group_id {
                    return Err(AppError::Message(
                        "选中的表单属于不同分组，请按同一分组分别提交。".to_string(),
                    ));
                }
            } else {
                group_id = Some(item_group_id);
            }
        }
    }
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
             updated_at = CURRENT_TIMESTAMP
         WHERE invoice_id = ?2 AND is_released = 0",
        params![domain::batch_item_status_for_form_status(status), form_id],
    )?;
    Ok(())
}

fn current_invoice_status(
    conn: &rusqlite::Connection,
    invoice_id: i64,
) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT status FROM invoice WHERE invoice_id = ?1",
            params![invoice_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn current_batch_status(conn: &rusqlite::Connection, batch_id: i64) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT status FROM reimbursement WHERE reimbursement_id = ?1",
            params![batch_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn current_transaction_status(
    conn: &rusqlite::Connection,
    transaction_id: i64,
) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT status FROM reconciliation_transaction WHERE transaction_id = ?1",
            params![transaction_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn insert_status_log_tx(
    tx: &rusqlite::Transaction<'_>,
    owner_type: &str,
    owner_id: i64,
    old_status: Option<&str>,
    new_status: &str,
    remark: &str,
) -> AppResult<()> {
    if old_status == Some(new_status) {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO status_log(owner_type, owner_id, old_status, new_status, remark)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![owner_type, owner_id, old_status, new_status, remark],
    )?;
    Ok(())
}

fn load_attachment_paths_tx(
    tx: &rusqlite::Transaction<'_>,
    owner_type: &str,
    owner_id: i64,
) -> AppResult<Vec<String>> {
    let mut stmt =
        tx.prepare("SELECT relative_path FROM attachment WHERE owner_type = ?1 AND owner_id = ?2")?;
    let rows = stmt
        .query_map(params![owner_type, owner_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn remove_attachment_files(data_dir: &Path, relative_paths: Vec<String>) -> AppResult<()> {
    for relative_path in relative_paths {
        let target = files::ensure_inside(data_dir, &data_dir.join(relative_path))?;
        if target.is_file() {
            fs::remove_file(target)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_transaction(
    app: AppHandle,
    transaction: ReconciliationTransaction,
) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let old_status = current_transaction_status(&tx, transaction.id)?;
    upsert_transaction_tx(&tx, &transaction)?;
    insert_status_log_tx(
        &tx,
        "transaction",
        transaction.id,
        old_status.as_deref(),
        &transaction.status,
        "保存到账收入",
    )?;
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
    let old_status = current_transaction_status(&tx, transaction.id)?;
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
    insert_status_log_tx(
        &tx,
        "transaction",
        transaction.id,
        old_status.as_deref(),
        &transaction.status,
        "保存到账收入及附件",
    )?;
    tx.commit()?;
    load_app_data(app)
}

#[tauri::command]
pub fn save_reconciliation_result(
    app: AppHandle,
    batches: Vec<ReimbursementBatch>,
    mut transaction: ReconciliationTransaction,
) -> AppResult<AppData> {
    let mut conn = db::connect(&app)?;
    let tx = conn.transaction()?;
    let previous_reconciled = load_reconciled_amounts_for_transaction_items(&tx, &transaction)?;
    let match_amounts =
        collect_reconciliation_match_amounts(&batches, &transaction, &previous_reconciled);
    let matched_total: f64 = match_amounts.iter().map(|(_, _, amount)| amount).sum();
    transaction.status =
        domain::transaction_status_for_match_total(transaction.amount, matched_total);
    for batch in batches {
        save_batch_tx(&tx, batch, false)?;
    }
    let old_status = current_transaction_status(&tx, transaction.id)?;
    upsert_transaction_with_match_amounts_tx(&tx, &transaction, &match_amounts)?;
    insert_status_log_tx(
        &tx,
        "transaction",
        transaction.id,
        old_status.as_deref(),
        &transaction.status,
        "保存到账对账结果",
    )?;
    tx.commit()?;
    load_app_data(app)
}

fn load_reconciled_amounts_for_transaction_items(
    tx: &rusqlite::Transaction<'_>,
    transaction: &ReconciliationTransaction,
) -> AppResult<std::collections::HashMap<i64, f64>> {
    let mut amounts = std::collections::HashMap::new();
    for item_id in &transaction.matched_item_ids {
        let amount = tx
            .query_row(
                "SELECT reconciled_amount FROM reimbursement_item WHERE item_id = ?1",
                params![item_id],
                |row| row.get::<_, f64>(0),
            )
            .optional()?
            .unwrap_or(0.0);
        amounts.insert(*item_id, amount);
    }
    Ok(amounts)
}

fn collect_reconciliation_match_amounts(
    batches: &[ReimbursementBatch],
    transaction: &ReconciliationTransaction,
    previous_reconciled: &std::collections::HashMap<i64, f64>,
) -> Vec<(i64, i64, f64)> {
    let selected: std::collections::HashSet<i64> =
        transaction.matched_item_ids.iter().copied().collect();
    batches
        .iter()
        .flat_map(|batch| {
            batch.items.iter().filter_map(|item| {
                if !selected.contains(&item.id) {
                    return None;
                }
                let previous = previous_reconciled.get(&item.id).copied().unwrap_or(0.0);
                let matched = (item.reconciled_amount - previous).max(0.0);
                (matched > 0.0).then_some((batch.id, item.id, matched))
            })
        })
        .collect()
}

fn upsert_transaction_tx(
    tx: &rusqlite::Transaction<'_>,
    transaction: &ReconciliationTransaction,
) -> AppResult<()> {
    upsert_transaction_base_tx(tx, transaction)?;
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
                "SELECT reimbursement_id, MAX(amount - reconciled_amount, 0) FROM reimbursement_item WHERE item_id = ?1 AND is_released = 0",
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

fn upsert_transaction_with_match_amounts_tx(
    tx: &rusqlite::Transaction<'_>,
    transaction: &ReconciliationTransaction,
    match_amounts: &[(i64, i64, f64)],
) -> AppResult<()> {
    upsert_transaction_base_tx(tx, transaction)?;
    tx.execute(
        "DELETE FROM reconciliation_match WHERE transaction_id = ?1",
        params![transaction.id],
    )?;
    for (batch_id, item_id, matched_amount) in match_amounts {
        tx.execute(
            "INSERT INTO reconciliation_match(transaction_id, reimbursement_id, item_id, matched_amount, remark)
             VALUES(?1, ?2, ?3, ?4, '')",
            params![transaction.id, batch_id, item_id, matched_amount],
        )?;
    }
    Ok(())
}

fn upsert_transaction_base_tx(
    tx: &rusqlite::Transaction<'_>,
    transaction: &ReconciliationTransaction,
) -> AppResult<()> {
    tx.execute(
        "INSERT INTO reconciliation_transaction(transaction_id, transaction_no, amount, transaction_time, transaction_account, transaction_location, counterparty_account, accounting_date, category, direction, status, remark, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
         ON CONFLICT(transaction_id) DO UPDATE SET
           transaction_no=excluded.transaction_no, amount=excluded.amount, transaction_time=excluded.transaction_time,
           transaction_account=excluded.transaction_account, transaction_location=excluded.transaction_location,
           counterparty_account=excluded.counterparty_account, accounting_date=excluded.accounting_date,
           category=excluded.category, direction=excluded.direction, status=excluded.status, remark=excluded.remark,
           updated_at=CURRENT_TIMESTAMP",
        params![
            transaction.id,
            transaction.no,
            transaction.amount,
            transaction.transaction_time,
            transaction.transaction_account,
            transaction.transaction_location,
            transaction.counterparty_account,
            transaction.accounting_date,
            transaction.category,
            transaction.direction,
            transaction.status,
            transaction.remark
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub fn backup_now(app: AppHandle) -> AppResult<AppData> {
    let stamp = files::backup_database(&app)?;
    let mut settings = loaders::load_settings(&db::connect(&app)?)?;
    settings.last_backup_at = Some(stamp);
    save_settings(app, settings)
}
