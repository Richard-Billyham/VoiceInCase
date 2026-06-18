import { invoke } from "@tauri-apps/api/core";
import { sampleData } from "../app/sampleData";
import type {
  AppData,
  Attachment,
  DroppedFilePayload,
  ExpenseGroup,
  FormRecord,
  InvoiceStatus,
  OcrIncomeResult,
  OcrInvoiceResult,
  PersonMember,
  ReimbursementBatch,
  ReimbursementItem,
  ReconciliationTransaction,
  Settings,
  UploadedAttachmentPayload,
} from "../types/domain";
import { deriveBatchStatusFromItems, normalizeBatchStatus, normalizeInvoiceStatus } from "../utils/workflowRules";

const STORE_KEY = "ivic-app-data-v2.1";

interface FormMatchCommit {
  order: FormRecord;
  invoice: FormRecord;
  matchedOrder: FormRecord;
}

export interface FormWithAttachmentsPayload {
  record: FormRecord;
  attachments: UploadedAttachmentPayload[];
}

export interface OcrInvoiceRequest {
  fileName: string;
  bytes: number[];
  sourcePath?: string;
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
    const nextRecord = resolveFormMember(record, data);
    const exists = data.forms.some((item) => item.id === nextRecord.id);
    data.forms = exists ? data.forms.map((item) => (item.id === nextRecord.id ? nextRecord : item)) : [nextRecord, ...data.forms];
    data.batches = syncBatchesForForm(data.batches, nextRecord);
    return writeLocalData(data);
  },

  async saveFormWithAttachments(record: FormRecord, attachments: UploadedAttachmentPayload[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_form_with_attachments", { record, attachments });
    }
    const data = readLocalData();
    const resolvedRecord = resolveFormMember(record, data);
    const uploadedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const nextAttachments: Attachment[] = attachments.map((attachment, index) => ({
      id: Date.now() + index,
      ownerType: "invoice",
      ownerId: resolvedRecord.id,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      relativePath: `browser/imports/${resolvedRecord.id}/${attachment.fileName}`,
      remark: attachment.remark,
      uploadedAt,
    }));
    const existingCount = data.attachments.filter((item) => item.ownerType === "invoice" && item.ownerId === resolvedRecord.id).length;
    const nextRecord = {
      ...resolvedRecord,
      attachmentCount: existingCount + nextAttachments.length,
      hasInvoice: resolvedRecord.hasInvoice || nextAttachments.some((item) => item.fileType === "发票"),
    };
    const exists = data.forms.some((item) => item.id === nextRecord.id);
    data.forms = exists ? data.forms.map((item) => (item.id === nextRecord.id ? nextRecord : item)) : [nextRecord, ...data.forms];
    data.batches = syncBatchesForForm(data.batches, nextRecord);
    data.attachments = [...nextAttachments, ...data.attachments];
    return writeLocalData(data);
  },

  async saveFormsWithAttachments(items: FormWithAttachmentsPayload[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_forms_with_attachments", { items });
    }
    const data = readLocalData();
    const uploadedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    let attachmentSeed = Date.now();
    for (const item of items) {
      const resolvedRecord = resolveFormMember(item.record, data);
      const nextAttachments: Attachment[] = item.attachments.map((attachment) => ({
        id: attachmentSeed++,
        ownerType: "invoice",
        ownerId: resolvedRecord.id,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        relativePath: `browser/imports/${resolvedRecord.id}/${attachment.fileName}`,
        remark: attachment.remark,
        uploadedAt,
      }));
      const existingCount = data.attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === resolvedRecord.id).length;
      const nextRecord = {
        ...resolvedRecord,
        attachmentCount: existingCount + nextAttachments.length,
        hasInvoice: resolvedRecord.hasInvoice || nextAttachments.some((attachment) => attachment.fileType === "鍙戠エ"),
      };
      const exists = data.forms.some((form) => form.id === nextRecord.id);
      data.forms = exists ? data.forms.map((form) => (form.id === nextRecord.id ? nextRecord : form)) : [nextRecord, ...data.forms];
      data.batches = syncBatchesForForm(data.batches, nextRecord);
      data.attachments = [...nextAttachments, ...data.attachments];
    }
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
        const matchedOrder = resolveFormMember(match.matchedOrder, data);
        return {
          ...matchedOrder,
          attachmentCount: data.attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === match.order.id).length,
        };
      });
    for (const match of matches) {
      const matchedOrder = resolveFormMember(match.matchedOrder, data);
      if (!data.forms.some((form) => form.id === match.order.id)) {
        data.forms.unshift({
          ...matchedOrder,
          attachmentCount: data.attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === match.order.id).length,
        });
      }
      data.batches = syncBatchesForForm(data.batches, matchedOrder);
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

  async recognizeInvoiceAttachments(items: OcrInvoiceRequest[]): Promise<OcrInvoiceResult[]> {
    if (isTauriRuntime()) {
      return invoke<OcrInvoiceResult[]>("recognize_invoice_attachments", { items });
    }
    return Promise.all(items.map((item) => this.recognizeInvoiceAttachment(item.fileName, item.bytes)));
  },

  async recognizeIncomeAttachment(fileName: string, bytes: number[]): Promise<OcrIncomeResult> {
    if (isTauriRuntime()) {
      return invoke<OcrIncomeResult>("recognize_income_attachment", { fileName, bytes });
    }
    return {
      ok: false,
      message: "浏览器预览模式不支持本机 OCR，请在 Tauri 桌面应用中使用。",
      rawText: "",
      amount: "",
      transactionAccount: "",
      transactionTime: "",
      transactionLocation: "",
      counterpartyAccount: "",
      accountingDate: "",
    };
  },

  async deleteForms(ids: number[]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("delete_form_records", { ids });
    }
    const data = readLocalData();
    const blocker = data.batches
      .flatMap((batch) => batch.items.map((item) => ({ batch, item })))
      .find(({ item }) => !item.isReleased && ids.includes(item.formId));
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
    const owner = group.ownerId ? data.members.find((member) => member.id === group.ownerId) : null;
    const nextGroup = { ...group, ownerName: owner?.name ?? group.ownerName };
    const exists = data.groups.some((item) => item.id === group.id);
    data.groups = exists ? data.groups.map((item) => (item.id === group.id ? nextGroup : item)) : [...data.groups, nextGroup];
    return writeLocalData(data);
  },

  async deleteGroup(id: number): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("delete_group", { id });
    }
    const data = readLocalData();
    const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
    data.groups = data.groups.filter((group) => group.id !== id);
    data.forms = data.forms.map((form) => (
      form.groupId === id
        ? { ...form, groupId: null, groupName: "", memberId: null, memberName: "", updatedAt: timestamp }
        : form
    ));
    data.batches = data.batches.map((batch) => (
      batch.groupId === id
        ? {
            ...batch,
            groupId: null,
            groupName: "未分组",
            updatedTime: timestamp,
            items: batch.items.map((item) => ({ ...item })),
          }
        : batch
    ));
    return writeLocalData(data);
  },

  async saveMember(member: PersonMember): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_member", { member });
    }
    const name = member.name.trim();
    if (!name) {
      throw new Error("人员名字不能为空。");
    }
    const data = readLocalData();
    const nextMember = { ...member, name, updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }) };
    const exists = data.members.some((item) => item.id === member.id);
    data.members = exists ? data.members.map((item) => (item.id === member.id ? nextMember : item)) : [...data.members, nextMember];
    data.groups = data.groups.map((group) => (group.ownerId === member.id ? { ...group, ownerName: name } : group));
    data.forms = data.forms.map((form) => (form.memberId === member.id ? { ...form, memberName: name } : form));
    return writeLocalData(data);
  },

  async deleteMember(id: number): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("delete_member", { id });
    }
    const data = readLocalData();
    const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
    data.members = data.members.filter((member) => member.id !== id);
    data.groups = data.groups.map((group) => (
      group.ownerId === id ? { ...group, ownerId: null, ownerName: "", updatedAt: timestamp } : group
    ));
    data.forms = data.forms.map((form) => {
      if (form.memberId !== id) {
        return form;
      }
      const group = form.groupId ? data.groups.find((item) => item.id === form.groupId) : null;
      return {
        ...form,
        memberId: group?.ownerId ?? null,
        memberName: group?.ownerName ?? "",
        updatedAt: timestamp,
      };
    });
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
      const item = batch.items.find((candidate) => !candidate.isReleased && candidate.formId === form.id);
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
    const formIds = new Set(batch?.items.filter((item) => !item.isReleased).map((item) => item.formId) ?? []);
    data.batches = data.batches.filter((item) => item.id !== id);
    data.forms = data.forms.map((form) => (formIds.has(form.id) ? { ...form, status: "待提交", updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }) } : form));
    return writeLocalData(data);
  },

  async releaseBatchItemForRetry(batchId: number, itemId: number, targetStatus?: ReimbursementItem["status"]): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("release_batch_item_for_retry", { batchId, itemId, targetStatus: targetStatus ?? null });
    }
    const data = readLocalData();
    const batch = data.batches.find((item) => item.id === batchId);
    const item = batch?.items.find((candidate) => candidate.id === itemId);
    if (!batch || !item) {
      throw new Error("该子订单不在当前批次中，无法退回修改。");
    }
    const wantsFailure = targetStatus ? normalizeInvoiceStatus(targetStatus) === "报销失败" : false;
    if (normalizeInvoiceStatus(item.status) !== "报销失败" && !wantsFailure) {
      throw new Error("只有报销失败的子订单可以退回修改。");
    }
    const hasReconciliationMatch = data.transactions.some((transaction) => transaction.matchedItemIds.includes(itemId));
    if (item.reconciledAmount > 0.01 && hasReconciliationMatch) {
      throw new Error("该子订单已有到账记录，请先处理对账记录后再退回修改。");
    }
    const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
    const failedStatus: InvoiceStatus = "报销失败";
    const nextItems: ReimbursementItem[] = batch.items.map((candidate) => {
      if (candidate.id !== itemId) {
        return candidate;
      }
      return {
        ...candidate,
        status: failedStatus,
        reconciledAmount: 0,
        isReleased: true,
        releasedAt: timestamp,
        releaseReason: "报销失败退回修改",
        remark: [candidate.remark.trim(), "已退回修改"].filter(Boolean).join("；"),
      };
    });
    const activeItems = nextItems.filter((candidate) => !candidate.isReleased);
    const nextStatus = activeItems.length ? deriveBatchStatusFromItems(batch.status, nextItems) : "已取消" as const;
    data.batches = data.batches.map((candidate) => {
      if (candidate.id !== batchId) {
        return candidate;
      }
      return {
        ...candidate,
        items: nextItems,
        totalAmount: activeItems.reduce((sum, nextItem) => sum + nextItem.amount, 0),
        status: nextStatus,
        updatedTime: timestamp,
        completedTime: activeItems.length ? candidate.completedTime : timestamp,
        statusTimeline: [
          ...candidate.statusTimeline,
          {
            status: candidate.status,
            timestamp,
            remark: `子订单“${item.title}”因报销失败退回修改，释放金额 ${item.amount.toFixed(2)}，表单回到待提交。`,
          },
          ...(activeItems.length ? [] : [{ status: "已取消" as const, timestamp, remark: "所有子订单已释放，批次自动取消。" }]),
        ],
      };
    });
    data.forms = data.forms.map((form) => (form.id === item.formId ? { ...form, status: "待提交", updatedAt: timestamp } : form));
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

  async saveReconciliationResult(batches: ReimbursementBatch[], transaction: ReconciliationTransaction): Promise<AppData> {
    if (isTauriRuntime()) {
      return invoke<AppData>("save_reconciliation_result", { batches, transaction });
    }
    let data = readLocalData();
    for (const batch of batches) {
      const exists = data.batches.some((item) => item.id === batch.id);
      data.batches = exists ? data.batches.map((item) => (item.id === batch.id ? batch : item)) : [batch, ...data.batches];
      data.forms = data.forms.map((form) => {
        const item = batch.items.find((candidate) => !candidate.isReleased && candidate.formId === form.id);
        return item ? { ...form, status: statusForBatchItem(batch, item), updatedAt: batch.updatedTime } : form;
      });
    }
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
    if (!batch.items.some((item) => !item.isReleased && item.formId === form.id)) {
      return batch;
    }
    const items = batch.items.map((item) => {
      if (item.isReleased || item.formId !== form.id) {
        return item;
      }
      return {
        ...item,
        status: form.status === "待提交" ? "批次创建" : form.status,
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

function resolveFormMember(record: FormRecord, data: AppData): FormRecord {
  const explicitMember = record.memberId ? data.members.find((member) => member.id === record.memberId) : null;
  if (explicitMember) {
    return { ...record, memberId: explicitMember.id, memberName: explicitMember.name };
  }
  if (record.memberName?.trim()) {
    return { ...record, memberId: record.memberId ?? null, memberName: record.memberName.trim() };
  }
  const group = record.groupId ? data.groups.find((item) => item.id === record.groupId) : null;
  return {
    ...record,
    memberId: group?.ownerId ?? null,
    memberName: group?.ownerName ?? "",
  };
}

function normalizeLocalData(data: AppData): AppData {
  const attachments = data.attachments ?? [];
  const members = (data.members ?? []).map((member) => ({
    ...member,
    phone: member.phone ?? "",
    email: member.email ?? "",
    remark: member.remark ?? "",
    isActive: typeof member.isActive === "boolean" ? member.isActive : true,
    updatedAt: member.updatedAt || "",
  }));
  const memberById = new Map(members.map((member) => [member.id, member]));
  return {
    ...data,
    attachments,
    members,
    groups: data.groups.map((group) => ({
      ...group,
      ownerId: group.ownerId ?? null,
      ownerName: group.ownerId && memberById.has(group.ownerId) ? memberById.get(group.ownerId)!.name : group.ownerName || "",
      quickSubmitTemplate: group.quickSubmitTemplate || "",
      attachmentRuleConfig: group.attachmentRuleConfig || "",
    })),
    forms: data.forms.map((form) => ({
      ...form,
      invoiceKind: form.invoiceKind || "",
      status: normalizeInvoiceStatus(form.status),
      memberId: form.memberId ?? null,
      memberName: form.memberId && memberById.has(form.memberId) ? memberById.get(form.memberId)!.name : form.memberName || "",
      invoiceConfirmed: typeof form.invoiceConfirmed === "boolean" ? form.invoiceConfirmed : !form.hasInvoice,
      attachmentCount: attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === form.id).length || form.attachmentCount || 0,
    })),
    batches: data.batches.map((batch) => ({
      ...batch,
      status: normalizeBatchStatus(batch.status),
      items: batch.items.map((item) => ({
        ...item,
        status: normalizeInvoiceStatus(item.status),
        isReleased: Boolean(item.isReleased),
        releasedAt: item.releasedAt ?? "",
        releaseReason: item.releaseReason ?? "",
      })),
    })),
    transactions: (data.transactions ?? []).map((transaction) => ({
      ...transaction,
      transactionAccount: transaction.transactionAccount ?? "",
      transactionLocation: transaction.transactionLocation ?? "",
      counterpartyAccount: transaction.counterpartyAccount ?? "",
      accountingDate: transaction.accountingDate ?? "",
      attachmentCount: attachments.filter((attachment) => attachment.ownerType === "transaction" && attachment.ownerId === transaction.id).length,
      matchedBatchIds: transaction.matchedBatchIds ?? [],
      matchedItemIds: transaction.matchedItemIds ?? [],
    })),
  };
}
