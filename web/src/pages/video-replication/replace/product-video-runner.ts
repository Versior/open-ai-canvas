import { create } from "zustand";
import { createClientId } from "@/lib/client-id";
import { pendingProductVideoShots, productVideoTargetShots, PRODUCT_VIDEO_ACTIVE, type ProductVideoJob, type ProductVideoShot } from "@/lib/product-video/job";
import { productVideoRenderSize, productVideoShotSeconds, productVideoTimeline } from "@/lib/product-video/media";
import { buildProductVideoShotPrompt, productVideoReferenceImages } from "@/lib/product-video/prompt";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { createProductVideoSplit, parseProductVideoSplitResult } from "@/services/api/product-video";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { cancelGenerationTask, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { createTimelineRenderTask, type TimelineRenderResult } from "@/services/api/timeline-tasks";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";
import { productVideoGenerationConfig, productVideoLimitsFor } from "./product-video-config";
import { readProductVideo, updateProductVideo } from "./use-product-video-store";

/**
 * 一条作品的生成流程：切参考视频 → 每段交给视频模型（参考图 + 这一段参考视频）→ 按原顺序拼成片。
 * 每一步的任务 ID 先写进作品再等结果，离开页面或刷新后从作品记录接着跑，已提交的任务不重复提交。
 * 流程在模块里运行，站内切换页面不打断；当前进度（阶段、百分比）只在内存里，不写进作品。
 */

const SPLIT_TIMEOUT_MS = 11 * 60_000;
const VIDEO_TIMEOUT_MS = 65 * 60_000;
const RENDER_TIMEOUT_MS = 62 * 60_000;
const SHOT_CONCURRENCY = 3;

type Progress = { stage?: string; percent?: number };
type Runtime = { active: Record<string, true>; progress: Record<string, Progress> };

export const useProductVideoRuntime = create<Runtime>(() => ({ active: {}, progress: {} }));

const controllers = new Map<string, AbortController>();

function setProgress(id: string, progress: Progress | undefined) {
    useProductVideoRuntime.setState((state) => {
        const next = { ...state.progress };
        if (progress) next[id] = progress;
        else delete next[id];
        return { progress: next };
    });
}

function setActive(id: string, active: boolean) {
    useProductVideoRuntime.setState((state) => {
        const next = { ...state.active };
        if (active) next[id] = true;
        else delete next[id];
        return { active: next };
    });
}

function read(id: string) {
    const job = readProductVideo(id);
    if (!job) throw new Error("作品已被删除");
    return job;
}

function patchShot(index: number, patch: Partial<ProductVideoShot>) {
    return (job: ProductVideoJob): ProductVideoJob => ({ ...job, shots: job.shots.map((shot) => (shot.index === index ? { ...shot, ...patch } : shot)) });
}

function taskPercent(task: GenerationTask) {
    return typeof task.progress === "number" ? Math.round(Math.min(Math.max(task.progress, 0), 100)) : undefined;
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function terminal(task: GenerationTask) {
    return task.status === "failed" || task.status === "cancelled";
}

async function splitStep(id: string, signal: AbortSignal) {
    const job = read(id);
    if (job.split?.segments?.length) return;
    if (!job.reference) throw new Error("没有参考视频");
    const split = job.split?.key ? job.split : { key: createClientId(), maxSegmentSeconds: job.split?.maxSegmentSeconds || 15 };
    setProgress(id, { stage: "切分参考视频" });
    // 同一幂等键重放拿回同一个任务；键先写进作品再提交。
    if (!job.split?.key) await updateProductVideo(id, (value) => ({ ...value, split }));
    const created = await createProductVideoSplit({ resourceId: job.reference.resourceId, startMs: job.startMs, endMs: job.endMs, maxSegmentSeconds: split.maxSegmentSeconds }, split.key, signal);
    if (job.split?.taskId !== created.id) await updateProductVideo(id, (value) => ({ ...value, split: { ...split, ...value.split, taskId: created.id } }));
    const done = await waitForGenerationTask(created.id, { initialTask: created, signal, timeoutMs: SPLIT_TIMEOUT_MS, onTaskUpdate: (task) => setProgress(id, { stage: task.stage || "切分参考视频", percent: taskPercent(task) }) });
    const result = parseProductVideoSplitResult(done);
    await updateProductVideo(id, (value) => ({
        ...value,
        status: "generating",
        split: { ...split, ...value.split, taskId: created.id, segments: result.segments, hasAudio: result.hasAudio, warnings: result.warnings },
        shots: pendingProductVideoShots(result.segments),
    }));
}

function shotReferences(job: ProductVideoJob, index: number) {
    const segment = job.split?.segments?.find((item) => item.index === index);
    if (!segment) throw new Error(`第 ${index} 段的参考片段不见了`);
    const { images } = productVideoReferenceImages(job);
    const referenceImages: ReferenceImage[] = images.map((image) => ({
        id: image.id,
        name: image.name || "参考图.png",
        type: "image/png",
        dataUrl: "",
        storageKey: resourceStorageKey(image.resourceId),
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
    }));
    const referenceVideos: ReferenceVideo[] = [
        { id: `segment-${index}`, name: `参考片段-${String(index).padStart(2, "0")}.mp4`, type: "video/mp4", url: "", storageKey: resourceStorageKey(segment.resourceId), width: segment.width, height: segment.height, durationMs: segment.durationMs },
    ];
    return { segment, referenceImages, referenceVideos };
}

async function shotStep(id: string, index: number, config: AiConfig, signal: AbortSignal) {
    let job = read(id);
    let shot = job.shots.find((item) => item.index === index);
    if (!shot || shot.status === "succeeded") return;
    let task: GenerationTask | undefined;
    if (shot.taskId) {
        task = await queryGenerationTask(shot.taskId, { signal });
        // 上一次的任务已经失败（例如刷新前失败、还没来得及记下）：换一次新的生成。
        if (terminal(task)) {
            await updateProductVideo(id, patchShot(index, { taskId: undefined, attempt: shot.attempt + 1 }));
            task = undefined;
            job = read(id);
            shot = job.shots.find((item) => item.index === index)!;
        }
    }
    if (!task) {
        const limits = productVideoLimitsFor(config, job.model);
        if (typeof limits === "string") throw new Error(`所选模型${limits}，不能做元素替换`);
        const { segment, referenceImages, referenceVideos } = shotReferences(job, index);
        const seconds = productVideoShotSeconds(segment.durationMs, limits.durations);
        const total = job.split?.segments?.length || 1;
        const prompt = buildProductVideoShotPrompt({ ...job, index, total, seconds, fix: shot.fix });
        await updateProductVideo(id, patchShot(index, { status: "running", error: undefined }));
        task = await submitBackendGenerationTask({
            mode: "video",
            prompt,
            config: productVideoGenerationConfig(config, { model: job.model, ratio: job.ratio, resolution: job.resolution, seconds, audio: job.audio }),
            referenceImages,
            referenceVideos,
            signal,
            clientOperationId: `${id}-${index}-${shot.attempt}`,
            metadata: { source: "product-video", productVideoId: id, productVideoSegment: index },
        });
        await updateProductVideo(id, patchShot(index, { status: "running", taskId: task.id }));
    }
    try {
        const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: VIDEO_TIMEOUT_MS });
        const result = parseBackendGenerationResult(done);
        const resourceId = resourceIdFromStorageKey(result.video?.storageKey);
        if (!resourceId) throw new Error("任务完成但没有可用的视频，请到任务中心核对");
        await updateProductVideo(
            id,
            patchShot(index, {
                status: "succeeded",
                resourceId,
                error: undefined,
                ...(result.video?.durationMs ? { durationMs: result.video.durationMs } : {}),
                ...(result.video?.width ? { width: result.video.width } : {}),
                ...(result.video?.height ? { height: result.video.height } : {}),
            }),
        );
    } catch (error) {
        if (signal.aborted) throw error;
        await updateProductVideo(id, patchShot(index, { status: "failed", error: errorMessage(error, "生成失败") }));
    }
}

async function generateStep(id: string, config: AiConfig, signal: AbortSignal) {
    const queue = productVideoTargetShots(read(id)).map((shot) => shot.index);
    const count = () => {
        const job = read(id);
        const done = job.shots.filter((shot) => shot.status === "succeeded").length;
        setProgress(id, { stage: `生成第 ${Math.min(done + 1, job.shots.length)}/${job.shots.length} 段`, percent: job.shots.length ? Math.round((done / job.shots.length) * 100) : undefined });
    };
    count();
    const worker = async () => {
        for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
            try {
                await shotStep(id, index, config, signal);
            } catch (error) {
                if (signal.aborted) throw error;
                await updateProductVideo(id, patchShot(index, { status: "failed", error: errorMessage(error, "提交失败") }));
            }
            count();
        }
    };
    await Promise.all(Array.from({ length: Math.min(SHOT_CONCURRENCY, queue.length) }, worker));
}

async function assembleStep(id: string, signal: AbortSignal) {
    const job = read(id);
    if (job.render?.resourceId) return;
    setProgress(id, { stage: "拼接成片" });
    let task = job.render?.taskId ? await queryGenerationTask(job.render.taskId, { signal }) : undefined;
    const size = productVideoRenderSize(job);
    if (!task || terminal(task)) {
        const timeline = productVideoTimeline(job, size);
        task = await createTimelineRenderTask({ projectId: "", timeline }, signal);
        await updateProductVideo(id, (value) => ({ ...value, render: { taskId: task!.id } }));
    }
    const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: RENDER_TIMEOUT_MS, intervalMs: 3000, onTaskUpdate: (item) => setProgress(id, { stage: "拼接成片", percent: taskPercent(item) }) });
    const parsed = JSON.parse(done.resultJson || "{}") as TimelineRenderResult;
    if (!parsed.resourceId) throw new Error("拼接任务没有返回成片");
    await updateProductVideo(id, (value) => ({
        ...value,
        status: "succeeded",
        error: undefined,
        render: { taskId: task!.id, resourceId: parsed.resourceId, ...(parsed.durationMs ? { durationMs: parsed.durationMs } : {}), width: size.width, height: size.height },
    }));
}

/** 开始或接着跑一条作品；已经在跑时什么也不做。config 是提交时的模型配置。 */
export function runProductVideo(id: string, config: AiConfig) {
    if (controllers.has(id)) return;
    const controller = new AbortController();
    const scope = getActiveUserScope();
    controllers.set(id, controller);
    setActive(id, true);
    void (async () => {
        try {
            await splitStep(id, controller.signal);
            let job = read(id);
            if (job.status !== "assembling") {
                if (job.status !== "generating") await updateProductVideo(id, (value) => ({ ...value, status: "generating", error: undefined }));
                await generateStep(id, config, controller.signal);
                job = read(id);
                const preview = job.preview && !job.previewApproved;
                const failed = (preview ? job.shots.slice(0, 1) : job.shots).filter((shot) => shot.status !== "succeeded");
                if (failed.length) {
                    await updateProductVideo(id, (value) => ({ ...value, status: "failed", error: `第 ${failed.map((shot) => shot.index).join("、")} 段没有生成成功，可以补充要求后单独重做` }));
                    return;
                }
                if (preview) {
                    await updateProductVideo(id, (value) => ({ ...value, status: "previewed", error: undefined }));
                    return;
                }
                await updateProductVideo(id, (value) => ({ ...value, status: "assembling", error: undefined }));
            }
            await assembleStep(id, controller.signal);
        } catch (error) {
            if (controller.signal.aborted || getActiveUserScope() !== scope || !readProductVideo(id)) return;
            await updateProductVideo(id, (value) => ({ ...value, status: "failed", error: errorMessage(error, "生成失败") })).catch(() => undefined);
        } finally {
            controllers.delete(id);
            setActive(id, false);
            setProgress(id, undefined);
        }
    })();
}

/** 停止：取消还在跑的后端任务，作品标成未完成，已生成好的段保留。 */
export async function stopProductVideo(id: string) {
    controllers.get(id)?.abort();
    const job = readProductVideo(id);
    if (!job) return;
    const running = [job.split?.segments?.length ? undefined : job.split?.taskId, ...job.shots.filter((shot) => shot.status === "running").map((shot) => shot.taskId), job.render?.resourceId ? undefined : job.render?.taskId].filter(
        (taskId): taskId is string => Boolean(taskId),
    );
    await Promise.all(running.map((taskId) => cancelGenerationTask(taskId).catch(() => undefined)));
    await updateProductVideo(id, (value) => ({
        ...value,
        status: "failed",
        error: "已停止",
        shots: value.shots.map((shot) => (shot.status === "running" ? { ...shot, status: "failed", error: "已停止", taskId: undefined, attempt: shot.attempt + 1 } : shot)),
        render: value.render?.resourceId ? value.render : undefined,
    }));
}

/** 接着跑：没切完的重新切，失败的段换一次新的生成，拼接失败的重新拼。 */
export async function retryProductVideo(id: string, config: AiConfig) {
    await updateProductVideo(id, (value) => ({
        ...value,
        status: value.split?.segments?.length ? "generating" : "splitting",
        error: undefined,
        split: value.split?.segments?.length ? value.split : { key: createClientId(), maxSegmentSeconds: value.split?.maxSegmentSeconds || 15 },
        shots: value.shots.map((shot) => (shot.status === "failed" ? { ...shot, status: "pending", error: undefined, taskId: undefined, attempt: shot.attempt + 1 } : shot)),
        render: value.render?.resourceId ? value.render : undefined,
    }));
    runProductVideo(id, config);
}

/** 定向修正：只重做某一段，带上这次要修正的问题；成片要重新拼。 */
export async function redoProductVideoShot(id: string, index: number, fix: string, config: AiConfig) {
    await updateProductVideo(id, (value) => ({
        ...value,
        status: "generating",
        error: undefined,
        shots: value.shots.map((shot) => (shot.index === index ? { index, status: "pending", attempt: shot.attempt + 1, ...(fix.trim() ? { fix: fix.trim() } : {}) } : shot)),
        render: undefined,
    }));
    runProductVideo(id, config);
}

/** 预览满意后生成其余段并拼成片。 */
export async function approveProductVideoPreview(id: string, config: AiConfig) {
    await updateProductVideo(id, (value) => ({ ...value, previewApproved: true, status: "generating", error: undefined }));
    runProductVideo(id, config);
}

/** 打开页面时接着跑上次没跑完的作品。 */
export function resumeProductVideos(jobs: readonly ProductVideoJob[], config: AiConfig) {
    for (const job of jobs) if (PRODUCT_VIDEO_ACTIVE.includes(job.status) && !controllers.has(job.id)) runProductVideo(job.id, config);
}

export function isProductVideoRunning(id: string) {
    return controllers.has(id);
}
