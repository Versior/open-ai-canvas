import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { StudioShot } from "../../src/lib/ecommerce-studio/types";
import type { InteriorRound } from "../../src/services/api/interior";
import type { GenerationTask } from "../../src/services/api/task-center";
import type { GalleryActions, GalleryBatch } from "../../src/pages/workbench/workbench-gallery";
import type { EcommercePlanImage } from "../../src/services/api/ecommerce";
import type { PackagingProject } from "../../src/lib/packaging/types";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    Node: dom.Node,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    SVGElement: dom.SVGElement,
    Image: dom.Image,
    MouseEvent: dom.MouseEvent,
    CustomEvent: dom.CustomEvent,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ImageGenerationPack } = await import("../../src/components/image-pack/image-generation-pack");
const { ResultTile } = await import("../../src/pages/ecommerce-studio/studio-results");
const { createStudioProduct } = await import("../../src/lib/ecommerce-studio/product");
const { InteriorBoard } = await import("../../src/pages/interior/interior-board");
const { WorkbenchGalleryTile } = await import("../../src/pages/workbench/workbench-gallery");
const { EcommerceOutputGallery } = await import("../../src/pages/ecommerce/output-gallery");
const { emptyEcommerceDraft } = await import("../../src/services/api/ecommerce");
const { useConfigStore } = await import("../../src/stores/use-config-store");
const { PackagingMockups } = await import("../../src/pages/packaging/packaging-mockups");
const { newPackagingDocument } = await import("../../src/lib/packaging/types");
const { ImagePackProgress } = await import("../../src/components/image-pack/image-pack-progress");
const { GenerationSuccessNotifier } = await import("../../src/components/layout/generation-success-notifier");
const { observeGenerationTaskStatus } = await import("../../src/services/generation-completion-tracker");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useNotificationPreferencesStore } = await import("../../src/stores/use-notification-preferences-store");
const { useDocumentTitleStore } = await import("../../src/stores/use-document-title-store");
const noop = () => {};
const now = "2026-11-15T00:00:00Z";

function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    return {
        host,
        client,
        render: (children: ReactNode) => act(async () => root.render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)),
        close: async () => {
            await act(async () => root.unmount());
            client.clear();
            host.remove();
        },
    };
}
afterAll(() => dom.happyDOM.abort());

test("各入口共用主页阶段展示，隐藏无依据的进度并保留保存与费用状态", async () => {
    const view = mount();
    await view.render(<ImagePackProgress task={{ status: "running", stage: "provider_processing", progress: 0, createdAt: now }} />);
    expect(view.host.textContent).toContain("正在生成图片");
    expect(view.host.textContent).not.toContain("provider_processing");
    expect(view.host.textContent).not.toContain("0%");
    expect(view.host.querySelectorAll(".generation-phase-steps li").length).toBe(3);
    await view.render(<ImagePackProgress task={{ status: "running", stage: "上游生成中", progress: 42 }} />);
    expect(view.host.textContent).toContain("42%");
    await view.render(<ImagePackProgress task={{ status: "running", mediaStage: "upload", progress: 42 }} />);
    expect(view.host.textContent).toContain("正在保存图片");
    expect(view.host.textContent).not.toContain("42%");
    await view.render(<ImagePackProgress task={{ status: "running", stage: "submission_unknown" }} />);
    expect(view.host.textContent).toContain("为避免重复扣费，未自动重试");
    expect(view.host.querySelector(".generation-phase-steps")).toBeNull();
    await view.close();
});

test("真实完成事件不弹通知，后台仍计数，回到页面清除计数且不补弹窗", async () => {
    const view = mount();
    const previousUser = useUserStore.getState().user;
    const preferences = useNotificationPreferencesStore.getState();
    useUserStore.getState().setUser({ id: "notice-test", username: "sample", displayName: "测试用户", role: "user", status: "active" });
    useNotificationPreferencesStore.setState({ generationNotice: true, generationSound: false });
    await view.render(<GenerationSuccessNotifier />);
    const task: GenerationTask = { id: "visible-notice", type: "canvas_image", status: "running", prompt: "样例", attempts: 1, createdAt: now, updatedAt: now };
    observeGenerationTaskStatus(task);
    observeGenerationTaskStatus({ ...task, status: "succeeded" });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(document.querySelector(".ant-notification")).toBeNull();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    observeGenerationTaskStatus({ ...task, id: "hidden-notice" });
    observeGenerationTaskStatus({ ...task, id: "hidden-notice", status: "succeeded" });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(useDocumentTitleStore.getState().attentionCount).toBe(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new dom.Event("visibilitychange"));
    expect(useDocumentTitleStore.getState().attentionCount).toBe(0);
    expect(document.querySelector(".ant-notification")).toBeNull();
    await view.close();
    useUserStore.getState().setUser(previousUser);
    useNotificationPreferencesStore.setState({ generationNotice: preferences.generationNotice, generationSound: preferences.generationSound });
});

test("袋子跨生成到图片加载保持同一元素；图片失败后恢复操作", async () => {
    const view = mount();
    const render = (pending: boolean, succeeded: boolean) =>
        view.render(
            <ImageGenerationPack pending={pending} succeeded={succeeded} pendingActions={<button>取消任务</button>}>
                <button data-image-pack-result>
                    <img src="/result.png" alt="作品" />
                </button>
            </ImageGenerationPack>,
        );
    await render(true, false);
    const packet = view.host.querySelector(".image-generation-packet");
    expect(packet).not.toBeNull();
    expect(view.host.querySelector(".image-pack-slot-actions")?.textContent).toBe("取消任务");
    await render(false, true);
    expect(view.host.querySelector(".image-generation-packet")).toBe(packet);
    expect(view.host.querySelector(".image-generation-reveal")).toBeNull();
    await act(async () => view.host.querySelector("img")!.dispatchEvent(new dom.Event("error", { bubbles: true })));
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    expect(view.host.querySelector(".image-pack-slot-body")?.hasAttribute("inert")).toBe(false);
    await view.close();
});

test("历史图片、任务失败、取消和明确关闭动效不播放", async () => {
    const view = mount();
    await view.render(
        <ImageGenerationPack pending={false} succeeded>
            <img data-image-pack-result src="/history.png" />
        </ImageGenerationPack>,
    );
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    await view.render(
        <ImageGenerationPack pending succeeded={false}>
            <span>生成中</span>
        </ImageGenerationPack>,
    );
    await view.render(
        <ImageGenerationPack pending={false} succeeded={false}>
            <span>生成失败</span>
        </ImageGenerationPack>,
    );
    expect(view.host.textContent).toBe("生成失败");
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    await view.render(
        <ImageGenerationPack pending succeeded={false} disabled>
            <span>原等待状态</span>
        </ImageGenerationPack>,
    );
    expect(view.host.querySelector(".image-pack-slot")?.hasAttribute("data-active")).toBe(false);
    await view.close();
});

test("电商生图台的新结果保留袋子，旧采用图不会被冒充新结果开包", async () => {
    const view = mount();
    const product = createStudioProduct("sample", now);
    const shot: StudioShot = {
        id: "shot",
        role: "main-white",
        title: "主图",
        ratio: "1:1",
        headline: "",
        subline: "",
        lines: [],
        sellingPointIds: [],
        tweaks: [],
        attempts: [{ id: "attempt", status: "running", model: "sample", tweaks: [], createdAt: now, outputs: [] }],
    };
    const group = { key: "sample", ref: { planKind: "main" as const }, title: "主图", createdAt: now, textMode: "model" as const, shots: [shot], fromAgent: false };
    const render = (current: StudioShot) => view.render(<ResultTile product={product} group={group} shot={current} blocked="" onView={noop} onDownload={noop} onReference={noop} onRerun={noop} onSync={noop} />);
    await render({ ...shot, attempts: [{ ...shot.attempts[0], status: "submitting" }] });
    expect(view.host.querySelector(".image-pack-progress")?.getAttribute("data-phase")).toBe("submitting");
    expect(view.host.textContent).toContain("正在提交");
    await render(shot);
    const packet = view.host.querySelector(".image-generation-packet");
    const output = { resourceId: "new-result", url: "/result.png" };
    const done = { ...shot, attempts: [{ ...shot.attempts[0], status: "succeeded" as const, outputs: [output] }] };
    await render(done);
    expect(view.host.querySelector(".image-generation-packet")).toBe(packet);
    expect(view.host.querySelector("[data-image-pack-result] img")).not.toBeNull();
    await render({ ...done, adopted: { resourceId: "old-result", url: "/old.png" } });
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    await render({ ...shot, attempts: [{ ...shot.attempts[0], status: "failed", error: "模型暂时不可用", outputs: [] }] });
    expect(view.host.querySelector('.es-tile-state[data-tone="error"]')?.textContent).toContain("生成失败");
    expect(view.host.textContent).toContain("模型暂时不可用");
    await render({ ...shot, attempts: [{ ...shot.attempts[0], status: "cancelled", outputs: [] }] });
    expect(view.host.querySelector('.es-tile-state[data-tone="neutral"]')?.textContent).toContain("已取消");
    await view.close();
});

test("室内多张图片的等待和结果使用同一批位置，原图不参与开包", async () => {
    const view = mount();
    const round: InteriorRound = {
        id: "round",
        createdAt: now,
        surface: "quick",
        modeKey: "sample",
        modeName: "装修效果",
        params: {},
        count: 2,
        source: { resourceId: "source", width: 800, height: 600 },
        references: [],
        items: [{ id: "style", status: "pending", outputs: [] }],
    };
    const render = (current: InteriorRound) =>
        view.render(
            <InteriorBoard
                document={{ version: 1, rounds: [current] }}
                stalled={{}}
                busy={false}
                downloadingRound=""
                onRetryWatch={noop}
                onOpen={noop}
                onDownload={noop}
                onDownloadRound={noop}
                onContinue={noop}
                onTo3D={noop}
                onReuse={noop}
                onDeleteRound={noop}
            />,
        );
    await render(round);
    const packets = [...view.host.querySelectorAll(".image-generation-packet")];
    expect(packets.length).toBe(2);
    await render({ ...round, items: [{ ...round.items[0], status: "succeeded", outputs: [{ resourceId: "one" }, { resourceId: "two" }] }] });
    expect([...view.host.querySelectorAll(".image-generation-packet")]).toEqual(packets);
    expect(view.host.querySelectorAll("[data-image-pack-result] img").length).toBe(2);
    expect(view.host.querySelector(".is-source [data-image-pack-result]")).toBeNull();
    await render({ ...round, items: [{ ...round.items[0], status: "failed", error: "模型暂时不可用", outputs: [] }] });
    expect(view.host.querySelector(".itd-card.is-failed")?.textContent).toContain("模型暂时不可用");
    expect(view.host.textContent).toContain("用这组设置重试");
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    await view.close();
});

test("图片工具箱等待结果详情时保留袋子，历史加载和视频不用开包", async () => {
    const view = mount();
    const task: GenerationTask = { id: "task", type: "image", status: "running", prompt: "样例", attempts: 1, createdAt: now, updatedAt: now };
    const batch: GalleryBatch = { key: "batch", createdAt: now, prompt: "样例", chips: [], tiles: [], tasks: [task], outputs: [], counts: { done: 0, active: 1, failed: 0, pending: 0, total: 1 }, resumable: 0, submitting: false, localOnly: false };
    const actions: GalleryActions = { openOutput: noop, download: noop, cancelTask: noop, retryTask: noop, reuse: noop, copyPrompt: noop, downloadAll: noop, cancelBatch: noop, retryFailed: noop, resume: noop, dismiss: noop, visible: noop, measure: noop };
    await view.render(<WorkbenchGalleryTile batch={batch} tile={{ type: "active", key: "slot", task, slot: 0 }} kind="image" actions={actions} busy={false} />);
    const packet = view.host.querySelector(".image-generation-packet");
    await view.render(<WorkbenchGalleryTile batch={batch} tile={{ type: "loading", key: "slot", task: { ...task, status: "succeeded" } }} kind="image" actions={actions} busy={false} />);
    expect(view.host.querySelector(".image-generation-packet")).toBe(packet);
    await view.close();
    const history = mount();
    await history.render(<WorkbenchGalleryTile batch={batch} tile={{ type: "loading", key: "slot", task: { ...task, status: "succeeded" } }} kind="image" actions={actions} busy={false} />);
    expect(history.host.querySelector(".image-generation-packet")).toBeNull();
    await history.render(<WorkbenchGalleryTile batch={batch} tile={{ type: "active", key: "slot", task, slot: 0 }} kind="video" actions={actions} busy={false} />);
    expect(history.host.querySelector(".image-pack-slot")).toBeNull();
    await history.render(<WorkbenchGalleryTile batch={batch} tile={{ type: "failed", key: "slot", task: { ...task, status: "cancelled" } }} kind="image" actions={actions} busy={false} />);
    expect(history.host.querySelector(".is-cancelled .lucide-circle-stop")).not.toBeNull();
    expect(history.host.textContent).toContain("重新生成");
    await history.close();
});

test("电商 Agent 重新生成复用原位置，结果加载失败仍可操作", async () => {
    const view = mount();
    const draft = emptyEcommerceDraft();
    const image: EcommercePlanImage = {
        id: "image",
        taskId: "task",
        imageType: "main",
        platform: "taobao",
        language: "zh",
        goal: "主图",
        theme: "",
        composition: "",
        mainVisual: "",
        verifiedClaims: "",
        copy: "",
        lighting: "",
        fidelity: "",
        prompt: "样例",
        negativePrompt: "",
        imageModel: "",
        ratio: "1:1",
        resolution: "auto",
    };
    const task: GenerationTask = { id: "task", type: "image", status: "running", prompt: "样例", attempts: 1, createdAt: now, updatedAt: now };
    const render = (current: GenerationTask) =>
        view.render(
            <EcommerceOutputGallery
                config={useConfigStore.getState().config}
                draft={draft}
                plan={{ productSummary: "", confirmedFacts: [], uncertainFacts: [], visualStrategy: "", qualityChecks: [], images: [image] }}
                tasks={{ task: current }}
                selected={new Set()}
                imageModels={[]}
                onSelect={noop}
                onDownload={noop}
                generationPending={false}
                onRemove={async () => {}}
                onRegenerate={async () => {}}
                onRetry={noop}
            />,
        );
    await render(task);
    const packet = view.host.querySelector(".image-generation-packet");
    await render({ ...task, status: "succeeded", previewUrl: "/sample.png" });
    expect(view.host.querySelector(".image-generation-packet")).toBe(packet);
    expect(view.host.querySelector("[data-image-pack-result]")).not.toBeNull();
    await act(async () => view.host.querySelector("[data-image-pack-result] img")!.dispatchEvent(new dom.Event("error", { bubbles: true })));
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    await render({ ...task, status: "failed", error: "模型暂时不可用" });
    expect(view.host.querySelector('.commerce-output-empty-card[data-tone="error"]')?.textContent).toContain("模型暂时不可用");
    expect(view.host.querySelector(".commerce-output-empty-card strong")?.textContent).toBe("生成失败");
    await render({ ...task, status: "cancelled" });
    expect(view.host.querySelector('.commerce-output-empty-card[data-tone="neutral"] strong')?.textContent).toBe("已取消");
    await view.close();
});

test("包装效果图保留袋子、取消和下载入口，生成参考不参与开包", async () => {
    const view = mount();
    const template = {
        id: "sample",
        name: "测试盒",
        category: "sample",
        structure: "tuck" as const,
        description: "",
        enabled: true,
        defaults: { length: 80, width: 60, height: 100, thickness: 0.4, bleed: 3, glue: 15, tab: 15, gap: 1, frontHeight: 50, windowWidth: 0, windowHeight: 0, inflation: 0, spoutRadius: 0 },
    };
    const material = { id: "sample", name: "纸", color: "#eeeeee", insideColor: "#eeeeee", thickness: 0.4, roughness: 0.6, metalness: 0, enabled: true };
    const project: PackagingProject = { id: "sample", userId: "sample", name: "测试包装", templateId: template.id, revision: 1, createdAt: now, updatedAt: now, document: newPackagingDocument(template, material) };
    const task = { id: "task", type: "image", status: "running" as const, prompt: "样例", attempts: 1, createdAt: now, updatedAt: now, packagingRevision: 1, referenceResourceId: "reference", scene: "studio", outputResourceIds: [] as string[] };
    view.client.setQueryData(["packaging-mockups", undefined, project.id, false, 1], { items: [task], total: 1 });
    await view.render(<PackagingMockups project={project} enabled />);
    const packet = view.host.querySelector(".image-generation-packet");
    expect(packet).not.toBeNull();
    expect(view.host.textContent).toContain("取消生成");
    await act(async () => view.client.setQueryData(["packaging-mockups", undefined, project.id, false, 1], { items: [{ ...task, status: "succeeded", outputResourceIds: ["output"] }], total: 1 }));
    await view.render(<PackagingMockups project={project} enabled />);
    expect(view.host.querySelector(".image-generation-packet")).toBe(packet);
    expect(view.host.querySelectorAll("[data-image-pack-result]").length).toBe(1);
    expect(view.host.textContent).toContain("下载效果图");
    await act(async () => view.client.setQueryData(["packaging-mockups", undefined, project.id, false, 1], { items: [{ ...task, status: "failed", errorCode: "UPSTREAM_UNAVAILABLE" }], total: 1 }));
    await view.render(<PackagingMockups project={project} enabled />);
    expect(view.host.querySelector('.pkg-mockup-failure[data-tone="error"]')?.textContent).toContain("UPSTREAM_UNAVAILABLE");
    expect(view.host.querySelector(".image-generation-packet")).toBeNull();
    await act(async () => view.client.setQueryData(["packaging-mockups", undefined, project.id, false, 1], { items: [{ ...task, status: "cancelled" }], total: 1 }));
    await view.render(<PackagingMockups project={project} enabled />);
    expect(view.host.querySelector('.pkg-mockup-failure[data-tone="neutral"]')?.textContent).toContain("已取消生成");
    await view.close();
});
