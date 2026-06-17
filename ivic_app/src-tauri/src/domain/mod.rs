pub fn normalize_invoice_status(status: &str) -> String {
    match status {
        "待开票" | "待匹配" | "待提交" | "批次创建" | "已提交" | "已到账" | "报销失败" => {
            status.to_string()
        }
        "已完成" => "已到账".to_string(),
        "已报销" => "已提交".to_string(),
        "报销中" | "部分到账" | "处理中" | "审核中" => "已提交".to_string(),
        "异常结项" | "已取消" | "已作废" | "需处理" => "报销失败".to_string(),
        _ => "待提交".to_string(),
    }
}

pub fn normalize_batch_status(status: &str) -> String {
    match status {
        "待提交" | "已提交" | "已到账" | "部分到账" | "异常处理" | "已取消" => {
            status.to_string()
        }
        "已完成" => "已到账".to_string(),
        "已报销" | "审核中" | "处理中" => "已提交".to_string(),
        "异常结项" | "需处理" => "异常处理".to_string(),
        _ => "待提交".to_string(),
    }
}

pub fn batch_item_status_for_form_status(status: &str) -> &'static str {
    match status {
        "已到账" => "已到账",
        "报销失败" => "报销失败",
        "已提交" => "已提交",
        "批次创建" | "待提交" => "批次创建",
        _ => "批次创建",
    }
}

pub fn form_status_for_batch_item(batch_status: &str, item_status: &str) -> &'static str {
    let batch_status = normalize_batch_status(batch_status);
    let item_status = normalize_invoice_status(item_status);
    if batch_status == "已到账" || item_status == "已到账" {
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

pub fn derive_batch_status_from_item_details(
    current_status: &str,
    items: &[(&str, f64)],
) -> String {
    let status = normalize_batch_status(current_status);
    if status == "已取消" || items.is_empty() {
        return status;
    }
    let normalized: Vec<String> = items
        .iter()
        .map(|(item_status, _)| normalize_invoice_status(item_status))
        .collect();
    let has_reconciled_amount = items.iter().any(|(_, reconciled)| *reconciled > 0.0);
    let paid_count = normalized
        .iter()
        .filter(|item_status| item_status.as_str() == "已到账")
        .count();
    if paid_count == normalized.len() {
        return "已到账".to_string();
    }
    if paid_count > 0 || has_reconciled_amount || status == "部分到账" {
        return "部分到账".to_string();
    }
    if normalized.iter().any(|item_status| item_status == "已提交") {
        return "已提交".to_string();
    }
    if status == "异常处理" {
        return status;
    }
    "待提交".to_string()
}

pub fn transaction_status_for_match_total(amount: f64, matched: f64) -> String {
    if matched <= 0.0 {
        return "待对账".to_string();
    }
    if (matched - amount).abs() < 0.01 {
        return "已对账".to_string();
    }
    if matched < amount {
        return "部分对账".to_string();
    }
    "金额差异".to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        derive_batch_status_from_item_details, form_status_for_batch_item, normalize_batch_status,
        transaction_status_for_match_total,
    };

    #[test]
    fn transaction_statuses_cover_difference() {
        assert_eq!(transaction_status_for_match_total(100.0, 0.0), "待对账");
        assert_eq!(transaction_status_for_match_total(100.0, 60.0), "部分对账");
        assert_eq!(transaction_status_for_match_total(100.0, 100.0), "已对账");
        assert_eq!(transaction_status_for_match_total(100.0, 120.0), "金额差异");
    }

    #[test]
    fn old_reimbursed_status_normalizes_to_submitted() {
        assert_eq!(normalize_batch_status("已报销"), "已提交");
    }

    #[test]
    fn partial_payment_takes_priority_over_failed_items() {
        let items = vec![("已到账", 100.0), ("报销失败", 0.0)];
        assert_eq!(
            derive_batch_status_from_item_details("部分到账", &items),
            "部分到账"
        );
    }

    #[test]
    fn reconciled_amount_marks_batch_partially_paid() {
        let items = vec![("已提交", 50.0), ("报销失败", 0.0)];
        assert_eq!(
            derive_batch_status_from_item_details("已提交", &items),
            "部分到账"
        );
    }

    #[test]
    fn submitted_with_failed_items_stays_submitted() {
        let items = vec![("已提交", 0.0), ("报销失败", 0.0)];
        assert_eq!(
            derive_batch_status_from_item_details("已提交", &items),
            "已提交"
        );
    }

    #[test]
    fn created_with_failed_items_stays_pending() {
        let items = vec![("批次创建", 0.0), ("报销失败", 0.0)];
        assert_eq!(
            derive_batch_status_from_item_details("待提交", &items),
            "待提交"
        );
    }

    #[test]
    fn batch_item_maps_back_to_form_status() {
        assert_eq!(form_status_for_batch_item("待提交", "批次创建"), "批次创建");
        assert_eq!(form_status_for_batch_item("已提交", "批次创建"), "已提交");
        assert_eq!(form_status_for_batch_item("部分到账", "已到账"), "已到账");
        assert_eq!(form_status_for_batch_item("异常处理", "已提交"), "报销失败");
    }
}
