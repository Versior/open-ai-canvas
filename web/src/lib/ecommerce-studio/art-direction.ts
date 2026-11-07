import type { StudioCompositionId, StudioShot, StudioProduct, StudioShotRole } from "./types";
import type { StudioTextZone } from "./shot-specs";

/** 底图与排字共用坐标，防止留白与导出错位。 */
export const STUDIO_COMPOSITIONS: Record<StudioCompositionId, { label: string; render: string; zone: StudioTextZone }> = {
    left: { label: "左文右图", render: "文字占左侧约 40%，商品在右侧形成主视觉；用不对称留白和大幅裁切，让主体与文字互相呼应", zone: { x: 0.06, y: 0.12, width: 0.38, height: 0.72, align: "left", vAlign: "center" } },
    right: { label: "左图右文", render: "商品或局部摄影占左侧约 55%，右侧文字纵向排布；正文与细节形成阅读路径，避免居中展台摆拍", zone: { x: 0.58, y: 0.12, width: 0.36, height: 0.72, align: "left", vAlign: "center" } },
    top: { label: "上文下图", render: "上部为短标题和大留白，下部以商品、场景或微距做视觉重心；标题可以分行，主体避免缩成小图", zone: { x: 0.07, y: 0.06, width: 0.86, height: 0.3, align: "left", vAlign: "top" } },
    bottom: { label: "上图下文", render: "上方大幅摄影占约 60%，下方以窄文字区收住；可以采用满版局部裁切，不重复上方标题加中央展台的构图", zone: { x: 0.07, y: 0.66, width: 0.86, height: 0.28, align: "left", vAlign: "top" } },
    center: { label: "中轴海报", render: "标题在上方居中形成明确中轴，主体在下方放大并与光影或主题道具相呼应；信息克制，不堆叠统一圆角卡片", zone: { x: 0.12, y: 0.06, width: 0.76, height: 0.28, align: "center", vAlign: "top" } },
    corner: { label: "满版角落题签", render: "摄影满版，商品或人物在右下侧，左上方留一块约三分之一宽的自然负空间放题签；像杂志内页，文字紧凑，不加通用标题横条", zone: { x: 0.07, y: 0.07, width: 0.38, height: 0.38, align: "left", vAlign: "top" } },
};
export const STUDIO_COMPOSITION_IDS = Object.keys(STUDIO_COMPOSITIONS) as StudioCompositionId[];
export function studioCompositionOf(value: unknown): StudioCompositionId | undefined {
    return typeof value === "string" && Object.hasOwn(STUDIO_COMPOSITIONS, value) ? (value as StudioCompositionId) : undefined;
}

/** 只识别明确写出的反向分区，不把道具位置或局部标签误判为主标题位置。 */
export function studioCompositionConflict(shot: Pick<StudioShot, "composition" | "visual">) {
    if (shot.composition !== "left" && shot.composition !== "right") return false;
    const opposite = shot.composition === "left" ? "右" : "左";
    return (
        new RegExp(`${opposite}(?:侧|边|半边|半部)?(?:约?[一二三四五六七八九十两\\d]+(?:成|%|％))?(?:留白|文字区|文案区|为|放|排|放置|纵向|\\s|约|短|主|题签){0,8}(?:标题|文案|文字)`).test(shot.visual || "") ||
        (shot.composition === "left" ? /左图右文/.test(shot.visual || "") : /左文右图/.test(shot.visual || ""))
    );
}

/** 新生成的一组换构图，失败重试沿用记录里的构图；白底商品图不参与。 */
export function nextStudioComposition(role: StudioShotRole, previous?: StudioCompositionId, index = 0): StudioCompositionId | undefined {
    if (role === "main-white") return undefined;
    const choices: StudioCompositionId[] = /scene|model|seeding|ugc/.test(role) ? ["corner", "bottom", "left", "right"] : /spec|size/.test(role) ? ["bottom", "right", "left", "top"] : ["left", "top", "right", "center"];
    const start = previous ? choices.indexOf(previous) + 1 : 0;
    return choices[(start + index) % choices.length];
}

export function studioDesignZone(shot: Pick<StudioShot, "layout" | "composition">, fallback: StudioTextZone): StudioTextZone {
    if (shot.composition) return STUDIO_COMPOSITIONS[shot.composition].zone;
    if (["spec", "data", "icons", "closing"].includes(shot.layout || "")) return { x: 0.07, y: 0.48, width: 0.86, height: 0.46, align: "left", vAlign: "top" };
    if (["poster", "scene", "pain"].includes(shot.layout || "")) return { x: 0.07, y: 0.06, width: 0.86, height: 0.32, align: "left", vAlign: "top" };
    return fallback;
}

export function reviewStudioCopy(shot: Pick<StudioShot, "headline" | "subline" | "lines">) {
    const issues: { code: string; message: string }[] = [];
    const text = [shot.headline, shot.subline, ...shot.lines].join(" ");
    if (/品质之选|匠心打造|焕新生活|重新定义|尊享|臻选|好物推荐|开启.*生活|更亮眼|更出众|陪你每一天/.test(text)) issues.push({ code: "generic", message: "口号缺少商品信息。把已确认卖点放进标题，用细节证明它。" });
    if (/最[好强佳]|第一|100%|绝对|根治|永久|全网最低/.test(text)) issues.push({ code: "claim", message: "检查绝对承诺或功效用语，删去没有证明的数据与结论。" });
    if (shot.headline.length > 18) issues.push({ code: "headline", message: "标题超过 18 字，手机缩略图难读。拆成主标题与说明。" });
    if (shot.subline.trim() && shot.subline.trim() === shot.headline.trim()) issues.push({ code: "repeat", message: "副标题重复主标题。改成材料、规格或使用条件。" });
    if (shot.lines.length > 3) issues.push({ code: "density", message: "这一屏超过 3 个要点。建议拆屏，每张回答一个购买问题。" });
    return issues;
}

/** 候选只取已确认的商品文案，不编造性能和折扣。 */
export function studioFactCopyOptions(product: StudioProduct) {
    return product.sellingPoints
        .filter((point) => point.enabled && (point.evidence === "visible" || point.evidence === "confirmed"))
        .slice(0, 4)
        .map((point) => ({ headline: point.title, subline: point.detail }));
}

export const STUDIO_CHANNEL_DESIGN: Record<string, string> = {
    taobao: "移动端商品决策：首屏一个核心利益点，之后用真实细节、规格和使用过程证明；共用字体、色板与边距，摄影屏与信息屏交替，图文重心随内容变化。",
    amazon: "区分白底主图与 A+ 内容：主图仅商品；A+ 用场景、特征细节、使用说明与真实参数，按模块组织，避免把促销海报当主图。",
    douyin: "购买决策图：清楚的商品轮廓，一个使用问题配一个看得见的证明；少字，重点在手机上可读，首图遵守平台规格。",
    xiaohongshu: "内容封面与内页：封面表达具体问题，内页展开使用场景与选购依据；采用编辑式层级和生活摄影，不伪造体验、评价或前后效果。",
};

export function studioChannelDesign(platform: string) {
    return STUDIO_CHANNEL_DESIGN[platform] || STUDIO_CHANNEL_DESIGN.taobao;
}
