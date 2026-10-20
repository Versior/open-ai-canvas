import assert from "node:assert/strict";
import { mock } from "bun:test";
import React, { act } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
let scope = "account-a";
const storage = {
    getItem: () => scope,
    setItem: (_key: string, value: string) => {
        scope = value;
    },
};
Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage }) });
const imageStorage = await import("../../src/services/image-storage");
let uploads = 0;
let afterUpload = () => {};
mock.module("@/services/image-storage", () => ({
    ...imageStorage,
    uploadImage: async () => {
        uploads++;
        afterUpload();
        return { url: "/test.png", storageKey: `test-${uploads}`, width: uploads % 2 ? 750 : 1500, height: uploads === 1 ? 9000 : 1000, bytes: 10, mimeType: "image/png" };
    },
}));
const assetSync = await import("../../src/services/project-asset-sync");
mock.module("@/services/project-asset-sync", () => ({ ...assetSync, ensureCanvasNodeAsset: async () => ({ assetId: "test-asset", created: true, linkedToProject: false }) }));
App.useApp = (() => ({ message: { warning() {}, success() {}, error() {} } })) as typeof App.useApp;
const { useCanvasMediaTools } = await import("../../src/pages/canvas/use-canvas-media-tools");
const source: CanvasNodeData = { id: "table", type: CanvasNodeType.BatchTable, title: "Detail", position: { x: 0, y: 0 }, width: 800, height: 600, metadata: {} };
const nodesRef = { current: [source] };
const connectionsRef = { current: [] as { id: string; fromNodeId: string; toNodeId: string }[] };
let tools!: ReturnType<typeof useCanvasMediaTools>;
function Probe() {
    const noop = () => {};
    tools = useCanvasMediaTools({
        projectId: "test",
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef: { current: new Set() },
        setNodes: (value) => {
            nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
        },
        setConnections: (value) => {
            connectionsRef.current = typeof value === "function" ? value(connectionsRef.current) : value;
        },
        setSelectedNodeIds: noop,
        setSelectedConnectionId: noop,
        setDialogNodeId: noop,
        setContextMenu: noop,
        setHoveredNodeId: noop,
        setToolbarNodeId: noop,
        setRunningNodeId: noop,
        startUploadStatus: (() => noop) as never,
        startGenerationRequest: () => new AbortController(),
        finishGenerationRequest: noop,
        bindGenerationTask: noop,
        applyGenerationTaskResult: async () => {},
    });
    return null;
}
const fail = (error: unknown) => {
    throw error;
};
const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
const pieces = Array.from({ length: 4 }, (_, index) => ({ index: index + 1, top: index * 1000, height: 1000, dataUrl: "data:image/png;base64,test" }));
try {
    await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
    await act(async () => {
        await tools.exportEcommerceDetailPage(source, "data:image/png;base64,long", pieces, []);
    });
    assert.equal(nodesRef.current.length, 6);
    assert.equal(connectionsRef.current.length, 5);
    const outputs = nodesRef.current.slice(1);
    for (let i = 0; i < outputs.length; i++)
        for (let j = i + 1; j < outputs.length; j++) {
            const a = outputs[i],
                b = outputs[j];
            assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y);
        }
    nodesRef.current = [source];
    connectionsRef.current = [];
    uploads = 0;
    afterUpload = () => {
        scope = "account-b";
    };
    await assert.rejects(() => tools.exportEcommerceDetailPage(source, "long", pieces, []), /账号已切换/);
    assert.equal(uploads, 1);
    assert.equal(nodesRef.current.length, 1);
    assert.equal(connectionsRef.current.length, 0);
    scope = "account-a";
    uploads = 0;
    afterUpload = () => {
        nodesRef.current = [];
    };
    await assert.rejects(() => tools.exportEcommerceDetailPage(source, "long", pieces, []), /已删除或锁定/);
    assert.equal(uploads, 1);
    assert.equal(nodesRef.current.length, 0);
    nodesRef.current = [source];
    uploads = 0;
    let valid = true;
    afterUpload = () => {
        valid = false;
    };
    await assert.rejects(
        () =>
            tools.exportEcommerceDetailPage(source, "long", pieces, [], () => {
                if (!valid) throw new Error("selection changed");
            }),
        /selection changed/,
    );
    assert.equal(uploads, 1);
    assert.equal(nodesRef.current.length, 1);
    console.log("Long-image export validates account, source and non-overlapping layout.");
} finally {
    await act(async () => reconciler.updateContainer(null, root, null, null));
}
