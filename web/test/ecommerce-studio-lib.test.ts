import { describe, expect, test } from "bun:test";
import { STUDIO_DETAIL_PLAN_CAPABILITY, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, studioPlanTargetRoles } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { buildFillPrompt, buildRecognitionPrompt, extractStudioJson, parseFill, parseRecognition, studioAnalysisMetadata } from "@/lib/ecommerce-studio/dossier-tasks";
import { compileStudioPrompt, studioModelAdapter, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { createStudioProduct, normalizeStudioProduct, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { createStudioRun, studioActivePlan, studioRunTitle, studioSetEntries, studioSingleTargets, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { studioInfoPoints, studioRatioValid } from "@/lib/ecommerce-studio/brief";
import { studioEffectiveResolution, studioImageRequest, studioQualityOptions, studioRatioOptions, studioResolutionOptions } from "@/lib/ecommerce-studio/image-options";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { studioProductStyle } from "@/lib/ecommerce-studio/shot-specs";
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
        // 详情页固定 10 屏：要求模型正好排 10 屏，屏型可以重复，先分析买家关心什么。
        expect(prompt).toContain("共 10 屏");
        expect(prompt).toContain("正好排 10 屏");
        expect(prompt).toContain("屏型可以重复使用");
        expect(prompt).toContain("买这件商品的人下单前最关心什么");
        expect(prompt).not.toContain("信息少就少排");
        expect(result.plan.screens.map((screen) => screen.role)).toEqual(["detail-hero", "detail-scene", "detail-size", "detail-closeup", "detail-model", "detail-scene", "detail-closing"]);
        expect(result.dropped).toBe(1);
        expect(result.ungrounded).toBe(2);
        expect(result.plan.screens[1]).toMatchObject({ subline: "", lines: ["单手开盖"] });
        expect(result.plan.screens[0].subline).toBe("500ml 真空保温");
        expect(result.issues.some((issue) => issue.term.includes("最"))).toBe(true);
        expect(() => parseDetailPlan(JSON.stringify({ screens: [{ role: "detail-hero", visual: "x" }] }), product, roles, { id: "p", model: "m", createdAt: "" })).toThrow("策划结果不完整");
        // 去掉依据不够的屏后不到 6 屏，也要求重新策划。
        const short = JSON.stringify({ screens: (JSON.parse(reply) as { screens: unknown[] }).screens.slice(0, 5) });
        expect(() => parseDetailPlan(short, product, roles, { id: "p", model: "m", createdAt: "" })).toThrow("策划结果不完整");
        // 多给的屏只收前 10 屏。
        const long = JSON.stringify({ screens: Array.from({ length: 12 }, (_, index) => ({ role: "detail-scene", title: `场景 ${index + 1}`, visual: `场景 ${index + 1} 的画面` })) });
        expect(parseDetailPlan(long, product, roles, { id: "p", model: "m", createdAt: "" }).plan.screens).toHaveLength(10);
    });

    test("a planned detail page drives the run, the shot list and the prompt", () => {
        const { product } = planned();
        const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        expect(run.suite).toEqual({ id: "plan_1", name: "按商品策划", style: "雾蓝灰 #DDE5EC 渐变背景，柔和侧光，细黑体" });
        expect(run.shots.map((shot) => shot.title)).toEqual(["首屏", "通勤", "容量", "杯盖", "握持", "办公桌", "收尾"]);
        expect(run.shots[0]).toMatchObject({ headline: "一杯装下一整天", subline: "500ml 真空保温" });
        expect(run.shots[0].visual).toContain("这一屏要让买家明白：一眼认出这只杯子");
        const compiled = compileStudioPrompt({ product, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: product.brief, suite: run.suite });
        expect(compiled.prompt).toContain("【这一屏的画面】");
        expect(compiled.prompt).toContain("清晨地铁站");
        expect(compiled.prompt).toContain("整套视觉规范「按商品策划」");
        expect(compiled.prompt).toContain("按「这一屏的画面」里的版式和文字位置排");
        for (const title of ["【构图与机位】", "【光线】", "【背景与道具】"]) expect(compiled.prompt).not.toContain(title);
        const skipped = { ...product, brief: toggleStudioSetEntry(product, "p1") };
        expect(createStudioRun(skipped, ids(), "2026-11-01T00:00:00Z").shots.map((shot) => shot.title)).toEqual(["首屏", "容量", "杯盖", "握持", "办公桌", "收尾"]);
        // 不加文字时策划的文案也不进图。
        const textless = { ...product, brief: { ...product.brief, language: "none" as const } };
        expect(createStudioRun(textless, ids(), "2026-11-01T00:00:00Z").shots.every((shot) => !shot.headline && !shot.lines.length)).toBe(true);
    });

    test("each screen gets a layout, info elements and a design system", () => {
        const { product, roles, result } = planned();
        const [hero, , , closeup, model, desk] = result.plan.screens;
        // 小标题前面的序号去掉：详情页是一张长图，每屏带「01」就像页码。
        expect(hero).toMatchObject({ layout: "poster", eyebrow: "ALL DAY CUP" });
        expect(closeup).toMatchObject({ layout: "callout", elements: "3 条引线指向杯盖、提环和杯口", lines: ["一键弹盖", "银色提环", "宽口杯身"] });
        // 不认识的版式按屏型补；带了数字的英文小标题不收。
        expect(model.layout).toBe("scene");
        expect(desk.eyebrow).toBe("");
        const prompt = buildDetailPlanPrompt(product, roles);
        expect(prompt).toContain("【可以用的版式】");
        expect(prompt).toContain("icons（图标卖点）");
        expect(prompt).toContain("整套至少用到 6 种版式");
        expect(prompt).toContain("字体（中文标题的字重和气质");
        expect(prompt).toContain("以「雾感极简」为基础");
        expect(prompt).not.toContain('"styleId"');

        // 出图：版式和信息元素进画面层，标签按版式写成引线标签，允许图标、引线这类设计元素。
        const run = createStudioRun(product, ids(), "2026-11-01T00:00:00Z");
        const shot = run.shots[3];
        expect(shot).toMatchObject({ layout: "callout" });
        expect(shot.visual).toContain("版式「引线标注」");
        expect(shot.visual).toContain("信息元素：3 条引线指向杯盖、提环和杯口");
        const compiled = compileStudioPrompt({ product, textMode: run.textMode, shot, model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt;
        expect(compiled).toContain("引线标签（每条引线末端一条，指向标签说的那个部位）：「一键弹盖」 「银色提环」 「宽口杯身」");
        expect(compiled).toContain("可以有图标、细线、引线");
        expect(compiled).toContain("整张是排过版的电商画面");
        expect(compiled).toContain("摄影是商业大片级别");
        expect(compiled).toContain("有一个一眼抓住人的视觉焦点");
        // 模型写字的图都带上防土味的禁止项。
        expect(compiled).toContain("不用描边字、渐变字、发光字");
        const heroPrompt = compileStudioPrompt({ product, textMode: run.textMode, shot: run.shots[0], model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt;
        expect(heroPrompt).toContain("栏目小标题「ALL DAY CUP」");
        expect(heroPrompt).toContain("画面里不出现页码、屏号和 01、02 这类序号。");
        expect(heroPrompt).not.toContain("编号圆点");
        // 使用步骤屏的步骤编号照常画。
        expect(compileStudioPrompt({ product, textMode: run.textMode, shot: { ...run.shots[0], role: "detail-steps" }, model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt).toContain("步骤用 1、2、3 这样的小编号标出先后");
        // 以前带序号的出图记录读回时去掉序号；策划提示词要求不加页码。
        const numbered = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, runs: [{ ...run, shots: [{ ...run.shots[0], eyebrow: "01 ALL DAY CUP" }] }] })))!;
        expect(numbered.runs[0].shots[0].eyebrow).toBe("ALL DAY CUP");
        expect(prompt).toContain("每屏都不加页码、屏号和 01、02 这类序号");
        expect(prompt).toContain("（如 CLEAR FRAME，只用英文字母，不带序号）");
        expect(prompt).not.toContain("序号加英文小标题");

        // 调整这一张写的修改要求只进这一张，读回时保留。
        const adjusted = compileStudioPrompt({ product, textMode: run.textMode, shot: { ...shot, adjust: "背景换成浅木纹桌面" }, model: "gpt-image-2", brief: product.brief, suite: run.suite }).prompt;
        expect(adjusted).toContain("【这一张的修改要求】\n背景换成浅木纹桌面。");
        const withRun = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, runs: [{ ...run, shots: [{ ...shot, adjust: "背景换成浅木纹桌面" }] }] })))!;
        expect(withRun.runs[0].shots[0]).toMatchObject({ adjust: "背景换成浅木纹桌面", layout: "callout" });
    });

    test("with the style left to the product, the planner picks one", () => {
        const { product, roles } = planned();
        const auto = { ...product, style: "auto" as const };
        const prompt = buildDetailPlanPrompt(auto, roles);
        expect(prompt).toContain('"styleId"');
        expect(prompt).toContain("candy（童趣糖果）");
        const picked = parseDetailPlan(JSON.stringify({ ...JSON.parse(reply), styleId: "candy" }), auto, roles, { id: "p2", model: "m", createdAt: "" }).plan;
        expect(picked.styleId).toBe("candy");
        expect(studioProductStyle(auto, studioActivePlan({ brief: { ...auto.brief, detailPlan: picked } })?.styleId).name).toBe("童趣糖果");
        // 没有策划时按品类挑；换成主图套图时详情页的策划不算数；选了具体质感时不收策划挑的。
        expect(studioProductStyle(auto, studioActivePlan({ brief: { ...auto.brief, detailPlan: undefined } })?.styleId).name).toBe("纯净高级白");
        expect(studioProductStyle(auto, studioActivePlan({ brief: { ...auto.brief, outputType: "main-set", detailPlan: picked } })?.styleId).name).toBe("纯净高级白");
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
        expect(prompt).toContain("主图文字比详情页更少");
        expect(prompt).not.toContain("detail-hero（");
        expect(prompt).not.toContain("整套至少用到 6 种版式");

        // 模型把场景图排在第一张：白底图挪到最前；详情页的屏型不收。
        const reply = JSON.stringify({
            tone: "global-minimal",
            style: "纯白底，细黑体",
            screens: [screen("main-scene", "场景"), screen("main-white", "白底", { noText: true }), screen("detail-hero", "头图"), screen("main-selling", "卖点"), screen("main-angle", "侧面"), screen("detail-seeding", "种草")],
        });
        const result = parseDetailPlan(reply, product, roles, meta, { scope: "main" });
        expect(result.plan.screens.map((item) => item.role)).toEqual(["main-white", "main-scene", "main-selling", "main-angle", "detail-seeding"]);
        expect(result.dropped).toBe(1);
        const short = JSON.stringify({ screens: [screen("main-white", "白底"), screen("main-scene", "场景"), screen("main-selling", "卖点")] });
        expect(() => parseDetailPlan(short, product, roles, meta, { scope: "main" })).toThrow("策划结果不完整");

        // 主图套图按主图的策划出，详情页的策划不混进来。
        const plannedProduct = { ...product, brief: { ...product.brief, mainPlan: result.plan } };
        expect(studioActivePlan(plannedProduct)?.id).toBe("plan_x");
        expect(studioActivePlan({ brief: { ...plannedProduct.brief, outputType: "detail-set" } })).toBeUndefined();
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        expect(run.kind).toBe("main");
        expect(run.suite).toMatchObject({ name: "按商品策划", tone: "global-minimal" });
        expect(run.shots.map((shot) => shot.title)).toEqual(["白底", "场景", "卖点", "侧面", "种草"]);
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
        expect(prompt).toContain("这次要出的 2 张图（种草图 1 张、对比图 1 张）");
        expect(prompt).toContain("第 1 张 detail-seeding（种草），第 2 张 detail-compare（对比）");
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

    test("tone, copy rules and the adjustment note reach the planner and the image prompt", () => {
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
        expect(prompt).toContain("1. 旧首屏（detail-hero · poster）「旧标题」：旧画面");
        expect(prompt).toContain("【设计调性】");
        expect(prompt).toContain("- global-minimal（国际大牌极简）");
        expect(prompt).toContain("【文案要求】");
        expect(prompt).toContain("神器");
        expect(prompt).toContain("visual 和 style 里不写任何品牌名");
        expect(buildDetailPlanPrompt({ ...product, brief: { ...product.brief, planNote: "" } }, roles)).not.toContain("补充调整】");

        const screens = Array.from({ length: 10 }, (_, index) => screen(index === 0 ? "detail-hero" : index === 9 ? "detail-closing" : "detail-scene", `第${index + 1}屏`));
        screens[1] = { ...screens[1], headline: "居家神器" };
        const result = parseDetailPlan(JSON.stringify({ tone: "editorial", style: "高对比黑白", screens }), product, roles, meta);
        expect(result.plan.tone).toBe("editorial");
        expect(result.tacky).toEqual(["神器"]);
        expect(parseDetailPlan(JSON.stringify({ tone: "fancy", screens }), product, roles, meta).plan.tone).toBeUndefined();

        // 设计调性写进策划过的屏的出图提示词，出图记录读回时保留。
        const plannedProduct = { ...product, brief: { ...product.brief, detailPlan: result.plan } };
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        expect(run.suite?.tone).toBe("editorial");
        // 第 2 屏带文案（第 1 屏的标题里有原文没有的数字，已被去掉）。
        const compiled = compileStudioPrompt({ product: plannedProduct, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: plannedProduct.brief, suite: run.suite });
        expect(compiled.prompt).toContain("【设计调性「时尚大片」】");
        expect(compiled.prompt).toContain("时尚杂志式版面");
        // 主标题的字重跟设计调性走，不一律加粗。
        expect(compiled.prompt).toContain("字重按设计调性和整套视觉规范");
        expect(compiled.prompt).not.toContain("粗字重");
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...plannedProduct, runs: [run] })))!;
        expect(restored.runs[0].suite?.tone).toBe("editorial");
        expect(restored.brief.planNote).toBe("多放生活场景，少放参数");
    });

    test("each product gets its own concept, reference images reach the planner and layout variety is checked", () => {
        const product = base({ outputType: "detail-set" });
        const roles = studioDetailPlanRoles(product);
        const prompt = buildDetailPlanPrompt(product, roles, { scope: "detail", images: { photos: 2, references: 1 } });
        expect(prompt).toContain("附图：图1–图2 是商品图（外观唯一依据）；图3 是卖家给的参考图（大牌或爆款的图，不是这件商品）。");
        expect(prompt).toContain("参考图怎么用：先看懂它好在哪里");
        // 先做视觉策划：同质化、差异化定位、视觉主题和视觉元素库；元素每张只选用一两个，商品完整摆拍不超过一半。
        expect(prompt).toContain("1. 先做视觉策划，再排每一张");
        expect(prompt).toContain("写进 positioning");
        expect(prompt).toContain("放进 concept");
        expect(prompt).toContain("写进 motifs");
        expect(prompt).toContain("换成别的商品就不成立");
        expect(prompt).toContain("至少三张不出现");
        expect(prompt).toContain("整件商品连同包装完整摆拍的张数不超过一半");
        expect(prompt).toContain("不写说明书口吻（该有的、就这么简单");
        expect(prompt).toContain('"positioning":"差异化定位"');
        expect(buildDetailPlanPrompt(base({ outputType: "main-set" }), studioDetailPlanRoles(product, "main"), { scope: "main" })).toContain("至少两张不出现");
        expect(prompt).toContain("11. inspiration 用一句话");
        expect(prompt).toContain('"concept":"创意主线（视觉主题）","motifs":["视觉元素"],"inspiration":"借鉴了什么"');
        // 视觉节奏与创意：整套一个色彩世界、机位和创意手法都有要求，信息少时不拿标识凑数；主色要撑得起整屏。
        expect(prompt).toContain("【视觉节奏与创意】");
        expect(prompt).toContain("整套一个色彩世界");
        expect(prompt).toContain("同一个商品角度和景别整套最多用两次");
        expect(prompt).toContain("首屏必须有");
        expect(prompt).toContain("商品标识、印字和型号不单独成屏");
        expect(prompt).toContain("主色要撑得起整屏");
        expect(prompt).toContain("主标题不能只是罗列外观或参数");
        expect(buildDetailPlanPrompt(base({ outputType: "main-set" }), studioDetailPlanRoles(product, "main"), { scope: "main" })).toContain("5 张是一个系列");
        // 没有附图时不写附图说明。
        expect(buildDetailPlanPrompt(product, roles)).not.toContain("附图：");

        const flat = Array.from({ length: 10 }, (_, index) => screen(index === 0 ? "detail-hero" : index === 9 ? "detail-closing" : "detail-scene", `屏${"一二三四五六七八九十"[index]}`, { layout: "scene" }));
        flat[2] = { ...flat[2], headline: "该有的，都写在身上" };
        const reply = JSON.stringify({
            positioning: "通勤人的第一口热水",
            concept: "清晨第一口热水的雾气，每屏都有一缕热气",
            motifs: ["热气", "晨光", "热气", "地铁站台", "笔记本", "围巾", "钥匙"],
            inspiration: "同类爆款的色块分区和编号徽章",
            style: "雾蓝",
            screens: flat,
        });
        const result = parseDetailPlan(reply, product, roles, meta);
        expect(result.plan).toMatchObject({ positioning: "通勤人的第一口热水", concept: "清晨第一口热水的雾气，每屏都有一缕热气", inspiration: "同类爆款的色块分区和编号徽章" });
        // 视觉元素去重，最多 5 个；说明书口吻的标题会被提示。
        expect(result.plan.motifs).toEqual(["热气", "晨光", "地铁站台", "笔记本", "围巾"]);
        expect(result.tacky).toEqual(["该有的", "都写在"]);
        expect(result.layoutKinds).toBe(1);
        expect(result.layoutRepeats).toBe(9);

        // 创意主线跟着出图记录进每张图的整套视觉规范，读回时保留。
        const plannedProduct = { ...product, brief: { ...product.brief, detailPlan: result.plan } };
        const run = createStudioRun(plannedProduct, ids(), "2026-11-01T00:00:00Z");
        expect(run.suite?.concept).toBe("清晨第一口热水的雾气，每屏都有一缕热气");
        const compiled = compileStudioPrompt({ product: plannedProduct, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: plannedProduct.brief, suite: run.suite }).prompt;
        expect(compiled).toContain("创意主线：清晨第一口热水的雾气，每屏都有一缕热气。视觉元素库：热气、晨光、地铁站台、笔记本、围巾，这张图按画面需要选用其中一两个");
        expect(compiled).not.toContain("这张图也要体现它");
        // 画面没写包装盒时，不把包装盒摆进来；策划的屏按材质补布光。
        expect(compiled).toContain("不要把包装盒也摆进来");
        expect(compileStudioPrompt({ product: plannedProduct, textMode: run.textMode, shot: { ...run.shots[1], visual: "纸盒立在台面上" }, model: "gpt-image-2", brief: plannedProduct.brief, suite: run.suite }).prompt).not.toContain(
            "不要把包装盒也摆进来",
        );
        const clearFrame = { ...plannedProduct, dossier: { ...plannedProduct.dossier!, facts: [...plannedProduct.dossier!.facts, { id: "f_frame", group: "appearance" as const, label: "镜框", value: "透明亚克力", evidence: "visible" as const }] } };
        const lit = compileStudioPrompt({ product: clearFrame, textMode: run.textMode, shot: run.shots[1], model: "gpt-image-2", brief: clearFrame.brief, suite: run.suite }).prompt;
        expect(lit).toContain("【按材质布光】");
        expect(lit).toContain("透明部分用背光或侧逆光打亮");
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...plannedProduct, runs: [run] })))!;
        expect(restored.brief.detailPlan).toMatchObject({ positioning: "通勤人的第一口热水", concept: "清晨第一口热水的雾气，每屏都有一缕热气", inspiration: "同类爆款的色块分区和编号徽章" });
        expect(restored.brief.detailPlan?.motifs).toEqual(["热气", "晨光", "地铁站台", "笔记本", "围巾"]);
        expect(restored.runs[0].suite).toMatchObject({ concept: "清晨第一口热水的雾气，每屏都有一缕热气", motifs: ["热气", "晨光", "地铁站台", "笔记本", "围巾"] });
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
