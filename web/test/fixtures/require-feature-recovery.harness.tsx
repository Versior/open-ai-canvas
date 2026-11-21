import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { AxiosError } from "axios";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/interior", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement", "Element", "Node", "SVGElement", "ShadowRoot", "Event", "CustomEvent", "MutationObserver", "ResizeObserver"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
}
Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.getComputedStyle.bind(dom) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const { act, useEffect, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Route, Routes, useLocation } = await import("react-router");
const { RequireFeature } = await import("@/components/auth/require-feature");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { apiClient } = await import("@/services/api/request");
const { defaultFeatureAvailability, useUserStore } = await import("@/stores/use-user-store");

type Reply = boolean | 503;
const pending: Array<{ owner: string; signal?: { readonly aborted: boolean }; reply: (value: Reply) => void }> = [];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let initialized = 0;
let editorActions = 0;
const originalAdapter = apiClient.defaults.adapter;

beforeEach(() => {
    initialized = editorActions = pending.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    apiClient.defaults.adapter = async (config) => {
        expect([config.method, config.url]).toEqual(["get", "/features"]);
        const value = await new Promise<Reply>((reply) => pending.push({ owner: String(config.headers.get("X-Canvas-Expected-User")), signal: config.signal, reply }));
        const response = { config, headers: {}, status: value === 503 ? 503 : 200, statusText: value === 503 ? "Service Unavailable" : "OK" };
        if (value === 503) throw new AxiosError("Service Unavailable", "ERR_BAD_RESPONSE", config, undefined, { ...response, data: { code: 503, msg: "开关服务暂不可用", reason: "unavailable" } });
        return { ...response, data: { code: 0, msg: "", data: { features: { ...defaultFeatureAvailability, interiorEnabled: value } } } };
    };
});
afterEach(async () => {
    await act(() => root.unmount());
    apiClient.defaults.adapter = originalAdapter;
    host.remove();
});
afterAll(() => dom.happyDOM.abort());

function signIn(id: string, enabled: boolean) {
    setActiveUserScope(id);
    useUserStore.setState({ user: { id, username: id, displayName: id, role: "user", status: "active" }, hydrated: true, features: { ...defaultFeatureAvailability, interiorEnabled: enabled } });
}

function Editor() {
    const [draft, setDraft] = useState("");
    const [instance] = useState(() => ++initialized);
    useEffect(() => {
        const shortcut = () => {
            editorActions++;
        };
        window.addEventListener("keydown", shortcut);
        return () => window.removeEventListener("keydown", shortcut);
    }, []);
    return (
        <section aria-label="工作区" data-instance={instance}>
            <input aria-label="编辑草稿" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button
                onClick={() => {
                    editorActions++;
                }}
            >
                保存草稿
            </button>
        </section>
    );
}

function CurrentRoute() {
    return <output aria-label="当前路由">{useLocation().pathname}</output>;
}

async function open(enabled = true) {
    signIn("synthetic-a", enabled);
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={["/interior"]}>
                <CurrentRoute />
                <Routes>
                    <Route
                        path="/interior"
                        element={
                            <RequireFeature feature="interiorEnabled">
                                <Editor />
                            </RequireFeature>
                        }
                    />
                </Routes>
            </MemoryRouter>,
        ),
    );
    expect(pending.map((request) => request.owner)).toEqual(["synthetic-a"]);
}

const editor = () => host.querySelector<HTMLElement>('[aria-label="工作区"]');
const draft = () => host.querySelector<HTMLInputElement>('[aria-label="编辑草稿"]');
const route = () => host.querySelector("output")?.textContent;
const reply = (index: number, value: Reply) =>
    act(async () => {
        pending[index].reply(value);
    });
const retry = () =>
    act(async () => {
        const button = [...host.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find((item) => item.textContent?.includes("重新确认"));
        expect(button).toBeDefined();
        button!.click();
    });

async function enter(text: string) {
    const input = draft()!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe(text);
}

function isAvailable(element: HTMLElement | null) {
    if (!element) return false;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.inert || getComputedStyle(parent).display === "none") return false;
    }
    return true;
}

test("503 后工作区不可见、快捷键失效；原地重试开启时恢复原实例和草稿", async () => {
    await open();
    const instance = editor()?.dataset.instance;
    expect(isAvailable(draft())).toBe(true);
    await enter("尚未保存的室内预算");
    window.dispatchEvent(new Event("keydown"));
    expect(editorActions).toBe(1);
    await reply(0, 503);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法确认功能状态");
    expect(isAvailable(draft())).toBe(false);
    expect(isAvailable(editor()?.querySelector("button") ?? null)).toBe(false);
    window.dispatchEvent(new Event("keydown"));
    expect(editorActions).toBe(1);
    await retry();
    expect(pending.map((request) => request.owner)).toEqual(["synthetic-a", "synthetic-a"]);
    expect(isAvailable(draft())).toBe(false);
    await reply(1, true);
    expect(route()).toBe("/interior");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(isAvailable(draft())).toBe(true);
    expect(editor()?.dataset.instance).toBe(instance);
    expect(draft()?.value).toBe("尚未保存的室内预算");
    window.dispatchEvent(new Event("keydown"));
    expect(editorActions).toBe(2);
});

test("重试得到关闭时卸载原编辑器，不以保留草稿为由继续开放", async () => {
    await open();
    await enter("未提交的方案");
    await reply(0, 503);
    await retry();
    await reply(1, false);
    expect(host.querySelector('[data-kind="forbidden"]')?.textContent).toContain("室内设计暂未开放");
    expect(editor()).toBeNull();
    expect(route()).toBe("/interior");
});

test("会话初始未开放且查询确认关闭时，从未挂载编辑器", async () => {
    await open(false);
    expect(editor()).toBeNull();
    await reply(0, false);
    expect(host.querySelector('[data-kind="forbidden"]')?.textContent).toContain("室内设计暂未开放");
    expect(initialized).toBe(0);
});

test("换号丢弃原编辑器；旧账号迟到的开启回执不能重开新账号已关闭的功能", async () => {
    await open();
    const oldInstance = editor()?.dataset.instance;
    await enter("仅属于 A 的草稿");
    await reply(0, 503);
    await retry();
    await act(async () => signIn("synthetic-b", true));
    expect(pending.map((request) => request.owner)).toEqual(["synthetic-a", "synthetic-a", "synthetic-b"]);
    expect(pending[1].signal?.aborted).toBe(true);
    expect(isAvailable(draft())).toBe(true);
    expect(draft()?.value).toBe("");
    expect(editor()?.dataset.instance).not.toBe(oldInstance);
    await reply(2, false);
    await reply(1, true);
    expect(useUserStore.getState().features.interiorEnabled).toBe(false);
    expect(editor()).toBeNull();
    expect(host.querySelector('[data-kind="forbidden"]')?.textContent).toContain("室内设计暂未开放");
});
