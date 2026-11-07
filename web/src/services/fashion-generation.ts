import { nanoid } from "nanoid";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { studioImageRequest, STUDIO_PREFERRED_TIER } from "@/lib/ecommerce-studio/image-options";
import type { FashionImage, FashionUnit } from "@/lib/fashion/workflow";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { modelCompatibilityError } from "@/lib/model-selection";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const references = (images: FashionImage[]): ReferenceImage[] =>
    images.map((image) => ({ id: image.resourceId, name: image.name, type: "image/png", dataUrl: "", storageKey: resourceStorageKey(image.resourceId), width: image.width, height: image.height }));

export function fashionImageConfig(config: AiConfig, model: string, count: number) {
    const profile = modelCapabilityConfigFor(config, model).image;
    if (!model || !profile) throw new Error("请选择支持图片编辑的模型");
    const problem = modelCompatibilityError(config, model, { capability: "image", input: { textCount: 1, imageCount: count, referenceImageCount: count, videoCount: 0, audioCount: 0, characterCount: 0 } });
    if (problem) throw new Error(problem);
    if (count > (profile.references.maxImages ?? 0)) throw new Error(`这个模型最多参考 ${profile.references.maxImages || 0} 张图，当前操作需要 ${count} 张，请换一个支持多图编辑的模型`);
    const request = studioImageRequest(profile, STUDIO_PREFERRED_TIER, "3:4");
    const node = { id: "fashion", type: CanvasNodeType.Image, title: "模特工具", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } } as unknown as CanvasNodeData;
    return buildEcommerceImageGeneration(
        config,
        node,
        { ...DEFAULT_ECOMMERCE_BRIEF, ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), imageSettings: request.imageSettings },
        { textCount: 1, imageCount: count, videoCount: 0, audioCount: 0, characterCount: 0 },
    ).config;
}

export function fashionVideoConfig(config: AiConfig, model: string, seconds: number) {
    const requirements = { capability: "video" as const, input: { textCount: 1, imageCount: 1, referenceImageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 }, videoSeconds: String(seconds) };
    const profile = modelCapabilityConfigFor(config, model).video;
    const selectedProblem = modelCompatibilityError(config, model, requirements);
    if (!model || !profile || selectedProblem) throw new Error(selectedProblem || "请选择支持图生视频的模型");
    if (!videoDurationOptions(profile).includes(seconds)) throw new Error("所选时长不符合模型能力，请重新选择时长");
    const generation = buildGenerationConfig({ ...config, videoModel: model, model, videoSeconds: String(seconds), taskWorkflowProvider: "model" }, undefined, "video", {
        capability: "video",
        input: { textCount: 1, imageCount: 1, referenceImageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 },
        videoSeconds: String(seconds),
    });
    const problem = modelCompatibilityError(generation, model, { capability: "video", input: { textCount: 1, imageCount: 1, referenceImageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 }, videoSeconds: String(seconds) });
    if (problem) throw new Error(problem);
    return generation;
}

export async function generateFashion(unit: FashionUnit, config: AiConfig, mode: "image" | "video", onSubmitted: (task: GenerationTask) => Promise<void>, signal?: AbortSignal) {
    const video = mode === "video" ? unit.video : undefined;
    if (mode === "video" && (!video || !unit.resourceId)) throw new Error("请先生成并选定模特图片");
    const savedId = video?.taskId || (mode === "image" ? unit.taskId : undefined);
    const task = savedId
        ? undefined
        : await submitBackendGenerationTask({
              mode,
              config,
              prompt: video?.prompt || unit.prompt,
              referenceImages: references(video ? [{ resourceId: unit.resourceId!, name: unit.title }] : unit.references),
              clientOperationId: `fashion-${unit.id}-${mode}`,
              expectedUserScope: getActiveUserScope(),
              signal,
              metadata: { source: "fashion-workbench", fashionUnitId: unit.id },
          });
    if (task) await onSubmitted(task);
    const done = await waitForGenerationTask(savedId || task!.id, { initialTask: task, signal, timeoutMs: mode === "video" ? 30 * 60_000 : 10 * 60_000 });
    const result = parseBackendGenerationResult(done);
    const output = mode === "video" ? result.video : result.images?.[0];
    const resourceId = resourceIdFromStorageKey(output?.storageKey);
    if (!resourceId) throw new Error("任务结束但成品未就绪，请到任务中心检查资源");
    return { resourceId, name: unit.title, width: output?.width, height: output?.height } satisfies FashionImage;
}

export const newFashionId = () => nanoid(12);
