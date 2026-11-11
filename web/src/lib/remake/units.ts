import type { RemakeJob, RemakeShot, RemakeTake, RemakeUnit } from "./job";
import { buildRemakeUnitPrompt, remakeReferenceImages } from "./prompts";

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

/** 参考片段可能从镜头前开始，候选必须覆盖到该单元在参考时间轴上的末尾。 */
export function remakeTakeError(unit: Pick<RemakeUnit, "treatment" | "startMs" | "endMs" | "clipStartMs" | "shotIndexes">, take: Pick<RemakeTake, "durationMs">) {
    const origin = unit.treatment === "replace" ? unit.clipStartMs : unit.startMs;
    return !take.durationMs || !Number.isFinite(take.durationMs) || take.durationMs + 100 < unit.endMs - origin ? `镜头 ${unit.shotIndexes.join("、")} 的生成时长不足，不能用静止尾帧补成完整视频；原成品保留在任务中心` : "";
}

/** 导演输入变化后重新生成，保留旧候选；不能重提尚未确认结束的付费任务。 */
export function applyRemakeCreativeSignature(job: RemakeJob, units: RemakeUnit[]) {
    return units.map((unit) => {
        const shots = job.shots.filter((shot) => unit.shotIndexes.includes(shot.index));
        if (!unit.creativeSignature && unit.taskId) return unit;
        const input = JSON.stringify([
            buildRemakeUnitPrompt(job, { ...unit, fix: undefined }, shots, (unit.endMs - unit.startMs) / 1000),
            remakeReferenceImages(job).images.map((image) => image.resourceId),
            job.model,
            job.ratio,
            job.resolution,
            job.audio,
            job.language,
        ]);
        // 固定长度的内容指纹，避免每个单元重复保存整份配方而超过作品大小限制；不用于鉴权。
        let hash = BigInt("0xcbf29ce484222325");
        const prime = BigInt("0x100000001b3");
        for (let index = 0; index < input.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(input.charCodeAt(index))) * prime);
        const signature = `director-v1:${hash.toString(16)}`;
        if (unit.creativeSignature === signature) return unit;
        if (unit.taskId || (unit.input && unit.status !== "succeeded")) throw new Error("旧镜头任务尚未确认结束，请完成取消或等待后再应用导演修改");
        return { ...unit, creativeSignature: signature, input: undefined, status: "pending" as const, taskId: undefined, error: undefined, attempt: unit.attempt + (unit.takes.length || unit.taskId ? 1 : 0) };
    });
}
