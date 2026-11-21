import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { referenceFixture } from "./reference-replication-data";
import type { GenerationTask } from "@/services/api/task-center";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import type { BackendGenerationTaskOptions } from "@/services/api/generation-task";

const dom = new Window({ url: "http://localhost/video-replication" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, Event: dom.Event, CustomEvent: dom.CustomEvent }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
afterAll(() => dom.happyDOM.abort());
const { http } = await import("@/services/api/request");
const { setActiveUserScope, scopedLocalStorage } = await import("@/lib/user-scope");
const { loadProductVideos, readStoredWork, updateRemake, removeProductVideo, readProductVideo } = await import("@/pages/video-replication/replace/use-product-video-store");
const { createProductVideoJob, emptyProductVideoInputs } = await import("@/lib/product-video/job");
const { defaultConfig } = await import("@/stores/use-config-store");
const get = spyOn(http, "get");
const put = spyOn(http, "put");
const post = spyOn(http, "post");
const remove = spyOn(http, "delete");

const task = (id: string, status: GenerationTask["status"], result?: unknown): GenerationTask => ({ id, type: "canvas_video", status, prompt: "fixture", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify(result) });
const completedVideo = { video: { dataUrl: "/local/video", storageKey: "resource:fixture-result", width: 720, height: 1280, mimeType: "video/mp4", bytes: 10 } };
const videoConfig = await import("@/pages/video-replication/replace/product-video-config");
mock.module("@/pages/video-replication/replace/product-video-config", () => ({
    ...videoConfig,
    productVideoLimitsFor: () => ({ maxImages: 2, generateAudio: true, maxSegmentSeconds: 8, durations: [8] }),
    productVideoGenerationConfig: () => defaultConfig,
}));
const generation = await import("@/services/api/generation-task");
const submitted: string[] = [];
const analysisRequests: BackendGenerationTaskOptions[] = [];
mock.module("@/services/api/generation-task", () => ({
    ...generation,
    submitBackendGenerationTask: async (options: BackendGenerationTaskOptions) => {
        submitted.push(options.clientOperationId!);
        return task("replacement", "succeeded", completedVideo);
    },
    runBackendGenerationTask: async (options: BackendGenerationTaskOptions) => {
        analysisRequests.push(options);
        throw new Error("创建回执丢失");
    },
}));
const { stopProductVideo, retryProductVideo, isProductVideoRunning } = await import("@/pages/video-replication/replace/product-video-runner");
const { resumePendingReplication, reanalyzeReplication } = await import("@/pages/video-replication/use-replication-runner");

test("相反顺序的列表、保存和删除都不能回退已确认状态", async () => {
    setActiveUserScope("work-races");
    const job = referenceFixture();
    const page = (revision: number) => ({ revision, items: [{ ...job, revision, title: `版本${revision}` }] });
    const stale = Promise.withResolvers<ReturnType<typeof page>>();
    get.mockResolvedValueOnce(stale.promise).mockResolvedValueOnce(page(2));
    const first = loadProductVideos(true);
    await loadProductVideos(true);
    stale.resolve(page(1));
    await first;
    expect(readStoredWork(job.id)?.revision).toBe(2);
    const preWrite = Promise.withResolvers<ReturnType<typeof page>>();
    get.mockResolvedValueOnce(preWrite.promise);
    const reading = loadProductVideos(true);
    put.mockResolvedValueOnce({ revision: 10, item: { ...job, revision: 3, title: "已保存" } });
    await updateRemake(job.id, (old) => ({ ...old, title: "已保存" }));
    preWrite.resolve(page(2));
    await reading;
    expect(readStoredWork(job.id)?.title).toBe("已保存");
    const preDelete = Promise.withResolvers<ReturnType<typeof page>>();
    get.mockResolvedValueOnce(preDelete.promise);
    const listing = loadProductVideos(true);
    remove.mockResolvedValueOnce({ revision: 12 });
    await removeProductVideo(job.id);
    preDelete.resolve(page(11));
    await listing;
    expect(readStoredWork(job.id)).toBeUndefined();
});

for (const status of ["running", "succeeded", "cancelled"] as const)
    test(`取消失联后继续：原任务为 ${status}，先查任务再决定是否新建`, async () => {
        setActiveUserScope(`legacy-${status}`);
        const job = createProductVideoJob(`old-${status}`, { ...emptyProductVideoInputs(), model: "fixture", preview: true, endMs: 8000 }, { splitKey: "split", maxSegmentSeconds: 8 });
        job.revision = 1;
        job.status = "generating";
        job.split!.segments = [{ index: 1, resourceId: "segment", startMs: 0, endMs: 8000, durationMs: 8000, width: 720, height: 1280 }];
        job.shots = [{ index: 1, status: "running", attempt: 1, taskId: "original" }];
        submitted.length = 0;
        let revision = 1;
        let queries = 0;
        get.mockImplementation(async (url) => {
            if (url === "/ecommerce/product-videos") return { revision, items: [job] };
            expect(url).toBe("/tasks/original");
            queries++;
            return task("original", status === "running" && queries > 1 ? "succeeded" : status, completedVideo);
        });
        put.mockImplementation(async (_url, payload) => ({ revision: ++revision, item: { ...(payload as { item: object }).item, revision } }));
        post.mockRejectedValueOnce(new Error("取消状态未知"));
        await loadProductVideos(true);
        await stopProductVideo(job.id);
        expect(readProductVideo(job.id)?.shots[0]).toMatchObject({ taskId: "original", attempt: 1 });
        expect(readProductVideo(job.id)?.error).toContain("取消未确认");
        await retryProductVideo(job.id, defaultConfig);
        for (let step = 0; isProductVideoRunning(job.id) && step < 150; step++) await Bun.sleep(20);
        expect(queries).toBeGreaterThan(0);
        expect(submitted).toEqual(status === "cancelled" ? [`${job.id}-1-2`] : []);
        expect(readProductVideo(job.id)?.shots[0].resourceId).toBe("fixture-result");
    });

const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "source", durationMs: 4000, width: 640, height: 360, hasAudio: false },
    shots: [{ index: 1, startMs: 0, endMs: 4000, boundary: "start", keyframeTimeMs: 100, keyframeResourceId: "frame", keyframeWidth: 640, keyframeHeight: 360 }],
    grids: [{ resourceId: "grid", width: 640, height: 360, shotIndexes: [1] }],
    transcript: { source: "none", segments: [] },
    warnings: [],
};
const key = "video-replication:pending";
const recent = Array.from({ length: 50 }, (_, index) => ({ id: `recent-${index}`, status: "succeeded" as const, stage: "", progress: 100, createdAt: "", durationMs: 0, shotCount: 1 }));
const { createModelChannel, encodeChannelModel } = await import("@/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const vision = defaultModelCapabilityConfig("openai");
vision.text!.references.maxImages = 4;
vision.text!.references.maxImageBytes = 4_000_000;
const channel = createModelChannel({ id: "vision", name: "测试", interfaceType: "openai", baseUrl: "/api", apiKey: "", models: ["gpt-4o"], modelCosts: [{ model: "gpt-4o", capability: "text", capabilityConfig: vision }] });
const model = encodeChannelModel(channel.id, "gpt-4o");
const config = { ...defaultConfig, channels: [channel], textModel: model };
const unfinished = (id: string) => ({ id, model, transcribe: false, fallbackTitle: "视频", startedAt: Date.now(), textTasks: {} });

test("第51条待办按已知ID恢复，已提交文本任务不重建，已分析的待办不再执行", async () => {
    setActiveUserScope("resume-51");
    const id = "beyond-page";
    const detail = { task: task(id, "succeeded", bundle) };
    const row = { ...unfinished(id), textTasks: { "batch-1-try-1": "text-issued" } };
    const urls: string[] = [];
    let analyzed = false;
    get.mockImplementation(async (url) => {
        urls.push(url);
        if (url === `/video-replication/teardowns/${id}`) return analyzed ? { ...detail, analyzedAt: "2026-01-01" } : detail;
        if (url === "/tasks/text-issued") return task("text-issued", "cancelled");
        throw new Error(`非预期请求 ${url}`);
    });
    analysisRequests.length = 0;
    scopedLocalStorage.setItem(key, JSON.stringify([row]));
    await resumePendingReplication(recent, config);
    expect(urls).toEqual([`/video-replication/teardowns/${id}`, "/tasks/text-issued"]);
    expect(analysisRequests).toHaveLength(0);
    analyzed = true;
    scopedLocalStorage.setItem(key, JSON.stringify([row]));
    await resumePendingReplication(recent, config);
    expect(scopedLocalStorage.getItem(key)).toBeNull();
    expect(analysisRequests).toHaveLength(0);
});

test("同一拆解批次丢回执后继续沿用先保存的操作号", async () => {
    setActiveUserScope("analysis-replay");
    const id = "replay-analysis";
    get.mockResolvedValue({ task: task(id, "succeeded", bundle) });
    analysisRequests.length = 0;
    for (let attempt = 0; attempt < 2; attempt++) await reanalyzeReplication(id, { model, transcribe: false }, "测试", config);
    expect(analysisRequests).toHaveLength(2);
    expect(analysisRequests[0].clientOperationId).toBeTruthy();
    expect(analysisRequests[1].clientOperationId).toBe(analysisRequests[0].clientOperationId);
});
