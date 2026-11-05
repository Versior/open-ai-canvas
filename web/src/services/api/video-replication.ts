import { createClientId } from "@/lib/client-id";
import type { VideoReplicationAnalysisDocument } from "@/lib/canvas/video-teardown";
import { http } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";

/** 一镜开头是怎么来的：start 第一镜，cut 检测到的切点，split 长镜头按时长切开（画面连续）。 */
export type VideoTeardownBoundary = "start" | "cut" | "split";

export type VideoTeardownShot = {
    index: number;
    startMs: number;
    endMs: number;
    boundary: VideoTeardownBoundary;
    keyframeTimeMs: number;
    keyframeResourceId: string;
    keyframeWidth: number;
    keyframeHeight: number;
};

/** 一张宫格放几个镜头：一行一个镜头，三列依次是开头、中间、结尾。 */
export type VideoTeardownGrid = {
    resourceId: string;
    shotIndexes: number[];
    width: number;
    height: number;
};

export type VideoTeardownTranscriptSegment = { startMs: number; endMs: number; text: string };

/** 后端拆解准备任务的结果：切点和时间码是程序算出来的确定值，语义由前端调用的看图模型补全。 */
export type VideoTeardownBundle = {
    version: 1;
    source: { resourceId: string; durationMs: number; width: number; height: number; hasAudio: boolean };
    shots: VideoTeardownShot[];
    grids: VideoTeardownGrid[];
    /** source 为 none 表示没有语音转写，口播改从画面字幕读；note 是没有转写的原因。 */
    transcript: { source: "asr" | "none"; language?: string; segments: VideoTeardownTranscriptSegment[]; note?: string };
    /** 口播原因以外的拆解提示。 */
    warnings: string[];
};

export type CreateVideoTeardownInput = {
    resourceId: string;
    projectId?: string;
    transcribe: boolean;
    language?: string;
    maxShots?: number;
};

// 校验拆解结果用的硬上限，等于后台时长上限能设的最大值；实际能拆多长以 getVideoReplicationConfig 为准。
const MAX_DURATION_MS = 180_000;
const MAX_DIMENSION = 16_384;
const BOUNDARIES = new Set<VideoTeardownBoundary>(["start", "cut", "split"]);

export function createVideoTeardown(input: CreateVideoTeardownInput, signal?: AbortSignal) {
    const body = {
        resourceId: input.resourceId,
        transcribe: input.transcribe,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.maxShots ? { maxShots: input.maxShots } : {}),
    };
    return http.post<GenerationTask>("/video-replication/teardowns", body, { signal, headers: { "X-Idempotency-Key": createClientId() } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integerIn(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function resourceId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim();
}

/** 严格校验拆解结果：时间码、镜头编号和资源 ID 都要自洽，不合法就报错，不拿默认值补。 */
export function parseVideoTeardownBundle(task: GenerationTask): VideoTeardownBundle {
    let value: unknown;
    try {
        value = JSON.parse(task.resultJson || "");
    } catch {
        throw new Error("拆解结果无效");
    }
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.source) || !Array.isArray(value.shots) || !Array.isArray(value.grids) || !isRecord(value.transcript) || !Array.isArray(value.warnings)) {
        throw new Error("拆解结果无效");
    }
    const source = value.source;
    if (!resourceId(source.resourceId) || !integerIn(source.durationMs, 1, MAX_DURATION_MS) || !integerIn(source.width, 1, MAX_DIMENSION) || !integerIn(source.height, 1, MAX_DIMENSION) || typeof source.hasAudio !== "boolean") {
        throw new Error("拆解结果里的视频信息无效");
    }
    const durationMs = source.durationMs;
    const shots = value.shots.map((shot, index): VideoTeardownShot => {
        if (
            !isRecord(shot) ||
            shot.index !== index + 1 ||
            !integerIn(shot.startMs, 0, durationMs) ||
            !integerIn(shot.endMs, 1, durationMs) ||
            (shot.startMs as number) >= (shot.endMs as number) ||
            typeof shot.boundary !== "string" ||
            !BOUNDARIES.has(shot.boundary as VideoTeardownBoundary) ||
            !integerIn(shot.keyframeTimeMs, shot.startMs as number, shot.endMs as number) ||
            !resourceId(shot.keyframeResourceId) ||
            !integerIn(shot.keyframeWidth, 1, MAX_DIMENSION) ||
            !integerIn(shot.keyframeHeight, 1, MAX_DIMENSION)
        ) {
            throw new Error(`拆解结果里第 ${index + 1} 个镜头无效`);
        }
        return shot as VideoTeardownShot;
    });
    if (!shots.length) throw new Error("拆解结果里没有镜头");
    const covered = new Set<number>();
    const grids = value.grids.map((grid, index): VideoTeardownGrid => {
        if (!isRecord(grid) || !resourceId(grid.resourceId) || !Array.isArray(grid.shotIndexes) || !grid.shotIndexes.length || !integerIn(grid.width, 1, MAX_DIMENSION) || !integerIn(grid.height, 1, MAX_DIMENSION)) {
            throw new Error(`拆解结果里第 ${index + 1} 张宫格无效`);
        }
        for (const shotIndex of grid.shotIndexes) {
            if (!integerIn(shotIndex, 1, shots.length) || covered.has(shotIndex)) throw new Error(`拆解结果里第 ${index + 1} 张宫格的镜头编号无效`);
            covered.add(shotIndex);
        }
        return grid as VideoTeardownGrid;
    });
    if (covered.size !== shots.length) throw new Error("拆解结果的宫格没有覆盖全部镜头");
    const transcript = value.transcript;
    if (
        (transcript.source !== "asr" && transcript.source !== "none") ||
        !Array.isArray(transcript.segments) ||
        (transcript.language !== undefined && typeof transcript.language !== "string") ||
        (transcript.note !== undefined && typeof transcript.note !== "string")
    ) {
        throw new Error("拆解结果里的口播转写无效");
    }
    const segments = transcript.segments.map((segment): VideoTeardownTranscriptSegment => {
        if (!isRecord(segment) || !integerIn(segment.startMs, 0, Number.MAX_SAFE_INTEGER) || !integerIn(segment.endMs, 0, Number.MAX_SAFE_INTEGER) || typeof segment.text !== "string") {
            throw new Error("拆解结果里的口播转写无效");
        }
        return { startMs: segment.startMs, endMs: segment.endMs, text: segment.text };
    });
    if (!value.warnings.every((warning) => typeof warning === "string")) throw new Error("拆解结果无效");
    const { note, warnings } = transcriptNoteAndWarnings(transcript.source, typeof transcript.note === "string" ? transcript.note.trim() : "", value.warnings as string[]);
    return {
        version: 1,
        source: { resourceId: source.resourceId, durationMs, width: source.width, height: source.height, hasAudio: source.hasAudio },
        shots,
        grids,
        transcript: { source: transcript.source, ...(transcript.language ? { language: transcript.language } : {}), segments, ...(note ? { note } : {}) },
        warnings,
    };
}

const LEGACY_TRANSCRIPT_SUFFIXES = ["，口播改从画面字幕识别", "，改从画面字幕识别", "，没有识别口播"];

/**
 * 没有转写的原因短句和其余提示分开。早期的拆解结果没有 transcript.note，原因写在 warnings 里
 * （那时 warnings 只会有这一条，句尾带着「口播改从画面字幕识别」）；这里拆回原因短句，和后端 transcriptNoteAndWarnings 同一规则。
 */
function transcriptNoteAndWarnings(source: "asr" | "none", note: string, warnings: string[]) {
    if (note || source !== "none" || !warnings.length) return { note, warnings };
    const suffix = LEGACY_TRANSCRIPT_SUFFIXES.find((item) => warnings[0].endsWith(item));
    const legacy = suffix ? warnings[0].slice(0, -suffix.length) : warnings[0];
    // 早期的「未配置转写服务（配置项名）」改成和现在一样的说法，不把服务器配置项名露出去。
    return { note: legacy.startsWith("未配置转写服务") ? "服务器没有配置转写服务" : legacy, warnings: warnings.slice(1) };
}

/** 视频复刻页面的历史记录：id 是拆解任务 ID；保存过分析的带标题、模型和分析时间。 */
export type VideoReplicationRecord = {
    id: string;
    status: GenerationTask["status"];
    stage: string;
    progress: number;
    error?: string;
    createdAt: string;
    durationMs: number;
    shotCount: number;
    coverResourceId?: string;
    /** 均匀取自全片的几张关键帧，卡片上排成胶片条。 */
    previewResourceIds?: string[];
    width?: number;
    height?: number;
    title?: string;
    model?: string;
    analyzedAt?: string;
};

/** 一条记录的全部内容：拆解任务（resultJson 是镜头事实）和保存过的分析原文，分析由调用方再校验。 */
export type VideoReplicationDetail = { task: GenerationTask; analysis?: unknown; analyzedAt?: string };

export function listVideoReplications(signal?: AbortSignal) {
    return http.get<VideoReplicationRecord[]>("/video-replication/teardowns", { signal });
}

export function getVideoReplication(id: string, signal?: AbortSignal) {
    return http.get<VideoReplicationDetail>(`/video-replication/teardowns/${encodeURIComponent(id)}`, { signal });
}

export function saveVideoReplicationAnalysis(id: string, analysis: VideoReplicationAnalysisDocument, signal?: AbortSignal) {
    return http.put<VideoReplicationDetail>(`/video-replication/teardowns/${encodeURIComponent(id)}/analysis`, analysis, { signal });
}

/** 后台设置的拆解限制，以及这台服务器现在能不能识别口播；不能时 transcribeNote 写原因。 */
export type VideoReplicationConfig = { maxDurationSeconds: number; maxShots: number; transcribeAvailable: boolean; transcribeNote?: string };

export function getVideoReplicationConfig(signal?: AbortSignal) {
    return http.get<VideoReplicationConfig>("/video-replication/config", { signal });
}
