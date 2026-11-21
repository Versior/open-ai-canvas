import type { StudioShotRole } from "./types";

export function studioScreenCopyBudget(role: StudioShotRole) {
    const hero = role === "detail-hero" || role === "main-selling";
    const information = ["detail-spec", "detail-size", "detail-steps"].includes(role);
    return { lines: information ? 6 : hero ? 2 : 3, units: information ? 160 : hero ? 60 : 90 };
}
