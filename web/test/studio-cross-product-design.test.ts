import { expect, test } from "bun:test";
import catalog from "../../backend/internal/ecommerceagent/studio_design_catalog.json";
import { buildStudioDesignCheckPrompt } from "@/lib/ecommerce-studio/design-check";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { compileStudioShot, locateStudioShot, studioImageInput, studioImageInputCount } from "@/lib/ecommerce-studio/generation-input";
import { buildDirectionsPrompt, parseDirections } from "@/lib/ecommerce-studio/plan-prep-tasks";
import { createStudioProduct, normalizeStudioProduct, studioChangeStyle } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, studioActivePlan } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";
import type { StudioCompositionId, StudioDesignToneId, StudioProduct, StudioStylePresetId } from "@/lib/ecommerce-studio/types";

type Variant = { style: StudioStylePresetId; tone: StudioDesignToneId; system: string; type: string };
type Example = { name: string; family: NonNullable<StudioProduct["dossier"]>["family"]; composition: StudioCompositionId; headline: string; photo: string; variants: Variant[] };

// 手工蓝图夹具验证真实数据传递，不把它们当作文本模型已生成或图片质量已通过的证据。
const examples: Example[] = [
    {
        name: "儿童眼镜",
        family: "generic",
        composition: "orbit",
        headline: "清透前框",
        photo: "完整镜架作为主摄影，镜框边缘近景作较小证据窗口；透明前框轮廓呼应环绕负空间",
        variants: [
            { style: "candy", tone: "playful", system: "天空蓝 #BFE3FF、暖黄 #FFE27A、深蓝字 #17354B", type: "清透用小号圆黑体，前框用宽字面大字，两词围绕镜框留白共享起笔轴线" },
            { style: "noir", tone: "editorial", system: "午夜蓝 #14243C、白字 #FFFFFF、暖黄强调 #FFE27A", type: "清透用细窄黑体，前框为中黑大字，沿镜框弧线错开两词起笔位置" },
        ],
    },
    {
        name: "机械键盘",
        family: "electronics",
        composition: "sidebar",
        headline: "键帽轮廓",
        photo: "完整键盘在宽幅摄影区建立识别，键帽表面特写在窄边窗形成尺度差，不画内部芯片",
        variants: [
            { style: "tech", tone: "tech", system: "石墨黑 #15171A、冷白字 #F6F8FC、橙色强调 #FF7833", type: "键帽为窄字面粗黑大词，轮廓为小词沿按键边界对齐，细线连接真实键帽" },
            { style: "editorial", tone: "editorial", system: "暖纸白 #F3EEE6、墨黑字 #202020、朱红强调 #D84636", type: "键帽为中宋大字，轮廓为细黑小词缩进，词组边界接续侧栏特写边缘" },
        ],
    },
    {
        name: "曲奇饼干",
        family: "food",
        composition: "diagonal",
        headline: "饼干纹理",
        photo: "一枚完整饼干沿对角线放大，可见烘烤表面近景作次级层，不添加未确认的原料",
        variants: [
            { style: "vivid", tone: "hot-seller", system: "暖橙 #F36E32、奶白字 #FFF4DF、深棕辅助 #4F2E21", type: "饼干为厚实圆黑大字，纹理小字缩进，长短字块顺着饼干对角边界" },
            { style: "oriental", tone: "oriental", system: "玉绿 #294A40、米白字 #F4E8CC、赭红强调 #AA4935", type: "饼干为竖向中宋大字，纹理为横向细黑小字，留白与饼干弧边相接" },
        ],
    },
    {
        name: "护理精华",
        family: "beauty",
        composition: "window",
        headline: "瓶身弧线",
        photo: "完整瓶身作主摄影，可见瓶肩弧面近景为小窗口，与主摄影建立圆弧呼应；不展示未知膏体",
        variants: [
            { style: "luxe", tone: "editorial", system: "酒红 #502436、浅粉字 #F6E6E7、金米强调 #D8BA8B", type: "瓶身用小号细黑，弧线用窄长宋体大字，词组下缘与瓶肩摄影窗口相接" },
            { style: "organic", tone: "global-minimal", system: "鼠尾草 #D4DED1、墨绿字 #24382D、米白辅助 #F7F2E7", type: "瓶身小词与弧线中等大字形成纵向间隔，细宋字块呼应瓶肩曲率，以负空间形成张力" },
        ],
    },
    {
        name: "衬衫",
        family: "apparel",
        composition: "diptych",
        headline: "衣领走线",
        photo: "一侧是完整衬衫，另一侧为较窄衣领走线摄影；主图越过摄影分界，但领形完整可辨",
        variants: [
            { style: "editorial", tone: "editorial", system: "纸白 #F2EBDD、深蓝字 #243B58、淡蓝辅助 #AABDCF", type: "衣领为宽字面中黑大词，走线细字贴近局部摄影，词组沿双幅分界错位" },
            { style: "oriental", tone: "oriental", system: "墨蓝 #24313E、米白字 #F2EBDD、赭色强调 #AF7554", type: "衣领为细宋竖向大字，走线为横向小字，两轴与双幅摄影边界呼应" },
        ],
    },
    {
        name: "陶瓷杯",
        family: "home",
        composition: "ribbon",
        headline: "杯口弧面",
        photo: "完整杯形为主摄影，真实杯口近景融入中段窄摄影带；杯身跨横带边界，杯口不遮挡",
        variants: [
            { style: "warm", tone: "lifestyle", system: "杏白 #F4E2CC、深棕字 #49382D、苔绿辅助 #66755B", type: "杯口小词沿横带左缘，弧面为圆角黑体大词，横向字块呼应口沿" },
            { style: "fresh", tone: "editorial", system: "淡蓝 #C9DFEE、海军蓝字 #203E57、白色辅助 #FFFFFF", type: "杯口用细窄黑小词，弧面为中宋大字并下沉缩进，与横带构成连续阅读路径" },
        ],
    },
];

for (const example of examples)
    for (const variant of example.variants) {
        test(`${example.name}／${variant.style}：排字与摄影构成经过解析、存储、生成快照和重试仍保留`, () => {
            let product = createStudioProduct("cross-product");
            product.name = example.name;
            product.style = variant.style;
            product.photos = [{ id: "truth", resourceId: `truth-${example.name}`, view: "front", truth: true, url: "", addedAt: "" }];
            product.brief = { ...product.brief, productType: example.name, outputType: "detail-set", detailScreens: 2 };
            product.dossier = { name: example.name, category: example.name, family: example.family, summary: example.photo, facts: [], invariants: [`保留${example.name}的实际结构与本色`], questions: [] };
            const roles = studioDetailPlanRoles(product);
            expect(buildDirectionsPrompt(product, "detail")).toContain(catalog.posterDesign.hero);
            expect(buildDetailPlanPrompt(product, roles)).toContain(catalog.posterDesign.principles);
            const visual = `${example.name}主视觉：${example.photo}。${variant.type}。背景与文字系统：${variant.system}。先读核心词，再辨认商品，最后看近景证据。`;
            product.brief.detailPlan = parseDetailPlan(
                JSON.stringify({
                    style: variant.system,
                    tone: variant.tone,
                    designAnalysis: `${example.name}的可见形态决定摄影景别，${variant.type}`,
                    screens: [
                        { role: "detail-hero", layout: "poster", composition: example.composition, title: "形态识别", purpose: "识别商品的可见外观", visual, elements: variant.type, headline: example.headline },
                        { role: "detail-closing", layout: "closing", composition: "bottom", visual: "完整商品与短说明", headline: example.headline },
                    ],
                }),
                product,
                roles,
                { id: `plan-${variant.style}`, model: "fixture", createdAt: "" },
            ).plan;
            product = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
            let id = 0;
            const run = createStudioRun(product, () => `run-${++id}`);
            product = appendStudioRun(product, run);
            const ref = { runId: run.id };
            const shot = run.shots[0];
            const input = studioImageInput(product, locateStudioShot(product, ref, shot.id)!, "gpt-image-2", defaultConfig);
            expect(input.compiled.prompt).toContain(visual);
            expect(input.compiled.prompt).toContain(variant.type);
            expect(input.compiled.prompt).toContain(variant.system);
            expect(input.compiled.prompt).toContain(`「${example.headline}」`);
            expect(input.compiled.references.map((photo) => photo.resourceId)).toEqual([`truth-${example.name}`]);
            expect(input.compiled.layoutGuide).toBeUndefined();
            expect(studioImageInputCount(input)).toBe(1);
            expect(input.compiled.prompt).not.toContain("严格按草图分区");
            expect(input.compiled.prompt).not.toContain("主标题明显最大，其余逐级变小");
            shot.attempts = [{ id: "attempt", model: "gpt-image-2", status: "submitting", tweaks: [], outputs: [], createdAt: "", input }];
            product.name = "另一件商品";
            product.style = "mist";
            product.brief = { ...product.brief, language: "en", extra: "新的配色", detailPlan: undefined };
            const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
            const located = locateStudioShot(restored, ref, shot.id)!;
            expect(located.shot.attempts[0].input?.compiled.prompt).toBe(input.compiled.prompt);
            expect(compileStudioShot(restored, located, "gpt-image-2", defaultConfig).compiled.prompt).toBe(input.compiled.prompt);
            const check = buildStudioDesignCheckPrompt(restored, located.shot, true, input.compiled);
            expect(check).toContain(variant.system);
            expect(check).toContain(variant.type);
            expect(check).toContain("不能只因配色匹配、没有错字就判设计通过");
        });
    }

test("方向摘要的文字与摄影关系不会被旧90字上限截断", () => {
    const product = createStudioProduct("directions");
    const visual = "完整商品在侧栏外形成主摄影，真实局部进入窄边摄影窗口。标题拆成核心词和支持词，核心词窄黑大字，支持词小字缩进，两词沿摄影边界共享轴线。场景纵深只作为次级层次，商品本色保持，背景为暖纸白，墨黑字和朱红强调色各有职责。";
    expect(visual.length).toBeGreaterThan(90);
    const directions = parseDirections(JSON.stringify({ directions: ["形态视角", "使用视角"].map((angle) => ({ angle, positioning: "识别真实形态", concept: "摄影边界与轮廓", visual })) }), () => "direction", product);
    expect(normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, brief: { ...product.brief, prep: { asks: [], directions, picked: "direction" } } })))?.brief.prep?.directions[0].visual).toBe(visual);
});

test("实际换质感使旧策划与旧选中方向失效，历史生成仍保留原设计", () => {
    let product = createStudioProduct("change-tone");
    product.style = "fresh";
    product.photos = [{ id: "truth", resourceId: "cup", view: "front", truth: true, url: "", addedAt: "" }];
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    const plan = parseDetailPlan(
        JSON.stringify({
            style: "淡蓝 #C9DFEE 与海军蓝字 #203E57",
            screens: [
                { role: "detail-hero", layout: "poster", composition: "left", visual: "左侧杯口小词，弧面大字下沉缩进；右侧完整杯形与杯口近景", headline: "杯口弧面" },
                { role: "detail-closing", layout: "closing", composition: "bottom", visual: "完整商品与短说明", headline: "杯口弧面" },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        { id: "old", model: "fixture", createdAt: "" },
    ).plan;
    product.brief.detailPlan = plan;
    let id = 0;
    const run = createStudioRun(product, () => `tone-${++id}`);
    product = appendStudioRun(product, run);
    product.brief = { ...product.brief, mainPlan: plan, singlePlan: plan, templatePlan: plan, prep: { asks: [], directions: [], picked: "old-direction" } };
    const ref = { runId: run.id };
    const before = compileStudioShot(product, locateStudioShot(product, ref, run.shots[0].id)!, "gpt-image-2", defaultConfig).compiled.prompt;
    expect(studioChangeStyle(product, "fresh")).toBe(product);
    const changed = normalizeStudioProduct(JSON.parse(JSON.stringify(studioChangeStyle(product, "oriental"))))!;
    expect(changed.style).toBe("oriental");
    expect(studioActivePlan(changed)).toBeUndefined();
    for (const field of ["detailPlan", "mainPlan", "singlePlan", "templatePlan"] as const) expect(changed.brief[field]).toBeUndefined();
    expect(changed.brief.prep?.picked).toBeUndefined();
    expect(changed.runs[0].suite?.style).toBe(plan.style);
    expect(compileStudioShot(changed, locateStudioShot(changed, ref, run.shots[0].id)!, "gpt-image-2", defaultConfig).compiled.prompt).toBe(before);
    expect(studioActivePlan(studioChangeStyle(changed, "fresh"))).toBeUndefined();
});
