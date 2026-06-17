import { GripVertical, Plus, Save, Search, Trash2, UserRound, UsersRound } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ivicService } from "../../services/ivicService";
import type { AppData, ExpenseGroup, PersonMember } from "../../types/domain";
import {
  createAttachmentRule,
  parseAttachmentRuleConfig,
  serializeAttachmentRuleConfig,
  splitRuleText,
  type AttachmentRule,
  type AttachmentRuleConfig,
} from "../../utils/attachmentRules";
import {
  createCustomQuickSubmitItem,
  parseQuickSubmitConfig,
  quickSubmitBatchFieldOptions,
  quickSubmitItemFieldOptions,
  serializeQuickSubmitConfig,
  type QuickSubmitConfig,
  type QuickSubmitConfigItem,
} from "../batches/quickSubmitText";

interface GroupsPageProps {
  data: AppData;
  persist: (action: Promise<AppData>, message: string) => Promise<void>;
}

interface QuickSubmitDragState {
  id: string;
  type: QuickSubmitConfigItem["type"];
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  targetIndex: number;
}

interface QuickSubmitDropTarget {
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface QuickSubmitDragPosition {
  x: number;
  y: number;
}

interface QuickSubmitDropMarkerStyle {
  height: number;
  x: number;
  y: number;
}

interface DeleteTarget {
  type: "group" | "member";
  id: number;
  name: string;
  summary: string;
}

export function GroupsPage({ data, persist }: GroupsPageProps) {
  const [keyword, setKeyword] = useState("");
  const [viewMode, setViewMode] = useState<"groups" | "members">("groups");
  const members = data.members ?? [];
  const [activeId, setActiveId] = useState(data.groups[0]?.id ?? 0);
  const [activeMemberId, setActiveMemberId] = useState(members[0]?.id ?? 0);
  const activeGroup = data.groups.find((group) => group.id === activeId) ?? data.groups[0];
  const activeMember = members.find((member) => member.id === activeMemberId) ?? members[0];
  const [draft, setDraft] = useState<ExpenseGroup | null>(activeGroup ?? null);
  const [memberDraft, setMemberDraft] = useState<PersonMember | null>(activeMember ?? null);
  const [quickSubmitDrag, setQuickSubmitDrag] = useState<QuickSubmitDragState | null>(null);
  const quickSubmitDragRef = useRef<QuickSubmitDragState | null>(null);
  const quickSubmitDragPreviewRef = useRef<HTMLDivElement | null>(null);
  const quickSubmitDropMarkerRef = useRef<HTMLDivElement | null>(null);
  const quickSubmitDropTargetsRef = useRef<QuickSubmitDropTarget[]>([]);
  const quickSubmitDragFrameRef = useRef<number | null>(null);
  const quickSubmitPendingPositionRef = useRef<QuickSubmitDragPosition | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);

  const filteredGroups = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return data.groups.filter((group) => !needle || [group.name, group.ownerName, group.category, group.titleRule].join(" ").toLowerCase().includes(needle));
  }, [data.groups, keyword]);
  const filteredMembers = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return members.filter((member) => !needle || [member.name, member.phone, member.email, member.remark].join(" ").toLowerCase().includes(needle));
  }, [members, keyword]);
  const ownerOptions = useMemo(
    () => members.filter((member) => member.isActive || member.id === draft?.ownerId),
    [draft?.ownerId, members],
  );
  const quickSubmitConfig = useMemo(
    () => parseQuickSubmitConfig(draft?.quickSubmitTemplate ?? ""),
    [draft?.quickSubmitTemplate],
  );
  const quickSubmitBatchItems = quickSubmitConfig.items.filter((item) => item.type === "field");
  const quickSubmitItemItems = quickSubmitConfig.items.filter((item) => item.type === "itemField");
  const quickSubmitCustomItems = quickSubmitConfig.items.filter((item) => item.type === "custom");
  const attachmentRuleConfig = useMemo(
    () => parseAttachmentRuleConfig(draft?.attachmentRuleConfig ?? ""),
    [draft?.attachmentRuleConfig],
  );

  function selectGroup(group: ExpenseGroup) {
    setActiveId(group.id);
    setDraft(group);
  }

  function selectMember(member: PersonMember) {
    setActiveMemberId(member.id);
    setMemberDraft(member);
  }

  function addGroup() {
    const next: ExpenseGroup = {
      id: Date.now(),
      name: "新分组",
      ownerName: "",
      category: "",
      titleRule: "",
      quickSubmitTemplate: "",
      attachmentRuleConfig: "",
      color: "#4f7d5a",
      remark: "",
      isActive: true,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    setActiveId(next.id);
    setDraft(next);
  }

  function addMember() {
    const next: PersonMember = {
      id: Date.now(),
      name: "新人员",
      phone: "",
      email: "",
      remark: "",
      isActive: true,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    setActiveMemberId(next.id);
    setMemberDraft(next);
  }

  function updateDraft(patch: Partial<ExpenseGroup>) {
    if (!draft) {
      return;
    }
    setDraft({ ...draft, ...patch, updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }) });
  }

  function updateMemberDraft(patch: Partial<PersonMember>) {
    if (!memberDraft) {
      return;
    }
    setMemberDraft({ ...memberDraft, ...patch, updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }) });
  }

  function updateGroupOwner(ownerIdValue: string) {
    const ownerId = ownerIdValue ? Number(ownerIdValue) : null;
    const owner = members.find((member) => member.id === ownerId);
    updateDraft({ ownerId, ownerName: owner?.name ?? "" });
  }

  function requestDeleteGroup(event: MouseEvent<HTMLButtonElement>, group: ExpenseGroup) {
    event.stopPropagation();
    const formCount = data.forms.filter((form) => form.groupId === group.id).length;
    const batchCount = data.batches.filter((batch) => batch.groupId === group.id).length;
    setPendingDelete({
      type: "group",
      id: group.id,
      name: group.name,
      summary: `关联的 ${formCount} 条订单和 ${batchCount} 个批次会保留，并改回未分组/默认人员。`,
    });
  }

  function requestDeleteMember(event: MouseEvent<HTMLButtonElement>, member: PersonMember) {
    event.stopPropagation();
    const groupCount = data.groups.filter((group) => group.ownerId === member.id).length;
    const formCount = data.forms.filter((form) => form.memberId === member.id).length;
    setPendingDelete({
      type: "member",
      id: member.id,
      name: member.name,
      summary: `关联的 ${groupCount} 个分组会清空负责人，${formCount} 条订单会回到对应分组负责人或默认人员。`,
    });
  }

  async function confirmDeleteTarget() {
    if (!pendingDelete) {
      return;
    }
    const target = pendingDelete;
    setPendingDelete(null);
    if (target.type === "group") {
      const nextGroup = data.groups.find((group) => group.id !== target.id) ?? null;
      setActiveId(nextGroup?.id ?? 0);
      setDraft(nextGroup);
      await persist(ivicService.deleteGroup(target.id), "分组已删除，相关数据已回到默认值");
      return;
    }
    const nextMember = members.find((member) => member.id !== target.id) ?? null;
    setActiveMemberId(nextMember?.id ?? 0);
    setMemberDraft(nextMember);
    await persist(ivicService.deleteMember(target.id), "人员已删除，相关数据已回到默认值");
  }

  function updateQuickSubmitConfig(config: QuickSubmitConfig) {
    updateDraft({ quickSubmitTemplate: serializeQuickSubmitConfig(config) });
  }

  function patchQuickSubmitItem(id: string, patch: Partial<QuickSubmitConfigItem>) {
    updateQuickSubmitConfig({
      ...quickSubmitConfig,
      items: quickSubmitConfig.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  function addCustomQuickSubmitItem() {
    updateQuickSubmitConfig({
      ...quickSubmitConfig,
      items: [...quickSubmitConfig.items, createCustomQuickSubmitItem()],
    });
  }

  function removeQuickSubmitItem(id: string) {
    updateQuickSubmitConfig({
      ...quickSubmitConfig,
      items: quickSubmitConfig.items.filter((item) => item.id !== id),
    });
  }

  function updateAttachmentRuleConfig(config: AttachmentRuleConfig) {
    updateDraft({ attachmentRuleConfig: serializeAttachmentRuleConfig(config) });
  }

  function patchAttachmentRule(id: string, patch: Partial<AttachmentRule>) {
    updateAttachmentRuleConfig({
      ...attachmentRuleConfig,
      rules: attachmentRuleConfig.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    });
  }

  function addAttachmentRule() {
    updateAttachmentRuleConfig({
      ...attachmentRuleConfig,
      rules: [...attachmentRuleConfig.rules, createAttachmentRule()],
    });
  }

  function removeAttachmentRule(id: string) {
    updateAttachmentRuleConfig({
      ...attachmentRuleConfig,
      rules: attachmentRuleConfig.rules.filter((rule) => rule.id !== id),
    });
  }

  function setQuickSubmitDragState(state: QuickSubmitDragState | null) {
    quickSubmitDragRef.current = state;
    setQuickSubmitDrag(state);
  }

  function getQuickSubmitItemsByType(type: QuickSubmitConfigItem["type"]) {
    return quickSubmitConfig.items.filter((item) => item.type === type);
  }

  function measureQuickSubmitDropTargets(type: QuickSubmitConfigItem["type"], draggingId: string) {
    return Array.from(document.querySelectorAll<HTMLElement>(`[data-quick-config-type="${type}"][data-quick-config-id]`))
      .filter((row) => row.dataset.quickConfigId !== draggingId)
      .map((row) => ({ row, rect: row.getBoundingClientRect() }))
      .sort((first, second) => {
        const firstRect = first.rect;
        const secondRect = second.rect;
        return Math.abs(firstRect.top - secondRect.top) < 6 ? firstRect.left - secondRect.left : firstRect.top - secondRect.top;
      })
      .map(({ rect }, index) => {
        return {
          index,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
  }

  function getQuickSubmitDropMarkerStyle(targetIndex: number): QuickSubmitDropMarkerStyle | null {
    const targets = quickSubmitDropTargetsRef.current;
    if (!targets.length) {
      return null;
    }
    if (targetIndex <= 0) {
      const first = targets[0];
      return { height: first.bottom - first.top, x: first.left - 5, y: first.top };
    }
    if (targetIndex >= targets.length) {
      const last = targets[targets.length - 1];
      return { height: last.bottom - last.top, x: last.right + 5, y: last.top };
    }
    const target = targets[targetIndex];
    return { height: target.bottom - target.top, x: target.left - 5, y: target.top };
  }

  function positionQuickSubmitDropMarker(targetIndex: number) {
    const marker = quickSubmitDropMarkerRef.current;
    const style = getQuickSubmitDropMarkerStyle(targetIndex);
    if (!marker || !style) {
      return;
    }
    marker.style.height = `${style.height}px`;
    marker.style.transform = `translate3d(${style.x}px, ${style.y}px, 0)`;
  }

  function moveQuickSubmitDragPreview() {
    quickSubmitDragFrameRef.current = null;
    const drag = quickSubmitDragRef.current;
    const position = quickSubmitPendingPositionRef.current;
    const preview = quickSubmitDragPreviewRef.current;
    if (!drag || !position || !preview) {
      return;
    }
    preview.style.transform = `translate3d(${position.x - drag.x}px, ${position.y - drag.y}px, 0)`;
    positionQuickSubmitDropMarker(drag.targetIndex);
  }

  function getQuickSubmitDropIndex(clientX: number, clientY: number) {
    const targets = quickSubmitDropTargetsRef.current;
    if (!targets.length) {
      return 0;
    }
    const target = targets.reduce((closest, candidate) => {
      const distance = Math.hypot(clientX - candidate.centerX, clientY - candidate.centerY);
      return distance < closest.distance ? { distance, target: candidate } : closest;
    }, { distance: Number.POSITIVE_INFINITY, target: targets[0] }).target;
    const sameRow = clientY >= target.top && clientY <= target.bottom;
    const before = sameRow ? clientX < target.centerX : clientY < target.centerY;
    return Math.max(0, Math.min(before ? target.index : target.index + 1, targets.length));
  }

  function beginQuickSubmitDrag(event: PointerEvent<HTMLButtonElement>, item: QuickSubmitConfigItem) {
    event.preventDefault();
    event.stopPropagation();
    const row = event.currentTarget.closest("[data-quick-config-id]") as HTMLElement | null;
    if (!row) {
      return;
    }
    const rect = row.getBoundingClientRect();
    const itemIndex = getQuickSubmitItemsByType(item.type).findIndex((candidate) => candidate.id === item.id);
    quickSubmitDropTargetsRef.current = measureQuickSubmitDropTargets(item.type, item.id);
    quickSubmitPendingPositionRef.current = { x: rect.left, y: rect.top };
    setQuickSubmitDragState({
      id: item.id,
      type: item.type,
      pointerId: event.pointerId,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      targetIndex: itemIndex < 0 ? 0 : itemIndex,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveQuickSubmitDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = quickSubmitDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    quickSubmitPendingPositionRef.current = {
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    };
    if (quickSubmitDragFrameRef.current === null) {
      quickSubmitDragFrameRef.current = window.requestAnimationFrame(moveQuickSubmitDragPreview);
    }
    const targetIndex = getQuickSubmitDropIndex(event.clientX, event.clientY);
    if (targetIndex !== drag.targetIndex) {
      const nextDrag = { ...drag, targetIndex };
      quickSubmitDragRef.current = nextDrag;
      positionQuickSubmitDropMarker(targetIndex);
    }
  }

  function finishQuickSubmitDrag(event?: PointerEvent<HTMLButtonElement>) {
    const drag = quickSubmitDragRef.current;
    if (event && drag && drag.pointerId !== event.pointerId) {
      return;
    }
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (quickSubmitDragFrameRef.current !== null) {
      window.cancelAnimationFrame(quickSubmitDragFrameRef.current);
      quickSubmitDragFrameRef.current = null;
    }
    if (drag) {
      const items = getQuickSubmitItemsByType(drag.type);
      const dragged = items.find((item) => item.id === drag.id);
      if (dragged) {
        const rest = items.filter((item) => item.id !== drag.id);
        const targetIndex = Math.max(0, Math.min(drag.targetIndex, rest.length));
        const nextTypedItems = [...rest.slice(0, targetIndex), dragged, ...rest.slice(targetIndex)];
        updateQuickSubmitConfig({
          ...quickSubmitConfig,
          items: [
            ...(drag.type === "field" ? nextTypedItems : quickSubmitBatchItems),
            ...(drag.type === "itemField" ? nextTypedItems : quickSubmitItemItems),
            ...(drag.type === "custom" ? nextTypedItems : quickSubmitCustomItems),
          ],
        });
      }
    }
    quickSubmitDropTargetsRef.current = [];
    quickSubmitPendingPositionRef.current = null;
    setQuickSubmitDragState(null);
  }

  function renderQuickSubmitConfigItem(item: QuickSubmitConfigItem) {
    const isPlaceholder = quickSubmitDrag?.id === item.id;
    const isCustom = item.type === "custom";
    return (
      <div
        key={item.id}
        className={[
          "quick-config-row",
          isCustom ? "custom" : "field",
          isPlaceholder ? "placeholder" : "",
        ].filter(Boolean).join(" ")}
        data-quick-config-id={item.id}
        data-quick-config-type={item.type}
        style={isPlaceholder ? { minHeight: quickSubmitDrag.height } : undefined}
      >
        <button
          aria-label="拖动排序"
          className="quick-config-grip"
          onPointerCancel={finishQuickSubmitDrag}
          onPointerDown={(event) => beginQuickSubmitDrag(event, item)}
          onPointerMove={moveQuickSubmitDrag}
          onPointerUp={finishQuickSubmitDrag}
          type="button"
        >
          <GripVertical size={18} />
        </button>
        <input
          aria-label="显示"
          checked={item.enabled}
          onChange={(event) => patchQuickSubmitItem(item.id, { enabled: event.target.checked })}
          type="checkbox"
        />
        <div className="quick-config-body">
          {isCustom ? (
            <>
              <div className="quick-config-meta">
                <strong>{fieldName(item)}</strong>
                <input
                  value={item.label}
                  onChange={(event) => patchQuickSubmitItem(item.id, { label: event.target.value })}
                  placeholder="显示名"
                />
              </div>
              <textarea
                value={item.text ?? ""}
                onChange={(event) => patchQuickSubmitItem(item.id, { text: event.target.value })}
                placeholder="自定义显示内容"
              />
            </>
          ) : (
            <strong className="quick-config-field-name">{fieldName(item)}</strong>
          )}
        </div>
        {isCustom && (
          <Button icon={<Trash2 size={15} />} onClick={() => removeQuickSubmitItem(item.id)} variant="ghost">删除</Button>
        )}
      </div>
    );
  }

  function renderQuickSubmitDragPreview() {
    if (!quickSubmitDrag) {
      return null;
    }
    const item = quickSubmitConfig.items.find((candidate) => candidate.id === quickSubmitDrag.id);
    if (!item) {
      return null;
    }
    return (
      <div
        className={["quick-config-row", "quick-config-drag-preview", item.type === "custom" ? "custom" : "field"].join(" ")}
        ref={quickSubmitDragPreviewRef}
        style={{
          left: quickSubmitDrag.x,
          minHeight: quickSubmitDrag.height,
          top: quickSubmitDrag.y,
          width: quickSubmitDrag.width,
        }}
      >
        <span className="quick-config-grip preview">
          <GripVertical size={18} />
        </span>
        <input aria-label="显示" checked={item.enabled} readOnly type="checkbox" />
        <div className="quick-config-body">
          {item.type === "custom" ? (
            <div className="quick-config-meta">
              <strong>{fieldName(item)}</strong>
              <input readOnly value={item.label} />
            </div>
          ) : (
            <strong className="quick-config-field-name">{fieldName(item)}</strong>
          )}
          {item.type === "custom" && <textarea readOnly value={item.text ?? ""} />}
        </div>
      </div>
    );
  }

  function renderQuickSubmitDropMarker() {
    if (!quickSubmitDrag) {
      return null;
    }
    const markerStyle = getQuickSubmitDropMarkerStyle(quickSubmitDrag.targetIndex);
    if (!markerStyle) {
      return null;
    }
    return (
      <div
        aria-hidden="true"
        className="quick-config-drop-marker"
        ref={quickSubmitDropMarkerRef}
        style={{
          height: markerStyle.height,
          transform: `translate3d(${markerStyle.x}px, ${markerStyle.y}px, 0)`,
        }}
      />
    );
  }

  return (
    <div className="groups-layout">
      <aside className="group-list-panel">
        <div className="group-mode-switch" role="tablist" aria-label="管理类型">
          <button className={viewMode === "groups" ? "active" : ""} onClick={() => setViewMode("groups")} type="button">
            <UsersRound size={15} />
            分组
          </button>
          <button className={viewMode === "members" ? "active" : ""} onClick={() => setViewMode("members")} type="button">
            <UserRound size={15} />
            人员
          </button>
        </div>
        <label className="field-with-icon">
          <Search size={16} />
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={viewMode === "groups" ? "搜索分组、负责人、抬头规则" : "搜索人员、电话、邮箱"} />
        </label>
        <div className="group-card-list">
          {viewMode === "groups" ? (
            <>
              {filteredGroups.map((group) => (
                <div key={group.id} className="group-card-shell">
                  <button className={group.id === activeId ? "group-card active" : "group-card"} onClick={() => selectGroup(group)} type="button">
                    <i style={{ background: group.color }} />
                    <strong>{group.name}</strong>
                    <span>{group.ownerName || "未设置负责人"} · {group.category || "未分类"}</span>
                    <small>{group.titleRule || "暂无发票抬头规则"}</small>
                  </button>
                  <button aria-label={`删除分组 ${group.name}`} className="group-card-delete" onClick={(event) => requestDeleteGroup(event, group)} type="button">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button className="group-card add-card" onClick={addGroup} type="button">
                <Plus size={20} />
                <strong>新增分组卡片</strong>
                <span>用于负责人、场景和抬头识别</span>
              </button>
            </>
          ) : (
            <>
              {filteredMembers.map((member) => (
                <div key={member.id} className="group-card-shell">
                  <button className={member.id === activeMemberId ? "group-card member-card active" : "group-card member-card"} onClick={() => selectMember(member)} type="button">
                    <i style={{ background: memberColor(member.id) }} />
                    <strong>{member.name}</strong>
                    <span>{member.phone || "未填电话"} · {member.email || "未填邮箱"}</span>
                    <small>{member.remark || "暂无备注"}</small>
                  </button>
                  <button aria-label={`删除人员 ${member.name}`} className="group-card-delete" onClick={(event) => requestDeleteMember(event, member)} type="button">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button className="group-card add-card" onClick={addMember} type="button">
                <Plus size={20} />
                <strong>新增人员卡片</strong>
                <span>用于负责人和订单人员选择</span>
              </button>
            </>
          )}
        </div>
      </aside>

      <section className="work-panel group-detail-panel">
        {viewMode === "members" ? (
          <>
            <div className="panel-heading">
              <div>
                <span className="section-kicker">人员详情</span>
                <h3>{memberDraft?.name ?? "请选择人员"}</h3>
              </div>
              <Button icon={<Save size={16} />} variant="primary" disabled={!memberDraft || !memberDraft.name.trim()} onClick={() => memberDraft && persist(ivicService.saveMember(memberDraft), "人员详情已保存")}>
                保存
              </Button>
            </div>
            {memberDraft && (
              <div className="form-grid person-detail-grid">
                <label>
                  <span>人员名字</span>
                  <input value={memberDraft.name} onChange={(event) => updateMemberDraft({ name: event.target.value })} />
                </label>
                <label>
                  <span>电话</span>
                  <input value={memberDraft.phone} onChange={(event) => updateMemberDraft({ phone: event.target.value })} />
                </label>
                <label>
                  <span>邮箱</span>
                  <input value={memberDraft.email} onChange={(event) => updateMemberDraft({ email: event.target.value })} />
                </label>
                <label className="wide">
                  <span>备注</span>
                  <textarea value={memberDraft.remark} onChange={(event) => updateMemberDraft({ remark: event.target.value })} />
                </label>
                <label className="switch-row">
                  <input checked={memberDraft.isActive} onChange={(event) => updateMemberDraft({ isActive: event.target.checked })} type="checkbox" />
                  <span>启用此人员并出现在选择列表中</span>
                </label>
              </div>
            )}
          </>
        ) : (
          <>
        <div className="panel-heading">
          <div>
            <span className="section-kicker">分组详情</span>
            <h3>{draft?.name ?? "请选择分组"}</h3>
          </div>
          <Button icon={<Save size={16} />} variant="primary" disabled={!draft} onClick={() => draft && persist(ivicService.saveGroup(draft), "分组详情已保存")}>
            保存
          </Button>
        </div>
        {draft && (
          <div className="form-grid">
            <label>
              <span>分组名称</span>
              <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
            </label>
            <label>
              <span>负责人/交接人</span>
              <select value={draft.ownerId ?? ""} onChange={(event) => updateGroupOwner(event.target.value)}>
                <option value="">未选择负责人</option>
                {ownerOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label>
              <span>简介/场景</span>
              <input value={draft.category} onChange={(event) => updateDraft({ category: event.target.value })} />
            </label>
            <label>
              <span>颜色</span>
              <input type="color" value={draft.color} onChange={(event) => updateDraft({ color: event.target.value })} />
            </label>
            <label className="wide">
              <span>发票抬头规则</span>
              <textarea value={draft.titleRule} onChange={(event) => updateDraft({ titleRule: event.target.value })} />
            </label>
            <section className="wide quick-config-panel">
              <div className="quick-config-head">
                <span>快速复制文本</span>
                <Button icon={<Plus size={16} />} onClick={addCustomQuickSubmitItem}>自定义文本</Button>
              </div>
              <div className="quick-config-groups">
                <div className="quick-config-group">
                  <span className="quick-config-group-title">提交批次字段</span>
                  <div className="quick-config-list">
                    {quickSubmitBatchItems.map(renderQuickSubmitConfigItem)}
                  </div>
                </div>
                <div className="quick-config-divider" role="separator" />
                <div className="quick-config-group">
                  <span className="quick-config-group-title">子订单字段</span>
                  <div className="quick-config-list">
                    {quickSubmitItemItems.map(renderQuickSubmitConfigItem)}
                  </div>
                </div>
                {quickSubmitCustomItems.length > 0 && (
                  <>
                    <div className="quick-config-divider subtle" role="separator" />
                    <div className="quick-config-group">
                      <span className="quick-config-group-title">自定义文本</span>
                      <div className="quick-config-list">
                        {quickSubmitCustomItems.map(renderQuickSubmitConfigItem)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
            <section className="wide attachment-rule-panel">
              <div className="quick-config-head">
                <span>附件规则</span>
                <Button icon={<Plus size={16} />} onClick={addAttachmentRule}>新增规则</Button>
              </div>
              <div className="attachment-rule-list">
                {attachmentRuleConfig.rules.map((rule) => (
                  <div key={rule.id} className="attachment-rule-card">
                    <div className="attachment-rule-top">
                      <label className="compact-check">
                        <input
                          checked={rule.enabled}
                          onChange={(event) => patchAttachmentRule(rule.id, { enabled: event.target.checked })}
                          type="checkbox"
                        />
                        <span>启用</span>
                      </label>
                      <Button icon={<Trash2 size={15} />} onClick={() => removeAttachmentRule(rule.id)} variant="ghost">删除</Button>
                    </div>
                    <label>
                      <span>规则名</span>
                      <input value={rule.name} onChange={(event) => patchAttachmentRule(rule.id, { name: event.target.value })} />
                    </label>
                    <div className="attachment-rule-grid">
                      <label>
                        <span>金额超过</span>
                        <input
                          min={0}
                          onChange={(event) => patchAttachmentRule(rule.id, { minAmount: Number(event.target.value || 0) })}
                          type="number"
                          value={rule.minAmount}
                        />
                      </label>
                      <label>
                        <span>单位</span>
                        <input value={rule.units.join("、")} onChange={(event) => patchAttachmentRule(rule.id, { units: splitRuleText(event.target.value) })} />
                      </label>
                    </div>
                    <label className="compact-check">
                      <input
                        checked={rule.includeEmptyUnit}
                        onChange={(event) => patchAttachmentRule(rule.id, { includeEmptyUnit: event.target.checked })}
                        type="checkbox"
                      />
                      <span>包含无单位</span>
                    </label>
                    <div className="attachment-rule-grid">
                      <label>
                        <span>需要附件</span>
                        <input
                          value={rule.requiredAttachmentLabel}
                          onChange={(event) => patchAttachmentRule(rule.id, { requiredAttachmentLabel: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>匹配关键词</span>
                        <input value={rule.keywords.join("、")} onChange={(event) => patchAttachmentRule(rule.id, { keywords: splitRuleText(event.target.value) })} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <label className="wide">
              <span>备注</span>
              <textarea value={draft.remark} onChange={(event) => updateDraft({ remark: event.target.value })} />
            </label>
            <label className="switch-row">
              <input checked={draft.isActive} onChange={(event) => updateDraft({ isActive: event.target.checked })} type="checkbox" />
              <span>启用此分组并参与导入/匹配建议</span>
            </label>
          </div>
        )}
          </>
        )}
      </section>
      {renderQuickSubmitDropMarker()}
      {renderQuickSubmitDragPreview()}
      {pendingDelete && (
        <div className="modal-backdrop confirm-backdrop" role="presentation">
          <section aria-modal="true" className="modal-card discard-confirm-modal" role="dialog">
            <h3>{pendingDelete.type === "group" ? "删除分组卡片" : "删除人员卡片"}</h3>
            <p>
              确认删除「{pendingDelete.name}」？{pendingDelete.summary}
            </p>
            <div className="modal-actions">
              <Button onClick={() => setPendingDelete(null)}>取消</Button>
              <Button icon={<Trash2 size={16} />} onClick={confirmDeleteTarget} variant="danger">
                确认删除
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function fieldName(item: QuickSubmitConfigItem) {
  if (item.type === "field") {
    return `提交批次 · ${quickSubmitBatchFieldOptions.find((option) => option.key === item.key)?.name ?? item.label}`;
  }
  if (item.type === "itemField") {
    return `子订单 · ${quickSubmitItemFieldOptions.find((option) => option.key === item.key)?.name ?? item.label}`;
  }
  return "自定义文本";
}

function memberColor(id: number) {
  const hue = Math.abs(id * 47) % 360;
  return `hsl(${hue} 62% 62%)`;
}
