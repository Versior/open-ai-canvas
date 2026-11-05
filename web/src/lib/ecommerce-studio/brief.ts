import { ecommerceRoleSpec } from "@/lib/ecommerce/ecommerce-platform-specs";
import { IMAGE_RATIOS } from "@/lib/image-size-presets";
import { studioShotSpec } from "./shot-specs";
import { studioPromptText } from "./prompt-overrides";
import { normalizeStudioSuite } from "./suites";
import type { StudioModelCast, StudioModelPick, StudioBrief, StudioLanguage, StudioMarket, StudioOutputType, StudioPlanKind, StudioProduct, StudioSellingPoint, StudioShotRole, StudioShooting } from "./types";

/**
 * 生图表单：出图类型、市场、语言、拍法这些选项的定义，以及表单字段的读取规则。
 * 选项文案给用户看，prompt 字段写进提示词；两者分开，改界面文案不会改变出图效果。
 */
export type StudioOutputSpec = { id: StudioOutputType; label: string; hint: string; role?: StudioShotRole; set?: StudioPlanKind };

export const STUDIO_OUTPUT_TYPES: StudioOutputSpec[] = [
    { id: "main", label: "商品主图", hint: "商品加主标题，用作首图", role: "main-selling" },
    { id: "white", label: "白底图", hint: "纯白背景，适合搜索列表", role: "main-white" },
    { id: "scene", label: "场景图", hint: "放进真实的使用场景", role: "main-scene" },
    { id: "selling", label: "卖点图", hint: "一张图讲清三个卖点", role: "detail-selling" },
    { id: "closeup", label: "细节特写", hint: "放大材质和做工", role: "main-detail" },
    { id: "model", label: "模特图", hint: "上身或使用效果", role: "detail-model" },
    { id: "angles", label: "多角度图", hint: "正面、侧面、背面一张看全", role: "detail-angles" },
    { id: "poster", label: "海报头图", hint: "详情页首屏或活动海报", role: "detail-hero" },
    { id: "main-set", label: "主图套图（5 张）", hint: "白底、卖点、场景、细节、多角度", set: "main" },
    { id: "detail-set", label: "详情页（10 屏）", hint: "按品类排好十屏，可导出长图", set: "detail" },
    // 实际按主图还是详情页出，看选中模板的用途；没选模板前按详情页处理。
    { id: "template-set", label: "模板套图", hint: "从后台精选或内置模板库选一套，按模板逐张出图", set: "detail" },
];

export const STUDIO_MARKETS: { id: StudioMarket; label: string; language: StudioLanguage; prompt: string }[] = [
    { id: "cn", label: "中国大陆", language: "zh", prompt: "面向中国大陆消费者，审美简洁现代；画面里出现人物时为东亚面孔。" },
    { id: "hk-tw", label: "港澳台", language: "zh-hant", prompt: "面向港澳台消费者，审美精致；画面里出现人物时为东亚面孔。" },
    { id: "jp-kr", label: "日韩", language: "ja", prompt: "面向日韩市场，审美清新细腻、留白克制；画面里出现人物时为东亚面孔。" },
    { id: "sea", label: "东南亚", language: "en", prompt: "面向东南亚市场，色彩明快、有生活气息；画面里出现人物时为东南亚面孔。" },
    { id: "west", label: "欧美", language: "en", prompt: "面向欧美市场，场景和生活方式符合欧美习惯；画面里出现人物时可以是不同族裔。" },
    { id: "mena", label: "中东", language: "en", prompt: "面向中东市场，审美大气，人物着装得体保守。" },
];

export const STUDIO_LANGUAGES: { id: StudioLanguage; label: string; name: string }[] = [
    { id: "zh", label: "中文", name: "简体中文" },
    { id: "zh-hant", label: "繁體中文", name: "繁体中文" },
    { id: "en", label: "English", name: "英文" },
    { id: "ja", label: "日本語", name: "日文" },
    { id: "ko", label: "한국어", name: "韩文" },
    { id: "none", label: "不加文字", name: "" },
];

export const STUDIO_SHOOTINGS: { id: StudioShooting; label: string; prompt: string }[] = [
    { id: "auto", label: "按出图类型", prompt: "" },
    { id: "studio", label: "纯商品棚拍", prompt: "纯商品棚拍：无缝背景，不放生活道具，光线干净可控。" },
    { id: "lifestyle", label: "生活场景", prompt: "放进真实的生活场景里拍摄，环境与商品用途一致，道具不超过 3 件。" },
    { id: "model", label: "模特穿搭/使用", prompt: "画面出现一位成年模特自然地穿戴或使用这件商品，商品清晰完整，是画面焦点；版型、颜色和细节与商品图一致。" },
    { id: "hand", label: "手持展示", prompt: "一只干净自然的手握住或托起商品展示，手部比例真实，不遮挡商品的标识和关键结构。" },
    { id: "flatlay", label: "平铺俯拍", prompt: "垂直俯拍的平铺构图，商品平放在干净的台面上，可以有少量呼应用途的小物件。" },
    { id: "macro", label: "微距特写", prompt: "微距特写，放大材质纹理和做工细节，浅景深。" },
];

export const STUDIO_COUNT_OPTIONS = [1, 2, 3, 4];

const OUTPUT_IDS = new Set(STUDIO_OUTPUT_TYPES.map((item) => item.id));
const MARKET_IDS = new Set(STUDIO_MARKETS.map((item) => item.id));
const LANGUAGE_IDS = new Set(STUDIO_LANGUAGES.map((item) => item.id));
const SHOOTING_IDS = new Set(STUDIO_SHOOTINGS.map((item) => item.id));
const RATIO_PATTERN = /^([1-9]\d?):([1-9]\d?)$/;
const SHOT_KEY_PATTERN = /^[a-z0-9-]{1,40}$/;

export function createStudioBrief(): StudioBrief {
    return { brand: "", productType: "", outputType: "main", market: "cn", language: "zh", shooting: "auto", audience: "", positioning: "", extra: "", sameLayout: false, count: 1, quality: "", ratio: "auto", shotOrder: [], shotSkip: [] };
}

/** 「重置参数」：品牌和商品类型属于商品本身，保留；其余回到默认。 */
export function resetStudioBriefParameters(brief: StudioBrief): StudioBrief {
    return { ...createStudioBrief(), brand: brief.brand, productType: brief.productType };
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function modelPick(value: unknown, withImage: boolean): StudioModelPick | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.itemId !== "string" || !record.itemId) return undefined;
    const resourceId = typeof record.resourceId === "string" && record.resourceId ? record.resourceId : undefined;
    if (withImage && !resourceId) return undefined;
    return {
        itemId: record.itemId.slice(0, 64),
        name: text(record.name, 60),
        prompt: text(record.prompt, 600),
        ...(resourceId ? { resourceId } : {}),
        ...(Number(record.width) > 0 ? { width: Number(record.width) } : {}),
        ...(Number(record.height) > 0 ? { height: Number(record.height) } : {}),
    };
}

/** 读回模特设定：人脸和姿势必须带已复制的原图，模特样式只要文字。 */
export function normalizeStudioModelCast(value: unknown): StudioModelCast | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const cast: StudioModelCast = {};
    const face = modelPick(record.face, true);
    const pose = modelPick(record.pose, true);
    const style = modelPick(record.style, false);
    if (face) cast.face = face;
    if (pose) cast.pose = pose;
    if (style?.prompt) cast.style = style;
    return cast.face || cast.pose || cast.style ? cast : undefined;
}

function shotKeys(value: unknown) {
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && SHOT_KEY_PATTERN.test(item)))].slice(0, 40) : [];
}

export function normalizeStudioBrief(value: unknown): StudioBrief {
    const base = createStudioBrief();
    if (!value || typeof value !== "object" || Array.isArray(value)) return base;
    const record = value as Record<string, unknown>;
    const count = Number(record.count);
    const suite = normalizeStudioSuite(record.suite);
    const model = normalizeStudioModelCast(record.model);
    return {
        brand: text(record.brand, 40),
        productType: text(record.productType, 40),
        outputType: OUTPUT_IDS.has(record.outputType as StudioOutputType) ? (record.outputType as StudioOutputType) : base.outputType,
        market: MARKET_IDS.has(record.market as StudioMarket) ? (record.market as StudioMarket) : base.market,
        language: LANGUAGE_IDS.has(record.language as StudioLanguage) ? (record.language as StudioLanguage) : base.language,
        shooting: SHOOTING_IDS.has(record.shooting as StudioShooting) ? (record.shooting as StudioShooting) : base.shooting,
        audience: text(record.audience, 60),
        positioning: text(record.positioning, 60),
        extra: text(record.extra, 300),
        sameLayout: record.sameLayout === true,
        count: Number.isInteger(count) && STUDIO_COUNT_OPTIONS.includes(count) ? count : base.count,
        quality: text(record.quality, 20),
        ratio: typeof record.ratio === "string" && (record.ratio === "auto" || RATIO_PATTERN.test(record.ratio)) ? record.ratio : base.ratio,
        ...(suite ? { suite } : {}),
        ...(model ? { model } : {}),
        shotOrder: shotKeys(record.shotOrder),
        shotSkip: shotKeys(record.shotSkip),
    };
}

export function studioOutputSpec(type: StudioOutputType) {
    return STUDIO_OUTPUT_TYPES.find((item) => item.id === type) || STUDIO_OUTPUT_TYPES[0];
}

export function studioMarket(id: StudioMarket) {
    const market = STUDIO_MARKETS.find((item) => item.id === id) || STUDIO_MARKETS[0];
    return { ...market, prompt: studioPromptText(`market.${market.id}`, market.prompt) };
}

export function studioLanguage(id: StudioLanguage) {
    return STUDIO_LANGUAGES.find((item) => item.id === id) || STUDIO_LANGUAGES[0];
}

export function studioShooting(id: StudioShooting) {
    const shooting = STUDIO_SHOOTINGS.find((item) => item.id === id) || STUDIO_SHOOTINGS[0];
    // 「按出图类型」本身不加文字，不给后台改。
    return shooting.id === "auto" ? shooting : { ...shooting, prompt: studioPromptText(`shooting.${shooting.id}`, shooting.prompt) };
}

/** 卖点与商品信息：一行一条，「标题：说明」拆成两级；前面的序号和圆点去掉。 */
export function studioInfoPoints(info: string) {
    return info
        .split(/\n|；|;/)
        .map((line) => line.replace(/^\s*(?:[-*·•]|\d+[.、)])\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((line) => {
            const match = line.match(/^(.{1,24}?)[：:｜|](.+)$/);
            return match ? { title: match[1].trim(), detail: match[2].trim().slice(0, 60) } : { title: line.slice(0, 24), detail: "" };
        });
}

export function studioPointLine(point: Pick<StudioSellingPoint, "title" | "detail">) {
    return point.detail.trim() ? `${point.title.trim()}：${point.detail.trim()}` : point.title.trim();
}

/**
 * 表单是出图的唯一依据：卖点与商品信息、品牌、商品类型都只读表单里的值，看到什么就用什么。
 * 识别或助手写好的内容先作为建议，用户点「填入」后才进入表单。
 */
export function studioInfoText(product: StudioProduct) {
    return product.sellerNotes;
}

export function studioBrandOf(product: StudioProduct) {
    return product.brief.brand;
}

export function studioProductTypeOf(product: StudioProduct) {
    return product.brief.productType;
}

export function studioTitleOf(product: StudioProduct) {
    return product.copy?.headline || "";
}

export function studioDisplayName(product: StudioProduct) {
    return product.name.trim() || [product.brief.brand, product.brief.productType].filter((item) => item.trim()).join(" ") || product.dossier?.name || "未命名商品";
}

function dossierBrand(product: StudioProduct) {
    return product.dossier?.facts.find((fact) => /^品牌/.test(fact.label.trim()) && (fact.evidence === "visible" || fact.evidence === "confirmed"))?.value.trim() || "";
}

export type StudioSuggestion = { brand: string; productType: string; info: string; points: number };

/** 档案或卖点里有、表单里还空着的内容（通常是助手写的），供「填入表单」使用。 */
export function studioSuggestion(product: StudioProduct): StudioSuggestion | undefined {
    const points = product.sellingPoints.filter((point) => point.enabled && point.title.trim());
    const info = product.sellerNotes.trim() ? "" : points.map(studioPointLine).join("\n");
    const brand = product.brief.brand.trim() ? "" : dossierBrand(product);
    const productType = product.brief.productType.trim() ? "" : product.dossier?.category.trim() || "";
    if (!info && !brand && !productType) return undefined;
    return { brand, productType, info, points: info ? points.length : 0 };
}

export function applyStudioSuggestion(product: StudioProduct): StudioProduct {
    const suggestion = studioSuggestion(product);
    if (!suggestion) return product;
    return {
        ...product,
        sellerNotes: suggestion.info || product.sellerNotes,
        brief: { ...product.brief, brand: suggestion.brand || product.brief.brand, productType: suggestion.productType || product.brief.productType },
    };
}

/** 把宽高换成最接近的常用比例，用于「按参考图版式」时跟随参考图的画幅。 */
export function studioNearestRatio(width: number, height: number, candidates: string[] = IMAGE_RATIOS) {
    if (!(width > 0 && height > 0) || !candidates.length) return undefined;
    const target = Math.log(width / height);
    let best = candidates[0];
    let distance = Infinity;
    for (const ratio of candidates) {
        const [w, h] = ratio.split(":").map(Number);
        if (!(w > 0 && h > 0)) continue;
        const gap = Math.abs(Math.log(w / h) - target);
        if (gap < distance) {
            best = ratio;
            distance = gap;
        }
    }
    return best;
}

/** 「自动」比例：主图与白底图跟平台主图规格，其余按竖版 3:4。 */
export function studioDefaultRatio(role: StudioShotRole, product: StudioProduct) {
    const spec = studioShotSpec(role, product.dossier?.family || "generic");
    if (spec.platformRole === "main" || spec.platformRole === "white") return ecommerceRoleSpec(product.platform, spec.platformRole)?.ratio || "1:1";
    return "3:4";
}

/** 这次出图用的比例：用户选了就按用户的；「自动」时同款版式跟参考图，否则按镜头类型推荐。 */
export function studioRunRatio(role: StudioShotRole, product: StudioProduct) {
    const brief = product.brief;
    if (brief.ratio !== "auto") return brief.ratio;
    const reference = brief.sameLayout ? product.references[0] : undefined;
    const fromReference = reference?.width && reference.height ? studioNearestRatio(reference.width, reference.height) : undefined;
    return fromReference || studioDefaultRatio(role, product);
}

/** 平台首图不许加字时（京东、抖音、亚马逊等），卖点主图的文字就不写进图里。 */
export function studioPlatformForbidsText(product: StudioProduct, role: StudioShotRole) {
    const spec = studioShotSpec(role, product.dossier?.family || "generic");
    return spec.platformRole === "main" && Boolean(ecommerceRoleSpec(product.platform, "main")?.noText);
}
