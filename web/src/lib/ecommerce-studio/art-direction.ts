import type { StudioShot, StudioProduct } from "./types";
import type { StudioTextZone } from "./shot-specs";

/** 底图与排字共用坐标，防止留白与导出错位。 */
export function studioDesignZone(shot: Pick<StudioShot, "layout">, fallback: StudioTextZone): StudioTextZone {
    if (["spec", "data", "icons", "closing"].includes(shot.layout || "")) return { x: 0.07, y: 0.48, width: 0.86, height: 0.46, align: "left", vAlign: "top" };
    if (["poster", "scene", "pain"].includes(shot.layout || "")) return { x: 0.07, y: 0.06, width: 0.86, height: 0.32, align: "left", vAlign: "top" };
    return fallback;
}

export function reviewStudioCopy(shot: Pick<StudioShot, "headline" | "subline" | "lines">) {
    const issues: { code: string; message: string }[] = [];
    const text = [shot.headline, shot.subline, ...shot.lines].join(" ");
    if (/品质之选|匠心打造|焕新生活|重新定义|尊享|臻选|好物推荐|开启.*生活/.test(text)) issues.push({ code: "generic", message: "口号缺少商品信息。把已确认卖点放进标题，用细节证明它。" });
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
    taobao: "移动端商品决策：首屏一个核心利益点，之后用真实细节、规格和使用过程证明；标题、编号、边距统一，摄影屏与信息屏交替。",
    amazon: "区分白底主图与 A+ 内容：主图仅商品；A+ 用场景、特征细节、使用说明与真实参数，按模块组织，避免把促销海报当主图。",
    douyin: "购买决策图：清楚的商品轮廓，一个使用问题配一个看得见的证明；少字，重点在手机上可读，首图遵守平台规格。",
    xiaohongshu: "内容封面与内页：封面表达具体问题，内页展开使用场景与选购依据；采用编辑式层级和生活摄影，不伪造体验、评价或前后效果。",
};

export function studioChannelDesign(platform: string) {
    return STUDIO_CHANNEL_DESIGN[platform] || STUDIO_CHANNEL_DESIGN.taobao;
}
