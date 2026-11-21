import { useLayoutEffect, useRef, type RefObject } from "react";
import { Group, Leafer, Path, Rect } from "leafer-ui";

import { canvasConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasConnectionDrafts } from "./canvas-connection-drafts";
import { useCanvasNodeResizeMotion } from "./canvas-node-resize-motion";
import type { CanvasNodeResizeMotion } from "@/lib/canvas/canvas-node-resize-motion";
import type { CanvasBatchConnectionPreview } from "@/lib/canvas/canvas-batch-connection";
import { agentConnectionEntranceDelay, prefersReducedMotion } from "@/lib/canvas/agent-canvas-entrance";
import type { BatchScroll } from "@/lib/canvas/canvas-batch-references";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview, subscribeCanvasSelectionPreview, type CanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { calculateCanvasPreviewTransform, sameCanvasViewport, shouldRebaseCanvasRaster } from "@/lib/canvas/canvas-leafer-viewport";
import { offsetSelectedNodeBounds } from "@/lib/canvas/canvas-selection";
import { CANVAS_CONNECTION_STROKE_WIDTH, type CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasDisplayConnection, CanvasNodeData, ConnectionHandle, Position, SelectionBox, ViewportTransform } from "@/types/canvas";

type NodeBounds = { left: number; top: number; width: number; height: number; count: number } | null;

type CanvasLeaferGraphicsLayerProps = {
    containerRef: RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    theme: CanvasTheme;
    displayConnections: CanvasDisplayConnection[];
    scriptScrollTopById: Record<string, number>;
    batchScrollById?: Record<string, BatchScroll>;
    connectingParams: ConnectionHandle | null;
    batchConnectionPreview: CanvasBatchConnectionPreview | null;
    mouseWorld: Position;
    nodeById: Map<string, CanvasNodeData>;
    selectionBox: SelectionBox | null;
    selectedNodeBounds: NodeBounds;
};

type LeaferScene = {
    leafer: Leafer;
    world: Group;
    host: HTMLDivElement;
};

type UnderlayScene = LeaferScene & {
    resizeMotion: CanvasNodeResizeMotion | null;
    connections: Group;
    movingConnections: Group;
    connectionEntries: Map<string, ConnectionSceneEntry>;
    connectionIdsByNodeId: Map<string, Set<string>>;
    scrolls: ConnectionScrolls;
    dragPreview: CanvasNodeDragPreview | null;
    dragEdges: Set<ConnectionSceneEntry>;
    wholeLayerMoving: boolean;
};

type ConnectionScrolls = Pick<CanvasLeaferGraphicsLayerProps, "scriptScrollTopById" | "batchScrollById">;

type ConnectionSceneEntry = {
    resizeMotion: CanvasNodeResizeMotion | null;
    path: Path;
    connection: CanvasDisplayConnection["connection"];
    from: CanvasNodeData;
    to: CanvasNodeData;
    pathOrigin: Position;
    resized: boolean;
};

type OverlayScene = LeaferScene & {
    selection: Rect;
    selectionBounds: Rect;
    guides: Path;
    dragPreview: CanvasNodeDragPreview | null;
};

export function CanvasLeaferGraphicsLayer(props: CanvasLeaferGraphicsLayerProps) {
    const resizeMotion = useCanvasNodeResizeMotion();
    const underlayHostRef = useRef<HTMLDivElement>(null);
    const overlayHostRef = useRef<HTMLDivElement>(null);
    const underlayRef = useRef<UnderlayScene | null>(null);
    const overlayRef = useRef<OverlayScene | null>(null);
    const viewportRef = useRef(props.viewport);
    const rasterViewportRef = useRef(props.viewport);
    const containerSizeRef = useRef({ width: 1, height: 1 });
    const propsRef = useRef(props);
    propsRef.current = props;

    useLayoutEffect(() => {
        const underlayHost = underlayHostRef.current;
        const overlayHost = overlayHostRef.current;
        // 子组件 layout effect 可能早于父层 ref 对外可见，host 的直接父元素才是此刻最可靠的画布容器。
        const container = (props.containerRef.current || underlayHost?.parentElement) as HTMLDivElement | null;
        if (!underlayHost || !overlayHost || !container) return;

        const underlay = createUnderlayScene(underlayHost, resizeMotion);
        const overlay = createOverlayScene(overlayHost);
        containerSizeRef.current = { width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight) };
        underlayRef.current = underlay;
        overlayRef.current = overlay;

        const resize = () => {
            const rect = container.getBoundingClientRect();
            containerSizeRef.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
            const size = { ...containerSizeRef.current, pixelRatio: canvasPixelRatio() };
            underlay.leafer.resize(size);
            overlay.leafer.resize(size);
            syncViewport(rasterViewportRef.current, size.width, size.height, underlay, overlay, propsRef.current);
            if (isViewportPreview(container, viewportRef.current, rasterViewportRef.current)) {
                applyScenePreview(viewportRef.current, rasterViewportRef.current, underlay, overlay);
            }
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        window.addEventListener("resize", resize);
        const unsubscribe = subscribeCanvasGraphicsViewportPreview(container, (next) => {
            viewportRef.current = next;
            if (isViewportPreview(container, next, rasterViewportRef.current)) {
                if (shouldRebaseCanvasRaster(next, rasterViewportRef.current)) {
                    syncViewport(next, containerSizeRef.current.width, containerSizeRef.current.height, underlay, overlay, propsRef.current);
                    rasterViewportRef.current = next;
                    forceSceneRender(underlay, overlay);
                    resetScenePreview(underlay, overlay);
                    return;
                }
                applyScenePreview(next, rasterViewportRef.current, underlay, overlay);
                return;
            }
            resetScenePreview(underlay, overlay);
            if (sameCanvasViewport(next, rasterViewportRef.current)) return;
            syncViewport(next, containerSizeRef.current.width, containerSizeRef.current.height, underlay, overlay, propsRef.current);
            rasterViewportRef.current = next;
        });
        const unsubscribeSelection = subscribeCanvasSelectionPreview(container, (selection) => {
            syncSelection(overlay.selection, selection, propsRef.current.theme);
        });
        const unsubscribeNodeDrag = subscribeCanvasNodeDragPreview(container, (preview) => {
            applyConnectionDragPreview(underlay, propsRef.current, preview);
            const previous = overlay.dragPreview?.guides;
            overlay.dragPreview = preview;
            if (previous?.vertical !== preview?.guides?.vertical || previous?.horizontal !== preview?.guides?.horizontal) {
                syncGuidePath(overlay, rasterViewportRef.current, containerSizeRef.current.width, containerSizeRef.current.height);
            }
            syncLiveSelectionBounds(overlay, propsRef.current, viewportRef.current.k);
        });
        const unsubscribeResize = resizeMotion?.subscribe((nodeId) => {
            // 只刷新这个节点的相邻连线，不重建整张图的连接索引。
            for (const connectionId of underlay.connectionIdsByNodeId.get(nodeId) || []) {
                const entry = underlay.connectionEntries.get(connectionId);
                if (entry) syncConnectionPath(entry, propsRef.current, underlay.dragEdges.has(entry) ? underlay.dragPreview : null);
            }
        });
        resize();

        return () => {
            unsubscribe();
            unsubscribeSelection();
            unsubscribeNodeDrag();
            unsubscribeResize?.();
            resizeObserver.disconnect();
            window.removeEventListener("resize", resize);
            underlay.leafer.destroy(true);
            overlay.leafer.destroy(true);
            underlayRef.current = null;
            overlayRef.current = null;
        };
    }, [props.containerRef, resizeMotion]);

    useLayoutEffect(() => {
        const underlay = underlayRef.current;
        if (!underlay) return;
        rebuildConnections(underlay, props);
    }, [props.displayConnections, props.scriptScrollTopById, props.batchScrollById, props.theme]);

    useLayoutEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        syncOverlayContent(overlay, props, viewportRef.current.k);
    }, [props.selectedNodeBounds, props.selectionBox, props.theme]);

    useLayoutEffect(() => {
        const underlay = underlayRef.current;
        const overlay = overlayRef.current;
        const container = props.containerRef.current;
        if (!underlay || !overlay || !container) return;
        viewportRef.current = props.viewport;
        const hadPreview = hasScenePreview(underlay, overlay);
        if (hadPreview || !sameCanvasViewport(props.viewport, rasterViewportRef.current)) {
            syncViewport(props.viewport, containerSizeRef.current.width, containerSizeRef.current.height, underlay, overlay, props);
        }
        rasterViewportRef.current = props.viewport;
        // 新视口先同步到真实 DPR backing store，再撤销交互期的合成变换，避免出现跳帧。
        if (hadPreview) forceSceneRender(underlay, overlay);
        resetScenePreview(underlay, overlay);
    }, [props.containerRef, props.viewport]);

    useLayoutEffect(() => {
        const underlay = underlayRef.current;
        const overlay = overlayRef.current;
        const container = props.containerRef.current;
        if (!underlay || !overlay || !container) return;
        syncViewport(rasterViewportRef.current, containerSizeRef.current.width, containerSizeRef.current.height, underlay, overlay, props);
        if (isViewportPreview(container, viewportRef.current, rasterViewportRef.current)) {
            applyScenePreview(viewportRef.current, rasterViewportRef.current, underlay, overlay);
        }
    }, [props.containerRef, props.theme]);

    return (
        <>
            <div ref={underlayHostRef} data-canvas-leafer-underlay className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden />
            <div ref={overlayHostRef} data-canvas-leafer-overlay className="pointer-events-none absolute inset-0 z-[var(--z-canvas-overlay)] overflow-hidden" aria-hidden />
            <CanvasConnectionDrafts {...props} />
        </>
    );
}

function createUnderlayScene(host: HTMLDivElement, resizeMotion: CanvasNodeResizeMotion | null): UnderlayScene {
    const leafer = new Leafer({ view: host, width: 1, height: 1, pixelRatio: canvasPixelRatio(), fill: "transparent", hittable: false, smooth: true });
    const world = new Group({ hittable: false });
    const connections = new Group({ hittable: false });
    const movingConnections = new Group({ hittable: false });
    world.add(connections);
    world.add(movingConnections);
    leafer.add(world);
    return { leafer, world, host, resizeMotion, connections, movingConnections, connectionEntries: new Map(), connectionIdsByNodeId: new Map(), scrolls: { scriptScrollTopById: {} }, dragPreview: null, dragEdges: new Set(), wholeLayerMoving: false };
}

function createOverlayScene(host: HTMLDivElement): OverlayScene {
    const leafer = new Leafer({ view: host, width: 1, height: 1, pixelRatio: canvasPixelRatio(), fill: "transparent", hittable: false, smooth: true });
    const world = new Group({ hittable: false });
    const selection = new Rect({ visible: false, hittable: false });
    const selectionBounds = new Rect({ visible: false, hittable: false, fill: "transparent" });
    const guides = new Path({ visible: false, hittable: false });
    world.add(selection);
    world.add(selectionBounds);
    world.add(guides);
    leafer.add(world);
    return { leafer, world, host, selection, selectionBounds, guides, dragPreview: null };
}

const AGENT_CONNECTION_FADE_MS = 360;

/** Agent 刚建的连线在两端节点入场后淡入；之后的路径同步会照常写回常规透明度。 */
function fadeInAgentConnection(path: Path, delay: number) {
    const target = typeof path.opacity === "number" ? path.opacity : 0.8;
    path.opacity = 0;
    const start = performance.now() + delay;
    const step = (time: number) => {
        if (!path.parent) return;
        const progress = Math.min(1, Math.max(0, (time - start) / AGENT_CONNECTION_FADE_MS));
        path.opacity = target * progress;
        if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function rebuildConnections(scene: UnderlayScene, props: CanvasLeaferGraphicsLayerProps) {
    const nextIds = new Set<string>();
    const moving = scene.dragPreview?.nodeIds;
    const wholeLayerMoving = Boolean(moving && props.displayConnections.every(({ from, to }) => moving.has(from.id) && moving.has(to.id)));
    if (wholeLayerMoving !== scene.wholeLayerMoving) {
        scene.wholeLayerMoving = wholeLayerMoving;
        syncConnectionGroupOffset(scene);
    }

    for (const { connection, from, to } of props.displayConnections) {
        nextIds.add(connection.id);
        let entry = scene.connectionEntries.get(connection.id);
        if (!entry) {
            const path = new Path({ hittable: false, stroke: props.theme.connection.stroke, strokeWidth: CANVAS_CONNECTION_STROKE_WIDTH, strokeScaleFixed: true, strokeCap: "round", opacity: 0.8 });
            entry = { path, connection, from, to, resizeMotion: scene.resizeMotion, pathOrigin: from.position, resized: false };
            scene.connectionEntries.set(connection.id, entry);
            indexConnection(scene, entry, true);
            syncConnectionDragMode(scene, entry);
            syncConnectionPath(entry, props, scene.dragEdges.has(entry) ? scene.dragPreview : null);
            const entranceDelay = agentConnectionEntranceDelay(connection.id);
            if (entranceDelay !== null && !prefersReducedMotion()) fadeInAgentConnection(entry.path, entranceDelay);
            continue;
        }
        const oldFrom = entry.from;
        const oldTo = entry.to;
        const redirected = oldFrom.id !== from.id || oldTo.id !== to.id;
        const samePorts =
            !redirected && entry.connection.fromHandleId === connection.fromHandleId && entry.connection.toHandleId === connection.toHandleId && samePortLayout(oldFrom, from, scene.scrolls, props) && samePortLayout(oldTo, to, scene.scrolls, props);
        if (redirected) indexConnection(scene, entry, false);
        entry.connection = connection;
        entry.from = from;
        entry.to = to;
        if (redirected) indexConnection(scene, entry, true);
        const boundaryChanged = moving && syncConnectionDragMode(scene, entry);
        if (entry.path.stroke !== props.theme.connection.stroke) entry.path.stroke = props.theme.connection.stroke;
        if (samePorts && !boundaryChanged) {
            const dx = from.position.x - oldFrom.position.x;
            const dy = from.position.y - oldFrom.position.y;
            if (dx === to.position.x - oldTo.position.x && dy === to.position.y - oldTo.position.y) {
                if (!dx && !dy) continue;
                if (!scene.dragEdges.has(entry) && !entry.resized && !scene.resizeMotion?.getGeometry(from.id) && !scene.resizeMotion?.getGeometry(to.id)) {
                    entry.path.x = from.position.x - entry.pathOrigin.x;
                    entry.path.y = from.position.y - entry.pathOrigin.y;
                    continue;
                }
            }
        }
        syncConnectionPath(entry, props, scene.dragEdges.has(entry) ? scene.dragPreview : null);
    }
    for (const [connectionId, entry] of scene.connectionEntries) {
        if (nextIds.has(connectionId)) continue;
        entry.path.remove();
        indexConnection(scene, entry, false);
        scene.dragEdges.delete(entry);
        scene.connectionEntries.delete(connectionId);
    }
    scene.scrolls = { scriptScrollTopById: props.scriptScrollTopById, batchScrollById: props.batchScrollById };
}

function samePortLayout(before: CanvasNodeData, after: CanvasNodeData, previous: ConnectionScrolls, next: ConnectionScrolls) {
    return (
        (before === after || (before.type === after.type && before.width === after.width && before.height === after.height && before.metadata === after.metadata)) &&
        previous.scriptScrollTopById[before.id] === next.scriptScrollTopById[after.id] &&
        previous.batchScrollById?.[before.id] === next.batchScrollById?.[after.id]
    );
}

function indexConnection(scene: UnderlayScene, entry: ConnectionSceneEntry, add: boolean) {
    for (const nodeId of [entry.from.id, entry.to.id]) {
        let links = scene.connectionIdsByNodeId.get(nodeId);
        if (add) {
            if (!links) scene.connectionIdsByNodeId.set(nodeId, (links = new Set()));
            links.add(entry.connection.id);
        } else if (links) {
            links.delete(entry.connection.id);
            if (!links.size) scene.connectionIdsByNodeId.delete(nodeId);
        }
    }
}

function syncConnectionPath(entry: ConnectionSceneEntry, props: CanvasLeaferGraphicsLayerProps, preview: CanvasNodeDragPreview | null) {
    const resolvedFrom = entry.resizeMotion?.resolveNode(entry.from) || entry.from;
    const resolvedTo = entry.resizeMotion?.resolveNode(entry.to) || entry.to;
    entry.resized = resolvedFrom !== entry.from || resolvedTo !== entry.to;
    const from = translatePreviewNode(resolvedFrom, preview);
    const to = translatePreviewNode(resolvedTo, preview);
    entry.pathOrigin = from.position;
    entry.path.set({
        x: 0,
        y: 0,
        path: canvasConnectionPath(entry.connection, from, to, props.scriptScrollTopById[entry.from.id] || 0, props.scriptScrollTopById[entry.to.id] || 0, props.batchScrollById?.[entry.from.id], props.batchScrollById?.[entry.to.id]).pathD,
    });
}

function translatePreviewNode(node: CanvasNodeData, preview: CanvasNodeDragPreview | null) {
    if (!preview?.nodeIds.has(node.id) || (preview.x === 0 && preview.y === 0)) return node;
    return { ...node, position: { x: node.position.x + preview.x, y: node.position.y + preview.y } };
}

function syncConnectionDragMode(scene: UnderlayScene, entry: ConnectionSceneEntry) {
    const preview = scene.dragPreview;
    const moveFrom = Boolean(preview?.nodeIds.has(entry.from.id));
    const moveTo = Boolean(preview?.nodeIds.has(entry.to.id));
    const isBoundary = moveFrom !== moveTo;
    const group = moveFrom && moveTo && !scene.wholeLayerMoving ? scene.movingConnections : scene.connections;
    const wasBoundary = scene.dragEdges.has(entry);
    if (entry.path.parent !== group) group.add(entry.path);
    if (isBoundary) scene.dragEdges.add(entry);
    else scene.dragEdges.delete(entry);
    return isBoundary !== wasBoundary;
}

function applyConnectionDragPreview(scene: UnderlayScene, props: CanvasLeaferGraphicsLayerProps, preview: CanvasNodeDragPreview | null) {
    const previous = scene.dragPreview;
    scene.dragPreview = preview;
    if (previous?.nodeIds !== preview?.nodeIds) {
        scene.wholeLayerMoving = Boolean(preview && [...scene.connectionIdsByNodeId.keys()].every((nodeId) => preview.nodeIds.has(nodeId)));
        for (const entry of scene.connectionEntries.values()) {
            const changed = syncConnectionDragMode(scene, entry);
            if (changed && !scene.dragEdges.has(entry) && (previous?.x || previous?.y)) syncConnectionPath(entry, props, null);
        }
    }
    syncConnectionGroupOffset(scene);
    if (preview && ((previous?.x || 0) !== preview.x || (previous?.y || 0) !== preview.y || (previous?.nodeIds !== preview.nodeIds && (preview.x || preview.y || previous?.x || previous?.y)))) {
        for (const entry of scene.dragEdges) syncConnectionPath(entry, props, preview);
    }
}

function syncConnectionGroupOffset(scene: UnderlayScene) {
    const preview = scene.dragPreview;
    scene.connections.x = scene.wholeLayerMoving ? preview?.x || 0 : 0;
    scene.connections.y = scene.wholeLayerMoving ? preview?.y || 0 : 0;
    scene.movingConnections.x = !scene.wholeLayerMoving ? preview?.x || 0 : 0;
    scene.movingConnections.y = !scene.wholeLayerMoving ? preview?.y || 0 : 0;
}

function syncOverlayContent(scene: OverlayScene, props: CanvasLeaferGraphicsLayerProps, viewportScale: number) {
    const selection = props.selectionBox;
    scene.selection.visible = Boolean(selection);
    if (selection) {
        syncSelection(scene.selection, selection, props.theme);
    }

    const bounds = props.selectedNodeBounds;
    scene.selectionBounds.visible = Boolean(bounds && !selection);
    if (bounds && !selection) {
        syncSelectionBounds(scene.selectionBounds, liveSelectedNodeBounds(bounds, scene.dragPreview), viewportScale);
        scene.selectionBounds.stroke = props.theme.node.label;
    }
}

function syncSelection(rect: Rect, selection: SelectionBox, theme: CanvasTheme) {
    rect.set({
        x: Math.min(selection.startWorldX, selection.currentWorldX),
        y: Math.min(selection.startWorldY, selection.currentWorldY),
        width: Math.abs(selection.currentWorldX - selection.startWorldX),
        height: Math.abs(selection.currentWorldY - selection.startWorldY),
        fill: theme.canvas.selectionFill,
        stroke: theme.node.label,
        opacity: selection.hitMode === "intersect" ? 0.82 : 0.68,
    });
}

function syncViewport(viewport: ViewportTransform, width: number, height: number, underlay: UnderlayScene, overlay: OverlayScene, props: CanvasLeaferGraphicsLayerProps) {
    const scale = Math.max(viewport.k, 0.05);
    for (const scene of [underlay, overlay]) scene.world.set({ x: viewport.x, y: viewport.y, scaleX: scale, scaleY: scale });

    overlay.selection.set({
        strokeWidth: 1 / scale,
        cornerRadius: 2 / scale,
        dashPattern: [4 / scale, 4 / scale],
    });
    if (props.selectedNodeBounds) syncSelectionBounds(overlay.selectionBounds, liveSelectedNodeBounds(props.selectedNodeBounds, overlay.dragPreview), scale);
    overlay.selectionBounds.set({
        strokeWidth: 1 / scale,
        cornerRadius: 2 / scale,
        dashPattern: [4 / scale, 4 / scale],
        opacity: 0.68,
    });
    overlay.guides.set({
        stroke: props.theme.accent.primary,
        strokeWidth: 1 / scale,
        dashPattern: [5 / scale, 5 / scale],
        opacity: 0.72,
    });
    syncGuidePath(overlay, viewport, width, height);
}

function isViewportPreview(container: HTMLDivElement, viewport: ViewportTransform, rasterViewport: ViewportTransform) {
    return container.dataset.canvasViewportInteracting === "true" && !sameCanvasViewport(viewport, rasterViewport);
}

function applyScenePreview(viewport: ViewportTransform, rasterViewport: ViewportTransform, ...scenes: LeaferScene[]) {
    // 将已栅格画面的屏幕坐标映射到实时视口，缩放手势期间不触碰 Leafer 场景树。
    const { ratio, x, y } = calculateCanvasPreviewTransform(viewport, rasterViewport);
    for (const scene of scenes) {
        scene.host.style.transformOrigin = "0 0";
        scene.host.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${ratio})`;
        scene.host.style.willChange = "transform";
        scene.host.dataset.canvasLeaferPreview = "true";
    }
}

function hasScenePreview(...scenes: LeaferScene[]) {
    return scenes.some((scene) => scene.host.dataset.canvasLeaferPreview === "true");
}

function resetScenePreview(...scenes: LeaferScene[]) {
    for (const scene of scenes) {
        scene.host.style.transform = "";
        scene.host.style.transformOrigin = "";
        scene.host.style.willChange = "";
        delete scene.host.dataset.canvasLeaferPreview;
    }
}

function forceSceneRender(...scenes: LeaferScene[]) {
    for (const scene of scenes) scene.leafer.forceRender(undefined, true);
}

function liveSelectedNodeBounds(bounds: NonNullable<NodeBounds>, preview: CanvasNodeDragPreview | null) {
    return offsetSelectedNodeBounds(bounds, preview);
}

function syncLiveSelectionBounds(scene: OverlayScene, props: CanvasLeaferGraphicsLayerProps, viewportScale: number) {
    const bounds = props.selectedNodeBounds;
    const selection = props.selectionBox;
    scene.selectionBounds.visible = Boolean(bounds && !selection);
    if (!bounds || selection) return;
    syncSelectionBounds(scene.selectionBounds, liveSelectedNodeBounds(bounds, scene.dragPreview), viewportScale);
    scene.selectionBounds.stroke = props.theme.node.label;
}

function syncSelectionBounds(rect: Rect, bounds: NonNullable<NodeBounds>, viewportScale: number) {
    const padding = 12 / Math.max(viewportScale, 0.05);
    rect.set({
        x: bounds.left - padding,
        y: bounds.top - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2,
    });
}

function syncGuidePath(overlay: OverlayScene, viewport: ViewportTransform, width: number, height: number) {
    const guides = overlay.dragPreview?.guides;
    if (guides?.vertical === undefined && guides?.horizontal === undefined) {
        overlay.guides.visible = false;
        return;
    }
    const scale = Math.max(viewport.k, 0.05);
    const left = -viewport.x / scale;
    const top = -viewport.y / scale;
    const right = left + width / scale;
    const bottom = top + height / scale;
    const commands: string[] = [];
    if (typeof guides.vertical === "number") commands.push(`M ${guides.vertical} ${top} L ${guides.vertical} ${bottom}`);
    if (typeof guides.horizontal === "number") commands.push(`M ${left} ${guides.horizontal} L ${right} ${guides.horizontal}`);
    overlay.guides.set({ visible: true, path: commands.join(" ") });
}

function canvasPixelRatio() {
    return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}
