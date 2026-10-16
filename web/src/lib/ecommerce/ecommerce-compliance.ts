/**
 * 合规检查——电商图上最容易踩的雷。
 *
 * 广告法禁用绝对化用语，平台禁止无依据的功效宣称，价格标注要有依据。
 * 这些不是"建议"，是罚则：一次踩中就是整改或罚款。
 *
 * 检查在**生成之前**做，因为这些字是用户自己写的文案——模型不写字，
 * 也就不该由模型背这个锅。命中项直接标在节点里，不静默放过。
 */
import type { EcommerceCopy, EcommerceProductProfile, EcommerceSellingPoint } from "./ecommerce-contract";

export type EcommerceComplianceLevel = "block" | "warn";

export type EcommerceComplianceIssue = {
    level: EcommerceComplianceLevel;
    /** 命中的词 */
    term: string;
    /** 在哪条文案里 */
    field: string;
    reason: string;
};

type Rule = { pattern: RegExp; level: EcommerceComplianceLevel; reason: string };

/**
 * 绝对化用语。广告法第九条禁止"国家级""最高级""最佳"等用语。
 * 词表按常见变体展开，避免"最"字被"蕞""最最"这类写法绕过。
 */
const ABSOLUTE_TERMS: Rule[] = [
    { pattern: /国家级|世界级|全球级|国际级/, level: "block", reason: "广告法禁止使用「国家级」「世界级」等用语" },
    { pattern: /最高级|最佳|最优|最好|最强|最先进|最便宜|最低价|最受欢迎|最新科技|最新科学|最新技术/, level: "block", reason: "广告法禁止「最高级」「最佳」等绝对化用语" },
    { pattern: /第一品牌|销量第一|排名第一|全国第一|世界第一|独家|唯一|首个|首家|首创/, level: "block", reason: "「第一」「唯一」「独家」属绝对化用语，需有权威依据" },
    { pattern: /顶级|极致|冠军|王牌|领导品牌|领袖品牌|王者|天花板/, level: "block", reason: "「顶级」「冠军」「领导品牌」属绝对化用语" },
    { pattern: /全网最低|史上最低|空前绝后|绝无仅有|无与伦比/, level: "block", reason: "无法验证的极端表述，属绝对化用语" },
    { pattern: /最[好棒优良强佳]/, level: "warn", reason: "疑似绝对化用语，请核对是否有权威依据" },
];

/** 功效与承诺。没有依据的功效宣称在多数类目都违规。 */
const CLAIM_TERMS: Rule[] = [
    { pattern: /治疗|治愈|根治|药到病除|包治|疗效|处方/, level: "block", reason: "非药品不得宣称治疗功效" },
    { pattern: /100%|百分百|绝对|永不|终身|永久/, level: "block", reason: "绝对化承诺，无法验证" },
    { pattern: /无效退款|不满意退款|保证有效|立竿见影|一次见效/, level: "block", reason: "效果承诺需有依据，且部分类目直接禁止" },
    { pattern: /防癌|抗癌|抗肿瘤|降血压|降血糖|壮阳|丰胸/, level: "block", reason: "疾病相关宣称，普通商品不得使用" },
    { pattern: /纯天然|零添加|无添加|有机/, level: "warn", reason: "需有认证依据，否则不得标注" },
    { pattern: /医用级|药妆|械字号|医美级/, level: "warn", reason: "需有相应资质依据" },
];

/** 价格标注。原价、折扣要有真实依据。 */
const PRICE_TERMS: Rule[] = [
    { pattern: /原价|专柜价|市场价|日常价/, level: "warn", reason: "「原价」需为本次促销前七日内的真实成交价" },
    { pattern: /限时|仅此一天|最后一天|秒杀|清仓/, level: "warn", reason: "限时表述需与实际活动一致" },
];

const RULES: Rule[] = [...ABSOLUTE_TERMS, ...CLAIM_TERMS, ...PRICE_TERMS];

/** 检查一段文本，返回命中项。 */
export function checkEcommerceText(text: string, field: string): EcommerceComplianceIssue[] {
    const value = text.trim();
    if (!value) return [];
    const issues: EcommerceComplianceIssue[] = [];
    const seen = new Set<string>();
    for (const rule of RULES) {
        const match = value.match(rule.pattern);
        if (!match) continue;
        // 同一个字段同一个词只报一次，避免"最"和"最好"重复刷屏
        const key = `${field}:${match[0]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ level: rule.level, term: match[0], field, reason: rule.reason });
    }
    return issues;
}

/**
 * 检查一条文案节点。
 *
 * 价格字段额外单独判：写了价格但没有说明依据时提示——不是硬拦，
 * 因为用户可能确实有依据，只是没写在这里。
 */
export function checkEcommerceCopy(copy: EcommerceCopy | undefined): EcommerceComplianceIssue[] {
    if (!copy) return [];
    const fields: { key: keyof EcommerceCopy; label: string }[] = [
        { key: "headline", label: "标题" },
        { key: "subhead", label: "副文案" },
        { key: "cta", label: "行动引导" },
        { key: "price", label: "价格" },
    ];
    return fields.flatMap(({ key, label }) => checkEcommerceText(copy[key], label));
}

/** 检查卖点清单。卖点的依据字段本身不检查——它是给用户看的备注，不进画面。 */
export function checkEcommerceSellingPoints(points: EcommerceSellingPoint[] | undefined): EcommerceComplianceIssue[] {
    return (points || []).flatMap((point, index) => checkEcommerceText(point.claim, `卖点 ${index + 1}`));
}

/** 检查商品档案。禁止项字段是写给模型的约束，不检查。 */
export function checkEcommerceProfile(profile: EcommerceProductProfile | undefined): EcommerceComplianceIssue[] {
    if (!profile) return [];
    return [
        ...checkEcommerceText(profile.category, "品类"),
        ...checkEcommerceText(profile.marks, "标识"),
    ];
}

export type EcommerceComplianceInput = {
    copy?: EcommerceCopy;
    sellingPoints?: EcommerceSellingPoint[];
    profile?: EcommerceProductProfile;
};

/** 汇总检查。生成前跑一次，把问题摊在用户面前。 */
export function checkEcommerceCompliance(input: EcommerceComplianceInput): EcommerceComplianceIssue[] {
    return [
        ...checkEcommerceCopy(input.copy),
        ...checkEcommerceSellingPoints(input.sellingPoints),
        ...checkEcommerceProfile(input.profile),
    ];
}

/** 有没有硬拦项——有就不该直接生成。 */
export function ecommerceComplianceBlocked(issues: EcommerceComplianceIssue[]) {
    return issues.some((issue) => issue.level === "block");
}
