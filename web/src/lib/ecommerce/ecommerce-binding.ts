import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { batchOutputResultPending } from "@/lib/canvas/canvas-batch-references";
type Plan = NonNullable<NonNullable<CanvasNodeData["metadata"]>["ecommerceOneClick"]>;
export function ecommerceBindingKey(productId: string, plan: Plan) {
    return `${productId}:${plan.runId || `${plan.flow}:${plan.nodeIds.join(",")}`}`;
}
export function ecommerceBindingImages(plan: Plan, nodes: CanvasNodeData[]): CanvasNodeData[] | undefined {
    if (!plan.nodeIds.length) return;
    const outputs = plan.nodeIds.map((id) => nodes.find((node) => node.id === id));
    if (
        outputs.some(
            (node) =>
                !node ||
                node.type !== CanvasNodeType.Image ||
                node.metadata?.status !== "success" ||
                (!node.metadata.content && !node.metadata.storageKey) ||
                (plan.runId && node.metadata.ecommerceRunId !== plan.runId) ||
                (node.metadata.taskStatus && node.metadata.taskStatus !== "succeeded") ||
                batchOutputResultPending(node.metadata),
        )
    )
        return;
    return outputs as CanvasNodeData[];
}
export function finishEcommerceBinding(nodes: CanvasNodeData[], productId: string, key: string, error?: string) {
    return nodes.map((node) => {
        const plan = node.metadata?.ecommerceOneClick;
        if (node.id !== productId || !plan || ecommerceBindingKey(productId, plan) !== key) return node;
        return { ...node, metadata: { ...node.metadata, ecommerceOneClick: error ? { ...plan, status: "failed" as const, error } : undefined } };
    });
}
