import type { Attachment, ExpenseGroup, FormRecord } from "../types/domain";
import { formatMoney } from "./format";

export interface AttachmentRule {
  id: string;
  name: string;
  enabled: boolean;
  units: string[];
  includeEmptyUnit: boolean;
  minAmount: number;
  requiredAttachmentLabel: string;
  keywords: string[];
}

export interface AttachmentRuleConfig {
  kind: "ivic.attachmentRules";
  version: 1;
  rules: AttachmentRule[];
}

export interface AttachmentRuleBlocker {
  row: FormRecord;
  rule: AttachmentRule;
}

const DEFAULT_RULE_ID = "default-shopping-screenshot";

export function createDefaultAttachmentRule(): AttachmentRule {
  return {
    id: DEFAULT_RULE_ID,
    name: "购物截图",
    enabled: true,
    units: ["套", "批", "组"],
    includeEmptyUnit: true,
    minAmount: 1000,
    requiredAttachmentLabel: "购物截图",
    keywords: ["购物截图", "购物", "截图"],
  };
}

export function createAttachmentRule(): AttachmentRule {
  return {
    ...createDefaultAttachmentRule(),
    id: `attachment-rule-${Date.now()}`,
    name: "新附件规则",
  };
}

export function createDefaultAttachmentRuleConfig(): AttachmentRuleConfig {
  return {
    kind: "ivic.attachmentRules",
    version: 1,
    rules: [createDefaultAttachmentRule()],
  };
}

export function normalizeAttachmentRule(rule: Partial<AttachmentRule> | undefined): AttachmentRule {
  const fallback = createDefaultAttachmentRule();
  return {
    id: String(rule?.id || `attachment-rule-${Date.now()}`),
    name: String(rule?.name || fallback.name),
    enabled: rule?.enabled !== false,
    units: normalizeStringList(rule?.units, fallback.units),
    includeEmptyUnit: rule?.includeEmptyUnit !== false,
    minAmount: Number.isFinite(Number(rule?.minAmount)) ? Number(rule?.minAmount) : fallback.minAmount,
    requiredAttachmentLabel: String(rule?.requiredAttachmentLabel || fallback.requiredAttachmentLabel),
    keywords: normalizeStringList(rule?.keywords, fallback.keywords),
  };
}

export function parseAttachmentRuleConfig(raw?: string): AttachmentRuleConfig {
  if (!raw?.trim()) {
    return createDefaultAttachmentRuleConfig();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AttachmentRuleConfig>;
    if (!Array.isArray(parsed.rules)) {
      return createDefaultAttachmentRuleConfig();
    }
    const rules = parsed.rules.map(normalizeAttachmentRule);
    return {
      kind: "ivic.attachmentRules",
      version: 1,
      rules,
    };
  } catch {
    return createDefaultAttachmentRuleConfig();
  }
}

export function serializeAttachmentRuleConfig(config: AttachmentRuleConfig): string {
  return JSON.stringify({
    kind: "ivic.attachmentRules",
    version: 1,
    rules: config.rules.map(normalizeAttachmentRule),
  });
}

export function splitRuleText(value: string): string[] {
  return value
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function collectAttachmentRuleBlockers(
  rows: FormRecord[],
  group: ExpenseGroup | undefined,
  attachments: Attachment[],
): AttachmentRuleBlocker[] {
  if (!group) return [];
  const rules = parseAttachmentRuleConfig(group.attachmentRuleConfig).rules.filter((rule) => rule.enabled);
  if (!rules.length) return [];

  return rows.flatMap((row) =>
    rules
      .filter((rule) => matchesAttachmentRule(row, rule))
      .filter((rule) => !hasRequiredAttachment(row, rule, attachments))
      .map((rule) => ({ row, rule })),
  );
}

export function formatAttachmentRuleBlockers(blockers: AttachmentRuleBlocker[]): string {
  if (!blockers.length) return "";
  const shown = blockers.slice(0, 3);
  const detail = shown
    .map(({ row, rule }) => {
      const unit = row.itemUnit?.trim() || "无单位";
      return `「${row.title}」发票单位为${unit}，金额 ${formatMoney(row.amount)}，需要提交${rule.requiredAttachmentLabel}`;
    })
    .join("；");
  const more = blockers.length > shown.length ? `，另有 ${blockers.length - shown.length} 个订单也需要附件` : "";
  return `${detail}${more}。请先补充附件后再创建提交批次。`;
}

function matchesAttachmentRule(row: FormRecord, rule: AttachmentRule) {
  const unit = row.itemUnit?.trim() ?? "";
  const unitMatched = (!unit && rule.includeEmptyUnit) || rule.units.includes(unit);
  return unitMatched && Number(row.amount || 0) > rule.minAmount;
}

function hasRequiredAttachment(row: FormRecord, rule: AttachmentRule, attachments: Attachment[]) {
  const related = attachments.filter((attachment) => attachment.ownerType === "invoice" && attachment.ownerId === row.id);
  if (!related.length) return false;

  const keywords = rule.keywords.length ? rule.keywords : [rule.requiredAttachmentLabel].filter(Boolean);
  if (!keywords.length) return true;

  return related.some((attachment) => {
    const searchable = [attachment.fileType, attachment.fileName, attachment.remark].join(" ").toLowerCase();
    return keywords.some((keyword) => searchable.includes(keyword.toLowerCase()));
  });
}

function normalizeStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item).trim()).filter(Boolean);
}
