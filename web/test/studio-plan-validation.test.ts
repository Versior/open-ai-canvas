import { expect, test } from "bun:test";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { studioTemplatePlanRoles, patchStudioDetailPlanScreen } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan, StudioPlanValidationError } from "@/lib/ecommerce-studio/detail-plan-tasks";
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
        [{ ...screen, visual: "" }, "visual"],
        [{ ...screen, lines: [true] }, "lines"],
        [{ ...screen, noText: "true" }, "noText"],
        [{ ...screen, evidenceRefs: ["fact:absent"] }, "evidenceRefs"],
    ] as const) {
        const error = failure([screen, row]);
        expect(error.issues.some((issue) => issue.index === 1 && issue.field === field)).toBe(true);
        expect(error.review).toEqual([{ index: 0, title: screen.title, purpose: screen.purpose, headline: screen.headline, visual: screen.visual }]);
    }
    expect(failure([screen]).issues).toContainEqual({ index: 1, field: "screens", message: "缺少这一张的策划" });
    expect(failure([screen, { ...screen, noText: true }, screen]).issues.some((issue) => issue.index === 2 && /多余/.test(issue.message))).toBe(true);
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

test("有依据的屏可追溯，资料少可用无字实拍，同一利益不能只换构图", () => {
    const good = parse(
        [
            { ...screen, headline: "杯高24厘米", facts: ["杯高"] },
            { ...screen, noText: true },
        ],
        sample(),
    );
    expect(good.plan.screens[0].evidenceRefs).toContain("fact:h");
    expect(
        failure([
            { ...screen, headline: "杯高24厘米", evidenceRefs: ["fact:volume"] },
            { ...screen, noText: true },
        ]).issues.some((item) => item.index === 0 && item.field === "evidenceRefs"),
    ).toBe(true);
    const product = sample();
    product.brief.templatePlan = good.plan;
    expect(normalizeStudioProduct(product)!.brief.templatePlan!.screens[0].evidenceRefs).toEqual(["fact:h"]);
    expect(failure([screen, { ...screen, visual: "文字在上，商品在下", composition: "top" }]).issues.some((issue) => issue.field === "purpose" && issue.index === 1)).toBe(true);
    const repeated = sample();
    repeated.brief.outputType = "detail-set";
    repeated.brief.detailScreens = 4;
    const copied = ["侧看杯口", "杯口一瞥", "再看杯沿", "杯沿近看"].map((headline, index) => ({ ...screen, role: "detail-scene", purpose: "杯口是什么形状", visual: "杯口轮廓在下方中央", composition: ["top", "bottom", "left", "right"][index], headline }));
    expect(() => parseDetailPlan(JSON.stringify({ screens: copied }), repeated, ["detail-scene"], { id: "repeat", model: "mock", createdAt: "" })).toThrow("重复回答同一购买问题");
    expect(parse([screen, { ...screen, purpose: "观察连接杯盖的部位", headline: "杯盖细线", facts: ["杯盖上有细线"] }]).plan.screens).toHaveLength(2);
    expect(
        parse([
            { ...screen, noText: true },
            { ...screen, noText: true },
        ]).plan.screens,
    ).toHaveLength(2);
});

test("模型把来源编号包在方括号里时仍能采用整组策划", () => {
    const product = sample();
    product.brief.outputType = "detail-set";
    product.brief.detailScreens = 2;
    const result = parseDetailPlan(
        JSON.stringify({
            screens: [
                { ...screen, role: "detail-hero", headline: "杯高24厘米", evidenceRefs: ["[fact:h]"] },
                { ...screen, role: "detail-closeup", noText: true, evidenceRefs: ["[appearance:1]"] },
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
            { ...screen, role: "detail-spec", layout: "spec", lines: ["材质｜不锈钢", "颜色｜蓝色"] },
            { ...screen, noText: true },
        ],
        product,
    );
    expect(good.plan.screens[0].evidenceRefs).toEqual(["fact:material", "fact:color"]);
    expect(() =>
        parse(
            [
                { ...screen, role: "detail-spec", layout: "spec", lines: ["颜色｜红色"] },
                { ...screen, noText: true },
            ],
            product,
        ),
    ).toThrow(/颜色｜红色/);
    product.brief.templatePlan = good.plan;
    const edited = { ...createStudioRun(product, () => "shot").shots[0], lines: ["材质｜纯钛"] };
    expect(() => studioImageInput(product, { shot: edited, textMode: "model", quality: "", resolution: "", fromForm: true }, "gpt-image-2", defaultConfig)).toThrow(/材质｜纯钛/);
});
