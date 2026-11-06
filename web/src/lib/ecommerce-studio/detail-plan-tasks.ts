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
    studioPlannedScreenOf,
    studioPlanMotifs,
    studioPlanStyleId,
    studioPlanTone,
    studioRoleLayout,
    studioTemplateShotRoles,
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
 * 这次策划的范围：详情页 10 屏、主图 5 张、按选中的单张类型逐张出，或按表单里选中的模板一张对一张排；
 * previous 是要按补充调整修改的上一版。images 是随任务附带的图：先是商品图，后面是卖家上传的参考图（大牌或爆款截图）。
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

function screenCount(product: StudioProduct, request: StudioPlanRequest) {
    if (request.scope === "single") return studioPlanTargetRoles(request.targets || []).length;
    if (request.scope === "template") return product.brief.suite?.shots.length || 0;
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
        return `2. 正好排 ${count} 屏：第一屏用 detail-hero，最后一屏用 detail-closing，中间各屏的主题和顺序按第 1 条的分析来定。屏型可以重复使用（比如两屏卖点、两屏不同的使用场景、两屏不同部位的细节），但每屏讲的内容和画面都不能重复。信息不够时多排使用场景、种草、使用效果和商品图里看得到的细节，不编参数，也不把同一个卖点换个说法再讲一遍。整套像一个品牌故事：开头抓人，中段证明，结尾收束，节奏有起伏（大图屏和信息屏交替）。`;
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
            `- ${STUDIO_COLOR_WORLD}。至少两屏用强对比（深底浅字，或一整块饱和主色），不能整套都是同一档浅色渐变，也不能每屏换一种互不相干的背景。`,
            "- 每屏同一个栏目头：英文小标题、主标题、副标题的位置、字号和颜色全套一致，一眼就是一套。",
            "- 机位要有变化：同一个商品角度和景别整套最多用两次；至少一屏超近微距，一屏有人或手和商品互动，一屏是创意静物。",
            STUDIO_VISUALIZE,
            `- 关键几屏要有一个创意手法（首屏必须有）：${STUDIO_CREATIVE_DEVICES}。把用到的手法写进 visual，写清楚画面怎么做。`,
            "- 信息少时不要凑数：商品标识、印字和型号不单独成屏，也不当卖点；用使用场景、情绪时刻、创意静物和质感细节来撑，不把同几条外观换个说法反复讲。",
        ];
    if (request.scope === "main")
        return [
            head,
            "- 5 张是一个系列：同一个版头样式（同色标题条或角标、同一种字体和图标底板），同一组展台、道具和色块搭成的小世界，同一套主色，背景在这套颜色里做深浅变化；首图之外每张换一个机位和景别。",
            "- 讲功能用手在用的特写，可以配一两个圆形放大镜头把按键、接口或质地放大；已确认的关键数字做成画面里最大的元素。",
            `- 首图之外每张都要有一个让人停下来的创意手法：${STUDIO_CREATIVE_DEVICES}，写进 visual。`,
            "- 商品标识、印字和型号不当卖点。",
        ];
    if (request.scope === "template")
        return [
            head,
            `- 模板只定了每张讲什么，不要照着模板的镜头说明平铺直叙。${STUDIO_COLOR_WORLD}，相邻两张换机位和景别；每张同一个栏目头或版头。`,
            STUDIO_VISUALIZE,
            `- 白底图之外的首张和关键几张要有一个让人停下来的创意手法：${STUDIO_CREATIVE_DEVICES}，写进 visual。`,
            "- 商品标识、印字和型号不当卖点。",
        ];
    return [head, `- 每张都要有一个让人停下来的创意手法：${STUDIO_CREATIVE_DEVICES}，写进 visual；同一类型的几张换不同的手法和机位。`, "- 同时出几张时用同一个色彩世界和同一种标题样式，像一个品牌出的。", "- 商品标识、印字和型号不当卖点。"];
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
        `市场：${studioMarket(brief.market).label}。${language}`,
        brief.audience.trim() ? `目标人群：${brief.audience.trim()}` : undefined,
        brief.positioning.trim() ? `价格定位：${brief.positioning.trim()}` : undefined,
        brief.extra.trim() ? `卖家补充要求：${oneLine(brief.extra)}` : undefined,
        ...styleLines(product),
        cast.length ? `已在模特库选了${cast.join("、")}：有人物的图用 detail-model，人物会按模特库出图。` : undefined,
        ...(request.scope === "template" ? templateLines(product) : []),
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
        ...studioDetailLayoutIds(product).map((id) => `- ${id}（${STUDIO_DETAIL_LAYOUTS[id].label}）：${STUDIO_DETAIL_LAYOUTS[id].use}`),
        "",
        "【设计调性】（挑一个最适合这件商品和目标人群的写进 tone，整组的版面、字体、文案语气和摄影都按它来）",
        ...STUDIO_DESIGN_TONE_IDS.map((id) => `- ${id}（${STUDIO_DESIGN_TONES[id].label}）：${STUDIO_DESIGN_TONES[id].use}`),
        "",
        "【文案要求】（大牌和头部爆款的文案像品牌在说话，不像地摊吆喝）",
        "- 主标题讲买家得到的感受或结果，不讲「这是什么」；把卖点翻译成画面和感受，比如把「重量轻」写成「轻到忘了它在」，把「防滑」写成「低头也不跑」。",
        "- 不写说明书口吻（该有的、就这么简单、记清楚、一次看清、都写在）和空洞大词（品质之选、匠心、臻品、甄选、高端大气）。写完逐条自查：这句话换到同类任何一件商品上都成立，或者只是在描述商品长什么样，就重写。",
        "- 主标题不能只是罗列外观或参数（比如「透明框，绿镜腿」「四个地方，记清楚」），要说出买家在意的结果、情绪或一个画面；买的人和用的人不同时（比如家长给孩子买），对买的人说话。",
        "- 短、准、有节奏：可以用短句、对仗、留白和数字，口语但不油腻；同一组里的标题句式要有变化。国内头部详情页常用两个短语对仗、中间空一格（前讲作用、后讲结果，如「深润修护 强韧喉黏膜」），痛点共鸣屏用一个问句开场；关键词或数字要用强调色时写进 elements。",
        `- 不写土味和口号腔的词：${STUDIO_TACKY_COPY.join("、")}，不用感叹号，不堆四字成语。`,
        "- 每张最多三层文字：英文栏目小标题、主标题、一句注解；要点只用在图标、引线、拼格、对照、参数、痛点、机理、成分、资质和收尾版式里做标签。",
        "- 详情页是一张连续的长图：每屏都不加页码、屏号和 01、02 这类序号（使用步骤屏的步骤编号、机理示意里作用过程的先后编号除外），eyebrow、elements 和 style 里也不要写屏的序号。",
        "",
        ...rhythmLines(request),
        "",
        "【要求】",
        "1. 先做视觉策划，再排每一张（详见系统提示里的设计策划知识）：① 想清楚买这件商品的人下单前最关心什么、最担心什么，买的人和用的人是不是同一个人；② 同类商品的详情页通常长什么样，这组图要避开哪些套路；③ 用一句话写差异化定位，写进 positioning（不超过 40 个字）；④ 由定位推出一个具体的视觉主题，写成创意主线放进 concept（不超过 60 个字）：一个具体的世界或场景，不是一种颜色，换成别的商品就不成立；⑤ 从主题里取 3–5 个能反复使用的视觉元素写进 motifs（每个不超过 8 个字，比如道具、自然物、光影、图形、动作）。不用放在任何商品上都成立的通用画面（纯色背景加商品居中、泛泛的居家场景、空洞的大理石台面、整套同一条波浪曲线）。",
        scopeRequirement(product, request),
        `3. 每张只承担一个目的，并选一个最适合讲这件事的 layout。${request.scope === "detail" ? "相邻两屏的版式不能相同，整套至少用到 6 种版式；同一种屏型不能连续超过两屏；" : "相邻两张的版式尽量不同；"}相邻两张的景别、机位和场景也不能相同。`,
        "4. visual 写成能直接交给图片模型的一段话（不超过 150 个字），像摄影师和美术指导的分镜说明：背景或场景、商品怎么摆、什么角度和焦段、人物和动作（如有）、道具（不超过 3 件）、主色调、光线的方向和质感，以及按版式怎么分区、文字放在哪里。visual 和 style 里不写任何品牌名（上面提到的大牌只用来定调性），也不写「参考某某官网」。",
        "5. elements 写这一张的信息元素（不超过 80 个字）：图标卖点写几个图标、各画什么；引线标注写引线指向哪几个部位，要不要圆形放大镜头；拼格写每格放哪个部位；对照写两栏各放什么；痛点共鸣写人物神情和几个气泡标签，或宫格每格的场景；机理示意写剖面分几层、光点和箭头从哪到哪；成分特写写每个成分放在什么容器里；其他版式写装饰元素（色块、细线、圆角卡片、底部一排小图）。只写画面元素，不加新的事实，不写屏的序号、页码和屏号。",
        "6. 商品图里看不到的角度、内部结构、配件和包装不要安排成画面主体。",
        "7. 文案字数：headline 不超过 12 个字；subline 不超过 24 个字；lines 最多 6 条，每条不超过 12 个字，图标卖点、引线标注、拼格、痛点、机理、成分、资质和收尾版式的 lines 就是每个图标、引线、格子、气泡或成分的标签，数量和 elements 里写的一致。eyebrow 是主标题上方的英文栏目小标题（如 CLEAR FRAME，只用英文字母，不带序号），不需要就留空。只用上面的核心标题、卖点和已确认的事实，可以改写，但不加新的事实。文案里不出现上面没有的数字、参数、成分、认证、功效、价格和承诺，不用「最」「第一」「顶级」「100%」这类极限词。",
        "8. 同一条卖点最多用在一张（详情页的头图和收尾可以回顾）。素材不够写文案的图，headline 写一个短栏目名或设 noText: true。",
        "9. style 是整组共用的设计规范（不超过 300 个字），像设计师交给出图的规范：色板（底色、主色、强调色，各写色名和 #色值；主色要撑得起整屏，是深色或饱和色，按上面的节奏用在几屏的大色块背景上，不要整套都是同一档浅色）、背景体系（整套的色彩世界，照片怎么统一调色）、光线、字体（中文标题的字重和气质、英文小标题的样式、数字的样式、关键词的强调色）、栏目头（每屏同一位置、同一结构：英文小标题、主标题、副标题，比如再加一条细线，不用序号）、组件（标签用什么样式、卡片圆角、图标线框还是面性和线条粗细、有没有底板、放大镜头圆圈的描边）、反复出现的装饰元素。所有图一致，每张的背景和场景写在各自的 visual 里。",
        "10. facts 写这一张用到的事实名称或卖点标题，没有就留空数组。",
        "11. inspiration 用一句话（不超过 60 个字）写你从同类爆款套图和参考图里借鉴了什么（比如某种色块分区、圆形徽章、横幅标题）；没有参考时留空。",
        request.scope === "single"
            ? "12. 视觉元素选用一两个融进画面，不要把所有元素堆在一张里。visual 里没写包装盒时，画面里就只有 visual 写到的商品部分。"
            : `12. 视觉元素每张选用一两个，换着形式出现（实物、光影、局部、图形），至少${mainLike ? "两" : "三"}张不出现；不要把同一个图形贴在每一张上。整件商品连同包装完整摆拍的张数不超过一半，包装盒最多出现在两三张，其余张用质地、局部、使用中的手和人、场景、机理示意来讲；visual 里没写包装盒的张，画面里就只有 visual 写到的商品部分。`,
        "",
        "只输出下面这个 JSON，不要任何解释：",
        `{"summary":"一两句话说明买家最关心什么，这 ${count} 张按什么顺序回答","positioning":"差异化定位","concept":"创意主线（视觉主题）","motifs":["视觉元素"],"inspiration":"借鉴了什么","tone":"设计调性编号",${product.style === "auto" ? '"styleId":"从可选质感里挑的编号",' : ""}"style":"整组设计规范","screens":[{"role":"${exampleRole}","layout":"poster","title":"不超过 8 个字的屏名","purpose":"这一张要让买家明白什么","visual":"具体画面","elements":"信息元素","eyebrow":"","headline":"","subline":"","lines":[],"facts":[],"noText":false}]}`,
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
        if (textless || screen.noText) return { ...screen, headline: "", subline: "", lines: [], noText: true };
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
            .slice(0, scope.screens)
            .map(finish);
        if (screens.length < scope.minScreens) throw new Error("策划结果不完整，请重试或换一个文本模型");
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
    const tone = studioPlanTone(data.tone);
    return {
        plan: {
            id: meta.id,
            createdAt: meta.createdAt,
            model: meta.model,
            summary: text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary),
            style: text(data.style, STUDIO_DETAIL_PLAN_LIMITS.style),
            ...(text(data.positioning, STUDIO_DETAIL_PLAN_LIMITS.positioning) ? { positioning: text(data.positioning, STUDIO_DETAIL_PLAN_LIMITS.positioning) } : {}),
            ...(text(data.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) ? { concept: text(data.concept, STUDIO_DETAIL_PLAN_LIMITS.concept) } : {}),
            ...(studioPlanMotifs(data.motifs).length ? { motifs: studioPlanMotifs(data.motifs) } : {}),
            ...(text(data.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) ? { inspiration: text(data.inspiration, STUDIO_DETAIL_PLAN_LIMITS.inspiration) } : {}),
            ...(styleId ? { styleId } : {}),
            ...(tone ? { tone } : {}),
            ...(request.scope === "single" ? { targets: request.targets } : {}),
            ...(suite ? { suiteId: suite.id } : {}),
            screens,
        },
        dropped: request.scope === "single" || request.scope === "template" ? 0 : offered.length - screens.length,
        ungrounded,
        issues,
        tacky,
        layoutKinds: new Set(screens.map((screen) => screen.layout)).size,
        layoutRepeats: screens.filter((screen, index) => index > 0 && screen.layout === screens[index - 1].layout).length,
    };
}
