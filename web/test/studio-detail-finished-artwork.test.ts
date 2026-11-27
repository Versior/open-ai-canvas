import { expect, test } from "bun:test";
import { patchStudioDetailPlanScreen, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { buildStudioImageGeneration, locateStudioShot, studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { prepareBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";

const requiredArtwork = /必须由图片模型[^。\n]*商品原图[^。\n]*真实证据[^。\n]*可读[^。\n]*短文案/;

const earclipScreens = [
    {
        role: "detail-hero",
        purchaseQuestion: "耳机和收纳盒长什么样？",
        displayContent: "珊瑚橘耳夹式耳机与同色上翻盖收纳盒同框；盒盖打开，两只耳机左右对称放在盒内两个凹槽中。画面只呈现商品本体，不添加品牌、型号或参数文字。",
        visualBeat: "打开盒盖看清耳机和凹槽的关系",
    },
    {
        role: "detail-closeup",
        purchaseQuestion: "耳夹弧度是什么样的？",
        displayContent: "辨认单只耳机的弧形耳夹和两端的轮廓。",
        visualBeat: "单只耳机的弧形轮廓",
    },
];

function earclipProduct() {
    const product = createStudioProduct("earclip-product");
    product.name = "珊瑚橘耳夹式耳机";
    product.platform = "taobao";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: earclipScreens.length };
    product.photos = [{ id: "product-photo", resourceId: "earclip-original", url: "", truth: true, view: "front", addedAt: "" }];
    return product;
}

function planEarclip(product: ReturnType<typeof earclipProduct>, screens = earclipScreens) {
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "earclip-plan", model: "planner", createdAt: "" }, { scope: "detail" }).plan;
}

function restoreRun(product: ReturnType<typeof earclipProduct>, configureRun?: (run: ReturnType<typeof createStudioRun>) => void) {
    let serial = 0;
    const run = createStudioRun(product, () => `earclip-${++serial}`);
    configureRun?.(run);
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    return { restored, run: restored.runs[0] };
}

function earclipInput({ restored, run }: ReturnType<typeof restoreRun>, index: number, options?: { revision?: string; model?: string; config?: typeof defaultConfig }) {
    const located = locateStudioShot(restored, { runId: run.id }, run.shots[index].id)!;
    return studioImageInput(restored, located, options?.model || "gpt-image-2", options?.config || defaultConfig, options?.revision);
}

test("每屏原图直出由图片模型完成的详情页成品，策划的无字要求不能覆盖成品任务", () => {
    const product = earclipProduct();
    planEarclip(product);
    const { restored, run } = restoreRun(product);

    expect(run.shots).toHaveLength(earclipScreens.length);
    for (const [index] of run.shots.entries()) {
        const { compiled } = earclipInput({ restored, run }, index);
        const leadingText = compiled.prompt.split("\n\n", 1)[0];

        expect(leadingText.split("\n")[1]).toMatch(requiredArtwork);
        expect(leadingText).toContain("简体中文");
        expect(leadingText).toContain("不是素材照加一行浮字");
        expect(leadingText).toMatch(/(?:清楚|清晰|可读)[^。\n]*(?:文案|文字|信息)|(?:文案|文字|信息)[^。\n]*(?:清楚|清晰|可读)/);
        expect(compiled.prompt).toContain("淘宝 / 天猫");
        expect(compiled.prompt).toContain(`第 ${index + 1}/${earclipScreens.length} 屏`);
        expect(compiled.prompt).toContain(earclipScreens[index].purchaseQuestion);
        expect(leadingText).toContain("独立于商品印字的短文案");
        expect(leadingText).toContain("短文案实际画进图里");
        expect(leadingText).toMatch(/本屏[^。]*(?:部位|动作)[^。]*写出答案[^。]*不照抄问句/);
        expect(leadingText).not.toContain(earclipScreens[index].purchaseQuestion);
        expect(compiled.studioDetailContract).toBe(3);
        expect(compiled.useDesignKnowledge).toBe(true);
        expect(compiled.prompt).not.toMatch(/画面只呈现商品本体|不添加品牌、型号或参数文字/);
        expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["earclip-original"]);
        expect(compiled.styleReferences).toEqual([]);
        expect(compiled.layoutGuide).toBeUndefined();
        expect(compiled.copySnapshot).toMatchObject({ headline: "", subline: "", lines: [] });
        if (index === 0) {
            expect(compiled.prompt).toContain("盒盖打开");
            expect(compiled.prompt).toContain("两只耳机左右对称放在盒内两个凹槽中");
        }
    }
});

test("默认详情图只把当前屏交给图片模型，不在成品要求之后暗示可跳过文字", () => {
    const product = earclipProduct();
    planEarclip(product, [
        { ...earclipScreens[0], visualBeat: "两只耳机与打开的收纳盒" },
        { ...earclipScreens[1], visualBeat: "沿单只耳机弧面观察轮廓" },
    ]);
    const restored = restoreRun(product);
    const { compiled } = earclipInput(restored, 0);
    expect(compiled.prompt).toMatch(requiredArtwork);
    expect(compiled.prompt).toMatch(/盒盖打开，\s*两只耳机左右对称放在盒内两个凹槽中/);
    expect(compiled.prompt).not.toContain("画面主线：两只耳机与打开的收纳盒");
    expect(compiled.prompt).not.toContain("沿单只耳机弧面观察轮廓");
    expect(compiled.prompt).not.toMatch(/需要文字时|宁可用摄影|不添标语、标签/);
    expect(compiled.prompt).toMatch(/(?:字形|文案)[^。\n]*与(?:摄影|画面|商品)[^。\n]*(?:共同|一起)/);
});

test("图片模型字数预算很紧时，提交的请求仍以选定语言的成品要求开头", async () => {
    const product = earclipProduct();
    product.brief.language = "ja";
    planEarclip(product);
    const restored = restoreRun(product);
    const image = defaultImageCapabilityConfig("openai-image", "gpt-image-2");
    const maxChars = earclipInput(restored, 0).compiled.prompt.length - 12;
    image.references.promptMaxChars = maxChars;
    const channel = createModelChannel({
        id: "studio-budget",
        interfaceType: "openai-image",
        models: ["gpt-image-2"],
        modelCosts: [{ model: "gpt-image-2", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    const model = encodeChannelModel(channel.id, "gpt-image-2");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model, imageModels: [model] };
    const input = earclipInput(restored, 0, { model, config });
    const task = await prepareBackendGenerationTask({
        mode: "image",
        prompt: input.compiled.prompt,
        config: buildStudioImageGeneration(config, model, input, restored.run.shots[0].id),
        referenceImages: [{ id: "photo", name: "耳夹原图.png", type: "image/png", dataUrl: "", storageKey: resourceStorageKey("earclip-original") }],
        metadata: { source: "ecommerce-studio" },
    });

    expect(input.compiled.trimmed.length).toBeGreaterThan(0);
    expect(task.prompt?.length).toBeLessThanOrEqual(maxChars);
    expect(task.input.prompt).toBe(task.prompt);
    const leadingText = task.prompt?.split("\n\n", 1)[0];
    expect(leadingText).toMatch(requiredArtwork);
    expect(leadingText).toContain("日文");
    expect(task.prompt).toContain("第 1/2 屏");
    expect(task.prompt).toContain("两个凹槽");
    expect(task.input.referenceImages).toMatchObject([{ storageKey: resourceStorageKey("earclip-original") }]);
});

test("卖家选择无字时，不把成品排字指令混进请求", () => {
    const product = earclipProduct();
    product.brief.language = "none";
    planEarclip(product);
    const restored = restoreRun(product);
    const { compiled } = earclipInput(restored, 0);

    expect(compiled.prompt).toContain("不添加任何文字");
    expect(compiled.prompt).not.toMatch(requiredArtwork);
    expect(compiled.prompt).not.toContain("不是素材照加一行浮字");
    expect(compiled.studioDetailContract).toBe(3);
    expect(compiled.useDesignKnowledge).toBeUndefined();
    expect(compiled.prompt).toContain("两个凹槽");
    expect(compiled.layoutGuide).toBeUndefined();
});

test("显式同款参考和锁定原文仍随商品图提交", () => {
    const product = earclipProduct();
    product.brief.sameLayout = true;
    product.references = [{ ...product.photos[0], id: "seller-layout", resourceId: "seller-layout", truth: false }];
    planEarclip(product);
    product.brief = patchStudioDetailPlanScreen(product.brief, 0, { headline: "开盖看一看" });
    const { compiled } = earclipInput(restoreRun(product), 0);

    expect(compiled.prompt).toContain("照着图2的版式出图");
    expect(compiled.prompt).toContain("用户锁定的主标题「开盖看一看」：逐字保留");
    expect(compiled.prompt).not.toMatch(requiredArtwork);
    expect(compiled.useDesignKnowledge).toBeUndefined();
    expect(compiled.styleReferences.map(({ resourceId }) => resourceId)).toEqual(["seller-layout"]);
    expect(compiled.copySnapshot).toMatchObject({ headline: "开盖看一看", source: "user" });
});

test("修正候选保留卖家选定的成品，不切到重新设计模式", () => {
    const product = earclipProduct();
    planEarclip(product);
    const restored = restoreRun(product, (run) => {
        run.shots[0].attempts.push({ id: "original-attempt", status: "succeeded", model: "gpt-image-2", tweaks: [], createdAt: "", outputs: [{ resourceId: "selected-artwork", url: "" }] });
        run.shots[0].adjust = "只改标题字形";
    });
    const { compiled } = earclipInput(restored, 0, { revision: "selected-artwork" });

    expect(compiled.revisionReference?.resourceId).toBe("selected-artwork");
    expect(compiled.prompt).toContain("保留不需修改的设计");
    expect(compiled.prompt).toContain("只改标题字形");
    expect(compiled.prompt.split("\n\n", 1)[0]).not.toMatch(requiredArtwork);
    expect(compiled.useDesignKnowledge).toBeUndefined();
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["earclip-original"]);
});
