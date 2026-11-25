import { expect, test } from "bun:test";
import { patchStudioDetailPlanScreen, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";

const meta = { id: "plan", model: "planner", createdAt: "" };
const request = { scope: "detail" as const };

const scenarios = [
    {
        name: "软抽纸巾",
        archiveFact: "橙色包装右下角的圆形识别图案",
        photo: "纸巾正面",
        use: { purchaseQuestion: "怎样拿到一张纸？", displayContent: "手从开口抽出纸巾，主体是手和抬起的纸张", visualFocus: "手指提起纸张的动作" },
        proof: { purchaseQuestion: "抽出来是什么样？", displayContent: "展开展示纸巾的基本形态，不补画压纹或实验效果", visualFocus: "展开的纸张形态" },
    },
    {
        name: "手持吹风机",
        archiveFact: "手柄下段有环形接缝",
        photo: "吹风机正面",
        use: { purchaseQuestion: "握住时能碰到开关吗？", displayContent: "展示手握手柄时拇指接近可见开关的关系", visualFocus: "拇指与开关的触点" },
        proof: { purchaseQuestion: "吹发时怎么握这台机器？", displayContent: "展示手臂、吹风机与头发的实际操作距离，不画吹干效果", visualFocus: "握持与头发之间的使用关系" },
    },
];

function productFixture(example: (typeof scenarios)[number]) {
    const product = createStudioProduct(example.name);
    product.name = example.name;
    product.brief = { ...product.brief, productType: example.name, outputType: "detail-set", detailScreens: 3 };
    product.photos = [{ id: "photo", resourceId: example.photo, view: "front", truth: true, url: "", addedAt: "" }];
    product.dossier = {
        name: example.name,
        category: example.name,
        family: "generic",
        summary: "",
        facts: [{ id: "visible-decoration", group: "structure", label: "外观档案细节", value: example.archiveFact, evidence: "visible" }],
        invariants: [],
        questions: [],
    };
    return product;
}

test("普通详情先为商品分配买家任务，不按搭配、种草和佩戴等类型凑屏", () => {
    for (const example of scenarios) {
        const product = productFixture(example);
        product.brief.detailScreens = 10;
        const prompt = buildDetailPlanPrompt(product, studioDetailPlanRoles(product), request);
        expect(prompt).toContain("正好交付 10 屏");
        expect(prompt).toMatch(/先[^。\n]*选购与使用[^。\n]*再[^。\n]*标 role/);
        expect(prompt).toMatch(/包装或配件只有在[^。\n]*选购问题[^。\n]*才独立占屏/);
        expect(prompt).toContain("删掉一屏，买家是否少知道一件事");
        expect(prompt).toContain("同一表面的色泽、纹理和反光");
        expect(prompt).toContain('"visualBeat"');
        expect(prompt).not.toContain('"artDirection"');
        expect(prompt).not.toContain("aspectRatio");
        expect(prompt).not.toContain("像小红书分享一样的生活瞬间");
        expect(prompt).not.toContain("放大商品图里看得到的一个部位");
    }
});

for (const example of scenarios)
    test(`${example.name}只给商品图也能逐屏自主设计，不把档案或共享布景变成模板`, () => {
        const product = productFixture(example);
        const roles = studioDetailPlanRoles(product);
        const hero = { role: "detail-hero", purchaseQuestion: "这一款长什么样？", displayContent: `展示${example.name}完整形态`, visualFocus: "完整外形" };
        product.brief.detailPlan = parseDetailPlan(
            JSON.stringify({
                artDirection: { visualWorld: "每屏用同一张木桌与藤编", screenVariationPlan: "每屏顶部放等大标题" },
                screens: [hero, { role: "detail-model", ...example.use, headline: "策划拟的标题", composition: "upper" }, { role: "detail-model", ...example.proof }],
            }),
            product,
            roles,
            meta,
            request,
        ).plan;
        product.brief.shotOrder = ["p0", "p2", "p1"];
        let serial = 0;
        const run = createStudioRun(product, () => `run-${++serial}`);
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
        const briefs = restored.runs[0].shots.map((_, index) => studioImageInput(restored, studioLocateRunShot(restored.runs[0], index), "gpt-image-2", defaultConfig).compiled);
        const last = briefs[2];
        expect(briefs).toHaveLength(3);
        expect(last.prompt).toContain("第 3/3 屏");
        expect(last.layers.find((layer) => layer.id === "visual")?.text).toContain(example.use.visualFocus);
        expect(last.prompt).not.toContain(example.proof.visualFocus);
        expect(briefs[1].prompt).not.toContain(example.use.visualFocus);
        const copy = last.layers.find((layer) => layer.id === "copy")?.text;
        expect(last.layers.find((layer) => layer.id === "art-direction")?.text).toMatch(/由图片模型自定[^。\n]*不套版式/);
        expect(copy).toMatch(/依据本屏问题和真实证据[^。\n]*可读/);
        expect(last.references.map((photo) => photo.resourceId)).toEqual([example.photo]);
        expect(last.styleReferences).toEqual([]);
        expect(last.layoutGuide).toBeUndefined();
        for (const value of [example.archiveFact, "每屏用同一张木桌与藤编", "每屏顶部放等大标题", "策划拟的标题", "上身 / 佩戴", "屏型："]) expect(last.prompt).not.toContain(value);
    });

test("普通详情换问题却复用同一视觉重点时只给提示，不缩水、不拦出图", () => {
    const product = productFixture(scenarios[0]);
    product.brief.detailScreens = 2;
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "包装是什么形状？", displayContent: "完整包装放在桌面", visualFocus: "包装正面的标识" },
                { role: "detail-closeup", purchaseQuestion: "包装怎么看品牌？", displayContent: "拉近画面放大标签", visualFocus: "包装正面的标识。" },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        meta,
        request,
    );
    expect(result.warnings).toContainEqual(expect.objectContaining({ index: 1, field: "visualFocus" }));
    product.brief.detailPlan = result.plan;
    expect(createStudioRun(product, () => "run").shots).toHaveLength(2);
});

test("模型省略档案编号前缀时，普通详情仍把有效的本屏依据交给图片模型", () => {
    const product = productFixture(scenarios[1]);
    product.brief.detailScreens = 2;
    product.dossier!.facts.push({ id: "Knob-X5", group: "structure", label: "滑钮形态", value: "圆形滑钮位于手柄侧面", evidence: "visible" }, { id: "mode-pending", group: "spec", label: "温控档位", value: "冷风档", evidence: "pending" });
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "这款机器是什么造型？", displayContent: "展示机身外形" },
                { role: "detail-closeup", ...scenarios[1].use, evidence: ["[Knob-X5]", "mode-pending"], evidenceRefs: ["Knob-X5", "fact:Knob-X5"] },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        meta,
        request,
    );
    expect(result.plan.screens[1].evidenceRefs).toEqual(["fact:Knob-X5"]);
    expect(result.warnings.filter((warning) => warning.field === "facts" || warning.field === "evidenceRefs").map((warning) => warning.message)).toEqual([expect.stringContaining("mode-pending")]);
    product.brief.detailPlan = result.plan;
    const run = createStudioRun(product, () => "run");
    const hero = studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig).compiled;
    const closeup = studioImageInput(product, studioLocateRunShot(run, 1), "gpt-image-2", defaultConfig).compiled;
    expect(closeup.layers.find(({ id }) => id === "visual")?.text).toContain("滑钮形态 圆形滑钮位于手柄侧面");
    expect(closeup.prompt).not.toContain("冷风档");
    expect(hero.prompt).not.toContain("滑钮形态 圆形滑钮位于手柄侧面");
});

function twoScreenPlan(product: ReturnType<typeof productFixture>, first: Record<string, unknown> = {}) {
    product.brief.detailScreens = 2;
    return parseDetailPlan(
        JSON.stringify({
            summary: "先认出商品，再了解实际抽取方式",
            artDirection: { visualWorld: "锁定旧布景" },
            screens: [
                { role: "detail-hero", purchaseQuestion: "这款是什么样？", displayContent: "展示商品完整形态", ...first },
                { role: "detail-scene", ...scenarios[0].use },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        meta,
        request,
    ).plan;
}

test("普通详情只接收展示内容；旧策划多返排版、字块或画幅不会拦住正确的策划", () => {
    const product = productFixture(scenarios[0]);
    product.brief.detailPlan = twoScreenPlan(product, { composition: { zone: "top" }, lines: [42], noText: true, aspectRatio: "16:9", headline: "固定标题" });
    const run = createStudioRun(product, () => "run");
    const input = studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig);
    expect(run.shots).toHaveLength(2);
    expect(product.brief.detailPlan.artDirection).toBeUndefined();
    expect(input.request.aspectRatio).not.toBe("16:9");
    expect(input.compiled.prompt).toContain("展示商品完整形态");
    expect(input.compiled.layers.find(({ id }) => id === "copy")?.text).toMatch(/必须[^。\n]*可读[^。\n]*简体中文/);
    expect(input.compiled.prompt).not.toContain("固定标题");
});

test("生成新候选只执行用户补充的设计，不执行旧策划的额外出图指令", () => {
    const product = productFixture(scenarios[0]);
    product.brief.planNote = "用撕纸边缘做装饰";
    product.brief.detailPlan = twoScreenPlan(product);
    const run = createStudioRun(product, () => "run");
    Object.assign(run.shots[0], { imagePrompt: "每屏用同一木桌作为前景", negativePrompt: "不要画手或任何使用关系", adjust: "用更醒目的字形" });
    const { compiled } = studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig);
    expect(compiled.prompt).not.toContain("每屏用同一木桌");
    expect(compiled.prompt).not.toContain("不要画手");
    expect(compiled.prompt).toContain("用撕纸边缘做装饰");
    expect(compiled.prompt).toContain("用更醒目的字形");
});

test("旧草稿把字块塞进画面描述时，新候选只保留商品内容", () => {
    const product = productFixture(scenarios[0]);
    product.brief.detailPlan = twoScreenPlan(product, { displayContent: "展示长条抽取口，左侧三行长短字块，短标题放左上，手指抽出一张纸巾" });
    const run = createStudioRun(product, () => "run");
    const { compiled } = studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig);
    expect(compiled.prompt).toContain("展示长条抽取口");
    expect(compiled.prompt).toContain("手指抽出一张纸巾");
    expect(compiled.prompt).not.toContain("左侧三行长短字块");
    expect(compiled.prompt).not.toContain("短标题放左上");
});

test("普通详情画幅尊重表单选择和同款参考，不接受策划偷偷改画幅", () => {
    for (const ratio of ["9:16", "auto"]) {
        const product = productFixture(scenarios[0]);
        product.brief.ratio = ratio;
        if (ratio === "auto") {
            product.brief.sameLayout = true;
            product.references = [{ ...product.photos[0], id: "reference", resourceId: "reference", truth: false, width: 900, height: 1600 }];
        }
        product.brief.detailPlan = twoScreenPlan(product);
        product.brief.detailPlan.screens[0].aspectRatio = "16:9";
        const run = createStudioRun(product, () => "run");
        expect(run.shots[0].ratio).toBe("9:16");
        run.shots[0].aspectRatio = "16:9";
        const { compiled, request } = studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig);
        expect(request.aspectRatio).toBe("9:16");
        expect(compiled.prompt).toContain("画幅：9:16");
        expect(compiled.styleReferences.map((photo) => photo.resourceId)).toEqual(ratio === "auto" ? ["reference"] : []);
    }
});

test("只清空展示内容时，普通详情仍保留本屏问题、视觉重点和证据", () => {
    const product = productFixture(scenarios[0]);
    product.sellerNotes = "抽口：长条抽取口；包装：橙色印刷";
    product.brief.detailPlan = twoScreenPlan(product, { displayContent: "展示长条抽取口", purchaseQuestion: "从哪里抽出纸张？", visualFocus: "长条抽取口", evidence: ["seller:1"] });
    product.brief = patchStudioDetailPlanScreen(product.brief, 0, { visual: "" });
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
    const run = createStudioRun(restored, () => "run");
    const { compiled } = studioImageInput(restored, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig);
    expect(compiled.prompt).toContain("从哪里抽出纸张");
    expect(compiled.prompt).toContain("视觉入口：长条抽取口");
    expect(compiled.prompt).toContain("本屏商品依据：抽口：长条抽取口");
    expect(compiled.prompt).not.toContain("橙色印刷");
    expect(compiled.prompt).not.toContain("必须展示：长条抽取口");
    expect(compiled.layers.some((layer) => layer.id === "composition" || layer.id === "proof" || layer.id === "category")).toBe(false);
});
