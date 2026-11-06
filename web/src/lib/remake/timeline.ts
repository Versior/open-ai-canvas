import type { TimelineClip, TimelineProject } from "@/types/timeline";
import { remakeSpokenText, type RemakeJob, type RemakeUnit, type RemakeVoiceLine } from "./job";
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

/** 一句台词在成片里的位置：字幕、配音和剪映字幕轨共用。voice 是 AI 配音时这句已经生成好的配音。 */
export type RemakeLine = { shotIndex: number; text: string; startMs: number; endMs: number; voice?: RemakeVoiceLine };

/** 一句配音的签名：模型、音色、语速、语言或台词任何一项变了，旧配音就不能用了。 */
export function remakeVoiceSignature(job: Pick<RemakeJob, "voice" | "language">, text: string) {
    return [job.voice.model, job.voice.voice, job.voice.speed, job.language, text].join("|");
}

/** AI 配音要生成的句子：每个有新口播的镜头一句。 */
export function remakeVoicePlan(job: Pick<RemakeJob, "audio" | "shots" | "voice" | "language">) {
    if (job.audio !== "voice") return [];
    return job.shots.flatMap((shot) => {
        const text = remakeSpokenText(job, shot);
        return text ? [{ shotIndex: shot.index, text, signature: remakeVoiceSignature(job, text) }] : [];
    });
}

/** 已经生成好、签名也对得上的那句配音。 */
export function remakeVoiceLineFor(job: Pick<RemakeJob, "voiceLines" | "voice" | "language">, shotIndex: number, text: string) {
    const signature = remakeVoiceSignature(job, text);
    return job.voiceLines.find((line) => line.shotIndex === shotIndex && line.signature === signature && line.status === "succeeded" && line.resourceId);
}

/**
 * 每句台词在成片里的起止：从这一镜在成片里的开头算起，AI 配音按配音实际时长（没有时按镜头时长），
 * 其余按镜头时长；不超过下一句的开头和成片结尾。删掉的镜头没有台词。
 */
export function remakeLines(job: Pick<RemakeJob, "shots" | "units" | "audio" | "voiceLines" | "voice" | "language">): RemakeLine[] {
    const pieces = remakePieces(job);
    const total = pieces[pieces.length - 1]?.endMs || 0;
    const lines = job.shots.flatMap((shot): RemakeLine[] => {
        const text = remakeSpokenText(job, shot);
        const startMs = text ? remakeOutputTime(pieces, shot.startMs) : undefined;
        if (!text || startMs === undefined) return [];
        const voice = job.audio === "voice" ? remakeVoiceLineFor(job, shot.index, text) : undefined;
        return [{ shotIndex: shot.index, text, startMs, endMs: startMs + (voice?.durationMs || shot.endMs - shot.startMs), ...(voice ? { voice } : {}) }];
    });
    lines.sort((a, b) => a.startMs - b.startMs);
    return lines.map((line, index) => ({ ...line, endMs: Math.min(line.endMs, lines[index + 1]?.startMs ?? total, total) })).filter((line) => line.endMs > line.startMs);
}

/** 烧录字幕图的签名：画幅和全部字幕文字（时间变了不用重画，只是挪位置）。 */
export function remakeSubtitleSignature(lines: readonly Pick<RemakeLine, "shotIndex" | "text">[], size: { width: number; height: number }) {
    return [`${size.width}x${size.height}`, ...lines.map((line) => `${line.shotIndex}:${line.text}`)].join("\n");
}

/** 时间线快照里的片段：叠加图（烧录字幕）和循环的背景音乐是后端渲染认的两个扩展字段。 */
export type RemakeTimelineClip = TimelineClip & { overlay?: boolean; loop?: boolean };
export type RemakeRenderTimeline = Omit<TimelineProject, "clips"> & { clips: RemakeTimelineClip[]; width: number; height: number; fit: "auto" };

/** 背景音乐结尾淡出的时长。 */
export const REMAKE_MUSIC_FADE_MS = 1500;

/**
 * 交给时间线渲染（和剪映草稿导出）的快照。生成的画面放在「生成」轨：改写口播时带着模型生成的声音，其余情况静音；
 * 保留原片的画面放在静音的「原片」轨。保留原声时，把原片对应的几段声音铺回去；AI 配音时每句配音放在「配音」轨。
 * 背景音乐铺满成片、结尾淡出。台词同时写成字幕片段（渲染结果附 SRT，剪映里是字幕轨）；勾了烧录字幕时，
 * 再把画好的字幕图作为叠加图片放在「烧录字幕」轨。
 */
export function remakeTimeline(job: RemakeJob, size: { width: number; height: number }): RemakeRenderTimeline {
    const pieces = remakePieces(job);
    if (!pieces.length) throw new Error("没有要拼进成片的镜头");
    const units = new Map(job.units.map((unit) => [unit.key, unit]));
    const clips: RemakeTimelineClip[] = pieces.map((piece, index) => {
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
                title: "原片",
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
            title: "生成片段",
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
                title: "原声",
                directMedia: { id: job.source.resourceId, kind: "audio", title: "原声", storageKey: `resource:${job.source.resourceId}` },
            }),
        );
    }
    const durationMs = pieces[pieces.length - 1].endMs;
    const lines = remakeLines(job);
    if (job.audio === "voice") {
        const missing = lines.filter((line) => !line.voice?.resourceId);
        if (missing.length) throw new Error(`还有 ${missing.length} 句配音没有生成好`);
        lines.forEach((line, index) =>
            clips.push({
                id: `voice-${index}`,
                kind: "audio",
                nodeId: `voice-${index}`,
                trackId: "voice",
                startMs: line.startMs,
                durationMs: line.endMs - line.startMs,
                sourceStartMs: 0,
                title: `配音-镜头${line.shotIndex}`,
                directMedia: { id: line.voice!.resourceId!, kind: "audio", title: "配音", storageKey: `resource:${line.voice!.resourceId}` },
            }),
        );
    }
    if (job.music) {
        clips.push({
            id: "music",
            kind: "audio",
            nodeId: "music",
            trackId: "music",
            startMs: 0,
            durationMs,
            sourceStartMs: 0,
            volume: job.music.volume,
            loop: true,
            fadeOutMs: Math.min(REMAKE_MUSIC_FADE_MS, Math.floor(durationMs / 2)),
            title: "背景音乐",
            directMedia: { id: job.music.resourceId, kind: "audio", title: job.music.name || "背景音乐", storageKey: `resource:${job.music.resourceId}` },
        });
    }
    lines.forEach((line, index) => clips.push({ id: `line-${index}`, kind: "subtitle", nodeId: `line-${index}`, trackId: "subtitle", startMs: line.startMs, durationMs: line.endMs - line.startMs, text: line.text }));
    if (job.subtitles.burn && lines.length) {
        const images = job.subtitleImages?.signature === remakeSubtitleSignature(lines, size) ? new Map(job.subtitleImages.items.map((item) => [item.shotIndex, item.resourceId])) : undefined;
        if (!images) throw new Error("字幕图还没有画好");
        lines.forEach((line, index) => {
            const resourceId = images.get(line.shotIndex);
            if (!resourceId) throw new Error("字幕图还没有画好");
            clips.push({
                id: `burn-${index}`,
                kind: "image",
                nodeId: `burn-${index}`,
                trackId: "burn",
                startMs: line.startMs,
                durationMs: line.endMs - line.startMs,
                overlay: true,
                directMedia: { id: resourceId, kind: "image", title: "字幕", storageKey: `resource:${resourceId}` },
            });
        });
    }
    return {
        version: 2,
        tracks: [
            { id: "gen", kind: "video", label: "生成", order: 0, muted: job.audio !== "rewrite" },
            { id: "keep", kind: "video", label: "原片", order: 1, muted: true },
            { id: "audio", kind: "audio", label: "原声", order: 2 },
            { id: "voice", kind: "audio", label: "配音", order: 3 },
            { id: "music", kind: "audio", label: "背景音乐", order: 4 },
            { id: "subtitle", kind: "subtitle", label: "字幕", order: 5 },
            { id: "burn", kind: "image", label: "烧录字幕", order: 6 },
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

/** 字幕文件：台词按在成片里的位置排（改写口播、AI 配音是新口播，保留原声是原口播）。 */
export function remakeSubtitleSRT(job: Pick<RemakeJob, "shots" | "units" | "audio" | "voiceLines" | "voice" | "language">) {
    return remakeLines(job)
        .map((line, index) => `${index + 1}\n${srtTime(line.startMs)} --> ${srtTime(line.endMs)}\n${line.text}\n`)
        .join("\n");
}

// ---------- 烧录字幕的排版（画图在页面里做，这里只算怎么断行） ----------

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0e00-\u0e7f\uff00-\uffef\u3000-\u303f]/;

/** 断成能放下的几行：中日韩泰按字断，其余按词断；单个词比一行还长时按字断。 */
export function remakeWrapText(text: string, maxWidth: number, measure: (value: string) => number) {
    const tokens = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0e00-\u0e7f\uff00-\uffef\u3000-\u303f]|\s+|[^\s\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0e00-\u0e7f\uff00-\uffef\u3000-\u303f]+/g) || [];
    const lines: string[] = [];
    let current = "";
    const push = () => {
        if (current.trim()) lines.push(current.trim());
        current = "";
    };
    for (const token of tokens) {
        if (/^\s+$/.test(token)) {
            if (current) current += " ";
            continue;
        }
        if (measure(current + token) <= maxWidth) {
            current += token;
            continue;
        }
        if (current.trim()) push();
        if (measure(token) <= maxWidth || CJK.test(token)) {
            current = token;
            continue;
        }
        for (const char of Array.from(token)) {
            if (measure(current + char) > maxWidth && current) push();
            current += char;
        }
    }
    push();
    return lines;
}

export type RemakeSubtitleLayout = { fontSize: number; lineHeight: number; lines: string[]; centerX: number; bottomY: number; strokeWidth: number };

/**
 * 字幕版式：白字黑描边，居中，底边在画面 80% 高处（避开平台底部的按钮区），字号取短边的 5.5%。
 * 超过 2 行时缩小字号重排一次，还放不下就截成 2 行加省略号。
 */
export function remakeSubtitleLayout(text: string, size: { width: number; height: number }, measure: (value: string, fontSize: number) => number): RemakeSubtitleLayout {
    const base = Math.max(16, Math.round(Math.min(size.width, size.height) * 0.055));
    const maxWidth = size.width * 0.84;
    let fontSize = base;
    let lines = remakeWrapText(text, maxWidth, (value) => measure(value, fontSize));
    if (lines.length > 2) {
        fontSize = Math.round(base * 0.82);
        lines = remakeWrapText(text, maxWidth, (value) => measure(value, fontSize));
    }
    if (lines.length > 2) {
        let last = lines[1];
        while (last && measure(`${last}…`, fontSize) > maxWidth) last = Array.from(last).slice(0, -1).join("");
        lines = [lines[0], `${last}…`];
    }
    return { fontSize, lineHeight: Math.round(fontSize * 1.3), lines, centerX: size.width / 2, bottomY: Math.round(size.height * 0.8), strokeWidth: Math.max(2, Math.round(fontSize * 0.14)) };
}
