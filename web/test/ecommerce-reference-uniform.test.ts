import { describe, expect, test } from "bun:test";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { productViewNodes, resolveEcommerceInputs } from "../src/lib/ecommerce/ecommerce-canvas";
import { ecommerceSuiteDraftPrompt, ecommerceSuiteSkeleton } from "../src/lib/ecommerce/ecommerce-suite";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import * as presets from "../src/lib/ecommerce/ecommerce-canvas-preset";

function fixture() {
    const product: CanvasNodeData = {
        id: "product", type: CanvasNodeType.Product, title: "商品", position: { x: 0, y: 0 }, width: 460, height: 440,
        metadata: { productProfile: createEcommerceProductProfile("杯子"), ecommerceUniformPrompt: "自然日光，沿用商品材质，统一留白", ecommerceShotSet: { name: "旧方案", global: "固定旧要求", shots: [], updatedAt: "" } } as CanvasNodeData["metadata"],
    };
    const nodes: CanvasNodeData[] = [
        product,
        { id: "visual", type: CanvasNodeType.Image, title: "视觉参考", position: { x: -500, y: -400 }, width: 320, height: 240, metadata: { content: "/visual.webp", storageKey: "resource:visual", ecommerceReferenceRole: "style" } as CanvasNodeData["metadata"] },
        { id: "photo", type: CanvasNodeType.Image, title: "商品实拍", position: { x: -500, y: 0 }, width: 320, height: 240, metadata: { content: "/product.webp", storageKey: "resource:product" } },
        { id: "output", type: CanvasNodeType.Image, title: "产物", position: { x: 500, y: 0 }, width: 320, height: 240 },
    ];
    const connections: CanvasConnection[] = [
        { id: "visual-product", fromNodeId: "visual", toNodeId: "product" },
        { id: "photo-product", fromNodeId: "photo", toNodeId: "product" },
        { id: "product-output", fromNodeId: "product", toNodeId: "output" },
    ];
    return { product, nodes, connections };
}

describe("image and prompt driven suite consistency", () => {
    test("visual references never claim product identity views", () => {
        const { product, nodes, connections } = fixture();
        expect(productViewNodes(product.metadata?.productProfile, nodes, connections, product.id).map((item) => item.id)).toEqual(["photo"]);
    });

    test("generation includes product imagery before separate visual references", () => {
        const { nodes, connections } = fixture();
        const result = resolveEcommerceInputs("output", nodes, connections);
        expect(result.referenceImages.map((item) => item.id)).toEqual(["photo", "visual"]);
        expect(result.prompt).not.toContain("自然日光，沿用商品材质，统一留白");
        expect(result.prompt).not.toContain("固定旧要求");
        expect(result.prompt).not.toContain("【拍摄方案】旧方案");
        expect(result.prompt).toContain("视觉参考");
    });

    test("disconnecting a reference removes it from the next generation request", () => {
        const { nodes, connections } = fixture();
        const result = resolveEcommerceInputs("output", nodes, connections.filter((item) => item.id !== "visual-product"));
        expect(result.referenceImages.map((item) => item.id)).toEqual(["photo"]);
        expect(result.prompt).not.toContain("名为「视觉参考」");
    });

    test("the analysis prompt names visual images and includes editable consistency instructions", () => {
        const flow = ECOMMERCE_ONE_CLICK_FLOWS[0];
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteSkeleton(flow), undefined, { styleReferenceNames: ["视觉参考"] });
        expect(prompt).toContain("视觉参考");
        expect(prompt).not.toContain("【色彩美学】");
        expect(prompt).not.toContain("【字体风格】");
    });

    test("adding a visual reference creates a visible image and a real product connection", () => {
        const { product, nodes } = fixture();
        const create = (presets as unknown as Record<string, unknown>).createEcommerceStyleReference;
        expect(typeof create).toBe("function");
        const plan = (create as (product: CanvasNodeData, nodes: CanvasNodeData[]) => { node: CanvasNodeData; connection: CanvasConnection })(product, nodes);
        expect(plan.node.type).toBe(CanvasNodeType.Image);
        expect((plan.node.metadata as Record<string, unknown>).ecommerceReferenceRole).toBe("style");
        expect(plan.connection.fromNodeId).toBe(plan.node.id);
        expect(plan.connection.toNodeId).toBe(product.id);
    });
});
