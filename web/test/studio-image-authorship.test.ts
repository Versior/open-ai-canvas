import { expect, test } from "bun:test";
import { STUDIO_SINGLE_TYPES } from "@/lib/ecommerce-studio/brief";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan, studioPlanTargetRoles } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, studioSingleTargets } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";

function shoulderBag() {
    const product = createStudioProduct("shoulder-bag");
    product.name = "棕色扁桶包";
    product.photos = [{ id: "front", resourceId: "bag-original", url: "", truth: true, view: "front", addedAt: "" }];
    product.dossier = {
        name: product.name,
        category: "单肩包",
        family: "apparel",
        summary: "窄肩带连接两侧",
        invariants: [],
        questions: [],
        facts: [
            { id: "strap", group: "structure", label: "肩带", value: "细长肩带连接包身两侧", evidence: "visible", source: "图1" },
            { id: "snapshot", group: "package", label: "包装与配件", value: "画面仅见包体与肩带，未见防尘袋、吊牌或包装", evidence: "visible", source: "图1" },
        ],
    };
    return product;
}

function compiledRun(product: ReturnType<typeof shoulderBag>) {
    let serial = 0;
    const run = createStudioRun(product, () => `id-${++serial}`);
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    return restored.runs[0].shots.map((_, index) => studioImageInput(restored, studioLocateRunShot(restored.runs[0], index), "gpt-image-2", defaultConfig).compiled);
}

const cover = {
    role: "detail-hero",
    purchaseQuestion: "这是什么包？",
    displayContent: "看清扁桶形包身和棕色包边；上方出现 GUCCI 字。短文案：“上宽下窄，扁平桶形”。保留包内原印字「棕色，单肩款」。",
    visualBeat: "完整包身和两侧连接处",
};
const carrying = {
    role: "detail-model",
    purchaseQuestion: "背上身时包身落在哪里？",
    displayContent: "肩带经过肩膀，包的边缘贴在身体一侧。",
    visualBeat: "肩带与肩膀的接触关系",
};
const packageDraft = {
    role: "detail-package",
    purchaseQuestion: "下单到手到底包含哪些东西？",
    displayContent: "包体与已连好的肩带平放。短文案：“图中到手：包体与肩带”。未见防尘袋、吊牌或包装。",
    evidence: ["fact:snapshot"],
};

test("真实包图式策划只传展示内容，不把嵌入短文案和照片未见的包装当成成品要求", () => {
    const product = shoulderBag();
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 3 };
    const roles = studioDetailPlanRoles(product);
    expect(roles).not.toContain("detail-package");
    const parsed = parseDetailPlan(JSON.stringify({ screens: [cover, carrying, packageDraft] }), product, roles, { id: "plan", model: "planner", createdAt: "" }, { scope: "detail" });
    product.brief.detailPlan = parsed.plan;
    expect(parsed.plan.screens).toHaveLength(3);
    expect(parsed.plan.screens[0].displayContent).not.toContain("扁平桶形");
    const briefs = compiledRun(product);
    for (const brief of briefs) {
        expect(brief.references.map((photo) => photo.resourceId)).toEqual(["bag-original"]);
        expect(brief.layoutGuide).toBeUndefined();
        expect(brief.prompt).not.toMatch(/图中到手|未见防尘袋|上方出现 GUCCI 字|短文案：“上宽下窄/);
    }
    expect(briefs[0].prompt).toContain("棕色，单肩款");
    expect(briefs[1].prompt).toContain("肩带与肩膀的接触关系");
    expect(briefs[2].prompt).not.toContain(packageDraft.purchaseQuestion);
});

test("已保存策划中的旧内嵌文案不会被新生成照印，卖家锁字仍优先", () => {
    const product = shoulderBag();
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.copy = { headline: "我的单肩包", subhead: "", bullets: [], listingTitle: "" };
    product.brief.detailPlan = parseDetailPlan(JSON.stringify({ screens: [cover, carrying] }), product, studioDetailPlanRoles(product), { id: "plan", model: "planner", createdAt: "" }, { scope: "detail" }).plan;
    Object.assign(product.brief.detailPlan.screens[0], { displayContent: cover.displayContent, visual: cover.displayContent });
    const [brief] = compiledRun(product);
    expect(brief.copySnapshot?.headline).toBe("我的单肩包");
    expect(brief.prompt).toContain("我的单肩包");
    expect(brief.prompt).not.toContain("上宽下窄，扁平桶形");
});

test("所有单张入口和主图套图共用原图直出，而非镜头模板或程序字块", () => {
    for (const { id } of [...STUDIO_SINGLE_TYPES, { id: "main-set" as const }]) {
        const product = shoulderBag();
        product.brief.outputType = id;
        for (const brief of compiledRun(product)) {
            expect(brief.references[0].resourceId).toBe("bag-original");
            expect(brief.layoutGuide).toBeUndefined();
            expect(brief.prompt).not.toMatch(/等效 \d+mm|构图与机位|画面右侧五分之三|未见防尘袋/);
            expect(brief.prompt).toContain("图片模型");
            if (id === "white") expect(brief.prompt).toMatch(/纯白背景[\s\S]*不添加任何文字|不添加任何文字[\s\S]*纯白背景/);
        }
    }
});

test("单张策划不把分析模型的版式、视觉主题、翻写指令带进图片请求", () => {
    const product = shoulderBag();
    product.brief.outputType = "poster";
    const targets = studioSingleTargets(product.brief);
    const parsed = parseDetailPlan(
        JSON.stringify({ artDirection: { visualWorld: "紫背景银色横条" }, screens: [{ ...cover, headline: "策划标题", imagePrompt: "画一排红胶囊", negativePrompt: "不要黄色" }] }),
        product,
        studioPlanTargetRoles(targets),
        { id: "single-plan", model: "planner", createdAt: "" },
        { scope: "single", targets },
    );
    product.brief.singlePlan = parsed.plan;
    const [brief] = compiledRun(product);
    expect(brief.prompt).not.toMatch(/紫背景银色横条|策划标题|画一排红胶囊|不要黄色|上宽下窄，扁平桶形/);
    expect(brief.prompt).toContain("棕色包边");
    expect(brief.prompt).toContain("简体中文");
});
