import type { InteriorSceneScope, SceneBrief } from "@/lib/interior/scene-3d";
import type { RenovationSpec } from "@/lib/interior/renovation";
import type { SceneEditTarget } from "@/lib/interior/scene-local-edit";
import { compactApiParams, http } from "@/services/api/request";

export type InteriorSurface = "quick" | "pro";
export type InteriorAudience = "quick" | "pro" | "both";
export type InteriorPresetType = "style" | "room";
export type InteriorProjectKind = "home" | "client";

/** 系统模型目录里的一个模型：系统渠道 + 模型名，或前台逻辑模型。 */
export type InteriorModelRef = { channelId?: string; logicalModelId?: string; model: string; label?: string };

export type InteriorInputSlot = { key: "source" | "reference"; name: string; required: boolean; maxCount: number };
/** 前台目录里没有 prompt；后台列表才返回每个选项的提示词片段。 */
export type InteriorParamOption = { value: string; label: string; prompt?: string };
export type InteriorParamDef = { key: string; label: string; default: string; proOnly: boolean; options: InteriorParamOption[] };

export type InteriorMode = {
    id: string;
    key: string;
    name: string;
    subtitle: string;
    description: string;
    audience: InteriorAudience;
    coverResourceId?: string;
    coverUrl?: string;
    slots: InteriorInputSlot[];
    params: InteriorParamDef[];
    requiresRoom: boolean;
    requiresStyle: boolean;
    notesRequired: boolean;
    defaultModel?: InteriorModelRef;
    allowedModels: InteriorModelRef[];
    maxCount: number;
    sortOrder: number;
    enabled: boolean;
    builtin: boolean;
    version: number;
    /** 只在后台接口返回。 */
    promptTemplate?: string;
    updatedAt: string;
};

export type InteriorPreset = {
    id: string;
    type: InteriorPresetType;
    key: string;
    groupName: string;
    name: string;
    summary: string;
    coverResourceId?: string;
    coverUrl?: string;
    /** 只在后台接口返回。 */
    prompt?: string;
    tags: string[];
    sortOrder: number;
    enabled: boolean;
    builtin: boolean;
    version: number;
    updatedAt: string;
};

export type InteriorCatalog = {
    settings: { defaultSurface: InteriorSurface; allowSurfaceSwitch: boolean; maxStylesPerRun: number; maxCountPerStyle: number; defaultModel?: InteriorModelRef };
    modes: InteriorMode[];
    styles: InteriorPreset[];
    rooms: InteriorPreset[];
};

export type InteriorSettings = {
    defaultSurface: InteriorSurface;
    allowSurfaceSwitch: boolean;
    defaultModel?: InteriorModelRef;
    maxStylesPerRun: number;
    maxCountPerStyle: number;
};

export type InteriorGenerateInput = {
    professional?: RenovationSpec;
    surface: InteriorSurface;
    modeId: string;
    roomKey?: string;
    styleKeys?: string[];
    params?: Record<string, string>;
    notes?: string;
    sourceResourceId: string;
    referenceResourceIds?: string[];
    count: number;
    size?: string;
    quality?: string;
    model?: InteriorModelRef;
    projectId?: string;
    roundId?: string;
};

export type InteriorGenerateItem = { styleKey?: string; styleName?: string; task?: { id: string; status: string }; error?: string };
export type InteriorGenerateResult = { model: InteriorModelRef; count: number; params: Record<string, string>; items: InteriorGenerateItem[] };

export type InteriorEstimate = { model: InteriorModelRef; images: number; amountMicrocredits: number; estimated: boolean };

export function estimateInterior(input: InteriorGenerateInput, signal?: AbortSignal) {
    return http.post<InteriorEstimate>("/interior/estimate", input, { signal });
}

/** 项目文档里的图片一律写成 resourceId，资源清理才能识别为仍被引用。 */
export type InteriorImageRef = { resourceId: string; width?: number; height?: number };
export type InteriorRoundItemStatus = "pending" | "succeeded" | "failed";
export type InteriorRoundItem = { id: string; styleKey?: string; styleName?: string; taskId?: string; status: InteriorRoundItemStatus; error?: string; outputs: InteriorImageRef[] };
export type InteriorRound = {
    professional?: RenovationSpec;
    id: string;
    createdAt: string;
    surface: InteriorSurface;
    modeKey: string;
    modeName: string;
    roomKey?: string;
    roomName?: string;
    params: Record<string, string>;
    notes?: string;
    count: number;
    size?: string;
    model?: string;
    source: InteriorImageRef;
    references: InteriorImageRef[];
    items: InteriorRoundItem[];
};
/**
 * 一个 3D 模型。生成分两步：先做 AI 方案分析（stage=analyze，读图和需求、查知识库补全方案），再按分析写出整份 3D 方案（stage=spec，房间、门窗、家具、屋顶和庭院），把方案 JSON
 * 存成资源（sceneFile）；一句话修改是 stage=edit，在 parentId 那一版上应用改动。项目文档里只存进度和场景文件的资源 ID。
 */
export type InteriorSceneItem = {
    id: string;
    createdAt: string;
    status: InteriorRoundItemStatus;
    scope: InteriorSceneScope;
    /** 用户选了「AI 判断」：方案分析完成后 scope 换成 AI 判断的范围。 */
    autoScope?: boolean;
    description: string;
    roomKey?: string;
    roomName?: string;
    styleKey?: string;
    styleName?: string;
    /** 风格的简介，后面几步的提示词要用。 */
    styleHint?: string;
    model: string;
    reference?: InteriorImageRef;
    parentId?: string;
    instruction?: string;
    editTarget?: SceneEditTarget;
    /** spec：按方案出整份 3D 方案（第二版）；plan、parts 是旧版分部分搭的进度，已不再产生。 */
    stage?: "analyze" | "spec" | "plan" | "parts" | "edit";
    brief?: SceneBrief;
    /** 这次参考了知识库里的哪些条目（只记标题，页面上列出来）。 */
    knowledge?: { id: string; kindName: string; title: string }[];
    /** 规划或修改那一步的任务。 */
    taskId?: string;
    /** 校验不通过最多自动修正一次；持久化防止刷新后重复付费修正。 */
    repairCount?: number;
    /** 读图结构校核最多修正一次，独立于材质家具阶段。 */
    analysisRepairCount?: number;
    /** 旧版分部分搭留下的规划，只读不用。 */
    plan?: unknown;
    /** 各部分的任务；没提交成功的部分是 null。 */
    partTaskIds?: (string | null)[];
    error?: string;
    sceneFile?: { resourceId: string };
    /** 本人已对照原图确认的结构，允许相同图纸再次上传时复用。 */
    drawingBaseline?: boolean;
    structureSource?: { projectId: string; sceneId: string; title: string; notice?: string };
    title?: string;
    summary?: string;
    objectCount?: number;
    /** 规模说明，例如「3 层 · 18 个空间」；旧版模型没有，显示物体数。 */
    stats?: string;
    /** 生成时的提醒（例如回复被截断）。 */
    notice?: string;
    /** 没搭出来、被跳过的部分。 */
    failedParts?: string[];
    /** 读不懂、被去掉的物体数。 */
    dropped?: number;
};

export type InteriorProjectDocument = { version: 1; rounds: InteriorRound[]; scenes?: InteriorSceneItem[]; professional?: RenovationSpec };

export type InteriorProjectSummary = { id: string; name: string; kind: InteriorProjectKind; revision: number; createdAt: string; updatedAt: string };
export type InteriorProject = InteriorProjectSummary & { document: InteriorProjectDocument };
export type InteriorProjectInput = { name: string; kind: InteriorProjectKind; document?: InteriorProjectDocument; expectedRevision?: number };

export type InteriorDrawingBaseline = { projectId: string; sceneId: string; title: string; notice?: string; sceneFile: { resourceId: string } };

export function getInteriorDrawingBaseline(resourceId: string) {
    return http.get<{ baseline: InteriorDrawingBaseline | null }>("/interior/drawing-baseline", { params: { resourceId } }).then((value) => value.baseline);
}

/** 保存时服务端修订号不一致返回的 reason。 */
export const INTERIOR_PROJECT_CONFLICT = "interior_project_conflict";
export const INTERIOR_VERSION_CONFLICT = "interior_version_conflict";

export function getInteriorCatalog(signal?: AbortSignal) {
    return http.get<InteriorCatalog>("/interior/catalog", { signal });
}

export function generateInterior(input: InteriorGenerateInput) {
    return http.post<InteriorGenerateResult>("/interior/generate", input);
}

export function listInteriorProjects(signal?: AbortSignal) {
    return http.get<{ projects: InteriorProjectSummary[] }>("/interior/projects", { signal }).then((result) => result.projects);
}

export function getInteriorProject(id: string, signal?: AbortSignal) {
    return http.get<InteriorProject>(`/interior/projects/${encodeURIComponent(id)}`, { signal });
}

export function createInteriorProject(input: InteriorProjectInput) {
    return http.post<InteriorProject>("/interior/projects", input);
}

export function saveInteriorProject(id: string, input: InteriorProjectInput & { expectedRevision: number }) {
    return http.put<InteriorProject>(`/interior/projects/${encodeURIComponent(id)}`, input);
}

export function deleteInteriorProject(id: string) {
    return http.delete<{ deleted: boolean }>(`/interior/projects/${encodeURIComponent(id)}`);
}

// ---- 后台管理 ----

export type InteriorModeInput = {
    key: string;
    name: string;
    subtitle: string;
    description: string;
    audience: InteriorAudience;
    coverResourceId: string;
    slots: InteriorInputSlot[];
    params: InteriorParamDef[];
    promptTemplate: string;
    requiresRoom: boolean;
    requiresStyle: boolean;
    notesRequired: boolean;
    defaultModel?: InteriorModelRef;
    allowedModels: InteriorModelRef[];
    maxCount: number;
    sortOrder: number;
    enabled: boolean;
    version: number;
};

export type InteriorPresetInput = {
    type: InteriorPresetType;
    key: string;
    groupName: string;
    name: string;
    summary: string;
    coverResourceId: string;
    prompt: string;
    tags: string[];
    sortOrder: number;
    enabled: boolean;
    version: number;
};

export function listAdminInteriorModes() {
    return http.get<{ modes: InteriorMode[] }>("/admin/interior/modes").then((result) => result.modes);
}

export function saveAdminInteriorMode(id: string | undefined, input: InteriorModeInput) {
    const request = id ? http.put<{ mode: InteriorMode }>(`/admin/interior/modes/${encodeURIComponent(id)}`, input) : http.post<{ mode: InteriorMode }>("/admin/interior/modes", input);
    return request.then((result) => result.mode);
}

export function listAdminInteriorPresets(type: InteriorPresetType) {
    return http.get<{ presets: InteriorPreset[] }>("/admin/interior/presets", { params: { type } }).then((result) => result.presets);
}

export function saveAdminInteriorPreset(id: string | undefined, input: InteriorPresetInput) {
    const request = id ? http.put<{ preset: InteriorPreset }>(`/admin/interior/presets/${encodeURIComponent(id)}`, input) : http.post<{ preset: InteriorPreset }>("/admin/interior/presets", input);
    return request.then((result) => result.preset);
}

export function getAdminInteriorSettings() {
    return http.get<InteriorSettings>("/admin/interior/settings");
}

export function saveAdminInteriorSettings(input: InteriorSettings) {
    return http.put<InteriorSettings>("/admin/interior/settings", input);
}

/** 室内设计知识库的一条：尺寸规范、家具尺寸、动线、风格配色或建模要点。id 是条目标识。 */
export type InteriorKnowledgeEntry = { id: string; kind: string; kindName: string; title: string; guidance: string };

/** 后台的一条知识：id 是记录 ID，key 是条目标识；edited 表示内置条目被管理员改过内容。 */
export type AdminInteriorKnowledgeEntry = {
    id: string;
    key: string;
    kind: string;
    kindName: string;
    title: string;
    guidance: string;
    scopes: string[];
    rooms: string[];
    styles: string[];
    tags: string[];
    sortOrder: number;
    enabled: boolean;
    builtin: boolean;
    edited: boolean;
    version: number;
    updatedAt: string;
};

/** 知识类别和每次最多取几条。 */
export type InteriorKnowledgeKind = { value: string; label: string; limit: number };

export type InteriorKnowledgeInput = Pick<AdminInteriorKnowledgeEntry, "key" | "kind" | "title" | "guidance" | "scopes" | "rooms" | "styles" | "tags" | "sortOrder" | "enabled" | "version">;

export type InteriorKnowledgeQuery = { scope?: string; rooms?: string[]; styles?: string[]; q?: string };

/** 按范围、空间、风格和需求原文取相关知识（最多 16 条）。 */
export function getInteriorKnowledge(query: InteriorKnowledgeQuery, signal?: AbortSignal) {
    return http
        .get<{ entries: InteriorKnowledgeEntry[] }>("/interior/knowledge", {
            params: compactApiParams({ scope: query.scope || undefined, rooms: query.rooms?.length ? query.rooms.join(",") : undefined, styles: query.styles?.length ? query.styles.join(",") : undefined, q: query.q?.trim() || undefined }),
            signal,
        })
        .then((result) => result.entries);
}

export function listAdminInteriorKnowledge(signal?: AbortSignal) {
    return http.get<{ entries: AdminInteriorKnowledgeEntry[]; kinds: InteriorKnowledgeKind[] }>("/admin/interior/knowledge", { signal });
}

/** 新增（没有 id）或修改一条知识；修改带上次读到的 version，冲突返回 409。 */
export function saveAdminInteriorKnowledge(id: string | undefined, input: InteriorKnowledgeInput) {
    const request = id ? http.put<{ entry: AdminInteriorKnowledgeEntry }>(`/admin/interior/knowledge/${encodeURIComponent(id)}`, input) : http.post<{ entry: AdminInteriorKnowledgeEntry }>("/admin/interior/knowledge", input);
    return request.then((result) => result.entry);
}

/** 删除管理员新增的条目；内置条目只能停用。 */
export function deleteAdminInteriorKnowledge(entry: Pick<AdminInteriorKnowledgeEntry, "id" | "version">) {
    return http.delete<{ deleted: boolean }>(`/admin/interior/knowledge/${encodeURIComponent(entry.id)}`, { params: { version: entry.version } });
}

/** 把改过的内置条目恢复成程序自带的内容。 */
export function resetAdminInteriorKnowledge(entry: Pick<AdminInteriorKnowledgeEntry, "id" | "version">) {
    return http.post<{ entry: AdminInteriorKnowledgeEntry }>(`/admin/interior/knowledge/${encodeURIComponent(entry.id)}/reset`, { version: entry.version }).then((result) => result.entry);
}

export function interiorKnowledgeInput(entry: AdminInteriorKnowledgeEntry, patch: Partial<InteriorKnowledgeInput> = {}): InteriorKnowledgeInput {
    const { key, kind, title, guidance, scopes, rooms, styles, tags, sortOrder, enabled, version } = entry;
    return { key, kind, title, guidance, scopes, rooms, styles, tags, sortOrder, enabled, version, ...patch };
}

/** 后台出图统计和记录里的用户；用户已删除时只有 id。 */
export type InteriorAdminUser = { id: string; username?: string; displayName?: string };

/** 一个出图方式、风格、空间或模型在统计窗口里的出图次数，failed 是其中失败的。 */
export type InteriorAdminCount = { key: string; name: string; total: number; failed: number };

/** 近 30 天（UTC 自然日）的室内设计出图统计；一个风格一次算一个任务，超过 5000 条只算最新的并标 truncated。 */
export type AdminInteriorOverview = {
    windowDays: number;
    truncated: boolean;
    generations: { total: number; queued: number; running: number; succeeded: number; failed: number; cancelled: number; users: number; last7Days: number; today: number; quick: number; pro: number };
    projects: { total: number; home: number; client: number; users: number };
    config: { siteDefaultModel: boolean; enabledModes: number; modesWithoutModel: string[] };
    daily: { date: string; total: number; failed: number }[];
    modes: InteriorAdminCount[];
    styles: InteriorAdminCount[];
    rooms: InteriorAdminCount[];
    models: InteriorAdminCount[];
    recentFailures: { id: string; user: InteriorAdminUser; modeName?: string; error: string; createdAt: string }[];
};

/** 后台出图记录的一条；图片都是资源 ID，用管理员资源接口读。 */
export type AdminInteriorGeneration = {
    id: string;
    user: InteriorAdminUser;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    stage?: string;
    progress: number;
    error?: string;
    modeKey?: string;
    modeName?: string;
    surface?: "quick" | "pro";
    roomName?: string;
    styleName?: string;
    model?: string;
    sourceResourceId?: string;
    referenceResourceIds: string[];
    outputResourceIds: string[];
    projectId?: string;
    createdAt: string;
    completedAt?: string;
};

export type AdminInteriorGenerationDetail = AdminInteriorGeneration & { prompt: string; params: Record<string, string>; projectName?: string };

export type AdminInteriorGenerationPage = { records: AdminInteriorGeneration[]; total: number; page: number; pageSize: number };

export type AdminInteriorGenerationQuery = { status?: string; mode?: string; keyword?: string; page?: number; pageSize?: number };

export function getAdminInteriorOverview(signal?: AbortSignal) {
    return http.get<AdminInteriorOverview>("/admin/interior/overview", { signal });
}

export function listAdminInteriorGenerations(query: AdminInteriorGenerationQuery, signal?: AbortSignal) {
    return http.get<AdminInteriorGenerationPage>("/admin/interior/generations", {
        params: compactApiParams({ ...query, status: query.status === "all" ? undefined : query.status, mode: query.mode === "all" ? undefined : query.mode }),
        signal,
    });
}

export function getAdminInteriorGeneration(id: string, signal?: AbortSignal) {
    return http.get<AdminInteriorGenerationDetail>(`/admin/interior/generations/${encodeURIComponent(id)}`, { signal });
}

/** 后台列表返回的模式转回保存请求，保留服务端版本号做并发校验。 */
export function interiorModeInput(mode: InteriorMode, patch: Partial<InteriorModeInput> = {}): InteriorModeInput {
    return {
        key: mode.key,
        name: mode.name,
        subtitle: mode.subtitle,
        description: mode.description,
        audience: mode.audience,
        coverResourceId: mode.coverResourceId || "",
        slots: mode.slots,
        params: mode.params,
        promptTemplate: mode.promptTemplate || "",
        requiresRoom: mode.requiresRoom,
        requiresStyle: mode.requiresStyle,
        notesRequired: mode.notesRequired,
        ...(mode.defaultModel ? { defaultModel: mode.defaultModel } : {}),
        allowedModels: mode.allowedModels,
        maxCount: mode.maxCount,
        sortOrder: mode.sortOrder,
        enabled: mode.enabled,
        version: mode.version,
        ...patch,
    };
}

export function interiorPresetInput(preset: InteriorPreset, patch: Partial<InteriorPresetInput> = {}): InteriorPresetInput {
    return {
        type: preset.type,
        key: preset.key,
        groupName: preset.groupName,
        name: preset.name,
        summary: preset.summary,
        coverResourceId: preset.coverResourceId || "",
        prompt: preset.prompt || "",
        tags: preset.tags,
        sortOrder: preset.sortOrder,
        enabled: preset.enabled,
        version: preset.version,
        ...patch,
    };
}
