pub fn item_status_for_reconciled_amount(amount: f64, reconciled: f64, current: &str) -> String {
    if matches!(current, "异常处理" | "已取消") {
        return current.to_string();
    }
    if reconciled <= 0.0 {
        return "待提交".to_string();
    }
    if reconciled + 0.01 >= amount {
        return "已到账".to_string();
    }
    "部分到账".to_string()
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
    use super::{item_status_for_reconciled_amount, transaction_status_for_match_total};

    #[test]
    fn reconciled_item_statuses_cover_partial_and_complete() {
        assert_eq!(
            item_status_for_reconciled_amount(100.0, 0.0, "已提交"),
            "待提交"
        );
        assert_eq!(
            item_status_for_reconciled_amount(100.0, 50.0, "已提交"),
            "部分到账"
        );
        assert_eq!(
            item_status_for_reconciled_amount(100.0, 100.0, "已提交"),
            "已到账"
        );
    }

    #[test]
    fn transaction_statuses_cover_difference() {
        assert_eq!(transaction_status_for_match_total(100.0, 0.0), "待对账");
        assert_eq!(transaction_status_for_match_total(100.0, 60.0), "部分对账");
        assert_eq!(transaction_status_for_match_total(100.0, 100.0), "已对账");
        assert_eq!(transaction_status_for_match_total(100.0, 120.0), "金额差异");
    }
}
