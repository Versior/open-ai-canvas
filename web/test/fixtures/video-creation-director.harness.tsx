import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { RemakeJob } from "@/lib/remake/job";
import type { VideoTeardownBundle, VideoReplicationDetail } from "@/services/api/video-replication";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "ShadowRoot", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "ResizeObserver"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.getComputedStyle.bind(dom) });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { create } = await import("zustand");
const configModule = await import("@/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");
const { useUserStore } = await import("@/stores/use-user-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { createCreativeJob, creativeFactsInput, creativeCastDefaults } = await import("@/lib/remake/creative");
const product = { name: "测试杯", sellingPoints: "实拍蓝色杯身", images: [{ id: "photo", resourceId: "test_product", name: "测试实拍" }] };
const channel = configModule.createModelChannel({ id: "test-director", name: "测试", interfaceType: "openai", baseUrl: "/api", apiKey: "", models: ["test-vision"] });
const capabilityConfig = defaultModelCapabilityConfig("openai", "test-vision");
capabilityConfig.text!.references.maxImages = 4;
channel.modelCosts = [{ model: "test-vision", capabilityConfig }];
const model = configModule.encodeChannelModel(channel.id, "test-vision");
const config = { ...configModule.defaultConfig, channels: [channel], textModel: model };
mock.module("@/stores/use-config-store", () => ({ ...configModule, useEffectiveConfig: () => config }));
const store = create<{ jobs: RemakeJob[]; status: string; error: string }>(() => ({ jobs: [], status: "ready", error: "" }));
const calls: string[] = [];
let saveError = false;
let savedJob: RemakeJob | undefined;
let finishSave = () => {};
let finishRun = () => {};
let runSignal: AbortSignal | undefined;
let runOptions: unknown;
mock.module("@/pages/video-replication/replace/use-product-video-store", () => ({
    useProductVideoStore: store,
    loadProductVideos: async () => {},
    createProductVideo: async (job: RemakeJob) => {
        calls.push("save");
        await new Promise<void>((resolve) => {
            finishSave = resolve;
        });
        if (saveError) throw new Error("测试保存失败");
        savedJob = job;
        store.setState({ jobs: [job] });
        calls.push("saved");
    },
}));
mock.module("@/pages/video-replication/remake/creative-runner", () => ({
    executeCreativeRun: async (id: string, _config: unknown, signal: AbortSignal, options: unknown) => {
        calls.push(`plan:${id}`);
        runSignal = signal;
        runOptions = options;
        await new Promise<void>((resolve) => {
            finishRun = resolve;
        });
    },
}));
let home: ComponentProps<typeof import("@/pages/video-replication/replication-home").ReplicationHome>;
mock.module("@/pages/video-replication/replication-home", () => ({
    ReplicationHome: (props: typeof home) => {
        home = props;
        return <div>素材创作首页</div>;
    },
}));
mock.module("@/pages/video-replication/remake/remake-workbench", () => ({
    RemakeWorkbench: ({ id, creativeRunning, onBack }: { id: string; creativeRunning: boolean; onBack: () => void }) => (
        <div data-job={id} data-running={String(creativeRunning)}>
            <button onClick={onBack}>返回首页</button>
        </div>
    ),
}));
mock.module("@/components/layout/workspace-page", () => ({ WorkspacePage: ({ children }: { children: React.ReactNode }) => children }));
mock.module("@/pages/video-replication/replication-mode-switch", () => ({ ReplicationTabs: () => null }));
mock.module("@/pages/video-replication/replication-workspace", () => ({ ReplicationWorkspace: () => null }));
mock.module("@/pages/video-replication/remake/remake-works", () => ({ RemakeWorks: () => null }));
mock.module("@/pages/video-replication/remake/remake-runner", () => ({ resumeRemakes: () => {} }));
mock.module("@/pages/video-replication/replace/product-video-runner", () => ({ resumeProductVideos: () => {} }));
mock.module("@/pages/ecommerce-studio/studio-prompt-config", () => ({ loadStudioPromptConfig: async () => {} }));
mock.module("@/pages/video-replication/replication-canvas", () => ({ openVideoTeardownInCanvas: async () => null }));
const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "test_video", durationMs: 8000, width: 720, height: 1280, hasAudio: false },
    shots: [0, 1].map((index) => ({ index: index + 1, startMs: index * 4000, endMs: (index + 1) * 4000, boundary: "cut", keyframeTimeMs: index * 4000 + 1000, keyframeResourceId: `frame_${index}`, keyframeWidth: 720, keyframeHeight: 1280 })),
    grids: [],
    transcript: { source: "none", segments: [] },
    warnings: [],
};
const reference: VideoReplicationDetail = { task: { id: "chat_reference", type: "video_teardown", status: "succeeded", prompt: "", attempts: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" } };
let receiveRecord: (id: string) => void;
mock.module("@/services/api/video-replication", () => ({ getVideoReplicationConfig: async () => ({}), listVideoReplications: async () => [], getVideoReplication: async () => null, parseVideoTeardownBundle: () => bundle }));
mock.module("@/pages/video-replication/use-replication-runner", () => ({
    videoReplicationKeys: { config: (scope: string) => ["config", scope], list: (scope: string) => ["list", scope], detail: (scope: string, id: string) => ["detail", scope, id] },
    useReplicationRun: (onRecord: typeof receiveRecord) => {
        receiveRecord = onRecord;
        return { run: null, running: false };
    },
    dismissReplicationError: () => {},
    reanalyzeReplication: async () => {},
    resumePendingReplication: () => {},
    startReplication: async () => {},
}));
const { default: VideoReplicationPage } = await import("@/pages/video-replication/index");
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const client = new QueryClient();
async function render() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <MemoryRouter>
                        <VideoReplicationPage />
                    </MemoryRouter>
                </App>
            </QueryClientProvider>,
        ),
    );
}
const brief = createCreativeJob("fixture", product).creative!.brief;
const director = { model, confirmedInput: creativeFactsInput({ product }) };
const submit = () => home.onCreative(brief, "保持杯身颜色", "16:9", product, director, creativeCastDefaults(brief.scene));
afterAll(async () => {
    await act(async () => root.unmount());
    client.clear();
    await dom.happyDOM.abort();
});

test("新建拆解留在对话，复刻模式和主体要求完整交接；保存失败继续留在原页面", async () => {
    setActiveUserScope("reference-home-test");
    useUserStore.getState().setUser({ id: "reference-home-test", username: "test", displayName: "测试", role: "user", status: "active" });
    await render();
    await act(async () => receiveRecord("chat_reference"));
    expect(home.referenceId).toBe("chat_reference");
    expect(host.textContent).toContain("素材创作首页");
    for (const mode of ["structure", "style", "elements"] as const) {
        let pending!: Promise<void>;
        await act(async () => {
            pending = home.onRemake(reference, "参考广告", { mode, product, note: "不要音乐", seconds: 20, ratio: "1:1" });
        });
        await act(async () => {
            finishSave();
            await pending;
        });
        expect(savedJob).toMatchObject({ product, note: "不要音乐", ratio: "1:1", source: { teardownId: "chat_reference", resourceId: "test_video" } });
        if (mode === "elements") expect(savedJob!.replication).toBeUndefined();
        if (mode !== "elements") expect(savedJob!.replication).toMatchObject({ mode, targetDurationMs: mode === "style" ? 20000 : 8000, brief: "不要音乐", confirmed: false });
        expect(host.querySelector("[data-job]")?.getAttribute("data-job")).toBe(savedJob!.id);
        await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    }
    saveError = true;
    let rejected!: Promise<void>;
    await act(async () => {
        rejected = home.onRemake(reference, "参考广告", { mode: "style", product, note: "", seconds: 20 });
    });
    await act(async () => {
        finishSave();
        await expect(rejected).rejects.toThrow("测试保存失败");
    });
    expect(host.textContent).toContain("素材创作首页");
    saveError = false;
    await act(async () => home.onReferenceChange(""));
    expect(home.referenceId).toBe("");
    calls.length = 0;
});

test("首页服务端保存后直接启动导演策划，同一作品显示运行中，重复点击只提交一次", async () => {
    setActiveUserScope("director-home-test");
    await act(async () => {
        useUserStore.getState().setUser({ id: "director-home-test", username: "test", displayName: "测试", role: "user", status: "active" });
        useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true } }));
    });
    await render();
    let pending!: Promise<void>;
    await act(async () => {
        pending = submit();
        void submit();
    });
    expect(calls).toEqual(["save"]);
    expect(home.creating).toBe(true);
    await act(async () => finishSave());
    expect(calls).toEqual(["save", "saved", `plan:${savedJob!.id}`]);
    expect(savedJob).toMatchObject({ product, note: "保持杯身颜色", ratio: "16:9", creative: { brief, confirmedInput: director.confirmedInput } });
    expect(runOptions).toEqual({ kind: "plan", model, count: 4 });
    expect(host.querySelector('[data-running="true"]')?.getAttribute("data-job")).toBe(savedJob!.id);
    await act(async () => {
        finishRun();
        await pending;
    });
    expect(host.querySelector('[data-running="false"]')).not.toBeNull();
});

test("没有确认或保存失败不调用模型，账号切换会取消首页导演任务", async () => {
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => home.onCreative(brief, "", "9:16", product, { model, confirmedInput: "invalid" }, creativeCastDefaults(brief.scene)));
    expect(calls).toHaveLength(3);
    saveError = true;
    let pending!: Promise<void>;
    await act(async () => {
        pending = submit();
    });
    await act(async () => {
        finishSave();
        await pending;
    });
    expect(calls.at(-1)).toBe("save");
    expect(home.creating).toBe(false);
    saveError = false;
    await act(async () => {
        pending = submit();
    });
    await act(async () => finishSave());
    expect(runSignal!.aborted).toBe(false);
    setActiveUserScope("another-director-test");
    await act(async () => useUserStore.getState().setUser({ id: "another-director-test", username: "other", displayName: "另一个测试", role: "user", status: "active" }));
    await render();
    expect(runSignal!.aborted).toBe(true);
    await act(async () => {
        finishRun();
        await pending;
    });
});
