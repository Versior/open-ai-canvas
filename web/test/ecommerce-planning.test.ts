import { expect, test } from "bun:test";
import { DEFAULT_ECOMMERCE_BRIEF, ECOMMERCE_IMAGE_TYPES, patchEcommerceWorkbenchBrief, ecommerceWorkbenchPrompt, parseEcommerceWorkbenchPlan, validateEcommercePlanningCount } from "../src/lib/ecommerce/ecommerce-capabilities";

test("each selected image type gets a shot without shrinking a manually chosen total", () => {
    const brief = { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Cup" };
    const selected = ECOMMERCE_IMAGE_TYPES.slice(0, 7).map(([, label]) => label);
    const updated = patchEcommerceWorkbenchBrief(brief, { imageTypes: selected });
    expect(updated.count).toBe(7);
    expect(patchEcommerceWorkbenchBrief(updated, { count: 3 }).count).toBe(7);
    expect(patchEcommerceWorkbenchBrief(updated, { imageTypes: selected.slice(0, 2) }).count).toBe(7);
    expect(patchEcommerceWorkbenchBrief({ ...updated, count: 12 }, { imageTypes: selected }).count).toBe(12);
    expect(() => validateEcommercePlanningCount({ ...updated, count: 5 })).toThrow("图型");
    expect(ecommerceWorkbenchPrompt("planning", updated)).toContain("每个已选图型至少一张");
});

test("planning accepts unescaped quoted copy without losing the actual prompt", () => {
    const raw = '{"name":"商品","style":"暖白影棚","shots":[{"title":"场景","duty":"展示使用","prompt":"道具不得产生"随附配件"的联想，保留商品结构。"}]}';
    expect(parseEcommerceWorkbenchPlan(raw).shots[0].prompt).toBe('道具不得产生"随附配件"的联想，保留商品结构。');
});

test("planning rejects truncated documents and incomplete generation prompts", () => {
    expect(() => parseEcommerceWorkbenchPlan('{"name":"商品","style":"白底","shots":[{"title":"主图","duty":"展示","prompt":"未完成')).toThrow();
    expect(() => parseEcommerceWorkbenchPlan('{"name":"商品","style":"白底","shots":[{"title":"主图","duty":"展示","prompt":"完整单张但缺少数组和顶层闭合"}')).toThrow();
    expect(() => parseEcommerceWorkbenchPlan(JSON.stringify({ name: "商品", style: "白底", shots: [{ title: "主图", duty: "展示" }] }))).toThrow();
});
