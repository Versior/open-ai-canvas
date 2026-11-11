import type { TimelineRenderCreateRequest } from "@/services/api/timeline-tasks";
import type { TimelineClip } from "@/types/timeline";
import type { RemakeJob } from "./job";
import { remakeRenderSize } from "./timeline";

export type ComparisonAudio = "render" | "reference" | "mute";

/** 使用成片生成时冻结的原片映射，改配方后仍与正在导出的那条成片一致。 */
export function remakeComparison(job: RemakeJob, audio: ComparisonAudio): TimelineRenderCreateRequest["timeline"] {
    if (job.replication?.mode === "style") throw new Error("风格复刻使用独立时间线，不能导出逐帧同步原片对比");
    if (!job.source?.resourceId) throw new Error("这条作品没有原片，无法导出原片对比");
    if (!job.authorized) throw new Error("请在配方中确认原片使用授权，再导出对比");
    if (!job.render?.resourceId) throw new Error("请先拼成片，再导出对比视频");
    const source = job.source;
    const pieces = job.render.sourcePieces;
    if (!pieces?.length) throw new Error("这条成片没有原片对齐记录，请重新拼成片后导出对比");
    const durationMs = pieces.reduce((total, piece) => total + piece.durationMs, 0);
    if (!durationMs || (job.render.durationMs && Math.abs(durationMs - job.render.durationMs) > 40)) throw new Error("当前镜头与成片时长不一致，请重新拼成片");
    let cursor = 0;
    const clips: TimelineClip[] = pieces.map((piece, index) => {
        if (piece.durationMs <= 0 || piece.sourceStartMs < 0 || piece.sourceStartMs + piece.durationMs > source.durationMs + 40) throw new Error("原片对比范围超出视频时长");
        const clip: TimelineClip = {
            id: `reference-${index}`,
            nodeId: `reference-${index}`,
            trackId: "reference",
            kind: "video",
            startMs: cursor,
            durationMs: piece.durationMs,
            sourceStartMs: piece.sourceStartMs,
            directMedia: { id: source.resourceId, kind: "video", title: "原片", storageKey: `resource:${source.resourceId}` },
        };
        cursor += piece.durationMs;
        return clip;
    });
    const size = job.render.width && job.render.height ? { width: job.render.width, height: job.render.height } : remakeRenderSize(job);
    const scale = Math.min(1, 2048 / size.width, 2160 / size.height);
    const paneWidth = Math.max(16, Math.round((size.width * scale) / 2) * 2);
    const height = Math.max(16, Math.round((size.height * scale) / 2) * 2);
    return {
        version: 2,
        durationMs,
        width: paneWidth * 2,
        height,
        fit: "pad",
        tracks: [{ id: "render", kind: "video", label: "复刻", order: 0 }],
        clips: [{ id: "render", nodeId: "render", trackId: "render", kind: "video", startMs: 0, durationMs, sourceStartMs: 0, directMedia: { id: job.render.resourceId, kind: "video", title: "复刻成片", storageKey: `resource:${job.render.resourceId}` } }],
        comparison: { authorized: true, audio, clips },
    };
}
