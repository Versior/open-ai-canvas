import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { connectedImageNodes, effectiveProductViews, isEcommerceNode, mergeEcommercePrompt, productViewNodes, resolveEcommerceInputs, upstreamEcommerceNodes } from "@/lib/ecommerce/ecommerce-canvas";
import { createEcommerceCopy, createEcommerceProductProfile, createEcommerceSellingPoint, createEcommerceShot, createEcommerceShotSet, createEcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceModel } from "@/lib/ecommerce/ecommerce-models";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function imageNode(id: string, title: string): CanvasNodeData {
    return { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: `data:image/png;base64,${id}` }), id, title };
}

function connect(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}->${toNodeId}`, fromNodeId, toNodeId };
}

describe("ecommerce canvas wiring", () => {
    const profile = { ...createEcommerceProductProfile("保温杯"), category: "保温杯", appearance: "哑光黑", views: { front: "img-front", side: "img-side", back: "img-missing" } };
    const shotSet = { ...createEcommerceShotSet("白底棚拍"), shots: [{ ...createEcommerceShot("白底棚拍", "main-1"), composition: "居中构图", background: "纯白背景" }] };
    const style = { ...createEcommerceStyle("极简白"), palette: ["#FFFFFF", "#1A1A1A"], mood: "干净克制" };
    const points = [createEcommerceSellingPoint("保温 12 小时", "检测报告")];
    const copy = { ...createEcommerceCopy(), headline: "一次装够一天的水" };

    const product = { ...createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: profile }), id: "product-1" };
    const shot = { ...createCanvasNode(CanvasNodeType.ShotRecipe, { x: 0, y: 0 }, { shotSet }), id: "shot-1" };
    const styleNode = { ...createCanvasNode(CanvasNodeType.Style, { x: 0, y: 0 }, { ecommerceStyle: style }), id: "style-1" };
    const pointNode = { ...createCanvasNode(CanvasNodeType.SellingPoint, { x: 0, y: 0 }, { sellingPoints: points }), id: "points-1" };
    const copyNode = { ...createCanvasNode(CanvasNodeType.Copy, { x: 0, y: 0 }, { ecommerceCopy: copy }), id: "copy-1" };
    const front = imageNode("img-front", "正面图");
    const side = imageNode("img-side", "侧面图");
    const target = { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {}), id: "target-1" };
    const nodes = [product, shot, styleNode, pointNode, copyNode, front, side, target];
    const connections = [
        connect("product-1", "target-1"), connect("shot-1", "target-1"), connect("style-1", "target-1"),
        connect("points-1", "target-1"), connect("copy-1", "target-1"),
    ];

    test("recognises exactly the five ecommerce constraint nodes", () => {
        for (const node of [product, shot, styleNode, pointNode, copyNode]) expect(isEcommerceNode(node)).toBe(true);
        expect(isEcommerceNode(target)).toBe(false);
        expect(isEcommerceNode(front)).toBe(false);
    });

    test("finds every upstream constraint node by type, not position", () => {
        const found = upstreamEcommerceNodes("target-1", nodes, connections);
        expect(found.product?.id).toBe("product-1");
        expect(found.recipe?.id).toBe("shot-1");
        expect(found.style?.id).toBe("style-1");
        expect(found.sellingPoints?.id).toBe("points-1");
        expect(found.copy?.id).toBe("copy-1");
        // 反方向连线不该被当成上游
        expect(upstreamEcommerceNodes("product-1", nodes, connections).product).toBeUndefined();
    });

    test("ignores batch-output relations so generated results do not feed back", () => {
        const withOutput: CanvasConnection[] = [...connections, { id: "out", fromNodeId: "shot-1", toNodeId: "target-1", relation: "batch-output" }];
        expect(upstreamEcommerceNodes("target-1", nodes, withOutput).recipe?.id).toBe("shot-1");
    });

    test("compiles all five blocks in hard-to-soft order and appends the node's own prompt last", () => {
        const inputs = resolveEcommerceInputs("target-1", nodes, connections);
        const order = ["【商品锁定】", "【品牌风格】", "【商品卖点】", "【文案】", "【拍摄方案】"].map((marker) => inputs.prompt.indexOf(marker));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(mergeEcommercePrompt(inputs.prompt, "再补一句：画面偏暖")).toEndWith("再补一句：画面偏暖");
        expect(mergeEcommercePrompt("", "只用自己的提示词")).toBe("只用自己的提示词");
    });

    test("collects bound view images in view order and drops unbound or missing ones", () => {
        const views = productViewNodes(profile, nodes);
        expect(views.map((node) => node.id)).toEqual(["img-front", "img-side"]);
        expect(productViewNodes(undefined, nodes)).toEqual([]);
    });

    test("a canvas with no ecommerce nodes produces nothing and changes no behaviour", () => {
        const plain = [{ ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {}), id: "plain" }];
        const inputs = resolveEcommerceInputs("plain", plain, []);
        expect(inputs.prompt).toBe("");
        expect(inputs.referenceImages).toEqual([]);
    });

    test("only the first node of a duplicated type is used, so the result stays predictable", () => {
        const second = { ...createCanvasNode(CanvasNodeType.ShotRecipe, { x: 0, y: 0 }, { shotSet: { ...createEcommerceShotSet("第二条拍法"), shots: [{ ...createEcommerceShot("第二条拍法", "m2"), composition: "俯拍" }] } }), id: "shot-2" };
        const inputs = resolveEcommerceInputs("target-1", [...nodes, second], [...connections, connect("shot-2", "target-1")]);
        expect(inputs.sources.shotSet?.name).toBe("白底棚拍");
        expect(inputs.prompt).not.toContain("俯拍");
    });

    test("walks the constraint chain: 商品 → 拍法 → 图片 still gets the product lock", () => {
        const chained = [product, shot, target];
        const chain = [connect("product-1", "shot-1"), connect("shot-1", "target-1")];
        const found = upstreamEcommerceNodes("target-1", chained, chain);
        expect(found.recipe?.id).toBe("shot-1");
        // 商品隔着拍法也要拿到——否则连线看着对、结果却少了锁定块
        expect(found.product?.id).toBe("product-1");
        expect(resolveEcommerceInputs("target-1", chained, chain).prompt).toContain("【商品锁定】");
    });

    test("keeps walking through a longer constraint chain", () => {
        const chained = [product, pointNode, styleNode, shot, target];
        const chain = [
            connect("product-1", "points-1"),
            connect("points-1", "style-1"),
            connect("style-1", "shot-1"),
            connect("shot-1", "target-1"),
        ];
        const found = upstreamEcommerceNodes("target-1", chained, chain);
        expect([found.product?.id, found.sellingPoints?.id, found.style?.id, found.recipe?.id]).toEqual(["product-1", "points-1", "style-1", "shot-1"]);
    });

    test("stops at media nodes so a neighbouring branch does not leak in", () => {
        // 商品 → 参考图（图片节点）→ 目标：图片节点不是约束节点，链条到此为止
        const graph = [product, front, target];
        const edges = [connect("product-1", "img-front"), connect("img-front", "target-1")];
        expect(upstreamEcommerceNodes("target-1", graph, edges).product).toBeUndefined();
    });

    test("a cycle does not hang the walk", () => {
        const cyclic = [shot, styleNode, target];
        const edges = [connect("shot-1", "style-1"), connect("style-1", "shot-1"), connect("shot-1", "target-1")];
        expect(upstreamEcommerceNodes("target-1", cyclic, edges).style?.id).toBe("style-1");
    });
});

describe("商品实拍接进参考图：连线就是在指定「这是这个商品」", () => {
    const productNode = { ...createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("保温杯") }), id: "product-1" };
    const photo = (id: string) => ({ ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: `blob:${id}`, storageKey: `image:u:${id}` }), id });
    const front = photo("front");
    const side = photo("side");

    test("没绑视角时，连进商品节点的图按顺序补上——这是原先最大的静默丢失", () => {
        const graph = [productNode, front, side];
        const edges = [connect("front", "product-1"), connect("side", "product-1")];
        const views = effectiveProductViews(productNode.metadata?.productProfile, connectedImageNodes("product-1", graph, edges));
        expect(views.front).toBe("front");
        expect(views.side).toBe("side");
    });

    test("显式绑定的视角优先，不被连线顺序挤掉", () => {
        const profile = { ...createEcommerceProductProfile("保温杯"), views: { detail: "side" } };
        const graph = [productNode, front, side];
        const edges = [connect("front", "product-1"), connect("side", "product-1")];
        const views = effectiveProductViews(profile, connectedImageNodes("product-1", graph, edges));
        expect(views.detail).toBe("side");
        expect(views.front).toBe("front");
        // 已被显式占用的图不会同时出现在自动槽位里
        expect(Object.values(views).filter((id) => id === "side")).toHaveLength(1);
    });

    test("显式清空的槽位挡住自动认领——否则用户刚取消的视角下一秒又回来了", () => {
        const profile = { ...createEcommerceProductProfile("保温杯"), views: { front: "" } };
        const graph = [productNode, front];
        const edges = [connect("front", "product-1")];
        const views = effectiveProductViews(profile, connectedImageNodes("product-1", graph, edges));
        expect(views.front).toBe("");
        expect(views.side).toBe("front");
    });

    test("productViewNodes 按视角顺序返回，且读的是同一份生效判据", () => {
        const profile = createEcommerceProductProfile("保温杯");
        const graph = [productNode, front, side];
        const edges = [connect("front", "product-1"), connect("side", "product-1")];
        const picked = productViewNodes(profile, graph, edges, "product-1");
        expect(picked.map((node) => node.id)).toEqual(["front", "side"]);
    });

    test("生成时商品实拍进参考图，模特参考图按 storageKey 一起进", () => {
        const model = createEcommerceModel("小美", ["image:u:model-a"]);
        const graph = [productNode, front, { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceModelId: model.id }), id: "target-1" }];
        const edges = [connect("front", "product-1"), connect("product-1", "target-1")];
        const inputs = resolveEcommerceInputs("target-1", graph, edges, [model]);
        expect(inputs.referenceImages.map((image) => image.storageKey)).toEqual(["image:u:front", "image:u:model-a"]);
    });

    test("画布上没有电商节点时参考图为空", () => {
        const plain = [{ ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {}), id: "plain" }];
        expect(resolveEcommerceInputs("plain", plain, []).referenceImages).toEqual([]);
    });
});

describe("输入框为空也能提交", () => {
    const panel = readFileSync(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url), "utf8");
    const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");

    test("上游有电商节点时提交按钮不禁用——灰按钮等于点了没反应", () => {
        expect(panel).toContain("const isSubmitDisabled = !isRunning && !prompt.trim() && !ecommercePromptAvailable;");
        expect(panel).toContain("if ((!text && !ecommercePromptAvailable) || isRunning) return false;");
    });

    test("判据由页面给，面板自己不遍历图", () => {
        expect(project).toContain("ecommercePromptAvailable={canvasKind === \"ecommerce\" && Boolean(resolveEcommerceInputs(panelNode.id, nodesRef.current, connectionsRef.current).prompt)}");
    });
});
