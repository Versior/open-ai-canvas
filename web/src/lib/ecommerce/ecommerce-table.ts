import { nanoid } from "nanoid";
import { canonicalize } from "json-canonicalize";
import { canvasGenerationInputPrompt } from "@/lib/canvas/canvas-generation-input-prompt";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasBatchRow, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { ecommerceOneClickFlow, type EcommerceOneClickFlowId } from "./ecommerce-oneclick";
import { resolveEcommerceTableModels } from "./ecommerce-model-defaults";
import type { EcommerceModel } from "./ecommerce-models";
import { CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION, ecommerceSuiteRows, migrateLegacyEcommerceSuite, type EcommerceSuite, type EcommerceSuiteRow } from "./ecommerce-suite";
import type { EcommerceSuiteTargets } from "./ecommerce-canvas-preset";
import { ecommerceMediaIdentity, mergeEcommercePrompt, resolveEcommerceInputs } from "./ecommerce-canvas";

export type EcommerceResultSourceSignature = (row: EcommerceSuiteRow, node: CanvasNodeData) => string | undefined;

/**
 * Inputs that can alter one generated image.
 *
 * Batch count never matters, and纯本地排版（layout）也不影响底图。但详情页让模型画字，
 * 文案是画面的一部分——所以文案必须进签名，否则改了标题还能把旧图当成当前结果。
 */
export function ecommerceGenerationSourceSignature(input: { source: CanvasNodeData; row: EcommerceSuiteRow; target: CanvasNodeData; nodes: CanvasNodeData[]; connections: CanvasConnection[]; config: AiConfig; customModels?: EcommerceModel[] }) {
    const { source, row, target, nodes, connections, config, customModels = [] } = input;
    const { imageModel } = resolveEcommerceTableModels(config, { imageModel: source.metadata?.ecommerceImageModel });
    if (!imageModel) return undefined;
    // 详情页的新合同行由图片模型画字：文案与版式都是画面的一部分，一起进底图与签名。
    // 其他用途走本地叠字，文案和版式都不进底图，改了只需重新合成。
    const flowId = target.metadata?.ecommerceFlowId || source.metadata?.ecommerceFlowId;
    const modelDrawsText = row.imagePromptContractVersion === 1 && flowId === "detail";
    const prepared = synchronizeGenerationSpec(target, {
        prompt: row.prompt,
        composerContent: row.prompt,
        model: imageModel,
        ...(source.metadata?.ecommerceImageSize?.trim() ? { size: source.metadata.ecommerceImageSize.trim() } : {}),
        ...(source.metadata?.ecommerceImageQuality?.trim() ? { quality: source.metadata.ecommerceImageQuality.trim() } : {}),
    });
    // 画布图里可能还是旧节点：source（表）与 target（产物）都要换成调用方传进来的那一份，
    // 否则解析仍按旧表读平台/设置，签名和真实请求就会各说一套。
    const graphNodes = nodes.map((node) => (node.id === prepared.id ? prepared : node.id === source.id ? source : node));
    if (!graphNodes.some((node) => node.id === source.id)) graphNodes.push(source);
    if (!graphNodes.some((node) => node.id === prepared.id)) graphNodes.push(prepared);
    // 传入的行是真相：画布表里存的可能还是旧行，读那边会让签名对文案不敏感。
    // 文案与版式只有一个来源——这条 rowsOverride，不是先写进 prepared 再让下游回读：
    // prepared 上的 ecommerceCopy/ecommerceLayout 没人读，写了也只是看起来在生效。
    // 只有文案真进底图时才覆盖；本地叠字的用途保持原读取路径，不无故让旧结果失效。
    const ecommerce = resolveEcommerceInputs(prepared.id, graphNodes, connections, customModels, modelDrawsText ? [row] : undefined);
    const generation = buildGenerationConfig(config, prepared, "image");
    const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
    // 尾巴只取**当前行**的画面段：真实请求准备节点时就把行提示词写进了 prepared.prompt（project.tsx），
    // 快照再从 prepared 上读回来拼。签名若改读 target 自己那份，产物节点还挂着旧画面 A 时，
    // 用户刚把画面改成 B 就会拿 A 去拼——两端各读一份，同源当场破裂。
    // 相机的附加段仍按 prepared 补，这是请求侧 canvasGenerationInputPrompt 的同一段逻辑。
    // 合并必须走请求侧同一个入口、同一个第三参数，两处各写一套必然一处去重一处保留。
    return JSON.stringify([
        // 与 project.tsx 准备节点、快照取提示词同一口径：都先 trim 掉表格里敲进去的尾空白，
        // 否则相机段会把空白夹在中间，trim 不掉，签名比真实请求多几个空格。
        mergeEcommercePrompt(ecommerce.prompt, canvasGenerationInputPrompt(prepared, "image", row.prompt.trim()), { visualPrompt: ecommerce.sources.visualPrompt }),
        ecommerce.referenceImages.map((reference) => {
            const identity = ecommerceMediaIdentity(nodeById.get(reference.id));
            return [reference.id, reference.storageKey || identity?.[1] || "", identity?.[2] || "", reference.type || identity?.[3] || "", identity?.[4] || ""];
        }),
        generation.model?.trim() || "",
        generation.size?.trim() || "",
        generation.quality?.trim() || "",
        generation.imageResolution?.trim() || "",
        generation.imageParameters?.trim() || "",
        generation.transparentBackground?.trim() || "",
    ]);
}

export function ecommerceResultSourceCurrent(node: CanvasNodeData, expected: string | undefined) {
    return Boolean(expected && node.metadata?.batchResultInputSignature === expected);
}

export function detachEcommerceTableOutputConnections(connections: CanvasConnection[], tableId: string) {
    return connections.filter((edge) => edge.fromNodeId !== tableId || edge.relation !== "batch-output");
}

/**
 * 补上当前版本号，但**不补行**：写出入口只记录用户确认过的结构，加屏只发生在真正的加载迁移里。
 */
function versionedEcommerceSuite(suite: EcommerceSuite) {
    return suite.schemaVersion === undefined ? { ...suite, schemaVersion: CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION } : suite;
}

export function ecommerceSuiteMetadata(metadata: CanvasNodeMetadata | undefined, suite: EcommerceSuite): CanvasNodeMetadata {
    const current = versionedEcommerceSuite(suite);
    // The canvas canonicalizer treats sibling paths with shared prefixes as cycles.
    return { ecommerceSuite: structuredClone(current), ecommerceSuitesByFlow: structuredClone({ ...metadata?.ecommerceSuitesByFlow, [current.flow]: current }) };
}

/** Replace a detail-page table skeleton while preserving its model and table settings. */
export function replaceEcommerceTableOutlineRows(table: CanvasNodeData, rows: EcommerceSuiteRow[]): CanvasNodeData {
    const cleanRows = rows.map(({ slotId, enabled, title, duty, prompt, stance }) => ({
        slotId,
        ...(enabled === undefined ? {} : { enabled }),
        title,
        duty,
        prompt,
        ...(stance ? { stance } : {}),
    }));
    const currentSuite = table.metadata?.ecommerceSuitesByFlow?.detail || (table.metadata?.ecommerceSuite?.flow === "detail" ? table.metadata.ecommerceSuite : undefined);
    const suite: EcommerceSuite = {
        ...(currentSuite || {}),
        flow: "detail",
        rows: cleanRows,
        source: "draft",
        updatedAt: new Date().toISOString(),
    };
    return {
        ...table,
        metadata: {
            ...table.metadata,
            ...ecommerceSuiteMetadata(table.metadata, suite),
            batchTable: {
                operation: "product",
                concurrency: 10,
                ...table.metadata?.batchTable,
                rows: cleanRows.map((row) => ({ id: row.slotId, enabled: row.enabled !== false, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } })),
            },
        },
    };
}

export function ecommerceTableMetadata(product: CanvasNodeData, flowId: EcommerceOneClickFlowId): CanvasNodeMetadata {
    const flow = ecommerceOneClickFlow(flowId)!;
    const suite: EcommerceSuite =
        product.metadata?.ecommerceSuitesByFlow?.[flowId] ||
        (product.metadata?.ecommerceSuite?.flow === flowId ? product.metadata.ecommerceSuite : { flow: flowId, rows: ecommerceSuiteRows(flow, undefined), source: "draft", updatedAt: new Date().toISOString() });
    // 读商品上的旧套图就是一次加载：结构升级发生在这里。两份表示都从迁移后的行派生，
    // 否则首次建表会得到「套装十行、表格九行」的错位。
    const current = migrateLegacyEcommerceSuite(suite);
    return {
        ecommerceProductId: product.id,
        ecommerceFlowId: flowId,
        ecommerceSuite: versionedEcommerceSuite(current),
        ecommerceAnalysisModel: product.metadata?.ecommerceAnalysisModel,
        ecommerceImageModel: product.metadata?.ecommerceImageModel,
        ecommerceImageSize: product.metadata?.ecommerceImageSize,
        ecommerceImageQuality: product.metadata?.ecommerceImageQuality,
        ecommerceBrief: product.metadata?.ecommerceBrief,
        ecommerceAnalysisSkillsByFlow: product.metadata?.ecommerceAnalysisSkillsByFlow,
        ecommerceAutoBind: product.metadata?.ecommerceAutoBind,
        batchTable: { operation: "product", concurrency: 10, rows: current.rows.map((row) => ({ id: row.slotId, enabled: row.enabled !== false, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } })) },
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

/** Batch rows already mirror the suite: same ids, order, skip flags, prompts and cells. */
function rowsMirrorSuite(rows: CanvasBatchRow[] | undefined, suite: EcommerceSuite) {
    return (
        rows?.length === suite.rows.length &&
        rows.every((row, index) => row.id === suite.rows[index].slotId && row.enabled === (suite.rows[index].enabled !== false) && row.prompt === suite.rows[index].prompt && row.cells?.title === suite.rows[index].title && row.cells?.duty === suite.rows[index].duty)
    );
}

/** A manually connected product activates the same workflow as the product buttons. */
export function syncEcommerceTables(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    let changed = false;
    const next = nodes.map((node) => {
        if (node.type !== CanvasNodeType.BatchTable || node.metadata?.locked) return node;
        if (node.metadata?.ecommerceFlowId) {
            const flowId = node.metadata.ecommerceFlowId as EcommerceOneClickFlowId;
            // A suite written for another flow is corrupt data: leave it alone rather than index a second flow here.
            const direct = node.metadata.ecommerceSuite?.flow === flowId ? node.metadata.ecommerceSuite : undefined;
            const indexed = node.metadata.ecommerceSuitesByFlow?.[flowId];
            // Two representations that disagree are ambiguous data: leave both untouched so no edit is silently discarded.
            if (direct && indexed && canonicalize(direct) !== canonicalize(indexed)) return node;
            const source = direct || indexed;
            if (!source) return node;
            const suite = versionedEcommerceSuite(migrateLegacyEcommerceSuite(source));
            const rows = node.metadata.batchTable?.rows;
            // Already current: no migration, both representations are separate copies and rows mirror the suite.
            if (direct && indexed && direct !== indexed && canonicalize(suite) === canonicalize(source) && rowsMirrorSuite(rows, suite)) return node;
            changed = true;
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    ...ecommerceSuiteMetadata(node.metadata, suite),
                    batchTable: {
                        operation: "product" as const,
                        concurrency: 10,
                        ...node.metadata.batchTable,
                        rows: suite.rows.map((row) => ({ id: row.slotId, enabled: row.enabled !== false, inputNodeIds: [], prompt: row.prompt, cells: { title: row.title, duty: row.duty } })),
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
                rows: node.metadata.batchTable.rows.map((row, i) => ({ slotId: row.id, enabled: row.enabled, title: String(row.cells?.title || "第 " + (i + 1) + " 张"), duty: String(row.cells?.duty || ""), prompt: row.prompt })),
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
export function ecommerceTableResults(rows: EcommerceSuiteRow[], outputs: CanvasNodeData[], flowId: string, sourceSignature?: EcommerceResultSourceSignature) {
    const candidates = new Map<string, CanvasNodeData[]>();
    for (const node of outputs) {
        const slot = node.metadata?.ecommerceShotId;
        if (node.type !== CanvasNodeType.Image || !slot || node.metadata?.ecommerceFlowId !== flowId) continue;
        candidates.set(slot, [...(candidates.get(slot) || []), node]);
    }
    const selected = new Map<string, CanvasNodeData>();
    const stale = new Map<string, CanvasNodeData[]>();
    for (const row of rows) {
        const images = candidates.get(row.slotId) || [];
        const current = sourceSignature ? images.filter((item) => ecommerceResultSourceCurrent(item, sourceSignature(row, item))) : images;
        if (sourceSignature)
            stale.set(
                row.slotId,
                images.filter((item) => !current.includes(item)),
            );
        const node = row.resultNodeId ? current.find((item) => item.id === row.resultNodeId) : [...current].reverse().find((item) => item.metadata?.storageKey && item.metadata.status !== "loading" && item.metadata.status !== "error") || current.at(-1);
        if (node) selected.set(row.slotId, node);
    }
    return { candidates, selected, stale };
}

export function ecommerceSelectedOutputs(table: CanvasNodeData, rows: EcommerceSuiteRow[], nodes: CanvasNodeData[], connections: CanvasConnection[], sourceSignature?: EcommerceResultSourceSignature) {
    const enabledRows = rows.filter((row) => row.enabled !== false);
    if (!enabledRows.length) throw new Error("创作表没有可装订的行");
    const downstream = new Set(connections.filter((edge) => edge.fromNodeId === table.id).map((edge) => edge.toNodeId));
    const { selected } = ecommerceTableResults(
        enabledRows,
        nodes.filter((node) => downstream.has(node.id)),
        table.metadata?.ecommerceFlowId || "",
        sourceSignature,
    );
    return enabledRows.map((row, index) => {
        const image = selected.get(row.slotId);
        if (!image?.metadata?.storageKey || image.metadata.status === "loading" || image.metadata.status === "error") {
            const chosen = row.resultNodeId ? nodes.find((node) => node.id === row.resultNodeId) : undefined;
            if (chosen && sourceSignature && !ecommerceResultSourceCurrent(chosen, sourceSignature(row, chosen))) throw new Error(`第 ${index + 1} 张来自旧方案，请重新生成`);
            throw new Error(`第 ${index + 1} 张尚无有效采用结果`);
        }
        return image;
    });
}

/** A completed analysis belongs to the exact brief, product facts and reference assets it read. */
export function ecommerceAnalysisSnapshot(source: CanvasNodeData, product: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], analysisModel?: string, skillIds?: string[]) {
    const inputs = connections
        .filter((edge) => edge.toNodeId === product.id || edge.toNodeId === source.id)
        .map(({ fromNodeId, toNodeId, fromHandleId, toHandleId, relation, storyboardRowId }) => ({ fromNodeId, toNodeId, fromHandleId, toHandleId, relation, storyboardRowId }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify([
        source.id,
        source.metadata?.locked,
        source.metadata?.ecommerceSuite,
        source.metadata?.ecommerceBrief,
        source.metadata?.ecommerceFlowId,
        product.id,
        product.metadata?.locked,
        product.metadata?.productProfile,
        analysisModel?.trim(),
        [...(skillIds || [])].sort(),
        inputs,
        inputs.map((edge) => ecommerceMediaIdentity(nodes.find((item) => item.id === edge.fromNodeId))),
    ]);
}

/** Put a new run beside its table without covering previous results. Product edges carry generation constraints. */
export function connectEcommerceTableOutputs(plan: EcommerceSuiteTargets, table: CanvasNodeData, nodes: CanvasNodeData[], existingConnections: CanvasConnection[] = []): EcommerceSuiteTargets {
    if (table.type !== CanvasNodeType.BatchTable) return plan;
    const batchOutputKeys = new Set(existingConnections.filter((edge) => edge.relation === "batch-output").map((edge) => `${edge.fromNodeId}\u0000${edge.toNodeId}\u0000${edge.storyboardRowId || ""}`));
    const connections = plan.connections.filter((edge) => {
        if (edge.relation !== "batch-output") return true;
        const key = `${edge.fromNodeId}\u0000${edge.toNodeId}\u0000${edge.storyboardRowId || ""}`;
        if (batchOutputKeys.has(key)) return false;
        batchOutputKeys.add(key);
        return true;
    });
    plan.nodeIds.forEach((id, index) => {
        const storyboardRowId = plan.rows[index]?.slotId;
        const key = `${table.id}\u0000${id}\u0000${storyboardRowId || ""}`;
        if (batchOutputKeys.has(key)) return;
        batchOutputKeys.add(key);
        connections.push({ id: nanoid(), fromNodeId: table.id, toNodeId: id, relation: "batch-output", storyboardRowId });
    });
    if (!plan.spawned.length) return { ...plan, connections };
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
        connections,
    };
}
