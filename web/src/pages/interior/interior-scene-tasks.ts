import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { normalizeInteriorScene, type InteriorSceneScope, type SceneKnowledge } from "@/lib/interior/scene-3d";
import { normalizeSceneV2, type InteriorSceneData, type SpecPromptInput } from "@/lib/interior/scene-spec";
import { modelCompatibilityError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { getInteriorKnowledge, type InteriorCatalog, type InteriorImageRef, type InteriorKnowledgeEntry, type InteriorSceneItem } from "@/services/api/interior";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";

/** 搭 3D 模型的文本任务对模型的要求：一段文字，带图时还要能看一张图。 */
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
        referenceImages: image ? [{ id: image.resourceId, name: "参考图", type: "image/jpeg", dataUrl: "", storageKey: resourceStorageKey(image.resourceId), width: image.width, height: image.height }] : [],
        // 流式返回：页面边收边读方案、边搭模型，用户不用干等。
        streamText: true,
        metadata: { source: "interior-design", interior: { kind: "scene", stage } },
    });
}

/** 按范围、空间、风格和需求查知识库；查不到时报错往上抛，不当成「没有相关知识」。 */
export async function fetchSceneKnowledge(query: { scope?: InteriorSceneScope; roomKey?: string; styleKey?: string; text: string }) {
    const entries = await getInteriorKnowledge({ scope: query.scope, rooms: query.roomKey ? [query.roomKey] : [], styles: query.styleKey ? [query.styleKey] : [], q: query.text.slice(0, 1000) });
    return { knowledge: entries.map(promptKnowledge), refs: entries.map((entry) => ({ id: entry.id, kindName: entry.kindName, title: entry.title })) };
}

function promptKnowledge(entry: InteriorKnowledgeEntry): SceneKnowledge {
    return { kindName: entry.kindName, title: entry.title, guidance: entry.guidance };
}

/** 一个模型后面几步查知识用的条件：方案分析之后以分析结果为准。 */
export function sceneKnowledgeQuery(item: InteriorSceneItem) {
    return { scope: item.scope, roomKey: item.roomKey, styleKey: item.styleKey, text: [item.brief?.spaces.map((space) => space.name).join("、"), item.description, item.brief?.description].filter(Boolean).join("\n") };
}

export function scenePromptInput(item: InteriorSceneItem, knowledge?: SceneKnowledge[]): SpecPromptInput {
    return { scope: item.scope, description: item.description, roomName: item.roomName, styleName: item.styleName, stylePrompt: item.styleHint, hasReference: Boolean(item.reference), brief: item.brief, knowledge };
}

export function catalogKeys(catalog: InteriorCatalog) {
    return { rooms: catalog.rooms.map((item) => ({ key: item.key, name: item.name })), styles: catalog.styles.map((item) => ({ key: item.key, name: item.name })) };
}

/** 拼好的场景存成 JSON 资源；项目文档里只记资源 ID，文档不会被大场景撑满。 */
export async function saveSceneFile(scene: InteriorSceneData) {
    const blob = new Blob([JSON.stringify(scene)], { type: "application/json" });
    const resource = await uploadResourceFile(blob, "file", { fileName: "interior-scene.json" });
    return { resourceId: resource.id };
}

const sceneCache = new Map<string, Promise<InteriorSceneData>>();

/** 读一个场景文件（第一版几何体或第二版方案），再按同样的规则收紧一遍；同一个文件在这次打开页面期间只下载一次。 */
export function loadSceneFile(resourceId: string) {
    let pending = sceneCache.get(resourceId);
    if (!pending) {
        pending = fetch(resourceFileUrl(resourceId), { credentials: "include" })
            .then(async (response) => {
                if (!response.ok) throw new Error(response.status === 404 ? "这个 3D 模型的文件已经不在了" : `读取 3D 模型失败（${response.status}）`);
                const value: unknown = await response.json();
                if (value && typeof value === "object" && (value as { version?: unknown }).version === 2) return normalizeSceneV2(value as Record<string, unknown>);
                return normalizeInteriorScene(value).scene;
            })
            .catch((error: unknown) => {
                sceneCache.delete(resourceId);
                throw error;
            });
        sceneCache.set(resourceId, pending);
    }
    return pending;
}
