import { nanoid } from "nanoid";
import { modelDisplayName, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { resourceFileUrl } from "@/services/api/resources";
import type { InteriorMode, InteriorModelRef, InteriorProjectDocument, InteriorRound, InteriorRoundItem, InteriorSceneItem } from "@/services/api/interior";

/**
 * 模型选项值转成服务端认可的模型引用。室内设计只接受系统渠道或前台逻辑模型，
 * 用户自定义渠道返回 null，选择器里直接隐藏。
 */
export function interiorModelRef(config: AiConfig, value: string): InteriorModelRef | null {
    if (!value) return null;
    const model = modelOptionName(value);
    const channel = resolveModelChannel(config, value);
    const logicalModelId = channel.modelCosts?.find((item) => item.model === model)?.logicalModelId || "";
    const label = modelDisplayName(config, value);
    if (logicalModelId) return { model, logicalModelId, label };
    if (channel.scope === "system" && channel.id) return { model, channelId: channel.id, label };
    return null;
}

export function sameInteriorModel(left?: InteriorModelRef | null, right?: InteriorModelRef | null) {
    if (!left || !right) return false;
    return left.model === right.model && (left.channelId || "") === (right.channelId || "") && (left.logicalModelId || "") === (right.logicalModelId || "");
}

/** 和服务端 interiorModelChoice 同一规则：可选范围为空时不限制；默认模型总是允许。 */
export function interiorModelPermitted(mode: Pick<InteriorMode, "allowedModels" | "defaultModel">, siteDefault: InteriorModelRef | undefined, ref: InteriorModelRef | null) {
    if (!ref) return false;
    if (!mode.allowedModels.length) return true;
    return mode.allowedModels.some((item) => sameInteriorModel(item, ref)) || sameInteriorModel(mode.defaultModel || siteDefault, ref);
}

/** 模型引用转回选择器的选项值；当前账号不可用时返回空串。 */
export function interiorModelValue(config: AiConfig, ref?: InteriorModelRef | null) {
    if (!ref) return "";
    return interiorImageModelOptions(config).find((item) => sameInteriorModel(item.ref, ref))?.value || "";
}

/**
 * 切换出图方式时预选模型，和服务端顺序一致。
 * 专业模式：当前模型（在可选范围内时）> 推荐的默认模型 > 可选范围里第一个可用的。
 * 快速出图：推荐的默认模型 > 当前模型（在可选范围内时）> 可选范围里第一个可用的。
 */
export function interiorInitialModel(config: AiConfig, mode: InteriorMode, siteDefault: InteriorModelRef | undefined, current: string, surface: "quick" | "pro") {
    const currentPermitted = Boolean(current) && interiorModelPermitted(mode, siteDefault, interiorModelRef(config, current));
    // 专业模式尊重用户已经选的模型；快速出图没有选择器，跟着推荐走。
    if (surface === "pro" && currentPermitted) return current;
    const recommended = interiorModelValue(config, mode.defaultModel || siteDefault);
    if (recommended) return recommended;
    if (currentPermitted) return current;
    return interiorImageModelOptions(config).find((item) => interiorModelPermitted(mode, siteDefault, item.ref))?.value || current;
}

/** 当前账号能用来出图的系统图片模型（选项值沿用全局模型选择的编码）。 */
export function interiorImageModelOptions(config: AiConfig) {
    return selectableModelsByCapability(config, "image")
        .map((value) => ({ value, ref: interiorModelRef(config, value) }))
        .filter((item): item is { value: string; ref: InteriorModelRef } => item.ref !== null);
}

export function interiorImageUrl(resourceId: string, thumbnail = false) {
    return `${resourceFileUrl(resourceId)}${thumbnail ? "?variant=thumbnail" : ""}`;
}

export function emptyInteriorDocument(): InteriorProjectDocument {
    return { version: 1, rounds: [] };
}

/** 服务端文档结构由前端维护；读到旧数据或手改过的数据时只保留能识别的轮次。 */
export function normalizeInteriorDocument(value: unknown): InteriorProjectDocument {
    if (!value || typeof value !== "object") return emptyInteriorDocument();
    const rounds = (value as { rounds?: unknown }).rounds;
    const scenes = (value as { scenes?: unknown }).scenes;
    const document: InteriorProjectDocument = {
        version: 1,
        rounds: Array.isArray(rounds)
            ? rounds.filter((round): round is InteriorRound => Boolean(round && typeof round === "object" && typeof (round as InteriorRound).id === "string" && (round as InteriorRound).source?.resourceId && Array.isArray((round as InteriorRound).items)))
            : [],
    };
    // 3D 模型：只认有 id 的；生成好的必须带场景文件，没有时按失败显示，不丢记录。
    const sceneItems = Array.isArray(scenes) ? scenes.filter((item): item is InteriorSceneItem => Boolean(item && typeof item === "object" && typeof (item as InteriorSceneItem).id === "string")) : [];
    if (sceneItems.length) document.scenes = sceneItems.map((item) => (item.status === "succeeded" && !item.sceneFile?.resourceId ? { ...item, status: "failed", error: "这个 3D 模型的数据读不出来" } : item));
    return document;
}

export function newInteriorId() {
    return nanoid(16);
}

export function patchInteriorRound(document: InteriorProjectDocument, roundId: string, patch: (round: InteriorRound) => InteriorRound): InteriorProjectDocument {
    return { ...document, rounds: document.rounds.map((round) => (round.id === roundId ? patch(round) : round)) };
}

export function patchInteriorItem(document: InteriorProjectDocument, roundId: string, itemId: string, patch: Partial<InteriorRoundItem>): InteriorProjectDocument {
    return patchInteriorRound(document, roundId, (round) => ({ ...round, items: round.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) }));
}

/**
 * 保存冲突时合并两边：以服务端为底，本地有而服务端没有的轮次补上，同一轮次以本地为准。
 * 只有本页会写室内项目，冲突多半来自另一个窗口新增或删除了轮次。
 */
export function mergeInteriorDocuments(server: InteriorProjectDocument, local: InteriorProjectDocument, deletedIds: ReadonlySet<string>): InteriorProjectDocument {
    const rounds = mergeById(server.rounds, local.rounds, deletedIds);
    const scenes = mergeById(server.scenes || [], local.scenes || [], deletedIds);
    return scenes.length ? { version: 1, rounds, scenes } : { version: 1, rounds };
}

/** 以服务端为底按 id 合并：本地删掉的去掉，同一条以本地为准，本地新增的补上，按时间倒序。 */
function mergeById<T extends { id: string; createdAt: string }>(server: T[], local: T[], deletedIds: ReadonlySet<string>) {
    const localById = new Map(local.map((item) => [item.id, item]));
    const merged = server.filter((item) => !deletedIds.has(item.id)).map((item) => localById.get(item.id) || item);
    const known = new Set(merged.map((item) => item.id));
    for (const item of local) if (!known.has(item.id)) merged.push(item);
    merged.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return merged;
}

export function patchInteriorScene(document: InteriorProjectDocument, sceneId: string, patch: Partial<InteriorSceneItem>): InteriorProjectDocument {
    return { ...document, scenes: (document.scenes || []).map((item) => (item.id === sceneId ? { ...item, ...patch } : item)) };
}

export function interiorDownloadName(round: InteriorRound, item: InteriorRoundItem, index: number) {
    const parts = [round.roomName, item.styleName || round.modeName].filter(Boolean).join("-") || "室内设计";
    return `${parts.replace(/[\\/:*?"<>|\s]+/g, "_")}_${index + 1}.png`;
}
