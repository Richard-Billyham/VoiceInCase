import { AlertCircle, FileCheck2, FileText, GripHorizontal, UploadCloud, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ivicService } from "../../services/ivicService";
import type { Attachment, DroppedFilePayload, ExpenseGroup, FormRecord, OcrInvoiceResult, ReimbursementBatch, UploadedAttachmentPayload } from "../../types/domain";
import { formatMoney } from "../../utils/format";
import { invoiceStatusOptions, validateInvoiceStatusForSave } from "../../utils/workflowRules";
import {
  buildUploadedFileSummary,
  extractReadableText,
  fileSnapshot,
  filesToPayloads,
  isInvoiceAttachment,
  isInvoiceLikeFile,
  isTauriRuntime,
  payloadsToExistingFileItems,
  payloadsToFileItems,
  removeFileItem,
  revokeItems,
  toFileItems,
  type SelectedFileItem,
} from "./importFileUtils";
import {
  applyOcrFallbackData,
  emptyInvoiceDetail,
  findInvoiceTaxNoProblem,
  mergeInvoiceIntoForm,
  missingInvoiceDetailFields,
  ocrResultToDetail,
  parseDate,
  parseTitle,
  recordToInvoiceDetail,
  withInferredContentType,
  type ImportFormDraft,
  type InvoiceDetailDraft,
} from "./importUtils";
import { buildBatchRecord, buildBatchRow, buildSingleRecord, type BatchRecordDraft } from "./importRecordUtils";

interface ImportDialogsProps {
  existingForms?: FormRecord[];
  groups: ExpenseGroup[];
  initialTab?: "single" | "batch";
  initialRecord?: FormRecord | null;
  initialAttachments?: Attachment[];
  statusBatches?: ReimbursementBatch[];
  onCreateForm?: (record: FormRecord, attachments?: UploadedAttachmentPayload[]) => Promise<void> | void;
  onClose?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}

interface DragOrigin {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface BatchRecognitionRow extends BatchRecordDraft {
  itemId: string;
  recognizing: boolean;
  missingFields: string[];
  invoiceConfirmed: boolean;
}

export function ImportDialogs({
  existingForms = [],
  groups,
  initialTab = "single",
  initialRecord = null,
  initialAttachments = [],
  statusBatches = [],
  onCreateForm,
  onClose,
  onDirtyChange,
  onSaved,
}: ImportDialogsProps) {
  const [tab, setTab] = useState<"single" | "batch">(initialTab);
  const isEditing = Boolean(initialRecord);
  const [formDraft, setFormDraft] = useState<ImportFormDraft>(() => ({
    title: initialRecord?.title ?? "",
    amount: initialRecord ? String(initialRecord.amount || "") : "",
    purchaseDate: initialRecord?.purchaseDate ?? "",
    groupId: initialRecord?.groupId ? String(initialRecord.groupId) : "",
    contentType: initialRecord?.contentType ?? "订单",
    status: initialRecord?.status ?? "待开票",
  }));
  const [invoiceText, setInvoiceText] = useState(initialRecord?.invoiceRemark ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initialRecord?.issueDate ?? "");
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetailDraft>(() => recordToInvoiceDetail(initialRecord));
  const [invoiceConfirmed, setInvoiceConfirmed] = useState(initialRecord?.invoiceConfirmed ?? false);
  const [invoiceFiles, setInvoiceFiles] = useState<SelectedFileItem[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<SelectedFileItem[]>([]);
  const [batchFiles, setBatchFiles] = useState<SelectedFileItem[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRecognitionRow[]>([]);
  const [attachmentRemark, setAttachmentRemark] = useState("");
  const [error, setError] = useState("");
  const [ocrMessage, setOcrMessage] = useState("");
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [externalDragging, setExternalDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [initializingExistingFiles, setInitializingExistingFiles] = useState(() => Boolean(initialRecord && initialAttachments.length));
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragOrigin | null>(null);
  const fileStateRef = useRef({ invoiceFiles, attachmentFiles, batchFiles });
  const initialLoadRef = useRef(false);
  const baselineSnapshotRef = useRef<string | null>(null);
  const openingSnapshotRef = useRef<string | null>(null);
  const existingFormsSnapshotRef = useRef(existingForms);
  const userTouchedDuringInitializationRef = useRef(false);
  const manualContentTypeRef = useRef(Boolean(initialRecord));
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const activeInvoice = tab === "single" ? invoiceFiles[0] ?? null : null;
  const selectedGroup = groups.find((group) => String(group.id) === formDraft.groupId);
  const existingInvoiceAttachmentCount = initialAttachments.filter(isInvoiceAttachment).length;
  const existingAttachmentCount = initialAttachments.length;
  const batchTotal = batchRows.reduce((sum, row) => sum + row.amount, 0);
  const invoiceMissingFields = useMemo(() => missingInvoiceDetailFields(invoiceDetail), [invoiceDetail]);
  const existingInvoiceNumberOwners = useMemo(() => {
    const owners = new Map<string, FormRecord>();
    existingFormsSnapshotRef.current.forEach((form) => {
      const key = normalizeInvoiceNumberKey(form.invoiceNumber);
      if (key && form.id !== initialRecord?.id) {
        owners.set(key, form);
      }
    });
    return owners;
  }, [initialRecord?.id]);
  const batchInvoiceNumberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    batchRows.forEach((row) => {
      const key = normalizeInvoiceNumberKey(row.invoiceNumber);
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    });
    return counts;
  }, [batchRows]);
  const batchProblemCount = batchRows.filter((row) => !row.recognizing && batchRowProblem(row)).length;
  const batchProblemItemIds = useMemo(
    () => new Set(batchRows.filter((row) => !row.recognizing && batchRowProblem(row)).map((row) => row.itemId)),
    [batchRows, batchInvoiceNumberCounts, existingInvoiceNumberOwners],
  );
  const dirtySnapshot = useMemo(
    () =>
      JSON.stringify({
        attachmentFiles: fileSnapshot(attachmentFiles),
        attachmentRemark,
        batchFiles: fileSnapshot(batchFiles),
        batchRows,
        formDraft,
        invoiceDate,
        invoiceDetail,
        invoiceConfirmed,
        invoiceFiles: fileSnapshot(invoiceFiles),
        invoiceText,
      }),
    [attachmentFiles, attachmentRemark, batchFiles, batchRows, formDraft, invoiceDate, invoiceDetail, invoiceConfirmed, invoiceFiles, invoiceText],
  );
  if (openingSnapshotRef.current === null) {
    openingSnapshotRef.current = dirtySnapshot;
  }

  useEffect(() => {
    fileStateRef.current = { invoiceFiles, attachmentFiles, batchFiles };
  }, [attachmentFiles, batchFiles, invoiceFiles]);

  useEffect(() => {
    return () => {
      revokeItems(fileStateRef.current.invoiceFiles);
      revokeItems(fileStateRef.current.attachmentFiles);
      revokeItems(fileStateRef.current.batchFiles);
    };
  }, []);

  useEffect(() => {
    if (initializingExistingFiles) {
      return;
    }
    if (baselineSnapshotRef.current === null) {
      baselineSnapshotRef.current = userTouchedDuringInitializationRef.current ? openingSnapshotRef.current ?? dirtySnapshot : dirtySnapshot;
      onDirtyChange?.(dirtySnapshot !== baselineSnapshotRef.current);
      return;
    }
    onDirtyChange?.(dirtySnapshot !== baselineSnapshotRef.current);
  }, [dirtySnapshot, initializingExistingFiles, onDirtyChange]);

  useEffect(() => {
    if (!initialRecord || initialLoadRef.current) {
      return;
    }
    initialLoadRef.current = true;
    const invoiceAttachments = initialAttachments.filter(isInvoiceAttachment);
    const otherAttachments = initialAttachments.filter((attachment) => !isInvoiceAttachment(attachment));
    if (!invoiceAttachments.length && !otherAttachments.length) {
      setInitializingExistingFiles(false);
      return;
    }
    setOcrMessage("正在加载已有附件预览...");
    void Promise.all(initialAttachments.map((attachment) => ivicService.readAttachmentFile(attachment)))
      .then((payloads) => {
        const loaded = payloads.filter((item): item is UploadedAttachmentPayload => Boolean(item));
        const invoicePayloads = loaded.filter((item) => isInvoiceLikeFile(item.fileName) || item.fileType === "发票");
        const attachmentPayloads = loaded.filter((item) => !invoicePayloads.includes(item));
        setInvoiceFiles(payloadsToExistingFileItems(invoicePayloads.slice(0, 1)));
        setAttachmentFiles(payloadsToExistingFileItems(attachmentPayloads));
        setOcrMessage(invoicePayloads.length ? "已加载已有发票预览。" : "");
      })
      .catch(() => {
        setOcrMessage("已有附件暂时无法读取，可重新上传发票或附件。");
      })
      .finally(() => {
        setInitializingExistingFiles(false);
      });
  }, [initialAttachments, initialRecord]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setExternalDragging(true);
        }
        if (payload.type === "leave") {
          setExternalDragging(false);
        }
        if (payload.type === "drop") {
          setExternalDragging(false);
          void handleDroppedPaths(payload.paths);
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        setOcrMessage("系统级拖拽监听不可用，可点击上传框选择文件。");
      });
    return () => unlisten?.();
  }, [tab]);

  function patchFormDraft(patch: Partial<ImportFormDraft>) {
    markUserTouched();
    setFormDraft((current) => applyContentTypeInference({ ...current, ...patch }, invoiceDetail));
  }

  function patchInvoiceDetail(
    patch: Partial<InvoiceDetailDraft>,
    formPatch?: Partial<ImportFormDraft> | ((draft: ImportFormDraft, detail: InvoiceDetailDraft) => Partial<ImportFormDraft>),
  ) {
    markUserTouched();
    setInvoiceConfirmed(false);
    setInvoiceDetail((current) => {
      const nextDetail = { ...current, ...patch };
      setFormDraft((currentDraft) => {
        const extra = typeof formPatch === "function" ? formPatch(currentDraft, nextDetail) : formPatch ?? {};
        return applyContentTypeInference({ ...currentDraft, ...extra }, nextDetail);
      });
      return nextDetail;
    });
  }

  function applyContentTypeInference(draft: ImportFormDraft, detail: InvoiceDetailDraft) {
    return manualContentTypeRef.current ? draft : withInferredContentType(draft, detail);
  }

  function mergeInvoiceIntoDraft(current: ImportFormDraft, detail: InvoiceDetailDraft, file: File, text: string) {
    if (!manualContentTypeRef.current) {
      return mergeInvoiceIntoForm(current, detail, file, text);
    }
    return {
      ...current,
      amount: current.amount || detail.totalWithTax || detail.subtotalAmount,
    };
  }

  async function handleDroppedPaths(paths: string[]) {
    if (!paths.length) {
      return;
    }
    markUserTouched();
    try {
      const payloads = await ivicService.readDroppedFiles(paths);
      const invoicePayloads = payloads.filter((item) => isInvoiceLikeFile(item.fileName));
      const otherPayloads = payloads.filter((item) => !isInvoiceLikeFile(item.fileName));
      if (tab === "batch") {
        handleBatchPayloads(invoicePayloads.length ? invoicePayloads : payloads);
        return;
      }
      if (invoicePayloads.length) {
        await handleInvoicePayloads([invoicePayloads[0]]);
      }
      if (otherPayloads.length || invoicePayloads.length > 1) {
        handleAttachmentPayloads([...otherPayloads, ...invoicePayloads.slice(1)]);
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "读取拖入文件失败。");
    }
  }

  async function handleInvoiceFiles(files: File[]) {
    markUserTouched();
    const next = toFileItems(files.slice(0, 1));
    setInvoiceFiles((current) => {
      revokeItems(current);
      return next;
    });
    setError("");
    const file = next[0]?.file;
    if (!file) {
      return;
    }
    await recognizeAndApplyInvoice(next[0]);
  }

  async function handleInvoicePayloads(payloads: DroppedFilePayload[]) {
    markUserTouched();
    const next = payloadsToFileItems(payloads.slice(0, 1));
    setInvoiceFiles((current) => {
      revokeItems(current);
      return next;
    });
    setError("");
    if (next[0]) {
      await recognizeAndApplyInvoice(next[0]);
    }
  }

  function handleAttachmentFiles(files: File[]) {
    markUserTouched();
    const next = toFileItems(files);
    setAttachmentFiles((current) => [...current, ...next]);
    setError("");
  }

  function handleAttachmentPayloads(payloads: DroppedFilePayload[]) {
    markUserTouched();
    const next = payloadsToFileItems(payloads);
    setAttachmentFiles((current) => [...current, ...next]);
    setError("");
  }

  function handleBatchFiles(files: File[]) {
    markUserTouched();
    const next = toFileItems(files);
    setBatchFiles((current) => {
      revokeItems(current);
      return next;
    });
    setBatchRows(next.map((item, index) => createInitialBatchRow(item, index)));
    setError("");
    void recognizeBatchItems(next);
  }

  function handleBatchPayloads(payloads: DroppedFilePayload[]) {
    markUserTouched();
    const next = payloadsToFileItems(payloads);
    setBatchFiles((current) => {
      revokeItems(current);
      return next;
    });
    setBatchRows(next.map((item, index) => createInitialBatchRow(item, index)));
    setError("");
    void recognizeBatchItems(next);
  }

  function createInitialBatchRow(item: SelectedFileItem, index: number): BatchRecognitionRow {
    return {
      ...buildBatchRow(item.file, index),
      itemId: item.id,
      recognizing: true,
      missingFields: [],
      invoiceConfirmed: false,
    };
  }

  async function recognizeBatchItems(items: SelectedFileItem[]) {
    if (!items.length) {
      return;
    }
    setIsRecognizing(true);
    setOcrMessage(`正在 OCR 识别 ${items.length} 个发票文件...`);
    let issueCount = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      try {
        const bytes = item.bytes ?? Array.from(new Uint8Array(await item.file.arrayBuffer()));
        const result = await ivicService.recognizeInvoiceAttachment(item.file.name, bytes);
        const fallbackText = await extractReadableText(item.file);
        const row = buildRecognizedBatchRow(item, index, result, fallbackText);
        if (batchRowProblem(row)) {
          issueCount += 1;
        }
        setBatchRows((current) => current.map((candidate) => (candidate.itemId === item.id ? row : candidate)));
      } catch (exception) {
        const fallbackText = await extractReadableText(item.file);
        const fallback = applyOcrFallbackData(item.file, fallbackText);
        const problem = exception instanceof Error ? exception.message : "OCR 识别失败";
        issueCount += 1;
        setBatchRows((current) => current.map((candidate) => (
          candidate.itemId === item.id
            ? buildBatchRowFromDetail(item, index, fallback.detail, fallback.invoiceText, problem)
            : candidate
        )));
      }
    }
    setIsRecognizing(false);
    setOcrMessage(issueCount ? `批量 OCR 完成，发现 ${issueCount} 个异常文件。` : "批量 OCR 识别完成，可以导入。");
  }

  function buildRecognizedBatchRow(item: SelectedFileItem, index: number, result: OcrInvoiceResult, fallbackText: string): BatchRecognitionRow {
    const invoiceTextValue = result.rawText || fallbackText || buildUploadedFileSummary(item.file);
    const detail = result.ok ? ocrResultToDetail(result, item.file) : applyOcrFallbackData(item.file, invoiceTextValue).detail;
    const resultProblem = result.ok ? "" : result.message || "OCR 未识别到内容";
    return buildBatchRowFromDetail(item, index, detail, invoiceTextValue, resultProblem, result.issueDate);
  }

  function buildBatchRowFromDetail(
    item: SelectedFileItem,
    index: number,
    detail: InvoiceDetailDraft,
    invoiceTextValue: string,
    resultProblem = "",
    issueDate = "",
  ): BatchRecognitionRow {
    const amount = Number(detail.totalWithTax || detail.subtotalAmount) || 0;
    const taxNoProblem = findInvoiceTaxNoProblem(detail);
    const missingFields = missingInvoiceDetailFields(detail);
    const problem = [resultProblem, taxNoProblem, amount > 0 ? "" : "未识别到有效金额"].filter(Boolean).join("；");
    return {
      ...buildBatchRow(item.file, index),
      itemId: item.id,
      recognizing: false,
      title: detail.itemName || parseTitle(invoiceTextValue, item.file.name),
      invoiceNumber: detail.invoiceNumber || `IV${Date.now()}${index}`,
      amount,
      taxAmount: Number(detail.taxAmount) || 0,
      issueDate: issueDate || parseDate(`${invoiceTextValue}\n${item.file.name}`),
      buyerName: detail.buyerName,
      buyerTaxNo: detail.buyerTaxNo,
      itemQuantity: Number(detail.quantity) || null,
      itemSpecModel: detail.specModel,
      itemUnit: detail.unit,
      invoiceKind: detail.invoiceKind,
      sellerName: detail.sellerName,
      sellerTaxNo: detail.sellerTaxNo,
      missingFields,
      invoiceConfirmed: missingFields.length === 0,
      problem,
    };
  }

  async function recognizeAndApplyInvoice(item: SelectedFileItem) {
    setIsRecognizing(true);
    setOcrMessage("正在 OCR 识别发票...");
    try {
      const bytes = item.bytes ?? Array.from(new Uint8Array(await item.file.arrayBuffer()));
      const result = await ivicService.recognizeInvoiceAttachment(item.file.name, bytes);
      const fallbackText = await extractReadableText(item.file);
      applyOcrResult(result, item.file, fallbackText);
    } catch (exception) {
      const fallbackText = await extractReadableText(item.file);
      applyInvoiceFallback(item.file, fallbackText);
      setOcrMessage(exception instanceof Error ? exception.message : "OCR 识别失败，已保留文件并使用可解析文本。");
    } finally {
      setIsRecognizing(false);
    }
  }

  function applyOcrResult(result: OcrInvoiceResult, file: File, fallbackText: string) {
    if (!result.ok) {
      applyInvoiceFallback(file, fallbackText || result.rawText);
      setOcrMessage(result.message || "OCR 未识别到内容，请手动修正发票详情。");
      return;
    }
    const invoiceTextValue = result.rawText || fallbackText || buildUploadedFileSummary(file);
    const detail = ocrResultToDetail(result, file);
    const taxNoProblem = findInvoiceTaxNoProblem(detail);
    setInvoiceText(invoiceTextValue);
    setInvoiceDetail(detail);
    setInvoiceConfirmed(missingInvoiceDetailFields(detail).length === 0);
    setInvoiceDate(result.issueDate || parseDate(`${invoiceTextValue}\n${file.name}`));
    setFormDraft((current) => mergeInvoiceIntoDraft(current, detail, file, invoiceTextValue));
    setOcrMessage(taxNoProblem ? `OCR 识别完成，但${taxNoProblem}。` : "OCR 识别完成，已回填发票详情。");
    setError(taxNoProblem);
  }

  function applyInvoiceFallback(file: File, fallbackText: string) {
    const fallback = applyOcrFallbackData(file, fallbackText);
    setInvoiceText(fallback.invoiceText);
    setInvoiceDetail(fallback.detail);
    setInvoiceConfirmed(missingInvoiceDetailFields(fallback.detail).length === 0);
    setInvoiceDate(fallback.invoiceDate);
    setFormDraft((current) => mergeInvoiceIntoDraft(current, fallback.detail, file, fallback.invoiceText));
  }

  function removeInvoiceFile(id: string) {
    markUserTouched();
    setInvoiceFiles((current) => removeFileItem(current, id));
    setInvoiceText("");
    setInvoiceDate("");
    setInvoiceDetail(emptyInvoiceDetail);
    setInvoiceConfirmed(false);
    setFormDraft((current) => applyContentTypeInference(current, emptyInvoiceDetail));
    setOcrMessage("");
  }

  function removeAttachmentFile(id: string) {
    markUserTouched();
    setAttachmentFiles((current) => removeFileItem(current, id));
  }

  function removeBatchFile(id: string) {
    markUserTouched();
    setBatchFiles((current) => removeFileItem(current, id));
    setBatchRows((current) => current.filter((row) => row.itemId !== id));
  }

  function updateFormDraftDirect(patch: Partial<ImportFormDraft>) {
    markUserTouched();
    if (patch.contentType) {
      manualContentTypeRef.current = true;
    }
    setFormDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.contentType === "订单+发票" && current.contentType !== "订单+发票") {
        return { ...next, status: "待提交" };
      }
      return next;
    });
  }

  function updateAttachmentRemark(value: string) {
    markUserTouched();
    setAttachmentRemark(value);
  }

  function markUserTouched() {
    userTouchedDuringInitializationRef.current = true;
  }

  function confirmInvoiceDetail() {
    markUserTouched();
    setInvoiceConfirmed(true);
    setOcrMessage(invoiceMissingFields.length ? `已确认空字段：${invoiceMissingFields.join("、")}。` : "发票明细已确认。");
  }

  function batchRowProblem(row: BatchRecognitionRow) {
    return [
      row.problem,
      existingInvoiceNumberProblem(row.invoiceNumber),
      batchInvoiceNumberProblem(row),
    ].filter(Boolean).join("；");
  }

  function existingInvoiceNumberProblem(invoiceNumber: string) {
    const owner = existingInvoiceNumberOwners.get(normalizeInvoiceNumberKey(invoiceNumber));
    if (!owner) {
      return "";
    }
    return `票号已存在：${invoiceNumber}（${owner.title}）`;
  }

  function batchInvoiceNumberProblem(row: BatchRecognitionRow) {
    const key = normalizeInvoiceNumberKey(row.invoiceNumber);
    if (!key || (batchInvoiceNumberCounts.get(key) ?? 0) <= 1) {
      return "";
    }
    return `本次批量内票号重复：${row.invoiceNumber}`;
  }

  async function handleSingleImport() {
    const amount = Number(formDraft.amount || invoiceDetail.totalWithTax || invoiceDetail.subtotalAmount);
    const hasInvoice = invoiceFiles.length > 0 || Boolean(initialRecord?.hasInvoice);
    const taxNoProblem = findInvoiceTaxNoProblem(invoiceDetail);
    if (!formDraft.title.trim() && !hasInvoice) {
      setError("请先填写名称。");
      return;
    }
    if (taxNoProblem) {
      setError(taxNoProblem);
      return;
    }
    const invoiceNumberProblem = hasInvoice ? existingInvoiceNumberProblem(invoiceDetail.invoiceNumber) : "";
    if (invoiceNumberProblem) {
      setError(invoiceNumberProblem);
      return;
    }
    const statusProblem = validateInvoiceStatusForSave({
      contentType: formDraft.contentType,
      id: initialRecord?.id ?? 0,
      status: formDraft.status,
    }, statusBatches);
    if (statusProblem) {
      setError(statusProblem);
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setError("请填写有效金额。");
      return;
    }
    if (hasInvoice && !invoiceConfirmed) {
      const fields = invoiceMissingFields.length ? invoiceMissingFields.join("、") : "发票明细";
      setError(`请先确认${fields}。`);
      return;
    }
    if (!formDraft.purchaseDate && !hasInvoice) {
      setError("请填写购买日期。");
      return;
    }
    setIsImporting(true);
    setError("");
    try {
      const payloads = [
        ...(await filesToPayloads(invoiceFiles, "发票", invoiceText || "导入发票源文件")),
        ...(await filesToPayloads(attachmentFiles, "附件", attachmentRemark || "导入附件")),
      ];
      await onCreateForm?.(
        buildSingleRecord({
          baseRecord: initialRecord,
          invoiceText,
          invoiceFileName: invoiceFiles[0]?.file.name ?? "",
          attachmentCount: payloads.length,
          existingAttachmentCount,
          hasExistingInvoice: Boolean(initialRecord?.hasInvoice || existingInvoiceAttachmentCount),
          attachmentRemark,
          draft: formDraft,
          invoiceDetail,
          invoiceConfirmed,
          invoiceDate,
          selectedGroup,
          statusBatches,
        }),
        payloads,
      );
      baselineSnapshotRef.current = dirtySnapshot;
      onDirtyChange?.(false);
      if (onSaved) {
        onSaved();
      } else {
        onClose?.();
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "导入失败，请检查文件后重试。");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleBatchImport() {
    if (!batchFiles.length) {
      setError("请先上传要批量导入的发票文件。");
      return;
    }
    if (isRecognizing || batchRows.some((row) => row.recognizing)) {
      setError("批量 OCR 还在识别中，请稍后再导入。");
      return;
    }
    const problemRows = batchRows.filter((row) => batchRowProblem(row));
    if (problemRows.length) {
      setError(`请先处理 ${problemRows.length} 个异常文件：${problemRows.map((row) => `${row.fileName}（${batchRowProblem(row)}）`).join("、")}`);
      return;
    }
    setIsImporting(true);
    setError("");
    try {
      for (let index = 0; index < batchFiles.length; index += 1) {
        const item = batchFiles[index];
        const row = batchRows.find((candidate) => candidate.itemId === item.id);
        const payloads = await filesToPayloads([item], "发票", "批量导入发票源文件");
        await onCreateForm?.(buildBatchRecord(item.file, index, row, selectedGroup), payloads);
      }
      baselineSnapshotRef.current = dirtySnapshot;
      onDirtyChange?.(false);
      if (onSaved) {
        onSaved();
      } else {
        onClose?.();
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "批量导入失败，请检查文件后重试。");
    } finally {
      setIsImporting(false);
    }
  }

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const origin = dragRef.current;
    if (!origin || origin.pointerId !== event.pointerId) {
      return;
    }
    setPosition({
      x: origin.originX + event.clientX - origin.startX,
      y: origin.originY + event.clientY - origin.startY,
    });
  }

  function stopDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  const primaryActionLabel = tab === "batch" ? (isImporting ? "导入中" : "确认批量导入") : (isImporting ? "保存中" : isEditing ? "保存修改" : "提交");
  const handlePrimaryAction = tab === "batch" ? handleBatchImport : handleSingleImport;

  return (
    <section
      className={`modal-card import-modal ${activeInvoice ? "has-preview" : "compact-import"} ${externalDragging ? "external-dragging" : ""}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      {externalDragging && (
        <div className="external-drop-overlay">
          <UploadCloud size={36} />
          <strong>松开即可导入文件</strong>
          <span>发票会自动进入 OCR，其他文件会作为附件。</span>
        </div>
      )}
      <div
        className="import-drag-handle"
        onPointerCancel={stopDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
      >
        <div>
          <span className="section-kicker">表单管理 &gt; 导入</span>
          <h3>{isEditing ? "编辑导入记录" : "确认前不写入正式表"}</h3>
        </div>
        <GripHorizontal size={18} />
      </div>

      <div className="import-modal-actions">
        {!isEditing && (
          <div className="segmented-control">
            <button className={tab === "single" ? "active" : ""} onClick={() => setTab("single")} type="button">单条</button>
            <button className={tab === "batch" ? "active" : ""} onClick={() => setTab("batch")} type="button">批量</button>
          </div>
        )}
        <Button disabled={isImporting || isRecognizing} onClick={handlePrimaryAction} variant="primary">{primaryActionLabel}</Button>
        <Button onClick={onClose}>关闭</Button>
      </div>

      {error && (
        <div className="import-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {ocrMessage && (
        <div className={`import-ocr-status ${isRecognizing ? "running" : ""}`}>
          <AlertCircle size={16} />
          <span>{ocrMessage}</span>
        </div>
      )}

      {tab === "single" ? (
        <div className="import-workspace">
          <div className="import-left-stack">
            <div className="import-field-card form-field-card">
              <span>表单信息</span>
              <div className="import-form-grid">
                <label className="wide">
                  <span>名称</span>
                  <input
                    value={formDraft.title}
                    onChange={(event) => patchFormDraft({ title: event.target.value })}
                    placeholder="例如：会议注册费、传感器采购"
                  />
                </label>
                <label>
                  <span>金额</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    value={formDraft.amount}
                    onChange={(event) => patchFormDraft({ amount: event.target.value })}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  <span>购买日期</span>
                  <input
                    type="date"
                    value={formDraft.purchaseDate}
                    onChange={(event) => patchFormDraft({ purchaseDate: event.target.value })}
                  />
                </label>
                <label>
                  <span>开票日期</span>
                  <input readOnly value={invoiceDate} placeholder="上传发票后自动获取" />
                </label>
                <label>
                  <span>分组</span>
                  <select value={formDraft.groupId} onChange={(event) => patchFormDraft({ groupId: event.target.value })}>
                    <option value="">不选择分组</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>内容类型</span>
                  <select
                    value={formDraft.contentType}
                    onChange={(event) => updateFormDraftDirect({ contentType: event.target.value as FormRecord["contentType"] })}
                  >
                    <option>订单</option>
                    <option>发票</option>
                    <option>订单+发票</option>
                  </select>
                </label>
                <label>
                  <span>状态</span>
                  <select value={formDraft.status} onChange={(event) => updateFormDraftDirect({ status: event.target.value as FormRecord["status"] })}>
                    {invoiceStatusOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {invoiceFiles.length ? (
              <div className="import-field-card invoice-detail-card">
                <div className="import-field-title">
                  <span>发票详情</span>
                  <span className={`confirm-pill ${invoiceConfirmed ? "success" : "warning"}`}>{invoiceConfirmed ? "已确认" : "待确认"}</span>
                  <button onClick={confirmInvoiceDetail} type="button">确认明细</button>
                  <button onClick={() => invoiceInputRef.current?.click()} type="button">重新上传</button>
                </div>
                <input
                  ref={invoiceInputRef}
                  accept=".pdf,image/*,.ofd,.txt,.csv,.json,.xml"
                  hidden
                  onChange={(event) => handleInvoiceFiles(Array.from(event.currentTarget.files ?? []))}
                  type="file"
                />
                <div className="invoice-detail-grid">
                  <label className="wide">
                    <span>票号</span>
                    <input
                      value={invoiceDetail.invoiceNumber}
                      onChange={(event) => patchInvoiceDetail({ invoiceNumber: event.target.value })}
                      placeholder="发票号码"
                    />
                  </label>
                  <label>
                    <span>发票类型</span>
                    <select
                      value={invoiceDetail.invoiceKind}
                      onChange={(event) => patchInvoiceDetail({ invoiceKind: event.target.value as FormRecord["invoiceKind"] })}
                    >
                      <option value="">未识别</option>
                      <option value="普通发票">普通发票</option>
                      <option value="专用发票">专用发票</option>
                      <option value="其他发票">其他发票</option>
                    </select>
                  </label>
                  <label>
                    <span>购买方名称</span>
                    <input value={invoiceDetail.buyerName} onChange={(event) => patchInvoiceDetail({ buyerName: event.target.value })} />
                  </label>
                  <label>
                    <span>购买方税号</span>
                    <input value={invoiceDetail.buyerTaxNo} onChange={(event) => patchInvoiceDetail({ buyerTaxNo: event.target.value })} />
                  </label>
                  <label>
                    <span>销售方名称</span>
                    <input value={invoiceDetail.sellerName} onChange={(event) => patchInvoiceDetail({ sellerName: event.target.value })} />
                  </label>
                  <label>
                    <span>销售方税号</span>
                    <input value={invoiceDetail.sellerTaxNo} onChange={(event) => patchInvoiceDetail({ sellerTaxNo: event.target.value })} />
                  </label>
                  <label>
                    <span>价税合计</span>
                    <input
                      value={invoiceDetail.totalWithTax}
                      onChange={(event) => {
                        const value = event.target.value;
                        patchInvoiceDetail({ totalWithTax: value }, (current) => ({ amount: current.amount || value }));
                      }}
                    />
                  </label>
                  <label>
                    <span>合计</span>
                    <input value={invoiceDetail.subtotalAmount} onChange={(event) => patchInvoiceDetail({ subtotalAmount: event.target.value })} />
                  </label>
                  <label>
                    <span>税额</span>
                    <input value={invoiceDetail.taxAmount} onChange={(event) => patchInvoiceDetail({ taxAmount: event.target.value })} />
                  </label>
                  <label className="wide">
                    <span>发票备注</span>
                    <textarea value={invoiceDetail.remark} onChange={(event) => patchInvoiceDetail({ remark: event.target.value })} />
                  </label>
                  <label className="wide">
                    <span>首个项目名称</span>
                    <input
                      value={invoiceDetail.itemName}
                      onChange={(event) => patchInvoiceDetail({ itemName: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>规格型号</span>
                    <input value={invoiceDetail.specModel} onChange={(event) => patchInvoiceDetail({ specModel: event.target.value })} />
                  </label>
                  <label>
                    <span>单位</span>
                    <input value={invoiceDetail.unit} onChange={(event) => patchInvoiceDetail({ unit: event.target.value })} />
                  </label>
                  <label>
                    <span>数量</span>
                    <input value={invoiceDetail.quantity} onChange={(event) => patchInvoiceDetail({ quantity: event.target.value })} />
                  </label>
                </div>
                <FileList items={invoiceFiles} onRemove={removeInvoiceFile} />
              </div>
            ) : (
              <FileDropZone
                accept=".pdf,image/*,.ofd,.txt,.csv,.json,.xml"
                files={invoiceFiles}
                hint="上传成功后这里会变为发票文本内容"
                multiple={false}
                onFiles={handleInvoiceFiles}
                title="发票 - 拖拽 or 上传框"
              />
            )}

            <div className="import-field-card attachment-upload-card">
              <FileDropZone
                files={attachmentFiles}
                hint="截图、聊天记录、财务系统材料"
                multiple
                onFiles={handleAttachmentFiles}
                onRemove={removeAttachmentFile}
                title="附件 - 拖拽 or 上传框"
              />
              <textarea
                value={attachmentRemark}
                onChange={(event) => updateAttachmentRemark(event.target.value)}
                placeholder="可点击输入附件备注，例如来源、用途或缺失情况"
              />
            </div>

          </div>

          {activeInvoice && <PreviewPane file={activeInvoice.file} title="发票源文件预览" url={activeInvoice.url} />}
        </div>
      ) : (
        <div className="batch-import-grid">
          <label className="batch-group-select">
            <span>导入分组</span>
            <select value={formDraft.groupId} onChange={(event) => patchFormDraft({ groupId: event.target.value })}>
              <option value="">不选择分组</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <FileDropZone
            accept=".pdf,image/*,.ofd,.txt,.csv,.json,.xml"
            files={batchFiles}
            hint="一次选择或拖入多个发票文件"
            multiple
            onFiles={handleBatchFiles}
            onRemove={removeBatchFile}
            problemItemIds={batchProblemItemIds}
            title="批量发票拖拽/上传"
          />
          <div className="batch-summary">
            <strong>{batchRows.length}</strong><span>文件总数</span>
            <strong>{formatMoney(batchTotal)}</strong><span>识别金额</span>
            <strong>{batchProblemCount}</strong><span>需处理</span>
          </div>
          {batchProblemCount > 0 && (
            <div className="batch-issue-list">
              {batchRows.filter((row) => !row.recognizing && batchRowProblem(row)).map((row) => (
                <div key={row.itemId}>
                  <strong>{row.fileName}</strong>
                  <span>{batchRowProblem(row)}</span>
                </div>
              ))}
            </div>
          )}
          {!batchRows.length && <p className="batch-empty">上传文件后可直接确认批量导入。</p>}
        </div>
      )}
    </section>
  );
}

function FileDropZone({
  accept,
  files,
  hint,
  multiple,
  onFiles,
  onRemove,
  problemItemIds,
  title,
}: {
  accept?: string;
  files: SelectedFileItem[];
  hint: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  onRemove?: (id: string) => void;
  problemItemIds?: Set<string>;
  title: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pickFiles(fileList: FileList | null) {
    const next = Array.from(fileList ?? []);
    if (next.length) {
      onFiles(next);
    }
  }

  return (
    <div
      className={`drop-zone ${dragging ? "dragging" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        pickFiles(event.dataTransfer.files);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        accept={accept}
        hidden
        multiple={multiple}
        onChange={(event) => pickFiles(event.currentTarget.files)}
        type="file"
      />
      <UploadCloud size={24} />
      <strong>{title}</strong>
      <span>{hint}</span>
      {files.length > 0 && <FileList items={files} onRemove={onRemove} problemItemIds={problemItemIds} />}
    </div>
  );
}

function FileList({ items, onRemove, problemItemIds }: { items: SelectedFileItem[]; onRemove?: (id: string) => void; problemItemIds?: Set<string> }) {
  return (
    <div className="upload-file-list">
      {items.map((item) => (
        <span key={item.id} className={`upload-file-chip ${problemItemIds?.has(item.id) ? "problem" : ""}`} title={item.file.name}>
          <FileCheck2 size={13} />
          <span>{item.file.name}</span>
          {onRemove && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onRemove(item.id);
              }}
              type="button"
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function normalizeInvoiceNumberKey(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function PreviewPane({ file, title, url }: { file: File; title: string; url: string }) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith("image/");
  return (
    <div className="preview-pane invoice-preview-pane">
      <div className="preview-title">
        <FileText size={18} />
        <strong>{title}</strong>
        <span>{file.name}</span>
      </div>
      {isPdf ? (
        <iframe src={url} title={file.name} />
      ) : isImage ? (
        <img alt={file.name} src={url} />
      ) : (
        <div className="preview-placeholder">
          <FileText size={42} />
          <strong>已上传源文件</strong>
          <span>当前格式暂不支持内嵌预览，但会随表单保存到附件目录。</span>
        </div>
      )}
    </div>
  );
}
