import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { buildEcommerceAnalysisGeneration } from "@/lib/ecommerce/ecommerce-analysis-generation";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioCleanNotes, studioPointLine, studioProductTypeOf, studioTitleOf } from "@/lib/ecommerce-studio/brief";
import { STUDIO_DETAIL_PLAN_CAPABILITY, STUDIO_PLAN_FIELD, STUDIO_PLAN_SCOPES, studioDetailPlanRoles, studioDetailScreenCount, studioTemplatePlanRoles } from "@/lib/ecommerce-studio/detail-plan";
import { buildDetailPlanPrompt, parseDetailPlan, studioPlanTargetRoles, StudioPlanValidationError, type StudioDetailPlanResult, type StudioPlanRequest } from "@/lib/ecommerce-studio/detail-plan-tasks";
import { mergeStudioDossier } from "@/lib/ecommerce-studio/dossier-review";
import { buildFillPrompt, parseFill, studioAnalysisMetadata, type StudioFillResult } from "@/lib/ecommerce-studio/dossier-tasks";
import { buildAskPrompt, buildDirectionsPrompt, parseAsks, parseDirections } from "@/lib/ecommerce-studio/plan-prep-tasks";
import { buildStudioImageGeneration, locateStudioShot, studioImageInput, type StudioShotRef, type StudioLocatedShot } from "@/lib/ecommerce-studio/generation-input";
import { studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioPlanInputSignature } from "@/lib/ecommerce-studio/plan-input";
import { studioPlanningImages } from "@/lib/ecommerce-studio/reference-selection";
import { patchStudioShot, studioAttemptActive, studioAttemptNeedsReview, studioShotPreview, studioGenerationSource } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, patchStudioRunShot, studioActivePlan, studioPlanScopeOf, studioRevisionPlan, studioSingleTargets, trimStudioRuns } from "@/lib/ecommerce-studio/runs";
import { studioFactUsable, type StudioAsk, type StudioAttempt, type StudioAttemptStatus, type StudioDirection, type StudioOutput, type StudioPhoto, type StudioPlanReceipt, type StudioProduct, type StudioShot } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { assertCurrentUserSession, captureUserSession, getActiveUserScope } from "@/lib/user-scope";
import { parseBackendGenerationResult, runBackendGenerationTask, submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey } from "@/services/api/resources";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";
import { isGenerationTaskTerminalError, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import { workbenchTaskOutputs } from "@/pages/workbench/workbench-batches";
import { commerceSubmissionKeyConflict, commerceSubmissionRejected } from "@/pages/ecommerce/generation-slot";
import { prepareCommerceReferenceViews } from "@/pages/ecommerce/long-reference-media";
import { useStudioStore } from "./use-studio-store";
import { renderStudioLayoutGuide, studioLayoutGuideReference } from "./studio-layout-guide";

/**
 * 生图台的任务运行时：识别填表、按镜头出图。全部走后端统一任务（计费、取消、记录一致），
 * 页面只负责提交和监听；离开页面不取消已提交的任务，回来时按任务 ID 接着同步。
 *
 * 提交排队：同时进行的任务不超过账号并发与 4 个，空出名额再提交下一张，避免后端按并发上限拒绝。
 */
const MAX_PARALLEL = 4;
const MAX_ATTEMPTS = 8;
const REVIEW_RECEIPT = "无法确认原请求的回执，已停止重新提交。请先到任务中心核对，不要重复生成";

/** 镜头在哪：表单记录（runId）或助手方案（planKind）。 */
export { compileStudioShot, locateStudioShot, type StudioShotRef, type StudioLocatedShot } from "@/lib/ecommerce-studio/generation-input";

// 跨组件实例共享：同一次尝试不会被挂上两个监听，也不会被误判为中断。
const watching = new Set<string>();
const submitting = new Set<string>();
const uncertain = new Set<string>();
const waiting = new Map<string, { productId: string; ref: StudioShotRef; shotId: string }>();
const jobs: { attemptId: string; owner: symbol; recovering: boolean; run: () => Promise<void> }[] = [];

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

function preflightImage(product: StudioProduct, located: StudioLocatedShot, model: string, config: ModelConfigInput, revisionResourceId?: string) {
    try {
        const input = studioImageInput(product, located, model, config, revisionResourceId);
        buildStudioImageGeneration(config, model, input, located.shot.id);
        if (input.compiled.layoutGuide?.proof) {
            const canvas = renderStudioLayoutGuide(input.compiled.layoutGuide, input.compiled.copySnapshot);
            canvas.width = canvas.height = 0;
        }
    } catch (error) {
        throw new Error(`「${located.shot.title}」预检失败：${error instanceof Error ? error.message : String(error)}`);
    }
}

/** 商品身份与设计参考分组传递，容量由当前文本模型决定。 */
async function planImages(product: StudioProduct, current: ModelConfigInput, textModel: string, withReferences = true, assertCurrent?: () => void) {
    const draft = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(0));
    const capacity = modelCapabilityConfigFor(current, draft.model).text?.references.maxImages ?? 2;
    const selected = studioPlanningImages(product, capacity, withReferences);
    if (!selected.references.length) return { ...selected, readingViews: undefined };
    const prepared = await prepareCommerceReferenceViews(
        {
            ...emptyEcommerceDraft(),
            referenceMode: "style",
            references: selected.photos.map(({ resourceId }) => ({ resourceId, role: "primary" as const })),
            layoutReferences: selected.references.map(({ resourceId, name, width, height }) => ({ resourceId, role: "style" as const, name, width, height })),
        },
        capacity,
        assertCurrent,
    );
    const windows: StudioPhoto[] = prepared.views.map((view) => ({ id: view.resourceId, resourceId: view.resourceId, name: view.name, width: view.width, height: view.height, url: "", view: "other", truth: false, addedAt: "" }));
    const references = [...selected.references, ...windows];
    const readingViews = prepared.views.map((view, index) => ({
        imageIndex: selected.images.length + index + 1,
        sourceIndex: selected.photos.length + selected.references.findIndex((photo) => photo.resourceId === view.sourceResourceId) + 1,
        top: view.top,
        bottom: view.bottom,
    }));
    return { ...selected, references, images: [...selected.photos, ...references], readingViews };
}

/** 策划类任务给服务端的知识检索提示：策划范围（模板套图按模板用途）、单张类型、品类大类和材质。 */
function planKnowledgeMetadata(product: StudioProduct) {
    const scope = studioPlanScopeOf(product);
    const suite = scope === "template" ? product.brief.suite : undefined;
    const targets = scope === "single" ? studioSingleTargets(product.brief) : undefined;
    return {
        studioPlanKind: suite ? suite.kind : scope || "detail",
        studioTextMode: "model",
        ...(targets?.length ? { studioPlanTargets: targets.map((target) => target.type).join(",") } : {}),
        ...(product.dossier?.family && product.dossier.family !== "generic" ? { studioFamily: product.dossier.family } : {}),
        ...(studioPlanMaterials(product) ? { studioMaterials: studioPlanMaterials(product) } : {}),
    };
}

function planSpecification(product: StudioProduct) {
    const scope = studioPlanScopeOf(product);
    if (!scope) throw new Error("先选择一套模板，再按模板策划");
    const suite = scope === "template" ? product.brief.suite : undefined;
    const targets = scope === "single" ? studioSingleTargets(product.brief) : undefined;
    const roles = targets ? studioPlanTargetRoles(targets) : suite ? studioTemplatePlanRoles(product, suite) : studioDetailPlanRoles(product, scope === "main" ? "main" : "detail");
    const count = targets ? roles.length : suite ? suite.shots.length : scope === "detail" ? studioDetailScreenCount(product.brief) : STUDIO_PLAN_SCOPES[scope].screens;
    return { scope, targets, roles, metadata: { studioPlanScope: scope, studioPlanCount: count, studioPlanRoles: [...new Set(roles)], ...(suite ? { studioTemplateId: suite.id, studioTemplateSource: suite.source } : {}) } };
}

function checkPlanTask(task: GenerationTask, productId: string, receipt: StudioPlanReceipt) {
    let metadata;
    try {
        metadata = JSON.parse(task.inputJson || "null")?.metadata;
    } catch {
        metadata = null;
    }
    if (task.id !== receipt.taskId || task.type !== "canvas_text" || metadata?.source !== "ecommerce-studio" || metadata.studioProductId !== productId || metadata.studioStep !== "plan" || metadata.studioPlanAttemptId !== receipt.attemptId)
        throw new Error("原任务与这次商品策划不匹配，不能采用");
}

function knowledgeContext(product: StudioProduct) {
    return { platform: product.platform, category: studioProductTypeOf(product) || product.dossier?.category, productName: [product.name, product.dossier?.name, studioTitleOf(product)].filter(Boolean).join(" ") };
}

function taskOutputs(task: GenerationTask): StudioOutput[] {
    return workbenchTaskOutputs(task, "image")
        .filter((output) => output.resourceId)
        .map((output) => ({ resourceId: output.resourceId!, url: `/api/resources/${output.resourceId}/file`, ...(output.width ? { width: output.width } : {}), ...(output.height ? { height: output.height } : {}) }));
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
        owner.current = Symbol("studio-runner");
        const activeOwner = owner.current;
        const active = controllers.current;
        return () => {
            owner.current = Symbol("inactive-studio-runner");
            for (const controller of active.values()) controller.abort();
            active.clear();
            // 离开页面时还没提交的镜头不再提交，标成失败，回来后可以一键重试。
            const dropped = jobs.filter((job) => job.owner === activeOwner);
            for (let index = jobs.length - 1; index >= 0; index--) if (jobs[index].owner === activeOwner) jobs.splice(index, 1);
            for (const job of dropped) {
                const entry = waiting.get(job.attemptId);
                waiting.delete(job.attemptId);
                if (entry && !job.recovering)
                    update(entry.productId, (product) => patchAttempt(product, entry.ref, entry.shotId, job.attemptId, { status: "failed", error: "离开页面时还没提交，点重试再生成", completedAt: new Date().toISOString() }), { immediate: true });
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

    const rememberAnalysisTask = useCallback(
        (productId: string, task: GenerationTask) => {
            if (read(productId).lastAnalysisTaskId !== task.id) update(productId, (value) => ({ ...value, lastAnalysisTaskId: task.id }), { immediate: true });
        },
        [read, update],
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
                    streamText: true,
                    metadata: studioAnalysisMetadata(productId, "recognize", { platform: product.platform, category: studioProductTypeOf(product) || product.dossier?.category, productName: studioTitleOf(product) || product.name }),
                    onTaskUpdate: (task) => rememberAnalysisTask(productId, task),
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
        [read, rememberAnalysisTask, scope, update],
    );

    /**
     * 按这件商品策划当前出图类型（详情页、主图套图、选中的单张图或选中的模板）：服务端按「出图策划」能力和策划范围
     * 带上电商知识库的对应方法，模型看商品图和表单信息排每一张。结果存进表单对应的策划，镜头清单换成策划的屏，
     * 原来的勾选和顺序清掉。revise 时带上这一版策划，按补充调整修改。
     */
    const plan = useCallback(
        (productId: string, textModel: string, options: { revise?: boolean; recheck?: boolean } = {}) =>
            trackAnalysis(productId, "plan", async (): Promise<StudioDetailPlanResult> => {
                const product = read(productId);
                const inputFingerprint = studioPlanInputSignature(product);
                const session = captureUserSession();
                const { scope: planScope, targets, roles, metadata } = planSpecification(product);
                const previousReceipt = options.recheck ? product.planReceipt : undefined;
                if (options.recheck && (!previousReceipt?.taskId || previousReceipt.scope !== planScope || previousReceipt.inputSignature !== inputFingerprint || previousReceipt.state === "accepted"))
                    throw new Error("只有相同输入的未采用策划才能重验，不会提交新的模型任务");
                const previous = options.revise ? studioRevisionPlan(product) : undefined;
                const alternative = !options.recheck && !options.revise ? studioActivePlan(product) : undefined;
                let receipt: StudioPlanReceipt = previousReceipt || {
                    scope: planScope,
                    inputSignature: inputFingerprint,
                    model: textModel,
                    createdAt: new Date().toISOString(),
                    attemptId: nanoid(16),
                    state: "submitted",
                    ...(alternative ? { alternativeDirection: true } : {}),
                };
                const request: StudioPlanRequest = { scope: planScope, targets, previous, alternative, alternativeDirection: receipt.alternativeDirection };
                const field = STUDIO_PLAN_FIELD[planScope];
                const persist = (next: StudioPlanReceipt, result?: StudioDetailPlanResult) => {
                    assertCurrentUserSession(session);
                    receipt = next;
                    if (
                        !update(
                            productId,
                            (value) => {
                                const canApply = result && studioPlanInputSignature(value) === inputFingerprint;
                                const planReceipt: StudioPlanReceipt = result && !canApply ? { ...next, state: "not-accepted", message: "其他窗口已修改策划输入，未采用这份结果" } : next;
                                return { ...value, ...(next.taskId ? { lastAnalysisTaskId: next.taskId } : {}), planReceipt, ...(canApply ? { brief: { ...value.brief, [field]: result.plan, shotOrder: [], shotSkip: [] } } : {}) };
                            },
                            { immediate: true },
                        )
                    )
                        throw new Error("商品已删除，不能保存策划结果");
                };
                const assertCurrent = () => {
                    if (studioPlanInputSignature(read(productId)) !== inputFingerprint) throw new Error("策划期间商品信息或出图要求已修改，不会把这份结果套到新输入");
                };
                let taskSucceeded = false;
                let parsed: StudioDetailPlanResult;
                try {
                    let raw: string | undefined;
                    if (previousReceipt?.taskId) {
                        const task = await waitForGenerationTask(previousReceipt.taskId, { signal: session.signal });
                        checkPlanTask(task, productId, previousReceipt);
                        taskSucceeded = true;
                        raw = parseBackendGenerationResult(task).text;
                    } else {
                        const current = configRef.current;
                        const { photos, references, images, readingViews } = await planImages(product, current, textModel, true, assertCurrent);
                        assertCurrent();
                        const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(images.length));
                        receipt.model = generation.model;
                        if (images.length) request.images = { photos: photos.length, references: references.length, readingViews };
                        const result = await runBackendGenerationTask({
                            mode: "text",
                            expectedUserScope: scope,
                            signal: session.signal,
                            prompt: buildDetailPlanPrompt(product, roles, request, modelCapabilityConfigFor(current, generation.model).text?.references.promptMaxChars),
                            config: generation,
                            referenceImages: images.map(photoReference),
                            streamText: true,
                            metadata: { ...studioAnalysisMetadata(productId, "plan", knowledgeContext(product), STUDIO_DETAIL_PLAN_CAPABILITY), ...planKnowledgeMetadata(product), ...metadata, studioPlanAttemptId: receipt.attemptId },
                            onTaskUpdate: (task) => {
                                if (task.status === "succeeded") taskSucceeded = true;
                                if (receipt.taskId !== task.id) persist({ ...receipt, taskId: task.id });
                            },
                        });
                        taskSucceeded = true;
                        raw = result.text;
                    }
                    assertCurrent();
                    parsed = parseDetailPlan(raw || "", product, roles, { id: receipt.attemptId, model: receipt.model, createdAt: receipt.createdAt }, request);
                } catch (error) {
                    const message = error instanceof Error ? error.message : "策划未完成";
                    const diagnosis = error instanceof StudioPlanValidationError ? { review: error.review, issues: error.issues } : {};
                    persist({ ...receipt, state: taskSucceeded ? "not-accepted" : !receipt.taskId || isGenerationTaskTerminalError(error) ? "task-failed" : "submitted", message, ...diagnosis });
                    await useStudioStore.getState().flush(productId);
                    throw error;
                }
                persist({ ...receipt, state: "accepted", message: undefined, issues: parsed.warnings, review: undefined }, parsed);
                await useStudioStore.getState().flush(productId);
                assertCurrent();
                return parsed;
            }),
        [read, scope, update],
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
                const { images } = await planImages(product, current, textModel, false);
                const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(images.length));
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt: buildAskPrompt(product),
                    config: generation,
                    referenceImages: images.map(photoReference),
                    streamText: true,
                    metadata: studioAnalysisMetadata(productId, "ask", knowledgeContext(product)),
                    onTaskUpdate: (task) => rememberAnalysisTask(productId, task),
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
        [read, rememberAnalysisTask, scope, update],
    );

    /** 给 3 个视角方案：带上卖家补充、电商知识库和同类爆款套图；新的一批替换原来的，原来挑的方向清掉。 */
    const directions = useCallback(
        (productId: string, textModel: string) =>
            trackAnalysis(productId, "directions", async (): Promise<StudioDirection[]> => {
                const product = read(productId);
                const current = configRef.current;
                const { photos, references, images, readingViews } = await planImages(product, current, textModel);
                const generation = buildEcommerceAnalysisGeneration(current, textModel, inputSummary(images.length));
                const result = await runBackendGenerationTask({
                    mode: "text",
                    expectedUserScope: scope,
                    prompt: buildDirectionsPrompt(product, studioPlanScopeOf(product), images.length ? { photos: photos.length, references: references.length, readingViews } : undefined),
                    config: generation,
                    referenceImages: images.map(photoReference),
                    streamText: true,
                    metadata: { ...studioAnalysisMetadata(productId, "directions", knowledgeContext(product), STUDIO_DETAIL_PLAN_CAPABILITY), ...planKnowledgeMetadata(product) },
                });
                const items = parseDirections(result.text || "", () => nanoid(10), product);
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
        async (productId: string, ref: StudioShotRef, shotId: string, attemptId: string, imageModel: string, recovering = false) => {
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
                const attempt = located.shot.attempts.find((item) => item.id === attemptId);
                if (!attempt || !studioAttemptActive(attempt) || !attempt.replaySafe || !attempt.input) return;
                const input = attempt.input;
                await useStudioStore.getState().flush(productId);
                const saved = locateStudioShot(read(productId), ref, shotId)?.shot.attempts.find((item) => item.id === attemptId);
                if (!saved || !studioAttemptActive(saved)) throw new Error("这次生成已不在记录里");
                const { compiled } = input;
                // 布局草图排最后，不挤掉商品、模特或卖家参考的名额。
                const references = [...compiled.references, ...compiled.modelReferences, ...compiled.styleReferences].map(photoReference);
                if (compiled.revisionReference) references.push(photoReference(compiled.revisionReference));
                if (compiled.layoutGuide) {
                    const guide = await studioLayoutGuideReference(compiled.layoutGuide, attemptId, scope, submission.signal, compiled.copySnapshot);
                    if (!compiled.layoutGuide.resourceId) {
                        const stable = { ...input, compiled: { ...compiled, layoutGuide: { ...compiled.layoutGuide, resourceId: guide.resourceId } } };
                        update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { input: stable }));
                        await useStudioStore.getState().flush(productId);
                    }
                    references.push(guide.image);
                }
                const generation = buildStudioImageGeneration(current, imageModel, input, shotId);
                const task = await serializeSubmit(() => {
                    if (submission.signal.aborted || getActiveUserScope() !== scope) throw new DOMException("提交已中止", "AbortError");
                    requested = true;
                    return submitBackendGenerationTask({
                        expectedUserScope: scope,
                        signal: submission.signal,
                        mode: "image",
                        prompt: compiled.prompt,
                        config: generation,
                        referenceImages: references,
                        clientOperationId: attemptId,
                        metadata: { source: "ecommerce-studio", studioProductId: productId, studioShotId: shotId, studioAttemptId: attemptId, studioRole: located.shot.role, ...("runId" in ref ? { studioRunId: ref.runId } : {}) },
                    });
                });
                update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { taskId: task.id, status: task.status, textMode: compiled.textMode }), { immediate: true });
                submitting.delete(attemptId);
                await watch(productId, ref, shotId, attemptId, task.id, task);
            } catch (error) {
                if (submission.signal.aborted || getActiveUserScope() !== scope) return;
                if (requested && commerceSubmissionKeyConflict(error)) {
                    update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { replaySafe: undefined, error: REVIEW_RECEIPT }), { immediate: true });
                    return;
                }
                if (recovering || (requested && !commerceSubmissionRejected(error))) {
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
        async (productId: string, ref: StudioShotRef, shotIds: string[], imageModel: string, revisionResourceId?: string) => {
            if (!imageModel) throw new Error("请先选择图片模型");
            const activeOwner = owner.current;
            const product = read(productId);
            const attempts = shotIds.map((shotId) => ({
                shotId,
                attempt: {
                    id: nanoid(12),
                    replaySafe: true,
                    status: "submitting" as const,
                    model: imageModel,
                    textMode: "model" as const,
                    tweaks: [],
                    input: studioImageInput(product, locateStudioShot(product, ref, shotId)!, imageModel, configRef.current, revisionResourceId),
                    ...(revisionResourceId ? { revisionResourceId } : {}),
                    createdAt: new Date().toISOString(),
                    outputs: [],
                } satisfies StudioAttempt,
            }));
            for (const { shotId, attempt } of attempts) waiting.set(attempt.id, { productId, ref, shotId });
            // 尝试记下提交时这张图的微调标签，之后改了标签也能看出每张结果是怎么出的。
            update(productId, (product) =>
                trimStudioRuns(
                    attempts.reduce(
                        (value, { shotId, attempt }) =>
                            patchStudioShotAt(value, ref, shotId, (shot) => {
                                if (shot.attempts.some((item) => item.id === attempt.id)) return shot;
                                const source = revisionResourceId ? shot.attempts.find((item) => item.status === "succeeded" && item.outputs.some((output) => output.resourceId === revisionResourceId)) : undefined;
                                const next = [...shot.attempts, { ...attempt, tweaks: [...shot.tweaks] }].slice(-MAX_ATTEMPTS);
                                // 修正旧候选时保留源图，刷新恢复不能因历史上限丢掉编辑起点。
                                if (source && !next.some((item) => item.id === source.id)) next.splice(0, 1, source);
                                return { ...shot, attempts: next };
                            }),
                        product,
                    ),
                ),
            );
            try {
                await useStudioStore.getState().flush(productId);
                read(productId);
                if (owner.current !== activeOwner) throw new DOMException("页面已离开，请重新生成", "AbortError");
            } catch (error) {
                for (const { shotId, attempt } of attempts) {
                    waiting.delete(attempt.id);
                    update(productId, (value) => patchAttempt(value, ref, shotId, attempt.id, { status: "failed", error: error instanceof Error ? error.message : "保存失败，未提交生成", completedAt: new Date().toISOString() }));
                }
                throw error;
            }
            for (const { shotId, attempt } of attempts) {
                ownedAttempts.current.add(attempt.id);
                waiting.set(attempt.id, { productId, ref, shotId });
                jobs.push({ attemptId: attempt.id, owner: activeOwner, recovering: false, run: () => submit(productId, ref, shotId, attempt.id, imageModel) });
            }
            pump();
        },
        [read, submit, update],
    );

    /** 按当前表单生成一组：先记下这一组，再逐张排队提交。返回新记录的 ID。 */
    const generate = useCallback(
        async (productId: string, imageModel: string, options: { firstOnly?: boolean } = {}) => {
            if (!imageModel) throw new Error("请先选择图片模型");
            const product = read(productId);
            if (!product.photos.length) throw new Error("请先上传商品图");
            const run = createStudioRun(product, () => nanoid(10));
            const selected = options.firstOnly ? run.shots.slice(0, 1) : run.shots;
            for (const shot of selected)
                preflightImage(product, { shot, textMode: run.textMode, quality: run.quality, resolution: run.resolution || "", fromForm: true, styleId: run.styleId, source: run.source, suite: run.suite }, imageModel, configRef.current);
            update(productId, (value) => appendStudioRun(value, run), { immediate: true });
            await enqueue(
                productId,
                { runId: run.id },
                selected.map((shot) => shot.id),
                imageModel,
            );
            return run.id;
        },
        [enqueue, read, update],
    );

    /** 重新出某几张（失败重试、再来一张、确认助手的出图请求）。正在出的镜头不重复提交。 */
    const rerun = useCallback(
        async (productId: string, ref: StudioShotRef, shotIds: string[], imageModel: string, revisionResourceId?: string) => {
            const product = read(productId);
            const runnable = shotIds.filter((shotId) => {
                const shot = locateStudioShot(product, ref, shotId)?.shot;
                return shot && !shot.attempts.some(studioAttemptActive);
            });
            for (const shotId of runnable) {
                const located = locateStudioShot(product, ref, shotId);
                if (located) preflightImage(product, located, imageModel, configRef.current, revisionResourceId);
            }
            if (runnable.length) await enqueue(productId, ref, runnable, imageModel, revisionResourceId);
            return runnable.length;
        },
        [enqueue, read],
    );

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
                        else if (!watching.has(attempt.id) && !submitting.has(attempt.id) && !waiting.has(attempt.id)) {
                            if (studioAttemptNeedsReview(attempt)) {
                                if (attempt.error !== REVIEW_RECEIPT) update(product.id, (value) => patchAttempt(value, ref, shot.id, attempt.id, { error: REVIEW_RECEIPT }), { immediate: true });
                                continue;
                            }
                            ownedAttempts.current.add(attempt.id);
                            uncertain.delete(attempt.id);
                            waiting.set(attempt.id, { productId: product.id, ref, shotId: shot.id });
                            jobs.push({ attemptId: attempt.id, owner: owner.current, recovering: true, run: () => submit(product.id, ref, shot.id, attempt.id, attempt.model, true) });
                        }
                    }
                }
            }
            pump();
        },
        [submit, update, watch],
    );

    return { fill, ask, directions, plan, generate, rerun, resume };
}

export type StudioRunner = ReturnType<typeof useStudioRunner>;

/** 镜头还没出过图、也没有在出：「全部生成」只补这些。 */
export function studioShotPending(shot: StudioShot) {
    return !studioShotPreview(shot) && !shot.attempts.some(studioAttemptActive);
}
