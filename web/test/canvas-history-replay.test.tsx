import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { normalizeCanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { stampCanvasNodeChanges } from "@/lib/canvas/canvas-node-timestamps";
import { useCanvasHistory, type CanvasHistorySnapshot } from "@/pages/canvas/use-canvas-history";
import { CanvasNodeType } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/test" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useLayoutEffect, useMemo, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const noop = () => {};
const waitForHistory = () =>
    act(async () => {
        await Bun.sleep(210);
    });

test("拖动撤销比计时器晚提交时仍保留重做；下一笔真实编辑才清空重做分支", async () => {
    const initial: CanvasHistorySnapshot = {
        nodes: [{ id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 256, height: 144, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        canvasAppearance: { mode: "light" },
        backgroundMode: "dots",
        showImageInfo: false,
    };
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    let history!: ReturnType<typeof useCanvasHistory>;
    let write!: ReturnType<typeof createCanvasStateWriter<typeof initial.nodes>>;
    let snapshot = initial;
    function Harness() {
        const [nodes, publish] = useState(initial.nodes);
        const nodesRef = useRef(nodes);
        write = useMemo(() => createCanvasStateWriter(nodesRef, publish, stampCanvasNodeChanges), []);
        const [canvasAppearance, setAppearance] = useState(initial.canvasAppearance);
        snapshot = { ...initial, nodes, canvasAppearance };
        history = useCanvasHistory({
            ...snapshot,
            projectLoaded: true,
            restoreHistoryNodes: (value) => {
                write(value);
                return nodesRef.current;
            },
            restoreHistoryAppearance: (value) => {
                const normalized = normalizeCanvasAppearance(value, "light");
                setAppearance(normalized);
                return normalized;
            },
            setConnections: noop,
            setChatSessions: noop,
            setActiveChatId: noop,
            setBackgroundMode: noop,
            setShowImageInfo: noop,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setContextMenu: noop,
        });
        useLayoutEffect(() => history.resetHistory(initial), [history.resetHistory]);
        return <span>{nodes[0].position.x}</span>;
    }
    const move = (x: number) => act(() => write((nodes) => nodes.map((node) => ({ ...node, position: { x, y: 0 } }))));
    try {
        await act(async () => root.render(<Harness />));
        await move(96);
        await waitForHistory();
        expect(history.historyState.canUndo).toBe(true);
        await act(async () => {
            history.undoCanvas();
            await Bun.sleep(8);
        });
        expect(host.textContent).toBe("0");
        await waitForHistory();
        expect(history.historyState.canRedo).toBe(true);
        await act(async () => history.redoCanvas());
        expect(host.textContent).toBe("96");
        await act(async () => {
            history.undoCanvas();
            history.redoCanvas();
            history.undoCanvas();
            write((nodes) => nodes.map((node) => ({ ...node, position: { x: 48, y: 0 } })));
        });
        expect(host.textContent).toBe("48");
        await waitForHistory();
        expect(history.historyState.canRedo).toBe(false);
        await act(async () => history.undoCanvas());
        expect(host.textContent).toBe("0");
        await move(72);
        await act(async () => history.resetHistory(snapshot));
        await waitForHistory();
        expect(history.historyState).toEqual({ canUndo: false, canRedo: false });
        await act(async () => history.undoCanvas());
        expect(host.textContent).toBe("72");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
