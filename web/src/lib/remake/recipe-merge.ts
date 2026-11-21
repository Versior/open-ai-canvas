import type { RemakeJob } from "./job";
import { referenceReplicationInput } from "./reference-replication";

type Choice = "local" | "remote";

export class RecipeConflict extends Error {
    constructor(
        readonly latest: RemakeJob,
        fields: string[],
        readonly changedMode = false,
    ) {
        super(changedMode ? "复刻方式已在另一窗口改变，请载入最新配方" : `另一窗口也修改了${fields.map((field) => (field === "authorized" ? "原片使用授权" : `「${field}」`)).join("、")}，请核对后选择保留哪一版`);
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const same = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right);

function recipeFields(job: RemakeJob) {
    const { title, product, people, models, backgrounds, audio, language, voice, voiceReference, subtitles, music, authorized, note, model, ratio, resolution, shots, campaign, directorPlans, activeDirectorPlanId } = job;
    return {
        title,
        product,
        people,
        models,
        backgrounds,
        audio,
        language,
        voice,
        voiceReference,
        subtitles,
        music,
        authorized,
        note,
        model,
        ratio,
        resolution,
        shots,
        campaign,
        directorPlans,
        activeDirectorPlanId,
        creative: job.creative && { brief: job.creative.brief, confirmedInput: job.creative.confirmedInput },
        replication: job.replication && { brief: job.replication.brief, targetDurationMs: job.replication.targetDurationMs },
    };
}

export function mergeRemakeRecipe(base: RemakeJob, local: RemakeJob, latest: RemakeJob, choice?: Choice): RemakeJob {
    if (base.replication?.mode !== latest.replication?.mode) throw new RecipeConflict(latest, [], true);
    const conflicts: string[] = [];
    const merge = (before: unknown, edited: unknown, remote: unknown, path: string): unknown => {
        if (before === edited) return remote;
        if (before === remote) return edited;
        if (record(before) && record(edited) && record(remote)) {
            const merged = { ...remote };
            for (const key of new Set([...Object.keys(before), ...Object.keys(edited)])) merged[key] = merge(before[key], edited[key], remote[key], path ? `${path}.${key}` : key);
            return merged;
        }
        if (same(before, edited)) return remote;
        if (same(before, remote)) return edited;
        if (path !== "authorized" && same(edited, remote)) return remote;
        if (Array.isArray(before) && Array.isArray(edited) && Array.isArray(remote) && before.length === edited.length && before.length === remote.length) {
            const identity = (entry: unknown) => (record(entry) ? (entry.id ?? entry.index) : undefined);
            if (before.every((entry, index) => identity(entry) !== undefined && identity(entry) === identity(edited[index]) && identity(entry) === identity(remote[index]))) {
                return before.map((entry, index) => merge(entry, edited[index], remote[index], `${path}[${identity(entry)}]`));
            }
        }
        if (!choice) conflicts.push(path);
        return choice === "local" ? edited : remote;
    };
    const { creative, replication, ...fields } = merge(recipeFields(base), recipeFields(local), recipeFields(latest), "") as ReturnType<typeof recipeFields>;
    if (conflicts.length) throw new RecipeConflict(latest, conflicts);
    const result = { ...latest, ...fields };
    if (latest.creative && creative) result.creative = { ...latest.creative, ...creative };
    if (latest.replication && replication) {
        result.replication = { ...latest.replication, ...replication };
        if (result.replication.plan?.input !== referenceReplicationInput(result)) result.replication.confirmed = false;
    }
    return result;
}
