import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationInspiration } from "../../src/lib/inspirations/catalog";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, SVGElement: dom.SVGElement, Element: dom.Element, Node: dom.Node, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
let intersect: (entries: { isIntersecting: boolean }[]) => void;
Object.defineProperty(globalThis, "IntersectionObserver", { value: class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect() {}
} });
Object.defineProperty(globalThis, "MutationObserver", { value: dom.MutationObserver });
const resizeCallbacks = new Map<Element, () => void>();
Object.defineProperty(globalThis, "ResizeObserver", { value: class {
    private element?: Element;
    constructor(private callback: () => void) {}
    observe(element: Element) { this.element = element; resizeCallbacks.set(element, this.callback); }
    disconnect() { if (this.element) resizeCallbacks.delete(this.element); }
} });
let plays = 0;
let stalled = false;
let rejectPlayback = false;
dom.HTMLMediaElement.prototype.play = async function () { plays++; if (rejectPlayback) throw new Error("Autoplay blocked"); if (!stalled) this.dispatchEvent(new dom.Event("playing")); };
dom.HTMLMediaElement.prototype.pause = function () {};
dom.HTMLMediaElement.prototype.load = function () {};
const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const catalogEntries: CreationInspiration[] = Array.from({ length: 72 }, (_, index) => ({ id: `case-${index}`, title: `案例${index}`, description: "测试", image: `/poster-${index}.webp`, mode: index < 36 ? "image" : "video", prompt: "提示词", sourceId: "original" }));
mock.module("@/services/inspiration-catalog", () => ({ loadGalleryPool: async () => catalogEntries, loadInspirationCatalog: async () => ({ entries: catalogEntries, categoriesBySource: {}, revisions: {}, loadedAt: 0 }) }));
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const canvasWork = { templateUuid: "canvas-work", projectUuid: "canvas-project", title: "画布作品案例", description: "作品描述", coverUrl: "/canvas.webp", mediaUrl: "/canvas.mp4", mediaType: "video", authorName: "", authorAvatar: "", likeCount: 0, publishedAt: "", tags: [], sourceUrl: "" };
const imageCanvasWork = { ...canvasWork, templateUuid: "image-work", title: "图片作品案例", mediaType: "image", mediaUrl: "/image.webp" };
mock.module("@/services/api/libtv-gallery", () => ({
    LIBTV_GALLERY_PAGE_SIZE: 20,
    getLibTVGallery: async () => ({ items: [canvasWork, imageCanvasWork], page: 1, pageSize: 20, hasMore: false, requestId: "fixture" }),
    getLibTVWorkDetail: async () => ({ work: canvasWork, steps: [], nodeCount: 0, connectionCount: 0, canImport: false, warnings: [{ message: "部分引用未公开" }, { message: "暂不支持的节点类型" }] }),
}));
mock.module("@/lib/localforage-storage", () => ({ localForageStorageForScope: () => ({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }) }));
const { useInspirationStore } = await import("../../src/stores/use-inspiration-store");
const { InspirationCard, InspirationHall, default: InspirationsPage } = await import("../../src/pages/inspirations");
const { CreationFeaturedWorks } = await import("../../src/pages/create/creation-workspace-empty");
const { CreationInspirationTunnel } = await import("../../src/pages/create/creation-inspiration-tunnel");
const { LibTVGalleryCard } = await import("../../src/pages/inspiration/gallery-card");
const { MemoryRouter, Routes, Route, useLocation } = await import("react-router");
const { InspirationDetailModal } = await import("../../src/pages/inspirations/inspiration-detail-modal");
const { VIDEO_HOVER_DELAY_MS } = await import("../../src/lib/canvas/canvas-video-hover-preview");
const noop = () => {};
const item: CreationInspiration = { id: "seedance:preview", title: "视频案例", description: "测试悬停", image: "/poster.webp", videoUrl: "https://media.goodcase.ai/example.mp4", mode: "video", prompt: "测试提示词", sourceId: "seedance", credit: "@author", ratio: "16:9" };
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
async function render(entries: CreationInspiration[]) {
    await act(async () => { root.render(<div className="inspiration-gallery" style={{ gridAutoRows: "4px", rowGap: "20px" }}>{entries.map((entry) => <InspirationCard key={entry.id} item={entry} onOpen={noop} />)}</div>); });
    return Array.from(host.querySelectorAll(".inspiration-card-cover"));
}
function enter(cover: Element, pointerType = "mouse") { cover.dispatchEvent(new dom.PointerEvent("pointerenter", { pointerType })); }
const wait = () => new Promise((resolve) => setTimeout(resolve, VIDEO_HOVER_DELAY_MS + 40));
afterAll(async () => { await act(async () => root.unmount()); await dom.happyDOM.abort(); });

test("real cards show only media with an overlaid title and load only after hover", async () => {
    const [cover] = await render([item]);
    expect(host.querySelector(".inspiration-card-body")).toBeNull();
    expect(host.querySelector(".inspiration-card-tags")).toBeNull();
    expect(cover.querySelector(".inspiration-card-caption")?.textContent).toBe(item.title);
    expect(host.querySelector("button")?.getAttribute("aria-label")).toContain(item.title);
    expect(host.textContent).not.toContain("社区精选");
    expect(host.textContent).not.toContain("@author");
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.querySelector(".inspiration-card-actions")).toBeNull();
    expect(host.querySelector("video")).toBeNull();
    expect(cover.querySelector(".inspiration-preview-play")).not.toBeNull();
    expect(host.textContent).not.toContain("悬停预览");
    enter(cover); cover.dispatchEvent(new dom.PointerEvent("pointerleave"));
    enter(cover, "touch"); await wait();
    expect(plays).toBe(0);
    enter(cover); await wait();
    const video = cover.querySelector("video")!;
    expect(video.src).toBe(item.videoUrl!);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.dataset.hoverPreviewPlaying).toBe("true");
    expect(cover.getAttribute("data-hover-preview-state")).toBe("playing");
    video.currentTime = 3; video.dispatchEvent(new dom.Event("timeupdate"));
    expect(cover.querySelector("video")).toBe(video);
    video.currentTime = 6; video.dispatchEvent(new dom.Event("timeupdate"));
    expect(cover.querySelector("video")).toBeNull();
    expect(cover.getAttribute("data-hover-preview-state")).toBe("finished");
    cover.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
    await wait();
    expect(cover.querySelector("video")).toBeNull();
    expect(cover.getAttribute("data-hover-preview-state")).toBe("finished");
    cover.dispatchEvent(new dom.PointerEvent("pointerleave"));
    expect(video.getAttribute("src")).toBeNull();
    expect(cover.querySelector("video")).toBeNull();
    expect(cover.querySelector("img")).not.toBeNull();
    expect(cover.hasAttribute("data-hover-preview-state")).toBe(false);
});

test("managed hidden cards expose a working restore action", async () => {
    let restored = false;
    await act(async () => {
        root.render(
            <div className="inspiration-gallery">
                <InspirationCard item={item} favorite={false} hidden onOpen={noop} onToggleFavorite={noop} onRestore={() => { restored = true; }} onEdit={noop} onDelete={noop} />
            </div>,
        );
    });
    const restore = host.querySelector(`[aria-label="\u6062\u590d\u663e\u793a\uff1a${item.title}"]`) as HTMLElement | null;
    expect(restore).not.toBeNull();
    await act(async () => restore!.click());
    expect(restored).toBe(true);
});

test("only one real card previews and error, offscreen, background and unmount release it", async () => {
    const [first, second] = await render([item, { ...item, id: "seedance:second" }]);
    enter(first); await wait();
    enter(second);
    expect(first.querySelector("video")).toBeNull();
    await wait();
    expect(host.querySelectorAll("video")).toHaveLength(1);
    second.querySelector("video")!.dispatchEvent(new dom.Event("error"));
    expect(second.querySelector("video")).toBeNull();
    expect(second.getAttribute("data-hover-preview-state")).toBe("error");
    enter(first); await wait(); intersect([{ isIntersecting: false }]);
    expect(host.querySelector("video")).toBeNull();
    enter(first); await wait(); document.dispatchEvent(new dom.Event("visibilitychange"));
    expect(host.querySelector("video")).toBeNull();
    enter(first); await wait();
    const video = first.querySelector("video")!;
    await render([]);
    expect(video.getAttribute("src")).toBeNull();
});

test("image cards and video prompts without a source stay static", async () => {
    const covers = await render([{ ...item, id: "image", mode: "image" }, { ...item, id: "no-video", videoUrl: undefined }]);
    const before = plays;
    for (const cover of covers) enter(cover);
    await wait();
    expect(plays).toBe(before);
    expect(host.querySelector("video")).toBeNull();
});

test("slow media exposes loading state and clears it when leaving", async () => {
    const [cover] = await render([item]);
    stalled = true;
    try {
        enter(cover); await wait();
        expect(cover.getAttribute("data-hover-preview-state")).toBe("loading");
        expect(cover.querySelector("video")?.dataset.hoverPreviewPlaying).toBeUndefined();
        expect(cover.querySelector("img")).not.toBeNull();
        cover.dispatchEvent(new dom.PointerEvent("pointerleave"));
        expect(cover.hasAttribute("data-hover-preview-state")).toBe(false);
        expect(cover.querySelector("video")).toBeNull();
    } finally { stalled = false; }
});

test("moving within a card preserves loading and resumes after a scroll cancellation", async () => {
    const [cover] = await render([item]);
    stalled = true;
    try {
        enter(cover); await wait();
        const video = cover.querySelector("video")!;
        enter(cover);
        for (let index = 0; index < 3; index++) {
            cover.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
        }
        await wait();
        expect(cover.querySelector("video")).toBe(video);
        expect(cover.getAttribute("data-hover-preview-state")).toBe("loading");
        window.dispatchEvent(new dom.WheelEvent("wheel"));
        expect(cover.querySelector("video")).toBeNull();
        cover.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
        await wait();
        const resumed = cover.querySelector("video");
        expect(resumed).not.toBeNull();
        expect(resumed).not.toBe(video);
        resumed!.dispatchEvent(new dom.Event("playing"));
        expect(cover.getAttribute("data-hover-preview-state")).toBe("playing");
        cover.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
        await wait();
        expect(cover.querySelector("video")).toBe(resumed);
        cover.dispatchEvent(new dom.PointerEvent("pointerleave"));
    } finally { stalled = false; await render([]); }
});

test("centered preview reports actual buffered seconds and resets on leave", async () => {
    const [cover] = await render([item]);
    stalled = true;
    try {
        enter(cover); await wait();
        const video = cover.querySelector("video")!;
        let ranges = [[0, 3]];
        Object.defineProperty(video, "duration", { configurable: true, value: 20 });
        Object.defineProperty(video, "buffered", { configurable: true, get: () => ({ length: ranges.length, start: (index: number) => ranges[index][0], end: (index: number) => ranges[index][1] }) });
        await act(async () => video.dispatchEvent(new dom.Event("progress")));
        expect(cover.querySelector(".inspiration-preview-percent")?.textContent).toBe("50%");
        expect(cover.querySelector("circle[pathLength]")?.getAttribute("stroke-dashoffset")).toBe("50");
        ranges = [[0, 1.5], [4, 6]];
        await act(async () => video.dispatchEvent(new dom.Event("progress")));
        expect(cover.querySelector(".inspiration-preview-percent")?.textContent).toBe("25%");
        Object.defineProperty(video, "duration", { configurable: true, value: 2 });
        ranges = [[0, 2]];
        await act(async () => video.dispatchEvent(new dom.Event("loadedmetadata")));
        expect(cover.querySelector(".inspiration-preview-percent")?.textContent).toBe("100%");
        await act(async () => cover.dispatchEvent(new dom.PointerEvent("pointerleave")));
        expect(cover.querySelector(".inspiration-preview-percent")?.textContent).toBe("0%");
        expect(cover.querySelector("video")).toBeNull();
    } finally { stalled = false; }
});

test("loading without metadata is indeterminate then shows real buffered progress", async () => {
    const [cover] = await render([item]);
    stalled = true;
    try {
        enter(cover); await wait();
        expect(cover.querySelector(".inspiration-preview-percent")?.textContent).toBe("0%");
        const video = cover.querySelector("video")!;
        Object.defineProperty(video, "duration", { configurable: true, value: NaN });
        Object.defineProperty(video, "buffered", { configurable: true, value: { length: 1, start: () => 0, end: () => 3 } });
        await act(async () => video.dispatchEvent(new dom.Event("progress")));
        expect(cover.querySelector(".inspiration-preview-percent")?.textContent).toBe("50%");
        expect(cover.querySelector(".inspiration-preview-loading")?.getAttribute("data-indeterminate")).toBe("false");
        await act(async () => cover.dispatchEvent(new dom.PointerEvent("pointerleave")));
    } finally { stalled = false; }
});

test("detail uses a full video player and omits metadata and management actions", async () => {
    const before = plays;
    await act(async () => root.render(<StrictMode><InspirationDetailModal item={{ ...item, tags: ["test-tag"], sourceUrl: "https://example.com/original" }} onClose={noop} onUse={noop} onCopy={noop} /></StrictMode>));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const video = dialog.querySelector("video")!;
    expect(video.src).toBe(item.videoUrl!);
    expect(plays).toBeGreaterThan(before);
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.controls).toBe(false);
    await act(async () => video.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
    expect(video.controls).toBe(true);
    await act(async () => video.dispatchEvent(new dom.PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })));
    expect(video.controls).toBe(false);
    await act(async () => video.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "Tab" })));
    expect(video.controls).toBe(true);
    await act(async () => video.dispatchEvent(new dom.FocusEvent("focusout", { bubbles: true })));
    expect(video.controls).toBe(false);
    await act(async () => video.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })));
    expect(video.controls).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.preload).toBe("auto");
    expect(dialog.textContent).toContain(item.prompt);
    for (const text of ["awesome-seedance", "@author", "CC BY", "来源", "许可", "分类", "类型", "查看上游", "test-tag"]) expect(dialog.textContent).not.toContain(text);
    expect(dialog.querySelector('[aria-label="收藏灵感"], [aria-label="编辑灵感"], [aria-label="隐藏灵感"]')).toBeNull();
    await act(async () => root.render(null));
    expect(video.getAttribute("src")).toBeNull();
});

test("detail keeps manual controls available when autoplay is blocked", async () => {
    rejectPlayback = true;
    try {
        await act(async () => root.render(<InspirationDetailModal item={item} onClose={noop} onUse={noop} onCopy={noop} />));
        const dialog = document.querySelector('[role="dialog"]')!;
        const video = dialog.querySelector("video")!;
        expect(video.controls).toBe(true);
        expect(dialog.textContent).toContain("自动播放受限");
        await act(async () => video.dispatchEvent(new dom.Event("play")));
        expect(dialog.textContent).not.toContain("自动播放受限");
        await act(async () => root.render(null));
        expect(video.getAttribute("src")).toBeNull();
    } finally { rejectPlayback = false; }
});

test("embedded hall follows composer modes, keeps appended order stable and reshuffles on reentry", async () => {
    useInspirationStore.setState({ hydrated: true, custom: [], overrides: {}, hidden: [], favorites: [] });
    const show = async (mode: "image" | "video") => {
        await act(async () => root.render(<App><InspirationHall embedded creationMode={mode} onUse={noop} /></App>));
    };
    const titles = () => Array.from(host.querySelectorAll(".inspiration-card-open"), (button) => button.getAttribute("aria-label"));
    const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLElement).click()); };
    const random = Math.random;
    let rank = 0;
    Math.random = () => (++rank % 10000) / 10000;
    try {
        await show("video");
        await act(async () => { intersect([{ isIntersecting: true }]); });
        const first = titles();
        expect(first).toHaveLength(30);
        expect(first.every((title) => Number(title!.replace("查看灵感：案例", "")) >= 36)).toBe(true);
        await show("video");
        expect(titles()).toEqual(first);
        await click(".inspiration-hall-load-more button");
        expect(titles()).toHaveLength(36);
        expect(titles().slice(0, 30)).toEqual(first);
        await click(".inspiration-card-open");
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(titles().slice(0, 30)).toEqual(first);
        await show("image");
        expect(titles()).toHaveLength(30);
        expect(titles().every((title) => Number(title!.replace("查看灵感：案例", "")) < 36)).toBe(true);
        await act(async () => root.render(null));
        rank = 0;
        Math.random = () => 1 - (++rank % 10000) / 10000;
        await show("video");
        await act(async () => { intersect([{ isIntersecting: true }]); });
        expect(titles()).toHaveLength(30);
        expect(titles()).not.toEqual(first);
        await act(async () => root.render(null));
    } finally { Math.random = random; }
});

test("embedded hall removes its duplicate heading and appends cards without pagination", async () => {
    useInspirationStore.setState({ hydrated: true, custom: [], overrides: {}, hidden: [], favorites: [] });
    const show = async (mode: "image" | "video") => {
        await act(async () => root.render(<App><InspirationHall embedded creationMode={mode} onUse={noop} /></App>));
    };
    const titles = () => Array.from(host.querySelectorAll(".inspiration-card-open"), (button) => button.getAttribute("aria-label"));
    await show("video");
    await act(async () => { intersect([{ isIntersecting: true }]); });
    expect(host.querySelector("h2")).toBeNull();
    expect(host.querySelector(".inspiration-hall")?.getAttribute("aria-label")).toBe("单次创作灵感");
    expect(host.querySelector(".inspiration-hall-header p")).toBeNull();
    expect(host.querySelector(".inspiration-hall-actions")).toBeNull();
    expect(host.querySelector(".inspiration-hall-toolbar")).toBeNull();
    expect(host.querySelector('[aria-label="分页"]')).toBeNull();
    const first = titles();
    expect(first).toHaveLength(30);
    const loadNext = intersect;
    await act(async () => { loadNext([{ isIntersecting: false }]); });
    expect(titles()).toEqual(first);
    await act(async () => { loadNext([{ isIntersecting: true }]); loadNext([{ isIntersecting: true }]); });
    expect(titles()).toHaveLength(36);
    expect(titles().slice(0, 30)).toEqual(first);
    expect(new Set(titles()).size).toBe(36);
    expect(host.querySelector(".inspiration-hall-load-more")).toBeNull();
    await show("image");
    expect(titles()).toHaveLength(30);
    expect(titles().every((title) => Number(title!.replace("查看灵感：案例", "")) < 36)).toBe(true);
    await act(async () => (host.querySelector(".inspiration-hall-load-more button") as HTMLElement).click());
    expect(titles()).toHaveLength(36);
    await act(async () => root.render(null));
});

test("standalone route owns scrolling, appends in catalog order and keeps order on reentry", async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={["/inspiration?view=prompt"]}><App><InspirationsPage /></App></MemoryRouter>));
    const scrollOwner = host.querySelector("main.app-workspace-scroll");
    expect(scrollOwner).not.toBeNull();
    expect(scrollOwner?.classList.contains("h-full")).toBe(true);
    expect(scrollOwner?.classList.contains("overflow-y-auto")).toBe(true);
    expect(scrollOwner?.querySelector(".inspiration-hall")).not.toBeNull();
    await act(async () => { intersect([{ isIntersecting: true }]); });
    expect(scrollOwner?.querySelectorAll(".inspiration-card")).toHaveLength(30);
    expect(scrollOwner?.querySelector('[aria-label="分页"]')).toBeNull();
    const titles = () => Array.from(host.querySelectorAll(".inspiration-card-open"), (button) => button.getAttribute("aria-label"));
    const expected = catalogEntries.map((item) => `查看灵感：${item.title}`);
    expect(titles()).toEqual(expected.slice(0, 30));
    const append = intersect;
    await act(async () => { append([{ isIntersecting: true }]); append([{ isIntersecting: true }]); });
    expect(titles()).toEqual(expected.slice(0, 60));
    await act(async () => { intersect([{ isIntersecting: true }]); });
    expect(titles()).toEqual(expected);
    expect(host.querySelector(".inspiration-hall-load-more")).toBeNull();
    await act(async () => (host.querySelectorAll(".inspiration-hall-modes button")[1] as HTMLElement).click());
    expect(titles()).toEqual(expected.slice(0, 30));
    expect(host.querySelector('.inspiration-hall-modes [aria-pressed="true"]')?.textContent).toBe("图片");
    await act(async () => root.render(null));
    await act(async () => root.render(<MemoryRouter initialEntries={["/inspiration?view=prompt"]}><App><InspirationsPage /></App></MemoryRouter>));
    await act(async () => { intersect([{ isIntersecting: true }]); });
    expect(titles()).toEqual(expected.slice(0, 30));
    await act(async () => root.render(null));
});

test("standalone inspiration switches to canvas works and opens details without nested page scrolling", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/inspiration?view=prompt"]}><App><InspirationsPage /></App></MemoryRouter></QueryClientProvider>));
    const buttons = host.querySelectorAll(".inspirations-view-switch button");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("新建灵感");
    expect(host.querySelector('[aria-label="更多灵感管理操作"]')).not.toBeNull();
    expect(host.querySelector("h2#inspiration-hall-title")).toBeNull();
    await act(async () => (buttons[1] as HTMLElement).click());
    for (let attempt = 0; attempt < 30 && !host.querySelector(".library-item"); attempt++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
    expect(host.textContent).toContain(canvasWork.title);
    expect(host.querySelector(".library-item-info")?.textContent).toBe(canvasWork.title);
    expect(host.textContent).not.toContain("灵感大厅");
    expect(host.querySelectorAll("main.app-workspace-scroll")).toHaveLength(1);
    expect(host.querySelector(".inspiration-hall")).toBeNull();
    const playsBeforeOpen = plays;
    await act(async () => (host.querySelector(".library-item") as HTMLElement).click());
    for (let attempt = 0; attempt < 30 && !document.querySelector(".libtv-detail-main"); attempt++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
    const dialog = document.querySelector(".libtv-work-detail-dialog")!;
    expect(dialog.querySelector("aside")).toBeNull();
    expect(dialog.textContent).not.toContain("精选推荐");
    expect(dialog.querySelector("h1")?.textContent).toBe(canvasWork.title);
    expect(dialog.querySelector("video")?.controls).toBe(true);
    expect(dialog.querySelector("video")?.preload).toBe("auto");
    expect(dialog.querySelector("video")?.muted).toBe(true);
    expect(plays).toBeGreaterThan(playsBeforeOpen);
    const video = dialog.querySelector("video")!;
    expect(video.src).toContain(canvasWork.mediaUrl);
    const notice = dialog.querySelector("details.libtv-import-notice")!;
    expect(notice.hasAttribute("open")).toBe(false);
    expect(notice.querySelector("summary")?.textContent).toContain("2 项");
    expect(notice.querySelectorAll("li")).toHaveLength(2);
    expect(dialog.querySelector(".libtv-detail-main")?.getAttribute("tabindex")).toBe("0");
    expect(dialog.textContent).not.toContain("一键复刻");
    await act(async () => (document.querySelector(".libtv-work-detail-dialog .ant-modal-close") as HTMLElement).click());
    await act(async () => (buttons[0] as HTMLElement).click());
    expect(host.querySelector(".inspiration-hall")).not.toBeNull();
    await act(async () => root.render(null));
    expect(video.getAttribute("src")).toBeNull();
    client.clear();
});

test("canvas works follow creation mode and remove exhausted cover failures", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const renderMode = async (mode: "image" | "video") => {
        await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><App><CreationFeaturedWorks creationMode={mode} /></App></MemoryRouter></QueryClientProvider>));
    };
    await renderMode("video");
    for (let attempt = 0; attempt < 30 && !host.querySelector(".creation-featured-card"); attempt++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
    expect(host.textContent).toContain(canvasWork.title);
    expect(host.textContent).not.toContain(imageCanvasWork.title);
    expect(host.querySelector(".creation-featured-layout .is-featured-hero")).not.toBeNull();
    expect(host.querySelector(".creation-featured-media img")).not.toBeNull();
    expect(host.querySelector(".creation-featured-copy")?.textContent).toBe(canvasWork.title);
    await renderMode("image");
    expect(host.textContent).toContain(imageCanvasWork.title);
    expect(host.textContent).not.toContain(canvasWork.title);
    await act(async () => root.render(<LibTVGalleryCard priority item={{ ...canvasWork, coverUrl: "https://libtv-res.liblib.art/fixture/cover.png", mediaUrl: "https://libtv-res.liblib.art/fixture/video.mp4", mediaType: "video" }} onClick={noop} />));
    expect(host.querySelector("img")?.src).toContain("image%2Fresize%2Cw_480");
    await act(async () => host.querySelector("img")!.dispatchEvent(new dom.Event("error")));
    expect(host.querySelector("img")?.src).toBe("https://libtv-res.liblib.art/fixture/cover.png");
    await act(async () => host.querySelector("img")!.dispatchEvent(new dom.Event("error")));
    expect(host.querySelector("img")?.src).toContain("video%2Fsnapshot");
    await act(async () => host.querySelector("img")!.dispatchEvent(new dom.Event("error")));
    expect(host.querySelectorAll(".libtv-gallery-card").length).toBe(0);
    expect(host.querySelector(".libtv-cover-spinner")).toBeNull();
    await act(async () => root.render(null));
    client.clear();
});

test("creation tunnel shows canvas works by mode and opens autoplay details", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const show = async (mode: "image" | "video", enabled = true, hidden = false) => {
        await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><App><CreationInspirationTunnel mode={mode} enabled={enabled} hidden={hidden} /></App></MemoryRouter></QueryClientProvider>));
    };
    await show("video", false);
    expect(host.querySelector(".creation-inspiration-tunnel")).toBeNull();
    await show("video");
    for (let attempt = 0; attempt < 30 && !host.querySelector(".creation-tunnel-card"); attempt++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
    expect(host.querySelectorAll(".creation-tunnel-card")).toHaveLength(1);
    expect(host.querySelector(".creation-tunnel-card-title")?.textContent).toBe(canvasWork.title);
    await act(async () => host.querySelector("img")!.dispatchEvent(new dom.Event("load")));
    expect(host.querySelector(".creation-tunnel-card")?.classList.contains("is-ready")).toBe(true);
    const before = plays;
    await act(async () => host.querySelector(".creation-tunnel-card")!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    for (let attempt = 0; attempt < 30 && !document.querySelector(".libtv-detail-main video"); attempt++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
    expect(document.querySelector(".libtv-work-detail-dialog h1")?.textContent).toBe(canvasWork.title);
    expect(plays).toBeGreaterThan(before);
    await act(async () => (document.querySelector(".libtv-work-detail-dialog .ant-modal-close") as HTMLElement).click());
    await show("image");
    expect(host.querySelector(".creation-tunnel-card-title")?.textContent).toBe(imageCanvasWork.title);
    expect(host.querySelectorAll(".creation-tunnel-card")).toHaveLength(1);
    await show("image", true, true);
    expect(host.querySelector(".creation-inspiration-tunnel")?.getAttribute("data-hidden")).toBe("true");
    expect(host.querySelector(".creation-inspiration-tunnel")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => root.render(null));
    client.clear();
});

test("missing canvas images use single creation images in both areas and keep prompt handoff", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
    client.setQueryData(["libtv-gallery", "", null], { pages: [{ items: [canvasWork], page: 1, pageSize: 20, hasMore: false, requestId: "fixture" }], pageParams: [{ page: 1 }] });
    useInspirationStore.setState({ hydrated: true, custom: [], overrides: {}, hidden: [], favorites: [] });
    let used: CreationInspiration | undefined;
    const onUse = (entry: CreationInspiration) => { used = entry; };
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><App><CreationFeaturedWorks creationMode="image" onUseInspiration={onUse} /></App></MemoryRouter></QueryClientProvider>));
    await act(async () => { intersect([{ isIntersecting: true }]); });
    expect(host.querySelectorAll(".inspiration-card-open").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".creation-featured-card, video").length).toBe(0);
    await act(async () => (host.querySelector(".inspiration-card-open") as HTMLElement).click());
    await act(async () => (document.querySelector(".inspiration-detail-use") as HTMLElement).click());
    expect(used?.mode).toBe("image");
    expect(used?.prompt).toBeTruthy();
    used = undefined;
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><App><CreationInspirationTunnel mode="image" enabled onUseInspiration={onUse} /></App></MemoryRouter></QueryClientProvider>));
    expect(host.querySelectorAll(".creation-tunnel-card").length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain(canvasWork.title);
    await act(async () => host.querySelector(".creation-tunnel-card.is-active")!.dispatchEvent(new dom.MouseEvent("click", { bubbles: true })));
    await act(async () => (document.querySelector(".inspiration-detail-use") as HTMLElement).click());
    expect(used?.mode).toBe("image");
    await act(async () => root.render(null));
    client.clear();
});

test("failed featured hero disappears and the next loaded card takes its place", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
    client.setQueryData(["libtv-gallery", "", null], { pages: [{ items: [canvasWork, { ...canvasWork, templateUuid: "second-work", title: "第二张作品" }], page: 1, pageSize: 20, hasMore: false, requestId: "fixture" }], pageParams: [{ page: 1 }] });
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><App><CreationFeaturedWorks creationMode="video" /></App></MemoryRouter></QueryClientProvider>));
    expect(host.querySelectorAll(".creation-featured-card").length).toBe(2);
    const first = host.querySelector(".is-featured-hero")!;
    const title = first.getAttribute("aria-label");
    await act(async () => first.querySelector("img")!.dispatchEvent(new dom.Event("error")));
    expect(host.querySelectorAll(".creation-featured-card").length).toBe(1);
    expect(host.querySelector(".is-featured-hero")?.getAttribute("aria-label")).not.toBe(title);
    await act(async () => root.render(null));
    client.clear();
});

test("standalone detail hands the selected prompt and mode to the creation route", async () => {
    function CreationDestination() {
        const { state } = useLocation();
        return <output data-mode={state?.inspirationMode}>{state?.inspirationPrompt}</output>;
    }
    for (const mode of ["image", "video"] as const) {
        const selected = { ...item, id: `custom:handoff-${mode}`, mode, prompt: "Original prompt", promptZh: `  ${mode} 中文提示词\n保留第二行  ` };
        useInspirationStore.setState({ hydrated: true, custom: [selected], overrides: {}, hidden: [], favorites: [] });
        await act(async () => root.render(<MemoryRouter initialEntries={["/inspiration?view=prompt"]}><App><Routes>
            <Route path="/inspiration" element={<InspirationsPage />} />
            <Route path="/create" element={<CreationDestination />} />
        </Routes></App></MemoryRouter>));
        await act(async () => { intersect([{ isIntersecting: true }]); });
        await act(async () => (host.querySelector(".inspiration-card-open") as HTMLElement).click());
        await act(async () => (document.querySelector(".inspiration-detail-use") as HTMLElement).click());
        expect(host.querySelector("output")?.textContent).toBe(selected.promptZh.trim());
        expect(host.querySelector("output")?.getAttribute("data-mode")).toBe(mode);
        await act(async () => root.render(null));
    }
});

test("masonry bounds tall posters and recalculates row spans when content resizes", async () => {
    const [cover] = await render([item]);
    const image = cover.querySelector("img")!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 560 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 994 });
    await act(async () => image.dispatchEvent(new dom.Event("load")));
    expect(parseFloat((cover as HTMLElement).style.aspectRatio)).toBe(0.8);
    expect(host.querySelector(".inspiration-card-desc")).toBeNull();
    const content = host.querySelector(".inspiration-card-open")!;
    const card = content.parentElement!;
    Object.defineProperty(content, "getBoundingClientRect", { configurable: true, value: () => ({ height: 304 }) });
    resizeCallbacks.get(content)!();
    expect(card.style.gridRowEnd).toBe("span 14");
    Object.defineProperty(content, "getBoundingClientRect", { configurable: true, value: () => ({ height: 208 }) });
    resizeCallbacks.get(content)!();
    expect(card.style.gridRowEnd).toBe("span 10");
    await render([]);
    expect(resizeCallbacks.has(content)).toBe(false);
});
