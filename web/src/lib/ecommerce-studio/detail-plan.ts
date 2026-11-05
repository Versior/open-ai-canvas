import { studioFactUsable, type StudioBrief, type StudioDetailPlan, type StudioFact, type StudioPlannedScreen, type StudioProduct, type StudioShotRole } from "./types";

/**
 * 详情页策划：出详情页前先让文本模型按这件商品排每一屏，代替按品类固定的十屏。
 * 这里是策划的数据规则（能排哪些屏型、读回与修改）；提示词和解析在 detail-plan-tasks.ts。
 */
export const STUDIO_DETAIL_PLAN_CAPABILITY = "detail-plan";
/** 出图记录和结果区里这一组的名字。 */
export const STUDIO_DETAIL_PLAN_NAME = "按商品策划";

export const STUDIO_DETAIL_PLAN_LIMITS = {
    minScreens: 3,
    maxScreens: 12,
    title: 16,
    purpose: 80,
    visual: 400,
    headline: 24,
    subline: 40,
    lines: 4,
    line: 30,
    facts: 6,
    summary: 200,
    style: 400,
} as const;

type StudioDetailRole = Exclude<StudioShotRole, `main-${string}`>;

/** 详情页的屏型：给模型看的用途；材质、多角度、参数、尺寸、包装要有依据才能排。 */
export const STUDIO_DETAIL_SCREEN_GUIDE: Record<StudioDetailRole, { label: string; use: string }> = {
    "detail-hero": { label: "头图", use: "第一屏，建立第一印象：这是什么、凭什么值得看下去" },
    "detail-selling": { label: "卖点", use: "一屏讲清一个或几个核心卖点" },
    "detail-model": { label: "上身 / 佩戴 / 使用效果", use: "画面里有人穿戴或使用商品的屏都用它" },
    "detail-scene": { label: "使用场景", use: "一个具体的使用时刻或生活场景，没有人物或人物只露局部" },
    "detail-material": { label: "材质工艺", use: "用料和做工，只写已确认的材质" },
    "detail-closeup": { label: "细节特写", use: "放大商品图里看得到的一个部位" },
    "detail-angles": { label: "多角度", use: "同一画面展示几个角度，只用商品图里有的角度" },
    "detail-spec": { label: "规格参数", use: "参数表，只列已确认的参数" },
    "detail-size": { label: "尺寸参考", use: "尺寸或尺码，只写已确认的数值" },
    "detail-package": { label: "包装与配件", use: "到手有什么，只放已确认的包装和配件" },
    "detail-closing": { label: "收尾", use: "最后一屏，回顾理由、促成下单" },
};
const SCREEN_ROLES = Object.keys(STUDIO_DETAIL_SCREEN_GUIDE) as StudioDetailRole[];
const SIZE_LABEL = /尺寸|尺码|长|宽|高|厚|直径|口径|容量|重量|规格/;

/** 可以写进策划和文案的事实：图片可见或卖家已确认。 */
export function studioDetailPlanFacts(product: StudioProduct, predicate: (fact: StudioFact) => boolean = () => true) {
    return (product.dossier?.facts || []).filter((fact) => studioFactUsable(fact) && predicate(fact));
}

/**
 * 这件商品能排的屏型：材质、参数、尺寸、包装要有已确认的事实，多角度要有侧面或背面的商品图。
 * 没有依据的屏型不交给模型，也不接受模型排进来，避免出现空屏或编出来的参数。
 */
export function studioDetailPlanRoles(product: StudioProduct): StudioShotRole[] {
    const views = new Set(product.photos.filter((photo) => photo.truth).map((photo) => photo.view));
    const ready: Partial<Record<StudioDetailRole, boolean>> = {
        "detail-material": studioDetailPlanFacts(product, (fact) => fact.group === "material").length > 0,
        "detail-angles": views.has("side") || views.has("back"),
        "detail-spec": studioDetailPlanFacts(product, (fact) => fact.group === "spec").length >= 2,
        "detail-size": studioDetailPlanFacts(product, (fact) => SIZE_LABEL.test(fact.label)).length > 0,
        "detail-package": studioDetailPlanFacts(product, (fact) => fact.group === "package").length > 0,
    };
    return SCREEN_ROLES.filter((role) => ready[role] !== false);
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown, max: number, length: number) {
    return Array.isArray(value)
        ? value
              .map((item) => text(item, length))
              .filter(Boolean)
              .slice(0, max)
        : [];
}

/**
 * 读一屏：屏型要认识，其余字段按上限截断。模型给的结果要求画面不为空；
 * 读回用户改过的策划时画面可以清空，出图时这一屏改按镜头规格出。
 */
export function studioPlannedScreenOf(value: unknown, requireVisual = true): StudioPlannedScreen | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const role = typeof record.role === "string" && SCREEN_ROLES.includes(record.role as StudioDetailRole) ? (record.role as StudioDetailRole) : undefined;
    const visual = text(record.visual, limits.visual);
    if (!role || (requireVisual && !visual)) return undefined;
    return {
        role,
        title: text(record.title, limits.title) || STUDIO_DETAIL_SCREEN_GUIDE[role].label,
        purpose: text(record.purpose, limits.purpose),
        visual,
        headline: text(record.headline, limits.headline),
        subline: text(record.subline, limits.subline),
        lines: textList(record.lines, limits.lines, limits.line),
        facts: textList(record.facts, limits.facts, 40),
        ...(record.noText === true ? { noText: true } : {}),
    };
}

/** 读回表单里的策划：字段不全或不到三屏时当作没有策划。 */
export function normalizeStudioDetailPlan(value: unknown): StudioDetailPlan | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id || !Array.isArray(record.screens)) return undefined;
    const screens = record.screens
        .map((screen) => studioPlannedScreenOf(screen, false))
        .filter((screen): screen is StudioPlannedScreen => Boolean(screen))
        .slice(0, STUDIO_DETAIL_PLAN_LIMITS.maxScreens);
    if (screens.length < STUDIO_DETAIL_PLAN_LIMITS.minScreens) return undefined;
    return {
        id: record.id.slice(0, 40),
        createdAt: text(record.createdAt, 40),
        model: text(record.model, 120),
        summary: text(record.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
        style: text(record.style, STUDIO_DETAIL_PLAN_LIMITS.style),
        screens,
    };
}

/** 改策划里的一屏（标题、画面和文案），返回新的表单参数；超出上限的部分截掉。 */
export function patchStudioDetailPlanScreen(brief: StudioBrief, index: number, patch: Partial<Pick<StudioPlannedScreen, "title" | "visual" | "headline" | "subline" | "lines">>): StudioBrief {
    const plan = brief.detailPlan;
    const current = plan?.screens[index];
    if (!plan || !current) return brief;
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const next: StudioPlannedScreen = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.slice(0, limits.title) } : {}),
        ...(patch.visual !== undefined ? { visual: patch.visual.slice(0, limits.visual) } : {}),
        ...(patch.headline !== undefined ? { headline: patch.headline.slice(0, limits.headline) } : {}),
        ...(patch.subline !== undefined ? { subline: patch.subline.slice(0, limits.subline) } : {}),
        ...(patch.lines !== undefined ? { lines: patch.lines.slice(0, limits.lines).map((line) => line.slice(0, limits.line)) } : {}),
    };
    return { ...brief, detailPlan: { ...plan, screens: plan.screens.map((screen, position) => (position === index ? next : screen)) } };
}

/** 策划里的屏在镜头清单里的 key：p 加序号。 */
export function studioDetailPlanKey(index: number) {
    return `p${index}`;
}

/** 出图记录里一屏的目的与画面合在一起的上限。 */
export const STUDIO_SHOT_VISUAL_MAX = 600;

/** 出图时写进提示词的这一屏：目的在前，画面在后。画面被清空时返回空，这一屏改按镜头规格出。 */
export function studioPlannedShotVisual(screen: Pick<StudioPlannedScreen, "purpose" | "visual">) {
    const visual = screen.visual.trim();
    if (!visual) return "";
    const purpose = screen.purpose.trim();
    return (purpose ? `这一屏要让买家明白：${purpose}\n画面：${visual}` : `画面：${visual}`).slice(0, STUDIO_SHOT_VISUAL_MAX);
}
