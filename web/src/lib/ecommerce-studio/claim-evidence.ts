import { commerceVisibleObservation } from "@/lib/ecommerce/image-brief-content";
import { studioCleanNotes } from "./brief";
import { studioAnsweredAsks, studioAskAnswer } from "./plan-prep";
import { studioPhotoEvidenceId } from "./reference-selection";
import { studioCopyPair } from "./typography";
import { STUDIO_VIEW_LABEL, studioFactUsable, type StudioFact, type StudioProduct, type StudioShot } from "./types";

export type StudioClaimSource = { id: string; label: string; text: string; appearanceOnly?: boolean; value?: string; sellerConfirmed?: boolean };

export function studioFactSupportsArtwork(fact: StudioFact) {
    return studioFactUsable(fact) && (fact.group !== "package" || fact.evidence === "confirmed");
}

export function studioSellerClaimSources(notes: string): StudioClaimSource[] {
    return studioCleanNotes(notes)
        .split(/[\n；;]/u)
        .flatMap((line, index) => {
            const text = line.trim();
            if (!text) return [];
            const [label, value] = studioCopyPair(text);
            return [{ id: `seller:${index + 1}`, label: label || text, text, value: value || undefined, sellerConfirmed: true }];
        });
}

export function studioClaimSources(product: StudioProduct): StudioClaimSource[] {
    const sources: StudioClaimSource[] = [];
    const add = (source: StudioClaimSource) => {
        if (source.text.trim()) sources.push({ ...source, text: source.text.trim() });
    };
    for (const fact of product.dossier?.facts || []) {
        if (!studioFactSupportsArtwork(fact)) continue;
        const inscription = fact.group === "text" && fact.evidence === "visible";
        const value = fact.evidence === "visible" && !inscription ? commerceVisibleObservation(fact.value).trim() : fact.value;
        if (value) add({ id: `fact:${fact.id}`, label: fact.label, text: `${fact.label} ${value}`, value, sellerConfirmed: fact.evidence === "confirmed", ...(inscription ? { appearanceOnly: true } : {}) });
    }
    sources.push(...studioSellerClaimSources(product.sellerNotes));
    for (const point of product.sellingPoints)
        if (point.enabled && (point.evidence === "confirmed" || point.evidence === "visible")) {
            add({ id: `point:${point.id}`, label: point.title, text: `${point.title} ${point.detail}`, value: point.detail, sellerConfirmed: point.evidence === "confirmed" });
        }
    for (const ask of studioAnsweredAsks(product.brief.prep)) {
        const answer = studioAskAnswer(ask);
        const question = normalize(ask.question);
        const claims = [...question.matchAll(claimTerms)];
        const confirmsOneClaim = claims.length === 1 && /^(?:是|是的|有|支持|已确认|yes)$/i.test(answer.trim());
        const numericAnswer = /^[\s约大至少最多\d.]+\s*(?:厘米|毫米|公斤|克|小时|毫升|cm|mm|kg|g|h|ml)$/i.test(answer.trim());
        const ports = [...question.matchAll(flowPort)];
        const portAnswer =
            ports.length === 1 && partMarkers.some((pattern) => pattern.test(question)) && asserted(question, ports[0].index!, ports[0][0].length) && !/(?:还是|或|哪一|哪边)/u.test(question) && /^(?:是|是的|对|对的|已确认|yes)$/i.test(answer.trim());
        const text = portAnswer ? `${ask.question}：${answer}` : confirmsOneClaim ? `${claims[0][0]}：${answer}` : numericAnswer && !claims.length ? `${ask.question}：${answer}` : answer;
        add({ id: `answer:${ask.id}`, label: ask.question, text, sellerConfirmed: true });
    }
    for (const [index, text] of (product.dossier?.invariants || []).entries()) add({ id: `appearance:${index + 1}`, label: text, text, appearanceOnly: true });
    for (const photo of product.photos) {
        if (!photo.truth || !photo.resourceId || photo.view === "tag") continue;
        const label = `商品实拍（${STUDIO_VIEW_LABEL[photo.view]}）`;
        add({ id: studioPhotoEvidenceId(photo), label, text: label, appearanceOnly: true });
    }
    add({ id: "product:name", label: "商品名称", text: product.name, appearanceOnly: true });
    add({ id: "product:title", label: "主标题", text: product.copy?.headline || "", appearanceOnly: true });
    const confirmed = sources.filter((source) => source.sellerConfirmed);
    return sources.flatMap((source) => {
        if (source.sellerConfirmed || (source.appearanceOnly && source.value !== undefined) || source.id.startsWith("photo:") || source.id.startsWith("product:")) return [source];
        const label = supportedStudioDescription(source.label, confirmed);
        if (source.value !== undefined) {
            const value = supportedStudioDescription(source.value, confirmed);
            if (!value && (!label || source.id.startsWith("fact:"))) return [];
            return [{ ...source, label: label || "可见外观", value, text: [label, value].filter(Boolean).join(" ") }];
        }
        const text = supportedStudioDescription(source.text, confirmed);
        return text ? [{ ...source, label: label || "可见外观", text }] : [];
    });
}

export function studioArtworkFacts(product: StudioProduct, sources = studioClaimSources(product)): StudioFact[] {
    const usable = new Map(sources.map((source) => [source.id, source]));
    return (product.dossier?.facts || []).flatMap((fact) => {
        const source = usable.get(`fact:${fact.id}`);
        return source?.value ? [{ ...fact, label: source.label, value: source.value }] : [];
    });
}

export function studioArtworkMaterials(product: StudioProduct) {
    return studioArtworkFacts(product)
        .filter((fact) => ["material", "appearance", "structure"].includes(fact.group))
        .map((fact) => `${fact.label} ${fact.value}`)
        .join("；");
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
    w: [
        ["峰值功率", /(?:峰值|最大)\s*功率/g],
        ["输入功率", /输入\s*功率/g],
        ["输出功率", /输出\s*功率/g],
        ["功率", /(?:额定\s*)?功率/g],
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
const sellerOnlyClaim = /(?:更|很)?(?:节省|省|不占(?:用)?)(?:收纳)?空间|(?:轻松|快速)(?:吹干|干发)|风力(?:更为?|很)?集中|肉质(?:紧实|鲜嫩|细嫩)|口感(?:鲜美|鲜嫩|嫩滑|香甜|紧实)|新鲜(?!色|感|视角|样式)/u;
const otherEvidenceClaim =
    /防蓝光|防滑|防漏|不漏水|防水|防摔|耐摔|抗菌|抑菌|治疗|治愈|防过敏|无毒|食品级|医用级|主动降噪|低噪(?:音)?|静音运行|低延迟|防胀气|持久保温|长效保温|速干|轻(?:巧|量|盈)便携|稳固耐用|握持(?:更舒适|不挡手)|使用更顺手|出风(?:更|更为)?(?:均匀|集中)|均匀出风|(?:开启|切到|切换至)(?:高|低|冷|热|强|弱)(?:温|风)?[档挡]|多层防护|固定(?:直角|l形)(?:结构|形态|连接|状态)?|(?:无|没有)(?:可见的?)?(?:折叠(?:关节|铰链|转轴)|铰链(?:或折合结构)?)|(?:不是)?折叠款|(?:不能|不可|不支持|无法|不|可|能)(?:折叠|折小)|折叠收纳|(?:手柄|机身|支架|靠背)(?:(?:不能|不可|无法)折)(?![\p{Script=Han}])|\b(?:waterproof|antibacterial|IPX?\d{1,2})\b|(?:FDA|CE|FCC|RoHS|CCC|3C)\s*(?:认证|certified|approved)|(?:通过|获得)(?:国家|权威|第三方)?(?:认证|检测)/u;
const omittedPreparation =
    /(?:无[需须]|不(?:需要|必|用)|不(?:是|一定)必须|并非必须|省去|省掉|省略|跳过|(?<!避|难)免)(?:再|额外|另行|提前|自行|手工|手动|先|做|进行|任何)*(?<prep>切(?:成|为)[\p{Script=Han}]{0,5}?(?:圈|片|丁|段|块|丝|条)|切(?:圈|片|丁|段|块|丝|条|配|开)|(?:清|冲|淘)?洗|去(?:内脏|皮|壳|骨|鳞|刺)|解冻|泡发|浸泡|腌制|焯水|(?:预)?处理(?!背景|图片|照片|图像|文字|字体|图层|素材)|备料)/u;
const claimTerms = new RegExp(`${sellerOnlyClaim.source}|${otherEvidenceClaim.source}|${omittedPreparation.source}`, "giu");
const preparationStep = (step: string) => step.replace(/^切(?:成|为).*(圈|片|丁|段|块|丝|条)$/u, "切$1").replace(/^清洗$/u, "洗");
const packagingInscription = /(?:包装|袋身|瓶身|盒身|标签)(?:上|正面|背面|侧面)?(?:印[有着]|写[有着]|标[有着]|原文[为是:：]?)\s*[「『“"]([^」』”"\n]+)[」』”"]/gu;

function printedClaimSource(sentence: string, index: number, sources: StudioClaimSource[]) {
    const seen = sources.filter((source) => source.appearanceOnly && source.value);
    const field = seen.find((source) => normalize(source.text) === sentence && index >= normalize(source.label).length);
    if (field) return field;
    for (const match of sentence.matchAll(packagingInscription)) {
        const start = match.index! + match[0].indexOf(match[1]);
        if (index >= start && index < start + match[1].length) return seen.find((source) => normalize(source.value!) === match[1]);
    }
}
const caution = /(?:避免|不要|不得|不可|不能|不(?:具备|提供|支持|代表|表示|保证|宣称|承诺|意味着|应|用|写|画|加|编|含)|未(?:核实|确认|提供|经|检测)|没有|无法|并非|不是)[^。；，,;]{0,12}$|不\s*$/;
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
    [/\b(?:rated power|power rating)\b/g, "额定功率"],
    [/\b(?:peak|maximum|max\.?)[ -]+power\b/g, "峰值功率"],
    [/\binput power\b/g, "输入功率"],
    [/\boutput power\b/g, "输出功率"],
    [/\bpower\b/g, "功率"],
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
const flowPort = /[进出][风水气](?:的?[一这]?[端侧面]|口)/gu;
const portRole = (term: string) => `${term.slice(0, 2)}口`;
const partMarkers = [/格栅|网罩|网面|网孔|圆网/u, /扁嘴|扁平|扁口/u, /圆形|圆环|圆孔|圆口|圆网/u, /前[端侧面]|正面/u, /背[侧面]|后[端侧面]|尾端/u, /左[端侧边]/u, /右[端侧边]/u, /上端|顶(?:端|部)/u, /下端|底(?:端|部)/u];
const workingPart = /(?:风[口筒嘴]|喷[口嘴]|管口|端面|格栅|网罩|扁嘴|哪一端)/u;
const aimsAt = /(?:朝[向哪个]|对[着准]|正对|吹向|对位|(?:位于|处在|靠近)(?:[此该哪一]?端的?)?(?:风口|喷嘴|喷口|管口)(?:下方|前方|方向))/u;
const flowTarget = /(?:头发|湿发|长发|发[束根梢丝区]|刘海|后颈|杯[子口中内]|水[盆杯槽])/u;

function flowPortSource(clause: string, port: string, sources: StudioClaimSource[]) {
    const anchors = partMarkers.filter((pattern) => pattern.test(clause));
    return sources.find(
        (source) =>
            source.sellerConfirmed &&
            sentences(source.text).some((sentence) =>
                sentence.split(/[，,；;]/u).some((part) => {
                    const ports = [...part.matchAll(flowPort)];
                    return ports.length > 0 && ports.every((match) => portRole(match[0]) === portRole(port) && asserted(part, match.index!, match[0].length)) && anchors.every((pattern) => pattern.test(part));
                }),
            ),
    );
}

function workingDirectionPort(clause: string) {
    if (!workingPart.test(clause) || !aimsAt.test(clause) || !flowTarget.test(clause)) return;
    return /头发|湿发|长发|发[束根梢丝区]|刘海|后颈|风[筒嘴口]/u.test(clause) ? "出风口" : "出水口";
}

function neutralPortDescription(clause: string, sources: StudioClaimSource[]) {
    const unsupported = [...new Set([...clause.matchAll(flowPort)].map(([term]) => term))].filter((term) => !flowPortSource(normalize(clause), term, sources));
    if (!unsupported.length) return clause;
    if (!/(?:格栅|环圈|网孔|圆环|形状|轮廓|配色|颜色|开口|外沿|圆形|侧面|正面|特写|相对大小|大小关系|比例关系)/u.test(clause) || /(?:对[着准]|正对|朝向|吹向|作用于|送往|流向|对位)/u.test(clause)) return "";
    return unsupported.reduce((text, term) => text.replaceAll(term, term.includes("风") ? "端面" : "开口"), clause);
}
const guard = (word: string) => (/至少|不少于|不低于|≥/.test(word) ? "≥" : /不超过|至多|最多|≤/.test(word) ? "≤" : /约/.test(word) ? "约" : word);

function quantityMetric(unit: string, left: string, right: string) {
    const family = ["cm", "mm", "m", "inch"].includes(unit) ? "length" : ["h", "min", "s"].includes(unit) ? "time" : ["g", "kg"].includes(unit) ? "weight" : unit;
    const candidates = metrics[family] || [];
    let metric = "",
        prefix = "",
        suffix = "",
        distance = Infinity;
    for (const [name, pattern] of candidates) {
        for (const match of left.matchAll(pattern)) {
            const gap = left.length - match.index! - match[0].length;
            if (gap <= 12 && gap < distance) {
                metric = name;
                distance = gap;
                prefix = /^[\s:：为是达约]*$/u.test(left.slice(match.index! + match[0].length)) ? left.slice(match.index!) : "";
                suffix = "";
            }
        }
        for (const match of right.matchAll(pattern))
            if (match.index! <= 2 && match.index! < distance) {
                metric = name;
                distance = match.index!;
                prefix = "";
                suffix = /^\s*$/u.test(right.slice(0, match.index!)) ? right.slice(0, match.index! + match[0].length) : "";
            }
    }
    return { metric, prefix, suffix };
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
        const { metric, prefix, suffix } = quantityMetric(unit, left, right);
        return {
            raw: match[0].trim(),
            matchedText: metric && !prefix && !suffix ? undefined : (prefix + match[0] + suffix).trim(),
            index: match.index!,
            value: match[2].replace(/\s/g, "").replace(/[至到~–]/g, "-"),
            unit,
            metric,
            guard: guard(match[1] || ""),
        };
    });
}

export type StudioClaimCheck = { refs: string[]; issue?: string; matchedText?: string };

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
    ["额定功率", "功率", "rated power", "power rating", "power"],
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

export function checkStudioClaim(value: string, sources: StudioClaimSource[], blueprint = false, checkPrepOmissions = true): StudioClaimCheck {
    const refs = new Set<string>();
    for (const sentence of sentences(value)) {
        const tokens = scopeTokens(sentence);
        const sourceFor = (test: (line: string) => boolean, sellerOnly = false) =>
            sources.find(
                (source) =>
                    !source.appearanceOnly &&
                    (!sellerOnly || source.sellerConfirmed) &&
                    sentences(source.text).some((line) => {
                        if (!test(line)) return false;
                        const verified = scopeTokens(line);
                        return verified.every((token) => tokens.includes(token) || compact(sentence).includes(token)) && tokens.every((token) => verified.includes(token) || compact(line).includes(token));
                    }),
            );
        for (const clause of sentence.split(/[，,]/u)) {
            const implied = workingDirectionPort(clause);
            if (implied) {
                const source = flowPortSource(clause, implied, sources);
                if (!source) return { refs: [...refs], issue: "工作端与作用对象的方向关系没有对应的商品依据" };
                refs.add(source.id);
            }
            for (const match of clause.matchAll(flowPort)) {
                if (!asserted(clause, match.index!, match[0].length)) continue;
                const source = flowPortSource(clause, match[0], sources);
                if (!source) return { refs: [...refs], issue: `「${match[0]}」缺少对应部位的工作方向依据`, matchedText: match[0] };
                refs.add(source.id);
            }
        }
        for (const match of sentence.matchAll(claimTerms)) {
            if (!asserted(sentence, match.index!, match[0].length)) continue;
            const step = match.groups?.prep;
            if (step && !checkPrepOmissions) continue;
            const source =
                (step && printedClaimSource(sentence, match.index!, sources)) ||
                sourceFor((line) => {
                    if (step && /[?？]|待(?:确认|核实)|未(?:经)?(?:确认|核实)|还没(?:确认|核实)/u.test(line)) return false;
                    return [...line.matchAll(claimTerms)].some((term) => (step ? term.groups?.prep && preparationStep(term.groups.prep) === preparationStep(step) : term[0] === match[0]) && asserted(line, term.index!, term[0].length));
                }, true);
            if (!source) return { refs: [...refs], issue: `「${match[0]}」没有对应的商品依据或适用条件`, matchedText: match[0] };
            refs.add(source.id);
        }
        const amounts = quantities(sentence);
        for (const amount of amounts) {
            if (!asserted(sentence, amount.index, amount.raw.length)) continue;
            if (blueprint && !amount.metric && /^\s*(?:留白|画幅|主体占比|镜头|焦距|柔光灯|补光灯)/.test(sentence.slice(amount.index + amount.raw.length))) continue;
            const source = sourceFor((line) =>
                quantities(line).some((entry) => asserted(line, entry.index, entry.raw.length) && entry.value === amount.value && entry.unit === amount.unit && (!amount.metric || entry.metric === amount.metric) && entry.guard === amount.guard),
            );
            if (!source) return { refs: [...refs], issue: `「${amount.metric}${amount.raw}」缺少同指标、数值、单位及条件的商品依据`, matchedText: amount.matchedText };
            refs.add(source.id);
        }
        if (blueprint) continue;
        const rest = sentence.replace(quantityPattern, " ");
        for (const match of rest.matchAll(/[a-z]*\d+(?:\.\d+)?[a-z]*/gi)) {
            const token = match[0];
            if (/^\d/.test(token) && /(?:保温|保冷|续航|承重|重量|高度|宽度|长度|容量|厚度|直径|功率)[ :：约达为]*(?:≥|≤)?\s*$/.test(rest.slice(0, match.index))) return { refs: [...refs], issue: `「${token}」缺少可核对的指标单位` };
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
        const { issue } = checkStudioClaim(value, sources, blueprint, false);
        if (issue) return `${label}：${issue}`;
    }
}

export function supportedStudioDescription(value: string, sources: StudioClaimSource[]) {
    const observed = commerceVisibleObservation(value);
    const description = [...observed.matchAll(flowPort)].length
        ? observed
              .split(/(?<=[。；;！？!?，,])|\n/)
              .map((clause) => neutralPortDescription(clause, sources))
              .join("")
              .replace(/[，,]\s*$/, "")
        : observed;
    const supported = description
        .split(/(?<=[。；;！？!?])|\n/)
        .flatMap((sentence) => {
            if (!checkStudioClaim(sentence, sources, true).issue) return [sentence];
            const clauses = sentence.split(/(?<=[，,])/);
            return clauses
                .filter((clause) => !checkStudioClaim(clause, sources, true).issue)
                .join("")
                .replace(/[，,]\s*$/, "")
                .trim();
        })
        .join("")
        .trim();
    return supported !== observed && /[?？]$/.test(observed.trim()) && /(?:[时后前中]|时候|情况[下中])$/.test(supported) ? "" : supported;
}
