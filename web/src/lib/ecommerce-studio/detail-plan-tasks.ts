import { checkEcommerceText, type EcommerceComplianceIssue } from "@/lib/ecommerce/ecommerce-compliance";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioInfoPoints, studioInfoText, studioLanguage, studioMarket, studioProductTypeOf, studioTitleOf } from "./brief";
import { STUDIO_DETAIL_PLAN_LIMITS, STUDIO_DETAIL_SCREEN_GUIDE, studioDetailPlanFacts, studioPlannedScreenOf } from "./detail-plan";
import { extractStudioJson } from "./dossier-tasks";
import { studioStyle } from "./shot-specs";
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

export function buildDetailPlanPrompt(product: StudioProduct, roles: StudioShotRole[]) {
    const brief = product.brief;
    const platform = ecommercePlatform(product.platform)?.name || "电商平台";
    const style = studioStyle(product.style);
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
        `为这件商品策划一套${platform}手机端详情页，长图按屏从上到下排列，每屏画幅 3:4。`,
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
        `视觉方向以「${style.name}」为基础：${style.mood}；色板 ${style.palette.map((color) => `${color.name} ${color.hex}`).join("、")}；光影${style.light}。`,
        cast.length ? `已在模特库选了${cast.join("、")}：有人物的屏用 detail-model，人物会按模特库出图。` : undefined,
        "",
        "【可以排的屏型】（role 只能从这里选；没有列出的屏型说明依据不够，不要排）",
        ...roles.map((role) => {
            const guide = STUDIO_DETAIL_SCREEN_GUIDE[role as keyof typeof STUDIO_DETAIL_SCREEN_GUIDE];
            return guide ? `- ${role}（${guide.label}）：${guide.use}` : undefined;
        }),
        "",
        "【要求】",
        "1. 按信息量排 6–10 屏，信息少就少排，不凑数；第一屏用 detail-hero，最后一屏用 detail-closing。",
        "2. 每屏只承担一个目的。相邻两屏的景别、机位和场景不能相同，商品不能连续几屏都是同一个角度。",
        "3. visual 写成能直接交给图片模型的一段话（不超过 150 个字）：场景或背景、商品怎么摆、什么角度、人物和动作（如有）、道具（不超过 3 件）、主色调、光线，以及文字放在画面哪个位置。",
        "4. 商品图里看不到的角度、内部结构、配件和包装不要安排成画面主体。",
        "5. 文案：headline 不超过 12 个字；subline 不超过 24 个字；lines 最多 4 条，每条不超过 14 个字。只用上面的核心标题、卖点和已确认的事实，可以改写得更口语，但不加新的事实。文案里不出现上面没有的数字、参数、成分、认证、功效、价格和承诺，不用「最」「第一」「顶级」「100%」这类极限词。",
        "6. 同一条卖点最多用在一屏（头图和收尾可以回顾）。素材不够写文案的屏，headline 写一个短栏目名或设 noText: true。",
        "7. style 写整套共用的视觉规范：色板（色名和 #色值）、光线气质、字体气质和反复出现的装饰元素，所有屏一致；每屏的背景和场景写在各自的 visual 里。",
        "8. facts 写这一屏用到的事实名称或卖点标题，没有就留空数组。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        `{"summary":"一两句话说明这套详情页的叙事思路","style":"整套视觉规范","screens":[{"role":"detail-hero","title":"不超过 8 个字的屏名","purpose":"这一屏要让买家明白什么","visual":"具体画面","headline":"","subline":"","lines":[],"facts":[],"noText":false}]}`,
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

/** 读回策划结果：屏型必须在这件商品能排的范围里，文案的数字必须有出处；不够三屏时要求重试。 */
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
    return {
        plan: { id: meta.id, createdAt: meta.createdAt, model: meta.model, summary: text(data.summary, STUDIO_DETAIL_PLAN_LIMITS.summary), style: text(data.style, STUDIO_DETAIL_PLAN_LIMITS.style), screens },
        dropped: offered.length - screens.length,
        ungrounded,
        issues,
    };
}
