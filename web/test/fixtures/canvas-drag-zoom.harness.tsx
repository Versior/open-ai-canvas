import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasHistorySnapshot } from "@/pages/canvas/use-canvas-history";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/test" });
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback);
        return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const { act, useLayoutEffect, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasViewport } = await import("@/components/canvas/canvas-viewport");
const { useCanvasSelectionController } = await import("@/pages/canvas/use-canvas-selection-controller");
const { useCanvasHistory } = await import("@/pages/canvas/use-canvas-history");
const { subscribeCanvasNodeDragPreview, subscribeCanvasSelectionPreview, observeCanvasGestureActive, setCanvasGestureActive, applyCanvasLiveViewport, applyCanvasNodeDragPreview, prepareCanvasNodeLayer } = await import("@/lib/canvas/canvas-live-viewport");
const { CanvasGestureRenderWindow } = await import("@/pages/canvas/canvas-gesture-render-window");
const { buildCanvasSpatialIndex, canvasNodeBounds } = await import("@/lib/canvas/canvas-spatial-index");
const { CanvasNodeType } = await import("@/types/canvas");
const noop = () => {};

test("部分选区只平移共享活动层；不同叠序的随动节点和同层锁定节点分别补偿，媒体不换父元素", async () => {
    const container = document.createElement("div");
    const layer = document.createElement("div");
    layer.dataset.canvasNodeLayer = "";
    container.append(layer);
    document.body.append(container);
    const nodes = Array.from({ length: 100 }, (_, index) => {
        const node = document.createElement("div");
        node.dataset.nodeId = String(index);
        if (index <= 40 && index !== 20) node.slot = "canvas-active";
        layer.append(node);
        return node;
    });
    try {
        prepareCanvasNodeLayer(layer);
        const nodeIds = new Set(nodes.slice(0, 40).map((node) => node.dataset.nodeId!));
        applyCanvasNodeDragPreview(container, { nodeIds, x: 36, y: -12 });
        expect(layer.style.translate).toBe("");
        const group = layer.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="canvas-active"]')!.parentElement!;
        expect(group.style.translate).toBe("36px -12px");
        expect(nodes[0].style.translate).toBe("");
        expect(nodes[20].style.translate).toBe("36px -12px");
        expect(nodes[40].style.translate).toBe("-36px 12px");
        expect(nodes[41].style.translate).toBe("");
        expect(nodes.every((node) => node.parentElement === layer)).toBe(true);
        nodes[20].slot = "canvas-active";
        await dom.happyDOM.waitUntilComplete();
        expect(nodes[20].style.translate).toBe("");
        applyCanvasNodeDragPreview(container, null);
        expect(group.style.translate).toBe("");
        expect(nodes[40].style.translate).toBe("");
    } finally {
        applyCanvasNodeDragPreview(container, null);
        container.remove();
    }
});

test("千个已选节点只移动共同的层；拖动中补挂的选中节点跟随，未选节点保持原位", async () => {
    const container = document.createElement("div");
    const layer = document.createElement("div");
    layer.dataset.canvasNodeLayer = "";
    container.append(layer);
    document.body.append(container);
    const nodeIds = new Set(Array.from({ length: 1001 }, (_, index) => String(index)));
    const mount = (id: string) => {
        const node = document.createElement("div");
        node.dataset.nodeId = id;
        layer.append(node);
        return node;
    };
    const mounted = Array.from(nodeIds).slice(0, 1000).map(mount);
    const move = (x: number) => applyCanvasNodeDragPreview(container, { x, y: 20, nodeIds });
    try {
        move(10);
        move(30);
        expect(layer.style.translate).toBe("30px 20px");
        expect(mounted.filter((node) => node.style.translate)).toHaveLength(0);
        const lateSelected = mount("1000");
        const lateStationary = mount("locked");
        await dom.happyDOM.waitUntilComplete();
        expect(lateSelected.style.translate).toBe("");
        expect(lateStationary.style.translate).toBe("-30px -20px");
        move(40);
        expect(lateStationary.style.translate).toBe("-40px -20px");
        applyCanvasNodeDragPreview(container, null);
        expect(layer.style.translate).toBe("");
        expect(lateStationary.style.translate).toBe("");
        const subset = new Set(["0", "other-selected"]);
        applyCanvasNodeDragPreview(container, { x: -15, y: 8, nodeIds: subset });
        const other = mount("other-selected");
        await dom.happyDOM.waitUntilComplete();
        expect(layer.style.translate).toBe("");
        expect(mounted[0].style.translate).toBe("-15px 8px");
        expect(other.style.translate).toBe("-15px 8px");
        expect(lateSelected.style.translate).toBe("");
        expect(lateStationary.style.translate).toBe("");
    } finally {
        applyCanvasNodeDragPreview(container, null);
        container.remove();
    }
});
// happy-dom 的 WheelEvent 未初始化 MouseEvent 坐标，显式补齐浏览器会提供的字段。
function wheelAt(point: { x: number; y: number }, deltaY: number) {
    const event = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
    Object.defineProperties(event, { clientX: { value: point.x }, clientY: { value: point.y }, ctrlKey: { value: true } });
    return event;
}

test("跨吸附线时只刷新绘制预览，松手提交最后的位置并清理手势", async () => {
    const nodes: CanvasNodeData[] = [100, 400].map((left) => ({ id: `node-${left}`, type: CanvasNodeType.Text, title: "镜头", position: { x: left, y: 100 }, width: 100, height: 80, metadata: {} }));
    let commits = 0;
    let written: CanvasNodeData[] | undefined;
    const guides: Array<number | undefined> = [];
    const activity: boolean[] = [];
    const measuringWhileDragging: boolean[] = [];
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const controller = useCanvasSelectionController({
            containerRef,
            nodesRef: useRef(nodes),
            viewportRef: useRef({ x: 0, y: 0, k: 1 }),
            selectedNodeIdsRef: useRef(new Set<string>()),
            historyPausedRef: useRef(false),
            screenToCanvas: (x, y) => {
                measuringWhileDragging.push(containerRef.current?.dataset.canvasNodeDragging === "true");
                return { x, y };
            },
            setNodes: (update) => {
                written = typeof update === "function" ? update(nodes) : update;
            },
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            cancelPendingConnectionCreate: noop,
            onCanvasSelectionStart: noop,
            onNodeInteractionStart: noop,
            onNodeClick: noop,
            onDeselect: noop,
        });
        useLayoutEffect(() => {
            commits++;
        });
        useLayoutEffect(() => subscribeCanvasNodeDragPreview(containerRef.current!, (preview) => guides.push(preview?.guides?.vertical)), []);
        return (
            <div ref={containerRef} data-canvas-viewport>
                <div className="node-element" data-node-id="node-100" onMouseDown={(event) => controller.handleNodeMouseDown(event, "node-100")} />
                <div className="node-element" data-node-id="node-400">
                    <span />
                </div>
            </div>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const stop = observeCanvasGestureActive(document, (active) => activity.push(active));
    try {
        await act(async () => root.render(<Harness />));
        const node = host.querySelector<HTMLElement>("[data-node-id]")!;
        await act(async () => node.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 140, clientY: 140 })));
        const afterDown = commits;
        const marked = () => [...host.querySelectorAll<HTMLElement>("[data-canvas-drag-cursor]")].map((element) => element.dataset.nodeId);
        const viewport = host.querySelector<HTMLElement>("[data-canvas-viewport]")!;
        const over = (element: Element) => element.dispatchEvent(new dom.MouseEvent("mouseover", { bubbles: true }));
        expect(marked()).toEqual(["node-100"]);
        over(host.querySelector('[data-node-id="node-400"] span')!);
        expect(marked()).toEqual(["node-400"]);
        over(viewport);
        expect(marked()).toEqual([]);
        over(node);
        viewport.dispatchEvent(new dom.MouseEvent("mouseleave"));
        expect(marked()).toEqual([]);
        over(node);
        for (const clientX of [338, 441, 467, 443]) {
            await act(async () => {
                const reads = measuringWhileDragging.length;
                window.dispatchEvent(new dom.PointerEvent("pointermove", { clientX, clientY: 177 }));
                window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX, clientY: 177 }));
                const pending = [...frames.values()];
                frames.clear();
                pending.forEach((callback) => callback(performance.now()));
                expect(measuringWhileDragging.length - reads).toBe(1);
            });
        }
        expect(guides.slice(-4)).toEqual([undefined, 400, undefined, 400]);
        expect(commits).toBe(afterDown);
        await act(async () => window.dispatchEvent(new dom.MouseEvent("mouseup", { clientX: 443, clientY: 177 })));
        expect(written?.[0].position).toEqual({ x: 400, y: 137 });
        expect(measuringWhileDragging.at(-1)).toBe(true);
        expect(node.style.translate).toBe("");
        expect(activity).toEqual([false, true, false]);
        expect(marked()).toEqual([]);
        over(node);
        expect(marked()).toEqual([]);

        const startAgain = async () => {
            await act(async () => node.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 140, clientY: 140 })));
            await act(async () => window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX: 180, clientY: 188 })));
        };
        await startAgain();
        await act(async () => window.dispatchEvent(new dom.MouseEvent("mouseup", { clientX: 188, clientY: 199 })));
        expect(written?.[0].position).toEqual({ x: 148, y: 159 });
        expect(measuringWhileDragging.at(-1)).toBe(true);
        const beforeCancel = written;
        await startAgain();
        const readsBeforeCancel = measuringWhileDragging.length;
        await act(async () => window.dispatchEvent(new dom.Event("pointercancel")));
        expect(marked()).toEqual([]);
        over(node);
        expect(marked()).toEqual([]);
        expect(written).toBe(beforeCancel);
        expect(measuringWhileDragging).toHaveLength(readsBeforeCancel);
        expect(node.style.translate).toBe("");
        expect(host.querySelector<HTMLElement>("[data-canvas-viewport]")?.dataset.canvasNodeDragging).toBeUndefined();
    } finally {
        stop();
        await act(async () => root.unmount());
        host.remove();
    }
});

test("框选最后一次命中只提交不重画；未绘制的松手、新节点位置与修饰键仍以真实落点为准", async () => {
    const initial: CanvasNodeData[] = [0, 1, 2].map((index) => ({ id: String(index), type: CanvasNodeType.Image, title: String(index), position: { x: 10 + 30 * index, y: 10 }, width: 10, height: 10 }));
    const nodesRef = { current: initial };
    const selectedNodeIdsRef = { current: new Set(["2"]) };
    const commits: string[][] = [];
    let previews = 0;
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const controller = useCanvasSelectionController({
            containerRef,
            nodesRef,
            viewportRef: useRef({ x: 0, y: 0, k: 1 }),
            selectedNodeIdsRef,
            historyPausedRef: useRef(false),
            screenToCanvas: (x, y) => ({ x, y }),
            setNodes: noop,
            setSelectedNodeIds: () => commits.push([...selectedNodeIdsRef.current]),
            setSelectedConnectionId: noop,
            cancelPendingConnectionCreate: noop,
            onCanvasSelectionStart: noop,
            onNodeInteractionStart: noop,
            onNodeClick: noop,
            onDeselect: noop,
        });
        useLayoutEffect(() => subscribeCanvasSelectionPreview(containerRef.current!, () => previews++), []);
        return (
            <div data-viewport ref={containerRef} onPointerDown={controller.handleCanvasMouseDown}>
                {initial.map((node) => (
                    <div key={node.id} data-node-id={node.id} />
                ))}
            </div>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<Harness />));
        const container = host.querySelector<HTMLElement>("[data-viewport]")!;
        const down = (modifiers = {}) => act(async () => container.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 2, clientY: 2, ...modifiers })));
        const move = (x: number) =>
            act(async () => {
                window.dispatchEvent(new dom.PointerEvent("pointermove", { clientX: x, clientY: 26 }));
                const pending = [...frames.values()];
                frames.clear();
                pending.forEach((callback) => callback(performance.now()));
            });
        const up = (x: number) => act(async () => window.dispatchEvent(new dom.PointerEvent("pointerup", { clientX: x, clientY: 26 })));
        await down();
        await move(54);
        expect(previews).toBe(1);
        expect(commits).toHaveLength(0);
        expect(container.querySelectorAll('[data-canvas-selection-preview="include"]')).toHaveLength(2);
        expect(container.querySelector('[data-node-id="2"]')?.getAttribute("data-canvas-selection-preview")).toBe("remove");
        await up(54);
        expect(previews).toBe(1);
        expect(commits).toEqual([["0", "1"]]);
        expect(container.querySelectorAll("[data-canvas-selection-preview]")).toHaveLength(0);
        await down({ ctrlKey: true });
        await up(23);
        expect(commits.at(-1)).toEqual(["1"]);
        expect(previews).toBe(1);
        await down({ shiftKey: true });
        await move(54);
        nodesRef.current = [{ ...initial[0], position: { x: 140, y: 10 } }, initial[1], { ...initial[2], position: { x: 20, y: 10 } }];
        await up(54);
        expect(commits.at(-1)).toEqual(["1", "2"]);
        await down({ altKey: true });
        await move(28);
        expect(container.querySelector('[data-node-id="2"]')?.getAttribute("data-canvas-selection-preview")).toBe(null);
        await up(35);
        expect(commits.at(-1)).toEqual(["1"]);
        const beforeCancel = commits.length;
        await down();
        await move(54);
        await act(async () => window.dispatchEvent(new dom.Event("pointercancel")));
        expect([...selectedNodeIdsRef.current]).toEqual(["1"]);
        expect(commits).toHaveLength(beforeCancel);
        expect(container.querySelectorAll("[data-canvas-selection-preview]")).toHaveLength(0);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        frames.clear();
    }
});

test.each([0.5, 1.2])("Ctrl+滚轮、多选拖拽和松手在初始缩放 %s 保持鼠标锚点", async (scale) => {
    let latestNodes: CanvasNodeData[] = [];
    let latestViewport: ViewportTransform = { x: 60, y: 40, k: scale };
    const original = [
        { x: 100, y: 160 },
        { x: 500, y: 600 },
    ];
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [nodes, setNodes] = useState<CanvasNodeData[]>(original.map((position, i) => ({ id: `node-${i}`, type: CanvasNodeType.Text, title: `node-${i}`, position, width: 100, height: 80, metadata: {} })));
        latestNodes = nodes;
        const nodesRef = useRef(nodes);
        nodesRef.current = nodes;
        const [viewport, setViewport] = useState(latestViewport);
        const viewportRef = useRef(viewport);
        const selectedNodeIdsRef = useRef(new Set(["node-0", "node-1"]));
        const historyPausedRef = useRef(false);
        const controller = useCanvasSelectionController({
            containerRef,
            nodesRef,
            viewportRef,
            selectedNodeIdsRef,
            historyPausedRef,
            screenToCanvas: (x, y) => ({ x: (x - viewportRef.current.x) / viewportRef.current.k, y: (y - viewportRef.current.y) / viewportRef.current.k }),
            setNodes,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            cancelPendingConnectionCreate: noop,
            onCanvasSelectionStart: noop,
            onNodeInteractionStart: noop,
            onNodeClick: noop,
            onDeselect: noop,
        });
        const preview = (next: ViewportTransform) => {
            latestViewport = next;
            viewportRef.current = next;
        };
        return (
            <CanvasViewport
                containerRef={containerRef}
                viewport={viewport}
                onViewportPreviewChange={preview}
                onViewportChange={(next) => {
                    preview(next);
                    setViewport(next);
                }}
            >
                {nodes.map((node) => (
                    <div key={node.id} data-node-id={node.id} onMouseDown={(event) => controller.handleNodeMouseDown(event, node.id)}>
                        {node.title}
                    </div>
                ))}
            </CanvasViewport>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const flush = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(performance.now()));
    };
    await act(async () => root.render(<Harness />));
    try {
        const node = host.querySelector<HTMLElement>('[data-node-id="node-0"]')!;
        const grab = { x: 20, y: 30 };
        let mouse = { x: 60 + 120 * scale, y: 40 + 190 * scale };
        await act(async () => node.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: mouse.x, clientY: mouse.y })));
        expect(host.querySelector<HTMLElement>("[data-canvas-viewport]")?.dataset.canvasNodeDragging).toBe("true");
        mouse = { x: mouse.x + 110, y: mouse.y + 77 };
        await act(async () => {
            window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX: mouse.x, clientY: mouse.y }));
            flush();
        });
        for (const deltaY of [-120, 120, -120]) {
            await act(async () => {
                const wheel = wheelAt(mouse, deltaY);
                node.dispatchEvent(wheel);
                expect(wheel.defaultPrevented).toBe(true);
                flush();
            });
            mouse = { x: mouse.x + 31, y: mouse.y + 19 };
            await act(async () => {
                window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX: mouse.x, clientY: mouse.y }));
                flush();
            });
            const [dx, dy] = node.style.translate.split(" ").map(parseFloat);
            expect(node.style.translate, host.innerHTML).not.toBe("");
            expect(latestViewport.x + (original[0].x + dx + grab.x) * latestViewport.k).toBeCloseTo(mouse.x, 6);
            expect(latestViewport.y + (original[0].y + dy + grab.y) * latestViewport.k).toBeCloseTo(mouse.y, 6);
        }
        // 最后一次缩放后直接松手，不依赖补发 mousemove。
        await act(async () => {
            node.dispatchEvent(wheelAt(mouse, 120));
            flush();
        });
        await act(async () => window.dispatchEvent(new dom.MouseEvent("mouseup", { clientX: mouse.x, clientY: mouse.y })));
        expect(latestViewport.x + (latestNodes[0].position.x + grab.x) * latestViewport.k).toBeCloseTo(mouse.x, 6);
        expect(latestViewport.y + (latestNodes[0].position.y + grab.y) * latestViewport.k).toBeCloseTo(mouse.y, 6);
        expect(latestNodes[1].position.x - latestNodes[0].position.x).toBeCloseTo(400, 6);
        expect(latestNodes[1].position.y - latestNodes[0].position.y).toBeCloseTo(440, 6);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        frames.clear();
    }
});

test("框与批次成员共同移动一次；锁定项和未选项不动，单步撤销及重做恢复全部位置", async () => {
    const initial: CanvasNodeData[] = [0, 40, 140, 800, 950].map((x, index) => ({ id: String(index), type: CanvasNodeType.Image, title: String(index), position: { x, y: index * 125 }, width: 40, height: 30 }));
    initial[0] = { ...initial[0], type: CanvasNodeType.Frame };
    initial[1] = { ...initial[1], parentId: "0", metadata: { batchChildIds: ["2"] } };
    initial[3] = { ...initial[3], metadata: { locked: true } };
    const snapshot: CanvasHistorySnapshot = { nodes: initial, activeChatId: null, canvasAppearance: { mode: "light" }, backgroundMode: "dots", showImageInfo: false, chatSessions: [], connections: [] };
    let current = initial;
    function Harness() {
        const [nodes, setNodes] = useState(initial);
        const [selected, setSelectedNodeIds] = useState(new Set(["0", "1", "3"]));
        const nodesRef = useRef(nodes);
        current = nodesRef.current = nodes;
        const selectedNodeIdsRef = useRef(selected);
        selectedNodeIdsRef.current = selected;
        const containerRef = useRef<HTMLDivElement>(null);
        const history = useCanvasHistory({
            ...snapshot,
            nodes,
            projectLoaded: true,
            restoreHistoryNodes: (snapshotNodes) => {
                setNodes(snapshotNodes);
                return snapshotNodes;
            },
            setSelectedNodeIds,
            setConnections: noop,
            setChatSessions: noop,
            setActiveChatId: noop,
            restoreHistoryAppearance: (appearance) => appearance,
            setBackgroundMode: noop,
            setShowImageInfo: noop,
            setSelectedConnectionId: noop,
            setContextMenu: noop,
        });
        useLayoutEffect(() => history.resetHistory(snapshot), [history.resetHistory]);
        const controller = useCanvasSelectionController({
            containerRef,
            nodesRef,
            viewportRef: useRef({ x: 0, y: 0, k: 1 }),
            selectedNodeIdsRef,
            historyPausedRef: history.historyPausedRef,
            screenToCanvas: (x, y) => ({ x, y }),
            setNodes,
            setSelectedNodeIds,
            setSelectedConnectionId: noop,
            cancelPendingConnectionCreate: noop,
            onCanvasSelectionStart: noop,
            onNodeInteractionStart: noop,
            onNodeClick: noop,
            onDeselect: noop,
        });
        return (
            <div ref={containerRef}>
                {nodes.map((node) => (
                    <div key={node.id} data-node-id={node.id} onMouseDown={(event) => controller.handleNodeMouseDown(event, node.id)} />
                ))}
                <button data-undo disabled={!history.historyState.canUndo} onClick={history.undoCanvas} />
                <button data-redo disabled={!history.historyState.canRedo} onClick={history.redoCanvas} />
            </div>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<Harness />));
        const node = host.querySelector<HTMLElement>('[data-node-id="0"]')!;
        const undo = host.querySelector<HTMLButtonElement>("[data-undo]")!;
        const redo = host.querySelector<HTMLButtonElement>("[data-redo]")!;
        await act(async () => node.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
        await act(async () => {
            window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX: 40, clientY: 37 }));
            window.dispatchEvent(new dom.MouseEvent("mouseup", { clientX: 85, clientY: 52 }));
        });
        const moved = current;
        expect(moved.map((node) => node.position)).toEqual(initial.map((node, index) => (index < 3 ? { x: node.position.x + 80, y: node.position.y + 47 } : node.position)));
        expect(moved[1].parentId).toBe("0");
        expect(moved[3]).toBe(initial[3]);
        expect(moved[4]).toBe(initial[4]);
        await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
        expect(undo.disabled).toBe(false);
        await act(async () => {
            undo.click();
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
        expect(current).toEqual(initial);
        expect(undo.disabled).toBe(true);
        expect(redo.disabled).toBe(false);
        await act(async () => {
            redo.click();
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
        expect(current).toEqual(moved);
        expect(redo.disabled).toBe(true);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        frames.clear();
    }
});

test("平移中补入新视区，折返或结束后不累积预览节点", async () => {
    const nodes: CanvasNodeData[] = [1600, 1650, 3000].map((left) => ({ id: String(left), type: CanvasNodeType.Text, title: "镜头", position: { x: left, y: 60 }, width: 40, height: 30 }));
    const index = buildCanvasSpatialIndex(nodes.map((node) => ({ id: node.id, value: node, bounds: canvasNodeBounds(node) })));
    const connection = { connection: { id: "adjacent", fromNodeId: "1600", toNodeId: "1650" }, from: nodes[0], to: nodes[1] };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let queryCount = 0;
    let pageCommits = 0;
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        useLayoutEffect(() => {
            pageCommits++;
        });
        return (
            <CanvasGestureRenderWindow
                containerRef={containerRef}
                viewport={{ x: 0, y: 0, k: 1 }}
                size={{ width: 400, height: 200 }}
                connections={[]}
                filterConnections={(entries) => entries}
                query={(_view, bounds) => {
                    queryCount++;
                    const visible = index.query(bounds);
                    return { nodes: visible, connections: visible.includes(nodes[0]) ? [connection] : [] };
                }}
            >
                {(incoming, edges) => (
                    <div ref={containerRef} data-canvas-viewport>
                        {[...incoming.map((node) => node.id), ...edges.map((edge) => edge.connection.id)].join(",")}
                    </div>
                )}
            </CanvasGestureRenderWindow>
        );
    }
    try {
        await act(async () => root.render(<Harness />));
        const container = host.querySelector<HTMLDivElement>("[data-canvas-viewport]")!;
        const move = (x: number) => act(async () => applyCanvasLiveViewport(container, { x, y: 0, k: 1 }));
        await act(async () => setCanvasGestureActive(container, "canvasViewportInteracting", true));
        await move(-1400);
        expect(container.textContent).toBe("1600,1650,adjacent");
        await move(-1410);
        expect(queryCount).toBe(1);
        await move(-2800);
        expect(container.textContent).toBe("3000");
        await move(0);
        expect(container.textContent).toBe("");
        await move(-1400);
        await act(async () => setCanvasGestureActive(container, "canvasViewportInteracting", false));
        expect(container.textContent).toBe("");
        expect(pageCommits).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
