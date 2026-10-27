import assert from "node:assert/strict";
import { mock } from "bun:test";
import React, { act, useState, type ReactElement, type ReactNode } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";
import { createEcommerceProductProfile } from "../../src/lib/ecommerce/ecommerce-contract";

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
let afterAssetSync = () => {};
let assetSyncError = false;
mock.module("@/services/image-storage", () => ({
    ...imageStorage,
    uploadImage: async () => {
        uploads++;
        afterUpload();
        return { url: "/test.png", storageKey: `test-${uploads}`, width: uploads % 2 ? 750 : 1500, height: uploads === 1 ? 9000 : 1000, bytes: 10, mimeType: "image/png" };
    },
    imageToDataUrl: async () => "data:image/png;base64,source",
}));
const assetSync = await import("../../src/services/project-asset-sync");
mock.module("@/services/project-asset-sync", () => ({
    ...assetSync,
    ensureCanvasNodeAsset: async () => {
        afterAssetSync();
        if (assetSyncError) throw new Error("asset sync failed");
        return { assetId: "test-asset", created: true, linkedToProject: false };
    },
}));
const raster = await import("../../src/lib/ecommerce/ecommerce-rasterize");
mock.module("@/lib/ecommerce/ecommerce-rasterize", () => ({
    ...raster,
    rasterizeEcommerceDetailPage: async () => ({
        longImage: { dataUrl: "data:image/png;base64,long", width: 750, height: 2000 },
        pieces: [{ index: 1, top: 0, height: 2000, dataUrl: "data:image/png;base64,piece" }],
        fileNames: ["ITEM_详情页_01_v1.png"],
        plan: { pieces: [{ index: 1, top: 0, height: 2000 }], conflicts: [] },
    }),
}));
App.useApp = (() => ({ message: { warning() {}, success() {}, error() {} } })) as typeof App.useApp;
const { useCanvasMediaTools } = await import("../../src/pages/canvas/use-canvas-media-tools");
const source: CanvasNodeData = { id: "table", type: CanvasNodeType.BatchTable, title: "Detail", position: { x: 0, y: 0 }, width: 800, height: 600, metadata: {} };
const nodesRef = { current: [source] };
const connectionsRef = { current: [] as { id: string; fromNodeId: string; toNodeId: string }[] };
const selectedNodeIdsRef = { current: new Set<string>() };
let tools!: ReturnType<typeof useCanvasMediaTools>;
function Probe() {
    const noop = () => {};
    tools = useCanvasMediaTools({
        projectId: "test",
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        setNodes: (value) => {
            nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
        },
        setConnections: (value) => {
            connectionsRef.current = typeof value === "function" ? value(connectionsRef.current) : value;
        },
        setSelectedNodeIds: (value) => {
            selectedNodeIdsRef.current = typeof value === "function" ? value(selectedNodeIdsRef.current) : value;
        },
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

    const productSource: CanvasNodeData = { ...source, type: CanvasNodeType.Product, metadata: { productProfile: createEcommerceProductProfile("商品 A") } };
    nodesRef.current = [productSource];
    uploads = 0;
    afterUpload = () => {
        nodesRef.current = [{ ...productSource, metadata: { ...productSource.metadata, productProfile: createEcommerceProductProfile("商品 B") } }];
    };
    await assert.rejects(() => tools.exportEcommerceDetailPage(productSource, "long", pieces.slice(0, 1), []), /商品名称已变化/);
    assert.equal(nodesRef.current.length, 1);

    const existing: CanvasNodeData = { id: "existing", type: CanvasNodeType.Image, title: "Existing", position: { x: 0, y: 700 }, width: 320, height: 320, metadata: {} };
    nodesRef.current = [source, existing];
    connectionsRef.current = [{ id: "existing-connection", fromNodeId: source.id, toNodeId: existing.id }];
    selectedNodeIdsRef.current = new Set([existing.id]);
    uploads = 0;
    afterUpload = () => {};
    afterAssetSync = () => {
        nodesRef.current = nodesRef.current.map((item) => (item.id === source.id ? { ...item, metadata: { ...item.metadata, locked: true } } : item));
        afterAssetSync = () => {};
    };
    await assert.rejects(() => tools.exportEcommerceDetailPage(source, "long", pieces, []));
    assert.deepEqual(
        nodesRef.current.map((item) => item.id),
        [source.id, existing.id],
    );
    assert.deepEqual(connectionsRef.current, [{ id: "existing-connection", fromNodeId: source.id, toNodeId: existing.id }]);
    assert.deepEqual([...selectedNodeIdsRef.current], []);
    nodesRef.current = [source];
    connectionsRef.current = [];
    uploads = 0;
    valid = true;
    assetSyncError = true;
    afterAssetSync = () => {
        valid = false;
    };
    await assert.rejects(
        () =>
            tools.exportEcommerceDetailPage(source, "long", pieces.slice(0, 1), [], () => {
                if (!valid) throw new Error("delivery changed during failed asset sync");
            }),
        /delivery changed during failed asset sync/,
    );
    assert.equal(nodesRef.current.length, 1);
    assetSyncError = false;
    afterAssetSync = () => {};

    const { CanvasNodeActionContext } = await import("../../src/components/canvas/canvas-node-action-context");
    const { CanvasNodeGraphContext } = await import("../../src/components/canvas/canvas-node-graph-context");
    const { DeliveryNodeContent } = await import("../../src/components/canvas/nodes/delivery-node");
    const { canvasThemes } = await import("../../src/lib/canvas-theme");
    const delivery = { name: "交付", code: "SKU-A", version: 2, targets: [{ id: "target", platformId: "taobao" as const, role: "detail" as const }] };
    let deliveryNode: CanvasNodeData = { id: "delivery", type: CanvasNodeType.Delivery, title: "交付", position: { x: 0, y: 0 }, width: 400, height: 400, metadata: { ecommerceDelivery: delivery } };
    const first: CanvasNodeData = { id: "first", type: CanvasNodeType.Image, title: "第一张", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { storageKey: "first" } };
    const second: CanvasNodeData = { id: "second", type: CanvasNodeType.Image, title: "第二张", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { storageKey: "second" } };
    let deliveryImages = [first, second];
    let deliveryTree: ReactNode;
    let rerenderDelivery = () => {};
    let validateDelivery: (() => void) | undefined;
    function DeliveryProbe() {
        const [, publish] = useState(0);
        rerenderDelivery = () => publish((value) => value + 1);
        deliveryTree = DeliveryNodeContent({ node: deliveryNode, theme: canvasThemes.dark });
        return null;
    }
    const find = (tree: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined => {
        if (!React.isValidElement<Record<string, unknown>>(tree)) return undefined;
        if (predicate(tree)) return tree;
        for (const child of React.Children.toArray(tree.props.children as ReactNode)) {
            const match = find(child, predicate);
            if (match) return match;
        }
        return undefined;
    };
    await act(async () =>
        reconciler.updateContainer(
            <CanvasNodeActionContext.Provider value={{ exportEcommerceDetailPage: async (_node, _long, _pieces, _names, validateSource) => void (validateDelivery = validateSource) }}>
                <CanvasNodeGraphContext.Provider value={{ getUpstreamNodes: () => deliveryImages }}>
                    <DeliveryProbe />
                </CanvasNodeGraphContext.Provider>
            </CanvasNodeActionContext.Provider>,
            root,
            null,
            null,
        ),
    );
    const stitchButton = find(deliveryTree, (element) => typeof element.props.title === "string" && element.props.title.startsWith("把 "));
    assert.ok(stitchButton);
    await act(async () => {
        (stitchButton.props.onClick as () => void)();
        for (let index = 0; index < 10; index++) await Promise.resolve();
    });
    assert.ok(validateDelivery);
    const expectStale = async (mutate: () => void) => {
        mutate();
        await act(async () => rerenderDelivery());
        assert.throws(() => validateDelivery?.(), /交付内容已变化/);
    };
    await expectStale(() => {
        deliveryImages = [second, first];
    });
    deliveryImages = [first, second];
    await act(async () => rerenderDelivery());
    await expectStale(() => {
        deliveryNode = { ...deliveryNode, metadata: { ...deliveryNode.metadata, ecommerceDelivery: { ...delivery, targets: [{ ...delivery.targets[0], platformId: "amazon" }] } } };
    });
    deliveryNode = { ...deliveryNode, metadata: { ...deliveryNode.metadata, ecommerceDelivery: delivery } };
    await act(async () => rerenderDelivery());
    await expectStale(() => {
        deliveryNode = { ...deliveryNode, metadata: { ...deliveryNode.metadata, ecommerceDelivery: { ...delivery, code: "SKU-B" } } };
    });
    deliveryNode = { ...deliveryNode, metadata: { ...deliveryNode.metadata, ecommerceDelivery: delivery } };
    await act(async () => rerenderDelivery());
    await expectStale(() => {
        deliveryNode = { ...deliveryNode, metadata: { ...deliveryNode.metadata, ecommerceDelivery: { ...delivery, version: 3 } } };
    });
    console.log("Long-image export validates account, source, rollback and non-overlapping layout.");
} finally {
    await act(async () => reconciler.updateContainer(null, root, null, null));
}
