import { describe, expect, test } from "bun:test";

import { createCanvasBatchInputSnapshot } from "@/lib/canvas/canvas-batch-input-snapshot";
import { batchOutputResultPending, batchRowInputChanged, batchRowInputSignature } from "@/lib/canvas/canvas-batch-references";
import { createEcommerceVideo, ecommerceVideoCreativePlanSourceSignature } from "@/lib/ecommerce/ecommerce-video";
import { ensureRemoteResourceReferences } from "@/services/user-data-sync-media";
import { CanvasNodeType, type CanvasBatchTableData, type CanvasNodeData } from "@/types/canvas";

const localKey = "image:scope:original";
const remoteKey = "resource:original";

function fixture() {
    const image: CanvasNodeData = {
        id: "image:with:colon",
        type: CanvasNodeType.Image,
        title: "人物",
        width: 200,
        height: 300,
        position: { x: 0, y: 0 },
        metadata: { content: "blob:original", storageKey: localKey, naturalWidth: 200, naturalHeight: 300 },
    };
    const output: CanvasNodeData = {
        ...image,
        id: "result",
        metadata: { content: "/api/resources/result/file", storageKey: "resource:result", prompt: "保留人物", composerContent: "保留人物", status: "success", batchSourceNodeId: "table", batchRowId: "row" },
    };
    const table: CanvasBatchTableData = { operation: "creative", concurrency: 1, rows: [{ id: "row", enabled: true, prompt: "保留人物", inputNodeIds: [image.id], outputNodeId: output.id }] };
    const tableNode: CanvasNodeData = { ...image, id: "table", type: CanvasNodeType.BatchTable, metadata: { batchTable: table } };
    const nodes = [image, output, tableNode];
    const signature = batchRowInputSignature(table, table.rows[0], new Map(nodes.map((node) => [node.id, node])));
    output.metadata!.batchInputSignature = signature;
    output.metadata!.batchResultInputSignature = signature;
    table.rows[0].generatedInputSignature = signature;
    const snapshot = createCanvasBatchInputSnapshot(output, nodes, [{ id: "edge", fromNodeId: image.id, toNodeId: output.id }], []);
    tableNode.metadata!.generationBatches = [
        {
            id: "batch",
            sourceNodeId: tableNode.id,
            projectId: "test",
            mode: "batch_image",
            status: "completed",
            createdAt: "",
            updatedAt: "",
            items: [{ id: "item", rowId: "row", nodeId: output.id, status: "succeeded", retryCount: 0, inputSnapshot: snapshot }],
        },
    ];
    return { image, output, table, tableNode, nodes, signature };
}

function rowChanged(nodes: CanvasNodeData[]) {
    const table = nodes.find((node) => node.id === "table")!.metadata!.batchTable!;
    return batchRowInputChanged(table, table.rows[0], new Map(nodes.map((node) => [node.id, node])));
}

describe("batch signatures across resource promotion", () => {
    test("normalizing the same file rewrites all saved signatures without changing the live document", async () => {
        const state = fixture();
        const before = JSON.stringify(state.nodes);
        expect(rowChanged(state.nodes)).toBe(false);
        const remote = await ensureRemoteResourceReferences({ nodes: state.nodes }, new Map([[localKey, remoteKey]]));
        const reloaded: { nodes: CanvasNodeData[] } = JSON.parse(JSON.stringify(remote));
        const output = reloaded.nodes.find((node) => node.id === "result")!;
        const table = reloaded.nodes.find((node) => node.id === "table")!.metadata!.batchTable!;
        expect(rowChanged(reloaded.nodes)).toBe(false);
        expect(output.metadata!.batchInputSignature).not.toBe(state.signature);
        expect(output.metadata!.batchResultInputSignature).toBe(output.metadata!.batchInputSignature);
        expect(table.rows[0].generatedInputSignature).toBe(output.metadata!.batchInputSignature);
        expect(batchOutputResultPending(output.metadata)).toBe(false);
        expect(JSON.stringify(state.nodes)).toBe(before);
    });

    test("normalization preserves a real prompt change and never rewrites arbitrary text", async () => {
        const state = fixture();
        state.table.rows[0].prompt = "改成夜景";
        state.output.metadata!.prompt = state.signature;
        expect(rowChanged(state.nodes)).toBe(true);
        const remote = await ensureRemoteResourceReferences({ nodes: state.nodes }, new Map([[localKey, remoteKey]]));
        expect(rowChanged(remote.nodes)).toBe(true);
        const output = remote.nodes.find((node) => node.id === "result")!;
        expect(JSON.parse(output.metadata!.batchResultInputSignature!)[0]).toBe("保留人物");
        expect(output.metadata!.prompt).toBe(state.signature);
    });

    test("a queued old resource is promoted independently after the live source is replaced", async () => {
        const state = fixture();
        const replacementKey = "image:scope:replacement";
        state.nodes[0] = { ...state.image, metadata: { ...state.image.metadata, content: "blob:replacement", storageKey: replacementKey } };
        state.output.metadata!.batchResultInputSignature = undefined;
        const item = state.tableNode.metadata!.generationBatches![0].items[0];
        item.status = "waiting";
        const snapshotBefore = JSON.stringify(item.inputSnapshot);
        const remote = await ensureRemoteResourceReferences(
            { nodes: state.nodes },
            new Map([
                [localKey, remoteKey],
                [replacementKey, "resource:replacement"],
            ]),
        );
        const remoteTable = remote.nodes.find((node) => node.id === "table")!;
        const snapshot = remoteTable.metadata!.generationBatches![0].items[0].inputSnapshot!;
        const output = remote.nodes.find((node) => node.id === "result")!;
        expect(remote.nodes[0].metadata!.storageKey).toBe("resource:replacement");
        expect(snapshot.context.referenceImages[0].storageKey).toBe(remoteKey);
        const originalRemote = { ...state.image, metadata: { ...state.image.metadata, storageKey: remoteKey } };
        const expectedOriginalSignature = batchRowInputSignature(state.table, state.table.rows[0], new Map([[originalRemote.id, originalRemote]]));
        expect(output.metadata!.batchInputSignature).toBe(expectedOriginalSignature);
        expect(remoteTable.metadata!.batchTable!.rows[0].generatedInputSignature).toBe(expectedOriginalSignature);
        expect(batchOutputResultPending(output.metadata)).toBe(true);
        expect(rowChanged(remote.nodes)).toBe(true);
        expect(JSON.stringify(item.inputSnapshot)).toBe(snapshotBefore);
    });

    test("a snapshot alone retains promotion identity when the source node has been deleted", async () => {
        const state = fixture();
        const remote = await ensureRemoteResourceReferences({ nodes: state.nodes.filter((node) => node.id !== state.image.id) }, new Map([[localKey, remoteKey]]));
        const output = remote.nodes.find((node) => node.id === "result")!;
        const originalRemote = { ...state.image, metadata: { ...state.image.metadata, storageKey: remoteKey } };
        expect(output.metadata!.batchInputSignature).toBe(batchRowInputSignature(state.table, state.table.rows[0], new Map([[originalRemote.id, originalRemote]])));
        expect(rowChanged(remote.nodes)).toBe(true);
    });

    test("ecommerce result signatures retain source identity after resource promotion", async () => {
        const state = fixture();
        const signature = JSON.stringify([
            "商品主图 prompt",
            [[state.image.id, localKey, "200x300", "image/png", "opaque"]],
            "image-model",
            "1:1",
            "high",
            "2K",
            "{}",
            "disabled",
        ]);
        state.output.metadata!.batchResultInputSignature = signature;
        state.table.rows[0].generatedInputSignature = signature;

        const remote = await ensureRemoteResourceReferences({ nodes: state.nodes }, new Map([[localKey, remoteKey]]));
        const outputSignature = remote.nodes.find((node) => node.id === "result")!.metadata!.batchResultInputSignature!;
        const rowSignature = remote.nodes.find((node) => node.id === "table")!.metadata!.batchTable!.rows[0].generatedInputSignature!;

        expect(JSON.parse(outputSignature)).toEqual([
            "商品主图 prompt",
            [[state.image.id, remoteKey, "200x300", "image/png", "opaque"]],
            "image-model",
            "1:1",
            "high",
            "2K",
            "{}",
            "disabled",
        ]);
        expect(rowSignature).toBe(outputSignature);
        expect(outputSignature).not.toContain("blob:");
        expect(outputSignature).not.toContain("data:");
    });
    test("video Creative Plans stay current when local references are promoted to resources", async () => {
        const referenceKey = "video-reference:scope:reference";
        const remoteReferenceKey = "resource:reference";
        const productKey = "image:scope:product";
        const remoteProductKey = "resource:product";
        const reference: CanvasNodeData = {
            id: "reference-video",
            type: CanvasNodeType.Video,
            position: { x: 0, y: 0 },
            metadata: { content: "blob:reference", storageKey: referenceKey },
        };
        const product: CanvasNodeData = {
            id: "product",
            type: CanvasNodeType.Product,
            position: { x: 0, y: 0 },
            metadata: { productProfile: { name: "保温杯", category: "杯具", appearance: "白色", marks: "", forbidden: "", audience: "通勤", facts: "210g", price: "99 元", views: {} } },
        };
        const productImage: CanvasNodeData = {
            id: "product-image",
            type: CanvasNodeType.Image,
            position: { x: 0, y: 0 },
            metadata: { content: "blob:product", storageKey: productKey },
        };
        const target: CanvasNodeData = {
            id: "video-target",
            type: CanvasNodeType.EcommerceVideo,
            position: { x: 0, y: 0 },
            metadata: { ecommerceVideo: createEcommerceVideo("复刻视频") },
        };
        target.metadata!.ecommerceVideo!.replica = { referenceVideoNodeId: reference.id, aspects: ["rhythm"], notes: "{}", extraExclude: "" };
        const signature = ecommerceVideoCreativePlanSourceSignature({ target, referenceVideo: reference, product, productImages: [productImage] });
        target.metadata!.ecommerceVideo!.replica.planSourceSignature = signature;
        const result: CanvasNodeData = {
            id: "creative-plan",
            type: CanvasNodeType.Text,
            position: { x: 0, y: 0 },
            metadata: { ecommerceVideoCreativePlanSource: { targetNodeId: target.id, referenceVideoId: reference.id, signature } },
        };

        const remote = await ensureRemoteResourceReferences(
            { nodes: [reference, product, productImage, target, result] },
            new Map([
                [referenceKey, remoteReferenceKey],
                [productKey, remoteProductKey],
            ]),
        );
        const node = (id: string) => remote.nodes.find((item) => item.id === id)!;
        const expected = ecommerceVideoCreativePlanSourceSignature({ target: node(target.id), referenceVideo: node(reference.id), product: node(product.id), productImages: [node(productImage.id)] });

        expect(node(target.id).metadata!.ecommerceVideo!.replica!.planSourceSignature).toBe(expected);
        expect(node(result.id).metadata!.ecommerceVideoCreativePlanSource!.signature).toBe(expected);
        expect(expected).not.toBe(signature);
    });
    test("unknown legacy signatures stay intact instead of being replaced by current inputs", async () => {
        const state = fixture();
        state.output.metadata!.batchResultInputSignature = "legacy-signature";
        state.table.rows[0].generatedInputSignature = "[malformed";
        const remote = await ensureRemoteResourceReferences({ nodes: state.nodes }, new Map([[localKey, remoteKey]]));
        expect(remote.nodes.find((node) => node.id === "result")!.metadata!.batchResultInputSignature).toBe("legacy-signature");
        expect(remote.nodes.find((node) => node.id === "table")!.metadata!.batchTable!.rows[0].generatedInputSignature).toBe("[malformed");
    });

    test("editing an imported text node fingerprints its editable body rather than its unchanged file key", () => {
        const state = fixture();
        const text: CanvasNodeData = { ...state.image, id: "note", type: CanvasNodeType.Text, metadata: { content: "黄昏暖光", storageKey: "resource:uploaded-text" } };
        state.nodes.push(text);
        state.table.rows[0].textNodeIds = [text.id];
        state.output.metadata!.batchResultInputSignature = batchRowInputSignature(state.table, state.table.rows[0], new Map(state.nodes.map((node) => [node.id, node])));
        expect(rowChanged(state.nodes)).toBe(false);
        const edited = state.nodes.map((node) => (node.id === text.id ? { ...node, metadata: { ...node.metadata, content: "阴天冷光" } } : node));
        expect(rowChanged(edited)).toBe(true);
        expect(edited.find((node) => node.id === text.id)!.metadata!.storageKey).toBe(text.metadata!.storageKey);
    });
});
