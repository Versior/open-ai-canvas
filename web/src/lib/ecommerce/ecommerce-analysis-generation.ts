import { buildGenerationConfig, resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { modelCompatibilityError, type ModelInputSummary } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType } from "@/types/canvas";

// Both commerce entry points must validate the displayed selection before any
// task is submitted. Image-node metadata must not choose the analysis model.
export function buildEcommerceAnalysisGeneration(config: AiConfig, selected: string | undefined, input: ModelInputSummary) {
    const requested = selected?.trim() || config.textModel;
    const model = resolveCanvasGenerationModel(config, requested, "text");
    if (!model) throw new Error("分析模型未选择或已不可用，请重新选择文本模型；尚未提交分析任务");
    const requirements = { capability: "text" as const, input };
    const generation = buildGenerationConfig(config, { id: "ecommerce-analysis", type: CanvasNodeType.Text, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model } }, "text", requirements);
    const error = modelCompatibilityError(generation, generation.model, requirements);
    if (error) throw new Error(`当前分析模型不支持这些参考素材：${error}；尚未提交分析任务`);
    return generation;
}
