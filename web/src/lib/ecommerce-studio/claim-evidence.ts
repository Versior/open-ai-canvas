import { studioCleanNotes } from "./brief";
import { studioAnsweredAsks, studioAskAnswer } from "./plan-prep";
import { studioCopyPair } from "./typography";
import { studioFactUsable, type StudioProduct, type StudioShot } from "./types";

export type StudioClaimSource = { id: string; label: string; text: string; appearanceOnly?: boolean; value?: string };

export function studioClaimSources(product: StudioProduct): StudioClaimSource[] {
    const sources: StudioClaimSource[] = [];
    const add = (id: string, label: string, text: string, appearanceOnly = false, value?: string) => {
        if (text.trim()) sources.push({ id, label, text: text.trim(), appearanceOnly, value });
    };
    for (const fact of product.dossier?.facts || []) if (studioFactUsable(fact)) add(`fact:${fact.id}`, fact.label, `${fact.label} ${fact.value}`, false, fact.value);
    studioCleanNotes(product.sellerNotes)
        .split(/[\n；;]/)
        .forEach((line, index) => {
            const [label, value] = studioCopyPair(line);
            add(`seller:${index + 1}`, label || line, line, false, value || undefined);
        });
    for (const point of product.sellingPoints) if (point.enabled && (point.evidence === "confirmed" || point.evidence === "visible")) add(`point:${point.id}`, point.title, `${point.title} ${point.detail}`, false, point.detail);
    for (const ask of studioAnsweredAsks(product.brief.prep)) {
        const answer = studioAskAnswer(ask);
        const claims = [...normalize(ask.question).matchAll(claimTerms)];
        const confirmsOneClaim = claims.length === 1 && /^(?:是|是的|有|支持|已确认|yes)$/i.test(answer.trim());
        const numericAnswer = /^[\s约大至少最多\d.]+\s*(?:厘米|毫米|公斤|克|小时|毫升|cm|mm|kg|g|h|ml)$/i.test(answer.trim());
        const text = confirmsOneClaim ? `${claims[0][0]}：${answer}` : numericAnswer && !claims.length ? `${ask.question}：${answer}` : answer;
        add(`answer:${ask.id}`, ask.question, text);
    }
    for (const [index, text] of (product.dossier?.invariants || []).entries()) add(`appearance:${index + 1}`, text, text, true);
    add("product:name", "商品名称", product.name, true);
    add("product:title", "主标题", product.copy?.headline || "", true);
    return sources;
}

const compact = (value: string) =>
    value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s，,。；;：:｜|]/g, "");

export function studioEvidenceMatch(sources: StudioClaimSource[], reference: string) {
    const key = compact(reference);
    return sources.find((source) => source.id === reference || (key.length > 1 && (compact(source.label) === key || compact(source.text).includes(key))));
}

const unitGroups: Record<string, string[]> = {
    cm: ["厘米", "公分", "cm"],
    mm: ["毫米", "mm"],
    m: ["米", "m"],
    kg: ["公斤", "千克", "kg"],
    g: ["克", "g"],
    ml: ["毫升", "ml"],
    l: ["升", "l"],
    h: ["小时", "钟头", "hours", "hour", "hrs", "hr", "h"],
    min: ["分钟", "mins", "min"],
    s: ["秒", "seconds", "sec"],
    mah: ["毫安时", "mah"],
    w: ["瓦特", "瓦", "w"],
    pct: ["%"],
    celsius: ["°c", "摄氏度"],
    yuan: ["元"],
    inch: ["英寸", "inches", "inch"],
};
const units = new Map(Object.entries(unitGroups).flatMap(([id, names]) => names.map((name) => [name, id] as const)));
const quantityPattern = new RegExp(`(至少|不少于|不低于|不超过|至多|最多|约|大约|≥|≤|>|<)?\\s*(\\d+(?:\\.\\d+)?(?:\\s*[-~至到–]\\s*\\d+(?:\\.\\d+)?)?)\\s*(${[...units.keys()].sort((a, b) => b.length - a.length).join("|")})(?![a-z])`, "gi");
const metrics: Record<string, [string, RegExp][]> = {
    length: [
        ["高度", /(?:杯|瓶|椅|座|机身|总|净)高(?:度)?|高度|身高|高(?=\s*[:：]?\s*$)/g],
        ["宽度", /宽度|宽(?=\s*[:：]?\s*$)/g],
        ["长度", /长度|长(?=\s*[:：]?\s*$)/g],
        ["直径", /直径|口径/g],
        ["厚度", /厚度|厚(?=\s*[:：]?\s*$)/g],
    ],
    time: [
        ["保温", /保温|保热|热饮/g],
        ["保冷", /保冷|冷饮/g],
        ["续航", /续航|播放时长/g],
        ["待机", /待机/g],
        ["充电", /充电|充满/g],
        ["持妆", /持妆/g],
        ["保湿", /保湿/g],
    ],
    weight: [
        ["承重", /承重|负载|载重/g],
        ["毛重", /毛重|含包装重/g],
        ["重量", /重量|重约|净重|杯重|自重|重(?=\s*[:：]?\s*$)/g],
    ],
    pct: [
        ["抑菌", /抑菌|抗菌/g],
        ["过滤", /过滤/g],
        ["含量", /含量|占比/g],
        ["节能", /节能|省电/g],
    ],
};
const conditions =
    /(?:室温|常温|满电|静置|待机模式|低温|高温|[低中高]档|[低中高]挡|节能模式|标准模式|实验室条件|空载|满载|未开盖|不开盖|密闭|密封条件|不加冰|加冰|\d+(?:\.\d+)?\s*(?:°c|摄氏度))|(?:仅限|仅适用(?:于)?|适用(?:于)?|条件[:：])([^，,。；;\n]{1,18})/gi;
const claimTerms =
    /防蓝光|防滑|防漏|不漏水|防水|防摔|耐摔|抗菌|抑菌|治疗|治愈|防过敏|无毒|食品级|医用级|主动降噪|低延迟|防胀气|持久保温|长效保温|\b(?:waterproof|antibacterial|IPX?\d{1,2})\b|(?:FDA|CE|FCC|RoHS|CCC|3C)\s*(?:认证|certified|approved)|(?:通过|获得)(?:国家|权威|第三方)?(?:认证|检测)/gi;
const caution = /(?:避免|不要|不得|不可|不能|不(?:具备|提供|支持|代表|保证|宣称|承诺|意味着|应|用|写|画|加|编|含)|未(?:核实|确认|提供|经|检测)|没有|无法|并非|不是)[^。；，,;]{0,12}$|不\s*$/;
const englishClaimTokens: [RegExp, string][] = [
    [/\b(?:height|high|tall)\b/g, "高度"],
    [/\b(?:width|wide)\b/g, "宽度"],
    [/\b(?:length|long)\b/g, "长度"],
    [/\bdiameter\b/g, "直径"],
    [/\b(?:thickness|thick)\b/g, "厚度"],
    [/\b(?:heat retention|hot|warm)\b/g, "保温"],
    [/\b(?:cold retention|cold|chilled)\b/g, "保冷"],
    [/\bbattery life\b/g, "续航"],
    [/\bstandby\b/g, "待机"],
    [/\bcharg(?:ing|e)\b/g, "充电"],
    [/\b(?:load capacity|load bearing)\b/g, "承重"],
    [/\b(?:net weight|weighs?|weight)\b/g, "重量"],
    [/\bcapacity\b/g, "容量"],
    [/\broom temperature\b/g, "室温"],
    [/\b(?:sealed|lid closed)\b/g, "密闭"],
    [/\bfully charged\b/g, "满电"],
    [/\b(?:up to|at most|no more than)\b/g, "最多"],
    [/\bat least\b/g, "至少"],
    [/\b(?:approx\.?|approximate(?:ly)?|about)\b/g, "约"],
    [/\b(?:leakproof|leak-proof)\b/g, "防漏"],
    [/\bwaterproof\b/g, "防水"],
    [/\bantibacterial\b/g, "抗菌"],
    [/\b(?:no|not|without)\b/g, "不具备"],
];
const normalize = (text: string) =>
    englishClaimTokens.reduce(
        (value, [pattern, replacement]) => value.replace(pattern, replacement),
        text
            .normalize("NFKC")
            .toLowerCase()
            .replace(/#[\da-f]{3,8}\b/gi, " "),
    );
const scopeTokens = (text: string) =>
    [...text.matchAll(conditions)].map((match) =>
        compact(match[1] || match[0])
            .replace("常温", "室温")
            .replace("不开盖", "未开盖")
            .replace("密封条件", "密闭")
            .replace("挡", "档"),
    );
const sentences = (text: string) =>
    normalize(text)
        .split(/[。；;！!\n]/)
        .map((line) => line.trim())
        .filter(Boolean);
const asserted = (text: string, index: number, length: number) => !caution.test(text.slice(0, index)) && !/^\s*(?:无依据|未经证实|尚未确认|待确认)/.test(text.slice(index + length));
const guard = (word: string) => (/至少|不少于|不低于|≥/.test(word) ? "≥" : /不超过|至多|最多|≤/.test(word) ? "≤" : /约/.test(word) ? "约" : word);

function quantityMetric(unit: string, left: string, right: string) {
    const family = ["cm", "mm", "m", "inch"].includes(unit) ? "length" : ["h", "min", "s"].includes(unit) ? "time" : ["g", "kg"].includes(unit) ? "weight" : unit;
    const candidates = metrics[family] || [];
    let metric = "",
        distance = Infinity;
    for (const [name, pattern] of candidates) {
        for (const match of left.matchAll(pattern)) {
            const gap = left.length - match.index! - match[0].length;
            if (gap <= 12 && gap < distance) {
                metric = name;
                distance = gap;
            }
        }
        for (const match of right.matchAll(pattern))
            if (match.index! <= 2 && match.index! < distance) {
                metric = name;
                distance = match.index!;
            }
    }
    return metric;
}

function quantities(text: string) {
    return [...text.matchAll(quantityPattern)].map((match) => {
        const left =
            text
                .slice(0, match.index)
                .split(/[，,；;、。\n]/)
                .pop() || "";
        const right = text.slice(match.index! + match[0].length).split(/[，,；;、。\n]/)[0];
        const unit = units.get(match[3])!;
        return { raw: match[0].trim(), index: match.index!, value: match[2].replace(/\s/g, "").replace(/[至到~–]/g, "-"), unit, metric: quantityMetric(unit, left, right), guard: guard(match[1] || "") };
    });
}

export type StudioClaimCheck = { refs: string[]; issue?: string };

const specLabels = [
    ["材质", "材料", "用料", "material", "materials"],
    ["颜色", "色彩", "配色", "color", "colour"],
    ["尺寸", "规格尺寸", "dimensions", "size"],
    ["外尺寸", "外部尺寸", "outer dimensions", "external dimensions"],
    ["内尺寸", "内部尺寸", "internal dimensions", "inner dimensions"],
    ["高度", "杯高", "瓶高", "高", "height"],
    ["宽度", "杯宽", "宽", "width"],
    ["长度", "长", "length"],
    ["厚度", "厚", "thickness"],
    ["直径", "口径", "diameter"],
    ["容量", "容积", "capacity", "volume"],
    ["重量", "净重", "weight", "net weight"],
    ["承重", "载重", "load capacity"],
    ["成分", "ingredients", "composition"],
    ["型号", "款号", "model", "model number"],
    ["包装内容", "包装清单", "包装与配件", "package contents"],
    ["配件", "accessories"],
    ["品牌", "brand"],
    ["保温", "保温时长", "保温时间", "heat retention"],
    ["保冷", "保冷时长", "保冷时间", "cold retention"],
    ["续航", "续航时长", "battery life"],
];
const specKeys = new Map(specLabels.flatMap((names) => names.map((name) => [compact(name), names[0]] as const)));
const specToken = (value: string) => compact(value).replace(/[.!！。]+$/u, "");
const specValue = (value: string) => {
    const translations: [RegExp, string][] = [
        [/\bstainless steel\b/g, "不锈钢"],
        [/\bpure titanium\b/g, "纯钛"],
        [/\bpure cotton\b/g, "纯棉"],
        [/\bcotton\b/g, "棉"],
        [/\bblue\b|蓝色/g, "蓝"],
        [/\bred\b|红色/g, "红"],
        [/\bblack\b|黑色/g, "黑"],
        [/\bwhite\b|白色/g, "白"],
        [/\bgreen\b|绿色/g, "绿"],
    ];
    const canonical = normalize(value).replace(quantityPattern, (_: string, bound: string, number: string, unit: string) => `${guard(bound || "")}${number}${units.get(unit)}`);
    return specToken(translations.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), canonical));
};

function studioSpecEvidence(label: string, value: string, sources: StudioClaimSource[]): StudioClaimCheck {
    if (!label.trim() || !value.trim()) return { refs: [] };
    if (/(?:建议|提示|指南|说明|提醒|注意事项|小贴士|选购前|下单前)|^(?:怎么|怎样|如何|是否|先看|先量)|\b(?:advice|tips?|notes?|how to|before buying)\b/i.test(label.trim())) return { refs: [] };
    const labelKey = compact(label);
    const canonical = specKeys.get(labelKey) || labelKey;
    const candidates = sources.filter((source) => !source.appearanceOnly && (specKeys.get(compact(source.label)) || compact(source.label)) === canonical);
    const wanted = specValue(value);
    const match = candidates.find((source) => {
        const original = source.value || (compact(source.text).startsWith(compact(source.label)) ? source.text.slice(source.label.length).replace(/^[\s｜|：:]+/, "") : "");
        return original && specValue(original) === wanted;
    });
    if (match) return { refs: [match.id] };
    const terms = specLabels.find((names) => names[0] === canonical) || [label];
    const explicit = sources.find(
        (source) =>
            !source.appearanceOnly &&
            source.text.split(/[\n，,；;。]/).some((part) =>
                terms.some((term) => {
                    const clause = part.trim();
                    if (!clause.toLowerCase().startsWith(term.toLowerCase())) return false;
                    const remainder = clause.slice(term.length).replace(/^[\s为是｜|：:]+/, "");
                    return remainder && specValue(remainder) === wanted;
                }),
            ),
    );
    if (explicit) return { refs: [explicit.id] };
    return { refs: [], issue: `规格「${label}｜${value}」与商品资料中的同一项目及取值不符或缺少依据，请补充已确认的原文` };
}

export function studioSpecRowIssue(label: string, value: string, sources: StudioClaimSource[]): string | undefined {
    return studioSpecEvidence(label, value, sources).issue;
}

export function studioSpecLineCheck(line: string, sources: StudioClaimSource[]): StudioClaimCheck {
    const [label, value] = studioCopyPair(line);
    return studioSpecEvidence(label, value, sources);
}

export function checkStudioClaim(value: string, sources: StudioClaimSource[], blueprint = false): StudioClaimCheck {
    const refs = new Set<string>();
    for (const sentence of sentences(value)) {
        const tokens = scopeTokens(sentence);
        const sourceFor = (test: (line: string) => boolean) =>
            sources.find(
                (source) =>
                    !source.appearanceOnly &&
                    sentences(source.text).some((line) => {
                        if (!test(line)) return false;
                        const verified = scopeTokens(line);
                        return verified.every((token) => tokens.includes(token) || compact(sentence).includes(token)) && tokens.every((token) => verified.includes(token) || compact(line).includes(token));
                    }),
            );
        for (const match of sentence.matchAll(claimTerms)) {
            if (!asserted(sentence, match.index!, match[0].length)) continue;
            const source = sourceFor((line) => [...line.matchAll(claimTerms)].some((term) => term[0] === match[0] && asserted(line, term.index!, term[0].length)));
            if (!source) return { refs: [...refs], issue: `「${match[0]}」没有对应的商品依据或适用条件` };
            refs.add(source.id);
        }
        const amounts = quantities(sentence);
        for (const amount of amounts) {
            if (!asserted(sentence, amount.index, amount.raw.length)) continue;
            if (blueprint && !amount.metric && !/容量|毫升|续航|克重|规格|参数|净重|额定|售价|温度|商品实测/.test(sentence)) continue;
            const source = sourceFor((line) =>
                quantities(line).some((entry) => asserted(line, entry.index, entry.raw.length) && entry.value === amount.value && entry.unit === amount.unit && (!amount.metric || entry.metric === amount.metric) && entry.guard === amount.guard),
            );
            if (!source) return { refs: [...refs], issue: `「${amount.metric}${amount.raw}」缺少同指标、数值、单位及条件的商品依据` };
            refs.add(source.id);
        }
        if (blueprint) continue;
        const rest = sentence.replace(quantityPattern, " ");
        for (const match of rest.matchAll(/[a-z]*\d+(?:\.\d+)?[a-z]*/gi)) {
            const token = match[0];
            if (/^\d/.test(token) && /(?:保温|保冷|续航|承重|重量|高度|宽度|长度|容量|厚度|直径)[ :：约达为]*(?:≥|≤)?\s*$/.test(rest.slice(0, match.index))) return { refs: [...refs], issue: `「${token}」缺少可核对的指标单位` };
            const source = sources.find((entry) => [...normalize(entry.text).matchAll(/[a-z]*\d+(?:\.\d+)?[a-z]*/gi)].some((number) => number[0] === token));
            if (!source) return { refs: [...refs], issue: `「${token}」没有可核对的原文依据` };
            refs.add(source.id);
        }
    }
    return { refs: [...refs] };
}

export function studioShotClaimIssue(product: StudioProduct, shot: StudioShot, withCopy: boolean) {
    const sources = studioClaimSources(product);
    if (withCopy && (shot.layout === "spec" || shot.role === "detail-spec" || shot.role === "detail-size")) {
        for (const line of shot.lines) {
            const issue = studioSpecLineCheck(line, sources).issue;
            if (issue) return issue;
        }
    }
    const fields: [string, string, boolean][] = [
        ["主标题", shot.headline, false],
        ["副标题", shot.subline, false],
        ["要点", shot.lines.join("\n"), false],
        ["栏目", shot.eyebrow || "", false],
        [
            "画面",
            (shot.visual || "")
                .split("\n")
                .filter((line) => !/^(内容版式|本屏构图|本屏依据主题)/.test(line))
                .join("\n"),
            true,
        ],
        ["调整", shot.adjust || "", true],
    ];
    for (const [label, value, blueprint] of fields) {
        if (!blueprint && !withCopy) continue;
        const { issue } = checkStudioClaim(value, sources, blueprint);
        if (issue) return `${label}：${issue}`;
    }
}

export function supportedStudioDescription(value: string, sources: StudioClaimSource[]) {
    return value
        .split(/(?<=[。；;！？])|\n/)
        .filter((sentence) => !checkStudioClaim(sentence, sources, true).issue)
        .join("")
        .trim();
}
