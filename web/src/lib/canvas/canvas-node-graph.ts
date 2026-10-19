import { getNodeResourceKind } from './node-registry';
import type { CanvasConnection, CanvasNodeData } from '@/types/canvas';

/** One snapshot index per canvas update, shared by all node queries. */
export function createCanvasNodeGraph(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const incoming = new Map<string, CanvasConnection[]>();
    const outgoing = new Map<string, CanvasConnection[]>();
    const attached = new Map<string, CanvasConnection[]>();
    const append = (map: Map<string, CanvasConnection[]>, id: string, edge: CanvasConnection) => {
        const entries = map.get(id);
        if (entries) entries.push(edge); else map.set(id, [edge]);
    };
    for (const edge of connections) {
        append(incoming, edge.toNodeId, edge);
        append(outgoing, edge.fromNodeId, edge);
        append(attached, edge.fromNodeId, edge);
        if (edge.toNodeId !== edge.fromNodeId) append(attached, edge.toNodeId, edge);
    }
    const resources = (edges: CanvasConnection[], direction: 'fromNodeId' | 'toNodeId') => edges
        .map(edge => byId.get(edge[direction]))
        .filter((node): node is CanvasNodeData => Boolean(node && (node.metadata?.workflowKind === 'character' && node.metadata.characterAssetId || getNodeResourceKind(node))));
    const inputs = new Map<string, CanvasNodeData[]>();
    for (const [id, edges] of incoming) {
        const ids = new Set(edges.filter(edge => edge.relation !== 'batch-output').map(edge => edge.fromNodeId));
        inputs.set(id, [...ids].map(source => byId.get(source)).filter((node): node is CanvasNodeData => Boolean(node)));
    }
    // Input numbering historically follows node order, whereas resource queries
    // follow edge order. Preserve both contracts.
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    for (const list of inputs.values()) list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const upstream = new Map([...incoming].map(([id, edges]) => [id, resources(edges, 'fromNodeId')]));
    const downstream = new Map([...outgoing].map(([id, edges]) => [id, resources(edges, 'toNodeId')]));
    const noNodes: CanvasNodeData[] = [];
    const noEdges: CanvasConnection[] = [];
    return {
        getUpstreamNodes: (id: string) => upstream.get(id) ?? noNodes,
        getDownstreamNodes: (id: string) => downstream.get(id) ?? noNodes,
        getInputNodes: (id: string) => inputs.get(id) ?? noNodes,
        getConnections: (id: string) => attached.get(id) ?? noEdges,
    };
}
