import { expect, test } from "bun:test";
import { studioEyebrowText, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
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

test("a planner response contradicting a no-English request cannot reach image generation", () => {
    const product = createStudioProduct("design-test");
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2, planNote: "不要英文栏目，不要页码" };
    const roles = studioDetailPlanRoles(product);
    const screens = ["detail-hero", "detail-closing"].map((role) => ({ role, visual: "右侧商品，左侧中文标题", composition: "left", headline: "透明前框", eyebrow: "CLEAR FRAME" }));
    expect(() => parseDetailPlan(JSON.stringify({ screens }), product, roles, { id: "plan", model: "m", createdAt: "" })).toThrow(/英文栏目/);
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

test("old plans also enforce no-English before submitting an image task", () => {
    const product = createStudioProduct("design-test");
    product.brief.planNote = "不要暖白台面、植物、窗格阴影、展台、英文栏目、页码";
    expect(() => compileStudioPrompt({ product, shot: { ...shot, eyebrow: "CLEAR FRAME" }, model: "gpt-image" })).toThrow(/英文栏目/);
});

test("composition survives trimming and precedes the visual and shared style", () => {
    const product = createStudioProduct("design-test");
    const compiled = compileStudioPrompt({ product, shot, model: "gpt-image", suite: { name: "old", style: "顶部标题加商品居中" } });
    expect(compiled.prompt.indexOf("本屏构图契约")).toBeLessThan(compiled.prompt.indexOf("这一屏的画面"));
    expect(compiled.prompt).toContain("保持左右分栏");
    const tight = compileStudioPrompt({ product, shot, model: "gpt-image", suite: { name: "old", style: "顶部标题加商品居中" }, maxChars: compiled.prompt.length - 10 });
    expect(tight.layers.some((layer) => layer.id === "composition")).toBe(true);
    expect(tight.prompt).toContain("宽 38%");
});

test("layout reference never displaces product truth or a locked seller reference", () => {
    const product = createStudioProduct("design-test");
    product.photos = [{ id: "truth", resourceId: "truth", url: "", view: "front", truth: true, name: "商品图", addedAt: "" }];
    const guided = compileStudioPrompt({ product, shot: { ...shot, visual: undefined }, model: "gpt-image", maxReferences: 2 });
    expect(guided.layoutGuide?.composition).toBe("left");
    expect(guided.references.map((photo) => photo.id)).toEqual(["truth"]);
    expect(guided.prompt).toContain("图2为图文区域参考");
    expect(guided.prompt).toContain("不复制草图的两条等大粗线");
    expect(compileStudioPrompt({ product, shot, model: "gpt-image", maxReferences: 2 }).layoutGuide).toBeUndefined();
    expect(compileStudioPrompt({ product, shot, model: "gpt-image", maxReferences: 1 }).layoutGuide).toBeUndefined();
    expect(compileStudioPrompt({ product, shot, model: "gpt-image", brief: { ...product.brief, sameLayout: true } }).layoutGuide).toBeUndefined();
    expect(compileStudioPrompt({ product, shot: { ...shot, headline: "", subline: "" }, model: "gpt-image" }).layoutGuide).toBeUndefined();
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
