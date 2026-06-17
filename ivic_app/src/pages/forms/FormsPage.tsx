import { CheckSquare2, Edit3, FileDown, FilePlus2, GitCompareArrows, PackagePlus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "../../components/ui/Button";
import { DataTable, type Column } from "../../components/data-table/DataTable";
import { GroupBadge } from "../../components/ui/GroupBadge";
import { StatusPill } from "../../components/ui/StatusPill";
import { ivicService } from "../../services/ivicService";
import type { AppData, FormRecord } from "../../types/domain";
import { formatMoney, statusTone } from "../../utils/format";
import { invoiceStatusOptions, normalizeFormsWorkflow } from "../../utils/workflowRules";
import { validateBatchSubmission } from "../batches/batchUtils";
import { ImportDialogs } from "../import/ImportDialogs";
import { SubmitBatchDialog } from "./SubmitBatchDialog";

interface FormsPageProps {
  data: AppData;
  persist: (action: Promise<AppData>, message: string) => Promise<void>;
}

type ModalCloseTarget = "import" | "edit";

interface MatchCommit {
  order: FormRecord;
  invoice: FormRecord;
  matchedOrder: FormRecord;
}

interface StagedMatchPair {
  orderId: number;
  invoiceId: number;
  tone: number;
}

export function FormsPage({ data, persist }: FormsPageProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [keyword, setKeyword] = useState("");
  const [groupId, setGroupId] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [matchMode, setMatchMode] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [importMode, setImportMode] = useState<"single" | "batch" | null>(null);
  const [editingRow, setEditingRow] = useState<FormRecord | null>(null);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [importDirty, setImportDirty] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [pendingClose, setPendingClose] = useState<ModalCloseTarget | null>(null);
  const [successToast, setSuccessToast] = useState("");
  const successTimerRef = useRef<number | null>(null);
  const hidden = data.settings.hideAmounts;
  const members = data.members ?? [];
  const formRows = useMemo(() => normalizeFormsWorkflow(data), [data]);

  const filteredRows = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return formRows.filter((form) => {
      const keywordHit = !needle || [form.title, form.invoiceNumber, form.groupName, form.remark].join(" ").toLowerCase().includes(needle);
      const groupHit = groupId === "全部" || String(form.groupId) === groupId;
      const statusHit = status === "全部" || form.status === status;
      return keywordHit && groupHit && statusHit;
    });
  }, [formRows, groupId, keyword, status]);

  const selectedRows = filteredRows.filter((row) => selectedIds.includes(row.id));
  const groupById = useMemo(() => new Map(data.groups.map((group) => [group.id, group])), [data.groups]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const columns: Array<Column<FormRecord>> = [
    { key: "title", header: "名称/摘要", width: "165px", sortable: true, render: (row) => <strong>{row.title}</strong>, sortValue: (row) => row.title },
    { key: "amount", header: "金额", width: "105px", align: "right", sortable: true, render: (row) => formatMoney(row.amount, hidden), sortValue: (row) => row.amount },
    { key: "purchaseDate", header: "购买日期", width: "116px", sortable: true, render: (row) => displayPurchaseDate(row), sortValue: displayPurchaseDate },
    { key: "issueDate", header: "开票日期", width: "116px", sortable: true, render: (row) => row.issueDate || "-", sortValue: (row) => row.issueDate || "" },
    { key: "group", header: "分组", width: "118px", render: (row) => <GroupBadge color={row.groupId ? groupById.get(row.groupId)?.color : undefined} name={row.groupName} /> },
    { key: "status", header: "状态", width: "88px", render: (row) => <StatusPill value={row.status} tone={statusTone(row.status)} /> },
    { key: "member", header: "人员", width: "92px", render: (row) => <MemberTag name={displayMemberName(row, memberById, groupById)} id={row.memberId ?? row.groupId ?? row.id} /> },
    { key: "remark", header: "备注", width: "132px", render: (row) => <span className="cell-ellipsis" title={row.remark}>{shortenText(row.remark, 12)}</span> },
    { key: "updated", header: "更新时间", width: "160px", sortable: true, render: (row) => row.updatedAt, sortValue: (row) => sortTimestamp(row.updatedAt) },
  ];

  function toggleSelected(key: string | number) {
    const id = Number(key);
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  function showSuccessToast(message: string) {
    setSuccessToast(message);
    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = window.setTimeout(() => setSuccessToast(""), 2600);
  }

  function toggleAllFilteredRows() {
    const visibleIds = filteredRows.map((row) => row.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  }

  function selectSingleRow(row: FormRecord) {
    setSelectedIds([row.id]);
  }

  function toggleMultiSelect() {
    setMultiSelect((enabled) => {
      if (enabled) {
        setSelectedIds((current) => current.slice(0, 1));
      }
      return !enabled;
    });
  }

  function resetFilters() {
    setKeyword("");
    setGroupId("全部");
    setStatus("全部");
    setSelectedIds([]);
  }

  function handleExport() {
    const rows = selectedRows.length ? selectedRows : filteredRows;
    const csv = [
      "名称,票号,票种,金额,购买日期,开票日期,分组,状态,人员,备注",
      ...rows.map((row) => [row.title, row.invoiceNumber, row.invoiceKind, row.amount, displayPurchaseDate(row), row.issueDate, row.groupName, row.status, displayMemberName(row, memberById, groupById), row.remark].map(csvCell).join(",")),
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ivic-forms.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function handleSubmitBatch() {
    const validationMessage = validateBatchSubmission(selectedRows, data.batches, data.groups, data.attachments);
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }
    setSubmitDialogOpen(true);
  }

  function handleDeleteSelected() {
    const ids = selectedRows.map((row) => row.id);
    if (!ids.length) {
      return;
    }
    const batchDeletionBlocker = buildBatchDeletionBlocker(selectedRows, data.batches);
    if (batchDeletionBlocker) {
      setDeleteError(batchDeletionBlocker);
      return;
    }
    void persist(ivicService.deleteForms(ids), "已删除选中的表单记录").then(() => setSelectedIds([]));
  }

  async function saveMatchedRecords(matches: MatchCommit[]) {
    return ivicService.saveMatchedForms(matches);
  }

  function openImport(mode: "single" | "batch") {
    setImportDirty(false);
    setPendingClose(null);
    setImportMode(mode);
  }

  function openEditor(row: FormRecord) {
    setEditDirty(false);
    setPendingClose(null);
    setEditingRow(row);
  }

  function closeImportModal() {
    setImportMode(null);
    setImportDirty(false);
    setPendingClose(null);
  }

  function closeEditModal() {
    setEditingRow(null);
    setEditDirty(false);
    setPendingClose(null);
  }

  function requestModalClose(target: ModalCloseTarget) {
    const dirty = target === "import" ? importDirty : editDirty;
    if (dirty) {
      setPendingClose(target);
      return;
    }
    if (target === "import") {
      closeImportModal();
      return;
    }
    closeEditModal();
  }

  function confirmDiscardChanges() {
    if (pendingClose === "import") {
      closeImportModal();
      return;
    }
    if (pendingClose === "edit") {
      closeEditModal();
    }
  }

  const noSelection = selectedRows.length === 0;
  const notSingle = selectedRows.length !== 1;
  const editingAttachments = editingRow ? data.attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === editingRow.id) : [];

  return (
    <div className="page-grid with-detail">
      <section className="work-panel main-table-panel">
        <div className="toolbar form-toolbar">
          <div className="toolbar-section filter-section" aria-label="搜索筛选">
            <div className="filter-search-row">
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索名称、票号、分组、备注" />
            </div>
            <div className="filter-control-row">
              <label className="filter-field">
                <span>分组</span>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  <option>全部</option>
                  {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label className="filter-field">
                <span>状态</span>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option>全部</option>
                  {invoiceStatusOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <Button icon={<RotateCcw size={16} />} onClick={resetFilters}>重置</Button>
            </div>
          </div>
          <div className="toolbar-section action-section" aria-label="执行操作">
            <Button icon={<Upload size={16} />} variant="primary" onClick={() => openImport("single")}>导入</Button>
            <Button icon={<FilePlus2 size={16} />} onClick={() => openImport("batch")}>批量导入</Button>
            <Button icon={<CheckSquare2 size={16} />} variant={multiSelect ? "primary" : "secondary"} onClick={toggleMultiSelect}>多选</Button>
            <Button icon={<GitCompareArrows size={16} />} variant={matchMode ? "primary" : "secondary"} onClick={() => setMatchMode(!matchMode)}>匹配</Button>
            <Button icon={<FileDown size={16} />} disabled={noSelection} onClick={handleExport}>导出</Button>
            <Button icon={<PackagePlus size={16} />} disabled={noSelection} onClick={handleSubmitBatch}>提交</Button>
            <Button icon={<Edit3 size={16} />} disabled={notSingle || matchMode} onClick={() => openEditor(selectedRows[0])}>编辑</Button>
            <Button icon={<Trash2 size={16} />} disabled={noSelection || matchMode} variant="danger" onClick={handleDeleteSelected}>删除</Button>
          </div>
        </div>

        {matchMode ? (
          <MatchMode
            data={data}
            hidden={hidden}
            onCancel={() => setMatchMode(false)}
            onComplete={(matches) => persist(saveMatchedRecords(matches), "匹配结果已保存")}
          />
        ) : (
          <DataTable
            rows={filteredRows}
            columns={columns}
            rowKey={(row) => row.id}
            className="forms-data-table"
            selectedKeys={selectedIds}
            showSelectionColumn={multiSelect}
            allRowsSelected={filteredRows.length > 0 && filteredRows.every((row) => selectedIds.includes(row.id))}
            onToggleAllRows={multiSelect ? toggleAllFilteredRows : undefined}
            onToggleRow={multiSelect ? toggleSelected : undefined}
            onSelectRow={multiSelect ? (row) => toggleSelected(row.id) : selectSingleRow}
            onRowDoubleClick={openEditor}
            emptyText="没有符合条件的表单记录"
          />
        )}
      </section>

      <aside className="detail-panel">
        <span className="section-kicker">当前选择</span>
        <h3>{selectedRows.length === 1 ? selectedRows[0].title : `${selectedRows.length} 条记录`}</h3>
        {selectedRows.length === 1 ? (
          <div className="detail-list">
            <span>票号 <strong>{selectedRows[0].invoiceNumber || "待补"}</strong></span>
            <span>票种 <strong>{selectedRows[0].invoiceKind || "未识别"}</strong></span>
            <span>金额 <strong>{formatMoney(selectedRows[0].amount, hidden)}</strong></span>
            <span>购买日期 <strong>{displayPurchaseDate(selectedRows[0]) || "待补"}</strong></span>
            <span>开票日期 <strong>{selectedRows[0].issueDate || "待发票识别"}</strong></span>
            <span>人员 <strong>{displayMemberName(selectedRows[0], memberById, groupById) || "未设置"}</strong></span>
            <span>销售方 <strong>{selectedRows[0].sellerName}</strong></span>
            <span>购买方 <strong>{selectedRows[0].buyerName}</strong></span>
            <span>附件 <strong>{selectedRows[0].attachmentCount} 份</strong></span>
          </div>
        ) : (
          <p>选择单条记录可查看附件、状态和字段详情；多选后可导出、提交或删除。</p>
        )}
      </aside>

      {importMode && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestModalClose("import");
            }
          }}
          role="presentation"
        >
          <ImportDialogs
            existingForms={data.forms}
            groups={data.groups}
            members={members}
            initialTab={importMode}
            onClose={() => requestModalClose("import")}
            onCreateForm={(record, attachments = []) =>
              persist(
                attachments.length ? ivicService.saveFormWithAttachments(record, attachments) : ivicService.saveForm(record),
                "导入记录已写入表单",
              )
            }
            onCreateForms={(items) =>
              persist(
                ivicService.saveFormsWithAttachments(items),
                "批量导入记录已写入表单",
              )
            }
            onDirtyChange={setImportDirty}
            onSaved={closeImportModal}
          />
        </div>
      )}
      {editingRow && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestModalClose("edit");
            }
          }}
          role="presentation"
        >
          <ImportDialogs
            existingForms={data.forms}
            groups={data.groups}
            members={members}
            initialTab="single"
            initialRecord={editingRow}
            initialAttachments={editingAttachments}
            statusBatches={data.batches}
            onClose={() => requestModalClose("edit")}
            onCreateForm={(record, attachments = []) =>
              persist(
                attachments.length ? ivicService.saveFormWithAttachments(record, attachments) : ivicService.saveForm(record),
                "表单修改已保存",
              )
            }
            onDirtyChange={setEditDirty}
            onSaved={closeEditModal}
          />
        </div>
      )}
      {submitDialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSubmitDialogOpen(false);
            }
          }}
          role="presentation"
        >
          <SubmitBatchDialog
            existingBatches={data.batches}
            group={selectedRows[0]?.groupId ? groupById.get(selectedRows[0].groupId) : undefined}
            hidden={hidden}
            rows={selectedRows}
            onClose={() => setSubmitDialogOpen(false)}
            onSubmit={(batch) => {
              void persist(ivicService.saveBatch(batch), "已根据选中表单创建提交批次").then(() => {
                setSubmitDialogOpen(false);
                setSelectedIds([]);
                showSuccessToast("提交批次已创建。");
              });
            }}
          />
        </div>
      )}
      {successToast && <div className="form-toast success">{successToast}</div>}
      {submitError && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <section aria-modal="true" className="modal-card submit-error-modal" role="alertdialog">
            <h3>暂不能提交</h3>
            <p>{submitError}</p>
            <div className="modal-actions">
              <Button onClick={() => setSubmitError("")} variant="primary">知道了</Button>
            </div>
          </section>
        </div>
      )}
      {deleteError && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <section aria-modal="true" className="modal-card submit-error-modal" role="alertdialog">
            <h3>暂不能删除</h3>
            <p>{deleteError}</p>
            <div className="modal-actions">
              <Button onClick={() => setDeleteError("")} variant="primary">知道了</Button>
            </div>
          </section>
        </div>
      )}
      {pendingClose && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <section aria-modal="true" className="modal-card discard-confirm-modal" role="dialog">
            <h3>放弃未保存修改？</h3>
            <p>当前弹窗里有尚未保存的编辑内容，直接退出会丢失这些修改。</p>
            <div className="modal-actions">
              <Button onClick={() => setPendingClose(null)}>继续编辑</Button>
              <Button onClick={confirmDiscardChanges} variant="danger">不保存退出</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function buildBatchDeletionBlocker(rows: FormRecord[], batches: AppData["batches"]) {
  const blocked = rows.flatMap((row) => {
    const batch = batches.find((item) => item.items.some((batchItem) => batchItem.formId === row.id));
    return batch ? [`${row.title}（${batch.no}）`] : [];
  });
  if (!blocked.length) {
    return "";
  }
  const visible = blocked.slice(0, 3).join("、");
  const suffix = blocked.length > 3 ? ` 等 ${blocked.length} 条` : "";
  return `${visible}${suffix} 已在报销批次中。请先删除对应报销批次，再删除订单。`;
}

function shortenText(text: string, maxLength: number) {
  if (!text) {
    return "-";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}......` : text;
}

function displayPurchaseDate(row: FormRecord) {
  return row.purchaseDate || row.issueDate || "";
}

function sortTimestamp(value: string) {
  const parsed = Date.parse(value.replace(/-/g, "/"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function displayMemberName(row: FormRecord, memberById: Map<number, AppData["members"][number]>, groupById: Map<number, AppData["groups"][number]>) {
  if (row.memberId && memberById.has(row.memberId)) {
    return memberById.get(row.memberId)!.name;
  }
  if (row.memberName) {
    return row.memberName;
  }
  if (row.groupId && groupById.has(row.groupId)) {
    return groupById.get(row.groupId)!.ownerName;
  }
  return "";
}

function MemberTag({ id, name }: { id: number; name: string }) {
  if (!name) {
    return <span className="member-tag empty">未设</span>;
  }
  const hue = Math.abs(Number(id) * 47) % 360;
  return (
    <span
      className="member-tag"
      style={{
        "--member-bg": `hsl(${hue} 52% 92%)`,
        "--member-border": `hsl(${hue} 36% 55%)`,
        "--member-text": `hsl(${hue} 42% 28%)`,
      } as CSSProperties}
      title={name}
    >
      {name}
    </span>
  );
}

function MatchMode({
  data,
  hidden,
  onCancel,
  onComplete,
}: {
  data: AppData;
  hidden: boolean;
  onCancel: () => void;
  onComplete: (matches: MatchCommit[]) => void;
}) {
  const [orderId, setOrderId] = useState<number | null>(null);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [stagedPairs, setStagedPairs] = useState<StagedMatchPair[]>([]);
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<number | null>(null);
  const rows = useMemo(() => normalizeFormsWorkflow(data), [data]);
  const orders = rows
    .filter((form) => form.contentType === "订单" && form.status === "待开票" && !form.isMatched)
    .sort(compareFormsByAmount);
  const invoices = rows
    .filter((form) => form.contentType === "发票" && form.status === "待匹配" && !form.isMatched)
    .sort(compareFormsByAmount);
  const selectedOrder = orders.find((row) => row.id === orderId);
  const selectedInvoice = invoices.find((row) => row.id === invoiceId);
  const selectedStagedPair = stagedPairs.find((pair) => pair.orderId === orderId && pair.invoiceId === invoiceId);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }

  function buildMatchedOrder(order: FormRecord, invoice: FormRecord): FormRecord {
    const now = new Date().toLocaleString("zh-CN", { hour12: false });
    return {
      ...order,
      invoiceNumber: invoice.invoiceNumber,
      invoiceKind: invoice.invoiceKind,
      taxAmount: invoice.taxAmount || order.taxAmount,
      issueDate: invoice.issueDate || order.issueDate,
      memberId: order.memberId ?? invoice.memberId ?? null,
      memberName: order.memberName || invoice.memberName || "",
      contentType: "订单+发票",
      hasInvoice: true,
      isMatched: true,
      invoiceConfirmed: invoice.invoiceConfirmed,
      status: "待提交",
      sellerName: invoice.sellerName || order.sellerName,
      sellerTaxNo: invoice.sellerTaxNo || order.sellerTaxNo,
      buyerName: invoice.buyerName || order.buyerName,
      buyerTaxNo: invoice.buyerTaxNo || order.buyerTaxNo,
      invoiceItemName: invoice.invoiceItemName || order.invoiceItemName,
      invoiceRemark: invoice.invoiceRemark || order.invoiceRemark,
      itemSpecModel: invoice.itemSpecModel || order.itemSpecModel,
      itemUnit: invoice.itemUnit || order.itemUnit,
      itemQuantity: invoice.itemQuantity ?? order.itemQuantity,
      attachmentCount: order.attachmentCount + invoice.attachmentCount,
      remark: order.remark,
      updatedAt: now,
    };
  }

  function stageMatch() {
    if (!selectedOrder || !selectedInvoice) {
      return;
    }
    if (Math.abs(selectedOrder.amount - selectedInvoice.amount) > 0.01) {
      showToast(`订单金额 ${formatMoney(selectedOrder.amount, hidden)} 与发票金额 ${formatMoney(selectedInvoice.amount, hidden)} 不一致。`);
      return;
    }
    if (selectedOrder.groupId !== selectedInvoice.groupId) {
      showToast("订单和发票分组不同，不能匹配。");
      return;
    }
    setStagedPairs((current) => {
      const remaining = current.filter((pair) => pair.orderId !== selectedOrder.id && pair.invoiceId !== selectedInvoice.id);
      return [
        ...remaining,
        { orderId: selectedOrder.id, invoiceId: selectedInvoice.id, tone: nextMatchTone(remaining) },
      ];
    });
    showToast("已暂存匹配，点击完成匹配后保存。");
  }

  function unstageMatch() {
    if (!selectedStagedPair) {
      return;
    }
    setStagedPairs((current) => current.filter((pair) => pair !== selectedStagedPair));
  }

  function finishMatches() {
    const matches = stagedPairs.flatMap((pair) => {
      const order = orders.find((row) => row.id === pair.orderId);
      const invoice = invoices.find((row) => row.id === pair.invoiceId);
      return order && invoice ? [{ order, invoice, matchedOrder: buildMatchedOrder(order, invoice) }] : [];
    });
    if (!matches.length) {
      return;
    }
    onComplete(matches);
    onCancel();
  }

  function pairForRow(row: FormRecord) {
    return stagedPairs.find((pair) => pair.orderId === row.id || pair.invoiceId === row.id);
  }

  function rowClassName(row: FormRecord, selected: boolean) {
    const pair = pairForRow(row);
    return [
      selected ? "selected-temp" : "",
      row.contentType === "订单+发票" || row.isMatched || pair ? "matched-temp" : "",
    ].filter(Boolean).join(" ");
  }

  function rowStyle(row: FormRecord): CSSProperties | undefined {
    const pair = pairForRow(row);
    return pair ? matchToneStyle(pair.tone) : undefined;
  }

  return (
    <div className="match-workbench">
      {toast && <div className="match-toast">{toast}</div>}
      <div className="match-table">
        <h3>待开票订单</h3>
        {orders.map((row) => (
          <button key={row.id} className={rowClassName(row, row.id === orderId)} style={rowStyle(row)} onClick={() => setOrderId(row.id)} type="button">
            {row.title}<span>{formatMoney(row.amount, hidden)}</span>
          </button>
        ))}
      </div>
      <div className="match-controls">
        <Button variant="primary" disabled={!selectedOrder || !selectedInvoice} onClick={stageMatch}>Match</Button>
        <Button disabled={!selectedStagedPair} onClick={unstageMatch}>Unmatch</Button>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="primary" disabled={!stagedPairs.length} onClick={finishMatches}>完成匹配</Button>
      </div>
      <div className="match-table">
        <h3>待匹配发票</h3>
        {invoices.map((row) => (
          <button key={row.id} className={rowClassName(row, row.id === invoiceId)} style={rowStyle(row)} onClick={() => setInvoiceId(row.id)} type="button">
            {row.title}<span>{row.invoiceNumber || "无票号"} · {formatMoney(row.amount, hidden)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function nextMatchTone(pairs: StagedMatchPair[]) {
  const used = new Set(pairs.map((pair) => pair.tone));
  for (let index = 0; index < 64; index += 1) {
    if (!used.has(index)) {
      return index;
    }
  }
  return pairs.length;
}

function matchToneStyle(tone: number): CSSProperties {
  const hue = Math.round((tone * 137.508 + 142) % 360);
  return {
    "--match-bg": `hsl(${hue} 34% 90%)`,
    "--match-border": `hsl(${hue} 34% 42%)`,
    "--match-text": `hsl(${hue} 38% 24%)`,
  } as CSSProperties;
}

function compareFormsByAmount(left: FormRecord, right: FormRecord) {
  const amountDiff = left.amount - right.amount;
  if (Math.abs(amountDiff) > 0.001) {
    return amountDiff;
  }
  const dateDiff = displayPurchaseDate(left).localeCompare(displayPurchaseDate(right));
  return dateDiff || left.title.localeCompare(right.title, "zh-CN");
}
