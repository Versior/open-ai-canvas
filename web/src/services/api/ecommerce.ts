import { apiBaseURL, http } from "./request";
import type { RemoteResource } from "./resources";
import { canonicalize } from "json-canonicalize";
import { ECOMMERCE_CAPABILITIES, type EcommerceCapability } from "@/lib/ecommerce/ecommerce-capabilities";
export const ECOMMERCE_FLOW_IDS = ["detail", "main", "wear", "seed"] as const;
export type EcommerceFlowId = (typeof ECOMMERCE_FLOW_IDS)[number];
export type PublicEcommerceModel = { id: string; name: string; enabled: boolean; tags: string[]; resourceIds: string[] };
export type EcommerceSuiteTemplate = { id: string; name: string; flow: EcommerceFlowId; category: string; enabled: boolean; style: string; source: string; shots: { title: string; duty: string }[] };
export type EcommerceSetting = {
    capabilities?: Record<EcommerceCapability, { enabled: boolean; directorPrompt: string }>;
    enabled: boolean;
    modelLibraryEnabled: boolean;
    autoBindEnabled: boolean;
    flows: Record<EcommerceFlowId, { enabled: boolean; directorPrompt: string }>;
    models: PublicEcommerceModel[];
    templates: EcommerceSuiteTemplate[];
    revision: string;
};
export function ecommerceCapabilitySettings(setting: EcommerceSetting) {
    return setting.capabilities || (Object.fromEntries(ECOMMERCE_CAPABILITIES.map((item) => [item.id, { enabled: true, directorPrompt: "" }])) as NonNullable<EcommerceSetting["capabilities"]>);
}
export const DEFAULT_ECOMMERCE_SETTING: EcommerceSetting = {
    enabled: true,
    modelLibraryEnabled: true,
    autoBindEnabled: true,
    flows: { detail: { enabled: true, directorPrompt: "" }, main: { enabled: true, directorPrompt: "" }, wear: { enabled: true, directorPrompt: "" }, seed: { enabled: true, directorPrompt: "" } },
    models: [],
    templates: [],
    revision: "initial",
};
export function ecommerceSettingsEqual(a: EcommerceSetting, b: EcommerceSetting, ignoreRevision = false) {
    return canonicalize(ignoreRevision ? { ...a, revision: "" } : a) === canonicalize(ignoreRevision ? { ...b, revision: "" } : b);
}
export function parseEcommerceSetting(value: unknown): EcommerceSetting {
    if (!value || typeof value !== "object") throw new Error("电商画布配置格式无效");
    const setting = structuredClone(value) as EcommerceSetting;
    if (setting.capabilities && typeof setting.capabilities === "object")
        for (const item of Object.values(setting.capabilities)) {
            if (item && typeof item === "object" && item.directorPrompt === undefined) item.directorPrompt = "";
        }
    if (
        setting.capabilities !== undefined &&
        (!setting.capabilities ||
            typeof setting.capabilities !== "object" ||
            Object.keys(setting.capabilities).length !== ECOMMERCE_CAPABILITIES.length ||
            ECOMMERCE_CAPABILITIES.some(({ id }) => typeof setting.capabilities?.[id]?.enabled !== "boolean" || typeof setting.capabilities[id].directorPrompt !== "string" || setting.capabilities[id].directorPrompt.length > 20000))
    )
        throw new Error("电商能力配置无效");
    if (setting.templates === undefined) setting.templates = [];
    if (
        !Array.isArray(setting.templates) ||
        setting.templates.length > 200 ||
        new Set(setting.templates.map((item) => item?.id)).size !== setting.templates.length ||
        setting.templates.some(
            (item) =>
                !item ||
                typeof item.id !== "string" ||
                !item.id.trim() ||
                item.id.length > 150 ||
                typeof item.name !== "string" ||
                !item.name.trim() ||
                [...item.name].length > 100 ||
                !ECOMMERCE_FLOW_IDS.includes(item.flow) ||
                typeof item.enabled !== "boolean" ||
                typeof item.category !== "string" ||
                [...item.category].length > 200 ||
                typeof item.style !== "string" ||
                [...item.style].length > 6000 ||
                typeof item.source !== "string" ||
                [...item.source].length > 500 ||
                !Array.isArray(item.shots) ||
                !item.shots.length ||
                item.shots.length > 30 ||
                item.shots.some((shot) => !shot || typeof shot !== "object" || typeof shot.title !== "string" || !shot.title.trim() || [...shot.title].length > 100 || typeof shot.duty !== "string" || !shot.duty.trim() || [...shot.duty].length > 12000),
        )
    )
        throw new Error("套图模板格式无效");
    for (const flow of Object.values(setting.flows || {})) {
        if (flow && typeof flow === "object" && flow.directorPrompt === undefined) flow.directorPrompt = "";
    }
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
export const getAdminEcommerceDefaults = () => http.get<{ defaults: Record<string, string> }>("/admin/settings/ecommerce/defaults", { timeout: 15000 });
export type EcommerceCatalogEntry = { id: string; name: string; category: string; description: string; count: number };
export const getEcommerceCatalog = (q: string, page = 1, signal?: AbortSignal) =>
    http.get<{ items: EcommerceCatalogEntry[]; total: number; page: number; pageSize: number }>("/ecommerce/templates", { params: { q, page, pageSize: 20 }, signal, timeout: 15000 });
export const getEcommerceCatalogTemplate = (id: string, signal?: AbortSignal) => http.get<{ template: EcommerceSuiteTemplate }>("/ecommerce/templates/" + encodeURIComponent(id), { signal, timeout: 15000 });
export const getPreviousEcommerceSetting = () => readSetting("/admin/settings/ecommerce/previous");
export async function saveAdminEcommerceSetting(value: EcommerceSetting) {
    const validated = parseEcommerceSetting(value);
    if (new TextEncoder().encode(JSON.stringify(validated)).byteLength > 2 * 1024 * 1024) throw new Error("电商配置超过 2MB，请减少模板数量或缩短内容后保存");
    const result = await http.put<{ setting: unknown }>("/admin/settings/ecommerce", validated);
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
