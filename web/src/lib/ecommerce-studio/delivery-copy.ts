import type { StudioCopySource, StudioLanguage, StudioOutput, StudioShot } from "./types";

export type StudioCopySnapshot = { language: StudioLanguage; eyebrow: string; headline: string; subline: string; lines: string[]; source?: StudioCopySource };

export function studioCopySnapshot(shot: Pick<StudioShot, "eyebrow" | "headline" | "subline" | "lines"> & Partial<Pick<StudioShot, "copySource">>, language: StudioLanguage, hasCopy: boolean): StudioCopySnapshot {
    // 策划模型的文字只是分析草稿，不是这次图片请求的定稿。只有用户在清单
    // 里明确改过并锁定为 user，才允许把文案快照交给验收、恢复和候选预览。
    if (!hasCopy || language === "none" || shot.copySource === "assistant") return { language, eyebrow: "", headline: "", subline: "", lines: [], ...(shot.copySource ? { source: shot.copySource } : {}) };
    return { language, eyebrow: shot.eyebrow?.trim() || "", headline: shot.headline.trim(), subline: shot.subline.trim(), lines: shot.lines.map((line) => line.trim()).filter(Boolean), ...(shot.copySource ? { source: shot.copySource } : {}) };
}

export function studioCandidateCopy(shot: StudioShot, output: StudioOutput, language: StudioLanguage, composed: boolean) {
    const submitted = shot.attempts.find((attempt) => attempt.outputs.some((item) => item.resourceId === output.resourceId))?.input?.compiled.copySnapshot;
    if (!composed && submitted) return { ...submitted, source: "submitted" as const };
    return { ...studioCopySnapshot(shot, language, shot.role !== "main-white"), source: composed ? ("typeset" as const) : ("plan-only" as const) };
}
