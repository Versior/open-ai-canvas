import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import {
    ECOMMERCE_TEARDOWN_DIMENSIONS,
    buildEcommerceTeardownPrompt,
    createEcommerceTeardown,
    createEcommerceTeardownFinding,
    createEcommerceTeardownOutlineRow,
    ecommerceTeardownDimensionLabel,
    ecommerceTeardownSourceNode,
    type EcommerceTeardown,
    type EcommerceTeardownDimension,
    type EcommerceTeardownOutlineRow,
} from "@/lib/ecommerce/ecommerce-teardown";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type TeardownNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/** 竞品图的判定：必须是带内容的图片节点。 */
function isImageNode(node: CanvasNodeData) {
    return getNodeResourceKind(node) === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

/**
 * 竞品拆解节点——把别人的详情页拆成一张可执行的大纲。
 *
 * 这是调研里最清楚的断层：头部工具全都只做到「风格复刻」，输出的还是一张图；
 * 运营真正要的是**结构**——竞品第一屏讲什么、卖点按什么顺序排、信任背书放在第几屏。
 *
 * 卡片分成两段，因为这是两种不同的东西：
 * - 上面是**拆出来的结论**（竞品怎么做的）
 * - 下面是**我方大纲**（我们要怎么做），每行可以选「跟着做」或「反着来」
 *
 * 反着来那一栏是关键：拆解的目的从来不是照抄，是找差异化的位置。
 */
export function TeardownNodeContent({ node, theme }: TeardownNodeContentProps) {
    const { updateMetadata, reversePromptFromNode } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [editing, setEditing] = useState(false);

    const teardown: EcommerceTeardown = node.metadata?.ecommerceTeardown || createEcommerceTeardown(node.title || "未命名拆解");
    const editable = Boolean(updateMetadata);
    const source = upstream.find(isImageNode);

    const patch = (next: Partial<EcommerceTeardown>) => updateMetadata?.(node.id, { ecommerceTeardown: { ...teardown, ...next } });
    const commitOutline = (next: EcommerceTeardownOutlineRow[]) => patch({ outline: next });

    const findings = teardown.findings.filter((finding) => finding.finding.trim());
    const outline = teardown.outline.filter((row) => row.title.trim());
    const follow = outline.filter((row) => row.stance === "follow").length;

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><Search className="size-3.5" /></span>
                    <span>电商 / 竞品拆解</span>
                </div>
                <span className="ecom-card-status">{findings.length} 条结论</span>
            </header>

            <EcommerceNodeTitle node={node} fallback="未命名拆解" subtitle="拆的是结构，不是画面" />

            {source?.metadata?.content ? (
                <div className="ecom-teardown-source">
                    <img src={source.metadata.content} alt="" draggable={false} />
                    <span className="ecom-replica-slot-tag">竞品图</span>
                </div>
            ) : (
                <div className="ecom-teardown-source ecom-teardown-source-empty">
                    <span className="ecom-replica-slot-label">连一张竞品详情页或主图</span>
                </div>
            )}

            <div className="ecom-point-list thin-scrollbar">
                {findings.length ? findings.map((finding, index) => (
                    <div key={finding.id} className="ecom-point">
                        <span className="ecom-point-index">{index + 1}</span>
                        <span className="ecom-point-body">
                            <span className="ecom-point-claim">{ecommerceTeardownDimensionLabel(finding.dimension)}</span>
                            <span className="ecom-point-evidence">{finding.finding.trim()}</span>
                        </span>
                    </div>
                )) : (
                    <p className="ecom-card-stage-empty" style={{ textAlign: "left", padding: 0 }}>
                        还没有结论。连上竞品图后点「拆解」，模型按勾选的维度读图，只描述结构、不复述它的文案。
                    </p>
                )}
            </div>

            {outline.length ? (
                <div className="ecom-teardown-outline">
                    <span className="ecom-field-label">我方大纲 · {outline.length} 屏</span>
                    {outline.map((row) => (
                        <div key={row.id} className="ecom-teardown-outline-row">
                            <span className="ecom-teardown-outline-title">{row.title.trim()}</span>
                            <span className="ecom-teardown-stance" data-stance={row.stance}>{row.stance === "follow" ? "跟着做" : "反着来"}</span>
                        </div>
                    ))}
                </div>
            ) : null}

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-field">
                        <span className="ecom-field-label">拆解维度</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_TEARDOWN_DIMENSIONS.map((dimension) => (
                                <button
                                    key={dimension.id}
                                    type="button"
                                    className="ecom-chip"
                                    aria-pressed={teardown.dimensions.includes(dimension.id)}
                                    title={dimension.hint}
                                    onClick={() => {
                                        const has = teardown.dimensions.includes(dimension.id);
                                        patch({ dimensions: has ? teardown.dimensions.filter((item) => item !== dimension.id) : [...teardown.dimensions, dimension.id] });
                                    }}
                                >
                                    {dimension.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">结论</span>
                        {teardown.findings.map((finding) => (
                            <div key={finding.id} className="ecom-chip-row">
                                <select
                                    className="ecom-field-input w-auto py-0.5"
                                    value={finding.dimension}
                                    aria-label="拆解维度"
                                    onChange={(event) => patch({ findings: teardown.findings.map((item) => (item.id === finding.id ? { ...item, dimension: event.target.value as EcommerceTeardownDimension } : item)) })}
                                >
                                    {ECOMMERCE_TEARDOWN_DIMENSIONS.map((dimension) => <option key={dimension.id} value={dimension.id}>{dimension.label}</option>)}
                                </select>
                                <textarea
                                    className="ecom-field-input thin-scrollbar"
                                    rows={2}
                                    value={finding.finding}
                                    placeholder="竞品在这一维度是怎么做的"
                                    onChange={(event) => patch({ findings: teardown.findings.map((item) => (item.id === finding.id ? { ...item, finding: event.target.value } : item)) })}
                                />
                                <button type="button" className="ecom-chip" aria-label="删除这条结论" onClick={() => patch({ findings: teardown.findings.filter((item) => item.id !== finding.id) })}>
                                    <Trash2 className="size-3" />
                                </button>
                            </div>
                        ))}
                        <button type="button" className="ecom-action" onClick={() => patch({ findings: [...teardown.findings, createEcommerceTeardownFinding()] })}>
                            <Plus className="size-3" />
                            加一条结论
                        </button>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">我方大纲 · 每行一屏</span>
                        {teardown.outline.map((row, index) => (
                            <div key={row.id} className="ecom-teardown-outline-editor">
                                <input className="ecom-field-input" value={row.title} placeholder={`第 ${index + 1} 屏叫什么`} onChange={(event) => commitOutline(teardown.outline.map((item) => (item.id === row.id ? { ...item, title: event.target.value } : item)))} />
                                <textarea className="ecom-field-input thin-scrollbar" rows={2} value={row.brief} placeholder="这一屏解决什么、放什么内容" onChange={(event) => commitOutline(teardown.outline.map((item) => (item.id === row.id ? { ...item, brief: event.target.value } : item)))} />
                                <div className="ecom-chip-row">
                                    <button type="button" className="ecom-chip" aria-pressed={row.stance === "follow"} onClick={() => commitOutline(teardown.outline.map((item) => (item.id === row.id ? { ...item, stance: "follow" } : item)))}>跟着做</button>
                                    <button type="button" className="ecom-chip" aria-pressed={row.stance === "differentiate"} title="反着来的行不会进提示词——它标记的是我们要和竞品拉开距离的地方" onClick={() => commitOutline(teardown.outline.map((item) => (item.id === row.id ? { ...item, stance: "differentiate" } : item)))}>反着来</button>
                                    <button type="button" className="ecom-chip" aria-label="删除这一屏" onClick={() => commitOutline(teardown.outline.filter((item) => item.id !== row.id))}>
                                        <Trash2 className="size-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button type="button" className="ecom-action" onClick={() => commitOutline([...teardown.outline, createEcommerceTeardownOutlineRow()])}>
                            <Plus className="size-3" />
                            加一屏
                        </button>
                    </div>
                </div>
            ) : null}

            {/* 拆解常驻可见——它是这个节点的目的，藏在「编辑」里等于没有。
                走「读图 → 出结论」的支线：问的是结构大纲，不是生图提示词。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!reversePromptFromNode || !source}
                    title={source ? "助手读这张竞品图，按维度给出结构结论，并列出我方大纲" : "先连一张竞品图"}
                    onClick={() => source && reversePromptFromNode?.(source, buildEcommerceTeardownPrompt(teardown))}
                >
                    <Search className="size-3" />
                    拆解这张竞品图
                </button>
            </div>

            <footer className="ecom-card-footer">
                <span>{outline.length ? <><b>{follow}</b>/<b>{outline.length}</b> 屏跟着做</> : "还没有大纲"}</span>
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
