import { expect, test } from "bun:test";
import { buildStudioImageGeneration, compileStudioShot, locateStudioShot, studioImageInput } from "@/lib/ecommerce-studio/generation-input";
import { createStudioProduct, normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun } from "@/lib/ecommerce-studio/runs";
import { defaultConfig } from "@/stores/use-config-store";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";

test("selling point screens demonstrate supported benefits without inventing performance evidence", () => {
    const product = createStudioProduct("visual-proof");
    product.name = "示例保温杯";
    product.photos = [{ id: "photo", resourceId: "resource", url: "", truth: true, view: "front", addedAt: "2026-11-10" }];
    product.sellingPoints = [
        { id: "usable", title: "握持方便", detail: "杯身带有可见把手", evidence: "visible", factIds: [], enabled: true },
        { id: "unknown", title: "超长保温", detail: "保持热水99小时", evidence: "pending", factIds: [], enabled: true },
    ];
    let index = 0;
    const run = createStudioRun(product, () => `proof-${++index}`);
    const shot = { ...run.shots[0], role: "detail-selling" as const, sellingPointIds: ["usable", "unknown"], visual: "展示手握把手的使用状态" };
    const input = compileStudioPrompt({ product, shot, model: "gpt-image-2", textMode: "model" });
    const proof = input.layers.find((layer) => layer.id === "proof")!;
    expect(proof.text).toContain("杯身带有可见把手");
    expect(proof.text).not.toContain("99小时");
    expect(proof.text).toContain("不能伪造温度曲线");
    expect(input.prompt).toContain("卖点可视化");
});

test("run source and compiled input survive reload without channel credentials", () => {
    let product = createStudioProduct("input-snapshot");
    product.name = "示例保温杯";
    product.copy = { headline: "一杯温暖", subhead: "", listingTitle: "", bullets: [] };
    product.photos = [{ id: "photo", resourceId: "resource", url: "/api/resources/resource/file", truth: true, view: "front", addedAt: "2026-11-09" }];
    product.brief = { ...product.brief, outputType: "main", language: "zh", count: 4 };
    let index = 0;
    const run = createStudioRun(product, () => `snapshot-${++index}`);
    product = appendStudioRun(product, run);
    const ref = { runId: run.id };
    const shot = run.shots[3];
    const located = locateStudioShot(product, ref, shot.id)!;
    const input = studioImageInput(product, located, "gpt-image-2", { ...defaultConfig, apiKey: "FAKE_TEST_CREDENTIAL" });
    const before = input.compiled.prompt;
    shot.attempts = [{ id: "operation", status: "submitting", model: "gpt-image-2", tweaks: [], outputs: [], createdAt: "2026-11-09", input }];
    product = { ...product, name: "改后的名字", brief: { ...product.brief, language: "en" } };
    const reloaded = normalizeStudioProduct(JSON.parse(JSON.stringify(product)))!;
    const after = compileStudioShot(reloaded, locateStudioShot(reloaded, ref, shot.id)!, "gpt-image-2", defaultConfig).compiled;
    expect(after.prompt).toBe(before);
    expect(after.layers.find((layer) => layer.id === "market")?.text).toContain("中文");
    expect(reloaded.runs[0].shots[3].attempts[0].input?.compiled.prompt).toBe(before);
    expect(JSON.stringify(reloaded)).not.toContain("FAKE_TEST_CREDENTIAL");
    expect(reloaded.name).toBe("改后的名字");
    expect(() => buildStudioImageGeneration(defaultConfig, "gpt-image-2", { ...input, compiled: { ...input.compiled, references: [] } }, shot.id)).toThrow("生成输入不完整");
    expect(() => buildStudioImageGeneration(defaultConfig, "gpt-image-2", { ...input, compiled: { ...input.compiled, prompt: "" } }, shot.id)).toThrow("生成输入不完整");
});
