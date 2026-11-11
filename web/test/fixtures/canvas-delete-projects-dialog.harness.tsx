import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

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
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const requests: string[][] = [];
let cleanupCount = 0;
let deleteRequest: () => Promise<void> = async () => {};
mock.module("@/services/user-data-sync", () => ({
    deleteCanvasProjectsWithRemoteSync: async (ids: string[]) => {
        requests.push(ids);
        await deleteRequest();
    },
}));
mock.module("@/stores/use-asset-store", () => ({
    useAssetStore: (selector: (state: { cleanupImages: () => void }) => unknown) =>
        selector({
            cleanupImages: () => {
                cleanupCount++;
            },
        }),
}));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
mock.module("@/components/layout/app-top-nav", () => ({ AppWorkspaceShell: ({ children }: { children: import("react").ReactNode }) => children }));
mock.module("@/components/canvas/use-agent-panel-dock", () => ({ useAgentPanelDock: () => ({ active: false, width: 0 }) }));
mock.module("@/lib/app-theme", () => ({ getWorkspaceAntThemeConfig: () => ({}) }));
mock.module("@/stores/use-global-agent-store", () => ({ useGlobalAgentStore: { getState: () => ({ closeAgent: () => {} }) } }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { MemoryRouter, useLocation, useNavigate } = await import("react-router");
await import("@/i18n");
const { useCanvasUiStore } = await import("@/stores/canvas/use-canvas-ui-store");
const { default: UserLayout } = await import("@/layouts/user-layout");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let navigate: ReturnType<typeof useNavigate>;

function Page() {
    const location = useLocation();
    navigate = useNavigate();
    return <output>{location.pathname}</output>;
}

async function render(path = "/studio") {
    await act(async () =>
        root.render(
            <App>
                <MemoryRouter initialEntries={[path]}>
                    <UserLayout>
                        <Page />
                    </UserLayout>
                </MemoryRouter>
            </App>,
        ),
    );
}

async function eventually(check: () => void) {
    const deadline = Date.now() + 2000;
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

function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((element) => element.textContent?.replace(/\s/g, "") === label);
    expect(found).toBeDefined();
    return found!;
}

async function open() {
    await act(async () => useCanvasUiStore.getState().setDeleteProjectIds(["canvas-2"]));
    await eventually(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1));
}

beforeEach(() => {
    requests.length = 0;
    cleanupCount = 0;
    deleteRequest = async () => {};
    useCanvasUiStore.setState({ deleteProjectIds: [], selectedProjectIds: ["canvas-1", "canvas-2"] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useCanvasUiStore.setState({ deleteProjectIds: [], selectedProjectIds: [] });
});
afterAll(() => dom.happyDOM.abort());

test("生图台也能打开唯一的共用删除弹窗，取消不请求删除", async () => {
    await render();
    await open();
    await act(async () => button("取消").click());
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual([]);
    expect(requests).toEqual([]);
    expect(host.querySelector("output")?.textContent).toBe("/studio");
});

test("服务端删除成功才关闭弹窗并移除选择，删除其他画布保留当前页面", async () => {
    await render("/canvas/canvas-1");
    await open();
    await act(async () => button("删除").click());
    expect(requests).toEqual([["canvas-2"]]);
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual([]);
    expect(useCanvasUiStore.getState().selectedProjectIds).toEqual(["canvas-1"]);
    expect(cleanupCount).toBe(1);
    expect(host.querySelector("output")?.textContent).toBe("/canvas/canvas-1");
});

test("删除当前画布后离开编辑器，返回全部画布", async () => {
    await render("/canvas/canvas-2");
    await open();
    await act(async () => button("删除").click());
    expect(host.querySelector("output")?.textContent).toBe("/canvas");
    expect(requests).toEqual([["canvas-2"]]);
});

test("删除失败保留弹窗、选择和当前画布，允许重试", async () => {
    deleteRequest = async () => {
        throw new Error("测试拒绝删除");
    };
    await render("/canvas/canvas-2");
    await open();
    await act(async () => button("删除").click());
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual(["canvas-2"]);
    expect(useCanvasUiStore.getState().selectedProjectIds).toEqual(["canvas-1", "canvas-2"]);
    expect(cleanupCount).toBe(0);
    expect(host.querySelector("output")?.textContent).toBe("/canvas/canvas-2");
    expect(document.body.textContent).toContain("测试拒绝删除");
    deleteRequest = async () => {};
    await act(async () => button("删除").click());
    expect(host.querySelector("output")?.textContent).toBe("/canvas");
});

test("删除请求未完成时不重复提交，也不关闭确认框", async () => {
    let complete: (() => void) | undefined;
    deleteRequest = () =>
        new Promise<void>((resolve) => {
            complete = resolve;
        });
    await render("/canvas/canvas-2");
    await open();
    await act(async () => {
        button("删除").click();
        button("删除").click();
    });
    expect(requests).toEqual([["canvas-2"]]);
    expect(button("取消").disabled).toBe(true);
    await act(async () => button("取消").click());
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual(["canvas-2"]);
    await act(async () => navigate("/studio"));
    expect(host.querySelector("output")?.textContent).toBe("/studio");
    await act(async () => complete?.());
    expect(host.querySelector("output")?.textContent).toBe("/studio");
    expect(useCanvasUiStore.getState().deleteProjectIds).toEqual([]);
});
