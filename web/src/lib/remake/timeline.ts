import type { TimelineClip, TimelineProject } from "@/types/timeline";
import type { RemakeJob, RemakeUnit } from "./job";
import { remakeUnitTake } from "./units";

// 成片拼接：按原片顺序把保留的镜头排起来，删掉的镜头跳过，所以成片比原片短多少就是删掉了多少。
// 生成单元的候选按它在参考片段里的位置裁出对应的那一段；保留原片的镜头直接用原视频。

/** 成片里的一小段：在成片里的位置 [startMs, endMs)，对应原片里从 sourceStartMs 开始的同样长度。 */
export type RemakePiece = { kind: "unit" | "keep"; unitKey?: string; startMs: number; endMs: number; sourceStartMs: number };

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

/** 成片的分段表：先按原片时间排出每一段，再累计出在成片里的位置。 */
export function remakePieces(job: Pick<RemakeJob, "shots" | "units">): RemakePiece[] {
    const raw: { kind: "unit" | "keep"; unit?: RemakeUnit; sourceStartMs: number; sourceEndMs: number }[] = [];
    for (const shot of job.shots) {
        if (shot.treatment === "skip") continue;
        if (shot.treatment === "keep") {
            const last = raw[raw.length - 1];
            if (last?.kind === "keep" && last.sourceEndMs === shot.startMs) last.sourceEndMs = shot.endMs;
            else raw.push({ kind: "keep", sourceStartMs: shot.startMs, sourceEndMs: shot.endMs });
            continue;
        }
        for (const unit of job.units) {
            if (!unit.shotIndexes.includes(shot.index) || !overlap(unit.startMs, unit.endMs, shot.startMs, shot.endMs)) continue;
            const start = Math.max(unit.startMs, shot.startMs);
            const end = Math.min(unit.endMs, shot.endMs);
            const last = raw[raw.length - 1];
            if (last?.unit?.key === unit.key && last.sourceEndMs === start) last.sourceEndMs = end;
            else raw.push({ kind: "unit", unit, sourceStartMs: start, sourceEndMs: end });
        }
    }
    let cursor = 0;
    return raw.map((item) => {
        const length = item.sourceEndMs - item.sourceStartMs;
        const piece: RemakePiece = { kind: item.kind, ...(item.unit ? { unitKey: item.unit.key } : {}), startMs: cursor, endMs: cursor + length, sourceStartMs: item.sourceStartMs };
        cursor += length;
        return piece;
    });
}

/** 成片里某个时间点对应原片的时间（对比播放时让原片跟上）。 */
export function remakeSourceTime(pieces: readonly RemakePiece[], timeMs: number) {
    const piece = pieces.find((item) => timeMs >= item.startMs && timeMs < item.endMs) || pieces[pieces.length - 1];
    return piece ? piece.sourceStartMs + Math.min(Math.max(timeMs - piece.startMs, 0), piece.endMs - piece.startMs) : 0;
}

/** 原片某个时间点在成片里的位置；这一刻被删掉了时返回 undefined。 */
export function remakeOutputTime(pieces: readonly RemakePiece[], sourceMs: number) {
    const piece = pieces.find((item) => sourceMs >= item.sourceStartMs && sourceMs < item.sourceStartMs + (item.endMs - item.startMs));
    return piece ? piece.startMs + (sourceMs - piece.sourceStartMs) : undefined;
}

export type RemakeRenderTimeline = TimelineProject & { width: number; height: number; fit: "auto" };

/**
 * 交给时间线渲染的快照。生成的画面放在「生成」轨：改写口播时带着模型生成的声音，其余情况静音；
 * 保留原片的画面放在静音的「原片」轨。保留原声时，把原片对应的几段声音铺回去。
 */
export function remakeTimeline(job: RemakeJob, size: { width: number; height: number }): RemakeRenderTimeline {
    const pieces = remakePieces(job);
    if (!pieces.length) throw new Error("没有要拼进成片的镜头");
    const units = new Map(job.units.map((unit) => [unit.key, unit]));
    const clips: TimelineClip[] = pieces.map((piece, index) => {
        const length = piece.endMs - piece.startMs;
        if (piece.kind === "keep") {
            return {
                id: `keep-${index}`,
                kind: "video",
                nodeId: `keep-${index}`,
                trackId: "keep",
                startMs: piece.startMs,
                durationMs: length,
                sourceStartMs: piece.sourceStartMs,
                directMedia: { id: job.source.resourceId, kind: "video", title: "原片", storageKey: `resource:${job.source.resourceId}` },
            };
        }
        const unit = units.get(piece.unitKey || "");
        const take = unit ? remakeUnitTake(unit) : undefined;
        if (!unit || !take) throw new Error("还有镜头没有生成好");
        const origin = unit.treatment === "replace" ? unit.clipStartMs : unit.startMs;
        return {
            id: `unit-${index}`,
            kind: "video",
            nodeId: `unit-${index}`,
            trackId: "gen",
            startMs: piece.startMs,
            durationMs: length,
            sourceStartMs: Math.max(0, piece.sourceStartMs - origin),
            ...(take.durationMs ? { sourceDurationMs: take.durationMs } : {}),
            directMedia: { id: take.resourceId, kind: "video", title: "生成片段", storageKey: `resource:${take.resourceId}` },
        };
    });
    if (job.audio === "original" && job.source.hasAudio) {
        let run: { startMs: number; endMs: number; sourceStartMs: number } | null = null;
        const runs: { startMs: number; endMs: number; sourceStartMs: number }[] = [];
        for (const piece of pieces) {
            if (run && run.sourceStartMs + (run.endMs - run.startMs) === piece.sourceStartMs) run.endMs = piece.endMs;
            else {
                if (run) runs.push(run);
                run = { startMs: piece.startMs, endMs: piece.endMs, sourceStartMs: piece.sourceStartMs };
            }
        }
        if (run) runs.push(run);
        runs.forEach((item, index) =>
            clips.push({
                id: `audio-${index}`,
                kind: "audio",
                nodeId: `audio-${index}`,
                trackId: "audio",
                startMs: item.startMs,
                durationMs: item.endMs - item.startMs,
                sourceStartMs: item.sourceStartMs,
                directMedia: { id: job.source.resourceId, kind: "audio", title: "原声", storageKey: `resource:${job.source.resourceId}` },
            }),
        );
    }
    const durationMs = pieces[pieces.length - 1].endMs;
    return {
        version: 2,
        tracks: [
            { id: "gen", kind: "video", label: "生成", order: 0, muted: job.audio !== "rewrite" },
            { id: "keep", kind: "video", label: "原片", order: 1, muted: true },
            { id: "audio", kind: "audio", label: "原声", order: 2 },
        ],
        clips,
        durationMs,
        width: Math.max(16, Math.round(size.width / 2) * 2),
        height: Math.max(16, Math.round(size.height / 2) * 2),
        fit: "auto",
    };
}

/** 成片画幅：取第一条候选的尺寸，没有时用原片尺寸（短边不超过 1080）。 */
export function remakeRenderSize(job: Pick<RemakeJob, "units" | "source">) {
    for (const unit of job.units) {
        const take = remakeUnitTake(unit);
        if (take?.width && take.height) return { width: take.width, height: take.height };
    }
    const { width, height } = job.source;
    const scale = Math.min(1, 1080 / Math.max(1, Math.min(width || 720, height || 1280)));
    return { width: Math.round((width || 720) * scale), height: Math.round((height || 1280) * scale) };
}

function srtTime(ms: number) {
    const total = Math.max(0, Math.round(ms));
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)},${pad(total % 1000, 3)}`;
}

/** 新口播的字幕文件：按镜头在成片里的位置排。改写口播时才有。 */
export function remakeSubtitleSRT(job: Pick<RemakeJob, "shots" | "units" | "audio">) {
    if (job.audio !== "rewrite") return "";
    const pieces = remakePieces(job);
    const entries: string[] = [];
    for (const shot of job.shots) {
        const text = shot.dialogue.trim();
        if (shot.treatment === "skip" || !text) continue;
        const start = remakeOutputTime(pieces, shot.startMs);
        if (start === undefined) continue;
        const end = start + (shot.endMs - shot.startMs);
        entries.push(`${entries.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`);
    }
    return entries.join("\n");
}
