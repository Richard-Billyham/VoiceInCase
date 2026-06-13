use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseGroup {
    pub id: i64,
    pub name: String,
    pub owner_name: String,
    pub category: String,
    pub title_rule: String,
    #[serde(default)]
    pub quick_submit_template: String,
    #[serde(default)]
    pub attachment_rule_config: String,
    pub color: String,
    pub remark: String,
    pub is_active: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormRecord {
    pub id: i64,
    pub title: String,
    pub invoice_number: String,
    #[serde(default)]
    pub invoice_kind: String,
    pub amount: f64,
    pub tax_amount: f64,
    pub purchase_date: String,
    pub issue_date: String,
    pub group_id: Option<i64>,
    pub group_name: String,
    pub content_type: String,
    pub status: String,
    pub has_invoice: bool,
    pub is_matched: bool,
    #[serde(default)]
    pub invoice_confirmed: bool,
    pub attachment_count: i64,
    pub seller_name: String,
    #[serde(default)]
    pub seller_tax_no: String,
    pub buyer_name: String,
    #[serde(default)]
    pub buyer_tax_no: String,
    #[serde(default)]
    pub invoice_item_name: String,
    #[serde(default)]
    pub invoice_remark: String,
    #[serde(default)]
    pub item_spec_model: String,
    #[serde(default)]
    pub item_unit: String,
    #[serde(default)]
    pub item_quantity: Option<f64>,
    pub remark: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReimbursementItem {
    pub id: i64,
    pub batch_id: i64,
    pub form_id: i64,
    pub title: String,
    pub amount: f64,
    pub reconciled_amount: f64,
    pub status: String,
    pub exception_reason: String,
    pub remark: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchStatusEvent {
    pub status: String,
    pub timestamp: String,
    pub remark: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReimbursementBatch {
    pub id: i64,
    pub no: String,
    pub group_id: Option<i64>,
    pub group_name: String,
    pub total_amount: f64,
    pub status: String,
    pub apply_time: String,
    #[serde(default)]
    pub updated_time: String,
    pub completed_time: Option<String>,
    #[serde(default)]
    pub status_timeline: Vec<BatchStatusEvent>,
    pub remark: String,
    pub quick_submit_text: String,
    pub items: Vec<ReimbursementItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationTransaction {
    pub id: i64,
    pub no: String,
    pub amount: f64,
    pub transaction_time: String,
    pub category: String,
    pub direction: String,
    pub status: String,
    pub remark: String,
    pub attachment_count: i64,
    pub matched_batch_ids: Vec<i64>,
    pub matched_item_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: i64,
    pub owner_type: String,
    pub owner_id: i64,
    pub file_name: String,
    pub file_type: String,
    pub relative_path: String,
    pub remark: String,
    pub uploaded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAttachmentPayload {
    pub file_name: String,
    pub file_type: String,
    pub remark: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormMatchPair {
    pub order_id: i64,
    pub invoice_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFilePayload {
    pub file_name: String,
    pub file_type: String,
    pub remark: String,
    pub bytes: Vec<u8>,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OcrInvoiceResult {
    pub ok: bool,
    pub message: String,
    pub raw_text: String,
    pub invoice_type: String,
    pub invoice_number: String,
    pub issue_date: String,
    pub buyer_name: String,
    pub buyer_tax_no: String,
    pub seller_name: String,
    pub seller_tax_no: String,
    pub item_name: String,
    pub spec_model: String,
    pub unit: String,
    pub quantity: String,
    pub subtotal_amount: String,
    pub tax_amount: String,
    pub total_with_tax: String,
    pub invoice_remark: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub database_path: String,
    pub attachment_dir: String,
    pub dark_mode: bool,
    pub check_updates: bool,
    pub hide_amounts: bool,
    pub last_backup_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub groups: Vec<ExpenseGroup>,
    pub forms: Vec<FormRecord>,
    pub batches: Vec<ReimbursementBatch>,
    pub transactions: Vec<ReconciliationTransaction>,
    pub attachments: Vec<Attachment>,
    pub settings: Settings,
}
