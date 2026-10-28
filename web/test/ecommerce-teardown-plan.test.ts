import { describe, expect, test } from "bun:test";

import {
    ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE,
    applyEcommerceTeardownDraft,
    buildEcommerceTeardownPlanPrompt,
    createEcommerceTeardown,
    createEcommerceTeardownDraft,
    ecommerceTeardownOutlineToSuiteRows,
    ecommerceTeardownPlanRequest,
    ecommerceTeardownPlanSourceSignature,
    parseEcommerceTeardownPlan,
    parseEcommerceTeardownPlanRequest,
    type EcommerceTeardownDimension,
} from "@/lib/ecommerce/ecommerce-teardown";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { reconcileEcommerceSuiteDraftRows } from "@/lib/ecommerce/ecommerce-suite";

const selectedDimensions: EcommerceTeardownDimension[] = ["structure", "evidence"];
const validPlan = JSON.stringify({
    findings: [
        { dimension: "structure", finding: "六屏，由痛点进入证据。" },
        { dimension: "evidence", finding: "第三屏用实测数据支撑。" },
    ],
    outline: [
        { title: "痛点开场", brief: "让目标用户认出自己的问题。", stance: "follow" },
        { title: "反常规证据", brief: "先给实测结果，再解释原理。", stance: "differentiate" },
    ],
});

function target(dimensions: EcommerceTeardownDimension[] = selectedDimensions): CanvasNodeData {
    return {
        id: "teardown-target",
        type: CanvasNodeType.Teardown,
        position: { x: 0, y: 0 },
        metadata: { ecommerceTeardown: { ...createEcommerceTeardown("竞品 A"), dimensions } },
    };
}

function reference(content: string): CanvasNodeData {
    return { id: "reference-image", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { content } };
}

function product(id = "confirmed-product", facts = "净重 210g"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Product,
        position: { x: 0, y: 0 },
        metadata: {
            productProfile: {
                name: "轻量保温杯",
                category: "杯具",
                appearance: "雾白色杯身",
                marks: "YINGCE",
                forbidden: "不得改变杯盖结构",
                audience: "通勤人群",
                facts,
                price: "99 元",
                views: {},
            },
        },
    };
}

describe("ecommerce teardown structured plan", () => {
    test("request markers round-trip the target without leaking into the prompt", () => {
        const value = ecommerceTeardownPlanRequest("teardown/一", "只输出 JSON");
        expect(parseEcommerceTeardownPlanRequest(value)).toEqual({ targetNodeId: "teardown/一", prompt: "只输出 JSON" });
        expect(parseEcommerceTeardownPlanRequest("只输出 JSON")).toBeUndefined();
        expect(ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE).toBe("详情页复刻方案");
    });

    test("the plan prompt asks only for selected dimensions and a bounded JSON contract", () => {
        const prompt = buildEcommerceTeardownPlanPrompt({ ...createEcommerceTeardown("窄拆"), dimensions: ["structure"] });
        expect(prompt).toContain("页面结构");
        expect(prompt).not.toContain("配色体系");
        expect(prompt).toContain('"findings"');
        expect(prompt).toContain('"outline"');
        expect(prompt).toContain("follow / differentiate");
        expect(prompt).toContain("最多 30 屏");
    });

    test("a complete plan is parsed, then drafted without changing the editable teardown", () => {
        const plan = parseEcommerceTeardownPlan(`\n\`\`\`json\n${validPlan}\n\`\`\``, selectedDimensions)!;
        const draft = createEcommerceTeardownDraft(plan, "source-a");
        const current = { ...createEcommerceTeardown("我的方案"), findings: [{ id: "manual", dimension: "trust" as const, finding: "人工结论" }] };
        const applied = applyEcommerceTeardownDraft(current, draft);

        expect(plan.outline[1].stance).toBe("differentiate");
        expect(draft.sourceSignature).toBe("source-a");
        expect(current.findings).toEqual([{ id: "manual", dimension: "trust", finding: "人工结论" }]);
        expect(applied.name).toBe("我的方案");
        expect(applied.findings.map((item) => item.finding)).toEqual(["六屏，由痛点进入证据。", "第三屏用实测数据支撑。"]);
        expect(applied.outline.map((item) => item.title)).toEqual(["痛点开场", "反常规证据"]);
    });

    test("the parser requires exactly one finding for every selected dimension", () => {
        const raw = JSON.parse(validPlan);
        expect(parseEcommerceTeardownPlan(validPlan, selectedDimensions)).toBeDefined();
        expect(parseEcommerceTeardownPlan(validPlan, ["structure"])).toBeUndefined();
        expect(parseEcommerceTeardownPlan(validPlan, ["structure", "structure"])).toBeUndefined();
        expect(parseEcommerceTeardownPlan(JSON.stringify({ ...raw, findings: [raw.findings[0]] }), selectedDimensions)).toBeUndefined();
        expect(parseEcommerceTeardownPlan(JSON.stringify({ ...raw, findings: [raw.findings[0], raw.findings[0]] }), selectedDimensions)).toBeUndefined();
    });

    test("invalid dimensions, stances, oversized text and more than 30 screens are rejected", () => {
        const raw = JSON.parse(validPlan);
        expect(parseEcommerceTeardownPlan(JSON.stringify({ ...raw, findings: [{ dimension: "unknown", finding: "x" }] }), selectedDimensions)).toBeUndefined();
        expect(parseEcommerceTeardownPlan(JSON.stringify({ ...raw, outline: [{ title: "x", brief: "y", stance: "copy" }] }), selectedDimensions)).toBeUndefined();
        expect(parseEcommerceTeardownPlan(JSON.stringify({ ...raw, outline: [{ title: "x".repeat(121), brief: "y", stance: "follow" }] }), selectedDimensions)).toBeUndefined();
        expect(parseEcommerceTeardownPlan(JSON.stringify({ ...raw, outline: Array.from({ length: 31 }, (_, index) => ({ title: `第 ${index + 1} 屏`, brief: "说明", stance: "follow" })) }), selectedDimensions)).toBeUndefined();
        expect(parseEcommerceTeardownPlan('{"findings":[],"outline":[]}', selectedDimensions)).toBeUndefined();
    });

    test("draft IDs are stable for the same result and isolated across different results", () => {
        const plan = parseEcommerceTeardownPlan(validPlan, selectedDimensions)!;
        const first = createEcommerceTeardownDraft(plan, "source-a");
        const repeated = createEcommerceTeardownDraft(plan, "source-a");
        const otherSource = createEcommerceTeardownDraft(plan, "source-b");
        const otherPlan = createEcommerceTeardownDraft({ ...plan, outline: [{ ...plan.outline[0], title: "另一版首屏" }, plan.outline[1]] }, "source-a");

        expect(repeated.findings.map((item) => item.id)).toEqual(first.findings.map((item) => item.id));
        expect(repeated.outline.map((item) => item.id)).toEqual(first.outline.map((item) => item.id));
        expect(otherSource.outline[0].id).not.toBe(first.outline[0].id);
        expect(otherPlan.outline[0].id).not.toBe(first.outline[0].id);
    });

    test("source signatures follow selected dimensions, reference identity and confirmed product facts without retaining raw sensitive inputs", () => {
        const source = reference("https://cdn.example.test/detail.png?token=secret");
        const confirmed = product("confirmed-product", "净重 210g；来源 https://private.test/?token=product-secret；data:raw；blob:raw");
        const signature = ecommerceTeardownPlanSourceSignature({ target: target(), referenceImage: source, product: confirmed });

        expect(signature).not.toContain("https://");
        expect(signature).not.toContain("token");
        expect(signature).not.toContain("secret");
        expect(signature).not.toContain("data:");
        expect(signature).not.toContain("blob:");
        expect(ecommerceTeardownPlanSourceSignature({ target: target(["structure"]), referenceImage: source, product: confirmed })).not.toBe(signature);
        expect(ecommerceTeardownPlanSourceSignature({ target: target(), referenceImage: reference("data:image/png;base64,raw-bytes"), product: confirmed })).not.toBe(signature);
        expect(ecommerceTeardownPlanSourceSignature({ target: target(), referenceImage: source, product: product("confirmed-product", "净重 300g") })).not.toBe(signature);
        expect(ecommerceTeardownPlanSourceSignature({ target: target(), referenceImage: source, product: product("other-product", confirmed.metadata!.productProfile!.facts) })).not.toBe(signature);
        expect(ecommerceTeardownPlanSourceSignature({ target: { ...target(), metadata: { ...target().metadata, model: "other-model" } }, referenceImage: source, product: confirmed })).toBe(signature);
    });

    test("an accepted outline becomes a clean editable suite skeleton that preserves differentiation intent", () => {
        const draft = createEcommerceTeardownDraft(parseEcommerceTeardownPlan(validPlan, selectedDimensions)!, "source-a");
        const outlineWithOldResult = draft.outline.map((row) => ({ ...row, resultNodeId: "old-result", prompt: "old prompt" }));
        const rows = ecommerceTeardownOutlineToSuiteRows(outlineWithOldResult);

        expect(rows).toEqual([
            { slotId: "detail-1", enabled: true, title: "痛点开场", duty: "让目标用户认出自己的问题。", prompt: "", stance: "follow" },
            {
                slotId: "detail-2",
                enabled: true,
                title: "反常规证据",
                duty: "差异化处理，不照搬竞品结构：先给实测结果，再解释原理。",
                prompt: "",
                stance: "differentiate",
            },
        ]);
        expect(rows.some((row) => "resultNodeId" in row)).toBe(false);
    });

    test("suite redrafting preserves teardown stance", () => {
        const previous = [{ slotId: "detail-1", title: "旧标题", duty: "旧职责", prompt: "旧提示", stance: "differentiate" as const }];
        const parsed = [{ slotId: "detail-1", title: "新标题", duty: "新职责", prompt: "新提示" }];

        expect(reconcileEcommerceSuiteDraftRows(previous, parsed)?.[0].stance).toBe("differentiate");
    });
});
