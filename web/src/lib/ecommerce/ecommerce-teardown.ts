/**
 * 竞品拆解——把别人的详情页拆成一张可执行的大纲。
 *
 * 这一块是调研里最清楚的断层：头部工具（美图、稿定、创客贴、Canva）全都只做到
 * 「风格复刻」——像素级迁移，输出的还是一张图。而运营真正要的是**结构**：
 * 竞品第一屏讲什么、卖点按什么顺序排、信任背书放在第几屏、用了什么证据类型。
 * 目前只有智策师、青虎这类小工具在做，且都是新品。
 *
 * 拆解和复刻的区别：
 * - 复刻看的是「长什么样」，输出是一张图
 * - 拆解看的是「怎么说服人」，输出是一份大纲——**可以再变成自己的交付物**
 *
 * 所以拆解节点的产出不是图，是结构：结论 + 我方大纲。大纲能一键铺成拍摄清单。
 */
import { canvasBatchInputToken } from "@/lib/canvas/canvas-batch-input-signature";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import type { EcommerceSuiteRow } from "./ecommerce-suite";

/** 拆解维度。取自行业里的「五个维度」方法论，加上证据与信任两块。 */
export type EcommerceTeardownDimension =
    | "structure"
    | "sellingOrder"
    | "evidence"
    | "trust"
    | "layout"
    | "palette";

export const ECOMMERCE_TEARDOWN_DIMENSIONS: { id: EcommerceTeardownDimension; label: string; hint: string; ask: string }[] = [
    { id: "structure", label: "页面结构", hint: "分几屏、每屏解决什么", ask: "这个详情页分了几屏？每一屏分别在解决什么问题？按顺序列出来。" },
    { id: "sellingOrder", label: "卖点顺序", hint: "先讲什么后讲什么", ask: "卖点按什么顺序出现？最强的卖点放在第几屏？为什么这样排？" },
    { id: "evidence", label: "证据类型", hint: "用什么证明自己", ask: "每个卖点用了什么证据来支撑？（检测报告/实测数据/对比图/用户评价/工艺展示）" },
    { id: "trust", label: "信任模块", hint: "背书、认证、售后", ask: "信任背书出现在哪些位置？用了什么形式？（认证标识/销量数据/品牌故事/售后承诺）" },
    { id: "layout", label: "版式层级", hint: "标题正文图的关系", ask: "标题、正文、图片的层级关系是怎样的？文字块在画面里的位置与占比？" },
    { id: "palette", label: "配色体系", hint: "主色与对比关系", ask: "主色是什么？商品与背景的对比关系如何？有没有贯穿全页的色彩线索？" },
];

/** 一条拆解结论。 */
export type EcommerceTeardownFinding = {
    id: string;
    dimension: EcommerceTeardownDimension;
    /** 拆出来的结论。 */
    finding: string;
};

/** 我方大纲的一行——这是拆解真正要产出的东西。 */
export type EcommerceTeardownOutlineRow = {
    id: string;
    /** 这一屏叫什么。 */
    title: string;
    /** 这一屏解决什么、放什么内容。 */
    brief: string;
    /** 这一屏抄结构还是反着来。 */
    stance: "follow" | "differentiate";
};

export type EcommerceTeardown = {
    name: string;
    /** 勾选的拆解维度。 */
    dimensions: EcommerceTeardownDimension[];
    findings: EcommerceTeardownFinding[];
    outline: EcommerceTeardownOutlineRow[];
};

export type EcommerceTeardownPlan = {
    findings: Array<Omit<EcommerceTeardownFinding, "id">>;
    outline: Array<Omit<EcommerceTeardownOutlineRow, "id">>;
};

export type EcommerceTeardownDraft = Pick<EcommerceTeardown, "findings" | "outline"> & { sourceSignature: string };

export const ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE = "详情页复刻方案";

const ECOMMERCE_TEARDOWN_PLAN_REQUEST_PREFIX = "<!-- yingce:ecommerce-teardown-plan:";
const ECOMMERCE_TEARDOWN_PLAN_MAX_FINDINGS = 30;
const ECOMMERCE_TEARDOWN_PLAN_MAX_SCREENS = 30;
const ECOMMERCE_TEARDOWN_PLAN_MAX_TITLE_LENGTH = 120;
const ECOMMERCE_TEARDOWN_PLAN_MAX_TEXT_LENGTH = 1000;
const ecommerceTeardownDimensionIds = new Set<EcommerceTeardownDimension>(ECOMMERCE_TEARDOWN_DIMENSIONS.map((item) => item.id));

export function ecommerceTeardownPlanRequest(targetNodeId: string, prompt: string) {
    return `${ECOMMERCE_TEARDOWN_PLAN_REQUEST_PREFIX}${encodeURIComponent(targetNodeId)} -->\n${prompt.trim()}`;
}

export function parseEcommerceTeardownPlanRequest(value: string | undefined) {
    if (!value?.startsWith(ECOMMERCE_TEARDOWN_PLAN_REQUEST_PREFIX)) return undefined;
    const end = value.indexOf(" -->\n");
    if (end < 0) return undefined;
    try {
        const targetNodeId = decodeURIComponent(value.slice(ECOMMERCE_TEARDOWN_PLAN_REQUEST_PREFIX.length, end)).trim();
        const prompt = value.slice(end + 5).trim();
        return targetNodeId && prompt ? { targetNodeId, prompt } : undefined;
    } catch {
        return undefined;
    }
}

function ecommerceTeardownPlanText(value: unknown, maxLength: number) {
    if (typeof value !== "string") return undefined;
    const text = value.trim();
    return text && text.length <= maxLength ? text : undefined;
}

/** Accept only a complete bounded plan so partial model output never replaces user edits. */
export function parseEcommerceTeardownPlan(value: string | undefined, selectedDimensions: EcommerceTeardownDimension[]): EcommerceTeardownPlan | undefined {
    const selected = new Set(selectedDimensions);
    if (!selectedDimensions.length || selected.size !== selectedDimensions.length) return undefined;
    const source = value?.trim();
    if (!source) return undefined;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
        const raw = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.findings) || !Array.isArray(raw.outline)) return undefined;
        if (raw.findings.length > ECOMMERCE_TEARDOWN_PLAN_MAX_FINDINGS || raw.outline.length > ECOMMERCE_TEARDOWN_PLAN_MAX_SCREENS || (!raw.findings.length && !raw.outline.length)) return undefined;
        const findings = raw.findings.map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
            const finding = item as Record<string, unknown>;
            const dimension = finding.dimension;
            const text = ecommerceTeardownPlanText(finding.finding, ECOMMERCE_TEARDOWN_PLAN_MAX_TEXT_LENGTH);
            return typeof dimension === "string" && ecommerceTeardownDimensionIds.has(dimension as EcommerceTeardownDimension) && text
                ? { dimension: dimension as EcommerceTeardownDimension, finding: text }
                : undefined;
        });
        const outline = raw.outline.map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
            const row = item as Record<string, unknown>;
            const title = ecommerceTeardownPlanText(row.title, ECOMMERCE_TEARDOWN_PLAN_MAX_TITLE_LENGTH);
            const brief = ecommerceTeardownPlanText(row.brief, ECOMMERCE_TEARDOWN_PLAN_MAX_TEXT_LENGTH);
            const stance = row.stance;
            return title && brief && (stance === "follow" || stance === "differentiate") ? { title, brief, stance } : undefined;
        });
        if (findings.some((item) => !item) || outline.some((item) => !item)) return undefined;
        const findingDimensions = findings.map((item) => item!.dimension);
        if (findingDimensions.some((dimension) => !selected.has(dimension)) || new Set(findingDimensions).size !== findingDimensions.length || findingDimensions.length !== selected.size) return undefined;
        return { findings: findings as EcommerceTeardownPlan["findings"], outline: outline as EcommerceTeardownPlan["outline"] };
    } catch {
        return undefined;
    }
}

/** Create an editable proposal; applying it remains a separate explicit action. */
export function createEcommerceTeardownDraft(plan: EcommerceTeardownPlan, sourceSignature: string): EcommerceTeardownDraft {
    const draftToken = canvasBatchInputToken("teardown-draft", JSON.stringify([sourceSignature, plan]));
    return {
        sourceSignature,
        findings: plan.findings.map((finding, index) => ({ ...finding, id: `${draftToken}:finding:${index + 1}` })),
        outline: plan.outline.map((row, index) => ({ ...row, id: `${draftToken}:row:${index + 1}` })),
    };
}

export function applyEcommerceTeardownDraft(teardown: EcommerceTeardown, draft: EcommerceTeardownDraft): EcommerceTeardown {
    return {
        ...teardown,
        findings: draft.findings.map((finding) => ({ ...finding })),
        outline: draft.outline.map((row) => ({ ...row })),
    };
}

function canvasMediaSignatureToken(node: CanvasNodeData | undefined) {
    if (!node) return "";
    const metadata = node.metadata;
    const identity = metadata?.currentMediaVersionId || metadata?.assetId || metadata?.taskId || metadata?.storageKey || metadata?.content || "";
    return identity ? canvasBatchInputToken(node.id, identity) : node.id;
}

/** Fingerprint plan inputs without retaining media URLs, access tokens, data URLs or bytes. */
export function ecommerceTeardownPlanSourceSignature(input: { target: CanvasNodeData; referenceImage?: CanvasNodeData; product?: CanvasNodeData }) {
    const dimensions = input.target.metadata?.ecommerceTeardown?.dimensions || createEcommerceTeardown(input.target.title).dimensions;
    const profile = input.product?.metadata?.productProfile;
    const profileToken = profile
        ? canvasBatchInputToken(input.product!.id, JSON.stringify([profile.name, profile.category, profile.appearance, profile.marks, profile.forbidden, profile.audience, profile.facts, profile.price]))
        : "";
    return JSON.stringify([input.target.id, [...new Set(dimensions)].sort(), canvasMediaSignatureToken(input.referenceImage), input.product?.id || "", profileToken]);
}

export function ecommerceTeardownOutlineToSuiteRows(
    outline: ReadonlyArray<Pick<EcommerceTeardownOutlineRow, "title" | "brief" | "stance">>,
): Array<EcommerceSuiteRow & { stance: EcommerceTeardownOutlineRow["stance"] }> {
    return outline.slice(0, ECOMMERCE_TEARDOWN_PLAN_MAX_SCREENS).map((row, index) => ({
        slotId: `detail-${index + 1}`,
        enabled: true,
        title: row.title.trim(),
        duty: row.stance === "differentiate" ? `差异化处理，不照搬竞品结构：${row.brief.trim()}` : row.brief.trim(),
        prompt: "",
        stance: row.stance,
    }));
}

export function createEcommerceTeardownFinding(dimension: EcommerceTeardownDimension = "structure", finding = ""): EcommerceTeardownFinding {
    return { id: `finding-${Math.random().toString(36).slice(2, 10)}`, dimension, finding };
}

export function createEcommerceTeardownOutlineRow(title = "", brief = ""): EcommerceTeardownOutlineRow {
    return { id: `row-${Math.random().toString(36).slice(2, 10)}`, title, brief, stance: "follow" };
}

export function createEcommerceTeardown(name = "未命名拆解"): EcommerceTeardown {
    return { name, dimensions: ECOMMERCE_TEARDOWN_DIMENSIONS.map((dimension) => dimension.id), findings: [], outline: [] };
}

export function ecommerceTeardownReady(teardown: EcommerceTeardown | undefined) {
    if (!teardown) return false;
    return teardown.findings.some((finding) => finding.finding.trim()) || teardown.outline.some((row) => row.title.trim());
}

export function ecommerceTeardownDimensionLabel(dimension: EcommerceTeardownDimension) {
    return ECOMMERCE_TEARDOWN_DIMENSIONS.find((item) => item.id === dimension)?.label || dimension;
}

/**
 * 拆解指令。
 *
 * 交给视觉模型读竞品图，按勾选的维度逐条输出。刻意要求「只描述结构，不要复述文案」——
 * 复述竞品原文会把别人的文案带进我们的提示词，那是抄袭。
 *
 * 维度随严格 JSON 一起返回，模型结论才能被逐条对回维度；完整校验后先成为草稿，
 * 只有用户明确采用时才覆盖当前可编辑内容。
 */
export function buildEcommerceTeardownPlanPrompt(teardown: EcommerceTeardown) {
    const asks = ECOMMERCE_TEARDOWN_DIMENSIONS
        .filter((dimension) => teardown.dimensions.includes(dimension.id))
        .map((dimension) => `- ${dimension.label}：${dimension.ask}`);
    return [
        "请分析这张电商详情页/主图，只拆解它的**结构**，不要复述它的文案。",
        "按以下维度提炼 findings：",
        ...asks,
        "再为我们的商品给出可编辑的页面 outline；不要抄它的文案原文，只描述每屏任务。",
        "只输出一个 JSON 对象，不要 Markdown 解释。字段必须完整：",
        '{"findings":[{"dimension":"structure","finding":"结构结论"}],"outline":[{"title":"屏标题","brief":"这一屏解决什么","stance":"follow"}]}',
        `dimension 只能是 ${ECOMMERCE_TEARDOWN_DIMENSIONS.map((item) => item.id).join(" / ")}。`,
        "stance 只能是 follow / differentiate；outline 最多 30 屏。",
    ].join("\n");
}

export function buildEcommerceTeardownPrompt(teardown: EcommerceTeardown) {
    return buildEcommerceTeardownPlanPrompt(teardown);
}
/**
 * 把拆解结论编译成给生成链路的约束。
 *
 * 只输出「跟随」的行——标了「差异化」的行是刻意要和竞品反着来的，
 * 写进提示词会把竞品结构又搬回来。
 */
export function ecommerceTeardownBlock(teardown: EcommerceTeardown | undefined) {
    if (!ecommerceTeardownReady(teardown)) return "";
    const teardownValue = teardown!;
    const lines: string[] = [];
    const findings = teardownValue.findings.filter((finding) => finding.finding.trim());
    if (findings.length) {
        lines.push("竞品结构（只作参考，不要照搬它的文案）：");
        for (const finding of findings) lines.push(`- ${ecommerceTeardownDimensionLabel(finding.dimension)}：${finding.finding.trim()}`);
    }
    const follow = teardownValue.outline.filter((row) => row.title.trim() && row.stance === "follow");
    if (follow.length) {
        lines.push("本套图的页面顺序：");
        follow.forEach((row, index) => lines.push(`${index + 1}. ${row.title.trim()}：${row.brief.trim() || "（未写说明）"}`));
    }
    if (!lines.length) return "";
    return [`【竞品参考】${teardownValue.name.trim() || "未命名拆解"}`, ...lines].join("\n");
}

/** 拆解节点的上游竞品图。 */
export function ecommerceTeardownSourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const fromIds = connections.filter((connection) => connection.toNodeId === nodeId && connection.relation !== "batch-output").map((connection) => connection.fromNodeId);
    return nodes.find((node) => fromIds.includes(node.id) && node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey));
}
