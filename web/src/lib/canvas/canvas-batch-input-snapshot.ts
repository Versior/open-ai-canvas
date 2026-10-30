import { buildNodeGenerationContext, type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { canvasGenerationInputPrompt } from "@/lib/canvas/canvas-generation-input-prompt";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasBatchInputSnapshot, CanvasConnection, CanvasNodeData, EcommerceTextMode } from "@/types/canvas";
import { ecommerceReferenceImageGuide, mergeEcommercePrompt, resolveEcommerceInputs } from "@/lib/ecommerce/ecommerce-canvas";
import type { EcommerceModel } from "@/lib/ecommerce/ecommerce-models";

/** Snapshot locators and compiled text, never the entire canvas or decoded image bytes. */
export function createCanvasBatchInputSnapshot(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], assets: Asset[], customModels: EcommerceModel[] = []): CanvasBatchInputSnapshot {
    const prompt = nodeGenerationPrompt(node).trim();
    const context = buildNodeGenerationContext(node.id, nodes, connections, canvasGenerationInputPrompt(node, "image", prompt), assets);
    const ecommerce = resolveEcommerceInputs(node.id, nodes, connections, customModels);
    // 详情新合同行的节点提示词就是画面段原文；七项已经把它展开过，尾部再拼一次会把
    // 编译器剔掉的旧第九段（含「主标题：…」这类营销行）重新塞回请求里。
    if (ecommerce.prompt) context.prompt = mergeEcommercePrompt(ecommerce.prompt, context.prompt, { visualPrompt: ecommerce.sources.visualPrompt });
    const evidenceImages = ecommerce.referenceImages.filter((image) => (image.storageKey || image.url || image.dataUrl) && !context.referenceImages.some((existing) => existing.id === image.id));
    context.referenceImages.push(...evidenceImages);
    context.imageCount += evidenceImages.length;
    if (ecommerce.referenceImages.length) context.prompt = mergeEcommercePrompt(context.prompt, ecommerceReferenceImageGuide(context.referenceImages));
    const referenceImages = context.referenceImages.map((image) => {
        if (!image.storageKey && /^(data:|blob:)/i.test(image.dataUrl || image.url || "")) {
            throw new Error(`参考图「${image.name}」尚未保存为资源，请完成保存后重新提交批量任务`);
        }
        const source = nodes.find((candidate) => candidate.id === image.id);
        const dimensions = { width: image.width || source?.metadata?.naturalWidth, height: image.height || source?.metadata?.naturalHeight };
        return image.storageKey ? { ...image, ...dimensions, dataUrl: "", url: undefined } : { ...image, ...dimensions };
    });
    // 文字模式随入队输入一起冻结；旧快照和无法判定的节点保持缺失，重试不回读 store 猜。
    const ecommerceTextMode: EcommerceTextMode | undefined =
        ecommerce.textMode ?? (ecommerce.sources.renderCopyText === undefined ? undefined : ecommerce.sources.renderCopyText ? "model" : "local");
    return { version: 1, prompt, ecommerceTextMode, ecommerceIssue: ecommerce.issue, context: structuredClone({ ...context, referenceImages }) };
}

/** Each attempt owns a fresh context, so hydration cannot mutate the persisted snapshot. */
export function resolveCanvasBatchInputContext(snapshot: CanvasBatchInputSnapshot | undefined, buildCurrentContext: () => NodeGenerationContext): NodeGenerationContext {
    return snapshot ? structuredClone(snapshot.context) : buildCurrentContext();
}

/** 冻结的电商文字模式；没有快照时才向入队输入要，缺失一律 unknown。 */
export function resolveFrozenEcommerceTextMode(snapshot: CanvasBatchInputSnapshot | undefined, buildCurrentMode: () => EcommerceTextMode | undefined): EcommerceTextMode | undefined {
    if (snapshot) return snapshot.ecommerceTextMode === "model" || snapshot.ecommerceTextMode === "local" ? snapshot.ecommerceTextMode : undefined;
    const current = buildCurrentMode();
    return current === "model" || current === "local" ? current : undefined;
}
