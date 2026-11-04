import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import {
    buildVideoTeardownPrompt,
    buildVideoTeardownSummaryPrompt,
    parseVideoTeardownAnalysis,
    parseVideoTeardownSummary,
    videoTeardownTextRequirements,
    VIDEO_TEARDOWN_MAX_GRIDS_PER_REQUEST,
    type VideoTeardownAnalysis,
    type VideoTeardownAnalysisRow,
} from "@/lib/canvas/video-teardown";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelCompatibilityError } from "@/lib/model-selection";
import { parseBackendGenerationResult, runBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { waitForGenerationTask } from "@/services/api/task-center";
import type { VideoTeardownBundle, VideoTeardownGrid } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";

const TEXT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

type AnalyzeOptions = {
    config: AiConfig;
    model: string;
    /** 没有模型给的标题时用来兜底的名字（视频文件名或平台标题）。 */
    fallbackTitle: string;
    signal: AbortSignal;
    expectedScope: string;
    onProgress: (detail: string) => void;
    /** 中断后接着跑：这一步之前已经提交过的文本任务 ID，有就等它的结果，不再新建（不重复扣费）。 */
    existingTask?: (key: string) => string | undefined;
    /** 每个文本任务一建好就回报 ID，调用方记下来供中断后接回。 */
    onTaskCreated?: (key: string, taskId: string) => void;
};

function isAbort(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}

/**
 * 把宫格按所选模型的图片上限分批交给看图模型逐镜分析；多批时再单独请求一次全片总结。
 * 走普通文本生成任务，计费和渠道路由与其他文本生成一致。回复缺镜头或不是 JSON 时重试一次，再失败就报错。
 * 每个请求有固定的步骤名（第几批、第几次尝试），中断后用同一步骤名接回已提交的任务。
 */
export async function analyzeVideoTeardown(bundle: VideoTeardownBundle, options: AnalyzeOptions): Promise<VideoTeardownAnalysis> {
    const { config, model, signal } = options;
    const maxImages = modelCapabilityConfigFor(config, model).text?.references.maxImages ?? 0;
    const batchSize = Math.min(VIDEO_TEARDOWN_MAX_GRIDS_PER_REQUEST, maxImages);
    if (batchSize < 1) throw new Error("所选模型不支持图片输入，请换一个能看图的文本模型");
    const batches: VideoTeardownGrid[][] = [];
    for (let start = 0; start < bundle.grids.length; start += batchSize) batches.push(bundle.grids.slice(start, start + batchSize));
    const run = async (key: string, prompt: string, grids: VideoTeardownGrid[]) => {
        const existing = options.existingTask?.(key);
        if (existing) return parseBackendGenerationResult(await waitForGenerationTask(existing, { signal, timeoutMs: TEXT_TASK_TIMEOUT_MS })).text || "";
        const requirements = videoTeardownTextRequirements(config, grids.length);
        const error = modelCompatibilityError(config, model, requirements);
        if (error) throw new Error(`所选模型不能用于拆解：${error}`);
        let reported = false;
        const result = await runBackendGenerationTask({
            mode: "text",
            prompt,
            config: { ...buildGenerationConfig(config, undefined, "text", requirements), model },
            referenceImages: grids.map((grid, index) => ({
                id: grid.resourceId,
                name: `宫格 ${index + 1}`,
                type: "image/jpeg",
                dataUrl: "",
                storageKey: resourceStorageKey(grid.resourceId),
                width: grid.width,
                height: grid.height,
            })),
            streamText: false,
            signal,
            expectedUserScope: options.expectedScope,
            onTaskUpdate: (task) => {
                if (reported) return;
                reported = true;
                options.onTaskCreated?.(key, task.id);
            },
        });
        return result.text || "";
    };
    const withRetry = async <T>(attempt: (attemptNumber: number) => Promise<T>) => {
        try {
            return await attempt(1);
        } catch (error) {
            if (isAbort(error) || signal.aborted) throw error;
            return attempt(2);
        }
    };
    const rows: VideoTeardownAnalysisRow[] = [];
    let title = "";
    let summary: VideoTeardownAnalysis["summary"] = null;
    for (const [index, grids] of batches.entries()) {
        options.onProgress(batches.length > 1 ? `分析镜头（${index + 1}/${batches.length}）` : "分析镜头");
        const withSummary = batches.length === 1;
        const expected = grids.flatMap((grid) => grid.shotIndexes);
        const analysis = await withRetry(async (attempt) => parseVideoTeardownAnalysis(await run(`batch-${index + 1}-try-${attempt}`, buildVideoTeardownPrompt(bundle, grids, withSummary), grids), expected, withSummary));
        rows.push(...analysis.rows);
        if (withSummary) ({ title, summary } = analysis);
    }
    if (batches.length > 1) {
        options.onProgress("总结全片结构");
        ({ title, summary } = await withRetry(async (attempt) => parseVideoTeardownSummary(await run(`summary-try-${attempt}`, buildVideoTeardownSummaryPrompt(bundle, rows), []))));
    }
    return { title: title || options.fallbackTitle || "视频拆解", summary, rows };
}
