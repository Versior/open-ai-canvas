import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "../src/types/canvas";

// 图片加载失败不再留下透明空白：先强制重签一次原图地址自动重试，仍失败才显示「重新加载」。
const dom = new Window({ url: "http://localhost/" });
const failingUrls = new Set<string>();
const delayedImages = new Map<string, FakeImage[]>();
const cancelledUrls: string[] = [];
class FakeImage {
    onload: ((event: Event) => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "async";
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    private current = "";
    get src() {
        return this.current;
    }
    set src(value: string) {
        this.current = value;
        if (delayedImages.has(value)) delayedImages.get(value)!.push(this);
        else queueMicrotask(() => this.finish());
    }
    finish() {
        if (failingUrls.has(this.current)) return this.onerror?.();
        this.complete = true;
        this.naturalWidth = 1824;
        this.naturalHeight = 1024;
        this.onload?.(new Event("load"));
    }
    removeAttribute(attribute: string) {
        if (attribute === "src") cancelledUrls.push(this.current);
    }
    decode() {
        return Promise.resolve();
    }
}
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    MouseEvent: dom.MouseEvent,
    Image: FakeImage,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { apiClient } = await import("../src/services/api/request");
const { BatchPreviewImage, ImageContent, RetainedCanvasImage } = await import("../src/components/canvas/canvas-node-media-content");
const { CanvasNodeType } = await import("../src/types/canvas");
const { canvasThemes } = await import("../src/lib/canvas-theme");

const accessRequests: unknown[] = [];
let nextAccessUrl = "https://cdn.example.com/fresh.png";
const previousAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = async (config) => {
    const payload = JSON.parse(String(config.data || "[]")) as Array<{ resourceId: string }>;
    accessRequests.push(...payload);
    const items = payload.map((item) => ({ access: { resourceId: item.resourceId, url: nextAccessUrl, delivery: "cdn", actualVariant: "original", requestedVariant: "original", issuedAt: new Date().toISOString() } }));
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items } } };
};

afterAll(() => {
    apiClient.defaults.adapter = previousAdapter;
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

beforeEach(() => {
    failingUrls.clear();
    delayedImages.clear();
    cancelledUrls.length = 0;
    accessRequests.length = 0;
    nextAccessUrl = "https://cdn.example.com/fresh.png";
});

test("图片初始化抛错只拒绝对应任务，不阻塞同批次的后续图片", async () => {
    const { prepareCanvasImage, canvasImagePreparationStats, isCanvasImageActive } = await import("@/services/canvas-image-loader");
    const original = Object.getOwnPropertyDescriptor(globalThis, "Image")!;
    const error = new Error("image initialization failed");
    let first = true;
    class ImageWithOneFailure extends FakeImage {
        constructor() {
            super();
            if (first) {
                first = false;
                throw error;
            }
        }
    }
    Object.defineProperty(globalThis, "Image", { ...original, value: ImageWithOneFailure });
    try {
        const { signal } = new AbortController();
        const failed = "blob:init-failure";
        const [bad, good] = await Promise.allSettled([prepareCanvasImage(failed, signal, 300), prepareCanvasImage("blob:after-init-failure", signal, 300)]);
        expect(bad).toEqual({ status: "rejected", reason: error });
        expect(good.status).toBe("fulfilled");
        expect(isCanvasImageActive(failed)).toBe(false);
        expect(canvasImagePreparationStats()).toMatchObject({ active: 0, queued: 0 });
    } finally {
        Object.defineProperty(globalThis, "Image", original);
    }
});

const settle = async () => {
    for (let index = 0; index < 8; index += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
};

async function mount(props: { src: string; storageKey?: string; accessFailed?: boolean; identity: string }) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(<RetainedCanvasImage {...props} originalSize={{}} fitToImage={() => {}} className="" loading={false} theme={canvasThemes.dark} />);
    });
    await settle();
    return { host, unmount: () => act(() => root.unmount()) };
}

test("首次地址失败时强制重签原图地址并自动重试一次", async () => {
    failingUrls.add("https://cdn.example.com/stale.png");
    const view = await mount({ identity: "a", src: "https://cdn.example.com/stale.png", storageKey: "resource:r1" });
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/fresh.png");
    expect(view.host.querySelector(".canvas-image-state")).toBeNull();
    expect(accessRequests).toHaveLength(1);
    await view.unmount();
});

test("重签后仍失败显示可重试的失败态，点击重新加载后恢复显示", async () => {
    // 加载器会缓存已解码图片，每个用例使用独立地址。
    nextAccessUrl = "https://cdn.example.com/fresh-b.png";
    failingUrls.add("https://cdn.example.com/stale-b.png");
    failingUrls.add(nextAccessUrl);
    const view = await mount({ identity: "b", src: "https://cdn.example.com/stale-b.png", storageKey: "resource:r2" });
    const error = view.host.querySelector('.canvas-image-state[data-state="error"]');
    expect(error?.textContent).toContain("图片暂时无法显示");
    expect(view.host.querySelector("img")?.getAttribute("src")).toBeNull();

    failingUrls.delete(nextAccessUrl);
    await act(async () => (view.host.querySelector(".canvas-image-state-retry") as HTMLButtonElement).click());
    await settle();
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
    expect(view.host.querySelector(".canvas-image-state")).toBeNull();
    expect(accessRequests).toHaveLength(2);
    await view.unmount();
});

test("访问地址换取失败且无回退时直接显示失败态，重试会重新换取地址", async () => {
    nextAccessUrl = "https://cdn.example.com/fresh-c.png";
    const view = await mount({ identity: "c", src: "", storageKey: "resource:r3", accessFailed: true });
    expect(view.host.querySelector('.canvas-image-state[data-state="error"]')).not.toBeNull();
    await act(async () => (view.host.querySelector(".canvas-image-state-retry") as HTMLButtonElement).click());
    await settle();
    expect(accessRequests).toHaveLength(1);
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
    await view.unmount();
});

test("尚无地址时用静态底板占位，而不是露出画布", async () => {
    const view = await mount({ identity: "d", src: "", storageKey: "resource:r4" });
    expect(view.host.querySelector('.canvas-image-state[data-state="idle"]')).not.toBeNull();
    expect(view.host.querySelector(".canvas-image-state-retry")).toBeNull();
    expect(accessRequests).toHaveLength(0);
    await view.unmount();
});

test("骨架微光只给占用下载并发位的图片，排队中的保持静止", async () => {
    // 让图片一直处于加载中，占满 4 个并发位后第 5 个只能排队。
    const hang = "https://cdn.example.com/hang-";
    const originalSetter = Object.getOwnPropertyDescriptor(FakeImage.prototype, "src")!;
    Object.defineProperty(FakeImage.prototype, "src", {
        configurable: true,
        get: originalSetter.get,
        set(value: string) {
            if (value.startsWith(hang)) return;
            originalSetter.set!.call(this, value);
        },
    });
    try {
        const views = [];
        for (let index = 0; index < 5; index += 1) views.push(await mount({ identity: `q${index}`, src: `${hang}${index}.png` }));
        const active = views.map((view) => view.host.querySelector(".canvas-image-skeleton")?.getAttribute("data-active"));
        expect(active.filter((value) => value === "true")).toHaveLength(4);
        expect(active[4]).toBeNull();
        for (const view of views) await view.unmount();
    } finally {
        Object.defineProperty(FakeImage.prototype, "src", originalSetter);
    }
});

test("非资源图片失败时不请求访问地址，直接显示失败态", async () => {
    failingUrls.add("https://provider.example.com/a.png");
    const view = await mount({ identity: "e", src: "https://provider.example.com/a.png" });
    expect(view.host.querySelector('.canvas-image-state[data-state="error"]')).not.toBeNull();
    expect(accessRequests).toHaveLength(0);
    await view.unmount();
});

function imageNode(id: string): CanvasNodeData {
    return { id, title: id, type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: `https://cdn.example.com/${id}.jpg` } };
}

function testImage(node: CanvasNodeData, renderLOD: "full" | "shell" = "full") {
    return <ImageContent node={node} theme={canvasThemes.light} renderLOD={renderLOD} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} />;
}

test("慢图移出视口时让出下载位，仍可见的共享消费者和已显示图片不受影响", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
    const observed = new Map<Element, (visible: boolean) => void>();
    class ViewportObserver {
        constructor(private readonly update: (entries: unknown[]) => void) {}
        observe(target: Element) {
            observed.set(target, (visible) => this.update([{ target, isIntersecting: visible }]));
        }
        unobserve(target: Element) {
            observed.delete(target);
        }
    }
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: ViewportObserver });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const nodes = ["slow-a", "slow-b", "slow-c", "slow-d", "slow-queued", "slow-new"].map(imageNode);
    const same = { ...nodes[0], id: "same", title: "slow-shared" };
    const views = [...nodes, same];
    const urls = nodes.map((node) => node.metadata!.content!);
    urls.forEach((src) => delayedImages.set(src, []));
    const visible = (index: number, value: boolean) => observed.get(host.querySelector(`[alt="${views[index].title}"][data-image-pack-result]`)!.parentElement!)?.(value);
    const render = (shell = false) => root.render(views.map((node) => <div key={node.id}>{testImage(node, shell ? "shell" : "full")}</div>));
    try {
        await act(async () => render());
        await act(async () => [0, 1, 2, 3, 4, 6].forEach((index) => visible(index, true)));
        expect(urls.map((url) => delayedImages.get(url)!.length)).toEqual([1, 1, 1, 1, 0, 0]);
        await act(async () => {
            visible(0, false);
            visible(4, false);
            visible(5, true);
            visible(1, false);
        });
        expect(cancelledUrls).toEqual([urls[1]]);
        expect(delayedImages.get(urls[4])).toHaveLength(0);
        expect(delayedImages.get(urls[5])).toHaveLength(1);
        await act(async () => {
            delayedImages.get(urls[5])![0].finish();
            visible(6, false);
        });
        expect(cancelledUrls).toContain(urls[0]);
        const shown = host.querySelector<HTMLImageElement>('[alt="slow-new"]')!;
        await act(async () => {
            visible(5, false);
            visible(0, true);
        });
        expect(shown.getAttribute("src")).toBe(urls[5]);
        expect(delayedImages.get(urls[0])).toHaveLength(2);
        await act(async () => delayedImages.get(urls[0])![0].finish());
        expect(host.querySelector('[alt="slow-a"]')?.getAttribute("src")).toBeNull();
        await act(async () => delayedImages.get(urls[0])![1].finish());
        expect(host.querySelector('[alt="slow-a"]')?.getAttribute("src")).toBe(urls[0]);
        await act(async () => render(true));
        expect(cancelledUrls).toContain(urls[2]);
        expect(cancelledUrls).toContain(urls[3]);
        expect(shown.getAttribute("src")).toBe(urls[5]);
        views[0] = { ...nodes[0], metadata: { content: urls[4] } };
        await act(async () => render());
        expect(delayedImages.get(urls[4])).toHaveLength(0);
        expect(host.querySelector('[alt="slow-a"]')?.getAttribute("src")).toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
        if (original) Object.defineProperty(globalThis, "IntersectionObserver", original);
        else Reflect.deleteProperty(globalThis, "IntersectionObserver");
    }
});

test("批次叠图只请求缩略图，下载排在主图后并与主图合并同址请求", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const covers = [0, 1, 2, 3].map((index) => imageNode(`slow-cover-${index}`));
    const back = imageNode("slow-card");
    back.metadata = { storageKey: "resource:slow-card" };
    const shared = imageNode("slow-shared-card");
    const newCover = imageNode("slow-promoted");
    const backUrl = (nextAccessUrl = "https://cdn.example.com/slow-card-thumb.jpg");
    [...covers, shared, newCover].forEach((node) => delayedImages.set(node.metadata!.content!, []));
    delayedImages.set(backUrl, []);
    const render = (extra: boolean) =>
        root.render(
            <>
                {covers.map((node) => (
                    <div key={node.id}>{testImage(node)}</div>
                ))}
                <BatchPreviewImage node={back} theme={canvasThemes.light} />
                <BatchPreviewImage node={shared} theme={canvasThemes.light} />
                {extra && (
                    <>
                        {testImage(shared)}
                        {testImage(newCover)}
                    </>
                )}
            </>,
        );
    try {
        await act(async () => render(false));
        await settle();
        expect(accessRequests).toEqual([expect.objectContaining({ resourceId: "slow-card", variant: "thumbnail" })]);
        expect(host.querySelector('[alt="子图预览：slow-card"]')?.getAttribute("src") ?? null).toBeNull();
        await act(async () => render(true));
        await act(async () => {
            delayedImages.get(covers[0].metadata!.content!)![0].finish();
            delayedImages.get(covers[1].metadata!.content!)![0].finish();
        });
        expect(delayedImages.get(shared.metadata!.content!)).toHaveLength(1);
        expect(delayedImages.get(newCover.metadata!.content!)).toHaveLength(1);
        expect(delayedImages.get(backUrl)).toHaveLength(0);
        await act(async () => delayedImages.get(shared.metadata!.content!)![0].finish());
        expect(host.querySelector('[alt="子图预览：slow-shared-card"]')?.getAttribute("src")).toBe(shared.metadata!.content!);
        expect(host.querySelector('[alt="slow-shared-card"]')?.getAttribute("src")).toBe(shared.metadata!.content!);
        expect(delayedImages.get(backUrl)).toHaveLength(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("GIF 节点在完整和概览模式均请求原图，静态图片继续使用缩略图", async () => {
    for (const renderLOD of ["full", "preview"] as const) {
        for (const mimeType of ["image/gif", "image/png"]) {
            accessRequests.length = 0;
            const id = `animation-${renderLOD}-${mimeType.slice(6)}`;
            nextAccessUrl = `https://cdn.example.com/${id}`;
            const host = document.createElement("div");
            document.body.append(host);
            const root = createRoot(host);
            await act(async () =>
                root.render(
                    <ImageContent
                        node={{ id, title: "图片", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { storageKey: `resource:${id}`, mimeType } }}
                        theme={canvasThemes.light}
                        renderLOD={renderLOD}
                        isBatchRoot={false}
                        batchCount={0}
                        batchExpanded={false}
                        batchOpening={false}
                        batchRecovering={false}
                    />,
                ),
            );
            await settle();
            expect(accessRequests).toEqual([expect.objectContaining({ resourceId: id, variant: mimeType === "image/gif" ? "original" : "thumbnail" })]);
            expect(host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
            await act(() => root.unmount());
            host.remove();
        }
    }
});

test("开包期间解码图片不提前改变节点尺寸，结束后再按原比例回写", async () => {
    const { CanvasNodeActionContext } = await import("../src/components/canvas/canvas-node-action-context");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const node: CanvasNodeData = { id: "deferred-fit", title: "图片", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { content: "https://provider.example.com/deferred.png" } };
    const updates: CanvasNodeData[] = [];
    const actions = { updateMediaNode: (_id: string, update: (current: CanvasNodeData) => CanvasNodeData) => updates.push(update(node)) };
    const render = (deferFit: boolean) =>
        root.render(
            <CanvasNodeActionContext.Provider value={actions}>
                <ImageContent node={node} theme={canvasThemes.light} deferFit={deferFit} renderLOD="full" isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} />
            </CanvasNodeActionContext.Provider>,
        );
    await act(async () => render(true));
    await settle();
    expect(updates).toHaveLength(0);
    const src = host.querySelector("img")?.getAttribute("src");
    await act(async () => render(false));
    expect(updates).toHaveLength(1);
    expect(updates[0].metadata?.naturalWidth).toBe(1824);
    expect(updates[0].width / updates[0].height).toBeCloseTo(1824 / 1024, 2);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(src);
    await act(async () => root.unmount());
    host.remove();
});
