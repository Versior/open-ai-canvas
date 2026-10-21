import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { defaultImageParamsForModel, modelCompatibilityError, modelRequestOptions, type ModelInputSummary } from "@/lib/model-selection";
import { imagePresetValue, imageSizePresets } from "@/lib/image-size-presets";
import { imageParameterRequest } from "@/lib/image-parameters";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { EcommerceWorkbenchBrief } from "./ecommerce-capabilities";

export type EcommerceImageSettings = Partial<Pick<AiConfig, "size" | "quality" | "imageResolution" | "imageParameters" | "transparentBackground">>;

/** Resolve public ratio intent using the model's exact presets, never invented pixels. */
export function ecommerceImageSettings(config: AiConfig, model: string, brief: EcommerceWorkbenchBrief) {
    const profile = modelCapabilityConfigFor(config, model).image!;
    const settings = { ...defaultImageParamsForModel(config, model), ...brief.imageSettings };
    const requested = brief.imageSettings?.size || brief.aspectRatio;
    if (requested) {
        let size = requested;
        if (profile.size.parameter === "aspect_ratio" && !profile.size.values.includes(size)) {
            const preset = imageSizePresets(profile).find((preset) => preset.size === size && (!profile.resolution.supported || preset.tier === settings.imageResolution));
            if (preset && profile.size.values.includes(preset.ratio)) size = preset.ratio;
        }
        if (profile.size.parameter === "size" && requested.includes(":")) {
            const presets = imageSizePresets(profile);
            const tier = profile.resolution.supported ? settings.imageResolution : profile.size.defaultTier || presets.find((preset) => preset.size === profile.size.default)?.tier;
            const preset = presets.find((preset) => preset.ratio === requested && (!tier || preset.tier === tier));
            if (!preset) throw new Error(`当前图片模型未配置 ${requested} 的尺寸预设，请在整组生图设置中选择支持的尺寸`);
            size = imagePresetValue(profile, preset);
        }
        if (profile.size.parameter === "none" || (!profile.size.allowCustom && !profile.size.values.includes(size))) throw new Error(`当前图片模型不支持 ${requested}，请在整组生图设置中重新选择尺寸`);
        settings.size = size;
    }
    for (const [key, option] of [["quality", profile.quality], ["imageResolution", profile.resolution]] as const) {
        const value = brief.imageSettings?.[key];
        if (value && value !== "auto" && (!option.supported || (option.values.length > 0 && !option.values.includes(value)))) throw new Error(`当前图片模型不支持${key === "quality" ? "质量" : "分辨率"} ${value}，请重新选择`);
    }
    imageParameterRequest(profile, settings, true);
    return settings;
}

export function buildEcommerceImageGeneration(config: AiConfig, target: CanvasNodeData, brief: EcommerceWorkbenchBrief, input: ModelInputSummary) {
    const model = target.metadata?.model || config.imageModel || config.model;
    const settings = ecommerceImageSettings(config, model, brief);
    const metadata = { ...target.metadata, ...settings, model, count: 1 };
    const hasSize = modelCapabilityConfigFor(config, model).image!.size.parameter !== "none";
    const requirements = { capability: "image" as const, input, ...(hasSize ? { imageSize: settings.size } : {}) };
    const generation = buildGenerationConfig(config, { ...target, metadata }, "image", requirements);
    const error = modelCompatibilityError(generation, generation.model, { ...requirements, ...(hasSize ? { imageSize: generation.size } : {}), options: modelRequestOptions(generation, "image") });
    if (error) throw new Error(error);
    return { config: generation, metadata: { ...metadata, size: generation.size, quality: generation.quality, imageResolution: generation.imageResolution, imageParameters: generation.imageParameters } };
}
