import { ChevronDown, Download, LayoutTemplate } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { createEcommerceCopy, type EcommerceCopy } from "@/lib/ecommerce/ecommerce-contract";
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
 * 预览与导出共用同一套确定性排版：图片模型只负责底图，文字由浏览器在导出时合成。
 * 改字只更新排版，不重新生图；主按钮始终导出当前画幅，编辑区只补充其他画幅。
 */
export function LayoutNodeContent({ node, theme }: LayoutNodeContentProps) {
    const { updateMetadata, exportEcommerceLayout } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [exporting, setExporting] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [resolvedImage, setResolvedImage] = useState<{ key: string; url: string } | null>(null);
    const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null);
    const [exportError, setExportError] = useState("");

    const layout = node.metadata?.ecommerceLayout || createEcommerceLayout(node.title || "未命名版式");
    const ratio = node.metadata?.ecommerceAspectRatio || "1:1";
    const editable = Boolean(updateMetadata);

    // 判据与 canvas-node-generation 的 readReferenceImage 保持一致，
    // 否则会出现「预览有图、导出却拿不到」这种不报错的偏差。
    const sourceImage = upstream.find((item) => getNodeResourceKind(item) === "image" && (item.metadata?.content || item.metadata?.storageKey));
    const sourceImageUrl = sourceImage?.metadata?.content;
    const sourceImageStorageKey = sourceImage?.metadata?.storageKey;
    const sourceImageTitle = sourceImage?.title;
    const sourceImageKey = sourceImage ? JSON.stringify([sourceImage.id, sourceImageUrl, sourceImageStorageKey, sourceImageTitle]) : "";
    const previewImageUrl = resolvedImage?.key === sourceImageKey ? resolvedImage.url : "";
    const feedback = exportError || (previewError?.key === sourceImageKey ? previewError.message : "");
    const copyNode = upstream.find((item) => item.type === CanvasNodeType.Copy);
    const copy: EcommerceCopy = copyNode?.metadata?.ecommerceCopy || createEcommerceCopy();
    const activePreset = ECOMMERCE_LAYOUT_PRESETS.find((preset) => preset.layout.name === layout.name);

    const previewSize = useMemo(() => {
        const value = ecommerceRatioValue(ratio);
        return { width: PREVIEW_WIDTH, height: Math.round(PREVIEW_WIDTH / value) };
    }, [ratio]);

    useEffect(() => {
        if (!sourceImageKey) return;
        let active = true;
        void imageToDataUrl({ url: sourceImageUrl, storageKey: sourceImageStorageKey, name: sourceImageTitle })
            .then((url) => {
                if (!url) throw new Error("成品图不存在或已失效");
                if (active) {
                    setResolvedImage({ key: sourceImageKey, url });
                    setPreviewError(null);
                }
            })
            .catch((error) => {
                if (active) setPreviewError({ key: sourceImageKey, message: `预览失败：${error instanceof Error ? error.message : "请重试"}` });
            });
        return () => {
            active = false;
        };
    }, [sourceImageKey, sourceImageStorageKey, sourceImageTitle, sourceImageUrl]);

    const patchLayout = (next: Partial<EcommerceLayout>) => updateMetadata?.(node.id, { ecommerceLayout: { ...layout, ...next } });
    const patchBlock = (id: string, next: Partial<EcommerceLayoutBlock>) => patchLayout({ blocks: layout.blocks.map((block) => (block.id === id ? { ...block, ...next } : block)) });
    const visibleBlocks = ecommerceLayoutVisibleBlocks(layout, copy);
    const missingCopy = layout.blocks.filter((block) => !copy[block.field]?.trim());
    const ratioLabel = ECOMMERCE_ASPECT_RATIOS.find((item) => item.id === ratio)?.label || ratio;

    const composite = async (targetRatio: string) => {
        if (!exportEcommerceLayout) return;
        setExportError("");
        setExporting(targetRatio);
        try {
            const imageUrl = sourceImageKey ? previewImageUrl || (await imageToDataUrl({ url: sourceImageUrl, storageKey: sourceImageStorageKey, name: sourceImageTitle })) : "";
            if (sourceImageKey && !imageUrl) throw new Error("成品图不存在或已失效");
            if (sourceImageKey && !previewImageUrl) {
                setResolvedImage({ key: sourceImageKey, url: imageUrl });
                setPreviewError(null);
            }
            const dataUrl = await rasterizeEcommerceLayout({ imageUrl, layout, copy, size: ecommerceExportSize(targetRatio) });
            await exportEcommerceLayout(node, dataUrl, `${node.title || "排版"} · ${targetRatio}`);
        } catch (error) {
            setExportError(`导出失败：${error instanceof Error ? error.message : "请重试"}`);
        } finally {
            setExporting(null);
        }
    };

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark">
                        <LayoutTemplate className="size-3.5" />
                    </span>
                    <span>电商 / 排版</span>
                </div>
                <span className={missingCopy.length ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {ratioLabel} · {visibleBlocks.length} 块文字
                </span>
            </header>

            <EcommerceNodeTitle node={node} fallback="未命名版式" subtitle={!visibleBlocks.length ? "先填写文案；改字只更新排版，不重新生图" : !sourceImage ? "可先导出纯色文字版；预览即导出效果，改字不重新生图" : "预览即导出效果；改字不重新生图"} />

            <div className="ecom-card-stage" style={{ padding: 8 }}>
                <div
                    className="relative overflow-hidden rounded-[10px]"
                    style={{
                        width: "100%",
                        maxWidth: previewSize.width,
                        aspectRatio: `${previewSize.width} / ${previewSize.height}`,
                        background: sourceImage ? `color-mix(in srgb, ${theme.node.text} 8%, transparent)` : "#FFFFFF",
                        border: `1px solid ${theme.node.stroke}`,
                    }}
                >
                    {previewImageUrl ? (
                        <img src={previewImageUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
                    ) : (
                        <span className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] leading-relaxed" style={{ color: "#9A9A9A" }}>
                            {sourceImage ? "图未就绪" : "还没有成品图"}
                        </span>
                    )}
                    {visibleBlocks.map((block) => (
                        <span key={block.id} style={ecommerceLayoutBlockStyle(block, previewSize)}>
                            {copy[block.field].trim()}
                        </span>
                    ))}
                </div>
            </div>

            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!exportEcommerceLayout || !visibleBlocks.length || Boolean(exporting)}
                    title={visibleBlocks.length ? "按当前画幅本地排版导出；预览即导出效果，改字不重新生图" : "文案为空，先生成或填写文案"}
                    onClick={() => composite(ratio)}
                >
                    <Download className="size-3" />
                    {exporting === ratio ? "导出中…" : "导出当前画幅"}
                </button>
            </div>

            {feedback ? (
                <p role="alert" className="ecom-card-subtitle" style={{ color: "var(--status-error)", margin: "0 14px 8px", whiteSpace: "normal" }}>
                    {feedback}
                </p>
            ) : null}

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
                                onClick={() => {
                                    const next = createEcommerceLayoutFromPreset(preset.id);
                                    if (next) updateMetadata?.(node.id, { ecommerceLayout: next });
                                }}
                            >
                                {preset.layout.name}
                            </button>
                        ))}
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">画幅</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_ASPECT_RATIOS.map((item) => (
                                <button key={item.id} type="button" className="ecom-chip tabular-nums" aria-pressed={ratio === item.id} title={item.hint} onClick={() => updateMetadata?.(node.id, { ecommerceAspectRatio: item.id })}>
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
                                    {ECOMMERCE_LAYOUT_ANCHORS.map((anchor) => (
                                        <option key={anchor.id} value={anchor.id}>
                                            {anchor.label}
                                        </option>
                                    ))}
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
                                    <input
                                        type="color"
                                        value={/^#[0-9a-fA-F]{6}$/.test(block.color) ? block.color : "#1A1A1A"}
                                        aria-label={`${ecommerceLayoutFieldLabel(block.field)} 字色`}
                                        className="size-4 cursor-pointer rounded border-0 bg-transparent p-0"
                                        onChange={(event) => patchBlock(block.id, { color: event.target.value.toUpperCase() })}
                                    />
                                </label>
                                <label className="ecom-chip flex items-center gap-1">
                                    垫底
                                    <input
                                        type="color"
                                        value={/^#[0-9a-fA-F]{6}$/.test(block.plate.slice(0, 7)) ? block.plate.slice(0, 7) : "#FFFFFF"}
                                        aria-label={`${ecommerceLayoutFieldLabel(block.field)} 垫底`}
                                        className="size-4 cursor-pointer rounded border-0 bg-transparent p-0"
                                        onChange={(event) => patchBlock(block.id, { plate: `${event.target.value.toUpperCase()}CC` })}
                                    />
                                </label>
                                <button type="button" className="ecom-chip" aria-pressed={!block.plate} onClick={() => patchBlock(block.id, { plate: "" })}>
                                    不垫
                                </button>
                                <button type="button" className="ecom-chip font-bold" aria-pressed={block.bold} onClick={() => patchBlock(block.id, { bold: !block.bold })}>
                                    B
                                </button>
                            </div>
                        </div>
                    ))}

                    <div className="ecom-field">
                        <span className="ecom-field-label">导出其他画幅</span>
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
                            会按所选画幅重新排版导出，仍是本地合成，不会重新生图。
                        </span>
                    </div>
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>
                    {missingCopy.length ? (
                        <>
                            有 <b>{missingCopy.length}</b> 个文字块没有文案
                        </>
                    ) : (
                        <>
                            版式 <b>{layout.blocks.length}</b> 块
                        </>
                    )}
                </span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "调版式"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}
