import { expect, test } from "bun:test";
import { DEFAULT_ECOMMERCE_BRIEF, ecommerceWorkbenchPrompt } from "../src/lib/ecommerce/ecommerce-capabilities";
import { DEFAULT_ECOMMERCE_SETTING, parseEcommerceSetting } from "../src/services/api/ecommerce-canvas";
import { ecommercePlatformGuidance } from "../src/lib/ecommerce/ecommerce-platform-guidance";
test("only the selected supported platform guidance enters planning", () => {
    const brief = { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Cup", platform: "Amazon" };
    expect(ecommerceWorkbenchPrompt("planning", brief)).toContain("纯白 #FFFFFF");
    expect(ecommerceWorkbenchPrompt("planning", brief)).toContain("第 2–9 位放场景、卖点、尺寸、细节、对比、包装");
    expect(ecommerceWorkbenchPrompt("planning", brief)).not.toContain("生活场景优先");
    expect(ecommercePlatformGuidance("custom marketplace")).toContain("尚未专属适配");
    for (const platform of ["淘宝", "天猫", "京东", "拼多多", "抖音", "小红书", "Amazon", "亚马逊", "Shopify", "TikTok Shop"]) {
        const guidance = ecommercePlatformGuidance(platform);
        expect(guidance).toContain("硬规则");
        expect(guidance).toContain("创作偏好");
        expect(guidance).toContain("禁止项");
        expect(guidance).toContain("仅用于画面规划");
    }
    expect(ecommercePlatformGuidance("小红书")).not.toBe(ecommercePlatformGuidance("TikTok Shop"));
});
test("builtin templates preserve long categories and enter planning without polluting unrelated tools", () => {
    const template = { id: "builtin", name: "Template", category: "类".repeat(131), flow: "detail" as const, enabled: true, source: "MIT", style: "Shared lighting", shots: [{ title: "Hero", duty: "Full prompt with camera and whitespace" }] };
    expect(parseEcommerceSetting({ ...structuredClone(DEFAULT_ECOMMERCE_SETTING), templates: [template] }).templates[0].category).toBe(template.category);
    const brief = { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Real product", template };
    const prompt = ecommerceWorkbenchPrompt("planning", brief);
    expect(prompt).toContain(template.style);
    expect(prompt).toContain(template.shots[0].duty);
    expect(prompt).toContain("模板属性与示例文案均非当前商品事实");
    expect(ecommerceWorkbenchPrompt("model-cast", brief)).not.toContain("templateReference");
});
