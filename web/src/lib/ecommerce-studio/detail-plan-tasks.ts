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
    studioDetailLayoutIds,
    studioDetailPlanFacts,
    studioDetailScreenCount,
    studioPlannedScreenOf,
    studioPlanMotifs,
    studioPlanStyleId,
    studioPlanTone,
    studioRoleLayout,
    studioTemplateShotRoles,
} from "./detail-plan";
import { extractStudioJson } from "./dossier-tasks";
import { STUDIO_COMPOSITIONS, STUDIO_COMPOSITION_IDS, studioChannelDesign } from "./art-direction";
import { studioTypeInstruction } from "./typography";
import { studioPickedDirection, studioPrepFactsText, studioPrepPromptLines } from "./plan-prep";
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
    const source = [studioTitleOf(product), studioBrandOf(product), studioProductTypeOf(product), studioInfoText(product), product.dossier?.name || "", product.dossier?.summary || "", studioPrepFactsText(product.brief.prep), ...facts].join("\n");
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
 * 这次策划的范围：用户选定屏数的详情页、主图 5 张、按选中的单张类型逐张出，或按表单里选中的模板一张对一张排；
 * previous 是要按补充调整修改的上一版。images 是随任务附带的图：先是商品图，后面是卖家上传的参考图（大牌或爆款截图）。
 */
export type StudioPlanRequest = { scope: StudioPlanScope; targets?: StudioPlanTarget[]; previous?: StudioDetailPlan; alternative?: StudioDetailPlan; images?: { photos: number; references: number } };

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

function screenCount(product: StudioProduct, request: StudioPlanRequest) {
    if (request.scope === "single") return studioPlanTargetRoles(request.targets || []).length;
    if (request.scope === "template") return product.brief.suite?.shots.length || 0;
    if (request.scope === "detail") return studioDetailScreenCount(product.brief);
    return STUDIO_PLAN_SCOPES[request.scope].screens;
}

/** 模板每张的职责写进策划提示词时的上限：内置模板一张有七八行镜头、布光、背景说明。 */
const TEMPLATE_DUTY_CHARS = 240;

/**
 * 选中的模板：每张的标题、建议屏型、画幅和职责。模板只定每张讲什么、大致怎么拍；
 * 模板原本是给别的商品做的，里面的商品、颜色和属性不照搬。
 */
function templateLines(product: StudioProduct): string[] {
    const suite = product.brief.suite;
    if (!suite) return [];
    const roles = studioTemplateShotRoles(suite);
    return [
        "",
        `【套图模板「${suite.name}」】（卖家选的模板，${suite.kind === "main" ? "按主图出" : "按详情页出"}${suite.category ? `，原本是给「${suite.category}」做的` : ""}；只学它每张讲什么、怎么拍，模板里写到的商品、材质、颜色、属性、价格和功效都不照搬）`,
        suite.style.trim() ? `模板的整套风格：${oneLine(suite.style).slice(0, 300)}` : undefined,
        ...suite.shots.map((shot, index) => {
            const tags = [`建议 role：${roles[index]}`, shot.ratio ? `画幅 ${shot.ratio}` : "", shot.noText ? "这张不放文字" : ""].filter(Boolean).join(" · ");
            const duty = oneLine(shot.duty);
            return `${index + 1}. 「${shot.title}」（${tags}）${duty ? `：${duty.length > TEMPLATE_DUTY_CHARS ? `${duty.slice(0, TEMPLATE_DUTY_CHARS - 1)}…` : duty}` : ""}`;
        }),
    ].filter((line): line is string => line !== undefined);
}

function introLine(product: StudioProduct, request: StudioPlanRequest, platform: string) {
    const count = screenCount(product, request);
    if (request.scope === "template") {
        const suite = product.brief.suite;
        return `为这件商品按卖家选的套图模板「${suite?.name || "模板"}」策划一套${platform}${suite?.kind === "main" ? "主图套图" : "详情页"}，共 ${count} 张。模板定了每张的顺序和要讲的事；画面、版式和文案要按这件商品重新设计，做得比照模板原样出更好看、更像大牌。`;
    }
    if (request.scope === "detail") return `为这件商品策划一套${platform}手机端详情页，共 ${count} 屏，长图按屏从上到下排列，每屏画幅 3:4。`;
    if (request.scope === "main") return `为这件商品策划${platform}主图套图，共 ${count} 张，用在搜索列表和商品页顶部的轮播，画幅按平台主图规格。`;
    const list = (request.targets || []).map((target) => `${studioOutputSpec(target.type).label} ${target.count} 张`).join("、");
    return `为这件商品策划这次要出的 ${count} 张图（${list}），每张单独使用，都要能独立打动人。`;
}

/** 范围不同的排法要求：详情页讲完整的故事，主图争取点击，单张图按选中的类型逐张出。 */
function scopeRequirement(product: StudioProduct, request: StudioPlanRequest): string {
    const count = screenCount(product, request);
    if (request.scope === "template")
        return `2. 按模板的顺序正好给出 ${count} 张，第 N 张对应模板第 N 张：保留模板这一张的目的和大致的画面类型（白底、场景、细节、模特、参数……），画面、构图、版式和文案按这件商品重新写。role 优先用模板这一张的建议 role，必须从可以排的屏型里选；模板这一张要讲的东西（参数、材质、尺寸、包装、几种颜色款式、某项功能、某个痛点）这件商品没有依据时，换成有依据的内容讲同一个目的，不编参数、款式和功能。模板标了「这张不放文字」的写 noText: true。${product.brief.suite?.kind === "main" ? "这是主图模板，文字比详情页更少：主标题不超过 8 个字，最多一行副标题，不排参数表。" : ""}`;
    if (request.scope === "detail")
        return `2. 用户选择了 ${count} 屏，正好排 ${count} 屏：第一屏用 detail-hero，最后一屏用 detail-closing，中间各屏的主题和顺序按第 1 条的分析来定。屏型可以重复使用，但每屏回答不同的购买问题。短页把相近证据合并，长页展开有依据的细节、操作和选购条件；不按十屏模板裁剪或补齐。信息不足以支持这么多独立主题时，在 summary 说明缺少什么，并安排无字的真实商品细节摄影，不编卖点，不把同一个卖点换个说法再讲一遍。结尾回顾选购依据，不虚构售后承诺。`;
    if (request.scope === "main") {
        const main = ecommerceRoleSpec(product.platform, "main");
        const first = [main?.whiteBackground ? "纯白背景" : "", main?.noText ? "不放任何文字" : "最多一行很短的标题"].filter(Boolean).join("、");
        return `2. 正好排 ${count} 张：第 1 张是搜索列表里的首图，用 main-white 或 main-selling（这个平台的首图要求：${first || "商品完整清楚"}），缩成小图也要一眼认出商品；第 2–${count} 张各承担一个不同的点击理由（最打动人的卖点、使用场景或上身效果、证明品质的细节、对比或尺寸、种草氛围），按买家最在意的顺序排，不重复。主图文字比详情页更少：主标题不超过 8 个字，最多一行副标题，不排参数表。`;
    }
    const roles = studioPlanTargetRoles(request.targets || []);
    return `2. 按顺序正好给出 ${count} 张，role 依次是：${roles.map((role, index) => `第 ${index + 1} 张 ${role}（${STUDIO_DETAIL_SCREEN_GUIDE[role].label}）`).join("，")}。同一类型的几张要换场景、角度、版式或文案，不能雷同；每张都要能单独使用。`;
}

/**
 * 视觉节奏与创意：平台上做得好的详情页不普通，靠的是明暗和疏密的节奏、机位的变化和关键屏的创意手法，
 * 不是每一屏都同样干净的浅色底加一张商品照。按范围写，详情页要求最多。
 */
const STUDIO_CREATIVE_DEVICES = "超大比例或微缩场景、悬浮与失重、文字和商品前后穿插、几何色块切割画面、光影投射、用一个道具把卖点变成画面、镜面倒影、俯拍平铺构成";

/**
 * 整套一个色彩世界：拆过的高质量详情页和主图（午夜蓝加暖金光的磁疗贴、天空蓝加蜂蜜黄的蜂胶喷雾、纯黑加橙的灶具）
 * 都是全套一个色彩世界、照片统一调色，节奏靠内容和明暗交替；每屏换一种互不相干的背景反而像拼凑。
 */
const STUDIO_COLOR_WORLD = "整套一个色彩世界：由创意主线定一个主色世界（比如午夜蓝加暖金光、天空蓝加蜂蜜黄、纯黑加橙），所有屏的背景、场景和人物照片都统一调色到这个世界里；节奏靠同一色系里的明暗交替，或者从色板里取两三个颜色做整屏色块交替";
/** 看不见的作用画出来：拆过的医用、保健和个护详情页最有说服力的几屏都是机理、成分和痛点的可视化。 */
const STUDIO_VISUALIZE =
    "- 看不见的要画出来：商品有作用原理、成分或结构可讲时，至少一屏用机理示意（剖面、透明人体或器官、分层爆炸图，光点和箭头表示作用方向）或成分特写，不要只用文字讲；买家有明确的困扰时，用一屏痛点共鸣开场（问句标题，人物神情配气泡标签，或困扰场景宫格）。";

function rhythmLines(request: StudioPlanRequest): string[] {
    const head = "【视觉节奏与创意】（爆款和大牌的图不普通，靠的是节奏和创意，不是每张都一样干净）";
    if (request.scope === "detail")
        return [
            head,
            `- ${STUDIO_COLOR_WORLD}。按商品气质控制明暗节奏，不强制深色或饱和色；避免每屏换一种互不相干的背景。`,
            "- 系列感来自字体家族、色板和边距，不固定栏目头位置或字号。大标题、微距、满版场景、侧栏与信息页交替，不能每屏都是顶端标题加居中商品。",
            "- 景别变化服务于内容：整体、可见部位微距、实际使用各有职责。只有正面实拍时不强制转角；人物、手部和道具仅在帮助说明商品时出现，不为追求多样性硬加。",
            STUDIO_VISUALIZE,
            "- 首屏先保证商品识别、清楚的标题和一个视觉焦点。创意可以来自光影、尺度和留白，不强制悬浮、微缩或文字穿插；不叠加多个互相争夺注意力的手法。",
            "- 信息少时不要凑数：商品标识、印字和型号不单独成屏，也不当卖点；用使用场景、情绪时刻、创意静物和质感细节来撑，不把同几条外观换个说法反复讲。",
        ];
    if (request.scope === "main")
        return [
            head,
            "- 5 张共用字体家族与色板，布局随内容变化，避免每张都加同色标题条、展台或图标底板；首图之外换机位、裁切和图文重心。",
            "- 讲功能用手在用的特写，可以配一两个圆形放大镜头把按键、接口或质地放大；已确认的关键数字做成画面里最大的元素。",
            `- 首图之外每张都要有一个让人停下来的创意手法：${STUDIO_CREATIVE_DEVICES}，写进 visual。`,
            "- 商品标识、印字和型号不当卖点。",
        ];
    if (request.scope === "template")
        return [
            head,
            `- 模板定每张讲什么和系列字体、色板，不锁栏目头的位置。${STUDIO_COLOR_WORLD}，相邻两张换机位、裁切和图文重心。用户明确要求参考图同款时沿用其布局。`,
            STUDIO_VISUALIZE,
            `- 白底图之外的首张和关键几张要有一个让人停下来的创意手法：${STUDIO_CREATIVE_DEVICES}，写进 visual。`,
            "- 商品标识、印字和型号不当卖点。",
        ];
    return [head, `- 每张都要有一个让人停下来的创意手法：${STUDIO_CREATIVE_DEVICES}，写进 visual；同一类型的几张换不同的手法和机位。`, "- 同时出几张时用同一个色彩世界和同一种标题样式，像一个品牌出的。", "- 商品标识、印字和型号不当卖点。"];
}

const KIDS = /儿童|宝宝|婴|幼儿|童装|童鞋|孩子|学生|小学|玩具/;

/**
 * 这件商品自身的限制：测试环境里儿童眼镜只有一张正面商品图，图片模型把 7 张都画成了同一个角度的整件摆拍；
 * 策划还给它选了纯灰白的极简调性，整套发冷。这两条按商品图和人群写进节奏要求。
 */
function productRealityLines(product: StudioProduct): string[] {
    const truth = product.photos.filter((photo) => photo.truth);
    const views = new Set(truth.map((photo) => photo.view));
    const lines: string[] = [];
    if (views.size <= 1) {
        const view = truth[0] ? STUDIO_VIEW_LABEL[truth[0].view] : "正面";
        lines.push(
            `- 只有一张${view}商品图：图片模型很难把商品转到别的角度，整件商品同一个角度的摆拍整套最多两张。变化靠景别和场景：戴在身上或拿在手里、局部微距、放进包里或桌面的远景、和道具一起的创意静物；不要写侧面、背面、仰视、俯视整件这类要把商品转过去的画面。`,
        );
    }
    const kids = product.dossier?.family === "baby-toys" || KIDS.test(`${studioProductTypeOf(product)} ${product.dossier?.category || ""} ${product.dossier?.name || ""} ${product.name}`);
    if (kids) lines.push("- 这是给孩子用的商品：区分家长选购与孩子使用。人物适龄、动作自然；色彩和调性服从用户选定方向，不默认卡通、撞色或强制人物出镜。");
    return lines;
}

/** 上一版策划：按卖家的补充调整修改时带上，模型只改卖家不满意的地方。 */
function previousLines(previous: StudioDetailPlan | undefined): string[] {
    if (!previous) return [];
    return [
        "",
        "【上一版策划】（按卖家的补充调整修改这一版：卖家没提意见的部分尽量保留，卖家不满意的地方要改到位）",
        previous.summary ? `思路：${previous.summary}` : "",
        ...previous.screens.map((screen, index) => `${index + 1}. ${screen.title}（${screen.role} · ${screen.layout} · ${screen.composition || "按画面"}）${screen.headline ? `「${screen.headline}」` : ""}：${screen.visual.slice(0, 120)}`),
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
    const count = screenCount(product, request);
    const note = brief.planNote?.trim();
    // 主图类的范围（主图套图、按主图出的模板）文字更少、视觉元素可以少出现几张。
    const mainLike = request.scope === "main" || (request.scope === "template" && brief.suite?.kind === "main");
    const exampleRole =
        request.scope === "single"
            ? studioPlanTargetRoles(request.targets || [])[0] || "detail-scene"
            : request.scope === "template"
              ? (brief.suite ? studioTemplateShotRoles(brief.suite)[0] : undefined) || "detail-hero"
              : request.scope === "main"
                ? "main-white"
                : "detail-hero";
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
        `平台视觉策略：${studioChannelDesign(product.platform)}`,
        "交付方式：先完成商品分析与图文策划，再由图片模型一次完成整屏图文设计。标题、标签、引线与商品位置一起设计，逐字使用给定文案；不生成无字底图供程序叠字。",
        "设计交付要求：每屏只承担一个购买问题，headline 给结论，subline 给已确认的理由，lines 展开证据。画面同时指定商品焦点、文字留白、光线方向与一个主题元素；避免整套都用同一张商品棚拍加口号。摄影、信息与细节屏交替，但共享边距、字阶和栏目规范。",
        `市场：${studioMarket(brief.market).label}。${language}`,
        brief.audience.trim() ? `目标人群：${brief.audience.trim()}` : undefined,
        brief.positioning.trim() ? `价格定位：${brief.positioning.trim()}` : undefined,
        brief.extra.trim() ? `卖家补充要求：${oneLine(brief.extra)}` : undefined,
        ...styleLines(product),
        cast.length ? `已在模特库选了${cast.join("、")}：有人物的图用 detail-model，人物会按模特库出图。` : undefined,
        ...studioPrepPromptLines(brief.prep, Boolean(request.alternative), Boolean(note)),
        ...(request.scope === "template" ? templateLines(product) : []),
        note ? "" : undefined,
        note ? `【卖家对这次策划的补充调整】（优先照做；和商品事实、平台规则冲突时以事实和规则为准）\n${note}` : undefined,
        ...previousLines(request.previous),
        ...(request.alternative
            ? [
                  "【换一个设计方向】保留商品事实、用户选定的类型与数量、模特和参考约束；重新选择视觉主题、图文重心和裁切。至少一半屏的构图或机位与旧版不同，不能只换配色或改写标题。用户明确锁定参考图同款时保留该布局，只变化未锁定的摄影与细节。",
                  ...request.alternative.screens.map((screen, index) => `旧版 ${index + 1}：${screen.layout} / ${screen.composition || "按画面"} / ${screen.visual.slice(0, 120)}`),
              ]
            : []),
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
        ...studioDetailLayoutIds(product).map((id) => `- ${id}（${STUDIO_DETAIL_LAYOUTS[id].label}）：${STUDIO_DETAIL_LAYOUTS[id].use}`),
        "",
        "【设计调性】（挑一个最适合这件商品和目标人群的写进 tone，整组的版面、字体、文案语气和摄影都按它来）",
        ...STUDIO_DESIGN_TONE_IDS.map((id) => `- ${id}（${STUDIO_DESIGN_TONES[id].label}）：${STUDIO_DESIGN_TONES[id].use}；${studioTypeInstruction(id)}`),
        "",
        "【文案要求】（大牌和头部爆款的文案像品牌在说话，不像地摊吆喝）",
        "- 主标题优先回答一个购买问题：这件有什么不同、怎么用、哪个细节值得看。使用已确认的具体名词、动作或数值，不为追求情绪删掉商品信息；标题建议 6–12 字，注解补充一个依据或适用条件。",
        "- 讲出来的好处要有出处：轻、防滑、不易掉、耐摔、防蓝光、保温多久这类性能，卖点、已确认的事实和卖家补充里没有就不写，换成感受的说法也不行（没有重量信息就不能写「轻到像没戴」，没说防滑就不能写「低头也不滑」）。外观看得见的（透明、颜色、形状、结构）可以讲成感受。",
        "- 品牌字样、印字、logo 和型号是商品的身份，不是买它的理由：不当卖点，不做成图标标签，也不写进标题（「镜片上的名字」这类不要）。素材不够时少讲几个点、讲深一点，不拿外观凑成三个理由。",
        "- 不写空洞大词和泛情绪口号（品质之选、匠心、臻品、甄选、更亮眼、更出众、陪你每一天）。写完逐条自查：删掉商品图，这句话是否仍能用于任意衣服、杯子和眼镜；如果是，换成具体细节。",
        "- 可见外观可以作为设计主题，不能冒充舒适度或性能。比如用「清透前框，柔灰收边」讲配色，用微距证明；不写「轻到忘了戴」或「跑跳不掉」等没有依据的体验。参数屏直接给规格，无须改写成口号。",
        "- 短、准、有节奏：可以用短句、对仗、留白和数字，口语但不油腻；同一组里的标题句式要有变化。国内头部详情页常用两个短语对仗、中间空一格（前讲作用、后讲结果，如「深润修护 强韧喉黏膜」），痛点共鸣屏用一个问句开场；关键词或数字要用强调色时写进 elements。",
        `- 不写土味和口号腔的词：${STUDIO_TACKY_COPY.join("、")}，不用感叹号，不堆四字成语。`,
        "- 每张最多三层文字：英文栏目小标题、主标题、一句注解；要点只用在图标、引线、拼格、对照、参数、痛点、机理、成分、资质和收尾版式里做标签。",
        "- 不强制每屏放英文栏目头。摄影屏可以只有一句标题或完全无字；表格用 lines 写「项目｜数值与条件」，数据屏主标题放已确认的关键数字与单位，对照屏只写商品自身的真实角度或选项。",
        "- 详情页是一张连续的长图：每屏都不加页码、屏号和 01、02 这类序号（使用步骤屏的步骤编号、机理示意里作用过程的先后编号除外），eyebrow、elements 和 style 里也不要写屏的序号。",
        "",
        ...rhythmLines(request),
        ...productRealityLines(product),
        "",
        "【要求】",
        "1. 先做视觉策划，再排每一张（详见系统提示里的设计策划知识）：① 想清楚买这件商品的人下单前最关心什么、最担心什么，买的人和用的人是不是同一个人；② 同类商品的详情页通常长什么样，这组图要避开哪些套路；③ 用一句话写差异化定位，写进 positioning（不超过 40 个字）；④ 由定位推出一个具体的视觉主题，写成创意主线放进 concept（不超过 60 个字）：一个具体的世界或场景，不是一种颜色，换成别的商品就不成立；⑤ 从主题里取 3–5 个能反复使用的视觉元素写进 motifs（每个不超过 8 个字，比如道具、自然物、光影、图形、动作）。不用放在任何商品上都成立的通用画面（纯色背景加商品居中、泛泛的居家场景、空洞的大理石台面、整套同一条波浪曲线）。",
        scopeRequirement(product, request),
        `每屏选一个 composition 图文骨架：${STUDIO_COMPOSITION_IDS.map((id) => `${id}（${STUDIO_COMPOSITIONS[id].label}：${STUDIO_COMPOSITIONS[id].render}）`).join("；")}。visual 的文字与商品位置须与 composition 一致；内容版式 layout 定信息怎么表达，composition 定主体与留白在哪里。白底纯商品图不选 composition。${request.scope === "detail" ? `这 ${count} 屏建议使用 ${Math.min(4, Math.ceil(count / 2))} 种构图骨架；按主题变化，不为凑种类拆散系列感。` : "有文字的多张图交替构图骨架，单张图选最适合本商品的一种。"}`,
        "3. 每张只承担一个目的，按内容选最合适的 layout，不强制凑版式种类。首屏建立识别，证据屏把细节讲清，摄影屏留呼吸；同一组件可复用，但不要连续重复同一照片和信息。",
        "4. visual 写成能直接交给图片模型的一段话（不超过 150 个字），像摄影师和美术指导的分镜说明：背景或场景、商品怎么摆、什么角度和焦段、人物和动作（如有）、道具（不超过 3 件）、主色调、光线的方向和质感，以及按版式怎么分区、文字放在哪里。visual 和 style 里不写任何品牌名（上面提到的大牌只用来定调性），也不写「参考某某官网」。",
        "5. elements 写这一张的信息元素（不超过 80 个字）：图标卖点写几个图标、各画什么；引线标注写引线指向哪几个部位，要不要圆形放大镜头；拼格写每格放哪个部位；对照写两栏各放什么；痛点共鸣写人物神情和几个气泡标签，或宫格每格的场景；机理示意写剖面分几层、光点和箭头从哪到哪；成分特写写每个成分放在什么容器里；其他版式写装饰元素（色块、细线、圆角卡片、底部一排小图）。只写画面元素，不加新的事实，不写屏的序号、页码和屏号。",
        "6. 商品图里看不到的角度、内部结构、配件和包装不要安排成画面主体。",
        "7. 文案字数：headline 不超过 12 个字；subline 不超过 24 个字；lines 最多 6 条，每条不超过 12 个字，图标卖点、引线标注、拼格、痛点、机理、成分、资质和收尾版式的 lines 就是每个图标、引线、格子、气泡或成分的标签，数量和 elements 里写的一致。eyebrow 是主标题上方的英文栏目小标题（如 CLEAR FRAME，只用英文字母，不带序号），不需要就留空。只用上面的核心标题、卖点和已确认的事实，可以改写，但不加新的事实。文案里不出现上面没有的数字、参数、成分、认证、功效、价格和承诺，不用「最」「第一」「顶级」「100%」这类极限词。",
        "8. 同一条卖点最多用在一张（详情页的头图和收尾可以回顾）。素材不够写文案的图，headline 写一个短栏目名或设 noText: true。",
        "9. style 是整组共用的字体家族、色板、边距和图形语言（不超过 300 个字）。给出色名、色值、标题气质和标签风格。统一品牌识别，不规定每屏同一标题位置、同一字号或同一种卡片；首屏大胆、细节屏克制，字号和裁切按购买问题变化。每张的摄影、图文位置和道具写在各自 visual 里。",
        "设计依据 designAnalysis（150–300 字）：从实拍识别实际颜色、轮廓、透明度或表面反光，结合平台和目标买家，解释背景明度、对比色与强调色的选择；说明哪种主光/轮廓光能展示这件商品，哪些实际可见视角与局部裁切能证明各屏信息；给出标题与注解的字号比例、字重与留白策略。颜色、机位、字体必须服务于商品识别和阅读，不能套固定暖光、台面、居中棚拍。只有正面素材时用真实正面及可见局部，不臆造背面和内部。卖家选定质感或参考同款时尊重约束，仍按商品实际配色调整对比。style 和各屏 visual 必须执行这些依据。",
        "10. facts 写这一张用到的事实名称或卖点标题，没有就留空数组。",
        "11. inspiration 用一句话（不超过 60 个字）写你从同类爆款套图和参考图里借鉴了什么（比如某种色块分区、圆形徽章、横幅标题）；没有参考时留空。",
        request.scope === "single"
            ? "12. 视觉元素选用一两个融进画面，不要把所有元素堆在一张里。visual 里没写包装盒时，画面里就只有 visual 写到的商品部分。"
            : `12. 视觉元素可选，不要把同一个图形贴在每一张上。整件商品与局部景别按内容交替，不强制数量比例；包装仅在商品资料确认且该屏需要时出现。${mainLike ? "主图只保留有助于识别的元素。" : "短页优先讲清商品，长页展开证据，不为装饰堆道具。"}`,
        "",
        '只输出下面这个 JSON，并在顶层加入 "designAnalysis":"商品与设计选择的具体依据"，不要任何 JSON 外的解释：',
        `{"summary":"一两句话说明买家最关心什么，这 ${count} 张按什么顺序回答","positioning":"差异化定位","concept":"创意主线（视觉主题）","motifs":["视觉元素"],"inspiration":"借鉴了什么","tone":"设计调性编号",${product.style === "auto" ? '"styleId":"从可选质感里挑的编号",' : ""}"style":"整组设计规范","screens":[{"role":"${exampleRole}","layout":"poster","composition":"left","title":"不超过 8 个字的屏名","purpose":"这一张要让买家明白什么","visual":"具体画面","elements":"信息元素","eyebrow":"","headline":"","subline":"","lines":[],"facts":[],"noText":false}]}`,
    ];
    return lines.filter((line): line is string => line !== undefined).join("\n");
}

/** 土味和口号腔的写法：提示词里禁止，读回时发现了也提示用户。 */
export const STUDIO_TACKY_COPY = ["神器", "必入", "闭眼入", "yyds", "绝绝子", "天花板", "谁用谁知道", "一眼就认", "颜值担当", "您值得拥有", "爆款", "种草了", "上头"];
/** 说明书口吻和空洞大词：不土，但低端，读回时一样提示。 */
export const STUDIO_FLAT_COPY = ["该有的", "就这么简单", "记清楚", "一次看清", "都写在", "品质之选", "匠心", "臻品", "甄选", "高端大气"];

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
    compositionKinds: number;
    compositionRepeats: number;
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
    // 没有已确认的认证类事实时不收「资质背书」：图片模型会照着画出编造的证书，改用屏型默认的版式。
    const layouts = new Set(studioDetailLayoutIds(product));
    const finish = (planned: StudioPlannedScreen): StudioPlannedScreen => {
        const screen = layouts.has(planned.layout) ? planned : { ...planned, layout: studioRoleLayout(planned.role) };
        if (textless || screen.noText || screen.role === "main-white") return { ...screen, composition: undefined, headline: "", subline: "", lines: [], noText: true };
        return { ...screen, headline: grounded(screen.headline), subline: grounded(screen.subline), lines: screen.lines.map(grounded).filter(Boolean) };
    };
    let screens: StudioPlannedScreen[];
    const suite = request.scope === "template" ? product.brief.suite : undefined;
    if (request.scope === "template") {
        // 模板套图：和模板一张对一张。模型给的屏型不能排时改用模板对上的屏型，那个也没依据时按场景出；模板不放文字的张保持不放。
        const shots = suite?.shots || [];
        const expected = suite ? studioTemplateShotRoles(suite) : [];
        const fallback: StudioShotRole = suite?.kind === "main" ? "main-scene" : "detail-scene";
        screens = shots
            .map((shot, index) => {
                const screen = studioPlannedScreenOf(offered[index]);
                if (!screen) return undefined;
                const role = allowed.has(screen.role) ? screen.role : allowed.has(expected[index]) ? expected[index] : fallback;
                return finish({ ...screen, role, ...(shot.noText ? { noText: true } : {}) });
            })
            .filter((screen): screen is StudioPlannedScreen => Boolean(screen));
        if (!shots.length || screens.length < shots.length) throw new Error(`策划结果不完整（模板 ${shots.length} 张，只排好 ${screens.length} 张），请重试或换一个文本模型`);
    } else if (request.scope === "single") {
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
            .map(finish);
        if (request.scope === "detail") {
            const expected = screenCount(product, request);
            if (screens.length !== expected) throw new Error(`策划结果不完整（选择 ${expected} 屏，有效 ${screens.length} 屏），请重新策划；不会补入默认屏或直接扣费出图`);
        } else {
            screens = screens.slice(0, scope.screens);
            if (screens.length < scope.minScreens) throw new Error("策划结果不完整，请重试或换一个文本模型");
        }
        // 主图第一张要在搜索列表里一眼认出商品：模型没把白底图或卖点主图放第一张时，把排在最前的那张挪上来。
        const first = request.scope === "main" ? screens.findIndex((screen) => screen.role === "main-white" || screen.role === "main-selling") : -1;
        if (first > 0) screens = [screens[first], ...screens.filter((_, index) => index !== first)];
    }
    const copies = screens.flatMap((screen) => [screen.headline, screen.subline, ...screen.lines]);
    const issues = screens.flatMap((screen, index) => [screen.headline, screen.subline, ...screen.lines].flatMap((value) => checkEcommerceText(value, `第 ${index + 1} 张`)));
    const tacky = [...STUDIO_TACKY_COPY, ...STUDIO_FLAT_COPY].filter((word) => copies.some((value) => value.toLowerCase().includes(word.toLowerCase())));
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    // 只有质感选了「按商品推荐」时才收策划挑的质感。
    const styleId = product.style === "auto" ? studioPlanStyleId(data.styleId) : undefined;
    // 明确调整后不能用旧方向补回被移除的场景、调性；换方向也不补旧主线。
    const direction = studioPickedDirection(product.brief.prep);
    const adjusted = Boolean(product.brief.planNote?.trim());
    const tone = studioPlanTone(data.tone) || (adjusted ? undefined : direction?.tone);
    const positioning = text(data.positioning, STUDIO_DETAIL_PLAN_LIMITS.positioning) || (!adjusted ? direction?.positioning.slice(0, STUDIO_DETAIL_PLAN_LIMITS.positioning) : "") || "";
    const concept = text(data.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) || (!adjusted && !request.alternative ? direction?.concept.slice(0, STUDIO_DETAIL_PLAN_LIMITS.concept) : "") || "";
    return {
        plan: {
            id: meta.id,
            createdAt: meta.createdAt,
            model: meta.model,
            summary: text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
            ...(text(data.designAnalysis, STUDIO_DETAIL_PLAN_LIMITS.designAnalysis) ? { designAnalysis: text(data.designAnalysis, STUDIO_DETAIL_PLAN_LIMITS.designAnalysis) } : {}),
            style: text(data.style, STUDIO_DETAIL_PLAN_LIMITS.style),
            ...(positioning ? { positioning } : {}),
            ...(concept ? { concept } : {}),
            ...(studioPlanMotifs(data.motifs).length ? { motifs: studioPlanMotifs(data.motifs) } : {}),
            ...(text(data.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) ? { inspiration: text(data.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) } : {}),
            ...(styleId ? { styleId } : {}),
            ...(tone ? { tone } : {}),
            ...(request.scope === "single" ? { targets: request.targets } : {}),
            ...(suite ? { suiteId: suite.id } : {}),
            ...(request.scope === "detail" ? { requestedScreens: screenCount(product, request) } : {}),
            screens,
        },
        dropped: request.scope === "single" || request.scope === "template" ? 0 : offered.length - screens.length,
        ungrounded,
        issues,
        tacky,
        layoutKinds: new Set(screens.map((screen) => screen.layout)).size,
        layoutRepeats: screens.filter((screen, index) => index > 0 && screen.layout === screens[index - 1].layout).length,
        compositionKinds: new Set(screens.map((screen) => screen.composition).filter(Boolean)).size,
        compositionRepeats: screens.filter((screen, index) => index > 0 && screen.composition && screen.composition === screens[index - 1].composition).length,
    };
}
