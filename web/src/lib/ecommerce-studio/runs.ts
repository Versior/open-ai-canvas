import { studioDisplayName, studioInfoPoints, studioInfoText, studioOutputSpec, studioPlatformForbidsText, studioRunRatio, studioTitleOf } from "./brief";
import { studioAttemptActive, studioShotCopy } from "./product";
import { studioPlanRoles, studioShotSpec } from "./shot-specs";
import type { StudioPhoto, StudioProduct, StudioRun, StudioShot, StudioShotRole } from "./types";

/**
 * 表单生成的记录：点一次「生成商品图」就是一组镜头。
 * 数量、比例和文案在点生成那一刻定下来，之后改表单不影响已经排好的这一组。
 */
export type StudioIdFactory = () => string;

/** 保留的组数：超出后删掉最早一组（图片仍在素材库和任务中心）。 */
export const STUDIO_MAX_RUNS = 30;

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

export function createStudioRun(product: StudioProduct, createId: StudioIdFactory, now = new Date().toISOString()): StudioRun {
    const brief = product.brief;
    const spec = studioOutputSpec(brief.outputType);
    const family = product.dossier?.family || "generic";
    const single = !spec.set;
    const roles: StudioShotRole[] = spec.set ? studioPlanRoles(spec.set, family) : Array.from({ length: Math.max(1, Math.min(4, brief.count)) }, () => spec.role || "main-selling");
    return {
        id: createId(),
        createdAt: now,
        type: spec.id,
        ...(spec.set ? { kind: spec.set } : {}),
        textMode: "model",
        quality: brief.quality,
        shots: roles.map((role, index) => ({
            id: createId(),
            role,
            title: single ? (roles.length > 1 ? `${spec.label} ${index + 1}` : spec.label) : studioShotSpec(role, family).title,
            ratio: studioRunRatio(role, product),
            ...studioRunShotCopy(role, product, single),
            tweaks: [],
            attempts: [],
        })),
    };
}

function runActive(run: StudioRun) {
    return run.shots.some((shot) => shot.attempts.some(studioAttemptActive));
}

/** 新的一组放最前；超出上限时从最旧的删起，还有任务在跑的记录不删。 */
export function appendStudioRun(product: StudioProduct, run: StudioRun): StudioProduct {
    if (product.runs.some((item) => item.id === run.id)) return product;
    const runs = [run, ...product.runs];
    for (let index = runs.length - 1; runs.length > STUDIO_MAX_RUNS && index > 0; index -= 1) {
        if (!runActive(runs[index])) runs.splice(index, 1);
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
