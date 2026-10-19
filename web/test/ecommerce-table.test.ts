import { expect, test } from 'bun:test';
import { canvasConnectionError } from '../src/lib/canvas/canvas-connection-policy';
import { createCanvasNode } from '../src/lib/canvas/canvas-project-domain';
import { defaultConfig } from '../src/stores/use-config-store';
import { CanvasNodeType } from '../src/types/canvas';
import { connectEcommerceTableOutputs, ecommerceTableSource, openEcommerceTable, syncEcommerceTables } from '../src/lib/ecommerce/ecommerce-table';
import { ecommerceSuiteTargets } from '../src/lib/ecommerce/ecommerce-canvas-preset';
import { ECOMMERCE_ONE_CLICK_FLOWS } from '../src/lib/ecommerce/ecommerce-oneclick';
import { syncBatchColumnReferences } from '../src/lib/canvas/canvas-batch-references';
import { batchReferenceHandleY } from '../src/lib/canvas/canvas-batch-table';
import { getConnectionTargetAnchor } from '../src/lib/canvas/canvas-project-domain';
import { upstreamEcommerceNodes } from '../src/lib/ecommerce/ecommerce-canvas';

test('four purposes create separate connected tables and reopening preserves edits', () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    let plan = openEcommerceTable([product], [], product.id, 'detail');
    const firstId = plan.table.id;
    const edited = { ...plan.table, metadata: { ...plan.table.metadata, ecommerceImageModel: 'chosen-model' } };
    plan = openEcommerceTable([product, edited], plan.connections, product.id, 'detail');
    expect(plan.table).toBe(edited);
    expect(plan.nodes).toHaveLength(2);
    expect(plan.connections).toHaveLength(1);
    for (const flow of ECOMMERCE_ONE_CLICK_FLOWS.slice(1)) plan = openEcommerceTable(plan.nodes, plan.connections, product.id, flow.id);
    const tables = plan.nodes.filter(node => node.type === CanvasNodeType.BatchTable);
    expect(tables).toHaveLength(4);
    expect(new Set(tables.map(table => table.metadata?.ecommerceFlowId)).size).toBe(4);
    expect(plan.connections.every(edge => edge.fromNodeId === product.id)).toBe(true);
    const repaired = openEcommerceTable(plan.nodes, [], product.id, 'detail');
    expect(repaired.table.id).toBe(firstId);
    expect(repaired.connections).toHaveLength(1);
    expect(repaired.table.metadata?.ecommerceImageModel).toBe('chosen-model');
});

test('product ownership and lock checks reject writes, while ordinary image tables remain usable', () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const other = { ...product, id: 'other-product' };
    const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 });
    const plan = openEcommerceTable([product, other], [], product.id, 'main');
    expect(() => ecommerceTableSource(plan.table, plan.nodes, [])).toThrow('连接一个商品');
    expect(() => ecommerceTableSource(plan.table, plan.nodes, [{ id: 'wrong', fromNodeId: other.id, toNodeId: plan.table.id }])).toThrow('不匹配');
    expect(canvasConnectionError(defaultConfig, plan.nodes, [], { fromNodeId: other.id, toNodeId: plan.table.id })).toContain('其他商品');
    expect(canvasConnectionError(defaultConfig, [...plan.nodes, image], [], { fromNodeId: image.id, toNodeId: plan.table.id })).toContain('只接受商品');
    const locked = { ...plan.table, metadata: { ...plan.table.metadata, locked: true } };
    expect(canvasConnectionError(defaultConfig, [product, locked], [], { fromNodeId: product.id, toNodeId: locked.id })).toContain('锁定');
    expect(() => ecommerceTableSource(locked, [product, locked], plan.connections)).toThrow('锁定');
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 });
    expect(canvasConnectionError(defaultConfig, [image, table], [], { fromNodeId: image.id, toNodeId: table.id })).toBe('');
    expect(canvasConnectionError(defaultConfig, [product, image, table], [{ id: 'image', fromNodeId: image.id, toNodeId: table.id }], { fromNodeId: product.id, toNodeId: table.id })).toContain('先断开');
});

test('manually connecting a product activates the workflow without replacing edited prompts', () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 900, y: 0 }, { batchTable: { operation: 'creative', concurrency: 3, rows: [{ id: 'mine', enabled: true, inputNodeIds: [], prompt: 'Keep this prompt' }] } });
    const edges = [{ id: 'product', fromNodeId: product.id, toNodeId: table.id }];
    const nodes = syncBatchColumnReferences(syncEcommerceTables([product, table], edges), edges);
    expect(nodes[1].metadata?.ecommerceSuite?.rows[0]).toMatchObject({ slotId: 'mine', prompt: 'Keep this prompt' });
    expect(nodes[1].metadata?.ecommerceProductId).toBe(product.id);
    const settled = syncEcommerceTables(nodes, edges);
    expect(settled[1].metadata?.batchTable?.rows[0].prompt).toBe('Keep this prompt');
    expect(syncEcommerceTables(settled, edges)).toBe(settled);
    expect(syncBatchColumnReferences(settled, edges)).toBe(settled);
    expect(batchReferenceHandleY(settled[1])).toBeUndefined();
    expect(getConnectionTargetAnchor(settled[1], { nodeId: product.id, handleType: 'source' }).y).toBe(settled[1].position.y + settled[1].height / 2);
});

test('table outputs retain product constraints and a later run does not cover earlier results', () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const { table, nodes, connections } = openEcommerceTable([product], [], product.id, 'main');
    const suite = { flow: 'main', source: 'draft' as const, updatedAt: '', rows: [{ slotId: 'main-1', title: 'Hero', duty: 'Show', prompt: 'Draw product' }] };
    let sequence = 0;
    const first = connectEcommerceTableOutputs(ecommerceSuiteTargets(product, ECOMMERCE_ONE_CLICK_FLOWS[1], suite, { nodes, connections }, {}, () => 'edge-' + ++sequence), table, nodes);
    expect(first.connections.some(edge => edge.fromNodeId === table.id && edge.relation === 'batch-output')).toBe(true);
    const allNodes = [...nodes, ...first.spawned];
    const allEdges = [...connections, ...first.connections];
    expect(upstreamEcommerceNodes(first.nodeIds[0], allNodes, allEdges).product?.id).toBe(product.id);
    const second = connectEcommerceTableOutputs(ecommerceSuiteTargets(product, ECOMMERCE_ONE_CLICK_FLOWS[1], suite, { nodes: allNodes, connections: allEdges }, {}, () => 'edge-' + ++sequence), table, allNodes);
    expect(second.spawned[0].position.y).toBeGreaterThanOrEqual(first.spawned[0].position.y + first.spawned[0].height);
    expect(first.spawned[0].position.x).toBeGreaterThan(table.position.x + table.width);
    expect(second.spawned[0].metadata?.prompt).toBe('Draw product');
});

test('a product can connect to a creation table while unrelated text remains rejected', () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 900, y: 0 });
    const text = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 });
    expect(canvasConnectionError(defaultConfig, [product, table], [], { fromNodeId: product.id, toNodeId: table.id })).toBe('');
    expect(canvasConnectionError(defaultConfig, [text, table], [], { fromNodeId: text.id, toNodeId: table.id })).not.toBe('');
});
