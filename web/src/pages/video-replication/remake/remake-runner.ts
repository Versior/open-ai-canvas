import { create } from "zustand";
import { isDoubaoAudioConfig } from "@/lib/audio-generation";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { createClientId } from "@/lib/client-id";
import { productVideoShotSeconds } from "@/lib/product-video/media";
import { REMAKE_ACTIVE, remakeLanguage, type RemakeJob, type RemakeUnit, type RemakeVoiceLine } from "@/lib/remake/job";
import { buildRemakeUnitPrompt, remakeReferenceImages } from "@/lib/remake/prompts";
import { remakeLines, remakeRenderSize, remakeSubtitleSignature, remakeTimeline, remakeVoicePlan } from "@/lib/remake/timeline";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { planRemakeUnits, remakeClipSignature } from "@/lib/remake/units";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { createProductVideoSplit, parseProductVideoSplitResult } from "@/services/api/product-video";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { cancelGenerationTask, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { createTimelineRenderTask, type TimelineRenderResult } from "@/services/api/timeline-tasks";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";
import { productVideoGenerationConfig, productVideoLimitsFor } from "../replace/product-video-config";
import { readRemake, updateRemake } from "../replace/use-product-video-store";
import { drawRemakeSubtitle } from "./remake-subtitles";

/**
 * 复刻工作台的生成流程：切换元素单元的参考片段 → 每个生成单元交给视频模型（参考图 + 参考片段或分镜描述）
 * → 所有单元都有选中的候选后按原片顺序拼成片。每一步的任务 ID 先写进作品再等结果，刷新或离开页面后接着跑，
 * 已提交的任务不重复提交。当前进度只在内存里。
 */

const SPLIT_TIMEOUT_MS = 11 * 60_000;
const VIDEO_TIMEOUT_MS = 65 * 60_000;
const RENDER_TIMEOUT_MS = 62 * 60_000;
const UNIT_CONCURRENCY = 3;
const VOICE_TIMEOUT_MS = 10 * 60_000;

type Progress = { stage?: string; percent?: number; units?: Record<string, number> };
export const useRemakeRuntime = create<{ active: Record<string, true>; progress: Record<string, Progress> }>(() => ({ active: {}, progress: {} }));

const controllers = new Map<string, AbortController>();

function setProgress(id: string, patch: Progress | undefined) {
    useRemakeRuntime.setState((state) => {
        const next = { ...state.progress };
        if (patch) next[id] = { ...next[id], ...patch, units: { ...next[id]?.units, ...patch.units } };
        else delete next[id];
        return { progress: next };
    });
}

function setActive(id: string, active: boolean) {
    useRemakeRuntime.setState((state) => {
        const next = { ...state.active };
        if (active) next[id] = true;
        else delete next[id];
        return { active: next };
    });
}

function read(id: string) {
    const job = readRemake(id);
    if (!job) throw new Error("作品已被删除");
    return job;
}

function patchUnit(key: string, patch: Partial<RemakeUnit> | ((unit: RemakeUnit) => Partial<RemakeUnit>)) {
    return (job: RemakeJob): RemakeJob => ({ ...job, units: job.units.map((unit) => (unit.key === key ? { ...unit, ...(typeof patch === "function" ? patch(unit) : patch) } : unit)) });
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function terminal(task: GenerationTask) {
    return task.status === "failed" || task.status === "cancelled";
}

function limitsOf(config: AiConfig, job: RemakeJob) {
    const limits = productVideoLimitsFor(config, job.model);
    if (typeof limits === "string") throw new Error(`所选模型${limits}，请换一个能参考视频的模型`);
    return limits;
}

/** 按当前的逐镜做法排生成单元；做法和范围没变的单元沿用之前的候选。 */
export function remakeUnitsFor(job: RemakeJob, config: AiConfig) {
    const limits = productVideoLimitsFor(config, job.model);
    const maxMs = (typeof limits === "string" ? 15 : limits.maxSegmentSeconds) * 1000;
    return planRemakeUnits(job.shots, { maxMs, sourceDurationMs: job.source.durationMs }, job.units);
}

async function clipStep(id: string, signal: AbortSignal) {
    const job = read(id);
    const missing = job.units.filter((unit) => unit.treatment === "replace" && !unit.clipResourceId);
    if (!missing.length) return;
    const signature = remakeClipSignature(missing);
    const clips = job.clips?.signature === signature && job.clips.key ? job.clips : { key: createClientId(), signature };
    setProgress(id, { stage: "切参考片段" });
    if (job.clips !== clips) await updateRemake(id, (value) => ({ ...value, status: "clipping", clips }));
    const longest = Math.max(...missing.map((unit) => unit.clipEndMs - unit.clipStartMs));
    const created = await createProductVideoSplit(
        { resourceId: job.source.resourceId, startMs: 0, endMs: 0, maxSegmentSeconds: Math.min(30, Math.max(8, Math.ceil(longest / 1000))), ranges: missing.map((unit) => ({ startMs: unit.clipStartMs, endMs: unit.clipEndMs })) },
        clips.key,
        signal,
    );
    if (clips.taskId !== created.id) await updateRemake(id, (value) => ({ ...value, clips: { ...clips, taskId: created.id } }));
    const done = await waitForGenerationTask(created.id, { initialTask: created, signal, timeoutMs: SPLIT_TIMEOUT_MS, onTaskUpdate: (task) => setProgress(id, { stage: task.stage || "切参考片段", percent: task.progress }) });
    const result = parseProductVideoSplitResult(done);
    if (result.segments.length !== missing.length) throw new Error("切出的参考片段数量不对，请重试");
    const byKey = new Map(missing.map((unit, index) => [unit.key, result.segments[index].resourceId]));
    await updateRemake(id, (value) => ({ ...value, units: value.units.map((unit) => (byKey.has(unit.key) ? { ...unit, clipResourceId: byKey.get(unit.key) } : unit)) }));
}

function unitReferences(job: RemakeJob, unit: RemakeUnit) {
    const { images } = remakeReferenceImages(job);
    const referenceImages: ReferenceImage[] = images.map((image) => ({
        id: image.id,
        name: image.name || "参考图.png",
        type: "image/png",
        dataUrl: "",
        storageKey: resourceStorageKey(image.resourceId),
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
    }));
    const referenceVideos: ReferenceVideo[] =
        unit.treatment === "replace" && unit.clipResourceId ? [{ id: `clip-${unit.key}`, name: "参考片段.mp4", type: "video/mp4", url: "", storageKey: resourceStorageKey(unit.clipResourceId), durationMs: unit.clipEndMs - unit.clipStartMs }] : [];
    return { referenceImages, referenceVideos };
}

async function unitStep(id: string, key: string, config: AiConfig, signal: AbortSignal) {
    let job = read(id);
    let unit = job.units.find((item) => item.key === key);
    if (!unit || unit.status === "succeeded") return;
    let task: GenerationTask | undefined;
    if (unit.taskId) {
        task = await queryGenerationTask(unit.taskId, { signal });
        if (terminal(task)) {
            await updateRemake(id, patchUnit(key, { status: "failed", error: task.error || "生成失败", taskId: undefined }));
            return;
        }
    }
    if (!task) {
        const limits = limitsOf(config, job);
        if (unit.treatment === "replace" && !unit.clipResourceId) throw new Error("参考片段还没切好");
        const shots = job.shots.filter((shot) => unit!.shotIndexes.includes(shot.index));
        const length = unit.treatment === "replace" ? unit.clipEndMs - unit.clipStartMs : unit.endMs - unit.startMs;
        const seconds = productVideoShotSeconds(length, limits.durations);
        // 只有改写口播让视频模型出声；AI 配音另配，视频静音。
        const speaks = job.audio === "rewrite" && shots.some((shot) => shot.dialogue.trim());
        const { referenceImages, referenceVideos } = unitReferences(job, unit);
        await updateRemake(id, patchUnit(key, { status: "running", error: undefined }));
        task = await submitBackendGenerationTask({
            mode: "video",
            prompt: buildRemakeUnitPrompt(job, unit, shots, seconds),
            config: productVideoGenerationConfig(config, { model: job.model, ratio: job.ratio, resolution: job.resolution, seconds, audio: speaks ? "model" : "mute" }),
            referenceImages,
            referenceVideos,
            signal,
            clientOperationId: `${id}-${key}-${unit.attempt}`,
            metadata: { source: "video-remake", remakeId: id, remakeUnit: key },
        });
        await updateRemake(id, patchUnit(key, { status: "running", taskId: task.id }));
        job = read(id);
        unit = job.units.find((item) => item.key === key)!;
    }
    try {
        const done = await waitForGenerationTask(task.id, {
            initialTask: task,
            signal,
            timeoutMs: VIDEO_TIMEOUT_MS,
            onTaskUpdate: (item) => typeof item.progress === "number" && setProgress(id, { units: { [key]: Math.round(item.progress) } }),
        });
        const result = parseBackendGenerationResult(done);
        const resourceId = resourceIdFromStorageKey(result.video?.storageKey);
        if (!resourceId) throw new Error("任务完成但没有可用的视频，请到任务中心核对");
        const takeItem = {
            taskId: done.id,
            resourceId,
            createdAt: new Date().toISOString(),
            ...(result.video?.durationMs ? { durationMs: result.video.durationMs } : {}),
            ...(result.video?.width ? { width: result.video.width } : {}),
            ...(result.video?.height ? { height: result.video.height } : {}),
        };
        await updateRemake(
            id,
            patchUnit(key, (value) => {
                const takes = [...value.takes.filter((item) => item.taskId !== done.id), takeItem];
                return { status: "succeeded", error: undefined, taskId: undefined, takes, chosen: takes.length - 1 };
            }),
        );
    } catch (error) {
        if (signal.aborted) throw error;
        await updateRemake(id, patchUnit(key, { status: "failed", error: errorMessage(error, "生成失败"), taskId: undefined }));
    }
}

async function generateStep(id: string, config: AiConfig, signal: AbortSignal) {
    const queue = read(id)
        .units.filter((unit) => unit.status === "pending" || unit.status === "running")
        .map((unit) => unit.key);
    const report = () => {
        const job = read(id);
        const done = job.units.filter((unit) => unit.status === "succeeded").length;
        setProgress(id, { stage: `生成 ${done}/${job.units.length} 段`, percent: job.units.length ? Math.round((done / job.units.length) * 100) : undefined });
    };
    report();
    const worker = async () => {
        for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
            try {
                await unitStep(id, key, config, signal);
            } catch (error) {
                if (signal.aborted) throw error;
                await updateRemake(id, patchUnit(key, { status: "failed", error: errorMessage(error, "提交失败") }));
            }
            report();
        }
    };
    await Promise.all(Array.from({ length: Math.min(UNIT_CONCURRENCY, queue.length) }, worker));
}

/** 配音任务的生成参数：按一个音频节点走通用的模型路由，音色、语速和（豆包的）语种来自作品。 */
export function remakeVoiceConfig(config: AiConfig, job: Pick<RemakeJob, "voice" | "language">) {
    const probe = { ...config, model: job.voice.model, audioModel: job.voice.model };
    const node = {
        id: "remake-voice",
        type: CanvasNodeType.Audio,
        title: "",
        width: 0,
        height: 0,
        position: { x: 0, y: 0 },
        metadata: { model: job.voice.model, audioVoice: job.voice.voice, audioSpeed: job.voice.speed || "1", audioFormat: "mp3", audioLanguage: isDoubaoAudioConfig(probe) ? remakeLanguage(job.language).tts : "" },
    } as unknown as CanvasNodeData;
    return buildGenerationConfig(config, node, "audio");
}

function patchVoice(shotIndex: number, patch: Partial<RemakeVoiceLine>) {
    return (job: RemakeJob): RemakeJob => ({ ...job, voiceLines: job.voiceLines.map((line) => (line.shotIndex === shotIndex ? { ...line, ...patch } : line)) });
}

async function voiceLineStep(id: string, shotIndex: number, config: AiConfig, signal: AbortSignal) {
    const job = read(id);
    const line = job.voiceLines.find((item) => item.shotIndex === shotIndex);
    if (!line || line.status === "succeeded") return;
    let task: GenerationTask | undefined = line.taskId ? await queryGenerationTask(line.taskId, { signal }) : undefined;
    if (task && terminal(task)) task = undefined;
    if (!task) {
        await updateRemake(id, patchVoice(shotIndex, { status: "running", error: undefined }));
        task = await submitBackendGenerationTask({
            mode: "audio",
            prompt: line.text,
            config: remakeVoiceConfig(config, job),
            signal,
            clientOperationId: `${id}-voice-${shotIndex}-${line.attempt}`,
            metadata: { source: "video-remake", remakeId: id, remakeVoice: shotIndex },
        });
        await updateRemake(id, patchVoice(shotIndex, { status: "running", taskId: task.id }));
    }
    try {
        const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: VOICE_TIMEOUT_MS });
        const result = parseBackendGenerationResult(done);
        const resourceId = resourceIdFromStorageKey(result.audio?.storageKey);
        if (!resourceId) throw new Error("配音任务完成但没有可用的音频，请到任务中心核对");
        await updateRemake(id, patchVoice(shotIndex, { status: "succeeded", taskId: undefined, error: undefined, resourceId, ...(result.audio?.durationMs ? { durationMs: result.audio.durationMs } : {}) }));
    } catch (error) {
        if (signal.aborted) throw error;
        await updateRemake(id, patchVoice(shotIndex, { status: "failed", taskId: undefined, error: errorMessage(error, "配音失败") }));
    }
}

/** AI 配音：按当前台词排好要配的句子（签名没变的沿用），没配好的每句一个音频任务，最多 3 句并行。 */
async function voiceStep(id: string, config: AiConfig, signal: AbortSignal) {
    const job = read(id);
    const plan = remakeVoicePlan(job);
    if (!plan.length) return;
    const lines: RemakeVoiceLine[] = plan.map((item) => job.voiceLines.find((line) => line.shotIndex === item.shotIndex && line.signature === item.signature) || { ...item, status: "pending", attempt: 1 });
    await updateRemake(id, (value) => ({ ...value, voiceLines: lines }));
    const queue = lines.filter((line) => line.status !== "succeeded").map((line) => line.shotIndex);
    if (!queue.length) return;
    const report = () => {
        const current = read(id).voiceLines;
        setProgress(id, { stage: `配音 ${current.filter((line) => line.status === "succeeded").length}/${current.length} 句` });
    };
    report();
    const worker = async () => {
        for (let shotIndex = queue.shift(); shotIndex !== undefined; shotIndex = queue.shift()) {
            try {
                await voiceLineStep(id, shotIndex, config, signal);
            } catch (error) {
                if (signal.aborted) throw error;
                await updateRemake(id, patchVoice(shotIndex, { status: "failed", error: errorMessage(error, "提交失败") }));
            }
            report();
        }
    };
    await Promise.all(Array.from({ length: Math.min(UNIT_CONCURRENCY, queue.length) }, worker));
    const failed = read(id).voiceLines.filter((line) => line.status !== "succeeded");
    if (failed.length) throw new Error(`有 ${failed.length} 句配音没有生成成功：${failed[0].error || "请重试"}`);
}

/** 烧录字幕：按成片画幅把每句台词画成整幅透明 PNG 存成素材；台词和画幅都没变时沿用上次画好的。 */
async function subtitleStep(id: string, size: { width: number; height: number }, signal: AbortSignal) {
    const job = read(id);
    if (!job.subtitles.burn) return;
    const lines = remakeLines(job);
    if (!lines.length) return;
    const signature = remakeSubtitleSignature(lines, size);
    if (job.subtitleImages?.signature === signature) return;
    setProgress(id, { stage: "画字幕" });
    const items: { shotIndex: number; resourceId: string }[] = [];
    for (const line of lines) {
        if (signal.aborted) throw new DOMException("已停止", "AbortError");
        const blob = await drawRemakeSubtitle(line.text, size);
        const file = new File([blob], `字幕-镜头${line.shotIndex}.png`, { type: "image/png" });
        const resource = await uploadResourceFile(file, "image", { fileName: file.name, width: size.width, height: size.height });
        items.push({ shotIndex: line.shotIndex, resourceId: resource.id });
    }
    await updateRemake(id, (value) => ({ ...value, subtitleImages: { signature, items } }));
}

async function assembleStep(id: string, config: AiConfig, signal: AbortSignal) {
    let job = read(id);
    if (job.render?.resourceId) return;
    const size = remakeRenderSize(job);
    await voiceStep(id, config, signal);
    await subtitleStep(id, size, signal);
    job = read(id);
    setProgress(id, { stage: "拼接成片" });
    let task = job.render?.taskId ? await queryGenerationTask(job.render.taskId, { signal }) : undefined;
    if (!task || terminal(task)) {
        task = await createTimelineRenderTask({ projectId: "", timeline: remakeTimeline(job, size) }, signal);
        await updateRemake(id, (value) => ({ ...value, render: { taskId: task!.id } }));
    }
    const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: RENDER_TIMEOUT_MS, intervalMs: 3000, onTaskUpdate: (item) => setProgress(id, { stage: "拼接成片", percent: item.progress }) });
    const parsed = JSON.parse(done.resultJson || "{}") as TimelineRenderResult;
    if (!parsed.resourceId) throw new Error("拼接任务没有返回成片");
    await updateRemake(id, (value) => ({
        ...value,
        status: "succeeded",
        error: undefined,
        render: { taskId: task!.id, resourceId: parsed.resourceId, ...(parsed.durationMs ? { durationMs: parsed.durationMs } : {}), width: size.width, height: size.height },
    }));
}

/** 跑一条作品：有缺的片段先切，有待生成的单元就生成，全部有候选后拼成片。已经在跑时什么也不做。 */
export function runRemake(id: string, config: AiConfig) {
    if (controllers.has(id)) return;
    const controller = new AbortController();
    const scope = getActiveUserScope();
    controllers.set(id, controller);
    setActive(id, true);
    void (async () => {
        try {
            if (read(id).status !== "assembling") {
                await clipStep(id, controller.signal);
                await updateRemake(id, (value) => ({ ...value, status: "generating", error: undefined }));
                await generateStep(id, config, controller.signal);
                const failed = read(id).units.filter((unit) => unit.status !== "succeeded");
                if (failed.length) {
                    await updateRemake(id, (value) => ({ ...value, status: "failed", error: `有 ${failed.length} 段没有生成成功，可以写下问题单独重做` }));
                    return;
                }
                await updateRemake(id, (value) => ({ ...value, status: "assembling", error: undefined }));
            }
            await assembleStep(id, config, controller.signal);
        } catch (error) {
            if (controller.signal.aborted || getActiveUserScope() !== scope || !readRemake(id)) return;
            await updateRemake(id, (value) => ({ ...value, status: "failed", error: errorMessage(error, "生成失败") })).catch(() => undefined);
        } finally {
            controllers.delete(id);
            setActive(id, false);
            setProgress(id, undefined);
        }
    })();
}

/** 开始生成：按当前做法排好单元（沿用没变的），清掉旧成片，再跑。 */
export async function startRemake(id: string, config: AiConfig, credits?: number) {
    const job = read(id);
    const units = remakeUnitsFor(job, config);
    await updateRemake(id, (value) => ({
        ...value,
        units,
        status: units.some((unit) => unit.treatment === "replace" && !unit.clipResourceId) ? "clipping" : "generating",
        error: undefined,
        render: undefined,
        ...(credits !== undefined ? { credits } : {}),
    }));
    runRemake(id, config);
}

export async function stopRemake(id: string) {
    controllers.get(id)?.abort();
    const job = readRemake(id);
    if (!job) return;
    const running = [
        job.status === "clipping" ? job.clips?.taskId : undefined,
        ...job.units.filter((unit) => unit.status === "running").map((unit) => unit.taskId),
        ...job.voiceLines.filter((line) => line.status === "running").map((line) => line.taskId),
        job.render?.resourceId ? undefined : job.render?.taskId,
    ].filter((taskId): taskId is string => Boolean(taskId));
    await Promise.all(running.map((taskId) => cancelGenerationTask(taskId).catch(() => undefined)));
    await updateRemake(id, (value) => ({
        ...value,
        status: "failed",
        error: "已停止",
        units: value.units.map((unit) => (unit.status === "running" ? { ...unit, status: "failed", error: "已停止", taskId: undefined } : unit)),
        voiceLines: value.voiceLines.map((line) => (line.status === "running" ? { ...line, status: "failed", error: "已停止", taskId: undefined } : line)),
        render: value.render?.resourceId ? value.render : undefined,
    }));
}

/** 定向重做一段：带上这次要修正的问题，保留已有候选，新候选生成好后自动选中。 */
export async function redoRemakeUnit(id: string, key: string, fix: string, config: AiConfig) {
    await updateRemake(id, (value) => ({
        ...patchUnit(key, (unit) => ({ status: "pending", attempt: unit.attempt + 1, error: undefined, taskId: undefined, ...(fix.trim() ? { fix: fix.trim() } : { fix: undefined }) }))(value),
        status: "generating",
        error: undefined,
        render: undefined,
    }));
    runRemake(id, config);
}

/** 接着生成：失败的段换一次新的生成，拼接失败的重新拼。 */
export async function retryRemake(id: string, config: AiConfig) {
    await updateRemake(id, (value) => ({
        ...value,
        status: "generating",
        error: undefined,
        units: value.units.map((unit) => (unit.status === "failed" ? { ...unit, status: "pending", attempt: unit.attempt + 1, error: undefined, taskId: undefined } : unit)),
        voiceLines: value.voiceLines.map((line) => (line.status === "failed" ? { ...line, status: "pending", attempt: line.attempt + 1, error: undefined, taskId: undefined } : line)),
        render: value.render?.resourceId ? value.render : undefined,
    }));
    runRemake(id, config);
}

/** 换一条候选：成片要重新拼。 */
export async function chooseRemakeTake(id: string, key: string, index: number) {
    // 成片清掉，页面提示重新拼；作品状态不变。
    await updateRemake(id, (value) => ({ ...patchUnit(key, { chosen: index })(value), render: undefined }));
}

/** 只重新拼成片（换了候选之后）。 */
export async function assembleRemake(id: string, config: AiConfig) {
    await updateRemake(id, (value) => ({ ...value, status: "assembling", error: undefined, render: undefined }));
    runRemake(id, config);
}

export function resumeRemakes(jobs: readonly RemakeJob[], config: AiConfig) {
    for (const job of jobs) if (REMAKE_ACTIVE.includes(job.status) && !controllers.has(job.id)) runRemake(job.id, config);
}

export function isRemakeRunning(id: string) {
    return controllers.has(id);
}
