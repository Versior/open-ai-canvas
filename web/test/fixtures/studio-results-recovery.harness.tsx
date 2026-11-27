import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import type { GenerationTask } from "@/services/api/task-center";
import type { StudioProduct, StudioRun, StudioShot } from "@/lib/ecommerce-studio/types";
import type { StudioViewerTarget } from "@/pages/ecommerce-studio/studio-results";
import type { StudioRunner } from "@/pages/ecommerce-studio/use-studio-runner";

const dom = new Window({ url: "http://localhost/studio", settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
for (const key of [
    "document",
    "navigator",
    "HTMLElement",
    "HTMLHtmlElement",
    "HTMLBodyElement",
    "HTMLAnchorElement",
    "Element",
    "SVGElement",
    "ShadowRoot",
    "Node",
    "CustomEvent",
    "Event",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "localStorage",
    "sessionStorage",
] as const) {
    const value = dom[key];
    Object.defineProperty(globalThis, key, { configurable: true, value: typeof value === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? value.bind(dom) : value });
}
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(dom.navigator, "locks", { configurable: true, value: { request: async (_name: string, callback: () => unknown) => callback() } });

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const { useUserStore } = await import("@/stores/use-user-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { createStudioProduct, studioGenerationSource } = await import("@/lib/ecommerce-studio/product");
const { useStudioStore } = await import("@/pages/ecommerce-studio/use-studio-store");
const saveDownload = mock((_zip: Blob, _name: string) => {});
mock.module("file-saver", () => ({ saveAs: saveDownload }));
const delivery = await import("@/pages/ecommerce-studio/studio-delivery");
const { StudioResults, studioShotGroups } = await import("@/pages/ecommerce-studio/studio-results");
const { StudioViewer } = await import("@/pages/ecommerce-studio/studio-viewer");
const scope = "results-test";
setActiveUserScope(scope);
useUserStore.setState({ features: { ...useUserStore.getState().features, creditsEnabled: false } });
const product = createStudioProduct("sample");
product.photos = [{ id: "original", resourceId: "product-image", url: "", truth: true, view: "front", addedAt: product.createdAt }];
const shot = (id: string): StudioShot => ({
    id,
    role: "detail-scene",
    title: id,
    ratio: "3:4",
    headline: "",
    subline: "",
    lines: [],
    sellingPointIds: [],
    tweaks: [],
    attempts: [{ id: `attempt-${id}`, taskId: id, status: "failed", model: "image", tweaks: [], createdAt: product.createdAt, outputs: [], error: "原任务失败" }],
});
const saved = shot("saved-task");
saved.purchaseQuestion = "从侧面看清杯柄";
saved.attempts[0] = { ...saved.attempts[0], status: "succeeded", error: undefined, outputs: [{ resourceId: "saved-image", url: "", width: 768, height: 1024 }] };
product.plans = [{ id: "plan", kind: "detail", createdAt: product.createdAt, textMode: "model", shots: [shot("save-task"), shot("uncertain-task"), saved] }];
useStudioStore.setState({ scope, status: "ready", products: [product] });
const tasks: Record<string, GenerationTask> = {
    "save-task": { id: "save-task", type: "canvas_image", status: "failed", prompt: "", attempts: 1, createdAt: product.createdAt, updatedAt: product.createdAt, canRecoverMedia: true, mediaStage: "download" },
    "uncertain-task": { id: "uncertain-task", type: "canvas_image", status: "failed", prompt: "", attempts: 1, createdAt: product.createdAt, updatedAt: product.createdAt, stage: "submission_unknown" },
    "saved-task": { id: "saved-task", type: "canvas_image", status: "succeeded", prompt: "", attempts: 1, createdAt: product.createdAt, updatedAt: product.createdAt },
};
const writes: string[] = [];
apiClient.request = (async (request) => {
    const path = request.url || "";
    let data;
    if (path === "/tasks/save-task/recover-media") {
        writes.push(path);
        tasks["save-task"] = { ...tasks["save-task"], status: "running", stage: "作品已生成，正在保存" };
        data = tasks["save-task"];
    } else if (path.startsWith("/tasks/")) data = tasks[path.slice("/tasks/".length)];
    else throw new Error(`unexpected request ${path}`);
    return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
}) as typeof apiClient.request;
const regenerations: string[][] = [];
const resumed: StudioProduct[] = [];
const runner = {
    resume: (value: StudioProduct) => resumed.push(value),
    rerun: async (_productId: string, _ref: unknown, shotIds: string[]) => {
        regenerations.push(shotIds);
        return shotIds.length;
    },
} as unknown as StudioRunner;
const root = createRoot(dom.document.body.appendChild(dom.document.createElement("div")));
const client = new QueryClient();
function Panel() {
    const current = useStudioStore((state) => state.products[0]);
    const [target, setTarget] = useState<StudioViewerTarget>();
    return (
        <>
            <StudioResults product={current} runner={runner} imageModel="image" edit={(updater) => useStudioStore.setState((state) => ({ products: [updater(state.products[0])] }))} onView={setTarget} onReference={() => {}} />
            <StudioViewer
                product={current}
                groups={studioShotGroups(current)}
                target={target}
                imageModel="image"
                onChange={setTarget}
                onClose={() => setTarget(undefined)}
                onDownload={() => {}}
                onReference={() => {}}
                onTune={() => {}}
                onApplyCopy={() => {}}
                onAdopt={() => {}}
                onReview={() => {}}
            />
        </>
    );
}
afterAll(async () => {
    await act(async () => root.unmount());
    client.clear();
    await dom.happyDOM.abort();
});

beforeAll(async () => {
    await act(async () => {
        root.render(
            <ConfigProvider>
                <App>
                    <QueryClientProvider client={client}>
                        <MemoryRouter>
                            <Panel />
                        </MemoryRouter>
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        );
        await new Promise((resolve) => setTimeout(resolve, 40));
    });
});

test("继续保存只 POST recover-media，整组操作不会提交待核对任务", async () => {
    expect(dom.document.querySelector('[aria-label="逐屏生成进度"]')?.textContent).toContain("1 待保存");
    expect(dom.document.querySelector('[aria-label="逐屏生成进度"]')?.textContent).toContain("1 待核对");
    expect(dom.document.querySelector('[data-shot-id="uncertain-task"]')?.textContent).toContain("原任务可能已产生费用");
    const target = [...dom.document.querySelectorAll("button")].find((item) => item.textContent.includes("继续保存"));
    expect(target).toBeDefined();
    await act(async () => {
        target!.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(writes).toEqual(["/tasks/save-task/recover-media"]);
    expect(regenerations).toEqual([]);
    expect(resumed[0].plans[0].shots[0].attempts[0]).toMatchObject({ taskId: "save-task", status: "running", error: undefined });
    expect(dom.document.querySelector('[data-shot-id="save-task"] .image-pack-progress')?.getAttribute("data-phase")).toBe("saving");
    const groupAction = [...dom.document.querySelectorAll("button")].find((item) => item.textContent.includes("处理未完成"));
    expect(groupAction).toBeDefined();
    await act(async () => {
        groupAction!.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(regenerations).toEqual([]);
    expect(writes).toEqual(["/tasks/save-task/recover-media"]);
    const rerun = dom.document.querySelector<HTMLButtonElement>('[data-shot-id="saved-task"] [aria-label="再出一张"]');
    expect(rerun).toBeDefined();
    await act(async () => {
        rerun!.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(regenerations).toEqual([["saved-task"]]);
    expect(
        resumed
            .flatMap((entry) => entry.plans[0].shots)
            .filter((item) => item.id === "saved-task")
            .every((item) => item.attempts[0].status === "succeeded"),
    ).toBe(true);
    expect(writes).toEqual(["/tasks/save-task/recover-media"]);
});

test("全部保存后收起重复进度，成品可按手机长图的顺序阅读", async () => {
    await act(async () => {
        useStudioStore.setState({ products: [{ ...product, plans: [{ ...product.plans[0], shots: [saved, { ...saved, id: "second-screen", purchaseQuestion: "查看把手与杯身接合处" }] }] }] });
    });
    expect(dom.document.querySelector('[aria-label="逐屏生成进度"]')).toBeNull();
    expect(dom.document.querySelectorAll(".es-tile-context").length).toBe(2);
    expect(dom.document.querySelector('[data-shot-id="saved-task"]')?.textContent).toContain(saved.purchaseQuestion!);
    const preview = [...dom.document.querySelectorAll("button")].find((item) => item.textContent.trim() === "预览整页");
    expect(preview).toBeDefined();
    await act(async () => preview!.click());
    const reading = dom.document.querySelector('[aria-label="消费者整页阅读预览"]');
    expect(reading?.querySelectorAll("img").length).toBe(2);
    expect(reading?.textContent).toContain("整页阅读预览");
});

test("普通详情页成品只显示原屏序和购买问题，保留模板、主图和旧套图的标题", async () => {
    const available = (id: string, title: string, patch: Partial<StudioShot> = {}): StudioShot => ({
        ...saved,
        id,
        title,
        purchaseQuestion: undefined,
        attempts: [{ ...saved.attempts[0], taskId: undefined, outputs: [{ resourceId: `${id}-img`, url: "", width: 768, height: 1024 }] }],
        ...patch,
    });
    const ordinary: StudioRun = {
        id: "ordinary",
        createdAt: product.createdAt,
        kind: "detail",
        textMode: "model",
        type: "detail-set",
        quality: "",
        shots: [
            available("missing", "头图", { screenIndex: 1, purchaseQuestion: "这款杯子是什么样的？", attempts: [] }),
            available("question", "细节特写", { screenIndex: 2, purchaseQuestion: "杯柄接在什么位置？" }),
            available("no-question", "搭配", { screenIndex: 3 }),
        ],
    };
    const template: StudioRun = { ...ordinary, id: "template", type: "template-set", shots: [available("template-page", "模板指定标题", { screenIndex: 1, purchaseQuestion: "看清杯底" })] };
    const main: StudioRun = { ...ordinary, id: "main", kind: "main", type: "main-set", shots: [available("main-page", "主图标题", { screenIndex: 1, purchaseQuestion: "不要替换主图标题" })] };
    const legacy: StudioRun = { ...ordinary, id: "legacy", shots: [available("legacy-page", "旧成品标题")] };
    await act(async () => useStudioStore.setState({ products: [{ ...product, plans: [], runs: [ordinary, template, main, legacy] }] }));
    const tile = (id: string) => dom.document.querySelector(`[data-shot-id="${id}"]`)!;
    expect(tile("question").querySelector("figcaption")?.textContent).toBe("第 2 屏 · 杯柄接在什么位置？");
    expect(tile("no-question").querySelector("figcaption")?.textContent).toBe("第 3 屏");
    expect(tile("template-page").querySelector("figcaption")?.textContent).toContain("01 模板指定标题");
    expect(tile("template-page").querySelector(".es-tile-context")?.textContent).toBe("看清杯底");
    expect(tile("main-page").querySelector("figcaption")?.textContent).toBe("01 主图标题");
    expect(tile("legacy-page").querySelector("figcaption")?.textContent).toBe("01 旧成品标题");
    const group = tile("question").closest(".es-group")!;
    expect(group.querySelector('[aria-label="第 2 屏 · 杯柄接在什么位置？ · 已保存"]')).not.toBeNull();
    const readingButton = [...group.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent.trim() === "预览整页")!;
    await act(async () => readingButton.click());
    const reading = group.querySelector('[aria-label="消费者整页阅读预览"]')!;
    expect(reading.querySelector(".es-delivery-missing")?.textContent).toBe("第 1 屏 · 这款杯子是什么样的？ · 缺图");
    expect([...reading.querySelectorAll("img")].map((image) => image.alt)).toEqual(["第 2 屏 · 杯柄接在什么位置？", "第 3 屏"]);
    await act(async () => tile("question").querySelector<HTMLButtonElement>("[data-image-pack-result]")!.click());
    expect(dom.document.querySelector(".es-viewer-side h3")?.textContent).toBe("第 2 屏 · 杯柄接在什么位置？");
    expect(dom.document.querySelector(".es-viewer-count")).toBeNull();
    await act(async () => [...dom.document.querySelectorAll<HTMLButtonElement>(".es-viewer-nav button")].find((button) => button.textContent.trim() === "下一张")!.click());
    expect(dom.document.querySelector(".es-viewer-side h3")?.textContent).toBe("第 3 屏");
});

test("历史主图套图按出图时的平台、语言和图位编辑，不受当前表单影响", async () => {
    const source = studioGenerationSource({ ...product, platform: "amazon", brief: { ...product.brief, outputType: "main-set", language: "ja" } });
    const available = (id: string, role: StudioShot["role"]): StudioShot => ({
        ...saved,
        id,
        role,
        headline: "不是锁定的旧草稿",
        attempts: [{ ...saved.attempts[0], taskId: undefined, outputs: [{ resourceId: `${id}-image`, url: "" }] }],
    });
    const run: StudioRun = {
        id: "historical-main",
        createdAt: product.createdAt,
        kind: "main",
        type: "main-set",
        textMode: "model",
        quality: "",
        source,
        shots: [available("cover", "main-selling"), available("supporting", "main-detail")],
    };
    await act(async () => useStudioStore.setState({ products: [{ ...product, photos: [], brief: { ...product.brief, language: "none" }, plans: [], runs: [run] }] }));
    await act(async () => dom.document.querySelector<HTMLButtonElement>('[data-shot-id="cover"] [data-image-pack-result]')!.click());
    expect(dom.document.querySelector(".es-tuner-copy")).toBeNull();
    await act(async () => [...dom.document.querySelectorAll<HTMLButtonElement>(".es-viewer-nav button")].find((button) => button.textContent.trim() === "下一张")!.click());
    const copy = dom.document.querySelector(".es-tuner-copy");
    expect(copy).not.toBeNull();
    expect(copy?.querySelector("input")?.value).toBe("");
    const rerun = dom.document.querySelector<HTMLButtonElement>('[data-shot-id="supporting"] [aria-label="再出一张"]');
    expect(rerun?.disabled).toBe(false);
});

const nativeMenuLabel = "按详情长图导出";
const singleOutput = { resourceId: "selected-single", url: "", width: 1296, height: 2304 };
const readySingle: StudioShot = { ...saved, id: "native-single", ratio: "9:16", attempts: [{ ...saved.attempts[0], taskId: undefined, outputs: [singleOutput] }] };
const singleRun: StudioRun = { id: "native-export", createdAt: product.createdAt, type: "poster", textMode: "model", quality: "", shots: [readySingle] };
const alternate = { ...singleOutput, resourceId: "alternate" };
const severalCandidates = { ...readySingle, attempts: [{ ...readySingle.attempts[0], outputs: [alternate, singleOutput] }] };

async function openResultMenu(run: StudioRun) {
    await act(async () => useStudioStore.setState({ products: [{ ...product, plans: [], runs: [run] }] }));
    const more = dom.document.querySelector<HTMLButtonElement>('.es-group button[aria-label="更多操作"]')!;
    await act(async () => more.click());
    const get = (text: string) => [...dom.document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => !element.closest(".ant-dropdown-hidden") && element.textContent.trim() === text);
    expect(get("文件与文案诊断")).toBeDefined();
    return get;
}

test("只有已完成的独立单图能从结果更多菜单按详情长图导出", async () => {
    const single = await openResultMenu(singleRun);
    expect(single(nativeMenuLabel)).toBeDefined();
    for (const [id, patch] of [
        ["multi", { shots: [readySingle, { ...readySingle, id: "second" }] }],
        ["missing", { shots: [{ ...readySingle, attempts: [] }] }],
        ["ambiguous", { shots: [severalCandidates] }],
        ["overlay", { shots: [{ ...readySingle, attempts: [{ ...readySingle.attempts[0], textMode: "overlay" }] }] }],
        ["same-layout", { source: studioGenerationSource({ ...product, brief: { ...product.brief, sameLayout: true } }) }],
        ["main-set", { kind: "main", type: "main-set" }],
        ["detail-set", { kind: "detail", type: "detail-set" }],
        ["template-set", { kind: "detail", type: "template-set" }],
    ] as const) {
        const menu = await openResultMenu({ ...singleRun, ...patch, shots: [...("shots" in patch ? patch.shots : singleRun.shots)], id });
        expect(menu(nativeMenuLabel)).toBeUndefined();
        if ("kind" in patch && patch.kind === "detail") expect(menu("只下载完整原长图（不切片）")).toBeDefined();
    }
});

test("回车导出已采用的候选与原生成平台，只下载一次，不改记录或重新生成", async () => {
    const source = studioGenerationSource({ ...product, name: "眼镜", platform: "jd" });
    const menu = await openResultMenu({ ...singleRun, id: "single-keyboard", source, shots: [{ ...severalCandidates, adopted: singleOutput }] });
    const pending = Promise.withResolvers<Blob>();
    const exportFile = spyOn(delivery, "exportStudioNativeDetail").mockImplementation(() => pending.promise);
    const requests = [...writes];
    const reruns = [...regenerations];
    const snapshot = JSON.stringify(useStudioStore.getState().products);
    try {
        const item = menu(nativeMenuLabel)!;
        await act(async () => {
            item.focus();
            item.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        });
        expect(exportFile).toHaveBeenCalledTimes(1);
        expect(exportFile.mock.calls[0].slice(0, 2)).toEqual([expect.objectContaining({ id: product.id, name: "眼镜", platform: "jd" }), singleOutput]);
        expect(dom.document.querySelector('.es-group button[aria-label="更多操作"]')?.getAttribute("aria-busy")).toBe("true");
        const archive = new Blob(["finished"], { type: "application/zip" });
        await act(async () => pending.resolve(archive));
        expect(saveDownload.mock.calls).toEqual([[archive, "眼镜-详情长图.zip"]]);
        expect(JSON.stringify(useStudioStore.getState().products)).toBe(snapshot);
        expect(writes).toEqual(requests);
        expect(regenerations).toEqual(reruns);
    } finally {
        exportFile.mockRestore();
        saveDownload.mockClear();
    }
});

test("导出失败显示原因；导出过程中更换账号不下载旧账号的文件", async () => {
    const exportFile = spyOn(delivery, "exportStudioNativeDetail").mockRejectedValueOnce(new Error("无法读取章节原图"));
    try {
        const failure = await openResultMenu({ ...singleRun, id: "single-error" });
        await act(async () => failure(nativeMenuLabel)!.click());
        expect(dom.document.querySelector(".ant-message-error")?.textContent).toContain("无法读取章节原图");
        expect(saveDownload).not.toHaveBeenCalled();
        const second = await openResultMenu({ ...singleRun, id: "single-switch" });
        const pending = Promise.withResolvers<Blob>();
        exportFile.mockImplementationOnce(() => pending.promise);
        await act(async () => second(nativeMenuLabel)!.click());
        expect(exportFile).toHaveBeenCalledTimes(2);
        setActiveUserScope("switched-account");
        await act(async () => pending.resolve(new Blob()));
        expect(saveDownload).not.toHaveBeenCalled();
    } finally {
        setActiveUserScope(scope);
        exportFile.mockRestore();
        saveDownload.mockClear();
    }
});
