import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioInfoPoints, studioInfoText, studioMarket, studioProductTypeOf, studioTitleOf } from "./brief";
import { STUDIO_DESIGN_TONE_IDS, STUDIO_DESIGN_TONES, STUDIO_PLAN_SCOPES, studioDetailPlanFacts } from "./detail-plan";
import { extractStudioJson } from "./dossier-tasks";
import { STUDIO_PREP_LIMITS, studioAskOf, studioDirectionOf, studioPrepPromptLines } from "./plan-prep";
import { studioAutoColorIssue, studioDesignKnowledgeLines } from "./design-knowledge";
import { studioPlanImageLines, type StudioPlanImages } from "./detail-plan-tasks";
import { STUDIO_FACT_GROUP_LABEL, STUDIO_VIEW_LABEL, studioFactUsable, type StudioAsk, type StudioDirection, type StudioPlanScope, type StudioProduct } from "./types";

/**
 * 策划前的两个文本任务：
 * - 提问（ask）：商品图只看得到外观，真正的卖点、给谁用、在哪用只有卖家知道。按这件商品问 3–5 个选择题，
 *   测试环境里儿童眼镜只识别出外观，策划拿「镜片上的品牌字样」凑成了一个卖点，就是缺了这一步。
 * - 视角方案（directions）：给 3 个不同视角的方向（色彩世界、调性、首屏示例），卖家挑一个再排每一张。
 */
export type StudioIdFactory = () => string;

/** 这件商品现在知道什么：提问和视角方案共用。 */
function productLines(product: StudioProduct): string[] {
    const brief = product.brief;
    const points = studioInfoPoints(studioInfoText(product));
    const facts = studioDetailPlanFacts(product);
    const unsure = (product.dossier?.facts || []).filter((fact) => !studioFactUsable(fact)).map((fact) => fact.label.trim());
    const views = product.photos.filter((photo) => photo.truth).map((photo) => STUDIO_VIEW_LABEL[photo.view]);
    const groups = [...new Set(facts.map((fact) => fact.group))].map(
        (group) =>
            `${STUDIO_FACT_GROUP_LABEL[group]}：${facts
                .filter((fact) => fact.group === group)
                .map((fact) => `${fact.label} ${fact.value}`)
                .join("；")}`,
    );
    const type = studioProductTypeOf(product) || product.dossier?.category || "";
    return [
        "【商品】",
        `名称：${product.dossier?.name || product.name || type || "见商品图"}`,
        studioBrandOf(product) ? `品牌：${studioBrandOf(product)}` : "",
        type ? `商品类型：${type}` : "",
        product.dossier?.summary ? `概括：${product.dossier.summary}` : "",
        `商品图：${views.length ? views.join("、") : "正面"}`,
        studioTitleOf(product) ? `核心标题：${studioTitleOf(product)}` : "",
        points.length ? `卖点：${points.map((point) => `${point.title}${point.detail ? `（${point.detail}）` : ""}`).join("；")}` : "卖点：无",
        groups.length ? `已确认的事实：\n${groups.join("\n")}` : "已确认的事实：无",
        unsure.length ? `没有确认的信息：${unsure.join("、")}` : "",
        brief.audience.trim() ? `目标人群：${brief.audience.trim()}` : "",
        brief.positioning.trim() ? `价格定位：${brief.positioning.trim()}` : "",
        brief.extra.trim() ? `卖家补充要求：${brief.extra.trim()}` : "",
    ].filter(Boolean);
}

export function buildAskPrompt(product: StudioProduct) {
    const platform = ecommercePlatform(product.platform)?.name || "电商平台";
    return [
        `这件商品要在${platform}上做详情页、主图和海报。策划之前，先问卖家几个只有卖家知道的问题：商品图只看得到外观，真正打动买家的卖点、给谁用、在哪用、想要什么感觉，现在还不知道。`,
        "",
        ...productLines(product),
        "",
        "【要求】",
        `1. 问 3–${STUDIO_PREP_LIMITS.asks} 个最影响文案和画面的问题，按重要性排：真正的卖点和优势（材质、功能、工艺、认证这些图上看不出来的）、给谁用（年龄段、人群、买的人和用的人是不是同一个人）、在什么场景用、想要的感觉或风格、有没有不能出现或要避开的内容。上面已经写清楚的不再问。`,
        `2. 每个问题配 3–${STUDIO_PREP_LIMITS.options} 个可以直接点选的选项：写这一类商品真实常见的答案，短（不超过 10 个字）、具体（比如「TR90 材质」「可配近视镜片」「6–12 岁」「上学通勤」），不要「其他」「都可以」「不确定」；可以同时成立的写 multi: true。`,
        "3. question 不超过 20 个字，口语、直接（比如「这副眼镜主要给多大的孩子？」），不要「请问」「麻烦」。",
        "4. 选项只是给卖家勾选的候选，不是这件商品的事实。不问价格和促销，不问商品图上已经看得清的东西，不问品牌名。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        '{"asks":[{"question":"","options":[""],"multi":false}]}',
    ].join("\n");
}

/** 读回提问：问题和选项按上限截断，少于两个选项的问题不要；一个都没有时报错。 */
export function parseAsks(raw: string, createId: StudioIdFactory): StudioAsk[] {
    const data = extractStudioJson(raw);
    const asks = (Array.isArray(data.asks) ? data.asks : [])
        .map((item) => (item && typeof item === "object" ? { ...(item as Record<string, unknown>), id: createId(), picked: [], note: "" } : item))
        .map(studioAskOf)
        .filter((ask): ask is StudioAsk => Boolean(ask))
        .slice(0, STUDIO_PREP_LIMITS.asks);
    if (!asks.length) throw new Error("没有生成可用的问题，请重试或换一个文本模型");
    return asks;
}

function scopeLabel(product: StudioProduct, scope: StudioPlanScope | undefined) {
    if (scope === "template") return product.brief.suite?.kind === "main" ? "主图套图" : "详情页";
    return scope ? STUDIO_PLAN_SCOPES[scope].label : "这组图";
}

/** images 是随任务附带的商品图张数和参考图张数。 */
export function buildDirectionsPrompt(product: StudioProduct, scope: StudioPlanScope | undefined, images?: StudioPlanImages) {
    const platform = ecommercePlatform(product.platform)?.name || "电商平台";
    const brief = product.brief;
    return [
        `为这件商品想 3 个明显不同的视角方案，卖家会挑一个，再按它排${platform}的${scopeLabel(product, scope)}。`,
        "",
        ...productLines(product),
        ...studioPlanImageLines(images),
        ...studioDesignKnowledgeLines(product),
        ...studioPrepPromptLines({ asks: brief.prep?.asks || [], directions: [] }),
        "",
        `【出图条件】市场：${studioMarket(brief.market).label}`,
        "",
        "【设计调性】（tone 只能从这里选）",
        ...STUDIO_DESIGN_TONE_IDS.map((id) => `- ${id}（${STUDIO_DESIGN_TONES[id].label}）：${STUDIO_DESIGN_TONES[id].use}`),
        "",
        "【要求】",
        "1. 每个方案从一个不同的视角讲这件商品：买的人的担心和放心、用的人的体验、真实功能、生活方式、送礼……按已有资料选最适合的 3 个。三个方案还须有不同的首屏构成钩子、文字与摄影关系，不能同一摆拍只换背景、色板或字体名称。用户锁定同款时保留版式，变化未锁定的内容。",
        `2. angle 是视角名字（不超过 8 个字）；positioning 是差异化定位（不超过 ${STUDIO_PREP_LIMITS.positioning} 个字）；concept 是与本品相关的视觉主题（不超过 ${STUDIO_PREP_LIMITS.concept} 个字）；tone 是调性编号；palette 是 3 个颜色（色名和 #色值）；headline 是完整的首屏标题示例，通常用 6–16 字，不为凑字数删除对象与条件；visual 是首屏构成摘要（上限 ${STUDIO_PREP_LIMITS.visual} 字），写标题原文的主次、语义分行、摄影尺度与证据关系，最后写色调；why 说明打动谁、已有证据和构成为何适合（不超过 40 个字）。`,
        "3. headline 是一个具体购买结论，不是泛情绪口号：在内部比较具体描述、真实动作和选购条件的写法，再选择与本品证据和语气最贴切的一句。只用上面的卖点、事实和卖家补充；不编性能，不把品牌字样、印字和型号当卖点。visual 必须按这句实际标题组织阅读路径与摄影证据，不能文案和画面各说各的。",
        "4. 给孩子、宠物和吃的东西，色彩世界要明亮有温度，不用整套灰白；三个方案不能都是浅色极简。",
        "5. 不写其他品牌，不编参数、认证、功效和价格。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        '{"directions":[{"angle":"","positioning":"","concept":"","tone":"","palette":[{"name":"","hex":"#000000"}],"headline":"","visual":"","why":""}]}',
    ].join("\n");
}

/** 读回视角方案：至少要两个能用的方向，否则让用户重试。 */
export function parseDirections(raw: string, createId: StudioIdFactory, product?: StudioProduct): StudioDirection[] {
    const data = extractStudioJson(raw);
    const directions = (Array.isArray(data.directions) ? data.directions : [])
        .map((item) => (item && typeof item === "object" ? { ...(item as Record<string, unknown>), id: createId() } : item))
        .map(studioDirectionOf)
        .filter((direction): direction is StudioDirection => Boolean(direction))
        .slice(0, STUDIO_PREP_LIMITS.directions);
    if (directions.length < 2) throw new Error("没有生成足够的视角方案，请重试或换一个文本模型");
    if (product)
        for (const direction of directions) {
            const issue = studioAutoColorIssue(product, { style: direction.visual, palette: direction.palette });
            if (issue) throw new Error(issue);
        }
    return directions;
}
