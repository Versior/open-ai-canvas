import { expect, test } from "bun:test";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { buildDetailPlanPrompt } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { normalizeStudioDetailPlan, patchStudioDetailPlanScreen, studioScreenCopyIssue } from "@/lib/ecommerce-studio/detail-plan";
import type { StudioDetailPlan } from "@/lib/ecommerce-studio/types";

const product = createStudioProduct("budget-test");
product.name = "示例水杯";
product.photos = [{ id: "photo", resourceId: "resource", url: "", view: "front", truth: true, addedAt: "2026-11-10" }];
let index = 0;
const shot = { ...createStudioRun(product, () => `budget-${++index}`).shots[0], role: "detail-hero" as const, visual: "杯子主视觉", headline: "方便握持", subline: "可见把手", lines: ["要点一", "要点二", "要点三", "要点四"] };
test("AI 策划过密时交给图片模型删减，用户锁定文案仍在扣费前拦下", () => {
    expect(() => compileStudioPrompt({ product, shot, model: "gpt-image-2", textMode: "model" })).not.toThrow();
    expect(() => compileStudioPrompt({ product, shot: { ...shot, copySource: "user" }, model: "gpt-image-2", textMode: "model" })).toThrow("信息过密");
    expect(() => compileStudioPrompt({ product, shot: { ...shot, role: "detail-spec" }, model: "gpt-image-2", textMode: "model" })).not.toThrow();
});
test("生成约束明确单一焦点和阅读尺度，策划连接购买问题与证据", () => {
    const compiled = compileStudioPrompt({ product, shot: { ...shot, purchaseQuestion: "杯子的轮廓是什么", lines: ["自然握持"] }, pageKind: "detail", model: "gpt-image-2", textMode: "model" });
    expect(compiled.prompt).toContain("购买问题：杯子的轮廓是什么");
    expect(compiled.prompt).toContain("手机阅读");
    const prompt = buildDetailPlanPrompt(product, ["detail-hero", "detail-selling", "detail-scene", "detail-closing"]);
    expect(prompt).toMatch(/先[^。\n]*选购与使用[^。\n]*答案[^。\n]*再[^。\n]*分配屏数[^。\n]*标 role/);
});

test("策划编辑与刷新保留超限要点，提示调整而不是静默截断", () => {
    const plan: StudioDetailPlan = {
        id: "plan",
        createdAt: "",
        model: "text",
        summary: "",
        style: "",
        screens: [{ role: "detail-hero", title: "首屏", purpose: "识别", visual: "商品主视觉", layout: "poster", elements: "", eyebrow: "", headline: "握持方便", subline: "可见把手", lines: [], facts: [] }],
    };
    const lines = Array.from({ length: 7 }, (_, index) => `第${index + 1}条用户要点`);
    const edited = patchStudioDetailPlanScreen({ ...product.brief, detailPlan: plan }, 0, { lines });
    expect(edited.detailPlan!.screens[0].lines).toEqual(lines);
    const restored = normalizeStudioDetailPlan(JSON.parse(JSON.stringify(edited.detailPlan)))!;
    expect(restored.screens[0].lines).toEqual(lines);
    expect(studioScreenCopyIssue(restored.screens[0])).toContain("最多 2 条");
});

test("旧版艺术方向保留在历史策划，不进入新的普通详情图", () => {
    const plan = normalizeStudioDetailPlan({
        id: "art-plan",
        createdAt: "2026-11-22",
        model: "text",
        summary: "以雾气和金属反光表现晨间饮水",
        style: "冷雾蓝与暖金光的编辑感视觉系统",
        artDirection: {
            emotionalPromise: "让买家感到清醒、轻盈、可靠",
            visualWorld: "清晨窗边的薄雾与金属光",
            palette: [
                { name: "雾蓝", hex: "#9DB7C9", role: "背景" },
                { name: "暖金", hex: "#D9A441", role: "强调" },
            ],
            typographyTreatment: "细黑体正文配一处沿蒸汽曲线变形的艺术字标题",
            materialEffects: ["玻璃上的雾气高光", "细金属线条"],
            compositionGrammar: "整组以大面积负空间和局部跨界裁切形成呼吸",
            recurringMotifs: ["蒸汽弧线", "金属细线"],
            screenVariationPlan: "首屏字主图次，证据屏微距主导，场景屏让动作成为焦点",
            referenceDna: "迁移参考图的不等大网格和窄栏注解",
            avoid: ["连续圆角信息卡", "无关贴纸"],
        },
        screens: [
            {
                role: "detail-hero",
                title: "晨间一杯",
                purpose: "建立商品识别",
                visual: "窗边雾气中的保温杯",
                layout: "poster",
                elements: "艺术字标题沿蒸汽弧线排布",
                eyebrow: "",
                headline: "一杯装下一整天",
                subline: "500ml 大容量",
                lines: [],
                facts: [],
                noText: false,
            },
        ],
    })!;
    expect(plan.artDirection?.palette?.[1]).toEqual({ name: "暖金", hex: "#D9A441", role: "强调" });
    const compiled = compileStudioPrompt({
        product,
        shot: { ...shot, visual: "窗边雾气中的保温杯", lines: [] },
        pageKind: "detail",
        model: "gpt-image-2",
        suite: { name: "按商品策划", style: plan.style, artDirection: plan.artDirection },
    });
    expect(compiled.prompt).toContain("窗边雾气中的保温杯");
    expect(compiled.prompt).not.toContain("清晨窗边的薄雾与金属光");
    expect(compiled.layers.find((layer) => layer.id === "art-direction")?.text).toContain("由图片模型自定构成");
    expect(compiled.layers.find((layer) => layer.id === "copy")?.text).toMatch(/艺术字[^。]*特效/);
    expect(compiled.prompt).toContain("不做同一张商品照换背景");
    for (const lock of ["#9DB7C9", "细黑体正文配一处", "整组以大面积负空间"]) expect(compiled.prompt).not.toContain(lock);
});
