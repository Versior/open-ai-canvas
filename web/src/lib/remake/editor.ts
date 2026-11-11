import type { TimelineProject } from "@/types/timeline";
import type { RemakeJob } from "./job";
import { remakeRenderSize, remakeTimeline } from "./timeline";
import { remakeUnitTake } from "./units";

export type RemakeStep = "recipe" | "produce" | "edit";

/** 保存时间不影响成片；镜头、音轨、字幕、LUT、画幅和烧录开关共同决定导出版本。 */
export function remakeEditRenderSignature(project: TimelineProject, size: { width: number; height: number }, burnSubtitles: boolean) {
    return JSON.stringify({ ...project, updatedAt: undefined, ...size, burnSubtitles });
}

export function remakeDefaultStep(job?: RemakeJob): RemakeStep {
    return job && (job.units.length || job.render?.resourceId || job.status !== "draft") ? "produce" : "recipe";
}

/** 一次性建剪辑草稿：后续始终读已保存草稿，不随配方或候选变化重新构建。 */
export function createRemakeEditTimeline(job: RemakeJob): TimelineProject {
    const size = remakeRenderSize(job);
    const timeline = remakeTimeline({ ...job, subtitles: { burn: false } }, size, true);
    const sources = new Map<string, { durationMs?: number; width?: number; height?: number }>(job.source ? [[job.source.resourceId, job.source]] : []);
    for (const unit of job.units) {
        const take = remakeUnitTake(unit);
        if (take) sources.set(take.resourceId, take);
    }
    const used = new Set(timeline.clips.map((clip) => clip.trackId));
    const assigned = new Set<string>();
    const ids = new Map<string, string>();
    const tracks = timeline.tracks
        .filter((track) => used.has(track.id))
        .map((track) => {
            const id = !assigned.has(track.kind) ? `${track.kind}-1` : track.id;
            assigned.add(track.kind);
            ids.set(track.id, id);
            return { ...track, id };
        });
    return {
        ...timeline,
        tracks,
        clips: timeline.clips.map((clip) => {
            const source = clip.directMedia && sources.get(clip.directMedia.id);
            const next = { ...clip, trackId: ids.get(clip.trackId) || clip.trackId };
            return source ? { ...next, sourceDurationMs: source.durationMs, directMedia: { ...clip.directMedia!, durationMs: source.durationMs, width: source.width, height: source.height } } : next;
        }),
    };
}
