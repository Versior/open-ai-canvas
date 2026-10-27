import { memo, useMemo, useState } from "react";
import { AlertTriangle, AudioLines, Clock3, FileText, Image, Layers, LoaderCircle, Pencil, Search, X } from "lucide-react";

import { CanvasVideoPreviewImage } from "@/components/canvas/canvas-video-preview-image";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { canvasNodeMaterialSummary, canvasNodeSearchContext, canvasNodeSearchTimes } from "@/lib/canvas/canvas-node-search";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import type { AiConfig } from "@/stores/use-config-store";
import { getNodeIcon, getNodeListLabel } from "@/lib/canvas/node-registry";
import type { CanvasKind } from "@/lib/canvas/canvas-kind";
import { ECOMMERCE_NODE_GROUPS, ecommerceNodeGroup, ecommerceNodeSummary, type EcommerceNodeFlag } from "@/lib/ecommerce/ecommerce-node-summary";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { Video as CanvasVideoIcon } from "lucide-react";

export function CanvasWorkspaceNodeListPanel({
    nodes,
    config,
    results,
    query,
    deferredQuery,
    selectedNodeIds,
    canvasKind = "freeform",
    onQueryChange,
    onFocus,
}: {
    nodes: CanvasNodeData[];
    config: AiConfig;
    results: CanvasNodeData[];
    query: string;
    deferredQuery: string;
    selectedNodeIds: Set<string>;
    canvasKind?: CanvasKind;
    onQueryChange: (value: string) => void;
    onFocus: (nodeId: string) => void;
}) {
    // 「只看没配齐的」——一套上新几十个节点，查漏才是这张表的主要用途。
    const [onlyIncomplete, setOnlyIncomplete] = useState(false);
    const ecommerce = canvasKind === "ecommerce";

    /**
     * 分组只对电商画布做。
     *
     * 电商画布的节点本来就是按阶段铺开的（上→下是事实→成图→收尾），
     * 清单按同一个顺序排，两边的空间位置与列表位置能对上；
     * 自由画布节点类型杂且没有固定阶段，硬分组反而更难找。
     */
    const grouped = useMemo(() => {
        const flagged = results.map((node) => ({ node, summary: ecommerce ? ecommerceNodeSummary(node) : null }));
        const visible = onlyIncomplete ? flagged.filter((item) => item.summary?.incomplete) : flagged;
        if (!ecommerce) return [{ id: "all", label: "", hint: "", items: visible }];
        return ECOMMERCE_NODE_GROUPS
            .map((group) => ({ ...group, items: visible.filter((item) => ecommerceNodeGroup(item.node) === group.id) }))
            .filter((group) => group.items.length);
    }, [ecommerce, onlyIncomplete, results]);

    const incompleteCount = useMemo(
        () => (ecommerce ? results.filter((node) => ecommerceNodeSummary(node).incomplete).length : 0),
        [ecommerce, results],
    );
    const visibleCount = grouped.reduce((total, group) => total + group.items.length, 0);
    // 一批提交十几张时，「还有几张在跑」是用户最想知道的数
    const generatingCount = useMemo(() => results.filter((node) => isCanvasNodeGenerating(node)).length, [results]);

    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
                <Layers className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">画布节点</span>
                <span className="tabular-nums text-foreground/32">{nodes.length.toLocaleString("zh-CN")}</span>
                {generatingCount ? (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5 tabular-nums text-[10px] text-primary" title="正在生成">
                        <LoaderCircle className="size-2.5 animate-spin" />
                        {generatingCount}
                    </span>
                ) : incompleteCount ? (
                    <span className="ml-auto shrink-0 tabular-nums text-[10px] text-amber-600" title="有节点还没配齐">待补 {incompleteCount}</span>
                ) : null}
            </header>
            <div className="shrink-0 border-b border-border/70 p-2">
                <label className="flex h-8 items-center gap-2 rounded-[var(--r-md)] bg-foreground/[.045] px-2 focus-within:ring-2 focus-within:ring-[var(--workspace-accent-soft)]">
                    <Search className="size-3.5 shrink-0 text-foreground/32" />
                    <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/28"
                        placeholder="搜索节点、章节、镜头、模型或标签…"
                        aria-label="搜索画布节点"
                    />
                    {query ? (
                        <button type="button" onClick={() => onQueryChange("")} className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground" aria-label="清空搜索">
                            <X className="size-3" />
                        </button>
                    ) : null}
                </label>
                {deferredQuery || (ecommerce && onlyIncomplete) ? (
                    <div className="mt-1 flex items-center gap-2 px-0.5 text-[var(--fs-micro)] tabular-nums text-foreground/35">
                        <span>找到 {visibleCount.toLocaleString("zh-CN")} 个节点</span>
                        {ecommerce ? (
                            <button type="button" className="rounded px-1 hover:bg-surface-hover hover:text-foreground" aria-pressed={onlyIncomplete} onClick={() => setOnlyIncomplete((value) => !value)}>
                                {onlyIncomplete ? "显示全部" : "只看没配齐"}
                            </button>
                        ) : null}
                    </div>
                ) : ecommerce ? (
                    <div className="mt-1 px-0.5">
                        <button type="button" className="rounded px-1 text-[var(--fs-micro)] text-foreground/35 hover:bg-surface-hover hover:text-foreground" aria-pressed={false} onClick={() => setOnlyIncomplete(true)}>
                            只看没配齐
                        </button>
                    </div>
                ) : null}
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain py-1" role="listbox" aria-label="画布节点列表">
                {grouped.length ? (
                    grouped.map((group) => (
                        <div key={group.id}>
                            {/* 分组标题只在电商画布出现，且只占一行——它是导航不是内容 */}
                            {group.label ? (
                                <div className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-2" title={group.hint}>
                                    <span className="text-[9px] font-bold tracking-[.12em] text-foreground/40">{group.label}</span>
                                    <span className="tabular-nums text-[9px] text-foreground/28">{group.items.length}</span>
                                </div>
                            ) : null}
                            {group.items.map(({ node, summary }) => (
                                <CanvasNodeListItem key={node.id} node={node} config={config} active={selectedNodeIds.has(node.id)} summary={summary} onSelect={() => onFocus(node.id)} />
                            ))}
                        </div>
                    ))
                ) : (
                    <WorkspaceState icon="canvas" compact title={onlyIncomplete ? "都配齐了" : "没有匹配节点"} description={onlyIncomplete ? "点「显示全部」看所有节点。" : "换一个关键词继续搜索。"} />
                )}
            </div>
        </>
    );
}

const FLAG_COLOR: Record<EcommerceNodeFlag, string> = { ok: "", warn: "#d97706", block: "#dc2626" };

const CanvasNodeListItem = memo(function CanvasNodeListItem({ node, config, active, summary, onSelect }: { node: CanvasNodeData; config: AiConfig; active: boolean; summary: { text: string; flag: EcommerceNodeFlag } | null; onSelect: () => void }) {
    const times = canvasNodeSearchTimes(node);
    // 电商节点优先用自己那句摘要；它比「商品节点 · 800×800」有用得多
    const materialSummary = summary?.text || canvasNodeMaterialSummary(node, config);
    const context = canvasNodeSearchContext(node);
    const generating = isCanvasNodeGenerating(node);
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-2 rounded-[var(--r-md)] px-2 py-2 text-left transition-[background-color,box-shadow] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            style={{
                background: active ? "var(--surface-active)" : undefined,
                boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)" : undefined,
                contentVisibility: "auto",
                containIntrinsicSize: "48px",
            }}
            onClick={onSelect}
        >
            <CanvasNodeListThumbnail node={node} />
            <span className="min-w-0 self-center">
                <span className="flex min-w-0 items-center gap-1.5">
                    {/* 有拦截项或待补时点一个点——几十行里靠它一眼找到要处理的 */}
                    {summary?.flag && summary.flag !== "ok" ? (
                        <span
                            className="grid size-3 shrink-0 place-items-center"
                            style={{ color: FLAG_COLOR[summary.flag] }}
                            title={summary.flag === "block" ? "有拦截项" : "还没配齐"}
                            aria-label={summary.flag === "block" ? "有拦截项" : "还没配齐"}
                        >
                            {summary.flag === "block" ? <AlertTriangle className="size-2.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                        </span>
                    ) : null}
                    <span className="min-w-0 truncate text-xs font-medium leading-4 text-foreground" title={node.title}>
                        {node.title || getNodeListLabel(node.type)}
                    </span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] leading-3 text-foreground/45" title={materialSummary || context}>
                    {materialSummary || context}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-foreground/40">
                    {/* 生成状态排在时间前面——「这张还在跑」比「这张什么时候改的」重要得多 */}
                    {generating ? (
                        <span className="flex shrink-0 items-center gap-0.5 text-primary" title="生成中">
                            <LoaderCircle className="size-2.5 animate-spin" />
                            <span className="tabular-nums">生成中</span>
                        </span>
                    ) : node.metadata?.status === "error" ? (
                        <span className="flex shrink-0 items-center gap-0.5" style={{ color: "#dc2626" }} title="生成失败">
                            <AlertTriangle className="size-2.5" />
                            <span>失败</span>
                        </span>
                    ) : null}
                    <Clock3 className="size-2.5 shrink-0" />
                    <span className="mt-0.5 block text-[var(--fs-label)] tabular-nums text-foreground/35" title={fullTime(times.updatedAt)}>
                        {times.updatedLabel}
                    </span>
                </span>
            </span>
        </button>
    );
});

function CanvasNodeListThumbnail({ node }: { node: CanvasNodeData }) {
    const [failed, setFailed] = useState(false);
    const mediaSource =
        node.metadata?.drawingPreviewUrl ||
        node.metadata?.characterCoverUrl ||
        node.metadata?.folder?.themeCover ||
        (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.ColorGrade ? node.metadata?.content : undefined);
    const commonClass = "h-9 w-11 rounded-[var(--r-sm)] border object-cover";
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };

    if (node.type === CanvasNodeType.Video) {
        const fallback = <span aria-hidden="true" className="grid h-9 w-11 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}><CanvasVideoIcon className="size-3.5" /></span>;
        return <CanvasVideoPreviewImage node={node} alt="" width={44} height={36} loading="lazy" decoding="async" className={commonClass} style={commonStyle} fallback={fallback} />;
    }

    if (mediaSource && !failed) {
        return <img src={mediaSource} alt="" width={44} height={36} loading="lazy" decoding="async" className={commonClass} style={commonStyle} onError={() => setFailed(true)} />;
    }

    const textPreview = node.metadata?.previewContent || node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.content;
    if (textPreview && (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Markdown || node.type === CanvasNodeType.Script)) {
        return (
            <span aria-hidden="true" className="line-clamp-3 h-9 w-11 overflow-hidden rounded-[var(--r-sm)] border px-1 py-0.5 text-[7px] leading-[10px] text-foreground/55" style={commonStyle}>
                {textPreview}
            </span>
        );
    }

    // 电商节点用注册表里的图标，不是清一色的文件图标——
    // 商品/拍法/信息图/交付在一列里长得一样，等于没缩略图。
    const registryIcon = getNodeIcon(node.type);
    return (
        <span aria-hidden="true" className="grid h-9 w-11 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}>
            {registryIcon ?? (
                node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama ? (
                    <Image className="size-3.5" />
                ) : node.type === CanvasNodeType.Video ? (
                    <CanvasVideoIcon className="size-3.5" />
                ) : node.type === CanvasNodeType.Audio ? (
                    <AudioLines className="size-3.5" />
                ) : node.type === CanvasNodeType.Drawing ? (
                    <Pencil className="size-3.5" />
                ) : (
                    <FileText className="size-3.5" />
                )
            )}
        </span>
    );
}

function fullTime(value?: string) {
    if (!value) return "时间未记录";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
