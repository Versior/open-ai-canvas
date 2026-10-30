import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { FormInstance } from "antd";
import { defaultModelCapabilityConfig, normalizeLegacyImageResolutionConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { imagePresetForRatio, imageSizePresets } from "@/lib/image-size-presets";
import { modelProtocolSupportsTokenBilling, type ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ChannelModel } from "@/services/api/wallet";
import type { ModelTag } from "@/lib/model-tags";
import { initializeImageRatioDefaults, resolveImageParameters } from "@/lib/image-parameters";
import { findProtocolWorkflow, resolveWorkflowVideoScreenSpec } from "@/lib/video-screen-specs";
import { defaultPriceTier, legacyPriceTierToForm, normalizeUpstreamModelKey, priceTierToForm, type PriceTierFormValues } from "./channel-model-price-tier-form";
import { applyModelMetadataPreset, matchingModelPresets, modelFamilyIdentity, modelMatchScore, presetApplicationError, type ModelMetadataPreset } from "@/lib/model-metadata-presets";
import type { PriceCurrency } from "@/services/api/user-groups";

export type ChannelModelFormValues = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    channelLabel?: string;
    tags: ModelTag[];
    description?: string;
    icon?: string;
    capability: ModelCapabilityChoice;
    protocol?: string;
    priceTiers: PriceTierFormValues[];
    /** 售价单位；成本价始终以积分计。 */
    priceCurrency: PriceCurrency;
    enabled: boolean;
    capabilityConfig?: ModelCapabilityConfig;
};

export type EditorSection = "identity" | "capabilities" | "pricing";

export function copyChannelModelPrices(values: ChannelModelFormValues, source: ChannelModel): ChannelModelFormValues {
    if (source.capability !== values.capability) throw new Error("请选择相同能力的模型复制价格");
    const tiers = source.priceTiers?.length ? source.priceTiers.map((tier) => priceTierToForm(tier, source.capabilityConfig?.image, source.protocol)) : [legacyPriceTierToForm(source)];
    if (source.protocol !== values.protocol && tiers.some((tier) => tier.matchMode === "advanced")) throw new Error("规格价格需要相同调用协议，请选择同协议模型，或手动配置规格条件");
    const next = { ...values, priceCurrency: source.priceCurrency || "credits", priceTiers: tiers.map((tier) => ({ ...structuredClone(tier), providerModelKey: "" })) };
    validateChannelModelPrices(next);
    return next;
}

export function autoConfigureChannelModel(values: ChannelModelFormValues, models: ChannelModel[], protocols: ModelProtocolDefinition[], presets: ModelMetadataPreset[], protectedFields = new Set<string>()) {
    const id = values.providerModelKey?.trim() || values.modelKey.trim();
    const ranked = models.filter((model) => model.protocol && model.capability && protocols.some((p) => p.value === model.protocol && p.capability === model.capability && p.enabled !== false))
        .map((model) => ({ model, score: Math.max(modelMatchScore(id, model.providerModelKey || model.modelKey, true), modelMatchScore(id, model.modelKey, true)) }));
    const score = Math.max(0, ...ranked.map((item) => item.score));
    const candidates = ranked.filter((item) => score > 0 && item.score === score);
    const template = candidates.length === 1 ? candidates[0].model : undefined;
    let next = { ...values };
    const blank = initialChannelModelValues(null, protocols);
    if (protectedFields.has("capability")) blank.capability = values.capability;
    if (protectedFields.has("protocol")) blank.protocol = values.protocol;
    else blank.protocol = protocols.find((p) => p.capability === blank.capability && p.enabled !== false)?.value;
    blank.capabilityConfig = blank.capability === "audio" ? undefined : defaultModelCapabilityConfig(blank.protocol, id);
    blank.priceTiers = blank.priceTiers.map((tier) => ({ ...tier, priceConfigured: false }));
    for (const key of ["displayName", "capability", "protocol", "capabilityConfig", "icon", "priceTiers"] as const) {
        if (!protectedFields.has(key)) Object.assign(next, { [key]: structuredClone(blank[key]) });
    }
    if (!protectedFields.has("priceTiers") && !protectedFields.has("priceCurrency")) next.priceCurrency = blank.priceCurrency;
    const sources: string[] = [];
    if (template && (!protectedFields.has("capability") || values.capability === template.capability) && (!protectedFields.has("protocol") || values.protocol === template.protocol)) {
        const defaults = initialChannelModelValues(template, protocols);
        for (const key of ["capability", "protocol", "capabilityConfig", "icon"] as const) {
            if (key === "capabilityConfig" && score === 1) {
                if (!protectedFields.has(key)) next.capabilityConfig = template.capability === "audio" ? undefined : defaultModelCapabilityConfig(defaults.protocol, id);
                continue;
            }
            if (!protectedFields.has(key)) Object.assign(next, { [key]: structuredClone(defaults[key]) });
        }
        if (!protectedFields.has("priceTiers") && (!protectedFields.has("priceCurrency") || values.priceCurrency === defaults.priceCurrency) && (!protectedFields.has("protocol") || values.protocol === template.protocol) && (template.priceConfigured || template.priceTiers?.some((tier) => tier.priceConfigured))) {
            next.priceTiers = defaults.priceTiers.map((tier) => ({ ...tier, providerModelKey: "" }));
            next.priceCurrency = defaults.priceCurrency;
            sources.push(`接口和价格参考 ${template.providerModelKey || template.modelKey}`);
        } else sources.push(`接口参考 ${template.providerModelKey || template.modelKey}`);
    }
    const preset = matchingModelPresets(presets, id)[0];
    const identity = modelFamilyIdentity(id);
    if (!protectedFields.has("displayName")) next.displayName = template?.displayName?.trim() && template.displayName !== "未分类" ? template.displayName : identity?.category || "未分类";
    if (!protectedFields.has("icon")) next.icon = template?.icon?.trim() || identity?.icon || "";
    if (identity) sources.push(`分类与 Logo 匹配 ${identity.category}`);
    if (preset && !presetApplicationError(preset, next.capability)) {
        const applied = applyModelMetadataPreset(next, preset);
        if (!protectedFields.has("capabilityConfig")) next.capabilityConfig = applied.capabilityConfig;
        if (!protectedFields.has("icon")) next.icon = applied.icon;
        sources.push(`参数匹配 ${preset.id}`);
    }
    return { values: next, source: sources.join("；") };
}

export function replaceChannelModelFormValues(form: Pick<FormInstance<ChannelModelFormValues>, "setFieldsValue" | "setFieldValue">, values: ChannelModelFormValues) {
    const { capabilityConfig, ...fields } = values;
    form.setFieldsValue(fields);
    // 整体替换协议配置，避免 setFieldsValue 深合并后残留旧协议字段。
    form.setFieldValue("capabilityConfig", capabilityConfig);
}

export function editorSectionForField(name: (string | number)[]): EditorSection {
    return name[0] === "priceTiers" ? "pricing" : name[0] === "capabilityConfig" ? "capabilities" : "identity";
}

export function initialChannelModelValues(item: ChannelModel | null, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = item?.capability || "text";
    const protocol = item ? item.protocol : protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const upstreamModel = item?.providerModelKey || item?.modelKey || "";
    const rawCapabilityConfig = item?.capabilityConfig || defaultModelCapabilityConfig(protocol, upstreamModel);
    let capabilityConfig =
        capability === "audio"
            ? undefined
            : (() => {
                  const normalized = normalizeModelCapabilityConfig(rawCapabilityConfig);
                  return normalized.image ? { ...normalized, image: normalizeLegacyImageResolutionConfig(protocol, normalized.image) } : normalized;
              })();
    const definitions = protocols.find((p) => p.value === protocol)?.imageParameters;
    if (capabilityConfig?.image && capability === "image" && definitions) capabilityConfig = { ...capabilityConfig, image: resolveImageParameters(capabilityConfig.image, definitions, upstreamModel) };
    return {
        modelKey: item?.modelKey || "",
        providerModelKey: upstreamModel,
        displayName: item?.displayName || "未分类",
        channelLabel: item?.channelLabel || upstreamModel,
        tags: item?.tags?.map((tag) => ({ ...tag })) || [],
        description: item?.description || "",
        icon: item?.icon || "",
        capability,
        protocol,
        priceTiers: item ? (item.priceTiers?.length ? item.priceTiers.map((tier) => priceTierToForm(tier, capabilityConfig?.image, protocol)) : [legacyPriceTierToForm(item)]) : [defaultPriceTier()],
        priceCurrency: item?.priceCurrency || "credits",
        enabled: item?.enabled ?? true,
        capabilityConfig,
    };
}

export function duplicateChannelModelValues(item: ChannelModel, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const values = initialChannelModelValues(item, protocols);
    const sourceUpstream = normalizeUpstreamModelKey(item.providerModelKey || item.modelKey);
    return {
        ...values,
        modelKey: "",
        providerModelKey: "",
        priceTiers: values.priceTiers.map((tier) => (normalizeUpstreamModelKey(tier.providerModelKey) === sourceUpstream ? { ...tier, providerModelKey: "" } : tier)),
    };
}

// Clear incompatible selectors, but never silently convert prices or billing units.
export function changeChannelModelCapability(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = values.capability;
    const protocol = protocols.find((p) => p.value === values.protocol && p.capability === capability && p.enabled !== false)?.value || protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const capabilityConfig = capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    if (capabilityConfig?.image && protocols.find((p) => p.value === protocol)?.imageParameters) {
        capabilityConfig.image.parameters = [];
        if (!capabilityConfig.image.resolution.supported || !protocols.find((p) => p.value === protocol)?.imageParameters?.some((p) => p.name === "size" && p.encoding === "pixels" && !p.values?.length)) capabilityConfig.image.size.presets = undefined;
    }
    return updateChannelModelUpstreamCapabilities(
        {
            ...values,
            protocol,
            capabilityConfig,
            priceTiers: values.priceTiers.map((tier) => ({
                ...tier,
                operation: "*",
                imageSelector: {},
                imageResolution: "*",
                quality: "*",
                size: "*",
                resolution: "*",
                videoSeconds: 0,
                videoGenerateAudio: "*",
                imageCount: 0,
            })),
        },
        protocols,
    );
}

export function changeChannelModelProtocol(values: ChannelModelFormValues, protocol: string, protocols: ModelProtocolDefinition[] = []): ChannelModelFormValues {
    const capabilityConfig = values.capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    if (capabilityConfig?.image && protocols.find((p) => p.value === protocol)?.imageParameters) {
        capabilityConfig.image.parameters = [];
        if (!capabilityConfig.image.resolution.supported || !protocols.find((p) => p.value === protocol)?.imageParameters?.some((p) => p.name === "size" && p.encoding === "pixels" && !p.values?.length)) capabilityConfig.image.size.presets = undefined;
    }
    const next: ChannelModelFormValues = {
        ...values,
        protocol,
        capabilityConfig,
        priceTiers: values.capability === "image" ? values.priceTiers.map((tier) => ({ ...tier, imageResolution: "*", quality: "*", imageSelector: {} })) : values.priceTiers,
    };
    return updateChannelModelUpstreamCapabilities(next, protocols);
}

export function updateChannelModelUpstreamCapabilities(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[] = []): ChannelModelFormValues {
    const workflows = protocols.find((p) => p.value === values.protocol)?.workflows;
    if (values.capability === "video" && workflows?.length) {
        // 工作流协议的画面规格必须写回表单；只在界面上投影会让保存提交旧协议的分辨率。
        const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
        const workflow = findProtocolWorkflow(workflows, values.protocol, values.providerModelKey?.trim() || values.modelKey.trim());
        if (!profile.video || !workflow) return values;
        const video = resolveWorkflowVideoScreenSpec(profile.video, workflow);
        if (JSON.stringify(video) === JSON.stringify(profile.video)) return values;
        return { ...values, capabilityConfig: { ...profile, video } };
    }
    const definitions = protocols.find((p) => p.value === values.protocol)?.imageParameters;
    if (values.capability === "image" && definitions) {
        const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
        if (profile.image) {
            const fresh = profile.image.parameters?.length === 0;
            const resolved = resolveImageParameters(profile.image, definitions, values.providerModelKey?.trim() || values.modelKey.trim());
            return { ...values, capabilityConfig: { ...profile, image: fresh ? initializeImageRatioDefaults(resolved, resolved.parameters!) : resolved } };
        }
    }
    if (values.capability !== "image" || values.protocol !== "cangyuan-midjourney-v82") return values;
    const defaults = defaultModelCapabilityConfig(values.protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    const image = values.capabilityConfig?.image;
    if (!image) return { ...values, capabilityConfig: defaults };
    if (image.size.parameter !== "aspect_ratio") return values;
    const tier = defaults.image!.size.presets![0].tier;
    const presets = imageSizePresets(image);
    if (presets.length && presets.every((preset) => preset.tier === tier)) return values;
    const ratios = Array.from(new Set(presets.map((preset) => preset.ratio)));
    return {
        ...values,
        capabilityConfig: {
            ...values.capabilityConfig!,
            image: { ...image, size: { ...image.size, presets: ratios.length ? ratios.map((ratio) => imagePresetForRatio(tier, ratio)) : defaults.image!.size.presets } },
        },
    };
}

export function validateChannelModelProtocol(capability: string, protocol: string | undefined, protocols: ModelProtocolDefinition[]) {
    if (!protocols.some((p) => p.value === protocol && p.capability === capability && p.enabled !== false)) {
        throw new Error("请选择当前能力下已启用的请求协议");
    }
}

export function validateChannelModelPrices(values: Pick<ChannelModelFormValues, "capability" | "protocol" | "priceTiers" | "capabilityConfig">) {
    const { capability, protocol, priceTiers } = values;
    if (!priceTiers?.length) throw new Error("请至少配置一个价格档");
    if (priceTiers.filter((tier) => tier.matchMode === "default").length > 1) throw new Error("只能配置一个所有规格统一价格");
    const operations: Record<string, string[]> = {
        text: ["text_generation"],
        image: ["text_to_image", "image_to_image"],
        video: ["text_to_video", "image_to_video", "video_to_video"],
        audio: [],
    };
    priceTiers.forEach((tier, index) => {
        const fail = (text: string) => {
            throw new Error(`价格档 ${index + 1}：${text}`);
        };
        if (!["fixed_request", "per_second", "token"].includes(tier.billingMode)) fail("请选择计费方式");
        if (tier.billingMode === "per_second" && capability !== "video" && capability !== "audio") fail("按秒计费仅支持视频或音频，请重新选择计费方式并核对价格");
        if (tier.billingMode === "token" && !modelProtocolSupportsTokenBilling(capability, protocol)) fail("当前模型能力不支持 Token 计费，请重新选择计费方式并核对价格");
        if (tier.matchMode === "advanced") {
            if (tier.operation && tier.operation !== "*" && !operations[capability]?.includes(tier.operation)) fail("生成方式与模型能力不匹配");
            const specific = (value: string | undefined) => Boolean(value && value !== "*");
            const image = values.capabilityConfig?.image;
            const imageCondition =
                Object.values(tier.imageSelector || {}).some(specific) ||
                (image?.resolution.supported !== false && specific(tier.imageResolution)) ||
                (image?.quality.supported !== false && specific(tier.quality)) ||
                specific(tier.resolution) ||
                specific(tier.size);
            if (!(specific(tier.operation) || (capability === "image" && imageCondition) || (capability === "video" && specific(tier.resolution)))) fail("规格价格至少需要一个匹配条件；统一价格请选择默认价格");
        }
        const prices = tier.billingMode !== "token" ? [tier.unitPrice] : capability === "video" ? [tier.outputTokenPrice] : [tier.inputTokenPrice, tier.outputTokenPrice, tier.cachedTokenPrice];
        if (prices.some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)) fail("积分价格必须是 0 到 1000000 之间的有效数值");
        if (tier.costConfigured) {
            const costs = tier.billingMode !== "token" ? [tier.costUnitPrice] : capability === "video" ? [tier.costOutputTokenPrice] : [tier.costInputTokenPrice, tier.costOutputTokenPrice, tier.costCachedTokenPrice];
            if (costs.some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 1_000_000)) fail("积分成本价必须是 0 到 1000000 之间的有效数值");
        }
    });
}
