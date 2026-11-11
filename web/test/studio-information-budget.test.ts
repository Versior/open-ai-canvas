import { expect, test } from "bun:test";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { buildDetailPlanPrompt } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { normalizeStudioDetailPlan, patchStudioDetailPlanScreen, studioScreenCopyIssue } from "@/lib/ecommerce-studio/detail-plan";
import type { StudioDetailPlan } from "@/lib/ecommerce-studio/types";

const product = createStudioProduct("budget-test");
product.name = "示例水杯";
product.photos = [{ id: "photo", resourceId: "resource", url: "", view: "front", truth: true, addedAt: "2026-11-10" }];
let index = 0;
const shot = { ...createStudioRun(product, () => `budget-${++index}`).shots[0], role: "detail-hero" as const, visual: "杯子主视觉", headline: "方便握持", subline: "可见把手", lines: ["要点一", "要点二", "要点三", "要点四"] };
test("过密首屏在扣费生成前被拦下，参数页允许必要信息", () => {
    expect(() => compileStudioPrompt({ product, shot, model: "gpt-image-2", textMode: "model" })).toThrow("信息过密");
    expect(() => compileStudioPrompt({ product, shot: { ...shot, role: "detail-spec" }, model: "gpt-image-2", textMode: "model" })).not.toThrow();
});
test("生成约束明确单一焦点和阅读尺度，策划连接购买问题与证据", () => {
    const compiled = compileStudioPrompt({ product, shot: { ...shot, lines: ["自然握持"] }, model: "gpt-image-2", textMode: "model" });
    expect(compiled.prompt).toContain("一屏只回答一个购买问题");
    expect(compiled.prompt).toContain("手机宽度");
    const prompt = buildDetailPlanPrompt(product, ["detail-hero", "detail-selling", "detail-scene", "detail-closing"]);
    expect(prompt).toContain("痛点 → 解决方案 → 可验证证据");
});

test("策划编辑与刷新保留超限要点，提示调整而不是静默截断", () => {
    const plan: StudioDetailPlan = {
        id: "plan",
        createdAt: "",
        model: "text",
        summary: "",
        style: "",
        screens: [{ role: "detail-hero", title: "首屏", purpose: "识别", visual: "商品主视觉", layout: "poster", elements: "", eyebrow: "", headline: "握持方便", subline: "可见把手", lines: [], facts: [] }],
    };
    const lines = Array.from({ length: 7 }, (_, index) => `第${index + 1}条用户要点`);
    const edited = patchStudioDetailPlanScreen({ ...product.brief, detailPlan: plan }, 0, { lines });
    expect(edited.detailPlan!.screens[0].lines).toEqual(lines);
    const restored = normalizeStudioDetailPlan(JSON.parse(JSON.stringify(edited.detailPlan)))!;
    expect(restored.screens[0].lines).toEqual(lines);
    expect(studioScreenCopyIssue(restored.screens[0])).toContain("最多 2 条");
});
