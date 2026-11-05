import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { buildReplicaScriptPrompt, parseReplicaScripts, type ReplicaScript, type VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import { videoTeardownTextRequirements, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { modelCompatibilityError } from "@/lib/model-selection";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";

type RewriteOptions = { config: AiConfig; model: string; count: number; signal: AbortSignal; expectedScope: string };

/** 不带图片的文本模型问题：没选或不能用。 */
export function replicaScriptModelError(config: AiConfig, model: string) {
    if (!model) return "请选择用于改写脚本的文本模型";
    const error = modelCompatibilityError(config, model, videoTeardownTextRequirements(config, 0));
    return error ? `所选模型不能用于改写：${error}` : "";
}

/**
 * 按商品档案改写口播和画面字：一个普通文本任务（按所选模型计费），返回若干个版本。
 * 回复不是可用的 JSON 时直接报错，不自动重试（重试要再扣一次费，交给用户决定）。
 */
export async function rewriteReplicaScripts(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, plan: VideoReplicaPlan, options: RewriteOptions): Promise<ReplicaScript[]> {
    const { config, model, signal } = options;
    const modelError = replicaScriptModelError(config, model);
    if (modelError) throw new Error(modelError);
    const shotNumbers = plan.shots.filter((shot) => shot.treatment !== "skip").map((shot) => shot.shotNumber);
    const requirements = videoTeardownTextRequirements(config, 0);
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: buildReplicaScriptPrompt(bundle, analysis, plan, options.count),
        config: { ...buildGenerationConfig(config, undefined, "text", requirements), model },
        referenceImages: [],
        streamText: false,
        signal,
        expectedUserScope: options.expectedScope,
    });
    const createdAt = new Date().toISOString();
    return parseReplicaScripts(result.text || "", shotNumbers, { model, createdAt, idPrefix: `s${Date.now().toString(36)}` });
}
