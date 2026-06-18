export type Id = number;

export type AppRoute = "dashboard" | "forms" | "batches" | "reconciliation" | "groups" | "settings";

export type InvoiceStatus =
  | "待开票"
  | "待匹配"
  | "待提交"
  | "批次创建"
  | "已提交"
  | "已到账"
  | "报销失败";

export type BatchStatus =
  | "待提交"
  | "已提交"
  | "已到账"
  | "部分到账"
  | "异常处理"
  | "已取消";

export type TransactionStatus = "待对账" | "部分对账" | "已对账" | "金额差异" | "异常";
export type InvoiceKind = "" | "普通发票" | "专用发票" | "其他发票";

export interface ExpenseGroup {
  id: Id;
  name: string;
  ownerId?: Id | null;
  ownerName: string;
  category: string;
  titleRule: string;
  quickSubmitTemplate: string;
  attachmentRuleConfig: string;
  color: string;
  remark: string;
  isActive: boolean;
  updatedAt: string;
}

export interface PersonMember {
  id: Id;
  name: string;
  phone: string;
  email: string;
  remark: string;
  isActive: boolean;
  updatedAt: string;
}

export interface Attachment {
  id: Id;
  ownerType: "invoice" | "transaction" | "batch" | "item";
  ownerId: Id;
  fileName: string;
  fileType: string;
  relativePath: string;
  remark: string;
  uploadedAt: string;
}

export interface FormRecord {
  id: Id;
  title: string;
  invoiceNumber: string;
  invoiceKind: InvoiceKind;
  amount: number;
  taxAmount: number;
  purchaseDate: string;
  issueDate: string;
  groupId: Id | null;
  groupName: string;
  memberId?: Id | null;
  memberName?: string;
  contentType: "订单" | "发票" | "订单+发票";
  status: InvoiceStatus;
  hasInvoice: boolean;
  isMatched: boolean;
  invoiceConfirmed: boolean;
  attachmentCount: number;
  sellerName: string;
  sellerTaxNo?: string;
  buyerName: string;
  buyerTaxNo?: string;
  invoiceItemName?: string;
  invoiceRemark?: string;
  itemSpecModel?: string;
  itemUnit?: string;
  itemQuantity?: number | null;
  remark: string;
  updatedAt: string;
}

export interface ReimbursementItem {
  id: Id;
  batchId: Id;
  formId: Id;
  title: string;
  amount: number;
  reconciledAmount: number;
  status: InvoiceStatus;
  isReleased?: boolean;
  releasedAt?: string;
  releaseReason?: string;
  exceptionReason: string;
  remark: string;
}

export interface BatchStatusEvent {
  status: BatchStatus;
  timestamp: string;
  remark: string;
}

export interface ReimbursementBatch {
  id: Id;
  no: string;
  groupId: Id | null;
  groupName: string;
  totalAmount: number;
  status: BatchStatus;
  applyTime: string;
  updatedTime: string;
  completedTime: string | null;
  statusTimeline: BatchStatusEvent[];
  remark: string;
  quickSubmitText: string;
  items: ReimbursementItem[];
}

export interface ReconciliationTransaction {
  id: Id;
  no: string;
  amount: number;
  transactionTime: string;
  transactionAccount?: string;
  transactionLocation?: string;
  counterpartyAccount?: string;
  accountingDate?: string;
  category: string;
  direction: "收入" | "支出";
  status: TransactionStatus;
  remark: string;
  attachmentCount: number;
  matchedBatchIds: Id[];
  matchedItemIds: Id[];
}

export interface DashboardStats {
  formCount: number;
  invoiceCount: number;
  batchCount: number;
  transactionCount: number;
  pendingInvoiceAmount: number;
  reimbursementAmount: number;
  reconciledAmount: number;
  issueReminderCount: number;
}

export interface Settings {
  databasePath: string;
  attachmentDir: string;
  darkMode: boolean;
  checkUpdates: boolean;
  hideAmounts: boolean;
  lastBackupAt: string | null;
}

export interface AppData {
  groups: ExpenseGroup[];
  members: PersonMember[];
  forms: FormRecord[];
  batches: ReimbursementBatch[];
  transactions: ReconciliationTransaction[];
  attachments: Attachment[];
  settings: Settings;
}

export interface ImportDraft {
  orderText: string;
  invoiceFileName: string;
  attachmentNames: string[];
  attachmentRemark: string;
  parsedTitle: string;
  parsedAmount: number;
  parsedInvoiceNumber: string;
}

export interface UploadedAttachmentPayload {
  fileName: string;
  fileType: string;
  remark: string;
  bytes: number[];
}

export interface DroppedFilePayload extends UploadedAttachmentPayload {
  sourcePath: string;
}

export interface OcrInvoiceResult {
  ok: boolean;
  message: string;
  rawText: string;
  invoiceType: string;
  invoiceNumber: string;
  issueDate: string;
  buyerName: string;
  buyerTaxNo: string;
  sellerName: string;
  sellerTaxNo: string;
  itemName: string;
  specModel: string;
  unit: string;
  quantity: string;
  subtotalAmount: string;
  taxAmount: string;
  totalWithTax: string;
  invoiceRemark: string;
}

export interface OcrIncomeResult {
  ok: boolean;
  message: string;
  rawText: string;
  amount: string;
  transactionAccount: string;
  transactionTime: string;
  transactionLocation: string;
  counterpartyAccount: string;
  accountingDate: string;
}

export interface BatchImportRow {
  id: Id;
  fileName: string;
  title: string;
  invoiceNumber: string;
  amount: number;
  issueDate: string;
  problem: string;
}
