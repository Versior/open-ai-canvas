import { ChevronDown, Copy as CopyIcon, LoaderCircle, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { compileEcommercePrompt } from "@/lib/ecommerce/ecommerce-contract";
import {
    ECOMMERCE_REPLICA_ASPECTS,
    ECOMMERCE_REPLICA_FIDELITIES,
    ECOMMERCE_REPLICA_NEVER,
    ECOMMERCE_REPLICA_PURPOSES,
    createEcommerceReplica,
    ecommerceReplicaReferenceNode,
    ecommerceReplicaReady,
    type EcommerceReplica,
    type EcommerceReplicaAspect,
    type EcommerceReplicaFidelity,
    type EcommerceReplicaPurpose,
} from "@/lib/ecommerce/ecommerce-replica";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
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
    const { updateMetadata, generateEcommerceNode } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [editing, setEditing] = useState(false);
    const [generating, setGenerating] = useState(false);

    const replica: EcommerceReplica = node.metadata?.ecommerceReplica || createEcommerceReplica(node.title || "未命名复刻");
    const editable = Boolean(updateMetadata);
    const reference = ecommerceReplicaReferenceNode(node.id, upstream, []);
    // 上游里除参考图之外的图片，就是我们要复刻进去的自有商品图
    const productImages = upstream.filter((item) => getNodeResourceKind(item) === "image" && item.id !== reference?.id && (item.metadata?.content || item.metadata?.storageKey));
    const ready = ecommerceReplicaReady(replica) && Boolean(reference) && productImages.length > 0;

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
            await generateEcommerceNode(node, "image", compileEcommercePrompt({ replica }));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><CopyIcon className="size-3.5" /></span>
                    <span>电商 / 爆款复刻</span>
                </div>
                <span className="ecom-card-status">{compose ? "溶图" : fidelity?.label || "借鉴"}</span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名复刻"
                subtitle={compose ? "把自己的商品放进这张场景图里" : "复刻的是爆款公式，不是画面"}
            />

            <div className="ecom-replica-pair">
                <div className="ecom-replica-slot" data-filled={reference ? "true" : "false"}>
                    {reference?.metadata?.content
                        ? <img src={reference.metadata.content} alt="" draggable={false} />
                        : <span className="ecom-replica-slot-label">参考图</span>}
                    <span className="ecom-replica-slot-tag">{compose ? "给场景" : "给结构"}</span>
                </div>
                <div className="ecom-replica-slot" data-filled={productImages.length ? "true" : "false"}>
                    {productImages[0]?.metadata?.content
                        ? <img src={productImages[0].metadata.content} alt="" draggable={false} />
                        : <span className="ecom-replica-slot-label">商品图</span>}
                    <span className="ecom-replica-slot-tag">给主体</span>
                </div>
            </div>

            <div className="ecom-replica-aspects">
                {ECOMMERCE_REPLICA_ASPECTS.map((aspect) => (
                    <span key={aspect.id} className="ecom-chip" data-on={replica.aspects.includes(aspect.id) ? "true" : "false"} title={aspect.hint}>
                        {aspect.label}
                    </span>
                ))}
            </div>

            {compose ? (
                <div className="ecom-replica-never">
                    <span className="ecom-replica-never-title"><ShieldAlert className="size-3" /> 溶图要贴合</span>
                    <span className="ecom-replica-never-item">光线方向与场景一致</span>
                    <span className="ecom-replica-never-item">接触阴影与倒影不能少</span>
                    <span className="ecom-replica-never-item">色温与透视要跟上</span>
                </div>
            ) : (
                <div className="ecom-replica-never">
                    <span className="ecom-replica-never-title"><ShieldAlert className="size-3" /> 绝对不复刻</span>
                    {ECOMMERCE_REPLICA_NEVER.map((item) => <span key={item} className="ecom-replica-never-item">{item}</span>)}
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
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>{fidelity?.hint}</span>
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
                        <textarea className="ecom-field-input thin-scrollbar" rows={3} value={replica.notes} placeholder={compose ? "木质桌面，窗外自然光从左上进来；台面有轻微反射；色温偏暖" : "商品偏左占四成，右侧竖排文字区；主光右上 45°；背景是浅灰到白的渐变"} onChange={(event) => patch({ notes: event.target.value })} />
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
                    title={ready ? (compose ? "把场景与商品锁定编译成提示词，交给图片模型合成" : "把复刻公式与商品锁定编译成提示词，交给图片模型出图") : !reference ? (compose ? "先连一张场景图——它给底" : "先连一张参考图——它给结构") : !productImages.length ? "再连一张自己的商品图——它给主体" : "复刻维度还没勾"}
                    onClick={() => void generate()}
                >
                    {generating ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {generating ? "提交中…" : compose ? "合成溶图" : "生成复刻图"}
                </button>
            </div>

            <footer className="ecom-card-footer">
                <span>{reference ? (productImages.length ? <>复刻 <b>{replica.aspects.length}</b> 个维度</> : "缺商品图") : "缺参考图"}</span>
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
