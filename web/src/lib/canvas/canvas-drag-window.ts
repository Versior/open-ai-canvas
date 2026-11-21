import type { CanvasNodeDragPreview } from "./canvas-live-viewport";
import type { CanvasIndexedConnection } from "./canvas-connection-index";
import type { CanvasSpatialBounds, CanvasSpatialIndex } from "./canvas-spatial-index";
import type { CanvasNodeData } from "@/types/canvas";

export function beforeDragBounds(bounds: CanvasSpatialBounds, offset: { x: number; y: number }): CanvasSpatialBounds {
    return { left: bounds.left - offset.x, right: bounds.right - offset.x, top: bounds.top - offset.y, bottom: bounds.bottom - offset.y };
}

export function queryDraggedCanvasContent(
    bounds: CanvasSpatialBounds,
    drag: CanvasNodeDragPreview,
    nodeIndex: CanvasSpatialIndex<string>,
    connectionIndex: CanvasSpatialIndex<CanvasIndexedConnection>,
    nodeById: ReadonlyMap<string, CanvasNodeData>,
    coveredIds: ReadonlySet<string>,
    coveredEdges: ReadonlySet<string>,
    connectionBudget: number,
) {
    const source = beforeDragBounds(bounds, drag);
    const nodes: CanvasNodeData[] = [];
    for (const id of nodeIndex.query(source)) {
        if (!drag.nodeIds.has(id) || coveredIds.has(id)) continue;
        const node = nodeById.get(id);
        if (node) nodes.push(node);
    }

    const connections = [];
    const swept = { left: Math.min(bounds.left, source.left), right: Math.max(bounds.right, source.right), top: Math.min(bounds.top, source.top), bottom: Math.max(bounds.bottom, source.bottom) };
    for (const { connection, fromId, toId } of connectionIndex.query(swept)) {
        if (connections.length >= connectionBudget) break;
        if (coveredEdges.has(connection.id)) continue;
        const moveFrom = drag.nodeIds.has(fromId),
            moveTo = drag.nodeIds.has(toId);
        if (!moveFrom && !moveTo) continue;
        const from = nodeById.get(fromId),
            to = nodeById.get(toId);
        if (!from || !to) continue;
        const fromX = from.position.x + (moveFrom ? drag.x : 0),
            fromY = from.position.y + (moveFrom ? drag.y : 0);
        const toX = to.position.x + (moveTo ? drag.x : 0),
            toY = to.position.y + (moveTo ? drag.y : 0);
        if (Math.min(fromX, toX) >= bounds.right || Math.max(fromX + from.width, toX + to.width) <= bounds.left || Math.min(fromY, toY) >= bounds.bottom || Math.max(fromY + from.height, toY + to.height) <= bounds.top) continue;
        connections.push({ connection, from, to });
    }
    return { nodes, connections };
}
