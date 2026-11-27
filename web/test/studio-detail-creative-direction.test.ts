import { expect, test } from "bun:test";
import { patchStudioDetailPlanScreen, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { locateStudioShot, studioImageInput, studioImageInputCount, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { compileStudioPrompt, renderStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
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
        expect(prompt).toContain("删掉一屏，整页是否少了有用的一步");
        expect(prompt).toContain("本屏负责的阅读任务，可以是简短陈述");
        expect(prompt).toContain("同一个部位的外形、边缘、内部纹理和颜色先合并");
        expect(prompt).toContain("同一个基本使用动作不能按人体部位、操作角度或场景拆开占屏");
        expect(prompt).toContain("把最有用的答案排在零件外观之前");
        expect(prompt).toMatch(/不凑零件目录|不预报整份零件清单/);
        expect(prompt).toContain('"visualBeat"');
        expect(prompt).toContain('"transitionOut"');
        expect(prompt).not.toContain('"artDirection"');
        expect(prompt).not.toContain("aspectRatio");
        expect(prompt).not.toContain("像小红书分享一样的生活瞬间");
        expect(prompt).not.toContain("放大商品图里看得到的一个部位");
    }
});

test("十屏不缩减：没有功效依据也要出图文，保留确认规格，不把吹发写成速干承诺", () => {
    const product = productFixture(scenarios[1]);
    product.brief.detailScreens = 10;
    product.sellerNotes = "机身长度：20 cm";
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "这款是什么样？", displayContent: "展示圆筒机身。" },
                { role: "detail-scene", purchaseQuestion: "实际怎么吹发？", displayContent: "手握吹风机靠近发丝。风口朝向发丝。可快速吹干头发。" },
                { role: "detail-size", purchaseQuestion: "机身有多长？", displayContent: "机身长度 20 cm。", evidenceRefs: ["seller:1"] },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        meta,
        request,
    ).plan;
    const run = createStudioRun(product, () => "run");
    const briefs = run.shots.map((_, index) => studioImageInput(product, studioLocateRunShot(run, index), "gpt-image-2", defaultConfig).compiled);
    expect(briefs).toHaveLength(10);
    expect(briefs[0].layers.find(({ id }) => id === "copy")?.text).toContain("独立于商品印字的短文案");
    expect(briefs[0].layers.find(({ id }) => id === "copy")?.text).toMatch(/必须[^。\n]*简体中文短文案/);
    expect(briefs[1].prompt).toContain("手握吹风机靠近发丝");
    expect(briefs[1].prompt).not.toContain("风口朝向发丝");
    expect(briefs[1].prompt).not.toContain("快速吹干");
    expect(briefs[2].prompt).toContain("机身长度 20 cm");
    expect(briefs[9].prompt).toContain("第 10/10 屏");
    expect(briefs.every((brief) => brief.textMode === "model" && !brief.layoutGuide && !brief.copySnapshot?.headline)).toBe(true);
});

test("局部图用实际部位作主体，不把通用利益承诺或整机摆拍重复灌进本屏", () => {
    const product = productFixture(scenarios[1]);
    product.brief.detailScreens = 2;
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "整机长什么样？", displayContent: "展示浅绿色整机。" },
                {
                    role: "detail-closeup",
                    purchaseQuestion: "手柄底部怎么出线？",
                    displayContent: "浅灰色线从手柄底部中央引出。握持不挡手，使用更顺手。",
                    visualBeat: "电源线从手柄底端离开的连接点。",
                    visualFocus: "手柄底部与浅灰线交接处。",
                },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        meta,
        request,
    ).plan;
    const run = createStudioRun(product, () => "run");
    const { compiled } = studioImageInput(product, studioLocateRunShot(run, 1), "gpt-image-2", defaultConfig);
    const visual = compiled.layers.find(({ id }) => id === "visual")!.text;
    expect(visual).toContain("浅灰色线从手柄底部中央引出");
    expect(visual).not.toContain("视觉入口：手柄底部与浅灰线交接处");
    expect(visual).toContain("不用整品摆拍加圆形放大框来代替");
    expect(visual).not.toMatch(/浅绿色整机|握持不挡手|使用更顺手/);
    expect(compiled.prompt).toContain("可见特征不等于功能或效果");
    expect(compiled.layers.find(({ id }) => id === "art-direction")?.text).toContain("不套版式");
    expect(compiled.copySnapshot?.headline).toBe("");
});

for (const example of scenarios)
    test(`${example.name}只给商品图也能逐屏自主设计，不把档案或共享布景变成模板`, () => {
        const product = productFixture(example);
        const roles = studioDetailPlanRoles(product);
        const transition = "由完整轮廓过渡到手的操作动作";
        const hero = { role: "detail-hero", purchaseQuestion: "这一款长什么样？", displayContent: `展示${example.name}完整形态`, visualFocus: "完整外形", transitionOut: transition };
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
        const ordered = createStudioRun(product, () => "ordered");
        expect(ordered.shots[0].transitionOut).toBe(transition);
        const skipped = { ...product, brief: { ...product.brief, shotSkip: ["p1"] } };
        expect(createStudioRun(skipped, () => "skipped").shots[0].transitionOut).toBeUndefined();
        product.brief.shotOrder = ["p0", "p2", "p1"];
        let serial = 0;
        const run = createStudioRun(product, () => `run-${++serial}`);
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
        const briefs = restored.runs[0].shots.map((_, index) => studioImageInput(restored, studioLocateRunShot(restored.runs[0], index), "gpt-image-2", defaultConfig).compiled);
        const last = briefs[2];
        expect(briefs).toHaveLength(3);
        expect(briefs.map((brief) => brief.continuity?.previousScreen)).toEqual([undefined, 1, 2]);
        expect(studioLocateRunShot(restored.runs[0], 2).detailContinuity?.previous?.displayContent).toBe(example.proof.displayContent);
        expect(briefs.every((brief) => !brief.prompt.includes(transition))).toBe(true);
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

test("本屏引用使用实际商品图的稳定 ID，单参考模型优先保留它，失效引用不拦出图", () => {
    const product = productFixture(scenarios[0]);
    const closeup = { ...product.photos[0], id: "texture", resourceId: "texture-photo", view: "detail" as const };
    const style = { ...product.photos[0], id: "style", resourceId: "layout-photo", truth: false };
    product.photos.push(closeup, style);
    product.brief.detailScreens = 2;
    const roles = studioDetailPlanRoles(product);
    const request = {
        scope: "detail" as const,
        images: {
            photos: 2,
            references: 1,
            photoEvidence: [
                { index: 1, id: "photo" },
                { index: 2, id: closeup.id },
            ],
        },
    };
    const prompt = buildDetailPlanPrompt(product, roles, request);
    const photoCitation = prompt.match(/图2 \[(E\d+)\]/)?.[1];
    expect(photoCitation).toBeDefined();
    expect(prompt).not.toContain("photo:texture");
    expect(prompt).toContain('"alternatives":[');
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "包装长什么样？", displayContent: "完整软抽包装。", evidence: ["photo:photo"] },
                { role: "detail-closeup", purchaseQuestion: "抽出的纸张有什么可见纹理？", displayContent: "展示原图中的纸面。", evidence: [`[${photoCitation}]`, "photo:style"] },
            ],
        }),
        product,
        roles,
        meta,
        request,
    );
    expect(result.plan.screens[1].evidenceRefs).toEqual(["photo:texture"]);
    const recovered = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "包装长什么样？", displayContent: "完整软抽包装。", evidence: ["photo:photo"] },
                { role: "detail-closeup", purchaseQuestion: "抽出的纸张有什么可见纹理？", displayContent: "展示原图中的纸面。", evidence: [`[${photoCitation}]`] },
            ],
        }),
        product,
        roles,
        meta,
        { scope: "detail" },
    );
    expect(recovered.plan.screens[1].evidenceRefs).toEqual(["photo:texture"]);
    product.brief.detailPlan = result.plan;
    const run = createStudioRun(product, () => "run");
    const shot = studioLocateRunShot(run, 1).shot;
    const compiled = compileStudioPrompt({ product, shot, model: "gpt-image-2", brief: product.brief, maxReferences: 1 });
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["texture-photo"]);
    expect(compiled.prompt).not.toContain("photo:texture");
    const withoutTexture = compileStudioPrompt({ product: { ...product, photos: product.photos.filter(({ id }) => id !== closeup.id) }, shot, model: "gpt-image-2", brief: product.brief, maxReferences: 1 });
    expect(withoutTexture.references.map(({ resourceId }) => resourceId)).toEqual([scenarios[0].photo]);
});

test("衔接图按真实参考图计数，没名额或字数时保留原图和本屏文案要求", () => {
    const product = productFixture(scenarios[0]);
    const transition = "由包装轮廓过渡到取纸动作";
    product.references = [{ ...product.photos[0], id: "style", resourceId: "style", truth: false }];
    product.brief.detailPlan = twoScreenPlan(product, { transitionOut: `${transition}。固定文字区` });
    const run = createStudioRun(product, () => "run");
    const located = studioLocateRunShot(run, 1);
    const model = "gpt-image-2";
    const { compiled, request: imageRequest } = studioImageInput(product, located, model, defaultConfig);
    expect(studioImageInputCount({ compiled, request: imageRequest })).toBe(3);
    expect(compiled.prompt).toContain("图3是上一屏已生成的下半幅");
    expect(compiled.prompt).toContain("从它的最底一行往下续画");
    expect(compiled.layers.find(({ id }) => id === "continuity")?.text).not.toContain("这款是什么样？");
    expect(compiled.continuity).toEqual({ previousScreen: 1, guide: "context" });
    expect(compiled.layers.find(({ id }) => id === "continuity")?.text).toContain(transition);
    expect(studioImageInput(product, studioLocateRunShot(run, 0), model, defaultConfig).compiled.layers.find(({ id }) => id === "continuity")?.text).toContain(transition);
    expect(compiled.prompt).not.toContain("固定文字区");

    const options = { product, shot: located.shot, model, brief: product.brief, detailContinuity: true as const };
    const withoutContinuity = compileStudioPrompt({ ...options, detailContinuity: undefined, maxReferences: 2 });
    const noRoom = compileStudioPrompt({ ...options, maxReferences: 2 });
    const required = renderStudioPrompt(withoutContinuity.layers.filter(({ id }) => id !== "market" && id !== "art-direction"));
    const tight = compileStudioPrompt({ ...options, maxReferences: 3, maxChars: required.length });
    for (const result of [noRoom, tight]) {
        expect(result.continuity).toBeUndefined();
        expect(result.references).toEqual(withoutContinuity.references);
        expect(result.styleReferences).toEqual(withoutContinuity.styleReferences);
        expect(result.prompt).toContain(scenarios[0].use.displayContent);
        expect(result.prompt).toMatch(/必须[^。\n]*可读[^。\n]*简体中文/);
    }
    expect(noRoom.prompt).not.toContain("从它的最底一行往下续画");
    expect(noRoom.prompt).not.toContain(transition);
    expect(noRoom.referenceNotice).toContain("优先保留商品和已选参考");
    expect(tight.referenceNotice).toContain("提示词字数不足");
});

test("生鲜的局部屏不临摹手托照，标题不能用外观替代新鲜度或处理依据", () => {
    const product = productFixture({ ...scenarios[0], name: "小鱿鱼" });
    product.dossier!.family = "food";
    product.brief.detailScreens = 2;
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "商品是什么形态？", displayContent: "手托整只小鱿鱼，画面中没有包装、标签或文字。", visualBeat: "手托整只小鱿鱼。" },
                { role: "detail-closeup", purchaseQuestion: "外套膜有什么可见纹理？", displayContent: "展示外套膜上的细密斑点。", visualFocus: "细小斑点的分布。", visualBeat: "表皮斑点，区别于首屏的整只托举。" },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        meta,
        request,
    ).plan;
    const run = createStudioRun(product, () => "run");
    const hero = studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig).compiled;
    const { compiled } = studioImageInput(product, studioLocateRunShot(run, 1), "gpt-image-2", defaultConfig);
    expect(hero.prompt).not.toContain("没有包装、标签或文字");
    expect(hero.layers.find(({ id }) => id === "visual")?.text).not.toContain("看局部");
    expect(compiled.layers.find(({ id }) => id === "visual")?.text).toContain("主体是本屏要看的局部及相邻的真实结构");
    expect(compiled.layers.find(({ id }) => id === "copy")?.text).toMatch(/实拍[^。]+不能证明鲜度、口感[^。]+已(?:经)?处理/);
    expect(compiled.prompt).not.toContain("手托整只小鱿鱼");
    expect(compiled.prompt).not.toContain("首屏的整只托举");
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual([scenarios[0].photo]);
});

test("旧助手详情方案不会等待上一屏，即使商品当前选择普通详情页", () => {
    const product = productFixture(scenarios[0]);
    product.brief.detailPlan = twoScreenPlan(product, { transitionOut: "由包装轮廓过渡到取纸动作" });
    const run = createStudioRun(product, () => "run");
    const [first, second] = run.shots;
    product.plans = [
        {
            id: "assistant-plan",
            kind: "detail",
            textMode: "model",
            createdAt: "",
            shots: [
                { ...first, id: "first" },
                { ...second, id: "second" },
            ],
        },
    ];
    const located = locateStudioShot(product, { planKind: "detail" }, "second")!;
    const { compiled } = studioImageInput(product, located, "gpt-image-2", defaultConfig);
    expect(compiled.continuity).toBeUndefined();
    expect(compiled.layers.some(({ id }) => id === "continuity")).toBe(false);
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual([scenarios[0].photo]);
});

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

test("历史详情重跑使用已保存的商品资料，剔除旧屏和承接线索里的无依据卖点", () => {
    const product = productFixture(scenarios[1]);
    product.sellerNotes = "机身长度：20 cm";
    product.brief.detailPlan = twoScreenPlan(product);
    const run = createStudioRun(product, () => "run");
    run.shots[0].transitionOut = "从整机过渡到手柄。收纳时，这支手柄不能折。";
    Object.assign(run.shots[1], {
        purchaseQuestion: "手柄和风筒怎样连接？它能不能折叠收纳？",
        displayContent: "手柄与风筒近直角连接。机身长度 20 cm。没有折叠关节。能快速吹干。格栅均匀出风。",
        visualBeat: "两段外壳的接合处。手柄不折叠。",
        visualFocus: "连接处连续的轮廓。出风更均匀。",
        evidenceRefs: ["seller:1"],
    });
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    restored.sellerNotes = "可折叠收纳。出风更均匀。";
    const located = studioLocateRunShot(restored.runs[0], 1);
    const { compiled } = studioImageInput(restored, located, "gpt-image-2", defaultConfig);
    for (const phrase of ["折叠收纳", "没有折叠关节", "不折叠", "手柄不能折", "能快速吹干", "出风更均匀", "均匀出风"]) expect(compiled.prompt).not.toContain(phrase);
    expect(compiled.layers.find(({ id }) => id === "continuity")?.text).toContain("从整机过渡到手柄");
    for (const phrase of ["手柄和风筒怎样连接", "手柄与风筒近直角连接", "机身长度 20 cm", "两段外壳的接合处", "连接处连续的轮廓"]) expect(compiled.prompt).toContain(phrase);
    expect(compiled.layers.find(({ id }) => id === "copy")?.text).toContain("独立于商品印字的短文案");
});

test("指定参考版式或基于已生成成品做修改时，不附上与之冲突的下缘底稿", () => {
    const product = productFixture(scenarios[0]);
    product.brief.sameLayout = true;
    product.references = [{ ...product.photos[0], id: "layout", resourceId: "chosen-layout", truth: false }];
    product.brief.detailPlan = twoScreenPlan(product, { transitionOut: "由包装轮廓过渡到取纸动作" });
    const run = createStudioRun(product, () => "run");
    const second = studioLocateRunShot(run, 1);
    const sameLayout = studioImageInput(product, second, "gpt-image-2", defaultConfig).compiled;
    expect(sameLayout.styleReferences[0].resourceId).toBe("chosen-layout");
    expect(sameLayout.continuity).toBeUndefined();
    expect(sameLayout.layers.some(({ id }) => id === "continuity")).toBe(false);

    run.source!.brief.sameLayout = false;
    run.shots[1].attempts = [{ id: "done", status: "succeeded", textMode: "model", model: "gpt-image-2", createdAt: "", tweaks: [], outputs: [{ resourceId: "revision", url: "" }] }];
    const revision = studioImageInput(product, studioLocateRunShot(run, 1), "gpt-image-2", defaultConfig, "revision").compiled;
    expect(revision.revisionReference?.resourceId).toBe("revision");
    expect(revision.continuity).toBeUndefined();
    expect(revision.layers.some(({ id }) => id === "continuity")).toBe(false);
});

test("精修只用所选成品和相邻的实际下缘，不把本屏当新稿设计", () => {
    const product = productFixture(scenarios[0]);
    product.brief.detailPlan = twoScreenPlan(product);
    const run = createStudioRun(product, () => "run");
    const original = { resourceId: "screen-two", url: "", width: 1024, height: 1536 };
    const completed = (resourceId: string) => ({ id: resourceId, status: "succeeded" as const, model: "gpt-image-2", tweaks: [], createdAt: "", outputs: [{ resourceId, url: "" }] });
    run.shots[0].attempts = [completed("screen-one")];
    run.shots[1].attempts = [{ ...completed(original.resourceId), outputs: [original] }];
    const located = studioLocateRunShot(run, 1);
    const input = studioImageInput(product, located, "gpt-image-2", defaultConfig, { repairSeam: original.resourceId });
    expect(studioImageInputCount(input)).toBe(3);
    expect(input.request).toMatchObject({ aspectRatio: "2:3", imageSettings: { size: "1024x1536" } });
    expect(input.compiled.prompt).toContain("画幅：2:3");
    expect(input.compiled.revisionReference?.resourceId).toBe(original.resourceId);
    expect(input.compiled.references.map(({ resourceId }) => resourceId)).toEqual([scenarios[0].photo]);
    expect(input.compiled.continuity).toEqual({ previousScreen: 1, guide: "edge", repair: true, anchor: { sourceResourceId: "screen-one" } });
    expect(input.compiled.prompt).toContain("只调整第 2 屏的顶部接边");
    expect(input.compiled.prompt).toContain("图3是第 1 屏实际下缘");
    expect(input.compiled.prompt).toContain("保留原有文字、排版与主体");
    expect(input.compiled.prompt).toContain("不修改底部接边");
    expect(input.compiled.useDesignKnowledge).toBeUndefined();
    expect(input.compiled.prompt).not.toContain("必须由图片模型看商品原图");
    expect(() => studioImageInput(product, studioLocateRunShot(run, 0), "gpt-image-2", defaultConfig, { repairSeam: "screen-one" })).toThrow(/上一屏/);
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
