import { ChevronDown, Copy as CopyIcon, LoaderCircle, Plus, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useNodeConnections, useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { compileEcommercePrompt } from "@/lib/ecommerce/ecommerce-contract";
import {
    ECOMMERCE_REPLICA_ASPECTS,
    ECOMMERCE_REPLICA_FIDELITIES,
    ECOMMERCE_REPLICA_NEVER,
    ECOMMERCE_REPLICA_PURPOSES,
    ECOMMERCE_REPLICA_PRODUCT_HANDLE,
    ECOMMERCE_REPLICA_REFERENCE_HANDLE,
    createEcommerceReplica,
    ecommerceReplicaImageRoleBlock,
    ecommerceReplicaInputIssue,
    ecommerceReplicaInputNodes,
    ecommerceReplicaReady,
    type EcommerceReplica,
    type EcommerceReplicaAspect,
    type EcommerceReplicaFidelity,
    type EcommerceReplicaPurpose,
} from "@/lib/ecommerce/ecommerce-replica";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type ReplicaNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/**
 * 爆款复刻节点——照着别人的图做自己的图。
 *
 * 五家头部产品（美图、稿定、摹小仙、绘蛙、即创）全部押注这件事，已经实质标准化：
 * 双输入，参考图给结构、产品图给主体。
 *
 * 卡片把「不可复刻清单」放在最显眼的位置，而不是折叠进设置里。因为这是这块功能
 * 唯一会出事的地方：抄画面是侵权，平台有图像指纹稽查。清单是常量，不可编辑——
 * 用户把它清空不该是「设置」，是「事故」。
 */
export function ReplicaNodeContent({ node, theme }: ReplicaNodeContentProps) {
    const actions = useCanvasNodeActions();
    const { updateMetadata, generateEcommerceNode } = actions;
    const upstream = useUpstreamNodes(node.id);
    const connections = useNodeConnections(node.id);
    const [editing, setEditing] = useState(false);
    const [generating, setGenerating] = useState(false);

    const replica: EcommerceReplica = node.metadata?.ecommerceReplica || createEcommerceReplica(node.title || "未命名复刻");
    const editable = Boolean(updateMetadata);
    const inputs = ecommerceReplicaInputNodes(node.id, upstream, connections);
    const reference = inputs.referenceImages.length === 1 ? inputs.referenceImages[0] : undefined;
    const product = inputs.productImages.length === 1 ? inputs.productImages[0] : undefined;
    const inputIssue = ecommerceReplicaInputIssue(inputs);
    const ready = ecommerceReplicaReady(replica) && Boolean(reference && product) && !inputIssue;

    const patch = (next: Partial<EcommerceReplica>) => updateMetadata?.(node.id, { ecommerceReplica: { ...replica, ...next } });
    const toggleAspect = (aspect: EcommerceReplicaAspect) => {
        const has = replica.aspects.includes(aspect);
        patch({ aspects: has ? replica.aspects.filter((item) => item !== aspect) : [...replica.aspects, aspect] });
    };

    const fidelity = ECOMMERCE_REPLICA_FIDELITIES.find((item) => item.id === replica.fidelity);
    const compose = replica.purpose === "compose";

    /**
     * 出复刻图。
     *
     * 复刻块是「结构从哪来」，商品锁定块是「主体是谁」——两块必须一起进提示词，
     * 否则模型会把参考图里的商品当成主体，直接抄画面。上游连进来的图由生成链路
     * 自动接成参考图，这里只负责把配置编译成提示词。
     */
    const generate = async () => {
        if (!generateEcommerceNode) return;
        setGenerating(true);
        try {
            const prompt = [compileEcommercePrompt({ replica }), ecommerceReplicaImageRoleBlock(replica, inputs)].filter(Boolean).join("\n\n");
            await generateEcommerceNode(node, "image", prompt);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark">
                        <CopyIcon className="size-3.5" />
                    </span>
                    <span>电商 / 爆款复刻</span>
                </div>
                <span className="ecom-card-status">{compose ? "溶图" : fidelity?.label || "借鉴"}</span>
            </header>

            <EcommerceNodeTitle node={node} fallback="未命名复刻" subtitle={compose ? "把自己的商品放进这张场景图里" : "复刻的是爆款公式，不是画面"} />

            <div className="ecom-replica-pair">
                <ReplicaInputSlot node={node} handle={ECOMMERCE_REPLICA_REFERENCE_HANDLE} label="参考图" tag={compose ? "给场景" : "给结构"} image={reference} editable={editable} />
                <ReplicaInputSlot node={node} handle={ECOMMERCE_REPLICA_PRODUCT_HANDLE} label="商品图" tag="给主体" image={product} editable={editable} />
            </div>

            {inputIssue ? (
                <div className="ecom-replica-never" role="alert">
                    <span className="ecom-replica-never-title">
                        <ShieldAlert className="size-3" /> 输入角色待确认
                    </span>
                    <span className="ecom-replica-never-item">{inputIssue}</span>
                    {editable && actions.disconnectEcommerceInput && inputs.unassignedConnections.length ? (
                        <>
                            <button
                                type="button"
                                className="ecom-action"
                                onClick={() => {
                                    for (const connection of inputs.unassignedConnections) actions.disconnectEcommerceInput?.(node.id, connection.toHandleId || "", connection.fromNodeId);
                                }}
                            >
                                断开全部未分配连线
                            </button>
                            <span className="ecom-card-subtitle">只断开连线，图片节点会保留</span>
                        </>
                    ) : null}
                </div>
            ) : null}

            <div className="ecom-replica-aspects">
                {ECOMMERCE_REPLICA_ASPECTS.map((aspect) => (
                    <span key={aspect.id} className="ecom-chip" data-on={replica.aspects.includes(aspect.id) ? "true" : "false"} title={aspect.hint}>
                        {aspect.label}
                    </span>
                ))}
            </div>

            {compose ? (
                <div className="ecom-replica-never">
                    <span className="ecom-replica-never-title">
                        <ShieldAlert className="size-3" /> 溶图要贴合
                    </span>
                    <span className="ecom-replica-never-item">光线方向与场景一致</span>
                    <span className="ecom-replica-never-item">接触阴影与倒影不能少</span>
                    <span className="ecom-replica-never-item">色温与透视要跟上</span>
                </div>
            ) : (
                <div className="ecom-replica-never">
                    <span className="ecom-replica-never-title">
                        <ShieldAlert className="size-3" /> 绝对不复刻
                    </span>
                    {ECOMMERCE_REPLICA_NEVER.map((item) => (
                        <span key={item} className="ecom-replica-never-item">
                            {item}
                        </span>
                    ))}
                </div>
            )}

            {editing && editable ? (
                <div className="ecom-card-editor">
                    {/* 用途决定整段提示词怎么写：复刻要「不要照搬」，溶图要「尽量贴合」，
                        同一句约束在两边正好相反，所以放在最前面先选。 */}
                    <div className="ecom-field">
                        <span className="ecom-field-label">这张参考图是什么</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_REPLICA_PURPOSES.map((item) => (
                                <button key={item.id} type="button" className="ecom-chip" aria-pressed={replica.purpose === item.id} title={item.hint} onClick={() => patch({ purpose: item.id as EcommerceReplicaPurpose })}>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                            {ECOMMERCE_REPLICA_PURPOSES.find((item) => item.id === replica.purpose)?.hint}
                        </span>
                    </div>

                    {compose ? null : (
                        <div className="ecom-field">
                            <span className="ecom-field-label">复刻强度</span>
                            <div className="ecom-chip-row">
                                {ECOMMERCE_REPLICA_FIDELITIES.map((item) => (
                                    <button key={item.id} type="button" className="ecom-chip" aria-pressed={replica.fidelity === item.id} title={item.hint} onClick={() => patch({ fidelity: item.id as EcommerceReplicaFidelity })}>
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                                {fidelity?.hint}
                            </span>
                        </div>
                    )}

                    {compose ? null : (
                        <div className="ecom-field">
                            <span className="ecom-field-label">复刻维度</span>
                            <div className="ecom-chip-row">
                                {ECOMMERCE_REPLICA_ASPECTS.map((aspect) => (
                                    <button key={aspect.id} type="button" className="ecom-chip" aria-pressed={replica.aspects.includes(aspect.id)} title={aspect.hint} onClick={() => toggleAspect(aspect.id)}>
                                        {aspect.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <label className="ecom-field">
                        <span className="ecom-field-label">{compose ? "场景笔记 · 光线、台面、环境" : "结构笔记 · 从参考图里读出来的"}</span>
                        <textarea
                            className="ecom-field-input thin-scrollbar"
                            rows={3}
                            value={replica.notes}
                            placeholder={compose ? "木质桌面，窗外自然光从左上进来；台面有轻微反射；色温偏暖" : "商品偏左占四成，右侧竖排文字区；主光右上 45°；背景是浅灰到白的渐变"}
                            onChange={(event) => patch({ notes: event.target.value })}
                        />
                    </label>

                    <label className="ecom-field">
                        <span className="ecom-field-label">{compose ? "不要出现" : "额外不复刻项"}</span>
                        <input className="ecom-field-input" value={replica.extraExclude} placeholder={compose ? "例如：改变场景里的其他物品" : "例如：参考图里的模特姿势"} onChange={(event) => patch({ extraExclude: event.target.value })} />
                    </label>
                </div>
            ) : null}

            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!generateEcommerceNode || !ready || generating}
                    title={
                        inputIssue ||
                        (ready
                            ? compose
                                ? "把场景与商品锁定编译成提示词，交给图片模型合成"
                                : "把复刻公式与商品锁定编译成提示词，交给图片模型出图"
                            : !reference
                              ? compose
                                  ? "先连一张场景图——它给底"
                                  : "先连一张参考图——它给结构"
                              : !product
                                ? "再连一张自己的商品图——它给主体"
                                : "复刻维度还没勾")
                    }
                    onClick={() => void generate()}
                >
                    {generating ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {generating ? "提交中…" : compose ? "合成溶图" : "生成复刻图"}
                </button>
            </div>

            <footer className="ecom-card-footer">
                <span>
                    {inputIssue ||
                        (reference ? (
                            product ? (
                                <>
                                    复刻 <b>{replica.aspects.length}</b> 个维度
                                </>
                            ) : (
                                "缺商品图"
                            )
                        ) : (
                            "缺参考图"
                        ))}
                </span>
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
function ReplicaInputSlot({ node, handle, label, tag, image, editable }: { node: CanvasNodeData; handle: string; label: string; tag: string; image?: CanvasNodeData; editable: boolean }) {
    const actions = useCanvasNodeActions();
    const content = image?.metadata?.content;
    const fallback = image ? image.title?.trim() || "已连接" : label;
    return (
        <div
            className="ecom-replica-slot"
            data-filled={image ? "true" : "false"}
            data-ecommerce-input={handle}
            data-product-node-id={node.id}
            onPointerUp={(event) => {
                if (editable) actions.dropEcommerceInput?.(event, node.id, handle);
            }}
        >
            {content ? <img src={content} alt={label} draggable={false} /> : <span className="ecom-replica-slot-label">{fallback}</span>}
            {editable ? (
                <button
                    type="button"
                    className="ecom-input-pin"
                    title={`连接${label}`}
                    aria-label={`连接${label}`}
                    onPointerDown={(event) => {
                        if (event.button === 0) actions.connectEcommerceInput?.(event, node.id, handle);
                    }}
                    onClick={(event) => {
                        if (event.detail === 0) actions.connectEcommerceInput?.(event as unknown as React.PointerEvent, node.id, handle);
                    }}
                >
                    <Plus className="size-3" />
                </button>
            ) : null}
            <span className="ecom-replica-slot-tag">{tag}</span>
        </div>
    );
}
