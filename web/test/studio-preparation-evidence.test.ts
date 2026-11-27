import { expect, test } from "bun:test";
import { checkStudioClaim, studioClaimSources, supportedStudioDescription } from "@/lib/ecommerce-studio/claim-evidence";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioImageInput, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";

function seafood() {
    const product = createStudioProduct("seafood");
    product.name = "小鱿鱼";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 3 };
    product.photos = [{ id: "original", resourceId: "starred", url: "", view: "front", truth: true, addedAt: "" }];
    product.dossier = {
        name: product.name,
        category: "海鲜",
        family: "food",
        facts: [{ id: "whole", group: "structure", label: "整体形态", value: "头、外套膜和鳍连为一体，整只未切开", evidence: "visible", source: "图1" }],
        summary: "整只小鱿鱼",
        invariants: [],
        questions: [],
    };
    return product;
}

test("whole squid last-screen replay keeps the prep board but not the unverified promise that a preparation step can be skipped", () => {
    const product = seafood();
    const question = "买回家后，它能不能以整只状态进入备料，而不是必须切成鱿鱼圈？";
    const display = "整只小鱿鱼平放在备料板上，刀尚未落下。";
    const plan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "买到什么形态？", displayContent: "头、外套膜和鳍连为一体。" },
                { role: "detail-closeup", displayContent: "蓝绿色眼球、乳白半透明表皮上的细密黑褐色斑点。" },
                { role: "detail-scene", purchaseQuestion: question, displayContent: display, visualBeat: "产品平放在砧板上，整只保持未切。", evidence: ["fact:whole"] },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        { id: "plan", model: "planner", createdAt: "" },
        { scope: "detail" },
    ).plan;
    product.brief.detailPlan = plan;
    const run = createStudioRun(product, () => "run");
    expect(run.shots).toHaveLength(3);
    const current = studioLocateRunShot(run, 2);
    const restored = { ...current, shot: { ...current.shot, purchaseQuestion: question } };
    const lockedTitle = { ...restored, shot: { ...restored.shot, visual: `购买问题：${question}\n展示内容：${display}`, headline: "备料台上的小鱿鱼", copySource: "user" as const } };
    for (const text of [plan.screens[2].purchaseQuestion, ...[current, restored, lockedTitle].map((screen) => studioImageInput(product, screen, "gpt-image-2", defaultConfig).compiled.prompt)])
        expect(text).not.toMatch(/不(?:是必须|用)切|无需切|切成鱿鱼圈/);
    expect(plan.screens[2].displayContent).toContain("整只小鱿鱼平放在备料板上");
    const sources = studioClaimSources(product);
    for (const value of ["无需切圈", "无需处理", "不需要清洗", "不是必须切成鱿鱼圈"]) expect(checkStudioClaim(value, sources, true).issue).toBeDefined();
    for (const value of ["刀还没落下，整只未切。", "按菜谱可整只蒸，也可切圈炒。", "把切好的鱿鱼圈放在盘里。"]) expect(supportedStudioDescription(value, sources)).toBe(value);
});

test("confirmed steps do not authorize other omissions, seller questions or a general ready-to-cook promise", () => {
    const product = seafood();
    product.sellerNotes = "本款无需切成鱿鱼圈；免洗？还没确认";
    const sources = studioClaimSources(product);
    expect(checkStudioClaim("不必切圈", sources).refs).toEqual(["seller:1"]);
    for (const claim of ["无需切片", "无需处理", "免洗"]) expect(checkStudioClaim(claim, sources).issue).toBeDefined();
    product.sellerNotes = "不能免洗";
    expect(checkStudioClaim("无需清洗", studioClaimSources(product)).issue).toBeDefined();
});

test("a literal on the package stays a literal, not evidence the food needs no preparation", () => {
    const product = seafood();
    product.dossier!.facts.push({ id: "printing", group: "text", label: "袋身文字", value: "免洗", evidence: "visible" });
    const sources = studioClaimSources(product);
    expect(sources.find((source) => source.id === "fact:printing")).toMatchObject({ value: "免洗", appearanceOnly: true });
    expect(checkStudioClaim("包装上印有「免洗」", sources, true)).toEqual({ refs: ["fact:printing"] });
    expect(checkStudioClaim("无需清洗", sources).issue).toBeDefined();
    expect(checkStudioClaim("包装上印有「免洗」，所以无需处理", sources, true).issue).toBeDefined();
    expect(checkStudioClaim("包装上印有「无需处理」", sources, true).issue).toBeDefined();
});
