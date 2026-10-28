import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNodeActionContext, type CanvasNodeActionContextValue } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { ReplicaNodeContent } from "../src/components/canvas/nodes/replica-node";
import { createCanvasNodeGraph } from "../src/lib/canvas/canvas-node-graph";
import { canvasThemes } from "../src/lib/canvas-theme";
import { isEcommerceInputHandle, withEcommerceInputConnection } from "../src/lib/ecommerce/ecommerce-canvas";
import { ECOMMERCE_REPLICA_PRODUCT_HANDLE, ECOMMERCE_REPLICA_REFERENCE_HANDLE, createEcommerceReplica, ecommerceReplicaImageRoleBlock, ecommerceReplicaInputIssue, ecommerceReplicaInputNodes, migrateLegacyEcommerceReplicaConnections } from "../src/lib/ecommerce/ecommerce-replica";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const replica: CanvasNodeData = { id: "replica", type: CanvasNodeType.Replica, title: "Replica", position: { x: 0, y: 0 }, width: 460, height: 560 };
const reference: CanvasNodeData = { id: "reference", type: CanvasNodeType.Image, title: "Reference", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { content: "/reference.png" } };
const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Image, title: "Product", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { content: "/product.png" } };

function render(connections: CanvasConnection[], nodes: CanvasNodeData[] = [product, reference, replica], actions: CanvasNodeActionContextValue = {}) {
    const graph = createCanvasNodeGraph(nodes, connections);
    return renderToStaticMarkup(
        <CanvasNodeActionContext.Provider value={actions}>
            <CanvasNodeGraphContext.Provider value={graph}>
                <ReplicaNodeContent node={replica} theme={canvasThemes.dark} />
            </CanvasNodeGraphContext.Provider>
        </CanvasNodeActionContext.Provider>,
    );
}

test("legacy replica connections migrate only when their roles are deterministic", () => {
    const one: CanvasConnection[] = [{ id: "reference-edge", fromNodeId: reference.id, toNodeId: replica.id }];
    expect(migrateLegacyEcommerceReplicaConnections([replica, reference], one)).toEqual([{ ...one[0], toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE }]);

    const two: CanvasConnection[] = [
        { id: "product-was-first", fromNodeId: product.id, toNodeId: replica.id },
        { id: "reference-was-second", fromNodeId: reference.id, toNodeId: replica.id },
    ];
    expect(migrateLegacyEcommerceReplicaConnections([replica, reference, product], two)).toEqual([
        { ...two[0], toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
        { ...two[1], toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
    ]);

    const referenceAssigned: CanvasConnection[] = [
        { id: "reference", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
        { id: "legacy-product", fromNodeId: product.id, toNodeId: replica.id },
    ];
    expect(migrateLegacyEcommerceReplicaConnections([replica, reference, product], referenceAssigned)).toEqual([referenceAssigned[0], { ...referenceAssigned[1], toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE }]);

    const productAssigned: CanvasConnection[] = [
        { id: "product", fromNodeId: product.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
        { id: "legacy-reference", fromNodeId: reference.id, toNodeId: replica.id },
    ];
    expect(migrateLegacyEcommerceReplicaConnections([replica, reference, product], productAssigned)).toEqual([productAssigned[0], { ...productAssigned[1], toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE }]);
});

test("legacy replica migration leaves ambiguous and conflicting connections untouched", () => {
    const extra: CanvasNodeData = { ...reference, id: "extra", title: "Extra" };
    const ambiguous: CanvasConnection[] = [
        { id: "one", fromNodeId: reference.id, toNodeId: replica.id },
        { id: "two", fromNodeId: product.id, toNodeId: replica.id },
        { id: "three", fromNodeId: extra.id, toNodeId: replica.id },
    ];
    expect(migrateLegacyEcommerceReplicaConnections([replica, reference, product, extra], ambiguous)).toBe(ambiguous);

    const conflicting: CanvasConnection[] = [
        { id: "reference-a", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
        { id: "reference-b", fromNodeId: extra.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
        { id: "legacy", fromNodeId: product.id, toNodeId: replica.id },
    ];
    expect(migrateLegacyEcommerceReplicaConnections([replica, reference, product, extra], conflicting)).toBe(conflicting);
});

test("replica handles replace only the occupied role through shared ecommerce connection logic", () => {
    expect(isEcommerceInputHandle(ECOMMERCE_REPLICA_REFERENCE_HANDLE)).toBe(true);
    expect(isEcommerceInputHandle(ECOMMERCE_REPLICA_PRODUCT_HANDLE)).toBe(true);
    expect(isEcommerceInputHandle(ECOMMERCE_REPLICA_REFERENCE_HANDLE, CanvasNodeType.Replica)).toBe(true);
    expect(isEcommerceInputHandle(ECOMMERCE_REPLICA_REFERENCE_HANDLE, CanvasNodeType.Product)).toBe(false);
    expect(isEcommerceInputHandle("product-view:front", CanvasNodeType.Product)).toBe(true);
    expect(isEcommerceInputHandle("product-view:front", CanvasNodeType.Replica)).toBe(false);

    const connections: CanvasConnection[] = [
        { id: "old-reference", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
        { id: "product-edge", fromNodeId: product.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
    ];
    const next = withEcommerceInputConnection(connections, {
        id: "new-reference",
        fromNodeId: product.id,
        toNodeId: replica.id,
        toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE,
    });

    expect(next.map((connection) => connection.id)).toEqual(["product-edge", "new-reference"]);
});

test("replica node resolves reference and product by handle when product was connected first", () => {
    const connections: CanvasConnection[] = [
        { id: "product-edge", fromNodeId: product.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
        { id: "reference-edge", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
    ];

    const html = render(connections);

    expect(html).toMatch(/data-ecommerce-input="replica-reference"[^>]*>[\s\S]*?src="\/reference\.png"/);
    expect(html).toMatch(/data-ecommerce-input="replica-product"[^>]*>[\s\S]*?src="\/product\.png"/);
    expect(html).not.toContain("缺参考图");
    expect(html).not.toContain("缺商品图");

    const inputs = ecommerceReplicaInputNodes(replica.id, [reference, product], connections);
    const roleBlock = ecommerceReplicaImageRoleBlock(createEcommerceReplica(), inputs);
    expect(roleBlock).toContain("第 1 张：商品图（主体）");
    expect(roleBlock).toContain("第 2 张：参考图（结构）");
});

test("replica node refuses to guess roles for legacy unlabelled connections", () => {
    const html = render([
        { id: "reference-edge", fromNodeId: reference.id, toNodeId: replica.id },
        { id: "product-edge", fromNodeId: product.id, toNodeId: replica.id },
    ]);

    expect(html).toContain("旧画布连线未标注用途");
    expect(html).not.toMatch(/data-ecommerce-input="replica-reference"[^>]*>[\s\S]*?src=/);
    expect(html).not.toMatch(/data-ecommerce-input="replica-product"[^>]*>[\s\S]*?src=/);
    expect(html).toContain("disabled");
});

test("ambiguous legacy inputs can be disconnected in simple mode without deleting image nodes", () => {
    const html = render(
        [
            { id: "reference-edge", fromNodeId: reference.id, toNodeId: replica.id },
            { id: "product-edge", fromNodeId: product.id, toNodeId: replica.id },
            { id: "extra-edge", fromNodeId: "extra", toNodeId: replica.id },
        ],
        [product, reference, { ...reference, id: "extra" }, replica],
        { updateMetadata() {}, disconnectEcommerceInput() {} },
    );

    expect(html).toContain("断开全部未分配连线");
    expect(html).toContain("只断开连线，图片节点会保留");
});

test("replica node shows storage-only inputs as connected instead of empty slots", () => {
    const storedReference = { ...reference, title: "已上传参考素材", metadata: { storageKey: "resource:reference" } };
    const storedProduct = { ...product, title: "", metadata: { storageKey: "resource:product" } };
    const html = render(
        [
            { id: "reference-edge", fromNodeId: storedReference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
            { id: "product-edge", fromNodeId: storedProduct.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
        ],
        [storedProduct, storedReference, replica],
    );

    expect(html).toContain("已上传参考素材");
    expect(html).toContain("已连接");
    expect(html.match(/data-filled="true"/g)).toHaveLength(2);
});

test("replica input validation rejects multiple images in either role", () => {
    const extra: CanvasNodeData = { ...reference, id: "extra", title: "Extra" };
    const multipleReferences = ecommerceReplicaInputNodes(
        replica.id,
        [reference, extra, product],
        [
            { id: "reference-a", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
            { id: "reference-b", fromNodeId: extra.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
            { id: "product", fromNodeId: product.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
        ],
    );
    const multipleProducts = ecommerceReplicaInputNodes(
        replica.id,
        [reference, extra, product],
        [
            { id: "reference", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
            { id: "product-a", fromNodeId: product.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
            { id: "product-b", fromNodeId: extra.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
        ],
    );

    expect(ecommerceReplicaInputIssue(multipleReferences)).toContain("参考图槽位连接了多张图片");
    expect(ecommerceReplicaInputIssue(multipleProducts)).toContain("商品图槽位连接了多张图片");
});

test("replica input validation rejects one image assigned to both roles", () => {
    const inputs = ecommerceReplicaInputNodes(
        replica.id,
        [reference],
        [
            { id: "reference-edge", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE },
            { id: "product-edge", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE },
        ],
    );

    expect(ecommerceReplicaInputIssue(inputs)).toContain("不能使用同一张图片");
    expect(ecommerceReplicaImageRoleBlock(createEcommerceReplica(), inputs)).toBe("");
});

test("replica node stays disabled when either role is missing", () => {
    const referenceOnly = render([{ id: "reference-edge", fromNodeId: reference.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_REFERENCE_HANDLE }]);
    const productOnly = render([{ id: "product-edge", fromNodeId: product.id, toNodeId: replica.id, toHandleId: ECOMMERCE_REPLICA_PRODUCT_HANDLE }]);

    expect(referenceOnly).toContain("缺商品图");
    expect(referenceOnly).toContain("disabled");
    expect(productOnly).toContain("缺参考图");
    expect(productOnly).toContain("disabled");
});
