// 商品视频 · 元素替换的作品记录：素材、参考视频选段、切好的片段、每段的生成任务和拼好的成片。
// 记录存在服务端的电商私有数据里（/ecommerce/product-videos），素材和成片只以 resourceId /
// keyframeResourceId 引用资源，服务端的孤儿清理据此保留它们。

export const PRODUCT_VIDEO_LIMITS = { products: 4, models: 3, backgrounds: 3 } as const;
export const PRODUCT_VIDEO_RANGE_MS = { min: 4_000, max: 120_000 } as const;

export type ProductVideoSlot = keyof typeof PRODUCT_VIDEO_LIMITS;
export const PRODUCT_VIDEO_SLOT_LABEL: Record<ProductVideoSlot, string> = { products: "商品图", models: "模特图", backgrounds: "背景图" };

/** 声音策略：保留原视频的声音（只换画面）、让模型生成声音、不要声音。 */
export type ProductVideoAudio = "original" | "model" | "mute";
export const PRODUCT_VIDEO_AUDIO_LABEL: Record<ProductVideoAudio, string> = { original: "保留原声", model: "模型配音", mute: "不要声音" };

export type ProductVideoImage = { id: string; resourceId: string; name: string; width?: number; height?: number };

export type ProductVideoReference = {
    resourceId: string;
    name: string;
    durationMs: number;
    width?: number;
    height?: number;
    /** 从平台链接导入时记下原链接，方便认出是哪条视频。 */
    link?: string;
};

export type ProductVideoSegment = {
    index: number;
    /** 在原视频里的位置（毫秒），拼成片时按它对齐原声。 */
    startMs: number;
    endMs: number;
    durationMs: number;
    resourceId: string;
    width: number;
    height: number;
    keyframeResourceId: string;
};

export type ProductVideoSplit = {
    /** 切段任务的幂等键：先记下再提交，刷新页面后重放拿回同一个任务。 */
    key: string;
    taskId?: string;
    maxSegmentSeconds: number;
    segments?: ProductVideoSegment[];
    hasAudio?: boolean;
    warnings?: string[];
};

export type ProductVideoShotStatus = "pending" | "running" | "succeeded" | "failed";

export type ProductVideoShot = {
    index: number;
    status: ProductVideoShotStatus;
    /** 第几次生成，用作任务的 clientOperationId，重做时加一。 */
    attempt: number;
    taskId?: string;
    resourceId?: string;
    durationMs?: number;
    width?: number;
    height?: number;
    error?: string;
    /** 定向修正：这一段重做时补充的要求（例如「商品 Logo 变形，保持正面文字」）。 */
    fix?: string;
};

export type ProductVideoStatus = "splitting" | "generating" | "previewed" | "assembling" | "succeeded" | "failed";

export const PRODUCT_VIDEO_STATUS_LABEL: Record<ProductVideoStatus, string> = {
    splitting: "切分参考视频",
    generating: "生成中",
    previewed: "预览完成",
    assembling: "拼接成片",
    succeeded: "已完成",
    failed: "未完成",
};

export type ProductVideoRender = { taskId?: string; resourceId?: string; durationMs?: number; width?: number; height?: number };

export type ProductVideoInputs = {
    title: string;
    products: ProductVideoImage[];
    models: ProductVideoImage[];
    backgrounds: ProductVideoImage[];
    reference?: ProductVideoReference;
    startMs: number;
    endMs: number;
    note: string;
    model: string;
    ratio: string;
    resolution: string;
    audio: ProductVideoAudio;
    /** 先只生成第一段看效果，确认后再生成其余段。 */
    preview: boolean;
};

export type ProductVideoJob = ProductVideoInputs & {
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    status: ProductVideoStatus;
    stage?: string;
    error?: string;
    split?: ProductVideoSplit;
    shots: ProductVideoShot[];
    render?: ProductVideoRender;
    /** 预览确认后继续生成其余段。 */
    previewApproved?: boolean;
    /** 开始生成时的预估积分（各段报价之和）。 */
    credits?: number;
};

export const PRODUCT_VIDEO_ACTIVE: readonly ProductVideoStatus[] = ["splitting", "generating", "assembling"];

export function emptyProductVideoInputs(): ProductVideoInputs {
    return { title: "", products: [], models: [], backgrounds: [], startMs: 0, endMs: 0, note: "", model: "", ratio: "", resolution: "", audio: "original", preview: false };
}

export function productVideoInputs(job: ProductVideoJob): ProductVideoInputs {
    const { title, products, models, backgrounds, reference, startMs, endMs, note, model, ratio, resolution, audio, preview } = job;
    return { title, products, models, backgrounds, reference, startMs, endMs, note, model, ratio, resolution, audio, preview };
}

export function productVideoImageCount(inputs: Pick<ProductVideoInputs, ProductVideoSlot>) {
    return inputs.products.length + inputs.models.length + inputs.backgrounds.length;
}

/** 开始生成前的检查；返回第一条要用户处理的问题，没有问题时返回空字符串。 */
export function productVideoInputsError(inputs: ProductVideoInputs, maxImages?: number) {
    if (!productVideoImageCount(inputs)) return "至少放一张商品图、模特图或背景图，告诉模型要换成什么";
    if (!inputs.reference) return "请先添加参考视频";
    const length = inputs.endMs - inputs.startMs;
    if (length < PRODUCT_VIDEO_RANGE_MS.min || length > PRODUCT_VIDEO_RANGE_MS.max) return "参考视频的选段须在 4–120 秒之间，可以用裁剪选出其中一段";
    if (!inputs.model) return "请选择视频模型";
    if (maxImages !== undefined && productVideoImageCount(inputs) > maxImages) return `所选模型一次最多参考 ${maxImages} 张图，请减少素材或换一个模型`;
    return "";
}

/** 新作品的默认名称：用参考视频的文件名或链接标题，没有时按时间。 */
export function productVideoTitle(inputs: Pick<ProductVideoInputs, "title" | "reference">, now = new Date()) {
    const named = inputs.title.trim() || inputs.reference?.name.replace(/\.[^.]+$/, "").trim();
    if (named) return named.slice(0, 60);
    return `商品视频 ${now.getMonth() + 1}-${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function createProductVideoJob(id: string, inputs: ProductVideoInputs, extra: { splitKey: string; maxSegmentSeconds: number; credits?: number }, now = new Date()): ProductVideoJob {
    const time = now.toISOString();
    return {
        ...inputs,
        title: productVideoTitle(inputs, now),
        id,
        revision: 0,
        createdAt: time,
        updatedAt: time,
        status: "splitting",
        split: { key: extra.splitKey, maxSegmentSeconds: extra.maxSegmentSeconds },
        shots: [],
        ...(extra.credits !== undefined ? { credits: extra.credits } : {}),
    };
}

/** 同一参考视频、同一选段、同一段长时，再次生成直接沿用已经切好的片段。 */
export function reusableProductVideoSplit(job: ProductVideoJob, inputs: ProductVideoInputs, maxSegmentSeconds: number): ProductVideoSplit | undefined {
    const split = job.split;
    if (!split?.segments?.length || !inputs.reference || job.reference?.resourceId !== inputs.reference.resourceId) return undefined;
    if (job.startMs !== inputs.startMs || job.endMs !== inputs.endMs || split.maxSegmentSeconds !== maxSegmentSeconds) return undefined;
    return split;
}

export function pendingProductVideoShots(segments: readonly ProductVideoSegment[]): ProductVideoShot[] {
    return segments.map((segment) => ({ index: segment.index, status: "pending", attempt: 1 }));
}

/** 这一轮要生成的段：预览模式且还没确认时只生成第一段。 */
export function productVideoTargetShots(job: Pick<ProductVideoJob, "preview" | "previewApproved" | "shots">) {
    const shots = job.preview && !job.previewApproved ? job.shots.slice(0, 1) : job.shots;
    return shots.filter((shot) => shot.status !== "succeeded");
}

export function productVideoProgress(job: Pick<ProductVideoJob, "status" | "shots">) {
    const done = job.shots.filter((shot) => shot.status === "succeeded").length;
    return { done, total: job.shots.length, failed: job.shots.filter((shot) => shot.status === "failed").length };
}

// ---------- 服务端数据的防御性解析 ----------

const STATUSES: readonly ProductVideoStatus[] = ["splitting", "generating", "previewed", "assembling", "succeeded", "failed"];
const SHOT_STATUSES: readonly ProductVideoShotStatus[] = ["pending", "running", "succeeded", "failed"];
const AUDIOS: readonly ProductVideoAudio[] = ["original", "model", "mute"];

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : undefined);
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const count = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
const optionalCount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T) => (values.includes(value as T) ? (value as T) : fallback);

function normalizeImage(value: unknown): ProductVideoImage | undefined {
    const raw = record(value);
    const resourceId = text(raw?.resourceId);
    if (!raw || !resourceId) return undefined;
    return { id: text(raw.id, resourceId), resourceId, name: text(raw.name), width: optionalCount(raw.width), height: optionalCount(raw.height) };
}

function normalizeImages(value: unknown, limit: number) {
    return (Array.isArray(value) ? value : [])
        .map(normalizeImage)
        .filter((item): item is ProductVideoImage => Boolean(item))
        .slice(0, limit);
}

function normalizeReference(value: unknown): ProductVideoReference | undefined {
    const raw = record(value);
    const resourceId = text(raw?.resourceId);
    if (!raw || !resourceId) return undefined;
    return { resourceId, name: text(raw.name), durationMs: count(raw.durationMs), width: optionalCount(raw.width), height: optionalCount(raw.height), ...(text(raw.link) ? { link: text(raw.link) } : {}) };
}

export function normalizeProductVideoSegment(value: unknown): ProductVideoSegment | undefined {
    const raw = record(value);
    const resourceId = text(raw?.resourceId);
    if (!raw || !resourceId) return undefined;
    const startMs = count(raw.startMs);
    const endMs = count(raw.endMs, startMs);
    return { index: count(raw.index), startMs, endMs, durationMs: count(raw.durationMs, endMs - startMs), resourceId, width: count(raw.width), height: count(raw.height), keyframeResourceId: text(raw.keyframeResourceId) };
}

function normalizeSplit(value: unknown): ProductVideoSplit | undefined {
    const raw = record(value);
    if (!raw || !text(raw.key)) return undefined;
    const segments = Array.isArray(raw.segments) ? raw.segments.map(normalizeProductVideoSegment).filter((item): item is ProductVideoSegment => Boolean(item)) : undefined;
    return {
        key: text(raw.key),
        ...(text(raw.taskId) ? { taskId: text(raw.taskId) } : {}),
        maxSegmentSeconds: count(raw.maxSegmentSeconds, 15),
        ...(segments ? { segments } : {}),
        ...(typeof raw.hasAudio === "boolean" ? { hasAudio: raw.hasAudio } : {}),
        ...(Array.isArray(raw.warnings) ? { warnings: raw.warnings.filter((item): item is string => typeof item === "string") } : {}),
    };
}

function normalizeShot(value: unknown): ProductVideoShot | undefined {
    const raw = record(value);
    if (!raw) return undefined;
    return {
        index: count(raw.index),
        status: oneOf(SHOT_STATUSES, raw.status, "pending"),
        attempt: Math.max(1, count(raw.attempt, 1)),
        ...(text(raw.taskId) ? { taskId: text(raw.taskId) } : {}),
        ...(text(raw.resourceId) ? { resourceId: text(raw.resourceId) } : {}),
        ...(optionalCount(raw.durationMs) ? { durationMs: optionalCount(raw.durationMs) } : {}),
        ...(optionalCount(raw.width) ? { width: optionalCount(raw.width) } : {}),
        ...(optionalCount(raw.height) ? { height: optionalCount(raw.height) } : {}),
        ...(text(raw.error) ? { error: text(raw.error) } : {}),
        ...(text(raw.fix) ? { fix: text(raw.fix) } : {}),
    };
}

function normalizeRender(value: unknown): ProductVideoRender | undefined {
    const raw = record(value);
    if (!raw) return undefined;
    return {
        ...(text(raw.taskId) ? { taskId: text(raw.taskId) } : {}),
        ...(text(raw.resourceId) ? { resourceId: text(raw.resourceId) } : {}),
        ...(optionalCount(raw.durationMs) ? { durationMs: optionalCount(raw.durationMs) } : {}),
        ...(optionalCount(raw.width) ? { width: optionalCount(raw.width) } : {}),
        ...(optionalCount(raw.height) ? { height: optionalCount(raw.height) } : {}),
    };
}

export function normalizeProductVideoJob(value: unknown): ProductVideoJob | undefined {
    const raw = record(value);
    const id = text(raw?.id);
    if (!raw || !id) return undefined;
    const createdAt = text(raw.createdAt, new Date(0).toISOString());
    return {
        id,
        revision: count(raw.revision),
        title: text(raw.title),
        createdAt,
        updatedAt: text(raw.updatedAt, createdAt),
        status: oneOf(STATUSES, raw.status, "failed"),
        ...(text(raw.stage) ? { stage: text(raw.stage) } : {}),
        ...(text(raw.error) ? { error: text(raw.error) } : {}),
        products: normalizeImages(raw.products, PRODUCT_VIDEO_LIMITS.products),
        models: normalizeImages(raw.models, PRODUCT_VIDEO_LIMITS.models),
        backgrounds: normalizeImages(raw.backgrounds, PRODUCT_VIDEO_LIMITS.backgrounds),
        reference: normalizeReference(raw.reference),
        startMs: count(raw.startMs),
        endMs: count(raw.endMs),
        note: text(raw.note),
        model: text(raw.model),
        ratio: text(raw.ratio),
        resolution: text(raw.resolution),
        audio: oneOf(AUDIOS, raw.audio, "original"),
        preview: raw.preview === true,
        ...(raw.previewApproved === true ? { previewApproved: true } : {}),
        split: normalizeSplit(raw.split),
        shots: (Array.isArray(raw.shots) ? raw.shots : []).map(normalizeShot).filter((item): item is ProductVideoShot => Boolean(item)),
        render: normalizeRender(raw.render),
        ...(typeof raw.credits === "number" && Number.isFinite(raw.credits) ? { credits: raw.credits } : {}),
    };
}
