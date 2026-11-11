import { Input } from "antd";
import { ChevronDown, ChevronUp, PenLine } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Select } from "@/components/ui/base/select";
import { STUDIO_DETAIL_LAYOUT_IDS, STUDIO_DETAIL_LAYOUTS, STUDIO_DETAIL_PLAN_LIMITS, studioScreenCopyBudget, studioScreenCopyIssue } from "@/lib/ecommerce-studio/detail-plan";
import { STUDIO_COMPOSITION_IDS, STUDIO_COMPOSITIONS } from "@/lib/ecommerce-studio/art-direction";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import type { StudioCompositionId, StudioDetailLayoutId, StudioPlannedScreen } from "@/lib/ecommerce-studio/types";

export type StudioPlannedScreenPatch = Partial<Pick<StudioPlannedScreen, "title" | "layout" | "composition" | "visual" | "elements" | "headline" | "subline" | "lines">>;

const LAYOUT_OPTIONS = STUDIO_DETAIL_LAYOUT_IDS.map((id) => ({ value: id, label: STUDIO_DETAIL_LAYOUTS[id].label, title: STUDIO_DETAIL_LAYOUTS[id].use }));

/** 详情页策划的一屏：展开后改屏名、版式、画面、信息元素和文案，出图按改过的写。 */
function PlannedScreenEditor({ entry, onChange }: { entry: StudioSetEntry; onChange: (patch: StudioPlannedScreenPatch) => void }) {
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const copy = entry.copy || { headline: "", subline: "", lines: [] };
    const id = `es-plan-${entry.key}`;
    const layout = entry.layout ? STUDIO_DETAIL_LAYOUTS[entry.layout] : undefined;
    const budget = studioScreenCopyBudget(entry.role);
    const copyIssue = studioScreenCopyIssue({ ...copy, role: entry.role, eyebrow: entry.eyebrow, noText: entry.noText });
    return (
        <div className="es-shot-edit">
            <label className="es-shot-edit-field" htmlFor={`${id}-title`}>
                <span>屏名</span>
                <Input id={`${id}-title`} variant="filled" maxLength={limits.title} value={entry.title} onChange={(event) => onChange({ title: event.target.value })} />
            </label>
            <div className="es-shot-edit-field">
                <span>版式</span>
                <Select appearance="field" value={entry.layout} options={LAYOUT_OPTIONS} ariaLabel="这一屏的版式" onChange={(value: StudioDetailLayoutId) => onChange({ layout: value })} />
            </div>
            <div className="es-shot-edit-field" data-span="2">
                <span>图文构图</span>
                <Select
                    appearance="field"
                    value={entry.composition}
                    placeholder="按画面说明"
                    options={STUDIO_COMPOSITION_IDS.map((id) => ({ value: id, label: STUDIO_COMPOSITIONS[id].label, title: STUDIO_COMPOSITIONS[id].render }))}
                    ariaLabel="这一屏的图文构图"
                    onChange={(value: StudioCompositionId) => onChange({ composition: value })}
                />
            </div>
            <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-visual`}>
                <span>画面</span>
                <Input.TextArea
                    id={`${id}-visual`}
                    variant="filled"
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    maxLength={limits.visual}
                    value={entry.visual || ""}
                    placeholder="清空后这一屏按默认的镜头规格出"
                    onChange={(event) => onChange({ visual: event.target.value })}
                />
            </label>
            <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-elements`}>
                <span>排版与信息元素</span>
                <Input.TextArea
                    id={`${id}-elements`}
                    variant="filled"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    maxLength={limits.elements}
                    value={entry.elements || ""}
                    placeholder="写明标题的语义分行、对齐轴线，以及哪条说明紧邻哪幅证据"
                    onChange={(event) => onChange({ elements: event.target.value })}
                />
            </label>
            {entry.noText ? (
                <p className="es-shot-edit-note">这一屏不放文字。</p>
            ) : (
                <>
                    <label className="es-shot-edit-field" htmlFor={`${id}-headline`}>
                        <span>主标题</span>
                        <Input.TextArea id={`${id}-headline`} variant="filled" autoSize={{ minRows: 1, maxRows: 3 }} value={copy.headline} onChange={(event) => onChange({ headline: event.target.value })} />
                    </label>
                    <label className="es-shot-edit-field" htmlFor={`${id}-subline`}>
                        <span>补充依据</span>
                        <Input.TextArea id={`${id}-subline`} variant="filled" autoSize={{ minRows: 1, maxRows: 3 }} value={copy.subline} onChange={(event) => onChange({ subline: event.target.value })} />
                    </label>
                    <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-lines`}>
                        <span>
                            {layout ? layout.lines.replace(/（[^）]*）$/, "") : "要点"}（一行一条，最多 {budget.lines} 条）
                        </span>
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
                        <p className="es-shot-edit-note">这一屏只讲一个重点，全部文案约 {budget.units} 个汉字以内。标题可按语义换行，无新信息的说明留空。</p>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * 套图镜头清单：勾掉这次不出的镜头，上下移动调整顺序；导出整套和详情长图都按这个顺序。
 * 详情页策划的屏可以展开修改画面和文案（传 onEditPlan 时）。
 */
export function StudioShotList({
    entries,
    unit,
    onToggle,
    onMove,
    onEditPlan,
}: {
    entries: StudioSetEntry[];
    unit: string;
    onToggle: (key: string) => void;
    onMove: (key: string, delta: -1 | 1) => void;
    onEditPlan?: (planIndex: number, patch: StudioPlannedScreenPatch) => void;
}) {
    const [open, setOpen] = useState<string>();
    let position = 0;
    return (
        <ol className="es-shots" aria-label="镜头清单">
            {entries.map((entry, index) => {
                if (entry.included) position += 1;
                const editable = entry.planIndex !== undefined && onEditPlan;
                const expanded = Boolean(editable && open === entry.key);
                const headline = entry.copy && !entry.noText ? entry.copy.headline.trim() : "";
                const layout = entry.layout ? STUDIO_DETAIL_LAYOUTS[entry.layout].label : "";
                const summary = [headline ? `「${headline}」` : "", layout, entry.composition ? STUDIO_COMPOSITIONS[entry.composition].label : "", entry.purpose].filter(Boolean).join(" · ");
                return (
                    <li key={entry.key} className="es-shot" data-off={entry.included ? undefined : true} data-open={expanded || undefined}>
                        <Checkbox checked={entry.included} onChange={() => onToggle(entry.key)} aria-label={`出这${unit}：${entry.title}`} />
                        <span className="es-shot-index" aria-hidden>
                            {entry.included ? String(position).padStart(2, "0") : "—"}
                        </span>
                        <span className="es-shot-text">
                            <strong>{entry.title}</strong>
                            <span title={entry.visual || entry.purpose}>{summary}</span>
                        </span>
                        <span className="es-shot-move">
                            {editable ? (
                                <button type="button" className="es-icon-btn" aria-label={`修改这一${unit}：${entry.title}`} aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : entry.key)}>
                                    <PenLine size={14} />
                                </button>
                            ) : null}
                            <button type="button" className="es-icon-btn" aria-label={`上移：${entry.title}`} disabled={index === 0} onClick={() => onMove(entry.key, -1)}>
                                <ChevronUp size={14} />
                            </button>
                            <button type="button" className="es-icon-btn" aria-label={`下移：${entry.title}`} disabled={index === entries.length - 1} onClick={() => onMove(entry.key, 1)}>
                                <ChevronDown size={14} />
                            </button>
                        </span>
                        {expanded && editable ? <PlannedScreenEditor entry={entry} onChange={(patch) => onEditPlan(entry.planIndex!, patch)} /> : null}
                    </li>
                );
            })}
        </ol>
    );
}
