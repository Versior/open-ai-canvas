import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasShareStatus } from "@/services/api/canvas-share";

const dom = new Window({ url: "http://localhost/", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, value });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { CanvasShareModal } = await import("@/components/canvas/canvas-share-modal");
const { ApiError, apiClient } = await import("@/services/api/request");
const initialAdapter = apiClient.defaults.adapter;

type Call = { method: string; projectId: string; signal?: { readonly aborted: boolean } };
let calls: Call[], copied: string[], root: ReturnType<typeof createRoot>, host: HTMLDivElement;
let respond: (request: Call) => CanvasShareStatus | Promise<CanvasShareStatus>;
let save: () => Promise<void>;
const inactive: CanvasShareStatus = { enabled: false };
const enabled = (token: string): CanvasShareStatus => ({ enabled: true, token });
const history = () => calls.map(({ method, projectId }) => `${method} ${projectId}`);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const text = (role: string) =>
    Array.from(dialog()?.querySelectorAll(`[role="${role}"]`) ?? [])
        .map((node) => node.textContent)
        .join(" ");
const button = (label: string) => Array.from(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((node) => node.textContent?.replace(/\s/g, "") === label || node.getAttribute("aria-label") === label);
const link = () => Array.from(dialog()?.querySelectorAll<HTMLInputElement>("input") ?? []).find((input) => input.value.startsWith(`${window.location.origin}/share/canvas/`));
const setClipboard = (writeText?: (value: string) => Promise<void>) => Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
const recordCopy = async (value: string) => {
    copied.push(value);
};
const click = async (label: string) => {
    const target = button(label);
    expect(target?.disabled).toBe(false);
    await act(async () => target!.click());
};

function render(projectId: string | null, localOnly = false) {
    root.render(
        <ConfigProvider theme={{ token: { motion: false } }}>
            <App>{projectId && <CanvasShareModal key={projectId} projectId={projectId} localOnly={localOnly} onClose={() => render(null)} beforeCreate={save} />}</App>
        </ConfigProvider>,
    );
}

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    calls = [];
    copied = [];
    save = async () => {};
    respond = () => inactive;
    setClipboard(recordCopy);
    apiClient.defaults.adapter = async (config) => {
        const match = /^\/canvas-projects\/([^/]+)\/share$/.exec(config.url!);
        if (!match) throw new Error(`Unexpected share endpoint: ${config.url}`);
        const call = { method: config.method!.toUpperCase(), projectId: match[1], signal: config.signal };
        calls.push(call);
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, msg: "", data: { share: await respond(call) } } };
    };
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    apiClient.defaults.adapter = initialAdapter;
});
afterAll(async () => {
    await dom.happyDOM.close();
});

test("an unsaved canvas exposes the saving phase and failure reason; no create request or copy is attempted", async () => {
    const pending = Promise.withResolvers<void>();
    save = () => pending.promise;
    await act(async () => render("A"));
    await click("创建并复制链接");
    expect(text("status")).toContain("正在将画布保存到云端");
    expect(history()).toEqual(["GET A"]);
    await act(async () => pending.reject(new Error("本地画布存在未解决的修订冲突")));
    expect(text("alert")).toContain("没有创建分享链接");
    expect(text("alert")).toContain("未解决的修订冲突");
    expect(history()).toEqual(["GET A"]);
    expect(link()).toBeUndefined();
    expect(copied).toEqual([]);
});

test("a local-only canvas missing on the first GET can be saved and shared without reopening", async () => {
    let stored = false;
    save = async () => {
        stored = true;
        render("draft");
    };
    respond = ({ method }) => {
        if (!stored) throw new ApiError("画布不存在", { status: 404 });
        expect(method).toBe("POST");
        return enabled("new-draft-share");
    };
    await act(async () => render("draft", true));
    expect(history()).toEqual(["GET draft"]);
    expect(stored).toBe(false);
    expect(text("alert")).toContain("先保存");
    await click("创建并复制链接");
    expect(history()).toEqual(["GET draft", "POST draft"]);
    expect(link()?.value).toBe("http://localhost/share/canvas/new-draft-share");
});

for (const [status, localOnly] of [
    [404, false],
    [500, true],
] as const) {
    test(`share GET ${status} on ${localOnly ? "local" : "existing"} canvas cannot silently become a creation`, async () => {
        save = async () => {
            throw new Error("must not run");
        };
        respond = () => {
            throw new ApiError("无法读取", { status });
        };
        await act(async () => render("A", localOnly));
        expect(text("alert")).toContain("无法读取");
        expect(button("创建并复制链接")).toBeUndefined();
        expect(history()).toEqual(["GET A"]);
    });
}

for (const clipboard of ["denied", "missing"] as const) {
    test(`saving finishes before creating; ${clipboard} clipboard leaves the returned link available for manual copying`, async () => {
        const saved = Promise.withResolvers<void>();
        const receipt = Promise.withResolvers<CanvasShareStatus>();
        save = () => saved.promise;
        respond = ({ method }) => (method === "GET" ? inactive : receipt.promise);
        setClipboard(clipboard === "missing" ? undefined : () => Promise.reject(new Error("clipboard denied")));
        await act(async () => render("A"));
        await click("创建并复制链接");
        expect(text("status")).toContain("正在将画布保存到云端");
        expect(history()).toEqual(["GET A"]);
        await act(async () => saved.resolve());
        expect(text("status")).toContain("正在创建分享链接");
        expect(text("status")).not.toContain("保存到云端");
        expect(history()).toEqual(["GET A", "POST A"]);
        await act(async () => receipt.resolve(enabled("fixture-share")));
        expect(text("alert")).toContain("手动复制");
        const input = link()!;
        expect(input.value).toBe("http://localhost/share/canvas/fixture-share");
        expect(input.readOnly).toBe(true);
        input.select();
        expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe(input.value);
        setClipboard(recordCopy);
        await click("复制分享链接");
        expect(copied).toEqual([input.value]);
        expect(history()).toEqual(["GET A", "POST A"]);
    });
}

test("an unconfirmed POST must be reconciled by GET, even if the first reread fails; no second creation", async () => {
    let reads = 0;
    respond = ({ method }) => {
        if (method === "POST") throw new Error("回执连接中断");
        reads++;
        if (reads === 2) throw new Error("仍然离线");
        return reads === 1 ? inactive : enabled("already-created");
    };
    await act(async () => render("A"));
    await click("创建并复制链接");
    expect(text("alert")).toContain("分享请求未确认");
    expect(text("alert")).toContain("回执连接中断");
    expect(button("创建并复制链接")).toBeUndefined();
    await click("重新读取分享状态");
    expect(text("alert")).toContain("仍然离线");
    expect(button("创建并复制链接")).toBeUndefined();
    await click("重新读取分享状态");
    expect(link()?.value).toBe("http://localhost/share/canvas/already-created");
    expect(history()).toEqual(["GET A", "POST A", "GET A", "GET A"]);
    expect(copied).toEqual([]);
});

for (const phase of ["save", "create"] as const) {
    test(`closing A during ${phase} cannot create, copy or overwrite B with a late A completion`, async () => {
        const saved = Promise.withResolvers<void>();
        const receipt = Promise.withResolvers<CanvasShareStatus>();
        save = () => (phase === "save" ? saved.promise : Promise.resolve());
        respond = ({ method, projectId }) => (projectId === "B" ? enabled("link-for-B") : method === "GET" ? inactive : receipt.promise);
        await act(async () => render("A"));
        await click("创建并复制链接");
        expect(text("status")).toContain(phase === "save" ? "保存到云端" : "正在创建分享链接");
        const request = calls.at(-1)!;
        await act(async () => dialog()!.querySelector<HTMLButtonElement>(".ant-modal-close")!.click());
        expect(dialog()).toBeNull();
        if (phase === "create") expect(request.signal?.aborted).toBe(true);
        await act(async () => render("B"));
        expect(link()?.value).toBe("http://localhost/share/canvas/link-for-B");
        await act(async () => {
            saved.resolve();
            receipt.resolve(enabled("late-link-for-A"));
        });
        expect(link()?.value).toBe("http://localhost/share/canvas/link-for-B");
        expect(text("alert")).toBe("");
        expect(history()).toEqual(phase === "save" ? ["GET A", "GET B"] : ["GET A", "POST A", "GET B"]);
        expect(copied).toEqual([]);
    });
}
