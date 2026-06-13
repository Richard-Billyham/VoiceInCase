import type {
  FormRecord,
  InvoiceKind,
  OcrInvoiceResult,
} from "../../types/domain";
import { defaultInvoiceStatusForContent, normalizeInvoiceStatus } from "../../utils/workflowRules";
import { buildUploadedFileSummary } from "./importFileUtils";

export interface ImportFormDraft {
  title: string;
  amount: string;
  purchaseDate: string;
  groupId: string;
  contentType: FormRecord["contentType"];
  status: FormRecord["status"];
}

export interface InvoiceDetailDraft {
  invoiceNumber: string;
  invoiceKind: InvoiceKind;
  buyerName: string;
  buyerTaxNo: string;
  sellerName: string;
  sellerTaxNo: string;
  totalWithTax: string;
  subtotalAmount: string;
  taxAmount: string;
  remark: string;
  itemName: string;
  specModel: string;
  unit: string;
  quantity: string;
}

export const emptyInvoiceDetail: InvoiceDetailDraft = {
  invoiceNumber: "",
  invoiceKind: "",
  buyerName: "",
  buyerTaxNo: "",
  sellerName: "",
  sellerTaxNo: "",
  totalWithTax: "",
  subtotalAmount: "",
  taxAmount: "",
  remark: "",
  itemName: "",
  specModel: "",
  unit: "",
  quantity: "",
};

const OCR_LABEL_NOISE = new Set([
  "单位",
  "单价",
  "数量",
  "金额",
  "税率",
  "税额",
  "规格",
  "型号",
  "规格型号",
  "项目名称",
  "商品名称",
  "合计",
  "价税合计",
  "小写",
  "大写",
  "备注",
  "名称",
  "税号",
  "纳税人识别号",
]);

const UNIT_WHITELIST = new Set([
  "个",
  "件",
  "只",
  "台",
  "套",
  "批",
  "张",
  "卷",
  "瓶",
  "盒",
  "包",
  "米",
  "条",
  "根",
  "片",
  "块",
  "本",
  "次",
  "项",
  "pcs",
  "pc",
  "piece",
  "set",
  "kg",
  "g",
  "m",
  "mm",
  "cm",
  "qt",
]);

export function ocrResultToDetail(result: OcrInvoiceResult, file: File): InvoiceDetailDraft {
  const fallback = parseInvoiceDetail(result.rawText || buildUploadedFileSummary(file), file);
  return {
    invoiceNumber: result.invoiceNumber || fallback.invoiceNumber,
    invoiceKind: normalizeInvoiceKind(result.invoiceType) || fallback.invoiceKind,
    buyerName: result.buyerName || fallback.buyerName,
    buyerTaxNo: result.buyerTaxNo || fallback.buyerTaxNo,
    sellerName: result.sellerName || fallback.sellerName,
    sellerTaxNo: result.sellerTaxNo || fallback.sellerTaxNo,
    totalWithTax: sanitizeMoney(result.totalWithTax) || fallback.totalWithTax,
    subtotalAmount: sanitizeMoney(result.subtotalAmount) || fallback.subtotalAmount,
    taxAmount: sanitizeMoney(result.taxAmount) || fallback.taxAmount,
    remark: cleanLabeledValue(result.invoiceRemark) || fallback.remark,
    itemName: cleanLabeledValue(result.itemName) || fallback.itemName,
    specModel: sanitizeSpecModel(result.specModel || fallback.specModel),
    unit: sanitizeUnit(result.unit) || fallback.unit,
    quantity: sanitizeQuantity(result.quantity) || fallback.quantity,
  };
}

export function findInvoiceTaxNoProblem(detail: Pick<InvoiceDetailDraft, "buyerTaxNo" | "sellerTaxNo">) {
  const buyerTaxNo = normalizeTaxNo(detail.buyerTaxNo);
  const sellerTaxNo = normalizeTaxNo(detail.sellerTaxNo);
  if (buyerTaxNo && sellerTaxNo && buyerTaxNo === sellerTaxNo) {
    return "购买方税号与销售方税号相同";
  }
  return "";
}

export function missingInvoiceDetailFields(detail: Pick<InvoiceDetailDraft, "specModel" | "unit" | "quantity">) {
  const missing: string[] = [];
  if (!sanitizeSpecModel(detail.specModel)) {
    missing.push("规格型号");
  }
  if (!sanitizeUnit(detail.unit)) {
    missing.push("单位");
  }
  if (!sanitizeQuantity(detail.quantity)) {
    missing.push("数量");
  }
  return missing;
}

export function recordToInvoiceDetail(record: FormRecord | null): InvoiceDetailDraft {
  if (!record) {
    return emptyInvoiceDetail;
  }
  return {
    invoiceNumber: record.invoiceNumber || "",
    invoiceKind: record.invoiceKind || "",
    buyerName: record.buyerName || "",
    buyerTaxNo: record.buyerTaxNo || "",
    sellerName: record.sellerName || "",
    sellerTaxNo: record.sellerTaxNo || "",
    totalWithTax: record.amount ? String(record.amount) : "",
    subtotalAmount: record.amount && record.taxAmount ? String(Number((record.amount - record.taxAmount).toFixed(2))) : "",
    taxAmount: record.taxAmount ? String(record.taxAmount) : "",
    remark: record.invoiceRemark || "",
    itemName: record.invoiceItemName || record.title || "",
    specModel: sanitizeSpecModel(record.itemSpecModel || ""),
    unit: sanitizeUnit(record.itemUnit || ""),
    quantity: record.itemQuantity ? String(record.itemQuantity) : "",
  };
}

export function mergeInvoiceIntoForm(current: ImportFormDraft, detail: InvoiceDetailDraft, file: File, invoiceText: string) {
  return withInferredContentType({
    ...current,
    amount: current.amount || detail.totalWithTax || detail.subtotalAmount || String(parseAmount(`${invoiceText}\n${file.name}`) || ""),
    status: normalizeInvoiceStatus(current.status),
  }, detail);
}

export function withInferredContentType(draft: ImportFormDraft, detail: InvoiceDetailDraft): ImportFormDraft {
  const contentType = inferContentType(draft, detail);
  return {
    ...draft,
    contentType,
    status: normalizeStatusForContent(draft.status, contentType),
  };
}

export function inferContentType(draft: Pick<ImportFormDraft, "title">, detail: Pick<InvoiceDetailDraft, "buyerTaxNo" | "sellerTaxNo">): FormRecord["contentType"] {
  const hasFormName = draft.title.trim().length > 0;
  const hasTaxNo = Boolean(detail.buyerTaxNo.trim() || detail.sellerTaxNo.trim());
  if (hasFormName && hasTaxNo) {
    return "订单+发票";
  }
  if (hasTaxNo) {
    return "发票";
  }
  return "订单";
}

export function applyOcrFallbackData(file: File, text: string) {
  const nextInvoiceText = text || buildUploadedFileSummary(file);
  const detail = parseInvoiceDetail(nextInvoiceText, file);
  return {
    invoiceText: nextInvoiceText,
    detail,
    invoiceDate: parseDate(`${nextInvoiceText}\n${file.name}`),
  };
}

export function parseInvoiceDetail(text: string, file: File): InvoiceDetailDraft {
  const names = Array.from(text.matchAll(/名称[:：]\s*([^\n\r]{2,80})/g)).map((match) => cleanField(match[1]));
  const taxNos = Array.from(text.matchAll(/(?:统一社会信用代码\/纳税人识别号|纳税人识别号|税号)[:：\s]*([A-Z0-9]{12,24})/g)).map((match) => match[1]);
  const totalWithTax = parseInvoiceAmount(text, ["价税合计", "小写"]);
  const subtotalAmount = parseInvoiceAmount(text, ["合计", "金额"]);
  const taxAmount = parseInvoiceAmount(text, ["税额"]);
  const itemName = parseFirstItemName(text) || file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return {
    invoiceNumber: parseInvoiceNumber(text),
    invoiceKind: parseInvoiceKind(text),
    buyerName: findLabeledValue(text, ["购买方名称", "购方名称", "买方名称"]) || names[0] || "",
    buyerTaxNo: findLabeledValue(text, ["购买方税号", "购买方纳税人识别号", "买方税号"]) || taxNos[0] || "",
    sellerName: findLabeledValue(text, ["销售方名称", "销方名称", "卖方名称"]) || names[1] || "",
    sellerTaxNo: findLabeledValue(text, ["销售方税号", "销售方纳税人识别号", "卖方税号"]) || taxNos[1] || "",
    totalWithTax,
    subtotalAmount,
    taxAmount,
    remark: findLabeledValue(text, ["备注"]),
    itemName,
    specModel: sanitizeSpecModel(findLabeledValue(text, ["规格型号", "规格", "型号"])),
    unit: sanitizeUnit(findLabeledValue(text, ["单位"])),
    quantity: sanitizeQuantity(findLabeledValue(text, ["数量"])),
  };
}

export function parseTitle(text: string, fileName: string) {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length >= 2 && item.length <= 32 && !item.startsWith("已上传") && !item.includes("文件大小"));
  if (line) {
    return line.replace(/^(名称|项目|摘要|标题)[:：]\s*/, "");
  }
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "新导入订单";
}

export function parseInvoiceNumber(text: string) {
  return matchFirst(text, /(?:发票号码|发票号|票号|invoice\s*no\.?)[:：\s]*([A-Za-z0-9-]+)/i);
}

export function parseInvoiceKind(text: string): InvoiceKind {
  return normalizeInvoiceKind(text);
}

export function normalizeInvoiceKind(value: string): InvoiceKind {
  const text = (value || "").replace(/\s+/g, "");
  if (!text) {
    return "";
  }
  if (text.includes("专用")) {
    return "专用发票";
  }
  if (text.includes("普通") || text.includes("普票")) {
    return "普通发票";
  }
  if (text.includes("发票")) {
    return "其他发票";
  }
  return "";
}

export function parseAmount(text: string) {
  const priority = matchFirst(text, /(?:价税合计|总金额|金额|合计|amount)[:：\s￥¥]*([0-9,]+(?:\.\d{1,2})?)/i);
  const priorityAmount = parseMoneyCandidate(priority);
  if (priorityAmount !== "") {
    return Number(priorityAmount);
  }
  const numbers = Array.from(text.matchAll(/[￥¥]?\s*([0-9,]+(?:\.\d{1,2})?)/g))
    .map((match) => Number(parseMoneyCandidate(match[1])))
    .filter((value) => Number.isFinite(value) && isReasonableMoney(value));
  return numbers.length ? Math.max(...numbers) : 0;
}

export function parseTaxAmount(text: string) {
  const tax = matchFirst(text, /(?:税额|tax)[:：\s￥¥]*([0-9,]+(?:\.\d{1,2})?)/i);
  const amount = parseMoneyCandidate(tax);
  return amount ? Number(amount) : 0;
}

export function parseDate(text: string) {
  const matched = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (matched) {
    return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
  }
  const short = text.match(/(?:^|[_\-\s])(\d{2})(\d{2})(\d{2})(?:\.|_|-|\s|$)/);
  if (short) {
    return `20${short[1]}-${short[2]}-${short[3]}`;
  }
  return "";
}

function parseInvoiceAmount(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = text.match(new RegExp(`${escaped}[^0-9￥¥-]{0,20}[￥¥]?\\s*(-?[0-9,]+(?:\\.\\d{1,2})?)`, "i"));
    const amount = parseMoneyCandidate(matched?.[1] ?? "");
    if (amount) {
      return amount;
    }
  }
  return "";
}

function findLabeledValue(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = text.match(new RegExp(`${escaped}\\s*[:：]?\\s*([^\\n\\r]{1,80})`));
    const value = cleanLabeledValue(matched?.[1] ?? "");
    if (value) {
      return value;
    }
  }
  return "";
}

function parseFirstItemName(text: string) {
  const labeled = findLabeledValue(text, ["项目名称", "货物或应税劳务、服务名称", "商品名称"]);
  if (labeled) {
    return labeled;
  }
  const itemLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(\*|·)?[\u4e00-\u9fa5A-Za-z0-9].{2,40}/.test(line) && /[0-9]/.test(line));
  return itemLine ? cleanField(itemLine.replace(/\s+[0-9].*$/, "")) : "";
}

function cleanLabeledValue(value: string) {
  const cleaned = cleanField(value);
  const compact = cleaned.replace(/\s+/g, "");
  if (!compact || OCR_LABEL_NOISE.has(compact)) {
    return "";
  }
  return cleaned;
}

function cleanField(value: string) {
  return value.replace(/\s{2,}/g, " ").replace(/[|｜]+/g, " ").trim();
}

function normalizeTaxNo(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeStatusForContent(status: FormRecord["status"], contentType: FormRecord["contentType"]): FormRecord["status"] {
  const normalized = normalizeInvoiceStatus(status);
  if (contentType === "订单" && normalized === "待匹配") {
    return "待开票";
  }
  if (contentType === "发票" && normalized === "待开票") {
    return "待匹配";
  }
  if (contentType === "订单+发票" && (normalized === "待开票" || normalized === "待匹配")) {
    return defaultInvoiceStatusForContent(contentType);
  }
  return normalized;
}

export function sanitizeSpecModel(value: string) {
  const cleaned = cleanLabeledValue(value || "");
  const compact = cleaned.replace(/\s+/g, "");
  if (!compact || OCR_LABEL_NOISE.has(compact)) {
    return "";
  }
  return cleaned;
}

export function sanitizeUnit(value: string) {
  const cleaned = cleanLabeledValue(value).replace(/[()（）【】[\]]/g, "").trim();
  const compact = cleaned.replace(/\s+/g, "");
  if (!compact || compact.length > 8 || /\d/.test(compact)) {
    return "";
  }
  return UNIT_WHITELIST.has(compact.toLowerCase()) ? compact : "";
}

export function sanitizeQuantity(value: string) {
  const cleaned = cleanLabeledValue(value);
  const matched = cleaned.match(/^-?\d+(?:\.\d+)?$/);
  if (!matched) {
    return "";
  }
  const number = Number(matched[0]);
  return Number.isFinite(number) && number >= 0 && number < 1_000_000 ? matched[0] : "";
}

function sanitizeMoney(value: string) {
  return parseMoneyCandidate(value);
}

function parseMoneyCandidate(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return "";
  }
  const number = Number(normalized);
  return isReasonableMoney(number) ? normalized : "";
}

function isReasonableMoney(value: number) {
  return Number.isFinite(value) && value >= 0 && value < 10_000_000;
}

function matchFirst(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1] ?? "";
}
