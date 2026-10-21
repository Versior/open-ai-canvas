import { expect, test } from "bun:test";
import { buildEcommerceImageGeneration, ecommerceImageSettings } from "../src/lib/ecommerce/ecommerce-image-generation";
import { DEFAULT_ECOMMERCE_BRIEF } from "../src/lib/ecommerce/ecommerce-capabilities";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { modelCompatibilityError } from "../src/lib/model-selection";
import { defaultConfig, createModelChannel, encodeChannelModel } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { projectImageParameters } from "../src/lib/image-parameters";
import { capabilitySpecFromChannelModel } from "../src/pages/admin/logical-models/model-routing-capabilities";
import { backendProviderConfig, prepareBackendGenerationTask } from "../src/services/api/generation-task";
import type { ChannelModel } from "../src/services/api/wallet";
import type { ImageCapabilityConfig } from "../src/lib/model-capabilities";

const input = { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 };
function fixture(image: ImageCapabilityConfig, logical = false) {
    const spec = capabilitySpecFromChannelModel({ capability: "image", capabilityConfig: { version: 1, image } } as ChannelModel)!;
    const channel = createModelChannel({ id: "studio-test", models: ["test-image"], modelCosts: [{ model: "test-image", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1, ...(logical ? { logicalModelId: "studio-logical", logicalCapabilitySpec: spec } : {}) }] });
    const model = encodeChannelModel(channel.id, "test-image");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model, imageModels: [model], quality: "low", size: "1024x1024" };
    const target: CanvasNodeData = { id: "result", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { model, count: 9 } };
    return { config, target };
}

test("studio 3:4 resolves a configured pixel preset before compatibility validation", () => {
    const image = defaultImageCapabilityConfig("openai-image", "test-image");
    image.size = { parameter: "size", values: ["1024x1024", "1080x1440"], default: "1024x1024", allowCustom: false, presets: [{ tier: "1k", ratio: "3:4", width: 1080, height: 1440, size: "1080x1440" }] };
    const channel = createModelChannel({ id: "studio-test", models: ["test-image"], modelCosts: [{ model: "test-image", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image }, billingMode: "fixed_request", unitPriceMicrocredits: 1 }] });
    const model = encodeChannelModel(channel.id, "test-image");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model, imageModels: [model] };
    const target: CanvasNodeData = { id: "result", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { model, size: "3:4", count: 1 } };
    const requirements = { capability: "image" as const, imageSize: "3:4", input: { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 } };
    const generation = buildEcommerceImageGeneration(config, target, { ...DEFAULT_ECOMMERCE_BRIEF, aspectRatio: "3:4" }, requirements.input).config;
    expect(modelCompatibilityError(generation, generation.model, { ...requirements, imageSize: generation.size })).toBe("");
    expect(generation.size).toBe("1080x1440");
});

test("logical image requests keep shared pixel size and quality after reload", async () => {
    const image = projectImageParameters(defaultImageCapabilityConfig("openai-image"), [
        { name: "size", label: "尺寸", type: "string", encoding: "pixels", values: ["1024x1024", "1080x1440"], default: "1024x1024" },
        { name: "quality", label: "质量", type: "string", values: ["low", "high"], default: "low" },
        { name: "count", label: "张数", type: "integer", min: 1, max: 4, default: 1 },
    ]);
    image.size.presets = [{ tier: "1k", ratio: "3:4", width: 1080, height: 1440, size: "1080x1440" }];
    const { config, target } = fixture(image, true);
    const brief = JSON.parse(JSON.stringify({ ...DEFAULT_ECOMMERCE_BRIEF, aspectRatio: "3:4", imageSettings: { size: "1080x1440", quality: "high" } }));
    const generation = buildEcommerceImageGeneration(config, target, brief, input).config;
    expect(generation).toMatchObject({ size: "1080x1440", quality: "high", count: "1" });
    const task = await prepareBackendGenerationTask({ mode: "image", prompt: "product", config: generation });
    expect(task.input.capabilityOptions).toMatchObject({ size: "1080x1440", quality: "high", count: 1 });
    expect(task.input.config).toMatchObject({ size: "1080x1440", quality: "high" });
});

test("Gemini ratio and resolution remain independent from quality", () => {
    const image = projectImageParameters(defaultImageCapabilityConfig("gemini-image"), [
        { name: "size", label: "画幅", type: "string", encoding: "ratio", values: ["1:1", "3:4"], default: "1:1" },
        { name: "imageResolution", label: "分辨率", type: "string", values: ["1k", "2k", "4k"], default: "1k" },
    ]);
    const { config, target } = fixture(image);
    const generation = buildEcommerceImageGeneration(config, target, { ...DEFAULT_ECOMMERCE_BRIEF, imageSettings: { size: "3:4", imageResolution: "4k" } }, input).config;
    expect(generation).toMatchObject({ size: "3:4", imageResolution: "4k", count: "1" });
    expect(backendProviderConfig(generation).imageParameters).toMatchObject({ size: "3:4", imageResolution: "4k" });
});

test("unsupported ratios and qualities fail before submission without silently changing intent", () => {
    const image = defaultImageCapabilityConfig("openai-image");
    image.size = { parameter: "size", values: ["1024x1024"], default: "1024x1024", allowCustom: false, presets: [] };
    const { config, target } = fixture(image);
    expect(() => buildEcommerceImageGeneration(config, target, { ...DEFAULT_ECOMMERCE_BRIEF, aspectRatio: "3:4" }, input)).toThrow("未配置 3:4");
    expect(() => ecommerceImageSettings(config, config.imageModel, { ...DEFAULT_ECOMMERCE_BRIEF, imageSettings: { quality: "ultra" } })).toThrow("不支持质量 ultra");
});

test("pixel preset selection is converted to the public ratio for ratio-encoded contracts", () => {
    const image = projectImageParameters(defaultImageCapabilityConfig("gemini-image"), [
        { name: "size", label: "画幅", type: "string", encoding: "pixels", values: ["1:1", "3:4"], default: "1:1" },
        { name: "imageResolution", label: "分辨率", type: "string", values: ["1k", "2k"], default: "1k" },
    ]);
    image.size.presets = [{ tier: "2k", ratio: "3:4", width: 1728, height: 2304, size: "1728x2304" }];
    const { config, target } = fixture(image);
    const generation = buildEcommerceImageGeneration(config, target, { ...DEFAULT_ECOMMERCE_BRIEF, imageSettings: { size: "1728x2304", imageResolution: "2k" } }, input).config;
    expect(generation).toMatchObject({ size: "3:4", imageResolution: "2k" });
});
