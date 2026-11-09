import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/video-replication" });
for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLAnchorElement",
    "HTMLBodyElement",
    "HTMLHtmlElement",
    "Element",
    "Node",
    "SVGElement",
    "ShadowRoot",
    "Event",
    "MouseEvent",
    "MutationObserver",
    "ResizeObserver",
]) {
    const value = key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.getComputedStyle.bind(dom) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { create } = await import("zustand");
const { defaultConfig } = await import("@/stores/use-config-store");
const { createRemakeJob } = await import("@/lib/remake/job");
const { createRemakeEditTimeline } = await import("@/lib/remake/editor");
const { planRemakeUnits } = await import("@/lib/remake/units");
import type { RemakeJob } from "@/lib/remake/job";
import type { EditorStore } from "@/stores/editor/editor-store";
import type { StoreApi, UseBoundStore } from "zustand";
import type { TimelineProject } from "@/types/timeline";

const job = createRemakeJob("ui-work", {
    teardownId: "source-analysis",
    sourceName: "裙装展示",
    analysis: null,
    bundle: {
        version: 1,
        source: { resourceId: "source", durationMs: 6000, width: 720, height: 1280, hasAudio: false },
        shots: [{ index: 1, startMs: 0, endMs: 6000, boundary: "start", keyframeTimeMs: 1000, keyframeResourceId: "frame", keyframeWidth: 720, keyframeHeight: 1280 }],
        grids: [],
        transcript: { source: "none", segments: [] },
        warnings: [],
    },
});
job.model = "video-a";
job.ratio = "9:16";
job.resolution = "720p";
job.shots[0].treatment = "remake";
job.units = planRemakeUnits(job.shots, { maxMs: 10000, sourceDurationMs: 6000 });
job.units[0] = { ...job.units[0], status: "succeeded", takes: [{ taskId: "take-task", resourceId: "take", createdAt: "", durationMs: 6000, width: 720, height: 1280 }] };
job.status = "succeeded";
job.render = { resourceId: "final" };
job.models = [
    { id: "face", resourceId: "face", name: "选中的人脸", role: "face" },
    { id: "pose", resourceId: "pose", name: "选中的姿势", role: "pose" },
];
let saved: RemakeJob = structuredClone(job);
let pauseSave = false;
let release: (() => void) | undefined;
const snapshots: RemakeJob[] = [];
const renders: TimelineProject[] = [];
const polled: string[] = [];
mock.module("@/services/api/product-video", () => ({
    PRODUCT_VIDEO_CONFLICT: "product_video_conflict",
    listProductVideos: async () => [saved],
    getProductVideo: async () => saved,
    saveProductVideo: async (value: RemakeJob) => {
        snapshots.push(structuredClone(value));
        if (pauseSave) {
            pauseSave = false;
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        }
        saved = { ...structuredClone(value), revision: saved.revision + 1 };
        return saved;
    },
    deleteProductVideo: async () => undefined,
}));
const configuration = await import("@/stores/use-config-store");
mock.module("@/stores/use-config-store", () => ({ ...configuration, useEffectiveConfig: () => ({ ...defaultConfig, videoModel: "video-a" }), selectableModelsByCapability: () => ["video-a", "video-b"] }));
const capabilities = await import("@/lib/model-capabilities");
mock.module("@/lib/model-capabilities", () => ({ ...capabilities, modelCapabilityConfigFor: () => ({ video: { ratios: ["9:16"], defaultRatio: "9:16", resolutions: ["720p"], defaultResolution: "720p" } }) }));
mock.module("@/pages/video-replication/replace/product-video-config", () => ({ productVideoLimitsFor: () => ({ maxImages: 10, generateAudio: true, maxSegmentSeconds: 10 }) }));
mock.module("@/pages/video-replication/remake/remake-config", () => ({ remakeLimitsFor: () => ({ maxImages: 10, generateAudio: true, maxSegmentSeconds: 10 }) }));
mock.module("@/pages/video-replication/remake/use-remake-estimate", () => ({ useRemakeEstimate: () => ({ enabled: false, state: "idle", units: 0 }) }));
mock.module("@/components/layout/workspace-page", () => ({ WorkspacePage: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
mock.module("@/components/model-picker", () => ({
    ModelPicker: ({ value, onChange }: { value: string; onChange: (model: string) => void }) => (
        <select aria-label="视频模型" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="video-a">视频 A</option>
            <option value="video-b">视频 B</option>
        </select>
    ),
}));
const runnerState = create(() => ({ active: {}, progress: {} }));
mock.module("@/pages/video-replication/remake/remake-runner", () => ({
    useRemakeRuntime: runnerState,
    remakeUnitsFor: (value: RemakeJob) => value.units,
    startRemake: async () => undefined,
    stopRemake: async () => undefined,
    retryRemake: async () => undefined,
    assembleRemake: async () => undefined,
    redoRemakeUnit: async () => undefined,
    chooseRemakeTake: async () => undefined,
}));
const storage = await import("@/services/file-storage");
mock.module("@/services/file-storage", () => ({ ...storage, resolveMediaUrl: async () => "" }));
const tasks = await import("@/services/api/task-center");
mock.module("@/services/api/task-center", () => ({
    ...tasks,
    queryGenerationTask: async (id: string) => ({ id, status: "succeeded", resultJson: JSON.stringify({ resourceId: "edited-video", durationMs: 6000 }) }),
    waitForGenerationTask: async (id: string) => {
        polled.push(id);
        return { id, status: "succeeded", resultJson: JSON.stringify({ resourceId: "edited-video", durationMs: 6000 }) };
    },
}));
const timelineApi = await import("@/services/api/timeline-tasks");
mock.module("@/services/api/timeline-tasks", () => ({
    ...timelineApi,
    createTimelineRenderTask: async ({ timeline }: { timeline: TimelineProject }) => {
        renders.push(timeline);
        return { id: "edit-render-task", status: "queued" };
    },
}));
mock.module("@/lib/plugins/builtin/editor/editor-filmstrip-media", () => ({ readTimelineFrames: async () => undefined }));
const resources = await import("@/services/api/resources");
mock.module("@/services/api/resources", () => ({ ...resources, uploadResourceFile: async () => ({ id: "uploaded-product", width: 720, height: 1280 }) }));
const { loadProductVideos, updateRemake, useProductVideoStore } = await import("@/pages/video-replication/replace/use-product-video-store");
const { RemakeWorkbench } = await import("@/pages/video-replication/remake/remake-workbench");
const { RemakeEditor } = await import("@/pages/video-replication/remake/remake-editor");
afterAll(() => dom.happyDOM.abort());

test("上传商品无需名称也显示已上传，人脸、姿势与模型都有摘要；保存中编辑不丢失", async () => {
    await loadProductVideos(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const steps: string[] = [];
    await act(async () =>
        root.render(
            <App>
                <RemakeWorkbench id={job.id} step="recipe" onStep={(step) => steps.push(step)} onBack={() => undefined} onOpen={() => undefined} onOpenTeardown={() => undefined} />
            </App>,
        ),
    );
    expect(host.textContent).toContain("还没选商品");
    const fileInput = host.querySelector<HTMLInputElement>(".pv-slot[aria-label='商品图'] input[type='file']")!;
    await act(async () => {
        Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["fixture"], "商品.png", { type: "image/png" })] });
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("已上传商品");
    expect(host.textContent).not.toContain("还没选商品");
    expect(host.querySelector(".rw-summary-references")?.textContent).toContain("人脸");
    expect(host.querySelector(".rw-summary-references")?.textContent).toContain("姿势");
    expect(host.querySelector(".rw-summary")?.textContent).toContain("video-a");
    pauseSave = true;
    const produce = Array.from(host.querySelectorAll<HTMLButtonElement>(".rw-steps button")).find((button) => button.textContent?.includes("出片对比"))!;
    await act(async () => {
        produce.click();
        await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>("input[aria-label='商品名称']")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, "上传后新名称");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
        release!();
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(input.value).toBe("上传后新名称");
    await act(async () => {
        produce.click();
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(saved.product.name).toBe("上传后新名称");
    expect(saved.product.images[0].resourceId).toBe("uploaded-product");
    expect(steps).toContain("produce");
    expect(snapshots.at(-1)?.units[0].takes[0].resourceId).toBe("take");
    await act(async () => root.unmount());
    host.remove();
});

test("真实剪辑台的分割、撤销与服务端保存，重新打开后恢复两段", async () => {
    const timeline = createRemakeEditTimeline(saved);
    await updateRemake(job.id, (latest) => ({ ...latest, editTimeline: timeline }));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let editor: UseBoundStore<StoreApi<EditorStore>> | undefined;
    function EditorHarness() {
        const current = useProductVideoStore((state) => state.jobs.find((item) => item.id === job.id)) as RemakeJob;
        return (
            <RemakeEditor
                job={current}
                onReady={(store) => {
                    editor = store;
                }}
            />
        );
    }
    await act(async () =>
        root.render(
            <App>
                <EditorHarness />
            </App>,
        ),
    );
    await act(async () => editor!.getState().seekTransportMs(3000));
    const split = host.querySelector<HTMLButtonElement>("button[aria-label='在播放头分割']")!;
    expect(split.disabled).toBe(false);
    await act(async () => split.click());
    expect(editor!.getState().project?.clips.filter((clip) => clip.kind === "video")).toHaveLength(2);
    await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='撤销剪辑']")!.click());
    expect(editor!.getState().project?.clips.filter((clip) => clip.kind === "video")).toHaveLength(1);
    await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='重做剪辑']")!.click());
    await act(async () => editor!.getState().flushSave());
    expect(saved.editTimeline?.clips.filter((clip) => clip.kind === "video")).toHaveLength(2);
    await act(async () => root.unmount());
    const reopened = createRoot(host);
    await act(async () =>
        reopened.render(
            <App>
                <EditorHarness />
            </App>,
        ),
    );
    expect(editor!.getState().project?.clips.filter((clip) => clip.kind === "video")).toHaveLength(2);
    const render = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("导出剪辑成片"))!;
    await act(async () => {
        render.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ width: 720, height: 1280, fit: "pad" });
    expect(renders[0].clips.filter((clip) => clip.kind === "video")).toHaveLength(2);
    expect(polled).toContain("edit-render-task");
    expect(saved.editRender?.resourceId).toBe("edited-video");
    expect(host.textContent).toContain("下载剪辑版");
    await act(async () => reopened.unmount());
    host.remove();
});
