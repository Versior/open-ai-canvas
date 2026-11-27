import { expect, test } from "bun:test";
import { studioImageInput, studioImageInputCount, studioImageReferenceSummary } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { createStudioRun, appendStudioRun } from "@/lib/ecommerce-studio/runs";
import { studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";

function sample(maxImages: number, sameLayout = false, sourceHeight = 9000) {
    const product = createStudioProduct("style-window");
    product.name = "毛巾";
    product.photos = [{ id: "photo", resourceId: "towel", view: "front", truth: true, url: "", addedAt: "" }];
    product.references = [{ id: "style", resourceId: "seller-long-photo", view: "other", truth: false, url: "", addedAt: "", width: 750, height: sourceHeight }];
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 3, sameLayout };
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({ screens: ["外形", "织纹", "收边"].map((value, index) => ({ role: index === 0 ? "detail-hero" : "detail-closeup", purchaseQuestion: `${value}什么样？`, displayContent: `可见的${value}` })) }),
        product,
        studioDetailPlanRoles(product),
        { id: "plan", model: "planner", createdAt: "" },
        { scope: "detail" },
    ).plan;
    let serial = 0;
    const run = createStudioRun(product, () => `window-${++serial}`);
    const image = defaultImageCapabilityConfig("openai-image", "gpt-image-2");
    image.references.maxImages = maxImages;
    const channel = createModelChannel({
        id: "window",
        interfaceType: "openai-image",
        models: ["gpt-image-2"],
        modelCosts: [{ model: "gpt-image-2", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model };
    const inputs = run.shots.map((_, index) => studioImageInput(product, studioLocateRunShot(run, index), model, config));
    return { model, product, run, inputs };
}

test("生成保留商品、原长图与衔接，另取各屏阅读位置；局部不是商品图", () => {
    const { inputs } = sample(4);
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.styleWindow?.sourceResourceId)).toEqual(Array(3).fill("seller-long-photo"));
    expect(inputs[0].styleWindow?.top).toBe(0);
    expect(inputs[2].styleWindow?.bottom).toBe(1);
    expect(inputs[1].styleWindow!.top).toBeGreaterThan(inputs[0].styleWindow!.bottom);
    for (const [index, input] of inputs.entries()) {
        expect(input.compiled.references.map((photo) => photo.resourceId)).toEqual(["towel"]);
        expect(input.compiled.styleReferences.map((photo) => photo.resourceId)).toEqual(["seller-long-photo"]);
        expect(input.compiled.prompt).toContain(`图${index ? 4 : 3}是图2的设计局部`);
        expect(input.compiled.prompt).toMatch(/不复制[^。]*(?:商品|品牌)[^。]*(?:文字|文案)/);
        expect(studioImageReferenceSummary(input).style).toBe(2);
        expect(studioImageInputCount(input)).toBe(index ? 4 : 3);
    }
});

test("不挤掉原参考或接续，不改同款与短图；刷新只恢复已经记录的局部", () => {
    expect(sample(3).inputs.map((input) => Boolean(input.styleWindow))).toEqual([true, false, false]);
    expect(sample(2).inputs.every((input) => !input.styleWindow)).toBe(true);
    expect(sample(6, true).inputs.every((input) => !input.styleWindow)).toBe(true);
    expect(sample(6, false, 1200).inputs.every((input) => !input.styleWindow)).toBe(true);
    const { product, run, inputs, model } = sample(4);
    const input = inputs[1];
    input.styleWindow!.resourceId = "uploaded-window";
    run.shots[1].attempts = [{ id: "attempt", status: "submitting", model, tweaks: [], createdAt: "", outputs: [], input }];
    const persisted = JSON.parse(JSON.stringify(appendStudioRun(product, run)));
    expect(normalizeStudioProduct(persisted)?.runs[0].shots[1].attempts[0].input?.styleWindow).toEqual(input.styleWindow);
    delete persisted.runs[0].shots[1].attempts[0].input.styleWindow;
    expect(normalizeStudioProduct(persisted)?.runs[0].shots[1].attempts[0].input?.styleWindow).toBeUndefined();
});
