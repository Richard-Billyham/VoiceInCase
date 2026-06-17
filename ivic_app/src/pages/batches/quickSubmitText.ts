import type { ExpenseGroup, FormRecord, ReimbursementBatch } from "../../types/domain";
import { formatMoney } from "../../utils/format";
import { batchStatusDisplay } from "./batchUtils";

const DEFAULT_TEMPLATE = "批次：{批次号}\n分组：{分组}\n总金额：{总金额}\n明细：\n{明细}\n备注：{备注}";
const CONFIG_KIND = "ivic.quickSubmitConfig";

export type QuickSubmitBatchFieldKey =
  | "batchNo"
  | "group"
  | "totalAmount"
  | "itemCount"
  | "status"
  | "applyTime"
  | "updatedTime"
  | "completedTime"
  | "remark"
  | "detail";

export type QuickSubmitItemFieldKey =
  | "itemTitle"
  | "itemAmount"
  | "itemStatus"
  | "itemRemark"
  | "reconciledAmount"
  | "pendingAmount"
  | "formId"
  | "invoiceIssueDate"
  | "invoiceNumber"
  | "invoiceKind"
  | "buyerName"
  | "buyerTaxNo"
  | "sellerName"
  | "sellerTaxNo"
  | "invoiceTotalAmount"
  | "invoiceAmountWithoutTax"
  | "taxAmount"
  | "invoiceRemark"
  | "itemSpecModel"
  | "itemUnit"
  | "itemQuantity"
  | "attachmentCount";

export interface QuickSubmitConfigItem {
  id: string;
  type: "field" | "itemField" | "custom";
  key?: QuickSubmitBatchFieldKey | QuickSubmitItemFieldKey;
  label: string;
  text?: string;
  enabled: boolean;
}

export interface QuickSubmitConfig {
  kind: typeof CONFIG_KIND;
  version: 1;
  items: QuickSubmitConfigItem[];
}

export interface QuickCopyEntry {
  id: string;
  label: string;
  value: string;
}

export interface QuickCopySection {
  id: string;
  title: string;
  entries: QuickCopyEntry[];
}

export const quickSubmitBatchFieldOptions: Array<{ key: QuickSubmitBatchFieldKey; name: string; defaultLabel: string; defaultEnabled: boolean }> = [
  { key: "batchNo", name: "批次号", defaultLabel: "批次", defaultEnabled: true },
  { key: "group", name: "分组", defaultLabel: "分组", defaultEnabled: true },
  { key: "totalAmount", name: "总金额", defaultLabel: "总金额", defaultEnabled: true },
  { key: "itemCount", name: "条目数", defaultLabel: "条目数", defaultEnabled: false },
  { key: "status", name: "批次状态", defaultLabel: "批次状态", defaultEnabled: false },
  { key: "applyTime", name: "提交时间", defaultLabel: "提交时间", defaultEnabled: false },
  { key: "updatedTime", name: "修改时间", defaultLabel: "修改时间", defaultEnabled: false },
  { key: "completedTime", name: "完成时间", defaultLabel: "完成时间", defaultEnabled: false },
  { key: "remark", name: "备注", defaultLabel: "备注", defaultEnabled: true },
  { key: "detail", name: "整段明细", defaultLabel: "明细", defaultEnabled: false },
];

export const quickSubmitItemFieldOptions: Array<{ key: QuickSubmitItemFieldKey; name: string; defaultLabel: string; defaultEnabled: boolean }> = [
  { key: "itemTitle", name: "首个项目名称", defaultLabel: "项目名称", defaultEnabled: true },
  { key: "itemAmount", name: "子订单金额", defaultLabel: "金额", defaultEnabled: true },
  { key: "itemStatus", name: "子订单状态", defaultLabel: "状态", defaultEnabled: false },
  { key: "itemRemark", name: "子订单备注", defaultLabel: "备注", defaultEnabled: false },
  { key: "reconciledAmount", name: "已到账金额", defaultLabel: "已到账", defaultEnabled: false },
  { key: "pendingAmount", name: "待到账金额", defaultLabel: "待到账", defaultEnabled: false },
  { key: "formId", name: "订单 ID", defaultLabel: "订单ID", defaultEnabled: false },
  { key: "invoiceIssueDate", name: "发票日期", defaultLabel: "发票日期", defaultEnabled: false },
  { key: "invoiceNumber", name: "票号", defaultLabel: "票号", defaultEnabled: false },
  { key: "invoiceKind", name: "发票类型", defaultLabel: "发票类型", defaultEnabled: false },
  { key: "buyerName", name: "购买方名称", defaultLabel: "购买方", defaultEnabled: false },
  { key: "buyerTaxNo", name: "购买方税号", defaultLabel: "购买方税号", defaultEnabled: false },
  { key: "sellerName", name: "销售方名称", defaultLabel: "销售方", defaultEnabled: false },
  { key: "sellerTaxNo", name: "销售方税号", defaultLabel: "销售方税号", defaultEnabled: false },
  { key: "invoiceTotalAmount", name: "价税合计", defaultLabel: "价税合计", defaultEnabled: false },
  { key: "invoiceAmountWithoutTax", name: "合计", defaultLabel: "合计", defaultEnabled: false },
  { key: "taxAmount", name: "税额", defaultLabel: "税额", defaultEnabled: false },
  { key: "invoiceRemark", name: "发票备注", defaultLabel: "发票备注", defaultEnabled: false },
  { key: "itemSpecModel", name: "规格型号", defaultLabel: "规格型号", defaultEnabled: false },
  { key: "itemUnit", name: "单位", defaultLabel: "单位", defaultEnabled: false },
  { key: "itemQuantity", name: "数量", defaultLabel: "数量", defaultEnabled: false },
  { key: "attachmentCount", name: "附件数量", defaultLabel: "附件数量", defaultEnabled: false },
];

export const quickSubmitFieldOptions = quickSubmitBatchFieldOptions;

export function buildQuickSubmitText(batch: ReimbursementBatch, group?: ExpenseGroup, hidden = false, forms: FormRecord[] = []) {
  return flattenQuickCopySections(buildQuickSubmitCopySections(batch, group, hidden, forms));
}

export function buildQuickSubmitCopySections(batch: ReimbursementBatch, group?: ExpenseGroup, hidden = false, forms: FormRecord[] = []): QuickCopySection[] {
  const template = group?.quickSubmitTemplate?.trim() || "";
  const config = parseStructuredQuickSubmitConfig(template);
  if (config) {
    return renderQuickSubmitConfig(config, batch, group, hidden, forms);
  }
  if (template && template !== DEFAULT_TEMPLATE) {
    return [{
      id: "custom",
      title: "自定义文本",
      entries: [{ id: "legacy-template", label: "文本", value: renderLegacyTemplate(template, batch, group, hidden) }],
    }];
  }
  return renderQuickSubmitConfig(createDefaultQuickSubmitConfig(), batch, group, hidden, forms);
}

export function createDefaultQuickSubmitConfig(): QuickSubmitConfig {
  return {
    kind: CONFIG_KIND,
    version: 1,
    items: [
      ...quickSubmitBatchFieldOptions.map((option) => ({
        id: option.key,
        type: "field" as const,
        key: option.key,
        label: option.defaultLabel,
        enabled: option.defaultEnabled,
      })),
      ...quickSubmitItemFieldOptions.map((option) => ({
        id: option.key,
        type: "itemField" as const,
        key: option.key,
        label: option.defaultLabel,
        enabled: option.defaultEnabled,
      })),
    ],
  };
}

function createDisabledFieldItems(): QuickSubmitConfigItem[] {
  return [
    ...quickSubmitBatchFieldOptions.map((option): QuickSubmitConfigItem => ({
      id: option.key,
      type: "field",
      key: option.key,
      label: option.defaultLabel,
      enabled: false,
    })),
    ...quickSubmitItemFieldOptions.map((option): QuickSubmitConfigItem => ({
      id: option.key,
      type: "itemField",
      key: option.key,
      label: option.defaultLabel,
      enabled: false,
    })),
  ];
}

export function createCustomQuickSubmitItem(): QuickSubmitConfigItem {
  return {
    id: `custom-${Date.now()}`,
    type: "custom",
    label: "自定义文本",
    text: "",
    enabled: true,
  };
}

export function parseQuickSubmitConfig(template: string): QuickSubmitConfig {
  const structured = parseStructuredQuickSubmitConfig(template);
  if (structured) {
    return structured;
  }
  if (!template.trim() || template.trim() === DEFAULT_TEMPLATE) {
    return createDefaultQuickSubmitConfig();
  }
  return {
    kind: CONFIG_KIND,
    version: 1,
    items: [
      {
        id: "legacy-template",
        type: "custom",
        label: "自定义文本",
        text: template,
        enabled: true,
      },
      ...createDisabledFieldItems(),
    ],
  };
}

export function serializeQuickSubmitConfig(config: QuickSubmitConfig) {
  return JSON.stringify(normalizeQuickSubmitConfig(config));
}

function parseStructuredQuickSubmitConfig(template: string): QuickSubmitConfig | null {
  if (!template.trim().startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(template) as Partial<QuickSubmitConfig>;
    if (parsed.kind !== CONFIG_KIND || parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return null;
    }
    return normalizeQuickSubmitConfig(parsed as QuickSubmitConfig);
  } catch {
    return null;
  }
}

function normalizeQuickSubmitConfig(config: QuickSubmitConfig): QuickSubmitConfig {
  const batchFallbackByKey = new Map(quickSubmitBatchFieldOptions.map((option) => [option.key, option]));
  const itemFallbackByKey = new Map(quickSubmitItemFieldOptions.map((option) => [option.key, option]));
  let legacyDetailEnabled = false;
  const items = config.items.flatMap((item, index): QuickSubmitConfigItem[] => {
    if (item.type === "custom") {
      return [{
        id: item.id || `custom-${index}`,
        type: "custom",
        label: item.label || "自定义文本",
        text: item.text || "",
        enabled: item.enabled !== false,
      }];
    }
    if (item.type === "itemField") {
      const key = item.key && itemFallbackByKey.has(item.key as QuickSubmitItemFieldKey) ? item.key as QuickSubmitItemFieldKey : "itemTitle";
      const fallback = itemFallbackByKey.get(key)!;
      return [{
        id: item.id || key,
        type: "itemField",
        key,
        label: fallback.defaultLabel,
        enabled: item.enabled !== false,
      }];
    }
    if (item.key === "detail") {
      legacyDetailEnabled = item.enabled !== false;
      return [];
    }
    const key = item.key && batchFallbackByKey.has(item.key as QuickSubmitBatchFieldKey) ? item.key as QuickSubmitBatchFieldKey : "batchNo";
    const fallback = batchFallbackByKey.get(key)!;
    return [{
      id: item.id || key,
      type: "field",
      key,
      label: fallback.defaultLabel,
      enabled: item.enabled !== false,
    }];
  });
  const knownBatchKeys = new Set(items.filter((item) => item.type === "field").map((item) => item.key));
  const knownItemKeys = new Set(items.filter((item) => item.type === "itemField").map((item) => item.key));
  const missingBatchFields = quickSubmitBatchFieldOptions
    .filter((option) => !knownBatchKeys.has(option.key))
    .map((option): QuickSubmitConfigItem => ({
      id: option.key,
      type: "field",
      key: option.key,
      label: option.defaultLabel,
      enabled: false,
    }));
  const missingItemFields = quickSubmitItemFieldOptions
    .filter((option) => !knownItemKeys.has(option.key))
    .map((option): QuickSubmitConfigItem => ({
      id: option.key,
      type: "itemField",
      key: option.key,
      label: option.defaultLabel,
      enabled: legacyDetailEnabled && (option.key === "itemTitle" || option.key === "itemAmount"),
    }));
  return {
    kind: CONFIG_KIND,
    version: 1,
    items: [...items, ...missingBatchFields, ...missingItemFields],
  };
}

function renderQuickSubmitConfig(config: QuickSubmitConfig, batch: ReimbursementBatch, group?: ExpenseGroup, hidden = false, forms: FormRecord[] = []): QuickCopySection[] {
  const batchValues = buildBatchValueMap(batch, group, hidden);
  const batchEntries: QuickCopyEntry[] = [];
  const formById = new Map(forms.map((form) => [form.id, form]));
  const activeItems = batch.items.filter((item) => !item.isReleased);
  const itemFields = config.items.filter((item) => item.enabled && item.type === "itemField");
  config.items.forEach((item) => {
    if (!item.enabled) {
      return;
    }
    if (item.type === "custom") {
      batchEntries.push({
        id: item.id,
        label: item.label || "自定义文本",
        value: replaceTokens(item.text || "", batchValues),
      });
      return;
    }
    if (item.type === "field") {
      const value = batchValues.get(item.key ?? "batchNo") ?? "";
      batchEntries.push({
        id: item.id,
        label: quickSubmitBatchFieldOptions.find((option) => option.key === item.key)?.defaultLabel || "字段",
        value,
      });
    }
  });
  const sections: QuickCopySection[] = [];
  if (batchEntries.length) {
    sections.push({ id: "batch", title: "提交批次", entries: batchEntries.filter((entry) => entry.value.trim()) });
  }
  if (itemFields.length) {
    activeItems.forEach((item, index) => {
      const itemValues = buildItemValueMap(item, formById.get(item.formId), hidden);
      const entries = itemFields.map((field) => ({
        id: `${item.id}-${field.id}`,
        label: quickSubmitItemFieldOptions.find((option) => option.key === field.key)?.defaultLabel || "字段",
        value: itemValues.get(field.key ?? "itemTitle") ?? "",
      })).filter((entry) => entry.value.trim());
      if (entries.length) {
        sections.push({ id: `item-${item.id}`, title: `${index + 1}. 子订单`, entries });
      }
    });
  }
  return sections;
}

function renderLegacyTemplate(template: string, batch: ReimbursementBatch, group?: ExpenseGroup, hidden = false) {
  return replaceTokens(template, buildBatchValueMap(batch, group, hidden));
}

function buildBatchValueMap(batch: ReimbursementBatch, group?: ExpenseGroup, hidden = false) {
  const activeItems = batch.items.filter((item) => !item.isReleased);
  const detailLines = activeItems
    .map((item, index) => `${index + 1}. ${item.title} ${formatMoney(item.amount, hidden)}`)
    .join("\n");
  return new Map<QuickSubmitBatchFieldKey | string, string>([
    ["batchNo", batch.no],
    ["group", batch.groupName || group?.name || "未分组"],
    ["totalAmount", formatMoney(batch.totalAmount, hidden)],
    ["itemCount", String(activeItems.length)],
    ["status", batchStatusDisplay(batch)],
    ["applyTime", batch.applyTime],
    ["updatedTime", batch.updatedTime],
    ["completedTime", batch.completedTime || ""],
    ["detail", detailLines || "无明细"],
    ["remark", batch.remark || ""],
    ["批次号", batch.no],
    ["分组", batch.groupName || group?.name || "未分组"],
    ["总金额", formatMoney(batch.totalAmount, hidden)],
    ["条目数", String(activeItems.length)],
    ["批次状态", batchStatusDisplay(batch)],
    ["提交时间", batch.applyTime],
    ["修改时间", batch.updatedTime],
    ["完成时间", batch.completedTime || ""],
    ["明细", detailLines || "无明细"],
    ["备注", batch.remark || ""],
  ]);
}

function buildItemValueMap(item: ReimbursementBatch["items"][number], form: FormRecord | undefined, hidden = false) {
  const invoiceTotalAmount = form?.amount ?? item.amount;
  const taxAmount = form?.taxAmount ?? 0;
  const amountWithoutTax = Math.max(0, invoiceTotalAmount - taxAmount);
  const quantity = form?.itemQuantity === null || typeof form?.itemQuantity === "undefined" ? "" : String(form.itemQuantity);
  const invoiceItemName = form?.invoiceItemName || form?.title || item.title;
  return new Map<QuickSubmitItemFieldKey | string, string>([
    ["itemTitle", invoiceItemName],
    ["itemAmount", formatMoney(item.amount, hidden)],
    ["itemStatus", item.status],
    ["itemRemark", item.remark || ""],
    ["reconciledAmount", formatMoney(item.reconciledAmount, hidden)],
    ["pendingAmount", formatMoney(Math.max(0, item.amount - item.reconciledAmount), hidden)],
    ["formId", String(item.formId)],
    ["invoiceIssueDate", form?.issueDate || ""],
    ["invoiceNumber", form?.invoiceNumber || ""],
    ["invoiceKind", form?.invoiceKind || ""],
    ["buyerName", form?.buyerName || ""],
    ["buyerTaxNo", form?.buyerTaxNo || ""],
    ["sellerName", form?.sellerName || ""],
    ["sellerTaxNo", form?.sellerTaxNo || ""],
    ["invoiceTotalAmount", formatMoney(invoiceTotalAmount, hidden)],
    ["invoiceAmountWithoutTax", formatMoney(amountWithoutTax, hidden)],
    ["taxAmount", formatMoney(taxAmount, hidden)],
    ["invoiceRemark", form?.invoiceRemark || ""],
    ["itemSpecModel", form?.itemSpecModel || ""],
    ["itemUnit", form?.itemUnit || ""],
    ["itemQuantity", quantity],
    ["attachmentCount", typeof form?.attachmentCount === "number" ? String(form.attachmentCount) : ""],
    ["子订单名称", form?.title || item.title],
    ["子订单金额", formatMoney(item.amount, hidden)],
    ["子订单状态", item.status],
    ["子订单备注", item.remark || ""],
    ["已到账金额", formatMoney(item.reconciledAmount, hidden)],
    ["待到账金额", formatMoney(Math.max(0, item.amount - item.reconciledAmount), hidden)],
    ["订单ID", String(item.formId)],
    ["发票日期", form?.issueDate || ""],
    ["票号", form?.invoiceNumber || ""],
    ["发票类型", form?.invoiceKind || ""],
    ["购买方名称", form?.buyerName || ""],
    ["购买方税号", form?.buyerTaxNo || ""],
    ["销售方名称", form?.sellerName || ""],
    ["销售方税号", form?.sellerTaxNo || ""],
    ["价税合计", formatMoney(invoiceTotalAmount, hidden)],
    ["合计", formatMoney(amountWithoutTax, hidden)],
    ["税额", formatMoney(taxAmount, hidden)],
    ["发票备注", form?.invoiceRemark || ""],
    ["首个项目名称", invoiceItemName],
    ["规格型号", form?.itemSpecModel || ""],
    ["单位", form?.itemUnit || ""],
    ["数量", quantity],
    ["附件数量", typeof form?.attachmentCount === "number" ? String(form.attachmentCount) : ""],
  ]);
}

function replaceTokens(text: string, values: Map<string, string>) {
  return [...values.entries()].reduce((result, [token, value]) => result.split(`{${token}}`).join(value), text);
}

function flattenQuickCopySections(sections: QuickCopySection[]) {
  return sections
    .map((section) => {
      const lines = section.entries.map((entry) => `${entry.label}：${entry.value}`);
      return section.id.startsWith("item-") ? `${section.title}\n${lines.join("\n")}` : lines.join("\n");
    })
    .filter((section) => section.trim())
    .join("\n");
}
