import { expect, test } from "bun:test";
import { STUDIO_COUNT_OPTIONS, STUDIO_SINGLE_TYPES, studioPlatformForbidsText } from "@/lib/ecommerce-studio/brief";
import { buildDetailPlanPrompt, parseDetailPlan, studioPlanTargetRoles } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { reviewStudioDelivery } from "@/lib/ecommerce-studio/delivery-review";
import { studioImageInput, studioImageTaskMetadata, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, studioActivePlan, studioSingleTargets } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";

function squid() {
    const product = createStudioProduct("squid");
    product.name = "小鱿鱼";
    product.platform = "taobao";
    product.photos = [{ id: "hand-photo", resourceId: "original", url: "", truth: true, view: "front", addedAt: "" }];
    return product;
}

function requests(product: ReturnType<typeof squid>) {
    let index = 0;
    const restored = normalizeStudioProduct(
        JSON.parse(
            JSON.stringify(
                appendStudioRun(
                    product,
                    createStudioRun(product, () => `id-${++index}`),
                ),
            ),
        ),
    )!;
    const [run] = restored.runs;
    return run.shots.map((_, index) => {
        const shot = studioLocateRunShot(run, index);
        const { compiled } = studioImageInput(restored, shot, "gpt-image-2", defaultConfig);
        return { compiled, metadata: studioImageTaskMetadata(restored, shot, compiled) };
    });
}

test("a planned main image and poster stay different deliverables inside the same selection", () => {
    const product = squid();
    product.brief = { ...product.brief, outputType: "mix", mix: ["main", "poster"] };
    const targets = studioSingleTargets(product.brief);
    const roles = studioPlanTargetRoles(targets);
    const request = { scope: "single" as const, targets };
    const samePhoto = { purchaseQuestion: "看清原照里的小鱿鱼？", displayContent: "手托小鱿鱼，观察眼睛", visualBeat: "一只手托着小鱿鱼" };
    const result = parseDetailPlan(JSON.stringify({ screens: roles.map((role) => ({ role, ...samePhoto })) }), product, roles, { id: "plan", model: "planner", createdAt: "" }, request);
    product.brief.singlePlan = result.plan;
    const [main, poster] = requests(product);

    expect(main.compiled.prompt).toContain("搜索列表");
    expect(main.compiled.prompt).toContain("缩略图");
    expect(poster.compiled.prompt).toContain("详情页首屏");
    expect(poster.compiled.prompt).toContain("不是局部特写");
    for (const { compiled, metadata } of [main, poster]) {
        expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toMatch(/必须[^。]*简体中文/);
        expect(compiled.prompt).toContain("淘宝 / 天猫");
        expect(compiled.prompt).not.toMatch(/需要文字时|文字只使用提供的文案|必须展示：手托/);
        expect(compiled.references.map((photo) => photo.resourceId)).toEqual(["original"]);
        expect(compiled.layoutGuide).toBeUndefined();
        expect(compiled.copySnapshot?.headline).toBe("");
        expect(metadata).toMatchObject({ studioPlanKind: "single", studioUseDesignKnowledge: true });
    }
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ index: 1, field: "visualBeat" })]));
    const planning = buildDetailPlanPrompt(product, roles, request);
    expect(planning).toContain("缩略图");
    expect(planning).toContain("不是局部特写");
});

test("every single output gets its own role and the language policy is unchanged by mixing", () => {
    const product = squid();
    product.brief = { ...product.brief, outputType: "mix", mix: STUDIO_SINGLE_TYPES.map(({ id }) => id), language: "ja" };
    const compiled = requests(product).map((request) => request.compiled);
    expect(compiled).toHaveLength(18);
    const placements = compiled.map((item) => item.layers.find((layer) => layer.id === "planning-brief")?.text);
    expect(new Set(placements).size).toBe(18);
    for (const [index, item] of compiled.entries()) {
        const type = STUDIO_SINGLE_TYPES[index].id;
        const copy = item.layers.find((layer) => layer.id === "copy")?.text;
        expect(item.references[0].resourceId).toBe("original");
        expect(item.layoutGuide).toBeUndefined();
        expect(item.prompt).not.toMatch(/文字只使用提供的文案|等效 \d+mm/);
        if (type === "white") {
            expect(copy).toContain("不添加任何文字");
            expect(item.useDesignKnowledge).toBeUndefined();
        } else if (["main", "poster", "selling", "campaign", "seeding", "steps", "compare", "spec", "size", "package"].includes(type)) {
            expect(copy).toMatch(/必须[^。]*日文/);
        }
    }
});

test("platform restrictions and explicit no-text still win over artwork defaults", () => {
    const product = squid();
    product.platform = "amazon";
    product.brief = { ...product.brief, outputType: "mix", mix: ["main", "scene", "closeup", "poster", "flatlay"] };
    const [main, scene, closeup, poster, flatlay] = requests(product);
    expect(main.compiled.prompt).toContain("纯白背景");
    expect(main.compiled.prompt).toContain("不添加任何文字");
    expect(main.metadata.studioUseDesignKnowledge).toBeUndefined();
    for (const [entry, purpose] of [
        [scene, "实际使用状态"],
        [closeup, "可见的部位"],
        [flatlay, "部件关系"],
    ] as const) {
        expect(entry.compiled.prompt).toContain(purpose);
        expect(entry.compiled.prompt).not.toMatch(/纯白背景|不添加任何文字|主体占比不低于/);
        expect(entry.compiled.prompt).toContain("画幅：1:1");
    }
    expect(poster.compiled.prompt).toMatch(/必须[^。]*简体中文/);
    product.brief.language = "none";
    for (const { compiled } of requests(product)) expect(compiled.prompt).toContain("不添加任何文字");
});

test("the largest supported single-image selection survives saving and produces every chosen role", () => {
    const product = squid();
    product.brief = { ...product.brief, outputType: "mix", mix: STUDIO_SINGLE_TYPES.map(({ id }) => id), count: Math.max(...STUDIO_COUNT_OPTIONS), ratio: "4:5" };
    const targets = studioSingleTargets(product.brief);
    const roles = studioPlanTargetRoles(targets);
    const request = { scope: "single" as const, targets };
    const result = parseDetailPlan(
        JSON.stringify({ screens: roles.map((role) => ({ role, displayContent: "展示商品轮廓", aspectRatio: "16:9", headline: "策划生成的旧标题" })) }),
        product,
        roles,
        { id: "selection-plan", model: "planner", createdAt: "" },
        request,
    );
    product.brief.singlePlan = result.plan;
    product.brief.shotOrder = roles.map((_, index) => `p${index}`).reverse();
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
    expect(roles).toHaveLength(72);
    expect(studioActivePlan(restored)?.screens).toHaveLength(72);
    const shots = createStudioRun(restored, () => crypto.randomUUID()).shots;
    expect(shots.map(({ role }) => role)).toEqual([...roles].reverse());
    expect(shots.every(({ ratio, headline }) => ratio === "4:5" && !headline)).toBe(true);
    restored.brief.singlePlan!.screens.splice(30);
    expect(studioActivePlan(restored)).toBeUndefined();
});

test("the Amazon listing cover and its supporting images use the same placement for generation and delivery", () => {
    const product = squid();
    product.platform = "amazon";
    product.brief.outputType = "main-set";
    const run = createStudioRun(product, () => crypto.randomUUID());
    const [cover, selling, scene] = run.shots;
    expect(studioPlatformForbidsText(product, cover.role, "main", 1)).toBe(true);
    expect(studioPlatformForbidsText(product, selling.role, "main", 2)).toBe(false);
    const measurements = new Map([cover, selling, scene].map(({ id }) => [id, { width: 1200, height: 1200, bytes: 4000, audit: { whiteEdgeRatio: 0, textRatio: 0.12 } }]));
    const review = reviewStudioDelivery(product, [cover, selling, scene], measurements, new Set(measurements.keys()), "main");
    expect(review.issues.filter(({ message }) => /不是纯白|不允许出现文字/.test(message)).map(({ shotId }) => shotId)).toEqual([cover.id, cover.id]);
    const soloScene = reviewStudioDelivery(product, [scene], measurements, new Set([scene.id]));
    expect(soloScene.issues).toEqual([]);
});

test("direct candidates for the same role are distinct briefs, not the same request three times", () => {
    const product = squid();
    product.brief = { ...product.brief, outputType: "poster", count: 3 };
    const prompts = requests(product).map(({ compiled }) => compiled.prompt);
    expect(new Set(prompts).size).toBe(3);
    expect(prompts.every((prompt) => prompt.includes("详情页首屏"))).toBe(true);
});
