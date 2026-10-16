import { ChevronDown, History, LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useDownstreamNodes, useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import {
    ECOMMERCE_REVISION_KINDS,
    createEcommerceRevision,
    ecommerceCurrentRevision,
    ecommerceNextRevisionVersion,
    ecommerceRevisionBlocked,
    ecommerceRevisionChain,
    ecommerceRevisionHasBranches,
    ecommerceRevisionIssues,
    ecommerceRevisionLabel,
    ecommerceRevisionNeedsRegion,
    ecommerceRevisionPrompt,
    ecommerceSwitchCurrentRevision,
    type EcommerceRevision,
    type EcommerceRevisionKind,
} from "@/lib/ecommerce/ecommerce-revision";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type RevisionNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

function isImageNode(node: CanvasNodeData) {
    return getNodeResourceKind(node) === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

/**
 * 改稿节点——一张图的版本链。
 *
 * 这一块不生成任何东西。它解决的是调研里排第一的痛点：**改稿没有版本记录**。
 * 运营说「回到上一版」，设计师只能凭记忆重做；文件名排到「最终版2打死不改版」。
 *
 * 卡片主体是**版本链本身**：每一版一行，写着改了什么、从哪一版改的、是不是当前采用的。
 * 点一行就切到那一版——「回到上一版」在这里是把旧版标成当前，**不删后面的版本**，
 * 因为运营可能改主意又要回来，而且它们记录了走过的弯路。
 *
 * 改动说明是**必填**的。没有说明的版本链等于没有版本链——两周后连自己都记不得
 * v3 和 v4 差在哪。
 */
export function RevisionNodeContent({ node, theme }: RevisionNodeContentProps) {
    const { updateMetadata, generateEcommerceNode } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const downstream = useDownstreamNodes(node.id);
    const [editing, setEditing] = useState(false);
    const [generating, setGenerating] = useState(false);

    const revisions = node.metadata?.ecommerceRevisions || [];
    const editable = Boolean(updateMetadata);
    // 版本链要认领的图来自两头：连进来的成品图，以及这个节点自己生成的下一版（落在下游）。
    // 只读上游的话，用户出完图回来会发现下拉框里没有刚出的那张。
    const seen = new Set<string>();
    const images = [...upstream, ...downstream].filter((item) => isImageNode(item) && !seen.has(item.id) && seen.add(item.id));
    const chain = ecommerceRevisionChain(revisions);
    const current = ecommerceCurrentRevision(revisions);
    const issues = ecommerceRevisionIssues(revisions);

    /**
     * 待生成的那一版：写了改动说明、但还不是当前版的最新一版。
     *
     * 版本链是「记录」，出图是「动作」——两者靠这条对上：写完说明就是待生成，
     * 出完图把它指到新图上。没有待生成的版本时按钮不给点，而不是拿当前版的说明重跑一遍。
     */
    const pending = [...revisions].reverse().find((item) => !item.current && item.change.trim());

    const patch = (next: EcommerceRevision[]) => updateMetadata?.(node.id, { ecommerceRevisions: next });
    const imageById = new Map(images.map((image) => [image.id, image]));

    const startChain = (imageNodeId: string) => {
        patch([createEcommerceRevision({ version: 1, kind: "first", change: "初版", basedOn: null, imageNodeId })]);
    };

    /**
     * 出下一版。
     *
     * 改动说明本身就是提示词——区域编辑还会带上「其余部分逐像素保持原样」，
     * 那是改稿最要紧的一句：模型很容易顺手把整张图重画了。
     * 当前版的图由生成链路自动接成参考图。
     */
    const generate = async () => {
        if (!generateEcommerceNode || !pending) return;
        setGenerating(true);
        try {
            await generateEcommerceNode(node, "image", ecommerceRevisionPrompt(pending));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><History className="size-3.5" /></span>
                    <span>电商 / 改稿</span>
                </div>
                <span className={ecommerceRevisionBlocked(issues) ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {chain.length ? `v${current?.version ?? chain.length}` : "未开始"}
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="改稿"
                subtitle={chain.length ? `共 ${chain.length} 版，当前 v${current?.version ?? "?"}` : "连入一张成品图，从初版开始记"}
            />

            {current ? (
                <div className="ecom-card-stage" style={{ padding: 8 }}>
                    <div className="ecom-revision-stage">
                        {imageById.get(current.imageNodeId)?.metadata?.content
                            ? <img src={imageById.get(current.imageNodeId)!.metadata!.content} alt="" draggable={false} />
                            : <span className="ecom-card-stage-empty">当前版本对应的图已不在画布上</span>}
                        <span className="ecom-revision-badge">{ecommerceRevisionLabel(current)}</span>
                    </div>
                </div>
            ) : null}

            <div className="ecom-revision-chain thin-scrollbar">
                {chain.length ? chain.map((revision) => {
                    const kind = ECOMMERCE_REVISION_KINDS.find((item) => item.id === revision.kind);
                    const branched = ecommerceRevisionHasBranches(chain, revision.id);
                    return (
                        <button
                            key={revision.id}
                            type="button"
                            className="ecom-revision-row"
                            data-current={revision.current ? "true" : "false"}
                            onClick={() => patch(ecommerceSwitchCurrentRevision(revisions, revision.id))}
                            title={revision.change.trim() || "没有写改了什么"}
                        >
                            <span className="ecom-revision-version">v{revision.version}</span>
                            <span className="ecom-revision-body">
                                <span className="ecom-revision-change">{revision.change.trim() || "（没有写改了什么）"}</span>
                                <span className="ecom-revision-meta">
                                    {kind?.label || revision.kind}
                                    {revision.basedOn ? ` · 基于 v${chain.find((item) => item.id === revision.basedOn)?.version ?? "?"}` : ""}
                                    {branched ? " · 已被后续版本取代" : ""}
                                </span>
                            </span>
                            {revision.current ? <span className="ecom-revision-current">当前</span> : null}
                        </button>
                    );
                }) : (
                    <p className="ecom-card-stage-empty" style={{ textAlign: "left", padding: 0 }}>
                        {images.length ? "还没有版本记录。点「编辑」从初版开始。" : "先连入一张成品图。"}
                    </p>
                )}
            </div>

            {issues.length ? (
                <div className="ecom-info-issues">
                    {issues.slice(0, 2).map((issue, index) => (
                        <span key={index} className="ecom-card-subtitle" style={{ whiteSpace: "normal", color: issue.level === "block" ? "#d97706" : undefined }}>{issue.message}</span>
                    ))}
                </div>
            ) : null}

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-field">
                        <span className="ecom-field-label">从一张图开始记</span>
                        <div className="ecom-chip-row">
                            {images.length ? images.map((image) => (
                                <button key={image.id} type="button" className="ecom-chip" onClick={() => startChain(image.id)}>
                                    {chain.length ? "重开链条 · " : "初版 · "}{image.title || image.id}
                                </button>
                            )) : <span className="ecom-card-status">还没有连入成品图</span>}
                        </div>
                    </div>

                    {chain.length ? (
                        <>
                            <div className="ecom-field">
                                <span className="ecom-field-label">基于哪一版接着改</span>
                                <div className="ecom-chip-row">
                                    {chain.map((revision) => (
                                        <button
                                            key={revision.id}
                                            type="button"
                                            className="ecom-chip"
                                            onClick={() => {
                                                const imageNodeId = images[0]?.id || revision.imageNodeId;
                                                const next = createEcommerceRevision({ version: ecommerceNextRevisionVersion(revisions), kind: "local", change: "", basedOn: revision.id, imageNodeId });
                                                patch([...revisions.map((item) => ({ ...item, current: false })), next]);
                                            }}
                                        >
                                            从 v{revision.version} 分叉
                                        </button>
                                    ))}
                                </div>
                                <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                                    分叉不会删掉后面的版本——它们记录了走过的弯路，而且运营可能改主意又要回来。
                                </span>
                            </div>

                            <div className="ecom-field">
                                <span className="ecom-field-label">每一版改了什么（必填）</span>
                                {chain.map((revision) => (
                                    <div key={revision.id} className="ecom-chip-row">
                                        <span className="ecom-revision-version">v{revision.version}</span>
                                        <select
                                            className="ecom-field-input w-auto py-0.5"
                                            value={revision.kind}
                                            aria-label={`v${revision.version} 改动类型`}
                                            onChange={(event) => patch(revisions.map((item) => (item.id === revision.id ? { ...item, kind: event.target.value as EcommerceRevisionKind } : item)))}
                                        >
                                            {ECOMMERCE_REVISION_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                                        </select>
                                        <textarea
                                            className="ecom-field-input thin-scrollbar"
                                            rows={2}
                                            value={revision.change}
                                            placeholder={ecommerceRevisionNeedsRegion(revision.kind) ? "把杯盖的 Logo 改小一点，其余不动" : "换了浅灰背景，商品与光位不动"}
                                            onChange={(event) => patch(revisions.map((item) => (item.id === revision.id ? { ...item, change: event.target.value } : item)))}
                                        />
                                        <select
                                            className="ecom-field-input w-auto py-0.5"
                                            value={revision.imageNodeId}
                                            aria-label={`v${revision.version} 对应的图`}
                                            onChange={(event) => patch(revisions.map((item) => (item.id === revision.id ? { ...item, imageNodeId: event.target.value } : item)))}
                                        >
                                            {images.map((image) => <option key={image.id} value={image.id}>{image.title || image.id}</option>)}
                                        </select>
                                        <button type="button" className="ecom-chip" aria-label={`删除 v${revision.version}`} onClick={() => patch(revisions.filter((item) => item.id !== revision.id))}>
                                            <Trash2 className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}

            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!generateEcommerceNode || !pending || generating}
                    title={!chain.length ? "先从一张成品图开始记初版" : !pending ? "在「每一版改了什么」里写一条还没生成的改动，它就是下一版的提示词" : `按 v${pending.version} 的改动说明出图；当前版 v${current?.version ?? "?"} 的图会自动作为参考`}
                    onClick={() => void generate()}
                >
                    {generating ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {generating ? "提交中…" : pending ? `生成 v${pending.version}` : "生成下一版"}
                </button>
            </div>

            <footer className="ecom-card-footer">
                <span>{chain.length ? <>当前 <b>v{current?.version ?? "?"}</b> · 共 {chain.length} 版</> : "还没有版本"}</span>
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
