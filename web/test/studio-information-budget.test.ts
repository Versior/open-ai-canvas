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
test("过密首屏在扣费生成前被拦下，参数页允许必要信息", () => {
    expect(() => compileStudioPrompt({ product, shot, model: "gpt-image-2", textMode: "model" })).toThrow("信息过密");
    expect(() => compileStudioPrompt({ product, shot: { ...shot, role: "detail-spec" }, model: "gpt-image-2", textMode: "model" })).not.toThrow();
});
test("生成约束明确单一焦点和阅读尺度，策划连接购买问题与证据", () => {
    const compiled = compileStudioPrompt({ product, shot: { ...shot, lines: ["自然握持"] }, model: "gpt-image-2", textMode: "model" });
    expect(compiled.prompt).toContain("一屏只回答一个购买问题");
    expect(compiled.prompt).toContain("手机宽度");
    const prompt = buildDetailPlanPrompt(product, ["detail-hero", "detail-selling", "detail-scene", "detail-closing"]);
    expect(prompt).toContain("痛点 → 解决方案 → 可验证证据");
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

test("结构化艺术导演方案从策划快照进入最终图片提示词", () => {
    const plan = normalizeStudioDetailPlan({
        id: "art-plan",
        createdAt: "2026-11-22",
        model: "text",
        summary: "以雾气和金属反光表现晨间饮水",
        style: "冷雾蓝与暖金光的编辑感视觉系统",
        artDirection: {
            emotionalPromise: "让买家感到清醒、轻盈、可靠",
            visualWorld: "清晨窗边的薄雾与金属光",
            palette: [{ name: "雾蓝", hex: "#9DB7C9", role: "背景" }, { name: "暖金", hex: "#D9A441", role: "强调" }],
            typographyTreatment: "细黑体正文配一处沿蒸汽曲线变形的艺术字标题",
            materialEffects: ["玻璃上的雾气高光", "细金属线条"],
            compositionGrammar: "整组以大面积负空间和局部跨界裁切形成呼吸",
            recurringMotifs: ["蒸汽弧线", "金属细线"],
            screenVariationPlan: "首屏字主图次，证据屏微距主导，场景屏让动作成为焦点",
            referenceDna: "迁移参考图的不等大网格和窄栏注解",
            avoid: ["连续圆角信息卡", "无关贴纸"],
        },
        screens: [{ role: "detail-hero", title: "晨间一杯", purpose: "建立商品识别", visual: "窗边雾气中的保温杯", layout: "poster", elements: "艺术字标题沿蒸汽弧线排布", eyebrow: "", headline: "一杯装下一整天", subline: "500ml 大容量", lines: [], facts: [], noText: false }],
    })!;
    expect(plan.artDirection?.palette?.[1]).toEqual({ name: "暖金", hex: "#D9A441", role: "强调" });
    const compiled = compileStudioPrompt({
        product,
        shot: { ...shot, visual: "窗边雾气中的保温杯", lines: [] },
        model: "gpt-image-2",
        suite: { name: "按商品策划", style: plan.style, artDirection: plan.artDirection },
    });
    expect(compiled.prompt).toContain("整组艺术导演方案");
    expect(compiled.prompt).toContain("允许艺术字、异形排字、材质字和非规则字块");
    expect(compiled.prompt).toContain("本屏必须与相邻屏在景别、重心、图文关系或节奏上有明确变化");
});
