import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { normalizeInteriorScene, type InteriorScene3D, type ScenePromptInput } from "@/lib/interior/scene-3d";
import { modelCompatibilityError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { InteriorImageRef, InteriorSceneItem } from "@/services/api/interior";
import type { AiConfig } from "@/stores/use-config-store";

/** 搭 3D 模型的文本任务对模型的要求：一段文字，带户型图时还要能看一张图。 */
export function sceneModelRequirements(config: AiConfig, imageCount: number): ModelRequirements {
    return { capability: "text", input: { textCount: 1, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 }, options: modelRequestOptions(config, "text") };
}

export function sceneModelProblem(config: AiConfig, model: string, imageCount: number) {
    if (!model) return "请选择文本模型";
    return modelCompatibilityError(config, model, sceneModelRequirements(config, imageCount));
}

/** 提交一次搭模型的文本任务（不等结果）；任务带室内设计的来源标记，受「室内设计」开关控制，按所选模型计费。 */
export function submitSceneTask(config: AiConfig, model: string, prompt: string, stage: string, image?: InteriorImageRef) {
    const requirements = sceneModelRequirements(config, image ? 1 : 0);
    return submitBackendGenerationTask({
        mode: "text",
        prompt,
        config: { ...buildGenerationConfig(config, undefined, "text", requirements), model },
        referenceImages: image ? [{ id: image.resourceId, name: "户型图", type: "image/jpeg", dataUrl: "", storageKey: resourceStorageKey(image.resourceId), width: image.width, height: image.height }] : [],
        streamText: false,
        metadata: { source: "interior-design", interior: { kind: "scene", stage } },
    });
}

export function scenePromptInput(item: InteriorSceneItem): ScenePromptInput {
    return { scope: item.scope, description: item.description, roomName: item.roomName, styleName: item.styleName, stylePrompt: item.styleHint, hasReference: Boolean(item.reference) };
}

/** 拼好的场景存成 JSON 资源；项目文档里只记资源 ID，文档不会被大场景撑满。 */
export async function saveSceneFile(scene: InteriorScene3D) {
    const blob = new Blob([JSON.stringify(scene)], { type: "application/json" });
    const resource = await uploadResourceFile(blob, "file", { fileName: "interior-scene.json" });
    return { resourceId: resource.id };
}

const sceneCache = new Map<string, Promise<InteriorScene3D>>();

/** 读一个场景文件，再按同样的规则收紧一遍；同一个文件在这次打开页面期间只下载一次。 */
export function loadSceneFile(resourceId: string) {
    let pending = sceneCache.get(resourceId);
    if (!pending) {
        pending = fetch(resourceFileUrl(resourceId), { credentials: "include" })
            .then(async (response) => {
                if (!response.ok) throw new Error(response.status === 404 ? "这个 3D 模型的文件已经不在了" : `读取 3D 模型失败（${response.status}）`);
                return normalizeInteriorScene(await response.json()).scene;
            })
            .catch((error: unknown) => {
                sceneCache.delete(resourceId);
                throw error;
            });
        sceneCache.set(resourceId, pending);
    }
    return pending;
}
