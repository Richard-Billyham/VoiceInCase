export function formatMoney(value: number, hidden = false) {
  if (hidden) {
    return "¥ ****";
  }
  return `¥ ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type StatusTone =
  | "neutral"
  | "draft"
  | "match"
  | "submit"
  | "queued"
  | "progress"
  | "partial"
  | "success"
  | "warning"
  | "cancelled"
  | "danger"
  | "info";

export function statusTone(status: string): StatusTone {
  if (["已完成", "已到账", "已对账", "已匹配"].includes(status)) {
    return "success";
  }
  if (["待匹配"].includes(status)) {
    return "match";
  }
  if (["待提交"].includes(status)) {
    return "submit";
  }
  if (["批次创建"].includes(status)) {
    return "queued";
  }
  if (["部分到账", "部分对账"].includes(status)) {
    return "partial";
  }
  if (["待补充", "已驳回"].includes(status)) {
    return "warning";
  }
  if (["待开票"].includes(status)) {
    return "draft";
  }
  if (["已取消", "已作废", "已退回"].includes(status)) {
    return "cancelled";
  }
  if (["异常", "异常处理", "异常结项", "金额差异", "报销失败"].includes(status)) {
    return "danger";
  }
  if (["报销中", "处理中", "审核中", "已提交", "待对账"].includes(status)) {
    return "progress";
  }
  return "neutral";
}
