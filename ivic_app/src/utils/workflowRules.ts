import type { AppData, BatchStatus, FormRecord, InvoiceStatus, ReimbursementBatch } from "../types/domain";

export const invoiceStatusOptions: InvoiceStatus[] = ["待开票", "待匹配", "待提交", "批次创建", "已提交", "已到账", "报销失败"];

export const batchStatusOptions: BatchStatus[] = ["待提交", "已提交", "已报销", "部分到账", "已到账", "异常处理", "已取消"];

export function normalizeInvoiceStatus(status: string): InvoiceStatus {
  if (status === "待开票" || status === "待匹配" || status === "待提交" || status === "批次创建" || status === "已提交" || status === "已到账" || status === "报销失败") {
    return status;
  }
  if (status === "已报销" || status === "已完成") {
    return "已到账";
  }
  if (status === "报销中" || status === "部分到账" || status === "处理中" || status === "审核中") {
    return "已提交";
  }
  if (status === "异常结项" || status === "已取消" || status === "已作废" || status === "需处理") {
    return "报销失败";
  }
  return status === "待匹配" ? "待开票" : "待提交";
}

export function normalizeBatchStatus(status: string): BatchStatus {
  if (status === "待提交" || status === "已提交" || status === "已报销" || status === "已到账" || status === "部分到账" || status === "异常处理" || status === "已取消") {
    return status;
  }
  if (status === "已完成") {
    return "已到账";
  }
  if (status === "异常结项" || status === "需处理") {
    return "异常处理";
  }
  return status === "审核中" || status === "处理中" ? "已提交" : "待提交";
}

export function normalizeBatchWorkflow(batch: ReimbursementBatch): ReimbursementBatch {
  const baseStatus = normalizeBatchStatus(batch.status);
  const items = batch.items.map((item) => ({
    ...item,
    status: normalizeInvoiceStatus(item.status),
  }));
  const derivedStatus = deriveBatchStatusFromItems(baseStatus, items);
  return {
    ...batch,
    status: derivedStatus,
    items,
  };
}

export function normalizeFormWorkflow(form: FormRecord, batches: ReimbursementBatch[]): FormRecord {
  const batchItem = batches
    .flatMap((batch) => batch.items.map((item) => ({ batch, item })))
    .find(({ item }) => item.formId === form.id);
  const normalizedStatus = normalizeInvoiceStatus(form.status);
  const status = form.contentType === "订单+发票" && batchItem
    ? formStatusForBatchItem(batchItem.batch, batchItem.item, normalizedStatus)
    : normalizedStatus;
  return {
    ...form,
    status,
    hasInvoice: hasInvoiceContent(form),
    isMatched: isMatchedContent(form),
    invoiceConfirmed: typeof form.invoiceConfirmed === "boolean" ? form.invoiceConfirmed : !hasInvoiceContent(form),
  };
}

export function normalizeFormsWorkflow(data: AppData) {
  const batches = data.batches.map(normalizeBatchWorkflow);
  return data.forms.map((form) => normalizeFormWorkflow(form, batches));
}

export function invoiceMatchLabel(form: FormRecord) {
  return `${hasInvoiceContent(form) ? "有票" : "缺票"} · ${isMatchedContent(form) ? "已匹配" : "待匹配"}`;
}

export function coerceFormWorkflowStatus(form: Pick<FormRecord, "contentType" | "id" | "status">, batches: ReimbursementBatch[] = []): InvoiceStatus {
  const status = normalizeInvoiceStatus(form.status);
  return validateInvoiceStatusForSave(form, batches) ? defaultInvoiceStatusForContent(form.contentType) : status;
}

export function allowedInvoiceStatusesForForm(form: Pick<FormRecord, "contentType" | "id" | "status">, batches: ReimbursementBatch[] = []): InvoiceStatus[] {
  void form;
  void batches;
  return invoiceStatusOptions;
}

export function defaultInvoiceStatusForContent(contentType: FormRecord["contentType"]): InvoiceStatus {
  if (contentType === "订单") {
    return "待开票";
  }
  if (contentType === "发票") {
    return "待匹配";
  }
  return "待提交";
}

export function validateInvoiceStatusForSave(form: Pick<FormRecord, "contentType" | "id" | "status">, batches: ReimbursementBatch[] = []) {
  const status = normalizeInvoiceStatus(form.status);
  const inBatch = batches.some((batch) => batch.items.some((item) => item.formId === form.id));
  if (form.contentType === "订单" && status !== "待开票" && status !== "报销失败") {
    return "单独订单只能保存为“待开票”或“报销失败”。";
  }
  if (form.contentType === "发票" && status !== "待匹配" && status !== "报销失败") {
    return "单独发票只能保存为“待匹配”或“报销失败”。";
  }
  if (form.contentType === "订单+发票" && ["批次创建", "已提交", "已到账"].includes(status) && !inBatch) {
    return "该记录还不在提交批次中，请先创建提交批次后再改为批次创建、已提交或已到账。";
  }
  return "";
}

export function deriveBatchStatusFromItems(status: BatchStatus, items: Array<Pick<ReimbursementBatch["items"][number], "status">>): BatchStatus {
  const normalizedStatus = normalizeBatchStatus(status);
  const normalizedItems = items.map((item) => normalizeInvoiceStatus(item.status));
  const itemCount = normalizedItems.length;
  if (normalizedStatus === "已取消" || itemCount === 0) {
    return normalizedStatus;
  }
  if (normalizedItems.some((itemStatus) => itemStatus === "报销失败")) {
    return "异常处理";
  }
  const paidCount = normalizedItems.filter((itemStatus) => itemStatus === "已到账").length;
  if (paidCount === itemCount) {
    return "已到账";
  }
  if (paidCount > 0 || normalizedStatus === "部分到账") {
    return "部分到账";
  }
  if (normalizedStatus === "已报销") {
    return "已报销";
  }
  if (normalizedItems.some((itemStatus) => itemStatus === "已提交")) {
    return "已提交";
  }
  if (normalizedStatus === "异常处理") {
    return normalizedStatus;
  }
  return "待提交";
}

function hasInvoiceContent(form: FormRecord) {
  return form.contentType !== "订单" || form.hasInvoice;
}

function isMatchedContent(form: FormRecord) {
  return form.contentType === "订单+发票" || form.isMatched;
}

function formStatusForBatchItem(
  batch: ReimbursementBatch,
  item: ReimbursementBatch["items"][number],
  fallback: InvoiceStatus,
): InvoiceStatus {
  const batchStatus = normalizeBatchStatus(batch.status);
  const itemStatus = normalizeInvoiceStatus(item.status);
  if (batchStatus === "已到账" || itemStatus === "已到账") {
    return "已到账";
  }
  if (batchStatus === "已报销") {
    return "已到账";
  }
  if (batchStatus === "异常处理" || batchStatus === "已取消" || itemStatus === "报销失败") {
    return "报销失败";
  }
  if (batchStatus === "已提交" || batchStatus === "部分到账" || itemStatus === "已提交") {
    return "已提交";
  }
  return fallback === "报销失败" ? "报销失败" : "批次创建";
}
