import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Dispatch, SetStateAction } from "react";

import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

let dom: Window | undefined;
const originals = new Map<string, PropertyDescriptor | undefined>();

type MediaToolsController = {
    createImageReversePromptNodes: (node: CanvasNodeData) => void;
};

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
        SVGElement: dom.SVGElement,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
}

async function mountMediaTools(source: CanvasNodeData) {
    installDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { App } = await import("antd");
    const { useCanvasMediaTools } = await import("../src/pages/canvas/use-canvas-media-tools");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const nodesRef = { current: [source] };
    const connectionsRef = { current: [] as CanvasConnection[] };
    const setNodes: Dispatch<SetStateAction<CanvasNodeData[]>> = (action) => {
        nodesRef.current = typeof action === "function" ? action(nodesRef.current) : action;
    };
    const setConnections: Dispatch<SetStateAction<CanvasConnection[]>> = (action) => {
        connectionsRef.current = typeof action === "function" ? action(connectionsRef.current) : action;
    };
    const noop = () => {};
    let controller!: MediaToolsController;

    function Harness() {
        controller = useCanvasMediaTools({
            projectId: "reverse-prompt-test",
            nodesRef,
            connectionsRef,
            selectedNodeIdsRef: { current: new Set() },
            setNodes,
            setConnections,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setDialogNodeId: noop,
            setContextMenu: noop,
            setHoveredNodeId: noop,
            setToolbarNodeId: noop,
            setRunningNodeId: noop,
            startUploadStatus: () => ({ update: noop, done: noop, fail: noop }),
            startGenerationRequest: () => new AbortController(),
            finishGenerationRequest: noop,
            bindGenerationTask: noop,
            applyGenerationTaskResult: async () => {},
        });
        return null;
    }

    await act(async () =>
        root.render(
            <App>
                <Harness />
            </App>,
        ),
    );
    return {
        controller,
        nodesRef,
        connectionsRef,
        dispose: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function sourceNode(type: CanvasNodeType.Image | CanvasNodeType.Video): CanvasNodeData {
    return {
        id: `${type}-source`,
        type,
        title: type === CanvasNodeType.Image ? "参考图" : "参考视频",
        position: { x: 100, y: 200 },
        width: 640,
        height: 360,
        metadata: { content: type === CanvasNodeType.Image ? "blob:image" : "blob:video" },
    };
}

afterAll(() => {
    dom?.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("媒体反推节点", () => {
    test("图片继续使用图片引用进入反推链路", async () => {
        const source = sourceNode(CanvasNodeType.Image);
        const fixture = await mountMediaTools(source);
        try {
            fixture.controller.createImageReversePromptNodes(source);
            const result = fixture.nodesRef.current.at(-1)!;
            expect(result.metadata?.composerContent).toBe("参考图片：@图片1\n任务说明：@文本1");
            expect(fixture.connectionsRef.current.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([
                [source.id, result.id],
                [fixture.nodesRef.current[1].id, result.id],
            ]);
        } finally {
            await fixture.dispose();
        }
    }, 15_000);

    test("视频使用视频引用进入拆解链路", async () => {
        const source = sourceNode(CanvasNodeType.Video);
        const fixture = await mountMediaTools(source);
        try {
            fixture.controller.createImageReversePromptNodes(source);
            const result = fixture.nodesRef.current.at(-1)!;
            expect(fixture.nodesRef.current).toHaveLength(3);
            expect(result.metadata?.composerContent).toBe("参考视频：@视频1\n任务说明：@文本1");
            expect(fixture.connectionsRef.current.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([
                [source.id, result.id],
                [fixture.nodesRef.current[1].id, result.id],
            ]);
        } finally {
            await fixture.dispose();
        }
    }, 15_000);
    test("仅有 storageKey 的视频仍作为真实视频引用进入拆解链路", async () => {
        const source = sourceNode(CanvasNodeType.Video);
        source.metadata = { storageKey: "video:stored-only", mimeType: "video/mp4" };
        const fixture = await mountMediaTools(source);
        try {
            fixture.controller.createImageReversePromptNodes(source);
            const result = fixture.nodesRef.current.at(-1)!;
            const context = buildNodeGenerationContext(result.id, fixture.nodesRef.current, fixture.connectionsRef.current, result.metadata?.composerContent || "", []);

            expect(result.metadata?.composerContent).toBe("参考视频：@视频1\n任务说明：@文本1");
            expect(context.referenceVideos).toEqual([expect.objectContaining({ id: source.id, url: "", storageKey: "video:stored-only" })]);
        } finally {
            await fixture.dispose();
        }
    }, 15_000);
});
