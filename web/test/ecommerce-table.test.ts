import { expect, test } from "bun:test";
import { canvasConnectionError } from "../src/lib/canvas/canvas-connection-policy";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection } from "../src/types/canvas";
import {
    connectEcommerceTableOutputs,
    detachEcommerceTableOutputConnections,
    ecommerceGenerationSourceSignature,
    ecommerceTableMetadata,
    ecommerceTableSource,
    openEcommerceTable,
    replaceEcommerceTableOutlineRows,
    syncEcommerceTables,
    ecommerceTableResults,
    ecommerceAnalysisSnapshot,
    ecommerceSelectedOutputs,
} from "../src/lib/ecommerce/ecommerce-table";
import { ecommerceSuiteTargets } from "../src/lib/ecommerce/ecommerce-canvas-preset";
import { CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION, ecommerceSuiteDraftPrompt } from "../src/lib/ecommerce/ecommerce-suite";
import { createEcommerceLayout, type EcommerceLayoutBlock } from "../src/lib/ecommerce/ecommerce-layout";
import { ECOMMERCE_FLOW_ASPECT, ECOMMERCE_ONE_CLICK_FLOWS, ecommerceOneClickFlow } from "../src/lib/ecommerce/ecommerce-oneclick";
import { syncBatchColumnReferences } from "../src/lib/canvas/canvas-batch-references";
import { batchReferenceHandleY } from "../src/lib/canvas/canvas-batch-table";
import { getConnectionTargetAnchor } from "../src/lib/canvas/canvas-project-domain";
import { mergeEcommercePrompt, resolveEcommerceInputs, upstreamEcommerceNodes } from "../src/lib/ecommerce/ecommerce-canvas";
import { canvasGenerationInputPrompt } from "../src/lib/canvas/canvas-generation-input-prompt";
import { createCanvasBatchInputSnapshot } from "../src/lib/canvas/canvas-batch-input-snapshot";
import { ecommerceSuiteMetadata } from "../src/lib/ecommerce/ecommerce-table";
import { canvasPersistentNodes } from "../src/lib/canvas/canvas-persistent-nodes";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import type { EcommerceModel } from "../src/lib/ecommerce/ecommerce-models";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectImageParameters } from "../src/lib/image-parameters";
import { nodeGenerationPrompt, synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { canGenerateImageInPlace } from "../src/lib/canvas/canvas-generation-layout";
import { mediaVersionFieldsBeforeReplace } from "../src/lib/canvas/canvas-media-versions";

test("template and analysis suite writes survive actual canvas persistence comparison", () => {
    const before = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 });
    const suite = { flow: "main", source: "draft" as const, updatedAt: "", rows: [{ slotId: "hero", title: "Hero", duty: "Show product", prompt: "" }] };
    const after = { ...before, metadata: { ...before.metadata, ...ecommerceSuiteMetadata(before.metadata, suite) } };
    expect(() => canvasPersistentNodes([after], [before])).not.toThrow();
    expect(after.metadata.ecommerceSuitesByFlow?.main).toEqual({ ...suite, schemaVersion: CURRENT_ECOMMERCE_SUITE_SCHEMA_VERSION });
    expect(after.metadata.ecommerceSuitesByFlow?.main).not.toBe(after.metadata.ecommerceSuite);
});

test("four purposes create separate connected tables and reopening preserves edits", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    let plan = openEcommerceTable([product], [], product.id, "detail");
    const firstId = plan.table.id;
    const edited = { ...plan.table, metadata: { ...plan.table.metadata, ecommerceImageModel: "chosen-model" } };
    plan = openEcommerceTable([product, edited], plan.connections, product.id, "detail");
    expect(plan.table).toBe(edited);
    expect(plan.nodes).toHaveLength(2);
    expect(plan.connections).toHaveLength(1);
    for (const flow of ECOMMERCE_ONE_CLICK_FLOWS.slice(1)) plan = openEcommerceTable(plan.nodes, plan.connections, product.id, flow.id);
    const tables = plan.nodes.filter((node) => node.type === CanvasNodeType.BatchTable);
    expect(tables).toHaveLength(4);
    expect(new Set(tables.map((table) => table.metadata?.ecommerceFlowId)).size).toBe(4);
    expect(plan.connections.every((edge) => edge.fromNodeId === product.id)).toBe(true);
    const repaired = openEcommerceTable(plan.nodes, [], product.id, "detail");
    expect(repaired.table.id).toBe(firstId);
    expect(repaired.connections).toHaveLength(1);
    expect(repaired.table.metadata?.ecommerceImageModel).toBe("chosen-model");
});

test("outline rows replace stale detail-page rows without resetting table settings", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const { table } = openEcommerceTable([product], [], product.id, "detail");
    const staleRow = {
        slotId: "old-row",
        enabled: true,
        title: "Old title",
        duty: "Old duty",
        prompt: "Old prompt",
        resultNodeId: "old-result",
        copy: { headline: "Old", subhead: "Old", cta: "Old", price: "99" },
        layout: { name: "Old layout", blocks: [] },
    };
    const existing = {
        ...table,
        metadata: {
            ...table.metadata,
            ecommerceSuite: { flow: "detail", source: "preset" as const, updatedAt: "old", rows: [staleRow] },
            ecommerceSuitesByFlow: {
                ...table.metadata?.ecommerceSuitesByFlow,
                detail: { flow: "detail", source: "preset" as const, updatedAt: "old", rows: [staleRow] },
            },
            ecommerceAnalysisModel: "vision-model",
            ecommerceImageModel: "image-model",
            ecommerceImageSize: "1024x1536",
            ecommerceImageQuality: "hd",
            ecommerceAnalysisSkillsByFlow: { detail: ["skill-a"] },
            batchTable: {
                ...table.metadata!.batchTable!,
                concurrency: 3,
                globalPrompt: "keep this",
                rows: [{ id: "old-row", enabled: true, inputNodeIds: [], prompt: "Old prompt", cells: { title: "Old title", duty: "Old duty" }, outputNodeId: "old-result", generatedInputSignature: "old-signature", inputChanged: true }],
            },
        },
    };
    const rows = [
        {
            slotId: "detail-1",
            enabled: false,
            title: "Pain point",
            duty: "Explain the problem",
            prompt: "",
            stance: "differentiate" as const,
            resultNodeId: "discard-result",
            copy: { headline: "Discard", subhead: "", cta: "", price: "" },
            layout: { name: "Discard layout", blocks: [] },
        },
    ];

    const updated = replaceEcommerceTableOutlineRows(existing, rows);
    const cleanRows = [{ slotId: "detail-1", enabled: false, title: "Pain point", duty: "Explain the problem", prompt: "", stance: "differentiate" }];

    expect(updated.metadata?.ecommerceSuite?.rows).toEqual(cleanRows);
    expect(updated.metadata?.ecommerceSuite?.source).toBe("draft");
    expect(updated.metadata?.ecommerceSuitesByFlow?.detail?.rows).toEqual(cleanRows);
    expect(updated.metadata?.batchTable?.rows).toEqual([{ id: "detail-1", enabled: false, inputNodeIds: [], prompt: "", cells: { title: "Pain point", duty: "Explain the problem" } }]);
    expect(updated.metadata?.ecommerceAnalysisModel).toBe("vision-model");
    expect(updated.metadata?.ecommerceImageModel).toBe("image-model");
    expect(updated.metadata?.ecommerceImageSize).toBe("1024x1536");
    expect(updated.metadata?.ecommerceImageQuality).toBe("hd");
    expect(updated.metadata?.ecommerceAnalysisSkillsByFlow).toEqual({ detail: ["skill-a"] });
    expect(updated.metadata?.batchTable?.concurrency).toBe(3);
    expect(updated.metadata?.batchTable?.globalPrompt).toBe("keep this");
    expect(existing.metadata.ecommerceSuite.rows[0].resultNodeId).toBe("old-result");
});

test("opening a table from a legacy nine-screen product suites both representations in step", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, {
        ecommerceSuitesByFlow: {
            detail: {
                flow: "detail",
                source: "preset" as const,
                updatedAt: "old",
                rows: Array.from({ length: 9 }, (_, i) => ({ slotId: `detail-${i + 1}`, title: `旧 ${i + 1}`, duty: "旧职责", prompt: `旧提示词 ${i + 1}` })),
            },
        },
    });
    const { table } = openEcommerceTable([product], [], product.id, "detail");
    const suiteRows = table.metadata!.ecommerceSuite!.rows;
    const batchRows = table.metadata!.batchTable!.rows;
    expect(suiteRows.map((row) => row.slotId)).toEqual(Array.from({ length: 10 }, (_, i) => `detail-${i + 1}`));
    // 首次返回就得两份一致，否则建表那一刻表格是九行、套装是十行。
    expect(batchRows.map((row) => row.id)).toEqual(suiteRows.map((row) => row.slotId));
    expect(batchRows.map((row) => row.prompt)).toEqual(suiteRows.map((row) => row.prompt));
});

test("outline replacement detaches only the target table outputs", () => {
    const connections: CanvasConnection[] = [
        { id: "target-output", fromNodeId: "detail-table", toNodeId: "old-image", relation: "batch-output" },
        { id: "other-output", fromNodeId: "other-table", toNodeId: "other-image", relation: "batch-output" },
        { id: "target-context", fromNodeId: "detail-table", toNodeId: "note" },
        { id: "product-input", fromNodeId: "product", toNodeId: "detail-table" },
    ];

    expect(detachEcommerceTableOutputConnections(connections, "detail-table")).toEqual(connections.slice(1));
});
test("product ownership and lock checks reject writes, while ordinary image tables remain usable", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const other = { ...product, id: "other-product" };
    const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 });
    const plan = openEcommerceTable([product, other], [], product.id, "main");
    expect(() => ecommerceTableSource(plan.table, plan.nodes, [])).toThrow("连接一个商品");
    expect(() => ecommerceTableSource(plan.table, plan.nodes, [{ id: "wrong", fromNodeId: other.id, toNodeId: plan.table.id }])).toThrow("不匹配");
    expect(canvasConnectionError(defaultConfig, plan.nodes, [], { fromNodeId: other.id, toNodeId: plan.table.id })).toContain("其他商品");
    expect(canvasConnectionError(defaultConfig, [...plan.nodes, image], [], { fromNodeId: image.id, toNodeId: plan.table.id })).toContain("只接受商品");
    const locked = { ...plan.table, metadata: { ...plan.table.metadata, locked: true } };
    expect(canvasConnectionError(defaultConfig, [product, locked], [], { fromNodeId: product.id, toNodeId: locked.id })).toContain("锁定");
    expect(() => ecommerceTableSource(locked, [product, locked], plan.connections)).toThrow("锁定");
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 });
    expect(canvasConnectionError(defaultConfig, [image, table], [], { fromNodeId: image.id, toNodeId: table.id })).toBe("");
    expect(canvasConnectionError(defaultConfig, [product, image, table], [{ id: "image", fromNodeId: image.id, toNodeId: table.id }], { fromNodeId: product.id, toNodeId: table.id })).toContain("先断开");
});

test("manually connecting a product activates the workflow without replacing edited prompts", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 900, y: 0 }, { batchTable: { operation: "creative", concurrency: 3, rows: [{ id: "mine", enabled: true, inputNodeIds: [], prompt: "Keep this prompt" }] } });
    const edges = [{ id: "product", fromNodeId: product.id, toNodeId: table.id }];
    const nodes = syncBatchColumnReferences(syncEcommerceTables([product, table], edges), edges);
    expect(nodes[1].metadata?.ecommerceSuite?.rows[0]).toMatchObject({ slotId: "mine", prompt: "Keep this prompt" });
    expect(nodes[1].metadata?.ecommerceProductId).toBe(product.id);
    const settled = syncEcommerceTables(nodes, edges);
    expect(settled[1].metadata?.batchTable?.rows[0].prompt).toBe("Keep this prompt");
    expect(syncEcommerceTables(settled, edges)).toBe(settled);
    expect(syncBatchColumnReferences(settled, edges)).toBe(settled);
    expect(batchReferenceHandleY(settled[1])).toBeUndefined();
    expect(getConnectionTargetAnchor(settled[1], { nodeId: product.id, handleType: "source" }).y).toBe(settled[1].position.y + settled[1].height / 2);
});

test("creation tables preserve skipped rows in both synchronization directions", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const suite = {
        flow: "main",
        source: "draft" as const,
        updatedAt: "",
        rows: [
            { slotId: "main-1", title: "Skip", duty: "Skip it", prompt: "", enabled: false },
            { slotId: "main-2", title: "Keep", duty: "Keep it", prompt: "Draw product" },
        ],
    };
    const owned = { ...product, metadata: { ...product.metadata, ecommerceSuitesByFlow: { main: suite } } };
    const metadata = ecommerceTableMetadata(owned, "main");
    expect(metadata.batchTable?.rows.map((row) => row.enabled)).toEqual([false, true]);

    const stale = createCanvasNode(CanvasNodeType.BatchTable, { x: 900, y: 0 }, { ...metadata, batchTable: { ...metadata.batchTable!, rows: metadata.batchTable!.rows.map((row) => ({ ...row, enabled: true })) } });
    const synced = syncEcommerceTables([owned, stale], []);
    expect(synced[1].metadata?.batchTable?.rows.map((row) => row.enabled)).toEqual([false, true]);

    const plain = createCanvasNode(CanvasNodeType.BatchTable, { x: 900, y: 500 }, { batchTable: { operation: "creative", concurrency: 3, rows: [{ id: "mine", enabled: false, inputNodeIds: [], prompt: "Keep this prompt" }] } });
    const connected = syncEcommerceTables([product, plain], [{ id: "product", fromNodeId: product.id, toNodeId: plain.id }]);
    expect(connected[1].metadata?.ecommerceSuite?.rows[0].enabled).toBe(false);
});

test("table outputs retain product constraints and a later run reuses the formal result with media history", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const { table, nodes, connections } = openEcommerceTable([product], [], product.id, "main");
    const suite = { flow: "main", source: "draft" as const, updatedAt: "", rows: [{ slotId: "main-1", title: "Hero", duty: "Show", prompt: "Draw product" }] };
    let sequence = 0;
    const first = connectEcommerceTableOutputs(
        ecommerceSuiteTargets(product, ECOMMERCE_ONE_CLICK_FLOWS[1], suite, { nodes, connections }, {}, () => "edge-" + ++sequence),
        table,
        nodes,
    );
    expect(first.connections.some((edge) => edge.fromNodeId === table.id && edge.relation === "batch-output")).toBe(true);
    const formal = { ...first.spawned[0], metadata: { ...first.spawned[0].metadata, storageKey: "image:old", status: "success" as const } };
    const allNodes = [...nodes, formal];
    const allEdges = [...connections, ...first.connections];
    expect(upstreamEcommerceNodes(formal.id, allNodes, allEdges).product?.id).toBe(product.id);
    const second = connectEcommerceTableOutputs(
        ecommerceSuiteTargets(product, ECOMMERCE_ONE_CLICK_FLOWS[1], suite, { nodes: allNodes, connections: allEdges }, {}, () => "edge-" + ++sequence),
        table,
        allNodes,
    );
    expect(formal.position.x).toBeGreaterThan(table.position.x + table.width);
    expect(formal.metadata?.generationResultPlacement).toBe("replace-node");
    expect(canGenerateImageInPlace(formal)).toBe(true);
    expect(mediaVersionFieldsBeforeReplace(formal).mediaVersions?.[0].media.storageKey).toBe("image:old");
    expect(second.spawned).toEqual([]);
    expect(second.reuse).toEqual([{ slotId: "main-1", nodeId: formal.id, prompt: "Draw product" }]);
    expect(second.nodeIds).toEqual([formal.id]);
});

test("reused formal outputs restore missing table edges without duplicating existing slot edges", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const { table, nodes, connections } = openEcommerceTable([product], [], product.id, "main");
    const rows = [
        { slotId: "main-1", title: "Hero", duty: "Show", prompt: "Draw hero" },
        { slotId: "main-2", title: "Benefit", duty: "Explain", prompt: "Draw benefit" },
    ];
    const first = createCanvasNode(CanvasNodeType.Image, { x: 1400, y: 0 }, { ecommerceShotId: rows[0].slotId, ecommerceProductId: product.id, ecommerceFlowId: "main" });
    const second = createCanvasNode(CanvasNodeType.Image, { x: 1800, y: 0 }, { ecommerceShotId: rows[1].slotId, ecommerceProductId: product.id, ecommerceFlowId: "main" });
    let sequence = 0;
    const plan = ecommerceSuiteTargets(product, ECOMMERCE_ONE_CLICK_FLOWS[1], { flow: "main", source: "draft", updatedAt: "", rows }, { nodes: [...nodes, first, second], connections }, {}, () => `edge-${++sequence}`);
    const connected = connectEcommerceTableOutputs(
        {
            ...plan,
            connections: [
                ...plan.connections,
                { id: "existing-a", fromNodeId: table.id, toNodeId: first.id, relation: "batch-output", storyboardRowId: rows[0].slotId },
                { id: "duplicate-a", fromNodeId: table.id, toNodeId: first.id, relation: "batch-output", storyboardRowId: rows[0].slotId },
            ],
        },
        table,
        [...nodes, first, second],
    );

    expect(connected.spawned).toEqual([]);
    expect(connected.connections.filter((edge) => edge.fromNodeId === table.id && edge.relation === "batch-output").map((edge) => [edge.toNodeId, edge.storyboardRowId])).toEqual([
        [first.id, "main-1"],
        [second.id, "main-2"],
    ]);
});

test("a product can connect to a creation table while unrelated text remains rejected", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 900, y: 0 });
    const text = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 });
    expect(canvasConnectionError(defaultConfig, [product, table], [], { fromNodeId: product.id, toNodeId: table.id })).toBe("");
    expect(canvasConnectionError(defaultConfig, [text, table], [], { fromNodeId: text.id, toNodeId: table.id })).not.toBe("");
});

test("adopted outputs remain selected across new runs and missing selections never silently fall back", () => {
    const first = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "image:first", ecommerceShotId: "hero", ecommerceFlowId: "main" });
    const second = { ...first, id: "second", metadata: { ...first.metadata, storageKey: "image:second" } };
    const pending = { ...first, id: "pending", metadata: { ...first.metadata, status: "loading" as const } };
    const rows = [{ slotId: "hero", title: "Hero", duty: "Show", prompt: "Product" }];
    expect(ecommerceTableResults(rows, [first, second, pending], "main").selected.get("hero")?.id).toBe(second.id);
    const chosen = [{ ...rows[0], resultNodeId: first.id }];
    expect(ecommerceTableResults(chosen, [first, second], "main").selected.get("hero")?.id).toBe(first.id);
    expect(ecommerceTableResults(chosen, [second], "main").selected.has("hero")).toBe(false);
    expect(ecommerceTableResults(rows, [first], "detail").candidates.size).toBe(0);
});

test("suite results are selectable only for the current generation source", () => {
    const row = { slotId: "hero", title: "Hero", duty: "Show", prompt: "Current prompt", copy: { headline: "A", subhead: "", cta: "", price: "" }, layout: { name: "Layout A", blocks: [] } };
    const signature = "current-generation-source";
    const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceShotId: "hero", ecommerceFlowId: "main", storageKey: "image:result", batchResultInputSignature: signature });
    const source = (currentRow: typeof row) => (currentRow.prompt === row.prompt ? signature : "changed-generation-source");

    expect(ecommerceTableResults([row], [image], "main", (current) => source(current as typeof row)).selected.get("hero")?.id).toBe(image.id);
    expect(ecommerceTableResults([{ ...row, prompt: "Changed" }], [image], "main", (current) => source(current as typeof row)).selected.has("hero")).toBe(false);
    expect(ecommerceTableResults([{ ...row, resultNodeId: image.id, prompt: "Changed" }], [image], "main", (current) => source(current as typeof row)).selected.has("hero")).toBe(false);
    expect(source({ ...row, copy: { ...row.copy, headline: "B" }, layout: { name: "Layout B", blocks: [] } })).toBe(signature);
});

test("generation source signature follows compiled product and model inputs but ignores local composition", () => {
    const row = { slotId: "hero", title: "Hero", duty: "Show", prompt: "Clean product hero", copy: { headline: "A", subhead: "", cta: "", price: "" }, layout: { name: "Layout A", blocks: [] } };
    const imageCapability = projectImageParameters(defaultImageCapabilityConfig("openai-image", "image-model"), [
        { name: "size", label: "Size", type: "string", values: ["1:1", "4:5"], default: "1:1" },
        { name: "quality", label: "Quality", type: "string", values: ["low", "high"], default: "low" },
        { name: "imageResolution", label: "Resolution", type: "string", values: ["auto", "2K"], default: "auto" },
        { name: "transparentBackground", label: "Transparent", type: "boolean", default: false },
        { name: "count", label: "Count", type: "integer", min: 1, max: 4, default: 1 },
        { name: "style", label: "Style", type: "string", values: ["plain", "vivid"], default: "plain" },
    ]);
    const channel = createModelChannel({
        id: "images",
        models: ["image-model", "other-model"],
        modelCosts: ["image-model", "other-model"].map((model) => ({
            model,
            capability: "image" as const,
            protocol: "openai-image" as const,
            capabilityConfig: { version: 1 as const, image: imageCapability },
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 1,
        })),
    });
    const imageModel = encodeChannelModel(channel.id, "image-model");
    const otherModel = encodeChannelModel(channel.id, "other-model");
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("Black mug"), ecommerceModelId: "model-a" });
    const source = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, { ecommerceImageModel: imageModel, ecommerceImageSize: "1:1", ecommerceImageQuality: "low" });
    const reference = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "product:front", assetId: "asset-front", content: "https://signed.example/private.png?token=secret" });
    const target = synchronizeGenerationSpec(createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { prompt: row.prompt, ecommerceShotId: row.slotId, ecommerceProductId: product.id, ecommerceFlowId: "main" }), { model: imageModel });
    const connections: CanvasConnection[] = [
        { id: "front", fromNodeId: reference.id, toNodeId: product.id, toHandleId: "product-view:front" },
        { id: "product-output", fromNodeId: product.id, toNodeId: target.id },
        { id: "table-output", fromNodeId: source.id, toNodeId: target.id, relation: "batch-output" },
    ];
    const models: EcommerceModel[] = [
        { id: "model-a", name: "Model A", kind: "custom", refs: ["model:a:front"], tags: [], createdAt: "", lastUsedAt: "" },
        { id: "model-b", name: "Model B", kind: "custom", refs: ["model:b:front"], tags: [], createdAt: "", lastUsedAt: "" },
    ];
    const config = { ...defaultConfig, channels: [channel], imageModel, imageModels: [imageModel, otherModel] };
    const signature = (currentProduct = product, currentRow = row, currentModels = models, currentSource = source, currentTarget = target, currentConfig = config) =>
        ecommerceGenerationSourceSignature({ source: currentSource, row: currentRow, target: currentTarget, nodes: [currentSource, currentProduct, reference, currentTarget], connections, config: currentConfig, customModels: currentModels });
    const initial = signature();

    expect(signature({ ...product, metadata: { ...product.metadata, productProfile: { ...product.metadata!.productProfile!, appearance: "Glossy red" } } })).not.toBe(initial);
    expect(signature({ ...product, metadata: { ...product.metadata, ecommerceModelId: "model-b" } })).not.toBe(initial);
    expect(signature(product, row, [{ ...models[0], refs: ["model:a:side"] }, models[1]])).not.toBe(initial);
    expect(signature(product, row, models, { ...source, metadata: { ...source.metadata, ecommerceImageModel: otherModel } })).not.toBe(initial);
    expect(signature(product, row, models, { ...source, metadata: { ...source.metadata, ecommerceImageSize: "4:5" } })).not.toBe(initial);
    expect(signature(product, row, models, { ...source, metadata: { ...source.metadata, ecommerceImageQuality: "high" } })).not.toBe(initial);
    expect(signature(product, row, models, source, synchronizeGenerationSpec(target, { transparentBackground: "true" }))).not.toBe(initial);
    expect(signature(product, row, models, source, synchronizeGenerationSpec(target, { imageResolution: "2K" }))).not.toBe(initial);
    expect(signature(product, row, models, source, synchronizeGenerationSpec(target, { imageParameters: JSON.stringify({ style: "vivid" }) }))).not.toBe(initial);
    expect(signature(product, row, models, source, { ...target, metadata: { ...target.metadata, cameraControl: { enabled: true, camera: "arri_alexa_mini_lf", lens: "cooke_s7i", focalLength: 50, aperture: 2.8 } } })).not.toBe(initial);
    expect(signature(product, row, models, source, synchronizeGenerationSpec(target, { count: 4 }))).toBe(initial);
    expect(signature(product, { ...row, copy: { ...row.copy, headline: "B" }, layout: { name: "Layout B", blocks: [] } })).toBe(initial);
    expect(initial).not.toContain("token=secret");
});

test("detail signature follows the passed row copy and every editable layout field", () => {
    const imageCapability = projectImageParameters(defaultImageCapabilityConfig("openai-image", "image-model"), [
        { name: "size", label: "Size", type: "string", values: ["1:1", "3:4"], default: "1:1" },
        { name: "quality", label: "Quality", type: "string", values: ["low", "high"], default: "low" },
    ]);
    const channel = createModelChannel({
        id: "images",
        models: ["image-model"],
        modelCosts: [
            {
                model: "image-model",
                capability: "image" as const,
                protocol: "openai-image" as const,
                capabilityConfig: { version: 1 as const, image: imageCapability },
                billingMode: "fixed_request" as const,
                unitPriceMicrocredits: 1,
            },
        ],
    });
    const imageModel = encodeChannelModel(channel.id, "image-model");
    const config = { ...defaultConfig, channels: [channel], imageModel, imageModels: [imageModel] };
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("Black mug") });
    // 画布上表里存的还是旧行；传入的是用户刚改过的草稿行。
    // 版式控件能改的每一项都在这儿：位置、字号、字色、垫底色（含「不垫」）、留白、加粗。
    const layoutBlock = (patch: Partial<EcommerceLayoutBlock> = {}): EcommerceLayoutBlock => ({
        id: "block-headline",
        field: "headline",
        anchor: "bottom-left",
        size: 8,
        color: "#1A1A1A",
        plate: "#FFFFFFCC",
        align: "left",
        inset: 6,
        bold: true,
        ...patch,
    });
    const layoutOf = (patch: Partial<EcommerceLayoutBlock> = {}) => ({ name: "Stored layout", blocks: [layoutBlock(patch)] });
    const storedRow = {
        slotId: "detail-1",
        title: "Detail",
        duty: "Show",
        // 画面段用真实骨架的长相（带画面标签）：只有无标签的整段才会被当成「用户补充」再拼一次尾部。
        prompt: "画面构成：3:4 竖版，浅灰背景，马克杯居中，柔和顶光\n产品摆放：杯柄朝右，杯口略高于视平线",
        imagePromptContractVersion: 1 as const,
        copy: { headline: "Stored headline", subhead: "", cta: "", price: "" },
        layout: layoutOf(),
    };
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, {
        ecommerceFlowId: "detail",
        ecommerceSuitesByFlow: { detail: { flow: "detail", rows: [storedRow], source: "draft" as const, updatedAt: "stored" } },
    });
    const target = synchronizeGenerationSpec(createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { prompt: storedRow.prompt, ecommerceShotId: storedRow.slotId, ecommerceProductId: product.id, ecommerceFlowId: "detail", batchSourceNodeId: table.id }), { model: imageModel });
    // 图上的表仍是旧行，产物节点也还挂着旧文案旧版式——真实场景里用户刚改完表格还没保存。
    const graphTable = { ...table, metadata: { ...table.metadata, ecommerceSuitesByFlow: { detail: { flow: "detail", rows: [storedRow], source: "draft" as const, updatedAt: "stored" } } } };
    const staleNodeTarget = synchronizeGenerationSpec({ ...target, metadata: { ...target.metadata, ecommerceCopy: { headline: "Stale node headline", subhead: "", cta: "", price: "" }, ecommerceLayout: layoutOf({ anchor: "top-center" }) } }, {});
    const connections: CanvasConnection[] = [{ id: "product", fromNodeId: product.id, toNodeId: target.id }];
    const draftRow = { ...storedRow, copy: { ...storedRow.copy, headline: "Draft headline" } };
    const signature = (currentRow = storedRow, currentTarget = target) =>
        ecommerceGenerationSourceSignature({ source: graphTable, row: currentRow, target: currentTarget, nodes: [graphTable, product, currentTarget], connections, config });

    const initial = signature();
    // 草稿行是真相：改了文案就得换签名，哪怕画布表里存的还是旧行。
    expect(signature(draftRow)).not.toBe(initial);
    expect(signature({ ...storedRow, copy: { ...storedRow.copy, headline: "Another headline" } })).not.toBe(signature(draftRow));
    // 产物节点自己带着旧文案时也一样：行是唯一真相，节点旧值不得反超。
    expect(signature(draftRow, staleNodeTarget)).toBe(signature(draftRow));
    expect(signature(draftRow, staleNodeTarget)).not.toBe(initial);
    // model 让图片模型画字，版式也是画面的一部分：任何一个可调项改了都必须重画。
    // 只测 name 或 size 会漏掉色值、垫底、留白、字重——用户调完这些看到的还是旧图。
    const layoutEdited = (patch: Partial<EcommerceLayoutBlock>) => signature({ ...draftRow, layout: layoutOf(patch) });
    const editable = signature(draftRow);
    expect(layoutEdited({ anchor: "top-center" }), "位置改了要重画").not.toBe(editable);
    expect(layoutEdited({ size: 12 }), "字号改了要重画").not.toBe(editable);
    expect(layoutEdited({ color: "#C8341F" }), "字色改了要重画").not.toBe(editable);
    expect(layoutEdited({ plate: "#000000CC" }), "垫底色改了要重画").not.toBe(editable);
    expect(layoutEdited({ plate: "" }), "取消垫底要重画").not.toBe(editable);
    expect(layoutEdited({ inset: 20 }), "留白改了要重画").not.toBe(editable);
    expect(layoutEdited({ bold: false }), "字重改了要重画").not.toBe(editable);
    // 不只是「变了」——这些值本身必须在签名里，否则是别的字段在抖、这一项其实漏了。
    expect(layoutEdited({ color: "#C8341F" })).toContain("#C8341F");
    expect(layoutEdited({ plate: "#000000CC" })).toContain("#000000CC");
    expect(layoutEdited({ plate: "" })).toContain("不垫底色");
    expect(layoutEdited({ inset: 20 })).toContain("距边约短边 20%");
    expect(layoutEdited({ size: 12 })).toContain("短边 12%");
    expect(layoutEdited({ bold: false })).toContain("常规字重");
    expect(editable).toContain("短边 8%");
    expect(editable).toContain("加粗");
    // 同内容的版式换对象不算变化。
    expect(signature({ ...draftRow, layout: layoutOf() })).toBe(editable);
    // graph 表与产物节点都还是旧值：新版式仍要按传入行算，不能被旧的盖回去。
    expect(layoutEdited({ color: "#C8341F" })).toBe(signature({ ...draftRow, layout: layoutOf({ color: "#C8341F" }) }, staleNodeTarget));
    expect(signature({ ...draftRow, layout: layoutOf({ color: "#C8341F" }) }, staleNodeTarget)).not.toBe(editable);
    // 清空排版不回退到产物节点上的旧版式，也不等于「还带着那套版式」。
    const staleLayoutTarget = { ...target, metadata: { ...target.metadata, ecommerceLayout: { name: "Stale layout", blocks: [layoutBlock({ anchor: "top-center" })] } } };
    expect(signature({ ...draftRow, layout: undefined }, staleLayoutTarget)).toBe(signature({ ...draftRow, layout: undefined }));
    expect(signature({ ...draftRow, layout: undefined }, staleLayoutTarget)).not.toBe(signature(draftRow));
    // 旧 source 节点上的 copy 不能盖掉传入行。
    const staleTarget = { ...target, metadata: { ...target.metadata, ecommerceCopy: { headline: "Stale node copy", subhead: "", cta: "", price: "" } } };
    expect(signature(draftRow, staleTarget)).toBe(signature(draftRow));
    // 行被清空文案也不能回退到节点旧值——"我明明删了字"不能又冒出来。
    expect(signature({ ...draftRow, copy: undefined }, staleTarget)).toBe(signature({ ...draftRow, copy: undefined }));
    expect(signature({ ...draftRow, copy: undefined }, staleTarget)).not.toBe(signature(draftRow));

    // 上面都是「签名变了」。真正要保证的是**同一个来源**：签名里的提示词，就是这次请求会发出去的提示词。
    // 任何一步偷偷改回读 graph 里的旧行，这里都会当场对不上。
    // 走请求侧的同一个合并入口、同一个尾巴来源。两条真实路径的尾巴都是**当前行**：
    // 实时生成先把行提示词写进节点再执行，批量快照从 prepared 上读回来——
    // 都不会拿产物节点上残留的旧画面。这里按同样口径复算，签名必须一字不差地等于它。
    const requestPrompt = (currentRow = storedRow, currentTarget = target) => {
        const prepared = synchronizeGenerationSpec(currentTarget, { prompt: currentRow.prompt, composerContent: currentRow.prompt });
        const graphNodes = [graphTable, product, prepared];
        const resolved = resolveEcommerceInputs(prepared.id, graphNodes, connections, [], [currentRow]);
        return mergeEcommercePrompt(resolved.prompt, canvasGenerationInputPrompt(prepared, "image", currentRow.prompt), { visualPrompt: resolved.sources.visualPrompt });
    };
    const editedLayoutRow = { ...draftRow, layout: layoutOf({ color: "#C8341F", inset: 20, bold: false }) };
    expect(requestPrompt(editedLayoutRow)).toContain("#C8341F");
    expect(requestPrompt(editedLayoutRow)).toContain("距边约短边 20%");
    expect(requestPrompt(editedLayoutRow)).toContain("常规字重");
    // 请求内容与签名同源：签名第一格以这次请求的提示词开头，一字不差（解析 JSON 再看，别比转义后的串）。
    // 尾巴是产物节点自己的补充提示词，签名历来一并计入；这里核对的是电商那一段必须真的来自同一个来源。
    const signaturePrompt = (currentRow = storedRow, currentTarget = target) => JSON.parse(signature(currentRow, currentTarget)!)[0];
    expect(signaturePrompt(editedLayoutRow).startsWith(requestPrompt(editedLayoutRow))).toBe(true);
    // 更硬的一条：批量快照会真的把这份提示词冻进队列。签名与快照必须一字不差，
    // 否则用户改完看到的那张图和「当前方案」判定各说一套。
    const snapshotPrompt = (currentRow = storedRow, currentTarget = target) => {
        const prepared = synchronizeGenerationSpec(currentTarget, { prompt: currentRow.prompt, composerContent: currentRow.prompt });
        const tableWithRow = { ...graphTable, metadata: { ...graphTable.metadata, ecommerceSuitesByFlow: { detail: { flow: "detail" as const, rows: [currentRow], source: "draft" as const, updatedAt: "current" } } } };
        return createCanvasBatchInputSnapshot(prepared, [tableWithRow, product, prepared], connections, []).context.prompt;
    };
    const marketingRow = { ...draftRow, prompt: `${draftRow.prompt}\n主标题：通勤一路温热` };
    expect(signaturePrompt(editedLayoutRow)).toBe(snapshotPrompt(editedLayoutRow));
    expect(signaturePrompt(marketingRow)).toBe(snapshotPrompt(marketingRow));
    // 产物节点上还挂着旧画面 A、行已经改成 B：两边都只能出现 B。
    const staleVisualTarget = synchronizeGenerationSpec({ ...target, metadata: { ...target.metadata, prompt: undefined, composerContent: undefined } }, { prompt: "画面构成：旧画面 A", composerContent: "画面构成：旧画面 A" });
    expect(snapshotPrompt(editedLayoutRow, staleVisualTarget)).not.toContain("旧画面 A");
    expect(signaturePrompt(editedLayoutRow, staleVisualTarget)).not.toContain("旧画面 A");
    // 合并入口也必须是同一个：画面段在请求里只能出现一次，尾部再拼一次就是重复回注。
    const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
    expect(occurrences(signaturePrompt(editedLayoutRow), editedLayoutRow.prompt)).toBe(1);
    expect(occurrences(requestPrompt(editedLayoutRow), editedLayoutRow.prompt)).toBe(1);
    // 画面段里混着的营销行（旧第九段的残渣）两处都必须剔掉，不能一处去重一处保留。
    expect(requestPrompt(marketingRow)).not.toContain("主标题：通勤一路温热");
    expect(signaturePrompt(marketingRow)).not.toContain("主标题：通勤一路温热");
    expect(signature(editedLayoutRow, staleNodeTarget)).toBe(signature(editedLayoutRow));
    // 清空文案：请求里不能出现节点旧字，签名也不能假装还带着它。
    const clearedRow = { ...draftRow, copy: undefined };
    expect(requestPrompt(clearedRow, staleTarget)).not.toContain("Stale node copy");
    expect(requestPrompt(clearedRow, staleTarget)).toContain("不生成主标题文字");
    expect(signaturePrompt(clearedRow, staleTarget).startsWith(requestPrompt(clearedRow, staleTarget))).toBe(true);
    // graph 表里存的是旧行；请求走的是新行，所以旧文案一个字都不能漏进去。
    expect(requestPrompt(editedLayoutRow)).not.toContain("Stored headline");
});

test("local text mode keeps the signature stable across every layout edit", () => {
    const imageCapability = projectImageParameters(defaultImageCapabilityConfig("openai-image", "image-model"), [
        { name: "size", label: "Size", type: "string", values: ["1:1"], default: "1:1" },
        { name: "quality", label: "Quality", type: "string", values: ["low"], default: "low" },
    ]);
    const channel = createModelChannel({
        id: "images",
        models: ["image-model"],
        modelCosts: [
            {
                model: "image-model",
                capability: "image" as const,
                protocol: "openai-image" as const,
                capabilityConfig: { version: 1 as const, image: imageCapability },
                billingMode: "fixed_request" as const,
                unitPriceMicrocredits: 1,
            },
        ],
    });
    const imageModel = encodeChannelModel(channel.id, "image-model");
    const config = { ...defaultConfig, channels: [channel], imageModel, imageModels: [imageModel] };
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("Black mug") });
    const layoutBlock = (patch: Partial<EcommerceLayoutBlock> = {}): EcommerceLayoutBlock => ({
        id: "block-headline",
        field: "headline",
        anchor: "bottom-left",
        size: 8,
        color: "#1A1A1A",
        plate: "#FFFFFFCC",
        align: "left",
        inset: 6,
        bold: true,
        ...patch,
    });
    const layoutOf = (patch: Partial<EcommerceLayoutBlock> = {}) => ({ name: "Layout", blocks: [layoutBlock(patch)] });
    const row = {
        slotId: "hero",
        title: "Hero",
        duty: "Show",
        prompt: "Clean product shot",
        imagePromptContractVersion: 1 as const,
        copy: { headline: "A", subhead: "", cta: "", price: "" },
        layout: layoutOf(),
    };
    // 非详情页：文案交给本地确定性排版，底图不含字，版式变化不该让旧图失效。
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, {
        ecommerceFlowId: "main",
        ecommerceSuitesByFlow: { main: { flow: "main", rows: [row], source: "draft" as const, updatedAt: "" } },
    });
    const target = synchronizeGenerationSpec(createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { prompt: row.prompt, ecommerceShotId: row.slotId, ecommerceProductId: product.id, ecommerceFlowId: "main", batchSourceNodeId: table.id }), { model: imageModel });
    const connections: CanvasConnection[] = [{ id: "product", fromNodeId: product.id, toNodeId: target.id }];
    const signature = (currentRow = row) =>
        ecommerceGenerationSourceSignature({ source: table, row: currentRow, target, nodes: [table, product, target], connections, config });

    const initial = signature();
    expect(signature({ ...row, layout: createEcommerceLayout("Layout A") })).toBe(initial);
    expect(signature({ ...row, layout: createEcommerceLayout("Layout B") })).toBe(initial);
    // 版式不进底图，本地叠字随便调都不该让旧图失效——合成一次就够。
    for (const patch of [{ anchor: "top-center" as const }, { size: 12 }, { color: "#C8341F" }, { plate: "#000000CC" }, { plate: "" }, { inset: 20 }, { bold: false }]) {
        expect(signature({ ...row, layout: layoutOf(patch) }), JSON.stringify(patch)).toBe(initial);
    }
});

test("platform shapes the authoring draft prompt, while aspect ratio comes from the flow", () => {
    const flow = ecommerceOneClickFlow("detail")!;
    const profile = createEcommerceProductProfile("Black mug");
    const rows = [{ slotId: "detail-1", title: "Detail", duty: "Show", prompt: "" }];
    const draft = (platformId: string) => ecommerceSuiteDraftPrompt(flow, profile, rows, null, { platformId });

    // 平台在作者侧的分析提示词里生效：模型据此写出每行 prompt。
    const amazon = draft("amazon");
    const taobao = draft("taobao");
    expect(amazon).not.toBe(taobao);
    expect(amazon).toContain("Amazon");
    expect(taobao).toContain("淘宝");

    // 画幅由用途决定，与平台无关——海外平台的主图 1:1 要求走的是规格校验，不是改这里的画幅。
    expect(ECOMMERCE_FLOW_ASPECT).toEqual({ detail: "3:4", main: "1:1", wear: "3:4", seed: "4:5" });
    expect(amazon).toContain("3:4");
});

test("signature resolves the platform from the passed source node, not from the stale canvas graph", () => {
    const imageCapability = projectImageParameters(defaultImageCapabilityConfig("openai-image", "image-model"), [
        { name: "size", label: "Size", type: "string", values: ["3:4"], default: "3:4" },
        { name: "quality", label: "Quality", type: "string", values: ["low"], default: "low" },
    ]);
    const channel = createModelChannel({
        id: "images",
        models: ["image-model"],
        modelCosts: [
            {
                model: "image-model",
                capability: "image" as const,
                protocol: "openai-image" as const,
                capabilityConfig: { version: 1 as const, image: imageCapability },
                billingMode: "fixed_request" as const,
                unitPriceMicrocredits: 1,
            },
        ],
    });
    const imageModel = encodeChannelModel(channel.id, "image-model");
    const config = { ...defaultConfig, channels: [channel], imageModel, imageModels: [imageModel] };
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("Black mug"), ecommercePlatform: "amazon" });
    const row = {
        slotId: "detail-1",
        title: "Detail",
        duty: "Show",
        prompt: "画面构成：3:4 竖版暖窗光台面；产品摆放：杯身朝左",
        imagePromptContractVersion: 1 as const,
        copy: { headline: "通勤一路温热", subhead: "", cta: "", price: "" },
    };
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, {
        ecommerceFlowId: "detail",
        ecommerceImageSize: "3:4",
        ecommercePlatform: "amazon",
        ecommerceSuitesByFlow: { detail: { flow: "detail", rows: [row], source: "draft" as const, updatedAt: "" } },
    });
    const target = synchronizeGenerationSpec(createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { prompt: row.prompt, ecommerceShotId: row.slotId, ecommerceProductId: product.id, ecommerceFlowId: "detail", batchSourceNodeId: table.id }), { model: imageModel });
    const connections: CanvasConnection[] = [{ id: "product", fromNodeId: product.id, toNodeId: target.id }];
    const signature = (currentRow = row, currentSource = table) =>
        ecommerceGenerationSourceSignature({ source: currentSource, row: currentRow, target, nodes: [currentSource, product, target], connections, config });

    const initial = signature();
    // 画面段按另一个平台重写过：内容变了，签名就得跟着换。
    const amazonWritten = signature({ ...row, prompt: "画面构成：3:4 纯白底，主体占八成；产品摆放：杯身朝左" });
    expect(amazonWritten).not.toBe(initial);
    expect(amazonWritten).toContain("纯白底");
    // 平台已经进了生成请求（resolver 把平台规则并进最终提示词），所以改标签必须让旧图失效；
    // 但它仍然不是一个额外的签名位，而是提示词内容的一部分。
    const taobaoTable = { ...table, metadata: { ...table.metadata, ecommercePlatform: "taobao" } };
    const taobaoSignature = signature(row, taobaoTable);
    expect(taobaoSignature).not.toBe(initial);
    expect(taobaoSignature).toContain("淘宝");
    // 不是「把等号改成不等号」就算数：平台规则必须真的进了最终提示词，而且两段内容不同。
    const amazonPrompt = JSON.parse(initial!)[0] as string;
    const taobaoPrompt = JSON.parse(taobaoSignature!)[0] as string;
    expect(amazonPrompt).toContain("【平台规则 · Amazon】");
    expect(taobaoPrompt).toContain("【平台规则 · 淘宝");
    expect(taobaoPrompt).not.toContain("【平台规则 · Amazon】");
    // 平台规则整段进提示词，不是只多了个标签：淘宝的偏好/禁止项必须真的落在里面。
    expect(taobaoPrompt).toContain("宽 750");
    expect(taobaoPrompt).toContain("总数 ≤50 张");
    expect(JSON.parse(taobaoSignature!)).toHaveLength(8);
    // 平台已经进请求，所以旧图里的表不能再被读到。这里断言的是**同一来源**：
    // 图里的表还是旧平台、传入的是新平台时，签名必须与「图里本来就是新平台」完全一致。
    // 漏掉 source 替换会当场变红。
    const staleGraphSource = { ...table, metadata: { ...table.metadata, ecommercePlatform: "taobao" } };
    const currentSourceNode = { ...table, metadata: { ...table.metadata, ecommercePlatform: "amazon" } };
    const requestFor = (graphSource: typeof table) =>
        resolveEcommerceInputs(target.id, [graphSource, product, target], connections, [], [row]).prompt;
    const signWithGraph = (graphSource: typeof table) =>
        ecommerceGenerationSourceSignature({ source: currentSourceNode, row, target, nodes: [graphSource, product, target], connections, config });
    expect(signWithGraph(staleGraphSource)).toBe(signWithGraph(currentSourceNode));
    expect(JSON.parse(signWithGraph(staleGraphSource)!)[0].startsWith(requestFor(currentSourceNode))).toBe(true);
    // 更硬：签名第一格就是批量快照真正冻进队列的那份提示词，一字不差。
    const snapshotWith = (graphSource: typeof table) =>
        createCanvasBatchInputSnapshot(target, [graphSource, product, target], connections, []).context.prompt;
    expect(JSON.parse(signWithGraph(staleGraphSource)!)[0]).toBe(snapshotWith(currentSourceNode));
    expect(snapshotWith(currentSourceNode)).toContain("【平台规则 · Amazon】");
    // 签名形状固定八格：平台若靠追加一格来生效，就会出现「改平台要重画、改提示词不重画」的错位。
    expect(JSON.parse(signWithGraph(staleGraphSource)!)).toHaveLength(8);
});

test("local text mode reads the table rows from the passed source node, not from the stale graph copy", () => {
    const imageCapability = projectImageParameters(defaultImageCapabilityConfig("openai-image", "image-model"), [
        { name: "size", label: "Size", type: "string", values: ["1:1"], default: "1:1" },
        { name: "quality", label: "Quality", type: "string", values: ["low"], default: "low" },
    ]);
    const channel = createModelChannel({
        id: "images",
        models: ["image-model"],
        modelCosts: [
            {
                model: "image-model",
                capability: "image" as const,
                protocol: "openai-image" as const,
                capabilityConfig: { version: 1 as const, image: imageCapability },
                billingMode: "fixed_request" as const,
                unitPriceMicrocredits: 1,
            },
        ],
    });
    const imageModel = encodeChannelModel(channel.id, "image-model");
    const config = { ...defaultConfig, channels: [channel], imageModel, imageModels: [imageModel] };
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("Black mug") });
    const graphRow = { slotId: "hero", title: "Hero", duty: "Show", prompt: "GRAPH_VISUAL", copy: { headline: "GRAPH_ROW_COPY", subhead: "", price: "", cta: "" } };
    const sourceRow = { ...graphRow, prompt: "SOURCE_VISUAL", copy: { ...graphRow.copy, headline: "SOURCE_ROW_COPY" } };
    const suiteOf = (row: typeof graphRow) => ({ main: { flow: "main", rows: [row], source: "draft" as const, updatedAt: "" } });
    // 非详情页 = 本地叠字，不传 rowsOverride，行只能从表节点读——正好用来验证「读的到底是哪一份表」。
    const graphTable = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, { ecommerceFlowId: "main", ecommerceSuitesByFlow: suiteOf(graphRow) });
    const currentSource = { ...graphTable, metadata: { ...graphTable.metadata, ecommerceSuitesByFlow: suiteOf(sourceRow) } };
    const target = synchronizeGenerationSpec(createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { prompt: graphRow.prompt, ecommerceShotId: graphRow.slotId, ecommerceProductId: product.id, ecommerceFlowId: "main", batchSourceNodeId: graphTable.id }), { model: imageModel });
    const connections: CanvasConnection[] = [{ id: "product", fromNodeId: product.id, toNodeId: target.id }];
    const sign = (source: typeof graphTable, nodeList = [source, product, target]) =>
        ecommerceGenerationSourceSignature({ source, row: sourceRow, target, nodes: nodeList, connections, config });

    const withStaleGraph = sign(currentSource, [graphTable, product, target]);
    const withCurrentGraph = sign(currentSource, [currentSource, product, target]);
    const prompt = JSON.parse(withStaleGraph!)[0] as string;
    expect(prompt).toContain("SOURCE_ROW_COPY");
    expect(prompt).not.toContain("GRAPH_ROW_COPY");
    expect(withStaleGraph).toBe(withCurrentGraph);
});

test("main flow with camera control keeps the signature byte-identical to the frozen snapshot when the row prompt has trailing blanks", () => {
    const imageCapability = projectImageParameters(defaultImageCapabilityConfig("openai-image", "image-model"), [
        { name: "size", label: "Size", type: "string", values: ["1:1"], default: "1:1" },
        { name: "quality", label: "Quality", type: "string", values: ["low"], default: "low" },
    ]);
    const channel = createModelChannel({
        id: "images",
        models: ["image-model"],
        modelCosts: [
            {
                model: "image-model",
                capability: "image" as const,
                protocol: "openai-image" as const,
                capabilityConfig: { version: 1 as const, image: imageCapability },
                billingMode: "fixed_request" as const,
                unitPriceMicrocredits: 1,
            },
        ],
    });
    const imageModel = encodeChannelModel(channel.id, "image-model");
    const config = { ...defaultConfig, channels: [channel], imageModel, imageModels: [imageModel] };
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("Black mug") });
    // 表格里存的行带着用户敲进去的尾空白。main 流程靠本地叠字，文案不进底图，所以走的是「尾巴原样保留」那条路。
    const row = {
        slotId: "hero",
        title: "Hero",
        duty: "Show",
        prompt: "画面构成：纯白底，杯身占八成，柔光    \n",
        copy: { headline: "轻盈随行", subhead: "", price: "", cta: "" },
    };
    const graphTable = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, {
        ecommerceFlowId: "main",
        ecommerceSuitesByFlow: { main: { flow: "main", rows: [row], source: "draft" as const, updatedAt: "" } },
    });
    const target = synchronizeGenerationSpec(
        createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {
            prompt: row.prompt,
            ecommerceShotId: row.slotId,
            ecommerceProductId: product.id,
            ecommerceFlowId: "main",
            batchSourceNodeId: graphTable.id,
            // 相机段会追加在尾巴后面：尾空白若没先 trim，就会卡在画面段和相机段之间。
            cameraControl: { enabled: true, camera: "arri_alexa_mini_lf", lens: "cooke_s7i", focalLength: 50, aperture: 2.8 },
        }),
        { model: imageModel },
    );
    const connections: CanvasConnection[] = [{ id: "product", fromNodeId: product.id, toNodeId: target.id }];
    // 与 project.tsx:2997-2998 同一口径：准备节点时先把行提示词 trim 掉。
    const prepared = synchronizeGenerationSpec(target, { prompt: row.prompt.trim(), composerContent: row.prompt.trim() });
    const nodes = [graphTable, product, prepared];
    const signature = ecommerceGenerationSourceSignature({ source: graphTable, row, target: prepared, nodes, connections, config });
    const snapshot = createCanvasBatchInputSnapshot(prepared, nodes, connections, []).context.prompt;
    // 签名第一格就是批量快照真正冻进队列的那份提示词，一个字节都不能差。
    expect(JSON.parse(signature!)[0]).toBe(snapshot);
    // 相机指令必须还在——去尾巴不能把摄影机参数一起吃掉。
    expect(snapshot).toContain("ARRI Alexa Mini LF");
    expect(snapshot).toContain("画面构成：纯白底，杯身占八成，柔光");
    // 画面段只出现一次，尾空白不制造第二次回注。
    expect(snapshot.split("画面构成：纯白底，杯身占八成，柔光").length - 1).toBe(1);
});

test("binding uses row order and direct selected outputs, refusing disconnected or missing images", () => {
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, { ecommerceFlowId: "detail" });
    const a = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceShotId: "a", ecommerceFlowId: "detail", storageKey: "image:a" });
    const b = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceShotId: "b", ecommerceFlowId: "detail", storageKey: "image:b" });
    const edges = [a, b].map((node) => ({ id: node.id, fromNodeId: table.id, toNodeId: node.id }));
    const rows = [b, a].map((node) => ({ slotId: node.metadata!.ecommerceShotId!, title: "", duty: "", prompt: "", resultNodeId: node.id }));
    expect(ecommerceSelectedOutputs(table, rows, [a, b], edges).map((node) => node.id)).toEqual([b.id, a.id]);
    expect(() => ecommerceSelectedOutputs(table, rows, [a, b], edges.slice(0, 1))).toThrow("第 1 张");
    expect(() => ecommerceSelectedOutputs(table, [], [a, b], edges)).toThrow("没有");
});

test("binding ignores skipped rows and still requires at least one enabled row", () => {
    const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }, { ecommerceFlowId: "detail" });
    const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceShotId: "keep", ecommerceFlowId: "detail", storageKey: "image:keep" });
    const rows = [
        { slotId: "skip", title: "Skip", duty: "", prompt: "", enabled: false },
        { slotId: "keep", title: "Keep", duty: "", prompt: "Draw" },
    ];
    const edges = [{ id: "keep", fromNodeId: table.id, toNodeId: image.id }];
    expect(ecommerceSelectedOutputs(table, rows, [image], edges).map((node) => node.id)).toEqual([image.id]);
    expect(() => ecommerceSelectedOutputs(table, [rows[0]], [image], edges)).toThrow("没有");
});

test("analysis snapshot ignores canvas positions, connection rendering details and input order", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const front = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "image:front" });
    const back = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "image:back" });
    const edges: CanvasConnection[] = [
        { id: "front", fromNodeId: front.id, toNodeId: product.id, toHandleId: "product-view:front", relation: "batch-input", fromAnchorRatio: 0.1, toAnchorRatio: 0.2, toAnchorXRatio: 0.3 },
        { id: "back", fromNodeId: back.id, toNodeId: product.id, toHandleId: "product-view:back", relation: "batch-input", fromAnchorRatio: 0.4, toAnchorRatio: 0.5, toAnchorXRatio: 0.6 },
    ];
    const nodes = [product, front, back];
    const snapshot = ecommerceAnalysisSnapshot(product, product, nodes, edges);
    const renderedDifferently = [...edges].reverse().map((edge, index) => ({ ...edge, id: `replacement-${index}`, fromAnchorRatio: index + 0.2, toAnchorRatio: index + 0.3, toAnchorXRatio: index + 0.4 }));
    expect(ecommerceAnalysisSnapshot({ ...product, position: { x: 100, y: 100 } }, product, nodes, renderedDifferently)).toBe(snapshot);
});

test("analysis snapshot detects semantic connection and reference asset changes", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "image:first" });
    const other = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { storageKey: "image:other" });
    const edge: CanvasConnection = { id: "ref", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front", relation: "batch-input" };
    const nodes = [product, image, other];
    const snapshot = ecommerceAnalysisSnapshot(product, product, nodes, [edge]);
    expect(ecommerceAnalysisSnapshot(product, product, nodes, [{ ...edge, fromNodeId: other.id }])).not.toBe(snapshot);
    expect(ecommerceAnalysisSnapshot(product, product, nodes, [{ ...edge, toHandleId: "product-view:back" }])).not.toBe(snapshot);
    expect(ecommerceAnalysisSnapshot(product, product, nodes, [{ ...edge, relation: "storyboard-asset-reference" }])).not.toBe(snapshot);
    expect(ecommerceAnalysisSnapshot(product, product, [product, { ...image, metadata: { storageKey: "image:changed" } }, other], [edge])).not.toBe(snapshot);
    expect(ecommerceAnalysisSnapshot(product, product, nodes, [])).not.toBe(snapshot);
    const edited = { ...product, metadata: { ...product.metadata, locked: true } };
    expect(ecommerceAnalysisSnapshot(product, edited, [edited, image, other], [edge])).not.toBe(snapshot);

    const content = `data:image/png;base64,${"private-pixels".repeat(100)}`;
    const legacy = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content });
    const legacyEdges = [{ id: "legacy", fromNodeId: legacy.id, toNodeId: product.id }];
    const legacySnapshot = ecommerceAnalysisSnapshot(product, product, [product, legacy], legacyEdges);
    expect(legacySnapshot).not.toContain(content);
    expect(ecommerceAnalysisSnapshot(product, product, [product, { ...legacy, position: { x: 200, y: 200 } }], legacyEdges)).toBe(legacySnapshot);
    expect(ecommerceAnalysisSnapshot(product, product, [product, { ...legacy, metadata: { content: `${content}-changed` } }], legacyEdges)).not.toBe(legacySnapshot);
});
test("analysis snapshot rejects changed models or skills while normalizing skill order", () => {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const initial = ecommerceAnalysisSnapshot(product, product, [product], [], "channel::vision-a", ["skill-b", "skill-a"]);

    expect(ecommerceAnalysisSnapshot(product, product, [product], [], "channel::vision-a", ["skill-a", "skill-b"])).toBe(initial);
    expect(ecommerceAnalysisSnapshot(product, product, [product], [], "channel::vision-b", ["skill-a", "skill-b"])).not.toBe(initial);
    expect(ecommerceAnalysisSnapshot(product, product, [product], [], "channel::vision-a", ["skill-a"])).not.toBe(initial);
});
