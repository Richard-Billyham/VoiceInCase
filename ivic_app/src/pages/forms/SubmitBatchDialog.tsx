import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { GroupBadge } from "../../components/ui/GroupBadge";
import type { BatchStatus, ExpenseGroup, FormRecord, ReimbursementBatch } from "../../types/domain";
import { formatMoney } from "../../utils/format";
import { batchStatusOptions, buildSubmissionBatch, nowTimestamp } from "../batches/batchUtils";
import { buildQuickSubmitText } from "../batches/quickSubmitText";

interface SubmitBatchDialogProps {
  existingBatches?: ReimbursementBatch[];
  group?: ExpenseGroup;
  hidden: boolean;
  onClose: () => void;
  onSubmit: (batch: ReimbursementBatch) => void;
  rows: FormRecord[];
}

export function SubmitBatchDialog({ existingBatches = [], group, hidden, onClose, onSubmit, rows }: SubmitBatchDialogProps) {
  const initialTime = useMemo(() => nowTimestamp(), []);
  const [no, setNo] = useState(() => `RB-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`);
  const [status, setStatus] = useState<BatchStatus>("待提交");
  const [updatedTime, setUpdatedTime] = useState(initialTime);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  function submit() {
    const trimmedNo = no.trim();
    if (!trimmedNo) {
      setError("请填写批次号。");
      return;
    }
    if (existingBatches.some((batch) => batch.no === trimmedNo)) {
      setError(`批次号 ${trimmedNo} 已存在，请换一个批次号。`);
      return;
    }
    setError("");
    const draftBatch = buildSubmissionBatch({ applyTime: initialTime, no: trimmedNo, quickSubmitText: "", remark, rows, status, updatedTime });
    onSubmit({ ...draftBatch, quickSubmitText: buildQuickSubmitText(draftBatch, group, hidden, rows) });
  }

  return (
    <section aria-modal="true" className="modal-card submit-batch-modal" role="dialog">
      <div className="submit-batch-header">
        <div>
          <span className="section-kicker">提交批次</span>
          <h3>确认批次信息</h3>
        </div>
        <GroupBadge color={group?.color} name={rows[0]?.groupName || "未分组"} />
      </div>

      <div className="submit-batch-summary">
        <span>表单 <strong>{rows.length} 条</strong></span>
        <span>总金额 <strong>{formatMoney(total, hidden)}</strong></span>
        <span>类型 <strong>订单+发票</strong></span>
      </div>

      {error && (
        <div className="import-error">
          <span>{error}</span>
        </div>
      )}

      <div className="submit-batch-grid">
        <label>
          <span>批次号</span>
          <input value={no} onChange={(event) => setNo(event.target.value)} />
        </label>
        <label>
          <span>状态</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as BatchStatus);
              setUpdatedTime(nowTimestamp());
            }}
          >
            {batchStatusOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span>提交时间</span>
          <strong className="readonly-time">{initialTime}</strong>
        </label>
        <label>
          <span>修改时间</span>
          <strong className="readonly-time">{updatedTime}</strong>
        </label>
        <label className="wide">
          <span>批次备注</span>
          <textarea value={remark} onChange={(event) => setRemark(event.target.value)} />
        </label>
      </div>

      <div className="submit-batch-items">
        {rows.map((row) => (
          <div key={row.id}>
            <span>{row.title}</span>
            <strong>{formatMoney(row.amount, hidden)}</strong>
          </div>
        ))}
        <div className="submit-batch-total">
          <span>总金额</span>
          <strong>{formatMoney(total, hidden)}</strong>
        </div>
      </div>

      <div className="modal-actions">
        <Button onClick={onClose}>取消</Button>
        <Button onClick={submit} variant="primary">创建批次</Button>
      </div>
    </section>
  );
}
