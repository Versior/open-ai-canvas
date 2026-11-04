import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { DEFAULT_ECOMMERCE_BRIEF } from "@/lib/ecommerce/ecommerce-capabilities";
import { buildEcommerceAnalysisGeneration } from "@/lib/ecommerce/ecommerce-analysis-generation";
import { buildEcommerceImageGeneration } from "@/lib/ecommerce/ecommerce-image-generation";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioBrandOf, studioPointLine, studioProductTypeOf, studioTitleOf } from "@/lib/ecommerce-studio/brief";
import { buildFillPrompt, parseFill, studioAnalysisMetadata, type StudioFillResult } from "@/lib/ecommerce-studio/dossier-tasks";
import { studioImageRequest } from "@/lib/ecommerce-studio/image-options";
import { compileStudioPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { patchStudioShot, studioAttemptActive, studioPlanOf, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { appendStudioRun, createStudioRun, patchStudioRunShot, studioRunOf } from "@/lib/ecommerce-studio/runs";
import type { StudioAttempt, StudioAttemptStatus, StudioOutput, StudioPhoto, StudioPlanKind, StudioProduct, StudioRun, StudioShot, StudioTextMode } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
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
const waiting = new Map<string, { productId: string; ref: StudioShotRef; shotId: string }>();
const jobs: { attemptId: string; run: () => Promise<void> }[] = [];

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
    while (jobs.length && watching.size + submitting.size < concurrency()) {
        const job = jobs.shift()!;
        void job
            .run()
            .catch(() => undefined)
            .finally(pump);
    }
}

export type StudioAnalysisKind = "fill";

/** 正在进行的识别，按商品记录；切换商品再回来也能看到进度。 */
export const useStudioAnalysis = create<{ running: Record<string, StudioAnalysisKind | undefined> }>(() => ({ running: {} }));

async function trackAnalysis<T>(productId: string, kind: StudioAnalysisKind, run: () => Promise<T>) {
    if (useStudioAnalysis.getState().running[productId]) throw new Error("这个商品正在识别，请等它完成");
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

function inputSummary(imageCount: number) {
    return { textCount: 0, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 };
}

function taskOutputs(task: GenerationTask): StudioOutput[] {
    return workbenchTaskOutputs(task, "image")
        .filter((output) => output.resourceId)
        .map((output) => ({ resourceId: output.resourceId!, url: `/api/resources/${output.resourceId}/file`, ...(output.width ? { width: output.width } : {}), ...(output.height ? { height: output.height } : {}) }));
}

export type StudioLocatedShot = { shot: StudioShot; textMode: StudioTextMode; quality: string; fromForm: boolean; suite?: StudioRun["suite"] };

export function locateStudioShot(product: StudioProduct, ref: StudioShotRef, shotId: string): StudioLocatedShot | undefined {
    if ("runId" in ref) {
        const run = studioRunOf(product, ref.runId);
        const shot = run?.shots.find((item) => item.id === shotId);
        return run && shot ? { shot, textMode: run.textMode, quality: run.quality, fromForm: true, suite: run.suite } : undefined;
    }
    const plan = studioPlanOf(product, ref.planKind);
    const shot = plan?.shots.find((item) => item.id === shotId);
    return plan && shot ? { shot, textMode: plan.textMode, quality: product.brief.quality, fromForm: false } : undefined;
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
    const config = useEffectiveConfig();
    const configRef = useRef(config);
    configRef.current = config;
    const update = useStudioStore((state) => state.update);
    const controllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        const active = controllers.current;
        return () => {
            for (const controller of active.values()) controller.abort();
            active.clear();
            // 离开页面时还没提交的镜头不再提交，标成失败，回来后可以一键重试。
            const dropped = jobs.splice(0, jobs.length);
            for (const job of dropped) {
                const entry = waiting.get(job.attemptId);
                waiting.delete(job.attemptId);
                if (entry)
                    useStudioStore
                        .getState()
                        .update(entry.productId, (product) => patchAttempt(product, entry.ref, entry.shotId, job.attemptId, { status: "failed", error: "离开页面时还没提交，点重试再生成", completedAt: new Date().toISOString() }), { immediate: true });
            }
        };
    }, []);

    const read = useCallback((productId: string) => {
        const product = useStudioStore.getState().products.find((item) => item.id === productId);
        if (!product) throw new Error("商品不存在或已被删除");
        return product;
    }, []);

    /** 看图识别并填表：建档、品牌、类型、主标题和卖点一次写好。已经填过的字段不覆盖。 */
    const fill = useCallback(
        (productId: string, textModel: string) =>
            trackAnalysis(productId, "fill", async (): Promise<StudioFillResult & { info: string; infoKept: boolean }> => {
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
                    sellerNotes: product.sellerNotes,
                    brand: studioBrandOf(product),
                    productType: studioProductTypeOf(product),
                    title: studioTitleOf(product),
                });
                const result = await runBackendGenerationTask({
                    mode: "text",
                    prompt,
                    config: generation,
                    referenceImages: photos.map(photoReference),
                    streamText: false,
                    metadata: studioAnalysisMetadata(productId, "recognize", { platform: product.platform, category: studioProductTypeOf(product) || product.dossier?.category, productName: studioTitleOf(product) || product.name }),
                });
                const parsed = parseFill(result.text || "", () => nanoid(10), generation.model);
                const info = parsed.sellingPoints
                    .filter((point) => point.enabled)
                    .map(studioPointLine)
                    .join("\n");
                let infoKept = false;
                update(
                    productId,
                    (value) => {
                        // 只填空着的字段：用户已经写过的内容不被识别结果覆盖。
                        infoKept = Boolean(value.sellerNotes.trim()) && Boolean(info);
                        return {
                            ...value,
                            name: value.name || parsed.dossier.name,
                            dossier: parsed.dossier,
                            sellingPoints: parsed.sellingPoints,
                            sellerNotes: value.sellerNotes.trim() ? value.sellerNotes : info,
                            brief: { ...value.brief, brand: value.brief.brand || parsed.brand, productType: value.brief.productType || parsed.dossier.category },
                            copy: { headline: value.copy?.headline || parsed.title, subhead: value.copy?.subhead || "", listingTitle: value.copy?.listingTitle || "", bullets: value.copy?.bullets || [] },
                        };
                    },
                    { immediate: true },
                );
                return { ...parsed, info, infoKept };
            }),
        [read, update],
    );

    const watch = useCallback(
        async (productId: string, ref: StudioShotRef, shotId: string, attemptId: string, taskId: string, initialTask?: GenerationTask) => {
            if (watching.has(attemptId)) return;
            watching.add(attemptId);
            const controller = new AbortController();
            controllers.current.set(attemptId, controller);
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
                if (controller.signal.aborted) return;
                const message = error instanceof Error ? error.message : "生成失败";
                const status: StudioAttemptStatus = isGenerationTaskTerminalError(error) && error.task.status === "cancelled" ? "cancelled" : "failed";
                update(productId, (product) => patchAttempt(product, ref, shotId, attemptId, { status, error: message, completedAt: new Date().toISOString() }), { immediate: true });
            } finally {
                controllers.current.delete(attemptId);
                watching.delete(attemptId);
                pump();
            }
        },
        [update],
    );

    const submit = useCallback(
        async (productId: string, ref: StudioShotRef, shotId: string, attemptId: string, imageModel: string) => {
            waiting.delete(attemptId);
            submitting.add(attemptId);
            try {
                const product = read(productId);
                const located = locateStudioShot(product, ref, shotId);
                if (!located) throw new Error("这张图已不在记录里");
                const current = configRef.current;
                const { profile, compiled } = compileStudioShot(product, located, imageModel, current);
                if (!compiled.references.length) throw new Error("请先上传商品图，出图以它为外观依据");
                const request = studioImageRequest(profile, located.quality, located.shot.ratio);
                const references = [...compiled.references, ...compiled.styleReferences];
                const node = { id: `studio-${shotId}`, type: CanvasNodeType.Image, title: "", width: 0, height: 0, position: { x: 0, y: 0 }, metadata: { model: imageModel } } as CanvasNodeData;
                const generation = buildEcommerceImageGeneration(current, node, { ...DEFAULT_ECOMMERCE_BRIEF, ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}), imageSettings: request.imageSettings }, inputSummary(references.length));
                const task = await serializeSubmit(() =>
                    submitBackendGenerationTask({
                        mode: "image",
                        prompt: compiled.prompt,
                        config: generation.config,
                        referenceImages: references.map(photoReference),
                        clientOperationId: attemptId,
                        metadata: { source: "ecommerce-studio", studioProductId: productId, studioShotId: shotId, studioAttemptId: attemptId, studioRole: located.shot.role, ...("runId" in ref ? { studioRunId: ref.runId } : {}) },
                    }),
                );
                update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { taskId: task.id, status: task.status }), { immediate: true });
                submitting.delete(attemptId);
                await watch(productId, ref, shotId, attemptId, task.id, task);
            } catch (error) {
                update(productId, (value) => patchAttempt(value, ref, shotId, attemptId, { status: "failed", error: error instanceof Error ? error.message : "提交失败", completedAt: new Date().toISOString() }), { immediate: true });
            } finally {
                submitting.delete(attemptId);
            }
        },
        [read, update, watch],
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
                waiting.set(attempt.id, { productId, ref, shotId });
                jobs.push({ attemptId: attempt.id, run: () => submit(productId, ref, shotId, attempt.id, imageModel) });
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
                        else if (!watching.has(attempt.id) && !submitting.has(attempt.id) && !waiting.has(attempt.id))
                            update(product.id, (current) => patchAttempt(current, ref, shot.id, attempt.id, { status: "failed", error: "提交被中断，请重新生成", completedAt: new Date().toISOString() }));
                    }
                }
            }
        },
        [update, watch],
    );

    return { fill, generate, rerun, resume };
}

export type StudioRunner = ReturnType<typeof useStudioRunner>;

/** 镜头还没出过图、也没有在出：「全部生成」只补这些。 */
export function studioShotPending(shot: StudioShot) {
    return !studioShotPreview(shot) && !shot.attempts.some(studioAttemptActive);
}
