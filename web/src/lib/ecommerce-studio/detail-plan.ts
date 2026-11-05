import { STUDIO_STYLES } from "./shot-specs";
import { studioFactUsable, type StudioBrief, type StudioDetailLayoutId, type StudioDetailPlan, type StudioFact, type StudioPlannedScreen, type StudioProduct, type StudioShotRole, type StudioStylePresetId } from "./types";

/**
 * 详情页策划：详情页固定 10 屏，每一屏讲什么、画面和文案由文本模型按这件商品排，不再每件商品都用按品类固定的同一套。
 * 没有可用的文本模型时才退回按品类的默认 10 屏。
 * 这里是策划的数据规则（能排哪些屏型、读回与修改）；提示词和解析在 detail-plan-tasks.ts。
 */
export const STUDIO_DETAIL_PLAN_CAPABILITY = "detail-plan";
/** 出图记录和结果区里这一组的名字。 */
export const STUDIO_DETAIL_PLAN_NAME = "按商品策划";

export const STUDIO_DETAIL_PLAN_LIMITS = {
    /** 详情页固定的屏数，策划按这个数排。 */
    screens: 10,
    /** 屏型依据不够被去掉后，少于这个数就要求重新策划。 */
    minScreens: 6,
    maxScreens: 10,
    title: 16,
    purpose: 80,
    visual: 400,
    /** 这一屏的信息元素：几个图标画什么、引线指向哪里、拼格放什么。 */
    elements: 200,
    eyebrow: 28,
    headline: 24,
    subline: 40,
    lines: 6,
    line: 30,
    facts: 6,
    summary: 200,
    style: 800,
} as const;

/**
 * 详情页的版式：平台上设计过的详情页每一屏都是排过版的画面（图标卖点、引线标注、拼格、对照……），
 * 不是「一张商品照片加一行标题」。use 给策划看，render 写进出图提示词；lines 说明要点文字在这种版式里的用法。
 */
export const STUDIO_DETAIL_LAYOUTS: Record<StudioDetailLayoutId, { label: string; use: string; render: string; lines: string }> = {
    poster: {
        label: "海报大字",
        use: "首屏或情绪屏：商品大图配超大标题，一眼抓住注意力",
        render: "海报式构图：商品是画面里最大的主体，主标题用超大字号占据上部约三分之一，强对比、留白干净，像品牌主视觉",
        lines: "要点（主标题下方一行小字，用细竖线隔开）",
    },
    split: {
        label: "左右分栏",
        use: "讲一个卖点：一侧商品或场景大图，另一侧标题和两三行说明",
        render: "画面左右分栏：一侧放商品或场景大图，另一侧是文字栏，文字栏有栏目小标题、主标题、副标题和要点，纵向对齐",
        lines: "要点（文字栏里纵向排列，每条前面一个小圆点或短线）",
    },
    icons: {
        label: "图标卖点",
        use: "一屏讲 3–6 个卖点：每个卖点一个图标配一条短标签",
        render: "上方是标题区，下方是 3–6 个统一风格的线框图标横排或排成宫格，每个图标下面一条短标签，商品放在标题区旁边或图标区上方",
        lines: "图标标签（每个图标下面一条，图标按标签内容画）",
    },
    callout: {
        label: "引线标注",
        use: "讲结构和细节：商品大图，几条细引线指向具体部位并配标签",
        render: "商品大图居中，2–4 条细引线从商品对应部位引出，末端是一个小圆点加短标签，引线互不交叉",
        lines: "引线标签（每条引线末端一条，指向标签说的那个部位）",
    },
    compare: {
        label: "对照",
        use: "讲差别：同一件商品的两种状态、两个角度或使用前后，左右或上下两栏",
        render: "画面分成左右或上下两栏对照，中间一条细分隔线，每栏顶部一个短标签；只对照这件商品自身，不出现其他品牌或商品",
        lines: "两栏的标签（第一条给第一栏，第二条给第二栏）",
    },
    grid: {
        label: "细节拼格",
        use: "一屏看几个细节：2×2 或一大两小拼格，每格一个部位特写",
        render: "画面是 2×2 或一大两小的拼格，格子之间留细缝，每格是一个部位的特写，每格角落一条短标签",
        lines: "拼格标签（按格子顺序，每格一条）",
    },
    scene: {
        label: "场景大片",
        use: "使用场景、上身效果：满版场景照片，文字压在留白或半透明色块上",
        render: "满版的场景或人物照片，像杂志大片，文字放在画面留白处或一块半透明色块上，不挡商品",
        lines: "要点（压在色块上的一两行小字）",
    },
    data: {
        label: "大字数据",
        use: "有已确认的关键数值时：一个大号数字或关键词做视觉中心",
        render: "一个大号数字或关键词居中做视觉中心，下方一行说明，商品放在一侧或底部陪衬",
        lines: "要点（大号数字下方的说明行）",
    },
    spec: {
        label: "参数尺寸",
        use: "规格、尺寸、包装清单：商品正视图或线稿配尺寸线和参数表",
        render: "商品正视图配细尺寸线，旁边或下方是一张简洁的参数表（左列项目、右列内容，细分隔线），整体像产品说明书",
        lines: "参数行（每条「项目：内容」，排成表格）",
    },
    closing: {
        label: "收尾承诺",
        use: "最后一屏：商品回到画面中心，回顾理由，底部一排小图标",
        render: "商品回到画面中心，上方是回顾的标题，底部一排 3–4 个小图标配短标签，收在整套的主色上",
        lines: "底部图标标签（每个小图标下面一条）",
    },
};
export const STUDIO_DETAIL_LAYOUT_IDS = Object.keys(STUDIO_DETAIL_LAYOUTS) as StudioDetailLayoutId[];

/** 模型没给版式时按屏型补一个。 */
const ROLE_LAYOUT: Partial<Record<StudioShotRole, StudioDetailLayoutId>> = {
    "detail-hero": "poster",
    "detail-selling": "icons",
    "detail-model": "scene",
    "detail-scene": "scene",
    "detail-material": "callout",
    "detail-closeup": "callout",
    "detail-angles": "grid",
    "detail-spec": "spec",
    "detail-size": "spec",
    "detail-package": "grid",
    "detail-closing": "closing",
};

/** 英文或编号小标题：只收字母、空格和少量符号，可以带两位序号（如「01 CLEAR FRAME」），不收别的数字。 */
const EYEBROW_PATTERN = /^(?:\d{2}\s*[/·.|-]?\s*)?[A-Za-z][A-Za-z &'.-]*$/;

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
    const layout = typeof record.layout === "string" && STUDIO_DETAIL_LAYOUT_IDS.includes(record.layout as StudioDetailLayoutId) ? (record.layout as StudioDetailLayoutId) : ROLE_LAYOUT[role] || "split";
    const eyebrow = text(record.eyebrow, limits.eyebrow);
    return {
        role,
        title: text(record.title, limits.title) || STUDIO_DETAIL_SCREEN_GUIDE[role].label,
        purpose: text(record.purpose, limits.purpose),
        visual,
        layout,
        elements: text(record.elements, limits.elements),
        eyebrow: EYEBROW_PATTERN.test(eyebrow) ? eyebrow : "",
        headline: text(record.headline, limits.headline),
        subline: text(record.subline, limits.subline),
        lines: textList(record.lines, limits.lines, limits.line),
        facts: textList(record.facts, limits.facts, 40),
        ...(record.noText === true ? { noText: true } : {}),
    };
}

/** 读回表单里的策划：字段不全或屏数不够时当作没有策划。 */
export function normalizeStudioDetailPlan(value: unknown): StudioDetailPlan | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id || !Array.isArray(record.screens)) return undefined;
    const screens = record.screens
        .map((screen) => studioPlannedScreenOf(screen, false))
        .filter((screen): screen is StudioPlannedScreen => Boolean(screen))
        .slice(0, STUDIO_DETAIL_PLAN_LIMITS.maxScreens);
    if (screens.length < STUDIO_DETAIL_PLAN_LIMITS.minScreens) return undefined;
    const styleId = studioPlanStyleId(record.styleId);
    return {
        id: record.id.slice(0, 40),
        createdAt: text(record.createdAt, 40),
        model: text(record.model, 120),
        summary: text(record.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
        style: text(record.style, STUDIO_DETAIL_PLAN_LIMITS.style),
        ...(styleId ? { styleId } : {}),
        screens,
    };
}

/** 策划挑的质感预设：只认识预设里的编号。 */
export function studioPlanStyleId(value: unknown): StudioStylePresetId | undefined {
    return typeof value === "string" && STUDIO_STYLES.some((style) => style.id === value) ? (value as StudioStylePresetId) : undefined;
}

/** 改策划里的一屏（标题、版式、画面、信息元素和文案），返回新的表单参数；超出上限的部分截掉。 */
export function patchStudioDetailPlanScreen(brief: StudioBrief, index: number, patch: Partial<Pick<StudioPlannedScreen, "title" | "layout" | "visual" | "elements" | "headline" | "subline" | "lines">>): StudioBrief {
    const plan = brief.detailPlan;
    const current = plan?.screens[index];
    if (!plan || !current) return brief;
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const next: StudioPlannedScreen = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.slice(0, limits.title) } : {}),
        ...(patch.visual !== undefined ? { visual: patch.visual.slice(0, limits.visual) } : {}),
        ...(patch.layout && STUDIO_DETAIL_LAYOUT_IDS.includes(patch.layout) ? { layout: patch.layout } : {}),
        ...(patch.elements !== undefined ? { elements: patch.elements.slice(0, limits.elements) } : {}),
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

/** 出图记录里一屏的版式、目的、画面和信息元素合在一起的上限。 */
export const STUDIO_SHOT_VISUAL_MAX = 1000;

/** 出图时写进提示词的这一屏：版式、目的、画面、信息元素依次写。画面被清空时返回空，这一屏改按镜头规格出。 */
export function studioPlannedShotVisual(screen: Pick<StudioPlannedScreen, "purpose" | "visual"> & Partial<Pick<StudioPlannedScreen, "layout" | "elements">>) {
    const visual = screen.visual.trim();
    if (!visual) return "";
    const layout = screen.layout ? STUDIO_DETAIL_LAYOUTS[screen.layout] : undefined;
    const purpose = screen.purpose.trim();
    const elements = screen.elements?.trim() || "";
    return [layout ? `版式「${layout.label}」：${layout.render}。` : "", purpose ? `这一屏要让买家明白：${purpose}` : "", `画面：${visual}`, elements ? `信息元素：${elements}` : ""].filter(Boolean).join("\n").slice(0, STUDIO_SHOT_VISUAL_MAX);
}
