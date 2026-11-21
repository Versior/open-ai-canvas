import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { Group, Path, Rect } from "@leafer-ui/draw";
import type { CanvasDisplayConnection, CanvasNodeData } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/test" });
Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
});
const paths: Path[] = [];
const writes = new Map<Path, number>();
let reparents = 0;
// 保留 Leafer 的路径解析、图层父子关系与坐标，只隔离没有浏览器 backing store 的光栅后端。
class RasterHost extends Group {
    resize() {}
    forceRender() {}
}
class MeteredGroup extends Group {
    override add(...args: Parameters<Group["add"]>) {
        const leaf = args[0];
        if (leaf instanceof Path && leaf.parent && leaf.parent !== this) reparents++;
        return super.add(...args);
    }
}
class MeteredPath extends Path {
    override set(...args: Parameters<Path["set"]>) {
        const data = args[0];
        if (data && "path" in data) {
            if (!writes.has(this)) paths.push(this);
            writes.set(this, (writes.get(this) || 0) + 1);
        }
        return super.set(...args);
    }
}
mock.module("leafer-ui", () => ({ Group: MeteredGroup, Path: MeteredPath, Rect, Leafer: RasterHost }));
const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasLeaferGraphicsLayer } = await import("@/components/canvas/canvas-leafer-graphics-layer");
const { canvasConnectionPath } = await import("@/components/canvas/canvas-connections");
const { CanvasNodeResizeMotionProvider, useCanvasNodeResizeMotion } = await import("@/components/canvas/canvas-node-resize-motion");
const { createStoryboardRow } = await import("@/lib/canvas/canvas-project-domain");
const { markAgentCanvasEntrance } = await import("@/lib/canvas/agent-canvas-entrance");
const { CANVAS_NODE_DRAG_PREVIEW_EVENT } = await import("@/lib/canvas/canvas-live-viewport");
const { canvasThemes } = await import("@/lib/canvas-theme");
const { CanvasNodeType } = await import("@/types/canvas");
const blankScroll = {};
const image = (index: number): CanvasNodeData => ({ id: `${index}`, type: CanvasNodeType.Image, title: `${index}`, width: 256, height: 144, position: { x: (index % 40) * 320, y: Math.floor(index / 40) * 208 } });
const visible = (nodes: CanvasNodeData[]): CanvasDisplayConnection[] => nodes.slice(1).map((node, index) => ({ connection: { id: `${index}`, fromNodeId: nodes[index].id, toNodeId: node.id }, from: nodes[index], to: node }));

function mount() {
    paths.length = 0;
    writes.clear();
    reparents = 0;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();
    let motion: ReturnType<typeof useCanvasNodeResizeMotion> = null;
    function MotionProbe() {
        motion = useCanvasNodeResizeMotion();
        return null;
    }
    return {
        get motion() {
            return motion!;
        },
        render: (edges: CanvasDisplayConnection[], scroll: Record<string, number> = blankScroll, batch?: Record<string, { top: number; left: number }>, theme = canvasThemes.light) =>
            act(async () =>
                root.render(
                    <div ref={containerRef}>
                        <CanvasNodeResizeMotionProvider nodes={[...new Set(edges.flatMap((edge) => [edge.from, edge.to]))]}>
                            <MotionProbe />
                            <CanvasLeaferGraphicsLayer
                                containerRef={containerRef}
                                viewport={{ x: 0, y: 0, k: 1 }}
                                theme={theme}
                                displayConnections={edges}
                                scriptScrollTopById={scroll}
                                batchScrollById={batch}
                                nodeById={new Map()}
                                selectedNodeBounds={null}
                                selectionBox={null}
                                mouseWorld={{ x: 0, y: 0 }}
                                connectingParams={null}
                                batchConnectionPreview={null}
                            />
                        </CanvasNodeResizeMotionProvider>
                    </div>,
                ),
            ),
        drag: (nodeIds?: Set<string>, x = 0, y = 0) => containerRef.current!.dispatchEvent(new CustomEvent(CANVAS_NODE_DRAG_PREVIEW_EVENT, { detail: nodeIds ? { nodeIds, x, y } : null })),
        close: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function curvePoints(pathD: string) {
    return pathD.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
}

function displayedCurve(path: Path) {
    const coords = curvePoints(String(path.path));
    let x = path.x,
        y = path.y;
    for (let parent = path.parent; parent; parent = parent.parent) {
        x += parent.x;
        y += parent.y;
    }
    return coords.map((point, index) => point + (index % 2 === 0 ? x : y));
}

function displayedEndpoints(path: Path) {
    const coords = displayedCurve(path);
    return [coords[0], coords[1], coords.at(-2), coords.at(-1)];
}

test.each([500, 1000])("999 条线：%s 节点同向位移只写跨界曲线，松手或取消不改变端点和叠序", async (count) => {
    const scene = mount();
    try {
        const nodes = Array.from({ length: 1000 }, (_, index) => image(index));
        const edges = visible(nodes);
        const selected = new Set(nodes.filter((_, index) => index % 40 < count / 25).map((node) => node.id));
        const offset = (node: CanvasNodeData) => (!selected.has(node.id) ? node : { ...node, position: { x: node.position.x - 368, y: node.position.y + 83 } });
        const moved = edges.map((edge) => ({ ...edge, from: offset(edge.from), to: offset(edge.to) }));
        const boundary = edges.filter(({ from, to }) => selected.has(from.id) !== selected.has(to.id)).length;
        await scene.render(edges);
        expect(paths).toHaveLength(999);
        const total = () => [...writes.values()].reduce((sum, n) => sum + n, 0);
        let mark = total();
        scene.drag(selected);
        const downWrites = total() - mark;
        mark = total();
        scene.drag(selected, -368, 83);
        const moveWrites = total() - mark;
        const check = (entries: CanvasDisplayConnection[]) => {
            for (const [index, edge] of entries.entries()) {
                const geometry = canvasConnectionPath(edge.connection, edge.from, edge.to);
                expect(displayedEndpoints(paths[index])).toEqual([geometry.startX, geometry.startY, geometry.endX, geometry.endY]);
            }
        };
        check(moved);
        scene.drag();
        check(edges);
        mark = total();
        await scene.render(moved);
        const commitWrites = total() - mark;
        check(moved);
        const gesturesReparents = reparents;
        await scene.render(edges);
        check(edges);
        expect({ downWrites, moveWrites, commitWrites }).toEqual({ downWrites: 0, moveWrites: boundary, commitWrites: boundary });
        if (count === 1000) expect(gesturesReparents).toBe(0);
    } finally {
        await scene.close();
    }
});

test("拖动中新增及移除屏外边：整层和部分选区换组不重复偏移，重接端点及时更新尺寸订阅", async () => {
    const scene = mount();
    try {
        const [first, second, third] = [0, 1, 2].map(image);
        const [inside, boundary] = visible([first, second, third]);
        const selected = new Set([first.id, second.id]);
        const shifted = (node: CanvasNodeData) => ({ ...node, position: { x: node.position.x + 105, y: node.position.y - 62 } });
        const check = (path: Path, edge: CanvasDisplayConnection) => {
            const value = canvasConnectionPath(edge.connection, edge.from, edge.to);
            expect(displayedEndpoints(path)).toEqual([value.startX, value.startY, value.endX, value.endY]);
        };
        await scene.render([inside]);
        scene.drag(selected, 105, -62);
        await scene.render([inside, boundary]);
        check(paths[0], { ...inside, from: shifted(first), to: shifted(second) });
        check(paths[1], { ...boundary, from: shifted(second) });
        expect(paths[0].parent).not.toBe(paths[1].parent);
        const world = paths[0].parent!.parent!;
        expect(world.children.indexOf(paths[0].parent!)).toBeGreaterThan(world.children.indexOf(paths[1].parent!));
        await scene.render([inside]);
        expect(paths[1].parent).toBeFalsy();
        check(paths[0], { ...inside, from: shifted(first), to: shifted(second) });
        scene.drag();
        check(paths[0], inside);
        const reverse = { ...inside, from: third, to: first, connection: { ...inside.connection, fromNodeId: third.id, toNodeId: first.id } };
        await scene.render([reverse]);
        check(paths[0], reverse);
        const previousWrites = writes.get(paths[0])!;
        scene.motion.setPreview(second.id, { ...second, width: 510 });
        expect(writes.get(paths[0])).toBe(previousWrites);
        scene.motion.setPreview(third.id, { ...third, width: 403 });
        check(paths[0], { ...reverse, from: { ...third, width: 403 } });
        scene.motion.clearPreview(third.id);
        check(paths[0], reverse);
    } finally {
        await scene.close();
    }
});

test("剧本行、批次单元格和各自滚动只刷新实际连接，主题变化不必重解曲线", async () => {
    const scene = mount();
    try {
        const rows = [0, 1, 2].map((i) => createStoryboardRow(i + 1, { id: `r${i}` }));
        const script: CanvasNodeData = { ...image(0), type: CanvasNodeType.Script, height: 630, metadata: { storyboard: { rows, visibleColumns: [], referenceNodeIds: [] } } };
        const table: CanvasNodeData = {
            ...image(1),
            type: CanvasNodeType.BatchTable,
            height: 670,
            metadata: { batchTable: { operation: "creative", concurrency: 2, rows: rows.map((row) => ({ id: row.id, enabled: true, inputNodeIds: [], prompt: "" })), referenceColumns: [{ id: "a", label: "参考图" }] } },
        };
        const [first, clean] = visible([script, table, image(2)]);
        const edge = { ...first, connection: { ...first.connection, fromHandleId: "row:r1", toHandleId: "batch-cell:r1:a" } };
        const unrelated = { ...clean, from: image(3), connection: { ...clean.connection, fromNodeId: "3" } };
        let edges = [edge, unrelated];
        await scene.render(edges);
        const scroll = { [script.id]: 32 };
        const batch = { [table.id]: { top: 20, left: 38 } };
        await scene.render(edges, scroll, batch);
        expect(paths[0].path).toBe(canvasConnectionPath(edge.connection, script, table, 32, 0, undefined, batch[table.id]).pathD);
        expect(writes.get(paths[1])).toBe(1);
        const reordered = { ...script, metadata: { ...script.metadata, storyboard: { ...script.metadata!.storyboard!, rows: [...rows].reverse().slice(1) } } };
        edges = [{ ...edge, from: reordered }, unrelated];
        await scene.render(edges, scroll, batch);
        const newPath = canvasConnectionPath(edge.connection, reordered, table, 32, 0, undefined, batch[table.id]);
        expect(paths[0].path).toBe(newPath.pathD);
        const mark = writes.get(paths[0]);
        await scene.render(edges, scroll, batch, canvasThemes.dark);
        expect(paths[0].stroke).toBe(canvasThemes.dark.connection.stroke);
        expect(writes.get(paths[0])).toBe(mark);
    } finally {
        await scene.close();
    }
});

test("连续整组拖动、跨端倒向和中途换选取消后，真实曲线的全部控制点不累积预览位移", async () => {
    const scene = mount();
    try {
        const original = [0, 1, 2, 3].map(image);
        const all = new Set(original.map((node) => node.id));
        const subset = new Set(["1", "2"]);
        const single = new Set(["0"]);
        let nodes = original;
        const project = (selection: Set<string>, dx: number, dy: number) => nodes.map((node) => (selection.has(node.id) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node));
        const verify = (expected: CanvasNodeData[]) => visible(expected).forEach((edge, index) => expect(displayedCurve(paths[index])).toEqual(curvePoints(canvasConnectionPath(edge.connection, edge.from, edge.to).pathD)));
        const commit = async (selection: Set<string>, dx: number, dy: number) => {
            scene.drag(selection);
            scene.drag(selection, dx, dy);
            const next = project(selection, dx, dy);
            verify(next);
            scene.drag();
            verify(nodes);
            nodes = next;
            await scene.render(visible(nodes));
            verify(nodes);
        };
        await scene.render(visible(nodes));
        await commit(all, -140.5, 33.25);
        await commit(all, 15.75, -90);
        await commit(single, 600, -105);
        await commit(subset, 172, 21);
        scene.drag(single, 240, -110);
        verify(project(single, 240, -110));
        scene.drag(subset, 240, -110);
        verify(project(subset, 240, -110));
        scene.drag(all, -40, 9);
        verify(project(all, -40, 9));
        scene.drag();
        verify(nodes);
        await commit(all, -162, 72);
        await scene.render(visible(original));
        verify(original);
    } finally {
        await scene.close();
    }
});

test("拖动中新挂的反向单元格连线保持夹边位置和 Agent 淡入；单元格消失后不残留线", async () => {
    const scene = mount();
    const pending: FrameRequestCallback[] = [];
    const originalRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (callback) => pending.push(callback);
    try {
        const source = image(6);
        const table: CanvasNodeData = {
            ...image(0),
            type: CanvasNodeType.BatchTable,
            height: 540,
            metadata: { batchTable: { operation: "creative", concurrency: 1, rows: [{ id: "row", enabled: true, inputNodeIds: [], prompt: "" }], referenceColumns: [{ id: "a", label: "参考图" }] } },
        };
        const selected = new Set([source.id, table.id]);
        const edge = { connection: { id: "enter-clipped", fromNodeId: source.id, toNodeId: table.id, toHandleId: "batch-cell:row:a" }, from: source, to: table };
        const batch = { [table.id]: { top: 9000, left: 1200 } };
        const coords = curvePoints(canvasConnectionPath(edge.connection, source, table, 0, 0, undefined, batch[table.id]).pathD);
        await scene.render([]);
        scene.drag(selected, -184, 53);
        markAgentCanvasEntrance([], [edge.connection.id]);
        await scene.render([edge], blankScroll, batch);
        expect(displayedCurve(paths[0])).toEqual(coords.map((point, index) => point + (index % 2 === 0 ? -184 : 53)));
        expect(paths[0].opacity).toBe(0);
        const sample = performance.now() + 300;
        pending.shift()!(sample);
        const duringFade = paths[0].opacity;
        expect(duringFade).toBeGreaterThan(0);
        expect(duringFade).toBeLessThan(0.8);
        scene.drag(new Set([table.id]), -184, 53);
        expect(paths[0].opacity).toBe(duringFade);
        const shifted = { ...table, position: { x: table.position.x - 184, y: table.position.y + 53 } };
        expect(displayedCurve(paths[0])).toEqual(curvePoints(canvasConnectionPath(edge.connection, source, shifted, 0, 0, undefined, batch[table.id]).pathD));
        scene.drag();
        expect(displayedCurve(paths[0])).toEqual(coords);
        const withoutRow = { ...table, metadata: { ...table.metadata, batchTable: { ...table.metadata!.batchTable!, rows: [] } } };
        await scene.render([{ ...edge, to: withoutRow }], blankScroll, batch);
        expect(displayedCurve(paths[0])).toEqual([]);
        pending.shift()!(sample + 450);
        expect(paths[0].opacity).toBe(0.8);
        await scene.render([edge], blankScroll, batch);
        expect(displayedCurve(paths[0])).toEqual(coords);
        expect(paths[0].opacity).toBe(0.8);
    } finally {
        if (originalRAF) globalThis.requestAnimationFrame = originalRAF;
        else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
        await scene.close();
    }
});
