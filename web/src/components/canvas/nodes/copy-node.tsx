import { ChevronDown, PenLine, Sparkles } from "lucide-react";
import { useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { createEcommerceCopy, type EcommerceCopy } from "@/lib/ecommerce/ecommerce-contract";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { buildEcommerceCopyDraftPrompt } from "@/lib/ecommerce/ecommerce-draft";
import type { CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type CopyNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

const COPY_FIELDS: { key: keyof EcommerceCopy; label: string; placeholder: string; hint: string; rows: number }[] = [
    { key: "headline", label: "标题", placeholder: "一次装够一天的水", hint: "主视觉上最大的那行", rows: 2 },
    { key: "subhead", label: "副文案", placeholder: "304 不锈钢，保温 12 小时", hint: "补充说明", rows: 2 },
    { key: "cta", label: "行动引导", placeholder: "立即购买", hint: "按钮或角标上的字", rows: 1 },
    { key: "price", label: "价格", placeholder: "¥ 199", hint: "有真实价格才填", rows: 1 },
];

/**
 * 文案节点——一张文案卡，按图上实际的层级排出来。
 *
 * 四个输入框看不出这些字放到图上是什么样，所以卡片主体是**文字预览**：
 * 标题用大字号、副文案次之、行动引导画成按钮、价格用促销红。
 * 用户看到的接近成品，而不是四行表单。
 *
 * 模型不负责写字——生成图片里的文字准确率不可控，所以文案的作用是告诉排版环节
 * 该在哪里留多大的位置。编译时会明确写「画面只需留出对应位置，不要自行生成文字」。
 */
export function CopyNodeContent({ node, theme }: CopyNodeContentProps) {
    const { updateMetadata, draftWithAgent } = useCanvasNodeActions();
    const [editing, setEditing] = useState(false);

    const copy = node.metadata?.ecommerceCopy || createEcommerceCopy();
    const editable = Boolean(updateMetadata);
    const filled = COPY_FIELDS.filter((field) => copy[field.key].trim()).length;

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><PenLine className="size-3.5" /></span>
                    <span>电商 / 文案</span>
                </div>
                <span className="ecom-card-status">{filled}/{COPY_FIELDS.length} 项</span>
            </header>

            <div className="ecom-card-stage">
                <div className="ecom-copy-preview">
                    {copy.headline.trim()
                        ? <span className="ecom-copy-headline">{copy.headline.trim()}</span>
                        : <span className="ecom-copy-placeholder">标题会显示在这里</span>}
                    {copy.subhead.trim() ? <span className="ecom-copy-subhead">{copy.subhead.trim()}</span> : null}
                    {copy.cta.trim() || copy.price.trim() ? (
                        <span className="ecom-copy-actions">
                            {copy.cta.trim() ? <span className="ecom-copy-cta">{copy.cta.trim()}</span> : null}
                            {copy.price.trim() ? <span className="ecom-copy-price">{copy.price.trim()}</span> : null}
                        </span>
                    ) : null}
                </div>
            </div>

            {/* 起草文案常驻可见——空节点上这是最高价值的入口，藏在「编辑」里等于没有。
                指令里明确不写价格：价格必须来自真实定价。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!draftWithAgent}
                    title="助手按商品与卖点起草标题、副文案与行动引导；价格留空，由你自己填"
                    onClick={() => draftWithAgent?.(node, buildEcommerceCopyDraftPrompt())}
                >
                    <Sparkles className="size-3" />
                    让助手起草文案
                </button>
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    {COPY_FIELDS.map((field) => (
                        <label key={field.key} className="ecom-field">
                            <span className="ecom-field-label">{field.label} · {field.hint}</span>
                            <textarea
                                className="ecom-field-input thin-scrollbar"
                                value={copy[field.key]}
                                rows={field.rows}
                                placeholder={field.placeholder}
                                onChange={(event) => updateMetadata?.(node.id, { ecommerceCopy: { ...copy, [field.key]: event.target.value } })}
                            />
                        </label>
                    ))}
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>{copy.price.trim() ? "含价格" : "价格留空——模型不会替你编"}</span>
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
