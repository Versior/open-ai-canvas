import { checkEcommerceText, type EcommerceComplianceIssue } from "@/lib/ecommerce/ecommerce-compliance";
import { ecommercePlatform, ecommerceRoleSpec } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioInfoPoints, studioInfoText, studioLanguage, studioMarket, studioOutputSpec, studioProductTypeOf, studioTitleOf } from "./brief";
import {
    STUDIO_DESIGN_TONE_IDS,
    STUDIO_DESIGN_TONES,
    STUDIO_DETAIL_LAYOUT_IDS,
    STUDIO_DETAIL_LAYOUTS,
    STUDIO_DETAIL_PLAN_LIMITS,
    STUDIO_DETAIL_SCREEN_GUIDE,
    STUDIO_PLAN_SCOPES,
    studioDetailPlanFacts,
    studioPlannedScreenOf,
    studioPlanStyleId,
    studioPlanTone,
} from "./detail-plan";
import { extractStudioJson } from "./dossier-tasks";
import { STUDIO_STYLES, studioStyle, type StudioStylePreset } from "./shot-specs";
import { STUDIO_FACT_GROUP_LABEL, STUDIO_VIEW_LABEL, studioFactUsable, type StudioDetailPlan, type StudioPlannedScreen, type StudioPlanScope, type StudioPlanTarget, type StudioProduct, type StudioShotRole } from "./types";

/**
 * 「按商品策划」的文本任务：这里写当前商品的信息、可以排的屏型和输出结构。
 * 系统指令与电商知识库（详情页、版式、摄影、场景和文案方法）由服务端按「详情页策划」能力注入。
 * 读回时把关：依据不够的屏型、带了原文里没有的数字的文案都不进清单。
 */

function oneLine(value: string) {
    return value
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("；");
}

/** 策划能用的原文：标题、卖点、卖家写的商品信息和已确认的事实。色值不算原文里的数字。 */
function sourceNumbers(product: StudioProduct) {
    const facts = studioDetailPlanFacts(product).map((fact) => `${fact.label} ${fact.value}`);
    const source = [studioTitleOf(product), studioBrandOf(product), studioProductTypeOf(product), studioInfoText(product), product.dossier?.name || "", product.dossier?.summary || "", ...facts].join("\n");
    return new Set(source.replace(/#[0-9a-f]{3,8}\b/gi, " ").match(/\d+(?:\.\d+)?/g) || []);
}

function paletteText(style: Pick<StudioStylePreset, "palette">) {
    return style.palette.map((color) => `${color.name} ${color.hex}`).join("、");
}

/** 视觉方向：选了质感就以它为基础；选「按商品推荐」时列出全部质感，让策划按商品和人群挑一个。 */
function styleLines(product: StudioProduct): string[] {
    if (product.style !== "auto") {
        const style = studioStyle(product.style);
        return [`视觉方向以「${style.name}」为基础：${style.mood}；色板 ${paletteText(style)}；光影${style.light}。可以在这个基础上加一个强调色。`];
    }
    return [
        "视觉方向由你按这件商品、目标人群和平台挑：从下面的质感里选一个最合适的，把它的编号写进 styleId，再在它的基础上写整套设计规范（可以加一个强调色）。",
        ...STUDIO_STYLES.map((style) => `- ${style.id}（${style.name}）：${style.mood}；色板 ${paletteText(style)}`),
    ];
}

/**
 * 这次策划的范围：详情页 10 屏、主图 5 张，或者按选中的单张类型逐张出；previous 是要按补充调整修改的上一版。
 * images 是随任务附带的图：先是商品图，后面是卖家上传的参考图（大牌或爆款截图）。
 */
export type StudioPlanRequest = { scope: StudioPlanScope; targets?: StudioPlanTarget[]; previous?: StudioDetailPlan; images?: { photos: number; references: number } };

function imageRange(from: number, count: number) {
    return count > 1 ? `图${from}–图${from + count - 1}` : `图${from}`;
}

/** 附图说明：哪几张是商品图、哪几张是参考图，以及参考图怎么用。 */
function imageLines(images: StudioPlanRequest["images"]): string[] {
    if (!images || images.photos + images.references === 0) return [];
    const parts = [images.photos ? `${imageRange(1, images.photos)} 是商品图（外观唯一依据）` : "", images.references ? `${imageRange(images.photos + 1, images.references)} 是卖家给的参考图（大牌或爆款的图，不是这件商品）` : ""].filter(Boolean);
    return [
        `附图：${parts.join("；")}。`,
        images.references ? "参考图怎么用：先看懂它好在哪里（版式和分区、字体和字号层级、配色、图标和装饰元素、文案的语气和节奏），把这些设计语言用到这组图里；参考图里的商品、品牌、文字、价格和参数不照搬，也不要把这组图做成参考图的翻版。" : "",
    ].filter(Boolean);
}

/** 单张图策划时每一张的屏型，按选中的类型和数量依次展开。 */
export function studioPlanTargetRoles(targets: StudioPlanTarget[]): StudioShotRole[] {
    return targets.flatMap((target) => {
        const role = studioOutputSpec(target.type).role;
        return role ? Array.from({ length: target.count }, () => role) : [];
    });
}

function screenCount(request: StudioPlanRequest) {
    return request.scope === "single" ? studioPlanTargetRoles(request.targets || []).length : STUDIO_PLAN_SCOPES[request.scope].screens;
}

function introLine(product: StudioProduct, request: StudioPlanRequest, platform: string) {
    const count = screenCount(request);
    if (request.scope === "detail") return `为这件商品策划一套${platform}手机端详情页，共 ${count} 屏，长图按屏从上到下排列，每屏画幅 3:4。`;
    if (request.scope === "main") return `为这件商品策划${platform}主图套图，共 ${count} 张，用在搜索列表和商品页顶部的轮播，画幅按平台主图规格。`;
    const list = (request.targets || []).map((target) => `${studioOutputSpec(target.type).label} ${target.count} 张`).join("、");
    return `为这件商品策划这次要出的 ${count} 张图（${list}），每张单独使用，都要能独立打动人。`;
}

/** 范围不同的排法要求：详情页讲完整的故事，主图争取点击，单张图按选中的类型逐张出。 */
function scopeRequirement(product: StudioProduct, request: StudioPlanRequest): string {
    const count = screenCount(request);
    if (request.scope === "detail")
        return `2. 正好排 ${count} 屏：第一屏用 detail-hero，最后一屏用 detail-closing，中间各屏的主题和顺序按第 1 条的分析来定。屏型可以重复使用（比如两屏卖点、两屏不同的使用场景、两屏不同部位的细节），但每屏讲的内容和画面都不能重复。信息不够时多排使用场景、种草、使用效果和商品图里看得到的细节，不编参数，也不把同一个卖点换个说法再讲一遍。整套像一个品牌故事：开头抓人，中段证明，结尾收束，节奏有起伏（大图屏和信息屏交替）。`;
    if (request.scope === "main") {
        const main = ecommerceRoleSpec(product.platform, "main");
        const first = [main?.whiteBackground ? "纯白背景" : "", main?.noText ? "不放任何文字" : "最多一行很短的标题"].filter(Boolean).join("、");
        return `2. 正好排 ${count} 张：第 1 张是搜索列表里的首图，用 main-white 或 main-selling（这个平台的首图要求：${first || "商品完整清楚"}），缩成小图也要一眼认出商品；第 2–${count} 张各承担一个不同的点击理由（最打动人的卖点、使用场景或上身效果、证明品质的细节、对比或尺寸、种草氛围），按买家最在意的顺序排，不重复。主图文字比详情页更少：主标题不超过 8 个字，最多一行副标题，不排参数表。`;
    }
    const roles = studioPlanTargetRoles(request.targets || []);
    return `2. 按顺序正好给出 ${count} 张，role 依次是：${roles.map((role, index) => `第 ${index + 1} 张 ${role}（${STUDIO_DETAIL_SCREEN_GUIDE[role].label}）`).join("，")}。同一类型的几张要换场景、角度、版式或文案，不能雷同；每张都要能单独使用。`;
}

/** 上一版策划：按卖家的补充调整修改时带上，模型只改卖家不满意的地方。 */
function previousLines(previous: StudioDetailPlan | undefined): string[] {
    if (!previous) return [];
    return [
        "",
        "【上一版策划】（按卖家的补充调整修改这一版：卖家没提意见的部分尽量保留，卖家不满意的地方要改到位）",
        previous.summary ? `思路：${previous.summary}` : "",
        ...previous.screens.map((screen, index) => `${index + 1}. ${screen.title}（${screen.role} · ${screen.layout}）${screen.headline ? `「${screen.headline}」` : ""}：${screen.visual.slice(0, 60)}`),
    ].filter(Boolean);
}

export function buildDetailPlanPrompt(product: StudioProduct, roles: StudioShotRole[], request: StudioPlanRequest = { scope: "detail" }) {
    const brief = product.brief;
    const platform = ecommercePlatform(product.platform)?.name || "电商平台";
    const points = studioInfoPoints(studioInfoText(product));
    const facts = studioDetailPlanFacts(product);
    const unsure = (product.dossier?.facts || []).filter((fact) => !studioFactUsable(fact)).map((fact) => fact.label.trim());
    const views = product.photos.filter((photo) => photo.truth).map((photo) => STUDIO_VIEW_LABEL[photo.view]);
    const productType = studioProductTypeOf(product) || product.dossier?.category || "";
    const brand = studioBrandOf(product);
    const groups = [...new Set(facts.map((fact) => fact.group))].map(
        (group) =>
            `${STUDIO_FACT_GROUP_LABEL[group]}：${facts
                .filter((fact) => fact.group === group)
                .map((fact) => `${fact.label} ${fact.value}`)
                .join("；")}`,
    );
    const cast = brief.model ? [brief.model.figure ? "全身模特" : brief.model.face ? "模特人脸" : "", brief.model.pose ? "姿势" : "", brief.model.style ? "造型" : ""].filter(Boolean) : [];
    const language = brief.language === "none" ? "这组图不放文字：每一张都写 noText: true，文案留空。" : `图上文字最终用${studioLanguage(brief.language).name}呈现；这里的文案先用简体中文写。`;
    const count = screenCount(request);
    const note = brief.planNote?.trim();
    const lines: (string | undefined)[] = [
        introLine(product, request, platform),
        "",
        "【商品】",
        `名称：${product.dossier?.name || product.name || productType || "见商品图"}`,
        brand ? `品牌：${brand}` : undefined,
        productType ? `商品类型：${productType}` : undefined,
        product.dossier?.summary ? `概括：${product.dossier.summary}` : undefined,
        `商品图：${views.length ? views.join("、") : "正面"}（外观以商品图为准）`,
        ...imageLines(request.images),
        product.dossier?.invariants.length ? `外观要点（每张都不能变）：${product.dossier.invariants.join("、")}` : undefined,
        "",
        "【可以用的文案素材】",
        studioTitleOf(product) ? `核心标题：${studioTitleOf(product)}` : "核心标题：无（标题从卖点里提炼）",
        points.length ? `卖点：\n${points.map((point, index) => `${index + 1}. ${point.title}${point.detail ? `：${point.detail}` : ""}`).join("\n")}` : "卖点：无",
        groups.length ? `已确认的事实：\n${groups.join("\n")}` : "已确认的事实：无",
        unsure.length ? `没有确认的信息（不能写进文案，也不能画成参数或数字）：${unsure.join("、")}` : undefined,
        "",
        "【出图条件】",
        `市场：${studioMarket(brief.market).label}。${language}`,
        brief.audience.trim() ? `目标人群：${brief.audience.trim()}` : undefined,
        brief.positioning.trim() ? `价格定位：${brief.positioning.trim()}` : undefined,
        brief.extra.trim() ? `卖家补充要求：${oneLine(brief.extra)}` : undefined,
        ...styleLines(product),
        cast.length ? `已在模特库选了${cast.join("、")}：有人物的图用 detail-model，人物会按模特库出图。` : undefined,
        note ? "" : undefined,
        note ? `【卖家对这次策划的补充调整】（优先照做；和商品事实、平台规则冲突时以事实和规则为准）\n${note}` : undefined,
        ...previousLines(request.previous),
        "",
        request.scope === "single" ? undefined : "【可以排的屏型】（role 只能从这里选；没有列出的屏型说明依据不够，不要排）",
        ...(request.scope === "single"
            ? []
            : roles.map((role) => {
                  const guide = STUDIO_DETAIL_SCREEN_GUIDE[role];
                  return guide ? `- ${role}（${guide.label}）：${guide.use}` : undefined;
              })),
        request.scope === "single" ? undefined : "",
        "【可以用的版式】（layout 只能从这里选；平台上做得好的图每张都是排过版的画面，不是一张商品照片加一行字）",
        ...STUDIO_DETAIL_LAYOUT_IDS.map((id) => `- ${id}（${STUDIO_DETAIL_LAYOUTS[id].label}）：${STUDIO_DETAIL_LAYOUTS[id].use}`),
        "",
        "【设计调性】（挑一个最适合这件商品和目标人群的写进 tone，整组的版面、字体、文案语气和摄影都按它来）",
        ...STUDIO_DESIGN_TONE_IDS.map((id) => `- ${id}（${STUDIO_DESIGN_TONES[id].label}）：${STUDIO_DESIGN_TONES[id].use}`),
        "",
        "【文案要求】（大牌和头部爆款的文案像品牌在说话，不像地摊吆喝）",
        "- 主标题讲买家得到的感受或结果，不讲「这是什么」；把卖点翻译成画面和感受，比如把「重量轻」写成「轻到忘了它在」，把「防滑」写成「低头也不跑」。",
        "- 短、准、有节奏：可以用短句、对仗、留白和数字，口语但不油腻；同一组里的标题句式要有变化。",
        `- 不写土味和口号腔的词：${STUDIO_TACKY_COPY.join("、")}，不用感叹号，不堆四字成语。`,
        "- 每张最多三层文字：栏目小标题（英文或序号）、主标题、一句注解；要点只用在图标、引线、拼格、对照、参数和收尾版式里做标签。",
        "",
        "【要求】",
        "1. 先想清楚：买这件商品的人下单前最关心什么、最担心什么，这件商品凭什么值得买，同类商品里它的气质是什么。整组图围绕这些回答来排，不要套一份各品类通用的模板。再定一条创意主线写进 concept（不超过 60 个字）：从这件商品最独特的地方（外观、材质、颜色、使用时刻、人群）出发，想一个贯穿整组的视觉母题（一种光、一个道具、一个动作、一种图形或一种色块），每张都出现它的变化，让这组图一眼就是这件商品的，换成别的商品就不成立。不用放在任何商品上都成立的通用画面（纯色背景加商品居中、泛泛的居家场景、空洞的大理石台面）。",
        scopeRequirement(product, request),
        `3. 每张只承担一个目的，并选一个最适合讲这件事的 layout。${request.scope === "detail" ? "相邻两屏的版式不能相同，整套至少用到 6 种版式；同一种屏型不能连续超过两屏；" : "相邻两张的版式尽量不同；"}相邻两张的景别、机位和场景也不能相同。`,
        "4. visual 写成能直接交给图片模型的一段话（不超过 150 个字），像摄影师和美术指导的分镜说明：背景或场景、商品怎么摆、什么角度和焦段、人物和动作（如有）、道具（不超过 3 件）、主色调、光线的方向和质感，以及按版式怎么分区、文字放在哪里。visual 和 style 里不写任何品牌名（上面提到的大牌只用来定调性），也不写「参考某某官网」。",
        "5. elements 写这一张的信息元素（不超过 80 个字）：图标卖点写几个图标、各画什么；引线标注写引线指向哪几个部位；拼格写每格放哪个部位；对照写两栏各放什么；其他版式写装饰元素（色块、细线、圆角卡片、编号）。只写画面元素，不加新的事实。",
        "6. 商品图里看不到的角度、内部结构、配件和包装不要安排成画面主体。",
        "7. 文案字数：headline 不超过 12 个字；subline 不超过 24 个字；lines 最多 6 条，每条不超过 12 个字，图标卖点、引线标注、拼格和收尾版式的 lines 就是每个图标、引线或格子的标签，数量和 elements 里写的一致。eyebrow 是主标题上方的英文栏目小标题（如 01 CLEAR FRAME，只用英文字母，可以带两位序号），不需要就留空。只用上面的核心标题、卖点和已确认的事实，可以改写，但不加新的事实。文案里不出现上面没有的数字、参数、成分、认证、功效、价格和承诺，不用「最」「第一」「顶级」「100%」这类极限词。",
        "8. 同一条卖点最多用在一张（详情页的头图和收尾可以回顾）。素材不够写文案的图，headline 写一个短栏目名或设 noText: true。",
        "9. style 是整组共用的设计规范（不超过 300 个字），像设计师交给出图的规范：色板（底色、主色、强调色，各写色名和 #色值）、背景体系、光线、字体（中文标题的字重和气质、英文小标题的样式、数字的样式）、栏目标题的样式（比如序号加英文小标题加中文标题加一条细线）、图标样式（线框还是面性、线条粗细、有没有底板）、反复出现的装饰元素。所有图一致，每张的背景和场景写在各自的 visual 里。",
        "10. facts 写这一张用到的事实名称或卖点标题，没有就留空数组。",
        "11. inspiration 用一句话（不超过 60 个字）写你从同类爆款套图和参考图里借鉴了什么（比如某种色块分区、编号徽章、横幅标题）；没有参考时留空。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        `{"summary":"一两句话说明买家最关心什么，这 ${count} 张按什么顺序回答","concept":"创意主线","inspiration":"借鉴了什么","tone":"设计调性编号",${product.style === "auto" ? '"styleId":"从可选质感里挑的编号",' : ""}"style":"整组设计规范","screens":[{"role":"${request.scope === "single" ? studioPlanTargetRoles(request.targets || [])[0] || "detail-scene" : request.scope === "main" ? "main-white" : "detail-hero"}","layout":"poster","title":"不超过 8 个字的屏名","purpose":"这一张要让买家明白什么","visual":"具体画面","elements":"信息元素","eyebrow":"","headline":"","subline":"","lines":[],"facts":[],"noText":false}]}`,
    ];
    return lines.filter((line): line is string => line !== undefined).join("\n");
}

/** 土味和口号腔的写法：提示词里禁止，读回时发现了也提示用户。 */
export const STUDIO_TACKY_COPY = ["神器", "必入", "闭眼入", "yyds", "绝绝子", "天花板", "谁用谁知道", "一眼就认", "颜值担当", "您值得拥有", "爆款", "种草了", "上头"];

export type StudioDetailPlanResult = {
    plan: StudioDetailPlan;
    /** 模型排了但依据不够或格式不对、没收进清单的屏数。 */
    dropped: number;
    /** 因为带了原文里没有的数字被去掉的文案条数。 */
    ungrounded: number;
    issues: EcommerceComplianceIssue[];
    /** 文案里出现的土味写法。 */
    tacky: string[];
    /** 详情页用到几种版式、相邻两屏版式相同的有几处；版式变化不够时提示用户。 */
    layoutKinds: number;
    layoutRepeats: number;
};

/** 读回策划结果：屏型必须在这件商品能排的范围里，文案的数字必须有出处；去掉依据不够的屏后剩得太少时要求重试。 */
export function parseDetailPlan(raw: string, product: StudioProduct, roles: StudioShotRole[], meta: { id: string; model: string; createdAt: string }, request: StudioPlanRequest = { scope: "detail" }): StudioDetailPlanResult {
    const data = extractStudioJson(raw);
    const allowed = new Set(roles);
    const numbers = sourceNumbers(product);
    const offered = Array.isArray(data.screens) ? data.screens : [];
    let ungrounded = 0;
    // 文案里的数字都要出现在原文里；对不上的那条去掉，避免模型编出重量、年龄段这类参数。
    const grounded = (value: string) => {
        if ((value.match(/\d+(?:\.\d+)?/g) || []).every((number) => numbers.has(number))) return value;
        ungrounded += 1;
        return "";
    };
    const textless = product.brief.language === "none";
    const finish = (screen: StudioPlannedScreen): StudioPlannedScreen => {
        if (textless || screen.noText) return { ...screen, headline: "", subline: "", lines: [], noText: true };
        return { ...screen, headline: grounded(screen.headline), subline: grounded(screen.subline), lines: screen.lines.map(grounded).filter(Boolean) };
    };
    let screens: StudioPlannedScreen[];
    if (request.scope === "single") {
        // 单张图：张数和每张的类型由用户的选择决定，模型写错屏型时按位置改回来。
        const expected = studioPlanTargetRoles(request.targets || []);
        screens = expected
            .map((role, index) => {
                const screen = studioPlannedScreenOf(offered[index]);
                return screen ? finish({ ...screen, role }) : undefined;
            })
            .filter((screen): screen is StudioPlannedScreen => Boolean(screen));
        if (!expected.length || screens.length < expected.length) throw new Error("策划结果不完整，请重试或换一个文本模型");
    } else {
        const scope = STUDIO_PLAN_SCOPES[request.scope];
        screens = offered
            .map((screen) => studioPlannedScreenOf(screen))
            .filter((screen): screen is StudioPlannedScreen => Boolean(screen && allowed.has(screen.role)))
            .slice(0, scope.screens)
            .map(finish);
        if (screens.length < scope.minScreens) throw new Error("策划结果不完整，请重试或换一个文本模型");
        // 主图第一张要在搜索列表里一眼认出商品：模型没把白底图或卖点主图放第一张时，把排在最前的那张挪上来。
        const first = request.scope === "main" ? screens.findIndex((screen) => screen.role === "main-white" || screen.role === "main-selling") : -1;
        if (first > 0) screens = [screens[first], ...screens.filter((_, index) => index !== first)];
    }
    const copies = screens.flatMap((screen) => [screen.headline, screen.subline, ...screen.lines]);
    const issues = screens.flatMap((screen, index) => [screen.headline, screen.subline, ...screen.lines].flatMap((value) => checkEcommerceText(value, `第 ${index + 1} 张`)));
    const tacky = STUDIO_TACKY_COPY.filter((word) => copies.some((value) => value.toLowerCase().includes(word.toLowerCase())));
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    // 只有质感选了「按商品推荐」时才收策划挑的质感。
    const styleId = product.style === "auto" ? studioPlanStyleId(data.styleId) : undefined;
    const tone = studioPlanTone(data.tone);
    return {
        plan: {
            id: meta.id,
            createdAt: meta.createdAt,
            model: meta.model,
            summary: text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
            style: text(data.style, STUDIO_DETAIL_PLAN_LIMITS.style),
            ...(text(data.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) ? { concept: text(data.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) } : {}),
            ...(text(data.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) ? { inspiration: text(data.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) } : {}),
            ...(styleId ? { styleId } : {}),
            ...(tone ? { tone } : {}),
            ...(request.scope === "single" ? { targets: request.targets } : {}),
            screens,
        },
        dropped: request.scope === "single" ? 0 : offered.length - screens.length,
        ungrounded,
        issues,
        tacky,
        layoutKinds: new Set(screens.map((screen) => screen.layout)).size,
        layoutRepeats: screens.filter((screen, index) => index > 0 && screen.layout === screens[index - 1].layout).length,
    };
}
