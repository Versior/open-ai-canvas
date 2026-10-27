import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import type { AiConfig } from "@/stores/use-config-store";

export function resolveEcommerceTableModels(config: AiConfig, overrides: { analysisModel?: string; imageModel?: string } = {}) {
    const analysisModel = overrides.analysisModel?.trim();
    const imageModel = overrides.imageModel?.trim();
    return {
        analysisModel: resolveCanvasGenerationModel(config, analysisModel || config.textModel, "text"),
        imageModel: resolveCanvasGenerationModel(config, imageModel || config.imageModel, "image"),
    };
}
