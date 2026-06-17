mod commands;
mod db;
mod domain;
mod errors;
mod files;
mod models;

use commands::{
    backup_now, check_for_updates, delete_batch, delete_form_records, delete_group, delete_member,
    load_app_data, open_external_url, pick_settings_path, read_attachment_file, read_dropped_files,
    recognize_invoice_attachment, release_batch_item_for_retry, save_batch, save_form_record,
    save_form_with_attachments, save_group, save_matched_forms, save_member,
    save_reconciliation_result, save_settings, save_transaction, save_transaction_with_attachments,
};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            db::migrations::ensure_database(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_settings,
            save_member,
            save_group,
            save_form_record,
            save_form_with_attachments,
            save_matched_forms,
            read_attachment_file,
            read_dropped_files,
            recognize_invoice_attachment,
            delete_form_records,
            delete_group,
            delete_member,
            delete_batch,
            save_batch,
            release_batch_item_for_retry,
            save_reconciliation_result,
            save_transaction,
            save_transaction_with_attachments,
            pick_settings_path,
            open_external_url,
            check_for_updates,
            backup_now
        ])
        .run(tauri::generate_context!())
        .expect("failed to run IVIC application");
}
