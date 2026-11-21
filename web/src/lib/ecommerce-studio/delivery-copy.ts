import type { StudioLanguage, StudioOutput, StudioShot } from "./types";

export type StudioCopySnapshot = { language: StudioLanguage; eyebrow: string; headline: string; subline: string; lines: string[] };

export function studioCopySnapshot(shot: Pick<StudioShot, "eyebrow" | "headline" | "subline" | "lines">, language: StudioLanguage, hasCopy: boolean): StudioCopySnapshot {
    if (!hasCopy || language === "none") return { language, eyebrow: "", headline: "", subline: "", lines: [] };
    return { language, eyebrow: shot.eyebrow?.trim() || "", headline: shot.headline.trim(), subline: shot.subline.trim(), lines: shot.lines.map((line) => line.trim()).filter(Boolean) };
}

export function studioCandidateCopy(shot: StudioShot, output: StudioOutput, language: StudioLanguage, composed: boolean) {
    const submitted = shot.attempts.find((attempt) => attempt.outputs.some((item) => item.resourceId === output.resourceId))?.input?.compiled.copySnapshot;
    if (!composed && submitted) return { source: "submitted" as const, ...submitted };
    return { source: composed ? ("typeset" as const) : ("plan-only" as const), ...studioCopySnapshot(shot, language, shot.role !== "main-white") };
}
