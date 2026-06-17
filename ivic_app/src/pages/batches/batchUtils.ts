import type { Attachment, BatchStatus, BatchStatusEvent, ExpenseGroup, FormRecord, InvoiceStatus, ReimbursementBatch } from "../../types/domain";
import { collectAttachmentRuleBlockers, formatAttachmentRuleBlockers } from "../../utils/attachmentRules";
import {
  batchItemStatusOptions,
  batchStatusOptions,
  deriveBatchStatusFromItems,
  initialBatchStatusOptions,
  normalizeBatchStatus,
  normalizeBatchWorkflow,
  normalizeInvoiceStatus,
} from "../../utils/workflowRules";

export { batchItemStatusOptions, batchStatusOptions, initialBatchStatusOptions };

export function nowTimestamp() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

export function validateBatchSubmission(
  rows: FormRecord[],
  batches: ReimbursementBatch[] = [],
  groups: ExpenseGroup[] = [],
  attachments: Attachment[] = [],
) {
  if (!rows.length) {
    return "请先选择要提交的表单。";
  }
  const groupKeys = new Set(rows.map((row) => String(row.groupId ?? "none")));
  if (groupKeys.size > 1) {
    return "选中的表单属于不同分组，请按同一分组分别提交。";
  }
  const invalidType = rows.find((row) => row.contentType !== "订单+发票");
  if (invalidType) {
    return `“${invalidType.title}”的类型是“${invalidType.contentType}”，只有“订单+发票”可以提交。`;
  }
  const invalidStatus = rows.find((row) => row.status !== "待提交");
  if (invalidStatus) {
    return `“${invalidStatus.title}”当前状态是“${invalidStatus.status}”，只有“待提交”的订单可以创建提交批次。`;
  }
  const submitted = rows.find((row) => batches.some((batch) => batch.items.some((item) => !item.isReleased && item.formId === row.id)));
  if (submitted) {
    return `“${submitted.title}”已经在提交批次中，请不要重复提交。`;
  }
  const group = groups.find((item) => item.id === rows[0].groupId);
  const attachmentMessage = formatAttachmentRuleBlockers(collectAttachmentRuleBlockers(rows, group, attachments));
  if (attachmentMessage) {
    return attachmentMessage;
  }
  return "";
}

export function normalizeBatchTimeline(batch: ReimbursementBatch): ReimbursementBatch {
  const normalizedBatch = normalizeBatchWorkflow({
    ...batch,
    status: normalizeBatchStatus(batch.status),
    items: batch.items.map((item) => ({ ...item, status: normalizeInvoiceStatus(item.status) })),
  });
  const updatedTime = batch.updatedTime || batch.applyTime;
  const statusTimeline = batch.statusTimeline?.length ? batch.statusTimeline : [makeStatusEvent(normalizedBatch.status, "创建批次", batch.applyTime)];
  return {
    ...normalizedBatch,
    updatedTime,
    statusTimeline,
  };
}

export function failedBatchItemCount(batch: Pick<ReimbursementBatch, "items">) {
  return batch.items.filter((item) => !item.isReleased && normalizeInvoiceStatus(item.status) === "报销失败").length;
}

export function releasedBatchItemCount(batch: Pick<ReimbursementBatch, "items">) {
  return batch.items.filter((item) => item.isReleased).length;
}

export function batchStatusDisplay(batch: Pick<ReimbursementBatch, "status" | "items">) {
  const failedCount = failedBatchItemCount(batch);
  const releasedCount = releasedBatchItemCount(batch);
  return [
    batch.status,
    failedCount > 0 ? `${failedCount} 条失败` : "",
    releasedCount > 0 ? `${releasedCount} 条已退回` : "",
  ].filter(Boolean).join(" · ");
}

export function appendBatchStatusEvent(batch: ReimbursementBatch, status: BatchStatus, remark: string) {
  const timestamp = nowTimestamp();
  const normalized = normalizeBatchTimeline(batch);
  const statusChanged = normalized.status !== status;
  return {
    ...normalized,
    status,
    updatedTime: timestamp,
    completedTime: isFinishedStatus(status) ? timestamp : normalized.completedTime,
    statusTimeline: statusChanged
      ? [...normalized.statusTimeline, makeStatusEvent(status, remark || "状态更新", timestamp)]
      : normalized.statusTimeline,
    items: normalized.items.map((item) => (item.isReleased ? item : { ...item, status: formStatusForBatchStatus(status) })),
  };
}

export function appendBatchItemStatusEvent(
  batch: ReimbursementBatch,
  itemTitle: string,
  fromStatus: InvoiceStatus,
  toStatus: InvoiceStatus,
  nextItems: ReimbursementBatch["items"] = batch.items,
) {
  const timestamp = nowTimestamp();
  const normalized = normalizeBatchTimeline(batch);
  const nextStatus = deriveBatchStatusFromItems(normalized.status, nextItems);
  const batchStatusChanged = normalized.status !== nextStatus;
  if (fromStatus === toStatus) {
    return {
      ...normalized,
      status: nextStatus,
      items: nextItems,
      updatedTime: timestamp,
      completedTime: isFinishedStatus(nextStatus) ? timestamp : normalized.completedTime,
      statusTimeline: batchStatusChanged
        ? [
          ...normalized.statusTimeline,
          makeStatusEvent(nextStatus, `子订单状态变更后，批次状态由“${normalized.status}”自动更新为“${nextStatus}”`, timestamp),
        ]
        : normalized.statusTimeline,
    };
  }
  const itemEvent = makeStatusEvent(normalized.status, `子订单“${itemTitle}”状态由“${fromStatus}”改为“${toStatus}”`, timestamp);
  const timeline = [...normalized.statusTimeline, itemEvent];
  return {
    ...normalized,
    status: nextStatus,
    updatedTime: timestamp,
    completedTime: isFinishedStatus(nextStatus) ? timestamp : normalized.completedTime,
    statusTimeline: batchStatusChanged
      ? [...timeline, makeStatusEvent(nextStatus, `子订单状态变更后，批次状态由“${normalized.status}”自动更新为“${nextStatus}”`, timestamp)]
      : timeline,
    items: nextItems,
  };
}

export function buildSubmissionBatch({
  applyTime,
  no,
  quickSubmitText,
  remark,
  rows,
  status,
  updatedTime,
}: {
  applyTime: string;
  no: string;
  quickSubmitText: string;
  remark: string;
  rows: FormRecord[];
  status: BatchStatus;
  updatedTime: string;
}): ReimbursementBatch {
  const batchId = Date.now();
  const normalizedStatus = normalizeBatchStatus(status);
  return {
    id: batchId,
    no,
    groupId: rows[0].groupId,
    groupName: rows[0].groupName || "未分组",
    totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
    status: normalizedStatus,
    applyTime,
    updatedTime,
    completedTime: isFinishedStatus(normalizedStatus) ? updatedTime : null,
    statusTimeline: [
      makeStatusEvent("待提交", "创建提交批次", applyTime),
      ...(normalizedStatus === "待提交" ? [] : [makeStatusEvent(normalizedStatus, "提交窗口设置状态", updatedTime)]),
    ],
    remark,
    quickSubmitText,
    items: rows.map((row, index) => ({
      id: batchId * 1000 + index,
      batchId,
      formId: row.id,
      title: row.title,
      amount: row.amount,
      reconciledAmount: 0,
      status: formStatusForBatchStatus(normalizedStatus),
      exceptionReason: "",
      remark: row.remark,
    })),
  };
}

function formStatusForBatchStatus(status: BatchStatus): InvoiceStatus {
  if (status === "已到账") {
    return "已到账";
  }
  if (status === "异常处理" || status === "已取消") {
    return "报销失败";
  }
  if (status === "已提交" || status === "部分到账") {
    return "已提交";
  }
  return "批次创建";
}

function makeStatusEvent(status: BatchStatus, remark: string, timestamp: string): BatchStatusEvent {
  return { status, timestamp, remark };
}

function isFinishedStatus(status: BatchStatus) {
  return status === "已到账" || status === "已取消" || status === "异常处理";
}
