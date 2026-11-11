import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasLibrarySummary } from "@/services/api/user-data";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

let canSelect = true;
let activeId = "conversation-1";
const conversations = Array.from({ length: 12 }, (_, index) => ({ id: `conversation-${index + 1}`, title: `创作 ${index + 1}`, mode: (["video", "image", "text"] as const)[index % 3], updatedAt: "2026-11-10T00:00:00Z" }));
mock.module("@/hooks/use-creation-sidebar-history", () => ({ useCreationSidebarHistory: () => ({ items: conversations, loading: false, error: "", refetch: () => {}, activeId, canSelect }) }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: { hydrated: boolean }) => unknown) => selector({ hydrated: true }) }));
mock.module("@/lib/workspace-route-modules", () => ({ loadCanvasProjectPage: async () => ({}) }));
mock.module("@/stores/use-config-store", () => ({ resolveBackendApiUrl: (url: string) => url }));
mock.module("@/components/cached-resource-image", () => ({ CachedResourceImage: () => null }));

const calls: Array<{ page: number; pageSize: number; signal?: AbortSignal }> = [];
let failPage = 0;
let holdPage = 0;
let releasePage: (() => void) | undefined;
let overlapping = false;
const projects: CanvasLibrarySummary[] = Array.from({ length: 12 }, (_, index) => ({ id: `canvas-${index + 1}`, title: `画布 ${index + 1}`, createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z", nodeCount: 0, previewNodes: [] }));
mock.module("@/services/api/user-data", () => ({
    listRemoteCanvasProjects: async () => ({ projects }),
    listRemoteCanvasProjectsPage: async (options: { page: number; pageSize: number; signal?: AbortSignal }) => {
        calls.push(options);
        if (holdPage === options.page)
            await new Promise<void>((resolve) => {
                releasePage = resolve;
            });
        if (failPage === options.page) throw new Error("offline");
        const start = (options.page - 1) * options.pageSize;
        const pageProjects = projects.slice(start, start + options.pageSize);
        if (overlapping && options.page === 2) pageProjects[0] = projects[4];
        return { projects: pageProjects, page: options.page, pageSize: options.pageSize, total: projects.length, hasMore: options.page < 3 };
    },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter, useLocation } = await import("react-router");
await import("@/i18n");
const { WorkspaceSidebarHistory } = await import("@/components/layout/workspace-sidebar-history");
const { useCanvasUiStore } = await import("@/stores/canvas/use-canvas-ui-store");
const { useSidebarHistoryPrefsStore } = await import("@/stores/use-sidebar-history-prefs-store");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;
let navigated = 0;
function Location() {
    const location = useLocation();
    return (
        <output>
            {location.pathname}
            {location.search}
        </output>
    );
}
async function render(userId = "user-a") {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <WorkspaceSidebarHistory
                        userId={userId}
                        onNavigate={() => {
                            navigated++;
                        }}
                    />
                    <Location />
                </MemoryRouter>
            </QueryClientProvider>,
        ),
    );
}
async function eventually(check: () => void) {
    const deadline = Date.now() + 1500;
    let failure: unknown;
    do {
        try {
            check();
            return;
        } catch (error) {
            failure = error;
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    } while (Date.now() < deadline);
    throw failure;
}
function section(label: string) {
    return host.querySelector<HTMLElement>(`section[aria-label="${label}"]`)!;
}
function rows(label: string) {
    return section(label).querySelectorAll("li");
}
function button(label: string, group: string) {
    const found = [...section(group).querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
    expect(found).toBeDefined();
    return found!;
}
async function click(label: string, group: string) {
    await act(async () => button(label, group).click());
}

beforeEach(() => {
    calls.length = 0;
    failPage = 0;
    holdPage = 0;
    releasePage = undefined;
    overlapping = false;
    canSelect = true;
    activeId = "conversation-1";
    navigated = 0;
    useCanvasUiStore.setState({ deleteProjectIds: [], selectedProjectIds: [] });
    useSidebarHistoryPrefsStore.setState({ users: {} });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
});
afterAll(() => dom.happyDOM.abort());

test("两组首屏最多五条，创作对话用视频、图片、文本图标并链接到首页", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    expect(rows("对话")).toHaveLength(5);
    expect(calls.map(({ page, pageSize }) => [page, pageSize])).toEqual([[1, 5]]);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect([...section("对话").querySelectorAll('[role="img"]')].slice(0, 3).map((node) => node.getAttribute("aria-label"))).toEqual(["视频", "图片", "文本"]);
    await act(async () => section("对话").querySelectorAll<HTMLAnchorElement>("li a")[1].click());
    expect(host.querySelector("output")?.textContent).toBe("/?conversation=conversation-2");
    expect(navigated).toBe(1);
});

test("画布右键菜单只选择当前条目删除，不导航、不沿用其他批量选择", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    useCanvasUiStore.setState({ selectedProjectIds: ["canvas-1", "canvas-4"] });
    const link = section("画布").querySelectorAll<HTMLAnchorElement>("li a")[1];
    await act(async () => link.dispatchEvent(new dom.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })));
    await eventually(() => expect([...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.includes("删除"))).toBe(true));
    expect(host.querySelector("output")?.textContent).toBe("/");
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual([]);
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("删除"))!.click());
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual(["canvas-2"]);
    expect(useCanvasUiStore.getState().selectedProjectIds).toEqual(["canvas-1", "canvas-4"]);
    expect(host.querySelector("output")?.textContent).toBe("/");
    expect(navigated).toBe(0);
});

test("画布左键仍直接打开条目，不显示删除弹窗", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    await act(async () => section("画布").querySelectorAll<HTMLAnchorElement>("li a")[2].click());
    expect(host.querySelector("output")?.textContent).toBe("/canvas/canvas-3");
    expect(navigated).toBe(1);
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual([]);
});

async function rowAction(title: string, action: string) {
    const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${title}的操作"]`)!;
    await act(async () => trigger.click());
    const menu = () => document.getElementById(trigger.getAttribute("aria-controls")!);
    await eventually(() => expect([...menu()!.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.trim() === action)).toBe(true));
    await act(async () => [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === action)!.click());
}

function canvasTitles() {
    return [...section("画布").querySelectorAll(".workspace-history-title")].map((node) => node.textContent);
}

test("更多按钮置顶与上移不导航，重置顺序保留置顶并隔离账号", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    await rowAction("画布 3", "上移");
    expect(canvasTitles()).toEqual(["画布 1", "画布 3", "画布 2", "画布 4", "画布 5"]);
    await rowAction("画布 4", "置顶");
    expect(canvasTitles()[0]).toBe("画布 4");
    await rowAction("画布 3", "恢复最近更新顺序");
    expect(canvasTitles()).toEqual(["画布 4", "画布 1", "画布 2", "画布 3", "画布 5"]);
    expect(host.querySelector("output")?.textContent).toBe("/");
    expect(navigated).toBe(0);
    await render("user-b");
    await eventually(() => expect(canvasTitles()[0]).toBe("画布 1"));
    await render("user-a");
    await eventually(() => expect(canvasTitles()[0]).toBe("画布 4"));
    await rowAction("画布 4", "取消置顶");
    expect(canvasTitles()[0]).toBe("画布 1");
});

test("第二页置顶在重新请求第一页后仍可发现，只持久化条目 ID", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    await click("加载更多", "画布");
    await eventually(() => expect(rows("画布")).toHaveLength(10));
    await rowAction("画布 8", "置顶");
    expect(canvasTitles()[0]).toBe("画布 8");
    await render("user-b");
    client.removeQueries({ queryKey: ["canvas-library", "user-a"] });
    await render("user-a");
    await eventually(() => expect(canvasTitles()[0]).toBe("画布 8"));
    expect(canvasTitles()).toHaveLength(5);
    const saved = localStorage.getItem("yingce:sidebar-history-prefs")!;
    expect(saved).toContain("canvas-8");
    expect(saved).not.toContain("画布 8");
    expect(saved).not.toContain("previewNodes");
});

test("对话同样可以置顶与调序，置顶条目不能上移跨组", async () => {
    await render();
    await rowAction("创作 3", "置顶");
    expect(section("对话").querySelector(".workspace-history-title")?.textContent).toBe("创作 3");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="创作 1的操作"]')!.click());
    await eventually(() => expect([...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"][aria-disabled="true"]')].some((item) => item.textContent === "上移")).toBe(true));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="创作 1的操作"]')!.click());
    await rowAction("创作 5", "上移");
    expect([...section("对话").querySelectorAll(".workspace-history-title")].map((node) => node.textContent)).toEqual(["创作 3", "创作 1", "创作 2", "创作 5", "创作 4"]);
});

test("每次追加五条，末页停止，收起后重新展开复用缓存", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    await click("加载更多", "对话");
    expect(rows("对话")).toHaveLength(10);
    await click("加载更多", "画布");
    await eventually(() => expect(rows("画布")).toHaveLength(10));
    await click("加载更多", "画布");
    await eventually(() => expect(rows("画布")).toHaveLength(12));
    expect([...section("画布").querySelectorAll("button")].some((node) => node.textContent?.includes("加载更多"))).toBe(false);
    await click("收起", "画布");
    expect(rows("画布")).toHaveLength(5);
    await click("加载更多", "画布");
    expect(rows("画布")).toHaveLength(10);
    expect(calls.map((call) => call.page)).toEqual([1, 2, 3]);
});

test("下一页失败保留已加载记录，重试同一页且不重复条目", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    failPage = 2;
    await click("加载更多", "画布");
    await eventually(() => expect(section("画布").querySelector('[role="alert"]')).not.toBeNull());
    expect(rows("画布")).toHaveLength(5);
    failPage = 0;
    overlapping = true;
    await click("重试", "画布");
    await eventually(() => expect(rows("画布")).toHaveLength(9));
    expect(new Set([...rows("画布")].map((row) => row.textContent)).size).toBe(9);
    expect(calls.map((call) => call.page)).toEqual([1, 2, 2]);
});

test("加载中禁止重复点击，完成后只追加一页", async () => {
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    holdPage = 2;
    await click("加载更多", "画布");
    await eventually(() => expect(button("加载中…", "画布").disabled).toBe(true));
    await click("加载中…", "画布");
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
    await act(async () => releasePage?.());
    await eventually(() => expect(rows("画布")).toHaveLength(10));
});

test("创作中阻止切换和新建，账号切换将两组重置为五条", async () => {
    canSelect = false;
    await render();
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    const second = section("对话").querySelectorAll<HTMLAnchorElement>("li a")[1];
    expect(second.getAttribute("aria-disabled")).toBe("true");
    await act(async () => second.click());
    await act(async () => section("对话").querySelector<HTMLAnchorElement>('a[aria-label="新建对话"]')!.click());
    expect(host.querySelector("output")?.textContent).toBe("/");
    expect(navigated).toBe(0);
    await click("加载更多", "对话");
    await click("加载更多", "画布");
    await eventually(() => expect(rows("画布")).toHaveLength(10));
    await render("user-b");
    await eventually(() => expect(rows("画布")).toHaveLength(5));
    expect(rows("对话")).toHaveLength(5);
    expect(calls.map((call) => call.page)).toEqual([1, 2, 1]);
});
