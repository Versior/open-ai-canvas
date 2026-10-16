import { ChevronDown, Download, LayoutTemplate, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { compileEcommercePrompt, createEcommerceCopy, createEcommerceShotSet, type EcommerceCopy } from "@/lib/ecommerce/ecommerce-contract";
import {
    ECOMMERCE_LAYOUT_ANCHORS,
    ECOMMERCE_LAYOUT_PRESETS,
    createEcommerceLayout,
    createEcommerceLayoutFromPreset,
    ecommerceLayoutBlockStyle,
    ecommerceLayoutFieldLabel,
    ecommerceLayoutVisibleBlocks,
    ecommerceRatioValue,
    type EcommerceLayout,
    type EcommerceLayoutAnchor,
    type EcommerceLayoutBlock,
} from "@/lib/ecommerce/ecommerce-layout";
import { ECOMMERCE_ASPECT_RATIOS } from "@/lib/ecommerce/ecommerce-recipes";
import { ecommerceExportSize, rasterizeEcommerceLayout } from "@/lib/ecommerce/ecommerce-rasterize";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import { imageToDataUrl } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type LayoutNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/** 预览容器的宽度上限，用于按画幅算高度。 */
const PREVIEW_WIDTH = 280;

/**
 * 排版节点——一张成品预览卡。
 *
 * 卡片主体就是**成品本身**：图和字叠在一起，按真实画幅比例排出来。
 * 版式库、画幅、字号这些是手段，折叠在编辑里；用户要判断的是「这张能不能上架」。
 *
 * **画面和文字一条提示词一起交给模型。** 主按钮把文案、版式、拍法编译成提示词，
 * 模型一次画完——不做「先生成底图、再本地叠字」的两段式。改字就重出，
 * 这条路上没有第二个系统要维护。
 *
 * 「本地精确合成」留在编辑里，是**文字错不起时的备用**：价格、参数、认证编号
 * 错一个字就是事故，那时改走本地按像素合成，一个错字都不会有。它是备用不是主路径。
 */
export function LayoutNodeContent({ node, theme }: LayoutNodeContentProps) {
    const { updateMetadata, exportEcommerceLayout, generateEcommerceNode } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [exporting, setExporting] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [generating, setGenerating] = useState(false);

    const layout = node.metadata?.ecommerceLayout || createEcommerceLayout(node.title || "未命名版式");
    const ratio = node.metadata?.ecommerceAspectRatio || "1:1";
    const editable = Boolean(updateMetadata);

    // 判据与 canvas-node-generation 的 readReferenceImage 保持一致，
    // 否则会出现「预览有图、导出却拿不到」这种不报错的偏差。
    const sourceImage = upstream.find((item) => getNodeResourceKind(item) === "image" && (item.metadata?.content || item.metadata?.storageKey));
    const copyNode = upstream.find((item) => item.type === CanvasNodeType.Copy);
    const copy: EcommerceCopy = copyNode?.metadata?.ecommerceCopy || createEcommerceCopy();
    const activePreset = ECOMMERCE_LAYOUT_PRESETS.find((preset) => preset.layout.name === layout.name);

    const previewSize = useMemo(() => {
        const value = ecommerceRatioValue(ratio);
        return { width: PREVIEW_WIDTH, height: Math.round(PREVIEW_WIDTH / value) };
    }, [ratio]);

    const patchLayout = (next: Partial<EcommerceLayout>) => updateMetadata?.(node.id, { ecommerceLayout: { ...layout, ...next } });
    const patchBlock = (id: string, next: Partial<EcommerceLayoutBlock>) => patchLayout({ blocks: layout.blocks.map((block) => (block.id === id ? { ...block, ...next } : block)) });
    const visibleBlocks = ecommerceLayoutVisibleBlocks(layout, copy);
    const missingCopy = layout.blocks.filter((block) => !copy[block.field]?.trim());
    const ratioLabel = ECOMMERCE_ASPECT_RATIOS.find((item) => item.id === ratio)?.label || ratio;

    const composite = async (targetRatio: string) => {
        if (!exportEcommerceLayout) return;
        setExporting(targetRatio);
        try {
            const imageUrl = sourceImage ? await imageToDataUrl({ url: sourceImage.metadata?.content, storageKey: sourceImage.metadata?.storageKey, name: sourceImage.title }) : "";
            const dataUrl = await rasterizeEcommerceLayout({ imageUrl, layout, copy, size: ecommerceExportSize(targetRatio) });
            await exportEcommerceLayout(node, dataUrl, `${node.title || "排版"} · ${targetRatio}`);
        } finally {
            setExporting(null);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><LayoutTemplate className="size-3.5" /></span>
                    <span>电商 / 排版</span>
                </div>
                <span className={missingCopy.length ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {ratioLabel} · {visibleBlocks.length} 块文字
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名版式"
                subtitle={
                    !sourceImage ? "连一张成品图，文字才能叠上去"
                        : !visibleBlocks.length ? "选了版式但文案为空，生成时不出字"
                            : "文案与版式编译成提示词交给模型；文字错不起时走本地精确合成"
                }
            />

            <div className="ecom-card-stage" style={{ padding: 8 }}>
                <div className="relative overflow-hidden rounded-[10px]" style={{ width: "100%", maxWidth: previewSize.width, aspectRatio: `${previewSize.width} / ${previewSize.height}`, background: sourceImage ? `color-mix(in srgb, ${theme.node.text} 8%, transparent)` : "#FFFFFF", border: `1px solid ${theme.node.stroke}` }}>
                    {sourceImage?.metadata?.content ? <img src={sourceImage.metadata.content} alt="" className="absolute inset-0 size-full object-cover" draggable={false} /> : (
                        <span className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] leading-relaxed" style={{ color: "#9A9A9A" }}>
                            {sourceImage ? "图未就绪" : "还没有成品图"}
                        </span>
                    )}
                    {visibleBlocks.map((block) => <span key={block.id} style={ecommerceLayoutBlockStyle(block, previewSize)}>{copy[block.field].trim()}</span>)}
                </div>
            </div>

            {/* 主操作只有一件事：把文案和版式交给模型出成品图。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!generateEcommerceNode || !visibleBlocks.length || generating}
                    title={visibleBlocks.length ? "把文案与版式编译成提示词，交给图片模型出成品图" : "文案为空，先生成或填写文案"}
                    onClick={async () => {
                        setGenerating(true);
                        try {
                            await generateEcommerceNode?.(node, "image", compileEcommercePrompt({
                                copy,
                                shotSet: { ...createEcommerceShotSet(layout.name || "版式"), global: layoutBlocksBrief(layout, copy), shots: [] },
                            }));
                        } finally {
                            setGenerating(false);
                        }
                    }}
                >
                    {generating ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {generating ? "提交中…" : "生成成品图"}
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-chip-row">
                        {ECOMMERCE_LAYOUT_PRESETS.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                className="ecom-chip"
                                aria-pressed={activePreset?.id === preset.id}
                                title={preset.hint}
                                onClick={() => { const next = createEcommerceLayoutFromPreset(preset.id); if (next) updateMetadata?.(node.id, { ecommerceLayout: next }); }}
                            >
                                {preset.layout.name}
                            </button>
                        ))}
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">画幅</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_ASPECT_RATIOS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className="ecom-chip tabular-nums"
                                    aria-pressed={ratio === item.id}
                                    title={item.hint}
                                    onClick={() => updateMetadata?.(node.id, { ecommerceAspectRatio: item.id })}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {layout.blocks.map((block) => (
                        <div key={block.id} className="ecom-field">
                            <span className="flex items-center gap-1.5">
                                <span className="ecom-field-label">{ecommerceLayoutFieldLabel(block.field)}</span>
                                {copy[block.field]?.trim() ? null : <span className="ecom-card-status ecom-card-status-warn">文案为空，合成时不显示</span>}
                            </span>
                            <div className="ecom-chip-row">
                                <select
                                    value={block.anchor}
                                    aria-label={`${ecommerceLayoutFieldLabel(block.field)} 位置`}
                                    className="ecom-field-input w-auto py-0.5"
                                    onChange={(event) => patchBlock(block.id, { anchor: event.target.value as EcommerceLayoutAnchor })}
                                >
                                    {ECOMMERCE_LAYOUT_ANCHORS.map((anchor) => <option key={anchor.id} value={anchor.id}>{anchor.label}</option>)}
                                </select>
                                <label className="ecom-chip flex items-center gap-1">
                                    字号
                                    <input
                                        type="number"
                                        min={2}
                                        max={30}
                                        step={0.5}
                                        value={block.size}
                                        aria-label={`${ecommerceLayoutFieldLabel(block.field)} 字号`}
                                        className="w-10 bg-transparent text-[10px] tabular-nums outline-none"
                                        onChange={(event) => patchBlock(block.id, { size: Number(event.target.value) || block.size })}
                                    />
                                </label>
                                <label className="ecom-chip flex items-center gap-1">
                                    字色
                                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(block.color) ? block.color : "#1A1A1A"} aria-label={`${ecommerceLayoutFieldLabel(block.field)} 字色`} className="size-4 cursor-pointer rounded border-0 bg-transparent p-0" onChange={(event) => patchBlock(block.id, { color: event.target.value.toUpperCase() })} />
                                </label>
                                <label className="ecom-chip flex items-center gap-1">
                                    垫底
                                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(block.plate.slice(0, 7)) ? block.plate.slice(0, 7) : "#FFFFFF"} aria-label={`${ecommerceLayoutFieldLabel(block.field)} 垫底`} className="size-4 cursor-pointer rounded border-0 bg-transparent p-0" onChange={(event) => patchBlock(block.id, { plate: `${event.target.value.toUpperCase()}CC` })} />
                                </label>
                                <button type="button" className="ecom-chip" aria-pressed={!block.plate} onClick={() => patchBlock(block.id, { plate: "" })}>不垫</button>
                                <button type="button" className="ecom-chip font-bold" aria-pressed={block.bold} onClick={() => patchBlock(block.id, { bold: !block.bold })}>B</button>
                            </div>
                        </div>
                    ))}

                    <div className="ecom-field">
                        <span className="ecom-field-label">本地精确合成 · 文字必须逐字准确时用</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_ASPECT_RATIOS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className="ecom-chip tabular-nums"
                                    disabled={!exportEcommerceLayout || Boolean(exporting) || !visibleBlocks.length}
                                    title={`按 ${item.hint} 在本地合成导出`}
                                    onClick={() => void composite(item.id)}
                                >
                                    <Download className="inline size-3" /> {exporting === item.id ? "合成中…" : item.label}
                                </button>
                            ))}
                        </div>
                        <span className="ecom-card-subtitle" style={{ whiteSpace: "normal", marginTop: 2 }}>
                            走本地合成，不经过模型——图和字都按你设的像素排，一个错字都不会有。
                            只在价格、参数、认证编号这类错不起的地方用它；平时走上面的「生成成品图」。
                        </span>
                    </div>
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>{missingCopy.length ? <>有 <b>{missingCopy.length}</b> 个文字块没有文案</> : <>版式 <b>{layout.blocks.length}</b> 块</>}</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "调版式"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}

/**
 * 把版式说成一句话给模型。
 *
 * 版式的价值在「哪块字放哪」——所以简述里必须带方位（左上/下中/右下），
 * 而不是像素坐标。模型读方位词才知道该往哪排；喂坐标它只会当成无关噪声。
 *
 * 注意：这是给**底图**用的，说的是「文字会出现在这里，把这块留干净」。
 */
function layoutBlocksBrief(layout: EcommerceLayout, copy: EcommerceCopy) {
    const visible = layout.blocks.filter((block) => copy[block.field]?.trim());
    if (!visible.length) return "";
    return `版式：${visible.map((block) => `${ecommerceLayoutFieldLabel(block.field)}放画面${anchorLabel(block.anchor)}`).join("；")}`;
}

function anchorLabel(anchor: EcommerceLayoutAnchor) {
    return ECOMMERCE_LAYOUT_ANCHORS.find((item) => item.id === anchor)?.label || anchor;
}
