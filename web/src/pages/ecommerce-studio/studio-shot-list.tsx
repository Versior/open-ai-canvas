import { Input } from "antd";
import { ChevronDown, ChevronUp, PenLine } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/base/checkbox";
import { STUDIO_DETAIL_PLAN_LIMITS } from "@/lib/ecommerce-studio/detail-plan";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import type { StudioPlannedScreen } from "@/lib/ecommerce-studio/types";

export type StudioPlannedScreenPatch = Partial<Pick<StudioPlannedScreen, "title" | "visual" | "headline" | "subline" | "lines">>;

/** 详情页策划的一屏：展开后改屏名、画面和文案，出图按改过的写。 */
function PlannedScreenEditor({ entry, onChange }: { entry: StudioSetEntry; onChange: (patch: StudioPlannedScreenPatch) => void }) {
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const copy = entry.copy || { headline: "", subline: "", lines: [] };
    const id = `es-plan-${entry.key}`;
    return (
        <div className="es-shot-edit">
            <label className="es-shot-edit-field" htmlFor={`${id}-title`}>
                <span>屏名</span>
                <Input id={`${id}-title`} variant="filled" maxLength={limits.title} value={entry.title} onChange={(event) => onChange({ title: event.target.value })} />
            </label>
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
            {entry.noText ? (
                <p className="es-shot-edit-note">这一屏不放文字。</p>
            ) : (
                <>
                    <label className="es-shot-edit-field" htmlFor={`${id}-headline`}>
                        <span>主标题</span>
                        <Input id={`${id}-headline`} variant="filled" maxLength={limits.headline} value={copy.headline} onChange={(event) => onChange({ headline: event.target.value })} />
                    </label>
                    <label className="es-shot-edit-field" htmlFor={`${id}-subline`}>
                        <span>副标题</span>
                        <Input id={`${id}-subline`} variant="filled" maxLength={limits.subline} value={copy.subline} onChange={(event) => onChange({ subline: event.target.value })} />
                    </label>
                    <label className="es-shot-edit-field" data-span="2" htmlFor={`${id}-lines`}>
                        <span>要点（一行一条，最多 {limits.lines} 条）</span>
                        <Input.TextArea id={`${id}-lines`} variant="filled" autoSize={{ minRows: 1, maxRows: limits.lines }} value={copy.lines.join("\n")} onChange={(event) => onChange({ lines: event.target.value.split("\n").slice(0, limits.lines) })} />
                    </label>
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
                const summary = [headline ? `「${headline}」` : "", entry.purpose].filter(Boolean).join(" ");
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
