import type { RemakeShot, RemakeUnit } from "./job";

/** 换元素单元的参考片段至少 4 秒：多数视频模型的参考视频要 2 秒以上、生成至少 4 秒，片段和成片一一对应。 */
export const REMAKE_MIN_CLIP_MS = 4000;

export function remakeUnitKey(unit: Pick<RemakeUnit, "treatment" | "startMs" | "endMs">) {
    return `${unit.treatment}:${unit.startMs}-${unit.endMs}`;
}

/**
 * 把逐镜做法排成生成单元：相邻、做法相同的镜头合并，总长不超过 maxMs；单个镜头超过 maxMs 时按时长均分。
 * 保留原片和删掉的镜头不生成。之前已有的单元（做法和时间范围都没变）原样沿用，候选和任务都不丢。
 */
export function planRemakeUnits(shots: readonly RemakeShot[], options: { maxMs: number; sourceDurationMs: number }, previous: readonly RemakeUnit[] = []): RemakeUnit[] {
    const { maxMs, sourceDurationMs } = options;
    const ranges: { treatment: "replace" | "remake"; shotIndexes: number[]; startMs: number; endMs: number }[] = [];
    let run: (typeof ranges)[number] | null = null;
    const flush = () => {
        if (run) ranges.push(run);
        run = null;
    };
    for (const shot of shots) {
        if (shot.treatment !== "replace" && shot.treatment !== "remake") {
            flush();
            continue;
        }
        const length = shot.endMs - shot.startMs;
        if (length > maxMs) {
            flush();
            const parts = Math.ceil(length / maxMs);
            for (let part = 0; part < parts; part += 1) {
                ranges.push({ treatment: shot.treatment, shotIndexes: [shot.index], startMs: shot.startMs + Math.round((length * part) / parts), endMs: shot.startMs + Math.round((length * (part + 1)) / parts) });
            }
            continue;
        }
        const current = run as (typeof ranges)[number] | null;
        if (current && current.treatment === shot.treatment && current.endMs === shot.startMs && shot.endMs - current.startMs <= maxMs) {
            current.shotIndexes.push(shot.index);
            current.endMs = shot.endMs;
            continue;
        }
        flush();
        run = { treatment: shot.treatment, shotIndexes: [shot.index], startMs: shot.startMs, endMs: shot.endMs };
    }
    flush();
    const reuse = new Map(previous.map((unit) => [unit.key, unit]));
    return ranges.map((range) => {
        const key = remakeUnitKey(range);
        const existing = reuse.get(key);
        if (existing) return { ...existing, shotIndexes: range.shotIndexes };
        const clip = range.treatment === "replace" ? remakeClipRange(range.startMs, range.endMs, sourceDurationMs, maxMs) : { clipStartMs: range.startMs, clipEndMs: range.endMs };
        return { key, ...range, ...clip, status: "pending", attempt: 1, takes: [], chosen: 0 };
    });
}

/** 参考片段：不足 4 秒时以单元为中心向两边补，补到视频头尾就往另一边补；不超过 maxMs。 */
export function remakeClipRange(startMs: number, endMs: number, sourceDurationMs: number, maxMs: number) {
    const length = endMs - startMs;
    const target = Math.min(Math.max(length, REMAKE_MIN_CLIP_MS), maxMs, sourceDurationMs);
    if (length >= target) return { clipStartMs: startMs, clipEndMs: endMs };
    let clipStartMs = Math.max(0, Math.round(startMs - (target - length) / 2));
    const clipEndMs = Math.min(sourceDurationMs, clipStartMs + target);
    clipStartMs = Math.max(0, clipEndMs - target);
    return { clipStartMs, clipEndMs };
}

/** 换元素单元的参考片段签名：签名变了说明要重新切。 */
export function remakeClipSignature(units: readonly RemakeUnit[]) {
    return units
        .filter((unit) => unit.treatment === "replace")
        .map((unit) => `${unit.clipStartMs}-${unit.clipEndMs}`)
        .join(",");
}

export function remakeUnitTake(unit: Pick<RemakeUnit, "takes" | "chosen">) {
    return unit.takes[unit.chosen] || unit.takes[unit.takes.length - 1];
}
