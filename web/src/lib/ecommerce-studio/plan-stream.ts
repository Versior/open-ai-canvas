import { createProgressiveJSONReader } from "../progressive-json";
import type { StudioPlanScope } from "./types";

export type StudioPlanDraftScreen = {
    index: number;
    title?: string;
    purpose: string;
    visual: string;
    visualBeat?: string;
    elements?: string;
    evidence?: string[];
};

export type StudioPlanStreamSnapshot = {
    characters: number;
    summary: string;
    concept: string;
    screens: StudioPlanDraftScreen[];
};

export function createStudioPlanStreamReader(scope: StudioPlanScope) {
    const detail = scope === "detail";
    const fields: readonly ("summary" | "concept")[] = detail ? ["summary"] : ["summary", "concept"];
    const reader = createProgressiveJSONReader(fields, "screens", (value, index): StudioPlanDraftScreen => {
        const text = (key: string) => (typeof value[key] === "string" ? value[key].trim() : "");
        const purpose = text("purchaseQuestion") || text("purpose");
        const visual = text("displayContent") || text("visual");
        const visualBeat = detail ? text("visualBeat") : "";
        const elements = text("visualFocus") || (detail ? "" : text("elements"));
        const evidence = Array.isArray(value.evidence) ? value.evidence.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])) : [];
        return {
            index,
            ...(!detail ? { title: text("title") } : {}),
            purpose,
            visual,
            ...(visualBeat ? { visualBeat } : {}),
            ...(elements ? { elements } : {}),
            ...(evidence.length ? { evidence } : {}),
        };
    });

    return {
        read(raw: string): StudioPlanStreamSnapshot {
            const { fields, items } = reader.read(raw);
            return { characters: raw.length, summary: fields.summary || "", concept: fields.concept || "", screens: [...items] };
        },
    };
}
