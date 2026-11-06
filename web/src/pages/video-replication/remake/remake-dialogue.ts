import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { videoTeardownTextRequirements } from "@/lib/canvas/video-teardown";
import type { RemakeJob } from "@/lib/remake/job";
import { buildRemakeDialoguePrompt, parseRemakeDialogue } from "@/lib/remake/prompts";
import { getActiveUserScope } from "@/lib/user-scope";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";
import { replicaScriptModelError } from "../replication-script";

/**
 * 按原节奏把口播改写成我的商品：一个普通文本任务（按所选模型计费）。回复不完整时直接报错，不自动重试，
 * 重试要再扣一次费，交给用户决定。返回镜头编号到新口播。
 */
export async function rewriteRemakeDialogue(job: RemakeJob, options: { config: AiConfig; model: string; signal?: AbortSignal }) {
    const error = replicaScriptModelError(options.config, options.model);
    if (error) throw new Error(error);
    const requirements = videoTeardownTextRequirements(options.config, 0);
    const result = await runBackendGenerationTask({
        mode: "text",
        prompt: buildRemakeDialoguePrompt(job),
        config: { ...buildGenerationConfig(options.config, undefined, "text", requirements), model: options.model },
        referenceImages: [],
        streamText: false,
        signal: options.signal,
        expectedUserScope: getActiveUserScope(),
    });
    return parseRemakeDialogue(
        result.text || "",
        job.shots.filter((shot) => shot.treatment !== "skip"),
        job.language,
    );
}
