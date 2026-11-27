import { expect, test } from "bun:test";
import { patchStudioDetailPlanScreen, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput, studioImageInputCount, studioImageReferenceSummary, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";

function sample(part: unknown, id = "switch") {
    const product = createStudioProduct(id);
    product.name = "台灯";
    product.photos = [{ id: "front", resourceId: "lamp-original", view: "front", truth: true, url: "", addedAt: "" }];
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    const request = { scope: "detail" as const, images: { photos: 1, references: 0, photoEvidence: [{ index: 1, id: "front" }] } };
    const roles = studioDetailPlanRoles(product);
    const screens = [
        { role: "detail-hero", purchaseQuestion: "这是什么灯？", displayContent: "展示整灯。" },
        { role: "detail-closeup", purchaseQuestion: "灯座边缘的滑钮在哪里？", displayContent: "展示滑钮和灯座外沿的连接。", evidence: ["photo:front"], detailSource: part },
    ];
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens }), product, roles, { id: "plan", model: "planner", createdAt: "" }, request).plan;
    let serial = 0;
    const restored = normalizeStudioProduct(
        JSON.parse(
            JSON.stringify(
                appendStudioRun(
                    product,
                    createStudioRun(product, () => `frame-${++serial}`),
                ),
            ),
        ),
    )!;
    const located = studioLocateRunShot(restored.runs[0], 1);
    return { restored, located, planPrompt: buildDetailPlanPrompt(product, roles, request), input: studioImageInput(restored, located, "gpt-image-2", defaultConfig) };
}

test("原图局部从真实策划经过持久化进入生图输入，另附完整商品图，不把坐标用作版式", () => {
    const { planPrompt, input, restored, located } = sample({ photo: "图1", box: [48, 50, 65, 74] });
    expect(planPrompt).toContain("detailSource");
    expect(input.detailSource).toEqual({ photo: "photo:front", box: [48, 50, 65, 74], sourceResourceId: "lamp-original" });
    expect(input.compiled.references[0].resourceId).toBe("lamp-original");
    expect(input.compiled.prompt).toContain("图3是图1的实拍局部");
    expect(input.compiled.prompt).not.toContain("48,50,65,74");
    expect(studioImageReferenceSummary(input).names.at(-1)).toBe("本屏实拍局部");
    expect(studioImageInputCount(input)).toBe(3);
    input.detailSource!.resourceId = "uploaded-lamp-control";
    located.shot.attempts.push({ id: "a", model: "gpt-image-2", status: "submitting", tweaks: [], createdAt: "", outputs: [], input });
    expect(normalizeStudioProduct(JSON.parse(JSON.stringify(restored)))!.runs[0].shots[1].attempts[0].input?.detailSource).toEqual(input.detailSource);
});

test("不接受越界坐标或非商品来源，不因缺少可用裁片阻断成片", () => {
    for (const source of [{ photo: "photo:front", box: [20, 60, 18, 80] }, { photo: "style:layout", box: [20, 60, 40, 80] }, { photo: "photo:front", box: [0, 0, 40, 101] }, undefined]) {
        const { input } = sample(source);
        expect(input.detailSource).toBeUndefined();
        expect(input.compiled.references.map((photo) => photo.resourceId)).toEqual(["lamp-original"]);
        expect(input.compiled.prompt).not.toContain("的实拍局部");
    }
});

test("定位屏优先用全景和实拍局部而非色样；刷新仍认识两张图各自的用途", () => {
    const { restored, located } = sample({ photo: "图1", box: [48, 50, 65, 74], framing: "locate" });
    const image = defaultImageCapabilityConfig("openai-image", "gpt-image-2");
    image.references.maxImages = 2;
    const channel = createModelChannel({ id: "locator", interfaceType: "openai-image", models: ["gpt-image-2"], modelCosts: [{ model: "gpt-image-2", capability: "image", capabilityConfig: { version: 1, image }, protocol: "openai-image" }] });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const input = studioImageInput(restored, located, model, { ...defaultConfig, channels: [channel], model, imageModel: model });
    expect(studioImageInputCount(input)).toBe(2);
    expect(input.compiled.continuity).toBeUndefined();
    expect(input.compiled.prompt).toContain("图2是图1的实拍局部");
    expect(input.compiled.prompt).toContain("对应回图1的整件商品");
    input.detailSource!.resourceId = "lamp-location-crop";
    located.shot.attempts.push({ id: "locator-check", model, status: "submitting", tweaks: [], createdAt: "", outputs: [], input });
    const reloaded = normalizeStudioProduct(JSON.parse(JSON.stringify(restored)))!;
    expect(reloaded.runs[0].shots[1].attempts[0].input?.detailSource).toEqual({ photo: "photo:front", box: [48, 50, 65, 74], framing: "locate", sourceResourceId: "lamp-original", resourceId: "lamp-location-crop" });
});

test("换展示内容不用前一个部位的局部，只改文案保留取证范围", () => {
    const { restored } = sample({ photo: "photo:front", box: [48, 50, 65, 74] });
    expect(patchStudioDetailPlanScreen(restored.brief, 1, { visual: "展示整片灯罩" }).detailPlan?.screens[1].detailSource).toBeUndefined();
    expect(patchStudioDetailPlanScreen(restored.brief, 1, { headline: "灯座一侧" }).detailPlan?.screens[1].detailSource).toEqual(restored.brief.detailPlan?.screens[1].detailSource);
});

test("静态实拍的截断和模糊小字不变成支点、挡位或工作方向", () => {
    const { restored, located } = sample(undefined);
    const compiled = studioImageInput(restored, { ...located, shot: { ...located.shot, role: "detail-scene" } }, "gpt-image-2", defaultConfig).compiled;
    expect(compiled.prompt).not.toMatch(/先从实拍辨认工作端|工作端必须对着作用对象/);
    expect(compiled.layers.find((layer) => layer.id === "truth")?.text).toMatch(/截断[^。]*支点/);
    expect(compiled.layers.find((layer) => layer.id === "truth")?.text).toMatch(/辨不清[^。]*补写/);
});
