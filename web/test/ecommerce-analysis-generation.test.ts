import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { defaultConfig, createModelChannel, encodeChannelModel } from "../src/stores/use-config-store";
import { CanvasNodeType } from "../src/types/canvas";
import { buildEcommerceAnalysisGeneration } from "../src/lib/ecommerce/ecommerce-analysis-generation";

test("an unavailable explicit analysis model cannot silently use the global default", () => {
    const capabilityConfig = defaultModelCapabilityConfig("newapi-chat", "qwen-test");
    capabilityConfig.text!.references.maxImages = 2;
    const channel = createModelChannel({ id: "test", models: ["qwen-test"], modelCosts: [{ model: "qwen-test", capability: "text", protocol: "newapi-chat", capabilityConfig }] });
    const config = { ...defaultConfig, channels: [channel], textModel: "test::qwen-test", textModels: ["test::qwen-test"] };
    const input = { textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 };
    expect(() => buildEcommerceAnalysisGeneration(config, "test::deleted-gemini", input)).toThrow("尚未提交");
    expect(buildEcommerceAnalysisGeneration(config, undefined, input).model).toBe(config.textModel);
    expect(() => buildEcommerceAnalysisGeneration(config, config.textModel, { ...input, imageCount: 3 })).toThrow("最多支持 2 张");
});

test.each(["gemini-3.8-flash-high", "deepseek-v4.1-flash", "qwen3.7-flash"])("analysis task preserves the selected channel and vision limits for %s", async (name) => {
    const text = defaultModelCapabilityConfig("newapi-chat", name);
    text.text!.references.maxImages = 10;
    text.text!.maxOutputTokens = 8192;
    const other = structuredClone(text);
    other.text!.references.maxImages = 0;
    other.text!.maxOutputTokens = 1024;
    const channels = [other, text].map((capabilityConfig, index) =>
        createModelChannel({
            id: index ? "chosen" : "other",
            scope: "system",
            models: [name],
            modelCosts: [{ model: name, capability: "text", protocol: "newapi-chat", capabilityConfig, billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
        }),
    );
    const selected = encodeChannelModel("chosen", name);
    const config = { ...defaultConfig, channels, model: selected, textModel: selected, textModels: [selected] };
    for (const type of [CanvasNodeType.Product, CanvasNodeType.EcommerceStudio]) {
        const generation = buildEcommerceAnalysisGeneration(config, selected, { textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 });
        const provider = backendProviderConfig(generation, "text");
        expect(provider.channelId).toBe("chosen");
        expect(provider.model).toBe(name);
        expect(provider.capabilityConfig?.text?.references.maxImages).toBe(10);
        expect(provider.capabilityConfig?.text?.maxOutputTokens).toBe(8192);
        const task = await prepareBackendGenerationTask({
            mode: "text",
            prompt: "product",
            config: generation,
            streamText: false,
            referenceImages: [{ storageKey: "resource:test-product" }],
            metadata: { ecommerceAnalysisFlow: type === CanvasNodeType.Product ? "detail" : "cap:planning" },
        });
        expect(task.input.config).toMatchObject({ channelId: "chosen", model: name, interfaceType: "newapi-chat" });
        expect(task.input.referenceImages).toHaveLength(1);
    }
});
