import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    connectedImageNodes,
    ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR,
    ECOMMERCE_MISSING_DETAIL_ROW_ERROR,
    ECOMMERCE_PROMPT_PLACEHOLDER_ERROR,
    ecommerceProductReferenceSignature,
    ecommerceReferenceImageGuide,
    ecommerceRowPromptIssue,
    ecommerceTextModeOf,
    effectiveProductViews,
    isEcommerceNode,
    mergeEcommercePrompt,
    productViewNodes,
    resolveEcommerceInputs,
    upstreamEcommerceNodes,
} from "@/lib/ecommerce/ecommerce-canvas";
import { ecommerceSuiteTargets } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { createCanvasBatchInputSnapshot } from "@/lib/canvas/canvas-batch-input-snapshot";
import { createEcommerceCopy, createEcommerceProductProfile, createEcommerceSellingPoint, createEcommerceShot, createEcommerceShotSet, createEcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceModel } from "@/lib/ecommerce/ecommerce-models";
import { ecommerceOneClickFlow } from "@/lib/ecommerce/ecommerce-oneclick";
import { connectEcommerceTableOutputs } from "@/lib/ecommerce/ecommerce-table";
import { ECOMMERCE_REPLICA_PRODUCT_HANDLE, ECOMMERCE_REPLICA_REFERENCE_HANDLE, createEcommerceReplica } from "@/lib/ecommerce/ecommerce-replica";
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
    const connections = [connect("product-1", "target-1"), connect("shot-1", "target-1"), connect("style-1", "target-1"), connect("points-1", "target-1"), connect("copy-1", "target-1")];

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

    test("只去重显式声明的当前画面原文，不猜拆旧文本或不同的补充", () => {
        const visualPrompt = "杯子立在暖窗光台面";
        const compiled = `画面构成：${visualPrompt}`;
        expect(mergeEcommercePrompt(compiled, ` ${visualPrompt} `, { visualPrompt })).toBe(compiled);
        expect(mergeEcommercePrompt(compiled, visualPrompt)).toBe(`${compiled}\n\n${visualPrompt}`);
        expect(mergeEcommercePrompt(compiled, "额外要求：让窗光更柔和", { visualPrompt })).toEndWith("额外要求：让窗光更柔和");
        expect(mergeEcommercePrompt(compiled, "主标题：旧营销文字", { visualPrompt: "" })).toBe(compiled);
    });

    test("一键详情页把确认文案交给图片模型，同时保留本地排版回退数据", () => {
        const detailCopy = { ...createEcommerceCopy(), headline: "通勤一路温热", subhead: "杯盖提手，随手带走" };
        const detailTarget = {
            ...target,
            id: "detail-target",
            metadata: { ...target.metadata, ecommerceProductId: product.id, ecommerceFlowId: "detail", ecommerceCopy: detailCopy },
        };
        const detailInputs = resolveEcommerceInputs(detailTarget.id, [product, detailTarget], [connect(product.id, detailTarget.id)]);
        expect(detailInputs.sources.renderCopyText).toBe(true);
        expect(detailInputs.sources.copy).toEqual(detailCopy);
        expect(detailInputs.prompt).toContain("以下文字要出现在画面上");
        expect(detailInputs.prompt).toContain("标题：通勤一路温热");
        expect(detailInputs.prompt).toContain("副文案：杯盖提手，随手带走");
        expect(detailInputs.prompt).not.toContain("【无字底图合同】");

        const mainTarget = { ...detailTarget, id: "main-target", metadata: { ...detailTarget.metadata, ecommerceFlowId: "main" } };
        const mainInputs = resolveEcommerceInputs(mainTarget.id, [product, mainTarget], [connect(product.id, mainTarget.id)]);
        expect(mainInputs.sources.renderCopyText).toBe(false);
        expect(mainInputs.prompt).toContain("【无字底图合同】");
    });

    test("passes replica slot images downstream and labels their final positions after direct images", () => {
        const replicaProduct = imageNode("replica-product", "自家商品");
        const replicaReference = imageNode("replica-reference", "爆款参考");
        const direct = imageNode("direct", "普通连线图");
        const replica = { ...createCanvasNode(CanvasNodeType.Replica, { x: 0, y: 0 }, { ecommerceReplica: createEcommerceReplica() }), id: "replica-1" };
        const graph = [replicaProduct, replicaReference, direct, replica, target];
        const edges: CanvasConnection[] = [
            { ...connect(replicaProduct.id, replica.id), toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
            { ...connect(replicaReference.id, replica.id), toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
            connect(replica.id, target.id),
            connect(direct.id, target.id),
        ];

        const inputs = resolveEcommerceInputs(target.id, graph, edges);
        expect(inputs.referenceImages.map((image) => image.id)).toEqual([replicaProduct.id, replicaReference.id]);
        expect(ecommerceReferenceImageGuide([{ name: direct.title! }, ...inputs.referenceImages])).toContain(["第 2 张：商品图（主体）：自家商品", "第 3 张：参考图（结构）：爆款参考"].join("\n"));
    });
    test("旧商品拍摄方案不再覆盖逐张确认的提示词", () => {
        const legacyProduct = { ...product, metadata: { ...product.metadata, ecommerceShotSet: shotSet } };
        const inputs = resolveEcommerceInputs("target-1", [legacyProduct, target], [connect("product-1", "target-1")]);
        expect(inputs.sources.shotSet).toBeUndefined();
        expect(inputs.prompt).not.toContain("【拍摄方案】");
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
        expect(inputs.copy.source).toBe("none");
        expect(inputs.textMode).toBeUndefined();
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
        const chain = [connect("product-1", "points-1"), connect("points-1", "style-1"), connect("style-1", "shot-1"), connect("shot-1", "target-1")];
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

    test("商品媒体身份签名不保存 URL/data URL，并对持久资源和旧内联资源保持准确", () => {
        const edges = [connect("persisted", "product-1")];
        const persisted = { ...photo("persisted"), metadata: { content: "https://signed.example/private-token", storageKey: "image:u:persisted", assetId: "asset-1" } };
        const signature = ecommerceProductReferenceSignature(productNode, [productNode, persisted], edges);
        expect(signature).not.toContain(persisted.metadata.content);
        expect(ecommerceProductReferenceSignature(productNode, [productNode, { ...persisted, metadata: { ...persisted.metadata, content: "https://signed.example/refreshed-token" } }], edges)).toBe(signature);
        expect(ecommerceProductReferenceSignature(productNode, [productNode, { ...persisted, metadata: { ...persisted.metadata, assetId: "asset-2" } }], edges)).not.toBe(signature);

        const content = `data:image/png;base64,${"legacy-pixels".repeat(100)}`;
        const legacy = { ...photo("legacy"), metadata: { content } };
        const legacyEdges = [connect("legacy", "product-1")];
        const legacySignature = ecommerceProductReferenceSignature(productNode, [productNode, legacy], legacyEdges);
        expect(legacySignature).not.toContain(content);
        expect(ecommerceProductReferenceSignature(productNode, [productNode, { ...legacy, position: { x: 100, y: 100 } }], legacyEdges)).toBe(legacySignature);
        expect(ecommerceProductReferenceSignature(productNode, [productNode, { ...legacy, metadata: { ...legacy.metadata } }], legacyEdges)).toBe(legacySignature);
        expect(ecommerceProductReferenceSignature(productNode, [productNode, { ...legacy, metadata: { content: `${content}-changed` } }], legacyEdges)).not.toBe(legacySignature);
        const mutableMetadata = { content };
        const mutable = { ...legacy, metadata: mutableMetadata };
        const mutableSignature = ecommerceProductReferenceSignature(productNode, [productNode, mutable], legacyEdges);
        mutableMetadata.content = `${content}-mutated`;
        expect(ecommerceProductReferenceSignature(productNode, [productNode, mutable], legacyEdges)).not.toBe(mutableSignature);
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
        expect(project).toContain('ecommercePromptAvailable={canvasKind === "ecommerce" && Boolean(resolveEcommerceInputs(panelNode.id, nodesRef.current, connectionsRef.current).prompt)}');
    });
});

test("复制的创作表只复用归属自己的套图产物", () => {
    const product = { ...createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }), id: "product" };
    const suite = {
        flow: "main",
        source: "draft" as const,
        updatedAt: "",
        rows: [{ slotId: "main-1", title: "主图", duty: "展示商品", prompt: "生成主图" }],
    };
    const table = { ...createCanvasNode(CanvasNodeType.BatchTable, { x: 500, y: 0 }, { ecommerceProductId: product.id, ecommerceFlowId: "main", ecommerceSuite: suite }), id: "table-copy" };
    const current = { ...imageNode("current-result", "副本产物"), metadata: { ecommerceProductId: product.id, ecommerceFlowId: "main", ecommerceShotId: "main-1", batchSourceNodeId: table.id } };
    const original = { ...imageNode("original-result", "原表产物"), metadata: { ecommerceProductId: product.id, ecommerceFlowId: "main", ecommerceShotId: "main-1", batchSourceNodeId: "table-original" } };
    const flow = ecommerceOneClickFlow("main")!;

    const reuse = ecommerceSuiteTargets(product, flow, suite, { nodes: [product, table, current, original], connections: [] }, {}, () => "edge", undefined, table.id);
    expect(reuse.reuse).toEqual([{ slotId: "main-1", nodeId: current.id, prompt: "生成主图" }]);

    const withoutOwnedResult = ecommerceSuiteTargets(product, flow, suite, { nodes: [product, table, original], connections: [] }, {}, () => "edge", undefined, table.id);
    expect(withoutOwnedResult.reuse).toEqual([]);
    expect(withoutOwnedResult.spawned).toHaveLength(1);
});

test("创作表重复认领同一产物时不再追加 batch-output 边", () => {
    const table = { ...createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 0 }), id: "table" };
    const output = imageNode("output", "主图");
    const plan = {
        rows: [{ slotId: "main-1", title: "主图", duty: "展示商品", prompt: "生成主图" }],
        reuse: [{ slotId: "main-1", nodeId: output.id, prompt: "生成主图" }],
        spawned: [],
        connections: [],
        reconnect: [],
        nodeIds: [output.id],
    };

    const first = connectEcommerceTableOutputs(plan, table, [table, output]);
    const second = connectEcommerceTableOutputs(plan, table, [table, output], first.connections);

    expect(first.connections.filter((edge) => edge.relation === "batch-output")).toHaveLength(1);
    expect(second.connections.filter((edge) => edge.relation === "batch-output")).toEqual([]);
});

describe("当前表行是文案的唯一真相", () => {
    const flow = ecommerceOneClickFlow("detail")!;
    const product = { ...createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { productProfile: createEcommerceProductProfile("保温杯") }), id: "product-1" };
    const legacyCopy = { ...createEcommerceCopy(), headline: "节点上的旧标题" };
    const target = {
        ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, {}),
        id: "detail-1-result",
        metadata: { ecommerceProductId: "product-1", ecommerceFlowId: "detail", ecommerceShotId: "detail-1", ecommerceCopy: legacyCopy },
    };
    const graph = [product, target];
    const edges = [connect("product-1", "detail-1-result")];
    const row = (copy?: { headline?: string }) => ({
        slotId: "detail-1",
        title: "痛点共情",
        duty: "说出买家正在遇到的问题",
        prompt: "画面构成：暖窗光下的台面；产品摆放：杯子居中",
        imagePromptContractVersion: 1 as const,
        ...(copy ? { copy: { ...createEcommerceCopy(), ...copy } } : {}),
    });

    test("即时草稿行覆盖节点上的旧文案，且签名来源可追溯", () => {
        const inputs = resolveEcommerceInputs(target.id, graph, edges, [], [row({ headline: "草稿里的新标题" })]);
        expect(inputs.copy.source).toBe("row");
        expect(inputs.copy.value?.headline).toBe("草稿里的新标题");
        expect(inputs.prompt).toContain("标题：草稿里的新标题");
        expect(inputs.prompt).not.toContain("节点上的旧标题");
    });

    test("表行显式清空文案时不回退到节点旧值", () => {
        const inputs = resolveEcommerceInputs(target.id, graph, edges, [], [row()]);
        expect(inputs.copy.source).toBe("row");
        expect(inputs.copy.value).toBeUndefined();
        expect(inputs.prompt).not.toContain("节点上的旧标题");
        // 清空就是不要字：整块【文案】都不该出现，别给模型留填空的机会。
        expect(inputs.prompt).not.toContain("【文案】");
    });

    test("非详情入口没有表行时仍读节点文案，来源标成 node", () => {
        const mainTarget = { ...target, metadata: { ...target.metadata, ecommerceFlowId: "main" } };
        const inputs = resolveEcommerceInputs(mainTarget.id, [product, mainTarget], edges);
        expect(inputs.copy.source).toBe("node");
        expect(inputs.prompt).toContain("节点上的旧标题");
    });

    test("详情入口认领了行却读不到：拒绝生成，旧节点文案不进提示词", () => {
        // 表被删、行被删、表串了流程——三种都是「这一张没有当前合同行」。
        // 旧节点上的文案只留给预览：它一旦进提示词，用户删掉的营销字就会画回图上。
        const inputs = resolveEcommerceInputs(target.id, graph, edges);
        expect(inputs.issue).toBe(ECOMMERCE_MISSING_DETAIL_ROW_ERROR);
        expect(inputs.prompt).not.toContain("节点上的旧标题");
        // 预览通道仍拿得到旧文案，界面不会突然一片空白。
        expect(inputs.copy.source).toBe("node");
        expect(inputs.copy.value?.headline).toBe("节点上的旧标题");
    });

    test("文本模式严格由文案通道映射得出", () => {
        expect(ecommerceTextModeOf(true)).toBe("model");
        expect(ecommerceTextModeOf(false)).toBe("local");
        expect(ecommerceTextModeOf(undefined)).toBeUndefined();
        expect(resolveEcommerceInputs(target.id, graph, edges).textMode).toBe("model");
        const mainTarget = { ...target, metadata: { ...target.metadata, ecommerceFlowId: "main" } };
        expect(resolveEcommerceInputs(mainTarget.id, [product, mainTarget], edges).textMode).toBe("local");
    });

    test("旧版详情自由文本禁止新生成，并给出可直接展示的原因", () => {
        const legacy = { slotId: "detail-1", title: "痛点共情", duty: "说出问题", prompt: "主标题：通勤一路温热；副标题：随手带走" };
        expect(ecommerceRowPromptIssue(legacy)).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
        expect(ecommerceRowPromptIssue(row({ headline: "通勤一路温热" }))).toBe("");

        // 共享解析自己也要给出同一句拒绝原因——单图执行不带表上下文时由调用方传 rowsOverride
        expect(resolveEcommerceInputs(target.id, graph, edges, [], [legacy]).issue).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
        expect(resolveEcommerceInputs(target.id, graph, edges, [], [row({ headline: "通勤一路温热" })]).issue).toBeUndefined();
    });

    test("没有合同版本的详情行一律禁止新生成，不猜纯画面安全", () => {
        // 看着像纯画面的旧行也不能放行：可能是被截断的自由文本，猜错的代价是把文案画进图。
        const looksClean = { slotId: "detail-1", title: "痛点共情", duty: "说出问题", prompt: "暖窗光下的台面，杯子居中" };
        expect(ecommerceRowPromptIssue(looksClean)).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
        expect(resolveEcommerceInputs(target.id, graph, edges, [], [looksClean]).issue).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
    });

    test("占位事实不得入画：文案与提示词都要干净", () => {
        expect(ecommerceRowPromptIssue(row({ headline: "认证待补充" }))).toBe(ECOMMERCE_PROMPT_PLACEHOLDER_ERROR);
        expect(ecommerceRowPromptIssue({ ...row(), prompt: "参数：未识别，按实际展示" })).toBe(ECOMMERCE_PROMPT_PLACEHOLDER_ERROR);
    });

    test("非详情入口不受详情合同约束", () => {
        expect(ecommerceRowPromptIssue({ slotId: "main-1", title: "主图", duty: "展示", prompt: "纯白底，商品占七成" }, "main")).toBe("");
    });

    test("model 模式的版式要进提示词，local 模式的底图不带版式", () => {
        const layout = {
            name: "左文右图",
            blocks: [{ id: "block-1", field: "headline" as const, anchor: "top-left" as const, size: 8, color: "#111111", plate: "", align: "left" as const, inset: 5, bold: true }],
        };
        const drafted = { ...row({ headline: "通勤一路温热" }), layout };

        const model = resolveEcommerceInputs(target.id, graph, edges, [], [drafted]);
        expect(model.textMode).toBe("model");
        // 七项输出把版式逐项内嵌到对应文字行后面：位置只有一处说法，不再另起一段【版式】。
        expect(model.prompt).toContain("主标题：通勤一路温热（置于左上，左对齐");
        expect(model.prompt).toContain("字色 #111111");
        expect(model.prompt).toContain("字号约占短边 8%");
        expect(model.prompt).toContain("加粗");
        expect(model.prompt).not.toContain("【版式】");

        // 改版式就得换提示词——签名带着它，用户调完位置才知道要重出。
        const moved = { ...drafted, layout: { ...layout, blocks: [{ ...layout.blocks[0], anchor: "bottom-center" as const }] } };
        expect(resolveEcommerceInputs(target.id, graph, edges, [], [moved]).prompt).not.toBe(model.prompt);

        // 换版式名也算改：模型据此知道整套的排布意图。
        // 详情七项里版式名不出现（位置已逐项内嵌），这一段留给非七项路径校验。
        expect(resolveEcommerceInputs(target.id, graph, edges, [], [{ ...drafted, layout: { ...layout, name: "居中大字" } }]).prompt).toBe(model.prompt);

        // local 走本地叠字，版式不进底图，否则改字改位置都要重出。
        const mainTarget = { ...target, metadata: { ...target.metadata, ecommerceFlowId: "main" } };
        const local = resolveEcommerceInputs(mainTarget.id, [product, mainTarget], edges, [], [drafted]);
        expect(local.textMode).toBe("local");
        expect(local.prompt).not.toContain("【版式】");
        expect(local.prompt).not.toContain("字号约占短边");
    });

    test("详情新合同行的最终提示词是完整七项，文案只从 copy 来", () => {
        const visual = [
            "画面构成：3:4 竖版暖窗光台面，杯子居中偏下",
            "产品摆放：杯身朝向左侧，露出 LOGO",
            "视觉风格：暖白极简，字号大气",
            "负面提示词：错色、LOGO 错误、虚构参数",
        ].join("；\n");
        const ready = { ...row({ headline: "通勤一路温热" }), prompt: visual };

        const final = resolveEcommerceInputs(target.id, graph, edges, [], [ready]).prompt;
        const order = ["画面构成：", "产品摆放：", "主标题：", "副标题：", "卖点模块：", "视觉风格：", "负面提示词："].map((label) => final.indexOf(label));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(final).toContain("画面构成：3:4 竖版暖窗光台面，杯子居中偏下");
        expect(final).toContain("产品摆放：杯身朝向左侧，露出 LOGO");
        expect(final).toContain("主标题：通勤一路温热");
        expect(final).toContain("视觉风格：暖白极简，字号大气");
        expect(final).toContain("负面提示词：错色、LOGO 错误、虚构参数");
        // 文案块与七项不能各说一遍——重复等于给模型两次机会改字。
        expect(final).not.toContain("【文案】");
    });

    test("copy 清空的详情行：七项齐全但明确不生成营销文字", () => {
        const visual = ["画面构成：3:4 竖版暖窗光台面", "产品摆放：杯子居中", "视觉风格：暖白极简", "负面提示词：错色"].join("；\n");
        const bare = { ...row(), prompt: visual };

        const final = resolveEcommerceInputs(target.id, graph, edges, [], [bare]).prompt;
        for (const label of ["画面构成：", "产品摆放：", "主标题：", "副标题：", "卖点模块：", "视觉风格：", "负面提示词："]) expect(final).toContain(label);
        expect(final).toContain("不生成主标题文字");
        expect(final).toContain("不生成副标题文字");
        expect(final).toContain("不生成卖点文字");
        expect(final).not.toContain("【文案】");
        expect(final).not.toContain("节点上的旧标题");
    });

    test("真实 snapshot 与 merge 出来的提示词同样是完整七项，且不含【文案】", () => {
        // 低层编译器对不算数：入队快照走的是 resolve → merge 这条真实入口。
        const visual = ["画面构成：3:4 竖版暖窗光台面", "产品摆放：杯子居中", "视觉风格：暖白极简", "负面提示词：错色"].join("；\n");
        const table = {
            ...createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 300 }, {
                ecommerceFlowId: "detail",
                ecommerceSuite: { flow: "detail", rows: [{ slotId: "detail-1", title: "痛点共情", duty: "说出问题", prompt: visual, imagePromptContractVersion: 1 as const, copy: { ...createEcommerceCopy(), headline: "通勤一路温热" } }] },
            }),
            id: "table-1",
        };
        const output = { ...target, metadata: { ...target.metadata, batchSourceNodeId: "table-1" } };
        const nodes = [product, table, output];
        const snapshot = createCanvasBatchInputSnapshot(output, nodes, edges, []);

        expect(snapshot.ecommerceIssue).toBeUndefined();
        // context.prompt 才是真正发给模型的输入；snapshot.prompt 只是节点原文。
        for (const label of ["画面构成：", "产品摆放：", "主标题：", "副标题：", "卖点模块：", "视觉风格：", "负面提示词："]) expect(snapshot.context.prompt).toContain(label);
        expect(snapshot.context.prompt).toContain("主标题：通勤一路温热");
        expect(snapshot.context.prompt).not.toContain("【文案】");
        expect(snapshot.context.prompt).not.toContain("【文案】");
        expect(snapshot.context.prompt).not.toContain("节点上的旧标题");
    });

    test.each(["CURRENT_VISUAL_ONLY", "画面构成：CURRENT_VISUAL_ONLY；产品摆放：杯子居中"])("快照只编译一次当前画面，并保留独立相机参数：%s", (visual) => {
        const table = createCanvasNode(CanvasNodeType.BatchTable, { x: 0, y: 300 }, {
            ecommerceFlowId: "detail",
            ecommerceSuite: { flow: "detail", rows: [{ ...row({ headline: "通勤一路温热" }), prompt: visual }] },
        });
        const output = {
            ...target,
            metadata: {
                ...target.metadata,
                prompt: visual,
                composerContent: visual,
                batchSourceNodeId: table.id,
                cameraControl: { enabled: true, camera: "arri_alexa_mini_lf", lens: "cooke_s7i", focalLength: 50, aperture: 2.8 },
            },
        };
        const snapshot = createCanvasBatchInputSnapshot(output, [product, table, output], edges, []);
        expect(snapshot.context.prompt.split("CURRENT_VISUAL_ONLY")).toHaveLength(2);
        expect(snapshot.context.prompt).toContain("ARRI Alexa Mini LF");
        expect(snapshot.context.prompt).toContain("主标题：通勤一路温热");
    });

    test("表被删掉的孤立详情产物：snapshot 带上拒绝原因，旧文案不进入队输入", () => {
        const output = { ...target, metadata: { ...target.metadata, batchSourceNodeId: "table-gone" } };
        const snapshot = createCanvasBatchInputSnapshot(output, [product, output], edges, []);
        expect(snapshot.ecommerceIssue).toBe(ECOMMERCE_MISSING_DETAIL_ROW_ERROR);
        expect(snapshot.context.prompt).not.toContain("节点上的旧标题");
    });

    test("版式每个字段变动都会改提示词——签名据此判断要重出", () => {
        const block = { id: "block-1", field: "headline" as const, anchor: "top-left" as const, size: 8, color: "#111111", plate: "#FFFFFFCC", align: "left" as const, inset: 5, bold: true };
        const promptOf = (patch: Partial<typeof block>) => resolveEcommerceInputs(target.id, graph, edges, [], [{ ...row({ headline: "通勤一路温热" }), layout: { name: "左文右图", blocks: [{ ...block, ...patch }] } }]).prompt;
        const base = promptOf({});
        const variants: Array<[string, Partial<typeof block>]> = [
            ["anchor", { anchor: "bottom-center" }],
            ["align", { align: "center" }],
            ["inset", { inset: 9 }],
            ["size", { size: 12 }],
            ["color", { color: "#C8341F" }],
            ["plate", { plate: "" }],
            ["bold", { bold: false }],
        ];
        for (const [field, patch] of variants) expect([field, promptOf(patch) !== base]).toEqual([field, true]);
        // 四漏项必须真的写进提示词，而不是只改签名。
        expect(promptOf({ color: "#C8341F" })).toContain("字色 #C8341F");
        expect(promptOf({ plate: "#C8341F" })).toContain("字下垫 #C8341F 底色");
        expect(promptOf({ inset: 9 })).toContain("距边约短边 9%");
        expect(promptOf({ bold: false })).toContain("常规字重");
    });
});
