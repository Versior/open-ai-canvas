import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import { observeCanvasGestureActive, subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview, type CanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { beforeDragBounds } from "@/lib/canvas/canvas-drag-window";
import { canvasNodeRenderPadding } from "@/lib/canvas/canvas-render-budget";
import type { CanvasSpatialBounds } from "@/lib/canvas/canvas-spatial-index";
import type { CanvasViewportSize } from "@/lib/canvas/canvas-viewport";
import type { CanvasDisplayConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type Preview = { nodes: CanvasNodeData[]; connections: CanvasDisplayConnection[] };
type Query = (view: CanvasSpatialBounds, bounds: CanvasSpatialBounds, scale: number, drag: CanvasNodeDragPreview | null) => Preview;
const EMPTY: Preview = { nodes: [], connections: [] };

function screenBounds(view: ViewportTransform, size: CanvasViewportSize, padding: number): CanvasSpatialBounds {
    return { left: (-view.x - padding) / view.k, top: (-view.y - padding) / view.k, right: (size.width - view.x + padding) / view.k, bottom: (size.height - view.y + padding) / view.k };
}

function covers(outer: CanvasSpatialBounds, inner: CanvasSpatialBounds) {
    return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

export function CanvasGestureRenderWindow({
    containerRef,
    viewport,
    size,
    query,
    connections,
    filterConnections,
    children,
}: {
    containerRef: RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    size: CanvasViewportSize;
    query: Query;
    connections: CanvasDisplayConnection[];
    filterConnections: (entries: CanvasDisplayConnection[]) => CanvasDisplayConnection[];
    children: (nodes: CanvasNodeData[], connections: CanvasDisplayConnection[]) => ReactNode;
}) {
    const [snapshot, setSnapshot] = useState<{ query: Query; viewport: ViewportTransform; preview: Preview } | null>(null);
    const latest = useRef<ViewportTransform | null>(null);
    const latestDrag = useRef<CanvasNodeDragPreview | null>(null);
    const preview = snapshot?.query === query && snapshot.viewport === viewport ? snapshot.preview : EMPTY;
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const padding = canvasNodeRenderPadding(false);
        let covered = screenBounds(viewport, size, padding);
        let dragCovered = screenBounds(viewport, size, 0);
        let previous = EMPTY;
        const update = () => {
            const next = latest.current ?? viewport;
            const drag = latestDrag.current;
            const view = screenBounds(next, size, 0);
            if (covers(covered, view) && (!drag || covers(dragCovered, beforeDragBounds(view, drag)))) return;
            covered = screenBounds(next, size, padding);
            dragCovered = drag ? beforeDragBounds(covered, drag) : view;
            const result = query(view, covered, next.k, drag);
            if (
                result.nodes.length === previous.nodes.length &&
                result.connections.length === previous.connections.length &&
                result.nodes.every((node, index) => node === previous.nodes[index]) &&
                result.connections.every((entry, index) => entry.connection === previous.connections[index].connection)
            )
                return;
            previous = result;
            setSnapshot({ query, viewport, preview: result });
        };
        const stopPreview = subscribeCanvasGraphicsViewportPreview(container, (next) => {
            if (container.dataset.canvasViewportInteracting !== "true") return;
            latest.current = next;
            update();
        });
        const stopDrag = subscribeCanvasNodeDragPreview(container, (drag) => {
            latestDrag.current = drag;
            if (drag) update();
        });
        if (latest.current || latestDrag.current) update();
        const stopGesture = observeCanvasGestureActive(container.ownerDocument, () => {
            if (container.dataset.canvasViewportInteracting || container.dataset.canvasNodeDragging) return;
            latest.current = null;
            latestDrag.current = null;
            covered = screenBounds(viewport, size, padding);
            dragCovered = screenBounds(viewport, size, 0);
            previous = EMPTY;
            setSnapshot(null);
        });
        return () => {
            stopPreview();
            stopDrag();
            stopGesture();
        };
    }, [containerRef, query, size, viewport]);
    const visibleConnections = useMemo(() => filterConnections(preview.connections.length ? [...connections, ...preview.connections] : connections), [connections, filterConnections, preview.connections]);
    return children(preview.nodes, visibleConnections);
}
