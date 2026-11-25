import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Button } from "antd";
import { useState } from "react";
import type { StudioClaimSource } from "@/lib/ecommerce-studio/claim-evidence";
import { studioPlanEvidenceMatch } from "@/lib/ecommerce-studio/detail-plan-tasks";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import type { StudioDetailPlan } from "@/lib/ecommerce-studio/types";
import "./studio-plan-preview.css";

function BriefPage({ plan, entry, index, detail, claimSources }: { plan: StudioDetailPlan; entry: StudioSetEntry; index: number; detail: boolean; claimSources: StudioClaimSource[] }) {
    const design = entry.planIndex === undefined ? undefined : plan.screens[entry.planIndex];
    const title = (detail && (entry.purchaseQuestion || entry.purpose)) || entry.title;
    const content = detail ? entry.displayContent || entry.visual : entry.visual;
    const beat = detail && entry.visualBeat?.trim();
    const focus = detail ? entry.visualFocus || entry.elements : entry.elements;
    const evidence = detail ? [...new Set((design?.evidenceRefs || design?.facts || []).map((reference) => studioPlanEvidenceMatch(claimSources, reference)?.text).filter(Boolean))].join("、") : design?.facts.join("、");
    return (
        <article className="es-proof-item" aria-label={`第 ${index + 1} 屏：${title}`}>
            <header className="es-proof-brief-head">
                <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                <strong>{title}</strong>
                {entry.noText ? <em>无字选择</em> : null}
            </header>
            <div className="es-proof-brief-body">
                {detail ? (
                    <>
                        {beat && beat !== title ? <p className="es-proof-brief-content">{beat}</p> : null}
                        {content && content !== title && content !== beat ? <p className="es-proof-brief-content">{content}</p> : null}
                        {evidence ? (
                            <p>
                                <strong>依据</strong>
                                {evidence}
                            </p>
                        ) : null}
                        {focus && focus !== content && focus !== beat ? (
                            <p>
                                <strong>视觉重点</strong>
                                {focus}
                            </p>
                        ) : null}
                    </>
                ) : (
                    <>
                        <p>
                            <strong>买家问题</strong>
                            {entry.purpose || "未标明"}
                        </p>
                        <p>
                            <strong>展示内容</strong>
                            {content || "由图片模型根据任务完成画面"}
                        </p>
                        <p>
                            <strong>依据</strong>
                            {evidence || "商品图与已确认资料"}
                        </p>
                        {focus ? (
                            <p>
                                <strong>视觉重点</strong>
                                {focus}
                            </p>
                        ) : null}
                    </>
                )}
            </div>
        </article>
    );
}

export function StudioPlanPreview({ plan, entries, detail, claimSources }: { plan: StudioDetailPlan; entries: StudioSetEntry[]; detail: boolean; claimSources: StudioClaimSource[] }) {
    const [open, setOpen] = useState(false);
    const selected = entries.filter((entry) => entry.included && entry.planIndex !== undefined);
    return (
        <>
            <Button block disabled={!selected.length} onClick={() => setOpen(true)}>
                连续页面预览 · {selected.length} 屏
            </Button>
            <AppModal title="连续页面预览" open={open} onCancel={() => setOpen(false)} width={520} footer={null}>
                {open && (
                    <div className="es-proof-view" aria-label="逐屏内容预览">
                        {!detail ? <p className="es-proof-view-note">这里展示页面任务与证据顺序，不预制标题、字体或版式；最终画面由图片模型一次完成。</p> : null}
                        <div className="es-proof-scroll" role="region" aria-label="连续页面内容滚动区" tabIndex={0}>
                            <div className="es-proof-long">
                                {selected.map((entry, index) => (
                                    <BriefPage key={entry.key} plan={plan} entry={entry} index={index} detail={detail} claimSources={claimSources} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </AppModal>
        </>
    );
}
