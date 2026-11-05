import { apiBaseURL, http } from "./request";

/** 电商生图台的模特库：模特人脸、姿势参考图、模特样式（造型）。后台维护，生图台按需选用。 */
export type StudioModelKind = "face" | "pose" | "style";
export type StudioModelGender = "" | "female" | "male";

export type StudioModelItem = {
    id: string;
    kind: StudioModelKind;
    name: string;
    category: string;
    gender: StudioModelGender;
    tags: string[];
    prompt: string;
    hasImage: boolean;
    width: number;
    height: number;
    revision: string;
    enabled: boolean;
    consent: boolean;
    sortOrder: number;
    updatedAt: string;
};

export type StudioModelCategoryCount = { name: string; count: number };

/** kindCounts、categoryCounts 只有后台列表返回：每种素材的总条数和当前类型每个分类的条数。 */
export type StudioModelPage = { items: StudioModelItem[]; total: number; page: number; pageSize: number; categories: string[]; kindCounts?: Partial<Record<StudioModelKind, number>>; categoryCounts?: StudioModelCategoryCount[] };

/** 后台列表的上下架筛选；空串看全部。 */
export type StudioModelStatusFilter = "" | "enabled" | "disabled";

export type StudioModelInput = {
    kind: StudioModelKind;
    name: string;
    category: string;
    gender: StudioModelGender;
    tags: string[];
    prompt: string;
    consent: boolean;
    enabled: boolean;
    sortOrder?: number;
};

export const STUDIO_MODEL_KIND_LABEL: Record<StudioModelKind, string> = { face: "模特人脸", pose: "姿势", style: "模特样式" };
export const STUDIO_MODEL_GENDER_LABEL: Record<StudioModelGender, string> = { "": "不限", female: "女", male: "男" };
export const STUDIO_MODEL_IMPORT_MAX_BYTES = 12 * 1024 * 1024;

/** 素材图地址；带 revision 时浏览器可以缓存。thumb 给列表用的缩略图。 */
export function studioModelImageUrl(item: Pick<StudioModelItem, "id" | "revision">, thumb = false) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/ecommerce/studio/models/${encodeURIComponent(item.id)}/image?${thumb ? "variant=thumb&" : ""}v=${encodeURIComponent(item.revision)}`;
}

export function listStudioModels(params: { kind: StudioModelKind; q?: string; category?: string; gender?: StudioModelGender; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<StudioModelPage>("/ecommerce/studio/models", {
        params: { kind: params.kind, q: params.q || undefined, category: params.category || undefined, gender: params.gender || undefined, page: params.page || 1, pageSize: params.pageSize || 24 },
        signal,
        timeout: 15000,
    });
}

/** 选用：服务端把原图复制到自己的资源库，返回自己的资源 ID 供出图引用。 */
export function attachStudioModel(id: string) {
    return http.post<{ resourceId: string; width: number; height: number }>(`/ecommerce/studio/models/${encodeURIComponent(id)}/attach`, undefined, { timeout: 30000 });
}

export function listAdminStudioModels(params: { kind: StudioModelKind; q?: string; category?: string; status?: StudioModelStatusFilter; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<StudioModelPage>("/admin/studio-models", {
        params: { kind: params.kind, q: params.q || undefined, category: params.category || undefined, status: params.status || undefined, page: params.page || 1, pageSize: params.pageSize || 24 },
        signal,
        timeout: 15000,
    });
}

export async function importAdminStudioModel(input: StudioModelInput, file?: File) {
    const body = new FormData();
    body.append("kind", input.kind);
    body.append("name", input.name);
    body.append("category", input.category);
    body.append("gender", input.gender);
    body.append("tags", JSON.stringify(input.tags));
    body.append("prompt", input.prompt);
    body.append("consent", String(input.consent));
    body.append("enabled", String(input.enabled));
    if (file) body.append("file", file);
    const result = await http.post<{ item: StudioModelItem }>("/admin/studio-models/import", body, { timeout: 60000 });
    return result.item;
}

export async function updateAdminStudioModel(id: string, input: StudioModelInput) {
    const result = await http.put<{ item: StudioModelItem }>(`/admin/studio-models/${encodeURIComponent(id)}`, input);
    return result.item;
}

export function batchAdminStudioModels(ids: string[], action: "enable" | "disable" | "delete") {
    return http.post<{ affected: number }>("/admin/studio-models/batch", { ids, action });
}
