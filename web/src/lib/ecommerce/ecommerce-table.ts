import { nanoid } from "nanoid";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { ecommerceOneClickFlow, type EcommerceOneClickFlowId } from "./ecommerce-oneclick";
import { ecommerceSuiteRows, type EcommerceSuite, type EcommerceSuiteRow } from "./ecommerce-suite";
import type { EcommerceSuiteTargets } from "./ecommerce-canvas-preset";

export function ecommerceSuiteMetadata(metadata: CanvasNodeMetadata | undefined, suite: EcommerceSuite): CanvasNodeMetadata {
    // The canvas canonicalizer treats sibling paths with shared prefixes as cycles.
    return { ecommerceSuite: structuredClone(suite), ecommerceSuitesByFlow: structuredClone({ ...metadata?.ecommerceSuitesByFlow, [suite.flow]: suite }) };
}

export function ecommerceTableMetadata(product: CanvasNodeData, flowId: EcommerceOneClickFlowId): CanvasNodeMetadata {
    const flow = ecommerceOneClickFlow(flowId)!;
    const suite: EcommerceSuite =
        product.metadata?.ecommerceSuitesByFlow?.[flowId] ||
        (product.metadata?.ecommerceSuite?.flow === flowId ? product.metadata.ecommerceSuite : { flow: flowId, rows: ecommerceSuiteRows(flow, undefined), source: "draft", updatedAt: new Date().toISOString() });
    return {
        ecommerceProductId: product.id,
        ecommerceFlowId: flowId,
        ecommerceSuite: suite,
        ecommerceAnalysisModel: product.metadata?.ecommerceAnalysisModel,
        ecommerceImageModel: product.metadata?.ecommerceImageModel,
        ecommerceImageSize: product.metadata?.ecommerceImageSize,
        ecommerceImageQuality: product.metadata?.ecommerceImageQuality,
        ecommerceBrief: product.metadata?.ecommerceBrief,
        ecommerceAnalysisSkillsByFlow: product.metadata?.ecommerceAnalysisSkillsByFlow,
        ecommerceAutoBind: product.metadata?.ecommerceAutoBind,
        batchTable: { operation: "product", concurrency: 10, rows: suite.rows.map((row) => ({ id: row.slotId, enabled: true, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } })) },
    };
}

/** Reopening a purpose focuses its existing table and repairs a removed input edge. */
export function openEcommerceTable(nodes: CanvasNodeData[], connections: CanvasConnection[], productId: string, flowId: EcommerceOneClickFlowId) {
    const product = nodes.find((node) => node.id === productId && node.type === CanvasNodeType.Product);
    if (!product || product.metadata?.locked) throw new Error("商品已删除或锁定");
    const flow = ecommerceOneClickFlow(flowId);
    if (!flow) throw new Error("未知的电商创作用途");
    let table = nodes.find((node) => node.type === CanvasNodeType.BatchTable && node.metadata?.ecommerceProductId === productId && node.metadata.ecommerceFlowId === flowId);
    if (!table) {
        table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, ecommerceTableMetadata(product, flowId));
        const x = product.position.x + (product.width || 420) + 160;
        let y = product.position.y;
        for (const other of [...nodes].sort((a, b) => a.position.y - b.position.y)) {
            if (other.position.x < x + table.width! && other.position.x + (other.width || 320) > x && other.position.y < y + table.height! && other.position.y + (other.height || 300) > y) y = other.position.y + (other.height || 300) + 80;
        }
        table = { ...table, title: flow.name + " · 创作表", position: { x, y } };
        nodes = [...nodes, table];
    }
    const incoming = connections.filter((edge) => edge.toNodeId === table.id);
    if (incoming.some((edge) => edge.fromNodeId !== productId)) throw new Error("此创作表已连接其他输入，请先断开");
    if (!incoming.length) {
        if (table.metadata?.locked) throw new Error("创作表已锁定");
        connections = [...connections, { id: nanoid(), fromNodeId: productId, toNodeId: table.id }];
    }
    return { nodes, connections, table };
}

/** A manually connected product activates the same workflow as the product buttons. */
export function syncEcommerceTables(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    let changed = false;
    const next = nodes.map((node) => {
        if (node.type !== CanvasNodeType.BatchTable || node.metadata?.locked) return node;
        if (node.metadata?.ecommerceFlowId) {
            const suite = node.metadata.ecommerceSuite;
            if (!suite) return node;
            const rows = node.metadata.batchTable?.rows;
            if (rows?.length === suite.rows.length && rows.every((row, index) => row.id === suite.rows[index].slotId && row.prompt === suite.rows[index].prompt && row.cells?.title === suite.rows[index].title && row.cells?.duty === suite.rows[index].duty))
                return node;
            changed = true;
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    batchTable: {
                        operation: "product" as const,
                        concurrency: 10,
                        ...node.metadata.batchTable,
                        rows: suite.rows.map((row) => ({ id: row.slotId, enabled: true, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } })),
                    },
                },
            };
        }
        const edge = connections.find((edge) => edge.toNodeId === node.id && nodes.some((source) => source.id === edge.fromNodeId && source.type === CanvasNodeType.Product));
        if (!edge) return node;
        const product = nodes.find((source) => source.id === edge.fromNodeId)!;
        const metadata = ecommerceTableMetadata(product, "main");
        // Preserve edited rows when an existing creation table receives a product.
        if (node.metadata?.batchTable?.rows.length)
            metadata.ecommerceSuite = {
                ...metadata.ecommerceSuite!,
                rows: node.metadata.batchTable.rows.map((row, i) => ({ slotId: row.id, title: String(row.cells?.title || "第 " + (i + 1) + " 张"), duty: String(row.cells?.duty || ""), prompt: row.prompt })),
            };
        changed = true;
        return { ...node, metadata: { ...node.metadata, ...metadata } };
    });
    return changed ? next : nodes;
}

export function ecommerceTableSource(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const source = nodes.find((item) => item.id === node.id);
    if (!source || source.metadata?.locked) throw new Error("创作节点已删除或锁定");
    if (source.type === CanvasNodeType.Product) return { source, product: source };
    if (source.type !== CanvasNodeType.BatchTable || !ecommerceOneClickFlow(source.metadata?.ecommerceFlowId)) throw new Error("不是电商创作表");
    const products = nodes.filter((item) => item.type === CanvasNodeType.Product && connections.some((edge) => edge.toNodeId === source.id && edge.fromNodeId === item.id));
    if (products.length !== 1) throw new Error("请为创作表连接一个商品节点");
    if (source.metadata?.ecommerceProductId && products[0].id !== source.metadata.ecommerceProductId) throw new Error("创作表与商品不匹配，请连接原商品或新建创作表");
    if (products[0].metadata?.locked) throw new Error("商品已锁定");
    return { source, product: products[0] };
}

/** Only this table's connected image outputs can be adopted or exported. */
export function ecommerceTableResults(rows: EcommerceSuiteRow[], outputs: CanvasNodeData[], flowId: string) {
    const candidates = new Map<string, CanvasNodeData[]>();
    for (const node of outputs) {
        const slot = node.metadata?.ecommerceShotId;
        if (node.type !== CanvasNodeType.Image || !slot || node.metadata?.ecommerceFlowId !== flowId) continue;
        candidates.set(slot, [...(candidates.get(slot) || []), node]);
    }
    const selected = new Map<string, CanvasNodeData>();
    for (const row of rows) {
        const images = candidates.get(row.slotId) || [];
        const node = row.resultNodeId ? images.find((item) => item.id === row.resultNodeId) : [...images].reverse().find((item) => item.metadata?.storageKey && item.metadata.status !== "loading" && item.metadata.status !== "error") || images.at(-1);
        if (node) selected.set(row.slotId, node);
    }
    return { candidates, selected };
}

export function ecommerceSelectedOutputs(table: CanvasNodeData, rows: EcommerceSuiteRow[], nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (!rows.length) throw new Error("创作表没有可装订的行");
    const downstream = new Set(connections.filter((edge) => edge.fromNodeId === table.id).map((edge) => edge.toNodeId));
    const { selected } = ecommerceTableResults(
        rows,
        nodes.filter((node) => downstream.has(node.id)),
        table.metadata?.ecommerceFlowId || "",
    );
    return rows.map((row, index) => {
        const image = selected.get(row.slotId);
        if (!image?.metadata?.storageKey || image.metadata.status === "loading" || image.metadata.status === "error") throw new Error(`第 ${index + 1} 张尚无有效采用结果`);
        return image;
    });
}

/** A completed analysis belongs to the exact brief, product facts and reference assets it read. */
export function ecommerceAnalysisSnapshot(source: CanvasNodeData, product: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const inputs = connections.filter((edge) => edge.toNodeId === product.id || edge.toNodeId === source.id);
    return JSON.stringify([
        source.id,
        source.metadata?.locked,
        source.metadata?.ecommerceSuite,
        source.metadata?.ecommerceBrief,
        source.metadata?.ecommerceFlowId,
        product.id,
        product.metadata?.locked,
        product.metadata?.productProfile,
        inputs,
        inputs.map((edge) => {
            const input = nodes.find((item) => item.id === edge.fromNodeId);
            return [input?.id, input?.metadata?.storageKey, input?.metadata?.content];
        }),
    ]);
}

/** Put a new run beside its table without covering previous results. Product edges carry generation constraints. */
export function connectEcommerceTableOutputs(plan: EcommerceSuiteTargets, table: CanvasNodeData, nodes: CanvasNodeData[]): EcommerceSuiteTargets {
    if (table.type !== CanvasNodeType.BatchTable || !plan.spawned.length) return plan;
    const columns = Math.min(5, plan.spawned.length);
    const width = Math.max(...plan.spawned.map((node) => node.width));
    const height = Math.max(...plan.spawned.map((node) => node.height));
    const x = table.position.x + table.width + 160;
    const right = x + columns * (width + 80) - 80;
    const blockHeight = Math.ceil(plan.spawned.length / columns) * (height + 60) - 60;
    let y = table.position.y;
    for (const other of [...nodes].sort((a, b) => a.position.y - b.position.y)) {
        if (other.position.x < right && other.position.x + other.width > x && other.position.y < y + blockHeight && other.position.y + other.height > y) y = other.position.y + other.height + 80;
    }
    return {
        ...plan,
        spawned: plan.spawned.map((node, index) => ({ ...node, position: { x: x + (index % columns) * (width + 80), y: y + Math.floor(index / columns) * (height + 60) } })),
        connections: [...plan.connections, ...plan.nodeIds.map((id, index) => ({ id: nanoid(), fromNodeId: table.id, toNodeId: id, relation: "batch-output" as const, storyboardRowId: plan.rows[index]?.slotId }))],
    };
}
