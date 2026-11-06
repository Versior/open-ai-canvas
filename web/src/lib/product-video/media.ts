import { videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { TimelineClip, TimelineProject } from "@/types/timeline";
import { PRODUCT_VIDEO_RANGE_MS, type ProductVideoJob, type ProductVideoSegment } from "./job";

// 模型能力换算与成片拼接：每段的生成时长、一段最长能参考多少秒、预估分段，以及交给时间线渲染的快照。

/** 后端切段接受的每段时长范围（秒）。 */
export const PRODUCT_VIDEO_SEGMENT_SECONDS = { min: 8, max: 30 } as const;

export type ProductVideoModelLimits = {
    maxImages: number;
    /** 一段参考视频的最长秒数：模型的参考视频时长上限和生成时长上限取小。 */
    maxSegmentSeconds: number;
    /** 模型可选的生成时长（秒），空数组表示模型不接受时长参数。 */
    durations: number[];
    generateAudio: boolean;
};

/** 模型能不能做元素替换：要能参考视频，一段至少能参考 8 秒。不能时返回原因。 */
export function productVideoModelLimits(profile: VideoCapabilityConfig | undefined): ProductVideoModelLimits | string {
    if (!profile || profile.processing) return "不是视频生成模型";
    const references = profile.references;
    if (references.maxVideos < 1) return "不支持参考视频";
    if (references.maxImages < 1) return "不支持参考图";
    const durations = profile.durationSupported === false ? [] : videoDurationOptions(profile).filter((value) => value > 0);
    const videoLimit = references.maxVideoDurationSeconds > 0 ? references.maxVideoDurationSeconds : 15;
    const durationLimit = durations.length ? Math.max(...durations) : videoLimit;
    const maxSegmentSeconds = Math.min(videoLimit, durationLimit, PRODUCT_VIDEO_SEGMENT_SECONDS.max);
    if (maxSegmentSeconds < PRODUCT_VIDEO_SEGMENT_SECONDS.min) return `一次只能参考 ${maxSegmentSeconds} 秒视频`;
    return { maxImages: references.maxImages, maxSegmentSeconds: Math.floor(maxSegmentSeconds), durations, generateAudio: profile.generateAudio.supported };
}

/** 一段的生成时长：取模型可选时长里不短于这一段的最小值，没有时取最长；成片拼接时再裁到原长。 */
export function productVideoShotSeconds(durationMs: number, durations: readonly number[]) {
    const needed = Math.max(1, Math.ceil(durationMs / 1000 - 0.05));
    if (!durations.length) return needed;
    const sorted = [...durations].sort((a, b) => a - b);
    return sorted.find((value) => value >= needed) ?? sorted[sorted.length - 1];
}

/** 还没切段时按选段长度估计分段（均分），用于报价和难度提示；切好后以实际片段为准。 */
export function plannedProductVideoSegments(rangeMs: number, maxSegmentSeconds: number) {
    const length = Math.min(Math.max(rangeMs, 0), PRODUCT_VIDEO_RANGE_MS.max);
    if (length <= 0) return [];
    const parts = Math.max(1, Math.ceil(length / (maxSegmentSeconds * 1000)));
    return Array.from({ length: parts }, (_, index) => Math.round((length * (index + 1)) / parts) - Math.round((length * index) / parts));
}

/** 按参考视频的宽高比挑一个模型支持的画幅：有 adaptive 就跟随参考视频，否则选最接近的比例。 */
export function productVideoDefaultRatio(ratios: readonly string[], width?: number, height?: number, fallback = "") {
    if (ratios.includes("adaptive")) return "adaptive";
    if (!width || !height) return fallback || ratios[0] || "";
    const target = width / height;
    let best = "";
    let bestDistance = Infinity;
    for (const ratio of ratios) {
        const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
        if (!match) continue;
        const distance = Math.abs(Math.log(Number(match[1]) / Number(match[2]) / target));
        if (distance < bestDistance) {
            best = ratio;
            bestDistance = distance;
        }
    }
    return best || fallback || ratios[0] || "";
}

export type ProductVideoRenderTimeline = TimelineProject & { width: number; height: number; fit: "auto" };

/**
 * 成片的时间线快照：生成好的各段按原视频顺序首尾相接，每段裁到参考片段的原长（生成得短时用最后一帧补齐），
 * 所以成片时长跟随参考视频。保留原声时画面轨静音，再把原视频这一段的声音铺满整条；不要声音时只静音。
 */
export function productVideoTimeline(job: Pick<ProductVideoJob, "audio" | "reference" | "shots" | "split">, size: { width: number; height: number }): ProductVideoRenderTimeline {
    const segments = job.split?.segments || [];
    if (!segments.length) throw new Error("还没有切好的参考片段");
    const shots = new Map(job.shots.map((shot) => [shot.index, shot]));
    const first = segments[0];
    const clips: TimelineClip[] = segments.map((segment: ProductVideoSegment) => {
        const shot = shots.get(segment.index);
        if (!shot?.resourceId) throw new Error(`第 ${segment.index} 段还没有生成好`);
        return {
            id: `shot-${segment.index}`,
            kind: "video",
            nodeId: `shot-${segment.index}`,
            trackId: "video",
            startMs: segment.startMs - first.startMs,
            durationMs: segment.durationMs,
            sourceStartMs: 0,
            ...(shot.durationMs ? { sourceDurationMs: shot.durationMs } : {}),
            directMedia: { id: shot.resourceId, kind: "video", title: `第 ${segment.index} 段`, storageKey: `resource:${shot.resourceId}` },
        };
    });
    const last = segments[segments.length - 1];
    const durationMs = last.endMs - first.startMs;
    const original = job.audio === "original" && job.split?.hasAudio !== false && job.reference;
    if (original && job.reference) {
        clips.push({
            id: "original-audio",
            kind: "audio",
            nodeId: "original-audio",
            trackId: "audio",
            startMs: 0,
            durationMs,
            sourceStartMs: first.startMs,
            directMedia: { id: job.reference.resourceId, kind: "audio", title: "原视频的声音", storageKey: `resource:${job.reference.resourceId}` },
        });
    }
    return {
        version: 2,
        tracks: [
            { id: "video", kind: "video", label: "画面", order: 0, muted: job.audio !== "model" },
            { id: "audio", kind: "audio", label: "原声", order: 1 },
        ],
        clips,
        durationMs,
        width: Math.max(16, Math.round(size.width / 2) * 2),
        height: Math.max(16, Math.round(size.height / 2) * 2),
        fit: "auto",
    };
}

/** 成片画幅：取第一段生成结果的尺寸，没有时用参考片段的尺寸。 */
export function productVideoRenderSize(job: Pick<ProductVideoJob, "shots" | "split">) {
    const shot = job.shots.find((item) => item.width && item.height);
    if (shot?.width && shot.height) return { width: shot.width, height: shot.height };
    const segment = job.split?.segments?.[0];
    return { width: segment?.width || 720, height: segment?.height || 1280 };
}

export function formatProductVideoSeconds(ms: number) {
    const seconds = Math.max(0, ms) / 1000;
    return seconds >= 10 ? `${Math.round(seconds)} 秒` : `${seconds.toFixed(1).replace(/\.0$/, "")} 秒`;
}
