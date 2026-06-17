import { CheckCircle2, Edit3, FileCheck2, Image as ImageIcon, Plus, RotateCcw, Save, Scale, UploadCloud, X, XCircle, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusPill } from "../../components/ui/StatusPill";
import { DataTable, type Column } from "../../components/data-table/DataTable";
import { ivicService } from "../../services/ivicService";
import type { AppData, Attachment, BatchStatus, ReconciliationTransaction, ReimbursementBatch, ReimbursementItem, TransactionStatus, UploadedAttachmentPayload } from "../../types/domain";
import { formatMoney, statusTone } from "../../utils/format";
import { deriveBatchStatusFromItems, normalizeBatchWorkflow, normalizeInvoiceStatus } from "../../utils/workflowRules";
import { filesToPayloads, payloadsToExistingFileItems, removeFileItem, revokeItems, toFileItems, type SelectedFileItem } from "../import/importFileUtils";

interface ReconciliationPageProps {
  data: AppData;
  persist: (action: Promise<AppData>, message: string) => Promise<void>;
}

interface ReconciliationItemRow extends ReimbursementItem {
  batchNo: string;
}

const incomeStatusOptions: TransactionStatus[] = ["待对账", "部分对账", "已对账", "金额差异", "异常"];

interface AttachmentImagePosition {
  x: number;
  y: number;
}

interface AttachmentImageDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: AttachmentImagePosition;
}

export function ReconciliationPage({ data, persist }: ReconciliationPageProps) {
  const [matchMode, setMatchMode] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selectedIncomeIds, setSelectedIncomeIds] = useState<number[]>([]);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [editingIncome, setEditingIncome] = useState<ReconciliationTransaction | null>(null);
  const hidden = data.settings.hideAmounts;
  const allItems = useMemo(
    () => data.batches.map(normalizeBatchWorkflow).flatMap((batch) => batch.items.filter((item) => !item.isReleased).map((item) => ({ ...item, batchNo: batch.no }))),
    [data.batches],
  );
  const needle = keyword.trim().toLowerCase();
  const filteredIncomes = data.transactions.filter((item) => !needle || [item.no, item.category, item.status, item.remark].join(" ").toLowerCase().includes(needle));
  const selectedIncome = data.transactions.find((item) => selectedIncomeIds.includes(item.id)) ?? null;
  const incomeAmount = selectedIncome?.amount ?? 0;
  const selectedItemRows = allItems.filter((item) => selectedItems.includes(item.id));
  const itemTotal = selectedItemRows.reduce((sum, item) => sum + remainingAmount(item), 0);
  const diff = incomeAmount - itemTotal;

  const incomeColumns: Array<Column<ReconciliationTransaction>> = [
    { key: "no", header: "到账编号", width: "170px", render: (row) => row.no },
    { key: "amount", header: "到账金额", width: "120px", align: "right", sortable: true, render: (row) => formatMoney(row.amount, hidden), sortValue: (row) => row.amount },
    { key: "time", header: "到账时间", width: "150px", render: (row) => row.transactionTime },
    { key: "status", header: "状态", width: "112px", render: (row) => <StatusPill value={row.status} tone={statusTone(row.status)} /> },
    { key: "attachmentCount", header: "附件", width: "84px", align: "right", render: (row) => `${row.attachmentCount} 张`, sortValue: (row) => row.attachmentCount },
    { key: "remark", header: "备注", width: "240px", render: (row) => row.remark || "-" },
  ];

  const itemRows = useMemo(
    () => allItems.filter((item) => {
      const status = normalizeInvoiceStatus(item.status);
      return status !== "已到账"
        && status !== "报销失败"
        && remainingAmount(item) > 0.01
        && (!needle || [item.batchNo, item.title, item.status, item.remark].join(" ").toLowerCase().includes(needle));
    }),
    [allItems, needle],
  );
  const itemColumns: Array<Column<ReconciliationItemRow>> = [
    { key: "title", header: "批次 / 子订单", width: "260px", render: (row) => `${row.batchNo} / ${row.title}` },
    { key: "amount", header: "应到账", width: "120px", align: "right", render: (row) => formatMoney(row.amount, hidden) },
    { key: "remain", header: "待匹配", width: "120px", align: "right", render: (row) => formatMoney(remainingAmount(row), hidden) },
    { key: "status", header: "状态", width: "112px", render: (row) => <StatusPill value={row.status} tone={statusTone(row.status)} /> },
    { key: "remark", header: "备注", width: "220px", render: (row) => row.remark || "-" },
  ];

  function toggleSingleIncome(id: string | number) {
    const numericId = Number(id);
    setSelectedIncomeIds((current) => (current.includes(numericId) ? [] : [numericId]));
  }

  function toggleItem(id: string | number) {
    const numericId = Number(id);
    setSelectedItems((current) => (current.includes(numericId) ? current.filter((item) => item !== numericId) : [...current, numericId]));
  }

  function openNewIncome() {
    setEditingIncome(buildIncomeDraft());
  }

  function saveIncome(income: ReconciliationTransaction, attachments: UploadedAttachmentPayload[] = []) {
    const exists = data.transactions.some((item) => item.id === income.id);
    const action = attachments.length ? ivicService.saveTransactionWithAttachments(income, attachments) : ivicService.saveTransaction(income);
    void persist(action, exists ? "到账收入已更新" : "到账收入已新增").then(() => {
      setEditingIncome(null);
      setSelectedIncomeIds([income.id]);
    });
  }

  function completeReconciliation() {
    if (!selectedIncome || !selectedItems.length || selectedIncome.amount <= 0) {
      return;
    }
    const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
    const selectedItemSet = new Set(selectedItems);
    const allocation = allocateIncome(selectedIncome.amount, selectedItemRows);
    const allocatedTotal = Array.from(allocation.values()).reduce((sum, value) => sum + value, 0);
    const matchedBatchIds = data.batches.filter((batch) => batch.items.some((item) => !item.isReleased && selectedItemSet.has(item.id))).map((batch) => batch.id);
    const updatedBatches = data.batches
      .filter((batch) => matchedBatchIds.includes(batch.id))
      .map((batch) => applyIncomeToBatch(batch, allocation, selectedItemSet, selectedIncome, timestamp));
    const updatedIncome: ReconciliationTransaction = {
      ...selectedIncome,
      status: incomeStatusForMatch(selectedIncome.amount, allocatedTotal),
      matchedBatchIds,
      matchedItemIds: selectedItems,
      remark: appendReconciliationRemark(selectedIncome.remark, selectedIncome.amount - allocatedTotal, timestamp),
    };

    void persist(ivicService.saveReconciliationResult(updatedBatches, updatedIncome), "到账收入对账结果已保存").then(() => {
      setSelectedIncomeIds([]);
      setSelectedItems([]);
      setMatchMode(false);
    });
  }

  return (
    <div className="reconciliation-page">
      <section className="work-panel">
        <div className="toolbar">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索到账收入、批次、备注" />
          <Button icon={<Plus size={16} />} variant="primary" onClick={openNewIncome}>新增到账收入</Button>
          <Button icon={<Edit3 size={16} />} disabled={!selectedIncome} onClick={() => selectedIncome && setEditingIncome(selectedIncome)}>编辑收入</Button>
          <Button icon={<Scale size={16} />} variant={matchMode ? "primary" : "secondary"} onClick={() => setMatchMode(!matchMode)}>对账</Button>
          <Button icon={<RotateCcw size={16} />} onClick={() => { setSelectedIncomeIds([]); setSelectedItems([]); setKeyword(""); }}>重置</Button>
          <Button icon={<Save size={16} />} disabled={!matchMode || !selectedIncome || !selectedItems.length || selectedIncome.amount <= 0} onClick={completeReconciliation}>完成对账</Button>
        </div>
        {matchMode && (
          <div className={Math.abs(diff) < 0.01 ? "difference-bar success" : "difference-bar warning"}>
            {Math.abs(diff) < 0.01 ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <span>到账收入 {formatMoney(incomeAmount, hidden)} - 子订单待匹配 {formatMoney(itemTotal, hidden)} = 差额 {formatMoney(diff, hidden)}</span>
            <strong>{Math.abs(diff) < 0.01 ? "金额一致" : "可保存并标记差异"}</strong>
          </div>
        )}
        <div className={matchMode ? "reconcile-match-grid" : "reconcile-normal-grid"}>
          <section>
            <h3>到账收入</h3>
            <DataTable
              rows={filteredIncomes}
              columns={incomeColumns}
              rowKey={(row) => row.id}
              selectedKeys={selectedIncomeIds}
              onToggleRow={matchMode ? toggleSingleIncome : undefined}
              onSelectRow={(row) => setSelectedIncomeIds([row.id])}
              onRowDoubleClick={(row) => setEditingIncome(row)}
              emptyText="暂无到账收入"
            />
          </section>
          {matchMode && (
            <section>
              <h3>报销批次 / 子订单</h3>
              <DataTable
                rows={itemRows}
                columns={itemColumns}
                rowKey={(row) => row.id}
                selectedKeys={selectedItems}
                onToggleRow={toggleItem}
                onSelectRow={(row) => toggleItem(row.id)}
                emptyText="暂无可对账子订单"
              />
            </section>
          )}
        </div>
      </section>

      {editingIncome && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingIncome(null);
            }
          }}
          role="presentation"
        >
          <IncomeEditorDialog
            income={editingIncome}
            attachments={data.attachments.filter((attachment) => attachment.ownerType === "transaction" && attachment.ownerId === editingIncome.id)}
            isNew={!data.transactions.some((item) => item.id === editingIncome.id)}
            onClose={() => setEditingIncome(null)}
            onSave={saveIncome}
          />
        </div>
      )}
    </div>
  );
}

function IncomeEditorDialog({
  attachments,
  income,
  isNew,
  onClose,
  onSave,
}: {
  attachments: Attachment[];
  income: ReconciliationTransaction;
  isNew: boolean;
  onClose: () => void;
  onSave: (income: ReconciliationTransaction, attachments?: UploadedAttachmentPayload[]) => void;
}) {
  const [draft, setDraft] = useState(() => ({ ...income }));
  const [error, setError] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<SelectedFileItem[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const attachmentFilesRef = useRef<SelectedFileItem[]>([]);

  useEffect(() => {
    attachmentFilesRef.current = attachmentFiles;
  }, [attachmentFiles]);

  useEffect(() => () => revokeItems(attachmentFilesRef.current), []);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setDraft({ ...income });
    if (!attachments.length) {
      revokeItems(attachmentFilesRef.current);
      setAttachmentFiles([]);
      return () => {
        cancelled = true;
      };
    }
    setLoadingAttachments(true);
    void Promise.all(attachments.map((attachment) => ivicService.readAttachmentFile(attachment)))
      .then((payloads) => {
        const loaded = payloads.filter((payload): payload is UploadedAttachmentPayload => Boolean(payload));
        const items = payloadsToExistingFileItems(loaded);
        if (cancelled) {
          revokeItems(items);
          return;
        }
        revokeItems(attachmentFilesRef.current);
        setAttachmentFiles(items);
      })
      .catch(() => {
        if (!cancelled) {
          setError("已有附件暂时无法读取，可继续新增到账截图。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAttachments(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachments, income]);

  function patch(patchValue: Partial<ReconciliationTransaction>) {
    setDraft((current) => ({ ...current, ...patchValue }));
  }

  function addAttachments(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|bmp|gif|webp)$/i.test(file.name));
    if (images.length !== files.length) {
      setError("这里只收到账截图图片，PDF 或其他文件先放一放。");
    }
    if (images.length) {
      setAttachmentFiles((current) => [...current, ...toFileItems(images)]);
    }
  }

  function removeAttachment(id: string) {
    setAttachmentFiles((current) => removeFileItem(current, id));
  }

  async function submit() {
    const no = draft.no.trim();
    const category = draft.category.trim() || "报销到账";
    if (!no) {
      setError("请填写到账编号。");
      return;
    }
    if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
      setError("到账金额必须大于 0。");
      return;
    }
    if (!draft.transactionTime.trim()) {
      setError("请填写到账时间。");
      return;
    }
    const nextIncome = {
      ...draft,
      no,
      category,
      direction: "收入" as const,
      amount: Number(draft.amount.toFixed(2)),
      transactionTime: draft.transactionTime.trim(),
      remark: draft.remark.trim(),
    };
    const newAttachments = await filesToPayloads(attachmentFiles, "到账截图", `${no} 到账截图`);
    onSave(nextIncome, newAttachments);
  }

  return (
    <section aria-modal="true" className={attachmentFiles.length ? "modal-card income-editor-modal has-attachments" : "modal-card income-editor-modal"} role="dialog">
      <div className="batch-detail-header">
        <div>
          <span className="section-kicker">到账收入</span>
          <h3>{isNew ? "新增到账收入" : "编辑到账收入"}</h3>
        </div>
        <Button icon={<X size={16} />} onClick={onClose}>关闭</Button>
      </div>
      {error && <p className="income-editor-error">{error}</p>}
      <div className="income-editor-layout">
        <div className="income-editor-form-side">
          <div className="batch-edit-grid">
            <label>
              <span>到账编号</span>
              <input value={draft.no} onChange={(event) => patch({ no: event.target.value })} />
            </label>
            <label>
              <span>到账金额</span>
              <input min="0" step="0.01" type="number" value={draft.amount} onChange={(event) => patch({ amount: Number(event.target.value) })} />
            </label>
            <label>
              <span>到账时间</span>
              <input value={draft.transactionTime} onChange={(event) => patch({ transactionTime: event.target.value })} />
            </label>
            <label>
              <span>类别</span>
              <input value={draft.category} onChange={(event) => patch({ category: event.target.value })} />
            </label>
            <label className="wide">
              <span>状态</span>
              <select value={draft.status} onChange={(event) => patch({ status: event.target.value as TransactionStatus })}>
                {incomeStatusOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="wide">
              <span>备注</span>
              <textarea value={draft.remark} onChange={(event) => patch({ remark: event.target.value })} />
            </label>
          </div>
          <AttachmentDropZone loading={loadingAttachments} onFiles={addAttachments} />
        </div>
        <IncomeAttachmentPanel
          files={attachmentFiles}
          onRemove={removeAttachment}
        />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button icon={<Save size={16} />} onClick={submit} variant="primary">保存收入</Button>
      </div>
    </section>
  );
}

function IncomeAttachmentPanel({
  files,
  onRemove,
}: {
  files: SelectedFileItem[];
  onRemove: (id: string) => void;
}) {
  const [zoomById, setZoomById] = useState<Record<string, number>>({});
  const [positionById, setPositionById] = useState<Record<string, AttachmentImagePosition>>({});
  const dragRef = useRef<AttachmentImageDrag | null>(null);

  function adjustZoom(id: string, delta: number) {
    setZoomById((current) => ({
      ...current,
      [id]: clampZoom((current[id] ?? 1) + delta),
    }));
  }

  function positionFor(id: string) {
    return positionById[id] ?? { x: 50, y: 0 };
  }

  function startImageDrag(event: React.PointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: positionFor(id),
    };
  }

  function moveImageDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const zoom = zoomById[drag.id] ?? 1;
    const nextX = drag.startPosition.x - ((event.clientX - drag.startX) / Math.max(1, rect.width)) * (100 / zoom);
    const nextY = drag.startPosition.y - ((event.clientY - drag.startY) / Math.max(1, rect.height)) * (100 / zoom);
    setPositionById((current) => ({
      ...current,
      [drag.id]: {
        x: clampPercent(nextX),
        y: clampPercent(nextY),
      },
    }));
  }

  function stopImageDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  function resetImagePosition(id: string) {
    setPositionById((current) => ({
      ...current,
      [id]: { x: 50, y: 0 },
    }));
  }

  if (!files.length) {
    return null;
  }

  return (
    <aside className="income-attachment-panel">
      <div className="income-attachment-head">
        <div>
          <strong>到账截图</strong>
          <span>{files.length} 张图片</span>
        </div>
      </div>
      <div className="income-attachment-list">
        {files.map((item) => (
          <div key={item.id} className="income-attachment-card">
            {!item.existingAttachment && (
              <button aria-label="移除附件" onClick={() => onRemove(item.id)} type="button">
                <X size={13} />
              </button>
            )}
            <div className="income-attachment-preview">
              {item.file.type.startsWith("image/") ? (
                <>
                  <div
                    className="income-attachment-image-viewport"
                    onDoubleClick={() => resetImagePosition(item.id)}
                    onPointerCancel={stopImageDrag}
                    onPointerDown={(event) => startImageDrag(event, item.id)}
                    onPointerMove={moveImageDrag}
                    onPointerUp={stopImageDrag}
                  >
                    <img
                      alt={item.file.name}
                      draggable={false}
                      src={item.url}
                      style={{
                        objectPosition: `${positionFor(item.id).x}% ${positionFor(item.id).y}%`,
                        transform: `scale(${zoomById[item.id] ?? 1})`,
                      }}
                    />
                  </div>
                  <div className="income-attachment-zoom" onPointerDown={(event) => event.stopPropagation()}>
                    <button aria-label="缩小图片" onClick={() => adjustZoom(item.id, -0.15)} type="button">
                      <ZoomOut size={13} />
                    </button>
                    <span>{Math.round((zoomById[item.id] ?? 1) * 100)}%</span>
                    <button aria-label="放大图片" onClick={() => adjustZoom(item.id, 0.15)} type="button">
                      <ZoomIn size={13} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="income-attachment-file">
                  <ImageIcon size={28} />
                </div>
              )}
            </div>
            <span title={item.file.name}>
              <FileCheck2 size={13} />
              {item.file.name}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function clampZoom(value: number) {
  return Math.min(2.5, Math.max(0.7, Number(value.toFixed(2))));
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

function AttachmentDropZone({ loading, onFiles }: { loading: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pickFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length) {
      onFiles(files);
    }
  }

  return (
    <div
      className={`income-attachment-drop ${dragging ? "dragging" : ""}`}
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
        accept="image/*"
        hidden
        multiple
        onChange={(event) => pickFiles(event.currentTarget.files)}
        type="file"
      />
      <UploadCloud size={22} />
      <strong>添加图片附件</strong>
      <span>{loading ? "正在读取已有截图..." : "支持截图拖入或点击选择"}</span>
    </div>
  );
}

function buildIncomeDraft(): ReconciliationTransaction {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return {
    id: Date.now(),
    no: `IN-${stamp}-NEW`,
    amount: 0,
    transactionTime: now.toLocaleString("zh-CN", { hour12: false }),
    category: "报销到账",
    direction: "收入",
    status: "待对账",
    remark: "",
    attachmentCount: 0,
    matchedBatchIds: [],
    matchedItemIds: [],
  };
}

function allocateIncome(amount: number, rows: ReconciliationItemRow[]) {
  let remaining = amount;
  const allocation = new Map<number, number>();
  for (const row of rows) {
    if (remaining <= 0) {
      break;
    }
    const allocated = Math.min(remainingAmount(row), remaining);
    if (allocated > 0) {
      allocation.set(row.id, allocated);
      remaining -= allocated;
    }
  }
  return allocation;
}

function applyIncomeToBatch(
  batch: ReimbursementBatch,
  allocation: Map<number, number>,
  selectedItemSet: Set<number>,
  income: ReconciliationTransaction,
  timestamp: string,
): ReimbursementBatch {
  const items = batch.items.map((item) => {
    const status = normalizeInvoiceStatus(item.status);
    if (item.isReleased || !selectedItemSet.has(item.id)) {
      return { ...item, status };
    }
    const reconciledAmount = Math.min(item.amount, item.reconciledAmount + (allocation.get(item.id) ?? 0));
    return {
      ...item,
      reconciledAmount,
      status: reconciledAmount + 0.01 >= item.amount ? "已到账" as const : status === "报销失败" ? "报销失败" as const : "已提交" as const,
    };
  });
  const nextStatus = deriveBatchStatusFromItems(batch.status, items);
  const changedItems = items.filter((item) => !item.isReleased && selectedItemSet.has(item.id));
  const allocatedTotal = changedItems.reduce((sum, item) => sum + (allocation.get(item.id) ?? 0), 0);
  return {
    ...batch,
    items,
    status: nextStatus,
    updatedTime: timestamp,
    completedTime: nextStatus === "已到账" ? timestamp : batch.completedTime,
    statusTimeline: [
      ...batch.statusTimeline,
      {
        status: nextStatus,
        timestamp,
        remark: `到账收入 ${income.no} 对账，匹配 ${changedItems.length} 个子订单，到账 ${formatPlainAmount(allocatedTotal)}`,
      },
    ],
  };
}

function incomeStatusForMatch(incomeAmount: number, matchedAmount: number): TransactionStatus {
  if (matchedAmount <= 0) {
    return "待对账";
  }
  if (Math.abs(incomeAmount - matchedAmount) < 0.01) {
    return "已对账";
  }
  return incomeAmount > matchedAmount ? "部分对账" : "金额差异";
}

function appendReconciliationRemark(remark: string, diff: number, timestamp: string) {
  const diffText = Math.abs(diff) < 0.01 ? "金额一致" : `差额 ${diff.toFixed(2)}`;
  return [remark.trim(), `${timestamp} 对账：${diffText}`].filter(Boolean).join("；");
}

function remainingAmount(item: ReimbursementItem) {
  return Math.max(0, item.amount - item.reconciledAmount);
}

function formatPlainAmount(value: number) {
  return `¥ ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
