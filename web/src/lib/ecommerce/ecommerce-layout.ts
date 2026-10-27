/**
 * 排版层——电商图上真正让人看懂的那一半。
 *
 * 核心决定：**文字不烧进像素。**
 *
 * 竞品全部把字烧进图里，所以价格从 199 改成 159 就要重出整张图。影策把文字做成
 * 独立的一层，叠在生成图上面：改字立即生效，不用重新生成；导出时才合成。
 * 这是设计师每天都要经历的浪费，也是 AI 生图最蠢的地方。
 *
 * 位置用「九宫格锚点 + 占短边百分比」表达，所以同一套版式天然适配任何画幅——
 * 一张设计出 6 个尺寸，主体和文案位跟着变，不用重做。
 */
import type { EcommerceCopy } from "./ecommerce-contract";

export type EcommerceLayoutAnchor =
    | "top-left" | "top-center" | "top-right"
    | "middle-left" | "middle-center" | "middle-right"
    | "bottom-left" | "bottom-center" | "bottom-right";

export const ECOMMERCE_LAYOUT_ANCHORS: { id: EcommerceLayoutAnchor; label: string }[] = [
    { id: "top-left", label: "左上" }, { id: "top-center", label: "上中" }, { id: "top-right", label: "右上" },
    { id: "middle-left", label: "左中" }, { id: "middle-center", label: "正中" }, { id: "middle-right", label: "右中" },
    { id: "bottom-left", label: "左下" }, { id: "bottom-center", label: "下中" }, { id: "bottom-right", label: "右下" },
];

/** 版式里的一个文字块。 */
export type EcommerceLayoutBlock = {
    id: string;
    /** 绑哪条文案。价格为空时整块不显示，不留空。 */
    field: keyof EcommerceCopy;
    anchor: EcommerceLayoutAnchor;
    /** 字号：占画幅短边的百分比。用短边而不是高度，横竖画幅观感才一致。 */
    size: number;
    color: string;
    /** 字后面垫的底色。空字符串表示不垫——背景复杂时字会读不清，所以默认垫。 */
    plate: string;
    align: "left" | "center" | "right";
    /** 距锚点边的留白，占短边百分比。 */
    inset: number;
    bold: boolean;
};

export type EcommerceLayout = {
    name: string;
    blocks: EcommerceLayoutBlock[];
};

const FIELD_LABELS: Record<keyof EcommerceCopy, string> = {
    headline: "标题", subhead: "副文案", cta: "行动引导", price: "价格",
};

export function ecommerceLayoutFieldLabel(field: keyof EcommerceCopy) {
    return FIELD_LABELS[field];
}

export function createEcommerceLayoutBlock(field: keyof EcommerceCopy, anchor: EcommerceLayoutAnchor = "bottom-left"): EcommerceLayoutBlock {
    return { id: `block-${Math.random().toString(36).slice(2, 10)}`, field, anchor, size: 7, color: "#1A1A1A", plate: "#FFFFFFCC", align: "left", inset: 6, bold: field === "headline" || field === "price" };
}

export function createEcommerceLayout(name = "未命名版式"): EcommerceLayout {
    return { name, blocks: [] };
}

/** 这个版式实际会画出哪些字——文案为空的不算。 */
export function ecommerceLayoutVisibleBlocks(layout: EcommerceLayout | undefined, copy: EcommerceCopy | undefined) {
    if (!layout || !copy) return [];
    return layout.blocks.filter((block) => copy[block.field]?.trim());
}

/**
 * 把锚点 + 百分比翻译成绝对定位。
 *
 * 短边取 min(宽, 高)：同一套版式在 1:1 和 9:16 上，字号与留白的观感一致，
 * 不会出现竖版字巨大、横版字微小的情况。
 */
export function ecommerceLayoutBlockStyle(block: EcommerceLayoutBlock, container: { width: number; height: number }) {
    const shortSide = Math.min(container.width, container.height);
    const inset = (block.inset / 100) * shortSide;
    const [vertical, horizontal] = block.anchor.split("-");
    const style: Record<string, string | number> = {
        position: "absolute",
        fontSize: `${(block.size / 100) * shortSide}px`,
        lineHeight: 1.25,
        color: block.color,
        fontWeight: block.bold ? 700 : 400,
        textAlign: block.align,
        maxWidth: `${container.width - inset * 2}px`,
        padding: block.plate ? `${inset * 0.22}px ${inset * 0.34}px` : 0,
        background: block.plate || "transparent",
        borderRadius: block.plate ? `${Math.max(2, shortSide * 0.012)}px` : 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    };
    if (vertical === "top") style.top = inset;
    else if (vertical === "bottom") style.bottom = inset;
    else style.top = "50%", style.transform = "translateY(-50%)";
    if (horizontal === "left") style.left = inset;
    else if (horizontal === "right") style.right = inset;
    else style.left = "50%", style.transform = style.transform ? "translate(-50%, -50%)" : "translateX(-50%)";
    // 居中锚点上再叠一次对齐，避免文字块自身贴左
    if (horizontal === "center" && block.align === "left") style.textAlign = "left";
    return style as React.CSSProperties;
}

/** 画幅比例字符串转数值，用于预览容器。 */
export function ecommerceRatioValue(ratio: string) {
    const [width, height] = ratio.split(":").map((part) => Number(part.trim()));
    if (!width || !height) return 1;
    return width / height;
}

// ── 版式库 ──────────────────────────────────────────────────

export type EcommerceLayoutPreset = { id: string; hint: string; layout: Omit<EcommerceLayout, "name"> & { name: string } };

function blocks(specs: Array<Partial<EcommerceLayoutBlock> & { field: keyof EcommerceCopy }>): EcommerceLayoutBlock[] {
    return specs.map((spec) => ({ ...createEcommerceLayoutBlock(spec.field), ...spec }));
}

export const ECOMMERCE_LAYOUT_PRESETS: EcommerceLayoutPreset[] = [
    {
        id: "bottom-bar", hint: "标题与价格压在底部，最通用的主图版式",
        layout: {
            name: "底部信息条",
            blocks: blocks([
                { field: "headline", anchor: "bottom-left", size: 8, bold: true, inset: 15 },
                { field: "subhead", anchor: "bottom-left", size: 4, color: "#4A4A4A", bold: false, inset: 6 },
                { field: "price", anchor: "bottom-right", size: 9, color: "#C8341F", bold: true },
            ]).map((block, index) => (index === 1 ? { ...block, inset: 6 } : index === 2 ? block : block)),
        },
    },
    {
        id: "top-banner", hint: "标题横压顶部，适合有明确卖点的主图",
        layout: {
            name: "顶部横幅",
            blocks: blocks([
                { field: "headline", anchor: "top-center", size: 7, bold: true, align: "center", plate: "#1A1A1ACC", color: "#FFFFFF" },
                { field: "price", anchor: "top-right", size: 6, color: "#C8341F", bold: true, plate: "#FFFFFFE6" },
            ]),
        },
    },
    {
        id: "price-corner", hint: "价格做大放角上，促销期用",
        layout: {
            name: "价格角标",
            blocks: blocks([
                { field: "price", anchor: "top-right", size: 13, color: "#FFFFFF", plate: "#C8341F", bold: true, align: "center" },
                { field: "headline", anchor: "bottom-left", size: 7, bold: true },
                { field: "cta", anchor: "bottom-right", size: 5, plate: "#1A1A1ACC", color: "#FFFFFF", align: "center" },
            ]),
        },
    },
    {
        id: "side-notes", hint: "文字让在右侧，商品主体不被压住",
        layout: {
            name: "侧边留白",
            blocks: blocks([
                { field: "headline", anchor: "middle-right", size: 7, bold: true, align: "right" },
                { field: "subhead", anchor: "bottom-right", size: 4, color: "#4A4A4A", bold: false, align: "right" },
            ]),
        },
    },
    {
        id: "detail-screen", hint: "详情页单屏：标题在上，正文在下",
        layout: {
            name: "详情页单屏",
            blocks: blocks([
                { field: "headline", anchor: "top-left", size: 6, bold: true },
                { field: "subhead", anchor: "bottom-left", size: 4, color: "#3A3A3A", bold: false },
            ]),
        },
    },
    {
        id: "poster", hint: "海报：标题居中，价格与引导分居两侧",
        layout: {
            name: "海报居中",
            blocks: blocks([
                { field: "headline", anchor: "top-center", size: 9, bold: true, align: "center", plate: "" },
                { field: "price", anchor: "bottom-left", size: 8, color: "#C8341F", bold: true },
                { field: "cta", anchor: "bottom-right", size: 5, plate: "#1A1A1ACC", color: "#FFFFFF", align: "center" },
            ]),
        },
    },
];

export function ecommerceLayoutPreset(id: string) {
    return ECOMMERCE_LAYOUT_PRESETS.find((preset) => preset.id === id);
}

export function createEcommerceLayoutFromPreset(id: string): EcommerceLayout | undefined {
    const preset = ecommerceLayoutPreset(id);
    return preset ? { ...createEcommerceLayout(preset.layout.name), ...preset.layout } : undefined;
}
