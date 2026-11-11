import { expect, mock, test } from "bun:test";
import { createRemakeJob } from "@/lib/remake/job";
import { remakeContinuityImage, remakeContinuityInput } from "@/lib/remake/continuity";
import { defaultConfig } from "@/stores/use-config-store";
import type { BackendGenerationTaskOptions } from "@/services/api/generation-task";
import type { StoredWork } from "@/services/api/product-video";

mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => "quality-user" }));
let stored: StoredWork;
mock.module("@/services/api/product-video", () => ({
    PRODUCT_VIDEO_CONFLICT: "conflict",
    listProductVideos: async () => [stored],
    getProductVideo: async () => stored,
    saveProductVideo: async (value: StoredWork) => {
        stored = { ...structuredClone(value), revision: value.revision + 1 };
        return stored;
    },
    deleteProductVideo: async () => undefined,
    createProductVideoSplit: async () => {
        throw new Error("测试片段已切好，不应再次切段");
    },
    parseProductVideoSplitResult: () => ({ segments: [] }),
}));
mock.module("@/pages/video-replication/remake/remake-config", () => ({ remakeLimitsFor: () => ({ maxImages: 8, maxSegmentSeconds: 8, durations: [4, 8], generateAudio: true, maxAudios: 1, maxAudioDurationSeconds: 15 }) }));
mock.module("@/pages/video-replication/replace/product-video-config", () => ({
    productVideoGenerationConfig: (config: typeof defaultConfig, input: { model: string; audio: string }) => ({ ...config, model: input.model, videoGenerateAudio: input.audio === "model" ? "true" : "false" }),
}));
mock.module("@/lib/canvas/canvas-project-generation", () => ({ buildGenerationConfig: (config: typeof defaultConfig) => config }));
const submitted: BackendGenerationTaskOptions[] = [];
mock.module("@/services/api/generation-task", () => ({
    submitBackendGenerationTask: async (options: BackendGenerationTaskOptions) => {
        submitted.push(options);
        return { id: `task-${submitted.length}`, status: "succeeded" };
    },
    parseBackendGenerationResult: (task: { id: string }) => ({ video: { storageKey: `resource:take-${task.id}`, durationMs: 4000, width: 720, height: 1280 }, images: [{ storageKey: `resource:image-${task.id}`, width: 720, height: 1280 }] }),
}));
mock.module("@/services/api/task-center", () => ({
    queryGenerationTask: async (id: string) => ({ id, status: "succeeded" }),
    waitForGenerationTask: async (id: string) => ({ id, status: "succeeded", resultJson: JSON.stringify({ resourceId: "final", durationMs: 8000 }) }),
    isGenerationTaskTerminalError: () => false,
    cancelGenerationTask: async () => ({ status: "cancelled" }),
}));
let rendered = 0;
mock.module("@/services/api/timeline-tasks", () => ({
    createTimelineRenderTask: async () => {
        rendered += 1;
        return { id: "render", status: "succeeded" };
    },
}));
const { createProductVideo, readRemake, updateRemake } = await import("@/pages/video-replication/replace/use-product-video-store");
const { startRemake, isRemakeRunning, approveRemakeTake, assembleRemake } = await import("@/pages/video-replication/remake/remake-runner");

async function finished(id: string) {
    for (let i = 0; i < 100 && isRemakeRunning(id); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(isRemakeRunning(id)).toBe(false);
}

test("真实生成流程冻结同一组目标图与音色，候选核对前不自动合成、不重复提交", async () => {
    const job = createRemakeJob("runner-quality", {
        teardownId: "teardown",
        sourceName: "纸巾原片",
        analysis: null,
        bundle: {
            version: 1,
            source: { resourceId: "source", durationMs: 8000, width: 720, height: 1280, hasAudio: true },
            shots: [0, 1].map((index) => ({ index: index + 1, startMs: index * 4000, endMs: (index + 1) * 4000, boundary: "cut", keyframeTimeMs: index * 4000 + 500, keyframeResourceId: `old-frame-${index}`, keyframeWidth: 720, keyframeHeight: 1280 })),
            grids: [],
            transcript: { source: "none", segments: [] },
            warnings: [],
        },
    });
    job.model = "video";
    job.audio = "rewrite";
    job.product.images = [{ id: "product", resourceId: "target-product", name: "商品" }];
    job.models = [{ id: "model", resourceId: "target-model", name: "模特", role: "figure" }];
    job.voiceReference = { resourceId: "same-speaker", name: "干声", durationMs: 3000 };
    job.shots = job.shots.map((shot) => ({ ...shot, risks: ["face", "product"], speaker: true, dialogue: "看看这包纸", treatment: "remake" }));
    job.continuity = { input: remakeContinuityInput(job), model: "image", attempt: 1, confirmed: true, image: { id: "anchor", resourceId: "target-frame", name: "定妆" } };
    // 不同做法产生两个实际生成单元，其中换元素片段已切好。
    job.shots[0].treatment = "replace";
    const { planRemakeUnits } = await import("@/lib/remake/units");
    job.units = planRemakeUnits(job.shots, { maxMs: 8000, sourceDurationMs: 8000 });
    job.units[0].clipResourceId = "source-clip";
    await createProductVideo(job);
    await startRemake(job.id, defaultConfig);
    await finished(job.id);
    expect(readRemake(job.id)?.status).toBe("review");
    expect(submitted).toHaveLength(2);
    for (const task of submitted) {
        expect(task.referenceImages?.map((image) => image.storageKey)).toEqual(["resource:target-product", "resource:target-model", "resource:target-frame"]);
        expect(task.referenceAudios?.map((audio) => audio.storageKey)).toEqual(["resource:same-speaker"]);
        expect(task.prompt).toContain("0.000–4.000 秒");
    }
    expect(rendered).toBe(0);
    await expect(assembleRemake(job.id, defaultConfig)).rejects.toThrow("尚未核对");
    for (const unit of readRemake(job.id)!.units) await approveRemakeTake(job.id, unit.key);
    await assembleRemake(job.id, defaultConfig);
    await finished(job.id);
    expect(rendered).toBe(1);
    expect(submitted).toHaveLength(2);
    expect(readRemake(job.id)?.render?.resourceId).toBe("final");
});

test("修改商品后不能确认或合成旧配方的候选，即使原候选已确认", async () => {
    const changed = structuredClone(readRemake("runner-quality")!);
    changed.id = "quality-changed-recipe";
    changed.product.images[0].resourceId = "different-product";
    await createProductVideo(changed);
    const before = rendered;
    await expect(approveRemakeTake(changed.id, changed.units[0].key)).rejects.toThrow("旧配方");
    await expect(assembleRemake(changed.id, defaultConfig)).rejects.toThrow("旧配方");
    await updateRemake(changed.id, (job) => ({ ...job, title: "更换商品后重新制作" }));
    expect(readRemake(changed.id)?.title).toBe("更换商品后重新制作");
    expect(rendered).toBe(before);
});

test("换素材或图片模型后仍能取回旧定妆任务，旧图不冒充当前定妆且不再提交收费任务", async () => {
    const { generateContinuity } = await import("@/pages/video-replication/remake/remake-continuity");
    const previous = structuredClone(readRemake("runner-quality")!);
    previous.id = "continuity-recovery";
    previous.continuity = { input: remakeContinuityInput(previous), model: "old-image-model", attempt: 2, confirmed: false, taskId: "existing-continuity" };
    previous.product.images[0].resourceId = "changed-product";
    await createProductVideo(previous);
    const before = submitted.length;
    await generateContinuity(previous.id, defaultConfig, "changed-image-model");
    const recovered = readRemake(previous.id)!;
    expect(submitted).toHaveLength(before);
    expect(recovered.continuity?.image?.resourceId).toBe("image-existing-continuity");
    expect(recovered.continuity?.model).toBe("old-image-model");
    expect(recovered.continuity?.attempt).toBe(2);
    expect(recovered.continuity?.taskId).toBeUndefined();
    expect(recovered.product.images[0].resourceId).toBe("changed-product");
    expect(remakeContinuityImage(recovered)).toBeUndefined();
});
