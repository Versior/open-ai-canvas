import { expect, test } from "bun:test";
import { STUDIO_COMPOSITION_IDS, STUDIO_COMPOSITIONS, STUDIO_IMAGE_ZONES, STUDIO_CHANNEL_DESIGN } from "@/lib/ecommerce-studio/art-direction";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { studioProductStyle } from "@/lib/ecommerce-studio/shot-specs";
import { studioAutoColorIssue, studioDesignProfile } from "@/lib/ecommerce-studio/design-knowledge";
import { studioDetailLayoutIds, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { buildDirectionsPrompt, parseDirections } from "@/lib/ecommerce-studio/plan-prep-tasks";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { ECOMMERCE_PLATFORMS } from "@/lib/ecommerce/ecommerce-platform-specs";

function kids() {
    const product = createStudioProduct("kids-glasses");
    product.name = "儿童眼镜";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.dossier = { name: "儿童眼镜", category: "眼镜", family: "generic", summary: "透明前框", facts: [], invariants: [], questions: [] };
    return product;
}

test("儿童眼镜即使识别为通用品类，也不能自动落到灰白质感", () => {
    const product = createStudioProduct("kids-glasses");
    product.name = "儿童眼镜";
    product.style = "auto";
    product.dossier = { name: "儿童眼镜", category: "眼镜", family: "generic", summary: "透明前框", facts: [], invariants: [], questions: [] };
    expect(["candy", "fresh", "cream", "vivid"]).toContain(studioProductStyle(product).id);
    product.style = "mist";
    expect(studioProductStyle(product).id).toBe("mist");
});

test("图文构图提供实际不同的设计骨架", () => {
    expect(STUDIO_COMPOSITION_IDS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(STUDIO_COMPOSITION_IDS.map((id) => JSON.stringify(STUDIO_IMAGE_ZONES[id]))).size).toBe(STUDIO_COMPOSITION_IDS.length);
    for (const id of STUDIO_COMPOSITION_IDS) {
        const zone = STUDIO_COMPOSITIONS[id].zone;
        for (const [x, y, width, height] of STUDIO_IMAGE_ZONES[id]) {
            expect(x + width).toBeLessThanOrEqual(1);
            expect(y + height).toBeLessThanOrEqual(1);
            const overlap = Math.min(x + width, zone.x + zone.width) > Math.max(x, zone.x) && Math.min(y + height, zone.y + zone.height) > Math.max(y, zone.y);
            expect(overlap).toBe(false);
        }
    }
});

test("儿童眼镜与数码获得不同候选，构图与设计依据进入保存和实际出图", () => {
    const product = kids();
    const tech = { ...product, name: "机械键盘", dossier: { ...product.dossier!, name: "机械键盘", category: "键盘", family: "electronics" as const } };
    expect(studioDesignProfile(product).key).toBe("kids");
    expect(studioDesignProfile(tech).key).toBe("electronics");
    expect(studioDesignProfile(product).compositions).not.toEqual(studioDesignProfile(tech).compositions);
    const prompt = buildDetailPlanPrompt(product, studioDetailPlanRoles(product));
    expect(prompt.indexOf("- candy（")).toBeLessThan(prompt.indexOf("- mist（"));
    expect(prompt).toContain("灰色镜腿或透明镜片是商品颜色");
    expect(prompt).toContain("优先信息版式：color-block");
    expect(buildDirectionsPrompt(product, "detail")).toContain("商品设计匹配");
    for (const composition of STUDIO_COMPOSITION_IDS) {
        const parsed = parseDetailPlan(
            JSON.stringify({
                styleId: "candy",
                style: "天空蓝 #BFE3FF 与暖黄 #FFE27A",
                designAnalysis: "透明前框以暖黄背景和清楚边缘展示，儿童场景明亮。",
                screens: [
                    { role: "detail-hero", layout: "color-block", composition, visual: "明亮场景", headline: "清透前框" },
                    { role: "detail-closing", layout: "macro", composition: "macro", visual: "真实局部", headline: "清透前框" },
                ],
            }),
            product,
            studioDetailPlanRoles(product),
            { id: "plan", model: "text", createdAt: "" },
        );
        const restored = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, brief: { ...product.brief, detailPlan: parsed.plan } })))!;
        let index = 0;
        const run = createStudioRun(restored, () => `shot-${index++}`);
        const compiled = compileStudioPrompt({ product: restored, shot: run.shots[0], suite: run.suite, brief: restored.brief, model: "gpt-image-2" });
        expect(run.shots[0].composition).toBe(composition);
        expect(compiled.prompt).toContain(STUDIO_COMPOSITIONS[composition].render);
        expect(compiled.prompt).toContain("#FFE27A");
        expect(compiled.layoutGuide).toBeUndefined();
        expect(compiled.prompt).toContain("本屏画面蓝图决定具体排字");
        const compressed = compileStudioPrompt({ product: restored, shot: run.shots[0], suite: run.suite, brief: restored.brief, model: "gpt-image-2", maxChars: compiled.prompt.length - 10 });
        expect(compressed.trimmed).not.toContain("style");
        expect(compressed.prompt).toContain("#FFE27A");
    }
});

test("儿童自动灰板被拦截，明确锁定和平台白底保留", () => {
    const product = kids();
    expect(studioAutoColorIssue(product, { styleId: "pure", style: "灰白 #EEEEEE 与冷灰 #AAAAAA" })).toBeDefined();
    expect(studioAutoColorIssue(product, { styleId: "pure", style: "天空蓝 #BFE3FF 与暖黄 #FFE27A" })).toBeUndefined();
    expect(studioAutoColorIssue({ ...product, style: "mist" }, { style: "灰白" })).toBeUndefined();
    expect(studioAutoColorIssue({ ...product, brief: { ...product.brief, extra: "使用灰白极简" } }, { style: "灰白" })).toBeUndefined();
    expect(studioAutoColorIssue({ ...product, brief: { ...product.brief, extra: "不要灰白" } }, { style: "灰白" })).toBeDefined();
    expect(studioAutoColorIssue({ ...product, brief: { ...product.brief, outputType: "white" } }, { style: "灰白" })).toBeUndefined();
    expect(() => parseDetailPlan('{"styleId":"pure","style":"灰白","screens":[]}', product, [], { id: "p", model: "m", createdAt: "" })).toThrow("儿童商品");
    const directions = ["家长视角", "孩子视角"].map((angle) => ({
        angle,
        positioning: "选购眼镜",
        concept: "阅读",
        palette: [
            { name: "灰白", hex: "#EEEEEE" },
            { name: "灰", hex: "#BBBBBB" },
        ],
    }));
    expect(() => parseDirections(JSON.stringify({ directions }), () => "d", product)).toThrow("儿童商品");
});

test("无材质、操作、参数依据时不开放对应设计，全部平台有自己的方法", () => {
    const product = kids();
    const available = studioDetailLayoutIds(product);
    for (const blocked of ["mechanism", "ingredients", "material-board", "data", "timeline", "proof"]) expect(available).not.toContain(blocked);
    expect(available).toContain("color-block");
    product.dossier!.facts = [
        { id: "material", group: "material", label: "材质", value: "已确认材料", evidence: "confirmed" },
        { id: "usage", group: "usage", label: "操作", value: "已确认步骤", evidence: "confirmed" },
    ];
    expect(studioDetailLayoutIds(product)).toContain("material-board");
    expect(studioDetailLayoutIds(product)).toContain("timeline");
    for (const platform of ECOMMERCE_PLATFORMS) expect(STUDIO_CHANNEL_DESIGN[platform.id]).toBeDefined();
    expect(new Set(Object.values(STUDIO_CHANNEL_DESIGN)).size).toBe(ECOMMERCE_PLATFORMS.length);
});
