import { apiBaseURL, http } from "./request";
import type { RemoteResource } from "./resources";
import { canonicalize } from "json-canonicalize";
export const ECOMMERCE_FLOW_IDS = ["detail", "main", "wear", "seed"] as const;
export type EcommerceFlowId = (typeof ECOMMERCE_FLOW_IDS)[number];
export type PublicEcommerceModel = { id: string; name: string; enabled: boolean; tags: string[]; resourceIds: string[] };
export type EcommerceSetting = { enabled: boolean; modelLibraryEnabled: boolean; autoBindEnabled: boolean; flows: Record<EcommerceFlowId, { enabled: boolean; directorPrompt: string }>; models: PublicEcommerceModel[]; revision: string };
export const DEFAULT_ECOMMERCE_SETTING: EcommerceSetting = {
    enabled: true,
    modelLibraryEnabled: true,
    autoBindEnabled: true,
    flows: { detail: { enabled: true, directorPrompt: "" }, main: { enabled: true, directorPrompt: "" }, wear: { enabled: true, directorPrompt: "" }, seed: { enabled: true, directorPrompt: "" } },
    models: [],
    revision: "initial",
};
export function ecommerceSettingsEqual(a: EcommerceSetting, b: EcommerceSetting, ignoreRevision = false) {
    return canonicalize(ignoreRevision ? { ...a, revision: "" } : a) === canonicalize(ignoreRevision ? { ...b, revision: "" } : b);
}
export function parseEcommerceSetting(value: unknown): EcommerceSetting {
    if (!value || typeof value !== "object") throw new Error("电商画布配置格式无效");
    const setting = structuredClone(value) as EcommerceSetting;
    for (const flow of Object.values(setting.flows || {})) { if (flow && flow.directorPrompt === undefined) flow.directorPrompt = ""; }
    if (
        typeof setting.enabled !== "boolean" ||
        typeof setting.modelLibraryEnabled !== "boolean" ||
        typeof setting.autoBindEnabled !== "boolean" ||
        typeof setting.revision !== "string" ||
        !setting.flows ||
        Object.keys(setting.flows).length !== 4 ||
        !ECOMMERCE_FLOW_IDS.every((id) => typeof setting.flows[id]?.enabled === "boolean" && typeof setting.flows[id]?.directorPrompt === "string") ||
        !Array.isArray(setting.models) ||
        !setting.models.every(
            (model) =>
                model &&
                typeof model.id === "string" &&
                typeof model.name === "string" &&
                typeof model.enabled === "boolean" &&
                Array.isArray(model.tags) &&
                model.tags.every((tag) => typeof tag === "string") &&
                Array.isArray(model.resourceIds) &&
                model.resourceIds.every((id) => typeof id === "string"),
        )
    )
        throw new Error("电商画布配置格式无效");
    if (
        !setting.revision ||
        setting.models.length > 200 ||
        new Set(setting.models.map((model) => model.id)).size !== setting.models.length ||
        setting.models.some(
            (model) =>
                !model.id.trim() ||
                model.id.length > 100 ||
                /[\/\\?#]/.test(model.id) ||
                !model.name.trim() ||
                [...model.name].length > 100 ||
                model.tags.length > 20 ||
                model.tags.some((tag) => [...tag].length > 50) ||
                model.resourceIds.length > 12 ||
                new Set(model.resourceIds).size !== model.resourceIds.length ||
                model.resourceIds.some((id) => !id.trim() || id.length > 100) ||
                (model.enabled && !model.resourceIds.length),
        ) ||
        ECOMMERCE_FLOW_IDS.some((id) => [...setting.flows[id].directorPrompt].length > 20000)
    )
        throw new Error("电商画布配置字段无效");
    return setting;
}
async function readSetting(path: string) {
    const result = await http.get<{ setting: unknown }>(path);
    return parseEcommerceSetting(result.setting);
}
export const getEcommerceSetting = () => readSetting("/ecommerce/settings");
export const getAdminEcommerceSetting = () => readSetting("/admin/settings/ecommerce");
export const getPreviousEcommerceSetting = () => readSetting("/admin/settings/ecommerce/previous");
export async function saveAdminEcommerceSetting(value: EcommerceSetting) {
    const result = await http.put<{ setting: unknown }>("/admin/settings/ecommerce", value);
    return parseEcommerceSetting(result.setting);
}
export function uploadEcommerceModelImage(file: File) {
    const form = new FormData();
    form.append("file", file);
    return http.post<{ resource: RemoteResource }>("/admin/settings/ecommerce/images", form);
}
export function ecommercePublicImageUrl(modelId: string, resourceId: string) {
    return `${apiBaseURL.replace(/\/$/, "")}/ecommerce/models/${encodeURIComponent(modelId)}/images/${encodeURIComponent(resourceId)}`;
}
