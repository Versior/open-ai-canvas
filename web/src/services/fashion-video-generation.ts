import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { fashionVideoProblem, fashionVideoRanges, fashionVideoTimeline, fashionVideoTool, planFashionVideos, type FashionVideoUnit, type FashionVideoWork } from "@/lib/fashion/video-workflow";
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
import { productVideoShotSeconds } from "@/lib/product-video/media";
import type { VideoCapabilityConfig } from "@/lib/model-capabilities";

export function fashionVideoSegmentLimit(profile: VideoCapabilityConfig) {
    return Math.min(30, Math.max(...videoDurationOptions(profile)), profile.references.maxVideoDurationSeconds || 30);
}

export function fashionVideoRequirements(work: Pick<FashionVideoWork, "draft">, imageCount: number, profile?: VideoCapabilityConfig): ModelRequirements {
    const source = fashionVideoTool(work.draft.tool).source;
    const range = source && profile ? fashionVideoRanges(work.draft, fashionVideoSegmentLimit(profile))[0] : undefined;
    const millis = range ? range.endMs - range.startMs : Math.round(work.draft.seconds * 1000);
    return {
        capability: "video",
        ...(profile || !source ? { videoSeconds: String(profile ? productVideoShotSeconds(millis, videoDurationOptions(profile)) : work.draft.seconds) } : {}),
        input: { textCount: 1, imageCount, referenceImageCount: source ? imageCount : 0, videoCount: source ? 1 : 0, audioCount: 0, characterCount: 0, videoDurationsMs: source && profile ? [millis] : [] },
    };
}
export function fashionVideoGenerationConfig(config: AiConfig, work: Pick<FashionVideoWork, "draft" | "model" | "ratio" | "resolution">, images: number) {
    if (!work.model) throw new Error("请选择视频模型");
    const profile = modelCapabilityConfigFor(config, work.model).video;
    const problem = modelCompatibilityError(config, work.model, fashionVideoRequirements(work, images, profile));
    if (!profile || problem) throw new Error(problem || "所选模型不能执行视频生成");
    const requirements = fashionVideoRequirements(work, images, profile);
    const seconds = Number(requirements.videoSeconds);
    if (!videoDurationOptions(profile).includes(seconds)) throw new Error("片段时长不符合模型能力，请重新选择");
    if (work.draft.audio === "model" && !profile.generateAudio.supported) throw new Error("所选模型不支持生成声音，请选择静音或原片声音");
    const selected = productVideoGenerationConfig(config, { model: work.model, ratio: work.ratio, resolution: work.resolution, seconds, audio: work.draft.audio });
    return buildGenerationConfig(selected, undefined, "video", requirements);
}

/** 快照先保存，取得任务ID后立即保存；恢复只监听原任务，未知提交沿用同一操作键。 */
async function runFashionVideoSegment(initial: FashionVideoWork, config: AiConfig, save: (work: FashionVideoWork) => Promise<FashionVideoWork>, signal: AbortSignal, expectedScope: string) {
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
        for (const unit of work.units) if (!unit.taskId && !unit.resourceId) fashionVideoGenerationConfig(config, work, unit.references.length + Number(work.draft.tool !== "motion"));
        const source = work.draft.source!;
        const durationMs = Math.round(work.draft.seconds * 1000);
        const clip = work.clip || { key: `clip_${work.id}` };
        if (!work.clip) await persist({ ...work, clip });
        const task = clip.taskId
            ? await queryGenerationTask(clip.taskId, { signal })
            : await createProductVideoSplit(
                  {
                      resourceId: source.resourceId,
                      startMs: work.draft.startMs,
                      endMs: work.draft.startMs + durationMs,
                      maxSegmentSeconds: Math.max(8, work.draft.seconds),
                      ranges: [{ startMs: work.draft.startMs, endMs: work.draft.startMs + durationMs }],
                  },
                  clip.key,
                  signal,
              );
        await persist({ ...work, clip: { ...clip, taskId: task.id } });
        const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: 11 * 60_000 });
        const result = parseProductVideoSplitResult(done);
        const segment = result.segments[0];
        if (result.segments.length !== 1 || segment.startMs !== work.draft.startMs || segment.endMs !== work.draft.startMs + durationMs || Math.abs(segment.durationMs - durationMs) > 100) throw new Error("原视频片段没有按选定范围切出，生成未执行");
        await persist({ ...work, clip: { ...work.clip!, resourceId: result.segments[0].resourceId, keyframeResourceId: result.segments[0].keyframeResourceId, hasAudio: result.hasAudio } });
    }
    if (work.draft.audio === "original" && work.clip?.hasAudio !== true) throw new Error("所选原片没有音轨，尚未提交模型；请创建静音或模型声音的新版本");
    for (const original of work.units) {
        if (original.status === "succeeded" || original.status === "failed") continue;
        let generatedCompleted = false;
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
                // 同一原片关键帧只约束环境、光线和身体，身份仍由专用参考图决定。
                const anchor = work.draft.tool !== "motion" && work.clip?.keyframeResourceId;
                if (anchor) images.push({ id: anchor, name: "全片环境与布光参考", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(anchor) });
                const generation = unit.taskId ? config : fashionVideoGenerationConfig(config, work, images.length);
                await patch(unit.id, { status: unit.taskId ? "running" : "submitting", error: undefined });
                const task = unit.taskId
                    ? await queryGenerationTask(unit.taskId, { signal })
                    : await submitBackendGenerationTask({
                          mode: "video",
                          config: generation,
                          prompt: `${unit.prompt}${anchor ? `\n@图片${images.length}是全片环境、布光和原身体参考。所有片段沿用这一空间布局、白平衡、曝光和肤色基调；面部或头部身份只按前面的目标身份图，不复制环境图的脸。` : ""}\n参考片段0–${work.draft.seconds}秒与生成片段同一时间轴，动作按原秒数发生，不把原动作拉伸到生成上限；多出的尾部只延续末帧动作。`,
                          referenceImages: images,
                          referenceVideos:
                              fashionVideoTool(work.draft.tool).source && work.clip?.resourceId
                                  ? [{ id: work.clip.resourceId, name: "选定动作片段", type: "video/mp4", url: "", storageKey: resourceStorageKey(work.clip.resourceId), durationMs: Math.round(work.draft.seconds * 1000) }]
                                  : [],
                          signal,
                          expectedUserScope: expectedScope,
                          clientOperationId: `fashion-video-${unit.id}`,
                          metadata: { source: "fashion-video-workbench", workId: work.id, unitId: unit.id, tool: work.draft.tool },
                      });
                await patch(unit.id, { taskId: task.id, status: "running" });
                const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: 35 * 60_000 });
                generatedCompleted = true;
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
            const current = work.units.find((unit) => unit.id === original.id)!;
            const outputRejected = (generatedCompleted || Boolean(current.resourceId)) && !current.render?.started;
            const terminal = outputRejected || (isGenerationTaskTerminalError(error) && error.task.billing?.status !== "uncertain" && !["requested", "uncertain"].includes(error.task.providerCancelStatus || ""));
            await patch(original.id, { ...(terminal ? { status: "failed" } : {}), error: error instanceof Error ? error.message : "视频处理失败" });
            if (!terminal) throw error;
        }
    }
    return work;
}

/** 长选段按模型能力切开。共享原片切段与环境锚点，每个版本独立拼回精确选段时长。 */
export async function runFashionVideoWork(initial: FashionVideoWork, config: AiConfig, save: (work: FashionVideoWork) => Promise<FashionVideoWork>, signal: AbortSignal, expectedScope = getActiveUserScope()) {
    if (!fashionVideoTool(initial.draft.tool).source) return runFashionVideoSegment(initial, config, save, signal, expectedScope);
    // 恢复已有切段或成品时不依赖模型仍在当前目录中。
    const profile = initial.model ? modelCapabilityConfigFor(config, initial.model).video : undefined;
    const existingRanges = initial.clip?.segments;
    const ranges = existingRanges || (profile ? fashionVideoRanges(initial.draft, fashionVideoSegmentLimit(profile)) : []);
    if (!initial.units.some((unit) => unit.parts) && ranges.length <= 1) return runFashionVideoSegment(initial, config, save, signal, expectedScope);
    let work = initial;
    const persist = async (next: FashionVideoWork) => {
        if (signal.aborted) throw new DOMException("已停止等待，后台任务保留", "AbortError");
        if (getActiveUserScope() !== expectedScope) throw new Error("账号已切换，结果保留在原账号任务中心");
        work = await save(next);
    };
    if (fashionVideoProblem(work.draft)) throw new Error(fashionVideoProblem(work.draft));
    if (!work.clip?.segments) {
        if (!profile) throw new Error("请选择可用的视频模型");
        fashionVideoGenerationConfig(config, work, work.units[0].references.length + Number(work.draft.tool !== "motion"));
        const clip = work.clip || { key: `clip_${work.id}` };
        if (!work.clip) await persist({ ...work, clip });
        const task = clip.taskId
            ? await queryGenerationTask(clip.taskId, { signal })
            : await createProductVideoSplit({ resourceId: work.draft.source!.resourceId, startMs: 0, endMs: 0, maxSegmentSeconds: Math.max(8, Math.ceil(fashionVideoSegmentLimit(profile))), ranges }, clip.key, signal);
        await persist({ ...work, clip: { ...clip, taskId: task.id } });
        const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: 11 * 60_000 });
        const result = parseProductVideoSplitResult(done);
        if (result.segments.length !== ranges.length || result.segments.some((part, index) => part.startMs !== ranges[index].startMs || part.endMs !== ranges[index].endMs || Math.abs(part.durationMs - (part.endMs - part.startMs)) > 100))
            throw new Error("原视频切段未覆盖选定范围，尚未提交生成");
        await persist({ ...work, clip: { ...work.clip!, segments: result.segments, keyframeResourceId: result.segments[0].keyframeResourceId, hasAudio: result.hasAudio } });
    }
    for (const variant of work.units) {
        if (variant.status === "succeeded" || variant.status === "failed") continue;
        if (!variant.parts) {
            const parts = work.clip!.segments!.map((part, index) => {
                const draft = { ...work.draft, startMs: part.startMs, seconds: (part.endMs - part.startMs) / 1000 };
                const planned = planFashionVideos(draft, () => "planned").find((unit) => unit.references.map((ref) => ref.resourceId).join(",") === variant.references.map((ref) => ref.resourceId).join(","))!;
                return { ...planned, id: `${variant.id}_part_${index + 1}`, startMs: part.startMs, endMs: part.endMs, clipResourceId: part.resourceId };
            });
            await persist({ ...work, units: work.units.map((unit) => (unit.id === variant.id ? { ...unit, parts } : unit)) });
        }
        const parts = work.units.find((unit) => unit.id === variant.id)!.parts!;
        for (const part of parts) {
            if (part.status === "succeeded") continue;
            const child: FashionVideoWork = {
                ...work,
                draft: { ...work.draft, startMs: part.startMs, seconds: (part.endMs - part.startMs) / 1000 },
                clip: { key: `clip_${part.id}`, resourceId: part.clipResourceId, keyframeResourceId: work.clip!.keyframeResourceId, hasAudio: work.clip!.hasAudio },
                units: [part],
            };
            await runFashionVideoSegment(
                child,
                config,
                async (next) => {
                    await persist({ ...work, units: work.units.map((unit) => (unit.id === variant.id ? { ...unit, status: "running", parts: unit.parts!.map((value) => (value.id === part.id ? { ...value, ...next.units[0] } : value)) } : unit)) });
                    return { ...next, revision: work.revision };
                },
                signal,
                expectedScope,
            );
        }
        const unit = work.units.find((value) => value.id === variant.id)!;
        if (unit.parts!.some((part) => part.status !== "succeeded" || !part.render?.resourceId)) {
            await persist({ ...work, units: work.units.map((value) => (value.id === unit.id ? { ...value, status: "failed", error: "部分片段未成功，不能交付完整视频" } : value)) });
            continue;
        }
        if (unit.render?.started && !unit.render.taskId) throw new Error("整片合成提交尚未确认，请在任务中心关联原任务");
        if (!unit.render) await persist({ ...work, units: work.units.map((value) => (value.id === unit.id ? { ...value, status: "rendering", render: { started: true } } : value)) });
        const durationMs = Math.round(work.draft.seconds * 1000);
        const timeline = fashionVideoTimeline(work, unit);
        const task = unit.render?.taskId ? await queryGenerationTask(unit.render.taskId, { signal }) : await createTimelineRenderTask({ projectId: "", timeline }, signal);
        await persist({ ...work, units: work.units.map((value) => (value.id === unit.id ? { ...value, render: { started: true, taskId: task.id } } : value)) });
        const done = await waitForGenerationTask(task.id, { initialTask: task, signal, timeoutMs: 20 * 60_000 });
        const result = JSON.parse(done.resultJson || "{}") as TimelineRenderResult;
        if (!result.resourceId) throw new Error("合成任务没有返回完整视频，原任务保留");
        await persist({
            ...work,
            units: work.units.map((value) =>
                value.id === unit.id
                    ? { ...value, status: "succeeded", resourceId: result.resourceId, durationMs, width: timeline.width, height: timeline.height, render: { started: true, taskId: task.id, resourceId: result.resourceId }, error: undefined }
                    : value,
            ),
        });
    }
    return work;
}
