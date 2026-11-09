import catalog from "../../../../backend/internal/ecommerceagent/studio_design_catalog.json";
import type { StudioCompositionId, StudioShot, StudioProduct, StudioShotRole } from "./types";
import type { StudioTextZone } from "./shot-specs";

/** 底图与排字共用坐标，防止留白与导出错位。 */
export const STUDIO_COMPOSITIONS = catalog.compositions as Record<StudioCompositionId, { label: string; render: string; zone: StudioTextZone }>;
/** 草图、策划和知识库共用同一份分区，新增骨架不退回默认布局。 */
export const STUDIO_IMAGE_ZONES = catalog.imageZones as Record<StudioCompositionId, [number, number, number, number][]>;
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
export function nextStudioComposition(role: StudioShotRole, previous?: StudioCompositionId, index = 0, candidates?: StudioCompositionId[]): StudioCompositionId | undefined {
    if (role === "main-white") return undefined;
    const choices: StudioCompositionId[] = /spec|size/.test(role)
        ? ["bottom", "right", "left", "top"]
        : /steps/.test(role)
          ? ["timeline", "triptych", "diptych"]
          : /compare/.test(role)
            ? ["diptych", "ribbon"]
            : /closeup|material|detail$/.test(role)
              ? ["macro", "mosaic", "sidebar", "orbit"]
              : candidates?.length
                ? candidates
                : /scene|model|seeding|ugc/.test(role)
                  ? ["corner", "window", "bottom", "diagonal", "sidebar"]
                  : ["left", "arch", "ribbon", "right", "center"];
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

export const STUDIO_CHANNEL_DESIGN: Record<string, string> = catalog.platforms;

export function studioChannelDesign(platform: string) {
    return STUDIO_CHANNEL_DESIGN[platform] || "按当前平台的商品图规范区分首图与内容图；明确商品、买家和购买问题，依据信息密度安排摄影与说明，保持手机端可读。";
}
