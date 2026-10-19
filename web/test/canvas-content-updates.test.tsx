import { expect, test } from "bun:test";
import React, { act, useMemo, useRef, useState } from "react";
import { reconciler } from "@react-three/fiber";
import { createCanvasStateWriter } from "../src/lib/canvas/canvas-editor-state";
import { useCanvasContentUpdates } from "../src/pages/canvas/use-canvas-content-updates";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "Product", position: { x: 0, y: 0 } };

test("saving a suite draft cannot rewind newly spawned outputs or their queue", async () => {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let api!: ReturnType<typeof useCanvasContentUpdates> & { nodes: CanvasNodeData[]; ref: { current: CanvasNodeData[] }; write: ReturnType<typeof createCanvasStateWriter<CanvasNodeData[]>> };
    function Probe() {
        const ref = useRef([product]);
        const [nodes, publish] = useState(ref.current);
        const write = useMemo(() => createCanvasStateWriter(ref, publish), []);
        api = { nodes, ref, write, ...useCanvasContentUpdates(ref, publish) };
        return null;
    }
    const fail = (error: unknown) => { throw error; };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    try {
        await act(async () => { reconciler.updateContainer(<Probe />, root, null, null); });
        for (let round = 1; round <= 2; round++) {
            await act(async () => {
                api.write((current) => [...current]);
                api.updateNode("product", (node) => ({ ...node, metadata: { ...node.metadata, prompt: "Draft " + round } }));
                api.write((current) => [...current, ...Array.from({ length: 5 }, (_, index) => ({ ...product, id: "output-" + round + "-" + index, type: CanvasNodeType.Image }))]);
                api.write((current) => current.map((node) => node.id === "product" ? { ...node, metadata: { ...node.metadata, ecommerceImageModel: "queue-" + round } } : node));
            });
            expect(api.ref.current).toEqual(api.nodes);
            expect(api.nodes[0].metadata?.prompt).toBe("Draft " + round);
            await act(async () => { api.write((current) => [...current]); });
            expect(api.nodes.filter((node) => node.type === CanvasNodeType.Image)).toHaveLength(round * 5);
            expect(api.nodes[0].metadata?.ecommerceImageModel).toBe("queue-" + round);
        }
        await act(async () => {
            api.updateMediaNode("output-1-0", (node) => ({ ...node, metadata: { ...node.metadata, naturalWidth: 1024 } }));
            api.updateMediaNode("output-1-0", (node) => ({ ...node, metadata: { ...node.metadata, naturalHeight: 768 } }));
            api.write((current) => [...current, { ...product, id: "later-output", type: CanvasNodeType.Image }]);
            await new Promise((resolve) => setTimeout(resolve, 160));
        });
        expect(api.ref.current).toEqual(api.nodes);
        expect(api.nodes).toHaveLength(12);
        expect(api.nodes.find((node) => node.id === "output-1-0")?.metadata).toMatchObject({ naturalWidth: 1024, naturalHeight: 768 });
    } finally {
        await act(async () => { reconciler.updateContainer(null, root, null, null); });
        if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
});
