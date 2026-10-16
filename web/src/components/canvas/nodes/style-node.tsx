import { ChevronDown, Sparkles, SwatchBook } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { createEcommerceStyle, type EcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_STYLE_PRESETS, createEcommerceStyleFromPreset } from "@/lib/ecommerce/ecommerce-recipes";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { buildEcommerceStyleDraftPrompt } from "@/lib/ecommerce/ecommerce-draft";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type StyleNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

const STYLE_FIELDS: { key: keyof Pick<EcommerceStyle, "tone" | "mood" | "typography">; label: string; placeholder: string }[] = [
    { key: "tone", label: "色调", placeholder: "中性白，低饱和，色温 5500K" },
    { key: "mood", label: "气质", placeholder: "干净、克制、留白充足" },
    { key: "typography", label: "字体气质", placeholder: "无衬线，字重对比强，行距宽松" },
];

/**
 * 品牌风格节点——一张风格卡，主体是色板。
 *
 * 色板占卡片最显眼的位置，因为它是这组图看起来像谁的全部依据；色调与气质在下面一行。
 * 编辑才展开取色器和输入框。
 *
 * 拍法决定怎么拍，风格决定看起来像谁——换商品、换拍法都不影响它。
 * 色板以十六进制逐字进提示词，可核对；但模型对具体色值的还原精度有限，这一点在卡片上说明。
 */
export function StyleNodeContent({ node, theme }: StyleNodeContentProps) {
    const { updateMetadata, draftWithAgent } = useCanvasNodeActions();
    const [editing, setEditing] = useState(false);

    const style = node.metadata?.ecommerceStyle || createEcommerceStyle(node.title || "未命名风格");
    const editable = Boolean(updateMetadata);
    const activePreset = ECOMMERCE_STYLE_PRESETS.find((preset) => preset.style.name === style.name);
    const summary = [style.tone, style.mood].map((value) => value.trim()).filter(Boolean).join(" · ");

    const patch = (next: Partial<EcommerceStyle>) => updateMetadata?.(node.id, { ecommerceStyle: { ...style, ...next } });
    const setSwatch = (index: number, value: string) => patch({ palette: style.palette.map((color, i) => (i === index ? value : color)) });
    const addSwatch = () => patch({ palette: [...style.palette, "#1A1A1A"] });
    const removeSwatch = (index: number) => patch({ palette: style.palette.filter((_, i) => i !== index) });

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><SwatchBook className="size-3.5" /></span>
                    <span>电商 / 品牌风格</span>
                </div>
                <span className="ecom-card-status">{style.palette.length} 色</span>
            </header>

            <EcommerceNodeTitle node={node} fallback="未命名风格" subtitle={summary || "整组图共用的视觉规范"} />

            <div className="ecom-card-stage" style={{ border: "none", background: "transparent" }}>
                <div className="ecom-palette-bar">
                    {style.palette.length
                        ? style.palette.map((color, index) => <span key={`${color}-${index}`} className="ecom-palette-swatch" style={{ background: color }} title={color} />)
                        : <span className="ecom-palette-empty">还没有色板——从风格库载入或自己加色</span>}
                </div>
            </div>

            {style.typography.trim() ? (
                <p className="ecom-card-subtitle" style={{ margin: 0, whiteSpace: "normal" }}>{style.typography.trim()}</p>
            ) : null}

            {/* 从参考图取色常驻可见。色板会逐字进每一张图的提示词，写错了整组图都会偏色 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!draftWithAgent}
                    title="助手读参考图提取色板与气质；色值要尽量准确，它会逐字进每一张图的提示词"
                    onClick={() => draftWithAgent?.(node, buildEcommerceStyleDraftPrompt())}
                >
                    <Sparkles className="size-3" />
                    让助手从参考图取色
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    <div className="ecom-chip-row">
                        {ECOMMERCE_STYLE_PRESETS.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                className="ecom-chip"
                                aria-pressed={activePreset?.id === preset.id}
                                title={preset.hint}
                                onClick={() => { const next = createEcommerceStyleFromPreset(preset.id); if (next) updateMetadata?.(node.id, { ecommerceStyle: next }); }}
                            >
                                {preset.style.name}
                            </button>
                        ))}
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">色板</span>
                        <div className="ecom-chip-row">
                            {style.palette.map((color, index) => (
                                <span key={`${color}-${index}`} className="flex items-center gap-1">
                                    <input
                                        type="color"
                                        value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#1A1A1A"}
                                        aria-label={`色板 ${index + 1}`}
                                        className="size-7 cursor-pointer rounded-lg border p-0.5"
                                        style={{ borderColor: "color-mix(in srgb, currentColor 20%, transparent)" }}
                                        onChange={(event) => setSwatch(index, event.target.value.toUpperCase())}
                                    />
                                    <button type="button" className="ecom-chip" aria-label={`删除色板 ${index + 1}`} onClick={() => removeSwatch(index)}>×</button>
                                </span>
                            ))}
                            <button type="button" className="ecom-chip" onClick={addSwatch}>+ 加色</button>
                        </div>
                    </div>

                    {STYLE_FIELDS.map((field) => (
                        <label key={field.key} className="ecom-field">
                            <span className="ecom-field-label">{field.label}</span>
                            <textarea
                                className="ecom-field-input thin-scrollbar"
                                value={style[field.key]}
                                rows={1}
                                placeholder={field.placeholder}
                                onChange={(event) => patch({ [field.key]: event.target.value } as Partial<EcommerceStyle>)}
                            />
                        </label>
                    ))}
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>拍法可换，品牌不换</span>
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
