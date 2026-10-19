import type { CanvasNodeData } from "@/types/canvas";
type Plan = NonNullable<NonNullable<CanvasNodeData["metadata"]>["ecommerceOneClick"]>;
export function ecommerceBindingKey(productId: string, plan: Plan) {
    return `${productId}:${plan.runId || `${plan.flow}:${plan.nodeIds.join(",")}`}`;
}
export function finishEcommerceBinding(nodes: CanvasNodeData[], productId: string, key: string, error?: string) {
    return nodes.map((node) => {
        const plan = node.metadata?.ecommerceOneClick;
        if (node.id !== productId || !plan || ecommerceBindingKey(productId, plan) !== key) return node;
        return { ...node, metadata: { ...node.metadata, ecommerceOneClick: error ? { ...plan, status: "failed" as const, error } : undefined } };
    });
}
