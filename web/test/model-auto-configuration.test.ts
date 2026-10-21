import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { autoConfigureChannelModel, copyChannelModelPrices, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import { autoConfigureUserChannelModels, mergeFetchedChannelModelCosts } from "../src/lib/channel-model-catalog";
import { modelMatchScore, type ModelMetadataPreset } from "../src/lib/model-metadata-presets";
import type { ChannelModel } from "../src/services/api/wallet";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import type { ModelChannel } from "../src/stores/use-config-store";

const protocols: ModelProtocolDefinition[] = [{ value: "chat-completion", label: "Chat", capability: "text", create: "POST /v1/chat/completions", contentType: "application/json", media: "url" }];
const preset: ModelMetadataPreset = { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1048576, output: 65536, vision: true, reasoning: true };
const template: ChannelModel = { id: "source", channelId: "test", modelKey: preset.id, providerModelKey: preset.id, displayName: "我的分组", icon: "Gemini", capability: "text", protocol: "chat-completion", billingMode: "token", unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 2000000, outputTokenPriceMicrocredits: 4000000, cachedTokenPriceMicrocredits: 500000, priceConfigured: true, enabled: true, priceVersion: 1, priceTiers: [], createdAt: "", updatedAt: "" };

test("explicit price copying preserves units and prices without copying source identity", () => {
    const values = { ...initialChannelModelValues(null, protocols), modelKey: "target", providerModelKey: "target-upstream" };
    const copied = copyChannelModelPrices(values, template);
    expect(copied).toMatchObject({ modelKey: "target", providerModelKey: "target-upstream", protocol: values.protocol });
    expect(copied.priceTiers[0]).toMatchObject({ providerModelKey: "", billingMode: "token", inputTokenPrice: 2, outputTokenPrice: 4, cachedTokenPrice: 0.5 });
    copied.priceTiers[0].inputTokenPrice = 19;
    expect(template.inputTokenPriceMicrocredits).toBe(2000000);
    expect(values.priceTiers[0].inputTokenPrice).toBe(0);
    expect(() => copyChannelModelPrices({ ...values, capability: "image" }, template)).toThrow("相同能力");
});

test("new admin model fills fuzzy metadata and reuses same-channel prices without retaining the old upstream", () => {
    const values = { ...initialChannelModelValues(null, protocols), modelKey: "new-product", providerModelKey: "models/Gemini_2.5_Flash-high" };
    const result = autoConfigureChannelModel(values, [template], protocols, [preset]);
    expect(result.values).toMatchObject({ modelKey: "new-product", providerModelKey: values.providerModelKey, displayName: "我的分组", icon: "Gemini", protocol: "chat-completion", capabilityConfig: { text: { contextWindowTokens: 1048576, maxOutputTokens: 65536 } } });
    expect(result.values.priceTiers[0]).toMatchObject({ providerModelKey: "", billingMode: "token", inputTokenPrice: 2, outputTokenPrice: 4, cachedTokenPrice: 0.5 });
    expect(result.source).toContain("接口和价格参考");
    expect(values.priceTiers[0].unitPrice).toBe(0);
});

test("manual capability, protocol, metadata, icon and pricing edits win over automatic values", () => {
    const values = initialChannelModelValues(null, protocols);
    values.modelKey = preset.id; values.icon = "Qwen"; values.priceTiers[0].unitPrice = 19;
    values.capabilityConfig!.text!.contextWindowTokens = 64000;
    const protectedFields = new Set(["displayName", "capability", "protocol", "capabilityConfig", "icon", "priceTiers"]);
    expect(autoConfigureChannelModel(values, [template], protocols, [preset], protectedFields).values).toEqual(values);
});

test("changing to an unknown model clears previously automatic prices and metadata", () => {
    const matched = autoConfigureChannelModel({ ...initialChannelModelValues(null, protocols), modelKey: preset.id }, [template], protocols, [preset]);
    const unknown = autoConfigureChannelModel({ ...matched.values, modelKey: "unrelated-brand" }, [template], protocols, [preset]);
    expect(unknown.values.icon).toBe("");
    expect(unknown.values.displayName).toBe("未分类");
    expect(unknown.values.priceTiers[0]).toMatchObject({ priceConfigured: false, inputTokenPrice: 0, unitPrice: 0 });
    expect(unknown.values.capabilityConfig?.text?.contextWindowTokens).not.toBe(preset.context);
});

test("category and logo matching is independent of text catalog limits and preserves manual choices", () => {
    const values = { ...initialChannelModelValues(null, protocols), modelKey: "models/Gemini_9_Image-preview" };
    const protectedFields = new Set(["capability", "protocol", "capabilityConfig"]);
    const image = autoConfigureChannelModel({ ...values, capability: "image" }, [], protocols, [], protectedFields).values;
    expect(image).toMatchObject({ displayName: "Gemini", icon: "Gemini", capability: "image" });
    const custom = { ...values, displayName: "商品图", icon: "Qwen" };
    expect(autoConfigureChannelModel(custom, [], protocols, [], new Set(["displayName", "icon"])).values).toMatchObject({ displayName: "商品图", icon: "Qwen" });
    for (const [modelKey, displayName, icon] of [["flux.1-dev", "FLUX", "Flux"], ["sora-2-pro", "Sora", "Sora"], ["veo-3.1", "Veo", "Gemini"], ["gpt-image-1", "GPT", "OpenAI"]]) {
        expect(autoConfigureChannelModel({ ...values, modelKey }, [], protocols, []).values).toMatchObject({ displayName, icon });
    }
});

test("family fallback reuses protocol and prices but not another version's text limits; ties do not pick arbitrarily", () => {
    expect(modelMatchScore("gemini-3.5-flash", preset.id, true)).toBe(1);
    expect(modelMatchScore("gemini-3.5-pro", preset.id, true)).toBe(0);
    expect(modelMatchScore("gpt-5-mini", "gpt-5", true)).toBe(0);
    const values = { ...initialChannelModelValues(null, protocols), modelKey: "gemini-3.5-flash" };
    const reused = autoConfigureChannelModel(values, [template], protocols, [preset]);
    expect(reused.values.priceTiers[0].inputTokenPrice).toBe(2);
    expect(reused.values.capabilityConfig?.text?.contextWindowTokens).not.toBe(preset.context);
    const ambiguous = autoConfigureChannelModel(values, [template, { ...template, id: "other", modelKey: "gemini-4.5-flash", providerModelKey: "gemini-4.5-flash" }], protocols, []);
    expect(ambiguous.values.priceTiers[0].priceConfigured).toBe(false);
});

test("personal channel additions and fetched models reuse prices, keep manual settings, and do not carry route identities", () => {
    const existing = { model: preset.id, capability: "text" as const, protocol: "chat-completion", billingMode: "token" as const, unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 234, outputTokenPriceMicrocredits: 567, logicalModelId: "old-route" };
    const channel: ModelChannel = { id: "personal", name: "Test", apiFormat: "openai", baseUrl: "https://example.invalid", apiKey: "", models: [preset.id, "Gemini_2.5_Flash-high"], modelCosts: [existing] };
    const costs = autoConfigureUserChannelModels(channel, [preset]);
    expect(costs[0]).toBe(existing);
    expect(costs[1]).toMatchObject({ model: channel.models[1], protocol: "chat-completion", inputTokenPriceMicrocredits: 234, outputTokenPriceMicrocredits: 567, capabilityConfig: { text: { contextWindowTokens: preset.context } } });
    expect(costs[1]).not.toHaveProperty("logicalModelId");
    const fetched = mergeFetchedChannelModelCosts(channel, [{ id: channel.models[1] }], [preset]);
    expect(fetched[0].inputTokenPriceMicrocredits).toBe(234);
});

test("frontend and backend ship the identical public metadata snapshot", () => {
    expect(readFileSync(new URL("../src/lib/data/model-metadata-presets.json", import.meta.url), "utf8")).toBe(readFileSync(new URL("../../backend/internal/modelpreset/catalog.json", import.meta.url), "utf8"));
});

test("personal Gemini channels use the native connection protocol for new text models", () => {
    const channel: ModelChannel = { id: "gemini", name: "Test", apiFormat: "gemini", baseUrl: "https://example.invalid", apiKey: "", models: [preset.id] };
    expect(autoConfigureUserChannelModels(channel, [preset])[0]).toMatchObject({ protocol: "gemini-generate-content", capability: "text", icon: "Gemini", capabilityConfig: { text: { contextWindowTokens: preset.context } } });
});

test("personal image model identity does not require a text catalog entry", () => {
    const channel: ModelChannel = { id: "image", name: "Test", apiFormat: "openai", interfaceType: "openai-image", baseUrl: "https://example.invalid", apiKey: "", models: ["FLUX.1-dev"] };
    const imageProtocols: ModelProtocolDefinition[] = [{ ...protocols[0], value: "openai-image", capability: "image" }];
    expect(autoConfigureUserChannelModels(channel, [], imageProtocols)[0]).toMatchObject({ displayName: "FLUX", icon: "Flux", capability: "image" });
    expect(mergeFetchedChannelModelCosts({ ...channel, interfaceType: undefined }, [{ id: "sora-2", modelType: "video" }])[0]).toMatchObject({ displayName: "Sora", icon: "Sora", capability: "video" });
});
