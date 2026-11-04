import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { videoReplicationAnalysisDocument, type VideoTeardownOptions } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { getResource, uploadResourceFile } from "@/services/api/resources";
import { createSocialVideoImport, parseSocialVideoImportResult, socialVideoURLFromText, validateSocialVideoResource } from "@/services/api/social-video";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { createVideoTeardown, getVideoReplication, parseVideoTeardownBundle, saveVideoReplicationAnalysis, type VideoTeardownBundle } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import { analyzeVideoTeardown } from "./replication-analysis";

/** 拆解哪段视频：平台分享链接，或本地视频文件。 */
export type ReplicationSource = { kind: "link"; text: string } | { kind: "file"; file: File };

/** 页面上正在跑的一次拆解；id 是拆解任务 ID，建好任务之前为空。 */
export type ReplicationRun = { id?: string; step: string; detail: string; error?: string };

const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
const TEARDOWN_TIMEOUT_MS = 11 * 60 * 1000;
const MAX_DURATION_MS = 180_000;

export const videoReplicationKeys = {
    list: (scope: string) => ["video-replications", scope] as const,
    detail: (scope: string, id: string) => ["video-replication", scope, id] as const,
};

function isAbort(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}

function percent(task: GenerationTask) {
    return typeof task.progress === "number" ? ` ${Math.round(Math.min(Math.max(task.progress, 0), 100))}%` : "";
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

/**
 * 视频复刻页面的一次拆解：导入或上传视频 → 后端切镜抽帧 → 看图模型逐镜分析 → 分析结果存回服务端。
 * 同一时间只跑一个；页面卸载或切换账号时中止，不把结果写到别的账号。
 */
export function useReplicationRunner({ config, onRecord }: { config: AiConfig; onRecord: (id: string) => void }) {
    const queryClient = useQueryClient();
    const [run, setRun] = useState<ReplicationRun | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const onRecordRef = useRef(onRecord);
    onRecordRef.current = onRecord;

    useEffect(() => () => controllerRef.current?.abort(), []);

    const refresh = useCallback(
        (scope: string, id?: string) => {
            void queryClient.invalidateQueries({ queryKey: videoReplicationKeys.list(scope) });
            if (id) void queryClient.invalidateQueries({ queryKey: videoReplicationKeys.detail(scope, id) });
        },
        [queryClient],
    );

    const execute = useCallback(
        async (body: (context: { signal: AbortSignal; scope: string; assertCurrent: () => void; update: (patch: Partial<ReplicationRun>) => void }) => Promise<void>) => {
            if (controllerRef.current) return;
            const controller = new AbortController();
            controllerRef.current = controller;
            const scope = getActiveUserScope();
            const assertCurrent = () => {
                if (!controller.signal.aborted && getActiveUserScope() !== scope) controller.abort();
                if (controller.signal.aborted) throw new DOMException("拆解已中止", "AbortError");
            };
            let current: ReplicationRun = { step: "准备", detail: "" };
            const update = (patch: Partial<ReplicationRun>) => {
                current = { ...current, ...patch };
                setRun(current);
            };
            update({});
            try {
                await body({ signal: controller.signal, scope, assertCurrent, update });
                setRun(null);
            } catch (error) {
                if (isAbort(error)) setRun(null);
                else update({ error: error instanceof Error ? error.message : "视频拆解失败" });
                refresh(scope, current.id);
            } finally {
                controllerRef.current = null;
            }
        },
        [refresh],
    );

    const analyzeAndSave = useCallback(
        async (id: string, bundle: VideoTeardownBundle, options: VideoTeardownOptions, fallbackTitle: string, context: { signal: AbortSignal; scope: string; assertCurrent: () => void; update: (patch: Partial<ReplicationRun>) => void }) => {
            context.update({ step: "模型分析", detail: `已切出 ${bundle.shots.length} 个镜头` });
            const analysis = await analyzeVideoTeardown(bundle, { config, model: options.model, fallbackTitle, signal: context.signal, expectedScope: context.scope, onProgress: (detail) => context.update({ detail }) });
            context.assertCurrent();
            context.update({ step: "保存结果", detail: "" });
            await saveVideoReplicationAnalysis(id, videoReplicationAnalysisDocument(analysis, options.model), context.signal);
            context.assertCurrent();
            refresh(context.scope, id);
        },
        [config, refresh],
    );

    const start = useCallback(
        (source: ReplicationSource, options: VideoTeardownOptions) =>
            execute(async (context) => {
                const { signal, assertCurrent, update } = context;
                let resourceId = "";
                let fallbackTitle = "";
                if (source.kind === "link") {
                    const url = socialVideoURLFromText(source.text);
                    if (!url) throw new Error("只支持抖音和 TikTok 的单视频链接或分享文字");
                    update({ step: "导入视频", detail: "提交下载任务" });
                    const created = await createSocialVideoImport(url, undefined, signal);
                    assertCurrent();
                    const task = await waitForGenerationTask(created.id, { initialTask: created, signal, timeoutMs: IMPORT_TIMEOUT_MS, onTaskUpdate: (item) => update({ detail: `下载并校验视频${percent(item)}` }) });
                    assertCurrent();
                    const result = parseSocialVideoImportResult(task);
                    const resource = validateSocialVideoResource(result, await getResource(result.resourceId));
                    assertCurrent();
                    resourceId = resource.id;
                    fallbackTitle = result.title.trim();
                } else {
                    const info = await readVideoFileInfo(source.file);
                    if (info.durationMs > MAX_DURATION_MS) throw new Error("视频超过 3 分钟，请先剪短再拆解");
                    update({ step: "上传视频", detail: "0%" });
                    const resource = await uploadResourceFile(source.file, "video", { ...info, fileName: source.file.name }, (uploaded, total) => update({ detail: total ? `${Math.round((uploaded / total) * 100)}%` : "" }), {
                        signal,
                        expectedScope: context.scope,
                    });
                    assertCurrent();
                    resourceId = resource.id;
                    fallbackTitle = source.file.name.replace(/\.[^.]+$/, "");
                }
                update({ step: "切镜头、截关键帧", detail: "提交拆解任务" });
                const created = await createVideoTeardown({ resourceId, transcribe: options.transcribe }, signal);
                assertCurrent();
                update({ id: created.id });
                onRecordRef.current(created.id);
                refresh(context.scope, created.id);
                const task = await waitForGenerationTask(created.id, { initialTask: created, signal, timeoutMs: TEARDOWN_TIMEOUT_MS, onTaskUpdate: (item) => update({ detail: `${item.stage || "切镜、截取关键帧"}${percent(item)}` }) });
                assertCurrent();
                await analyzeAndSave(created.id, parseVideoTeardownBundle(task), options, fallbackTitle, context);
            }),
        [analyzeAndSave, execute, refresh],
    );

    /** 拆解已完成但没分析完（或想换个模型重来）：直接用保存的镜头事实再分析一次。 */
    const reanalyze = useCallback(
        (id: string, options: VideoTeardownOptions, fallbackTitle: string) =>
            execute(async (context) => {
                context.update({ id, step: "读取拆解结果", detail: "" });
                const detail = await getVideoReplication(id, context.signal);
                context.assertCurrent();
                await analyzeAndSave(id, parseVideoTeardownBundle(detail.task), options, fallbackTitle, context);
            }),
        [analyzeAndSave, execute],
    );

    const dismiss = useCallback(() => setRun((current) => (current?.error ? null : current)), []);

    return { run, running: Boolean(run && !run.error), start, reanalyze, dismiss };
}
