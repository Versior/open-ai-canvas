import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { videoTeardownTextRequirements } from "@/lib/canvas/video-teardown";
import { buildCreativeAnalysisPrompt, buildCreativePlanPrompt, creativeFactsInput, creativePlanInput, creativePlanReferences, creativeReadyError, parseCreativeAnalysis, parseCreativePlans, type CreativeRun } from "@/lib/remake/creative";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { isGenerationTaskTerminalError, queryGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { readRemake, updateRemake } from "../replace/use-product-video-store";
import { replicaScriptImageCount, replicaScriptModelError } from "../replication-script";
import { nanoid } from "nanoid";

const active = new Set<string>();
export const creativeRunDependencies = { submit: submitBackendGenerationTask, query: queryGenerationTask, wait: waitForGenerationTask, save: updateRemake, read: readRemake };

/** 任务输入先得到服务端确认；响应丢失时按同一操作标识和冻结提示词恢复。 */
export async function executeCreativeRun(id: string, config: AiConfig, signal: AbortSignal, options?: { kind: "analysis" | "plan"; model: string; count: number }, deps = creativeRunDependencies) {
    if (active.has(id)) return;
    const scope = getActiveUserScope();
    const assert = () => {
        if (signal.aborted || getActiveUserScope() !== scope) throw new DOMException("已离开当前创作", "AbortError");
    };
    active.add(id);
    let operation: CreativeRun | undefined;
    let settled = false;
    try {
        assert();
        const job = deps.read(id);
        if (!job?.creative) throw new Error("商品视频作品不存在");
        operation = job.creative.run;
        if (options) {
            if (![2, 3, 4, 5, 6].includes(options.count)) throw new Error("创意方向数量须为2–6个");
            if (operation && !operation.settled) throw new Error("先恢复上一次策划任务，确认结果后再新建");
            const problem = replicaScriptModelError(config, options.model) || (options.kind === "plan" ? creativeReadyError(job) : !job.product.images.length ? "先上传商品图" : "");
            if (problem) throw new Error(problem);
            const references = options.kind === "plan" ? creativePlanReferences(job) : job.product.images;
            const images = replicaScriptImageCount(config, options.model, references.length);
            if (options.kind === "analysis" && !images) throw new Error("素材分析需要支持图片的文本模型");
            if (options.kind === "plan" && images < references.length) throw new Error("导演模型无法接收全部商品、人物与场景参考，请减少参考图或更换模型");
            operation = {
                id: `creative-${nanoid(12)}`,
                kind: options.kind,
                input: options.kind === "analysis" ? creativeFactsInput(job) : creativePlanInput(job),
                prompt: options.kind === "analysis" ? buildCreativeAnalysisPrompt(job) : buildCreativePlanPrompt(job, options.count),
                model: options.model,
                imageResourceIds: references.slice(0, images).map((image) => image.resourceId),
                count: options.count,
                status: "running",
                settled: false,
            };
            const frozen = operation;
            await deps.save(id, (value) => {
                if (value.creative?.run && !value.creative.run.settled && value.creative.run.id !== frozen.id) throw new Error("另一窗口已有未确认的策划任务");
                if ((frozen.kind === "analysis" ? creativeFactsInput(value) : creativePlanInput(value)) !== frozen.input) throw new Error("商品或设置已变化，请重新发起策划");
                return { ...value, creative: { ...value.creative!, run: frozen } };
            });
        }
        if (!operation || operation.settled) return;
        assert();
        const run = operation;
        const task = run.taskId
            ? await deps.query(run.taskId, { signal })
            : await deps.submit({
                  mode: "text",
                  prompt: run.prompt,
                  config: { ...buildGenerationConfig(config, undefined, "text", videoTeardownTextRequirements(config, run.imageResourceIds.length)), model: run.model },
                  referenceImages: run.imageResourceIds.map((resourceId) => ({ id: resourceId, name: "商品参考", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(resourceId) })),
                  expectedUserScope: scope,
                  signal,
                  streamText: false,
                  clientOperationId: run.id,
                  metadata: { source: "product-video-creative", remakeId: id, stage: run.kind },
              });
        assert();
        await deps.save(id, (value) => {
            if (value.creative?.run?.id !== run.id) throw new Error("策划任务已被另一窗口替换");
            return { ...value, creative: { ...value.creative!, run: { ...run, taskId: task.id, status: "running", error: undefined } } };
        });
        const done = await deps.wait(task.id, { initialTask: task, signal, timeoutMs: 10 * 60_000 });
        settled = true;
        assert();
        const latest = deps.read(id)!;
        const input = run.kind === "analysis" ? creativeFactsInput(latest) : creativePlanInput(latest);
        if (input !== run.input) throw new Error("商品或设置已变化，旧任务结果未应用，请重新策划");
        const text = parseBackendGenerationResult(done).text || "";
        const analysis = run.kind === "analysis" ? parseCreativeAnalysis(text, run.input) : undefined;
        const plans = run.kind === "plan" ? parseCreativePlans(text, latest, run.id, run.count) : undefined;
        await deps.save(id, (value) => {
            if (value.creative?.run?.id !== run.id) throw new Error("策划任务已被另一窗口替换");
            if ((run.kind === "analysis" ? creativeFactsInput(value) : creativePlanInput(value)) !== run.input) throw new Error("商品或设置已变化，旧任务结果未应用，请重新策划");
            const chosen = value.creative.plans.find((plan) => plan.id === value.creative?.activePlanId);
            return { ...value, creative: { ...value.creative, ...(analysis ? { analysis } : {}), ...(plans ? { plans: [...plans, ...(chosen ? [chosen] : [])].slice(0, 7) } : {}), run: { ...run, taskId: done.id, status: "succeeded", settled: true } } };
        });
    } catch (error) {
        if (!signal.aborted && scope === getActiveUserScope() && operation) {
            const run = operation;
            await deps.save(id, (value) =>
                value.creative?.run?.id === run.id
                    ? { ...value, creative: { ...value.creative, run: { ...value.creative.run, status: "failed", settled: settled || isGenerationTaskTerminalError(error), error: error instanceof Error ? error.message : "策划失败" } } }
                    : value,
            );
        }
        throw error;
    } finally {
        active.delete(id);
    }
}
