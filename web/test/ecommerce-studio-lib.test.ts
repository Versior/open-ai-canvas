import { describe, expect, test } from "bun:test";
import { STUDIO_DETAIL_PLAN_CAPABILITY, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { buildFillPrompt, buildRecognitionPrompt, extractStudioJson, parseFill, parseRecognition, studioAnalysisMetadata } from "@/lib/ecommerce-studio/dossier-tasks";
import { compileStudioPrompt, studioModelAdapter, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { createStudioProduct, normalizeStudioProduct, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { createStudioRun, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
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
    return { product: prepared, plan: createStudioRun(prepared, ids(), "2026-11-01T00:00:00Z") };
}

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

    test("selling image writes exact copy in model mode and leaves a clean zone in overlay mode", () => {
        const { product, plan } = setRun(cupProduct(), "main-set");
        const shot = plan.shots.find((item) => item.role === "main-selling")!;
        expect(shot.headline).toBe("500ml 大容量");
        const model = compileStudioPrompt({ product, plan, shot, model: "doubao-seedream-5-0" });
        expect(model.textMode).toBe("model");
        expect(model.prompt).toContain("「500ml 大容量」");
        expect(model.layers.find((layer) => layer.id === "style")?.text).toContain("雾蓝灰 #DDE5EC");
        const overlay = compileStudioPrompt({ product, plan: { ...plan, textMode: "overlay" }, shot, model: "gpt-image-2" });
        expect(overlay.prompt).not.toContain("「500ml 大容量」");
        expect(overlay.prompt).toContain("留给后期排字");
    });

    test("weak text models fall back to overlay typesetting", () => {
        const { product, plan } = setRun(cupProduct(), "main-set");
        const shot = plan.shots.find((item) => item.role === "main-selling")!;
        const compiled = compileStudioPrompt({ product, plan, shot, model: "flux-1.1-pro" });
        expect(studioModelAdapter("flux-1.1-pro").textRendering).toBe("weak");
        expect(compiled.textMode).toBe("overlay");
        expect(compiled.textModeNotice).toContain("程序排字");
    });

    test("long prompts drop decorative layers first and refuse impossible budgets", () => {
        const { product, plan } = setRun(cupProduct(), "detail-set");
        const shot = plan.shots[0];
        const full = compileStudioPrompt({ product, plan, shot, model: "gpt-image-2" });
        const tight = compileStudioPrompt({ product, plan, shot, model: "gpt-image-2", maxChars: full.prompt.length - 40 });
        expect(tight.trimmed[0]).toBe("quality");
        expect(tight.prompt.length).toBeLessThanOrEqual(full.prompt.length - 40);
        expect(tight.prompt).toContain("商品真值");
        expect(tight.prompt).toContain("这张图做什么");
        // 商品真值和这张图做什么是必需层，再紧的预算也不裁；放不下时直接拒绝。
        expect(tight.trimmed).not.toContain("truth");
        expect(tight.trimmed).not.toContain("goal");
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
        const prompt = buildFillPrompt({ photos: product.photos, platformName: "淘宝", sellerNotes: "容量 500ml", brand: "岚屿" });
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
    test("a detail set follows the category sequence; a single output repeats one role", () => {
        const product = cupProduct();
        product.dossier = { ...product.dossier!, family: "apparel" };
        product.brief = { ...product.brief, outputType: "detail-set" };
        const detail = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(detail.kind).toBe("detail");
        expect(detail.shots).toHaveLength(10);
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
            { role: "detail-hero", title: "首屏", purpose: "一眼认出这只杯子", visual: "雾蓝渐变背景上，保温杯三分之四侧立，上方三分之一留标题区", headline: "一杯装下一整天", subline: "500ml 真空保温", lines: [], facts: ["容量"] },
            { role: "detail-spec", title: "参数", purpose: "核对参数", visual: "参数表", headline: "产品参数", lines: ["重量 约 280g"] },
            { role: "detail-scene", title: "通勤", purpose: "带着出门", visual: "清晨地铁站，一只手握着杯身，背景虚化，文字放左上", headline: "通勤随手带", subline: "保温 12 小时", lines: ["约 280g 轻巧", "单手开盖"] },
            { role: "detail-size", title: "容量", purpose: "知道能装多少", visual: "杯子与 A4 纸并排平放，俯拍", headline: "500ml 容量", lines: [] },
            { role: "detail-closing", title: "收尾", purpose: "促成下单", visual: "杯子居中，背景回到首屏的雾蓝", headline: "最好的保温杯", lines: ["500ml 大容量"] },
        ],
    });
    const planned = () => {
        const product = { ...cupProduct(), sellerNotes: "500ml 大容量｜一天的饮水一次装够", brief: { ...cupProduct().brief, outputType: "detail-set" as const } };
        const roles = studioDetailPlanRoles(product);
        const result = parseDetailPlan(reply, product, roles, { id: "plan_1", model: "deepseek", createdAt: "2026-11-01T00:00:00Z" });
        return { product: { ...product, brief: { ...product.brief, detailPlan: result.plan } }, roles, result };
    };

    test("only screens with evidence are offered and accepted; invented numbers are dropped", () => {
        const { product, roles, result } = planned();
        // 材质只有推断、参数只有一条、没有包装：这三种不排；有侧面图和容量，多角度和尺寸可以排。
        expect(roles).toContain("detail-angles");
        expect(roles).toContain("detail-size");
        expect(roles).not.toContain("detail-material");
        expect(roles).not.toContain("detail-spec");
        expect(roles).not.toContain("detail-package");
        const prompt = buildDetailPlanPrompt(product, roles);
        expect(prompt).toContain("detail-angles（多角度）");
        expect(prompt).not.toContain("detail-spec（");
        expect(prompt).toContain("没有确认的信息（不能写进文案，也不能画成参数或数字）：内胆");
        expect(prompt).toContain("容量 500ml");
        expect(result.plan.screens.map((screen) => screen.role)).toEqual(["detail-hero", "detail-scene", "detail-size", "detail-closing"]);
        expect(result.dropped).toBe(1);
        expect(result.ungrounded).toBe(2);
        expect(result.plan.screens[1]).toMatchObject({ subline: "", lines: ["单手开盖"] });
        expect(result.plan.screens[0].subline).toBe("500ml 真空保温");
        expect(result.issues.some((issue) => issue.term.includes("最"))).toBe(true);
        expect(() => parseDetailPlan(JSON.stringify({ screens: [{ role: "detail-hero", visual: "x" }] }), product, roles, { id: "p", model: "m", createdAt: "" })).toThrow("策划结果不完整");
    });

    test("a planned detail page drives the run, the shot list and the prompt", () => {
        const { product } = planned();
        const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(run.suite).toEqual({ id: "plan_1", name: "按商品策划", style: "雾蓝灰 #DDE5EC 渐变背景，柔和侧光，细黑体" });
        expect(run.shots.map((shot) => shot.title)).toEqual(["首屏", "通勤", "容量", "收尾"]);
        expect(run.shots[0]).toMatchObject({ headline: "一杯装下一整天", subline: "500ml 真空保温" });
        expect(run.shots[0].visual).toContain("这一屏要让买家明白：一眼认出这只杯子");
        const compiled = compileStudioPrompt({ product, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: product.brief, suite: run.suite });
        expect(compiled.prompt).toContain("【这一屏的画面】");
        expect(compiled.prompt).toContain("清晨地铁站");
        expect(compiled.prompt).toContain("整套视觉规范「按商品策划」");
        expect(compiled.prompt).toContain("按「这一屏的画面」里安排的文字位置");
        for (const title of ["【构图与机位】", "【光线】", "【背景与道具】"]) expect(compiled.prompt).not.toContain(title);
        const skipped = { ...product, brief: toggleStudioSetEntry(product, "p1") };
        expect(createStudioRun(skipped, ids(), "2026-11-01T00:00:00Z").shots.map((shot) => shot.title)).toEqual(["首屏", "容量", "收尾"]);
        // 不加文字时策划的文案也不进图。
        const textless = { ...product, brief: { ...product.brief, language: "none" as const } };
        expect(createStudioRun(textless, ids(), "2026-11-01T00:00:00Z").shots.every((shot) => !shot.headline && !shot.lines.length)).toBe(true);
    });

    test("plans survive normalization and are only used by the detail set", () => {
        const { product } = planned();
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
        expect(restored.brief.detailPlan?.screens).toHaveLength(4);
        expect(normalizeStudioProduct({ ...product, brief: { ...product.brief, detailPlan: { id: "x", screens: [{ role: "detail-hero", visual: "a" }] } } })!.brief.detailPlan).toBeUndefined();
        const main = { ...product, brief: { ...product.brief, outputType: "main-set" as const } };
        expect(createStudioRun(main, ids(), "2026-11-01T00:00:00Z").suite).toBeUndefined();
        expect(studioAnalysisMetadata("product_cup", "plan", { platform: "taobao" }, STUDIO_DETAIL_PLAN_CAPABILITY)).toMatchObject({ studioStep: "plan", ecommerceCapability: "detail-plan", ecommerceAnalysisFlow: "cap:detail-plan" });
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
