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

/**
 * 口播：改写口播（视频模型说新台词、对口型）、AI 配音（新台词由配音模型统一音色朗读，视频不出声）、
 * 保留原声（要授权）、不要人声。
 */
export type RemakeAudio = "rewrite" | "voice" | "original" | "mute";
export const REMAKE_AUDIOS: RemakeAudio[] = ["rewrite", "voice", "original", "mute"];
export const REMAKE_AUDIO_LABEL: Record<RemakeAudio, string> = { rewrite: "改写口播", voice: "AI 配音", original: "保留原声", mute: "不要人声" };

/** 新口播用的语言：改写口播、配音和字幕都按它。cps 是每秒大约能说的字符数，用来限长。 */
export type RemakeLanguage = "zh" | "en" | "ja" | "ko" | "es" | "pt" | "id" | "th" | "vi" | "fr" | "de";
export const REMAKE_LANGUAGES: { value: RemakeLanguage; label: string; speech: string; tts: string; cps: number }[] = [
    { value: "zh", label: "中文", speech: "中文普通话", tts: "zh-cn", cps: 4 },
    { value: "en", label: "English", speech: "英语", tts: "en", cps: 14 },
    { value: "ja", label: "日本語", speech: "日语", tts: "ja", cps: 7 },
    { value: "ko", label: "한국어", speech: "韩语", tts: "ko", cps: 6 },
    { value: "es", label: "Español", speech: "西班牙语", tts: "es-mx", cps: 14 },
    { value: "pt", label: "Português", speech: "葡萄牙语（巴西）", tts: "pt-br", cps: 14 },
    { value: "id", label: "Bahasa Indonesia", speech: "印尼语", tts: "id", cps: 14 },
    { value: "th", label: "ไทย", speech: "泰语", tts: "th", cps: 10 },
    { value: "vi", label: "Tiếng Việt", speech: "越南语", tts: "vi", cps: 12 },
    { value: "fr", label: "Français", speech: "法语", tts: "fr", cps: 14 },
    { value: "de", label: "Deutsch", speech: "德语", tts: "de", cps: 13 },
];

export function remakeLanguage(value: RemakeLanguage | undefined) {
    return REMAKE_LANGUAGES.find((item) => item.value === value) || REMAKE_LANGUAGES[0];
}

/** AI 配音的设置：配音模型、音色和语速（与全局音频设置同一套取值）。 */
export type RemakeVoice = { model: string; voice: string; speed: string };

/** 一句配音：signature 记下生成它时的模型、音色、语速、语言和台词，任何一项变了就重新生成。 */
export type RemakeVoiceLine = {
    shotIndex: number;
    text: string;
    signature: string;
    status: "pending" | "running" | "succeeded" | "failed";
    attempt: number;
    taskId?: string;
    resourceId?: string;
    durationMs?: number;
    error?: string;
};

/** 背景音乐：从素材库或本机选的一段音频，比成片短时循环，结尾 1.5 秒淡出。volume 是 0.05–1。 */
export type RemakeMusic = { resourceId: string; name: string; durationMs?: number; volume: number };

/** 烧录字幕用的整幅透明图：signature 是画幅加全部字幕文字，变了就重画。 */
export type RemakeSubtitleImages = { signature: string; items: { shotIndex: number; resourceId: string }[] };

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
    language: RemakeLanguage;
    voice: RemakeVoice;
    voiceLines: RemakeVoiceLine[];
    /** 把字幕烧进成片（不勾时只能导出 SRT 或在剪映里编辑）。 */
    subtitles: { burn: boolean };
    subtitleImages?: RemakeSubtitleImages;
    music?: RemakeMusic;
    /** 从哪条作品复制来的（再做一版、套用到其他商品）。 */
    variantOf?: { id: string; title: string };
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
        language: "zh",
        voice: { model: "", voice: "", speed: "1" },
        voiceLines: [],
        subtitles: { burn: false },
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
    if (job.audio === "rewrite" && generated.some((shot) => shot.dialogue.trim()) && limits && !limits.generateAudio) return "所选模型不能生成声音，换一个能出声的模型，或把口播改成「AI 配音」";
    if (job.audio === "voice" && active.some((shot) => shot.dialogue.trim()) && !job.voice.model) return "请选择配音模型";
    return "";
}

/** 这一镜在成片里说的话（字幕和配音都按它）：改写口播和 AI 配音用新口播，保留原声用原口播，不要人声没有。 */
export function remakeSpokenText(job: Pick<RemakeJob, "audio">, shot: Pick<RemakeShot, "dialogue" | "originalDialogue" | "treatment">) {
    if (shot.treatment === "skip") return "";
    if (job.audio === "rewrite" || job.audio === "voice") return shot.dialogue.trim();
    if (job.audio === "original") return shot.originalDialogue.trim();
    return "";
}

/**
 * 复制一条作品：再做一版时沿用全部候选（只重做改了的部分）；换商品时清掉候选和口播，参考片段照用。
 * 成片、报价和切段任务都不带过去。
 */
export function duplicateRemakeJob(job: RemakeJob, id: string, options: { title: string; product?: RemakeProduct }, now = new Date()): RemakeJob {
    const time = now.toISOString();
    const swap = Boolean(options.product);
    return {
        ...job,
        id,
        revision: 0,
        title: options.title.slice(0, 60),
        createdAt: time,
        updatedAt: time,
        status: "draft",
        error: undefined,
        render: undefined,
        credits: undefined,
        clips: undefined,
        variantOf: { id: job.id, title: job.title },
        ...(swap
            ? {
                  product: options.product!,
                  shots: job.shots.map((shot) => ({ ...shot, dialogue: "" })),
                  units: job.units.map((unit) => ({ ...unit, status: "pending" as const, attempt: 1, taskId: undefined, error: undefined, fix: undefined, takes: [], chosen: 0 })),
                  voiceLines: [],
              }
            : { units: job.units.map((unit) => (unit.status === "running" ? { ...unit, status: "pending" as const, taskId: undefined } : unit)) }),
    };
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
const LANGUAGE_VALUES = REMAKE_LANGUAGES.map((item) => item.value);

function voiceLine(value: unknown): RemakeVoiceLine | undefined {
    const raw = record(value);
    if (!raw || !count(raw.shotIndex) || !text(raw.signature)) return undefined;
    return {
        shotIndex: count(raw.shotIndex),
        text: text(raw.text),
        signature: text(raw.signature),
        status: oneOf(["pending", "running", "succeeded", "failed"] as const, raw.status, "pending"),
        attempt: Math.max(1, count(raw.attempt, 1)),
        ...(text(raw.taskId) ? { taskId: text(raw.taskId) } : {}),
        ...(text(raw.resourceId) ? { resourceId: text(raw.resourceId) } : {}),
        ...(positive(raw.durationMs) ? { durationMs: positive(raw.durationMs) } : {}),
        ...(text(raw.error) ? { error: text(raw.error) } : {}),
    };
}
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
    const voice = record(raw.voice) || {};
    const subtitleImages = record(raw.subtitleImages);
    const music = record(raw.music);
    const variantOf = record(raw.variantOf);
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
        audio: oneOf(REMAKE_AUDIOS, raw.audio, "rewrite"),
        language: oneOf(LANGUAGE_VALUES, raw.language, "zh"),
        voice: { model: text(voice.model), voice: text(voice.voice), speed: text(voice.speed, "1") || "1" },
        voiceLines: (Array.isArray(raw.voiceLines) ? raw.voiceLines : []).map(voiceLine).filter((item): item is RemakeVoiceLine => Boolean(item)),
        subtitles: { burn: record(raw.subtitles)?.burn === true },
        ...(subtitleImages && text(subtitleImages.signature)
            ? {
                  subtitleImages: {
                      signature: text(subtitleImages.signature),
                      items: (Array.isArray(subtitleImages.items) ? subtitleImages.items : []).flatMap((item) => {
                          const entry = record(item);
                          return entry && count(entry.shotIndex) && text(entry.resourceId) ? [{ shotIndex: count(entry.shotIndex), resourceId: text(entry.resourceId) }] : [];
                      }),
                  },
              }
            : {}),
        ...(music && text(music.resourceId)
            ? {
                  music: {
                      resourceId: text(music.resourceId),
                      name: text(music.name),
                      ...(positive(music.durationMs) ? { durationMs: positive(music.durationMs) } : {}),
                      volume: Math.min(1, Math.max(0.05, typeof music.volume === "number" ? music.volume : 0.25)),
                  },
              }
            : {}),
        ...(variantOf && text(variantOf.id) ? { variantOf: { id: text(variantOf.id), title: text(variantOf.title) } } : {}),
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
