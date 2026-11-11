import catalog from "../../../../backend/internal/ecommerceagent/studio_design_catalog.json";
import { STUDIO_STYLES } from "./shot-specs";
import { STUDIO_COMPOSITIONS, studioCompositionOf } from "./art-direction";
import { studioEvidenceLayouts } from "./design-knowledge";
import { STUDIO_SUITE_LIMITS, studioSuiteShotRole } from "./suites";
import {
    studioFactUsable,
    type StudioBrief,
    type StudioDesignToneId,
    type StudioDetailLayoutId,
    type StudioDetailPlan,
    type StudioFact,
    type StudioPlanKind,
    type StudioPlannedScreen,
    type StudioPlanScope,
    type StudioPlanTarget,
    type StudioProduct,
    type StudioShotRole,
    type StudioStylePresetId,
    type StudioSuite,
} from "./types";

/**
 * 详情页策划：屏数由用户选择，每一屏讲什么、画面和文案由文本模型按商品排。
 * 这里是策划的数据规则（能排哪些屏型、读回与修改）；提示词和解析在 detail-plan-tasks.ts。
 */
export const STUDIO_DETAIL_PLAN_CAPABILITY = "detail-plan";
/** 出图记录和结果区里这一组的名字。 */
export const STUDIO_DETAIL_PLAN_NAME = "按商品策划";
export const STUDIO_DETAIL_SCREEN_OPTIONS = Array.from({ length: 19 }, (_, index) => index + 2);
/** 程序只负责独立文字区，不假装能识别商品部位、画引线或拼镜头。 */
export const STUDIO_OVERLAY_LAYOUTS: StudioDetailLayoutId[] = ["poster", "split", "scene", "data", "spec", "icons", "closing"];
export function studioDetailScreenCount(brief: Pick<StudioBrief, "detailScreens">) {
    return STUDIO_DETAIL_SCREEN_OPTIONS.includes(brief.detailScreens) ? brief.detailScreens : 10;
}

export const STUDIO_DETAIL_PLAN_LIMITS = {
    /** 未选择屏数时的初始值。 */
    screens: 10,
    /** 屏型依据不够被去掉后，少于这个数就要求重新策划。 */
    minScreens: 6,
    /** 读回策划时最多收几屏：模板套图按模板的张数排，最多和模板一样多。 */
    maxScreens: STUDIO_SUITE_LIMITS.shots,
    title: 16,
    purpose: 80,
    visual: 1200,
    /** 这一屏的信息元素：几个图标画什么、引线指向哪里、拼格放什么。 */
    elements: 600,
    eyebrow: 28,
    headline: 24,
    subline: 40,
    lines: 6,
    line: 30,
    facts: 6,
    summary: 200,
    designAnalysis: 600,
    /** 差异化定位：这件商品和同类比凭什么不一样。 */
    positioning: 80,
    /** 创意主线：由定位推出的视觉主题，一个具体的世界或场景。 */
    concept: 100,
    /** 视觉元素库：从主题里取的几个能反复使用的元素。 */
    motifs: 5,
    motif: 12,
    /** 从同类爆款和参考图里借鉴了什么。 */
    inspiration: 100,
    style: 800,
} as const;

/**
 * 详情页的版式：平台上设计过的详情页每一屏都是排过版的画面（图标卖点、引线标注、拼格、对照……），
 * 不是「一张商品照片加一行标题」。use 给策划看，render 写进出图提示词；lines 说明要点文字在这种版式里的用法。
 */
export const STUDIO_DETAIL_LAYOUTS: Record<StudioDetailLayoutId, { label: string; use: string; render: string; lines: string }> = catalog.layouts;
export const STUDIO_DETAIL_LAYOUT_IDS = Object.keys(STUDIO_DETAIL_LAYOUTS) as StudioDetailLayoutId[];

/** 认证、备案、检测、专利这类事实：有它们才能排「资质背书」，否则等于让图片模型编证书。 */
const PROOF_FACT = /认证|备案|检测|报告|专利|注册证|械字|批准|资质|GMP|ISO/i;

export function studioHasProofFacts(product: StudioProduct) {
    return studioDetailPlanFacts(product, (fact) => PROOF_FACT.test(`${fact.label}${fact.value}`)).length > 0;
}

/** 这件商品能用的版式：没有认证类事实时不给「资质背书」。 */
export function studioDetailLayoutIds(product: StudioProduct): StudioDetailLayoutId[] {
    return studioEvidenceLayouts(product, studioHasProofFacts(product) ? STUDIO_DETAIL_LAYOUT_IDS : STUDIO_DETAIL_LAYOUT_IDS.filter((id) => id !== "proof"));
}

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
    "detail-seeding": "scene",
    "detail-compare": "compare",
    "detail-steps": "grid",
    "detail-collocation": "split",
    "detail-campaign": "poster",
    "detail-ugc": "scene",
    "detail-closing": "closing",
    "main-white": "poster",
    "main-selling": "poster",
    "main-scene": "scene",
    "main-detail": "callout",
    "main-angle": "poster",
    "main-flatlay": "poster",
};

/** 屏型默认的版式：模型给的版式不认识或这件商品不能用时补上。 */
export function studioRoleLayout(role: StudioShotRole): StudioDetailLayoutId {
    return ROLE_LAYOUT[role] || "split";
}

/**
 * 设计调性：平台上大牌和头部爆款的详情页好看，是因为整套有一个清楚的调性——版面节奏、字体、文案语气和摄影都按它来。
 * use 给策划看（挑哪个、文案怎么写），render 写进出图提示词（版面、字体和摄影怎么做）。
 */
export const STUDIO_DESIGN_TONES: Record<StudioDesignToneId, { label: string; use: string; render: string }> = {
    "global-minimal": {
        label: "国际大牌极简",
        use: "像苹果、戴森、无印良品的产品页：一屏只讲一件事，文案极短、克制、有分量，用感受和结果说话",
        render: "国际大牌官网式的极简版面：以留白、真实形体和受控光线建立清楚重心；标题可用细到中等字重的现代黑体，字阶按内容和手机阅读选择，以明暗、位置和间距形成层级；说明紧邻标题或对应证据，元素沿共同轴线对齐；栏目仅在给定且允许时出现，数字只用已有事实；留白和标题位置服从本屏蓝图",
    },
    editorial: {
        label: "时尚大片",
        use: "像 Nike、Lululemon 或时尚杂志：人物和动态是主角，一屏一句态度型短句",
        render: "时尚杂志式版面：由人物或商品的轮廓、动作和摄影边界组织阅读；裁切、标题尺度和明暗对比按内容选择，黑体或宋体与正文形成明确层级，字块和主图共同构图；只有已给定的文案可用于文字构成，不新增英文装饰字",
    },
    oriental: {
        label: "东方雅致",
        use: "像观夏、花西子：意象化、有诗意的文案，借自然、节气和器物说话",
        render: "东方雅致的版面：细肌理与留白组织清楚层级，宋体标题配黑体说明，分行和方向按内容选择；温和色彩与柔光展示真实形体，图形仅在承担分区或信息职责时使用，不自动添加印章或伪书法",
    },
    lifestyle: {
        label: "日系生活",
        use: "像无印良品、UNIQLO：朴素具体的文案，讲生活里的小场景和真实感受",
        render: "日系生活杂志式版面：真实场景与动作解释用途，自然光展示商品，字块沿摄影边界或主体轴线排布，黑体说明与标题有清楚层级；色彩自然且主次明确，说明按手机阅读设置足够字号，道具不抢主体",
    },
    tech: {
        label: "科技发布",
        use: "像小米、大疆、索尼的发布页：参数和结构讲得清楚有力，文案利落",
        render: "科技发布会式版面：深色背景配冷色轮廓光，关键数字用超大号细体，结构用线稿、爆炸图或透视图表现，细线和网格做辅助，标题利落有力",
    },
    care: {
        label: "专业护理",
        use: "像头部医用、保健和功效个护品牌的详情页：整套一个色彩世界，痛点、机理、成分和证据一路讲清，可信但不冰冷",
        render: "专业护理品牌的版面：整套一个色彩世界（午夜蓝、天空蓝或水蓝，加一个暖色强调），柔和的光效、光点和光晕，机理和成分用半透明 3D 示意图表现；共用细宋体或中黑体字体家族，标题位置、字号和图文重心随本屏内容变化，关键词换成强调色；图标和标签保持图形语言一致，不能每屏都放同一个栏目头或卡片；人物和场景照片统一调色，信息清楚、可信、不吓人",
    },
    "hot-seller": {
        label: "爆款转化",
        use: "像天猫头部爆款：痛点、方案、证明、对比、场景、细节、参数一路推进，标题直给买家得到的好处",
        render: "头部爆款详情页的版面：信息密度高但层级清楚，主标题醒目有力，用色块分区、图标和数字讲卖点，强调色只用一种，画面饱满但对齐整齐",
    },
    playful: {
        label: "年轻活力",
        use: "像泡泡玛特、喜茶：口语化、俏皮的短句，有梗但不土",
        render: "年轻活力的版面：明亮撞色，圆润的标题字体，少量扁平插画或几何图形点缀，构图轻松有节奏，留白仍然充足",
    },
};
export const STUDIO_DESIGN_TONE_IDS = Object.keys(STUDIO_DESIGN_TONES) as StudioDesignToneId[];

/** 让画面显得廉价的做法，写进出图提示词的禁止项。 */
export const STUDIO_TACKY_DESIGN = "不用描边字、渐变字、发光字、立体浮雕字和投影字，不用贴纸、爆炸形、星星、波点、三个小圆点、手绘箭头和促销角标，整张最多两种字体";

/** 栏目名可以使用商品图文的语言；数字仍须在策划解析时核对依据。 */
const EYEBROW_PATTERN = /^[\p{L}][\p{L}\p{M}\p{N}\s&'’.·-]*$/u;
/** 小标题前面的序号（如「01 CLEAR FRAME」的「01 」）：详情页是一张连续的长图，每屏带上序号就像页码。 */
const EYEBROW_NUMBER = /^\d{1,2}(?:\s*[/·.|-]\s*|\s+)/;

/** 读策划和出图记录里的栏目名，去掉屏序号。 */
export function studioEyebrowText(value: string) {
    const text = value.trim().replace(EYEBROW_NUMBER, "").trim();
    return EYEBROW_PATTERN.test(text) ? text : "";
}

export function studioForbidsEnglishHeading(notes: string) {
    return /(?:不要|不加|不用|不放|不出现|不安排|不需要|去掉|移除)(?:\s*英文|[^。；;\n]{0,80}[、，,]\s*英文(?:栏目|小标题|标题))/.test(notes);
}

/** 各屏型给策划看的用途；材质、多角度、参数、尺寸、包装要有依据才能排。 */
export const STUDIO_DETAIL_SCREEN_GUIDE: Record<StudioShotRole, { label: string; use: string }> = {
    "main-white": { label: "白底首图", use: "搜索列表里的第一张：纯白背景，商品完整清楚，不加文字" },
    "main-selling": { label: "卖点主图", use: "商品加一句最打动人的卖点标题，提升点击" },
    "main-scene": { label: "场景主图", use: "商品放进真实使用场景，让人想象自己在用" },
    "main-detail": { label: "细节主图", use: "放大一个证明品质的细节" },
    "main-angle": { label: "多角度主图", use: "补一个侧面或背面，只用商品图里有的角度" },
    "main-flatlay": { label: "平铺主图", use: "垂直俯拍看全貌" },
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
    "detail-seeding": { label: "种草", use: "像小红书分享一样的生活瞬间，让人觉得「我也想要」" },
    "detail-compare": { label: "对比", use: "同一件商品的两种状态、两个角度或使用前后" },
    "detail-steps": { label: "使用步骤", use: "三四步讲清怎么用" },
    "detail-collocation": { label: "搭配", use: "和什么一起用、怎么搭" },
    "detail-campaign": { label: "活动海报", use: "节日、上新或大促的主视觉，不写价格" },
    "detail-ugc": { label: "随手拍", use: "手机随手拍质感的生活照" },
    "detail-closing": { label: "收尾", use: "最后一屏，回顾理由、促成下单" },
};
const SCREEN_ROLES = Object.keys(STUDIO_DETAIL_SCREEN_GUIDE) as StudioShotRole[];
/** 各策划范围能排的屏型：详情页用详情页屏型（不含活动海报和随手拍）；主图用主图屏型加几种适合做主图的。 */
const SCOPE_ROLES: Record<StudioPlanKind, StudioShotRole[]> = {
    detail: SCREEN_ROLES.filter((role) => role.startsWith("detail-") && role !== "detail-campaign" && role !== "detail-ugc"),
    main: ["main-white", "main-selling", "main-scene", "main-detail", "main-angle", "main-flatlay", "detail-model", "detail-compare", "detail-size", "detail-seeding"],
};
/** 每种策划范围排几张、读回时最少收几张；单张图按选中的类型和数量算，模板套图按模板的张数算。 */
export const STUDIO_PLAN_SCOPES: Record<StudioPlanScope, { label: string; unit: string; screens: number; minScreens: number }> = {
    detail: { label: "详情页", unit: "屏", screens: 10, minScreens: 6 },
    main: { label: "主图", unit: "张", screens: 5, minScreens: 4 },
    single: { label: "单张图", unit: "张", screens: 0, minScreens: 1 },
    template: { label: "模板套图", unit: "张", screens: 0, minScreens: 1 },
};
const SIZE_LABEL = /尺寸|尺码|长|宽|高|厚|直径|口径|容量|重量|规格/;

/** 可以写进策划和文案的事实：图片可见或卖家已确认。 */
export function studioDetailPlanFacts(product: StudioProduct, predicate: (fact: StudioFact) => boolean = () => true) {
    return (product.dossier?.facts || []).filter((fact) => studioFactUsable(fact) && predicate(fact));
}

/**
 * 这件商品能排的屏型：材质、参数、尺寸、包装要有已确认的事实，多角度要有侧面或背面的商品图。
 * 没有依据的屏型不交给模型，也不接受模型排进来，避免出现空屏或编出来的参数。
 */
export function studioDetailPlanRoles(product: StudioProduct, scope: StudioPlanKind = "detail"): StudioShotRole[] {
    return studioReadyRoles(product, SCOPE_ROLES[scope]);
}

/** 模板里第 index 张按标题和职责对上的屏型（和不策划时出图用的同一套规则）。 */
export function studioTemplateShotRoles(suite: Pick<StudioSuite, "kind" | "shots">): StudioShotRole[] {
    return suite.shots.map((shot, index) => studioSuiteShotRole(shot, suite.kind, index, suite.shots.length));
}

/** 模板套图能排的屏型：按模板用途的屏型，加上模板里对上的屏型（详情页模板的首张常是白底主图）；同样要有依据。 */
export function studioTemplatePlanRoles(product: StudioProduct, suite: Pick<StudioSuite, "kind" | "shots">): StudioShotRole[] {
    return studioReadyRoles(product, [...new Set([...SCOPE_ROLES[suite.kind], ...studioTemplateShotRoles(suite)])]);
}

function studioReadyRoles(product: StudioProduct, roles: StudioShotRole[]): StudioShotRole[] {
    const views = new Set(product.photos.filter((photo) => photo.truth).map((photo) => photo.view));
    const angles = views.has("side") || views.has("back");
    const ready: Partial<Record<StudioShotRole, boolean>> = {
        "detail-material": studioDetailPlanFacts(product, (fact) => fact.group === "material").length > 0,
        "detail-angles": angles,
        "main-angle": angles,
        "detail-spec": studioDetailPlanFacts(product, (fact) => fact.group === "spec").length >= 2,
        "detail-size": studioDetailPlanFacts(product, (fact) => SIZE_LABEL.test(fact.label)).length > 0,
        "detail-package": studioDetailPlanFacts(product, (fact) => fact.group === "package").length > 0,
    };
    return roles.filter((role) => ready[role] !== false);
}

export function studioScreenCopyBudget(role: StudioShotRole) {
    const hero = role === "detail-hero" || role === "main-selling";
    const information = ["detail-spec", "detail-size", "detail-steps"].includes(role);
    return { lines: information ? 6 : hero ? 2 : 3, units: information ? 160 : hero ? 60 : 90 };
}

/** 购买沟通页控制阅读负担；参数和步骤页保留必要信息。英文按半个汉字的显示宽度计算。 */
export function studioScreenCopyIssue(screen: { role: StudioShotRole; headline: string; subline: string; lines: string[]; eyebrow?: string; noText?: boolean }): string | undefined {
    if (screen.noText || screen.role === "main-white") return;
    const budget = studioScreenCopyBudget(screen.role);
    const lines = screen.lines.map((line) => line.trim()).filter(Boolean);
    const units = [...[screen.eyebrow, screen.headline, screen.subline, ...lines].filter(Boolean).join("")].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.5), 0);
    if (lines.length > budget.lines || units > budget.units) return `信息过密：这一屏最多 ${budget.lines} 条要点、约 ${budget.units} 个汉字。请保留一个核心利益，其余内容移到对应详情屏`;
    const copy = [screen.headline, screen.subline, ...lines].map((line) => line.trim()).filter(Boolean);
    if (new Set(copy).size !== copy.length) return "文案重复：标题、注解和要点需要各讲一件事，请去掉重复文字";
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
 * 读一屏：屏型要认识，模型蓝图超长时明确拒绝，避免截掉末尾的关键要求。
 * 读回用户改过的策划时画面可以清空，出图时这一屏改按镜头规格出。
 */
export function studioPlannedScreenOf(value: unknown, requireVisual = true): StudioPlannedScreen | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    const role = typeof record.role === "string" && SCREEN_ROLES.includes(record.role as StudioShotRole) ? (record.role as StudioShotRole) : undefined;
    const visual = typeof record.visual === "string" ? record.visual.trim() : "";
    const elements = typeof record.elements === "string" ? record.elements.trim() : "";
    if (requireVisual && (visual.length > limits.visual || elements.length > limits.elements)) throw new Error(`策划画面或信息元素超过上限（画面 ${limits.visual} 字、信息元素 ${limits.elements} 字），请精简后重新策划`);
    if (!role || (requireVisual && !visual)) return undefined;
    const layout = typeof record.layout === "string" && STUDIO_DETAIL_LAYOUT_IDS.includes(record.layout as StudioDetailLayoutId) ? (record.layout as StudioDetailLayoutId) : studioRoleLayout(role);
    const eyebrow = text(record.eyebrow, limits.eyebrow);
    return {
        role,
        title: text(record.title, limits.title) || STUDIO_DETAIL_SCREEN_GUIDE[role].label,
        purpose: text(record.purpose, limits.purpose),
        visual,
        layout,
        ...(studioCompositionOf(record.composition) ? { composition: studioCompositionOf(record.composition) } : {}),
        elements,
        eyebrow: studioEyebrowText(eyebrow),
        headline: text(record.headline, limits.headline),
        subline: text(record.subline, limits.subline),
        lines: Array.isArray(record.lines) ? record.lines.filter((line): line is string => typeof line === "string") : [],
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
    // 主图 5 张、单张图可以只有一两张：读回时只要求至少一屏，屏数是否够由各自的出图类型判断。
    if (!screens.length) return undefined;
    const styleId = studioPlanStyleId(record.styleId);
    const tone = studioPlanTone(record.tone);
    const targets = studioPlanTargets(record.targets);
    const suiteId = text(record.suiteId, 150);
    return {
        id: record.id.slice(0, 40),
        createdAt: text(record.createdAt, 40),
        ...(typeof record.inputSignature === "string" ? { inputSignature: record.inputSignature } : {}),
        model: text(record.model, 120),
        summary: text(record.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
        ...(text(record.designAnalysis, STUDIO_DETAIL_PLAN_LIMITS.designAnalysis) ? { designAnalysis: text(record.designAnalysis, STUDIO_DETAIL_PLAN_LIMITS.designAnalysis) } : {}),
        style: text(record.style, STUDIO_DETAIL_PLAN_LIMITS.style),
        ...(text(record.positioning, STUDIO_DETAIL_PLAN_LIMITS.positioning) ? { positioning: text(record.positioning, STUDIO_DETAIL_PLAN_LIMITS.positioning) } : {}),
        ...(text(record.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) ? { concept: text(record.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) } : {}),
        ...(studioPlanMotifs(record.motifs).length ? { motifs: studioPlanMotifs(record.motifs) } : {}),
        ...(text(record.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) ? { inspiration: text(record.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) } : {}),
        ...(styleId ? { styleId } : {}),
        ...(tone ? { tone } : {}),
        ...(targets.length ? { targets } : {}),
        ...(suiteId ? { suiteId } : {}),
        ...(typeof record.requestedScreens === "number" && STUDIO_DETAIL_SCREEN_OPTIONS.includes(record.requestedScreens) ? { requestedScreens: record.requestedScreens } : {}),
        screens,
    };
}

/** 视觉元素库：只收短文字，去重，最多 5 个。 */
export function studioPlanMotifs(value: unknown): string[] {
    return [...new Set(textList(value, STUDIO_DETAIL_PLAN_LIMITS.motifs * 2, STUDIO_DETAIL_PLAN_LIMITS.motif))].slice(0, STUDIO_DETAIL_PLAN_LIMITS.motifs);
}

export function studioPlanTone(value: unknown): StudioDesignToneId | undefined {
    return typeof value === "string" && STUDIO_DESIGN_TONE_IDS.includes(value as StudioDesignToneId) ? (value as StudioDesignToneId) : undefined;
}

/** 单张图策划的选择：类型要是单张类型，数量 1–4。 */
export function studioPlanTargets(value: unknown): StudioPlanTarget[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is { type: string; count: number } => Boolean(item) && typeof item === "object" && typeof (item as { type?: unknown }).type === "string" && Number.isInteger((item as { count?: unknown }).count))
        .filter((item) => item.count >= 1 && item.count <= 4)
        .map((item) => ({ type: item.type as StudioPlanTarget["type"], count: item.count }))
        .slice(0, 20);
}

/** 两次单张图选择是否一样（类型和每种数量都相同、顺序相同）。 */
export function studioSameTargets(a: StudioPlanTarget[] | undefined, b: StudioPlanTarget[]) {
    return Boolean(a) && a!.length === b.length && a!.every((item, index) => item.type === b[index].type && item.count === b[index].count);
}

/** 策划挑的质感预设：只认识预设里的编号。 */
export function studioPlanStyleId(value: unknown): StudioStylePresetId | undefined {
    return typeof value === "string" && STUDIO_STYLES.some((style) => style.id === value) ? (value as StudioStylePresetId) : undefined;
}

export type StudioPlanField = "detailPlan" | "mainPlan" | "singlePlan" | "templatePlan";

/** 各策划范围的策划存在表单的哪个字段。 */
export const STUDIO_PLAN_FIELD: Record<StudioPlanScope, StudioPlanField> = { detail: "detailPlan", main: "mainPlan", single: "singlePlan", template: "templatePlan" };

/** 改策划里的一屏；要点保留原文，密度问题在编辑与生成时提示，不静默删掉用户输入。 */
export function patchStudioDetailPlanScreen(
    brief: StudioBrief,
    index: number,
    patch: Partial<Pick<StudioPlannedScreen, "title" | "layout" | "composition" | "visual" | "elements" | "headline" | "subline" | "lines">>,
    field: StudioPlanField = "detailPlan",
): StudioBrief {
    const plan = brief[field];
    const current = plan?.screens[index];
    if (!plan || !current) return brief;
    const limits = STUDIO_DETAIL_PLAN_LIMITS;
    if ((patch.visual?.length || 0) > limits.visual || (patch.elements?.length || 0) > limits.elements) throw new Error("画面或信息元素超过上限，请精简后保存");
    const next: StudioPlannedScreen = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title.slice(0, limits.title) } : {}),
        ...(patch.visual !== undefined ? { visual: patch.visual } : {}),
        ...(patch.layout && STUDIO_DETAIL_LAYOUT_IDS.includes(patch.layout) ? { layout: patch.layout } : {}),
        ...(studioCompositionOf(patch.composition) ? { composition: patch.composition } : {}),
        ...(patch.elements !== undefined ? { elements: patch.elements } : {}),
        ...(patch.headline !== undefined ? { headline: patch.headline.slice(0, limits.headline) } : {}),
        ...(patch.subline !== undefined ? { subline: patch.subline.slice(0, limits.subline) } : {}),
        ...(patch.lines !== undefined ? { lines: patch.lines } : {}),
    };
    return { ...brief, [field]: { ...plan, screens: plan.screens.map((screen, position) => (position === index ? next : screen)) } };
}

/** 策划里的屏在镜头清单里的 key：p 加序号。 */
export function studioDetailPlanKey(index: number) {
    return `p${index}`;
}

/** 出图记录里一屏的版式、目的、画面和信息元素合在一起的上限。 */
export const STUDIO_SHOT_VISUAL_MAX = 3000;

/** 出图时写进提示词的这一屏：版式、目的、画面、信息元素依次写。画面被清空时返回空，这一屏改按镜头规格出。 */
export function studioPlannedShotVisual(screen: Pick<StudioPlannedScreen, "purpose" | "visual"> & Partial<Pick<StudioPlannedScreen, "layout" | "composition" | "elements">>) {
    const visual = screen.visual.trim();
    if (!visual) return "";
    const layout = screen.layout ? STUDIO_DETAIL_LAYOUTS[screen.layout] : undefined;
    const purpose = screen.purpose.trim();
    const elements = screen.elements?.trim() || "";
    const composition = screen.composition ? STUDIO_COMPOSITIONS[screen.composition] : undefined;
    const blueprint = [
        layout ? `内容版式「${layout.label}」：${layout.render}。` : "",
        composition ? `本屏构图「${composition.label}」（主体和文字的位置以此为准）：${composition.render}。` : "",
        purpose ? `这一屏要让买家明白：${purpose}` : "",
        `画面：${visual}`,
        elements ? `信息元素：${elements}` : "",
    ]
        .filter(Boolean)
        .join("\n");
    if (blueprint.length > STUDIO_SHOT_VISUAL_MAX) throw new Error("这一屏的完整画面蓝图超过上限，请精简后生成");
    return blueprint;
}
