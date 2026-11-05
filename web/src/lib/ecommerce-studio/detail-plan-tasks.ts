import { checkEcommerceText, type EcommerceComplianceIssue } from "@/lib/ecommerce/ecommerce-compliance";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioInfoPoints, studioInfoText, studioLanguage, studioMarket, studioProductTypeOf, studioTitleOf } from "./brief";
import { STUDIO_DETAIL_LAYOUT_IDS, STUDIO_DETAIL_LAYOUTS, STUDIO_DETAIL_PLAN_LIMITS, STUDIO_DETAIL_SCREEN_GUIDE, studioDetailPlanFacts, studioPlannedScreenOf, studioPlanStyleId } from "./detail-plan";
import { extractStudioJson } from "./dossier-tasks";
import { STUDIO_STYLES, studioStyle, type StudioStylePreset } from "./shot-specs";
import { STUDIO_FACT_GROUP_LABEL, STUDIO_VIEW_LABEL, studioFactUsable, type StudioDetailPlan, type StudioPlannedScreen, type StudioProduct, type StudioShotRole } from "./types";

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

export function buildDetailPlanPrompt(product: StudioProduct, roles: StudioShotRole[]) {
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
    const language = brief.language === "none" ? "这套图不放文字：每一屏都写 noText: true，文案留空。" : `图上文字最终用${studioLanguage(brief.language).name}呈现；这里的文案先用简体中文写。`;
    const lines: (string | undefined)[] = [
        `为这件商品策划一套${platform}手机端详情页，共 ${STUDIO_DETAIL_PLAN_LIMITS.screens} 屏，长图按屏从上到下排列，每屏画幅 3:4。`,
        "",
        "【商品】",
        `名称：${product.dossier?.name || product.name || productType || "见商品图"}`,
        brand ? `品牌：${brand}` : undefined,
        productType ? `商品类型：${productType}` : undefined,
        product.dossier?.summary ? `概括：${product.dossier.summary}` : undefined,
        `商品图：${views.length ? views.join("、") : "正面"}（外观以商品图为准）`,
        product.dossier?.invariants.length ? `外观要点（每屏都不能变）：${product.dossier.invariants.join("、")}` : undefined,
        "",
        "【可以用的文案素材】",
        studioTitleOf(product) ? `核心标题：${studioTitleOf(product)}` : "核心标题：无（头图标题从卖点里提炼，不超过 12 个字）",
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
        cast.length ? `已在模特库选了${cast.join("、")}：有人物的屏用 detail-model，人物会按模特库出图。` : undefined,
        "",
        "【可以排的屏型】（role 只能从这里选；没有列出的屏型说明依据不够，不要排）",
        ...roles.map((role) => {
            const guide = STUDIO_DETAIL_SCREEN_GUIDE[role as keyof typeof STUDIO_DETAIL_SCREEN_GUIDE];
            return guide ? `- ${role}（${guide.label}）：${guide.use}` : undefined;
        }),
        "",
        "【可以用的版式】（layout 只能从这里选；平台上做得好的详情页每屏都是排过版的画面，不是一张商品照片加一行字）",
        ...STUDIO_DETAIL_LAYOUT_IDS.map((id) => `- ${id}（${STUDIO_DETAIL_LAYOUTS[id].label}）：${STUDIO_DETAIL_LAYOUTS[id].use}`),
        "",
        "【要求】",
        "1. 先想清楚：买这件商品的人下单前最关心什么、最担心什么，这件商品凭什么值得买。整套详情页围绕这些回答来排，不要套一份各品类通用的模板。",
        `2. 正好排 ${STUDIO_DETAIL_PLAN_LIMITS.screens} 屏：第一屏用 detail-hero，最后一屏用 detail-closing，中间各屏的主题和顺序按第 1 条的分析来定。屏型可以重复使用（比如两屏卖点、两屏不同的使用场景、两屏不同部位的细节），但每屏讲的内容和画面都不能重复。信息不够时多排使用场景、使用效果和商品图里看得到的细节，不编参数，也不把同一个卖点换个说法再讲一遍。`,
        "3. 每屏只承担一个目的，并选一个最适合讲这件事的 layout。相邻两屏的版式不能相同，整套至少用到 6 种版式；同一种屏型不能连续超过两屏；相邻两屏的景别、机位和场景也不能相同。",
        "4. visual 写成能直接交给图片模型的一段话（不超过 150 个字）：背景或场景、商品怎么摆、什么角度、人物和动作（如有）、道具（不超过 3 件）、主色调、光线，以及按版式怎么分区、文字放在哪里。",
        "5. elements 写这一屏的信息元素（不超过 80 个字）：图标卖点写几个图标、各画什么；引线标注写引线指向哪几个部位；拼格写每格放哪个部位；对照写两栏各放什么；其他版式写装饰元素（色块、细线、圆角卡片、编号）。只写画面元素，不加新的事实。",
        "6. 商品图里看不到的角度、内部结构、配件和包装不要安排成画面主体。",
        "7. 文案：headline 不超过 12 个字；subline 不超过 24 个字；lines 最多 6 条，每条不超过 12 个字，图标卖点、引线标注、拼格和收尾版式的 lines 就是每个图标、引线或格子的标签，数量和 elements 里写的一致。eyebrow 是主标题上方的英文栏目小标题（如 01 CLEAR FRAME，只用英文字母，可以带两位序号），不需要就留空。只用上面的核心标题、卖点和已确认的事实，可以改写得更口语，但不加新的事实。文案里不出现上面没有的数字、参数、成分、认证、功效、价格和承诺，不用「最」「第一」「顶级」「100%」这类极限词。",
        "8. 同一条卖点最多用在一屏（头图和收尾可以回顾）。素材不够写文案的屏，headline 写一个短栏目名或设 noText: true。",
        "9. style 是整套共用的设计规范（不超过 300 个字），像设计师交给出图的规范：色板（底色、主色、强调色，各写色名和 #色值）、背景体系、光线、字体（中文标题的字重和气质、英文小标题的样式、数字的样式）、栏目标题的样式（比如序号加英文小标题加中文标题加一条细线）、图标样式（线框还是面性、线条粗细、有没有底板）、反复出现的装饰元素。所有屏一致，每屏的背景和场景写在各自的 visual 里。",
        "10. facts 写这一屏用到的事实名称或卖点标题，没有就留空数组。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        `{"summary":"一两句话说明买家最关心什么，这 ${STUDIO_DETAIL_PLAN_LIMITS.screens} 屏按什么顺序回答",${product.style === "auto" ? '"styleId":"从可选质感里挑的编号",' : ""}"style":"整套设计规范","screens":[{"role":"detail-hero","layout":"poster","title":"不超过 8 个字的屏名","purpose":"这一屏要让买家明白什么","visual":"具体画面","elements":"信息元素","eyebrow":"","headline":"","subline":"","lines":[],"facts":[],"noText":false}]}`,
    ];
    return lines.filter((line): line is string => line !== undefined).join("\n");
}

export type StudioDetailPlanResult = {
    plan: StudioDetailPlan;
    /** 模型排了但依据不够或格式不对、没收进清单的屏数。 */
    dropped: number;
    /** 因为带了原文里没有的数字被去掉的文案条数。 */
    ungrounded: number;
    issues: EcommerceComplianceIssue[];
};

/** 读回策划结果：屏型必须在这件商品能排的范围里，文案的数字必须有出处；去掉依据不够的屏后剩得太少时要求重试。 */
export function parseDetailPlan(raw: string, product: StudioProduct, roles: StudioShotRole[], meta: { id: string; model: string; createdAt: string }): StudioDetailPlanResult {
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
    const screens = offered
        .map((screen) => studioPlannedScreenOf(screen))
        .filter((screen): screen is StudioPlannedScreen => Boolean(screen && allowed.has(screen.role)))
        .slice(0, STUDIO_DETAIL_PLAN_LIMITS.maxScreens)
        .map((screen): StudioPlannedScreen => {
            if (textless || screen.noText) return { ...screen, headline: "", subline: "", lines: [], noText: true };
            return { ...screen, headline: grounded(screen.headline), subline: grounded(screen.subline), lines: screen.lines.map(grounded).filter(Boolean) };
        });
    if (screens.length < STUDIO_DETAIL_PLAN_LIMITS.minScreens) throw new Error("策划结果不完整，请重试或换一个文本模型");
    const issues = screens.flatMap((screen, index) => [screen.headline, screen.subline, ...screen.lines].flatMap((value) => checkEcommerceText(value, `第 ${index + 1} 屏`)));
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    // 只有质感选了「按商品推荐」时才收策划挑的质感。
    const styleId = product.style === "auto" ? studioPlanStyleId(data.styleId) : undefined;
    return {
        plan: { id: meta.id, createdAt: meta.createdAt, model: meta.model, summary: text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary), style: text(data.style, STUDIO_DETAIL_PLAN_LIMITS.style), ...(styleId ? { styleId } : {}), screens },
        dropped: offered.length - screens.length,
        ungrounded,
        issues,
    };
}
