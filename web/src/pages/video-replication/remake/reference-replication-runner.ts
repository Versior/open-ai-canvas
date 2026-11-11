import { canonicalize } from "json-canonicalize";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { readVideoReplicationAnalysis, videoTeardownTextRequirements } from "@/lib/canvas/video-teardown";
import { createClientId } from "@/lib/client-id";
import { remakeShotsFromTeardown } from "@/lib/remake/job";
import {
    buildReferenceReplicationPrompt,
    parseReferenceReplicationPlan,
    readReferenceReplicationSnapshot,
    referenceAnalysisFrames,
    referenceReplicationInput,
    setReferenceReplicationMode,
    type ReferenceReplicationMode,
} from "@/lib/remake/reference-replication";
import { getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { createGenerationTask, queryGenerationTask, waitForGenerationTask, type CreateTaskInput } from "@/services/api/task-center";
import { getVideoReplication, parseVideoTeardownBundle } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import { readRemake, updateRemake } from "../replace/use-product-video-store";
import { replicaScriptImageCount, replicaScriptModelError } from "../replication-script";

const running = new Map<string, Promise<void>>();

export async function changeReferenceReplicationMode(id: string, mode: "elements" | ReferenceReplicationMode) {
    const scope = getActiveUserScope();
    const job = readRemake(id);
    if (!job?.source) throw new Error("原片记录不存在");
    if ((job.replication?.mode || "elements") === mode) return;
    const detail = await getVideoReplication(job.source.teardownId);
    const bundle = parseVideoTeardownBundle(detail.task);
    if (getActiveUserScope() !== scope) throw new Error("账号已切换");
    if (bundle.source.resourceId !== job.source.resourceId) throw new Error("拆解与原片不一致，请重新打开作品");
    const shots = remakeShotsFromTeardown(bundle, readVideoReplicationAnalysis(detail.analysis, bundle.shots.length));
    await updateRemake(id, (value) => {
        if (value.source?.resourceId !== job.source?.resourceId) throw new Error("原片已在另一窗口修改");
        return setReferenceReplicationMode(value, mode, shots);
    });
}

export function generateReferenceReplicationPlan(id: string, config: AiConfig, model: string): Promise<void> {
    const lock = `${getActiveUserScope()}:${id}`;
    const existing = running.get(lock);
    if (existing) return existing;
    const operation = run(id, config, model).finally(() => {
        if (running.get(lock) === operation) running.delete(lock);
    });
    running.set(lock, operation);
    return operation;
}

/** 冻结输入和操作标识先保存，提交丢响应或刷新后继续查询同一任务。 */
async function run(id: string, config: AiConfig, model: string) {
    const scope = getActiveUserScope();
    const assertScope = () => {
        if (getActiveUserScope() !== scope) throw new Error("账号已切换");
    };
    const job = readRemake(id);
    if (!job?.replication || !job.source) throw new Error("请先选择结构或风格复刻");
    if (job.continuity?.taskId || job.units.some((unit) => unit.taskId || (unit.input && unit.status !== "succeeded"))) throw new Error("先恢复当前生成或定妆任务，再规划参考方案");
    const input = referenceReplicationInput(job);
    const capacity = replicaScriptImageCount(config, model, job.replication.sourceShots.length + job.product.images.length);
    const targetImageCount = Math.min(job.product.images.length, 4, Math.max(1, Math.floor(capacity / 3)));
    const imageCount = Math.min(12, job.replication.sourceShots.length, capacity - targetImageCount);
    if (!job.replication.run) {
        const problem = replicaScriptModelError(config, model);
        if (problem || imageCount < 1 || targetImageCount < 1) throw new Error(problem || "请选择至少支持两张图片的文本模型，对照原片与目标主体");
        if (!job.product.name.trim() || !job.product.images.length) throw new Error("请填写目标主体名称并上传参考图");
        if (job.audio === "original" || job.people === "original") throw new Error("请选择目标人物与新口播方式，再规划参考方案");
    }
    const state = job.replication.run ? { ...job.replication.run } : { key: createClientId(), input, model, createdAt: new Date().toISOString(), imageCount, targetImageCount, requestSignature: "" };
    const frozen = readReferenceReplicationSnapshot(state.input, job);
    if (!frozen) throw new Error("冻结的参考资料不完整，不能恢复规划");
    let request: CreateTaskInput | undefined;
    if (!state.taskId) {
        const frames = referenceAnalysisFrames(frozen, state.imageCount);
        const targetImages = frozen.product.images.slice(0, state.targetImageCount);
        const requirements = videoTeardownTextRequirements(config, frames.length + targetImages.length);
        request = await prepareBackendGenerationTask({
            mode: "text",
            expectedUserScope: scope,
            prompt: buildReferenceReplicationPrompt(frozen, frames.length, targetImages.length),
            config: { ...buildGenerationConfig({ ...config, textModel: state.model }, undefined, "text", requirements), model: state.model },
            referenceImages: [
                ...frames.map((shot) => ({ id: shot.keyframeResourceId, name: `原片镜头 ${shot.index}`, type: "image/png", dataUrl: "", storageKey: resourceStorageKey(shot.keyframeResourceId) })),
                ...targetImages.map((image) => ({ id: image.id, name: image.name || "目标主体实拍", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(image.resourceId) })),
            ],
            streamText: false,
            clientOperationId: `${id}-reference-${state.key}`,
            metadata: { source: "video-reference-planning", remakeId: id, mode: frozen.replication!.mode },
        });
        assertScope();
        // 仅保存摘要，不把渠道凭据写入作品；丢响应重放必须保持相同请求。
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(request)));
        const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (state.requestSignature && state.requestSignature !== signature) throw new Error("模型渠道或参数已变化，请恢复原设置后继续查询同一次参考规划；任务记录已保留");
        state.requestSignature = signature;
    }
    await updateRemake(id, (value) => {
        if (!value.replication || (job.replication?.run ? value.replication.run?.key !== state.key : value.replication.run || referenceReplicationInput(value) !== input)) throw new Error("参考资料或任务已在另一窗口修改，请重新核对");
        return { ...value, replication: { ...value.replication, confirmed: false, run: state } };
    });
    assertScope();
    let task = state.taskId ? await queryGenerationTask(state.taskId) : undefined;
    assertScope();
    if (!task) {
        if (!request) throw new Error("原任务查询未返回记录，请重试查询");
        task = await createGenerationTask(request);
        assertScope();
        await updateRemake(id, (value) => {
            if (value.replication?.run?.key !== state.key) throw new Error("参考规划任务已在另一窗口修改");
            return { ...value, replication: { ...value.replication, run: { ...state, taskId: task!.id } } };
        });
    }
    if (task.type !== "canvas_text") throw new Error("参考规划记录不是文本任务，不能恢复");
    let settled = task.status === "failed" || task.status === "cancelled";
    try {
        const done = await waitForGenerationTask(task.id, {
            initialTask: task,
            timeoutMs: 15 * 60_000,
            onTaskUpdate: (item) => {
                if (["failed", "cancelled", "succeeded"].includes(item.status)) settled = true;
            },
        });
        settled = true;
        assertScope();
        const plan = parseReferenceReplicationPlan(parseBackendGenerationResult(done).text || "", frozen, { id: state.key, model: state.model, createdAt: state.createdAt });
        await updateRemake(id, (value) => {
            if (value.replication?.run?.key !== state.key) throw new Error("参考规划任务已在另一窗口修改");
            return { ...value, replication: { ...value.replication, plan, confirmed: false, run: undefined } };
        });
    } catch (error) {
        assertScope();
        if (settled) await updateRemake(id, (value) => (value.replication?.run?.key === state.key ? { ...value, replication: { ...value.replication, run: undefined } } : value));
        throw error;
    }
}
