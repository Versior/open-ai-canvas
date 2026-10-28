import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useNodeInputs } from "@/components/canvas/canvas-node-graph-context";
import {
    ECOMMERCE_TEARDOWN_DIMENSIONS,
    ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE,
    applyEcommerceTeardownDraft,
    buildEcommerceTeardownPlanPrompt,
    createEcommerceTeardown,
    createEcommerceTeardownDraft,
    createEcommerceTeardownFinding,
    createEcommerceTeardownOutlineRow,
    ecommerceTeardownDimensionLabel,
    ecommerceTeardownOutlineToSuiteRows,
    ecommerceTeardownPlanRequest,
    ecommerceTeardownPlanSourceSignature,
    parseEcommerceTeardownPlan,
    type EcommerceTeardown,
    type EcommerceTeardownDimension,
    type EcommerceTeardownDraft,
    type EcommerceTeardownOutlineRow,
} from "@/lib/ecommerce/ecommerce-teardown";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type TeardownNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/** 竞品图的判定：必须是带内容的图片节点。 */
function isImageNode(node: CanvasNodeData) {
    return getNodeResourceKind(node) === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

type TeardownPlanSource = {
    targetNodeId: string;
    referenceImageId: string;
    productNodeId?: string;
    signature: string;
};

function teardownPlanSource(node: CanvasNodeData | undefined) {
    return (node?.metadata as (CanvasNodeMetadata & { ecommerceTeardownPlanSource?: TeardownPlanSource }) | undefined)?.ecommerceTeardownPlanSource;
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
    const { updateMetadata, reversePromptFromNode, openEcommerceTableFromOutline } = useCanvasNodeActions();
    const inputs = useNodeInputs(node.id);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<EcommerceTeardownDraft>();

    const teardown: EcommerceTeardown = node.metadata?.ecommerceTeardown || createEcommerceTeardown(node.title || "未命名拆解");
    const editable = Boolean(updateMetadata);
    const source = inputs.find(isImageNode);
    const product = inputs.find((item) => item.type === CanvasNodeType.Product);
    const planResult = [...inputs].reverse().find((item) => item.type === CanvasNodeType.Text && item.title === ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE);
    const planResultContent = planResult?.metadata?.status === "success" ? planResult.metadata.content?.trim() || "" : "";
    const parsedPlan = useMemo(() => parseEcommerceTeardownPlan(planResultContent, teardown.dimensions), [planResultContent, teardown.dimensions]);
    const currentSourceSignature = source ? ecommerceTeardownPlanSourceSignature({ target: node, referenceImage: source, product }) : "";
    const resultSource = teardownPlanSource(planResult);
    const resultStale = Boolean(
        planResultContent &&
            (!resultSource ||
                resultSource.targetNodeId !== node.id ||
                resultSource.referenceImageId !== source?.id ||
                resultSource.productNodeId !== product?.id ||
                resultSource.signature !== currentSourceSignature),
    );
    const currentDraftSourceSignature = JSON.stringify([currentSourceSignature, planResult?.id || "", planResultContent]);
    const draftStale = Boolean(draft && draft.sourceSignature !== currentDraftSourceSignature);

    const patch = (next: Partial<EcommerceTeardown>) => updateMetadata?.(node.id, { ecommerceTeardown: { ...teardown, ...next } });
    const commitOutline = (next: EcommerceTeardownOutlineRow[]) => patch({ outline: next });
    const loadDraft = () => {
        if (!parsedPlan || resultStale) return;
        setDraft(createEcommerceTeardownDraft(parsedPlan, currentDraftSourceSignature));
    };
    const applyDraft = () => {
        if (!draft || draftStale) return;
        patch(applyEcommerceTeardownDraft(teardown, draft));
        setDraft(undefined);
    };

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
                    disabled={!reversePromptFromNode || !source || !teardown.dimensions.length}
                    title={!source ? "先连一张竞品图" : !teardown.dimensions.length ? "至少选择一个拆解维度" : "助手读这张竞品图，按维度给出结构结论，并列出我方大纲"}
                    onClick={() => source && teardown.dimensions.length && reversePromptFromNode?.(source, ecommerceTeardownPlanRequest(node.id, buildEcommerceTeardownPlanPrompt(teardown)))}
                >
                    <Search className="size-3" />
                    拆解这张竞品图
                </button>
                <button
                    type="button"
                    className="ecom-action"
                    disabled={!openEcommerceTableFromOutline || !product || !outline.length}
                    title={!product ? "先连接目标商品" : !outline.length ? "先完成我方详情页大纲" : "写入已有详情页创作表前会再次确认是否替换"}
                    onClick={() => product && openEcommerceTableFromOutline?.(node, product, ecommerceTeardownOutlineToSuiteRows(outline))}
                >
                    写入详情页创作表
                </button>
            </div>

            {planResultContent ? (
                <>
                    {resultStale || draftStale ? (
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>方案已过期：商品、竞品图、拆解维度或拆解结果已变化，请重新载入或拆解。</span>
                    ) : !parsedPlan ? (
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>拆解结果不是完整方案，请回到结果节点修正 JSON 或重试。</span>
                    ) : draft ? (
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>已载入草稿：{draft.findings.length} 条结论 / {draft.outline.length} 屏。确认前不会覆盖当前内容。</span>
                    ) : (
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>已收到结构化方案。先载入草稿检查，再确认替换当前内容。</span>
                    )}
                    <div className="ecom-action-row">
                        <button type="button" className="ecom-action" disabled={!parsedPlan || resultStale} onClick={loadDraft}>
                            载入最新拆解
                        </button>
                        <button
                            type="button"
                            className="ecom-action ecom-action-primary"
                            disabled={!draft || draftStale}
                            title={draft && !draftStale ? "确认后替换当前结论与大纲" : draftStale ? "商品、竞品图、拆解维度或拆解结果已变化，请重新载入或拆解" : "先载入有效的最新拆解"}
                            onClick={applyDraft}
                        >
                            确认应用{draft ? `（${draft.findings.length} 条 / ${draft.outline.length} 屏）` : ""}
                        </button>
                    </div>
                </>
            ) : null}

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
