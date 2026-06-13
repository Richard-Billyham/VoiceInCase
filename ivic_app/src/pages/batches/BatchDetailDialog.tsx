import { RefreshCcw, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { GroupBadge } from "../../components/ui/GroupBadge";
import { StatusPill } from "../../components/ui/StatusPill";
import type { BatchStatus, ExpenseGroup, FormRecord, InvoiceStatus, ReimbursementBatch } from "../../types/domain";
import { formatMoney, statusTone } from "../../utils/format";
import { invoiceStatusOptions } from "../../utils/workflowRules";
import { appendBatchItemStatusEvent, appendBatchStatusEvent, batchStatusOptions, nowTimestamp } from "./batchUtils";
import { buildQuickSubmitCopySections, buildQuickSubmitText } from "./quickSubmitText";
import { QuickCopyText } from "./QuickCopyText";

interface BatchDetailDialogProps {
  batch: ReimbursementBatch;
  forms: FormRecord[];
  groups: ExpenseGroup[];
  hidden: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: (batch: ReimbursementBatch) => void;
}

export function BatchDetailDialog({ batch, forms, groups, hidden, onClose, onDelete, onSave }: BatchDetailDialogProps) {
  const [draft, setDraft] = useState(() => cloneBatch(batch));
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const selectedGroup = draft.groupId ? groupById.get(draft.groupId) : undefined;

  useEffect(() => {
    setDraft(cloneBatch(batch));
  }, [batch]);

  function patchBatch(patch: Partial<ReimbursementBatch>) {
    setDraft((current) => ({
      ...current,
      ...patch,
      updatedTime: nowTimestamp(),
    }));
  }

  function updateStatus(status: BatchStatus) {
    setDraft((current) => appendBatchStatusEvent(current, status, `批次状态由“${current.status}”改为“${status}”`));
  }

  function patchItem(itemId: number, patch: Partial<ReimbursementBatch["items"][number]>) {
    setDraft((current) => {
      const currentItem = current.items.find((item) => item.id === itemId);
      const nextItems = current.items.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        const next = { ...item, ...patch };
        if (patch.status === "已到账") {
          return { ...next, reconciledAmount: next.amount };
        }
        if (patch.status) {
          return { ...next, reconciledAmount: 0 };
        }
        return next;
      });
      if (typeof patch.status === "string") {
        return appendBatchItemStatusEvent(
          current,
          currentItem?.title ?? "未命名子订单",
          currentItem?.status ?? "待提交",
          patch.status,
          nextItems,
        );
      }
      return {
        ...current,
        updatedTime: nowTimestamp(),
        items: nextItems,
      };
    });
  }

  function regenerateQuickText() {
    patchBatch({ quickSubmitText: buildQuickSubmitText(draft, selectedGroup, hidden, forms) });
  }

  return (
    <section aria-modal="true" className="modal-card batch-detail-modal" role="dialog">
      <div className="batch-detail-header">
        <div>
          <span className="section-kicker">提交批次</span>
          <h3>{draft.no}</h3>
        </div>
        <div className="batch-detail-title-actions">
          <StatusPill value={draft.status} tone={statusTone(draft.status)} />
          <Button icon={<Trash2 size={16} />} onClick={onDelete} variant="danger">删除批次</Button>
          <Button icon={<X size={16} />} onClick={onClose}>关闭</Button>
        </div>
      </div>

      <div className="batch-detail-layout">
        <div className="batch-detail-main">
          <div className="batch-edit-grid">
            <label>
              <span>批次号</span>
              <input value={draft.no} onChange={(event) => patchBatch({ no: event.target.value })} />
            </label>
            <label>
              <span>分组</span>
              <strong className="readonly-time">{draft.groupName || "未分组"}</strong>
            </label>
            <label>
              <span>批次状态</span>
              <select value={draft.status} onChange={(event) => updateStatus(event.target.value as BatchStatus)}>
                {batchStatusOptions.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>
              <span>总金额</span>
              <strong className="readonly-time">{formatMoney(draft.totalAmount, hidden)}</strong>
            </label>
            <label>
              <span>提交时间</span>
              <strong className="readonly-time">{draft.applyTime}</strong>
            </label>
            <label>
              <span>修改时间</span>
              <strong className="readonly-time">{draft.updatedTime}</strong>
            </label>
            <label className="wide">
              <span>备注</span>
              <textarea value={draft.remark} onChange={(event) => patchBatch({ remark: event.target.value })} />
            </label>
          </div>

          <div className="batch-child-table">
            <div className="batch-child-head">
              <strong>批次内订单</strong>
              <GroupBadge color={selectedGroup?.color} name={draft.groupName || "未分组"} />
            </div>
            {draft.items.map((item) => (
              <div key={item.id} className="batch-child-row">
                <span title={item.title}>{item.title}</span>
                <strong>{formatMoney(item.amount, hidden)}</strong>
                <select value={item.status} onChange={(event) => patchItem(item.id, { status: event.target.value as InvoiceStatus })}>
                  {invoiceStatusOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
                <input value={item.remark} onChange={(event) => patchItem(item.id, { remark: event.target.value })} placeholder="备注" />
              </div>
            ))}
          </div>

          <div className="batch-timeline">
            <strong>流程时间线</strong>
            {draft.statusTimeline.map((event, index) => (
              <span key={`${event.status}-${event.timestamp}-${index}`}>
                <b>{event.status}</b>
                <small>{event.timestamp}</small>
                <em>{event.remark}</em>
              </span>
            ))}
          </div>
        </div>

        <aside className="batch-quick-panel">
          <div className="batch-quick-title">
            <strong>快速复制文本</strong>
            <div>
              <Button icon={<RefreshCcw size={15} />} onClick={regenerateQuickText}>重生成</Button>
            </div>
          </div>
          <QuickCopyText sections={buildQuickSubmitCopySections(draft, selectedGroup, hidden, forms)} />
        </aside>
      </div>

      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button icon={<Save size={16} />} onClick={() => onSave({ ...draft, totalAmount: draft.items.reduce((sum, item) => sum + item.amount, 0) })} variant="primary">
          保存批次
        </Button>
      </div>
    </section>
  );
}

function cloneBatch(batch: ReimbursementBatch) {
  return {
    ...batch,
    statusTimeline: batch.statusTimeline.map((event) => ({ ...event })),
    items: batch.items.map((item) => ({ ...item })),
  };
}
