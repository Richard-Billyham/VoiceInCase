import { invoke } from "@tauri-apps/api/core";
import { sampleData } from "../app/sampleData";
import type {
  AppData,
  Attachment,
  DroppedFilePayload,
  ExpenseGroup,
  FormRecord,
  OcrInvoiceResult,
  ReimbursementBatch,
  ReimbursementItem,
  ReconciliationTransaction,
  Settings,
  UploadedAttachmentPayload,
} from "../types/domain";
import { normalizeBatchStatus, normalizeInvoiceStatus } from "../utils/workflowRules";

const STORE_KEY = "ivic-app-data-v2.1";

interface FormMatchCommit {
  order: FormRecord;
  invoice: FormRecord;
  matchedOrder: FormRecord;
}

export type SettingsPathKind = "databasePath" | "attachmentDir";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  message: string;
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function readLocalData(): AppData {
  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) {
    const seeded = normalizeLocalData(sampleData);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(seeded));
    return structuredClone(seeded);
  }
  const data = normalizeLocalData(JSON.parse(raw) as AppData);
  window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
  return data;
}

function writeLocalData(data: AppData) {
  const normalized = normalizeLocalData(data);
  window.localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
  return structuredClone(normalized);
}

export const ivicService = {
  async loadAppData(): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("load_app_data");
    }
    return readLocalData();
  },

  async saveForm(record: FormRecord): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_form_record", { record });
    }
    const data = readLocalData();
    const exists = data.forms.some((item) => item.id === record.id);
    data.forms = exists ? data.forms.map((item) => (item.id === record.id ? record : item)) : [record, ...data.forms];
    data.batches = syncBatchesForForm(data.batches, record);
    return writeLocalData(data);
  },

  async saveFormWithAttachments(record: FormRecord, attachments: UploadedAttachmentPayload[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_form_with_attachments", { record, attachments });
    }
    const data = readLocalData();
    const uploadedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const nextAttachments: Attachment[] = attachments.map((attachment, index) => ({
      id: Date.now() + index,
      ownerType: "invoice",
      ownerId: record.id,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      relativePath: `browser/imports/${record.id}/${attachment.fileName}`,
      remark: attachment.remark,
      uploadedAt,
    }));
    const existingCount = data.attachments.filter((item) => item.ownerType === "invoice" && item.ownerId === record.id).length;
    const nextRecord = {
      ...record,
      attachmentCount: existingCount + nextAttachments.length,
      hasInvoice: record.hasInvoice || nextAttachments.some((item) => item.fileType === "发票"),
    };
    const exists = data.forms.some((item) => item.id === nextRecord.id);
    data.forms = exists ? data.forms.map((item) => (item.id === nextRecord.id ? nextRecord : item)) : [nextRecord, ...data.forms];
    data.batches = syncBatchesForForm(data.batches, nextRecord);
    data.attachments = [...nextAttachments, ...data.attachments];
    return writeLocalData(data);
  },

  async saveMatchedForms(matches: FormMatchCommit[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_matched_forms", {
        records: matches.map((match) => match.matchedOrder),
        pairs: matches.map((match) => ({ orderId: match.order.id, invoiceId: match.invoice.id })),
      });
    }
    const data = readLocalData();
    const matchedOrderIds = new Set(matches.map((match) => match.order.id));
    const matchedInvoiceIds = new Set(matches.map((match) => match.invoice.id));
    data.attachments = data.attachments.map((attachment) => {
      const match = matches.find((candidate) => attachment.ownerType === "invoice" && attachment.ownerId === candidate.invoice.id);
      return match ? { ...attachment, ownerId: match.order.id } : attachment;
    });
    data.forms = data.forms
      .filter((form) => !matchedInvoiceIds.has(form.id) || matchedOrderIds.has(form.id))
      .map((form) => {
        const match = matches.find((candidate) => candidate.order.id === form.id);
        if (!match) {
          return form;
        }
        return {
          ...match.matchedOrder,
          attachmentCount: data.attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === match.order.id).length,
        };
      });
    for (const match of matches) {
      if (!data.forms.some((form) => form.id === match.order.id)) {
        data.forms.unshift({
          ...match.matchedOrder,
          attachmentCount: data.attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === match.order.id).length,
        });
      }
      data.batches = syncBatchesForForm(data.batches, match.matchedOrder);
    }
    return writeLocalData(data);
  },

  async readDroppedFiles(paths: string[]): Promise<DroppedFilePayload[]> {
    if (isTauriRuntime()) {
      return invoke<DroppedFilePayload[]>("read_dropped_files", { paths });
    }
    return [];
  },

  async readAttachmentFile(attachment: Attachment): Promise<UploadedAttachmentPayload | null> {
    if (isTauriRuntime()) {
      return invoke<UploadedAttachmentPayload>("read_attachment_file", {
        relativePath: attachment.relativePath,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        remark: attachment.remark,
      });
    }
    return null;
  },

  async recognizeInvoiceAttachment(fileName: string, bytes: number[]): Promise<OcrInvoiceResult> {
    if (isTauriRuntime()) {
      return invoke<OcrInvoiceResult>("recognize_invoice_attachment", { fileName, bytes });
    }
    return {
      ok: false,
      message: "浏览器预览模式不支持本机 OCR，请在 Tauri 桌面应用中使用。",
      rawText: "",
      invoiceType: "",
      invoiceNumber: "",
      issueDate: "",
      buyerName: "",
      buyerTaxNo: "",
      sellerName: "",
      sellerTaxNo: "",
      itemName: "",
      specModel: "",
      unit: "",
      quantity: "",
      subtotalAmount: "",
      taxAmount: "",
      totalWithTax: "",
      invoiceRemark: "",
    };
  },

  async deleteForms(ids: number[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("delete_form_records", { ids });
    }
    const data = readLocalData();
    const blocker = data.batches
      .flatMap((batch) => batch.items.map((item) => ({ batch, item })))
      .find(({ item }) => ids.includes(item.formId));
    if (blocker) {
      const form = data.forms.find((item) => item.id === blocker.item.formId);
      throw new Error(`订单 ${form?.title ?? blocker.item.title} 已在报销批次 ${blocker.batch.no} 中。请先删除对应报销批次，再删除订单。`);
    }
    data.forms = data.forms.filter((item) => !ids.includes(item.id));
    return writeLocalData(data);
  },

  async saveGroup(group: ExpenseGroup): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_group", { group });
    }
    const data = readLocalData();
    const exists = data.groups.some((item) => item.id === group.id);
    data.groups = exists ? data.groups.map((item) => (item.id === group.id ? group : item)) : [...data.groups, group];
    return writeLocalData(data);
  },

  async saveBatch(batch: ReimbursementBatch): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_batch", { batch });
    }
    const data = readLocalData();
    const exists = data.batches.some((item) => item.id === batch.id);
    if (!exists && batch.items.length === 0) {
      throw new Error("请在订单页面选择订单后提交创建批次。");
    }
    data.batches = exists ? data.batches.map((item) => (item.id === batch.id ? batch : item)) : [batch, ...data.batches];
    data.forms = data.forms.map((form) => {
      const item = batch.items.find((candidate) => candidate.formId === form.id);
      return item ? { ...form, status: statusForBatchItem(batch, item), updatedAt: batch.updatedTime } : form;
    });
    return writeLocalData(data);
  },

  async deleteBatch(id: number): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("delete_batch", { id });
    }
    const data = readLocalData();
    const batch = data.batches.find((item) => item.id === id);
    const formIds = new Set(batch?.items.map((item) => item.formId) ?? []);
    data.batches = data.batches.filter((item) => item.id !== id);
    data.forms = data.forms.map((form) => (formIds.has(form.id) ? { ...form, status: "待提交", updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }) } : form));
    return writeLocalData(data);
  },

  async saveTransaction(transaction: ReconciliationTransaction): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_transaction", { transaction });
    }
    const data = readLocalData();
    const attachmentCount = data.attachments.filter((item) => item.ownerType === "transaction" && item.ownerId === transaction.id).length;
    const nextTransaction = { ...transaction, attachmentCount };
    const exists = data.transactions.some((item) => item.id === transaction.id);
    data.transactions = exists
      ? data.transactions.map((item) => (item.id === transaction.id ? nextTransaction : item))
      : [nextTransaction, ...data.transactions];
    return writeLocalData(data);
  },

  async saveTransactionWithAttachments(transaction: ReconciliationTransaction, attachments: UploadedAttachmentPayload[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_transaction_with_attachments", { transaction, attachments });
    }
    const data = readLocalData();
    const uploadedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const nextAttachments: Attachment[] = attachments.map((attachment, index) => ({
      id: Date.now() + index,
      ownerType: "transaction",
      ownerId: transaction.id,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      relativePath: `browser/transactions/${transaction.id}/${attachment.fileName}`,
      remark: attachment.remark,
      uploadedAt,
    }));
    const existingCount = data.attachments.filter((item) => item.ownerType === "transaction" && item.ownerId === transaction.id).length;
    const nextTransaction = { ...transaction, attachmentCount: existingCount + nextAttachments.length };
    const exists = data.transactions.some((item) => item.id === nextTransaction.id);
    data.transactions = exists
      ? data.transactions.map((item) => (item.id === nextTransaction.id ? nextTransaction : item))
      : [nextTransaction, ...data.transactions];
    data.attachments = [...nextAttachments, ...data.attachments];
    return writeLocalData(data);
  },

  async saveSettings(settings: Settings): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_settings", { settings });
    }
    const data = readLocalData();
    data.settings = settings;
    return writeLocalData(data);
  },

  async selectSettingsPath(kind: SettingsPathKind, currentPath: string): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("pick_settings_path", { kind, currentPath });
    }
    const label = kind === "databasePath" ? "数据库文件路径" : "附件目录路径";
    const value = window.prompt(`请输入${label}`, currentPath);
    return value?.trim() ? value : null;
  },

  async checkForUpdates(): Promise<UpdateCheckResult> {
    if (isTauriRuntime()) {
      return invoke<UpdateCheckResult>("check_for_updates");
    }
    return {
      hasUpdate: false,
      currentVersion: "2.1.0",
      latestVersion: "2.1.0",
      message: "已是最新版本",
    };
  },

  async openExternalUrl(url: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke<void>("open_external_url", { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  async backupNow(): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("backup_now");
    }
    const data = readLocalData();
    data.settings.lastBackupAt = new Date().toLocaleString("zh-CN", { hour12: false });
    return writeLocalData(data);
  },
};

function statusForBatchItem(batch: ReimbursementBatch, item: ReimbursementItem) {
  const status = normalizeBatchStatus(batch.status);
  const itemStatus = normalizeInvoiceStatus(item.status);
  if (status === "已到账" || itemStatus === "已到账") {
    return "已到账" as const;
  }
  if (status === "已报销") {
    return "已到账" as const;
  }
  if (status === "异常处理" || status === "已取消" || itemStatus === "报销失败") {
    return "报销失败" as const;
  }
  if (status === "已提交" || status === "部分到账" || itemStatus === "已提交") {
    return "已提交" as const;
  }
  return "批次创建" as const;
}

function syncBatchesForForm(batches: ReimbursementBatch[], form: FormRecord) {
  return batches.map((batch) => {
    if (!batch.items.some((item) => item.formId === form.id)) {
      return batch;
    }
    const items = batch.items.map((item) => {
      if (item.formId !== form.id) {
        return item;
      }
      return {
        ...item,
        status: form.status === "待提交" ? "批次创建" : form.status,
        reconciledAmount: 0,
      };
    });
    return {
      ...batch,
      items,
      status: deriveBatchStatusFromItems(batch.status, items),
      updatedTime: form.updatedAt,
    };
  });
}

function deriveBatchStatusFromItems(currentStatus: ReimbursementBatch["status"], items: ReimbursementItem[]) {
  const status = normalizeBatchStatus(currentStatus);
  const normalizedItems = items.map((item) => ({ ...item, status: normalizeInvoiceStatus(item.status) }));
  if (status === "异常处理" || status === "已取消") {
    return status;
  }
  if (normalizedItems.length && normalizedItems.every((item) => item.status === "已到账")) {
    return "已到账" as const;
  }
  if (normalizedItems.some((item) => item.status === "已到账")) {
    return "部分到账" as const;
  }
  if (normalizedItems.some((item) => item.status === "报销失败")) {
    return "异常处理" as const;
  }
  if (status === "已报销") {
    return "已报销" as const;
  }
  if (normalizedItems.some((item) => item.status === "已提交")) {
    return "已提交" as const;
  }
  return "待提交" as const;
}

function normalizeLocalData(data: AppData): AppData {
  const attachments = data.attachments ?? [];
  return {
    ...data,
    attachments,
    groups: data.groups.map((group) => ({
      ...group,
      quickSubmitTemplate: group.quickSubmitTemplate || "",
      attachmentRuleConfig: group.attachmentRuleConfig || "",
    })),
    forms: data.forms.map((form) => ({
      ...form,
      invoiceKind: form.invoiceKind || "",
      status: normalizeInvoiceStatus(form.status),
      invoiceConfirmed: typeof form.invoiceConfirmed === "boolean" ? form.invoiceConfirmed : !form.hasInvoice,
      attachmentCount: attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === form.id).length || form.attachmentCount || 0,
    })),
    batches: data.batches.map((batch) => ({
      ...batch,
      status: normalizeBatchStatus(batch.status),
      items: batch.items.map((item) => ({
        ...item,
        status: normalizeInvoiceStatus(item.status),
      })),
    })),
    transactions: (data.transactions ?? []).map((transaction) => ({
      ...transaction,
      attachmentCount: attachments.filter((attachment) => attachment.ownerType === "transaction" && attachment.ownerId === transaction.id).length,
      matchedBatchIds: transaction.matchedBatchIds ?? [],
      matchedItemIds: transaction.matchedItemIds ?? [],
    })),
  };
}
