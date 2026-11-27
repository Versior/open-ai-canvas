import { expect, test } from "bun:test";
import { studioDetailPlanRoles, patchStudioDetailPlanScreen } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, type StudioPlanImages } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput, studioImageInputCount, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { studioPlanImageBindings, studioPlanningImages } from "@/lib/ecommerce-studio/reference-selection";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import type { StudioPhoto, StudioPlanReceipt } from "@/lib/ecommerce-studio/types";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";

const photo = (id: string, truth: boolean, view: StudioPhoto["view"] = "other", height = 900): StudioPhoto => ({ id, resourceId: `res_${id}`, url: "", name: `${id}.png`, truth, view, width: 750, height, addedAt: "" });
const meta = { id: "plan", model: "planner", createdAt: "" };
const rows = [
    { role: "detail-hero", purchaseQuestion: "整张织物是什么形状？", displayContent: "整条毛巾展开", styleReference: "图4" },
    { role: "detail-scene", purchaseQuestion: "擦拭时怎样接触表面？", displayContent: "毛巾包住湿润的手掌", styleReference: "图3" },
    { role: "detail-closeup", purchaseQuestion: "包边如何连到织纹？", displayContent: "边缘可见缝线" },
];

function sample() {
    const product = createStudioProduct("screen-reference");
    product.name = "毛巾";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 3 };
    product.photos = [photo("tag", true, "tag"), photo("front", true, "front")];
    product.references = [photo("use", false), photo("hero", false, "other", 7000), photo("not-attached", false)];
    return product;
}

function planningImages(product: ReturnType<typeof sample>): StudioPlanImages {
    const selected = studioPlanningImages(product, 4);
    return { photos: selected.photos.length, references: selected.references.length, ...studioPlanImageBindings(selected, product.brief.sameLayout) };
}

function parse(product: ReturnType<typeof sample>, selection: unknown, attached: StudioPlanImages | Pick<StudioPlanReceipt, "photoEvidence" | "designReferences"> = planningImages(product)) {
    return parseDetailPlan(JSON.stringify({ screens: [{ ...rows[0], styleReference: selection }, ...rows.slice(1)] }), product, studioDetailPlanRoles(product), meta, { scope: "detail", images: attached }).plan;
}

function compile(product: ReturnType<typeof sample>) {
    let serial = 0;
    const run = createStudioRun(product, () => String(++serial));
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    return { restored, inputs: restored.runs[0].shots.map((_, index) => studioImageInput(restored, studioLocateRunShot(restored.runs[0], index), "gpt-image-2", defaultConfig)) };
}

test("按屏选卖家原始参考：实拍/吊牌在前，局部阅读图在后；不同屏不再收到同一叠", () => {
    const product = sample();
    const selected = studioPlanningImages(product, 4);
    expect(selected.images.map(({ id }) => id)).toEqual(["front", "tag", "use", "hero"]);
    const images = planningImages(product);
    expect(images.designReferences).toEqual([
        { index: 3, resourceId: "res_use" },
        { index: 4, resourceId: "res_hero" },
    ]);
    expect(images.photoEvidence).toEqual([{ index: 1, id: "front" }]);
    product.brief.detailPlan = parse(product, "图4", images);
    expect(buildDetailPlanPrompt(product, studioDetailPlanRoles(product), { scope: "detail", images })).toMatch(/图3、图4[^\n]+styleReference/);
    expect(product.brief.detailPlan.screens.map((screen) => screen.styleReferenceResourceId)).toEqual(["res_hero", "res_use", undefined]);
    const { restored, inputs } = compile(product);
    expect(restored.brief.detailPlan?.screens[0].styleReferenceResourceId).toBe("res_hero");
    expect(restored.runs[0].shots.map((shot) => shot.styleReferenceResourceId)).toEqual(["res_hero", "res_use", undefined]);
    expect(inputs.map((input) => input.compiled.styleReferences.map(({ resourceId }) => resourceId))).toEqual([["res_hero"], ["res_use"], ["res_use", "res_hero", "res_not-attached"]]);
    expect(inputs[0].styleWindow).toBeUndefined();
    expect(inputs[1].compiled.references.map(({ resourceId }) => resourceId)).toEqual(["res_front"]);
    expect(inputs[0].compiled.layers.find((layer) => layer.id === "layout")?.text).toContain("不套固定版式");
    restored.runs[0].shots[0].attempts.push({ id: "a", status: "submitting", model: "gpt-image-2", tweaks: [], createdAt: "", outputs: [], input: inputs[0] });
    restored.references = [];
    const reloaded = normalizeStudioProduct(JSON.parse(JSON.stringify(restored)))!;
    expect(reloaded.runs[0].shots[0].attempts[0].input?.compiled.styleReferences.map(({ resourceId }) => resourceId)).toEqual(["res_hero"]);
    expect(studioImageInput(reloaded, studioLocateRunShot(reloaded.runs[0], 1), "gpt-image-2", defaultConfig).compiled.styleReferences.map(({ resourceId }) => resourceId)).toEqual(["res_use"]);
});

test("复核使用实际附件回执，不按当前资源顺序猜图号", () => {
    const product = sample();
    const bindings = studioPlanImageBindings(studioPlanningImages(product, 4), false);
    const receipt: StudioPlanReceipt = { scope: "detail", state: "submitted", inputSignature: "test", model: "planner", createdAt: "", attemptId: "pending", ...bindings };
    product.planReceipt = receipt;
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
    expect(restored.planReceipt!.designReferences).toEqual(bindings.designReferences);
    restored.references.reverse();
    expect(parse(restored, "图3", restored.planReceipt!).screens[0].styleReferenceResourceId).toBe("res_use");
});

test("忽略商品、长图裁片、未附编号、直接资源 ID、外链和无意义选择，保留既有路径", () => {
    const product = sample();
    const withReadingViews = { ...planningImages(product), readingViews: [{ imageIndex: 5, sourceIndex: 4, top: 0, bottom: 0.3 }] };
    for (const invalid of ["图1", "图2", "图5", "图6", "图999", "res_hero", "https://example.invalid/reference.png", ["图3", "图4"], ""]) expect(parse(product, invalid, withReadingViews).screens[0].styleReferenceResourceId).toBeUndefined();
    product.brief.sameLayout = true;
    product.brief.detailPlan = parse(product, "图4");
    expect(product.brief.detailPlan.screens[0].styleReferenceResourceId).toBeUndefined();
    expect(compile(product).inputs[0].compiled.styleReferences.map(({ id }) => id)).toEqual(["use"]);
    product.brief.sameLayout = false;
    product.references = [product.references[1]];
    const onlyOne = planningImages(product);
    expect(parse(product, "图3", onlyOne).screens[0].styleReferenceResourceId).toBeUndefined();
    expect(buildDetailPlanPrompt(product, studioDetailPlanRoles(product), { scope: "detail", images: onlyOne })).not.toContain("styleReference");
    product.brief.detailPlan = parse(product, "图3", onlyOne);
    expect(compile(product).inputs[0].compiled.styleReferences.map(({ id }) => id)).toEqual(["hero"]);
    product.references = [];
    product.brief.detailPlan = parse(product, undefined);
    expect(compile(product).inputs[0].compiled.styleReferences).toEqual([]);
});

test("同一资源不能同时成为商品证据和卖家设计参考，重复上传不制造新选项", () => {
    const product = sample();
    const [use, hero] = product.references;
    product.references = [{ ...product.photos[1], truth: false }, use, { ...use, id: "duplicate-use" }, hero];
    const selected = studioPlanningImages(product, 7);
    const attached = studioPlanImageBindings(selected, false);
    expect(attached.designReferences).toEqual([
        { index: 4, resourceId: "res_use" },
        { index: 6, resourceId: "res_hero" },
    ]);
    expect(parse(product, "图3", attached).screens[0].styleReferenceResourceId).toBeUndefined();
    expect(parse(product, "图5", attached).screens[0].styleReferenceResourceId).toBeUndefined();
    expect(parse(product, "图6", attached).screens[0].styleReferenceResourceId).toBe("res_hero");
    product.references = [use, { ...use, id: "duplicate-use" }];
    expect(planningImages(product).designReferences).toBeUndefined();
});

test("渠道只收两张时，一张保真、一张按屏匹配；未匹配不影响普通出图", () => {
    const product = sample();
    product.brief.detailPlan = parse(product, "图4");
    const { restored } = compile(product);
    const image = defaultImageCapabilityConfig("openai-image", "gpt-image-2");
    image.references.maxImages = 2;
    const channel = createModelChannel({
        id: "matched",
        interfaceType: "openai-image",
        models: ["gpt-image-2"],
        modelCosts: [{ model: "gpt-image-2", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model };
    const inputs = restored.runs[0].shots.map((_, index) => studioImageInput(restored, studioLocateRunShot(restored.runs[0], index), model, config));
    expect(inputs.map((input) => input.compiled.styleReferences.map(({ id }) => id))).toEqual([["hero"], ["use"], ["use"]]);
    for (const input of inputs) {
        expect(studioImageInputCount(input)).toBe(2);
        expect(input.compiled.references.map(({ id }) => id)).toEqual(["front"]);
    }
});

test("改变主题就清除旧匹配；只改卖家锁字不清", () => {
    const product = sample();
    product.brief.detailPlan = parse(product, "图4");
    expect(patchStudioDetailPlanScreen(product.brief, 0, { headline: "卖家原文" }).detailPlan?.screens[0].styleReferenceResourceId).toBe("res_hero");
    expect(patchStudioDetailPlanScreen(product.brief, 0, { purchaseQuestion: "换成看包边" }).detailPlan?.screens[0].styleReferenceResourceId).toBeUndefined();
});
