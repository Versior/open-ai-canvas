import { expect, test } from "bun:test";
import { patchStudioDetailPlanScreen, studioTemplatePlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { locateStudioShot, studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct, studioGenerationSource } from "@/lib/ecommerce-studio/product";
import { compileStudioPrompt, type StudioCompiledPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import type { StudioProduct, StudioRun, StudioShot } from "@/lib/ecommerce-studio/types";
import { defaultConfig } from "@/stores/use-config-store";

const planMeta = { id: "plan", model: "planner", createdAt: "" };
const requiresCopy = /必须[^。\n]*(?:可读|清楚)[^。\n]*(?:标题|短文案|短注|辅助语)/;
const forbidsCopy = /不(?:添加|放|出现|生成)(?:任何|额外|新的)?(?:文字|文案)|不能生成额外文案/;

function copyInstructions(compiled: StudioCompiledPrompt) {
    return compiled.layers.find((layer) => layer.id === "copy")?.text;
}

function fixtureProduct(id: string, label = "黑色方框眼镜") {
    const product = createStudioProduct(id);
    product.name = label;
    product.photos = [{ id: "front", resourceId: `${id}-front`, url: "", truth: true, view: "front", addedAt: "" }];
    return product;
}

function delivery(product: StudioProduct) {
    let serial = 0;
    const run = createStudioRun(product, () => `run-${++serial}`);
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    return restored.runs[0].shots.map(({ id }) => studioImageInput(restored, locateStudioShot(restored, { runId: run.id }, id)!, "gpt-image-2", defaultConfig).compiled);
}

function planned(role: StudioShot["role"], visual: string): StudioShot {
    return {
        id: `contract-${role}`,
        role,
        title: role,
        ratio: "3:4",
        headline: "",
        subline: "",
        lines: [],
        copySource: "assistant",
        sellingPointIds: [],
        tweaks: [],
        visual,
        purchaseQuestion: "买家这一屏要确认什么",
        displayContent: visual,
        visualFocus: "商品和本屏证据是唯一焦点",
        evidenceRefs: [],
        layout: "scene",
        eyebrow: "",
        attempts: [],
    };
}

test("a text-enabled detail screen asks the image model to write and design readable copy grounded in the original product", () => {
    const product = createStudioProduct("image-autonomy-copy");
    const compiled = compileStudioPrompt({
        product,
        shot: planned("detail-selling", "展示商品可见按键和真实操作关系"),
        pageKind: "detail",
        model: "gpt-image-2",
    });

    expect(copyInstructions(compiled)).toMatch(requiresCopy);
    expect(copyInstructions(compiled)).toContain("简体中文");
    expect(copyInstructions(compiled)).toMatch(/商品原图|可见事实/);
    expect(copyInstructions(compiled)).toContain("艺术字");
    expect(copyInstructions(compiled)).toContain("特效");
    expect(compiled.prompt).not.toMatch(forbidsCopy);
    expect(compiled.layoutGuide).toBeUndefined();
});

test("detail role contracts prevent repeated full-front still lifes", () => {
    const product = createStudioProduct("image-autonomy-roles");
    const closeup = compileStudioPrompt({ product, shot: planned("detail-closeup", "展示商品表面可见纹理的局部"), model: "gpt-image-2" });
    const scene = compileStudioPrompt({ product, shot: planned("detail-scene", "展示商品在桌面上的真实使用空间关系"), model: "gpt-image-2" });
    const packageShot = compileStudioPrompt({ product, shot: planned("detail-package", "仅展示资料确认存在的包装关系"), model: "gpt-image-2" });
    const closing = compileStudioPrompt({ product, shot: planned("detail-closing", "以不同裁切回顾已确认的选购依据"), model: "gpt-image-2" });

    expect(closeup.prompt).toMatch(/放大[^。]*真实细节[^。]*不复用主视觉的整件摆拍/);
    expect(scene.prompt).toContain("商品、使用者与空间之间的真实关系");
    expect(packageShot.prompt).toContain("不把照片道具、数量或容器当作交付内容");
    expect(closing.prompt).toContain("不复拍首屏");
});

test("detail screens do not rotate a hidden visual template by screen number", () => {
    const product = createStudioProduct("image-autonomy-no-rotation");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 4 };
    const designLayers = Array.from({ length: 4 }, (_, index) => {
        const compiled = compileStudioPrompt({
            product,
            shot: { ...planned("detail-selling", "展示本屏独有的商品证据"), screenIndex: index + 1, screenCount: 4 },
            model: "gpt-image-2",
            pageKind: "detail",
        });
        return compiled.layers.find((layer) => layer.id === "art-direction")?.text || "";
    });

    expect(designLayers[0]).not.toBe("");
    expect(new Set(designLayers).size).toBe(1);
    for (const treatment of ["编辑封面", "动作瞬间", "满版近读", "双层阅读", "空间关系", "平面叙事", "安静收束"]) expect(designLayers.join("\n")).not.toContain(treatment);
});

test("historical front-facing invariants preserve print truth without locking the camera", () => {
    const product = createStudioProduct("image-autonomy-invariant");
    product.dossier = {
        ...product.dossier!,
        category: product.dossier?.category || "软抽纸巾",
        facts: [],
        invariants: ["长方体软包比例与正面朝向不变"],
    };
    const compiled = compileStudioPrompt({
        product,
        shot: planned("detail-closeup", "展示包装顶部可见开口的局部近景"),
        model: "gpt-image-2",
    });

    expect(compiled.prompt).not.toContain("正面朝向不变");
    expect(compiled.prompt).toContain("印刷版式关系不变，摄影视角按本屏内容决定");
    expect(compiled.prompt).toMatch(/放大[^。]*真实细节/);
});

test("planned detail screens carry platform and page-position context into the image prompt", () => {
    const product = createStudioProduct("image-autonomy-page-context");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 6 };
    const compiled = compileStudioPrompt({
        product,
        shot: { ...planned("detail-selling", "展示商品与真实使用动作"), screenIndex: 2, screenCount: 6 },
        model: "gpt-image-2",
    });
    expect(compiled.prompt).toContain("淘宝 / 天猫");
    expect(compiled.prompt).toContain("手机端商品详情页连续长图");
    expect(compiled.prompt).toContain("第 2/6 屏");
    expect(compiled.prompt).toContain("成品图");
    expect(copyInstructions(compiled)).toMatch(requiresCopy);
});

test("a small image prompt budget keeps the actual page, evidence, and readable copy", () => {
    const product = fixtureProduct("tight-cup", "陶瓷杯");
    product.sellerNotes = "杯柄：圆弧把手";
    const shot: StudioShot = {
        ...planned("detail-closeup", "展示杯柄和杯身的连接处"),
        screenIndex: 3,
        screenCount: 6,
        evidenceRefs: ["seller:1"],
    };
    const options = { product, brief: product.brief, shot, pageKind: "detail" as const, model: "flux-1.1-pro", maxChars: 920 };
    const compiled = compileStudioPrompt({ ...options, suite: { name: "策划", style: "", artDirection: { visualWorld: "可选的窗影与砂岩".repeat(30) } } });
    expect(compiled.prompt.length).toBeLessThanOrEqual(920);
    expect(compiled.trimmed).toContain("art-direction");
    expect(compiled.prompt).toContain("淘宝 / 天猫");
    expect(compiled.prompt).toContain("详情页连续长图");
    expect(compiled.prompt).toContain("第 3/6 屏");
    expect(compiled.prompt).toContain("展示杯柄和杯身的连接处");
    expect(compiled.prompt).toContain("圆弧把手");
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["tight-cup-front"]);
    expect(copyInstructions(compiled)).toMatch(requiresCopy);
    expect(compiled.prompt).toMatch(/所有新增文字[^。]*只用简体中文/);
    expect(compiled.prompt).toContain("不从照片估算尺寸或百分比");
    expect(compiled.textModeNotice).toContain("文字表现可能不稳定");
    expect(compiled.textMode).toBe("model");
    expect(compileStudioPrompt({ ...options, shot: { ...shot, noText: true } }).textModeNotice).toBeUndefined();
});

test("a tight ordinary detail brief retains source evidence, copy language, and seller wording", () => {
    const product = fixtureProduct("budget", "陶瓷杯");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 6 };
    product.sellerNotes = "杯柄：圆弧把手";
    const shot = { ...planned("detail-closeup", "展示杯柄和杯身的连接处"), screenIndex: 3, screenCount: 6, evidenceRefs: ["seller:1"] };
    const options = { product, brief: product.brief, model: "gpt-image-2", maxChars: 920 };
    const auto = compileStudioPrompt({ ...options, shot });
    const locked = compileStudioPrompt({ ...options, shot: { ...shot, headline: "圆弧杯柄", copySource: "user" } });

    for (const compiled of [auto, locked]) {
        expect(compiled.prompt.length).toBeLessThanOrEqual(920);
        expect(compiled.prompt).toContain("第 3/6 屏");
        expect(compiled.prompt).toContain("展示杯柄和杯身的连接处");
        expect(compiled.prompt).toContain("圆弧把手");
        expect(copyInstructions(compiled)).toMatch(/所有新增文字[^。]*只用简体中文/);
        expect(copyInstructions(compiled)).toContain("不从照片估算尺寸或百分比");
        expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["budget-front"]);
    }
    expect(copyInstructions(auto)).toMatch(requiresCopy);
    expect(copyInstructions(auto)).toMatch(/依据本屏问题和真实证据[^。\n]*可读/);
    expect(copyInstructions(locked)).toContain("「圆弧杯柄」：逐字保留");
    expect(locked.layoutGuide).toBeUndefined();
});

test("text-free ordinary detail design expresses the evidence without inviting lettering", () => {
    const product = fixtureProduct("text-free");
    product.brief = { ...product.brief, outputType: "detail-set", language: "none" };
    const shot = { ...planned("detail-closeup", "展示镜腿与铰链的接合"), screenIndex: 2, screenCount: 3 };
    const compiled = compileStudioPrompt({ product, brief: product.brief, shot, model: "gpt-image-2" });
    const guidance = compiled.layers
        .filter(({ id }) => id === "art-direction")
        .map(({ text }) => text)
        .join("\n");

    expect(copyInstructions(compiled)).toMatch(forbidsCopy);
    expect(guidance).toContain("用尺度、光影与疏密");
    expect(guidance).not.toMatch(/艺术字|图文关系|文字作用|字阶/);
    expect(compiled.layoutGuide).toBeUndefined();
});

test("a no-text product-state phrase does not disable the ordinary detail copy contract", () => {
    const product = fixtureProduct("surface-state", "纸巾包装");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2, language: "zh" };
    const shot = {
        ...planned("detail-closeup", "以无字无标的商品表面为主，展示包装压纹和纸张边缘"),
        screenIndex: 2,
        screenCount: 2,
        displayContent: "以无字无标的商品表面为主，展示包装压纹和纸张边缘",
    };
    const compiled = compileStudioPrompt({ product, brief: product.brief, shot, pageKind: "detail", model: "gpt-image-2" });

    expect(compiled.textMode).toBe("model");
    expect(copyInstructions(compiled)).toMatch(requiresCopy);
    expect(copyInstructions(compiled)).not.toMatch(forbidsCopy);
    expect(compiled.prompt).toContain("展示包装压纹和纸张边缘");
    expect(compiled.prompt).toMatch(/^【图文成品】\n必须[^\n]*可读的简体中文短文案/);
});

test("a reordered detail set sends the actual delivery position and distinct purchase tasks", () => {
    const product = fixtureProduct("glasses");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 6, shotOrder: ["p3", "p0", "p2", "p5"], shotSkip: ["p1", "p4"] };
    const screens = [
        { role: "detail-hero", purchaseQuestion: "正面是什么框型？", displayContent: "展示眼镜正面方形轮廓", visualFocus: "方框外沿" },
        { role: "detail-selling", purchaseQuestion: "镜腿外侧印纹是什么样？", displayContent: "展示镜腿外侧的装饰印纹", visualFocus: "镜腿印纹" },
        { role: "detail-closeup", purchaseQuestion: "鼻托是什么形状？", displayContent: "展示商品图中的透明鼻托", visualFocus: "鼻托的接触面" },
        { role: "detail-model", purchaseQuestion: "佩戴时框沿到哪里？", displayContent: "展示眼镜与眉线的相对位置", visualFocus: "框沿与眉线" },
        { role: "detail-scene", purchaseQuestion: "放在桌面是什么样？", displayContent: "眼镜放在书本旁边", visualFocus: "眼镜与书本的摆放" },
        { role: "detail-closing", purchaseQuestion: "怎样辨认这副眼镜？", displayContent: "同框展示外侧装饰与框沿连接", visualFocus: "外侧装饰与框沿连接处" },
    ] satisfies Pick<StudioShot, "role" | "purchaseQuestion" | "displayContent" | "visualFocus">[];
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({ screens }),
        product,
        screens.map(({ role }) => role),
        planMeta,
        { scope: "detail" },
    ).plan;
    const orderedScreens = [screens[3], screens[0], screens[2], screens[5]];
    const prompts = delivery(product);

    expect(prompts).toHaveLength(4);
    for (const [index, compiled] of prompts.entries()) {
        expect(compiled.prompt).toContain("淘宝 / 天猫");
        expect(compiled.prompt).toContain("详情页连续长图");
        expect(compiled.prompt).toContain(`第 ${index + 1}/4 屏`);
        expect(compiled.layers.find((layer) => layer.id === "planning-brief")?.text).not.toContain("屏型：");
        expect(compiled.prompt).toContain(orderedScreens[index].purchaseQuestion);
        expect(compiled.prompt).toContain(orderedScreens[index].displayContent);
        expect(compiled.prompt).toContain(orderedScreens[index].visualFocus);
        expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["glasses-front"]);
        expect(copyInstructions(compiled)).toMatch(requiresCopy);
        expect(compiled.prompt).not.toContain("【整页衔接】");
        for (const other of screens) {
            if (other === orderedScreens[index]) continue;
            for (const value of [other.purchaseQuestion, other.displayContent, other.visualFocus]) expect(compiled.prompt).not.toContain(value);
        }
    }
});

test("relative product proportions do not invite invented measurements or a second language", () => {
    const product = fixtureProduct("proportions", "浅薄荷绿吹风机");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", displayContent: "展示吹风机整机轮廓" },
                { role: "detail-size", purchaseQuestion: "出风口和机身的相对大小如何？", displayContent: "用同一件商品可见的结构表现出风口与机身的相对大小" },
            ],
        }),
        product,
        ["detail-hero", "detail-size"],
        planMeta,
        { scope: "detail" },
    ).plan;
    const [, compiled] = delivery(product);
    expect(compiled.prompt).toContain("第 2/2 屏");
    expect(compiled.prompt).toContain("出风口与机身的相对大小");
    expect(compiled.prompt).toMatch(/所有新增文字[^。]*尺寸标注[^。]*只用简体中文/);
    expect(compiled.prompt).toMatch(/不混用其他语言[^。]*不沿用参考图或旧稿的外语/);
    expect(compiled.prompt).toContain("商品原有标识和印字保留原文");
    expect(compiled.prompt).toMatch(/没有已确认的数值[^。]*不从照片估算尺寸或百分比/);
    expect(copyInstructions(compiled)).toMatch(requiresCopy);
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["proportions-front"]);
    expect(compiled.layoutGuide).toBeUndefined();
});

test("detail image copy stays grounded and only seller-locked words are literal", () => {
    const product = fixtureProduct("cup", "陶瓷杯");
    product.sellerNotes = "杯柄：圆弧把手";
    product.brief = { ...product.brief, language: "zh", outputType: "detail-set", detailScreens: 2 };
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            style: "用大号折角标题框",
            screens: [
                { role: "detail-hero", displayContent: "展示杯身完整轮廓", noText: true },
                {
                    role: "detail-closeup",
                    title: "助手拟题不要上图",
                    purchaseQuestion: "把手与杯身如何连接？",
                    displayContent: "展示杯柄与杯身的可见连接处",
                    visual: "预设左图右文",
                    visualFocus: "杯柄轮廓接到杯身处",
                    composition: "left",
                    layout: "icons",
                    headline: "不采用的卖点稿",
                    elements: "固定五张矩形卡片",
                    evidence: ["seller:1"],
                },
            ],
        }),
        product,
        ["detail-hero", "detail-closeup"],
        planMeta,
        { scope: "detail" },
    ).plan;
    expect(product.brief.detailPlan.screens[0].noText).not.toBe(true);
    const [hero, closeup] = delivery(product);
    expect(copyInstructions(hero)).toContain("简体中文");
    expect(copyInstructions(hero)).toMatch(requiresCopy);
    expect(hero.prompt).not.toMatch(forbidsCopy);
    expect(closeup.prompt).toContain("杯柄与杯身的可见连接处");
    expect(closeup.prompt).toContain("杯柄轮廓接到杯身处");
    expect(closeup.prompt).toContain("圆弧把手");
    expect(copyInstructions(closeup)).toMatch(requiresCopy);
    for (const stale of ["助手拟题不要上图", "不采用的卖点稿", "预设左图右文", "固定五张矩形卡片", "用大号折角标题框"]) expect(closeup.prompt).not.toContain(stale);
    expect(closeup.layoutGuide).toBeUndefined();

    product.brief = patchStudioDetailPlanScreen(product.brief, 1, { headline: "圆弧杯柄" });
    const [, locked] = delivery(product);
    expect(locked.prompt).toContain("圆弧杯柄");
    expect(locked.prompt).toMatch(/逐字|原文照排/);
    expect(locked.prompt).toMatch(/所有新增文字[^。]*只用简体中文/);
    expect(locked.prompt).toContain("卖家锁定文案保留原文");
    expect(locked.prompt).toContain("圆弧把手");
    expect(locked.layoutGuide).toBeUndefined();
    expect(locked.copySnapshot).toMatchObject({ headline: "圆弧杯柄", source: "user" });
});

test("new requests from saved plans retain the product evidence but discard planner-only copy and layout commands", () => {
    const product = fixtureProduct("old-display", "陶瓷杯");
    product.sellerNotes = "杯柄：圆弧把手";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            artDirection: { visualWorld: "窗边柔光；全部做成无字摄影", avoid: ["不要写文字", "混入其他品牌"] },
            screens: [
                {
                    role: "detail-hero",
                    purpose: "杯柄是什么样？",
                    visual: "展示杯身和圆弧杯柄，不放任何文字；保留杯沿釉面反光。",
                    visualFocus: "杯柄与杯身的连接处；左上保留固定文字区。",
                    imagePrompt: "杯子放在木桌上；禁用所有文字。",
                    negativePrompt: "不要添加虚构配件；不要加任何文案。",
                    evidence: ["seller:1"],
                },
                { role: "detail-closeup", displayContent: "展示杯底的圆形轮廓" },
            ],
        }),
        product,
        ["detail-hero", "detail-closeup"],
        planMeta,
        { scope: "detail" },
    ).plan;
    const [first] = delivery(product);
    expect(first.prompt).toContain("第 1/2 屏");
    expect(copyInstructions(first)).toMatch(requiresCopy);
    for (const content of ["展示杯身和圆弧杯柄", "保留杯沿釉面反光", "杯柄与杯身的连接处", "圆弧把手"]) expect(first.prompt).toContain(content);
    for (const stale of ["窗边柔光", "混入其他品牌", "无字摄影", "不要写文字", "不放任何文字", "保留固定文字区", "禁用所有文字", "不要加任何文案", "杯子放在木桌上", "不要添加虚构配件"]) expect(first.prompt).not.toContain(stale);
    expect(product.brief.detailPlan.screens[0].visual).toContain("不放任何文字");

    product.brief.extra = "左上保留固定文字区";
    const explicit = compileStudioPrompt({ product, brief: product.brief, shot: planned("detail-hero", "展示杯身"), model: "gpt-image-2" });
    expect(explicit.layers.find(({ id }) => id === "extra")?.text).toContain(product.brief.extra);
});

test("only the selected textless template screen omits copy after reordering", () => {
    const product = fixtureProduct("template");
    const suite = {
        id: "eyewear-template",
        name: "眼镜详情",
        kind: "detail",
        source: "admin",
        category: "眼镜",
        style: "",
        shots: [
            { title: "头图", duty: "展示正面轮廓" },
            { title: "细节特写", duty: "展示镜腿铰链", noText: true },
        ],
    } as const;
    product.brief = { ...product.brief, outputType: "template-set", suite: { ...suite, shots: [...suite.shots] }, shotOrder: ["p1", "p0"] };
    product.brief.templatePlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", displayContent: "展示正面轮廓" },
                { role: "detail-closeup", displayContent: "展示镜腿铰链" },
            ],
        }),
        product,
        studioTemplatePlanRoles(product, product.brief.suite!),
        planMeta,
        { scope: "template" },
    ).plan;
    const [textless, withCopy] = delivery(product);
    expect(textless.prompt).toContain("第 1/2 屏");
    expect(textless.prompt).toContain("展示镜腿铰链");
    expect(textless.prompt).toMatch(forbidsCopy);
    expect(textless.prompt).not.toMatch(requiresCopy);
    expect(withCopy.prompt).toContain("第 2/2 屏");
    expect(copyInstructions(withCopy)).toMatch(requiresCopy);
    expect(withCopy.prompt).not.toMatch(forbidsCopy);
});

test("white-background and platform-restricted cover outputs do not acquire copy", () => {
    const product = fixtureProduct("white");
    product.brief.outputType = "white";
    const [white] = delivery(product);
    expect(white.prompt).toMatch(/纯白背景|白色背景/);
    expect(white.prompt).toMatch(forbidsCopy);
    expect(white.prompt).not.toMatch(requiresCopy);

    product.platform = "jd";
    product.brief.outputType = "main";
    const [jd] = delivery(product);
    expect(jd.prompt).toContain("京东");
    expect(jd.prompt).toMatch(forbidsCopy);
    expect(jd.prompt).not.toContain("详情页连续长图");
});

test("explicit textless detail does not also instruct the image model to add a title", () => {
    const product = fixtureProduct("no-copy");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2, language: "none" };
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", displayContent: "展示眼镜正面轮廓" },
                { role: "detail-closeup", displayContent: "展示透明鼻托" },
            ],
        }),
        product,
        ["detail-hero", "detail-closeup"],
        planMeta,
        { scope: "detail" },
    ).plan;
    for (const { prompt } of delivery(product)) {
        expect(prompt).toMatch(forbidsCopy);
        expect(prompt).not.toMatch(requiresCopy);
    }
});

test("a no-text clause in user requirements overrides automatic detail copy without matching literal copy", () => {
    const product = fixtureProduct("textless-clause");
    const shot = planned("detail-hero", "展示眼镜正面轮廓");
    const input = { product, shot, pageKind: "detail" as const, model: "gpt-image-2" };
    const extra = compileStudioPrompt({ ...input, brief: { ...product.brief, extra: "白底，不加文字" } });
    const adjusted = compileStudioPrompt({ ...input, shot: { ...shot, adjust: "调整光线；请不加字。" } });
    for (const compiled of [extra, adjusted]) {
        expect(copyInstructions(compiled)).toMatch(forbidsCopy);
        expect(copyInstructions(compiled)).not.toMatch(requiresCopy);
    }
    const literal = compileStudioPrompt({ ...input, brief: { ...product.brief, extra: "避免使用『不加文字』这几个字" } });
    expect(copyInstructions(literal)).toMatch(requiresCopy);
});

test("short planner output fills the selected count with grounded page briefs rather than textless placeholder photos", () => {
    const product = fixtureProduct("short-plan", "双耳汤碗");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 3, language: "ja" };
    const result = parseDetailPlan(JSON.stringify({ screens: [{ role: "detail-hero", purchaseQuestion: "正面是什么轮廓？", displayContent: "展示汤碗及两侧把手" }] }), product, ["detail-hero", "detail-closeup", "detail-closing"], planMeta, {
        scope: "detail",
    });
    product.brief.detailPlan = result.plan;
    const outputs = delivery(product);
    expect(outputs).toHaveLength(3);
    expect(outputs[2].prompt).toContain("下单前还需要确认什么");
    expect(outputs[2].prompt).toContain("用尚未展示且有依据的选购、到手、安装或维护信息回答最后的下单疑虑");
    expect(outputs[2].prompt).not.toContain("只回顾已有理由");
    expect(result.warnings.some(({ field }) => field === "screens")).toBe(true);
    expect(result.plan.screens.every(({ noText }) => noText !== true)).toBe(true);
    for (const [index, compiled] of outputs.entries()) {
        expect(compiled.prompt).toContain(`第 ${index + 1}/3 屏`);
        expect(compiled.prompt).toContain("双耳汤碗");
        expect(copyInstructions(compiled)).toMatch(/所有新增文字[^。]*只用日文/);
        expect(copyInstructions(compiled)).toMatch(requiresCopy);
        expect(compiled.prompt).not.toMatch(forbidsCopy);
    }
});

test("a missing final detail screen uses unused confirmed selection evidence instead of a closing poster", () => {
    const product = fixtureProduct("chair-fit", "餐椅");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.dossier = {
        name: product.name,
        category: "餐椅",
        family: "home",
        summary: "弧背餐椅",
        invariants: [],
        questions: [],
        facts: [{ id: "seat-height", group: "spec", label: "坐高", value: "45 厘米", evidence: "confirmed" }],
    };
    const result = parseDetailPlan(JSON.stringify({ screens: [{ role: "detail-hero", purchaseQuestion: "这是什么椅子？", displayContent: "整把弧背餐椅" }] }), product, ["detail-hero", "detail-size", "detail-closing"], planMeta, { scope: "detail" });
    product.brief.detailPlan = result.plan;
    expect(result.plan.screens[1]).toMatchObject({ role: "detail-size", evidenceRefs: ["fact:seat-height"] });
    const compiled = delivery(product)[1];
    expect(compiled.prompt).toContain("第 2/2 屏");
    expect(compiled.prompt).toContain("坐高 45 厘米");
    expect(compiled.prompt).toContain("已确认的数值和单位照实写");
    expect(compiled.layoutGuide).toBeUndefined();
});

test("a single selling-point image is not a detail page despite its role ID", () => {
    const product = fixtureProduct("single-selling");
    product.platform = "xiaohongshu";
    product.brief.outputType = "selling";
    product.brief.singlePlan = parseDetailPlan(JSON.stringify({ screens: [{ role: "detail-selling", displayContent: "展示镜腿展开状态" }] }), product, ["detail-selling"], planMeta, { scope: "single", targets: [{ type: "selling", count: 1 }] }).plan;
    const [single] = delivery(product);
    expect(single.prompt).toContain("小红书");
    expect(single.prompt).toMatch(/独立商品图|单张(?:商品)?卖点图/);
    expect(single.prompt).toContain("展示镜腿展开状态");
    expect(single.prompt).not.toContain("详情页连续长图");
    expect(single.prompt).not.toMatch(/第 \d+\/\d+ 屏/);
});

test("rerendering a historical detail run restores original platform and position without replaying its design template", () => {
    const product = fixtureProduct("historical-run");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    const { purchaseQuestion: _question, displayContent: _content, visualFocus: _focus, ...legacyShot } = planned("detail-closeup", "");
    const submittedPrompt = "旧图片请求：只拍商品，不加文字。";
    const second: StudioShot = {
        ...legacyShot,
        title: "旧助手拟标题",
        headline: "旧助手画面文案",
        composition: "left",
        visual: "内容版式「旧版框」：固定五个白框。\n本屏构图「左文右图」（主体和文字的位置以此为准）：左侧固定排字。\n这一屏要让买家明白：鼻托是什么形状？\n画面：展示透明鼻托的可见轮廓\n信息元素：画三个固定徽章",
        attempts: [
            {
                id: "historical-attempt",
                taskId: "historical-task",
                model: "gpt-image-2",
                tweaks: [],
                status: "succeeded",
                createdAt: product.createdAt,
                outputs: [],
                input: {
                    compiled: {
                        prompt: submittedPrompt,
                        layers: [],
                        textMode: "model",
                        adapter: { family: "gpt-image", label: "GPT Image", textRendering: "strong" },
                        references: product.photos,
                        modelReferences: [],
                        styleReferences: [],
                        trimmed: [],
                    },
                    request: { aspectRatio: "3:4", imageSettings: {} },
                },
            },
        ],
    };
    const oldRun: StudioRun = {
        id: "legacy",
        createdAt: product.createdAt,
        type: "detail-set",
        kind: "detail",
        source: studioGenerationSource(product),
        textMode: "overlay",
        quality: "",
        shots: [{ ...planned("detail-hero", "展示正面完整轮廓"), attempts: [] }, second],
    };
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun({ ...product, platform: "jd", brief: { ...product.brief, outputType: "white", language: "none" } }, oldRun))))!;
    const rebuilt = studioImageInput(restored, locateStudioShot(restored, { runId: oldRun.id }, second.id)!, "gpt-image-2", defaultConfig).compiled;
    expect(rebuilt.prompt).toContain("淘宝 / 天猫");
    expect(rebuilt.prompt).toContain("详情页连续长图");
    expect(rebuilt.prompt).toContain("第 2/2 屏");
    expect(rebuilt.prompt).toContain("鼻托是什么形状？");
    expect(rebuilt.prompt).toContain("展示透明鼻托的可见轮廓");
    expect(copyInstructions(rebuilt)).toMatch(requiresCopy);
    for (const stale of ["旧助手拟标题", "旧助手画面文案", "固定五个白框", "左侧固定排字", "画三个固定徽章"]) expect(rebuilt.prompt).not.toContain(stale);
    expect(rebuilt.layoutGuide).toBeUndefined();
    expect(rebuilt.textMode).toBe("model");
    expect(restored.runs[0].shots[1].attempts[0].input?.compiled.prompt).toBe(submittedPrompt);
});
