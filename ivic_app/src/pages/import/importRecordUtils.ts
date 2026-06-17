import type { BatchImportRow, ExpenseGroup, FormRecord, PersonMember, ReimbursementBatch } from "../../types/domain";
import {
  parseInvoiceNumber,
  parseTaxAmount,
  parseTitle,
  sanitizeQuantity,
  sanitizeSpecModel,
  sanitizeUnit,
  type ImportFormDraft,
  type InvoiceDetailDraft,
} from "./importUtils";
import { defaultInvoiceStatusForContent, normalizeInvoiceStatus } from "../../utils/workflowRules";

const DEFAULT_IMPORT_REMARK = "由导入窗口创建，可继续编辑修正。";

export function buildSingleRecord({
  attachmentCount,
  attachmentRemark,
  baseRecord,
  draft,
  existingAttachmentCount,
  hasExistingInvoice,
  invoiceConfirmed,
  invoiceDetail,
  invoiceDate,
  invoiceFileName,
  invoiceText,
  selectedGroup,
  selectedMember,
  statusBatches = [],
}: {
  attachmentCount: number;
  attachmentRemark: string;
  baseRecord?: FormRecord | null;
  draft: ImportFormDraft;
  existingAttachmentCount?: number;
  hasExistingInvoice?: boolean;
  invoiceConfirmed: boolean;
  invoiceDetail: InvoiceDetailDraft;
  invoiceDate: string;
  invoiceFileName: string;
  invoiceText: string;
  selectedGroup?: ExpenseGroup;
  selectedMember?: PersonMember;
  statusBatches?: ReimbursementBatch[];
}): FormRecord {
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  const amount = Number(draft.amount || invoiceDetail.totalWithTax || invoiceDetail.subtotalAmount) || 0;
  const hasInvoice = Boolean(invoiceFileName || hasExistingInvoice);
  const contentType = draft.contentType;
  const hasOrder = contentType === "订单" || contentType === "订单+发票";
  void statusBatches;
  const status = normalizeInvoiceStatus(draft.status) || defaultInvoiceStatusForContent(contentType);
  const title = draft.title.trim() || invoiceDetail.itemName || parseTitle(invoiceText, invoiceFileName) || "未命名发票";
  return {
    id: baseRecord?.id ?? Date.now(),
    title,
    invoiceNumber: invoiceDetail.invoiceNumber || parseInvoiceNumber(invoiceText) || (hasInvoice ? `IV${Date.now()}` : ""),
    invoiceKind: invoiceDetail.invoiceKind,
    amount,
    taxAmount: Number(invoiceDetail.taxAmount) || parseTaxAmount(invoiceText) || (hasInvoice && amount ? Number((amount * 0.06).toFixed(2)) : 0),
    purchaseDate: draft.purchaseDate,
    issueDate: invoiceDate,
    groupId: selectedGroup?.id ?? null,
    groupName: selectedGroup?.name ?? "",
    memberId: selectedMember?.id ?? selectedGroup?.ownerId ?? null,
    memberName: selectedMember?.name ?? selectedGroup?.ownerName ?? "",
    contentType,
    status,
    hasInvoice,
    isMatched: hasOrder && hasInvoice && contentType === "订单+发票",
    invoiceConfirmed: hasInvoice ? invoiceConfirmed : true,
    attachmentCount: (existingAttachmentCount ?? 0) + attachmentCount,
    sellerName: invoiceDetail.sellerName || "待确认销售方",
    sellerTaxNo: invoiceDetail.sellerTaxNo,
    buyerName: invoiceDetail.buyerName || "待确认购买方",
    buyerTaxNo: invoiceDetail.buyerTaxNo,
    invoiceItemName: invoiceDetail.itemName || title,
    invoiceRemark: invoiceDetail.remark,
    itemSpecModel: sanitizeSpecModel(invoiceDetail.specModel),
    itemUnit: sanitizeUnit(invoiceDetail.unit),
    itemQuantity: Number(sanitizeQuantity(invoiceDetail.quantity)) || null,
    remark: attachmentRemark || cleanExistingRemark(baseRecord?.remark),
    updatedAt: now,
  };
}

function cleanExistingRemark(remark = "") {
  return remark === DEFAULT_IMPORT_REMARK ? "" : remark;
}

export interface BatchRecordDraft extends BatchImportRow {
  buyerName?: string;
  buyerTaxNo?: string;
  itemQuantity?: number | null;
  itemSpecModel?: string;
  itemUnit?: string;
  invoiceItemName?: string;
  sellerName?: string;
  sellerTaxNo?: string;
  taxAmount?: number;
  invoiceConfirmed?: boolean;
  invoiceKind?: FormRecord["invoiceKind"];
}

export function buildBatchRecord(file: File, index: number, draft?: BatchRecordDraft, selectedGroup?: ExpenseGroup, selectedMember?: PersonMember): FormRecord {
  const row: BatchRecordDraft = draft ?? buildBatchRow(file, index);
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  return {
    id: Date.now() + index,
    title: row.title,
    invoiceNumber: row.invoiceNumber,
    invoiceKind: row.invoiceKind || "",
    amount: row.amount,
    taxAmount: row.taxAmount ?? (row.amount ? Number((row.amount * 0.06).toFixed(2)) : 0),
    purchaseDate: row.issueDate,
    issueDate: row.issueDate,
    groupId: selectedGroup?.id ?? null,
    groupName: selectedGroup?.name ?? "",
    memberId: selectedMember?.id ?? selectedGroup?.ownerId ?? null,
    memberName: selectedMember?.name ?? selectedGroup?.ownerName ?? "",
    contentType: "发票",
    status: row.problem ? "报销失败" : "待匹配",
    hasInvoice: true,
    isMatched: false,
    invoiceConfirmed: Boolean(row.invoiceConfirmed),
    attachmentCount: 1,
    sellerName: row.sellerName || "待确认销售方",
    sellerTaxNo: row.sellerTaxNo,
    buyerName: row.buyerName || "待确认购买方",
    buyerTaxNo: row.buyerTaxNo,
    invoiceItemName: row.invoiceItemName || row.title,
    itemSpecModel: row.itemSpecModel,
    itemUnit: row.itemUnit,
    itemQuantity: row.itemQuantity ?? null,
    remark: "",
    updatedAt: now,
  };
}

export function buildBatchRow(file: File, index: number): BatchImportRow {
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "新导入发票";
  return {
    id: Date.now() + index,
    fileName: file.name,
    title,
    invoiceNumber: `IV${Date.now()}${index}`,
    amount: 0,
    issueDate: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10),
    problem: file.size === 0 ? "空文件" : "等待 OCR 识别",
  };
}
