import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceAnalysisGeneration } from "@/lib/ecommerce/ecommerce-analysis-generation";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioCleanNotes, studioPointLine, studioProductTypeOf, studioTitleOf } from "@/lib/ecommerce-studio/brief";
import { STUDIO_DETAIL_PLAN_CAPABILITY, STUDIO_PLAN_FIELD, studioDetailPlanRoles, studioTemplatePlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, studioPlanTargetRoles, type StudioDetailPlanResult, type StudioPlanRequest } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { mergeStudioDossier } from "@/lib/ecommerce-studio/dossier-review";
import { buildFillPrompt, parseFill, studioAnalysisMetadata, type StudioFillResult } from "@/lib/ecommerce-studio/dossier-tasks";
import { buildAskPrompt, buildDirectionsPrompt, parseAsks, parseDirections } from "@/lib/ecommerce-studio/plan-prep-tasks";
import { studioImageRequest } from "@/lib/ecommerce-studio/image-options";
import { compileStudioPrompt, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { patchStudioShot, studioAttemptActive, studioPlanOf, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, patchStudioRunShot, studioActivePlan, studioPlanScopeOf, studioRunOf, studioSingleTargets } from "@/lib/ecommerce-studio/runs";
import {
    studioFactUsable,
    type StudioAsk,
    type StudioAttempt,
    type StudioAttemptStatus,
    type StudioDirection,
    type StudioOutput,
    type StudioPhoto,
    type StudioPlanKind,
    type StudioProduct,
    type StudioRun,
    type StudioShot,
    type StudioTextMode,
} from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { getActiveUserScope } from "@/lib/user-scope";
import { ApiError } from "@/services/api/request";
import { runBackendGenerationTask, submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { isGenerationTaskTerminalError, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import { workbenchTaskOutputs } from "@/pages/workbench/workbench-batches";
import { useStudioStore } from "./use-studio-store";

/**
 * 生图台的任务运行时：识别填表、按镜头出图。全部走后端统一任务（计费、取消、记录一致），
 * 页面只负责提交和监听；离开页面不取消已提交的任务，回来时按任务 ID 接着同步。
 *
 * 提交排队：同时进行的任务不超过账号并发与 4 个，空出名额再提交下一张，避免后端按并发上限拒绝。
 */
const MAX_PARALLEL = 4;
const MAX_ATTEMPTS = 8;

/** 镜头在哪：表单记录（runId）或助手方案（planKind）。 */
export type StudioShotRef = { runId: string } | { planKind: StudioPlanKind };

// 跨组件实例共享：同一次尝试不会被挂上两个监听，也不会被误判为中断。
const watching = new Set<string>();
const submitting = new Set<string>();
const uncertain = new Set<string>();
const waiting = new Map<string, { productId: string; ref: StudioShotRef; shotId: string }>();
const jobs: { attemptId: string; owner: symbol; run: () => Promise<void> }[] = [];

function concurrency() {
    const limit = useUserStore.getState().runtimeLimits.activeTaskLimit;
    return Math.max(1, Math.min(MAX_PARALLEL, limit || MAX_PARALLEL));
}

// 创建任务的请求一个接一个发：并发创建会让 SQLite 部署报 database is locked，任务本身照样并行生成。
let submitChain: Promise<unknown> = Promise.resolve();
function serializeSubmit<T>(run: () => Promise<T>): Promise<T> {
    const next = submitChain.then(run, run);
    submitChain = next.catch(() => undefined);
    return next;
}

function pump() {
    while (jobs.length && watching.size + submitting.size + uncertain.size < concurrency()) {
        const job = jobs.shift()!;
        void job
            .run()
            .catch(() => undefined)
            .finally(pump);
    }
}

/** fill：识别商品自动填写；ask：策划前问卖家几个问题；directions：给几个视角方案；plan：按商品策划。 */
export type StudioAnalysisKind = "fill" | "ask" | "directions" | "plan";

const ANALYSIS_BUSY: Record<StudioAnalysisKind, string> = {
    fill: "这个商品正在识别，请等它完成",
    ask: "这个商品正在生成问题，请等它完成",
    directions: "这个商品正在生成视角方案，请等它完成",
    plan: "这个商品正在策划，请等它完成",
};

/** 正在进行的识别或策划，按商品记录；切换商品再回来也能看到进度。 */
export const useStudioAnalysis = create<{ running: Record<string, StudioAnalysisKind | undefined> }>(() => ({ running: {} }));

async function trackAnalysis<T>(productId: string, kind: StudioAnalysisKind, run: () => Promise<T>) {
    const running = useStudioAnalysis.getState().running[productId];
    if (running) throw new Error(ANALYSIS_BUSY[running]);
    useStudioAnalysis.setState((state) => ({ running: { ...state.running, [productId]: kind } }));
    try {
        return await run();
    } finally {
        useStudioAnalysis.setState((state) => ({ running: { ...state.running, [productId]: undefined } }));
    }
}

function photoReference(photo: StudioPhoto): ReferenceImage {
    return { id: photo.id, name: photo.name || `${photo.view}.png`, type: "image/png", dataUrl: "", storageKey: resourceStorageKey(photo.resourceId), ...(photo.width ? { width: photo.width } : {}), ...(photo.height ? { height: photo.height } : {}) };
}

/** 商品档案里能用的材质、外观和结构，给服务端挑布光方法；没有时为空。 */
function studioPlanMaterials(product: StudioProduct) {
    return (product.dossier?.facts || [])
        .filter((fact) => ["material", "appearance", "structure"].includes(fact.group) && studioFactUsable(fact))
        .map((fact) => `${fact.label} ${fact.value}`)
        .join("；")
        .slice(0, 200);
}

function inputSummary(imageCount: number) {
    return { textCount: 0, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 };
}

type ModelConfigInput = Parameters<typeof buildEcommerceAnalysisGeneration>[0];

/**
 * 策划类任务随附的图：商品图让模型看清外观，最多两张；卖家上传的参考图（大牌或爆款截图）再带最多两张，让策划学它的设计语言。
 * 参考图至少给商品图留一个名额；模型不收图时只按表单和档案的文字。
 */
function planImages(product: StudioProduct, current: ModelConfigInput, textModel: string, withReferences = true) {
    const draft = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(0));
    const budget = Math.min(4, modelCapabilityConfigFor(current, draft.model).text?.references.maxImages ?? 2);
    const uploaded = withReferences ? product.references.filter((photo) => photo.resourceId) : [];
    const referenceCount = Math.min(2, uploaded.length, Math.max(0, budget - 1));
    const photos = budget > 0 ? studioReferencePhotos(product.photos, Math.min(2, budget - referenceCount)) : [];
    const references = uploaded.slice(0, referenceCount);
    return { photos, references, images: [...photos, ...references] };
}

/** 策划类任务给服务端的知识检索提示：策划范围（模板套图按模板用途）、单张类型、品类大类和材质。 */
function planKnowledgeMetadata(product: StudioProduct) {
    const scope = studioPlanScopeOf(product);
    const suite = scope === "template" ? product.brief.suite : undefined;
    const targets = scope === "single" ? studioSingleTargets(product.brief) : undefined;
    return {
        studioPlanKind: suite ? suite.kind : scope || "detail",
        ...(targets?.length ? { studioPlanTargets: targets.map((target) => target.type).join(",") } : {}),
        ...(product.dossier?.family && product.dossier.family !== "generic" ? { studioFamily: product.dossier.family } : {}),
        ...(studioPlanMaterials(product) ? { studioMaterials: studioPlanMaterials(product) } : {}),
    };
}

function knowledgeContext(product: StudioProduct) {
    return { platform: product.platform, category: studioProductTypeOf(product) || product.dossier?.category, productName: studioTitleOf(product) || product.name };
}

function taskOutputs(task: GenerationTask): StudioOutput[] {
    return workbenchTaskOutputs(task, "image")
        .filter((output) => output.resourceId)
        .map((output) => ({ resourceId: output.resourceId!, url: `/api/resources/${output.resourceId}/file`, ...(output.width ? { width: output.width } : {}), ...(output.height ? { height: output.height } : {}) }));
}

export type StudioLocatedShot = { shot: StudioShot; textMode: StudioTextMode; quality: string; resolution: string; fromForm: boolean; suite?: StudioRun["suite"] };

export function locateStudioShot(product: StudioProduct, ref: StudioShotRef, shotId: string): StudioLocatedShot | undefined {
    if ("runId" in ref) {
        const run = studioRunOf(product, ref.runId);
        const shot = run?.shots.find((item) => item.id === shotId);
        return run && shot ? { shot, textMode: run.textMode, quality: run.quality, resolution: run.resolution || "", fromForm: true, suite: run.suite } : undefined;
    }
    const plan = studioPlanOf(product, ref.planKind);
    const shot = plan?.shots.find((item) => item.id === shotId);
    return plan && shot ? { shot, textMode: plan.textMode, quality: product.brief.quality, resolution: product.brief.resolution, fromForm: false } : undefined;
}

type ModelConfig = Parameters<typeof modelCapabilityConfigFor>[0];

/**
 * 按出图时的规则编译这张图的提示词，提交任务和「查看提示词」共用。
 * 助手方案的镜头由助手定好构图：只带市场、语言、人群和补充要求，不套表单里的拍法和同款版式。
 */
export function compileStudioShot(product: StudioProduct, located: StudioLocatedShot, imageModel: string, config: ModelConfig) {
    const profile = modelCapabilityConfigFor(config, imageModel).image;
    const brief = located.fromForm ? product.brief : { ...product.brief, shooting: "auto" as const, sameLayout: false };
    const compiled = compileStudioPrompt({
        product,
        textMode: located.textMode,
        shot: located.shot,
        model: imageModel,
        maxChars: profile?.references.promptMaxChars,
        maxReferences: profile?.references.maxImages || undefined,
        brief,
        ...(located.suite ? { suite: located.suite } : {}),
    });
    return { profile, compiled };
}

export function patchStudioShotAt(product: StudioProduct, ref: StudioShotRef, shotId: string, patch: (shot: StudioShot) => StudioShot) {
    return "runId" in ref ? patchStudioRunShot(product, ref.runId, shotId, patch) : patchStudioShot(product, ref.planKind, shotId, patch);
}

function patchAttempt(product: StudioProduct, ref: StudioShotRef, shotId: string, attemptId: string, patch: Partial<StudioAttempt>) {
    return patchStudioShotAt(product, ref, shotId, (shot) => ({ ...shot, attempts: shot.attempts.map((attempt) => (attempt.id === attemptId ? { ...attempt, ...patch } : attempt)) }));
}

export function useStudioRunner() {
    const userId = useUserStore((state) => state.user?.id);
    const scope = userId || getActiveUserScope();
    const owner = useRef(Symbol("studio-runner"));
    const ownedAttempts = useRef(new Set<string>());
    const config = useEffectiveConfig();
    const configRef = useRef(config);
    configRef.current = config;
    const storeUpdate = useStudioStore((state) => state.update);
    const update = useCallback<typeof storeUpdate>(
        (...args) => {
            if (getActiveUserScope() !== scope) return undefined;
            return storeUpdate(...args);
        },
        [scope, storeUpdate],
    );
    const controllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        const active = controllers.current;
        return () => {
            for (const controller of active.values()) controller.abort();
            active.clear();
            // 离开页面时还没提交的镜头不再提交，标成失败，回来后可以一键重试。
            const dropped = jobs.filter((job) => job.owner === owner.current);
            for (let index = jobs.length - 1; index >= 0; index--) if (jobs[index].owner === owner.current) jobs.splice(index, 1);
            for (const job of dropped) {
                const entry = waiting.get(job.attemptId);
                waiting.delete(job.attemptId);
                if (entry) update(entry.productId, (product) => patchAttempt(product, entry.ref, entry.shotId, job.attemptId, { status: "failed", error: "离开页面时还没提交，点重试再生成", completedAt: new Date().toISOString() }), { immediate: true });
            }
            for (const id of ownedAttempts.current) uncertain.delete(id);
            ownedAttempts.current.clear();
        };
    }, [scope, update]);

    const read = useCallback(
        (productId: string) => {
            if (getActiveUserScope() !== scope || useStudioStore.getState().scope !== scope) throw new DOMException("账号已切换", "AbortError");
            const product = useStudioStore.getState().products.find((item) => item.id === productId);
            if (!product) throw new Error("商品不存在或已被删除");
            return product;
        },
        [scope],
    );

    /** 看图识别并填表：建档、品牌、类型、主标题和卖点一次写好。已经填过的字段不覆盖，档案里卖家确认过的信息保留。 */
    const fill = useCallback(
        (productId: string, textModel: string) =>
            trackAnalysis(productId, "fill", async (): Promise<StudioFillResult & { info: string; infoKept: boolean; openQuestions: number; unsureFacts: number }> => {
                const product = read(productId);
                if (!product.photos.length) throw new Error("请先上传至少一张商品图");
                const current = configRef.current;
                const draft = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(1));
                const maxImages = Math.max(1, modelCapabilityConfigFor(current, draft.model).text?.references.maxImages || product.photos.length);
                const photos = product.photos.slice(0, maxImages);
                const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(photos.length));
                const prompt = buildFillPrompt({
                    photos,
                    platformName: ecommercePlatform(product.platform)?.name || "电商平台",
                    sellerNotes: studioCleanNotes(product.sellerNotes),
                    brand: studioBrandOf(product),
                    productType: studioProductTypeOf(product),
                    title: studioTitleOf(product),
                });
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt,
                    config: generation,
                    referenceImages: photos.map(photoReference),
                    streamText: false,
                    metadata: studioAnalysisMetadata(productId, "recognize", { platform: product.platform, category: studioProductTypeOf(product) || product.dossier?.category, productName: studioTitleOf(product) || product.name }),
                    onTaskUpdate: (task) => update(productId, (value) => ({ ...value, lastAnalysisTaskId: task.id }), { immediate: true }),
                });
                const parsed = parseFill(result.text || "", () => nanoid(10), generation.model);
                const info = parsed.sellingPoints
                    .filter((point) => point.enabled)
                    .map(studioPointLine)
                    .join("\n");
                let infoKept = false;
                let openQuestions = parsed.dossier.questions.length;
                let unsureFacts = 0;
                update(
                    productId,
                    (value) => {
                        // 只填空着的字段：用户已经写过的内容不被识别结果覆盖。
                        infoKept = Boolean(value.sellerNotes.trim()) && Boolean(info);
                        const dossier = mergeStudioDossier(value.dossier, parsed.dossier);
                        openQuestions = dossier.questions.length;
                        unsureFacts = dossier.facts.filter((fact) => !studioFactUsable(fact)).length;
                        return {
                            ...value,
                            name: value.name || parsed.dossier.name,
                            dossier,
                            sellingPoints: parsed.sellingPoints,
                            sellerNotes: value.sellerNotes.trim() ? value.sellerNotes : info,
                            brief: { ...value.brief, brand: value.brief.brand || parsed.brand, productType: value.brief.productType || parsed.dossier.category },
                            copy: { headline: value.copy?.headline || parsed.title, subhead: value.copy?.subhead || "", listingTitle: value.copy?.listingTitle || "", bullets: value.copy?.bullets || [] },
                        };
                    },
                    { immediate: true },
                );
                return { ...parsed, info, infoKept, openQuestions, unsureFacts };
            }),
        [read, update],
    );

    /**
     * 按这件商品策划当前出图类型（详情页、主图套图、选中的单张图或选中的模板）：服务端按「出图策划」能力和策划范围
     * 带上电商知识库的对应方法，模型看商品图和表单信息排每一张。结果存进表单对应的策划，镜头清单换成策划的屏，
     * 原来的勾选和顺序清掉。revise 时带上这一版策划，按补充调整修改。
     */
    const plan = useCallback(
        (productId: string, textModel: string, options: { revise?: boolean } = {}) =>
            trackAnalysis(productId, "plan", async (): Promise<StudioDetailPlanResult> => {
                const product = read(productId);
                const planScope = studioPlanScopeOf(product);
                if (!planScope) throw new Error("先选择一套模板，再按模板策划");
                const suite = planScope === "template" ? product.brief.suite : undefined;
                const targets = planScope === "single" ? studioSingleTargets(product.brief) : undefined;
                const current = configRef.current;
                const { photos, references, images } = planImages(product, current, textModel);
                const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(images.length));
                // 「按调整重新策划」带上这一版，模型只改卖家不满意的地方。
                const request: StudioPlanRequest = {
                    scope: planScope,
                    ...(targets ? { targets } : {}),
                    ...(options.revise ? { previous: studioActivePlan(product) } : {}),
                    ...(!options.revise ? { alternative: studioActivePlan(product) } : {}),
                    ...(images.length ? { images: { photos: photos.length, references: references.length } } : {}),
                };
                const roles = planScope === "single" ? studioPlanTargetRoles(targets || []) : suite ? studioTemplatePlanRoles(product, suite) : studioDetailPlanRoles(product, planScope === "main" ? "main" : "detail");
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt: buildDetailPlanPrompt(product, roles, request),
                    config: generation,
                    referenceImages: images.map(photoReference),
                    streamText: false,
                    // 服务端按策划范围取知识：主图取主图规范，详情页取详情页叙事，模板套图按模板用途取，单张图按选中的类型带打法；
                    // 品类大类用来在同类爆款套图对不上时取同大类的参考，档案里的材质用来挑布光方法。
                    metadata: { ...studioAnalysisMetadata(productId, "plan", knowledgeContext(product), STUDIO_DETAIL_PLAN_CAPABILITY), ...planKnowledgeMetadata(product) },
                    onTaskUpdate: (task) => update(productId, (value) => ({ ...value, lastAnalysisTaskId: task.id }), { immediate: true }),
                });
                const parsed = parseDetailPlan(result.text || "", product, roles, { id: nanoid(10), model: generation.model, createdAt: new Date().toISOString() }, request);
                const field = STUDIO_PLAN_FIELD[planScope];
                update(productId, (value) => ({ ...value, brief: { ...value.brief, [field]: parsed.plan, shotOrder: [], shotSkip: [] } }), { immediate: true });
                return parsed;
            }),
        [read, update],
    );

    /**
     * 策划前问卖家几个问题：按商品档案和表单里已有的信息，问只有卖家知道的卖点、人群、场景和想要的感觉。
     * 结果替换原来的问题（卖家已经答过的同一个问题保留答案），视角方案按新的答案重新给。
     */
    const ask = useCallback(
        (productId: string, textModel: string) =>
            trackAnalysis(productId, "ask", async (): Promise<StudioAsk[]> => {
                const product = read(productId);
                const current = configRef.current;
                const { images } = planImages(product, current, textModel, false);
                const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(images.length));
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt: buildAskPrompt(product),
                    config: generation,
                    referenceImages: images.map(photoReference),
                    streamText: false,
                    metadata: studioAnalysisMetadata(productId, "ask", knowledgeContext(product)),
                    onTaskUpdate: (task) => update(productId, (value) => ({ ...value, lastAnalysisTaskId: task.id }), { immediate: true }),
                });
                const asks = parseAsks(result.text || "", () => nanoid(10));
                update(
                    productId,
                    (value) => {
                        const previous = new Map((value.brief.prep?.asks || []).map((item) => [item.question, item]));
                        const merged = asks.map((item) => {
                            const old = previous.get(item.question);
                            return old ? { ...item, picked: old.picked.filter((option) => item.options.includes(option)), note: old.note } : item;
                        });
                        return { ...value, brief: { ...value.brief, prep: { directions: [], ...value.brief.prep, asks: merged, askedAt: new Date().toISOString() } } };
                    },
                    { immediate: true },
                );
                return asks;
            }),
        [read, update],
    );

    /** 给 3 个视角方案：带上卖家补充、电商知识库和同类爆款套图；新的一批替换原来的，原来挑的方向清掉。 */
    const directions = useCallback(
        (productId: string, textModel: string) =>
            trackAnalysis(productId, "directions", async (): Promise<StudioDirection[]> => {
                const product = read(productId);
                const current = configRef.current;
                const { photos, references, images } = planImages(product, current, textModel);
                const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(images.length));
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt: buildDirectionsPrompt(product, studioPlanScopeOf(product), images.length ? { photos: photos.length, references: references.length } : undefined),
                    config: generation,
                    referenceImages: images.map(photoReference),
                    streamText: false,
                    metadata: { ...studioAnalysisMetadata(productId, "directions", knowledgeContext(product), STUDIO_DETAIL_PLAN_CAPABILITY), ...planKnowledgeMetadata(product) },
                });
                const items = parseDirections(result.text || "", () => nanoid(10));
                update(
                    productId,
                    (value) => {
                        const { picked: _picked, ...prep } = value.brief.prep || { asks: [], directions: [] };
                        return { ...value, brief: { ...value.brief, prep: { ...prep, asks: prep.asks || [], directions: items, directionsAt: new Date().toISOString() } } };
                    },
                    { immediate: true },
                );
                return items;
            }),
        [read, update],
    );

    const watch = useCallback(
        async (productId: string, ref: StudioShotRef, shotId: string, attemptId: string, taskId: string, initialTask?: GenerationTask) => {
            if (getActiveUserScope() !== scope) return;
            if (watching.has(attemptId)) return;
            ownedAttempts.current.add(attemptId);
            uncertain.delete(attemptId);
            watching.add(attemptId);
            const controller = new AbortController();
            controllers.current.set(attemptId, controller);
            update(productId, (product) => patchAttempt(product, ref, shotId, attemptId, { error: undefined }));
            try {
                const done = await waitForGenerationTask(taskId, {
                    signal: controller.signal,
                    initialTask,
                    onTaskUpdate: (task) => {
                        const status: StudioAttemptStatus = task.status;
                        const current = useStudioStore.getState().products.find((item) => item.id === productId);
                        const attempt = current ? locateStudioShot(current, ref, shotId)?.shot.attempts.find((item) => item.id === attemptId) : undefined;
                        if (attempt && attempt.status !== status && status !== "succeeded") update(productId, (product) => patchAttempt(product, ref, shotId, attemptId, { status }));
                    },
                });
                const outputs = taskOutputs(done);
                if (!outputs.length) {
                    uncertain.add(attemptId);
                    update(productId, (product) => patchAttempt(product, ref, shotId, attemptId, { error: "任务已完成，图片暂时未同步，请重新查询或到任务中心核对" }), { immediate: true });
                    return;
                }
                update(
                    productId,
                    (product) =>
                        patchAttempt(
                            product,
                            ref,
                            shotId,
                            attemptId,
                            outputs.length ? { status: "succeeded", outputs, completedAt: new Date().toISOString(), error: undefined } : { status: "failed", error: "任务完成但没有可用的图片，请到任务中心核对", completedAt: new Date().toISOString() },
                        ),
                    { immediate: true },
                );
            } catch (error) {
                if (controller.signal.aborted || getActiveUserScope() !== scope) return;
                const message = error instanceof Error ? error.message : "生成失败";
                if (!isGenerationTaskTerminalError(error)) {
                    uncertain.add(attemptId);
                    update(productId, (product) => patchAttempt(product, ref, shotId, attemptId, { error: `结果同步中断：${message}。重新查询会接回原任务` }), { immediate: true });
                    return;
                }
                const status: StudioAttemptStatus = isGenerationTaskTerminalError(error) && error.task.status === "cancelled" ? "cancelled" : "failed";
                update(productId, (product) => patchAttempt(product, ref, shotId, attemptId, { status, error: message, completedAt: new Date().toISOString() }), { immediate: true });
            } finally {
                controllers.current.delete(attemptId);
                watching.delete(attemptId);
                pump();
            }
        },
        [scope, update],
    );

    const submit = useCallback(
        async (productId: string, ref: StudioShotRef, shotId: string, attemptId: string, imageModel: string) => {
            waiting.delete(attemptId);
            uncertain.delete(attemptId);
            submitting.add(attemptId);
            let requested = false;
            const submission = new AbortController();
            controllers.current.set(attemptId, submission);
            try {
                const product = read(productId);
                const located = locateStudioShot(product, ref, shotId);
                if (!located) throw new Error("这张图已不在记录里");
                const current = configRef.current;
                const { profile, compiled } = compileStudioShot(product, located, imageModel, current);
                if (!compiled.references.length) throw new Error("请先上传商品图，出图以它为外观依据");
                const request = studioImageRequest(profile, located.quality, located.shot.ratio, located.resolution);
                // 顺序就是提示词里的图号：商品图、模特（人脸或全身模特）与姿势、风格参考。
                const references = [...compiled.references, ...compiled.modelReferences, ...compiled.styleReferences];
                const node = { id: `studio-${shotId}`, type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model: imageModel } } as CanvasNodeData;
                const generation = buildEcommerceImageGeneration(current, node, { ...DEFAULT_ECOMMERCE_BRIEF, ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), imageSettings: request.imageSettings }, inputSummary(references.length));
                const task = await serializeSubmit(() => {
                    if (submission.signal.aborted || getActiveUserScope() !== scope) throw new DOMException("提交已中止", "AbortError");
                    requested = true;
                    return submitBackendGenerationTask({
                        expectedUserScope: scope,
                        signal: submission.signal,
                        mode: "image",
                        prompt: compiled.prompt,
                        config: generation.config,
                        referenceImages: references.map(photoReference),
                        clientOperationId: attemptId,
                        metadata: { source: "ecommerce-studio", studioProductId: productId, studioShotId: shotId, studioAttemptId: attemptId, studioRole: located.shot.role, ...("runId" in ref ? { studioRunId: ref.runId } : {}) },
                    });
                });
                update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { taskId: task.id, status: task.status }), { immediate: true });
                submitting.delete(attemptId);
                await watch(productId, ref, shotId, attemptId, task.id, task);
            } catch (error) {
                if (submission.signal.aborted || getActiveUserScope() !== scope) return;
                if (requested && !(error instanceof ApiError && typeof error.status === "number" && error.status >= 400 && error.status < 500)) {
                    uncertain.add(attemptId);
                    update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { error: "提交状态待核对，重新查询会使用同一个请求编号恢复" }), { immediate: true });
                    return;
                }
                update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { status: "failed", error: error instanceof Error ? error.message : "提交失败", completedAt: new Date().toISOString() }), { immediate: true });
            } finally {
                submitting.delete(attemptId);
                if (controllers.current.get(attemptId) === submission) controllers.current.delete(attemptId);
            }
        },
        [read, scope, update, watch],
    );

    /** 把镜头排进提交队列：先在记录里占一个「提交中」的位置，轮到它时再真正提交。 */
    const enqueue = useCallback(
        (productId: string, ref: StudioShotRef, shotIds: string[], imageModel: string) => {
            if (!imageModel) throw new Error("请先选择图片模型");
            const attempts = shotIds.map((shotId) => ({ shotId, attempt: { id: nanoid(12), status: "submitting" as const, model: imageModel, tweaks: [], createdAt: new Date().toISOString(), outputs: [] } satisfies StudioAttempt }));
            // 尝试记下提交时这张图的微调标签，之后改了标签也能看出每张结果是怎么出的。
            update(productId, (product) =>
                attempts.reduce(
                    (value, { shotId, attempt }) =>
                        patchStudioShotAt(value, ref, shotId, (shot) => (shot.attempts.some((item) => item.id === attempt.id) ? shot : { ...shot, attempts: [...shot.attempts, { ...attempt, tweaks: [...shot.tweaks] }].slice(-MAX_ATTEMPTS) })),
                    product,
                ),
            );
            for (const { shotId, attempt } of attempts) {
                ownedAttempts.current.add(attempt.id);
                waiting.set(attempt.id, { productId, ref, shotId });
                jobs.push({ attemptId: attempt.id, owner: owner.current, run: () => submit(productId, ref, shotId, attempt.id, imageModel) });
            }
            pump();
        },
        [submit, update],
    );

    /** 按当前表单生成一组：先记下这一组，再逐张排队提交。返回新记录的 ID。 */
    const generate = useCallback(
        (productId: string, imageModel: string) => {
            if (!imageModel) throw new Error("请先选择图片模型");
            const product = read(productId);
            if (!product.photos.length) throw new Error("请先上传商品图");
            const run = createStudioRun(product, () => nanoid(10));
            update(productId, (value) => appendStudioRun(value, run), { immediate: true });
            enqueue(
                productId,
                { runId: run.id },
                run.shots.map((shot) => shot.id),
                imageModel,
            );
            return run.id;
        },
        [enqueue, read, update],
    );

    /** 重新出某几张（失败重试、再来一张、确认助手的出图请求）。正在出的镜头不重复提交。 */
    const rerun = useCallback(
        (productId: string, ref: StudioShotRef, shotIds: string[], imageModel: string) => {
            const product = read(productId);
            const runnable = shotIds.filter((shotId) => {
                const shot = locateStudioShot(product, ref, shotId)?.shot;
                return shot && !shot.attempts.some(studioAttemptActive);
            });
            if (runnable.length) enqueue(productId, ref, runnable, imageModel);
            return runnable.length;
        },
        [enqueue, read],
    );

    /** 回到页面时接着同步还在跑的任务；提交中途断开的记录标为失败，让用户重试。 */
    const resume = useCallback(
        (product: StudioProduct) => {
            const groups: { ref: StudioShotRef; shots: StudioShot[] }[] = [
                ...product.plans.map((plan) => ({ ref: { planKind: plan.kind } as StudioShotRef, shots: plan.shots })),
                ...product.runs.map((run) => ({ ref: { runId: run.id } as StudioShotRef, shots: run.shots })),
            ];
            for (const { ref, shots } of groups) {
                for (const shot of shots) {
                    for (const attempt of shot.attempts) {
                        if (!studioAttemptActive(attempt)) continue;
                        if (attempt.taskId) void watch(product.id, ref, shot.id, attempt.id, attempt.taskId);
                        else if (!watching.has(attempt.id) && !submitting.has(attempt.id) && !waiting.has(attempt.id)) void submit(product.id, ref, shot.id, attempt.id, attempt.model);
                    }
                }
            }
        },
        [submit, watch],
    );

    return { fill, ask, directions, plan, generate, rerun, resume };
}

export type StudioRunner = ReturnType<typeof useStudioRunner>;

/** 镜头还没出过图、也没有在出：「全部生成」只补这些。 */
export function studioShotPending(shot: StudioShot) {
    return !studioShotPreview(shot) && !shot.attempts.some(studioAttemptActive);
}
