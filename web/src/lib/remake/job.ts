import type { VideoTeardownAnalysis, VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
import type { ProductVideoImage } from "@/lib/product-video/job";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { recommendRemakeShot } from "./recommend";

// 复刻工作台的作品（version 2）：一条拆解过的爆款视频 + 我的商品、模特、场景和口播配方，
// 逐镜头决定怎么复刻（换元素、重新拍、保留原片、删掉），再按生成单元出片、拼成成片。
// 和元素替换的旧作品（没有 version）存在同一个列表里（/ecommerce/product-videos），
// 素材、片段、候选和成片都以 resourceId / keyframeResourceId 引用，孤儿清理据此保留它们。

export const REMAKE_VERSION = 2;

/** 每镜做法：换元素（沿用原镜头的动作和运镜）、重新拍（按这一镜的作用重新生成）、保留原片、删掉。 */
export type RemakeTreatment = "replace" | "remake" | "keep" | "skip";
export const REMAKE_TREATMENTS: RemakeTreatment[] = ["replace", "remake", "keep", "skip"];
export const REMAKE_TREATMENT_LABEL: Record<RemakeTreatment, string> = { replace: "换元素", remake: "重新拍", keep: "保留原片", skip: "删掉" };
export const REMAKE_TREATMENT_HINT: Record<RemakeTreatment, string> = {
    replace: "保留这一镜的动作和运镜，把商品、人物或场景换成你的",
    remake: "按这一镜的作用重新生成画面，不用原片画面",
    keep: "直接用原片这一段（要有使用授权）",
    skip: "成片里不要这一镜",
};

/** 风险标签：生成前提醒用户，并影响推荐做法。 */
export type RemakeRisk = "product" | "face" | "speech" | "brand" | "text";
export const REMAKE_RISK_LABEL: Record<RemakeRisk, string> = { product: "有原商品", face: "真人露脸", speech: "有人说话", brand: "他人品牌", text: "画面文字" };

/** 口播：按原节奏改写成我的卖点、保留原声（要授权）、不要人声。 */
export type RemakeAudio = "rewrite" | "original" | "mute";
export const REMAKE_AUDIO_LABEL: Record<RemakeAudio, string> = { rewrite: "改写口播", original: "保留原声", mute: "不要人声" };

/** 人物：换成模特图、保留原人物（要授权）、不出人。 */
export type RemakePeople = "model" | "original" | "none";

export type RemakeShot = {
    index: number;
    startMs: number;
    endMs: number;
    keyframeResourceId: string;
    /** 原片这一镜在讲什么（来自 AI 解读），给重新拍和改写口播用。 */
    plot: string;
    motion: string;
    camera: string;
    shotSize: string;
    originalDialogue: string;
    onScreenText: string;
    risks: RemakeRisk[];
    /** 原片这一镜有人露脸说话：改写口播时让视频模型同时生成口型和声音。 */
    speaker: boolean;
    recommended: RemakeTreatment;
    treatment: RemakeTreatment;
    /** 新口播（改写后的台词），空表示这一镜不说话。 */
    dialogue: string;
};

export type RemakeTake = { taskId: string; resourceId: string; durationMs?: number; width?: number; height?: number; createdAt: string };

export type RemakeUnitStatus = "pending" | "running" | "succeeded" | "failed";

/**
 * 生成单元：相邻、做法相同的镜头合成一次生成（总长不超过模型的上限），避免 1 秒的短镜头单独花 4 秒的钱。
 * 换元素单元的参考片段是 [clipStartMs, clipEndMs)：太短时向两边补到 4 秒，成片只用 [startMs, endMs) 那部分。
 */
export type RemakeUnit = {
    key: string;
    treatment: "replace" | "remake";
    shotIndexes: number[];
    startMs: number;
    endMs: number;
    clipStartMs: number;
    clipEndMs: number;
    clipResourceId?: string;
    status: RemakeUnitStatus;
    attempt: number;
    taskId?: string;
    error?: string;
    fix?: string;
    takes: RemakeTake[];
    /** 选中的候选下标；生成好新候选时自动选中最新的一条。 */
    chosen: number;
};

export type RemakeStatus = "draft" | "clipping" | "generating" | "assembling" | "succeeded" | "failed";
export const REMAKE_STATUS_LABEL: Record<RemakeStatus, string> = { draft: "配方中", clipping: "切参考片段", generating: "生成中", assembling: "拼接成片", succeeded: "已完成", failed: "未完成" };
export const REMAKE_ACTIVE: readonly RemakeStatus[] = ["clipping", "generating", "assembling"];

export type RemakeSource = { teardownId: string; resourceId: string; name: string; durationMs: number; width: number; height: number; hasAudio: boolean };

export type RemakeProduct = { studioProductId?: string; name: string; sellingPoints: string; images: ProductVideoImage[] };

export type RemakeJob = {
    version: 2;
    id: string;
    revision: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    status: RemakeStatus;
    error?: string;
    source: RemakeSource;
    /** 原片在卖什么、开头怎么抓人：改写口播时给模型参考。 */
    sourceSummary: { product: string; hook: string; genre: string };
    product: RemakeProduct;
    people: RemakePeople;
    models: ProductVideoImage[];
    backgrounds: ProductVideoImage[];
    audio: RemakeAudio;
    /** 用户确认对原片有使用授权：保留原片画面、原人物或原声时必须勾选。 */
    authorized: boolean;
    note: string;
    model: string;
    ratio: string;
    resolution: string;
    shots: RemakeShot[];
    units: RemakeUnit[];
    /** 换元素单元参考片段的切段任务；key 是幂等键，先记下再提交。 */
    clips?: { key: string; taskId?: string; signature: string };
    render?: { taskId?: string; resourceId?: string; durationMs?: number; width?: number; height?: number };
    credits?: number;
};

export function isRemakeJob(value: unknown): value is RemakeJob {
    return Boolean(value) && typeof value === "object" && (value as { version?: unknown }).version === REMAKE_VERSION;
}

// ---------- 从拆解记录建作品 ----------

function rowRisks(row: VideoTeardownAnalysisRow | undefined): { risks: RemakeRisk[]; speaker: boolean } {
    if (!row) return { risks: [], speaker: false };
    const risks: RemakeRisk[] = [];
    const hasProduct = row.productRole ? row.productRole !== "none" : Boolean(row.product.trim());
    if (hasProduct) risks.push("product");
    const people = row.people.trim().toLowerCase();
    if (people === "speaker" || people === "presenter") risks.push("face");
    const speaker = people === "speaker" || (!people && Boolean(row.dialogue.trim()) && row.dialogueSource === "asr");
    if (row.dialogue.trim()) risks.push("speech");
    if (row.brandText.trim()) risks.push("brand");
    if (row.onScreenText.trim()) risks.push("text");
    return { risks, speaker };
}

export function remakeShotsFromTeardown(bundle: VideoTeardownBundle, analysis: Pick<VideoTeardownAnalysis, "rows"> | null): RemakeShot[] {
    const rows = new Map((analysis?.rows || []).map((row) => [row.shotNumber, row]));
    return bundle.shots.map((shot) => {
        const row = rows.get(shot.index);
        const { risks, speaker } = rowRisks(row);
        const recommended = recommendRemakeShot({ risks, durationMs: shot.endMs - shot.startMs, analyzed: Boolean(row) });
        return {
            index: shot.index,
            startMs: shot.startMs,
            endMs: shot.endMs,
            keyframeResourceId: shot.keyframeResourceId,
            plot: row?.plotDescription || "",
            motion: row?.videoMotionPrompt || row?.motion || "",
            camera: row?.camera || "",
            shotSize: row?.shotSize || "",
            originalDialogue: row?.dialogue || "",
            onScreenText: row?.onScreenText || "",
            risks,
            speaker,
            recommended,
            treatment: recommended,
            dialogue: "",
        };
    });
}

export function createRemakeJob(id: string, input: { teardownId: string; bundle: VideoTeardownBundle; analysis: (Pick<VideoTeardownAnalysis, "rows" | "title" | "summary"> & { model?: string }) | null; sourceName: string }, now = new Date()): RemakeJob {
    const time = now.toISOString();
    const { source } = input.bundle;
    const title = input.analysis?.title?.trim() || input.sourceName.trim() || "爆款复刻";
    return {
        version: REMAKE_VERSION,
        id,
        revision: 0,
        title: `复刻 · ${title}`.slice(0, 60),
        createdAt: time,
        updatedAt: time,
        status: "draft",
        source: { teardownId: input.teardownId, resourceId: source.resourceId, name: input.sourceName || title, durationMs: source.durationMs, width: source.width, height: source.height, hasAudio: source.hasAudio },
        sourceSummary: { product: input.analysis?.summary?.product || "", hook: input.analysis?.summary?.hook || "", genre: input.analysis?.summary?.genre || "" },
        product: { name: "", sellingPoints: "", images: [] },
        people: "model",
        models: [],
        backgrounds: [],
        audio: source.hasAudio ? "rewrite" : "mute",
        authorized: false,
        note: "",
        model: "",
        ratio: "",
        resolution: "",
        shots: remakeShotsFromTeardown(input.bundle, input.analysis),
        units: [],
    };
}

/** 生成前的检查：返回第一条要用户处理的问题。 */
export function remakeJobError(job: RemakeJob, limits?: { maxImages: number; generateAudio: boolean }) {
    const active = job.shots.filter((shot) => shot.treatment !== "skip");
    if (!active.length) return "至少保留一个镜头";
    const generated = active.filter((shot) => shot.treatment === "replace" || shot.treatment === "remake");
    if (generated.length && !job.product.images.length && !job.models.length && !job.backgrounds.length) return "请先放上你的商品图（或模特图、背景图），告诉模型要换成什么";
    if (!job.authorized && (active.some((shot) => shot.treatment === "keep") || job.audio === "original" || job.people === "original")) return "保留原片画面、原人物或原声，需要先确认你有使用授权";
    if (generated.length && !job.model) return "请选择视频模型";
    if (limits && job.product.images.length + job.models.length + job.backgrounds.length > limits.maxImages) return `所选模型一次最多参考 ${limits.maxImages} 张图，请减少素材或换一个模型`;
    if (job.audio === "rewrite" && generated.some((shot) => shot.dialogue.trim()) && limits && !limits.generateAudio) return "所选模型不能生成声音，换一个能出声的模型，或把口播改成「不要人声」";
    return "";
}

export function remakeKeptDurationMs(job: Pick<RemakeJob, "shots">) {
    return job.shots.filter((shot) => shot.treatment !== "skip").reduce((sum, shot) => sum + (shot.endMs - shot.startMs), 0);
}

// ---------- 服务端数据的防御性解析 ----------

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : undefined);
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const count = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
const positive = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T) => (values.includes(value as T) ? (value as T) : fallback);
const RISKS: RemakeRisk[] = ["product", "face", "speech", "brand", "text"];
const STATUSES: RemakeStatus[] = ["draft", "clipping", "generating", "assembling", "succeeded", "failed"];

function images(value: unknown, limit: number): ProductVideoImage[] {
    return (Array.isArray(value) ? value : [])
        .flatMap((item): ProductVideoImage[] => {
            const raw = record(item);
            const resourceId = text(raw?.resourceId);
            return raw && resourceId ? [{ id: text(raw.id, resourceId), resourceId, name: text(raw.name), width: positive(raw.width), height: positive(raw.height) }] : [];
        })
        .slice(0, limit);
}

function shot(value: unknown): RemakeShot | undefined {
    const raw = record(value);
    if (!raw) return undefined;
    const recommended = oneOf(REMAKE_TREATMENTS, raw.recommended, "replace");
    return {
        index: count(raw.index),
        startMs: count(raw.startMs),
        endMs: count(raw.endMs),
        keyframeResourceId: text(raw.keyframeResourceId),
        plot: text(raw.plot),
        motion: text(raw.motion),
        camera: text(raw.camera),
        shotSize: text(raw.shotSize),
        originalDialogue: text(raw.originalDialogue),
        onScreenText: text(raw.onScreenText),
        risks: (Array.isArray(raw.risks) ? raw.risks : []).filter((item): item is RemakeRisk => RISKS.includes(item as RemakeRisk)),
        speaker: raw.speaker === true,
        recommended,
        treatment: oneOf(REMAKE_TREATMENTS, raw.treatment, recommended),
        dialogue: text(raw.dialogue),
    };
}

function take(value: unknown): RemakeTake | undefined {
    const raw = record(value);
    const resourceId = text(raw?.resourceId);
    if (!raw || !resourceId) return undefined;
    return { taskId: text(raw.taskId), resourceId, durationMs: positive(raw.durationMs), width: positive(raw.width), height: positive(raw.height), createdAt: text(raw.createdAt) };
}

function unit(value: unknown): RemakeUnit | undefined {
    const raw = record(value);
    if (!raw || !text(raw.key)) return undefined;
    const takes = (Array.isArray(raw.takes) ? raw.takes : []).map(take).filter((item): item is RemakeTake => Boolean(item));
    return {
        key: text(raw.key),
        treatment: raw.treatment === "remake" ? "remake" : "replace",
        shotIndexes: (Array.isArray(raw.shotIndexes) ? raw.shotIndexes : []).filter((item): item is number => typeof item === "number" && Number.isSafeInteger(item) && item > 0),
        startMs: count(raw.startMs),
        endMs: count(raw.endMs),
        clipStartMs: count(raw.clipStartMs),
        clipEndMs: count(raw.clipEndMs),
        ...(text(raw.clipResourceId) ? { clipResourceId: text(raw.clipResourceId) } : {}),
        status: oneOf(["pending", "running", "succeeded", "failed"] as const, raw.status, "pending"),
        attempt: Math.max(1, count(raw.attempt, 1)),
        ...(text(raw.taskId) ? { taskId: text(raw.taskId) } : {}),
        ...(text(raw.error) ? { error: text(raw.error) } : {}),
        ...(text(raw.fix) ? { fix: text(raw.fix) } : {}),
        takes,
        chosen: Math.min(Math.max(0, count(raw.chosen)), Math.max(0, takes.length - 1)),
    };
}

export function normalizeRemakeJob(value: unknown): RemakeJob | undefined {
    const raw = record(value);
    const id = text(raw?.id);
    const source = record(raw?.source);
    if (!raw || !id || raw.version !== REMAKE_VERSION || !source || !text(source.resourceId)) return undefined;
    const product = record(raw.product) || {};
    const summary = record(raw.sourceSummary) || {};
    const clips = record(raw.clips);
    const render = record(raw.render);
    const createdAt = text(raw.createdAt, new Date(0).toISOString());
    return {
        version: REMAKE_VERSION,
        id,
        revision: count(raw.revision),
        title: text(raw.title),
        createdAt,
        updatedAt: text(raw.updatedAt, createdAt),
        status: oneOf(STATUSES, raw.status, "failed"),
        ...(text(raw.error) ? { error: text(raw.error) } : {}),
        source: {
            teardownId: text(source.teardownId),
            resourceId: text(source.resourceId),
            name: text(source.name),
            durationMs: count(source.durationMs),
            width: count(source.width),
            height: count(source.height),
            hasAudio: source.hasAudio !== false,
        },
        sourceSummary: { product: text(summary.product), hook: text(summary.hook), genre: text(summary.genre) },
        product: { ...(text(product.studioProductId) ? { studioProductId: text(product.studioProductId) } : {}), name: text(product.name), sellingPoints: text(product.sellingPoints), images: images(product.images, 4) },
        people: oneOf(["model", "original", "none"] as const, raw.people, "model"),
        models: images(raw.models, 3),
        backgrounds: images(raw.backgrounds, 3),
        audio: oneOf(["rewrite", "original", "mute"] as const, raw.audio, "rewrite"),
        authorized: raw.authorized === true,
        note: text(raw.note),
        model: text(raw.model),
        ratio: text(raw.ratio),
        resolution: text(raw.resolution),
        shots: (Array.isArray(raw.shots) ? raw.shots : []).map(shot).filter((item): item is RemakeShot => Boolean(item)),
        units: (Array.isArray(raw.units) ? raw.units : []).map(unit).filter((item): item is RemakeUnit => Boolean(item)),
        ...(clips && text(clips.key) ? { clips: { key: text(clips.key), ...(text(clips.taskId) ? { taskId: text(clips.taskId) } : {}), signature: text(clips.signature) } } : {}),
        ...(render
            ? {
                  render: {
                      ...(text(render.taskId) ? { taskId: text(render.taskId) } : {}),
                      ...(text(render.resourceId) ? { resourceId: text(render.resourceId) } : {}),
                      durationMs: positive(render.durationMs),
                      width: positive(render.width),
                      height: positive(render.height),
                  },
              }
            : {}),
        ...(typeof raw.credits === "number" && Number.isFinite(raw.credits) ? { credits: raw.credits } : {}),
    };
}
