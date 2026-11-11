import { modelCapabilityConfigFor, videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { ProductVideoModelLimits } from "@/lib/product-video/media";
import type { AiConfig } from "@/stores/use-config-store";
import type { RemakeJob } from "@/lib/remake/job";

export type RemakeModelLimits = ProductVideoModelLimits & { maxAudios: number; maxAudioDurationSeconds: number };

/** 换元素需要参考视频；全部重拍只要求参考图片，不沿用旧元素替换的八秒门槛。 */
export function remakeModelLimits(profile: VideoCapabilityConfig | undefined, referenceVideo: boolean): RemakeModelLimits | string {
    if (!profile || profile.processing) return "不是视频生成模型";
    if (profile.references.maxImages < 1) return "不支持参考图";
    if (referenceVideo && profile.references.maxVideos < 1) return "换元素需要支持参考视频的模型，或把镜头做法改为重拍";
    const durations = profile.durationSupported === false ? [] : videoDurationOptions(profile).filter((value) => value > 0);
    const durationLimit = durations.length ? Math.max(...durations) : profile.duration.default;
    const videoLimit = referenceVideo && profile.references.maxVideoDurationSeconds > 0 ? profile.references.maxVideoDurationSeconds : durationLimit;
    const maxSegmentSeconds = Math.min(durationLimit, videoLimit, 30);
    if (maxSegmentSeconds < 4) return `单段最多 ${maxSegmentSeconds} 秒，复刻需要至少四秒`;
    return { maxImages: profile.references.maxImages, durations, generateAudio: profile.generateAudio.supported, maxSegmentSeconds, maxAudios: profile.references.maxAudios, maxAudioDurationSeconds: profile.references.maxAudioDurationSeconds };
}

export function remakeLimitsFor(config: AiConfig, model: string, shots: RemakeJob["shots"]) {
    return remakeModelLimits(
        model ? modelCapabilityConfigFor(config, model).video : undefined,
        shots.some((shot) => shot.treatment === "replace"),
    );
}
