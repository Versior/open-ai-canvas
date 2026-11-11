import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import type { ChannelModel } from "../src/services/api/wallet";
import { copyChannelModelConfiguration, initialChannelModelValues } from "../src/pages/admin/components/channel-model-editor-form";
import { identifyChannelModelConfiguration } from "../src/pages/admin/components/channel-model-identification";
import { priceTierPayloadFromForm } from "../src/pages/admin/components/channel-model-price-tier-form";

const protocols: ModelProtocolDefinition[] = [
    { value: "chat-completion", label: "Chat", capability: "text", create: "POST /v1/chat/completions", contentType: "application/json", media: "url" },
    { value: "image", label: "Image", capability: "image", create: "POST /v1/images/generations", contentType: "application/json", media: "url" },
    { value: "video", label: "Video", capability: "video", create: "POST /v1/videos", contentType: "application/json", media: "url" },
];
const source: ChannelModel = {
    id: "source",
    channelId: "other",
    modelKey: "source-product",
    providerModelKey: "source-upstream",
    displayName: "来源分组",
    channelLabel: "来源渠道",
    tags: [{ text: "推荐", color: "green" }],
    description: "说明",
    icon: "Gemini",
    capability: "text",
    protocol: "chat-completion",
    capabilityConfig: defaultModelCapabilityConfig("chat-completion"),
    billingMode: "token",
    unitPriceMicrocredits: 0,
    inputTokenPriceMicrocredits: 1_000_000,
    outputTokenPriceMicrocredits: 2_000_000,
    cachedTokenPriceMicrocredits: 300_000,
    cacheWriteTokenPriceMicrocredits: 400_000,
    priceConfigured: true,
    enabled: true,
    priceCurrency: "USD",
    priceVersion: 1,
    priceTiers: [],
    createdAt: "",
    updatedAt: "",
};
const target = { ...initialChannelModelValues(null, protocols), modelKey: "target-product", providerModelKey: "target-upstream", channelLabel: "目标渠道", enabled: false };

test("complete copying replaces configured targets and deeply clones all settings while retaining target identity", () => {
    const configured = structuredClone(source);
    configured.capabilityConfig = { version: 1, text: configured.capabilityConfig!.text };
    configured.capabilityConfig!.text!.references.maxImages = 4;
    configured.capabilityConfig!.text!.streaming = false;
    configured.capabilityConfig!.mediaTransport = { image: "base64" };
    const next = copyChannelModelConfiguration({ ...target, capability: "image", protocol: "image", capabilityConfig: defaultModelCapabilityConfig("image") }, configured, protocols);
    expect(next).toMatchObject({
        modelKey: target.modelKey,
        providerModelKey: target.providerModelKey,
        channelLabel: target.channelLabel,
        enabled: false,
        displayName: source.displayName,
        tags: source.tags,
        description: source.description,
        icon: source.icon,
        capability: "text",
        protocol: source.protocol,
        priceCurrency: "USD",
        capabilityConfig: { text: { streaming: false, references: { maxImages: 4 } }, mediaTransport: { image: "base64" } },
    });
    expect(next.priceTiers[0]).toMatchObject({ providerModelKey: "", billingMode: "token", inputTokenPrice: 1, outputTokenPrice: 2, cachedTokenPrice: 0.3, cacheWriteTokenPrice: 0.4 });
    next.tags[0].text = "变更";
    next.capabilityConfig!.text!.references.maxImages = 8;
    expect(configured.tags![0].text).toBe("推荐");
    expect(configured.capabilityConfig!.text!.references.maxImages).toBe(4);
    expect(next.capabilityConfig!.image).toBeUndefined();
});

test("complete copy preserves Token rules, costs, reference video billing and optionally independent SKU routes", () => {
    const video = {
        ...source,
        capability: "video" as const,
        protocol: "video",
        capabilityConfig: defaultModelCapabilityConfig("video"),
        referenceVideoBilling: true,
        priceTiers: [
            {
                id: "source-tier",
                channelModelId: source.id,
                selector: {},
                selectorKey: "{}",
                resolution: "*",
                videoSeconds: 0,
                providerModelKey: "independent-sku",
                billingMode: "token" as const,
                unitPriceMicrocredits: 0,
                inputTokenPriceMicrocredits: 0,
                outputTokenPriceMicrocredits: 6_000_000,
                cachedTokenPriceMicrocredits: 0,
                cacheWriteTokenPriceMicrocredits: 0,
                referenceVideoOutputTokenPriceMicrocredits: 9_000_000,
                costPricing: {
                    configured: true,
                    unitPriceMicrocredits: 0,
                    inputTokenPriceMicrocredits: 0,
                    outputTokenPriceMicrocredits: 2_000_000,
                    cachedTokenPriceMicrocredits: 0,
                    cacheWriteTokenPriceMicrocredits: 0,
                    referenceVideoOutputTokenPriceMicrocredits: 3_000_000,
                },
                priceConfigured: true,
                enabled: false,
                priceVersion: 3,
                createdAt: "",
                updatedAt: "",
            },
        ],
    };
    for (const copyRoutes of [false, true]) {
        const next = copyChannelModelConfiguration(target, video, protocols, copyRoutes);
        const payload = priceTierPayloadFromForm(next.capability, next.priceTiers[0], target.providerModelKey, next.capabilityConfig);
        expect(next.referenceVideoBilling).toBe(true);
        expect(payload).toMatchObject({
            providerModelKey: copyRoutes ? "independent-sku" : target.providerModelKey,
            outputTokenPriceMicrocredits: 6_000_000,
            referenceVideoOutputTokenPriceMicrocredits: 9_000_000,
            enabled: false,
            costPricing: { outputTokenPriceMicrocredits: 2_000_000, referenceVideoOutputTokenPriceMicrocredits: 3_000_000 },
        });
        expect(payload).not.toHaveProperty("id");
    }
    const text = {
        ...source,
        priceTiers: [
            {
                ...video.priceTiers[0],
                providerModelKey: "models/source-upstream",
                referenceVideoOutputTokenPriceMicrocredits: 0,
                tokenPriceRulesEnabled: true,
                tokenPriceRules: [
                    {
                        enabled: true,
                        weekdays: [1, 2],
                        start: "08:00",
                        end: "18:00",
                        minInputTokens: 10_000,
                        maxInputTokens: 40_000,
                        inputTokenPriceMicrocredits: 2_000_000,
                        outputTokenPriceMicrocredits: 4_000_000,
                        cachedTokenPriceMicrocredits: 500_000,
                        cacheWriteTokenPriceMicrocredits: 700_000,
                    },
                ],
            },
        ],
    };
    const next = copyChannelModelConfiguration(target, text, protocols, true);
    expect(next.priceTiers[0].providerModelKey).toBe("");
    const payload = priceTierPayloadFromForm("text", next.priceTiers[0], target.providerModelKey, next.capabilityConfig);
    expect(payload.tokenPriceRules).toEqual(text.priceTiers[0].tokenPriceRules);
    expect(payload.tokenPriceRulesEnabled).toBe(true);
});

test("complete copy refuses unavailable protocols and invalid source prices without changing the target", () => {
    expect(() => copyChannelModelConfiguration(target, { ...source, protocol: "missing" }, protocols)).toThrow("已启用");
    expect(() => copyChannelModelConfiguration(target, { ...source, unitPriceMicrocredits: -1, billingMode: "fixed_request" }, protocols)).toThrow("有效数值");
    expect(target.protocol).toBe("chat-completion");
});

const preset = { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1048576, output: 65536, vision: true, reasoning: true, maxImages: 7 };
test("explicit identification fills missing product IDs, capabilities and metadata but preserves prices and activation", () => {
    const values = { ...target, modelKey: "", providerModelKey: "models/Gemini_2.5_Flash-high", capability: "image" as const, protocol: "image" };
    const result = identifyChannelModelConfiguration(values, [], protocols, [preset]);
    expect(result.values).toMatchObject({
        modelKey: "Gemini_2.5_Flash-high",
        providerModelKey: values.providerModelKey,
        channelLabel: target.channelLabel,
        enabled: false,
        capability: "text",
        protocol: "chat-completion",
        icon: "Gemini",
        capabilityConfig: { text: { contextWindowTokens: preset.context, maxOutputTokens: preset.output, references: { maxImages: 7 } } },
    });
    expect(result.values.priceTiers).toEqual(values.priceTiers);
    expect(result.values.priceCurrency).toBe(values.priceCurrency);
    expect(result.source).toContain(preset.id);
});

test("upstream media declarations override local limits and ambiguous protocols require a selection", () => {
    const item = {
        id: "new-video",
        modelType: "video" as const,
        options: { durationSeconds: [{ value: "5" }, { value: "12" }], aspectRatio: [{ value: "9:16" }], resolution: [{ value: "1080p" }] },
        defaultParameters: { durationSeconds: "12", resolution: "1080p" },
        supportsImages: false,
    };
    const result = identifyChannelModelConfiguration({ ...target, providerModelKey: item.id }, [], protocols, [], [item]);
    expect(result.values.capabilityConfig?.video).toMatchObject({
        duration: { selection: "enum", values: [5, 12], default: 12 },
        ratios: ["9:16"],
        defaultRatio: "9:16",
        resolutions: ["1080p"],
        defaultResolution: "1080p",
        references: { maxImages: 0 },
        operations: ["text_to_video"],
    });
    expect(result.values.modelKey).toBe(target.modelKey);
    const moreProtocols = [...protocols, { ...protocols[2], value: "another-video" }];
    expect(() => identifyChannelModelConfiguration({ ...target, providerModelKey: item.id }, [], moreProtocols, [], [item])).toThrow("多个可用调用协议");
    expect(identifyChannelModelConfiguration({ ...target, protocol: "video", providerModelKey: item.id }, [], moreProtocols, [], [item]).values.protocol).toBe("video");
});

test("unknown models and conflicting aliases do not invent capabilities", () => {
    expect(() => identifyChannelModelConfiguration({ ...target, providerModelKey: "unlisted-model" }, [], protocols, [])).toThrow("未找到可靠");
    const alias = { ...source, providerModelKey: "same-model" };
    const conflicting = [alias, { ...alias, protocol: "image", capability: "image" as const }];
    expect(() => identifyChannelModelConfiguration({ ...target, protocol: undefined, providerModelKey: alias.providerModelKey }, conflicting, protocols, [])).toThrow("不同配置");
    expect(identifyChannelModelConfiguration({ ...target, providerModelKey: alias.providerModelKey }, conflicting, protocols, []).values.protocol).toBe(target.protocol);
});

test("model-specific workflows identify video capability and preserve the administrator's price table", () => {
    const protocol: ModelProtocolDefinition = {
        ...protocols[2],
        value: "workflow-video",
        workflows: [
            { id: "exact-workflow", label: "已声明视频工作流", providerId: "workflow-video", capability: "video", parameters: [{ name: "resolution", type: "string", mapping: "resolution", values: ["720p", "1080p"] }], defaults: { resolution: "1080p" } },
        ],
    };
    const result = identifyChannelModelConfiguration({ ...target, providerModelKey: "exact-workflow" }, [], [...protocols, protocol], []);
    expect(result.values).toMatchObject({ capability: "video", protocol: "workflow-video", modelKey: target.modelKey, capabilityConfig: { video: { resolutions: ["720p", "1080p"], defaultResolution: "1080p" } } });
    expect(result.values.priceTiers).toEqual(target.priceTiers);
    expect(result.source).toContain("协议工作流");
    const configured = defaultModelCapabilityConfig(protocol.value);
    configured.mediaTransport = { image: "base64" };
    configured.video!.references.maxImageBytes = 7_000_000;
    const recognized = identifyChannelModelConfiguration({ ...target, capability: "video", protocol: protocol.value, providerModelKey: "exact-workflow", capabilityConfig: configured }, [], [protocol], []);
    expect(recognized.values.capabilityConfig).toMatchObject({ mediaTransport: { image: "base64" }, video: { references: { maxImageBytes: 7_000_000 } } });
});
