import { expect, test } from "bun:test";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import * as ecommerce from "../src/lib/ecommerce/ecommerce-canvas";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { getConnectionTargetAnchor } from "../src/lib/canvas/canvas-project-domain";
import { activeConnectionPath, canvasConnectionPath } from "../src/components/canvas/canvas-connections";
import { planBatchConnections } from "../src/lib/canvas/canvas-batch-connection";
import { defaultConfig } from "../src/stores/use-config-store";

const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "商品", position: { x: 100, y: 100 }, width: 400, height: 500 };
const photo = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 80, height: 80, metadata: { content: "/image.jpg", storageKey: `resource:${id}` } });

test("view handles, not edge insertion order, identify product angles", () => {
    const nodes = [photo("A"), photo("B")];
    const edges = [
        { id: "back", fromNodeId: "A", toNodeId: "product", toHandleId: "product-view:back" },
        { id: "front", fromNodeId: "B", toNodeId: "product", toHandleId: "product-view:front" },
    ];
    const resolve = ecommerce.effectiveProductViews as unknown as (...args: unknown[]) => Record<string, string>;
    const result = resolve(createEcommerceProductProfile("商品"), nodes, edges, "product");
    expect(result.front).toBe("B");
    expect(result.back).toBe("A");
});

test("a visual-reference handle does not assign a product view", () => {
    const nodes = [photo("visual"), photo("front")];
    const edges = [
        { id: "visual", fromNodeId: "visual", toNodeId: "product", toHandleId: "visual-reference:0" },
        { id: "front", fromNodeId: "front", toNodeId: "product", toHandleId: "product-view:front" },
    ];
    expect(ecommerce.connectedProductImageNodes("product", nodes, edges).map((item) => item.id)).toEqual(["front"]);
    expect(ecommerce.connectedStyleReferenceNodes("product", nodes, edges).map((item) => item.id)).toEqual(["visual"]);
});

test("replacing a view keeps other view connections and removes the former occupant", () => {
    const replace = (ecommerce as unknown as Record<string, unknown>).withEcommerceInputConnection;
    expect(typeof replace).toBe("function");
    const edges: CanvasConnection[] = [
        { id: "old", fromNodeId: "old", toNodeId: "product", toHandleId: "product-view:front" },
        { id: "back", fromNodeId: "back", toNodeId: "product", toHandleId: "product-view:back" },
    ];
    const next = (replace as (items: CanvasConnection[], edge: CanvasConnection) => CanvasConnection[])(edges, { id: "new", fromNodeId: "new", toNodeId: "product", toHandleId: "product-view:front" });
    expect(next.map((item) => item.id)).toEqual(["back", "new"]);
});

test("product input anchors match actual pin coordinates", () => {
    const anchor = (getConnectionTargetAnchor as unknown as (...args: unknown[]) => { x: number; y: number })(product, { nodeId: "image", handleType: "source" }, "product-view:front", 0, 0.4, 0.25);
    expect(anchor).toEqual({ x: 200, y: 300 });
    const edge = { id: "edge", fromNodeId: "image", toNodeId: "product", toHandleId: "product-view:front", toAnchorRatio: 0.4, toAnchorXRatio: 0.25 } as CanvasConnection;
    const path = canvasConnectionPath(edge, photo("image"), product);
    expect(path.endX).toBe(200);
    expect(path.endY).toBe(300);
});

test("explicit product view overrides an image's legacy reference role", () => {
    const image = { ...photo("reference"), metadata: { ...photo("reference").metadata, ecommerceReferenceRole: "style" as const } };
    const edges = [{ id: "edge", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:back" }];
    expect(ecommerce.connectedStyleReferenceNodes(product.id, [image], edges)).toEqual([]);
    expect(ecommerce.effectiveProductViews(createEcommerceProductProfile("商品"), [image], edges, product.id).back).toBe(image.id);
});

test("empty connected images still occupy visible input slots", () => {
    const image = { ...photo("empty"), metadata: { content: "" } };
    const edges = [{ id: "edge", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front" }];
    expect(ecommerce.effectiveProductViews(createEcommerceProductProfile("商品"), [image], edges, product.id).front).toBe(image.id);
    expect(ecommerce.productViewNodes(createEcommerceProductProfile("商品"), [image], edges, product.id)).toEqual([]);
});

test("draft connection starts from the same product input pin as the saved edge", () => {
    const path = activeConnectionPath(product, { nodeId: product.id, handleType: "target", handleId: "product-view:front", anchorRatio: 0.4, anchorXRatio: 0.25 }, { x: 0, y: 0 });
    expect(path).toContain(", 200 300");
});

test("generation still reads typed product views when a saved product has no profile", () => {
    const target = { ...photo("target"), metadata: {} };
    const edges = [{ id: "photo", fromNodeId: "back", toNodeId: product.id, toHandleId: "product-view:back" }, { id: "output", fromNodeId: product.id, toNodeId: target.id }];
    const result = ecommerce.resolveEcommerceInputs(target.id, [product, photo("back"), target], edges);
    expect(result.referenceImages.map((item) => item.id)).toEqual(["back"]);
});

test("analysis and generation use the same named view order, excluding empty slots", () => {
    const refs = ecommerce.ecommerceProductReferenceImages;
    const edges = [{ id: "back", fromNodeId: "B", toNodeId: product.id, toHandleId: "product-view:back" }, { id: "front", fromNodeId: "A", toNodeId: product.id, toHandleId: "product-view:front" }];
    const result = refs(product, [product, photo("B"), photo("A")], edges);
    expect(result.map((item: {id: string}) => item.id)).toEqual(["A", "B"]);
    expect(result[0].name).toContain("正面");
    expect(result[1].name).toContain("背面");
});

test("reference guide identifies the actual submitted image order", () => {
    const guide = ecommerce.ecommerceReferenceImageGuide;
    expect(guide([{name:"商品正面"},{name:"视觉参考"}])).toContain("第 1 张：商品正面");
    expect(guide([{name:"商品正面"},{name:"视觉参考"}])).toContain("第 2 张：视觉参考");
    expect(guide([])).toBe("");
});

test("right-click reference conversion moves product-view edges to free reference slots", () => {
    const convert = ecommerce.withImageAsEcommerceReference;
    const edges = [{id:"front",fromNodeId:"A",toNodeId:product.id,toHandleId:"product-view:front",toAnchorRatio:0.2}, {id:"ref",fromNodeId:"B",toNodeId:product.id,toHandleId:"visual-reference:0"}, {id:"other",fromNodeId:"A",toNodeId:"another"}];
    const next = convert(edges, "A", [product.id]);
    expect(next.find((item: CanvasConnection) => item.id === "front")?.toHandleId).toBe("visual-reference:1");
    expect(next.find((item: CanvasConnection) => item.id === "front")?.toAnchorRatio).toBeUndefined();
    expect(next.find((item: CanvasConnection) => item.id === "other")).toEqual(edges[2]);
    expect(convert(next, "A", [product.id])).toEqual(next);
});

test("empty explicit slots cannot be reassigned to a different image during generation", () => {
    const empty = {...photo("empty"),metadata:{}};
    const edges = [{id:"empty",fromNodeId:empty.id,toNodeId:product.id,toHandleId:"product-view:front"},{id:"other",fromNodeId:"other",toNodeId:product.id}];
    const result = ecommerce.ecommerceProductReferenceImages(product, [product,empty,photo("other")],edges);
    expect(result.map((ref) => ref.name)).toEqual(["商品侧面：other"]);
});

test("a moved explicit view clears the previous legacy angle for the same image", () => {
    const profile = {...createEcommerceProductProfile("商品"),views:{front:"A"}};
    const input = {...product,metadata:{productProfile:profile}};
    const edges = [{id:"moved",fromNodeId:"A",toNodeId:product.id,toHandleId:"product-view:back"}];
    expect(ecommerce.ecommerceProductReferenceImages(input,[input,photo("A")],edges)[0]?.name).toBe("商品背面：A");
});

test("batch connections cannot put multiple images in one named product slot", () => {
    const plan = planBatchConnections({sourceNodeIds:["A","B"],targetNodeId:product.id,targetHandleId:"product-view:front",nodes:[product,photo("A"),photo("B")],connections:[],config:defaultConfig});
    expect(plan.connections).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
});
