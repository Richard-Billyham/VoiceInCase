import { ChevronRight, Edit3, FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { GroupBadge } from "../../components/ui/GroupBadge";
import { StatusPill } from "../../components/ui/StatusPill";
import { ivicService } from "../../services/ivicService";
import type { AppData } from "../../types/domain";
import { formatMoney, statusTone } from "../../utils/format";
import { batchStatusDisplay, failedBatchItemCount, normalizeBatchTimeline, releasedBatchItemCount } from "./batchUtils";
import { BatchDetailDialog } from "./BatchDetailDialog";
import { buildQuickSubmitCopySections } from "./quickSubmitText";
import { QuickCopyText } from "./QuickCopyText";

interface BatchesPageProps {
  data: AppData;
  persist: (action: Promise<AppData>, message: string) => Promise<void>;
}

export function BatchesPage({ data, persist }: BatchesPageProps) {
  const [expandedIds, setExpandedIds] = useState<number[]>([data.batches[0]?.id ?? 0]);
  const [activeId, setActiveId] = useState(data.batches[0]?.id ?? 0);
  const [keyword, setKeyword] = useState("");
  const [editingBatchId, setEditingBatchId] = useState<number | null>(null);
  const hidden = data.settings.hideAmounts;
  const groupById = new Map(data.groups.map((group) => [group.id, group]));
  const batches = data.batches.map(normalizeBatchTimeline);
  const activeBatch = batches.find((batch) => batch.id === activeId) ?? batches[0];
  const activeGroup = activeBatch?.groupId ? groupById.get(activeBatch.groupId) : undefined;
  const editingBatch = editingBatchId ? batches.find((batch) => batch.id === editingBatchId) : null;
  const filteredBatches = batches.filter((batch) => {
    const needle = keyword.trim().toLowerCase();
    return !needle || [batch.no, batch.groupName, batch.status, batchStatusDisplay(batch), batch.remark].join(" ").toLowerCase().includes(needle);
  });

  function toggleExpanded(id: number) {
    setExpandedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function exportBatches() {
    const csv = ["批次号,分组,金额,状态,失败子订单数,已退回子订单数,申请时间,备注", ...batches.map((batch) => [batch.no, batch.groupName, batch.totalAmount, batchStatusDisplay(batch), failedBatchItemCount(batch), releasedBatchItemCount(batch), batch.applyTime, batch.remark].join(","))].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ivic-batches.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function deleteBatchById(id: number) {
    if (!id) {
      return;
    }
    const nextActiveId = data.batches.find((batch) => batch.id !== id)?.id ?? 0;
    void persist(ivicService.deleteBatch(id), "批次已删除，订单已回退为待提交").then(() => {
      setEditingBatchId(null);
      setActiveId(nextActiveId);
    });
  }

  return (
    <div className="page-grid with-detail">
      <section className="work-panel">
        <div className="toolbar">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索批次号、分组、备注" />
          <Button icon={<FileText size={16} />} onClick={exportBatches}>导出</Button>
          <Button icon={<Edit3 size={16} />} disabled={!activeBatch} onClick={() => activeBatch && setEditingBatchId(activeBatch.id)}>编辑</Button>
          <Button icon={<Trash2 size={16} />} disabled={!activeBatch} onClick={() => activeBatch && deleteBatchById(activeBatch.id)} variant="danger">删除</Button>
        </div>
        <div className="batch-list">
          {filteredBatches.map((batch) => (
            <article key={batch.id} className={batch.id === activeId ? "batch-card active" : "batch-card"} onDoubleClick={() => setEditingBatchId(batch.id)}>
              <button className="batch-main-row" onClick={() => setActiveId(batch.id)} type="button">
                <ChevronRight className={expandedIds.includes(batch.id) ? "expanded" : ""} onClick={(event) => { event.stopPropagation(); toggleExpanded(batch.id); }} size={20} />
                <strong>{batch.no}</strong>
                <GroupBadge color={batch.groupId ? groupById.get(batch.groupId)?.color : undefined} name={batch.groupName} />
                <span>{formatMoney(batch.totalAmount, hidden)}</span>
                <StatusPill value={batchStatusDisplay(batch)} tone={statusTone(batch.status)} />
              </button>
              {expandedIds.includes(batch.id) && (
                <div className="batch-items">
                  {batch.items.map((item) => (
                    <div key={item.id} className={item.isReleased ? "released" : undefined}>
                      <span>{item.title}</span>
                      <span>{formatMoney(item.amount, hidden)}</span>
                      <StatusPill value={item.isReleased ? "已退回" : item.status} tone={item.isReleased ? "neutral" : statusTone(item.status)} />
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      <aside className="detail-panel">
        <span className="section-kicker">批次详情</span>
        <h3>{activeBatch?.no ?? "暂无批次"}</h3>
        {activeBatch && (
          <>
            <div className="detail-list">
              <span>分组 <strong>{activeBatch.groupName}</strong></span>
              <span>申请时间 <strong>{activeBatch.applyTime}</strong></span>
              <span>修改时间 <strong>{activeBatch.updatedTime}</strong></span>
              {activeBatch.completedTime && <span>完成时间 <strong>{activeBatch.completedTime}</strong></span>}
              <span>总金额 <strong>{formatMoney(activeBatch.totalAmount, hidden)}</strong></span>
              <span>子订单 <strong>{activeBatch.items.filter((item) => !item.isReleased).length} 条</strong></span>
              {failedBatchItemCount(activeBatch) > 0 && <span>失败项 <strong>{failedBatchItemCount(activeBatch)} 条</strong></span>}
              {releasedBatchItemCount(activeBatch) > 0 && <span>已退回 <strong>{releasedBatchItemCount(activeBatch)} 条</strong></span>}
            </div>
            <label className="quick-submit">
              <span>快速复制文本</span>
              <QuickCopyText sections={buildQuickSubmitCopySections(activeBatch, activeGroup, hidden, data.forms)} />
            </label>
            <div className="batch-timeline">
              <strong>流程时间线</strong>
              {activeBatch.statusTimeline.map((event, index) => (
                <span key={`${event.status}-${event.timestamp}-${index}`}>
                  <b>{event.status}</b>
                  <small>{event.timestamp}</small>
                  <em>{event.remark}</em>
                </span>
              ))}
            </div>
          </>
        )}
      </aside>
      {editingBatch && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingBatchId(null);
            }
          }}
          role="presentation"
        >
          <BatchDetailDialog
            batch={editingBatch}
            forms={data.forms}
            groups={data.groups}
            hidden={hidden}
            onClose={() => setEditingBatchId(null)}
            onDelete={() => deleteBatchById(editingBatch.id)}
            onReleaseItem={(itemId, targetStatus) =>
              persist(ivicService.releaseBatchItemForRetry(editingBatch.id, itemId, targetStatus), "子订单已退回修改，可在订单页面补充后重新提交").then(() => {
                setEditingBatchId(null);
              })
            }
            onSave={(batch) => {
              void persist(ivicService.saveBatch(batch), "批次详情已保存").then(() => {
                setActiveId(batch.id);
                setEditingBatchId(null);
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
