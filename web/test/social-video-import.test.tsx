import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import type { CanvasNodeData } from "../src/types/canvas";
import { CanvasNodeType } from "../src/types/canvas";

let dom: Window | undefined;
const originals = new Map<string, PropertyDescriptor | undefined>();

function installDom() {
    if (dom) return;
    dom = new Window({ url: "http://localhost/" });
    for (const [key, value] of Object.entries({
        window: dom,
        document: dom.document,
        navigator: dom.navigator,
        HTMLElement: dom.HTMLElement,
        Element: dom.Element,
        Node: dom.Node,
        CustomEvent: dom.CustomEvent,
        SVGElement: dom.SVGElement,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
}

async function mountCanvasUpload(initial: { canvasId?: string; domainProjectId?: string } = {}) {
    installDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { App } = await import("antd");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { useCanvasUpload } = await import("../src/pages/canvas/use-canvas-upload");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const queryClient = new QueryClient();
    const context = { canvasId: initial.canvasId || "social-video-test", domainProjectId: initial.domainProjectId || "project-1" };
    const nodesRef = { current: [] as CanvasNodeData[] };
    let controller!: ReturnType<typeof useCanvasUpload>;
    const setNodes = (next: React.SetStateAction<CanvasNodeData[]>) => {
        nodesRef.current = typeof next === "function" ? next(nodesRef.current) : next;
    };
    const noop = () => {};
    function Harness() {
        controller = useCanvasUpload({
            canvasId: context.canvasId,
            domainProjectId: context.domainProjectId,
            nodesRef,
            selectedNodeIdsRef: { current: new Set() },
            getCanvasCenter: () => ({ x: 400, y: 300 }),
            screenToCanvas: (x, y) => ({ x, y }),
            setNodes,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setContextMenu: noop,
            setDialogNodeId: noop,
        });
        return null;
    }
    const render = () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <App>
                    <Harness />
                </App>
            </QueryClientProvider>,
        );
    await act(async () => render());
    return {
        get controller() {
            return controller;
        },
        nodesRef,
        updateContext: async (next: Partial<typeof context>) => {
            Object.assign(context, next);
            await act(async () => render());
        },
        dispose: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function clipboard(text: string) {
    return {
        clipboardData: {
            items: [],
            getData: (type: string) => (type === "text/plain" ? text : ""),
        },
    } as unknown as ClipboardEvent;
}

async function paste(controller: { pasteSystemClipboard: (position?: { x: number; y: number }, event?: ClipboardEvent | null) => Promise<boolean> | boolean }, text: string, position?: { x: number; y: number }) {
    const { act } = await import("react");
    let handled = false;
    await act(async () => {
        handled = await controller.pasteSystemClipboard(position, clipboard(text));
    });
    return handled;
}
function task(status: "queued" | "succeeded" | "failed", resultJson?: string, error?: string) {
    return {
        id: "social-task-1",
        type: "social_video_import",
        status,
        prompt: "https://v.douyin.com/abc123/",
        resultJson,
        error,
        attempts: 1,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
    };
}

const resultObject = {
    platform: "douyin",
    canonicalId: "video-123",
    title: "秋季风衣穿搭",
    resourceId: "social-resource-1",
    width: 1080,
    height: 1920,
    durationMs: 15300,
    mimeType: "video/mp4",
    size: 2048,
};
const result = JSON.stringify(resultObject);

function resource() {
    return {
        id: "social-resource-1",
        userId: "account-a",
        kind: "video",
        status: "ready",
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: "social-resource-1.mp4",
        publicUrl: "",
        mimeType: "video/mp4",
        size: 2048,
        width: 1080,
        height: 1920,
        durationMs: 15300,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
    };
}

function ok(config: InternalAxiosRequestConfig, data: unknown) {
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "ok" } };
}

async function withAdapter(adapter: AxiosAdapter, run: () => Promise<void>) {
    const { apiClient } = await import("../src/services/api/request");
    const previous = apiClient.defaults.adapter;
    apiClient.defaults.adapter = adapter;
    try {
        await run();
    } finally {
        apiClient.defaults.adapter = previous;
    }
}

async function withScope(scope: string, run: (setScope: (scope: string) => void) => Promise<void>) {
    const { getActiveUserScope, setActiveUserScope } = await import("../src/lib/user-scope");
    const previous = getActiveUserScope();
    setActiveUserScope(scope);
    try {
        await run(setActiveUserScope);
    } finally {
        setActiveUserScope(previous);
    }
}

describe("抖音/TikTok 分享链接粘贴导入", () => {
    test("链接规则与后端单视频入口一致并返回归一化 URL", async () => {
        const { socialVideoURLFromText } = await import("../src/services/api/social-video");
        for (const [input, expected] of [
            ["https://V.DOUYIN.COM.:443/abc123/", "https://v.douyin.com/abc123/"],
            ["https://www.douyin.com/video/7391234567890123457", "https://www.douyin.com/video/7391234567890123457"],
            ["https://m.douyin.com/share/video/7391234567890123457/?from=share", "https://m.douyin.com/share/video/7391234567890123457/?from=share"],
            ["https://www.tiktok.com/@shop/video/123", "https://www.tiktok.com/@shop/video/123"],
            ["https://tiktok.com/video/123/", "https://tiktok.com/video/123/"],
            ["https://vt.tiktok.com/abc/", "https://vt.tiktok.com/abc/"],
        ]) {
            expect(socialVideoURLFromText(input)).toBe(expected);
        }
        for (const input of [
            "http://www.douyin.com/video/123",
            "HTTPS://www.douyin.com/video/123",
            "https://user@www.douyin.com/video/123",
            "https://www.douyin.com:444/video/123",
            "https://www.douyin.com/video/123#part",
            "https://www.douyin.com/discover",
            "https://www.douyin.com/@shop/video/123",
            "https://v.douyin.com/",
            "https://www.tiktok.com/@shop/video/not-number",
            "https://www.douyin.com/video/123abc",
        ]) {
            expect(socialVideoURLFromText(input)).toBeNull();
        }
    });
    test("单个平台链接创建导入任务并直接生成持久化 Video 节点", async () => {
        const fixture = await mountCanvasUpload();
        const requests: InternalAxiosRequestConfig[] = [];
        await withScope("account-a", async () =>
            withAdapter(
                async (config) => {
                    requests.push(config);
                    if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                    if (config.method === "get" && config.url === "/tasks/social-task-1") return ok(config, task("succeeded", result));
                    if (config.method === "get" && config.url === "/resources/social-resource-1") return ok(config, { resource: resource() });
                    throw new Error(`unexpected request: ${config.method} ${config.url}`);
                },
                async () => {
                    try {
                        const handled = await paste(fixture.controller, "7.31 复制打开抖音 https://V.DOUYIN.COM.:443/abc123/ 看同款", { x: 20, y: 40 });
                        expect(handled).toBe(true);
                        expect(requests[0]?.url).toBe("/social-video/imports");
                        expect(JSON.parse(String(requests[0]?.data))).toEqual({ url: "https://v.douyin.com/abc123/", projectId: "project-1" });
                        expect(String(requests[0]?.headers?.["X-Idempotency-Key"] || "")).not.toBe("");
                        expect(requests.some((request) => request.method === "post" && request.url === "/resources")).toBe(false);
                        expect(fixture.nodesRef.current).toHaveLength(1);
                        expect(fixture.nodesRef.current[0]).toMatchObject({
                            type: CanvasNodeType.Video,
                            title: "秋季风衣穿搭",
                            position: { x: 20, y: 40 },
                            metadata: {
                                content: "/api/resources/social-resource-1/file",
                                storageKey: "resource:social-resource-1",
                                status: "success",
                                naturalWidth: 1080,
                                naturalHeight: 1920,
                                durationMs: 15300,
                                bytes: 2048,
                                mimeType: "video/mp4",
                            },
                        });
                    } finally {
                        await fixture.dispose();
                    }
                },
            ),
        );
    });

    test("普通 URL 或多个平台 URL 保持普通文本粘贴，不发导入任务", async () => {
        for (const text of [
            "https://example.com/video/1",
            "https://v.douyin.com/one/ https://vm.tiktok.com/two/",
            "https://v.douyin.com/one/ https://example.com/context",
            "https://evil.douyin.com/video/123",
            "http://www.douyin.com/video/123",
            "HTTPS://www.douyin.com/video/123",
            "https://www.douyin.com/discover",
        ]) {
            const fixture = await mountCanvasUpload();
            let requests = 0;
            await withAdapter(
                async (config) => {
                    requests += 1;
                    throw new Error(`unexpected request: ${config.method} ${config.url}`);
                },
                async () => {
                    try {
                        expect(await paste(fixture.controller, text)).toBe(true);
                        expect(requests).toBe(0);
                        expect(fixture.nodesRef.current).toHaveLength(1);
                        expect(fixture.nodesRef.current[0].type).toBe(CanvasNodeType.Text);
                        expect(fixture.nodesRef.current[0].metadata?.content).toBe(text);
                    } finally {
                        await fixture.dispose();
                    }
                },
            );
        }
    });

    test("相同用户、画布、项目和归一化链接的在途导入只创建一个任务和节点", async () => {
        const fixture = await mountCanvasUpload();
        let release = () => {};
        let markQueryStarted = () => {};
        const queryStarted = new Promise<void>((resolve) => (markQueryStarted = resolve));
        const gate = new Promise<void>((resolve) => (release = resolve));
        let postCount = 0;
        await withScope("dedupe-account", async () =>
            withAdapter(
                async (config) => {
                    if (config.method === "post" && config.url === "/social-video/imports") {
                        postCount += 1;
                        return ok(config, task("queued"));
                    }
                    if (config.method === "get" && config.url === "/tasks/social-task-1") {
                        markQueryStarted();
                        await gate;
                        return ok(config, task("succeeded", result));
                    }
                    if (config.method === "get" && config.url === "/resources/social-resource-1") return ok(config, { resource: resource() });
                    throw new Error(`unexpected request: ${config.method} ${config.url}`);
                },
                async () => {
                    try {
                        const { act } = await import("react");
                        let first!: Promise<boolean> | boolean;
                        let second!: Promise<boolean> | boolean;
                        await act(async () => {
                            first = fixture.controller.pasteSystemClipboard(undefined, clipboard("https://V.DOUYIN.COM.:443/abc123/"));
                            second = fixture.controller.pasteSystemClipboard(undefined, clipboard("https://v.douyin.com/abc123/"));
                            await queryStarted;
                        });
                        release();
                        await act(async () => {
                            expect(await Promise.all([first, second])).toEqual([true, true]);
                        });
                        expect(postCount).toBe(1);
                        expect(fixture.nodesRef.current).toHaveLength(1);
                    } finally {
                        release();
                        await fixture.dispose();
                    }
                },
            ),
        );
    });

    test("画布或项目变化会取消旧导入且不会写入新上下文", async () => {
        for (const next of [{ canvasId: "canvas-b" }, { domainProjectId: "project-b" }]) {
            const fixture = await mountCanvasUpload({ canvasId: "canvas-a", domainProjectId: "project-a" });
            let release = () => {};
            let markQueryStarted = () => {};
            const queryStarted = new Promise<void>((resolve) => (markQueryStarted = resolve));
            const gate = new Promise<void>((resolve) => (release = resolve));
            await withScope(`context-${Object.keys(next)[0]}`, async () =>
                withAdapter(
                    async (config) => {
                        if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                        if (config.method === "get" && config.url === "/tasks/social-task-1") {
                            markQueryStarted();
                            await gate;
                            return ok(config, task("succeeded", result));
                        }
                        if (config.method === "get" && config.url === "/resources/social-resource-1") return ok(config, { resource: resource() });
                        throw new Error(`unexpected request: ${config.method} ${config.url}`);
                    },
                    async () => {
                        try {
                            const { act } = await import("react");
                            let pending!: Promise<boolean> | boolean;
                            await act(async () => {
                                pending = fixture.controller.pasteSystemClipboard(undefined, clipboard("https://v.douyin.com/abc123/"));
                                await queryStarted;
                            });
                            await fixture.updateContext(next);
                            release();
                            await act(async () => {
                                expect(await pending).toBe(true);
                            });
                            expect(fixture.nodesRef.current).toEqual([]);
                        } finally {
                            release();
                            await fixture.dispose();
                        }
                    },
                ),
            );
        }
    });

    test("资源尺寸异常时回退到已严格校验的任务尺寸", async () => {
        const fixture = await mountCanvasUpload();
        await withScope("resource-dimension-account", async () =>
            withAdapter(
                async (config) => {
                    if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                    if (config.method === "get" && config.url === "/tasks/social-task-1") return ok(config, task("succeeded", result));
                    if (config.method === "get" && config.url === "/resources/social-resource-1") return ok(config, { resource: { ...resource(), width: -1, height: 720 } });
                    throw new Error(`unexpected request: ${config.method} ${config.url}`);
                },
                async () => {
                    try {
                        expect(await paste(fixture.controller, "https://v.douyin.com/abc123/")).toBe(true);
                        expect(fixture.nodesRef.current).toHaveLength(1);
                        expect(fixture.nodesRef.current[0].metadata).toMatchObject({ naturalWidth: 1080, naturalHeight: 1920 });
                    } finally {
                        await fixture.dispose();
                    }
                },
            ),
        );
    });

    test("拒绝身份、MIME 或关键数值不可信的资源", async () => {
        const cases = [{ id: "other-resource" }, { mimeType: "video/webm" }, { mimeType: "audio/mpeg" }, { size: 0 }, { durationMs: 180_001 }];
        for (const [index, override] of cases.entries()) {
            const fixture = await mountCanvasUpload();
            await withScope(`resource-boundary-${index}`, async () =>
                withAdapter(
                    async (config) => {
                        if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                        if (config.method === "get" && config.url === "/tasks/social-task-1") return ok(config, task("succeeded", result));
                        if (config.method === "get" && config.url === "/resources/social-resource-1") return ok(config, { resource: { ...resource(), ...override } });
                        throw new Error(`unexpected request: ${config.method} ${config.url}`);
                    },
                    async () => {
                        try {
                            expect(await paste(fixture.controller, "https://v.douyin.com/abc123/")).toBe(true);
                            expect(fixture.nodesRef.current).toEqual([]);
                            expect(fixture.controller.uploadStatus).toMatchObject({ error: true });
                        } finally {
                            await fixture.dispose();
                        }
                    },
                ),
            );
        }
    });

    test("任务失败显示明确进度错误且不创建节点", async () => {
        const fixture = await mountCanvasUpload();
        await withAdapter(
            async (config) => {
                if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                if (config.method === "get" && config.url === "/tasks/social-task-1") return ok(config, task("failed", undefined, "平台视频下载失败"));
                throw new Error(`unexpected request: ${config.method} ${config.url}`);
            },
            async () => {
                try {
                    expect(await paste(fixture.controller, "https://www.tiktok.com/@shop/video/123")).toBe(true);
                    expect(fixture.nodesRef.current).toEqual([]);
                    expect(fixture.controller.uploadStatus).toMatchObject({ error: true });
                    expect(fixture.controller.uploadStatus?.detail).toContain("平台视频下载失败");
                } finally {
                    await fixture.dispose();
                }
            },
        );
    });

    test("账号切换后丢弃旧账号任务结果", async () => {
        const fixture = await mountCanvasUpload();
        let release = () => {};
        let markQueryStarted = () => {};
        const queryStarted = new Promise<void>((resolve) => (markQueryStarted = resolve));
        const gate = new Promise<void>((resolve) => (release = resolve));
        await withScope("account-a", async (setScope) =>
            withAdapter(
                async (config) => {
                    if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                    if (config.method === "get" && config.url === "/tasks/social-task-1") {
                        markQueryStarted();
                        await gate;
                        return ok(config, task("succeeded", result));
                    }
                    if (config.method === "get" && config.url === "/resources/social-resource-1") return ok(config, { resource: resource() });
                    throw new Error(`unexpected request: ${config.method} ${config.url}`);
                },
                async () => {
                    try {
                        const { act } = await import("react");
                        let pending!: Promise<boolean> | boolean;
                        await act(async () => {
                            pending = fixture.controller.pasteSystemClipboard(undefined, clipboard("https://v.douyin.com/abc123/"));
                            await queryStarted;
                        });
                        setScope("account-b");
                        release();
                        let handled = false;
                        await act(async () => {
                            handled = await pending;
                        });
                        expect(handled).toBe(true);
                        expect(fixture.nodesRef.current).toEqual([]);
                    } finally {
                        release();
                        await fixture.dispose();
                    }
                },
            ),
        );
    });

    test("hook 卸载会 Abort 等待且不写回节点", async () => {
        const fixture = await mountCanvasUpload();
        let release = () => {};
        let markQueryStarted = () => {};
        const queryStarted = new Promise<void>((resolve) => (markQueryStarted = resolve));
        const gate = new Promise<void>((resolve) => (release = resolve));
        await withAdapter(
            async (config) => {
                if (config.method === "post" && config.url === "/social-video/imports") return ok(config, task("queued"));
                if (config.method === "get" && config.url === "/tasks/social-task-1") {
                    markQueryStarted();
                    await gate;
                    return ok(config, task("succeeded", result));
                }
                throw new Error(`unexpected request: ${config.method} ${config.url}`);
            },
            async () => {
                const { act } = await import("react");
                let pending!: Promise<boolean> | boolean;
                await act(async () => {
                    pending = fixture.controller.pasteSystemClipboard(undefined, clipboard("https://v.douyin.com/abc123/"));
                    await queryStarted;
                });
                await fixture.dispose();
                release();
                expect(await pending).toBe(true);
                expect(fixture.nodesRef.current).toEqual([]);
            },
        );
    });
});

afterAll(() => {
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});
