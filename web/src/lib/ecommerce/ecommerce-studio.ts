import { connectedStyleReferenceNodes, isEcommerceStyleReference, productViewNodes } from "./ecommerce-canvas";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { DEFAULT_ECOMMERCE_BRIEF } from "./ecommerce-capabilities";
import { nanoid } from "nanoid";
import { canonicalize } from "json-canonicalize";
import type { EcommerceWorkbenchPlan, EcommerceWorkbenchBrief } from "./ecommerce-capabilities";
import type { EcommerceSuiteRow } from "./ecommerce-suite";

/** Output adoption is delivery state and cannot invalidate an already paid generation. */
export function ecommerceStudioExecutionSignature(studio: NonNullable<CanvasNodeData["metadata"]>["ecommerceStudio"]) {
    if (!studio) return canonicalize(studio);
    const { adoptedResults: _adopted, deliveryReview: _delivery, ...inputs } = studio;
    return canonicalize(inputs);
}

export function ecommerceStudioPlanReviewSignature(studio: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const saved = studio.metadata?.ecommerceStudio;
    if (!saved?.plan?.shots.length) throw new Error("请先添加画面方案");
    const ids = [...new Set(connections.filter((edge) => edge.toNodeId === studio.id && edge.relation !== "batch-output").map((edge) => edge.fromNodeId))].sort();
    return canonicalize([saved.brief, saved.plan, saved.imageModel, saved.textModel, saved.skillIds, ids, ecommerceStudioInputSignature(ids, nodes, connections)]);
}

export function ecommerceStudioDeliveryReviewSignature(studio: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const outputs = nodes.filter((node) => connections.some((edge) => edge.fromNodeId === studio.id && edge.toNodeId === node.id));
    const selection = ecommerceStudioExportSelection(studio, outputs);
    for (const output of selection.selected.values()) validateEcommerceStudioResultInputs(output, nodes, connections);
    return canonicalize([ecommerceStudioPlanReviewSignature(studio, nodes, connections), [...selection.selected.values()].map((node) => [node.id, node.metadata?.storageKey, node.metadata?.taskId, node.metadata?.status])]);
}

export function assertEcommerceStudioReview(studio: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], delivery = false) {
    if (!studio.metadata?.ecommerceStudio?.brief.reviewRequired) return;
    const signature = delivery ? ecommerceStudioDeliveryReviewSignature(studio, nodes, connections) : ecommerceStudioPlanReviewSignature(studio, nodes, connections);
    const review = delivery ? studio.metadata.ecommerceStudio.deliveryReview : studio.metadata.ecommerceStudio.planReview;
    if (review?.signature !== signature) throw new Error(delivery ? "采用结果尚未审核，或结果与输入已变化，请重新审核后导出" : "当前方案尚未审核，或方案与输入已变化，请审核后生成");
}

export function ecommerceStudioShotSignature(plan: EcommerceWorkbenchPlan, index: number, brief?: EcommerceWorkbenchBrief) {
    const shot = plan.shots[index];
    return canonicalize([plan.style, shot?.title, shot?.duty, shot?.prompt, brief]);
}

/** A changed shot cannot silently adopt an output from a previous plan. */
export function ecommerceStudioShotResults(studio: CanvasNodeData, outputs: CanvasNodeData[], index: number) {
    const plan = studio.metadata?.ecommerceStudio?.plan;
    if (!plan) return [];
    const signature = ecommerceStudioShotSignature(plan, index, studio.metadata?.ecommerceStudio?.brief);
    return outputs.filter(
        (node) =>
            node.type === CanvasNodeType.Image &&
            node.metadata?.ecommerceStudioOutput?.studioId === studio.id &&
            node.metadata.ecommerceStudioOutput.shotIndex === index &&
            node.metadata.ecommerceStudioOutput.signature === signature &&
            node.metadata.status === "success" &&
            node.metadata.storageKey,
    );
}

export function ecommerceStudioExportSelection(studio: CanvasNodeData, outputs: CanvasNodeData[]) {
    const saved = studio.metadata?.ecommerceStudio;
    if (!saved?.plan?.shots.length) throw new Error("请先添加画面方案");
    const rows: EcommerceSuiteRow[] = [];
    const selected = new Map<string, CanvasNodeData>();
    for (const [index, shot] of saved.plan.shots.entries()) {
        const candidates = ecommerceStudioShotResults(studio, outputs, index);
        const adopted = saved.adoptedResults?.[String(index)];
        const result = adopted ? candidates.find((node) => node.id === adopted) : candidates.at(-1);
        if (!result) throw new Error(`第 ${index + 1} 张尚无有效结果，或已选结果不匹配当前方案`);
        const slotId = "studio-shot-" + index;
        rows.push({ slotId, title: shot.title, duty: shot.duty, prompt: shot.prompt || "", resultNodeId: result.id });
        selected.set(slotId, result);
    }
    return { rows, selected };
}

export function ecommerceStudioResultOptions(studio: CanvasNodeData, outputs: CanvasNodeData[], index: number) {
    const candidates = ecommerceStudioShotResults(studio, outputs, index);
    const adopted = studio.metadata?.ecommerceStudio?.adoptedResults?.[String(index)];
    return [
        { value: "", label: "自动采用当前方案的最新成功图" },
        ...(adopted && !candidates.some((node) => node.id === adopted) ? [{ value: adopted, label: "所选结果已失效，请重新选择", disabled: true }] : []),
        ...candidates.map((result, version) => ({ value: result.id, label: `版本 ${version + 1} · ${result.title || "图片"}` })),
    ];
}

export function openEcommerceStudio(nodes: CanvasNodeData[], connections: CanvasConnection[], productId: string) {
    const product = nodes.find((node) => node.id === productId && node.type === CanvasNodeType.Product);
    if (!product || product.metadata?.locked) throw new Error("商品已删除或锁定");
    const existing = nodes.find((node) => node.type === CanvasNodeType.EcommerceStudio && connections.some((edge) => edge.fromNodeId === productId && edge.toNodeId === node.id && edge.relation !== "batch-output"));
    if (existing) return { nodes, connections, studio: existing };
    const studio = createCanvasNode(CanvasNodeType.EcommerceStudio, { x: 0, y: 0 }, { ecommerceStudio: { brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: product.metadata?.productProfile?.name || product.title || "商品" } } });
    studio.position = findAvailableGenerationGroupPosition(nodes, { x: product.position.x + product.width + 160, y: product.position.y }, studio);
    return { nodes: [...nodes, studio], connections: [...connections, { id: nanoid(), fromNodeId: product.id, toNodeId: studio.id }], studio };
}

/** Expand product inputs using the same view bindings as the product card. */
export function ecommerceStudioSources(sourceIds: string[], nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const selected = sourceIds.map((id) => {
        const node = nodes.find((item) => item.id === id);
        if (!node) throw new Error("选中的素材已删除");
        return node;
    });
    const expanded = selected.flatMap((node) => (node.type === CanvasNodeType.Product ? [node, ...productViewNodes(node.metadata?.productProfile, nodes, connections, node.id), ...connectedStyleReferenceNodes(node.id, nodes, connections)] : [node]));
    return [...new Map(expanded.map((node) => [node.id, node])).values()];
}

export function ecommerceStudioSourceSignature(node: CanvasNodeData) {
    return canonicalize({ id: node.id, type: node.type, locked: node.metadata?.locked, storageKey: node.metadata?.storageKey, content: node.metadata?.content, status: node.metadata?.status, product: node.metadata?.productProfile });
}

export function ecommerceStudioInputSignature(sourceIds: string[], nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const sources = ecommerceStudioSources(sourceIds, nodes, connections);
    return JSON.stringify(sources.map((node) => [ecommerceStudioSourceSignature(node), node.type === CanvasNodeType.Image ? ecommerceStudioImageRole(node, sources, connections) : ""]));
}

export function validateEcommerceStudioResultInputs(output: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const origin = output.metadata?.ecommerceStudioOutput;
    if (!origin?.sourceIds || !origin.sourceSignature || origin.sourceSignature !== ecommerceStudioInputSignature(origin.sourceIds, nodes, connections)) throw new Error("商品或参考素材已变化，请重新生成后导出");
    const inputIds = [...new Set(connections.filter((edge) => edge.toNodeId === origin.studioId && edge.relation !== "batch-output").map((edge) => edge.fromNodeId))].sort();
    if (!origin.inputIds || JSON.stringify(inputIds) !== JSON.stringify(origin.inputIds)) throw new Error("生图台输入连线已变化，请重新生成后导出");
}

export function ecommerceStudioImageRole(image: CanvasNodeData, sources: CanvasNodeData[], connections: CanvasConnection[]) {
    const products = sources.filter((node) => node.type === CanvasNodeType.Product);
    if (products.some((product) => productViewNodes(product.metadata?.productProfile, sources, connections, product.id).some((node) => node.id === image.id))) return "商品实拍";
    if (isEcommerceStyleReference(image) || products.some((product) => connectedStyleReferenceNodes(product.id, sources, connections).some((node) => node.id === image.id))) return "视觉参考（仅风格，不作为商品事实）";
    return "商品实拍";
}
