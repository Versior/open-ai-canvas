import { Input } from "antd";
import { ChevronDown, ChevronUp, PenLine } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/base/checkbox";
import { STUDIO_DETAIL_PLAN_LIMITS, studioScreenCopyBudget, studioScreenCopyIssue, type patchStudioDetailPlanScreen } from "@/lib/ecommerce-studio/detail-plan";
import { studioDetailRepeats } from "@/lib/ecommerce-studio/detail-repeats";
import type { StudioClaimSource } from "@/lib/ecommerce-studio/claim-evidence";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import type { StudioDetailPlan } from "@/lib/ecommerce-studio/types";

export type StudioPlannedScreenPatch = Parameters<typeof patchStudioDetailPlanScreen>[2];

function PlannedScreenEditor({ entry, purchaseQuestion, onChange }: { entry: StudioSetEntry; purchaseQuestion?: string; onChange: (patch: StudioPlannedScreenPatch) => void }) {
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const detail = purchaseQuestion !== undefined;
    const copy = entry.copy || { headline: "", subline: "", lines: [] };
    const id = `es-plan-${entry.key}`;
    const budget = studioScreenCopyBudget(entry.role);
    const copyIssue = studioScreenCopyIssue({ ...copy, role: entry.role, eyebrow: entry.eyebrow, noText: entry.noText, copySource: entry.copySource });
    return (
        <div className="es-shot-edit">
            {detail ? (
                <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-question`}>
                    <span>购买问题</span>
                    <Input id={`${id}-question`} variant="filled" maxLength={limits.purpose} value={purchaseQuestion} onChange={(event) => onChange({ purchaseQuestion: event.target.value })} />
                </label>
            ) : (
                <label className="es-shot-edit-field" htmlFor={`${id}-title`}>
                    <span>屏名</span>
                    <Input id={`${id}-title`} variant="filled" maxLength={limits.title} value={entry.title} onChange={(event) => onChange({ title: event.target.value })} />
                </label>
            )}
            {detail ? (
                <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-beat`}>
                    <span>画面主线</span>
                    <Input.TextArea id={`${id}-beat`} variant="filled" autoSize={{ minRows: 1, maxRows: 3 }} maxLength={limits.visualBeat} value={entry.visualBeat || ""} onChange={(event) => onChange({ visualBeat: event.target.value })} />
                </label>
            ) : null}
            <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-visual`}>
                <span>{detail ? "展示内容" : "画面"}</span>
                <Input.TextArea
                    id={`${id}-visual`}
                    variant="filled"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    maxLength={limits.visual}
                    value={(detail ? entry.displayContent || entry.visual : entry.visual) || ""}
                    placeholder="清空后这一屏按默认的页面设计出"
                    onChange={(event) => onChange({ visual: event.target.value })}
                />
            </label>
            <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-elements`}>
                <span>视觉重点（可选）</span>
                <Input.TextArea
                    id={`${id}-elements`}
                    variant="filled"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    maxLength={limits.elements}
                    value={(detail ? entry.visualFocus || entry.elements : entry.elements) || ""}
                    placeholder="补充这一屏的视觉入口、主次关系或留白意图；不必写标题、字号或固定版式"
                    onChange={(event) => onChange({ elements: event.target.value })}
                />
            </label>
            {entry.noText ? (
                <p className="es-shot-edit-note">这一屏不放文字。</p>
            ) : (
                <>
                    <label className="es-shot-edit-field" htmlFor={`${id}-headline`}>
                        <span>标题素材（可选）</span>
                        <Input.TextArea id={`${id}-headline`} variant="filled" autoSize={{ minRows: 1, maxRows: 3 }} value={copy.headline} onChange={(event) => onChange({ headline: event.target.value })} />
                    </label>
                    <label className="es-shot-edit-field" htmlFor={`${id}-subline`}>
                        <span>说明素材（可选）</span>
                        <Input.TextArea id={`${id}-subline`} variant="filled" autoSize={{ minRows: 1, maxRows: 3 }} value={copy.subline} onChange={(event) => onChange({ subline: event.target.value })} />
                    </label>
                    <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-lines`}>
                        <span>要点（一行一条，最多 {budget.lines} 条）</span>
                        <Input.TextArea
                            id={`${id}-lines`}
                            variant="filled"
                            autoSize={{ minRows: 1, maxRows: limits.lines }}
                            status={copyIssue ? "error" : undefined}
                            value={copy.lines.join("\n")}
                            onChange={(event) => onChange({ lines: event.target.value.split("\n") })}
                        />
                    </label>
                    {copyIssue ? (
                        <p className="es-shot-edit-note" role="alert">
                            {copyIssue}
                        </p>
                    ) : (
                        <p className="es-shot-edit-note">AI 文案只是素材，会按画面重排；用户改过后才锁定。建议保留一个重点，约 {budget.units} 个汉字以内，不必填满每层。</p>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * 套图页面清单：勾掉这次不出的页面，上下移动调整顺序；导出整套和详情长图都按这个顺序。
 * 详情页策划的屏可以展开修改画面和文案（传 onEditPlan 时）。
 */
export function StudioShotList({
    entries,
    unit,
    detail = false,
    sameLayout = false,
    plan,
    claimSources,
    onToggle,
    onMove,
    onEditPlan,
}: {
    entries: StudioSetEntry[];
    unit: string;
    detail?: boolean;
    sameLayout?: boolean;
    plan?: StudioDetailPlan;
    claimSources: StudioClaimSource[];
    onToggle: (key: string) => void;
    onMove: (key: string, delta: -1 | 1) => void;
    onEditPlan?: (planIndex: number, patch: StudioPlannedScreenPatch) => void;
}) {
    const [open, setOpen] = useState<string>();
    const repeatNotes = useMemo(() => {
        const notes = new Map<string, string[]>();
        if (!detail || !plan) return notes;
        const selected = entries
            .filter((entry) => entry.included)
            .flatMap((entry, index) => {
                const screen = entry.planIndex === undefined ? undefined : plan.screens[entry.planIndex];
                return screen ? [{ screen, key: entry.key, position: index + 1 }] : [];
            });
        for (const { index, previousIndex, reason } of studioDetailRepeats(
            selected.map(({ screen }) => screen),
            sameLayout,
        )) {
            const key = selected[index].key;
            notes.set(key, [...(notes.get(key) || []), `与第 ${selected[previousIndex].position} 屏${reason}`]);
        }
        return notes;
    }, [detail, entries, plan, sameLayout]);
    let position = 0;
    return (
        <ol className="es-shots" aria-label="页面清单">
            {entries.map((entry, index) => {
                if (entry.included) position += 1;
                const editable = entry.planIndex !== undefined && onEditPlan;
                const expanded = Boolean(editable && open === entry.key);
                const screen = entry.planIndex === undefined ? undefined : plan?.screens[entry.planIndex];
                const title = (detail && (entry.purchaseQuestion || entry.purpose)) || entry.title;
                const content = detail ? entry.displayContent || entry.visual : entry.visual;
                const beat = detail && entry.visualBeat?.trim();
                const lead = detail ? beat || content : undefined;
                const more = !detail || (beat && content !== lead) ? content : undefined;
                const rawFocus = detail ? entry.visualFocus || entry.elements : entry.elements;
                const focus = detail && (rawFocus === content || rawFocus === lead) ? undefined : rawFocus;
                const evidence = screen?.evidenceRefs?.flatMap((id) => claimSources.filter((source) => source.id === id)) || [];
                const detailsLabel = detail ? (more ? "展示内容" : evidence.length ? (focus ? "重点与依据" : "依据") : "视觉重点") : `画面与证据${evidence.length ? ` · ${evidence.length} 项` : ""}`;
                const headline = entry.copySource === "user" && entry.copy && !entry.noText ? entry.copy.headline.trim() : "";
                const meta = entry.noText ? "无字画面" : "";
                const repeats = repeatNotes.get(entry.key);
                return (
                    <li key={entry.key} className="es-shot" data-off={entry.included ? undefined : true} data-open={expanded || undefined}>
                        <Checkbox checked={entry.included} onChange={() => onToggle(entry.key)} aria-label={`出这${unit}：${title}`} />
                        <span className="es-shot-index" aria-hidden>
                            {entry.included ? String(position).padStart(2, "0") : "—"}
                        </span>
                        <div className="es-shot-text es-storyboard-text">
                            <div className="es-storyboard-title">
                                <strong>{title}</strong>
                                {meta ? <span>{meta}</span> : null}
                            </div>
                            {lead && lead !== title ? <p>{lead}</p> : null}
                            {repeats ? (
                                <p className="es-inline-note" data-tone="warning" role="status">
                                    {repeats.join("；")}
                                </p>
                            ) : null}
                            {headline ? <p className="es-storyboard-copy">{headline}</p> : null}
                            {!detail && entry.purpose ? <p>{screen ? `购买问题：${entry.purpose}` : entry.purpose}</p> : null}
                            {evidence.length || more || focus ? (
                                <details>
                                    <summary>{detailsLabel}</summary>
                                    {more ? <p>{more}</p> : null}
                                    {focus ? <p>{detail ? focus : `视觉重点：${focus}`}</p> : null}
                                    {evidence.length ? (
                                        <ul>
                                            {evidence.map((source) => (
                                                <li key={source.id}>{source.text}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </details>
                            ) : null}
                        </div>
                        <span className="es-shot-move">
                            {editable ? (
                                <button type="button" className="es-icon-btn" aria-label={`修改这一${unit}：${title}`} aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : entry.key)}>
                                    <PenLine size={14} />
                                </button>
                            ) : null}
                            <button type="button" className="es-icon-btn" aria-label={`上移：${title}`} disabled={index === 0} onClick={() => onMove(entry.key, -1)}>
                                <ChevronUp size={14} />
                            </button>
                            <button type="button" className="es-icon-btn" aria-label={`下移：${title}`} disabled={index === entries.length - 1} onClick={() => onMove(entry.key, 1)}>
                                <ChevronDown size={14} />
                            </button>
                        </span>
                        {expanded && editable ? (
                            <PlannedScreenEditor entry={entry} purchaseQuestion={detail ? (screen?.purchaseQuestion ?? entry.purchaseQuestion ?? screen?.purpose ?? entry.purpose) : undefined} onChange={(patch) => onEditPlan(entry.planIndex!, patch)} />
                        ) : null}
                    </li>
                );
            })}
        </ol>
    );
}
