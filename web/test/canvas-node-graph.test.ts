import { expect, test } from 'bun:test';
import { createCanvasNodeGraph } from '../src/lib/canvas/canvas-node-graph';
import { getContextResourceNodes, getContextDownstreamResourceNodes } from '../src/lib/canvas/canvas-resource-references';
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from '../src/types/canvas';

test('indexed graph preserves resource edge order, input node order and self-loop semantics', () => {
    const nodes: CanvasNodeData[] = [
        { id: 'b', type: CanvasNodeType.Image, position: { x: 0, y: 0 } },
        { id: 'a', type: CanvasNodeType.Image, position: { x: 0, y: 0 } },
        { id: 'product', type: CanvasNodeType.Product, position: { x: 0, y: 0 } },
        { id: 'character', type: CanvasNodeType.Product, position: { x: 0, y: 0 }, metadata: { workflowKind: 'character', characterAssetId: 'asset' } },
    ];
    const edges: CanvasConnection[] = [
        { id: '1', fromNodeId: 'a', toNodeId: 'product' },
        { id: '2', fromNodeId: 'b', toNodeId: 'product' },
        { id: '3', fromNodeId: 'a', toNodeId: 'product' },
        { id: '4', fromNodeId: 'product', toNodeId: 'b', relation: 'batch-output' },
        { id: '5', fromNodeId: 'a', toNodeId: 'a' },
        { id: '6', fromNodeId: 'missing', toNodeId: 'product' },
        { id: '7', fromNodeId: 'character', toNodeId: 'product' },
    ];
    const graph = createCanvasNodeGraph(nodes, edges);
    for (const id of [...nodes.map(node => node.id), 'missing', 'absent']) {
        expect(graph.getUpstreamNodes(id)).toEqual(getContextResourceNodes(id, nodes, edges));
        expect(graph.getDownstreamNodes(id)).toEqual(getContextDownstreamResourceNodes(id, nodes, edges));
        expect(graph.getConnections(id)).toEqual(edges.filter(edge => edge.fromNodeId === id || edge.toNodeId === id));
        const ids = new Set(edges.filter(edge => edge.toNodeId === id && edge.relation !== 'batch-output').map(edge => edge.fromNodeId));
        expect(graph.getInputNodes(id)).toEqual(nodes.filter(node => ids.has(node.id)));
        expect(graph.getInputNodes(id)).toBe(graph.getInputNodes(id));
        expect(graph.getUpstreamNodes(id)).toBe(graph.getUpstreamNodes(id));
    }
});
