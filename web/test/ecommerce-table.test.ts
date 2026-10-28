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
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import { syncBatchColumnReferences } from "../src/lib/canvas/canvas-batch-references";
import { batchReferenceHandleY } from "../src/lib/canvas/canvas-batch-table";
import { getConnectionTargetAnchor } from "../src/lib/canvas/canvas-project-domain";
import { upstreamEcommerceNodes } from "../src/lib/ecommerce/ecommerce-canvas";
import { ecommerceSuiteMetadata } from "../src/lib/ecommerce/ecommerce-table";
import { canvasPersistentNodes } from "../src/lib/canvas/canvas-persistent-nodes";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import type { EcommerceModel } from "../src/lib/ecommerce/ecommerce-models";
import { defaultImageCapabilityConfig } from "../src/lib/model-capabilities";
import { projectImageParameters } from "../src/lib/image-parameters";
import { synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { canGenerateImageInPlace } from "../src/lib/canvas/canvas-generation-layout";
import { mediaVersionFieldsBeforeReplace } from "../src/lib/canvas/canvas-media-versions";

test("template and analysis suite writes survive actual canvas persistence comparison", () => {
    const before = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 });
    const suite = { flow: "main", source: "draft" as const, updatedAt: "", rows: [{ slotId: "hero", title: "Hero", duty: "Show product", prompt: "" }] };
    const after = { ...before, metadata: { ...before.metadata, ...ecommerceSuiteMetadata(before.metadata, suite) } };
    expect(() => canvasPersistentNodes([after], [before])).not.toThrow();
    expect(after.metadata.ecommerceSuitesByFlow?.main).toEqual(suite);
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
