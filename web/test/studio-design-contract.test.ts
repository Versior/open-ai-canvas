import { expect, test } from "bun:test";
import { studioEyebrowText, studioDetailPlanRoles, studioPlannedShotVisual } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioPlanInputSignature } from "@/lib/ecommerce-studio/plan-input";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { studioCompositionConflict } from "@/lib/ecommerce-studio/art-direction";
import { parseStudioDesignCheck } from "@/lib/ecommerce-studio/design-check";
import { readStudioCheckSession, saveStudioCheckSession } from "@/lib/ecommerce-studio/design-check-session";
import type { StudioShot } from "@/lib/ecommerce-studio/types";

test("optional section headings preserve the chosen language instead of forcing English", () => {
    expect(studioEyebrowText("01 框边透亮")).toBe("框边透亮");
    expect(studioEyebrowText("02 · CLEAR FRAME")).toBe("CLEAR FRAME");
});

test("Chinese planner does not require decorative English labels", () => {
    const product = createStudioProduct("design-test");
    expect(buildDetailPlanPrompt(product, studioDetailPlanRoles(product))).not.toContain("主标题上方的英文栏目小标题");
    expect(buildDetailPlanPrompt(product, studioDetailPlanRoles(product))).not.toContain("英文栏目小标题、主标题");
});

test("an ordinary detail planner cannot override a seller's no-English request with draft copy", () => {
    const product = createStudioProduct("design-test");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2, planNote: "不要英文栏目，不要页码" };
    const roles = studioDetailPlanRoles(product);
    const screens = ["detail-hero", "detail-closing"].map((role) => ({ role, displayContent: "看清镜框轮廓", composition: "left", headline: "透明前框", eyebrow: "CLEAR FRAME" }));
    const result = parseDetailPlan(JSON.stringify({ screens }), product, roles, { id: "plan", model: "m", createdAt: "" });
    expect(result.plan.screens).toHaveLength(2);
    expect(result.plan.screens.every((screen) => !screen.eyebrow && !screen.headline)).toBe(true);
    product.brief.detailPlan = result.plan;
    const run = createStudioRun(product, () => "screen");
    const compiled = compileStudioPrompt({ product, brief: product.brief, shot: run.shots[0], model: "gpt-image-2" });
    expect(compiled.prompt).toContain("不要英文栏目，不要页码");
    expect(compiled.prompt).not.toContain("CLEAR FRAME");
});

const shot: StudioShot = {
    id: "shot",
    role: "detail-hero",
    title: "前框",
    ratio: "3:4",
    visual: "右侧透明镜架，左侧文字区",
    composition: "left",
    layout: "poster",
    headline: "透明前框",
    subline: "柔灰镜腿",
    lines: [],
    tweaks: [],
    attempts: [],
    sellingPointIds: [],
};

test("planned screens leave non-locked English labels to the image model", () => {
    const product = createStudioProduct("design-test");
    product.brief.planNote = "不要暖白台面、植物、窗格阴影、展台、英文栏目、页码";
    expect(compileStudioPrompt({ product, shot: { ...shot, eyebrow: "CLEAR FRAME" }, model: "gpt-image" }).prompt).not.toContain("CLEAR FRAME");
});

test("AI composition is optional and does not become a fixed contract", () => {
    const product = createStudioProduct("design-test");
    const compiled = compileStudioPrompt({ product, shot, model: "gpt-image", suite: { name: "old", style: "顶部标题加商品居中" } });
    expect(compiled.layers.some((layer) => layer.id === "composition" || layer.id === "planned-layout")).toBe(false);
    expect(compiled.prompt).not.toContain("顶部标题加商品居中");
    expect(compiled.layoutGuide).toBeUndefined();
});

test("historical suite design fields are not replayed as design instructions", () => {
    const product = createStudioProduct("suite-inspiration-only");
    const compiled = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            copySource: "assistant",
            headline: "ASSISTANT_HEADLINE_MARK",
            visual: "用商品轮廓回答买家对外观的第一印象",
            purchaseQuestion: "BUYER_QUESTION_MARK",
            displayContent: "DISPLAY_CONTENT_MARK",
            visualFocus: "VISUAL_FOCUS_MARK",
        },
        pageKind: "detail",
        model: "gpt-image",
        suite: {
            name: "历史策划",
            style: "STYLE_INSPIRATION_MARK",
            designAnalysis: "DESIGN_ANALYSIS_FIXED_LAYOUT_MARK",
        },
    });
    for (const value of ["BUYER_QUESTION_MARK", "DISPLAY_CONTENT_MARK", "VISUAL_FOCUS_MARK"]) expect(compiled.prompt).toContain(value);
    for (const value of ["STYLE_INSPIRATION_MARK", "DESIGN_ANALYSIS_FIXED_LAYOUT_MARK", "ASSISTANT_HEADLINE_MARK"]) expect(compiled.prompt).not.toContain(value);
    expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toMatch(/排版|版式/);
});

test("assistant planner copy stays out of the image prompt so the image model owns typography", () => {
    const product = createStudioProduct("assistant-copy-autonomy");
    const assistantShot = {
        ...shot,
        copySource: "assistant" as const,
        eyebrow: "ASSISTANT_EYEBROW_MARK",
        headline: "ASSISTANT_HEADLINE_MARK",
        subline: "ASSISTANT_SUBLINE_MARK",
        lines: ["ASSISTANT_LINE_MARK"],
        visual: "用商品轮廓和一束侧光回答买家对外形的第一印象",
    };
    const compiled = compileStudioPrompt({ product, shot: assistantShot, pageKind: "detail", model: "gpt-image" });
    expect(compiled.prompt).not.toContain("ASSISTANT_EYEBROW_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_HEADLINE_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_SUBLINE_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_LINE_MARK");
    expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toMatch(/必须[^。\n]*可读[^。\n]*简体中文/);
});

test("planned image prompts keep only the structured buyer brief", () => {
    const product = createStudioProduct("structured-brief-autonomy");
    const compiled = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            title: "ASSISTANT_TITLE_MARK",
            layout: "callout",
            composition: "left",
            copySource: "assistant",
            headline: "ASSISTANT_HEADLINE_MARK",
            subline: "ASSISTANT_SUBLINE_MARK",
            lines: ["ASSISTANT_LINE_MARK"],
            visual: "LEGACY_VISUAL_BLUEPRINT_MARK：固定左栏标题、右侧商品、引线和镜头参数",
            purchaseQuestion: "BUYER_QUESTION_MARK",
            displayContent: "DISPLAY_CONTENT_MARK",
            visualFocus: "VISUAL_FOCUS_MARK",
        },
        model: "gpt-image",
    });
    expect(compiled.prompt).toContain("BUYER_QUESTION_MARK");
    expect(compiled.prompt).toContain("DISPLAY_CONTENT_MARK");
    expect(compiled.prompt).toContain("VISUAL_FOCUS_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_TITLE_MARK");
    expect(compiled.prompt).not.toContain("LEGACY_VISUAL_BLUEPRINT_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_HEADLINE_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_SUBLINE_MARK");
    expect(compiled.prompt).not.toContain("ASSISTANT_LINE_MARK");
    expect(compiled.prompt).not.toContain("本屏构图契约");
});

test("run snapshots compile structured fields instead of assistant layout text", () => {
    const visual = studioPlannedShotVisual({
        purpose: "BUYER_QUESTION_MARK",
        visual: "LEGACY_LAYOUT_MARK：固定左栏标题、右侧商品",
        displayContent: "DISPLAY_CONTENT_MARK",
        visualFocus: "VISUAL_FOCUS_MARK",
        facts: ["FACT_MARK"],
        evidenceRefs: ["fact:one"],
    });
    expect(visual).toContain("购买问题：BUYER_QUESTION_MARK");
    expect(visual).toContain("展示内容：DISPLAY_CONTENT_MARK");
    expect(visual).toContain("视觉入口：VISUAL_FOCUS_MARK");
    expect(visual).toContain("本屏依据主题：FACT_MARK");
    expect(visual).not.toContain("LEGACY_LAYOUT_MARK");
    expect(visual).not.toContain("固定左栏标题");
});

test("ordinary detail run snapshots keep content but do not promote legacy image instructions", () => {
    const product = createStudioProduct("structured-prompt-fields");
    product.photos = [{ id: "truth", resourceId: "truth", url: "", view: "front", truth: true, addedAt: "" }];
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.brief.detailPlan = {
        id: "plan",
        createdAt: "",
        inputSignature: "",
        model: "planner",
        summary: "",
        style: "",
        screens: [
            {
                role: "detail-hero",
                title: "入口",
                purpose: "回答外观问题",
                visual: "展示商品完整轮廓",
                purchaseQuestion: "回答外观问题",
                displayContent: "展示商品完整轮廓",
                visualFocus: "轮廓边缘",
                imagePrompt: "只补充窗边自然光下的商品状态",
                negativePrompt: "不添加未确认的配件",
                layout: "poster",
                elements: "",
                eyebrow: "",
                headline: "",
                subline: "",
                lines: [],
                facts: [],
                copySource: "assistant",
            },
            {
                role: "detail-closing",
                title: "收束",
                purpose: "回答购买顾虑",
                visual: "展示商品与真实使用环境",
                purchaseQuestion: "回答购买顾虑",
                displayContent: "展示商品与真实使用环境",
                visualFocus: "商品与环境关系",
                layout: "closing",
                elements: "",
                eyebrow: "",
                headline: "",
                subline: "",
                lines: [],
                facts: [],
                copySource: "assistant",
            },
        ],
    };
    product.brief.detailPlan.inputSignature = studioPlanInputSignature(product);
    let index = 0;
    const run = createStudioRun(product, () => `prompt-fields-${++index}`);
    expect(run.shots[0]).toMatchObject({ purchaseQuestion: "回答外观问题", displayContent: "展示商品完整轮廓", visualFocus: "轮廓边缘" });
    expect(run.shots[0].imagePrompt).toBeUndefined();
    expect(run.shots[0].negativePrompt).toBeUndefined();
    expect(run.shots[1].imagePrompt).toBeUndefined();
    expect(run.shots[1].negativePrompt).toBeUndefined();
});

test("user-locked copy remains verbatim while assistant copy remains free", () => {
    const product = createStudioProduct("user-copy-lock");
    const compiled = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            copySource: "user",
            headline: "USER_LOCKED_HEADLINE",
            subline: "USER_LOCKED_SUBLINE",
            lines: ["USER_LOCKED_LINE"],
            visual: "用商品轮廓和一束侧光回答买家对外形的第一印象",
        },
        model: "gpt-image",
    });
    expect(compiled.prompt).toContain("USER_LOCKED_HEADLINE");
    expect(compiled.prompt).toContain("USER_LOCKED_SUBLINE");
    expect(compiled.prompt).toContain("USER_LOCKED_LINE");
    expect(compiled.prompt).toContain("用户锁定的主标题「USER_LOCKED_HEADLINE」：逐字保留");
});

test("an independent poster requires readable text while a photography-only placement can omit it", () => {
    const product = createStudioProduct("empty-copy-autonomy");
    const compiled = compileStudioPrompt({
        product,
        shot: { ...shot, copySource: "assistant", eyebrow: "", headline: "", subline: "", lines: [], visual: "用商品轮廓和自然光回答买家对外形的第一印象" },
        pageKind: "single",
        model: "gpt-image",
    });
    expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toMatch(/必须[^。\n]*可读[^。\n]*简体中文/);
    const photo = compileStudioPrompt({ product, shot: { ...shot, role: "detail-ugc", copySource: "assistant" }, pageKind: "single", model: "gpt-image" });
    expect(photo.layers.find((layer) => layer.id === "copy")?.text).toMatch(/短注若能帮助[^。]*由图片模型/);
    expect(photo.prompt).not.toMatch(/不添加任何文字|必须[^。\n]*可读[^。\n]*简体中文/);
});

test("planned screens carry an explicit content layout contract instead of falling back to one poster template", () => {
    const product = createStudioProduct("layout-contract");
    const left = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            role: "detail-selling",
            title: "结构卖点",
            layout: "callout",
            composition: "left",
            visual: "右侧放大镜腿连接处，左侧短标题与两条引线标签。信息元素：两条细引线分别落到镜腿连接处和鼻托，标签紧邻对应部位",
            headline: "看清连接",
        },
        model: "gpt-image",
    });
    const right = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            role: "detail-scene",
            title: "佩戴关系",
            layout: "scene",
            composition: "corner",
            visual: "满版窗边阅读场景，人物在右下佩戴眼镜，左上自然留白。信息元素：标题贴左上负空间，不能出现引线、图标卡或顶部横条",
            headline: "戴上看世界",
        },
        model: "gpt-image",
    });
    const leftLayout = left.layers.find((layer) => layer.id === "planned-layout");
    const rightLayout = right.layers.find((layer) => layer.id === "planned-layout");
    expect(leftLayout).toBeUndefined();
    expect(rightLayout).toBeUndefined();
    expect(left.prompt).toContain("两条细引线分别落到镜腿连接处和鼻托");
    expect(right.prompt).toContain("左上自然留白");
    expect(left.prompt).not.toContain("满版窗边阅读场景");
    expect(right.prompt).not.toContain("两条细引线分别落到镜腿连接处");
});

test("hero and closeup have distinct content responsibilities rather than a repeated camera template", () => {
    const product = createStudioProduct("variation-contract");
    const hero = compileStudioPrompt({ product, shot, pageKind: "detail", model: "gpt-image" });
    const closeup = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            role: "detail-closeup",
            title: "看清连接",
            layout: "macro",
            visual: "右侧放大镜腿连接处，左下只放短标题",
        },
        model: "gpt-image",
    });
    expect(hero.layers.find((layer) => layer.id === "visual")?.text).toContain("完整商品主视觉");
    expect(closeup.layers.find((layer) => layer.id === "visual")?.text).toMatch(/放大[^。]*真实细节/);
    expect(closeup.prompt).toContain("不复用主视觉的整件摆拍");
    expect(hero.prompt).not.toMatch(/放大[^。]*真实细节/);
});

test("art direction keeps model-native effects available without allowing unrelated information", () => {
    const product = createStudioProduct("native-effects");
    const compiled = compileStudioPrompt({
        product,
        shot: {
            ...shot,
            visual: "暖光中商品沿弧线构图，标题与蒸汽形态呼应",
            layout: "poster",
            headline: "暖风呵护",
        },
        model: "gpt-image",
        suite: {
            name: "编辑感",
            style: "克制留白",
            artDirection: {
                typographyTreatment: "标题可沿蒸汽弧线变形",
                materialEffects: ["柔和光晕"],
                recurringMotifs: ["蒸汽弧线"],
            },
        },
    });
    expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toMatch(/艺术字[^。]*特效/);
    expect(compiled.layers.find((layer) => layer.id === "artwork")?.text).toMatch(/材质光效[^。]*按需要参与画面/);
    expect(compiled.prompt).not.toContain("柔和光晕");
    expect(compiled.layers.find((layer) => layer.id === "art-direction")?.text).toContain("由图片模型自定构成");
    expect(compiled.prompt).not.toContain("标题可沿蒸汽弧线变形");
    expect(compiled.prompt).not.toContain("一律不出现");
});

test("the default flow does not attach a layout guide; an uploaded layout reference preserves product truth", () => {
    const product = createStudioProduct("design-test");
    product.photos = [{ id: "truth", resourceId: "truth", url: "", view: "front", truth: true, name: "商品图", addedAt: "" }];
    product.references = [{ id: "layout", resourceId: "layout", url: "", view: "other", truth: false, name: "版式参考", addedAt: "" }];
    const guided = compileStudioPrompt({ product, shot, brief: { ...product.brief, sameLayout: true }, model: "gpt-image", maxReferences: 2 });
    expect(guided.layoutGuide).toBeUndefined();
    expect(guided.references.map((photo) => photo.id)).toEqual(["truth"]);
    expect(guided.styleReferences.map((photo) => photo.id)).toEqual(["layout"]);
    expect(guided.layers.find((layer) => layer.id === "layout")?.text).toContain("以参考图为准");
    expect(guided.layers.some((layer) => layer.id === "art-direction")).toBe(false);
    const white = compileStudioPrompt({ product, shot: { ...shot, role: "main-white" }, brief: { ...product.brief, sameLayout: true }, model: "gpt-image", maxReferences: 2 });
    expect(white.references.map((photo) => photo.id)).toEqual(["truth"]);
    expect(white.styleReferences).toEqual([]);
    expect(white.layers.some((layer) => ["art-direction", "layout"].includes(layer.id))).toBe(false);
    const textless = compileStudioPrompt({ product, shot: { ...shot, noText: true }, brief: product.brief, model: "gpt-image", maxReferences: 2 });
    expect(textless.layers.find((layer) => layer.id === "copy")?.title).toBe("无字成品");
    expect(textless.layers.find((layer) => layer.id === "layout")?.text).not.toContain("字阶");
    expect(compileStudioPrompt({ product, shot, model: "gpt-image", maxReferences: 2 }).layoutGuide).toBeUndefined();
    const single = compileStudioPrompt({ product, shot, brief: product.brief, model: "gpt-image", maxReferences: 1 });
    expect(single.references.map((photo) => photo.id)).toEqual(["truth"]);
    expect(single.styleReferences).toEqual([]);
    expect(single.layoutGuide).toBeUndefined();
});

test("explicit opposite title positions are rejected without misreading accessory locations", () => {
    expect(studioCompositionConflict({ composition: "right", visual: "右侧框边特写，左侧约三成放短标题与两行注解" })).toBe(true);
    expect(studioCompositionConflict({ composition: "left", visual: "左侧透明镜腿特写，右侧文字纵向排布" })).toBe(true);
    expect(studioCompositionConflict({ composition: "left", visual: "右侧镜腿，左侧放标题，右侧小标签标注桩头" })).toBe(false);
});

test("actual-image checks require evidence for all four areas and carry only failed corrections", () => {
    const findings = ["text", "composition", "product", "design"].map((area) => ({ area, status: area === "composition" ? "fail" : "unknown", evidence: "图中标题在顶部", correction: area === "composition" ? "把主标题移到左侧，商品保持右侧" : "" }));
    const result = parseStudioDesignCheck(JSON.stringify({ observedText: ["透明前框"], findings }));
    expect(result.revision).toBe("把主标题移到左侧，商品保持右侧");
    expect(result.findings[0].status).toBe("unknown");
    expect(() => parseStudioDesignCheck(JSON.stringify({ observedText: [], findings: findings.slice(1) }))).toThrow(/文字/);
    expect(() => parseStudioDesignCheck(JSON.stringify({ observedText: [], findings: [...findings, findings[0]] }))).toThrow(/文字/);
    expect(() => parseStudioDesignCheck(JSON.stringify({ observedText: [], findings: findings.map((item) => ({ ...item, evidence: "" })) }))).toThrow(/证据/);
});

test("single-image corrections retain the actual selected candidate and product truth", () => {
    const product = createStudioProduct("design-test");
    product.photos = [{ id: "truth", resourceId: "truth", url: "", view: "front", truth: true, addedAt: "" }];
    const source = { ...shot, attempts: [{ id: "old", status: "succeeded" as const, model: "gpt-image", tweaks: [], createdAt: "", outputs: [{ resourceId: "artwork", url: "" }] }] };
    const compiled = compileStudioPrompt({ product, shot: source, model: "gpt-image", maxReferences: 2, revisionResourceId: "artwork" });
    expect(compiled.references.map((photo) => photo.resourceId)).toEqual(["truth"]);
    expect(compiled.revisionReference?.resourceId).toBe("artwork");
    expect(compiled.layoutGuide).toBeUndefined();
    expect(compiled.prompt).toContain("图2是待修正的当前成品");
    const limited = compileStudioPrompt({
        product,
        shot: { ...source, role: "detail-model", visual: "模特佩戴商品，商品清楚可见" },
        model: "gpt-image",
        maxReferences: 2,
        revisionResourceId: "artwork",
        brief: { ...product.brief, shooting: "model", model: { figure: { itemId: "person", resourceId: "person", name: "模特", prompt: "" } } },
    });
    expect(limited.modelReferences).toHaveLength(0);
    expect(limited.referenceNotice).toContain("最多带 2 张图");
    expect(limited.referenceNotice).toContain("已为待修正成品预留一张");
    expect(() => compileStudioPrompt({ product, shot: source, model: "gpt-image", maxReferences: 1, revisionResourceId: "artwork" })).toThrow(/多参考图/);
    expect(() => compileStudioPrompt({ product, shot: source, model: "gpt-image", revisionResourceId: "unrelated" })).toThrow(/成功记录/);
    product.plans = [{ id: "plan", kind: "detail", textMode: "model", createdAt: "", shots: [{ ...source, attempts: [...source.attempts, { ...source.attempts[0], id: "new", status: "submitting", outputs: [], revisionResourceId: "artwork" }] }] }];
    expect(normalizeStudioProduct(product)?.plans[0].shots[0].attempts[1].revisionResourceId).toBe("artwork");
});

test("refresh resumes the same check operation and task without crossing user scopes", () => {
    const entries = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => entries.set(key, value) } } });
    try {
        saveStudioCheckSession("alice", "artwork", { operationId: "same-operation", running: true });
        expect(readStudioCheckSession("alice", "artwork")).toEqual({ operationId: "same-operation", running: false });
        saveStudioCheckSession("alice", "artwork", { operationId: "same-operation", taskId: "same-task", running: true });
        expect(readStudioCheckSession("alice", "artwork")?.taskId).toBe("same-task");
        expect(readStudioCheckSession("bob", "artwork")).toBeUndefined();
    } finally {
        if (original) Object.defineProperty(globalThis, "window", original);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
