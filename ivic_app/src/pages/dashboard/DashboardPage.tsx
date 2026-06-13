import { AlertTriangle, ArrowRight, BarChart3, Bell, CheckCircle2, FileText, Search, Upload } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import type { AppData, AppRoute, FormRecord, Id } from "../../types/domain";
import { StatusPill } from "../../components/ui/StatusPill";
import { formatMoney, statusTone } from "../../utils/format";
import { normalizeFormsWorkflow } from "../../utils/workflowRules";

interface DashboardPageProps {
  data: AppData;
  globalSearch: string;
  onNavigate: (route: AppRoute) => void;
}

type GroupScope = "all" | Id;
type DashboardReminderKind = "invoice" | "submit";

interface DashboardReminder {
  form: FormRecord;
  kind: DashboardReminderKind;
  days: number;
  priority: number;
}

export function DashboardPage({ data, globalSearch, onNavigate }: DashboardPageProps) {
  const [activeGroupId, setActiveGroupId] = useState<GroupScope>("all");
  const hidden = data.settings.hideAmounts;
  const activeGroup = activeGroupId === "all" ? null : data.groups.find((group) => group.id === activeGroupId) ?? null;
  const visibleGroups = data.groups.filter((group) => group.isActive);
  const formRows = useMemo(() => normalizeFormsWorkflow(data), [data]);

  const scopedForms = useMemo(
    () => filterFormsByGroup(formRows, activeGroupId),
    [activeGroupId, formRows],
  );
  const scopedBatches = useMemo(
    () => data.batches.filter((batch) => activeGroupId === "all" || batch.groupId === activeGroupId),
    [activeGroupId, data.batches],
  );

  const reminders = useMemo(() => buildDashboardReminders(scopedForms), [scopedForms]);
  const searchNeedle = globalSearch.trim().toLowerCase();
  const searchResults = searchNeedle
    ? scopedForms.filter((form) => [form.title, form.invoiceNumber, form.groupName, form.remark].join(" ").toLowerCase().includes(searchNeedle))
    : [];

  const statusAmounts = [
    { label: "待开票", value: sumForms(scopedForms.filter((form) => form.status === "待开票")), tone: "pending" },
    { label: "待匹配/待提交", value: sumForms(scopedForms.filter((form) => form.status === "待匹配" || form.status === "待提交" || form.status === "批次创建")), tone: "warning" },
    { label: "已提交", value: sumForms(scopedForms.filter((form) => form.status === "已提交")), tone: "progress" },
    { label: "已到账", value: sumForms(scopedForms.filter((form) => form.status === "已到账")), tone: "done" },
    { label: "报销失败", value: sumForms(scopedForms.filter((form) => form.status === "报销失败")), tone: "danger" },
  ];

  const statusCounts = [
    { label: "表单总数", value: scopedForms.length, tone: "total", icon: FileText },
    { label: "已有发票", value: scopedForms.filter((form) => form.hasInvoice).length, tone: "done", icon: CheckCircle2 },
    { label: "提交批次", value: scopedBatches.length, tone: "progress", icon: Upload },
    { label: "提醒处理", value: reminders.length, tone: "warning", icon: Bell },
  ];
  const [primaryAmount, ...secondaryAmounts] = statusAmounts;
  const chartRows = activeGroupId === "all"
    ? groupBars(data, formRows)
    : statusAmounts.map((item) => ({
      label: item.label,
      amount: item.value,
      color: statusChartColor(item.tone),
    }));
  const chartMax = Math.max(0, ...chartRows.map((item) => item.amount));

  return (
    <div className="dashboard-prototype">
      <section className="dashboard-overview-box">
        <div className="dashboard-overview-head">
          <div>
            <h2>{activeGroup?.name ?? "全部分组"}</h2>
          </div>
          <label className="group-select-box" aria-label="选择分组">
            <select value={activeGroupId} onChange={(event) => setActiveGroupId(event.target.value === "all" ? "all" : Number(event.target.value))}>
              <option value="all">全部</option>
              {visibleGroups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="dashboard-status-block amount-block">
          <div className={`status-box featured ${primaryAmount.tone}`}>
            <span className="status-label"><i aria-hidden="true" />{primaryAmount.label}</span>
            <b>{formatMoney(primaryAmount.value, hidden)}</b>
          </div>
          <div className="amount-secondary-grid">
            {secondaryAmounts.map((item) => (
              <div key={item.label} className={`status-box ${item.tone}`}>
                <span className="status-label"><i aria-hidden="true" />{item.label}</span>
                <b>{formatMoney(item.value, hidden)}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-status-block count-block">
          <div className="count-strip">
            {statusCounts.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={`count-item ${item.tone}`}>
                  <Icon size={28} />
                  <span>
                    <small>{item.label}</small>
                    <b>{item.value}</b>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="dashboard-reminder-box">
        <div className="panel-heading">
          <div>
            <h3>需要补发票或修正材料</h3>
          </div>
          <button className="link-button" type="button" onClick={() => onNavigate("forms")}>
            去表单管理 <ArrowRight size={15} />
          </button>
        </div>
        <div className="prototype-reminder-list">
          {reminders.map((reminder) => (
            <button
              key={reminder.form.id}
              className={`prototype-reminder-item ${reminder.kind}`}
              style={reminderStyle(reminder)}
              type="button"
              onClick={() => onNavigate("forms")}
            >
              <AlertTriangle size={19} />
              <b className="reminder-days">
                <strong>{reminder.days}</strong>
                <small>天</small>
              </b>
              <span>
                <strong>{reminder.form.title}</strong>
                <small>{reminder.kind === "invoice" ? `已经过了 ${reminder.days} 天，快去开票！` : `放了 ${reminder.days} 天啦，赶紧提交。`}</small>
                <em>{reminder.form.purchaseDate || "未填购买日期"} · {formatMoney(reminder.form.amount, hidden)} · {reminder.form.groupName || "未分组"}</em>
              </span>
              <StatusPill value={reminder.form.status} tone={statusTone(reminder.form.status)} />
            </button>
          ))}
          {reminders.length === 0 && <p className="empty-note">当前范围暂无开票或提交提醒。</p>}
        </div>
      </section>

      <section className="dashboard-main-display">
        {searchNeedle ? (
          <>
            <div className="panel-heading">
              <div>
                <span className="section-kicker">搜索结果</span>
                <h3>展示检索到的条目</h3>
              </div>
              <Search size={22} />
            </div>
            <div className="dashboard-search-results">
              {searchResults.map((form) => (
                <div key={form.id} className="dashboard-search-row">
                  <strong>{form.title}</strong>
                  <span>{form.issueDate} · {form.groupName} · {form.invoiceNumber || "无票号"}</span>
                  <b>{formatMoney(form.amount, hidden)}</b>
                  <StatusPill value={form.status} tone={statusTone(form.status)} />
                </div>
              ))}
              {searchResults.length === 0 && <p className="empty-note">当前分组范围内没有命中结果。</p>}
            </div>
          </>
        ) : (
          <>
            <div className="panel-heading">
              <div>
                <h3>{activeGroupId === "all" ? "分组金额和处理进度" : `${activeGroup?.name ?? "当前分组"} 状态分布`}</h3>
              </div>
              <BarChart3 size={24} />
            </div>
            <div className="dashboard-chart-area">
              {chartRows.map((item) => {
                const ratio = chartMax > 0 && item.amount > 0 ? Math.max(2, Math.round((item.amount / chartMax) * 100)) : 0;
                return (
                  <div key={item.label} className="dashboard-chart-row">
                    <span>{item.label}</span>
                    <div><i style={{ width: `${ratio}%`, background: item.color }} /></div>
                    <strong>{formatMoney(item.amount, hidden)}</strong>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function filterFormsByGroup(forms: FormRecord[], groupId: GroupScope) {
  return groupId === "all" ? forms : forms.filter((form) => form.groupId === groupId);
}

function sumForms(forms: FormRecord[]) {
  return forms.reduce((sum, form) => sum + form.amount, 0);
}

function statusChartColor(tone: string) {
  switch (tone) {
    case "pending":
      return "#9a6514";
    case "warning":
      return "#bf6b28";
    case "progress":
      return "#4f7d5a";
    case "done":
      return "#4d8cab";
    case "danger":
      return "#c75f45";
    case "total":
      return "#6d5a4d";
    default:
      return "#4f7d5a";
  }
}

function buildDashboardReminders(forms: FormRecord[]): DashboardReminder[] {
  return forms
    .flatMap((form): DashboardReminder[] => {
      if (form.status === "待开票") {
        return [{ form, kind: "invoice", days: daysSinceFormPurchase(form), priority: 0 }];
      }
      if (form.status === "待提交") {
        return [{ form, kind: "submit", days: daysSinceFormPurchase(form), priority: 1 }];
      }
      return [];
    })
    .sort((first, second) => first.priority - second.priority || second.days - first.days || second.form.amount - first.form.amount);
}

function daysSinceFormPurchase(form: FormRecord) {
  const date = parseDateOnly(form.purchaseDate) ?? parseDateOnly(form.issueDate) ?? parseDateOnly(form.updatedAt);
  if (!date) {
    return 0;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
}

function parseDateOnly(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  const normalized = text.replace(/[./]/g, "-");
  const match = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function reminderStyle(reminder: DashboardReminder) {
  const heat = Math.min(1, reminder.days / 30);
  if (reminder.kind === "invoice") {
    return {
      "--reminder-bg": mixRgb([255, 246, 244], [255, 210, 202], heat),
      "--reminder-border": mixRgb([218, 132, 112], [184, 40, 32], heat),
      "--reminder-accent": mixRgb([211, 77, 57], [147, 24, 22], heat),
      "--reminder-text": mixRgb([126, 39, 26], [88, 14, 13], heat),
    } as CSSProperties;
  }
  return {
    "--reminder-bg": mixRgb([255, 246, 232], [255, 224, 177], heat),
    "--reminder-border": mixRgb([220, 153, 76], [190, 95, 24], heat),
    "--reminder-accent": mixRgb([213, 113, 30], [164, 72, 14], heat),
    "--reminder-text": mixRgb([133, 72, 16], [94, 44, 8], heat),
  } as CSSProperties;
}

function mixRgb(from: [number, number, number], to: [number, number, number], ratio: number) {
  const [red, green, blue] = from.map((value, index) => Math.round(value + (to[index] - value) * ratio));
  return `rgb(${red} ${green} ${blue})`;
}

function groupBars(data: AppData, forms: FormRecord[]) {
  return data.groups.map((group) => ({
    label: group.name,
    amount: sumForms(forms.filter((form) => form.groupId === group.id)),
    color: group.color,
  }));
}
