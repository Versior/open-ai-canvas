import { STUDIO_SINGLE_TYPES, studioDisplayName, studioInfoPoints, studioInfoText, studioOutputSpec, studioPlatformForbidsText, studioRunRatio, studioSingleTypes, studioTitleOf } from "./brief";
import { studioAttemptActive, studioShotCopy } from "./product";
import { studioPlanRoles, studioShotSpec } from "./shot-specs";
import { studioSuiteShotRole } from "./suites";
import type { StudioBrief, StudioPhoto, StudioPlanKind, StudioProduct, StudioRun, StudioShot, StudioShotRole } from "./types";

/**
 * 表单生成的记录：点一次「生成商品图」就是一组镜头。
 * 数量、比例和文案在点生成那一刻定下来，之后改表单不影响已经排好的这一组。
 */
export type StudioIdFactory = () => string;

/** 保留的组数：超出后删掉最早一组（图片仍在素材库和任务中心）。 */
export const STUDIO_MAX_RUNS = 30;
/**
 * 记录占用的上限：服务端单个商品只收 1MB，模板套图每张都带职责文字，组数没到上限也可能先超；
 * 按字节再裁一次，给照片、档案、助手方案留出空间。
 */
export const STUDIO_RUNS_MAX_BYTES = 600 * 1024;

function jsonBytes(value: unknown) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** 用表单里的标题和卖点代替档案文案，复用镜头规格里按角色取文案的规则。 */
function copySource(product: StudioProduct): StudioProduct {
    const points = studioInfoPoints(studioInfoText(product));
    return {
        ...product,
        name: studioDisplayName(product),
        sellingPoints: points.map((point, index) => ({ id: `info_${index}`, title: point.title, detail: point.detail, evidence: "confirmed", factIds: [], enabled: true })),
        copy: { headline: studioTitleOf(product).trim(), subhead: product.copy?.subhead || "", listingTitle: product.copy?.listingTitle || "", bullets: product.copy?.bullets || [] },
    };
}

export function studioRunShotCopy(role: StudioShotRole, product: StudioProduct, single: boolean): Pick<StudioShot, "headline" | "subline" | "lines" | "sellingPointIds"> {
    const empty = { headline: "", subline: "", lines: [] as string[], sellingPointIds: [] as string[] };
    if (product.brief.language === "none" || studioPlatformForbidsText(product, role)) return empty;
    const source = copySource(product);
    const title = studioTitleOf(product).trim();
    if (single && role === "main-selling") {
        const first = source.sellingPoints[0];
        if (title) return { ...empty, headline: title, subline: first ? first.title : "" };
        return first ? { ...empty, headline: first.title, subline: first.detail } : empty;
    }
    if (single && title && (role === "detail-model" || role === "detail-angles")) return { ...empty, headline: title };
    return { ...studioShotCopy(role, source), sellingPointIds: [] };
}

/** 套图镜头清单里的一项。key 在一套里唯一：内置套图用镜头角色，模板套图用 s 加模板里的序号。 */
export type StudioSetEntry = { key: string; role: StudioShotRole; title: string; purpose: string; duty?: string; ratio?: string; noText?: boolean; included: boolean };

/** 套图按主图还是详情页出：模板套图看模板用途，单张类型返回 undefined。 */
export function studioSetKind(product: StudioProduct): StudioPlanKind | undefined {
    const spec = studioOutputSpec(product.brief.outputType);
    if (!spec.set) return undefined;
    return product.brief.outputType === "template-set" ? product.brief.suite?.kind || spec.set : spec.set;
}

function baseEntries(product: StudioProduct, kind: StudioPlanKind): Omit<StudioSetEntry, "included">[] {
    const family = product.dossier?.family || "generic";
    if (product.brief.outputType === "template-set") {
        const shots = product.brief.suite?.shots || [];
        return shots.map((shot, index) => {
            const role = studioSuiteShotRole(shot, kind, index, shots.length);
            const purpose = shot.duty.split("\n")[0] || studioShotSpec(role, family).purpose;
            return { key: `s${index}`, role, title: shot.title, purpose, ...(shot.duty ? { duty: shot.duty } : {}), ...(shot.ratio ? { ratio: shot.ratio } : {}), ...(shot.noText ? { noText: true } : {}) };
        });
    }
    return studioPlanRoles(kind, family).map((role) => {
        const spec = studioShotSpec(role, family);
        return { key: role, role, title: spec.title, purpose: spec.purpose };
    });
}

/** 当前表单下套图的镜头清单，按用户调整后的顺序；单张类型返回空数组。 */
export function studioSetEntries(product: StudioProduct): StudioSetEntry[] {
    const kind = studioSetKind(product);
    if (!kind) return [];
    const base = baseEntries(product, kind);
    const byKey = new Map(base.map((entry) => [entry.key, entry]));
    const keys = [...new Set([...product.brief.shotOrder.filter((key) => byKey.has(key)), ...base.map((entry) => entry.key)])];
    const skipped = new Set(product.brief.shotSkip);
    return keys.map((key) => ({ ...byKey.get(key)!, included: !skipped.has(key) }));
}

/** 把一张镜头上移或下移一位，返回新的表单参数。 */
export function moveStudioSetEntry(product: StudioProduct, key: string, delta: -1 | 1): StudioBrief {
    const keys = studioSetEntries(product).map((entry) => entry.key);
    const from = keys.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= keys.length) return product.brief;
    [keys[from], keys[to]] = [keys[to], keys[from]];
    return { ...product.brief, shotOrder: keys };
}

export function toggleStudioSetEntry(product: StudioProduct, key: string): StudioBrief {
    const skip = product.brief.shotSkip;
    return { ...product.brief, shotSkip: skip.includes(key) ? skip.filter((item) => item !== key) : [...skip, key] };
}

/** 镜头的画幅：用户选了比例或按参考图同款时照旧规则；否则模板写了画幅就按模板。 */
export function studioEntryRatio(entry: Pick<StudioSetEntry, "role" | "ratio">, product: StudioProduct) {
    return entry.ratio && product.brief.ratio === "auto" && !product.brief.sameLayout ? entry.ratio : studioRunRatio(entry.role, product);
}

const EMPTY_COPY = { headline: "", subline: "", lines: [] as string[], sellingPointIds: [] as string[] };

export function createStudioRun(product: StudioProduct, createId: StudioIdFactory, now = new Date().toISOString()): StudioRun {
    const brief = product.brief;
    const spec = studioOutputSpec(brief.outputType);
    const kind = studioSetKind(product);
    const base = { id: createId(), createdAt: now, type: spec.id, textMode: "model" as const, quality: brief.quality };
    if (kind) {
        if (brief.outputType === "template-set" && !brief.suite) throw new Error("先选择一套模板");
        const entries = studioSetEntries(product).filter((entry) => entry.included);
        if (!entries.length) throw new Error("镜头清单里至少留一张");
        return {
            ...base,
            kind,
            ...(brief.outputType === "template-set" && brief.suite ? { suite: { id: brief.suite.id, name: brief.suite.name, style: brief.suite.style } } : {}),
            shots: entries.map((entry) => ({
                id: createId(),
                role: entry.role,
                title: entry.title,
                ratio: studioEntryRatio(entry, product),
                ...(entry.noText ? EMPTY_COPY : studioRunShotCopy(entry.role, product, false)),
                ...(entry.duty ? { duty: entry.duty } : {}),
                tweaks: [],
                attempts: [],
            })),
        };
    }
    // 单张类型（含同时选了几种）：每种按数量出，每张都按单张图写文案。
    const types = studioSingleTypes(brief);
    if (!types.length) throw new Error("先选择出图类型");
    const count = Math.max(1, Math.min(4, brief.count));
    return {
        ...base,
        shots: types.flatMap((type) =>
            Array.from({ length: count }, (_, index) => {
                const role = type.role!;
                return {
                    id: createId(),
                    role,
                    title: count > 1 ? `${type.label} ${index + 1}` : type.label,
                    ratio: studioRunRatio(role, product),
                    ...studioRunShotCopy(role, product, true),
                    tweaks: [],
                    attempts: [],
                };
            }),
        ),
    };
}

/** 结果区里一组的标题：多种组合列出包含的类型，模板套图带上模板名。 */
export function studioRunTitle(run: Pick<StudioRun, "type" | "shots" | "suite">) {
    if (run.type === "mix") {
        const roles = new Set(run.shots.map((shot) => shot.role));
        const labels = STUDIO_SINGLE_TYPES.filter((item) => item.role && roles.has(item.role)).map((item) => item.label);
        if (labels.length) return labels.join(" · ");
    }
    const label = studioOutputSpec(run.type).label;
    return run.suite ? `${label} · ${run.suite.name}` : label;
}

function runActive(run: StudioRun) {
    return run.shots.some((shot) => shot.attempts.some(studioAttemptActive));
}

/** 新的一组放最前；组数或占用超出上限时从最旧的删起，还有任务在跑的记录不删。 */
export function appendStudioRun(product: StudioProduct, run: StudioRun): StudioProduct {
    if (product.runs.some((item) => item.id === run.id)) return product;
    const runs = [run, ...product.runs];
    for (let index = runs.length - 1; runs.length > STUDIO_MAX_RUNS && index > 0; index -= 1) {
        if (!runActive(runs[index])) runs.splice(index, 1);
    }
    let size = jsonBytes(runs);
    for (let index = runs.length - 1; size > STUDIO_RUNS_MAX_BYTES && index > 0; index -= 1) {
        if (runActive(runs[index])) continue;
        size -= jsonBytes(runs[index]);
        runs.splice(index, 1);
    }
    return { ...product, runs };
}

export function studioRunOf(product: StudioProduct, runId: string) {
    return product.runs.find((run) => run.id === runId);
}

export function patchStudioRunShot(product: StudioProduct, runId: string, shotId: string, patch: (shot: StudioShot) => StudioShot): StudioProduct {
    return { ...product, runs: product.runs.map((run) => (run.id !== runId ? run : { ...run, shots: run.shots.map((shot) => (shot.id === shotId ? patch(shot) : shot)) })) };
}

/** 同款版式只取第一张参考图；风格参考可以多张，受模型参考图上限约束。 */
export function studioStyleReferences(product: Pick<StudioProduct, "references" | "brief">, limit: number): StudioPhoto[] {
    if (limit <= 0) return [];
    return product.references.slice(0, product.brief.sameLayout ? 1 : limit);
}
