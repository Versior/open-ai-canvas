import { useEffect } from "react";
import { create } from "zustand";

import { appQueryClient } from "@/lib/query-client";
import { videoReplicationAnalysisDocument, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { getActiveUserScope, scopedLocalStorage } from "@/lib/user-scope";
import { getResource, uploadResourceFile } from "@/services/api/resources";
import { createSocialVideoImport, parseSocialVideoImportResult, socialVideoURLFromText, validateSocialVideoResource } from "@/services/api/social-video";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { createVideoTeardown, getVideoReplication, parseVideoTeardownBundle, saveVideoReplicationAnalysis, type VideoReplicationRecord, type VideoTeardownBundle } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import { analyzeVideoTeardown } from "./replication-analysis";

/** 拆解哪段视频：平台分享链接，或本地视频文件。 */
export type ReplicationSource = { kind: "link"; text: string } | { kind: "file"; file: File };

/** 一次拆解走到哪一步；页面按它画步骤条。 */
export type ReplicationStage = "import" | "upload" | "teardown" | "analyze" | "save";

export const REPLICATION_STAGE_LABELS: Record<ReplicationStage, string> = { import: "导入视频", upload: "上传视频", teardown: "切镜头、截关键帧", analyze: "模型分析", save: "保存结果" };

/** 正在跑（或刚失败）的一次拆解；id 是拆解任务 ID，建好任务之前为空。 */
export type ReplicationRun = { id?: string; stage: ReplicationStage; detail: string; percent?: number; error?: string; resumed?: boolean };

/**
 * 记在本机的未完成分析：拆解任务已经建好，但分析结果还没存回服务端。
 * 页面刷新或关掉后再打开时据此接着跑；textTasks 记着已提交的文本任务，接回时等它们的结果，不重复扣费。
 */
type PendingReplication = { id: string; model: string; transcribe: boolean; fallbackTitle: string; startedAt: number; textTasks: Record<string, string> };

const PENDING_KEY = "video-replication:pending";
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
const TEARDOWN_TIMEOUT_MS = 11 * 60 * 1000;
const MAX_DURATION_MS = 180_000;

export const videoReplicationKeys = {
    list: (scope: string) => ["video-replications", scope] as const,
    detail: (scope: string, id: string) => ["video-replication", scope, id] as const,
};

const useReplicationRunStore = create<{ run: ReplicationRun | null }>(() => ({ run: null }));

// 运行状态放在模块里而不是页面组件里：离开页面（去画布、素材库）拆解照样跑，回来还能看到进度。
// 只有账号切换会中止（每一步都核对当前账号）。
let controller: AbortController | null = null;
let recordListener: ((id: string) => void) | null = null;

function readPending(): PendingReplication[] {
    try {
        const value: unknown = JSON.parse(scopedLocalStorage.getItem(PENDING_KEY) || "[]");
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is PendingReplication => Boolean(item) && typeof item.id === "string" && typeof item.model === "string" && typeof item.startedAt === "number" && Date.now() - item.startedAt < PENDING_MAX_AGE_MS);
    } catch {
        return [];
    }
}

function writePending(items: PendingReplication[]) {
    if (items.length) scopedLocalStorage.setItem(PENDING_KEY, JSON.stringify(items));
    else scopedLocalStorage.removeItem(PENDING_KEY);
}

function updatePending(id: string, update: (item: PendingReplication | undefined) => PendingReplication | undefined) {
    const items = readPending();
    const next = update(items.find((item) => item.id === id));
    writePending([...items.filter((item) => item.id !== id), ...(next ? [next] : [])]);
}

function isAbort(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}

function taskPercent(task: GenerationTask) {
    return typeof task.progress === "number" ? Math.round(Math.min(Math.max(task.progress, 0), 100)) : undefined;
}

function refresh(scope: string, id?: string) {
    void appQueryClient.invalidateQueries({ queryKey: videoReplicationKeys.list(scope) });
    if (id) void appQueryClient.invalidateQueries({ queryKey: videoReplicationKeys.detail(scope, id) });
}

/** 上传前在浏览器里读出尺寸和时长：超过 3 分钟直接拦下，不白传。 */
function readVideoFileInfo(file: File): Promise<{ width: number; height: number; durationMs: number }> {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("读取视频信息超时，请确认文件可以播放")), 15_000);
        video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) reject(new Error("无法读取视频尺寸或时长"));
            else resolve({ width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(video.duration * 1000) });
        };
        video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("无法读取视频，请确认格式受浏览器支持"));
        };
        video.src = url;
    }).finally(() => URL.revokeObjectURL(url));
}

type RunContext = { signal: AbortSignal; scope: string; assertCurrent: () => void; update: (patch: Partial<ReplicationRun>) => void };

async function execute(initial: ReplicationRun, body: (context: RunContext) => Promise<void>) {
    if (controller) return;
    const current = new AbortController();
    controller = current;
    const scope = getActiveUserScope();
    const assertCurrent = () => {
        if (!current.signal.aborted && getActiveUserScope() !== scope) current.abort();
        if (current.signal.aborted) throw new DOMException("拆解已中止", "AbortError");
    };
    let run = initial;
    const update = (patch: Partial<ReplicationRun>) => {
        run = { ...run, ...patch };
        if (controller === current) useReplicationRunStore.setState({ run });
    };
    update({});
    try {
        await body({ signal: current.signal, scope, assertCurrent, update });
        useReplicationRunStore.setState({ run: null });
    } catch (error) {
        if (isAbort(error)) useReplicationRunStore.setState({ run: null });
        else update({ error: error instanceof Error ? error.message : "视频拆解失败" });
        refresh(scope, run.id);
    } finally {
        if (controller === current) controller = null;
    }
}

/** 等拆解任务完成 → 分析 → 存回服务端；成功或确定失败后清掉本机的未完成记录。 */
async function finishReplication(pending: PendingReplication, config: AiConfig, context: RunContext, initialTask?: GenerationTask) {
    const { id } = pending;
    context.update({ id, stage: "teardown", detail: "切镜头、截关键帧" });
    const task = await waitForGenerationTask(id, { initialTask, signal: context.signal, timeoutMs: TEARDOWN_TIMEOUT_MS, onTaskUpdate: (item) => context.update({ detail: item.stage || "切镜头、截关键帧", percent: taskPercent(item) }) });
    context.assertCurrent();
    const bundle: VideoTeardownBundle = parseVideoTeardownBundle(task);
    context.update({ stage: "analyze", detail: `已切出 ${bundle.shots.length} 个镜头`, percent: undefined });
    try {
        const analysis = await analyzeVideoTeardown(bundle, {
            config,
            model: pending.model,
            fallbackTitle: pending.fallbackTitle,
            signal: context.signal,
            expectedScope: context.scope,
            onProgress: (detail) => context.update({ detail }),
            existingTask: (key) => readPending().find((item) => item.id === id)?.textTasks[key],
            onTaskCreated: (key, taskId) => updatePending(id, (item) => (item ? { ...item, textTasks: { ...item.textTasks, [key]: taskId } } : item)),
        });
        context.assertCurrent();
        context.update({ stage: "save", detail: "" });
        await saveVideoReplicationAnalysis(id, videoReplicationAnalysisDocument(analysis, pending.model), context.signal);
        context.assertCurrent();
    } catch (error) {
        // 中止（切换账号）时留着记录，下次回到这个账号还能接上；分析本身失败就不再自动重跑，等用户点「重新分析」。
        if (!isAbort(error)) updatePending(id, () => undefined);
        throw error;
    }
    updatePending(id, () => undefined);
    refresh(context.scope, id);
}

export function startReplication(source: ReplicationSource, options: VideoTeardownOptions, config: AiConfig) {
    return execute({ stage: source.kind === "link" ? "import" : "upload", detail: "" }, async (context) => {
        const { signal, assertCurrent, update } = context;
        let resourceId = "";
        let fallbackTitle = "";
        if (source.kind === "link") {
            const url = socialVideoURLFromText(source.text);
            if (!url) throw new Error("只支持抖音和 TikTok 的单视频链接或分享文字");
            update({ detail: "提交下载任务" });
            const created = await createSocialVideoImport(url, undefined, signal);
            assertCurrent();
            const task = await waitForGenerationTask(created.id, { initialTask: created, signal, timeoutMs: IMPORT_TIMEOUT_MS, onTaskUpdate: (item) => update({ detail: "下载并校验视频", percent: taskPercent(item) }) });
            assertCurrent();
            const result = parseSocialVideoImportResult(task);
            const resource = validateSocialVideoResource(result, await getResource(result.resourceId));
            assertCurrent();
            resourceId = resource.id;
            fallbackTitle = result.title.trim();
        } else {
            const info = await readVideoFileInfo(source.file);
            if (info.durationMs > MAX_DURATION_MS) throw new Error("视频超过 3 分钟，请先剪短再拆解");
            update({ detail: source.file.name, percent: 0 });
            const resource = await uploadResourceFile(source.file, "video", { ...info, fileName: source.file.name }, (uploaded, total) => update({ percent: total ? Math.round((uploaded / total) * 100) : undefined }), {
                signal,
                expectedScope: context.scope,
            });
            assertCurrent();
            resourceId = resource.id;
            fallbackTitle = source.file.name.replace(/\.[^.]+$/, "");
        }
        update({ stage: "teardown", detail: "提交拆解任务", percent: undefined });
        const created = await createVideoTeardown({ resourceId, transcribe: options.transcribe }, signal);
        assertCurrent();
        const pending: PendingReplication = { id: created.id, model: options.model, transcribe: options.transcribe, fallbackTitle, startedAt: Date.now(), textTasks: {} };
        updatePending(created.id, () => pending);
        update({ id: created.id });
        recordListener?.(created.id);
        refresh(context.scope, created.id);
        await finishReplication(pending, config, context, created);
    });
}

/** 拆解已完成但没分析完（或想换个模型重来）：直接用保存的镜头事实再分析一次。 */
export function reanalyzeReplication(id: string, options: VideoTeardownOptions, fallbackTitle: string, config: AiConfig) {
    return execute({ id, stage: "analyze", detail: "读取拆解结果" }, async (context) => {
        const detail = await getVideoReplication(id, context.signal);
        context.assertCurrent();
        const pending: PendingReplication = { id, model: options.model, transcribe: options.transcribe, fallbackTitle, startedAt: Date.now(), textTasks: {} };
        updatePending(id, () => pending);
        await finishReplication(pending, config, context, detail.task);
    });
}

/**
 * 打开页面时接着跑上次没跑完的拆解（刷新、关页面都会打断浏览器里的分析）。
 * 拆解失败或已经有分析的记录直接清掉；一次只接一条，接完下一条等下次打开页面或本次结束后再看。
 */
export function resumePendingReplication(records: VideoReplicationRecord[], config: AiConfig) {
    if (controller) return;
    const byId = new Map(records.map((record) => [record.id, record]));
    const pending = readPending().filter((item) => {
        const record = byId.get(item.id);
        if (!record) return false;
        const resumable = !record.analyzedAt && (record.status === "queued" || record.status === "running" || record.status === "succeeded");
        if (!resumable) updatePending(item.id, () => undefined);
        return resumable;
    });
    const next = pending.sort((left, right) => right.startedAt - left.startedAt)[0];
    if (!next) return;
    void execute({ id: next.id, stage: "teardown", detail: "接着上次的拆解", resumed: true }, (context) => finishReplication(next, config, context));
}

export function dismissReplicationError() {
    const { run } = useReplicationRunStore.getState();
    if (run?.error) useReplicationRunStore.setState({ run: null });
}

/** 正在跑（或刚失败）的拆解任务 ID。 */
export function useReplicationRunId() {
    return useReplicationRunStore((state) => state.run?.id || "");
}

/** 页面订阅运行状态；新建的拆解任务一出来就在页面上选中它（离开页面后不再跳转）。 */
export function useReplicationRun(onRecord: (id: string) => void) {
    const run = useReplicationRunStore((state) => state.run);
    useEffect(() => {
        recordListener = onRecord;
        return () => {
            if (recordListener === onRecord) recordListener = null;
        };
    }, [onRecord]);
    return { run, running: Boolean(run && !run.error) };
}
