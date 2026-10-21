import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import catalog from "../src/lib/data/model-metadata-presets.json";
import { applyModelMetadataPreset, consolidateModelPresets, matchingModelPresets, presetApplicationError, presetModelIcon, type ModelMetadataPreset } from "../src/lib/model-metadata-presets";
import { initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";

const preset: ModelMetadataPreset = { provider: "google", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1048576, output: 65536, reasoning: true, vision: true, maxImages: 3600 };

test("exact model IDs consolidate duplicates without mixing version suffixes", () => {
    const variants = [preset, { ...preset, provider: "google-vertex", output: 32768 }];
    const models = consolidateModelPresets(variants);
    expect(matchingModelPresets(models, " gemini-2.5-flash " )).toEqual([{ ...preset, provider: undefined, output: 32768 }].map(({ provider, ...model }) => model));
    for (const id of ["gemini-2.5-flash-high", "models/gemini-2.5-flash", "Gemini 2.5 Flash", "Gemini-2.5-Flash"]) expect(matchingModelPresets(models, id)[0]?.id).toBe(preset.id);
    for (const id of ["gemini-2.5", "gemini-3.5-flash", "gemini-2.5-pro", ""]) expect(matchingModelPresets(variants, id)).toEqual([]);
    expect(consolidateModelPresets([...variants].reverse())).toEqual(models);
    expect(models[0].provider).toBeUndefined();
});

test("conflicting model capabilities use their intersection and smallest declared limits", () => {
    expect(consolidateModelPresets([preset, { ...preset, context: 128000, output: 8192, vision: false, reasoning: false, maxImages: 4 }])[0]).toMatchObject({ context: 128000, output: 8192, vision: false, reasoning: false, maxImages: 4 });
    expect(consolidateModelPresets([preset, { ...preset, id: preset.id + "-high" }])).toHaveLength(2);
});

test("applying a preset preserves custom identity, pricing, protocol and unrelated limits", () => {
    const values = initialChannelModelValues(null, []);
    Object.assign(values, { modelKey: "product-alias", providerModelKey: "custom-upstream", channelLabel: "自定义渠道名", displayName: "我的分组", icon: "Qwen", description: "自己的说明", enabled: false, protocol: "text", tags: [{ text: "特价", color: "gold" }] });
    values.priceTiers[0].unitPrice = 19;
    values.capabilityConfig!.text!.streaming = false;
    values.capabilityConfig!.text!.references.maxImageBytes = 123456;
    values.capabilityConfig!.text!.references.maxVideos = 2;
    const before = structuredClone(values);
    const next = applyModelMetadataPreset(values, preset);
    expect(values).toEqual(before);
    expect({ ...next, capabilityConfig: before.capabilityConfig }).toEqual(before);
    expect(next.capabilityConfig?.text).toEqual({ ...before.capabilityConfig!.text!, contextWindowTokens: 1048576, maxOutputTokens: 65536, references: { ...before.capabilityConfig!.text!.references, maxImages: 100 } });
    expect(next.capabilityConfig?.text?.thinking).toBeUndefined();
});

test("image counts use declared data, explicit conservative policy or zero for text-only", () => {
    const values = initialChannelModelValues(null, []);
    const unknown = { ...preset, maxImages: undefined };
    expect(applyModelMetadataPreset(values, unknown).capabilityConfig?.text?.references.maxImages).toBe(1);
    expect(applyModelMetadataPreset(values, { ...preset, maxImages: 8 }).capabilityConfig?.text?.references.maxImages).toBe(8);
    values.capabilityConfig!.text!.references.maxImages = 7;
    expect(applyModelMetadataPreset(values, unknown).capabilityConfig?.text?.references.maxImages).toBe(7);
    expect(applyModelMetadataPreset(values, { ...preset, vision: false }).capabilityConfig?.text?.references.maxImages).toBe(0);
    expect(applyModelMetadataPreset(values, preset).icon).toBe("Gemini");
});

test("unsupported contracts are rejected without clamping or treating image input as image generation", () => {
    const values = initialChannelModelValues(null, []);
    for (const capability of ["image", "video", "audio"]) expect(() => applyModelMetadataPreset({ ...values, capability }, preset)).toThrow("图片输入不代表图片生成能力");
    for (const invalid of [{ context: 2048 }, { output: 100 }, { output: preset.context }, { output: 1048576 }, { context: 10000001 }]) expect(() => applyModelMetadataPreset(values, { ...preset, ...invalid })).toThrow("不会自动截断参数");
    expect(presetApplicationError(preset, "text")).toBe("");
});

test("brand icons describe model families across resellers and exist in the installed registry", () => {
    for (const [id, icon] of [["qwen/qwen3.7-flash", "Qwen"], ["deepseek/deepseek-v4.1-flash", "DeepSeek"], ["anthropic/claude-opus-5", "Claude"], ["meta/llama-3.3", "Meta"], ["step-3.5", "Stepfun"]]) expect(presetModelIcon({ id, provider: "openrouter" })).toBe(icon);
    expect(presetModelIcon({ id: "unknown-brand", provider: "openrouter" })).toBe("");
    for (const model of catalog.models) {
        const icon = presetModelIcon(model);
        if (icon) expect(existsSync(new URL(`../node_modules/@lobehub/icons/es/${icon}/index.js`, import.meta.url))).toBe(true);
    }
});

test("bundled catalog is versioned and contains only public metadata, without provider transport or pricing", () => {
    expect(catalog.source).toBe("https://pi.dev/api/models");
    expect(catalog.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.isNaN(Date.parse(catalog.fetchedAt))).toBe(false);
    expect(catalog.models.length).toBeGreaterThan(1000);
    expect(new Set(catalog.models.map((model) => JSON.stringify([model.provider, model.id]))).size).toBe(catalog.models.length);
    for (const model of catalog.models) {
        expect(Object.keys(model).every((key) => ["provider", "id", "name", "context", "output", "reasoning", "vision", "maxImages"].includes(key))).toBe(true);
        expect(Number.isSafeInteger(model.context) && Number.isSafeInteger(model.output)).toBe(true);
    }
});
