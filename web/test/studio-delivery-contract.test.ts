import { expect, test } from "bun:test";
import { previewStudioDetailGeometry } from "@/lib/ecommerce-studio/delivery-geometry";
import { reviewStudioDelivery } from "@/lib/ecommerce-studio/delivery-review";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { buildStudioDesignCheckPrompt } from "@/lib/ecommerce-studio/design-check";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import type { StudioPlan, StudioShot } from "@/lib/ecommerce-studio/types";
import { readZip } from "@/lib/zip";
import { bindStudioLongImage, exportStudioZip } from "@/pages/ecommerce-studio/studio-delivery";

test("淘系超高分屏不阻断原长图；抖音预检区分第 16 和第 17 屏", () => {
    const taobao = previewStudioDetailGeometry("taobao", [{ ratio: "3:4" }, { ratio: "2:3" }]);
    expect(taobao).toMatchObject({ width: 750, height: 2125, longImageAvailable: true, sliceAvailable: false });
    expect(taobao.issues.join("；")).toContain("第 2 屏 1125px");
    expect(taobao.issues.join("；")).toContain("原长图");
    const screens = Array.from({ length: 17 }, () => ({ ratio: "3:4" }));
    expect(previewStudioDetailGeometry("douyin", screens.slice(0, 16))).toMatchObject({ height: 16000, sliceAvailable: true });
    expect(previewStudioDetailGeometry("douyin", screens)).toMatchObject({ height: 17000, longImageAvailable: true, sliceAvailable: false });
    expect(previewStudioDetailGeometry("taobao", [{ ratio: "auto" }])).toMatchObject({ height: null, sliceAvailable: false });
    const oversized = Array.from({ length: 30 }, () => ({ ratio: "1:3" }));
    expect(previewStudioDetailGeometry("jd", oversized)).toMatchObject({ longImageAvailable: false, sliceAvailable: false });
});

function deliveryFixture() {
    const product = createStudioProduct("fictional-spec");
    product.brief.language = "en";
    product.sellerNotes = "Body: Round\nBase: Flat\nColor: Blue\nFinish: Matte";
    const shots = ["Rim", "Base", "How to choose"].map((headline, index): StudioShot => ({
        id: `shot-${index + 1}`,
        role: index === 1 ? "detail-spec" : "detail-scene",
        title: `选购第 ${index + 1} 屏`,
        ratio: "3:4",
        headline,
        subline: "",
        lines: [],
        copySource: "user",
        tweaks: [],
        sellingPointIds: [],
        attempts: [],
    }));
    shots[1].lines = ["Body | Round", "Base | Flat", "Color | Blue", "Finish | Matte"];
    const produced = shots.map((shot) => {
        const compiled = compileStudioPrompt({ product, shot, brief: product.brief, model: "gpt-image" });
        const output = { resourceId: `out-${shot.id}`, url: "" };
        shot.attempts = [{ id: `attempt-${shot.id}`, status: "succeeded", textMode: "model", createdAt: "", model: "gpt-image", input: { compiled, request: { imageSettings: {} } }, outputs: [output], tweaks: [] }];
        return { shot, output, url: "data:application/octet-stream,fixture", composed: false };
    });
    const plan: StudioPlan = { id: "plan", createdAt: "", kind: "detail", textMode: "model", shots };
    const measured = new Map(shots.map((shot) => [shot.id, { width: 750, height: 1000, bytes: 1000 }]));
    return { product, shots, produced, plan, measured };
}

test("规格页四行沿用策划预算，文件齐全显式不代表文字、事实与上架审核", () => {
    const { product, shots, measured } = deliveryFixture();
    const report = reviewStudioDelivery(product, shots, measured, new Set(measured.keys()));
    expect(report).toMatchObject({ issues: [], fileSet: "complete", pixelText: "not-checked", productFacts: "not-verified", publication: "requires-human-review" });
});

test("缺中屏只允许显式草稿，保留原编号、缺图原因，不伪造完整长图或切片", async () => {
    const { product, shots, plan, produced, measured } = deliveryFixture();
    const partial = [produced[2], produced[0]];
    const report = reviewStudioDelivery(product, shots, measured, new Set(partial.map((item) => item.shot.id)));
    expect(report.fileSet).toBe("incomplete");
    expect(() => bindStudioLongImage(product, plan, partial)).toThrow("缺第 2 张");
    await expect(exportStudioZip(product, plan, partial, "complete", report)).rejects.toThrow("缺第 2 张");
    await expect(exportStudioZip(product, plan, partial, "originals", report)).rejects.toThrow("缺第 2 张");
    const files = await readZip(await exportStudioZip(product, plan, partial, "draft", report));
    const manifest = JSON.parse(await files.get("manifest.json")!.text());
    expect(manifest).toMatchObject({ archiveKind: "draft", complete: false, missingShots: [{ index: 2, id: "shot-2" }], slices: [] });
    expect(manifest.shots.map((item: { index: number }) => item.index)).toEqual([1, 3]);
    expect(files.has("详情页长图.png")).toBe(false);
    expect(await files.get("文案.txt")!.text()).toContain("缺图，未交付");
});

test("采用旧候选、改过表单及刷新后，验图与文件均以同一份目标语提交快照为准", async () => {
    const { product, shots, produced, plan, measured } = deliveryFixture();
    shots[0].headline = "New version not in the selected image";
    product.brief.language = "ja";
    product.plans = [plan];
    const restored = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
    const restoredPlan = restored.plans[0];
    const restoredShot = restoredPlan.shots[0];
    const submitted = restoredShot.attempts[0].input!.compiled;
    expect(submitted.copySnapshot).toMatchObject({ source: "user", language: "en", headline: "Rim" });
    const check = buildStudioDesignCheckPrompt(restored, restoredShot, false, submitted);
    expect(check).toContain("目标语：英文");
    expect(check).toContain('["Rim"]');
    expect(check).not.toContain(shots[0].headline);
    expect(check).not.toContain("日文");
    const report = reviewStudioDelivery(restored, restoredPlan.shots, measured, new Set(measured.keys()));
    const files = await readZip(await exportStudioZip(restored, restoredPlan, produced, "originals", report));
    const sheet = await files.get("文案.txt")!.text();
    expect(sheet).toContain("目标语言：English · 该候选提交定稿");
    expect(sheet).not.toContain(shots[0].headline);
    expect(sheet.indexOf("主标题：Rim")).toBeLessThan(sheet.indexOf("主标题：Base"));
    expect(sheet).toContain("Finish | Matte");
    const manifest = JSON.parse(await files.get("manifest.json")!.text());
    expect(manifest.shots[0].copy).toMatchObject({ source: "submitted", language: "en", headline: "Rim" });
    const legacyCheck = buildStudioDesignCheckPrompt(restored, restoredShot, false);
    expect(legacyCheck).toContain("无法确认是否要求有字或定稿是什么时标 unknown");
    expect(legacyCheck).not.toContain("目标语：");
    expect(legacyCheck).not.toContain(shots[0].headline);
});
