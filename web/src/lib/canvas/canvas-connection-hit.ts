import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position } from "@/types/canvas";
import { batchReferenceHandleAtY } from "./canvas-batch-table";
import type { BatchScroll } from "./canvas-batch-references";
import { getConnectionTargetAnchor, isHiddenBatchChild, storyboardHandleAtY } from "./canvas-project-domain";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "./canvas-frame";
import { buildCanvasSpatialIndex, canvasNodeBounds, type CanvasSpatialIndex } from "./canvas-spatial-index";

export type CanvasConnectionDropTarget = {
    nodeId: string | null;
    handleId?: string;
    anchorRatio?: number;
    isNearNode: boolean;
};

export type CanvasConnectionHitIndexCache = {
    query: (nodes: CanvasNodeData[], point: Position, radius: number, bodyNodeId?: string | null) => CanvasNodeData[];
};

/** Keeps the spatial index on immutable node snapshots while resolving IDs to current node objects. */
export function createCanvasConnectionHitIndexCache(): CanvasConnectionHitIndexCache {
    let source: CanvasNodeData[] | null = null;
    let index: CanvasSpatialIndex<string> = buildCanvasSpatialIndex([]);
    let nodeById = new Map<string, CanvasNodeData>();
    let requiresFullScan = false;

    return {
        query(nodes, point, radius, bodyNodeId) {
            if (source !== nodes) {
                source = nodes;
                nodeById = new Map(nodes.map((node) => [node.id, node]));
                requiresFullScan = nodes.some((node) => !isIndexableNode(node));
                index = requiresFullScan ? buildCanvasSpatialIndex([]) : buildCanvasSpatialIndex(nodes.map((node) => ({ id: node.id, bounds: canvasNodeBounds(node), value: node.id })));
            }
            if (requiresFullScan || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(radius) || radius < 0) return nodes;

            // Spatial bounds use exclusive edges; a tiny expansion keeps anchors exactly at radius eligible for the circular check below.
            const padding = radius + 0.01;
            const candidateIds = index.query({ left: point.x - padding, top: point.y - padding, right: point.x + padding, bottom: point.y + padding });
            if (bodyNodeId && nodeById.has(bodyNodeId) && !candidateIds.includes(bodyNodeId)) candidateIds.push(bodyNodeId);
            return candidateIds.map((id) => nodeById.get(id)).filter((node): node is CanvasNodeData => Boolean(node));
        },
    };
}

function isIndexableNode(node: CanvasNodeData) {
    return Boolean(node.id) && [node.position.x, node.position.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0;
}

export function resolveCanvasConnectionTarget({
    nodes,
    candidateNodes = nodes,
    current,
    point,
    radius,
    bodyNodeId,
    scriptScrollTopById,
    batchScrollById,
    canConnect,
}: {
    nodes: CanvasNodeData[];
    candidateNodes?: CanvasNodeData[];
    current: ConnectionHandle;
    point: Position;
    radius: number;
    bodyNodeId: string | null;
    scriptScrollTopById: Record<string, number>;
    batchScrollById?: Record<string, BatchScroll>;
    canConnect: (node: CanvasNodeData) => boolean;
}): CanvasConnectionDropTarget {
    const isEligible = (node: CanvasNodeData) => !isHiddenBatchChild(node, nodes) && !isNodeHiddenByCollapsedFrame(node, nodes) && !isFrameNode(node);
    const candidates = candidateNodes.filter(isEligible);
    const handleFor = (node: CanvasNodeData) =>
        node.type === CanvasNodeType.Script ? storyboardHandleAtY(node, point.y, scriptScrollTopById[node.id] || 0) : node.type === CanvasNodeType.BatchTable ? batchReferenceHandleAtY(node, point.y, radius) : undefined;
    const targetFor = (node: CanvasNodeData, handleId = handleFor(node)): CanvasConnectionDropTarget => {
        const missingHandle = (node.type === CanvasNodeType.Script || (node.type === CanvasNodeType.BatchTable && !node.metadata?.ecommerceFlowId)) && !handleId;
        return { nodeId: !missingHandle && canConnect(node) ? node.id : null, handleId, isNearNode: true };
    };
    // DOM 命中已经包含置顶、选中层级和卡片变换；不可连接的可见主体也阻止穿透。
    const body = candidates.find((node) => node.id === bodyNodeId);
    if (body) return targetFor(body);

    let isNearNode = false;
    for (const node of candidates.reverse()) {
        const scrollTop = scriptScrollTopById[node.id] || 0;
        const handleId = handleFor(node);
        const anchor = getConnectionTargetAnchor(node, current, handleId, scrollTop, batchScrollById?.[node.id]);
        // 没有可见主体时只测试端口圆，不把被遮挡的几何矩形重新当作主体。
        if (Math.hypot(point.x - anchor.x, point.y - anchor.y) > radius) continue;
        isNearNode = true;
        const target = targetFor(node, handleId);
        if (target.nodeId) return target;
    }
    return { nodeId: null, isNearNode };
}
