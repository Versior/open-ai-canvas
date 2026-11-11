import { expect, test } from "bun:test";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { buildDirectionsPrompt } from "@/lib/ecommerce-studio/plan-prep-tasks";
import { STUDIO_DETAIL_PLAN_LIMITS, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { studioPlanningImages, studioReferencePhotos } from "@/lib/ecommerce-studio/reference-selection";
import { studioPlanInputSignature } from "@/lib/ecommerce-studio/plan-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, studioActivePlan } from "@/lib/ecommerce-studio/runs";
import { buildStudioImageGeneration, locateStudioShot, studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { defaultConfig } from "@/stores/use-config-store";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";

function plannedProduct() {
    const product = createStudioProduct("quality-product");
    product.name = "儿童眼镜";
    product.photos = [{ id: "front", resourceId: "product-front", url: "", truth: true, view: "front", addedAt: "" }];
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2, shooting: "model", audience: "8岁儿童" };
    const screens = [
        { role: "detail-model", visual: "8岁儿童在窗边自然佩戴眼镜，镜框清晰", headline: "看见好奇" },
        { role: "detail-closing", visual: "桌上镜框的侧面细节", headline: "发现世界" },
    ];
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "plan", model: "planner", createdAt: "" }).plan;
    return product;
}

test("completed plans reject changed product evidence and creative inputs after reload", () => {
    const original = plannedProduct();
    const changes: Array<(product: StudioProduct) => void> = [
        (product) => {
            product.name = "成人太阳镜";
        },
        (product) => {
            product.photos[0].resourceId = "another-product";
        },
        (product) => {
            product.references = [{ ...product.photos[0], truth: false, resourceId: "style-reference" }];
        },
        (product) => {
            product.sellerNotes = "镜框宽度140毫米";
        },
        (product) => {
            product.brief.audience = "成年人";
        },
        (product) => {
            product.brief.extra = "改用户外场景";
        },
        (product) => {
            product.brief.model = { face: { itemId: "actor", name: "模特", prompt: "成年女性", resourceId: "actor-face" } };
        },
        (product) => {
            product.brief.planNote = "改成满版摄影";
        },
    ];
    expect(studioActivePlan(normalizeStudioProduct(original)!)).toBeDefined();
    for (const change of changes) {
        const product = structuredClone(original);
        change(product);
        const reloaded = normalizeStudioProduct(product)!;
        expect(studioActivePlan(reloaded)).toBeUndefined();
        expect(() => createStudioRun(reloaded, () => "shot")).toThrow("策划");
    }
    const legacy = structuredClone(original);
    delete legacy.brief.detailPlan!.inputSignature;
    expect(studioActivePlan(legacy)).toBeUndefined();
});

test("shot edits, order, generation results and resource URLs do not invalidate current planning", () => {
    const product = plannedProduct();
    product.brief.detailPlan!.screens[0].headline = "新的标题";
    product.brief.shotOrder = ["p1", "p0"];
    product.brief.shotSkip = ["p1"];
    product.brief.quality = "high";
    product.brief.resolution = "4k";
    product.photos[0].url = "/api/resources/product-front/file?display=refreshed";
    product.step = "deliver";
    product.revision += 1;
    expect(studioActivePlan(normalizeStudioProduct(product)!)).toBeDefined();
});

test("planning notes and preparation answers retain their identity across normalized persistence", () => {
    const product = plannedProduct();
    product.brief.planNote = "  自然窗光  ";
    product.brief.prep = { asks: [{ id: "age", question: "给谁用", options: ["儿童", "成人"], picked: ["儿童"], note: "  8岁  ", multi: false }], directions: [] };
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens: product.brief.detailPlan!.screens }), product, studioDetailPlanRoles(product), { id: "normalized", model: "planner", createdAt: "" }).plan;
    expect(studioActivePlan(normalizeStudioProduct(product)!)).toBeDefined();
});

test("historical runs keep the original planned product when the live product changes", () => {
    let product = plannedProduct();
    let id = 0;
    const run = createStudioRun(product, () => `run-${++id}`);
    product = appendStudioRun(product, run);
    const ref = { runId: run.id };
    const before = studioImageInput(product, locateStudioShot(product, ref, run.shots[0].id)!, "gpt-image", defaultConfig);
    product.name = "成人太阳镜";
    product.photos[0].resourceId = "different-product";
    product.brief.audience = "成年人";
    const reloaded = normalizeStudioProduct(product)!;
    const after = studioImageInput(reloaded, locateStudioShot(reloaded, ref, run.shots[0].id)!, "gpt-image", defaultConfig);
    expect(after.compiled.prompt).toBe(before.compiled.prompt);
    expect(after.compiled.references[0].resourceId).toBe("product-front");
});

test("child casting is not overridden by adult defaults in the final image request", () => {
    const product = plannedProduct();
    const run = createStudioRun(product, () => "shot");
    const compiled = compileStudioPrompt({ product, brief: product.brief, shot: run.shots[0], textMode: "model", model: "gpt-image" });
    expect(compiled.prompt).toContain("8岁儿童");
    expect(compiled.prompt).not.toContain("成年模特");
    const direct = compileStudioPrompt({ product, brief: product.brief, shot: { ...run.shots[0], visual: undefined }, model: "gpt-image" });
    expect(direct.prompt).not.toContain("成年模特");
});

test("product image execution isolates global text system instructions", () => {
    const product = plannedProduct();
    const run = createStudioRun(product, () => "shot");
    const input = studioImageInput(product, { shot: run.shots[0], textMode: run.textMode, quality: run.quality, resolution: "", fromForm: true, suite: run.suite }, "gpt-image", defaultConfig);
    const config = buildStudioImageGeneration({ ...defaultConfig, systemPrompt: "全部用成年模特和灰色棚拍背景" }, "gpt-image", input, "shot");
    expect(config.systemPrompt || "").toBe("");
    expect(input.compiled.prompt).toContain("8岁儿童");
});

test("planning and persistence retain the end of a detailed visual blueprint", () => {
    const product = plannedProduct();
    const visual = "主体与自然窗光、镜框细节、摄影层次。".repeat(28) + "末尾要求：右下角保留阅读场景，只有一位儿童。";
    const screens = product.brief.detailPlan!.screens.map((screen, index) => (index ? screen : { ...screen, visual }));
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "long-plan", model: "planner", createdAt: "" }).plan;
    const reloaded = normalizeStudioProduct(product)!;
    const run = createStudioRun(reloaded, () => "shot");
    expect(reloaded.brief.detailPlan!.screens[0].visual).toBe(visual);
    expect(run.shots[0].visual).toContain("末尾要求");
    expect(compileStudioPrompt({ product: reloaded, brief: reloaded.brief, shot: run.shots[0], model: "gpt-image", maxChars: 8000 }).prompt).toContain("末尾要求");
});

test("reference capacity reports omitted product views and never silently removes quality", () => {
    const product = plannedProduct();
    const run = createStudioRun(product, () => "shot");
    product.photos.push(...["side", "back", "detail"].map((view) => ({ ...product.photos[0], id: view, resourceId: view, view: view as "side" | "back" | "detail" })));
    const compiled = compileStudioPrompt({ product, brief: product.brief, shot: run.shots[0], model: "gpt-image", maxReferences: 1 });
    expect(compiled.referenceNotice).toContain("商品图");
    try {
        const tight = compileStudioPrompt({ product, brief: product.brief, shot: run.shots[0], model: "gpt-image", maxReferences: 1, maxChars: compiled.prompt.length - 1 });
        expect(tight.layers.some((layer) => layer.id === "quality")).toBe(true);
        expect(tight.trimmed).not.toContain("quality");
        expect(tight.trimmed).not.toContain("audience");
    } catch (error) {
        expect((error as Error).message).toContain("模型上限");
    }
});

test("planning uses available capacity, reads label photos and covers distinct views first", () => {
    const product = plannedProduct();
    product.photos.push(...["front", "side", "back", "detail", "tag"].map((view, index) => ({ ...product.photos[0], id: `view-${index}`, resourceId: `view-${index}`, view: view as "front" | "side" | "back" | "detail" | "tag" })));
    product.references = ["one", "two", "three"].map((id) => ({ ...product.photos[0], id, resourceId: id, truth: false }));
    expect(studioPlanningImages(product, 0).images).toHaveLength(0);
    expect(studioPlanningImages(product, 2).images).toHaveLength(2);
    expect(studioPlanningImages(product, 4).references).toHaveLength(2);
    const selected = studioPlanningImages(product, 12);
    expect(selected.photos).toHaveLength(6);
    expect(selected.references).toHaveLength(3);
    expect(selected.photos.some((photo) => photo.view === "tag")).toBe(true);
    expect(selected.notice).toBeUndefined();
    expect(studioPlanningImages(product, 4).notice).toContain("未采用");
    expect(studioReferencePhotos(product.photos, 3).map((photo) => photo.view)).toEqual(["front", "side", "back"]);
    expect(studioReferencePhotos(product.photos, 0)).toEqual([]);
    expect(() => compileStudioPrompt({ product, shot: { id: "shot", role: "main-white", title: "白底", ratio: "1:1", headline: "", subline: "", lines: [], sellingPointIds: [], tweaks: [], attempts: [] }, model: "gpt-image", maxReferences: 0 })).toThrow(
        "不支持商品参考图",
    );
});

test("overlong model blueprints fail explicitly instead of silently losing the ending", () => {
    const product = plannedProduct();
    const screens = product.brief.detailPlan!.screens.map((screen) => ({ ...screen, visual: "画".repeat(STUDIO_DETAIL_PLAN_LIMITS.visual + 1) }));
    expect(() => parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "too-long", model: "planner", createdAt: "" })).toThrow("超过上限");
});

test("scene people share the selected actor while pure detail shots remain without people", () => {
    const product = plannedProduct();
    product.brief.model = { face: { itemId: "child", name: "儿童模特", prompt: "8岁儿童，齐刘海", resourceId: "child-face" } };
    product.brief.detailPlan!.inputSignature = studioPlanInputSignature(product);
    const run = createStudioRun(product, () => "shot");
    const scene = { ...run.shots[0], role: "detail-scene" as const, visual: "8岁儿童在窗边佩戴眼镜，身体自然朝向光线" };
    const input = compileStudioPrompt({ product, brief: product.brief, shot: scene, model: "gpt-image", maxReferences: 3 });
    expect(input.modelReferences[0].resourceId).toBe("child-face");
    expect(input.prompt).toContain("齐刘海");
    const detail = compileStudioPrompt({ product, brief: product.brief, shot: { ...scene, role: "detail-closeup", visual: "纯商品微距，只呈现镜框可见转轴" }, model: "gpt-image" });
    expect(detail.modelReferences).toHaveLength(0);
    expect(detail.layers.some((layer) => layer.id === "shooting")).toBe(false);
});

test("long reference reading windows retain source grouping without changing the requested screen count", () => {
    const product = plannedProduct();
    const images = {
        photos: 2,
        references: 4,
        readingViews: [
            { imageIndex: 5, sourceIndex: 3, top: 0, bottom: 0.51 },
            { imageIndex: 6, sourceIndex: 3, top: 0.49, bottom: 1 },
        ],
    };
    const prompt = buildDetailPlanPrompt(product, studioDetailPlanRoles(product), { scope: "detail", images });
    expect(prompt).toContain("共 2 屏");
    for (const text of [prompt, buildDirectionsPrompt(product, "detail", images)]) {
        expect(text).toContain("图5对应参考图3的0%–51%区域");
        expect(text).toContain("图6对应参考图3的49%–100%区域");
        expect(text).toContain("不代表实际屏数");
    }
});
