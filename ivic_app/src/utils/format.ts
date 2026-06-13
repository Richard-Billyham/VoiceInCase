export function formatMoney(value: number, hidden = false) {
  if (hidden) {
    return "¥ ****";
  }
  return `¥ ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["已完成", "已到账", "已报销", "已对账", "已匹配"].includes(status)) {
    return "success";
  }
  if (["待提交", "批次创建", "部分到账", "部分对账", "待补充", "待匹配"].includes(status)) {
    return "warning";
  }
  if (["待开票", "异常", "异常处理", "异常结项", "金额差异", "已驳回", "已作废", "报销失败"].includes(status)) {
    return "danger";
  }
  if (["报销中", "处理中", "审核中", "已提交"].includes(status)) {
    return "info";
  }
  return "neutral";
}
