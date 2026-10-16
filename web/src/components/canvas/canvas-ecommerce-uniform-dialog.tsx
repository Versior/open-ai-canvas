import { useState } from "react";
import { ArrowLeftRight, Languages, Palette, Type } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { Select } from "@/components/ui/base/select";
import { ECOMMERCE_LANGUAGES, ECOMMERCE_STYLE_PRESETS, ECOMMERCE_TYPOGRAPHY_PRESETS, ecommerceLanguage, ecommerceStylePreset, ecommerceTypographyPreset } from "@/lib/ecommerce/ecommerce-recipes";
import { ECOMMERCE_PLATFORMS, ecommercePlatform, type EcommercePlatformId } from "@/lib/ecommerce/ecommerce-platform-specs";
import type { CanvasTheme } from "@/lib/canvas-theme";
import "./canvas-ecommerce-uniform-dialog.css";

export type EcommerceUniformValue = {
    platform: string;
    language: string;
    stylePresetId: string;
    typographyPresetId: string;
    styleReferenceKey: string;
};

type Props = {
    value: EcommerceUniformValue;
    /** 能当风格参考图的候选——商品节点上游的图。 */
    styleReferenceCandidates: { key: string; label: string }[];
    onChange: (patch: Partial<EcommerceUniformValue>) => void;
    theme: CanvasTheme;
};

/**
 * 整组统一的摘要。没设的项不占字数——一行读到底就知道这一套是什么调子。
 */
export function ecommerceUniformSummary(value: EcommerceUniformValue, candidateCount: number) {
    return [
        ecommerceStylePreset(value.stylePresetId)?.style.name,
        ecommerceTypographyPreset(value.typographyPresetId)?.name,
        ecommercePlatform(value.platform as EcommercePlatformId)?.name,
        ecommerceLanguage(value.language)?.name,
        value.styleReferenceKey && candidateCount ? "带风格参考图" : "",
    ].filter(Boolean).join(" · ");
}

/**
 * 整组统一——平台 / 图上语言 / 色彩美学 / 字体风格 / 风格参考图。
 *
 * **放在商品节点上，不放在套图面板里。** 这几条是「这一套长什么样」的底色，
 * 调一次能用一整套；塞在面板里等于每开一次面板都要路过一遍，而它跟
 * 「这一张画什么」根本不是同一层的事。用户的原话是「这些功能应该在商品节点」。
 *
 * 它们同时进分析提示词（模型据此写每一条）与出图约束——色彩与字体写进
 * `ecommerceStyle`，编译链已经会把它变成每张图前面的【品牌风格】块。
 */
export function CanvasEcommerceUniformDialog({ value, styleReferenceCandidates, onChange, theme }: Props) {
    const [open, setOpen] = useState(false);
    const summary = ecommerceUniformSummary(value, styleReferenceCandidates.length);
    const style = ecommerceStylePreset(value.stylePresetId);
    const platform = ecommercePlatform(value.platform as EcommercePlatformId);

    return (
        <>
            <button
                type="button"
                className="ecom-uniform-trigger"
                title={summary ? `整组统一：${summary}` : "整组统一——平台、语言、色彩、字体、风格参考"}
                aria-label="整组统一"
                onClick={() => setOpen(true)}
            >
                <Palette className="size-3.5 shrink-0" />
                <span className="ecom-uniform-trigger-label">{summary || "整组统一：色彩 / 字体 / 语言 / 平台"}</span>
            </button>

            {open ? (
                <AppModal title={null} closable={false} open centered footer={null} width={560} flush onCancel={() => setOpen(false)}>
                    <div className="ecom-uniform-shell">
                        <header className="ecom-uniform-head">
                            <h2>整组统一</h2>
                            <p>这几条是<b>这一套</b>的属性，不是某一张的——同一套图里色调、字体、说什么语言必须一致，逐张写就会写歪。改完这一套的每一张都按它来。</p>
                        </header>

                        <div className="ecom-uniform-rows">
                            <label className="ecom-uniform-row">
                                <span className="ecom-uniform-label"><Palette className="size-3.5" />色彩美学</span>
                                <Select
                                    className="canvas-compact-control canvas-control-select"
                                    value={value.stylePresetId || undefined}
                                    placeholder="不限"
                                    options={[{ value: "", label: "不限" }, ...ECOMMERCE_STYLE_PRESETS.map((item) => ({ value: item.id, label: `${item.style.name}——${item.hint}` }))]}
                                    popupMatchSelectWidth={false}
                                    onChange={(next) => onChange({ stylePresetId: next })}
                                />
                                <span className="ecom-uniform-hint">
                                    {style ? (
                                        <>
                                            <span className="ecom-uniform-swatches">{style.style.palette.map((color) => <i key={color} style={{ background: color }} title={color} />)}</span>
                                            {style.style.tone}
                                        </>
                                    ) : "决定每张图的色温、饱和度与留白——同一套里不能一张冷一张暖"}
                                </span>
                            </label>

                            <label className="ecom-uniform-row">
                                <span className="ecom-uniform-label"><Type className="size-3.5" />字体风格</span>
                                <Select
                                    className="canvas-compact-control canvas-control-select"
                                    value={value.typographyPresetId || undefined}
                                    placeholder="不限"
                                    options={[{ value: "", label: "不限" }, ...ECOMMERCE_TYPOGRAPHY_PRESETS.map((item) => ({ value: item.id, label: `${item.name}——${item.hint}` }))]}
                                    popupMatchSelectWidth={false}
                                    onChange={(next) => onChange({ typographyPresetId: next })}
                                />
                                <span className="ecom-uniform-hint">{ecommerceTypographyPreset(value.typographyPresetId)?.typography || "图上文字是什么脾气——同一套色板配无衬线是干净，配粗黑是张扬"}</span>
                            </label>

                            <label className="ecom-uniform-row">
                                <span className="ecom-uniform-label"><Languages className="size-3.5" />图上语言</span>
                                <Select
                                    className="canvas-compact-control canvas-control-select"
                                    value={value.language || undefined}
                                    placeholder="不限"
                                    options={[{ value: "", label: "不限" }, ...ECOMMERCE_LANGUAGES.map((item) => ({ value: item.id, label: `${item.name}——${item.hint}` }))]}
                                    popupMatchSelectWidth={false}
                                    onChange={(next) => onChange({ language: next })}
                                />
                                <span className="ecom-uniform-hint">图上文字写什么语言。选英文时会明确要求「用当地人真会那么说的说法」，不许逐字直译</span>
                            </label>

                            <label className="ecom-uniform-row">
                                <span className="ecom-uniform-label"><ArrowLeftRight className="size-3.5" />投放平台</span>
                                <Select
                                    className="canvas-compact-control canvas-control-select"
                                    value={value.platform || undefined}
                                    placeholder="不限"
                                    options={[{ value: "", label: "不限" }, ...ECOMMERCE_PLATFORMS.map((item) => ({ value: item.id, label: item.name }))]}
                                    popupMatchSelectWidth={false}
                                    onChange={(next) => onChange({ platform: next })}
                                />
                                <span className="ecom-uniform-hint">{platform?.roles.main?.note || "平台口径是硬规范——文字面积上限、白底要求、禁促销词，写进提示词让模型一次画对"}</span>
                            </label>

                            <label className="ecom-uniform-row">
                                <span className="ecom-uniform-label"><Palette className="size-3.5" />风格参考图</span>
                                <Select
                                    className="canvas-compact-control canvas-control-select"
                                    value={value.styleReferenceKey || undefined}
                                    placeholder={styleReferenceCandidates.length ? "选一张" : "先连图"}
                                    disabled={!styleReferenceCandidates.length}
                                    options={[{ value: "", label: "不用" }, ...styleReferenceCandidates.map((item) => ({ value: item.key, label: item.label }))]}
                                    popupMatchSelectWidth={false}
                                    onChange={(next) => onChange({ styleReferenceKey: next })}
                                />
                                <span className="ecom-uniform-hint">从你连进来的图里挑一张。分析时会说明是哪一张，并写明「只取调性，不要复刻构图与商品」</span>
                            </label>
                        </div>

                        <footer className="ecom-uniform-foot">
                            <span>改完立刻生效——下次分析这一套时会带上。</span>
                            <button type="button" className="ecom-uniform-close" style={{ background: theme.node.text, color: theme.node.panel }} onClick={() => setOpen(false)}>
                                知道了
                            </button>
                        </footer>
                    </div>
                </AppModal>
            ) : null}
        </>
    );
}
