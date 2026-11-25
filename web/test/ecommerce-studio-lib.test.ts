import { describe, expect, test } from "bun:test";
import { STUDIO_DETAIL_PLAN_CAPABILITY, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, studioPlanTargetRoles } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { buildFillPrompt, buildRecognitionPrompt, extractStudioJson, parseFill, parseRecognition, studioAnalysisMetadata } from "@/lib/ecommerce-studio/dossier-tasks";
import { compileStudioPrompt, studioModelAdapter, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { createStudioProduct, normalizeStudioProduct, studioGenerationSource, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { createStudioRun, studioActivePlan, studioRunTitle, studioSetEntries, studioSingleTargets, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { pickStudioSetType, resetStudioBriefParameters, studioInfoPoints, studioRatioValid } from "@/lib/ecommerce-studio/brief";
import { studioEffectiveResolution, studioImageRequest, studioQualityOptions, studioRatioOptions, studioResolutionOptions } from "@/lib/ecommerce-studio/image-options";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { planStudioTypeset, wrapStudioText } from "@/lib/ecommerce-studio/typeset";
import type { StudioPhoto, StudioProduct } from "@/lib/ecommerce-studio/types";

function ids() {
    let next = 0;
    return () => `id_${(next += 1).toString().padStart(4, "0")}`;
}

function photo(id: string, view: StudioPhoto["view"], truth = true): StudioPhoto {
    return { id, resourceId: `res_${id}`, url: `/api/resources/res_${id}/file`, view, truth, addedAt: "2026-11-01T00:00:00Z" };
}

function cupProduct(): StudioProduct {
    const product = createStudioProduct("product_cup", "2026-11-01T00:00:00Z");
    product.name = "雾蓝保温杯";
    product.style = "mist";
    product.photos = [photo("tag", "tag"), photo("side", "side"), photo("front", "front")];
    product.dossier = {
        name: "雾蓝保温杯",
        category: "保温杯",
        family: "generic",
        summary: "不锈钢真空保温杯",
        facts: [
            { id: "f_color", group: "appearance", label: "颜色", value: "哑光雾蓝 #6F8CA6", evidence: "visible", source: "图1" },
            { id: "f_text", group: "text", label: "刻字", value: "岚屿", evidence: "visible", source: "图1" },
            { id: "f_volume", group: "spec", label: "容量", value: "500ml", evidence: "confirmed", source: "卖家" },
            { id: "f_guess", group: "material", label: "内胆", value: "316 不锈钢", evidence: "inferred" },
        ],
        invariants: ["杯盖顶部的银色拉丝金属环"],
        questions: [],
    };
    product.sellingPoints = [
        { id: "p_volume", title: "500ml 大容量", detail: "一天的饮水一次装够", evidence: "confirmed", factIds: ["f_volume"], enabled: true },
        { id: "p_guess", title: "316 内胆", detail: "更耐腐蚀", evidence: "inferred", factIds: ["f_guess"], enabled: false },
    ];
    product.copy = { headline: "一杯装下一整天", subhead: "500ml 真空保温杯", listingTitle: "", bullets: [] };
    return product;
}

/** 套图镜头：表单的卖点写在 sellerNotes（「标题｜说明」一行一条），主标题写在 copy.headline。 */
function setRun(product: StudioProduct, outputType: "main-set" | "detail-set") {
    const prepared = { ...product, sellerNotes: "500ml 大容量｜一天的饮水一次装够", brief: { ...product.brief, outputType } };
    if (outputType === "detail-set") {
        prepared.brief.detailPlan = parseDetailPlan(
            JSON.stringify({
                screens: Array.from({ length: prepared.brief.detailScreens }, (_, index) => ({
                    role: index === 0 ? "detail-hero" : index === prepared.brief.detailScreens - 1 ? "detail-closing" : index === 1 ? "detail-model" : "detail-closeup",
                    visual: "商品实拍，雾蓝背景",
                    headline: "500ml 大容量",
                })),
            }),
            prepared,
            studioDetailPlanRoles(prepared),
            { id: "fixture-plan", model: "m", createdAt: "" },
        ).plan;
    }
    return { product: prepared, plan: createStudioRun(prepared, ids(), "2026-11-01T00:00:00Z") };
}

describe("detail page requested screen count", () => {
    test("2–20 screens keep the chosen length; old overlay preferences still generate integrated layouts", () => {
        for (const count of [2, 4, 6, 10, 13, 20]) {
            const product = cupProduct();
            product.brief = { ...product.brief, outputType: "detail-set", detailScreens: count };
            const screens = Array.from({ length: count }, (_, index) => ({ role: index === 0 ? "detail-hero" : index === count - 1 ? "detail-closing" : "detail-closeup", visual: `可见细节 ${index}`, headline: "雾蓝杯身" }));
            const plan = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "p", model: "m", createdAt: "" }).plan;
            product.brief.detailPlan = plan;
            expect(createStudioRun(product, ids()).shots).toHaveLength(count);
            expect(normalizeStudioProduct(product).brief.detailScreens).toBe(count);
        }
        expect(cupProduct().brief.detailScreens).toBe(6);
        for (const count of [0, 1, 21, 4.5, "4"]) expect(normalizeStudioProduct({ ...cupProduct(), brief: { ...cupProduct().brief, detailScreens: count } }).brief.detailScreens).toBe(6);
        const product = cupProduct();
        product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
        const plan = parseDetailPlan(
            JSON.stringify({
                screens: [
                    { role: "detail-hero", layout: "callout", visual: "引线指向商品", headline: "雾蓝杯身" },
                    { role: "detail-closing", visual: "商品", headline: "雾蓝杯身" },
                ],
            }),
            product,
            studioDetailPlanRoles(product),
            { id: "p", model: "m", createdAt: "" },
        ).plan;
        product.brief.detailPlan = plan;
        const run = createStudioRun(product, ids());
        expect(compileStudioPrompt({ product, plan: { ...run, textMode: "overlay" }, shot: run.shots[0], model: "gpt-image-2" }).textMode).toBe("model");
    });
    test("the display brief survives persistence without the planner's art direction", () => {
        const product = cupProduct();
        product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
        const analysis = "雾蓝哑光杯身用冷白背景拉开明度，侧光展示哑光轮廓；正面整杯和可见边缘裁切交替，标题与注解按 3:1 拉开字号。";
        const displayContent = "展示完整杯身与杯盖连接关系";
        const parsed = parseDetailPlan(
            JSON.stringify({
                designAnalysis: analysis,
                style: "冷白与雾蓝",
                screens: [
                    { role: "detail-hero", displayContent, headline: "雾蓝杯身" },
                    { role: "detail-closing", displayContent: "可见边缘裁切", headline: "雾蓝杯身" },
                ],
            }),
            product,
            studioDetailPlanRoles(product),
            { id: "p", model: "m", createdAt: "" },
        );
        product.brief.detailPlan = parsed.plan;
        const run = createStudioRun(product, ids());
        product.runs = [run];
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)));
        expect(restored.brief.detailPlan?.screens[0].displayContent).toBe(displayContent);
        expect(restored.brief.detailPlan?.designAnalysis).toBeUndefined();
        expect(restored.runs[0].suite?.designAnalysis).toBeUndefined();
        const compiled = compileStudioPrompt({ product: restored, shot: run.shots[0], model: "gpt-image-2", suite: restored.runs[0].suite, brief: restored.brief });
        expect(compiled.layers.find((layer) => layer.id === "visual")?.text).toContain(displayContent);
        expect(compiled.prompt).not.toContain(analysis);
        expect(buildDetailPlanPrompt(product, studioDetailPlanRoles(product))).not.toContain('"designAnalysis"');
    });

    test("four selected screens drive planning and survive product persistence", () => {
        const product = cupProduct();
        product.brief = { ...product.brief, outputType: "detail-set", ...{ detailScreens: 4 } };
        expect(buildDetailPlanPrompt(product, studioDetailPlanRoles(product), { scope: "detail" })).toContain("共 4 屏");
        const saved = normalizeStudioProduct(product);
        expect(saved?.brief).toHaveProperty("detailScreens", 4);
        const screens = ["detail-hero", "detail-closeup", "detail-scene", "detail-closing"].map((role) => ({ role, visual: "实拍商品细节", headline: "雾蓝杯身" }));
        product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "p4", model: "m", createdAt: "" }).plan;
        expect(studioSetEntries(product)).toHaveLength(4);
        const run = createStudioRun(product, ids());
        expect(run.shots).toHaveLength(4);
        expect(normalizeStudioProduct(product).brief.detailPlan?.requestedScreens).toBe(4);
        const reset = resetStudioBriefParameters(product.brief);
        expect(reset.detailScreens).toBe(4);
        expect(studioActivePlan({ ...product, brief: { ...reset, outputType: "detail-set" } })?.screens).toHaveLength(4);
        product.brief.detailScreens = 6;
        expect(studioActivePlan(product)).toBeUndefined();
        expect(() => createStudioRun(product, ids())).toThrow("先按所选 6 屏完成策划");
        expect(run.shots).toHaveLength(4);
        const expanded = parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "p", model: "m", createdAt: "" });
        expect(expanded.plan.screens).toHaveLength(6);
        expect(expanded.warnings.some((issue) => issue.field === "screens" && /已补入可用的商品展示任务/.test(issue.message))).toBe(true);
        expect(expanded.plan.screens.every((screen) => !screen.noText && screen.displayContent?.trim())).toBe(true);
    });
});

describe("ecommerce studio prompt compiler", () => {
    test("white main image keeps truth, platform rules and no text", () => {
        const { product, plan } = setRun(cupProduct(), "main-set");
        const compiled = compileStudioPrompt({ product, plan, shot: plan.shots[0], model: "gpt-image-2" });
        expect(plan.shots[0].role).toBe("main-white");
        expect(compiled.prompt).toContain("商品真值");
        expect(compiled.prompt).toContain("颜色 哑光雾蓝 #6F8CA6");
        expect(compiled.prompt).toContain("刻字 「岚屿」");
        expect(compiled.prompt).toContain("杯盖顶部的银色拉丝金属环");
        expect(compiled.prompt).toContain("主体占比不低于 60%");
        expect(compiled.prompt).toContain("纯白");
        expect(compiled.prompt).not.toContain("316 不锈钢");
        expect(compiled.layers.some((layer) => layer.id === "style")).toBe(false);
        expect(compiled.references.map((item) => item.view)).toEqual(["front", "side"]);
    });

    test("selling image preserves the user's exact title without locking supporting facts as copy", () => {
        const { product, plan } = setRun(cupProduct(), "main-set");
        const shot = plan.shots.find((item) => item.role === "main-selling")!;
        expect(shot.headline).toBe("500ml 大容量");
        const model = compileStudioPrompt({ product, plan, shot, model: "doubao-seedream-5-0" });
        expect(model.textMode).toBe("model");
        expect(model.copySnapshot).toMatchObject({ headline: product.copy?.headline, source: "user" });
        expect(model.layers.find((layer) => layer.id === "copy")?.text).toContain("「一杯装下一整天」：逐字保留");
        expect(model.layers.find((layer) => layer.id === "copy")?.text).not.toContain("500ml 大容量");
        expect(model.layers.find((layer) => layer.id === "proof")?.text).toContain("容量 500ml");
        expect(model.layers.find((layer) => layer.id === "style")?.text).toContain("雾蓝灰 #DDE5EC");
        const overlay = compileStudioPrompt({ product, plan: { ...plan, textMode: "overlay" }, shot, model: "gpt-image-2" });
        expect(overlay.copySnapshot).toEqual(model.copySnapshot);
        expect(overlay.prompt).not.toContain("留给后期排字");
    });

    test("weak text models keep integrated artwork instead of falling back to composited text", () => {
        const { product, plan } = setRun(cupProduct(), "main-set");
        const shot = plan.shots.find((item) => item.role === "main-selling")!;
        const compiled = compileStudioPrompt({ product, plan, shot, model: "flux-1.1-pro" });
        expect(studioModelAdapter("flux-1.1-pro").textRendering).toBe("weak");
        expect(compiled.textMode).toBe("model");
        expect(compiled.textModeNotice).toContain("文字");
        expect(compiled.copySnapshot?.source).toBe("user");
        expect(compiled.prompt).toMatch(/图片模型[^。\n]*一次完成成品/);
        expect(compiled.layoutGuide).toBeUndefined();
        expect(compiled.prompt).not.toContain("留给后期排字");
    });

    test("old overlay preference cannot select compositing for new generations", () => {
        const { product, plan } = setRun(cupProduct(), "main-set");
        product.brief.textMode = "overlay";
        expect(createStudioRun(product, ids()).textMode).toBe("model");
        expect(normalizeStudioProduct(product).brief.textMode).toBe("model");
        const compiled = compileStudioPrompt({ product, plan: { ...plan, textMode: "overlay" }, shot: plan.shots[1], model: "gpt-image-2" });
        expect(compiled.textMode).toBe("model");
        expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toContain("逐字保留");
        expect(compiled.prompt).toMatch(/图片模型[^。\n]*一次完成成品/);
        expect(compiled.layoutGuide).toBeUndefined();
        expect(compiled.prompt).not.toContain("留给后期排字");
    });

    test("long prompts drop decorative layers first and refuse impossible budgets", () => {
        const { product, plan } = setRun(cupProduct(), "detail-set");
        const shot = { ...plan.shots[0], screenIndex: 1, screenCount: plan.shots.length };
        const suite = { name: "策划", style: "", artDirection: { visualWorld: "清晨的室内窗影与细沙质感，整体以低饱和与细腻光线营造自然安静的空间" } };
        const full = compileStudioPrompt({ product, plan, shot, suite, model: "gpt-image-2" });
        const tight = compileStudioPrompt({ product, plan, shot, suite, model: "gpt-image-2", maxChars: full.prompt.length - 40 });
        expect(tight.trimmed).toEqual(["art-direction"]);
        expect(tight.layers.some((layer) => layer.id === "visual")).toBe(true);
        expect(tight.prompt.length).toBeLessThanOrEqual(full.prompt.length - 40);
        expect(tight.prompt).toContain("商品真值");
        expect(tight.prompt).toContain("手机端商品详情页连续长图");
        expect(tight.prompt).toContain(`第 1/${plan.shots.length} 屏`);
        expect(tight.layers.find((layer) => layer.id === "copy")?.text).toMatch(/逐字保留|图片模型[^。\n]*可读/);
        expect(() => compileStudioPrompt({ product, plan, shot, model: "gpt-image-2", maxChars: 120 })).toThrow("超过模型上限");
        const verbose = { ...product, dossier: { ...product.dossier!, summary: "很长的描述".repeat(120) } };
        expect(() => compileStudioPrompt({ product: verbose, plan, shot, model: "gpt-image-2", maxChars: 400 })).toThrow("超过模型上限");
    });

    test("reference photos skip tag shots and respect the model limit", () => {
        const photos = [photo("a", "tag"), photo("b", "detail"), photo("c", "front"), photo("d", "back", false)];
        expect(studioReferencePhotos(photos, 1).map((item) => item.id)).toEqual(["c"]);
        expect(studioReferencePhotos(photos).map((item) => item.id)).toEqual(["c", "b"]);
    });
});

describe("ecommerce studio dossier tasks", () => {
    test("recognition prompt lists photo roles and the JSON contract", () => {
        const prompt = buildRecognitionPrompt({ photos: [photo("a", "front"), photo("b", "tag")], platformName: "淘宝 / 天猫", sellerNotes: "容量 500ml" });
        expect(prompt).toContain("图1：正面");
        expect(prompt).toContain("图2：吊牌（读取吊牌文字）");
        expect(prompt).toContain("容量 500ml");
        expect(prompt).toContain('"evidence":"visible"');
        expect(studioAnalysisMetadata("product_cup", "recognize")).toMatchObject({ ecommerceCapability: "dossier", ecommerceAnalysisFlow: "cap:dossier" });
    });

    test("recognition parser tolerates fences and maps evidence", () => {
        const raw =
            '好的，结果如下：\n```json\n{"name":"雾蓝保温杯","category":"保温杯","family":"kitchen","summary":"真空杯","facts":[{"group":"appearance","label":"颜色","value":"雾蓝","evidence":"visible","source":"图1"},{"group":"spec","label":"容量","value":"500ml","evidence":"unknown"},{"label":"","value":"x"}],"invariants":["金属环"],"questions":["容量多少"],}\n```\n以上。';
        const dossier = parseRecognition(raw, ids(), "gpt-5");
        expect(dossier.family).toBe("generic");
        expect(dossier.facts).toHaveLength(2);
        expect(dossier.facts[1].evidence).toBe("pending");
        expect(dossier.recognizedWith).toBe("gpt-5");
        expect(() => parseRecognition('{"facts":[]}', ids())).toThrow("没有识别出商品信息");
        expect(() => extractStudioJson("没有 JSON")).toThrow();
    });

    test("fill parser binds selling points to facts and flags extreme words", () => {
        const product = cupProduct();
        const sellerNotes = "容量：500ml";
        const prompt = buildFillPrompt({ photos: product.photos, platformName: "淘宝", sellerNotes, brand: "岚屿" });
        expect(prompt).toContain("品牌：岚屿");
        expect(prompt).toContain('"points"');
        const result = parseFill(
            JSON.stringify({
                name: "雾蓝保温杯",
                brand: "岚屿",
                category: "保温杯",
                family: "generic",
                title: "一杯装下一整天",
                points: [
                    { title: "500ml 大容量", detail: "装够一天", facts: ["容量"] },
                    { title: "316 内胆", detail: "耐腐蚀", facts: ["内胆"] },
                    { title: "最好看的杯子", detail: "", facts: [] },
                ],
                facts: [
                    { group: "spec", label: "容量", value: "500ml", evidence: "visible", source: "卖家" },
                    { group: "material", label: "内胆", value: "316 不锈钢", evidence: "inferred" },
                ],
            }),
            ids(),
            "fixture",
            sellerNotes,
        );
        expect(result.sellingPoints.map((point) => [point.evidence, point.enabled])).toEqual([
            ["visible", true],
            ["inferred", false],
            ["pending", false],
        ]);
        expect(result.sellingPoints[0].factIds).toEqual([result.dossier.facts[0].id]);
        expect(result.brand).toBe("岚屿");
        expect(result.title).toBe("一杯装下一整天");
        expect(result.issues.some((issue) => issue.term.includes("最"))).toBe(true);
    });

    test("recognition does not promote guessed specifications and marketing copy to seller facts", () => {
        const raw = JSON.stringify({
            name: "薄荷绿吹风机",
            facts: [
                { group: "spec", label: "功率", value: "1800W", evidence: "confirmed", source: "卖家" },
                { group: "spec", label: "重量", value: "280g", evidence: "visible", source: "图1" },
                { group: "appearance", label: "颜色", value: "薄荷绿", evidence: "visible", source: "图1" },
            ],
            points: [
                { title: "1800W 功率", facts: ["功率"] },
                { title: "防水吹风机", facts: ["颜色"] },
                { title: "薄荷绿外观", facts: ["颜色"] },
            ],
        });
        const result = parseFill(raw, ids(), "fixture", "功率：180W");
        expect(result.dossier.facts.map((fact) => fact.evidence)).toEqual(["pending", "pending", "visible"]);
        expect(result.dossier.facts[0].source).not.toBe("卖家");
        expect(result.sellingPoints.map((point) => point.enabled)).toEqual([false, false, true]);
    });
    test("analysis metadata carries the product context for the shared knowledge base", () => {
        expect(studioAnalysisMetadata("product_cup", "recognize", { platform: "taobao", category: " 保温杯 ", productName: "雾蓝保温杯" })).toEqual({
            source: "ecommerce-studio",
            studioProductId: "product_cup",
            studioStep: "recognize",
            studioPlatform: "taobao",
            studioCategory: "保温杯",
            studioProductName: "雾蓝保温杯",
            ecommerceCapability: "dossier",
            ecommerceAnalysisFlow: "cap:dossier",
        });
        expect(studioAnalysisMetadata("product_cup", "recognize")).not.toHaveProperty("studioCategory");
    });
});
describe("ecommerce studio runs", () => {
    test("a detail set requires a complete plan; a single output repeats one role", () => {
        const product = cupProduct();
        product.dossier = { ...product.dossier!, family: "apparel" };
        product.brief = { ...product.brief, outputType: "detail-set" };
        expect(() => createStudioRun(product, ids())).toThrow("先按所选");
        const detail = setRun(product, "detail-set").plan;
        expect(detail.kind).toBe("detail");
        expect(detail.shots).toHaveLength(6);
        expect(detail.shots.map((shot) => shot.role)).toContain("detail-model");
        expect(detail.shots.every((shot) => shot.attempts.length === 0)).toBe(true);
        product.brief = { ...product.brief, outputType: "white", count: 3 };
        const white = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(white.kind).toBeUndefined();
        expect(white.shots.map((shot) => [shot.role, shot.title])).toEqual([
            ["main-white", "白底图 1"],
            ["main-white", "白底图 2"],
            ["main-white", "白底图 3"],
        ]);
    });
    test("server payloads are normalized and broken records dropped", () => {
        const product = normalizeStudioProduct({
            id: "product_cup",
            platform: "unknown",
            photos: [{ id: "a", resourceId: "res_a", url: "/api/resources/res_a/file", view: "weird" }, { id: "b" }],
            plans: [
                { id: "plan", kind: "main", shots: [{ id: "s", role: "main-white", attempts: [{ id: "a1", status: "bogus", outputs: [{ resourceId: "res_o", url: "/api/resources/res_o/file" }] }] }] },
                { id: "x", kind: "poster" },
            ],
        })!;
        expect(product.platform).toBe("taobao");
        expect(product.photos).toHaveLength(1);
        expect(product.photos[0].view).toBe("other");
        expect(product.plans).toHaveLength(1);
        expect(product.plans[0].shots[0].attempts[0].status).toBe("failed");
        expect(studioShotPreview(product.plans[0].shots[0])).toBeUndefined();
        expect(normalizeStudioProduct({ name: "no id" })).toBeUndefined();
    });
});

describe("ecommerce studio detail plan", () => {
    const reply = JSON.stringify({
        summary: "先讲一天的饮水，再证明容量，最后收尾。",
        style: "雾蓝灰 #DDE5EC 渐变背景，柔和侧光，细黑体",
        screens: [
            {
                role: "detail-hero",
                layout: "poster",
                eyebrow: "01 ALL DAY CUP",
                title: "首屏",
                purpose: "一眼认出这只杯子",
                visual: "雾蓝渐变背景上，保温杯三分之四侧立，上方三分之一留标题区",
                headline: "一杯装下一整天",
                subline: "500ml 真空保温",
                lines: [],
                facts: ["容量"],
            },
            { role: "detail-spec", title: "参数", purpose: "核对参数", visual: "参数表", headline: "产品参数", lines: ["重量 约 280g"] },
            { role: "detail-scene", title: "通勤", purpose: "带着出门", visual: "清晨地铁站，一只手握着杯身，背景虚化，文字放左上", headline: "通勤随手带", subline: "保温 12 小时", lines: ["约 280g 轻巧", "单手开盖"] },
            { role: "detail-size", title: "容量", purpose: "知道能装多少", visual: "杯子与 A4 纸并排平放，俯拍", headline: "500ml 容量", lines: [] },
            { role: "detail-closeup", layout: "callout", elements: "3 条引线指向杯盖、提环和杯口", title: "杯盖", purpose: "看清杯盖做工", visual: "杯盖微距，侧光勾出边缘", headline: "杯盖细节", lines: ["一键弹盖", "银色提环", "宽口杯身"] },
            { role: "detail-model", layout: "fancy", title: "握持", purpose: "知道拿在手里的样子", visual: "半身人物单手握杯，浅色针织衫，窗边自然光", headline: "单手就能握住", lines: [] },
            { role: "detail-scene", eyebrow: "500ML DESK", title: "办公桌", purpose: "想象放在工位上", visual: "木质办公桌一角，杯子立在笔记本旁，暖色台灯", noText: true },
            { role: "detail-closing", title: "收尾", purpose: "促成下单", visual: "杯子居中，背景回到首屏的雾蓝", headline: "最好的保温杯", lines: ["500ml 大容量"] },
        ],
    });
    const planned = () => {
        const product = { ...cupProduct(), sellerNotes: "500ml 大容量｜一天的饮水一次装够", brief: { ...cupProduct().brief, outputType: "detail-set" as const, detailScreens: 7 } };
        const roles = studioDetailPlanRoles(product);
        const result = parseDetailPlan(reply, product, roles, { id: "plan_1", model: "deepseek", createdAt: "2026-11-01T00:00:00Z" });
        return { product: { ...product, brief: { ...product.brief, detailPlan: result.plan } }, roles, result };
    };

    test("planner composition does not control ordinary-detail rendering or leak into snapshots", () => {
        const { product, roles } = planned();
        const data = JSON.parse(reply);
        data.screens[0].composition = "right";
        data.screens[2].composition = "corner";
        data.screens[4].composition = "invented";
        const result = parseDetailPlan(JSON.stringify(data), product, roles, { id: "design", model: "m", createdAt: "2026-11-01T00:00:00Z" });
        product.brief.detailPlan = result.plan;
        const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(run.shots[0].composition).toBeUndefined();
        expect(run.shots[2].composition).toBeUndefined();
        expect(run.shots[4].composition).toBeUndefined();
        product.runs = [run];
        expect(normalizeStudioProduct(JSON.parse(JSON.stringify(product))).runs[0].shots[0].composition).toBeUndefined();
        const model = compileStudioPrompt({ product, shot: run.shots[0], textMode: "model", model: "gpt-image-2", brief: product.brief, suite: run.suite });
        expect(model.prompt).not.toContain("左图右文");
        expect(model.prompt).not.toContain("构图契约");
        expect(model.prompt).toMatch(/图片模型[^。\n]*(?:最终设计|决定)/);
        const top = compileStudioPrompt({ product, shot: { ...run.shots[0], composition: "top" }, textMode: "model", model: "gpt-image-2", brief: product.brief, suite: run.suite });
        expect(top.prompt).not.toContain("不能把左右分栏改成顶部标题");
        const overlay = compileStudioPrompt({ product, shot: run.shots[0], textMode: "overlay", model: "gpt-image-2", brief: product.brief, suite: run.suite });
        expect(overlay.prompt).not.toContain("左 58%、上 12%");
        expect(result.compositionKinds).toBe(0);
    });

    test("new unplanned poster batches change composition, while retries and white or reference layouts preserve their contract", () => {
        const product = cupProduct();
        product.brief.outputType = "poster";
        product.brief.count = 3;
        const first = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(new Set(first.shots.map((shot) => shot.composition)).size).toBe(3);
        product.runs = [first];
        const next = createStudioRun(product, ids(), "2026-11-02T00:00:00Z");
        expect(next.shots[0].composition).not.toBe(first.shots[0].composition);
        expect(normalizeStudioProduct(JSON.parse(JSON.stringify(product))).runs[0].shots[0].composition).toBe(first.shots[0].composition);
        product.brief.sameLayout = true;
        expect(createStudioRun(product, ids(), "").shots.every((shot) => !shot.composition)).toBe(true);
        product.brief.sameLayout = false;
        product.brief.outputType = "white";
        expect(createStudioRun(product, ids(), "").shots.every((shot) => !shot.composition && !shot.headline)).toBe(true);
    });

    test("replanning asks for another purchase path while targeted revision preserves accepted content", () => {
        const { product, roles, result } = planned();
        product.brief.prep = { asks: [], picked: "chosen", directions: [{ id: "chosen", angle: "户外", positioning: "日常随身", concept: "旧户外场景", palette: [], visual: "旧示例", headline: "旧示例", why: "" }] };
        const alternative = buildDetailPlanPrompt(product, roles, { scope: "detail", alternative: result.plan });
        expect(alternative).toContain("找另一条能用本品证据说明的购买路径");
        expect(alternative).toContain("清晨地铁站");
        expect(alternative).not.toContain("卖家没提意见的部分尽量保留");
        expect(alternative).not.toContain("positioning、concept 照用");
        expect(alternative).not.toContain("旧户外场景");
        const revision = buildDetailPlanPrompt(product, roles, { scope: "detail", previous: result.plan });
        expect(revision).toContain("卖家没提意见的部分尽量保留");
        expect(revision).not.toContain("【换一个设计方向】");
        expect(revision).not.toContain("旧户外场景");
    });

    test("explicit adjustments take precedence over a picked old direction, without restoring omitted old concepts", () => {
        const { product, roles } = planned();
        product.brief.prep = { asks: [], picked: "chosen", directions: [{ id: "chosen", angle: "户外", positioning: "日常随身", tone: "lifestyle", concept: "旧草地风车", palette: [], visual: "旧示例", headline: "旧示例", why: "" }] };
        const meta = { id: "adjusted", model: "m", createdAt: "" };
        expect(parseDetailPlan(reply, product, roles, meta).plan.concept).toBeUndefined();
        product.brief.planNote = "改成时尚杂志静物，去掉风车和旧场景";
        const prompt = buildDetailPlanPrompt(product, roles);
        expect(prompt).toContain("改成时尚杂志静物，去掉风车和旧场景");
        expect(prompt).not.toContain("旧草地风车");
        const omitted = parseDetailPlan(reply, product, roles, meta).plan;
        expect(omitted.concept).toBeUndefined();
        expect(omitted.positioning).toBeUndefined();
        expect(omitted.tone).toBeUndefined();
        const revised = parseDetailPlan(JSON.stringify({ ...JSON.parse(reply), concept: "暖白静物", tone: "editorial" }), product, roles, meta).plan;
        expect(revised.concept).toBeUndefined();
        expect(revised.tone).toBeUndefined();
        product.brief.planNote = "";
        expect(parseDetailPlan(reply, product, roles, meta, { scope: "detail", alternative: revised }).plan.concept).toBeUndefined();
    });

    test("only screens with evidence are offered and accepted; invented numbers are dropped", () => {
        const { product, roles, result } = planned();
        // 材质只有推断、参数只有一条、没有包装：这三种不排；有侧面图和容量，多角度和尺寸可以排。
        expect(roles).toContain("detail-angles");
        expect(roles).toContain("detail-size");
        expect(roles).not.toContain("detail-material");
        expect(roles).not.toContain("detail-spec");
        expect(roles).not.toContain("detail-package");
        const prompt = buildDetailPlanPrompt(product, roles);
        expect(prompt).toContain("detail-angles");
        expect(prompt).not.toContain("detail-spec");
        expect(prompt).toContain("没有确认的信息（不能写进文案，也不能画成参数或数字）：内胆");
        expect(prompt).toContain("容量 500ml");
        expect(prompt).toContain("共 7 屏");
        expect(prompt).toContain("正好交付 7 屏");
        expect(prompt).toContain("缺资料就换一个可诚实展示的用途，不删除整屏");
        expect(result.plan.screens).toHaveLength(7);
        expect(result.plan.screens[0].role).toBe("detail-hero");
        expect(result.plan.screens.map((screen) => screen.role)).toContain("detail-scene");
        expect(result.warnings.some((issue) => issue.field === "role" && /detail-spec/.test(issue.message))).toBe(true);
        expect(result.dropped).toBe(1);
        const commute = result.plan.screens.find((screen) => screen.title === "通勤");
        expect(commute).toMatchObject({ headline: "", subline: "", lines: [] });
        expect(result.plan.screens[0].evidenceRefs).toContain("fact:f_volume");
        const unsupported = JSON.parse(reply);
        unsupported.screens[2].displayContent = "展示杯子的保温 12 小时能力；演示手握杯身";
        const checked = parseDetailPlan(JSON.stringify(unsupported), product, roles, { id: "unsupported", model: "m", createdAt: "" });
        expect(checked.ungrounded).toBeGreaterThanOrEqual(1);
        expect(checked.plan.screens).toHaveLength(7);
        expect(checked.plan.screens[2].displayContent).not.toContain("12 小时");
        expect(result.warnings.length).toBeGreaterThan(0);
        const missing = parseDetailPlan(JSON.stringify({ screens: [{ role: "detail-hero", visual: "x" }] }), product, roles, { id: "p", model: "m", createdAt: "" });
        expect(missing.plan.screens).toHaveLength(7);
        expect(missing.warnings.some((issue) => issue.field === "screens" && /已补入可用的商品展示任务/.test(issue.message))).toBe(true);
        expect(missing.plan.screens.every((screen) => !screen.noText && screen.displayContent?.trim())).toBe(true);
        const short = JSON.stringify({ screens: (JSON.parse(reply) as { screens: unknown[] }).screens.slice(0, 5) });
        const shortResult = parseDetailPlan(short, product, roles, { id: "p", model: "m", createdAt: "" });
        expect(shortResult.plan.screens).toHaveLength(7);
        expect(shortResult.warnings.some((issue) => issue.field === "screens" && /已补入可用的商品展示任务/.test(issue.message))).toBe(true);
        expect(shortResult.plan.screens.every((screen) => !screen.noText && screen.displayContent?.trim())).toBe(true);
        const long = JSON.stringify({ screens: Array.from({ length: 12 }, (_, index) => ({ role: "detail-scene", title: `场景 ${index + 1}`, visual: `场景 ${index + 1} 的画面` })) });
        const longResult = parseDetailPlan(long, product, roles, { id: "p", model: "m", createdAt: "" });
        expect(longResult.plan.screens).toHaveLength(7);
        expect(longResult.dropped).toBe(5);
        expect(longResult.warnings.some((issue) => issue.field === "screens" && /超出用户选择的 7 屏/.test(issue.message))).toBe(true);
    });

    test("a planned detail page drives the run, the shot list and the prompt", () => {
        const { product } = planned();
        const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(run.suite).toMatchObject({ id: "plan_1", name: "按商品策划", style: "" });
        expect(run.shots.map((shot) => shot.title)).toEqual(["首屏", "参数", "通勤", "容量", "杯盖", "握持", "办公桌"]);
        expect(run.shots[0]).toMatchObject({ headline: "", subline: "", purchaseQuestion: "一眼认出这只杯子" });
        expect(run.shots[0].visual).toContain("购买问题：一眼认出这只杯子");
        const compiled = compileStudioPrompt({ product, textMode: run.textMode, shot: run.shots.find((shot) => shot.title === "通勤")!, model: "gpt-image-2", brief: product.brief, suite: run.suite });
        expect(compiled.prompt).toContain("【这一屏的画面】");
        expect(compiled.prompt).toContain("清晨地铁站");
        expect(compiled.prompt).not.toContain("整套视觉规范");
        expect(compiled.prompt).toMatch(/图片模型[^。\n]*最终设计[^。\n]*排版/);
        for (const title of ["【构图与机位】", "【光线】", "【背景与道具】", "【品类要求】"]) expect(compiled.prompt).not.toContain(title);
        expect(compiled.prompt).toContain("不复刻原照摆位");
        const skipped = { ...product, brief: toggleStudioSetEntry(product, "p1") };
        expect(createStudioRun(skipped, ids(), "2026-11-01T00:00:00Z").shots.map((shot) => shot.title)).toEqual(["首屏", "通勤", "容量", "杯盖", "握持", "办公桌"]);
        // 不加文字时策划的文案也不进图。
        const textless = { ...product, brief: { ...product.brief, language: "none" as const } };
        expect(studioActivePlan(textless)).toBeUndefined();
        textless.brief.detailPlan = parseDetailPlan(reply, textless, studioDetailPlanRoles(textless), { id: "textless", model: "m", createdAt: "" }).plan;
        expect(createStudioRun(textless, ids(), "2026-11-01T00:00:00Z").shots.every((shot) => !shot.headline && !shot.lines.length)).toBe(true);
    });

    test("ordinary detail ignores automatic text blocks and gives each screen a display responsibility", () => {
        const { product, roles, result } = planned();
        const hero = result.plan.screens[0];
        const closeup = result.plan.screens.find((screen) => screen.role === "detail-closeup")!;
        const desk = result.plan.screens.find((screen) => screen.title === "办公桌")!;
        expect(hero).toMatchObject({ purchaseQuestion: "一眼认出这只杯子", eyebrow: "" });
        expect(closeup).toMatchObject({ purchaseQuestion: "看清杯盖做工", elements: "", lines: [] });
        expect(desk.eyebrow).toBe("");
        const prompt = buildDetailPlanPrompt(product, roles);
        expect(prompt).toContain("role 只标记内容用途，不锁定版式");
        expect(prompt).not.toContain("【可以用的版式】");
        expect(prompt).not.toContain('"artDirection"');
        expect(prompt).not.toContain('"styleId"');

        const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        const shot = run.shots.find((item) => item.title === "杯盖")!;
        expect(shot.visual).toContain("购买问题：看清杯盖做工");
        const compiled = compileStudioPrompt({ product, textMode: run.textMode, shot, model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt;
        expect(compiled).toContain("杯盖微距");
        expect(compiled).not.toContain("3 条引线指向杯盖、提环和杯口");
        expect(compiled).not.toContain("一键弹盖");
        expect(compiled).toMatch(/图片模型[^。\n]*排版[^。\n]*艺术字[^。\n]*特效/);
        const heroPrompt = compileStudioPrompt({ product, textMode: run.textMode, shot: run.shots[0], model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt;
        expect(heroPrompt).toContain("保温杯三分之四侧立");
        expect(heroPrompt).not.toContain("上方三分之一留标题区");
        expect(heroPrompt).not.toContain("ALL DAY CUP");
        expect(heroPrompt).toContain("平台名、屏序与屏型标记不印入画面");
        expect(heroPrompt).not.toContain("编号圆点");
        const numbered = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, runs: [{ ...run, shots: [{ ...run.shots[0], eyebrow: "01 ALL DAY CUP" }] }] })))!;
        expect(numbered.runs[0].shots[0].eyebrow).toBe("ALL DAY CUP");

        const adjusted = compileStudioPrompt({ product, textMode: run.textMode, shot: { ...shot, adjust: "背景换成浅木纹桌面" }, model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt;
        expect(adjusted).toContain("【这一张的修改要求】\n背景换成浅木纹桌面。");
        const withRun = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, runs: [{ ...run, shots: [{ ...shot, adjust: "背景换成浅木纹桌面" }] }] })))!;
        expect(withRun.runs[0].shots[0]).toMatchObject({ adjust: "背景换成浅木纹桌面", purchaseQuestion: "看清杯盖做工" });
    });

    test("automatic style is left to the image model while a seller preset remains explicit", () => {
        const { product, roles } = planned();
        const auto = { ...product, style: "auto" as const };
        const prompt = buildDetailPlanPrompt(auto, roles);
        expect(prompt).not.toContain('"styleId"');
        expect(prompt).not.toContain("candy（童趣糖果）");
        const picked = parseDetailPlan(JSON.stringify({ ...JSON.parse(reply), styleId: "candy" }), auto, roles, { id: "p2", model: "m", createdAt: "" }).plan;
        expect(picked.styleId).toBeUndefined();
        auto.brief = { ...auto.brief, detailPlan: picked };
        const autoRun = createStudioRun(auto, ids());
        const explicitRun = createStudioRun(product, ids());
        expect(autoRun.styleId).toBeUndefined();
        expect(compileStudioPrompt({ product: auto, shot: autoRun.shots[0], model: "gpt-image-2" }).layers.some((layer) => layer.id === "style")).toBe(false);
        expect(explicitRun.styleId).toBe("mist");
        expect(compileStudioPrompt({ product, shot: explicitRun.shots[0], model: "gpt-image-2" }).layers.find((layer) => layer.id === "style")?.title).toContain("雾感极简");
        expect(parseDetailPlan(JSON.stringify({ ...JSON.parse(reply), styleId: "candy" }), product, roles, { id: "p3", model: "m", createdAt: "" }).plan.styleId).toBeUndefined();
        expect(normalizeStudioProduct({ id: "p_style", style: "auto" })!.style).toBe("auto");
        expect(createStudioProduct("p_new").style).toBe("auto");
    });

    test("plans survive normalization and are only used by the detail set", () => {
        const { product } = planned();
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
        expect(restored.brief.detailPlan?.screens).toHaveLength(7);
        // 读回时只要求至少一屏（主图 5 张、单张图一两张也是合法的策划），一屏都认不出来才当作没有策划。
        expect(normalizeStudioProduct({ ...product, brief: { ...product.brief, detailPlan: { id: "x", screens: [{ role: "detail-hero", visual: "a" }] } } })!.brief.detailPlan?.screens).toHaveLength(1);
        expect(normalizeStudioProduct({ ...product, brief: { ...product.brief, detailPlan: { id: "x", screens: [{ role: "poster", visual: "a" }] } } })!.brief.detailPlan).toBeUndefined();
        const main = { ...product, brief: { ...product.brief, outputType: "main-set" as const } };
        expect(createStudioRun(main, ids(), "2026-11-01T00:00:00Z").suite).toBeUndefined();
        expect(studioAnalysisMetadata("product_cup", "plan", { platform: "taobao" }, STUDIO_DETAIL_PLAN_CAPABILITY)).toMatchObject({ studioStep: "plan", ecommerceCapability: "detail-plan", ecommerceAnalysisFlow: "cap:detail-plan" });
    });
});
describe("ecommerce studio plans for every output type", () => {
    const meta = { id: "plan_x", model: "deepseek", createdAt: "2026-11-01T00:00:00Z" };
    const base = (patch: Partial<StudioProduct["brief"]>) => {
        const product = cupProduct();
        return { ...product, sellerNotes: "500ml 大容量｜一天的饮水一次装够", brief: { ...product.brief, ...patch } };
    };
    const screen = (role: string, title: string, extra: Record<string, unknown> = {}) => ({ role, title, purpose: `${title}的目的`, visual: `${title}的画面`, headline: title, lines: [], ...extra });

    test("the main set is planned as 5 images and the first one is the searchable cover", () => {
        const product = base({ outputType: "main-set" });
        const roles = studioDetailPlanRoles(product, "main");
        // 主图能排主图屏型和几种适合做主图的；多角度要有侧面图，参数只有一条时不排。
        expect(roles).toEqual(expect.arrayContaining(["main-white", "main-selling", "main-angle", "main-flatlay", "detail-seeding", "detail-size"]));
        expect(roles).not.toContain("detail-hero");
        expect(roles).not.toContain("detail-closing");
        const prompt = buildDetailPlanPrompt(product, roles, { scope: "main" });
        expect(prompt).toContain("主图套图，共 5 张");
        expect(prompt).toContain("正好排 5 张：第 1 张是搜索列表里的首图");
        expect(prompt).toMatch(/第 1 张[^。]*最多一行很短的标题/);
        expect(prompt).toContain("第 2–5 张是商品页副图");
        expect(prompt).not.toContain("detail-hero（");
        expect(prompt).not.toContain("整套至少用到 6 种版式");

        // 模型把场景图排在第一张：白底图挪到最前；详情页的屏型不收。
        const reply = JSON.stringify({
            tone: "global-minimal",
            style: "纯白底，细黑体",
            screens: [screen("main-scene", "场景"), screen("main-white", "白底", { noText: true }), screen("detail-hero", "头图"), screen("main-selling", "卖点"), screen("main-angle", "侧面"), screen("detail-seeding", "种草")],
        });
        const result = parseDetailPlan(reply, product, roles, meta, { scope: "main" });
        expect(result.plan.screens).toHaveLength(5);
        expect(result.plan.screens.map((item) => item.role)).toEqual(["main-white", "main-scene", "main-scene", "main-selling", "main-angle"]);
        expect(result.warnings.some((issue) => issue.field === "role" && /detail-hero/.test(issue.message))).toBe(true);
        expect(result.dropped).toBe(1);
        const short = JSON.stringify({ screens: [screen("main-white", "白底"), screen("main-scene", "场景"), screen("main-selling", "卖点")] });
        expect(() => parseDetailPlan(short, product, roles, meta, { scope: "main" })).toThrow("策划结果不完整");

        // 主图套图按主图的策划出，详情页的策划不混进来。
        const plannedProduct = { ...product, brief: { ...product.brief, mainPlan: result.plan } };
        expect(studioActivePlan(plannedProduct)?.id).toBe("plan_x");
        expect(studioActivePlan({ ...plannedProduct, brief: { ...plannedProduct.brief, outputType: "detail-set" } })).toBeUndefined();
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        expect(run.kind).toBe("main");
        expect(run.suite).toMatchObject({ name: "按商品策划", tone: "global-minimal" });
        expect(run.shots.map((shot) => shot.title)).toEqual(["白底", "场景", "头图", "卖点", "侧面"]);
        expect(normalizeStudioProduct(JSON.parse(JSON.stringify(plannedProduct)))!.brief.mainPlan?.screens).toHaveLength(5);
    });

    test("single images can be planned and the plan only applies to the same selection", () => {
        const product = base({ outputType: "mix", mix: ["seeding", "compare"], count: 1 });
        const targets = studioSingleTargets(product.brief);
        expect(targets).toEqual([
            { type: "seeding", count: 1 },
            { type: "compare", count: 1 },
        ]);
        const roles = studioPlanTargetRoles(targets);
        expect(roles).toEqual(["detail-seeding", "detail-compare"]);
        const prompt = buildDetailPlanPrompt(product, roles, { scope: "single", targets });
        expect(prompt).toContain("2 张独立成品图（种草图 1 张、对比图 1 张）");
        expect(prompt).toContain("role 顺序：detail-seeding、detail-compare");
        expect(prompt).not.toContain("【可以排的屏型】");

        // 模型写错的屏型按位置改回用户选的类型；少给一张就要求重试。
        const reply = JSON.stringify({ tone: "lifestyle", style: "暖白底", screens: [screen("detail-scene", "窗边"), screen("main-white", "冷热对比")] });
        const result = parseDetailPlan(reply, product, roles, meta, { scope: "single", targets });
        expect(result.plan.screens.map((item) => item.role)).toEqual(["detail-seeding", "detail-compare"]);
        expect(result.plan.targets).toEqual(targets);
        expect(() => parseDetailPlan(JSON.stringify({ screens: [screen("detail-seeding", "窗边")] }), product, roles, meta, { scope: "single", targets })).toThrow("策划结果不完整");

        const plannedProduct = { ...product, brief: { ...product.brief, singlePlan: result.plan } };
        expect(studioSetEntries(plannedProduct).map((entry) => entry.title)).toEqual(["窗边", "冷热对比"]);
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        expect(run.kind).toBeUndefined();
        expect(run.suite).toMatchObject({ name: "按商品策划", tone: "lifestyle" });
        expect(studioRunTitle(run)).toBe("种草图 · 对比图 · 按商品策划");
        expect(run.shots.map((shot) => [shot.role, shot.title])).toEqual([
            ["detail-seeding", "窗边"],
            ["detail-compare", "冷热对比"],
        ]);
        // 改了数量：策划和选择对不上，按类型直接出，不用旧策划。
        const changed = { ...plannedProduct, brief: { ...plannedProduct.brief, count: 2 } };
        expect(studioActivePlan(changed)).toBeUndefined();
        expect(studioSetEntries(changed)).toEqual([]);
        expect(createStudioRun(changed, ids(), "2026-11-01T00:00:00Z").shots.map((shot) => shot.role)).toEqual(["detail-seeding", "detail-seeding", "detail-compare", "detail-compare"]);
        // 读回时保留带选择的单张图策划；没有选择记录的当作没有策划。
        expect(normalizeStudioProduct(JSON.parse(JSON.stringify(plannedProduct)))!.brief.singlePlan?.targets).toEqual(targets);
        const { targets: _targets, ...untargeted } = result.plan;
        expect(normalizeStudioProduct({ ...plannedProduct, brief: { ...plannedProduct.brief, singlePlan: untargeted } })!.brief.singlePlan).toBeUndefined();
    });

    test("seller adjustments reach both models without adopting draft tone or copy", () => {
        const product = base({ outputType: "detail-set", planNote: "多放生活场景，少放参数" });
        const roles = studioDetailPlanRoles(product);
        const previous = {
            ...meta,
            summary: "上一版思路",
            style: "雾蓝",
            screens: [{ role: "detail-hero" as const, layout: "poster" as const, title: "旧首屏", purpose: "", visual: "旧画面", elements: "", eyebrow: "", headline: "旧标题", subline: "", lines: [], facts: [] }],
        };
        const prompt = buildDetailPlanPrompt(product, roles, { scope: "detail", previous });
        expect(prompt).toContain("【卖家对这次策划的补充调整】");
        expect(prompt).toContain("多放生活场景，少放参数");
        expect(prompt).toContain("【上一版策划】");
        expect(prompt).toContain("旧画面");
        expect(prompt).not.toContain("旧标题");
        expect(prompt).not.toContain('"artDirection"');
        expect(buildDetailPlanPrompt({ ...product, brief: { ...product.brief, planNote: "" } }, roles)).not.toContain("补充调整】");

        const screens = Array.from({ length: 10 }, (_, index) => screen(index === 0 ? "detail-hero" : index === 9 ? "detail-closing" : "detail-scene", `第${index + 1}屏`));
        screens[1] = { ...screens[1], headline: "居家神器" };
        const result = parseDetailPlan(JSON.stringify({ tone: "editorial", style: "高对比黑白", screens }), product, roles, meta);
        expect(result.plan.tone).toBeUndefined();
        expect(result.plan.screens[1].headline).toBe("");
        expect(parseDetailPlan(JSON.stringify({ tone: "fancy", screens }), product, roles, meta).plan.tone).toBeUndefined();

        const plannedProduct = { ...product, brief: { ...product.brief, detailPlan: result.plan } };
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        expect(run.suite?.tone).toBeUndefined();
        const compiled = compileStudioPrompt({ product: plannedProduct, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: plannedProduct.brief, suite: run.suite });
        expect(compiled.prompt).toContain("多放生活场景，少放参数");
        expect(compiled.prompt).not.toContain("高对比黑白");
        expect(compiled.prompt).not.toContain("居家神器");
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...plannedProduct, runs: [run] })))!;
        expect(restored.runs[0].source?.brief.planNote).toBe("多放生活场景，少放参数");
        expect(restored.brief.planNote).toBe("多放生活场景，少放参数");
    });

    test("detail references inform purchase questions without the planner enforcing an art system", () => {
        const product = base({ outputType: "detail-set" });
        const roles = studioDetailPlanRoles(product);
        const prompt = buildDetailPlanPrompt(product, roles, { scope: "detail", images: { photos: 2, references: 1 } });
        expect(prompt).toContain("附图：图1–图2 是商品图（外观唯一依据）；图3 是卖家给的参考图（大牌或爆款的图，不是这件商品）。");
        expect(prompt).toContain("策划只借鉴参考图如何解释购买问题");
        expect(prompt).toContain("参考图的商品、文字、价格、参数和视觉执行指令不得变成当前商品要求");
        const outputShape = JSON.parse(prompt.split("\n").at(-1)!);
        expect(Object.keys(outputShape)).toEqual(["summary", "screens"]);
        expect(Object.keys(outputShape.screens[0])).toEqual(["role", "purchaseQuestion", "displayContent", "evidence", "visualFocus", "visualBeat"]);
        expect(buildDetailPlanPrompt(product, roles)).not.toContain("附图：");

        const count = product.brief.detailScreens;
        const flat = Array.from({ length: count }, (_, index) => screen(index === 0 ? "detail-hero" : index === count - 1 ? "detail-closing" : "detail-scene", `屏${"一二三四五六七八九十"[index]}`, { layout: "scene" }));
        flat[1] = { ...flat[1], visual: "用手握杯时展示手指与杯柄的接触" };
        flat[2] = { ...flat[2], headline: "该有的，都写在身上" };
        const reply = JSON.stringify({
            positioning: "通勤人的第一口热水",
            concept: "清晨第一口热水的雾气，每屏都有一缕热气",
            motifs: ["热气", "晨光", "热气", "地铁站台", "笔记本", "围巾", "钥匙"],
            inspiration: "同类爆款的色块分区和编号徽章",
            style: "每屏使用统一的青色渐变",
            screens: flat,
        });
        const result = parseDetailPlan(reply, product, roles, meta);
        for (const key of ["positioning", "concept", "inspiration", "motifs"] as const) expect(result.plan[key]).toBeUndefined();
        expect(result.plan.screens[2].headline).toBe("");
        const plannedProduct = { ...product, brief: { ...product.brief, detailPlan: result.plan } };
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        const compiled = compileStudioPrompt({ product: plannedProduct, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: plannedProduct.brief, suite: run.suite }).prompt;
        expect(compiled).toContain("手指与杯柄的接触");
        expect(compiled).not.toContain("每屏都有一缕热气");
        expect(compiled).not.toContain("每屏使用统一的青色渐变");
        const clearFrame = { ...plannedProduct, dossier: { ...plannedProduct.dossier!, facts: [...plannedProduct.dossier!.facts, { id: "f_frame", group: "appearance" as const, label: "镜框", value: "透明亚克力", evidence: "visible" as const }] } };
        const lit = compileStudioPrompt({ product: clearFrame, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: clearFrame.brief, suite: run.suite }).prompt;
        expect(lit).not.toContain("透明部分用背光或侧逆光打亮");
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...plannedProduct, runs: [run] })))!;
        expect(restored.brief.detailPlan?.screens[1].displayContent).toContain("手指与杯柄的接触");
        expect(restored.runs[0].suite?.concept).toBeUndefined();
    });

    test("pasted html line breaks are cleaned and unplanned shots get material lighting", () => {
        // 卖点里混进来的 <br/> 换成换行：不进图上的文案，也不进提示词。
        expect(studioInfoPoints("OEM/ODM定制加工<br/>卡波姆甘油三乙醇胺<br>二类医疗器械认证").map((point) => point.title)).toEqual(["OEM/ODM定制加工", "卡波姆甘油三乙醇胺", "二类医疗器械认证"]);
        const pasted = normalizeStudioProduct({ ...base({ outputType: "poster" }), sellerNotes: "保温 12 小时<br/>一键弹盖" })!;
        expect(pasted.sellerNotes).toBe("保温 12 小时\n一键弹盖");
        // 没策划的单张图按商品材质补布光。
        const clear = {
            ...base({ outputType: "poster", count: 1 }),
            dossier: { ...cupProduct().dossier!, facts: [...cupProduct().dossier!.facts, { id: "f_lid", group: "material" as const, label: "杯盖", value: "透明亚克力", evidence: "visible" as const }] },
        };
        const run = createStudioRun(clear, ids(), "2026-11-01T00:00:00Z");
        const prompt = compileStudioPrompt({ product: clear, textMode: run.textMode, shot: run.shots[0], model: "gpt-image-2", brief: clear.brief }).prompt;
        expect(prompt).toContain("透明部分用背光或侧逆光打亮");
        expect(prompt).not.toContain("<br");
    });

    test("new single types each map to their own shot", () => {
        const expected: [StudioProduct["brief"]["outputType"], string, string][] = [
            ["seeding", "detail-seeding", "种草图"],
            ["ugc", "detail-ugc", "随手拍"],
            ["compare", "detail-compare", "对比图"],
            ["steps", "detail-steps", "使用步骤"],
            ["collocation", "detail-collocation", "搭配图"],
            ["flatlay", "main-flatlay", "平铺图"],
            ["campaign", "detail-campaign", "活动海报"],
        ];
        for (const [outputType, role, label] of expected) {
            const product = base({ outputType, count: 1 });
            const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
            expect(run.shots.map((shot) => [shot.role, shot.title])).toEqual([[role, label]]);
            expect(compileStudioPrompt({ product, textMode: run.textMode, shot: run.shots[0], model: "gpt-image-2", brief: product.brief }).prompt).toContain("【商品真值");
        }
    });
});
describe("ecommerce studio agent fields", () => {
    test("server revision and agent generation requests survive normalization", () => {
        const normalized = normalizeStudioProduct({ id: "p_agent", revision: 7, pendingGeneration: { id: "req1", kind: "detail", shotIds: ["s1", 3, ""], note: "先出头图", source: "agent", createdAt: "2026-11-01T00:00:00.000Z" } });
        expect(normalized?.revision).toBe(7);
        expect(normalized?.pendingGeneration).toEqual({ id: "req1", kind: "detail", shotIds: ["s1"], note: "先出头图", source: "agent", createdAt: "2026-11-01T00:00:00.000Z" });
        for (const broken of [{ id: "req2", kind: "poster", shotIds: ["s1"] }, { id: "req3", kind: "main", shotIds: [] }, "req4"]) {
            expect(normalizeStudioProduct({ id: "p_agent", pendingGeneration: broken })?.pendingGeneration).toBeUndefined();
        }
        expect(normalizeStudioProduct({ id: "p_agent", revision: -2 })?.revision).toBe(0);
        expect(createStudioProduct("p_new").revision).toBe(0);
    });
});

describe("ecommerce studio typesetting", () => {
    const measure = (text: string, size: number) => text.length * size;

    test("wraps Chinese by character and keeps latin words together", () => {
        expect(wrapStudioText("一杯装下一整天", 4, (value) => value.length)).toEqual(["一杯装下", "一整天"]);
        expect(wrapStudioText("500ml cup", 6, (value) => value.length)).toEqual(["500ml", "cup"]);
    });

    test("lays text inside the zone and shrinks to fit", () => {
        const ops = planStudioTypeset({
            canvas: { width: 1000, height: 1000 },
            zone: { x: 0.1, y: 0.1, width: 0.8, height: 0.3, align: "center", vAlign: "top" },
            content: { headline: "一杯装下一整天", subline: "500ml 真空保温杯", lines: ["容量｜500ml"] },
            measure,
        });
        expect(ops.length).toBeGreaterThan(2);
        expect(ops.every((op) => op.x === 500 && op.align === "center")).toBe(true);
        expect(ops[0]).toMatchObject({ text: "一杯装下一整天", weight: 700, tone: "ink" });
        const last = ops[ops.length - 1];
        expect(last.y + last.size).toBeLessThanOrEqual(100 + 300 + 1);
    });
});

describe("ecommerce studio image size options", () => {
    // 与 GPT Image 2 的能力配置一致：质量 auto/low/medium/high，尺寸按 1K/2K/4K 三档预设，允许自定义尺寸。
    const presets = [
        ["1k", "1:1", 1024, 1024],
        ["1k", "3:4", 1024, 1360],
        ["2k", "1:1", 2048, 2048],
        ["2k", "3:4", 1728, 2304],
        ["4k", "1:1", 2880, 2880],
        ["4k", "3:4", 2448, 3264],
    ].map(([tier, ratio, width, height]) => ({ tier: tier as "1k", ratio: ratio as string, width: width as number, height: height as number, size: `${width}x${height}` }));
    const base = defaultImageCapabilityConfig();
    const profile = {
        ...base,
        size: { ...base.size, parameter: "size" as const, values: presets.map((preset) => preset.size), default: "1024x1360", allowCustom: true, presets },
        quality: { supported: true, values: ["auto", "low", "medium", "high"], default: "auto" },
        resolution: { ...base.resolution, supported: false },
    };

    test("quality and resolution are chosen separately and the size follows the tier", () => {
        expect(studioQualityOptions(profile).map((option) => option.value)).toEqual(["auto", "low", "medium", "high"]);
        expect(studioResolutionOptions(profile).map((option) => option.label)).toEqual(["1K", "2K", "4K"]);
        // 没选过清晰度时用 1K；选了就按选的档位给具体尺寸，质量照常写进 quality。
        expect(studioEffectiveResolution(profile, "")).toBe("1k");
        expect(studioImageRequest(profile, "high", "3:4", "")).toEqual({ aspectRatio: "3:4", imageSettings: { quality: "high", size: "1024x1360" } });
        expect(studioImageRequest(profile, "high", "3:4", "2k").imageSettings.size).toBe("1728x2304");
        expect(studioImageRequest(profile, "auto", "1:1", "4k").imageSettings.size).toBe("2880x2880");
        expect(studioRatioOptions(profile, "auto", "1k")).toEqual(["1:1", "3:4"]);
        // 按参数声明的模型（后台模型配置的写法）：画布只给默认档位，生图台按模型声明的尺寸取值放开 2K、4K。
        const declared = { ...profile, parameters: [], size: { ...profile.size, allowCustom: false } };
        expect(studioResolutionOptions(declared).map((option) => option.value)).toEqual(["1k", "2k", "4k"]);
        expect(studioImageRequest(declared, "high", "3:4", "2k").imageSettings).toEqual({ quality: "high", size: "1728x2304" });
        // 质量只有 auto 的渠道：「质量」选的是尺寸档位，没选过时用 1K（即使模型默认尺寸在别的档位），选了 2K 就按 2K。
        const tierOnly = { ...profile, size: { ...profile.size, default: "2048x2048" }, quality: { supported: true, values: ["auto"], default: "auto" } };
        expect(studioQualityOptions(tierOnly).map((option) => option.value)).toEqual(["1k", "2k", "4k"]);
        expect(studioImageRequest(tierOnly, "", "3:4").imageSettings).toEqual({ size: "1024x1360" });
        expect(studioImageRequest(tierOnly, "2k", "3:4").imageSettings).toEqual({ size: "1728x2304" });
        // 没有尺寸档位的模型不出现清晰度。
        expect(studioResolutionOptions({ ...profile, size: { ...profile.size, presets: presets.filter((preset) => preset.tier === "1k") } })).toEqual([]);
    });

    test("a custom ratio becomes a computed size when the model allows custom sizes", () => {
        expect(studioRatioValid("3:5")).toBe(true);
        expect(studioRatioValid("1:4")).toBe(false);
        expect(studioRatioValid("0:3")).toBe(false);
        expect(studioImageRequest(profile, "auto", "3:5", "2k").aspectRatio).toBe("3:5");
        const custom = studioImageRequest(profile, "auto", "3:5", "2k").imageSettings.size!;
        const [width, height] = custom.split("x").map(Number);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
        expect(Math.abs(width / height - 3 / 5)).toBeLessThan(0.02);
        // 不许自定义尺寸的模型落到最接近的预设比例。
        const fixed = studioImageRequest({ ...profile, size: { ...profile.size, allowCustom: false } }, "auto", "3:5", "2k");
        expect(fixed).toEqual({ aspectRatio: "3:4", imageSettings: { quality: "auto", size: "1728x2304" } });
        // 表单读回时自定义比例保留，越界的回到自动。
        expect(normalizeStudioProduct({ id: "p_ratio", brief: { ratio: "3:5", resolution: "4k" } })!.brief).toMatchObject({ ratio: "3:5", resolution: "4k" });
        expect(normalizeStudioProduct({ id: "p_ratio", brief: { ratio: "1:5", resolution: "8k" } })!.brief).toMatchObject({ ratio: "auto", resolution: "" });
    });
});

describe("ecommerce studio template isolation", () => {
    const suite = {
        id: "suite_sleepwear",
        name: "睡衣模板",
        source: "library" as const,
        kind: "detail" as const,
        category: "服饰",
        style: "柔和留白",
        shots: [{ title: "首屏", duty: "完整商品与标题" }],
    };

    test("switching away from a template clears its snapshot and plan", () => {
        const brief = {
            ...createStudioProduct("template_switch").brief,
            outputType: "template-set" as const,
            suite,
            templatePlan: { id: "template_plan", suiteId: suite.id, screens: [{ role: "detail-hero" as const, visual: "旧模板画面" }] },
        };
        const next = pickStudioSetType(brief, "detail-set");
        expect(next.outputType).toBe("detail-set");
        expect(next.suite).toBeUndefined();
        expect(next.templatePlan).toBeUndefined();
    });

    test("normalizing legacy non-template data drops stale template fields", () => {
        const restored = normalizeStudioProduct({
            id: "legacy_template_switch",
            brief: {
                outputType: "main-set",
                suite,
                templatePlan: { id: "template_plan", suiteId: suite.id, screens: [{ role: "detail-hero", visual: "旧模板画面" }] },
            },
        })!;
        expect(restored.brief.suite).toBeUndefined();
        expect(restored.brief.templatePlan).toBeUndefined();
    });

    test("run source never carries an old template into another output type", () => {
        const product = createStudioProduct("source_template_switch");
        product.brief = {
            ...product.brief,
            outputType: "detail-set",
            suite,
            templatePlan: { id: "template_plan", suiteId: suite.id, screens: [{ role: "detail-hero" as const, visual: "旧模板画面" }] },
        };
        const source = studioGenerationSource(product);
        expect(source.brief.outputType).toBe("detail-set");
        expect(source.brief.suite).toBeUndefined();
        expect(source.brief.templatePlan).toBeUndefined();
    });
});
