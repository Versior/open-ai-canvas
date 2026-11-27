import { expect, test } from "bun:test";
import { patchStudioDetailPlanScreen, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { locateStudioShot, studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";

function detailProduct(name: string, resourceId: string, detailScreens: number) {
    const product = createStudioProduct("product");
    product.name = name;
    product.brief = { ...product.brief, productType: name, outputType: "detail-set", detailScreens };
    product.photos = [{ id: "photo", resourceId, view: "front", truth: true, url: "", addedAt: "" }];
    return product;
}

function parseScreens(product: ReturnType<typeof detailProduct>, screens: readonly Record<string, unknown>[]) {
    return parseDetailPlan(JSON.stringify({ screens }), product, studioDetailPlanRoles(product), { id: "plan", model: "planner", createdAt: "" }, { scope: "detail" });
}

function restoredImageBriefs(product: ReturnType<typeof detailProduct>) {
    let serial = 0;
    const run = createStudioRun(product, () => `run-${++serial}`);
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    return restored.runs[0].shots.map((shot) => studioImageInput(restored, locateStudioShot(restored, { runId: run.id }, shot.id)!, "gpt-image-2", defaultConfig).compiled);
}

const squid = [
    { role: "detail-hero", purchaseQuestion: "这种鱿鱼是什么样？", displayContent: "看清完整鱿鱼的外形", visualFocus: "身体边缘", visualBeat: "完整的鱿鱼形态" },
    { role: "detail-scene", purchaseQuestion: "拿起来是什么样？", displayContent: "看到手和商品实际接触的地方", visualFocus: "指尖的触点", visualBeat: "手指捏起鱿鱼的动作" },
    { role: "detail-scene", purchaseQuestion: "上桌时是什么样？", displayContent: "看到食用情境中鱿鱼的样子", visualFocus: "盛放状态", visualBeat: "鱿鱼和餐具的食用关系" },
    { role: "detail-closeup", purchaseQuestion: "边缘长什么样？", displayContent: "看清露出的边缘", visualFocus: "表面纹路", visualBeat: "鱿鱼切面与外缘的对照" },
];

test("同一商品原图按交付顺序传递本屏独有的画面主线，不发送其他屏", () => {
    const product = detailProduct("即食鱿鱼", "squid-original", squid.length);
    product.brief.detailPlan = parseScreens(product, squid).plan;
    product.brief.shotOrder = ["p0", "p2", "p1", "p3"];
    product.brief.shotSkip = ["p3"];
    const briefs = restoredImageBriefs(product);
    const delivered = [squid[0], squid[2], squid[1]];

    expect(briefs).toHaveLength(delivered.length);
    for (const [index, brief] of briefs.entries()) {
        const current = delivered[index];
        const visual = brief.layers.find(({ id }) => id === "visual")?.text;
        expect(brief.prompt).toContain(`第 ${index + 1}/${delivered.length} 屏`);
        expect(brief.references.map(({ resourceId }) => resourceId)).toEqual(["squid-original"]);
        expect(brief.styleReferences).toEqual([]);
        expect(brief.layoutGuide).toBeUndefined();
        expect(visual).toContain(`画面主线：${current.visualBeat}`);
        expect(visual).toContain(`视觉入口：${current.visualFocus}`);
        expect(brief.layers.find(({ id }) => id === "truth")?.text).toMatch(/原图里的手[^。]+不是商品；只有本屏内容或卖家明确需要才沿用/);
        expect(brief.layers.find(({ id }) => id === "art-direction")?.text).toContain("没有参考也自行设计");
        for (const other of delivered.filter((screen) => screen !== current)) {
            expect(brief.prompt).not.toContain(other.visualBeat);
            expect(brief.prompt).not.toContain(other.purchaseQuestion);
        }
        expect(brief.prompt).not.toContain(squid[3].visualBeat);
    }
});

test("识别与特写不用手托照片当构图，真实操作仍交给图片模型", () => {
    const product = detailProduct("鲜小鱿鱼", "squid-in-hand", 3);
    product.dossier = {
        name: product.name,
        category: "小鱿鱼",
        family: "food",
        summary: "",
        facts: [{ id: "spots", group: "appearance", label: "体表纹理", value: "乳白半透明的体表有黑褐色斑点", evidence: "visible" }],
        invariants: [],
        questions: [],
    };
    product.brief.detailPlan = parseScreens(product, [
        {
            role: "detail-hero",
            purchaseQuestion: "这款是否为整只小鱿鱼？",
            displayContent: "头、外套膜与双鳍相连，整体被手托住展示。",
            visualBeat: "两只并排被手托住，头端朝上。",
        },
        {
            role: "detail-closeup",
            purchaseQuestion: "体表的斑点是什么样的？",
            displayContent: "乳白半透明的体表有黑褐色斑点。",
            visualFocus: "斑点的大小和疏密",
            visualBeat: "近看手托住的小鱿鱼，乳白体表上分布深色斑点。",
            evidence: ["fact:spots"],
        },
        {
            role: "detail-scene",
            purchaseQuestion: "整只鱿鱼如何移入备料碗？",
            displayContent: "手托着鱿鱼放入备料碗，碗接住完整食材。",
            visualBeat: "手与备料碗之间的承接动作",
        },
    ]).plan;
    const [hero, closeup, operation] = restoredImageBriefs(product);
    const visual = (brief: typeof hero) => brief.layers.find(({ id }) => id === "visual")!.text;
    expect(visual(hero)).toContain("头、外套膜与双鳍相连");
    expect(visual(hero)).not.toMatch(/被手托|被托起|头端朝上/);
    expect(hero.prompt).not.toMatch(/刻度|推定档位/);
    expect(visual(closeup)).toContain("斑点的大小和疏密");
    expect(visual(closeup)).not.toMatch(/手托|体表纹理\s+乳白半透明/);
    expect(visual(operation)).toContain("手托着鱿鱼放入备料碗");
    expect(visual(operation)).toContain("手与备料碗之间的承接动作");
    expect([hero, closeup, operation].every((brief) => brief.references[0].resourceId === "squid-in-hand" && !brief.layoutGuide)).toBe(true);
});

test("操控零件的特写不丢动作，也不把实拍里抓握的姿势强加给静物", () => {
    const product = detailProduct("手持器具", "tool-in-hand", 2);
    product.brief.detailPlan = parseScreens(product, [
        { role: "detail-hero", purchaseQuestion: "机身长什么样？", displayContent: "圆筒机身和深浅两段外壳。", visualBeat: "手掌托着整件器具立在台面上" },
        { role: "detail-closeup", purchaseQuestion: "怎样拨动开关？", displayContent: "拇指拨动手柄上的开关。", visualBeat: "拇指接触滑钮的位置和拨动方向" },
    ]).plan;
    const [hero, control] = restoredImageBriefs(product);
    expect(hero.prompt).not.toContain("手掌托着整件器具立在台面上");
    expect(control.prompt).toContain("拇指拨动手柄上的开关");
    expect(control.prompt).toContain("拇指接触滑钮的位置和拨动方向");
});

const tissues = [
    { role: "detail-hero", purchaseQuestion: "软抽是什么样？", displayContent: "看清软包和开口的外形", visualFocus: "软包轮廓", visualBeat: "完整的软抽包装" },
    { role: "detail-scene", purchaseQuestion: "怎么取出纸张？", displayContent: "看清纸边如何离开抽口", visualFocus: "纸与抽口的接触位置", visualBeat: "手指从抽口提起纸张" },
];

test("纸巾换了购买问题却重复同一画面主线，只提示而不拦出图", () => {
    const product = detailProduct("软抽纸巾", "tissues-original", tissues.length);
    const { plan, warnings, dropped } = parseScreens(product, [tissues[0], { ...tissues[1], visualBeat: `${tissues[0].visualBeat}。` }]);
    expect(warnings).toContainEqual(expect.objectContaining({ index: 1, field: "visualBeat", message: expect.stringContaining("画面主线重复") }));
    expect(dropped).toBe(0);
    product.brief.detailPlan = plan;
    expect(restoredImageBriefs(product)).toHaveLength(tissues.length);
});

test("勾选同款版式的纸巾详情保留锁定文案，不注入跨屏改版指令", () => {
    const product = detailProduct("软抽纸巾", "tissues-original", tissues.length);
    product.brief.sameLayout = true;
    product.references = [{ ...product.photos[0], id: "layout", resourceId: "chosen-layout", truth: false }];
    product.brief.detailPlan = parseScreens(product, tissues).plan;
    product.brief = patchStudioDetailPlanScreen(product.brief, 1, { headline: "从这里抽出纸张" });
    const [, brief] = restoredImageBriefs(product);
    expect(brief.references.map(({ resourceId }) => resourceId)).toEqual(["tissues-original"]);
    expect(brief.styleReferences.map(({ resourceId }) => resourceId)).toEqual(["chosen-layout"]);
    expect(brief.layers.find(({ id }) => id === "layout")?.text).toContain("照着图2的版式出图");
    expect(brief.layers.some(({ id }) => id === "variation")).toBe(false);
    expect(brief.layers.find(({ id }) => id === "visual")?.text).toContain(tissues[1].visualBeat);
    expect(brief.layers.find(({ id }) => id === "copy")?.text).toContain("用户锁定的主标题「从这里抽出纸张」：逐字保留");
    expect(brief.copySnapshot).toMatchObject({ headline: "从这里抽出纸张", source: "user" });
});

test("显式采用定稿排版的详情仍附上蓝图，无字设置不改商品主线", () => {
    const product = detailProduct("软抽纸巾", "tissues-original", tissues.length);
    const proof = { composition: "left" as const, headline: "从这里抽出纸张" };
    product.brief.detailPlan = parseScreens(product, tissues).plan;
    product.brief = patchStudioDetailPlanScreen(product.brief, 1, proof);
    product.brief.useProofLayout = true;
    const [, locked] = restoredImageBriefs(product);
    expect(locked.layoutGuide).toMatchObject({ proof: true, composition: "left" });
    expect(locked.prompt).toContain("卖家采用的定稿排版参考");
    expect(locked.layers.some(({ id }) => id === "variation")).toBe(false);

    product.brief.language = "none";
    product.brief.detailPlan = parseScreens(product, tissues).plan;
    product.brief = patchStudioDetailPlanScreen(product.brief, 1, proof);
    const [, textless] = restoredImageBriefs(product);
    expect(textless.layoutGuide).toBeUndefined();
    expect(textless.layers.find(({ id }) => id === "copy")?.text).toContain("不添加任何文字");
    expect(textless.prompt).not.toContain("从这里抽出纸张");
    expect(textless.layers.find(({ id }) => id === "visual")?.text).toContain(tissues[1].visualBeat);
});

test("修正详情成品仍以选定图片为编辑起点而不重做版式", () => {
    const product = detailProduct("软抽纸巾", "tissues-original", tissues.length);
    product.brief.detailPlan = parseScreens(product, tissues).plan;
    let serial = 0;
    const run = createStudioRun(product, () => `run-${++serial}`);
    run.shots[1].attempts.push({ id: "attempt", status: "succeeded", model: "gpt-image-2", tweaks: [], createdAt: "", outputs: [{ resourceId: "chosen-artwork", url: "" }] });
    run.shots[1].adjust = "只改标题字形";
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    const { compiled } = studioImageInput(restored, locateStudioShot(restored, { runId: run.id }, run.shots[1].id)!, "gpt-image-2", defaultConfig, "chosen-artwork");
    expect(compiled.references.map(({ resourceId }) => resourceId)).toEqual(["tissues-original"]);
    expect(compiled.revisionReference?.resourceId).toBe("chosen-artwork");
    expect(compiled.prompt).toContain("保留不需修改的设计");
    expect(compiled.prompt).toContain("只改标题字形");
    expect(compiled.layers.some(({ id }) => id === "variation")).toBe(false);
});
