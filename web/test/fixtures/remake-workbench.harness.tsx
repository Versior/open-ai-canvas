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
import { referenceFixture, referencePlanOutput } from "./reference-replication-data";
import { applyReferenceReplicationPlan, parseReferenceReplicationPlan, referenceReplicationInput, setReferenceReplicationMode } from "@/lib/remake/reference-replication";

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
    approveRemakeTake: async () => undefined,
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
const { timelineLutCube } = await import("@/lib/timeline/timeline-lut");
const librarySnapshot = { name: "暖阳柔肤", cube: timelineLutCube({ name: "暖阳柔肤", preset: "warm", strength: 1 }), strength: 1, libraryId: "lut-builtin-warm", libraryVersion: 1 };
let libraryEnabled = true;
let lutRead: Promise<void> | undefined;
mock.module("@/services/api/lut-library", () => ({
    listLUTLibrary: async () => (libraryEnabled ? [{ id: "lut-builtin-warm", name: "暖阳柔肤", category: "内置预设", description: "亲子", preset: "warm", cubeSize: 17, defaultStrength: 1, enabled: true, version: 1 }] : []),
    getLUTLibraryItem: async () => {
        await lutRead;
        return { lut: librarySnapshot };
    },
}));
const resources = await import("@/services/api/resources");
mock.module("@/services/api/resources", () => ({ ...resources, uploadResourceFile: async () => ({ id: "uploaded-product", width: 720, height: 1280 }) }));
const { loadProductVideos, updateRemake, useProductVideoStore } = await import("@/pages/video-replication/replace/use-product-video-store");
let planningRelease: (() => void) | undefined;
let planningDelay: Promise<void> | undefined;
const modeChanges: string[] = [];
mock.module("@/pages/video-replication/remake/reference-replication-runner", () => ({
    changeReferenceReplicationMode: async (id: string, mode: "elements" | "structure" | "style") => {
        modeChanges.push(mode);
        await updateRemake(id, (value) => setReferenceReplicationMode(value, mode, value.replication?.sourceShots || value.shots));
    },
    generateReferenceReplicationPlan: async (id: string, _config: unknown, model: string) => {
        await planningDelay;
        await updateRemake(id, (value) => ({
            ...value,
            replication: {
                ...value.replication!,
                run: undefined,
                confirmed: false,
                plan: parseReferenceReplicationPlan(JSON.stringify(referencePlanOutput(value.replication?.mode === "style")), value, { id: "ui-plan", model, createdAt: "2026-01-01T00:00:00Z" }),
            },
        }));
    },
}));
const { RemakeWorkbench } = await import("@/pages/video-replication/remake/remake-workbench");
const { RemakeEditor } = await import("@/pages/video-replication/remake/remake-editor");
const { RemakeProduce } = await import("@/pages/video-replication/remake/remake-produce");
const { ReferenceReplicationCard } = await import("@/pages/video-replication/remake/reference-replication-card");
afterAll(() => dom.happyDOM.abort());

test("对比预览按两份媒体比例显示，默认紧凑且可放大，逐段选择保留候选核对", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const previewJob = { ...structuredClone(job), render: { resourceId: "final", width: 1920, height: 1080, durationMs: 6000 } };
    previewJob.units[0].creativeSignature = "current-recipe";
    previewJob.units[0].takes[0].inputSignature = "current-recipe";
    await act(async () =>
        root.render(
            <App>
                <RemakeProduce job={previewJob} config={defaultConfig} onEditRecipe={() => undefined} />
            </App>,
        ),
    );
    expect(host.querySelector(".rw-produce")?.getAttribute("data-preview")).toBe("compact");
    const panes = host.querySelectorAll<HTMLElement>(".rw-pane");
    expect(Number(panes[0].style.getPropertyValue("--rw-preview-ratio"))).toBe(720 / 1280);
    expect(Number(panes[1].style.getPropertyValue("--rw-preview-ratio"))).toBe(1920 / 1080);
    const expand = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "放大预览")!;
    await act(async () => expand.click());
    expect(expand.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".rw-produce")?.getAttribute("data-preview")).toBe("expanded");
    await act(async () => expand.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".rw-block-unit")!.click());
    expect(host.querySelector(".rw-inspector")?.getAttribute("data-selection")).toBe("unit");
    expect(Number(panes[1].style.getPropertyValue("--rw-preview-ratio"))).toBe(720 / 1280);
    expect(host.textContent).toContain("人物、商品和声音正确");
    expect(host.querySelectorAll(".rw-time-ruler span")).toHaveLength(5);
    await act(async () => root.unmount());
    host.remove();
});

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
    await act(async () =>
        Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
            .find((button) => button.textContent === "LUT 滤镜")!
            .click(),
    );
    const warm = Array.from(host.querySelectorAll<HTMLButtonElement>("button[role='radio']")).find((button) => button.textContent?.includes("暖阳柔肤"))!;
    let finishRead!: () => void;
    lutRead = new Promise<void>((resolve) => {
        finishRead = resolve;
    });
    await act(async () => warm.click());
    expect(editor!.getState().project?.colorLut).toBeUndefined();
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("导出剪辑成片"))!.disabled).toBe(true);
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>("button[role='radio']")).find((button) => button.textContent?.includes("原色"))!.disabled).toBe(true);
    await act(async () => {
        finishRead();
        await lutRead;
    });
    expect(editor!.getState().project?.colorLut).toEqual(librarySnapshot);
    await act(async () => editor!.getState().flushSave());
    expect(saved.editTimeline?.clips.filter((clip) => clip.kind === "video")).toHaveLength(2);
    expect(saved.editTimeline?.colorLut).toEqual(librarySnapshot);
    libraryEnabled = false;
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
    await act(async () =>
        Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
            .find((button) => button.textContent === "LUT 滤镜")!
            .click(),
    );
    expect(host.textContent).toContain("已保存的作品滤镜快照");
    const render = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("导出剪辑成片"))!;
    await act(async () => {
        render.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ width: 720, height: 1280, fit: "pad" });
    expect(renders[0].colorLut).toEqual(librarySnapshot);
    expect(renders[0].clips.filter((clip) => clip.kind === "video")).toHaveLength(2);
    expect(polled).toContain("edit-render-task");
    expect(saved.editRender?.resourceId).toBe("edited-video");
    expect(host.textContent).toContain("下载剪辑版");
    await act(async () => reopened.unmount());
    host.remove();
});

test("真实参考卡片切换模式、锁定规划、展示迁移依据、应用与过期后恢复", async () => {
    saved = referenceFixture();
    await loadProductVideos(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const busyStates: boolean[] = [];
    function CardHarness() {
        const current = useProductVideoStore((state) => state.jobs.find((item) => item.id === saved.id)) as RemakeJob;
        return <ReferenceReplicationCard job={current} config={{ ...defaultConfig, textModel: "video-a" }} edit={(update) => void updateRemake(current.id, update)} flush={async () => undefined} onBusyChange={(busy) => busyStates.push(busy)} />;
    }
    const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)!;
    await act(async () =>
        root.render(
            <App>
                <CardHarness />
            </App>,
        ),
    );
    expect(host.querySelectorAll("button[role=radio]")).toHaveLength(3);
    await act(async () => button("风格复刻").click());
    expect(modeChanges.at(-1)).toBe("style");
    expect(host.querySelector("input[aria-label='风格复刻目标时长']")).toBeTruthy();
    planningDelay = new Promise((resolve) => {
        planningRelease = resolve;
    });
    await act(async () => button("分析参考并规划目标分镜").click());
    expect([...host.querySelectorAll<HTMLButtonElement>("button[role=radio]")].every((item) => item.disabled)).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>("textarea[aria-label='参考改编要求']")!.disabled).toBe(true);
    await act(async () => {
        planningRelease!();
        await planningDelay;
    });
    expect(busyStates).toContain(true);
    expect(busyStates.at(-1)).toBe(false);
    expect(host.textContent).toContain("原镜头作用与迁移依据");
    expect(host.querySelectorAll(".rw-reference-shots li")).toHaveLength(3);
    await act(async () => button("应用方案，进入目标分镜").click());
    expect(saved.replication?.confirmed).toBe(true);
    expect(saved.shots).toHaveLength(3);
    expect(button("已应用目标分镜").disabled).toBe(true);
    await act(async () => updateRemake(saved.id, (value) => ({ ...value, product: { ...value.product, name: "新的扶手椅" }, replication: { ...value.replication!, confirmed: false } })));
    expect(host.textContent).toContain("资料已变化");
    expect(button("应用方案，进入目标分镜").disabled).toBe(true);
    await act(async () =>
        updateRemake(saved.id, (value) => ({
            ...value,
            replication: {
                ...value.replication!,
                run: { key: "pending", model: "video-a", input: referenceReplicationInput(value), createdAt: "2026-01-01T00:00:00Z", imageCount: 2, targetImageCount: 1, requestSignature: "a".repeat(64), taskId: "pending-task" },
            },
        })),
    );
    expect(button("恢复参考规划任务").disabled).toBe(false);
    await act(async () => button("恢复参考规划任务").click());
    expect(saved.replication?.run).toBeUndefined();
    expect(button("应用方案，进入目标分镜").disabled).toBe(false);
    await act(async () => root.unmount());
    host.remove();
});

test("风格参考独立播放，新片暂停、等待、换段与进度不控制原片", async () => {
    const value = referenceFixture("style");
    value.replication!.plan = parseReferenceReplicationPlan(JSON.stringify(referencePlanOutput(true)), value, { id: "style-plan", model: "vision-model", createdAt: "2026-01-01T00:00:00Z" });
    const preview = applyReferenceReplicationPlan(value);
    preview.units = preview.shots
        .flatMap((shot) => planRemakeUnits([shot], { maxMs: 10000, sourceDurationMs: 8000 }))
        .map((unit) => ({ ...unit, status: "succeeded", takes: [{ taskId: `task-${unit.key}`, resourceId: `take-${unit.key}`, createdAt: "", durationMs: unit.endMs - unit.startMs }] }));
    preview.render = { resourceId: "style-final", durationMs: 8000 };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
        root.render(
            <App>
                <RemakeProduce job={preview} config={defaultConfig} onEditRecipe={() => undefined} />
            </App>,
        ),
    );
    const left = host.querySelector<HTMLVideoElement>("video[aria-label='原片']")!;
    const right = host.querySelector<HTMLVideoElement>("video[aria-label='新片']")!;
    let pauses = 0;
    left.pause = () => {
        pauses++;
    };
    left.currentTime = 1;
    right.currentTime = 3;
    for (const event of ["timeupdate", "play", "pause", "waiting", "ended", "ratechange", "seeked"]) await act(async () => right.dispatchEvent(new Event(event)));
    await act(async () => host.querySelector<HTMLButtonElement>(".rw-block-unit")!.click());
    expect(left.controls).toBe(true);
    expect(left.currentTime).toBe(1);
    expect(pauses).toBe(0);
    expect(host.textContent).toContain("风格参考 · 独立播放");
    expect(host.textContent).not.toContain("导出对比视频");
    await act(async () => root.unmount());
    host.remove();
});
