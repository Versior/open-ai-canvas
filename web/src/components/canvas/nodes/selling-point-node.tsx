import { BadgeCheck, ChevronDown, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { createEcommerceSellingPoint, type EcommerceSellingPoint } from "@/lib/ecommerce/ecommerce-contract";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { buildEcommerceSellingPointsDraftPrompt } from "@/lib/ecommerce/ecommerce-draft";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type SellingPointNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/**
 * 卖点节点——一张卖点卡。
 *
 * 卡片主体是编号条目，一眼扫得完；编辑才展开输入框。
 *
 * 依据是硬要求，不是可选项。没有依据的卖点会被模型展开成具体数据、功效或认证——
 * 那是编造。缺依据的条目在卡片上就用橙色标出来，在生成之前就让人看见风险。
 */
export function SellingPointNodeContent({ node, theme }: SellingPointNodeContentProps) {
    const { updateMetadata, draftWithAgent } = useCanvasNodeActions();
    const [editing, setEditing] = useState(false);

    const points = node.metadata?.sellingPoints || [];
    const editable = Boolean(updateMetadata);
    const missingEvidence = points.filter((point) => point.claim.trim() && !point.evidence.trim()).length;

    const commit = (next: EcommerceSellingPoint[]) => updateMetadata?.(node.id, { sellingPoints: next });
    const patch = (id: string, next: Partial<EcommerceSellingPoint>) => commit(points.map((point) => (point.id === id ? { ...point, ...next } : point)));

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><BadgeCheck className="size-3.5" /></span>
                    <span>电商 / 卖点</span>
                </div>
                <span className={missingEvidence ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {points.length} 条{missingEvidence ? ` · ${missingEvidence} 条缺依据` : ""}
                </span>
            </header>

            <EcommerceNodeTitle node={node} fallback="卖点" subtitle="写一条条能被验证的主张，配给卖点图与详情页" />

            <div className="ecom-point-list thin-scrollbar">
                {points.length ? points.map((point, index) => (
                    <div key={point.id} className="ecom-point">
                        <span className="ecom-point-index">{index + 1}</span>
                        <span className="ecom-point-body">
                            <span className="ecom-point-claim">{point.claim.trim() || "（还没写卖点）"}</span>
                            <span className="ecom-point-evidence" data-missing={point.claim.trim() && !point.evidence.trim() ? "true" : "false"}>
                                {point.evidence.trim() ? `依据：${point.evidence.trim()}` : "缺依据——模型不会替你编数据"}
                            </span>
                        </span>
                    </div>
                )) : (
                    <p className="ecom-card-stage-empty" style={{ textAlign: "left", padding: 0 }}>
                        还没有卖点。没有依据的卖点会被模型展开成具体数据、功效或认证，那是编造——所以依据是必填的。
                    </p>
                )}
            </div>

            {/* 起草卖点常驻可见——空节点上这是最高价值的入口。
                指令里明确要求：想不出依据的把依据留空并标出来，不要自己编数字。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!draftWithAgent}
                    title="助手按商品档案起草卖点，并逐条说明哪几条需要你补依据"
                    onClick={() => draftWithAgent?.(node, buildEcommerceSellingPointsDraftPrompt())}
                >
                    <Sparkles className="size-3" />
                    让助手起草卖点
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    {points.map((point, index) => (
                        <div key={point.id} className="ecom-field">
                            <span className="flex items-center gap-1.5">
                                <span className="ecom-field-label">卖点 {index + 1}</span>
                                <button type="button" className="ecom-chip" aria-label={`删除卖点 ${index + 1}`} onClick={() => commit(points.filter((item) => item.id !== point.id))}>
                                    <X className="size-3" />
                                </button>
                            </span>
                            <input className="ecom-field-input" value={point.claim} placeholder="卖点，一句话" onChange={(event) => patch(point.id, { claim: event.target.value })} />
                            <input className="ecom-field-input" value={point.evidence} placeholder="依据：实测数据、检测报告、材质参数…" onChange={(event) => patch(point.id, { evidence: event.target.value })} />
                        </div>
                    ))}
                    <button type="button" className="ecom-action" onClick={() => commit([...points, createEcommerceSellingPoint()])}>
                        <Plus className="size-3" />
                        添加卖点
                    </button>
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>缺依据 <b>{missingEvidence}</b> 条</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "编辑"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}
