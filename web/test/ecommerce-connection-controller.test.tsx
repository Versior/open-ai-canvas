import { expect, test } from "bun:test";
import React, { act } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { useCanvasConnectionController } from "../src/pages/canvas/use-canvas-connection-controller";
import { defaultConfig } from "../src/stores/use-config-store";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

test("product slot pointer drags create connected images; ordinary output drags retain the menu", async () => {
    const descriptors = Object.fromEntries(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const originalApp = App.useApp;
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { elementFromPoint: () => null } });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const warnings: string[] = [];
    App.useApp = (() => ({ message: { warning: (value: string) => warnings.push(value), error: (value: string) => warnings.push(value), success() {} } })) as typeof App.useApp;
    const product = createCanvasNode(CanvasNodeType.Product, { x: 100, y: 100 });
    const old = createCanvasNode(CanvasNodeType.Image, { x: 100, y: 900 });
    const nodesRef = { current: [product, old] };
    const connectionsRef = { current: [{ id: "old", fromNodeId: old.id, toNodeId: product.id, toHandleId: "product-view:front" }] as CanvasConnection[] };
    const setter =
        <T,>(ref: { current: T }) =>
        (update: React.SetStateAction<T>) => {
            ref.current = typeof update === "function" ? (update as (value: T) => T)(ref.current) : update;
        };
    let controller!: ReturnType<typeof useCanvasConnectionController>;
    function Probe() {
        controller = useCanvasConnectionController({
            projectId: "test",
            config: defaultConfig,
            defaultDrawingEngine: "excalidraw",
            nodesRef,
            connectionsRef,
            viewportRef: { current: { x: 0, y: 0, k: 1 } },
            scriptScrollTopById: {},
            screenToCanvas: (x, y) => ({ x, y }),
            setNodes: setter<CanvasNodeData[]>(nodesRef),
            setConnections: setter(connectionsRef),
            setSelectedNodeIds() {},
            setSelectedConnectionId() {},
            setContextMenu() {},
            setDialogNodeId() {},
            setDrawingNodeId() {},
        });
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const start = async (nodeId: string, type: "source" | "target", handleId?: string) => {
        await act(async () => controller.handleConnectStart({ pointerId: 1, clientX: 120, clientY: 120, preventDefault() {}, stopPropagation() {} } as React.PointerEvent, nodeId, type, handleId, 0.3, 0.25));
    };
    const drop = async (x: number, y: number) => {
        await act(async () => {
            const event = new Event("pointerup");
            Object.assign(event, { pointerId: 1, clientX: x, clientY: y });
            window.dispatchEvent(event);
        });
    };
    try {
        await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
        await start(product.id, "target", "product-view:front");
        await drop(-900, -900);
        expect(warnings).toEqual([]);
        expect(nodesRef.current).toHaveLength(3);
        const image = nodesRef.current[2];
        expect(image.type).toBe(CanvasNodeType.Image);
        expect(connectionsRef.current).toHaveLength(1);
        expect(connectionsRef.current[0]).toMatchObject({ fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front", toAnchorRatio: 0.3, toAnchorXRatio: 0.25 });
        expect(controller.pendingConnectionCreate).toBeNull();
        await start(product.id, "target", "visual-reference:0");
        await drop(-1100, -900);
        expect(nodesRef.current[3].type).toBe(CanvasNodeType.Image);
        expect(connectionsRef.current.at(-1)?.toHandleId).toBe("visual-reference:0");
        await start(product.id, "target", "visual-reference:1");
        await drop(120, 120);
        expect(nodesRef.current[4].type).toBe(CanvasNodeType.Image);
        await start(old.id, "source");
        await drop(-1400, -900);
        expect(nodesRef.current).toHaveLength(5);
        expect(controller.pendingConnectionCreate?.connection.nodeId).toBe(old.id);
    } finally {
        await act(async () => reconciler.updateContainer(null, root, null, null));
        App.useApp = originalApp;
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
