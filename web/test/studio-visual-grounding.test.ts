import { expect, test } from "bun:test";
import { checkStudioClaim, studioClaimSources, supportedStudioDescription } from "@/lib/ecommerce-studio/claim-evidence";
import { buildDetailPlanPrompt, parseDetailPlan } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { studioDetailPlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDirectionsPrompt } from "@/lib/ecommerce-studio/plan-prep-tasks";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { parseFill } from "@/lib/ecommerce-studio/dossier-tasks";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import { studioImageInput, studioImageTaskMetadata, studioLocateRunShot } from "@/lib/ecommerce-studio/generation-input";
import { defaultConfig } from "@/stores/use-config-store";

function oldDossier() {
    const product = createStudioProduct("observed");
    product.name = "手持吹风机";
    product.brief = { ...product.brief, outputType: "detail-set", detailScreens: 2 };
    product.photos = [{ id: "original", resourceId: "original", url: "", view: "side", truth: true, addedAt: "" }];
    product.dossier = {
        name: product.name,
        category: "吹风机",
        family: "electronics",
        summary: "圆筒形风筒配细长手柄与正面出风口格栅。",
        facts: [{ id: "grille", group: "structure", label: "出风口格栅", value: "圆形出风口，内部为多层同心圆格栅，中心为圆形轴心", evidence: "visible", source: "图1" }],
        invariants: ["出风口为圆形同心圆格栅，环圈与格栅为白色／浅灰"],
        questions: [],
    };
    product.sellingPoints = [{ id: "rings", title: "正面同心圆格栅", detail: "出风口为同心圆格栅，出风更集中", factIds: ["grille"], evidence: "visible", enabled: true }];
    return product;
}

test("still photo observation cannot identify a working end in plan, native image prompt or retrieval metadata", () => {
    const product = oldDossier();
    const sources = studioClaimSources(product);
    const roles = studioDetailPlanRoles(product);
    const plan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", purchaseQuestion: "手柄在什么位置？", displayContent: "细长手柄与机身连接。" },
                { role: "detail-closeup", purchaseQuestion: "出风口是什么形状？", displayContent: "圆形出风口正面特写，内部为多层同心圆格栅，出风更集中。", visualFocus: "圆形格栅是出风口", evidence: ["fact:grille", "point:rings"] },
            ],
        }),
        product,
        roles,
        { id: "plan", model: "planner", createdAt: "" },
        { scope: "detail" },
    ).plan;
    product.brief.detailPlan = plan;
    const run = createStudioRun(product, () => "run");
    const shot = studioLocateRunShot(run, 1);
    const compiled = studioImageInput(product, shot, "gpt-image-2", defaultConfig).compiled;
    const wrong = /出风口|出风更集中/;
    for (const text of [
        sources.map((s) => `${s.label} ${s.text}`).join("；"),
        buildDirectionsPrompt(product, "detail"),
        buildDetailPlanPrompt(product, roles),
        plan.screens[1].displayContent,
        compiled.prompt,
        JSON.stringify(studioImageTaskMetadata(product, shot, compiled)),
    ]) {
        expect(text).not.toMatch(wrong);
        expect(text).toContain("同心圆格栅");
    }
    expect(checkStudioClaim("出风更集中", sources).issue).toBeDefined();
    expect(checkStudioClaim("圆形格栅是出风口", sources).issue).toBeDefined();
    for (const action of ["吹头发时，风筒哪一端、朝哪个方向对着头发？", "风口正对发束", "让圆形格栅朝向湿发", "发丝位于风口下方", "圆网是出风端"]) expect(checkStudioClaim(action, sources, true).issue).toBeDefined();
    expect(supportedStudioDescription("吹头发时，风筒哪一端、朝哪个方向对着头发？", sources)).toBe("");
    expect(supportedStudioDescription("一只手拿着机器靠近发束，风口正对发束。", sources)).toBe("一只手拿着机器靠近发束");
});

test("an operating role is supported for the seller-confirmed part, not an arbitrary second opening; shape and ordinary actions survive", () => {
    const product = oldDossier();
    product.sellerNotes = "圆形格栅是进风口；扁嘴端为出风口";
    const sources = studioClaimSources(product);
    expect(checkStudioClaim("圆形格栅是进风口", sources).refs).toContain("seller:1");
    expect(checkStudioClaim("扁嘴端为出风口", sources).refs).toContain("seller:2");
    expect(checkStudioClaim("手持机器，扁嘴端朝向发丝", sources, true).refs).toContain("seller:2");
    expect(checkStudioClaim("让圆形格栅朝向湿发", sources, true).issue).toBeDefined();
    expect(checkStudioClaim("圆形格栅是出风口", sources).issue).toBeDefined();
    expect(supportedStudioDescription("手持机身靠近发束。圆形格栅是出风口，内部可见同心圆环。", sources)).toContain("手持机身靠近发束");
    expect(supportedStudioDescription("圆形格栅是出风口，内部可见同心圆环。", sources)).not.toContain("出风口");
    expect(supportedStudioDescription("扁嘴端为出风口。", sources)).toBe("扁嘴端为出风口。");
    product.sellerNotes = "这台机器有出风口";
    expect(checkStudioClaim("圆形格栅是出风口", studioClaimSources(product)).issue).toBeDefined();
    product.brief.prep = { asks: [{ id: "port", question: "圆形格栅端是进风口吗？", picked: ["是"], options: ["是", "否"], note: "", multi: false }], directions: [] };
    expect(checkStudioClaim("圆形格栅端是进风口", studioClaimSources(product)).refs).toContain("answer:port");
});

test("a side view of a dispenser supports the observed opening, not the water flow or a performance claim", () => {
    const product = oldDossier();
    product.name = "桌面饮水机";
    product.sellingPoints = [];
    product.dossier = { name: product.name, category: "饮水机", family: "home", summary: "", invariants: [], questions: [], facts: [{ id: "port", group: "structure", label: "背面进水口", value: "背面进水口外沿为黑色圆环，防漏", evidence: "visible" }] };
    const sources = studioClaimSources(product);
    const port = sources.find((source) => source.id === "fact:port");
    expect(port?.text).toContain("黑色圆环");
    expect(port?.text).not.toMatch(/进水口|防漏/);
    expect(checkStudioClaim("背面黑色圆环内是进水口", sources).issue).toBeDefined();
    product.dossier.facts[0].evidence = "confirmed";
    expect(checkStudioClaim("背面黑色圆环内是进水口", studioClaimSources(product)).issue).toBeUndefined();
    expect(checkStudioClaim("防漏", studioClaimSources(product)).refs).toEqual(["fact:port"]);
});

test("recognition uses the same evidence for the visible dossier, autofill headline and source IDs", () => {
    const old = oldDossier();
    const input = {
        ...old.dossier,
        title: "快速吹干",
        points: [
            { title: "圆形格栅", detail: "外圈为白色", facts: ["出风口格栅"] },
            { title: "快速吹干", facts: ["出风口格栅"] },
        ],
    };
    let next = 0;
    const parsed = parseFill(JSON.stringify(input), () => String(++next));
    expect(JSON.stringify(parsed.dossier)).not.toContain("出风口");
    expect(parsed.dossier.facts[0].value).toContain("多层同心圆格栅");
    expect(parsed.sellingPoints[0].factIds).toEqual([parsed.dossier.facts[0].id]);
    expect(parsed.sellingPoints[0].enabled).toBe(true);
    expect(parsed.sellingPoints[1].enabled).toBe(false);
    expect(parsed.title).not.toBe("快速吹干");
});

test("readable package text is retained on the product rather than becoming a verified benefit", () => {
    const product = oldDossier();
    const input = { name: "抽纸", facts: [{ group: "text", label: "包装原文", value: "抗菌", evidence: "visible", source: "图1" }] };
    const { dossier } = parseFill(JSON.stringify(input), () => "print");
    expect(dossier.facts[0]).toMatchObject({ evidence: "visible", value: "抗菌" });
    product.dossier = dossier;
    const sources = studioClaimSources(product);
    expect(sources.find((source) => source.id === "fact:print")).toMatchObject({ appearanceOnly: true, value: "抗菌" });
    expect(checkStudioClaim("抗菌", sources).issue).toBeDefined();
});

test("persisted image inputs keep the original idempotency metadata for both new and already-submitted legacy attempts", () => {
    const product = oldDossier();
    product.brief.detailPlan = parseDetailPlan(
        JSON.stringify({
            screens: [
                { role: "detail-hero", displayContent: "手柄与圆筒形机身。" },
                { role: "detail-closeup", displayContent: "同心圆格栅及环圈。" },
            ],
        }),
        product,
        studioDetailPlanRoles(product),
        { id: "plan", model: "planner", createdAt: "" },
        { scope: "detail" },
    ).plan;
    const run = createStudioRun(product, () => "run");
    const located = studioLocateRunShot(run, 0);
    const input = studioImageInput(product, located, "gpt-image-2", defaultConfig);
    const legacy = structuredClone(input);
    delete legacy.compiled.knowledgeMaterials;
    const attempts = [input, legacy].map((stored, index) => ({ id: `attempt-${index}`, status: "submitting" as const, model: "gpt-image-2", replaySafe: true as const, input: stored, createdAt: "", tweaks: [], outputs: [] }));
    run.shots[0] = { ...run.shots[0], purchaseQuestion: "出风口吗？", displayContent: "正面出风口格栅", attempts };
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(appendStudioRun(product, run))))!;
    const shot = studioLocateRunShot(restored.runs[0], 0);
    const [current, old] = shot.shot.attempts.map((attempt) => studioImageTaskMetadata(restored, shot, attempt.input!.compiled));
    expect(current.studioMaterials).toContain("同心圆格栅");
    expect(JSON.stringify(current)).not.toMatch(/出风口|studioPurchaseQuestion|studioDisplayContent/);
    expect(old).toMatchObject({ studioMaterials: "出风口格栅 圆形出风口，内部为多层同心圆格栅，中心为圆形轴心", studioPurchaseQuestion: "出风口吗？", studioDisplayContent: "正面出风口格栅" });
});
