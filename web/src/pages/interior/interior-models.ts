import { nanoid } from "nanoid";
import { modelDisplayName, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { resourceFileUrl } from "@/services/api/resources";
import type { InteriorModelRef, InteriorProjectDocument, InteriorRound, InteriorRoundItem } from "@/services/api/interior";

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
    if (!Array.isArray(rounds)) return emptyInteriorDocument();
    return {
        version: 1,
        rounds: rounds.filter((round): round is InteriorRound =>
            Boolean(round && typeof round === "object" && typeof (round as InteriorRound).id === "string" && (round as InteriorRound).source?.resourceId && Array.isArray((round as InteriorRound).items)),
        ),
    };
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
export function mergeInteriorDocuments(server: InteriorProjectDocument, local: InteriorProjectDocument, deletedRoundIds: ReadonlySet<string>): InteriorProjectDocument {
    const localById = new Map(local.rounds.map((round) => [round.id, round]));
    const merged = server.rounds.filter((round) => !deletedRoundIds.has(round.id)).map((round) => localById.get(round.id) || round);
    const known = new Set(merged.map((round) => round.id));
    for (const round of local.rounds) if (!known.has(round.id)) merged.push(round);
    merged.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return { version: 1, rounds: merged };
}

export function interiorDownloadName(round: InteriorRound, item: InteriorRoundItem, index: number) {
    const parts = [round.roomName, item.styleName || round.modeName].filter(Boolean).join("-") || "室内设计";
    return `${parts.replace(/[\\/:*?"<>|\s]+/g, "_")}_${index + 1}.png`;
}
