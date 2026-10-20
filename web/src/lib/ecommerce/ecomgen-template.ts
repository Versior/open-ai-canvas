import { parseEcommerceSetting, DEFAULT_ECOMMERCE_SETTING, type EcommerceFlowId, type EcommerceSuiteTemplate } from "@/services/api/ecommerce";
import type { EcommerceSuiteRow } from "./ecommerce-suite";
import { nanoid } from "nanoid";

/** Import upstream planning as editable directions, never verified product facts. */
export function parseEcomgenTemplate(text: string, flow: EcommerceFlowId): EcommerceSuiteTemplate {
    const value = JSON.parse(text);
    if (value?.kind !== "ecomgen.suite" || value.schemaVersion !== 1 || !Array.isArray(value.shots)) throw new Error("请选择 schemaVersion 1 的 ecomgen.suite JSON");
    if (value.shots.some((shot: unknown) => !shot || typeof shot !== "object" || !Number.isInteger((shot as { order?: unknown }).order)) || new Set(value.shots.map((shot: { order: number }) => shot.order)).size !== value.shots.length)
        throw new Error("套图镜头须有不重复的整数顺序");
    const fields = ["camera", "lighting", "background", "props", "productOccupancy", "whitespace", "textZone", "promptTemplate"] as const;
    const labels = ["镜头", "布光", "背景", "道具", "主体占比", "留白", "文字位置", "画面参考"];
    const template: EcommerceSuiteTemplate = {
        id: value.id,
        name: value.name,
        flow,
        enabled: false,
        category: [value.category?.l1, value.category?.l2, value.category?.leaf].filter((part) => typeof part === "string" && part.trim()).join(" / "),
        style: typeof value.styleLock?.lockText === "string" ? value.styleLock.lockText : "",
        source: "EcomGen · schemaVersion 1",
        shots: [...value.shots]
            .sort((a, b) => a.order - b.order)
            .map((shot) => ({
                title: shot.displayName,
                duty: [shot.intent, ...fields.map((field, index) => (typeof shot[field] === "string" && shot[field].trim() ? `${labels[index]}：${shot[field]}` : ""))].filter(Boolean).join(String.fromCharCode(10)),
            })),
    };
    return parseEcommerceSetting({ ...structuredClone(DEFAULT_ECOMMERCE_SETTING), templates: [template] }).templates[0];
}

export function ecommerceTemplateRows(template: EcommerceSuiteTemplate): EcommerceSuiteRow[] {
    const revision = nanoid();
    return template.shots.map((shot, index) => ({ slotId: `${template.flow}-${revision}-${index + 1}`, title: shot.title, duty: shot.duty, prompt: "" }));
}
