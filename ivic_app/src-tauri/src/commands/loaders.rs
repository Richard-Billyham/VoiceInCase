use rusqlite::{params, OptionalExtension};

use crate::errors::AppResult;
use crate::models::{
    AppData, Attachment, BatchStatusEvent, ExpenseGroup, FormRecord, ReconciliationTransaction,
    ReimbursementBatch, ReimbursementItem, Settings,
};

pub fn load_all(conn: &rusqlite::Connection) -> AppResult<AppData> {
    Ok(AppData {
        groups: load_groups(conn)?,
        forms: load_forms(conn)?,
        batches: load_batches(conn)?,
        transactions: load_transactions(conn)?,
        attachments: load_attachments(conn)?,
        settings: load_settings(conn)?,
    })
}

pub fn load_settings(conn: &rusqlite::Connection) -> AppResult<Settings> {
    let json: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
            row.get(0)
        })
        .optional()?;
    if let Some(json) = json {
        return Ok(serde_json::from_str(&json)?);
    }
    Ok(Settings {
        database_path: "IVIC_DATA/ivic.sqlite".to_string(),
        attachment_dir: "IVIC_DATA/attachments".to_string(),
        dark_mode: false,
        check_updates: false,
        hide_amounts: false,
        last_backup_at: None,
    })
}

pub fn write_settings(conn: &rusqlite::Connection, settings: &Settings) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES('app', ?1, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        params![serde_json::to_string(settings)?],
    )?;
    Ok(())
}

fn load_groups(conn: &rusqlite::Connection) -> AppResult<Vec<ExpenseGroup>> {
    let mut stmt = conn.prepare(
        "SELECT group_id, group_name, owner_name, category, invoice_title_rule, quick_submit_template, attachment_rule_config, color, remark, is_active, updated_at
         FROM expense_group ORDER BY is_active DESC, group_name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ExpenseGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            owner_name: row.get(2)?,
            category: row.get(3)?,
            title_rule: row.get(4)?,
            quick_submit_template: row.get(5)?,
            attachment_rule_config: row.get(6)?,
            color: row.get(7)?,
            remark: row.get(8)?,
            is_active: row.get::<_, i64>(9)? == 1,
            updated_at: row.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_forms(conn: &rusqlite::Connection) -> AppResult<Vec<FormRecord>> {
    let mut stmt = conn.prepare(
        "SELECT i.invoice_id, i.item_name, i.invoice_number, i.invoice_kind, i.amount, i.tax_amount, i.purchase_date, i.issue_date, i.content_type,
                i.group_id, COALESCE(g.group_name, ''), i.status,
                i.seller_name, i.seller_tax_no, i.buyer_name, i.buyer_tax_no, i.raw_text, i.description,
                i.spec_model, i.unit, i.quantity, COALESCE(NULLIF(i.invoice_item_name, ''), i.item_name), i.invoice_confirmed, i.updated_at,
                COUNT(a.attachment_id)
         FROM invoice i
         LEFT JOIN expense_group g ON g.group_id = i.group_id
         LEFT JOIN attachment a ON a.owner_type = 'invoice' AND a.owner_id = i.invoice_id
         GROUP BY i.invoice_id
         ORDER BY i.issue_date DESC, i.invoice_id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let attachment_count: i64 = row.get(24)?;
        Ok(FormRecord {
            id: row.get(0)?,
            title: row.get(1)?,
            invoice_number: row.get(2)?,
            invoice_kind: row.get(3)?,
            amount: row.get(4)?,
            tax_amount: row.get(5)?,
            purchase_date: row.get(6)?,
            issue_date: row.get(7)?,
            group_id: row.get(9)?,
            group_name: row.get(10)?,
            content_type: row.get(8)?,
            status: row.get(11)?,
            has_invoice: attachment_count > 0,
            is_matched: false,
            invoice_confirmed: row.get::<_, i64>(22)? == 1,
            attachment_count,
            seller_name: row.get(12)?,
            seller_tax_no: row.get(13)?,
            buyer_name: row.get(14)?,
            buyer_tax_no: row.get(15)?,
            invoice_item_name: row.get(21)?,
            invoice_remark: row.get(16)?,
            remark: row.get(17)?,
            item_spec_model: row.get(18)?,
            item_unit: row.get(19)?,
            item_quantity: row.get(20)?,
            updated_at: row.get(23)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_batches(conn: &rusqlite::Connection) -> AppResult<Vec<ReimbursementBatch>> {
    let mut stmt = conn.prepare(
        "SELECT r.reimbursement_id, r.reimbursement_no, r.group_id, COALESCE(g.group_name, ''),
                r.total_amount, r.status, r.apply_time, r.completed_time, r.status_timeline,
                r.remark, r.quick_submit_text, r.updated_at
         FROM reimbursement r
         LEFT JOIN expense_group g ON g.group_id = r.group_id
         ORDER BY r.apply_time DESC",
    )?;
    let mut rows = stmt.query([])?;
    let mut batches = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        batches.push(ReimbursementBatch {
            id,
            no: row.get(1)?,
            group_id: row.get(2)?,
            group_name: row.get(3)?,
            total_amount: row.get(4)?,
            status: row.get(5)?,
            apply_time: row.get(6)?,
            updated_time: row.get(11)?,
            completed_time: row.get(7)?,
            status_timeline: parse_status_timeline(row.get(8)?),
            remark: row.get(9)?,
            quick_submit_text: row.get(10)?,
            items: load_batch_items(conn, id)?,
        });
    }
    Ok(batches)
}

fn parse_status_timeline(json: String) -> Vec<BatchStatusEvent> {
    serde_json::from_str(&json).unwrap_or_default()
}

fn load_batch_items(
    conn: &rusqlite::Connection,
    batch_id: i64,
) -> AppResult<Vec<ReimbursementItem>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, reimbursement_id, COALESCE(invoice_id, order_id, 0), item_name, amount,
                reconciled_amount, status, exception_reason, remark
         FROM reimbursement_item WHERE reimbursement_id = ?1 ORDER BY item_id",
    )?;
    let rows = stmt.query_map(params![batch_id], |row| {
        Ok(ReimbursementItem {
            id: row.get(0)?,
            batch_id: row.get(1)?,
            form_id: row.get(2)?,
            title: row.get(3)?,
            amount: row.get(4)?,
            reconciled_amount: row.get(5)?,
            status: row.get(6)?,
            exception_reason: row.get(7)?,
            remark: row.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_transactions(conn: &rusqlite::Connection) -> AppResult<Vec<ReconciliationTransaction>> {
    let mut stmt = conn.prepare(
        "SELECT transaction_id, transaction_no, amount, transaction_time, category, direction, status, remark
         FROM reconciliation_transaction ORDER BY transaction_time DESC",
    )?;
    let mut rows = stmt.query([])?;
    let mut transactions = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        transactions.push(ReconciliationTransaction {
            id,
            no: row.get(1)?,
            amount: row.get(2)?,
            transaction_time: row.get(3)?,
            category: row.get(4)?,
            direction: row.get(5)?,
            status: row.get(6)?,
            remark: row.get(7)?,
            attachment_count: count_transaction_attachments(conn, id)?,
            matched_batch_ids: load_transaction_batch_ids(conn, id)?,
            matched_item_ids: load_transaction_item_ids(conn, id)?,
        });
    }
    Ok(transactions)
}

fn count_transaction_attachments(
    conn: &rusqlite::Connection,
    transaction_id: i64,
) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(1) FROM attachment WHERE owner_type = 'transaction' AND owner_id = ?1",
        params![transaction_id],
        |row| row.get(0),
    )?)
}

fn load_transaction_batch_ids(
    conn: &rusqlite::Connection,
    transaction_id: i64,
) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT COALESCE(m.reimbursement_id, ri.reimbursement_id)
         FROM reconciliation_match m
         LEFT JOIN reimbursement_item ri ON ri.item_id = m.item_id
         WHERE m.transaction_id = ?1 AND COALESCE(m.reimbursement_id, ri.reimbursement_id) IS NOT NULL",
    )?;
    let rows = stmt.query_map(params![transaction_id], |row| row.get::<_, i64>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_transaction_item_ids(
    conn: &rusqlite::Connection,
    transaction_id: i64,
) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT item_id FROM reconciliation_match WHERE transaction_id = ?1 AND item_id IS NOT NULL",
    )?;
    let rows = stmt.query_map(params![transaction_id], |row| row.get::<_, i64>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn load_attachments(conn: &rusqlite::Connection) -> AppResult<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT attachment_id, owner_type, owner_id, file_name, file_type, relative_path, remark, uploaded_at
         FROM attachment ORDER BY uploaded_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Attachment {
            id: row.get(0)?,
            owner_type: row.get(1)?,
            owner_id: row.get(2)?,
            file_name: row.get(3)?,
            file_type: row.get(4)?,
            relative_path: row.get(5)?,
            remark: row.get(6)?,
            uploaded_at: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
