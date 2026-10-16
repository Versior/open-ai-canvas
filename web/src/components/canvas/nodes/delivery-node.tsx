import { App } from "antd";
import { ChevronDown, Download, Layers, LoaderCircle, PackageCheck, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import {
    createEcommerceDelivery,
    createEcommerceDeliveryTarget,
    ecommerceDeliveryCsv,
    ecommerceDeliveryFileName,
    ecommerceDeliveryManifestName,
    ecommerceDeliverySummary,
    ecommerceNextVersion,
    type EcommerceDelivery,
    type EcommerceDeliveryEntry,
} from "@/lib/ecommerce/ecommerce-delivery";
import {
    ECOMMERCE_PLATFORMS,
    checkImageAgainstSpec,
    ecommerceRoleSpec,
    type EcommerceImageRole,
    type EcommercePlatformId,
} from "@/lib/ecommerce/ecommerce-platform-specs";
import { rasterizeEcommerceDetailPage } from "@/lib/ecommerce/ecommerce-rasterize";
import { ecommerceSliceSpec, type EcommerceSlicePlatform } from "@/lib/ecommerce/ecommerce-slice";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { imageToDataUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type DeliveryNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/** 交付节点的上游图：带内容的图片节点。 */
function isImageNode(node: CanvasNodeData) {
    return getNodeResourceKind(node) === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

/**
 * 交付节点——出图之后到上架之前的那一段。
 *
 * 调研里最一致的发现：AI 工具在「生」上卷得厉害，但设计师的钱和时间花在
 * 改、套、配、审、名、装、传上。这一段目前全靠人肉：命名规范是纯 SOP 教育，
 * 版本号靠「最终版/最终版2/打死不改版」，平台校验是事后独立扫描，
 * 而不合规会直接导致 listing 被压制。
 *
 * 卡片就干三件事：**汇总这一套图 → 逐张按平台校验 → 按规范命名**，
 * 最后导出一份能直接核对的清单。不替代上传（平台 API 各有门槛），
 * 但把「能不能上架」在导出前说清楚。
 */
export function DeliveryNodeContent({ node, theme }: DeliveryNodeContentProps) {
    const { updateMetadata, exportEcommerceDetailPage } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [editing, setEditing] = useState(false);
    const [stitching, setStitching] = useState(false);

    const delivery: EcommerceDelivery = node.metadata?.ecommerceDelivery || createEcommerceDelivery(node.title || "未命名交付");
    const editable = Boolean(updateMetadata);
    const images = upstream.filter(isImageNode);

    const { message } = App.useApp();

    const patch = (next: Partial<EcommerceDelivery>) => updateMetadata?.(node.id, { ecommerceDelivery: { ...delivery, ...next } });

    /**
     * 每个目标各出一份清单——同一张图发淘宝和发亚马逊，文件名和校验都不一样。
     * 尺寸与字节数从节点自己的记录里取；取不到就留 undefined，校验会跳过对应项。
     */
    const entriesByTarget = useMemo(() => delivery.targets.map((target) => {
        const entries: EcommerceDeliveryEntry[] = images.map((image, index) => {
            const facts = { width: image.width, height: image.height, bytes: undefined as number | undefined };
            return {
                nodeId: image.id,
                title: image.title || image.id,
                fileName: ecommerceDeliveryFileName(delivery, target, index + 1, image.metadata?.ecommerceShotId ? undefined : image.title || undefined),
                width: facts.width,
                height: facts.height,
                issues: checkImageAgainstSpec({ platformId: target.platformId, role: target.role, facts }).map((issue) => ({ ...issue, targetId: target.id })),
            };
        });
        return { target, entries };
    }), [delivery, images]);

    const summary = ecommerceDeliverySummary(entriesByTarget.flatMap((group) => group.entries));

    /** 详情页切片只支持有单图尺寸上限的平台。 */
    const slidable = Boolean(ecommerceSliceSpec(delivery.targets[0]?.platformId as EcommerceSlicePlatform));

    /**
     * 一键详情页。
     *
     * 拼长图与切片都是纯装配，不经过模型——九屏图已经出好了，交给模型它只会重画，
     * 商品就不一致了。切点优先落在屏与屏之间（那里天然是模块边界，切穿也不伤商品），
     * 挪不动的切点会记进 conflicts 并在卡片上说出来，不静默接受。
     *
     * 产物直接落成画布上的图片节点：用户要的是能上传的片，不是一句「已导出」。
     */
    const stitchDetailPage = async () => {
        if (!exportEcommerceDetailPage || !images.length) return;
        setStitching(true);
        try {
            const urls: string[] = [];
            for (const image of images) {
                urls.push(await imageToDataUrl({ url: image.metadata?.content, storageKey: image.metadata?.storageKey, name: image.title }));
            }
            const platform = (delivery.targets[0]?.platformId as EcommerceSlicePlatform) || "taobao";
            const result = await rasterizeEcommerceDetailPage({ imageUrls: urls, platform, code: delivery.code, version: delivery.version });
            await exportEcommerceDetailPage(node, result.longImage.dataUrl, result.pieces, result.fileNames);
            const adjusted = result.plan.pieces.filter((piece) => piece.adjustedFrom !== undefined).length;
            if (result.plan.conflicts.length) {
                message.warning(`长图 ${result.longImage.height}px 已切成 ${result.pieces.length} 片；有 ${result.plan.conflicts.length} 个切点挪不动，可能切穿商品，请人工核对`);
            } else {
                message.success(`已合成 ${result.longImage.height}px 长图并切成 ${result.pieces.length} 片${adjusted ? `（${adjusted} 个切点已挪到屏边界）` : ""}`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "详情页合成失败");
        } finally {
            setStitching(false);
        }
    };

    const downloadManifest = () => {        const groups = entriesByTarget.filter((group) => group.entries.length);
        if (!groups.length) return;
        const platformName = (platformId: EcommercePlatformId) => ECOMMERCE_PLATFORMS.find((platform) => platform.id === platformId)?.name || platformId;
        const csv = groups
            .flatMap((group) => [`# 平台：${platformName(group.target.platformId)}`, ecommerceDeliveryCsv(group.entries).trimEnd(), ""])
            .join("\r\n");
        // 加 BOM，否则 Excel 打开中文是乱码——这一条是交付件能不能用的分水岭
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = ecommerceDeliveryManifestName(delivery);
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><PackageCheck className="size-3.5" /></span>
                    <span>电商 / 交付</span>
                </div>
                <span className={summary.blocked ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    v{delivery.version}
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名交付"
                subtitle={`${delivery.code.trim() ? `编码 ${delivery.code.trim()}` : "还没填商品编码，文件名会是 ITEM"} · ${delivery.targets.length} 个目标`}
            />

            <div className="ecom-delivery-summary">
                <span className="ecom-delivery-stat" data-tone="clean"><b>{summary.clean}</b> 通过</span>
                <span className="ecom-delivery-stat" data-tone="warn"><b>{summary.warned}</b> 警告</span>
                <span className="ecom-delivery-stat" data-tone="block"><b>{summary.blocked}</b> 拦截</span>
            </div>

            <div className="ecom-point-list thin-scrollbar">
                {entriesByTarget.map(({ target, entries }) => {
                    const platform = ECOMMERCE_PLATFORMS.find((item) => item.id === target.platformId);
                    const spec = ecommerceRoleSpec(target.platformId, target.role);
                    return (
                        <div key={target.id} className="ecom-delivery-group">
                            <span className="ecom-delivery-group-head">
                                <span className="ecom-field-label">{platform?.name || target.platformId} · {spec?.label || target.role}</span>
                                <span className="ecom-card-status">{entries.length} 张</span>
                            </span>
                            {entries.length ? entries.map((entry) => (
                                <span key={entry.nodeId} className="ecom-delivery-entry" data-blocked={entry.issues.some((issue) => issue.level === "block") ? "true" : "false"}>
                                    <span className="ecom-delivery-entry-name">{entry.fileName}</span>
                                    {entry.issues.length ? (
                                        <span className="ecom-delivery-entry-issues">
                                            {entry.issues.slice(0, 2).map((issue, index) => <span key={index}>{issue.message}</span>)}
                                        </span>
                                    ) : <span className="ecom-delivery-entry-ok">通过</span>}
                                </span>
                            )) : <span className="ecom-card-stage-empty" style={{ textAlign: "left", padding: 0 }}>这一套还没有图</span>}
                        </div>
                    );
                })}
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <label className="ecom-field">
                        <span className="ecom-field-label">商品编码 · 进文件名</span>
                        <input className="ecom-field-input" value={delivery.code} placeholder="A001" onChange={(event) => patch({ code: event.target.value })} />
                    </label>

                    <div className="ecom-field">
                        <span className="ecom-field-label">版本 · 只增不减</span>
                        <div className="ecom-chip-row">
                            <span className="ecom-chip" data-on="true">v{delivery.version}</span>
                            <button type="button" className="ecom-chip" title="行业硬规矩：禁用「最终版」，版本号作废不复用" onClick={() => patch({ version: ecommerceNextVersion(delivery.version) })}>
                                升到 v{ecommerceNextVersion(delivery.version)}
                            </button>
                        </div>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">交付目标</span>
                        {delivery.targets.map((target) => (
                            <div key={target.id} className="ecom-chip-row">
                                <select
                                    className="ecom-field-input w-auto py-0.5"
                                    value={target.platformId}
                                    aria-label="平台"
                                    onChange={(event) => patch({ targets: delivery.targets.map((item) => (item.id === target.id ? { ...item, platformId: event.target.value as EcommercePlatformId, role: firstRole(event.target.value as EcommercePlatformId) } : item)) })}
                                >
                                    {ECOMMERCE_PLATFORMS.map((platform) => <option key={platform.id} value={platform.id}>{platform.name}</option>)}
                                </select>
                                <select
                                    className="ecom-field-input w-auto py-0.5"
                                    value={target.role}
                                    aria-label="位置"
                                    onChange={(event) => patch({ targets: delivery.targets.map((item) => (item.id === target.id ? { ...item, role: event.target.value as EcommerceImageRole } : item)) })}
                                >
                                    {rolesOf(target.platformId).map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
                                </select>
                                <button type="button" className="ecom-chip" aria-label="删除这个目标" onClick={() => patch({ targets: delivery.targets.filter((item) => item.id !== target.id) })}>
                                    <Trash2 className="size-3" />
                                </button>
                            </div>
                        ))}
                        <button type="button" className="ecom-action" onClick={() => patch({ targets: [...delivery.targets, createEcommerceDeliveryTarget()] })}>
                            <Plus className="size-3" />
                            加一个目标
                        </button>
                    </div>

                </div>
            ) : null}

            {/* 导出常驻可见——出图之后到上架之前这一段，交付清单是唯一的产物 */}
            {/* 一键详情页：一屏一屏的图 → 一张长图 → 按平台上限切好的片。
                交付时平台限制的是单图尺寸，详情长图必须切成多张上传；这段原本
                全靠人肉（拼图软件 + 手动量切点 + 还要避开切穿商品）。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!images.length || stitching || !slidable}
                    title={!images.length ? "先连入这一套图" : !slidable ? "当前平台不支持详情页切片" : `把 ${images.length} 张图拼成一张长图，按平台上限切好并导出`}
                    onClick={() => void stitchDetailPage()}
                >
                    {stitching ? <LoaderCircle className="size-3 animate-spin" /> : <Layers className="size-3" />}
                    {stitching ? "合成中…" : "一键详情页"}
                </button>
                <button type="button" className="ecom-action ecom-action-primary" disabled={!images.length} onClick={downloadManifest}>
                    <Download className="size-3" />
                    导出交付清单 CSV
                </button>
            </div>

            <footer className="ecom-card-footer">
                <span>{images.length ? <><b>{images.length}</b> 张图</> : "还没有连图"}</span>
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

function rolesOf(platformId: EcommercePlatformId) {
    const platform = ECOMMERCE_PLATFORMS.find((item) => item.id === platformId);
    return Object.entries(platform?.roles || {}).map(([id, spec]) => ({ id: id as EcommerceImageRole, label: spec!.label }));
}

function firstRole(platformId: EcommercePlatformId): EcommerceImageRole {
    return rolesOf(platformId)[0]?.id || "main";
}
