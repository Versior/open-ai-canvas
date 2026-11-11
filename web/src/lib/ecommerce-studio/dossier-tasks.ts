import { jsonrepair } from "jsonrepair";
import { checkEcommerceText, type EcommerceComplianceIssue } from "@/lib/ecommerce/ecommerce-compliance";
import { STUDIO_FAMILY_LABEL, STUDIO_VIEW_LABEL, studioFactUsable, type StudioCategoryFamily, type StudioCopy, type StudioDossier, type StudioEvidence, type StudioFact, type StudioFactGroup, type StudioPhoto, type StudioSellingPoint } from "./types";

/**
 * 表单上的「识别商品自动填写」：一次看图同时建档（事实带证据等级）、提炼品牌和类型、写主标题与卖点。
 * 系统提示词由服务端按「商品档案」能力注入（管理员可在后台改写）；这里只写当前任务和输出结构。
 */
export const STUDIO_DOSSIER_CAPABILITY = "dossier";
const FAMILIES = Object.keys(STUDIO_FAMILY_LABEL) as StudioCategoryFamily[];
const GROUPS: StudioFactGroup[] = ["identity", "appearance", "material", "structure", "text", "spec", "usage", "package"];
const MAX_FACTS = 40;
const MAX_POINTS = 6;

export type StudioIdFactory = () => string;

export type StudioKnowledgeContext = { platform?: string; category?: string; productName?: string };
/**
 * 生图台分析任务的标记。服务端按平台、商品类型和名称检索电商知识库（与电商 Agent 共用）：
 * 商品档案拿写卖点和文案的方法，详情页策划（capability 传 detail-plan）再拿详情页、版式、摄影和场景方法。
 */
export function studioAnalysisMetadata(productId: string, step: "recognize" | "copy" | "ask" | "directions" | "plan", context: StudioKnowledgeContext = {}, capability: string = STUDIO_DOSSIER_CAPABILITY) {
    const category = context.category?.trim().slice(0, 60);
    const productName = context.productName?.trim().slice(0, 120);
    return {
        source: "ecommerce-studio",
        studioProductId: productId,
        studioStep: step,
        ...(context.platform ? { studioPlatform: context.platform } : {}),
        ...(category ? { studioCategory: category } : {}),
        ...(productName ? { studioProductName: productName } : {}),
        ecommerceCapability: capability,
        ecommerceAnalysisFlow: `cap:${capability}`,
    };
}

/** 从模型回复里取出 JSON 对象：容忍代码块、前后说明文字和轻微的格式错误。 */
export function extractStudioJson(text: string): Record<string, unknown> {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型没有返回可读取的结果，请重试或换一个模型");
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonrepair(cleaned.slice(start, end + 1)));
    } catch {
        throw new Error("模型返回的结果格式不完整，请重试");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型返回的结果格式不完整，请重试");
    return parsed as Record<string, unknown>;
}

function text(value: unknown, max = 400) {
    // 模型偶尔用 <br/> 分行：换成空格，免得标签写进卖点和文案。
    return typeof value === "string"
        ? value
              .replace(/<br\s*\/?>/gi, " ")
              .replace(/<\/?[a-z][^>]*>/gi, "")
              .trim()
              .slice(0, max)
        : "";
}

function list(value: unknown, max = 12, length = 200) {
    return Array.isArray(value)
        ? value
              .map((item) => text(item, length))
              .filter(Boolean)
              .slice(0, max)
        : [];
}

function evidenceOf(value: unknown): StudioEvidence {
    if (value === "visible") return "visible";
    if (value === "inferred") return "inferred";
    if (value === "confirmed") return "confirmed";
    return "pending";
}

export function buildRecognitionPrompt(input: { photos: Pick<StudioPhoto, "view">[]; platformName: string; sellerNotes?: string }) {
    const manifest = input.photos.map((photo, index) => `图${index + 1}：${STUDIO_VIEW_LABEL[photo.view]}${photo.view === "tag" ? "（读取吊牌文字）" : ""}`).join("；");
    return [
        "识别随附商品图里的这件商品，建立商品档案。",
        `附图顺序：${manifest || "无"}。`,
        `目标平台：${input.platformName}（只用来判断哪些信息重要，不要写平台规则）。`,
        input.sellerNotes?.trim() ? `卖家补充（可当作已确认事实）：${input.sellerNotes.trim()}` : "卖家补充：无。",
        "",
        "逐项读取：品类；颜色（写名称，能判断时附近似色值 #RRGGBB）；形状与结构部件；材质；刻字、印字或标签原文（逐字照抄，看不清就放进 questions）；尺寸、容量、重量等参数；可见细节；包装与配件。",
        "每条信息标注 evidence：visible 表示图上直接可见或从吊牌、包装文字直接读出；inferred 表示根据外观推测，需要卖家确认；unknown 表示看不清或图片无法提供。",
        "卖家补充里的信息标为 visible 并在 source 写「卖家」。不要编造品牌、参数、成分、认证、功效和价格。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        `{"name":"简短的商品称呼","category":"品类，如 保温杯","family":"${FAMILIES.join("|")}","summary":"一句话说清这是什么","facts":[{"group":"${GROUPS.join("|")}","label":"颜色","value":"哑光雾蓝 #6F8CA6","evidence":"visible","source":"图1"}],"invariants":["出图时绝不能改动的外观要点"],"questions":["需要卖家确认的问题"]}`,
    ].join("\n");
}

export function parseRecognition(raw: string, createId: StudioIdFactory, recognizedWith?: string): StudioDossier {
    const data = extractStudioJson(raw);
    const facts: StudioFact[] = (Array.isArray(data.facts) ? data.facts : [])
        .map((item): StudioFact | undefined => {
            if (!item || typeof item !== "object") return undefined;
            const record = item as Record<string, unknown>;
            const label = text(record.label, 40);
            const value = text(record.value, 240);
            if (!label || !value) return undefined;
            const group = GROUPS.includes(record.group as StudioFactGroup) ? (record.group as StudioFactGroup) : "appearance";
            return { id: createId(), group, label, value, evidence: evidenceOf(record.evidence), source: text(record.source, 40) || undefined };
        })
        .filter((fact): fact is StudioFact => Boolean(fact))
        .slice(0, MAX_FACTS);
    const category = text(data.category, 40);
    const name = text(data.name, 60) || category;
    if (!name && !facts.length) throw new Error("模型没有识别出商品信息，请换一张更清晰的正面图再试");
    const family = FAMILIES.includes(data.family as StudioCategoryFamily) ? (data.family as StudioCategoryFamily) : "generic";
    return {
        name,
        category,
        family,
        summary: text(data.summary, 120),
        facts,
        invariants: list(data.invariants, 10, 120),
        questions: list(data.questions, 10, 120),
        recognizedAt: new Date().toISOString(),
        ...(recognizedWith ? { recognizedWith } : {}),
    };
}

/** 表单上的「识别商品」：一次看图同时建档、提炼品牌和类型、写主标题与卖点，结果填回表单。 */
export function buildFillPrompt(input: { photos: Pick<StudioPhoto, "view">[]; platformName: string; sellerNotes?: string; brand?: string; productType?: string; title?: string }) {
    const known = [
        input.brand?.trim() ? `品牌：${input.brand.trim()}` : "",
        input.productType?.trim() ? `商品类型：${input.productType.trim()}` : "",
        input.title?.trim() ? `主标题：${input.title.trim()}` : "",
        input.sellerNotes?.trim() ? `商品信息：${input.sellerNotes.trim()}` : "",
    ].filter(Boolean);
    return [
        buildRecognitionPrompt({ photos: input.photos, platformName: input.platformName, sellerNotes: known.join("；") }).split("\n\n只输出")[0],
        "",
        "在档案之外再给出表单要用的内容：brand 是商品上能读出的品牌（读不出就留空，不要猜）；category 用 2–6 个字说清商品类型；title 是一句不超过 12 个字的主标题；points 是 3–5 条卖点，每条 title 不超过 12 个字、detail 不超过 30 个字，facts 写出依据的事实名称（facts 列表里的 label）。",
        "卖点只能建立在图片可见或卖家已提供的信息上；不用「最」「第一」「顶级」「100%」这类极限词，不写功效承诺、价格和促销。",
        "品牌字样、印字、logo、商标和型号是商品的身份，不是买它的理由，不写成卖点；看得见的卖点不够 3 条时少写几条，不拿外观凑数。",
        "",
        "只输出下面这个 JSON，不要任何解释：",
        `{"name":"简短的商品称呼","brand":"","category":"保温杯","family":"${FAMILIES.join("|")}","summary":"一句话说清这是什么","title":"","points":[{"title":"","detail":"","facts":["事实名称"]}],"facts":[{"group":"${GROUPS.join("|")}","label":"颜色","value":"哑光雾蓝 #6F8CA6","evidence":"visible","source":"图1"}],"invariants":["出图时绝不能改动的外观要点"],"questions":["需要卖家确认的问题"]}`,
    ].join("\n");
}

export type StudioFillResult = { dossier: StudioDossier; sellingPoints: StudioSellingPoint[]; brand: string; title: string; issues: EcommerceComplianceIssue[] };

/** 讲品牌字样、印字、logo 和型号的卖点：测试环境的儿童眼镜识别出「品牌字样在镜片」，策划把它做成了一个卖点。 */
const IDENTITY_POINT = /字样|印字|印有|logo|标识|商标|型号|刻字/i;

export function parseFill(raw: string, createId: StudioIdFactory, recognizedWith?: string): StudioFillResult {
    const dossier = parseRecognition(raw, createId, recognizedWith);
    const data = extractStudioJson(raw);
    const byLabel = new Map(dossier.facts.map((fact) => [fact.label.trim(), fact]));
    const sellingPoints: StudioSellingPoint[] = (Array.isArray(data.points) ? data.points : [])
        .map((item): StudioSellingPoint | undefined => {
            if (!item || typeof item !== "object") return undefined;
            const record = item as Record<string, unknown>;
            const title = text(record.title, 24);
            if (!title) return undefined;
            const facts = list(record.facts, 6, 40)
                .map((label) => byLabel.get(label))
                .filter((fact): fact is StudioFact => Boolean(fact));
            // 只依据「文字与标识」类事实，或者标题就在讲字样和型号的，不收成卖点。
            if (IDENTITY_POINT.test(title) || (facts.length && facts.every((fact) => fact.group === "text"))) return undefined;
            // 卖点的证据等级取决于它依据的事实：全部可用才算可用，否则需要卖家确认后再启用。
            const evidence: StudioEvidence = !facts.length ? "pending" : facts.every(studioFactUsable) ? (facts.some((fact) => fact.evidence === "confirmed") ? "confirmed" : "visible") : "inferred";
            return { id: createId(), title, detail: text(record.detail, 60), evidence, factIds: facts.map((fact) => fact.id), enabled: evidence === "visible" || evidence === "confirmed" };
        })
        .filter((point): point is StudioSellingPoint => Boolean(point))
        .slice(0, MAX_POINTS);
    const brandFact = dossier.facts.find((fact) => /^品牌/.test(fact.label.trim()) && studioFactUsable(fact));
    const title = text(data.title, 30);
    const issues = studioCopyIssues(sellingPoints, { headline: title, subhead: "", listingTitle: "", bullets: [] });
    return { dossier, sellingPoints, brand: text(data.brand, 40) || brandFact?.value || "", title, issues };
}

export function studioCopyIssues(points: Pick<StudioSellingPoint, "title" | "detail">[], copy: StudioCopy | undefined) {
    const issues: EcommerceComplianceIssue[] = [];
    if (copy) {
        issues.push(...checkEcommerceText(copy.headline, "主标题"), ...checkEcommerceText(copy.subhead, "副标题"), ...checkEcommerceText(copy.listingTitle, "商品标题"));
        copy.bullets.forEach((bullet, index) => issues.push(...checkEcommerceText(bullet, `要点 ${index + 1}`)));
    }
    points.forEach((point, index) => issues.push(...checkEcommerceText(`${point.title} ${point.detail}`, `卖点 ${index + 1}`)));
    return issues;
}
