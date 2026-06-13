use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

use crate::db;
use crate::errors::AppResult;
use crate::models::Settings;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_group (
  group_id INTEGER PRIMARY KEY,
  group_name TEXT NOT NULL UNIQUE,
  owner_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  invoice_title_rule TEXT NOT NULL DEFAULT '',
  quick_submit_template TEXT NOT NULL DEFAULT '',
  attachment_rule_config TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#4f7d5a',
  remark TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice (
  invoice_id INTEGER PRIMARY KEY,
  seller_name TEXT NOT NULL DEFAULT '',
  seller_tax_no TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_tax_no TEXT NOT NULL DEFAULT '',
  group_id INTEGER,
  invoice_code TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_kind TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL,
  purchase_date TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '发票',
  item_name TEXT NOT NULL,
  invoice_item_name TEXT NOT NULL DEFAULT '',
  spec_model TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity REAL,
  amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待开票',
  invoice_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount >= 0),
  CHECK (tax_amount >= 0),
  FOREIGN KEY (group_id) REFERENCES expense_group(group_id)
);

CREATE TABLE IF NOT EXISTS order_item (
  order_id INTEGER PRIMARY KEY,
  invoice_id INTEGER,
  group_id INTEGER,
  title TEXT NOT NULL,
  order_text TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  order_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_type TEXT NOT NULL DEFAULT '订单',
  status TEXT NOT NULL DEFAULT '待开票',
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount >= 0),
  FOREIGN KEY (invoice_id) REFERENCES invoice(invoice_id),
  FOREIGN KEY (group_id) REFERENCES expense_group(group_id)
);

CREATE TABLE IF NOT EXISTS attachment (
  attachment_id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT '其他',
  relative_path TEXT NOT NULL,
  file_hash TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reimbursement (
  reimbursement_id INTEGER PRIMARY KEY,
  reimbursement_no TEXT NOT NULL UNIQUE,
  group_id INTEGER,
  total_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '待提交',
  apply_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_time TEXT,
  status_timeline TEXT NOT NULL DEFAULT '[]',
  remark TEXT NOT NULL DEFAULT '',
  quick_submit_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (total_amount >= 0),
  FOREIGN KEY (group_id) REFERENCES expense_group(group_id)
);

CREATE TABLE IF NOT EXISTS reimbursement_item (
  item_id INTEGER PRIMARY KEY,
  reimbursement_id INTEGER NOT NULL,
  invoice_id INTEGER,
  order_id INTEGER,
  group_id INTEGER,
  item_name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  reconciled_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '待提交',
  exception_reason TEXT NOT NULL DEFAULT '',
  exception_time TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount >= 0),
  CHECK (reconciled_amount >= 0),
  FOREIGN KEY (reimbursement_id) REFERENCES reimbursement(reimbursement_id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoice(invoice_id),
  FOREIGN KEY (order_id) REFERENCES order_item(order_id),
  FOREIGN KEY (group_id) REFERENCES expense_group(group_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_transaction (
  transaction_id INTEGER PRIMARY KEY,
  transaction_no TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  transaction_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  category TEXT NOT NULL DEFAULT '报销到账',
  direction TEXT NOT NULL DEFAULT '收入',
  status TEXT NOT NULL DEFAULT '待对账',
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reconciliation_match (
  match_id INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL,
  reimbursement_id INTEGER,
  item_id INTEGER,
  matched_amount REAL NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (matched_amount > 0),
  CHECK (reimbursement_id IS NOT NULL OR item_id IS NOT NULL),
  FOREIGN KEY (transaction_id) REFERENCES reconciliation_transaction(transaction_id) ON DELETE CASCADE,
  FOREIGN KEY (reimbursement_id) REFERENCES reimbursement(reimbursement_id),
  FOREIGN KEY (item_id) REFERENCES reimbursement_item(item_id)
);

CREATE TABLE IF NOT EXISTS status_log (
  log_id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  operate_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS import_log (
  import_id INTEGER PRIMARY KEY,
  source_name TEXT NOT NULL,
  import_type TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  problem_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_group ON invoice(group_id);
CREATE INDEX IF NOT EXISTS idx_order_group ON order_item(group_id);
CREATE INDEX IF NOT EXISTS idx_attachment_owner ON attachment(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_match_transaction ON reconciliation_match(transaction_id);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
"#;

pub fn ensure_database(app: &AppHandle) -> AppResult<()> {
    let conn = db::connect(app)?;
    apply_schema(&conn)?;
    ensure_default_settings(&conn, &db::default_settings(app)?)?;
    Ok(())
}

pub fn apply_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(SCHEMA)?;
    ensure_invoice_import_fields(conn)?;
    ensure_group_template_fields(conn)?;
    ensure_reimbursement_timeline_fields(conn)?;
    remove_legacy_seed_data(conn)?;
    Ok(())
}

fn remove_legacy_seed_data(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        DELETE FROM reconciliation_match
        WHERE transaction_id IN (
            SELECT transaction_id FROM reconciliation_transaction
            WHERE transaction_id IN (401, 402)
              AND transaction_no IN ('IN-20260609-001', 'IN-20260610-001')
        )
        OR item_id IN (
            SELECT item_id FROM reimbursement_item
            WHERE item_id IN (301, 302)
              AND item_name IN ('传感器模块采购', '上海会议注册费')
        )
        OR reimbursement_id IN (
            SELECT reimbursement_id FROM reimbursement
            WHERE reimbursement_id IN (201, 202)
              AND reimbursement_no IN ('RB-202606-001', 'RB-202606-002')
        );

        DELETE FROM reconciliation_transaction
        WHERE transaction_id IN (401, 402)
          AND transaction_no IN ('IN-20260609-001', 'IN-20260610-001');

        DELETE FROM reimbursement_item
        WHERE item_id IN (301, 302)
          AND item_name IN ('传感器模块采购', '上海会议注册费');

        DELETE FROM reimbursement
        WHERE reimbursement_id IN (201, 202)
          AND reimbursement_no IN ('RB-202606-001', 'RB-202606-002');

        DELETE FROM attachment
        WHERE attachment_id IN (501, 502)
          AND file_name IN ('meeting-invoice.pdf', 'sensor.pdf')
          AND relative_path IN ('invoices/meeting-invoice.pdf', 'invoices/sensor.pdf');

        DELETE FROM invoice
        WHERE invoice_id IN (101, 102, 103, 104)
          AND item_name IN ('上海会议注册费', '高铁票往返', '传感器模块采购', '云服务订阅')
          AND issue_date BETWEEN '2026-06-01' AND '2026-06-05';

        DELETE FROM expense_group
        WHERE group_id IN (1, 2, 3)
          AND group_name IN ('科研差旅', '实验材料', '个人垫付')
          AND NOT EXISTS (
              SELECT 1 FROM invoice WHERE invoice.group_id = expense_group.group_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM reimbursement WHERE reimbursement.group_id = expense_group.group_id
          );
        ",
    )?;
    Ok(())
}

fn ensure_default_settings(conn: &Connection, defaults: &Settings) -> AppResult<()> {
    let json: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'app'", [], |row| {
            row.get(0)
        })
        .optional()?;
    let mut settings = match json {
        Some(json) => serde_json::from_str::<Settings>(&json).unwrap_or_else(|_| defaults.clone()),
        None => defaults.clone(),
    };
    if settings.database_path.trim().is_empty() || settings.database_path == "IVIC_DATA/ivic.sqlite"
    {
        settings.database_path = defaults.database_path.clone();
    }
    if settings.attachment_dir.trim().is_empty()
        || settings.attachment_dir == "IVIC_DATA/attachments"
    {
        settings.attachment_dir = defaults.attachment_dir.clone();
    }
    conn.execute(
        "INSERT INTO settings(key, value, updated_at) VALUES('app', ?1, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        params![serde_json::to_string(&settings)?],
    )?;
    Ok(())
}

fn ensure_group_template_fields(conn: &Connection) -> AppResult<()> {
    let has_quick_submit_template = conn
        .prepare("SELECT quick_submit_template FROM expense_group LIMIT 1")
        .is_ok();
    if !has_quick_submit_template {
        conn.execute(
            "ALTER TABLE expense_group ADD COLUMN quick_submit_template TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    let has_attachment_rule_config = conn
        .prepare("SELECT attachment_rule_config FROM expense_group LIMIT 1")
        .is_ok();
    if !has_attachment_rule_config {
        conn.execute(
            "ALTER TABLE expense_group ADD COLUMN attachment_rule_config TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    Ok(())
}

fn ensure_invoice_import_fields(conn: &Connection) -> AppResult<()> {
    let has_purchase_date = conn
        .prepare("SELECT purchase_date FROM invoice LIMIT 1")
        .is_ok();
    if !has_purchase_date {
        conn.execute(
            "ALTER TABLE invoice ADD COLUMN purchase_date TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    let has_content_type = conn
        .prepare("SELECT content_type FROM invoice LIMIT 1")
        .is_ok();
    if !has_content_type {
        conn.execute(
            "ALTER TABLE invoice ADD COLUMN content_type TEXT NOT NULL DEFAULT '发票'",
            [],
        )?;
    }
    let has_invoice_kind = conn
        .prepare("SELECT invoice_kind FROM invoice LIMIT 1")
        .is_ok();
    if !has_invoice_kind {
        conn.execute(
            "ALTER TABLE invoice ADD COLUMN invoice_kind TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    let has_invoice_confirmed = conn
        .prepare("SELECT invoice_confirmed FROM invoice LIMIT 1")
        .is_ok();
    if !has_invoice_confirmed {
        conn.execute(
            "ALTER TABLE invoice ADD COLUMN invoice_confirmed INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    let has_invoice_item_name = conn
        .prepare("SELECT invoice_item_name FROM invoice LIMIT 1")
        .is_ok();
    if !has_invoice_item_name {
        conn.execute(
            "ALTER TABLE invoice ADD COLUMN invoice_item_name TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    conn.execute(
        "UPDATE invoice SET invoice_confirmed = CASE WHEN content_type = '订单' THEN 1 ELSE invoice_confirmed END",
        [],
    )?;
    conn.execute(
        "UPDATE invoice SET purchase_date = issue_date WHERE purchase_date = ''",
        [],
    )?;
    Ok(())
}

fn ensure_reimbursement_timeline_fields(conn: &Connection) -> AppResult<()> {
    let has_status_timeline = conn
        .prepare("SELECT status_timeline FROM reimbursement LIMIT 1")
        .is_ok();
    if !has_status_timeline {
        conn.execute(
            "ALTER TABLE reimbursement ADD COLUMN status_timeline TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::apply_schema;
    use rusqlite::Connection;

    #[test]
    fn fresh_schema_does_not_seed_demo_data() {
        let conn = Connection::open_in_memory().expect("open in-memory db");

        apply_schema(&conn).expect("apply schema");

        for table in [
            "expense_group",
            "invoice",
            "attachment",
            "reimbursement",
            "reimbursement_item",
            "reconciliation_transaction",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(1) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("read table count");
            assert_eq!(count, 0, "{table} should be empty after schema creation");
        }
    }

    #[test]
    fn apply_schema_removes_legacy_seed_data() {
        let conn = Connection::open_in_memory().expect("open in-memory db");

        apply_schema(&conn).expect("apply schema");
        conn.execute_batch(
            "
            INSERT INTO expense_group(group_id, group_name, owner_name, category, invoice_title_rule, color, remark)
            VALUES
              (1, '科研差旅', '林老师', '差旅/会议', '大学|学院|会务|酒店', '#4f7d5a', '会议注册费、住宿和交通票据归入此组。'),
              (99, '真实分组', '用户', '真实', '', '#4f7d5a', '');

            INSERT INTO invoice(invoice_id, seller_name, buyer_name, group_id, invoice_number, issue_date, content_type, item_name, amount, tax_amount, description, status)
            VALUES
              (101, '上海会务服务有限公司', '某某大学', 1, 'IV20260601001', '2026-06-01', '订单+发票', '上海会议注册费', 1800, 54, '已附会议通知截图', '批次创建'),
              (999, '真实商家', '真实买方', 99, 'REAL-001', '2026-06-01', '发票', '真实票据', 1, 0, '', '待提交');

            INSERT INTO attachment(attachment_id, owner_type, owner_id, file_name, file_type, relative_path, remark)
            VALUES
              (501, 'invoice', 101, 'meeting-invoice.pdf', '发票原件', 'invoices/meeting-invoice.pdf', '发票 PDF');

            INSERT INTO reimbursement(reimbursement_id, reimbursement_no, group_id, total_amount, status, apply_time, remark, quick_submit_text)
            VALUES
              (201, 'RB-202606-001', 1, 1800, '已提交', '2026-06-05 14:22', '会议注册费', '上海会议注册费；金额 1800.00；会议通知见附件。');

            INSERT INTO reimbursement_item(item_id, reimbursement_id, invoice_id, group_id, item_name, amount, reconciled_amount, status, remark)
            VALUES
              (301, 201, 101, 1, '上海会议注册费', 1800, 0, '批次创建', '');

            INSERT INTO reconciliation_transaction(transaction_id, transaction_no, amount, transaction_time, category, direction, status, remark)
            VALUES
              (401, 'IN-20260609-001', 1800, '2026-06-09 16:42', '报销到账', '收入', '待对账', '银行卡到账截图已上传');
            ",
        )
        .expect("insert legacy seed data");

        apply_schema(&conn).expect("reapply schema");

        for (table, predicate) in [
            ("expense_group", "group_id = 1"),
            ("invoice", "invoice_id = 101"),
            ("attachment", "attachment_id = 501"),
            ("reimbursement", "reimbursement_id = 201"),
            ("reimbursement_item", "item_id = 301"),
            ("reconciliation_transaction", "transaction_id = 401"),
        ] {
            let count: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(1) FROM {table} WHERE {predicate}"),
                    [],
                    |row| row.get(0),
                )
                .expect("read legacy row count");
            assert_eq!(count, 0, "{table} legacy seed row should be removed");
        }

        let real_count: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM invoice WHERE invoice_id = 999",
                [],
                |row| row.get(0),
            )
            .expect("read real row count");
        assert_eq!(real_count, 1);
    }

    #[test]
    fn applies_invoice_confirmed_to_existing_invoice_table() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE invoice (
              invoice_id INTEGER PRIMARY KEY,
              seller_name TEXT NOT NULL DEFAULT '',
              seller_tax_no TEXT NOT NULL DEFAULT '',
              buyer_name TEXT NOT NULL DEFAULT '',
              buyer_tax_no TEXT NOT NULL DEFAULT '',
              group_id INTEGER,
              invoice_code TEXT NOT NULL DEFAULT '',
              invoice_number TEXT NOT NULL DEFAULT '',
              issue_date TEXT NOT NULL,
              purchase_date TEXT NOT NULL DEFAULT '',
              content_type TEXT NOT NULL DEFAULT '发票',
              item_name TEXT NOT NULL,
              spec_model TEXT NOT NULL DEFAULT '',
              unit TEXT NOT NULL DEFAULT '',
              quantity REAL,
              amount REAL NOT NULL DEFAULT 0,
              tax_amount REAL NOT NULL DEFAULT 0,
              description TEXT NOT NULL DEFAULT '',
              raw_text TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT '待开票',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO invoice(invoice_id, issue_date, content_type, item_name)
            VALUES (1, '2026-06-12', '订单', '旧订单');
            ",
        )
        .expect("create old invoice table");

        apply_schema(&conn).expect("apply schema to old table");

        let confirmed: i64 = conn
            .query_row(
                "SELECT invoice_confirmed FROM invoice WHERE invoice_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read invoice_confirmed");
        assert_eq!(confirmed, 1);
    }
}
