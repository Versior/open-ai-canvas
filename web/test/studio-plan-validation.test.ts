import { expect, test } from "bun:test";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { studioTemplatePlanRoles, patchStudioDetailPlanScreen, studioDetailPlanCapacity, studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, StudioPlanValidationError } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { checkStudioClaim, studioClaimSources, studioSpecRowIssue } from "@/lib/ecommerce-studio/claim-evidence";
import { studioCompositionConflict } from "@/lib/ecommerce-studio/art-direction";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { defaultConfig } from "@/stores/use-config-store";

function sample() {
    const product = createStudioProduct("cup");
    product.name = "透明杯";
    product.brief.outputType = "template-set";
    product.brief.suite = {
        id: "cup-set",
        source: "library",
        name: "杯子",
        kind: "detail",
        style: "",
        category: "水杯",
        shots: [
            { title: "主视觉", duty: "展示杯身" },
            { title: "细节", duty: "展示杯口" },
        ],
    };
    product.photos = [{ id: "front", resourceId: "front", url: "", view: "front", truth: true, addedAt: "" }];
    product.dossier = {
        name: "杯子",
        category: "杯子",
        family: "home",
        summary: "抗菌杯（模型推断）",
        invariants: ["杯盖上有细线"],
        questions: [],
        facts: [
            { id: "h", group: "spec", label: "杯高", value: "24 厘米", evidence: "confirmed" },
            { id: "warm", group: "spec", label: "保温时间", value: "室温密闭条件下约 6 小时", evidence: "confirmed" },
            { id: "volume", group: "spec", label: "容量", value: "500 毫升", evidence: "confirmed" },
            { id: "antibacterial", group: "spec", label: "抗菌", value: "抗菌", evidence: "inferred" },
        ],
    };
    return product;
}
const screen = { role: "detail-closeup", layout: "poster", title: "杯口", purpose: "辨认杯口轮廓", visual: "左侧标题，右侧杯身。", composition: "left", headline: "透明杯口" };
const parse = (screens: unknown[], product = sample()) => parseDetailPlan(JSON.stringify({ screens }), product, studioTemplatePlanRoles(product, product.brief.suite!), { id: "plan", model: "fixture", createdAt: "" }, { scope: "template" });
function failure(screens: unknown[]) {
    try {
        parse(screens);
    } catch (error) {
        if (error instanceof StudioPlanValidationError) return error;
        throw error;
    }
    throw new Error("invalid plan was accepted");
}

test("资料不足仍保留十屏，诊断不声称缩减了屏数", () => {
    const product = createStudioProduct("glasses");
    product.name = "黑色粗框方形眼镜架";
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 10;
    product.photos = [{ id: "front", resourceId: "front", url: "", view: "front", truth: true, addedAt: "" }];
    product.dossier = { name: product.name, category: "眼镜", family: "generic", summary: "亮黑方形全框", invariants: [], questions: [], facts: [] };
    const capacity = studioDetailPlanCapacity(product, 10);
    expect(capacity.suggestedScreens).toBe(4);
    expect(capacity.reasons[0]).toContain("仍按所选 10 屏策划");
    expect(capacity.missingEvidence).toEqual(expect.arrayContaining(["侧面或背面商品图（不能臆造未拍到的角度）", "已确认规格、尺寸或重量"]));
    const screens = Array.from({ length: 10 }, (_, index) => ({ role: index === 0 ? "detail-hero" : index === 9 ? "detail-closing" : "detail-scene", visual: `第${index + 1}屏`, headline: `眼镜${index + 1}` }));
    const result = parseDetailPlan(JSON.stringify({ screens }), product, ["detail-hero", "detail-scene", "detail-closing"], { id: "capacity", model: "fixture", createdAt: "" }, { scope: "detail" });
    expect(result.plan.screens).toHaveLength(10);
    expect(result.plan.requestedScreens).toBe(10);
    expect(result.plan.suggestedScreens).toBe(4);
    expect(result.dropped).toBe(0);
    expect(result.diagnostics?.missingEvidence).toEqual(expect.arrayContaining(["真实佩戴或使用图（否则只能做搭配示意）"]));
});

test("普通详情页按所选屏数合并或拆分购买任务，模板不继承这套建议", () => {
    const product = sample();
    for (const [count, expected] of [
        [4, "短页合并相关职责"],
        [6, "不用把六屏分配给六种角色"],
        [13, "屏数不等于卖点数"],
    ] as const) {
        product.brief.detailScreens = count;
        const prompt = buildDetailPlanPrompt(product, studioDetailPlanRoles(product));
        expect(prompt).toContain(`正好交付 ${count} 屏`);
        expect(prompt).toContain(expected);
        expect(prompt).toContain("可重复，不是逐项清单或画法");
        expect(prompt).toContain("展示商品实际如何与人、其他物品或空间发生关系");
        expect(prompt).toMatch(/穿戴品[^。，\n]*佩戴关系/);
        expect(prompt).toMatch(/家具[^。，\n]*放入空间[^。，\n]*关系/);
        expect(prompt).toContain("不强制 detail-closing");
    }
    const templatePrompt = buildDetailPlanPrompt(product, studioTemplatePlanRoles(product, product.brief.suite!), { scope: "template" });
    expect(templatePrompt).toContain("按模板顺序正好给出 2 张");
    expect(templatePrompt).not.toContain("认货、给理由、看证据");
});

test("单图十屏按买家问题串联不同证据，不向模型索要十个独立卖点", () => {
    const product = sample();
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 10 };
    product.dossier!.facts = [];
    const roles = studioDetailPlanRoles(product);
    const prompt = buildDetailPlanPrompt(product, roles, { scope: "detail" });
    expect(prompt).toContain("同一购买问题可以跨相邻屏");
    expect(prompt).toContain("本屏补上的子问题");
    expect(prompt).toContain("后一屏必须带来前面没有的可见信息");
    expect(prompt).not.toMatch(/唯一的购买问题|长页只拆有独立依据的购买问题/);
    const grouped = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "用它饮水时嘴唇接触哪里？", displayContent: "杯口贴近嘴唇，手拿着杯身。", evidence: ["photo:front"] },
                { role: "detail-closeup", purchaseQuestion: "杯口边缘是什么形状？", displayContent: "杯沿是连贯的圆形，能看到弧面的边缘。", evidence: ["photo:front"] },
            ],
        }),
        { ...product, brief: { ...product.brief, detailScreens: 2 } },
        roles,
        { id: "grouped", model: "fixture", createdAt: "" },
        { scope: "detail" },
    );
    expect(grouped.plan.screens.map((screen) => screen.evidenceRefs)).toEqual([["photo:front"], ["photo:front"]]);
    expect(grouped.warnings.filter(({ field }) => field === "purpose" || field === "visual")).toEqual([]);
});

test("普通详情页识别重复购买问题，不因换构图或无字而跳过", () => {
    const product = sample();
    product.dossier = undefined;
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2, language: "none" };
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "杯口是什么形状？", displayContent: "杯口对着镜头，完整杯身入画" },
                { role: "detail-closeup", purchaseQuestion: "杯口是什么形状?", displayContent: "从杯口上方近看弧线" },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        { id: "repeat-question", model: "fixture", createdAt: "" },
    );
    expect(result.warnings).toContainEqual(expect.objectContaining({ index: 1, field: "purpose", message: expect.stringContaining("只换构图不算新内容") }));
    expect(result.plan.screens).toHaveLength(2);
});

test("知识库凭证只保存版本和条目 ID，并随策划与生成组快照保留", () => {
    const product = sample();
    const knowledgeReceipt = { source: "ecommerce-studio", capability: "detail-plan", version: "kb-v6", ids: ["KB20", "layout-pattern"] } as const;
    const result = parseDetailPlan(
        JSON.stringify({ screens: [screen, { ...screen, role: "detail-hero", title: "首屏" }] }),
        product,
        studioTemplatePlanRoles(product, product.brief.suite!),
        { id: "receipt-plan", model: "fixture", createdAt: "" },
        { scope: "template" },
        knowledgeReceipt,
    );
    expect(result.plan.knowledgeReceipt).toEqual(knowledgeReceipt);
    expect(JSON.stringify(result.plan)).not.toContain("知识正文");
    product.brief.templatePlan = result.plan;
    const run = createStudioRun(product, () => "receipt-run");
    expect(run.suite?.knowledgeReceipt).toEqual(knowledgeReceipt);
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify({ ...product, runs: [run] })))!;
    expect(restored.runs[0].suite?.knowledgeReceipt).toEqual(knowledgeReceipt);
});

test("模板只接受实际库中的角色别名；按位置回传缺张、多张和坏字段及可预览屏", () => {
    for (const role of ["HERO", "DETAIL", "SCENE", "TRUST", "CTA", "VARIANT", "PAIN_POINT", "COMPARISON"]) {
        const plan = parse([
            { ...screen, role },
            { ...screen, role: "DETAIL" },
        ]).plan;
        expect(plan.screens.map((item) => item.role)).toEqual(["detail-hero", "detail-closeup"]);
    }
    for (const [row, field] of [
        [{ ...screen, role: "INVENTED" }, "role"],
        [{ ...screen, visual: "" }, "displayContent"],
        [{ ...screen, visualFocus: true }, "visualFocus"],
        [{ ...screen, purchaseQuestion: ["问题"] }, "purchaseQuestion"],
        [{ ...screen, evidenceRefs: ["fact:absent"] }, "evidenceRefs"],
    ] as const) {
        if (field === "role" || field === "evidenceRefs") {
            const accepted = parse([screen, row]);
            expect(accepted.warnings.some((issue) => issue.index === 1 && issue.field === field)).toBe(true);
            expect(accepted.plan.screens).toHaveLength(2);
        } else {
            const error = failure([screen, row]);
            expect(error.issues.some((issue) => issue.index === 1 && issue.field === field)).toBe(true);
            expect(error.review).toEqual([{ index: 0, title: screen.title, purpose: screen.purpose, headline: "", visual: screen.visual }]);
        }
    }
    expect(failure([screen]).issues).toContainEqual({ index: 1, field: "screens", message: "缺少这一张的策划" });
    const extra = parse([screen, { ...screen, noText: true }, screen]);
    expect(extra.warnings.some((issue) => issue.index === 2 && /超出用户选择|忽略多余/.test(issue.message))).toBe(true);
});

test("否定、备选构图不是实际画面；真正的反向指令仍拦截", () => {
    for (const visual of ["左侧放主标题，右侧不放文字；右边是商品。避免左图右文。", "不要采用右侧标题；主标题放左边", "并非左图右文，而是左文右图"]) expect(studioCompositionConflict({ composition: "left", visual })).toBe(false);
    expect(studioCompositionConflict({ composition: "left", visual: "不要在左边放小字，但右侧放主标题" })).toBe(true);
});

test("数字、单位、指标、来源与使用条件不能拆借；摄影尺寸、空文案可用", () => {
    const sources = studioClaimSources(sample());
    for (const text of ["保温24小时", "杯宽24厘米", "杯高24毫米", "续航6小时", "保温6小时", "室温密闭条件下保温6小时", "抗菌", "防漏", "通过认证", "待机500小时"]) expect(checkStudioClaim(text, sources).issue).toBeDefined();
    expect(checkStudioClaim("室温密闭条件下保温约6小时", sources)).toEqual({ refs: ["fact:warm"] });
    expect(checkStudioClaim("杯高24cm，容量500ml", sources)).toEqual({ refs: ["fact:h", "fact:volume"] });
    expect(checkStudioClaim("左侧40%留白，50mm镜头，3条引线，不画防水认证", sources, true).issue).toBeUndefined();
    expect(checkStudioClaim("防水", [{ id: "seller:1", text: "不防水", label: "注意" }]).issue).toBeDefined();
    for (const text of ["Width: 24 cm", "24 cm wide", "Keeps cold for about 6 hours at room temperature, sealed", "Keeps hot for 6 hours", "Waterproof"]) expect(checkStudioClaim(text, sources).issue).toBeDefined();
    for (const text of ["Height: 24 cm", "24 cm tall", "Keeps hot for about 6 hours at room temperature, sealed"]) expect(checkStudioClaim(text, sources).issue).toBeUndefined();
    const unanswered = sample();
    unanswered.brief.prep = { asks: [{ id: "q1", question: "是否抗菌、防漏、耐摔？", options: ["耐摔", "防漏"], multi: true, picked: ["耐摔"], note: "" }], directions: [] };
    expect(checkStudioClaim("耐摔", studioClaimSources(unanswered)).refs).toContain("answer:q1");
    expect(checkStudioClaim("防漏", studioClaimSources(unanswered)).issue).toBeDefined();
});

test("没拍到铰链不能推导不折叠，但卖家确认的规格仍可用", () => {
    const observation = { id: "appearance:1", label: "连接处", text: "手柄与风筒近直角连接，未见可折叠关节", appearanceOnly: true };
    expect(checkStudioClaim("手柄不折叠", [observation], true).issue).toBeDefined();
    expect(checkStudioClaim("是否能折叠收纳？", [observation], true).issue).toBeDefined();
    expect(checkStudioClaim("它不是折叠款吧，收纳时能不能折小？", [observation], true).issue).toBeDefined();
    expect(checkStudioClaim("手柄与风筒连接处，没有铰链或折合结构", [observation], true).issue).toBeDefined();
    expect(checkStudioClaim("手柄与风筒近直角连接", [observation], true).issue).toBeUndefined();
    const known = { id: "seller:1", label: "手柄", text: "手柄不折叠", sellerConfirmed: true };
    expect(checkStudioClaim("手柄不折叠", [known]).refs).toEqual(["seller:1"]);
    expect(checkStudioClaim("手柄可折叠", [known]).issue).toBeDefined();
});

test("吹风机实测：没有拍到的关节与推断的固定结构不作事实，保留可见连接角度", () => {
    const product = createStudioProduct("dryer-observed");
    product.brief.detailScreens = 2;
    const hand = { id: "handle", group: "structure", label: "手柄形态", value: "细长直筒手柄，与风筒成近似直角连接，不可见折叠关节", evidence: "visible" } as const;
    product.dossier = { name: "吹风机", category: "吹风机", family: "electronics", summary: "", facts: [hand], invariants: [], questions: [] };
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "整机长什么样？", displayContent: "展示整个吹风机。" },
                { role: "detail-closing", purchaseQuestion: "手柄能不能折叠，收纳时是固定直角形态吗？", displayContent: "手柄与风筒保持近似直角连接，连接处不可见折叠关节，整机以固定L形状态呈现。", evidence: ["fact:handle"] },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        { id: "plan", model: "fixture", createdAt: "" },
        { scope: "detail" },
    );
    expect(studioClaimSources(product).find(({ id }) => id === "fact:handle")?.text).not.toContain("不可见折叠");
    expect(result.plan.screens[1].displayContent).toContain("近似直角连接");
    expect(result.plan.screens[1].displayContent).not.toMatch(/不可见|固定L形/);
    expect(result.plan.screens[1].purchaseQuestion).not.toMatch(/折叠|固定直角/);
});

test("有依据的屏可追溯，旧策划不能设成无字，同一利益不能只换构图", () => {
    const good = parse(
        [
            { ...screen, headline: "杯高24厘米", facts: ["杯高"] },
            { ...screen, noText: true },
        ],
        sample(),
    );
    expect(good.plan.screens[0].evidenceRefs).toContain("fact:h");
    const mismatched = parseDetailPlan(
        JSON.stringify({
            screens: [
                { ...screen, displayContent: "对照杯高24厘米的实物尺度", evidenceRefs: ["fact:volume"] },
                { ...screen, noText: true },
            ],
        }),
        sample(),
        studioTemplatePlanRoles(sample(), sample().brief.suite!),
        { id: "mismatch", model: "fixture", createdAt: "" },
        { scope: "template" },
    );
    expect(mismatched.warnings).toContainEqual(expect.objectContaining({ field: "displayContent", message: expect.stringContaining("已改用对应的商品资料") }));
    expect(mismatched.plan.screens[0].evidenceRefs).toContain("fact:h");
    expect(mismatched.plan.screens[1].noText).not.toBe(true);
    const product = sample();
    product.brief.templatePlan = good.plan;
    expect(normalizeStudioProduct(product)!.brief.templatePlan!.screens[0].evidenceRefs).toEqual(["fact:h"]);
    const conflicted = parse([screen, { ...screen, visual: "文字在上，商品在下", composition: "top" }]);
    expect(conflicted.warnings.some((issue) => issue.field === "purpose" && issue.index === 1)).toBe(true);
    const repeated = sample();
    repeated.brief.outputType = "detail-set";
    repeated.brief.detailScreens = 4;
    const copied = ["侧看杯口", "杯口一瞥", "再看杯沿", "杯沿近看"].map((headline, index) => ({ ...screen, role: "detail-scene", purpose: "杯口是什么形状", visual: "杯口轮廓在下方中央", composition: ["top", "bottom", "left", "right"][index], headline }));
    const repeatedResult = parseDetailPlan(JSON.stringify({ screens: copied }), repeated, ["detail-scene"], { id: "repeat", model: "mock", createdAt: "" });
    expect(repeatedResult.warnings.some((issue) => issue.field === "purpose" || issue.field === "visual")).toBe(true);
    expect(repeatedResult.plan.screens).toHaveLength(4);
    expect(parse([screen, { ...screen, purpose: "观察连接杯盖的部位", headline: "杯盖细线", facts: ["杯盖上有细线"] }]).plan.screens).toHaveLength(2);
    expect(
        parse([
            { ...screen, noText: true },
            { ...screen, noText: true },
        ]).plan.screens,
    ).toHaveLength(2);
});

test("详情页用购买问题和视觉重点提示重复，不执行旧策划文案或缩减所选屏数", () => {
    const product = sample();
    product.name = "薄荷绿吹风机";
    product.dossier = undefined;
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 5;
    const lines = ["手柄滑动开关", "同心圆格栅", "圆筒机身竖柄"];
    const screens = [
        { role: "detail-hero", headline: "结构一览", visual: "整机识别，背景留白" },
        { role: "detail-selling", headline: "结构一览", purchaseQuestion: "怎样触及开关？", layout: "split", displayContent: "手握机身时，拇指接触手柄的滑动开关", visualFocus: "拇指与滑动开关的接触处", lines },
        { role: "detail-selling", headline: "三处上手细节", purchaseQuestion: "怎样触及开关？", layout: "grid", displayContent: "换个角度演示相同的开关操作", visualFocus: "手指贴住滑动开关", lines: [...lines].reverse() },
        { role: "detail-selling", headline: "结构一览！", purchaseQuestion: "外观有什么细节？", layout: "poster", displayContent: "将握持场景中的可见开关拉近", visualFocus: "拇指与滑动开关的接触处", lines: [lines[0]] },
        { role: "detail-closing", headline: "结构一览", visual: "整机远景收尾" },
    ];
    const raw = JSON.stringify({ screens });
    const roles = ["detail-hero", "detail-selling", "detail-closing"] as const;
    const meta = { id: "dryer", model: "fixture", createdAt: "" };
    const repeatedResult = parseDetailPlan(raw, product, [...roles], meta, { scope: "detail" });
    expect(repeatedResult.warnings.some((item) => item.index === 2 && item.field === "purpose" && /购买问题重复/.test(item.message))).toBe(true);
    expect(repeatedResult.warnings.some((item) => item.index === 3 && item.field === "visualFocus" && /视觉重点重复/.test(item.message))).toBe(true);
    expect(repeatedResult.plan.screens.every((screen) => !screen.lines.length && !screen.headline)).toBe(true);
    product.brief.detailPlan = repeatedResult.plan;
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
    let next = 0;
    expect(createStudioRun(restored, () => `legacy-${++next}`).shots).toHaveLength(5);
});

test("新详情页不把家具同一蓝图换标题当新证据；允许首尾回顾、无字和独立候选", () => {
    const product = sample();
    product.name = "弧背餐椅";
    product.dossier = undefined;
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 4;
    const visual = "暖光下的餐椅靠背局部，宽幅裁切";
    const rows = [
        { role: "detail-hero", headline: "弧背的线条", visual: "完整餐椅与长桌" },
        { role: "detail-closeup", headline: "弧背的线条", visual, purpose: "看弧面", elements: "用短注解释可见轮廓" },
        { role: "detail-closeup", headline: "靠背曲线", visual, purpose: "看轮廓", elements: "用短注解释可见轮廓" },
        { role: "detail-closing", headline: "弧背的线条", visual: "餐桌边的完整餐椅" },
    ];
    const roles = ["detail-hero", "detail-closeup", "detail-closing"] as const;
    const meta = { id: "chair", model: "fixture", createdAt: "" };
    const detail = (screens: unknown[]) => parseDetailPlan(JSON.stringify({ screens }), product, [...roles], meta, { scope: "detail" });
    const repeated = detail(rows);
    expect(repeated.warnings.some((item) => item.index === 2 && item.field === "visual" && /画面内容和证据均重复/.test(item.message))).toBe(true);
    expect(repeated.plan.screens).toHaveLength(4);
    expect(detail([rows[0], { ...rows[1], noText: true }, { ...rows[2], noText: true }, rows[3]]).plan.screens).toHaveLength(4);
    expect(detail([rows[0], rows[1], { ...rows[2], visual: "手触靠背与坐垫之间的可见间隔" }, rows[3]]).plan.screens).toHaveLength(4);
    product.brief.sameLayout = true;
    expect(detail(rows).plan.screens).toHaveLength(4);
    const independent = parseDetailPlan(JSON.stringify({ screens: [rows[1], rows[1]] }), product, ["main-detail"], meta, { scope: "single", targets: [{ type: "closeup", count: 2 }] });
    expect(independent.plan.screens).toHaveLength(2);
});

test("十屏策划从同一次回复采用有依据的备选，不把几个吹发部位当成独立问题", () => {
    const product = createStudioProduct("dryer");
    product.name = "手持吹风机";
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 10;
    product.sellerNotes = "机身长度：20 cm\n风筒前端是出风口";
    const screens = [
        { role: "detail-hero", purchaseQuestion: "这一款是什么外形？", displayContent: "从正面辨认完整商品的轮廓。" },
        { role: "detail-scene", purchaseQuestion: "常用时手指怎样拨动开关？", displayContent: "拇指接触手柄前面的滑块。" },
        { role: "detail-closeup", purchaseQuestion: "风口正面是什么结构？", displayContent: "展示圆形格栅的边缘及中心。" },
        { role: "detail-scene", purchaseQuestion: "吹侧边长发时，风口和发束怎么对位？", displayContent: "出风口朝向长发，发束离开脸颊。", transitionOut: "从侧边发束进入头顶发根。" },
        { role: "detail-scene", purchaseQuestion: "头顶发根位置，另一只手和风口怎么配合？", displayContent: "手托起头顶发束，风口朝发根。" },
        { role: "detail-scene", purchaseQuestion: "吹后颈时，头部和手臂怎么摆才能把风口对到后颈发根？", displayContent: "低头侧举吹风机，风口朝后颈。" },
        { role: "detail-scene", purchaseQuestion: "吹刘海和分缝时，风口从哪个方向对头发？", displayContent: "吹风机位于额头前方，风口朝下。" },
        { role: "detail-scene", purchaseQuestion: "耳侧短发怎么让风口对准耳上发区？", displayContent: "手拢起耳边短发，风口从外侧对准。" },
        { role: "detail-closeup", purchaseQuestion: "机身配色怎样分布？", displayContent: "手柄和风筒的颜色对照。" },
        { role: "detail-closing", purchaseQuestion: "它不是折叠款吧，收纳时能不能折小？", displayContent: "完整机身以使用完毕的状态摆放。", visualFocus: "手柄与风筒连接处，没有铰链或折合结构" },
    ];
    const alternatives = [
        { role: "detail-closeup", purchaseQuestion: "风口能不能快速吹干？", displayContent: "能快速吹干发丝。" },
        { role: "detail-closeup", purchaseQuestion: "如何辨认机器的色块？", displayContent: "手柄和风筒的颜色对照。" },
        { role: "detail-closeup", purchaseQuestion: "机身长度是多少？", displayContent: "用已确认的 20 cm 机身长度说明尺寸。", evidence: ["seller:1"], headline: "策划拟的标题", layout: "grid" },
        { role: "detail-closeup", purchaseQuestion: "插线端从哪引出？", displayContent: "局部展示手柄下方的电源线根部。" },
        { role: "detail-scene", purchaseQuestion: "摆在梳妆台的什么位置方便拿取？", displayContent: "展示使用完毕的吹风机和梳妆台的空间关系。" },
    ];
    const roles = studioDetailPlanRoles(product);
    const prompt = buildDetailPlanPrompt(product, roles, { scope: "detail" });
    expect(prompt).toContain('"alternatives":[');
    expect(prompt).toContain("没有可证实的备选则返回空数组");
    expect(prompt).toContain("先找能替换重复屏的候补，再定正式屏");
    const run = (withAlternatives: boolean) =>
        parseDetailPlan(JSON.stringify({ summary: "沿头发不同位置讲使用", screens, ...(withAlternatives ? { alternatives } : {}) }), product, roles, { id: "plan", model: "fixture", createdAt: "" }, { scope: "detail" });
    const initial = run(false);
    expect(initial.warnings.filter(({ field }) => field === "purpose").map(({ index }) => index)).toEqual([4, 5, 6, 7]);
    expect(initial.plan.screens[9].purchaseQuestion).not.toMatch(/折叠|折小/);
    expect(initial.plan.screens[9].visualFocus).toBe("手柄与风筒连接处");
    const result = run(true);
    expect(result.plan.screens).toHaveLength(10);
    expect(result.plan.screens[9]).toMatchObject({ purchaseQuestion: alternatives[2].purchaseQuestion, evidenceRefs: ["seller:1"], headline: "", copySource: "assistant" });
    expect(result.plan.screens[4].purchaseQuestion).toBe(alternatives[3].purchaseQuestion);
    expect(result.plan.screens[5].purchaseQuestion).toBe(alternatives[4].purchaseQuestion);
    expect(result.plan.screens[3].purchaseQuestion).toBe(screens[3].purchaseQuestion);
    expect(result.plan.screens[3].transitionOut).toBeUndefined();
    expect(result.warnings.filter(({ field }) => field === "purpose").map(({ index }) => index)).toEqual([6, 7]);
    expect(result.plan.summary).toBe("");
    expect(result.dropped).toBe(0);
    product.brief.planNote = "按我指定的方式分开说明不同位置";
    expect(run(true).plan.screens[4].purchaseQuestion).toBe(screens[4].purchaseQuestion);
    expect(run(true).plan.screens[9].purchaseQuestion).toBe(initial.plan.screens[9].purchaseQuestion);
    expect(buildDetailPlanPrompt(product, roles, { scope: "detail" })).not.toContain('"alternatives":[');
});

test("模型把来源编号包在方括号里时仍能采用整组策划", () => {
    const product = sample();
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 2;
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "杯身有多高？", displayContent: "展示杯身全貌和已确认的 24 厘米杯高", evidenceRefs: ["[fact:h]"] },
                { role: "detail-closeup", purchaseQuestion: "杯盖上的细线是什么样的？", displayContent: "展示杯盖上真实可见的细线", noText: true, evidence: ["[appearance:1]"] },
            ],
        }),
        product,
        ["detail-hero", "detail-closeup"],
        { id: "bracketed", model: "fixture", createdAt: "" },
    );
    expect(result.plan.screens).toHaveLength(2);
    expect(result.plan.screens[0].evidenceRefs).toEqual(["fact:h"]);
    expect(result.plan.screens[1].evidenceRefs).toEqual(["appearance:1"]);
});

test("普通策划使用短引用号且跳过无包装印字的拍摄备注，读回保留原资料 ID", () => {
    const product = sample();
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 2;
    product.dossier!.facts.push({ id: "qZt9_p", group: "text", label: "包装或标签文字", value: "画面未出现包装、标签与任何文字", evidence: "visible" });
    const roles = studioDetailPlanRoles(product);
    const prompt = buildDetailPlanPrompt(product, roles);
    const height = prompt.match(/\[(E\d+)\] 杯高 24 厘米/)?.[1];
    expect(height).toBeDefined();
    expect(prompt).not.toContain("画面未出现包装");
    expect(prompt).not.toContain("fact:h");
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "这是什么样的杯子？", displayContent: "展示透明杯的全貌。" },
                { role: "detail-size", purchaseQuestion: "杯子有多高？", displayContent: "展示杯高 24 厘米。", evidence: [`[${height}]`, "E999"] },
            ],
        }),
        product,
        roles,
        { id: "short-citations", model: "fixture", createdAt: "" },
        { scope: "detail" },
    );
    expect(result.plan.screens[1].evidenceRefs).toEqual(["fact:h"]);
    expect(result.plan.screens[1].facts).toEqual(["fact:h"]);
    expect(result.warnings).toEqual([expect.objectContaining({ index: 1, field: "facts", message: expect.stringContaining("E999") })]);
});

test("实际操作优先于空握，回顾已知外观的末屏先采用不重复的候补", () => {
    const product = createStudioProduct("dryer-answers");
    product.name = "吹风机";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 4 };
    product.sellerNotes = "机身长度：20 cm\n已确认圆形格栅是出风口";
    const screens = [
        { role: "detail-hero", purchaseQuestion: "这款吹风机什么样？", displayContent: "浅薄荷绿圆筒风筒横在手柄上方，带白色环圈。", transitionOut: "从整机外形接到空握方向。" },
        { role: "detail-model", purchaseQuestion: "单手握持时，出风口朝哪个方向？", displayContent: "手掌握住手柄，让出风口向前。" },
        { role: "detail-scene", purchaseQuestion: "吹头发时，风口怎么对着头发？", displayContent: "手握手柄，让圆形格栅的一端朝向湿发。", transitionOut: "回看已说过的颜色。" },
        { role: "detail-closing", purchaseQuestion: "页面展示的外观细节，和实物能对得上吗？", displayContent: "浅薄荷绿圆筒风筒横在手柄上方，带白色环圈，与前述各屏为同一台机。" },
    ];
    const alternatives = [
        { role: "detail-closeup", purchaseQuestion: "滑动开关位于哪里？", displayContent: "展示手柄正面的开关位置与滑块。" },
        { role: "detail-closeup", purchaseQuestion: "这台机身多长？", displayContent: "用已确认资料展示 20 cm 的机身长度。", evidence: ["seller:1"] },
    ];
    const parseProduct = (alternatives: unknown[]) => parseDetailPlan(JSON.stringify({ screens, alternatives }), product, studioDetailPlanRoles(product), { id: "plan", model: "fixture", createdAt: "" }, { scope: "detail" });
    const initial = parseProduct([]);
    expect(initial.warnings.filter(({ field }) => field === "purpose").map(({ index }) => index)).toEqual([1]);
    expect(initial.plan.screens[3].displayContent).toContain("20 cm");
    const result = parseProduct(alternatives);
    expect(result.plan.screens.map(({ purchaseQuestion }) => purchaseQuestion)).toEqual([screens[0].purchaseQuestion, alternatives[0].purchaseQuestion, screens[2].purchaseQuestion, alternatives[1].purchaseQuestion]);
    expect(result.plan.screens.at(-1)?.evidenceRefs).toEqual(["seller:1"]);
    expect(result.plan.screens.every(({ transitionOut }) => !transitionOut)).toBe(true);
    expect(result.warnings).toEqual([]);
});

test("没有候补时用尚未使用的真实信息替换重复屏，不改首屏或编造参数", () => {
    const product = sample();
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 4;
    const rows = [
        { role: "detail-hero", purchaseQuestion: "这款杯子是什么样的？", displayContent: "辨认商品整体轮廓。" },
        { role: "detail-closeup", purchaseQuestion: "杯口是什么形状？", displayContent: "看清杯沿的轮廓。", visualBeat: "杯沿局部", transitionOut: "接着看杯沿" },
        { role: "detail-closeup", purchaseQuestion: "杯口是什么形状？", displayContent: "看清杯沿的轮廓。", visualBeat: "杯沿局部" },
        { role: "detail-size", purchaseQuestion: "杯子有多高？", displayContent: "核对杯高 24 厘米。", evidence: ["fact:h"] },
    ];
    const { plan, warnings } = parseDetailPlan(JSON.stringify({ screens: rows }), product, studioDetailPlanRoles(product), { id: "cup", model: "fixture", createdAt: "" }, { scope: "detail" });
    expect(plan.screens).toHaveLength(4);
    expect(plan.screens[0].purchaseQuestion).toBe(rows[0].purchaseQuestion);
    expect(plan.screens[1].transitionOut).toBeUndefined();
    expect(plan.screens[2]).toMatchObject({ evidenceRefs: ["fact:warm"], headline: "", copySource: "assistant" });
    expect(plan.screens[2].displayContent).toContain("室温密闭条件下约 6 小时");
    expect(plan.screens[3].evidenceRefs).toEqual(["fact:h"]);
    expect(warnings.some(({ index, field }) => index === 2 && field === "purpose")).toBe(false);
});

test("手改可见文案、画面或调整指令后，实际图像输入仍拒绝无来源性能", () => {
    const product = sample();
    product.brief.templatePlan = parse([screen, { ...screen, noText: true }], product).plan;
    product.brief = patchStudioDetailPlanScreen(product.brief, 0, { headline: "保温24小时" }, "templatePlan");
    let next = 0;
    const shot = createStudioRun(product, () => `shot-${++next}`).shots[0];
    const input = (overrides: Partial<typeof shot>) => studioImageInput(product, { shot: { ...shot, ...overrides }, textMode: "model", quality: "", resolution: "", fromForm: true }, "gpt-image-2", defaultConfig);
    expect(() => input({})).toThrow(/保温.*24小时/);
    expect(() => input({ headline: "透明杯口", adjust: "加上抗菌标签" })).toThrow(/抗菌/);
    expect(() => input({ headline: "透明杯口", visual: "在杯子旁用曲线演示保温24小时" })).toThrow(/保温.*24小时/);
    expect(() => input({ headline: "杯高24厘米" })).not.toThrow();
});

test("额定功率在普通分镜、规格和已编辑的生图输入中按同一数值与单位核验", () => {
    const product = { ...sample(), name: "薄荷绿吹风机", sellerNotes: "额定功率：1800 W", dossier: undefined };
    const sources = studioClaimSources(product);
    expect(checkStudioClaim("Rated power: 1800 W", sources, true).refs).toEqual(["seller:1"]);
    expect(checkStudioClaim("180W 柔光灯照出侧缘", sources, true).issue).toBeUndefined();
    expect(checkStudioClaim("峰值功率1800W", sources, true).issue).toBeDefined();
    expect(studioSpecRowIssue("Power", "1800 瓦", sources)).toBeUndefined();
    expect(studioSpecRowIssue("功率", "180W", sources)).toBeDefined();

    const first = { ...screen, title: "机身轮廓", purpose: "认识机身轮廓", headline: "薄荷绿机身", visual: "左侧标题，右侧吹风机机身。" };
    const second = { ...screen, noText: true };
    const falseWattage = "在机器旁把 180W 功率醒目写出";
    expect(parse([{ ...first, displayContent: falseWattage }, second], product).warnings.some((item) => /功率180w/i.test(item.message))).toBe(true);
    expect(parse([{ ...first, elements: falseWattage }, second], product).plan.screens[0].elements).not.toContain("180W");

    product.brief.templatePlan = parse([first, second], product).plan;
    product.brief = patchStudioDetailPlanScreen(product.brief, 0, { elements: falseWattage, lines: [falseWattage] }, "templatePlan");
    let next = 0;
    expect(() => {
        const shot = createStudioRun(product, () => `power-${++next}`).shots[0];
        studioImageInput(product, { shot, textMode: "model", quality: "", resolution: "", fromForm: true }, "gpt-image-2", defaultConfig);
    }).toThrow(/功率180w/i);
});

test("规格表按同键同值核验定性与定量数据；购物建议不是未经核实的商品参数", () => {
    const product = sample();
    product.dossier!.facts.push(
        { id: "material", group: "material", label: "材质", value: "不锈钢", evidence: "confirmed" },
        { id: "color", group: "appearance", label: "颜色", value: "蓝色", evidence: "visible" },
        { id: "rim", group: "structure", label: "杯口纹路", value: "直纹", evidence: "visible" },
    );
    const sources = studioClaimSources(product);
    for (const [label, value] of [
        ["材质", "不锈钢"],
        ["Material", "Stainless steel"],
        ["Color", "Blue"],
        ["Height", "24 cm"],
        ["杯口纹路", "直纹"],
        ["选购建议", "下单前检查柜内净空"],
    ])
        expect(studioSpecRowIssue(label, value, sources)).toBeUndefined();
    for (const [label, value] of [
        ["材质", "纯钛"],
        ["颜色", "红色"],
        ["Weight", "24 cm"],
        ["Width", "24 cm"],
        ["Material", "Blue"],
        ["Color", "Titanium"],
        ["型号", "C810"],
        ["供电接口", "USB-C"],
        ["杯口纹路", "螺旋纹"],
    ])
        expect(studioSpecRowIssue(label, value, sources)).toBeDefined();
    const notes = sample();
    notes.dossier = undefined;
    notes.sellerNotes = "材质为不锈钢，颜色为蓝色。";
    expect(studioSpecRowIssue("Color", "Blue", studioClaimSources(notes))).toBeUndefined();
    const good = parse(
        [
            { ...screen, role: "detail-spec", displayContent: "展示实物材质和颜色", evidence: ["fact:material", "fact:color"], lines: ["材质｜不锈钢", "颜色｜蓝色"] },
            { ...screen, noText: true },
        ],
        product,
    );
    expect(good.plan.screens[0].evidenceRefs).toEqual(["fact:material", "fact:color"]);
    const badSpec = parse(
        [
            { ...screen, role: "detail-spec", layout: "spec", lines: ["颜色｜红色"] },
            { ...screen, noText: true },
        ],
        product,
    );
    expect(badSpec.plan.screens[0].lines).toEqual([]);
    product.brief.templatePlan = good.plan;
    const edited = { ...createStudioRun(product, () => "shot").shots[0], lines: ["材质｜纯钛"], copySource: "user" as const };
    expect(() => studioImageInput(product, { shot: edited, textMode: "model", quality: "", resolution: "", fromForm: true }, "gpt-image-2", defaultConfig)).toThrow(/材质｜纯钛/);
});
