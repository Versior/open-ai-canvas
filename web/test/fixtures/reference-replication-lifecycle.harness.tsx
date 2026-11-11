import { expect, mock, test } from "bun:test";
import { referenceFixture, referencePlanOutput } from "./reference-replication-data";
import type { RemakeJob } from "@/lib/remake/job";
import { defaultConfig } from "@/stores/use-config-store";

let work = referenceFixture();
let scope = "fixture-owner";
let loseSubmit = false;
let failWait = false;
let editWhileWaiting = false;
let switchWhileWaiting = false;
let raceBeforeSave = false;
let submissions: Record<string, unknown>[] = [];
let reads: string[] = [];
let charges = 0;
const operations = new Map<string, { id: string; status: string }>();

mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => scope }));
mock.module("@/pages/video-replication/replace/use-product-video-store", () => ({
    readRemake: () => work,
    updateRemake: async (_id: string, update: (job: RemakeJob) => RemakeJob) => {
        if (raceBeforeSave) {
            raceBeforeSave = false;
            work = {
                ...work,
                replication: { ...work.replication!, run: { key: "other-window", input: referenceReplicationInput(work), model: "vision-model", createdAt: "2026-01-01T00:00:00Z", imageCount: 2, targetImageCount: 1, requestSignature: "a".repeat(64) } },
            };
        }
        work = update(work);
    },
}));
mock.module("@/pages/video-replication/replication-script", () => ({ replicaScriptImageCount: () => 3, replicaScriptModelError: () => "" }));
mock.module("@/lib/canvas/canvas-project-generation", () => ({ buildGenerationConfig: (config: { systemPrompt: string }) => ({ model: "vision-model", systemPrompt: config.systemPrompt }) }));
mock.module("@/services/api/generation-task", () => ({
    prepareBackendGenerationTask: async (request: Record<string, unknown>) => request,
    parseBackendGenerationResult: () => ({ text: JSON.stringify(referencePlanOutput()) }),
}));
mock.module("@/services/api/task-center", () => ({
    createGenerationTask: async (request: Record<string, unknown>) => {
        expect(work.replication?.run?.key, "操作标识先保存，才可以提交付费任务").toBeTruthy();
        expect(work.replication?.run?.taskId).toBeUndefined();
        submissions.push(request);
        const key = request.clientOperationId as string;
        if (!operations.has(key)) {
            charges++;
            operations.set(key, { id: "reference-text-task", status: "running" });
        }
        if (loseSubmit) {
            loseSubmit = false;
            throw new Error("提交响应中断");
        }
        return { ...operations.get(key), type: "canvas_text" };
    },
    queryGenerationTask: async (id: string) => {
        reads.push(id);
        return { id, status: "running", type: "canvas_text" };
    },
    waitForGenerationTask: async (id: string) => {
        expect(work.replication?.run?.taskId, "任务标识先保存，刷新后可以继续查询").toBe(id);
        if (failWait) {
            failWait = false;
            throw new Error("等待网络中断");
        }
        if (editWhileWaiting) work = { ...work, product: { ...work.product, name: "另一把扶手椅" } };
        if (switchWhileWaiting) scope = "fixture-other-owner";
        return { id, status: "succeeded" };
    },
}));
const { generateReferenceReplicationPlan } = await import("@/pages/video-replication/remake/reference-replication-runner");
const { referenceReplicationInput } = await import("@/lib/remake/reference-replication");

function reset() {
    work = referenceFixture();
    scope = "fixture-owner";
    loseSubmit = false;
    failWait = false;
    editWhileWaiting = false;
    switchWhileWaiting = false;
    raceBeforeSave = false;
    submissions = [];
    reads = [];
    charges = 0;
    operations.clear();
}

test("提交丢响应复用持久幂等键，关键帧与目标实拍顺序明确", async () => {
    reset();
    loseSubmit = true;
    await expect(generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model")).rejects.toThrow("提交响应中断");
    const operation = work.replication!.run!.key;
    await generateReferenceReplicationPlan(work.id, defaultConfig, "different-model");
    expect(charges).toBe(1);
    expect(submissions).toHaveLength(2);
    expect(submissions[0].clientOperationId).toBe(submissions[1].clientOperationId);
    expect(submissions[1].config).toMatchObject({ model: "vision-model" });
    expect(submissions[1].referenceImages).toMatchObject([{ storageKey: "resource:source-frame-1" }, { storageKey: "resource:source-frame-2" }, { storageKey: "resource:target-product" }]);
    expect(submissions[1].prompt).toContain("附件图3至图3是目标主体实拍");
    expect(work.replication?.plan?.id).toBe(operation);
    expect(work.replication?.confirmed).toBe(false);
    expect(work.replication?.run).toBeUndefined();
});

test("已持久化任务等待中断后只查询，不重复提交", async () => {
    reset();
    failWait = true;
    await expect(generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model")).rejects.toThrow("等待网络中断");
    expect(work.replication?.run?.taskId).toBe("reference-text-task");
    await generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model");
    expect(submissions).toHaveLength(1);
    expect(reads).toEqual(["reference-text-task"]);
    expect(work.replication?.plan).toBeTruthy();
});

test("等待期间修改资料，保存原输入方案供回查，不替换当前分镜", async () => {
    reset();
    editWhileWaiting = true;
    const originalInput = referenceReplicationInput(work);
    const originalShots = JSON.stringify(work.shots);
    await generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model");
    expect(work.product.name).toBe("另一把扶手椅");
    expect(work.replication?.plan?.input).toBe(originalInput);
    expect(referenceReplicationInput(work)).not.toBe(originalInput);
    expect(JSON.stringify(work.shots)).toBe(originalShots);
    expect(work.replication?.confirmed).toBe(false);
});

test("账号切换后禁止把旧任务结果写入当前作品", async () => {
    reset();
    switchWhileWaiting = true;
    await expect(generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model")).rejects.toThrow("账号已切换");
    expect(work.replication?.plan).toBeUndefined();
    expect(work.replication?.run?.taskId).toBe("reference-text-task");
});

test("提交响应丢失后参数变化不重放不同付费请求，恢复参数后沿用原标识", async () => {
    reset();
    loseSubmit = true;
    await expect(generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model")).rejects.toThrow("提交响应中断");
    await expect(generateReferenceReplicationPlan(work.id, { ...defaultConfig, systemPrompt: "changed settings" }, "vision-model")).rejects.toThrow("参数已变化");
    expect(charges).toBe(1);
    expect(submissions).toHaveLength(1);
    expect(work.replication?.run).toBeTruthy();
    await generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model");
    expect(charges).toBe(1);
});

test("另一窗口先保存任务，即使输入相同也不能覆盖或新增付费任务", async () => {
    reset();
    raceBeforeSave = true;
    await expect(generateReferenceReplicationPlan(work.id, defaultConfig, "vision-model")).rejects.toThrow("另一窗口");
    expect(work.replication?.run?.key).toBe("other-window");
    expect(charges).toBe(0);
});
