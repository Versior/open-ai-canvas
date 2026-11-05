import { ECOMMERCE_PLATFORMS, type EcommercePlatformId } from "@/lib/ecommerce/ecommerce-platform-specs";
import { createStudioBrief, normalizeStudioBrief, STUDIO_OUTPUT_TYPES } from "./brief";
import { STUDIO_STYLES } from "./shot-specs";
import { STUDIO_SUITE_LIMITS } from "./suites";
import {
    STUDIO_PRODUCT_SCHEMA,
    studioFactUsable,
    type StudioAttempt,
    type StudioAttemptStatus,
    type StudioCategoryFamily,
    type StudioDossier,
    type StudioEvidence,
    type StudioFact,
    type StudioFactGroup,
    type StudioGenerationRequest,
    type StudioOutput,
    type StudioOutputType,
    type StudioPhoto,
    type StudioPlan,
    type StudioPlanKind,
    type StudioProduct,
    type StudioRun,
    type StudioSellingPoint,
    type StudioShot,
    type StudioShotRole,
    type StudioStep,
    type StudioStyleId,
} from "./types";

const STEPS: StudioStep[] = ["dossier", "plan", "generate", "deliver"];
const VIEWS = new Set<string>(["front", "side", "back", "detail", "tag", "package", "scene", "other"]);
const STATUSES = new Set<string>(["submitting", "queued", "running", "succeeded", "failed", "cancelled"]);
const PLATFORM_IDS = new Set(ECOMMERCE_PLATFORMS.map((platform) => platform.id));
const STYLE_IDS = new Set(STUDIO_STYLES.map((style) => style.id));
const OUTPUT_IDS = new Set(STUDIO_OUTPUT_TYPES.map((item) => item.id));
const FAMILIES = new Set<string>(["apparel", "bags-shoes", "jewelry", "beauty", "food", "electronics", "home", "baby-toys", "generic"]);
const GROUPS = new Set<string>(["identity", "appearance", "material", "structure", "text", "spec", "usage", "package"]);
const EVIDENCE = new Set<string>(["visible", "inferred", "pending", "confirmed"]);
const ACTIVE: StudioAttemptStatus[] = ["submitting", "queued", "running"];

export function createStudioProduct(id: string, now = new Date().toISOString()): StudioProduct {
    return {
        schema: STUDIO_PRODUCT_SCHEMA,
        id,
        revision: 0,
        name: "",
        createdAt: now,
        updatedAt: now,
        platform: "taobao",
        style: "mist",
        step: "dossier",
        sellerNotes: "",
        photos: [],
        references: [],
        brief: createStudioBrief(),
        sellingPoints: [],
        plans: [],
        activePlan: "main",
        runs: [],
    };
}

export function studioPlanOf(product: StudioProduct, kind: StudioPlanKind) {
    return product.plans.find((plan) => plan.kind === kind);
}

export function studioUsablePoints(product: StudioProduct) {
    return product.sellingPoints.filter((point) => point.enabled && (point.evidence === "visible" || point.evidence === "confirmed"));
}

function pointLine(point: StudioSellingPoint) {
    return point.detail.trim() ? `${point.title.trim()}｜${point.detail.trim()}` : point.title.trim();
}

function factsOf(product: StudioProduct, predicate: (fact: StudioFact) => boolean) {
    return (product.dossier?.facts || []).filter((fact) => studioFactUsable(fact) && predicate(fact));
}

const SIZE_LABEL = /尺寸|尺码|长|宽|高|厚|直径|口径|容量|重量|规格/;

/** 按镜头角色从档案里取文案。只用已启用、证据可用的卖点；栏目名是排版标签，不是商品宣称。 */
export function studioShotCopy(role: StudioShotRole, product: StudioProduct): Pick<StudioShot, "headline" | "subline" | "lines" | "sellingPointIds"> {
    const points = studioUsablePoints(product);
    const copy = product.copy;
    const name = product.dossier?.name || product.name;
    const empty = { headline: "", subline: "", lines: [] as string[], sellingPointIds: [] as string[] };
    const fromPoint = (point?: StudioSellingPoint) => (point ? { ...empty, headline: point.title, subline: point.detail, sellingPointIds: [point.id] } : empty);
    switch (role) {
        case "main-selling":
            return fromPoint(points[0]);
        case "detail-hero":
            return { ...empty, headline: copy?.headline || name, subline: copy?.subhead || "" };
        case "detail-selling":
            return { ...empty, headline: "核心卖点", lines: points.slice(0, 3).map(pointLine), sellingPointIds: points.slice(0, 3).map((point) => point.id) };
        case "detail-scene":
            return fromPoint(points[1] || points[0]);
        case "detail-closeup":
            return fromPoint(points[2] || points[0]);
        case "detail-material": {
            const material = factsOf(product, (fact) => fact.group === "material")[0];
            return { ...empty, headline: material ? material.value : "", subline: material?.label ? `${material.label}` : "" };
        }
        case "detail-angles":
            return { ...empty, headline: "多角度展示" };
        case "detail-spec":
            return {
                ...empty,
                headline: "产品参数",
                lines: factsOf(product, (fact) => fact.group === "spec" || fact.group === "material")
                    .slice(0, 6)
                    .map((fact) => `${fact.label}｜${fact.value}`),
            };
        case "detail-size": {
            const sizes = factsOf(product, (fact) => SIZE_LABEL.test(fact.label));
            return { ...empty, headline: product.dossier?.family === "apparel" ? "尺码参考" : "尺寸参考", subline: sizes.map((fact) => `${fact.label} ${fact.value}`).join(" · ") };
        }
        case "detail-package":
            return {
                ...empty,
                headline: "包装与配件",
                subline: factsOf(product, (fact) => fact.group === "package")
                    .map((fact) => fact.value)
                    .join("、"),
            };
        case "detail-closing":
            return { ...empty, headline: name, subline: copy?.subhead || "", lines: points.slice(0, 3).map((point) => point.title), sellingPointIds: points.slice(0, 3).map((point) => point.id) };
        default:
            return empty;
    }
}

/** 改一张镜头卡：方案按种类定位，其余方案和镜头原样保留。 */
export function patchStudioShot(product: StudioProduct, kind: StudioPlanKind, shotId: string, patch: (shot: StudioShot) => StudioShot): StudioProduct {
    return { ...product, plans: product.plans.map((plan) => (plan.kind !== kind ? plan : { ...plan, shots: plan.shots.map((shot) => (shot.id === shotId ? patch(shot) : shot)) })) };
}

export function studioAttemptActive(attempt: Pick<StudioAttempt, "status">) {
    return ACTIVE.includes(attempt.status);
}

export function studioShotLatestAttempt(shot: StudioShot) {
    return shot.attempts[shot.attempts.length - 1];
}

/** 这张图当前展示的成品：已采用的优先，其次是最近一次成功的结果。 */
export function studioShotPreview(shot: StudioShot): StudioOutput | undefined {
    if (shot.adopted) return shot.adopted;
    for (let index = shot.attempts.length - 1; index >= 0; index -= 1) {
        const output = shot.attempts[index].outputs[0];
        if (shot.attempts[index].status === "succeeded" && output) return output;
    }
    return undefined;
}

export function studioShotOutputs(shot: StudioShot) {
    return shot.attempts.flatMap((attempt) => (attempt.status === "succeeded" ? attempt.outputs : []));
}

/** 商品封面：优先用商品照片，没有照片时用最近出的一张图。返回资源 ID。 */
export function studioProductCover(product: StudioProduct) {
    const photo = product.photos.find((item) => item.truth) || product.photos[0];
    if (photo) return photo.resourceId;
    for (const group of [...product.runs, ...product.plans]) {
        for (const shot of group.shots) {
            const preview = studioShotPreview(shot);
            if (preview) return preview.resourceId;
        }
    }
    return undefined;
}

/** 出过的图总数（表单记录和助手方案都算）。 */
export function studioOutputCount(product: StudioProduct) {
    return [...product.runs, ...product.plans].reduce((sum, group) => sum + group.shots.reduce((count, shot) => count + studioShotOutputs(shot).length, 0), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOf<T>(value: unknown, map: (item: Record<string, unknown>) => T | undefined): T[] {
    return Array.isArray(value) ? value.map((item) => (isRecord(item) ? map(item) : undefined)).filter((item): item is T => item !== undefined) : [];
}

function str(value: unknown, fallback = "") {
    return typeof value === "string" ? value : fallback;
}

function strings(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeOutput(item: Record<string, unknown>): StudioOutput | undefined {
    return typeof item.resourceId === "string" && typeof item.url === "string" ? { resourceId: item.resourceId, url: item.url, width: Number(item.width) || undefined, height: Number(item.height) || undefined } : undefined;
}

function normalizePhoto(item: Record<string, unknown>, fallbackTime: string, truthDefault: boolean): StudioPhoto | undefined {
    if (typeof item.resourceId !== "string" || typeof item.url !== "string" || typeof item.id !== "string") return undefined;
    return {
        id: item.id,
        resourceId: item.resourceId,
        url: item.url,
        view: (VIEWS.has(str(item.view)) ? item.view : "other") as StudioPhoto["view"],
        truth: truthDefault ? item.truth !== false : false,
        name: str(item.name) || undefined,
        width: Number(item.width) || undefined,
        height: Number(item.height) || undefined,
        addedAt: str(item.addedAt, fallbackTime),
    };
}

function normalizeAttempt(attempt: Record<string, unknown>, fallbackTime: string): StudioAttempt | undefined {
    if (typeof attempt.id !== "string") return undefined;
    return {
        id: attempt.id,
        taskId: typeof attempt.taskId === "string" ? attempt.taskId : undefined,
        status: (STATUSES.has(str(attempt.status)) ? attempt.status : "failed") as StudioAttemptStatus,
        model: str(attempt.model),
        tweaks: strings(attempt.tweaks),
        createdAt: str(attempt.createdAt, fallbackTime),
        completedAt: typeof attempt.completedAt === "string" ? attempt.completedAt : undefined,
        error: typeof attempt.error === "string" ? attempt.error : undefined,
        outputs: arrayOf(attempt.outputs, normalizeOutput),
    };
}

function normalizeShot(shot: Record<string, unknown>, fallbackTime: string): StudioShot | undefined {
    if (typeof shot.id !== "string" || typeof shot.role !== "string") return undefined;
    return {
        id: shot.id,
        role: shot.role as StudioShotRole,
        title: str(shot.title),
        ratio: str(shot.ratio, "1:1"),
        headline: str(shot.headline),
        subline: str(shot.subline),
        lines: strings(shot.lines),
        sellingPointIds: strings(shot.sellingPointIds),
        tweaks: strings(shot.tweaks),
        ...(typeof shot.duty === "string" && shot.duty.trim() ? { duty: shot.duty.slice(0, STUDIO_SUITE_LIMITS.duty) } : {}),
        attempts: arrayOf(shot.attempts, (attempt) => normalizeAttempt(attempt, fallbackTime)),
        adopted: isRecord(shot.adopted) ? normalizeOutput(shot.adopted) : undefined,
    };
}

function normalizeRun(run: Record<string, unknown>, fallbackTime: string): StudioRun | undefined {
    if (typeof run.id !== "string" || !OUTPUT_IDS.has(run.type as StudioOutputType)) return undefined;
    const shots = arrayOf(run.shots, (shot) => normalizeShot(shot, fallbackTime));
    if (!shots.length) return undefined;
    return {
        id: run.id,
        createdAt: str(run.createdAt, fallbackTime),
        type: run.type as StudioOutputType,
        ...(run.kind === "main" || run.kind === "detail" ? { kind: run.kind } : {}),
        textMode: run.textMode === "overlay" ? "overlay" : "model",
        quality: str(run.quality),
        ...(isRecord(run.suite) && typeof run.suite.id === "string" && typeof run.suite.name === "string"
            ? { suite: { id: run.suite.id, name: run.suite.name.slice(0, STUDIO_SUITE_LIMITS.name), style: str(run.suite.style).slice(0, STUDIO_SUITE_LIMITS.style) } }
            : {}),
        shots,
    };
}

/** 档案可能来自助手或旧版本数据：数组字段一律补齐，避免界面读到 null 直接报错。 */
function normalizeDossier(value: unknown): StudioDossier | undefined {
    if (!isRecord(value)) return undefined;
    return {
        name: str(value.name),
        category: str(value.category),
        family: (FAMILIES.has(str(value.family)) ? value.family : "generic") as StudioCategoryFamily,
        summary: str(value.summary),
        facts: arrayOf(value.facts, (fact): StudioFact | undefined =>
            typeof fact.id === "string"
                ? {
                      id: fact.id,
                      group: (GROUPS.has(str(fact.group)) ? fact.group : "appearance") as StudioFactGroup,
                      label: str(fact.label),
                      value: str(fact.value),
                      evidence: (EVIDENCE.has(str(fact.evidence)) ? fact.evidence : "pending") as StudioEvidence,
                      ...(typeof fact.source === "string" && fact.source ? { source: fact.source } : {}),
                  }
                : undefined,
        ),
        invariants: strings(value.invariants),
        questions: strings(value.questions),
        ...(typeof value.recognizedAt === "string" ? { recognizedAt: value.recognizedAt } : {}),
        ...(typeof value.recognizedWith === "string" ? { recognizedWith: value.recognizedWith } : {}),
    };
}

function normalizeSellingPoint(point: Record<string, unknown>): StudioSellingPoint | undefined {
    if (typeof point.id !== "string" || typeof point.title !== "string") return undefined;
    return {
        id: point.id,
        title: point.title,
        detail: str(point.detail),
        evidence: (EVIDENCE.has(str(point.evidence)) ? point.evidence : "pending") as StudioEvidence,
        factIds: strings(point.factIds),
        enabled: point.enabled === true,
    };
}

/** 服务端只保证是 JSON 对象；读取时补齐缺省字段，丢掉无法识别的记录，避免一条坏数据拖垮整个页面。 */
export function normalizeStudioProduct(value: unknown): StudioProduct | undefined {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id) return undefined;
    const base = createStudioProduct(value.id, str(value.createdAt, new Date(0).toISOString()));
    const time = base.createdAt;
    const platform = PLATFORM_IDS.has(value.platform as EcommercePlatformId) ? (value.platform as EcommercePlatformId) : base.platform;
    const style = STYLE_IDS.has(value.style as StudioStyleId) ? (value.style as StudioStyleId) : base.style;
    return {
        ...base,
        name: str(value.name),
        updatedAt: str(value.updatedAt, time),
        platform,
        style,
        step: STEPS.includes(value.step as StudioStep) ? (value.step as StudioStep) : base.step,
        sellerNotes: str(value.sellerNotes),
        photos: arrayOf(value.photos, (item) => normalizePhoto(item, time, true)),
        references: arrayOf(value.references, (item) => normalizePhoto(item, time, false)),
        brief: normalizeStudioBrief(value.brief),
        dossier: normalizeDossier(value.dossier),
        sellingPoints: arrayOf(value.sellingPoints, normalizeSellingPoint),
        copy: isRecord(value.copy)
            ? {
                  headline: str(value.copy.headline),
                  subhead: str(value.copy.subhead),
                  listingTitle: str(value.copy.listingTitle),
                  bullets: strings(value.copy.bullets),
              }
            : undefined,
        plans: arrayOf(value.plans, (plan): StudioPlan | undefined =>
            typeof plan.id === "string" && (plan.kind === "main" || plan.kind === "detail")
                ? {
                      id: plan.id,
                      kind: plan.kind,
                      createdAt: str(plan.createdAt, time),
                      textMode: plan.textMode === "overlay" ? "overlay" : "model",
                      shots: arrayOf(plan.shots, (shot) => normalizeShot(shot, time)),
                  }
                : undefined,
        ),
        activePlan: value.activePlan === "detail" ? "detail" : "main",
        runs: arrayOf(value.runs, (run) => normalizeRun(run, time)),
        revision: Number.isInteger(value.revision) && Number(value.revision) > 0 ? Number(value.revision) : 0,
        pendingGeneration: normalizeGenerationRequest(value.pendingGeneration),
    };
}

function normalizeGenerationRequest(value: unknown): StudioGenerationRequest | undefined {
    if (!isRecord(value) || typeof value.id !== "string" || (value.kind !== "main" && value.kind !== "detail") || !Array.isArray(value.shotIds)) return undefined;
    const shotIds = value.shotIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!shotIds.length) return undefined;
    return { id: value.id, kind: value.kind, shotIds, note: typeof value.note === "string" && value.note ? value.note : undefined, source: "agent", createdAt: str(value.createdAt) };
}
