import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { fashionVideoProblem, fashionVideoTimeline, fashionVideoTool, type FashionVideoUnit, type FashionVideoWork } from "@/lib/fashion/video-workflow";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { modelCompatibilityError, type ModelRequirements } from "@/lib/model-selection";
import { getActiveUserScope } from "@/lib/user-scope";
import { productVideoGenerationConfig } from "@/pages/video-replication/replace/product-video-config";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { createProductVideoSplit, parseProductVideoSplitResult } from "@/services/api/product-video";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { createTimelineRenderTask, type TimelineRenderResult } from "@/services/api/timeline-tasks";
import { isGenerationTaskTerminalError, queryGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export function fashionVideoRequirements(work: Pick<FashionVideoWork, "draft">, imageCount: number): ModelRequirements {
    const source = fashionVideoTool(work.draft.tool).source;
    return {
        capability: "video",
        videoSeconds: String(work.draft.seconds),
        input: { textCount: 1, imageCount, referenceImageCount: source ? imageCount : 0, videoCount: source ? 1 : 0, audioCount: 0, characterCount: 0, videoDurationsMs: source ? [work.draft.seconds * 1000] : [] },
    };
}
export function fashionVideoGenerationConfig(config: AiConfig, work: Pick<FashionVideoWork, "draft" | "model" | "ratio" | "resolution">, images: number) {
    if (!work.model) throw new Error("请选择视频模型");
    const profile = modelCapabilityConfigFor(config, work.model).video;
    const problem = modelCompatibilityError(config, work.model, fashionVideoRequirements(work, images));
    if (!profile || problem) throw new Error(problem || "所选模型不能执行视频生成");
    if (!videoDurationOptions(profile).includes(work.draft.seconds)) throw new Error("片段时长不符合模型能力，请重新选择");
    if (fashionVideoTool(work.draft.tool).source && profile.references.maxVideoDurationSeconds > 0 && work.draft.seconds > profile.references.maxVideoDurationSeconds)
        throw new Error(`模型参考视频最多${profile.references.maxVideoDurationSeconds}秒，请缩短片段`);
    if (work.draft.audio === "model" && !profile.generateAudio.supported) throw new Error("所选模型不支持生成声音，请选择静音或原片声音");
    const selected = productVideoGenerationConfig(config, { model: work.model, ratio: work.ratio, resolution: work.resolution, seconds: work.draft.seconds, audio: work.draft.audio });
    return buildGenerationConfig(selected, undefined, "video", fashionVideoRequirements(work, images));
}

/** 快照先保存，取得任务ID后立即保存；恢复只监听原任务，未知提交沿用同一操作键。 */
export async function runFashionVideoWork(initial: FashionVideoWork, config: AiConfig, save: (work: FashionVideoWork) => Promise<FashionVideoWork>, signal: AbortSignal, expectedScope = getActiveUserScope()) {
    let work = initial;
    const check = () => {
        if (signal.aborted) throw new DOMException("已停止等待，后台任务保留", "AbortError");
        if (getActiveUserScope() !== expectedScope) throw new Error("账号已切换，结果保留在原账号任务中心");
    };
    const persist = async (next: FashionVideoWork) => {
        check();
        work = await save(next);
        check();
    };
    const patch = (id: string, change: Partial<FashionVideoUnit>) => persist({ ...work, units: work.units.map((unit) => (unit.id === id ? { ...unit, ...change } : unit)) });
    check();
    const problem = fashionVideoProblem(work.draft);
    if (problem) throw new Error(problem);
    if (fashionVideoTool(work.draft.tool).source && !work.clip?.resourceId) {
        const source = work.draft.source!;
        const clip = work.clip || { key: `clip_${work.id}` };
        if (!work.clip) await persist({ ...work, clip });
        const task = clip.taskId
            ? await queryGenerationTask(clip.taskId, { signal })
            : await createProductVideoSplit(
                  {
                      resourceId: source.resourceId,
                      startMs: work.draft.startMs,
                      endMs: work.draft.startMs + work.draft.seconds * 1000,
                      maxSegmentSeconds: Math.max(8, work.draft.seconds),
                      ranges: [{ startMs: work.draft.startMs, endMs: work.draft.startMs + work.draft.seconds * 1000 }],
                  },
                  clip.key,
                  signal,
              );
        await persist({ ...work, clip: { ...clip, taskId: task.id } });
        const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: 11 * 60_000 });
        const result = parseProductVideoSplitResult(done);
        const segment = result.segments[0];
        if (result.segments.length !== 1 || segment.startMs !== work.draft.startMs || segment.endMs !== work.draft.startMs + work.draft.seconds * 1000 || Math.abs(segment.durationMs - work.draft.seconds * 1000) > 100)
            throw new Error("原视频片段没有按选定范围切出，生成未执行");
        await persist({ ...work, clip: { ...work.clip!, resourceId: result.segments[0].resourceId, hasAudio: result.hasAudio } });
    }
    if (work.draft.audio === "original" && work.clip?.hasAudio !== true) throw new Error("所选原片没有音轨，尚未提交模型；请创建静音或模型声音的新版本");
    for (const original of work.units) {
        if (original.status === "succeeded" || original.status === "failed") continue;
        try {
            check();
            let unit = work.units.find((item) => item.id === original.id)!;
            if (!unit.resourceId) {
                const images: ReferenceImage[] = unit.references.map((image) => ({
                    id: image.resourceId,
                    name: image.name,
                    type: "image/png",
                    dataUrl: "",
                    storageKey: resourceStorageKey(image.resourceId),
                    ...(work.draft.tool === "showcase" ? { role: "first_frame" as const } : {}),
                }));
                const generation = unit.taskId ? config : fashionVideoGenerationConfig(config, work, images.length);
                await patch(unit.id, { status: unit.taskId ? "running" : "submitting", error: undefined });
                const task = unit.taskId
                    ? await queryGenerationTask(unit.taskId, { signal })
                    : await submitBackendGenerationTask({
                          mode: "video",
                          config: generation,
                          prompt: unit.prompt,
                          referenceImages: images,
                          referenceVideos:
                              fashionVideoTool(work.draft.tool).source && work.clip?.resourceId
                                  ? [{ id: work.clip.resourceId, name: "选定动作片段", type: "video/mp4", url: "", storageKey: resourceStorageKey(work.clip.resourceId), durationMs: work.draft.seconds * 1000 }]
                                  : [],
                          signal,
                          expectedUserScope: expectedScope,
                          clientOperationId: `fashion-video-${unit.id}`,
                          metadata: { source: "fashion-video-workbench", workId: work.id, unitId: unit.id, tool: work.draft.tool },
                      });
                await patch(unit.id, { taskId: task.id, status: "running" });
                const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: 35 * 60_000 });
                const video = parseBackendGenerationResult(done).video;
                const resourceId = resourceIdFromStorageKey(video?.storageKey);
                if (!resourceId || !video?.durationMs || !video.width || !video.height) throw new Error("视频任务缺少成品资源、实际时长或尺寸，请到任务中心检查；原任务保留");
                await patch(unit.id, { resourceId, durationMs: video.durationMs, width: video.width, height: video.height });
                unit = work.units.find((item) => item.id === unit.id)!;
            }
            if (!unit.render?.resourceId) {
                const timeline = fashionVideoTimeline(work, unit);
                if (unit.render?.started && !unit.render.taskId) throw new Error("渲染提交尚未确认，请先在任务中心确认并关联原渲染任务，不自动重复合成");
                if (!unit.render) await patch(unit.id, { status: "rendering", render: { started: true } });
                const renderTask = unit.render?.taskId ? await queryGenerationTask(unit.render.taskId, { signal }) : await createTimelineRenderTask({ projectId: "", timeline }, signal);
                await patch(unit.id, { status: "rendering", render: { started: true, taskId: renderTask.id } });
                const done = await waitForGenerationTask(renderTask.id, { initialTask: renderTask, signal, timeoutMs: 20 * 60_000 });
                const result = JSON.parse(done.resultJson || "{}") as TimelineRenderResult;
                if (!result.resourceId) throw new Error("合成任务没有返回可用视频，原任务保留");
                await patch(unit.id, { status: "succeeded", render: { started: true, taskId: renderTask.id, resourceId: result.resourceId }, error: undefined });
            } else if (unit.status !== "succeeded") await patch(unit.id, { status: "succeeded", error: undefined });
        } catch (error) {
            check();
            const terminal = isGenerationTaskTerminalError(error) && error.task.billing?.status !== "uncertain" && !["requested", "uncertain"].includes(error.task.providerCancelStatus || "");
            await patch(original.id, { ...(terminal ? { status: "failed" } : {}), error: error instanceof Error ? error.message : "视频处理失败" });
            if (!terminal) throw error;
        }
    }
    return work;
}
