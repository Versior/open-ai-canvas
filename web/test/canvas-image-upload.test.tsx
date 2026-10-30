import { afterAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import type { AxiosAdapter } from "axios";
import { createImageUploadPlaceholder, createFileUploadPlaceholder, interruptFileUpload, readUploadImageSize, uploadNodeType, uploadPercent, uploadPreviewClarity, uploadVeilOpacity } from "../src/lib/canvas/canvas-file-upload";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { isCanvasImageSourceNode } from "../src/lib/canvas/canvas-image-source";
import { CanvasFileUploadContent } from "../src/components/canvas/canvas-file-upload-content";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { canvasThemes } from "../src/lib/canvas-theme";

const file = { name: "photo.png", size: 1234, type: "image/png" };
const placeholder = () => createImageUploadPlaceholder("upload", file, { x: 100, y: 200 }, { width: 1920, height: 1080 });
const read = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8").replace(/\r\n/g, "\n");

let uploadDom: Window | undefined;
const uploadDomOriginals = new Map<string, PropertyDescriptor | undefined>();

async function mountCanvasUpload(initialNodes: CanvasNodeData[] = []) {
    if (!uploadDom) {
        uploadDom = new Window({ url: "http://localhost/" });
        for (const [key, value] of Object.entries({
            window: uploadDom,
            document: uploadDom.document,
            navigator: uploadDom.navigator,
            HTMLElement: uploadDom.HTMLElement,
            Element: uploadDom.Element,
            Node: uploadDom.Node,
            SVGElement: uploadDom.SVGElement,
            getComputedStyle: uploadDom.getComputedStyle.bind(uploadDom),
            IS_REACT_ACT_ENVIRONMENT: true,
        })) {
            uploadDomOriginals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
            Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        }
    }
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { App } = await import("antd");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { useCanvasUpload } = await import("../src/pages/canvas/use-canvas-upload");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const nodesRef = { current: initialNodes };
    let controller!: ReturnType<typeof useCanvasUpload>;
    const setNodes = (next: React.SetStateAction<CanvasNodeData[]>) => {
        nodesRef.current = typeof next === "function" ? next(nodesRef.current) : next;
    };
    const noop = () => {};
    function Harness() {
        controller = useCanvasUpload({
            canvasId: "canvas-upload-test",
            nodesRef,
            selectedNodeIdsRef: { current: new Set() },
            getCanvasCenter: () => ({ x: 0, y: 0 }),
            screenToCanvas: (x, y) => ({ x, y }),
            setNodes,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setContextMenu: noop,
            setDialogNodeId: noop,
        });
        return <input ref={controller.imageInputRef} type="file" onChange={controller.handleImageInputChange} />;
    }
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <App>
                    <Harness />
                </App>
            </QueryClientProvider>,
        ),
    );
    const input = host.querySelector("input")!;
    const change = async (selected?: File) => {
        Object.defineProperty(input, "files", { configurable: true, value: selected ? [selected] : [] });
        await act(async () => controller.handleImageInputChange({ target: input } as React.ChangeEvent<HTMLInputElement>));
    };
    return {
        controller,
        input,
        nodesRef,
        change,
        dispose: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function delayedImageUpload() {
    let markStarted = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        started,
        release,
        adapter: (async (config) => {
            markStarted();
            await gate;
            return {
                config,
                status: 200,
                statusText: "OK",
                headers: {},
                data: { code: 0, data: { resource: { id: "account-a-resource", kind: "image", status: "ready", publicUrl: "", width: 1200, height: 800, size: 5, mimeType: "image/png" } } },
            };
        }) satisfies AxiosAdapter,
    };
}

function installInstantImage() {
    const original = globalThis.Image;
    globalThis.Image = class {
        naturalWidth = 1200;
        naturalHeight = 800;
        async decode() {}
    } as unknown as typeof Image;
    return () => {
        globalThis.Image = original;
    };
}

afterAll(() => {
    uploadDom?.happyDOM.abort();
    for (const [key, value] of uploadDomOriginals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("图片上传占位", () => {
    for (const [width, height] of [
        [1920, 1080],
        [900, 1600],
        [800, 800],
        [4000, 500],
    ]) {
        test(`按真实尺寸保持比例并围绕落点居中 ${width}x${height}`, () => {
            const node = createImageUploadPlaceholder("upload", file, { x: 100, y: 200 }, { width, height });
            expect(node.width / node.height).toBeCloseTo(width / height);
            expect(node.position.x + node.width / 2).toBe(100);
            expect(node.position.y + node.height / 2).toBe(200);
            expect(node.metadata?.naturalWidth).toBe(width);
            expect(node.metadata?.naturalHeight).toBe(height);
            expect(node.metadata?.fileUpload).toBe("uploading");
            expect(node.metadata?.content).toBeUndefined();
            expect(node.metadata?.status).toBeUndefined();
            expect(isCanvasImageSourceNode(node)).toBe(true);
        });
    }

    test("重新打开画布将中断上传转为可重试错误，不修改其他节点", () => {
        const node = placeholder();
        const interrupted = interruptFileUpload(node);
        expect(interrupted.metadata?.fileUpload).toBe("error");
        expect(interrupted.metadata?.errorDetails).toContain("中断");
        expect(interrupted.position).toEqual(node.position);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(interruptFileUpload(interrupted)).toBe(interrupted);
        const ready = { ...node, metadata: { content: "image" } };
        expect(interruptFileUpload(ready)).toBe(ready);
    });

    test("图片解码成功和失败均释放临时 URL，不伪造尺寸", async () => {
        const originalImage = globalThis.Image;
        const create = URL.createObjectURL;
        const revoke = URL.revokeObjectURL;
        const revoked: string[] = [];
        let fail = false;
        try {
            URL.createObjectURL = () => "blob:upload-test";
            URL.revokeObjectURL = (url) => {
                revoked.push(url);
            };
            globalThis.Image = class {
                src = "";
                naturalWidth = 1200;
                naturalHeight = 800;
                async decode() {
                    if (fail) throw new Error("decode failed");
                }
            } as unknown as typeof Image;
            const input = new File(["test"], "test.png", { type: "image/png" });
            expect(await readUploadImageSize(input)).toEqual({ width: 1200, height: 800 });
            fail = true;
            await expect(readUploadImageSize(input)).rejects.toThrow("decode failed");
            expect(revoked).toEqual(["blob:upload-test", "blob:upload-test"]);
        } finally {
            globalThis.Image = originalImage;
            URL.createObjectURL = create;
            URL.revokeObjectURL = revoke;
        }
    });

    test("account switch during image preprocessing aborts the real canvas upload entry", async () => {
        const fixture = await mountCanvasUpload();
        const originalImage = globalThis.Image;
        const createObjectURL = URL.createObjectURL;
        const revokeObjectURL = URL.revokeObjectURL;
        const { apiClient } = await import("../src/services/api/request");
        const adapter = apiClient.defaults.adapter;
        const { getActiveUserScope, setActiveUserScope } = await import("../src/lib/user-scope");
        const originalScope = getActiveUserScope();
        let releaseDecode = () => {};
        let markDecodeStarted = () => {};
        const decodeStarted = new Promise<void>((resolve) => {
            markDecodeStarted = resolve;
        });
        const decodeGate = new Promise<void>((resolve) => {
            releaseDecode = resolve;
        });
        let requests = 0;
        try {
            URL.createObjectURL = () => "blob:canvas-account-scope";
            URL.revokeObjectURL = () => {};
            globalThis.Image = class {
                onload: ((event: Event) => void) | null = null;
                onerror: (() => void) | null = null;
                complete = true;
                naturalWidth = 1200;
                naturalHeight = 800;
                set src(_value: string) {
                    queueMicrotask(() => this.onload?.(new Event("load")));
                }
                async decode() {
                    markDecodeStarted();
                    await decodeGate;
                }
                removeAttribute() {}
            } as unknown as typeof Image;
            apiClient.defaults.adapter = async (config) => {
                requests += 1;
                return {
                    config,
                    status: 200,
                    statusText: "OK",
                    headers: {},
                    data: { code: 0, data: { resource: { id: "wrong-account-resource", kind: "image", status: "ready", publicUrl: "", width: 1200, height: 800, size: 5, mimeType: "image/png" } } },
                };
            };
            setActiveUserScope("account-a");
            const { act } = await import("react");
            let upload!: Promise<string | null>;
            await act(async () => {
                upload = fixture.controller.createFileNode(new File(["image"], "product.png", { type: "image/png" }), { x: 0, y: 0 });
                await decodeStarted;
                setActiveUserScope("account-b");
                releaseDecode();
                await expect(upload).rejects.toMatchObject({ name: "AbortError" });
            });
            expect(requests).toBe(0);
            expect(fixture.nodesRef.current).toEqual([]);
        } finally {
            setActiveUserScope(originalScope);
            apiClient.defaults.adapter = adapter;
            globalThis.Image = originalImage;
            URL.createObjectURL = createObjectURL;
            URL.revokeObjectURL = revokeObjectURL;
            releaseDecode();
            await fixture.dispose();
        }
    });

    test("account switch removes only the new placeholder owned by the cancelled upload", async () => {
        const fixture = await mountCanvasUpload();
        const { apiClient } = await import("../src/services/api/request");
        const adapter = apiClient.defaults.adapter;
        const { getActiveUserScope, setActiveUserScope } = await import("../src/lib/user-scope");
        const originalScope = getActiveUserScope();
        const delayed = delayedImageUpload();
        const restoreImage = installInstantImage();
        try {
            apiClient.defaults.adapter = delayed.adapter;
            setActiveUserScope("account-a");
            const { act } = await import("react");
            await act(async () => {
                const upload = fixture.controller.createFileNode(new File(["image"], "product.png", { type: "image/png" }), { x: 0, y: 0 });
                await delayed.started;
                expect(fixture.nodesRef.current).toHaveLength(1);
                expect(fixture.nodesRef.current[0].metadata?.fileUpload).toBe("uploading");
                setActiveUserScope("account-b");
                delayed.release();
                await expect(upload).rejects.toMatchObject({ name: "AbortError" });
            });
            expect(fixture.nodesRef.current).toEqual([]);
        } finally {
            delayed.release();
            restoreImage();
            setActiveUserScope(originalScope);
            apiClient.defaults.adapter = adapter;
            await fixture.dispose();
        }
    });

    test("account switch restores a replaced node without touching a foreign node with the same id", async () => {
        const original = { ...placeholder(), id: "replace-me", metadata: { content: "account-a-image", status: "success" as const } };
        const fixture = await mountCanvasUpload([original]);
        const { apiClient } = await import("../src/services/api/request");
        const adapter = apiClient.defaults.adapter;
        const { getActiveUserScope, setActiveUserScope } = await import("../src/lib/user-scope");
        const originalScope = getActiveUserScope();
        const delayed = delayedImageUpload();
        let releaseSecond = () => {};
        const restoreImage = installInstantImage();
        try {
            apiClient.defaults.adapter = delayed.adapter;
            setActiveUserScope("account-a");
            const { act } = await import("react");
            await act(async () => {
                const upload = fixture.controller.createFileNode(new File(["replacement"], "replacement.png", { type: "image/png" }), { x: 0, y: 0 }, original.id);
                await delayed.started;
                expect(fixture.nodesRef.current[0].metadata?.fileUpload).toBe("uploading");
                setActiveUserScope("account-b");
                delayed.release();
                await expect(upload).rejects.toMatchObject({ name: "AbortError" });
            });
            expect(fixture.nodesRef.current[0]).toBe(original);

            const second = delayedImageUpload();
            releaseSecond = second.release;
            apiClient.defaults.adapter = second.adapter;
            setActiveUserScope("account-a");
            const foreign = { ...original, metadata: { content: "account-b-image", status: "success" as const } };
            await act(async () => {
                const collisionUpload = fixture.controller.createFileNode(new File(["replacement"], "replacement.png", { type: "image/png" }), { x: 0, y: 0 }, original.id);
                await second.started;
                fixture.nodesRef.current = [foreign];
                setActiveUserScope("account-b");
                second.release();
                await expect(collisionUpload).rejects.toMatchObject({ name: "AbortError" });
            });
            expect(fixture.nodesRef.current[0]).toBe(foreign);
        } finally {
            delayed.release();
            releaseSecond();
            restoreImage();
            setActiveUserScope(originalScope);
            apiClient.defaults.adapter = adapter;
            await fixture.dispose();
        }
    });

    for (const entry of ["input", "drop", "drop-replace", "drop-batch", "assistant"] as const) {
        test(`${entry} UI entry consumes account-switch AbortError`, async () => {
            const original = { ...placeholder(), id: "drop-target", position: { x: -100, y: -100 }, metadata: { content: "original", status: "success" as const } };
            const fixture = await mountCanvasUpload(entry === "drop-replace" ? [original] : []);
            const { apiClient } = await import("../src/services/api/request");
            const adapter = apiClient.defaults.adapter;
            const { getActiveUserScope, setActiveUserScope } = await import("../src/lib/user-scope");
            const originalScope = getActiveUserScope();
            const delayed = delayedImageUpload();
            const restoreImage = installInstantImage();
            const unhandled: unknown[] = [];
            const onUnhandled = (error: unknown) => {
                unhandled.push(error);
            };
            process.on("unhandledRejection", onUnhandled);
            try {
                apiClient.defaults.adapter = delayed.adapter;
                setActiveUserScope("account-a");
                const { act } = await import("react");
                await act(async () => {
                    const file = new File(["image"], "product.png", { type: "image/png" });
                    if (entry === "input") {
                        Object.defineProperty(fixture.input, "files", { configurable: true, value: [file] });
                        fixture.input.dispatchEvent(new uploadDom!.Event("change", { bubbles: true }));
                    } else if (entry === "assistant") {
                        fixture.controller.pasteAssistantImage(file);
                    } else {
                        const files = entry === "drop-batch" ? [file, new File(["image-2"], "second.png", { type: "image/png" })] : [file];
                        fixture.controller.handleDrop({
                            preventDefault: () => {},
                            stopPropagation: () => {},
                            clientX: 0,
                            clientY: 0,
                            target: document.createElement("div"),
                            dataTransfer: { files, types: ["Files"], getData: () => "" },
                        } as unknown as React.DragEvent<HTMLDivElement>);
                    }
                    await delayed.started;
                    setActiveUserScope("account-b");
                    delayed.release();
                    await new Promise((resolve) => setTimeout(resolve, 20));
                });
                expect(unhandled.filter((error) => error instanceof Error && error.name === "AbortError")).toEqual([]);
            } finally {
                process.off("unhandledRejection", onUnhandled);
                delayed.release();
                restoreImage();
                setActiveUserScope(originalScope);
                apiClient.defaults.adapter = adapter;
                await fixture.dispose();
            }
        });
    }

    for (const mode of ["light", "dark"] as const) {
        test(`${mode}主题包含可访问的上传状态、减弱动效和失败重试`, () => {
            const html = renderToStaticMarkup(<CanvasFileUploadContent node={placeholder()} theme={canvasThemes[mode]} reduceMotion />);
            expect(html).toContain("正在上传图片");
            expect(html).toContain('aria-busy="true"');
            expect(html).toContain('data-static="true"');
            expect(html).toContain(canvasThemes[mode].node.fill);
            const error = renderToStaticMarkup(
                <CanvasNodeActionContext.Provider value={{ upload: () => {} }}>
                    <CanvasFileUploadContent node={interruptFileUpload(placeholder())} theme={canvasThemes[mode]} />
                </CanvasNodeActionContext.Provider>,
            );
            expect(error).toContain("重新选择文件");
            expect(error).toContain('aria-busy="false"');
            expect(error).toContain('data-static="true"');
        });
    }

    test("上传先占位再传输，完成替换同一节点，弹窗不等待传输完成", () => {
        const hook = read("pages/canvas/use-canvas-upload.ts");
        const create = hook.slice(hook.indexOf("const createFileNode"), hook.indexOf("const createImageAssetNode"));
        expect(create.indexOf("createFileUploadPlaceholder")).toBeLessThan(create.indexOf("await uploadImage(file,"));
        expect(create).toContain("if (!currentNode)");
        expect(create).toContain("fileUpload: undefined");
        const replace = hook.slice(hook.indexOf("const replaceNodeMedia"), hook.indexOf("const pasteSystemClipboard"));
        expect(replace).toContain("await createFileNode(file, currentNode.position, nodeId)");
        expect(create).toContain("original?.metadata?.content");
        expect(read("components/canvas/canvas-upload-modal.tsx").replace(/\r\n/g, "\n")).toContain("onClose();\n            await pendingUpload;");
        expect(read("styles/globals.css")).toContain("prefers-reduced-motion: reduce");
    });
});

describe("延迟图片上传目标", () => {
    const deferredRequest = (controller: unknown) =>
        (
            controller as {
                requestDeferredImageUpload: (createTargetNode: () => string | undefined) => void;
            }
        ).requestDeferredImageUpload;

    test("打开选择器时不创建节点，取消选择也不调用创建回调", async () => {
        const fixture = await mountCanvasUpload();
        let clicks = 0;
        let creates = 0;
        fixture.input.addEventListener("click", () => {
            clicks += 1;
        });
        try {
            deferredRequest(fixture.controller)(() => {
                creates += 1;
                return undefined;
            });
            expect(fixture.input.accept).toBe("image/*");
            expect(clicks).toBe(1);
            expect(creates).toBe(0);
            expect(fixture.nodesRef.current).toEqual([]);
        } finally {
            await fixture.dispose();
        }
    });

    test("非图片和不支持的文件不创建延迟目标", async () => {
        const fixture = await mountCanvasUpload();
        let creates = 0;
        try {
            for (const file of [new File(["note"], "note.txt", { type: "text/plain" }), new File(["data"], "archive.bin", { type: "application/octet-stream" })]) {
                deferredRequest(fixture.controller)(() => {
                    creates += 1;
                    return undefined;
                });
                await fixture.change(file);
            }
            expect(creates).toBe(0);
            expect(fixture.nodesRef.current).toEqual([]);
        } finally {
            await fixture.dispose();
        }
    });

    test("合法图片只在 change 后创建一次，undefined 结果不上传且不会清掉后续目标", async () => {
        const fixture = await mountCanvasUpload();
        const image = new File(["image"], "product.png", { type: "image/png" });
        let firstCreates = 0;
        let secondCreates = 0;
        try {
            deferredRequest(fixture.controller)(() => {
                firstCreates += 1;
                deferredRequest(fixture.controller)(() => {
                    secondCreates += 1;
                    return undefined;
                });
                return undefined;
            });
            await fixture.change(image);
            expect(firstCreates).toBe(1);
            expect(secondCreates).toBe(0);
            expect(fixture.nodesRef.current).toEqual([]);

            await fixture.change(image);
            expect(firstCreates).toBe(1);
            expect(secondCreates).toBe(1);
            expect(fixture.nodesRef.current).toEqual([]);
        } finally {
            await fixture.dispose();
        }
    });
});

test("真实进度与遮罩浓度反向关联，不生成未知进度", () => {
    expect(uploadPercent(20, 100)).toBe(20);
    expect(uploadPercent(150, 100)).toBe(100);
    expect(uploadPercent(0, 0)).toBeUndefined();
    expect(uploadPercent(NaN, 100)).toBeUndefined();
    expect(uploadVeilOpacity(0)).toBe(1);
    expect(uploadVeilOpacity(50)).toBeCloseTo(0.55);
    expect(uploadVeilOpacity(100)).toBeCloseTo(0.1);
    // 清晰原图随进度淡入：起点完全磨砂，前段慢后段快，传完仍保留一点磨砂等待保存。
    expect(uploadPreviewClarity(undefined)).toBe(0);
    expect(uploadPreviewClarity(0)).toBe(0);
    expect(uploadPreviewClarity(50)).toBeLessThan(0.3);
    expect(uploadPreviewClarity(100)).toBeCloseTo(0.88);
    expect(uploadPreviewClarity(150)).toBeCloseTo(0.88);
});

test("统一识别图片、视频、音频、纯文本文件，不误收 PDF 或 Word", () => {
    for (const [name, type, expected] of [
        ["image.png", "image/png", CanvasNodeType.Image],
        ["video.mp4", "video/mp4", CanvasNodeType.Video],
        ["sound.ogg", "audio/ogg", CanvasNodeType.Audio],
        ["sound.wav", "", CanvasNodeType.Audio],
        ["note.md", "", CanvasNodeType.Text],
        ["note.txt", "text/plain", CanvasNodeType.Text],
        ["document.pdf", "application/pdf", null],
        ["document.docx", "", null],
    ] as const)
        expect(uploadNodeType({ name, type })).toBe(expected);
});

test("音频与文本在传输前就有独立占位，可重试且不带模型生成状态", async () => {
    for (const [name, type, expected] of [
        ["voice.mp3", "audio/mpeg", CanvasNodeType.Audio],
        ["note.md", "text/markdown", CanvasNodeType.Text],
    ] as const) {
        const node = await createFileUploadPlaceholder("file", new File(["content"], name, { type }), { x: 0, y: 0 });
        expect(node.type).toBe(expected);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(node.metadata?.content).toBeUndefined();
        expect(node.metadata?.status).toBeUndefined();
        expect(interruptFileUpload(node).metadata?.fileUpload).toBe("error");
    }
});

test("所有资源渲染真实百分比，100% 仍等待保存，磨砂渐淡但文案不淡出", () => {
    for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text]) {
        const node = { ...placeholder(), type, metadata: { fileUpload: "uploading" as const, fileUploadProgress: 50 } };
        const html = renderToStaticMarkup(<CanvasFileUploadContent node={node} theme={canvasThemes.light} />);
        expect(html).toContain("已上传 50%");
        expect(html).toContain("opacity:0.55");
        expect(html).toContain('aria-valuenow="50"');
        const complete = renderToStaticMarkup(<CanvasFileUploadContent node={{ ...node, metadata: { ...node.metadata, fileUploadProgress: 100 } }} theme={canvasThemes.dark} />);
        expect(complete).toContain("文件已传输，正在保存与处理");
        expect(complete).toContain('aria-busy="true"');
    }
});

test("短剧关联顶栏保留电商模式和专业入口", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { MemoryRouter } = await import("react-router");
    const { CanvasTopBar } = await import("../src/pages/canvas/canvas-project-top-bar");
    const noop = () => {};
    for (const workspaceMode of ["simple", "professional"] as const) {
        const html = renderToStaticMarkup(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <CanvasTopBar
                        ecommerce
                        workspaceMode={workspaceMode}
                        onWorkspaceModeChange={noop}
                        view="canvas"
                        onViewChange={noop}
                        title="电商画布"
                        titleDraft="电商画布"
                        isTitleEditing={false}
                        onTitleDraftChange={noop}
                        onStartTitleEditing={noop}
                        onFinishTitleEditing={noop}
                        onCancelTitleEditing={noop}
                        canUndo={false}
                        canRedo={false}
                        onCreateProject={noop}
                        onDeleteProject={noop}
                        onSave={noop}
                        onImportImage={noop}
                        onImportLibTV={noop}
                        onImportTapNow={noop}
                        onUndo={noop}
                        onRedo={noop}
                        onShare={noop}
                        shortcutRequestNonce={0}
                        onOpenSearch={noop}
                        onOpenModelLibrary={noop}
                        onEnterFocusMode={noop}
                        projectContext={{ projectId: "demo drama", projectName: "短剧示例", kind: "drama", nodeCount: 3, selectedCount: 0, chapterLabel: "", shotLabel: "" }}
                    />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        expect(html).toContain('href="/projects/demo%20drama"');
        expect(html).toContain("打开短剧制作台：短剧示例");
        expect(html).toContain(workspaceMode === "simple" ? 'aria-label="快捷创作，切换到专业画布"' : 'aria-label="专业画布，返回快捷创作"');
        expect(html.includes('aria-label="管理模特库"')).toBe(workspaceMode === "professional");
    }
});
