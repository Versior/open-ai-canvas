import { modelCapabilityConfigFor, normalizeVideoValue } from "@/lib/model-capabilities";
import { resolveModelVideoBooleanOptions, type ModelRequirements } from "@/lib/model-selection";
import { productVideoModelLimits } from "@/lib/product-video/media";
import type { ProductVideoAudio } from "@/lib/product-video/job";
import type { AiConfig } from "@/stores/use-config-store";

export type ProductVideoRequestSettings = { model: string; ratio: string; resolution: string; seconds: number; audio: ProductVideoAudio };

export function productVideoLimitsFor(config: AiConfig, model: string) {
    return productVideoModelLimits(model ? modelCapabilityConfigFor(config, model).video : undefined);
}

/** 一段的生成配置：画幅、清晰度和时长按模型能力归一；只有选了「模型配音」且模型支持时才让模型出声音。 */
export function productVideoGenerationConfig(config: AiConfig, settings: ProductVideoRequestSettings): AiConfig {
    const profile = modelCapabilityConfigFor(config, settings.model).video!;
    const normalized = normalizeVideoValue(profile, { ratio: settings.ratio, seconds: String(settings.seconds), resolution: settings.resolution });
    const booleans = resolveModelVideoBooleanOptions(config, settings.model, {}, { videoGenerateAudio: config.videoGenerateAudio, videoWatermark: config.videoWatermark });
    return {
        ...config,
        model: settings.model,
        videoModel: settings.model,
        size: normalized.ratio,
        videoSeconds: normalized.seconds,
        vquality: normalized.resolution.replace(/p$/i, ""),
        videoWatermark: booleans.videoWatermark,
        videoGenerateAudio: settings.audio === "model" && profile.generateAudio.supported ? "true" : "false",
        taskWorkflowProvider: "model",
    };
}

/** 报价与模型兼容检查用的需求：几张参考图、一段参考视频、这一段的时长。 */
export function productVideoRequirements(generation: AiConfig, imageCount: number): ModelRequirements {
    return {
        capability: "video",
        input: { textCount: 1, imageCount, referenceImageCount: imageCount, videoCount: 1, audioCount: 0, characterCount: 0 },
        videoSeconds: generation.videoSeconds,
        options: { size: generation.size, vquality: generation.vquality, videoGenerateAudio: generation.videoGenerateAudio === "true" },
    };
}
