import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { canonicalize } from "json-canonicalize";
import { saveAs } from "file-saver";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { buildEcommerceAnalysisGeneration } from "@/lib/ecommerce/ecommerce-analysis-generation";
import { ecommerceCopySourceIssues } from "@/lib/ecommerce/ecommerce-contract";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitImageNodeSize } from "@/lib/canvas/canvas-node-size";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { runBackendGenerationTask, parseBackendGenerationResult } from "@/services/api/generation-task";
import { cancelGenerationTask, queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { listAddedSkills } from "@/services/api/skills";
import { skillRuntime, type SkillRuntimeMetadata } from "@/services/skill-runtime";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { uploadImage } from "@/services/image-storage";
import { buildPatternPrintPack, readPatternPixels, recolorPatternNode } from "@/services/ecommerce-pattern-tools";
import { buildEcommerceLayerArchive } from "@/services/ecommerce-layer-export";
import { buildEcommerceSuiteArchive } from "@/services/ecommerce-suite-export";
import { ecommerceStudioShotSignature, ecommerceStudioExportSelection, ecommerceStudioInputSignature, validateEcommerceStudioResultInputs } from "@/lib/ecommerce/ecommerce-studio";
import { assertEcommerceStudioReview, ecommerceStudioPlanReviewSignature, ecommerceStudioDeliveryReviewSignature } from "@/lib/ecommerce/ecommerce-studio";
import { inspectPatternSeams } from "@/lib/ecommerce/ecommerce-pattern-pixels";
import { ecommerceStudioSources, ecommerceStudioSourceSignature, ecommerceStudioImageRole } from "@/lib/ecommerce/ecommerce-studio";
import {
    ecommerceWorkbenchPrompt,
    validateEcommerceWorkbenchBrief,
    validateEcommercePlanningCount,
    parseEcommerceWorkbenchPlan,
    ecommerceActionCapability,
    type EcommerceCapability,
    type EcommerceWorkbenchRequest,
} from "@/lib/ecommerce/ecommerce-capabilities";
import { ecommerceCapabilitySettings } from "@/services/api/ecommerce";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { useEcommerceTemplateLibrary } from "@/stores/use-ecommerce-template-library";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";
import { useEcommercePatternLibrary } from "@/stores/use-ecommerce-pattern-library";
import { resolveImageUrl } from "@/services/image-storage";
import { loadRasterImage } from "@/lib/image-raster";
import { createEcommerceModel } from "@/lib/ecommerce/ecommerce-models";
import { getActiveUserScope } from "@/lib/user-scope";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { buildEcommerceImageGeneration, ecommerceImageSettings } from "@/lib/ecommerce/ecommerce-image-generation";
import { downloadName } from "@/lib/media-package";
import { ecommerceStudioExecutionSignature } from "@/lib/ecommerce/ecommerce-studio";
import { rasterizeEcommerceLongImage } from "@/lib/ecommerce/ecommerce-rasterize";
import { imageToDataUrl } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection, type Position } from "@/types/canvas";

export type { EcommerceWorkbenchAction, EcommerceWorkbenchRequest } from "@/lib/ecommerce/ecommerce-capabilities";
type Options = {
    projectId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    center: () => Position;
    applyResult: (id: string, task: GenerationTask) => Promise<void>;
    bindTask: (id: string, task: GenerationTask) => void;
};

export function useEcommerceWorkbench(options: Options) {
    const { projectId, domainProjectId, nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, center, applyResult, bindTask } = options;
    const config = useEffectiveConfig();
    const [busy, setBusy] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const receiptIdRef = useRef<string | null>(null);
    const epochRef = useRef(0);
    useEffect(() => {
        setBusy(false);
        return () => {
            epochRef.current++;
            controllerRef.current?.abort();
            controllerRef.current = null;
        };
    }, [projectId]);
    const run = useCallback(
        async (request: EcommerceWorkbenchRequest) => {
            if (controllerRef.current) throw new Error("正在执行，请等待或停止当前步骤");
            const controller = new AbortController();
            controllerRef.current = controller;
            setBusy(true);
            const scope = getActiveUserScope();
            const epoch = epochRef.current;
            const capability = ecommerceActionCapability(request.action);
            let receipt: CanvasNodeData | undefined;
            let activeTask: GenerationTask | undefined;
            const deliveryAction = ["studio-place-results", "studio-compose"].includes(request.action);
            let savedExecution: CanvasNodeData["metadata"] | undefined;
            const check = () => {
                if (controller.signal.aborted) throw new Error("已停止当前操作；已提交的模型任务可在任务中心查看");
                if (scope !== getActiveUserScope()) throw new Error("账号已切换，已停止结果写入");
                if (epoch !== epochRef.current) throw new Error("画布已切换，已停止结果写入");
                if (receipt && !nodesRef.current.some((node) => node.id === receipt!.id && !node.metadata?.locked)) throw new Error("执行记录已删除或锁定");
            };
            const patchStep = (id: string, patch: Partial<NonNullable<NonNullable<CanvasNodeData["metadata"]>["ecommerceWorkbench"]>["steps"][number]>, content?: string) => {
                if (scope !== getActiveUserScope() || epoch !== epochRef.current) return;
                setNodes((current) =>
                    current.map((node) => {
                        if (node.id !== receipt?.id || !node.metadata?.ecommerceWorkbench) return node;
                        const work = node.metadata.ecommerceWorkbench;
                        const cleanPatch = patch.status === "running" || patch.status === "succeeded" ? { error: undefined, ...patch } : patch;
                        const steps = work.steps.some((step) => step.id === id) ? work.steps.map((step) => (step.id === id ? { ...step, ...cleanPatch } : step)) : [...work.steps, { id, status: "running" as const, ...cleanPatch }];
                        return {
                            ...node,
                            metadata: {
                                ...node.metadata,
                                ecommerceWorkbench: { ...work, steps },
                                content: content === undefined ? node.metadata.content : content,
                                status: steps.some((step) => step.status === "failed") ? "error" : steps.some((step) => step.status === "running") ? "loading" : "success",
                            },
                        };
                    }),
                );
            };
            let activeStep = request.action as string;
            try {
                const setting = await useEcommerceSettings.getState().load();
                check();
                if (!setting.enabled || !ecommerceCapabilitySettings(setting)[capability]?.enabled) throw new Error("管理员已停用此电商能力");
                if (request.action === "pipeline" && ["pattern", "print-pack", "listing"].some((id) => !ecommerceCapabilitySettings(setting)[id as EcommerceCapability].enabled)) throw new Error("成包流水线依赖的功能已停用");
                if (["pattern", "layers"].includes(request.action)) throw new Error("请选择具体的工作台操作");
                validateEcommerceWorkbenchBrief(request.brief);
                if (!request.resumeReceiptId && (request.generateAfterPlanning || request.action === "studio-generate")) ecommerceImageSettings(config, request.imageModel || config.imageModel || config.model, request.brief);
                if (request.action === "planning") validateEcommercePlanningCount(request.brief);
                const sources = ecommerceStudioSources(request.sourceIds, nodesRef.current, connectionsRef.current);
                if (request.action === "listing" || request.action === "pipeline") {
                    const products = sources.filter((node) => node.type === CanvasNodeType.Product);
                    const issues = [...new Set((products.length ? products : [undefined]).flatMap((product) => ecommerceCopySourceIssues(product?.metadata?.productProfile)))];
                    if (issues.length) throw new Error(`商品资料还缺：${issues.join("、")}。请回到商品节点补充后再生成 Listing。`);
                }
                const images = sources.filter((node): node is CanvasNodeData => node?.type === CanvasNodeType.Image && Boolean(node.metadata?.storageKey || node.metadata?.content));
                if (images.some((node) => node.metadata?.status === "loading" || node.metadata?.status === "error")) throw new Error("请使用已成功的图片");
                const hasProduct = sources.some((node) => node.type === CanvasNodeType.Product);
                if (request.generateAfterPlanning && !images.length && !hasProduct) throw new Error("请先连接商品档案或图片；尚未提交分析或生图任务");
                if (request.generateAfterPlanning && request.brief.generationMode === "product-protected" && !images.length) throw new Error("商品保护模式需要连接商品实拍；尚未提交分析或生图任务");
                const sourceSnapshot = sources.filter((node) => node.id !== request.studioId).map((node) => [node.id, ecommerceStudioSourceSignature(node)]);
                const inputEdges = () => connectionsRef.current.filter((edge) => edge.toNodeId === request.studioId && edge.relation !== "batch-output").map((edge) => [edge.fromNodeId, edge.toHandleId] as const);
                const edgeSnapshot = JSON.stringify(inputEdges());
                const oldWork = nodesRef.current.find((node) => node.id === request.resumeReceiptId)?.metadata?.ecommerceWorkbench;
                const restoredInputs = request.restoreStudioInputs && request.resumeReceiptId === request.studioId && oldWork?.studioSignature ? JSON.parse(ecommerceStudioExecutionSignature(JSON.parse(oldWork.studioSignature))) : undefined;
                let studioSnapshot = ecommerceStudioExecutionSignature(restoredInputs || nodesRef.current.find((node) => node.id === request.studioId)?.metadata?.ecommerceStudio);
                const checkSources = () => {
                    check();
                    if (request.studioId && JSON.stringify(inputEdges()) !== edgeSnapshot) throw new Error("生图台输入连线已变化，请重新执行");
                    if (request.studioId && ecommerceStudioExecutionSignature(nodesRef.current.find((node) => node.id === request.studioId)?.metadata?.ecommerceStudio) !== studioSnapshot) throw new Error("生图台方案或参数已修改，请重新执行");
                    const currentSources = ecommerceStudioSources(request.sourceIds, nodesRef.current, connectionsRef.current);
                    if (currentSources.map((node) => node.id).join() !== sources.map((node) => node.id).join()) throw new Error("输入连线已变化，请重新执行");
                    for (const [id, snapshot] of sourceSnapshot) {
                        const current = nodesRef.current.find((node) => node.id === id);
                        if (!current || ecommerceStudioSourceSignature(current) !== snapshot) throw new Error("源素材已变化，请重新执行");
                    }
                };
                const productContext = sources
                    .filter((node) => node.type === CanvasNodeType.Product)
                    .map((node) => JSON.stringify(node.metadata?.productProfile))
                    .join("\n");
                const textContext = sources
                    .filter((node) => node.type === CanvasNodeType.Text)
                    .map((node) => (node.title || "文本素材") + "：" + (node.metadata?.content || ""))
                    .join("\n\n");
                let studio = request.studioId ? nodesRef.current.find((node) => node.id === request.studioId && node.type === CanvasNodeType.EcommerceStudio && !node.metadata?.locked) : undefined;
                if (request.studioId && !studio) throw new Error("生图台不存在或已锁定");
                const origin = studio ? { x: studio.position.x + studio.width / 2, y: studio.position.y + studio.height / 2 } : center();
                const previousReceipt = request.resumeReceiptId ? nodesRef.current.find((node) => node.id === request.resumeReceiptId && !node.metadata?.locked) : undefined;
                let previousWork = previousReceipt?.metadata?.ecommerceWorkbench;
                const readLegacyPlan = Boolean(
                    previousWork &&
                    !previousWork.inputSignature &&
                    !previousWork.studioSignature &&
                    request.action === "planning" &&
                    !request.generateAfterPlanning &&
                    previousWork.steps.length === 1 &&
                    previousWork.steps[0].id === "planning" &&
                    previousWork.steps[0].taskId,
                );
                const previousSignature = previousWork?.studioSignature ? ecommerceStudioExecutionSignature(JSON.parse(previousWork.studioSignature)) : previousWork?.studioSignature;
                const requestSignature = (value: EcommerceWorkbenchRequest | undefined) => canonicalize({ ...value, resumeReceiptId: undefined, rerunFrom: undefined, retryFailed: undefined, restoreStudioInputs: undefined });
                if (
                    request.resumeReceiptId &&
                    (!previousWork ||
                        previousWork.request?.action !== request.action ||
                        (!readLegacyPlan && (previousWork.inputSignature !== ecommerceStudioInputSignature(request.sourceIds, nodesRef.current, connectionsRef.current) || previousSignature !== studioSnapshot)) ||
                        requestSignature(previousWork.request) !== requestSignature(request))
                )
                    throw new Error("执行输入或配置已变化。可恢复上次参数并读取已有任务；若要保留当前参数，请重新执行");
                if (request.retryFailed && (!previousWork || readLegacyPlan)) throw new Error("旧记录缺少输入快照，请核对后重新执行，不能直接重试");
                if (restoredInputs && studio) {
                    setNodes((current) =>
                        current.map((node) =>
                            node.id === studio!.id ? { ...node, metadata: { ...node.metadata, ecommerceStudio: { ...restoredInputs, adoptedResults: node.metadata?.ecommerceStudio?.adoptedResults, deliveryReview: undefined } } } : node,
                        ),
                    );
                    studio = nodesRef.current.find((node) => node.id === request.studioId)!;
                }
                if (request.rerunFrom) {
                    const order = ["seams", "print-pack", "listing"];
                    const start = order.indexOf(request.rerunFrom);
                    if (request.action !== "pipeline" || !previousWork || start < 0) throw new Error("请选择有效流水线步骤");
                    if (previousWork.steps.some((step) => step.status === "running")) throw new Error("原步骤仍在执行，请停止并到任务中心核对后重跑");
                    if (order.slice(0, start).some((id) => !previousWork!.steps.some((step) => step.id === id && step.status === "succeeded"))) throw new Error("前置步骤尚未完成，请从更早的步骤重跑");
                    previousWork = { ...previousWork, steps: previousWork.steps.filter((step) => order.indexOf(step.id) >= 0 && order.indexOf(step.id) < start) };
                }
                const work = {
                    capability,
                    brief: structuredClone(request.brief),
                    sourceIds: [...request.sourceIds],
                    request: structuredClone(request),
                    inputSignature: ecommerceStudioInputSignature(request.sourceIds, nodesRef.current, connectionsRef.current),
                    studioSignature: studioSnapshot,
                    startedAt: new Date().toISOString(),
                    steps: previousWork?.steps || [],
                };
                receipt = previousReceipt || studio || createCanvasNode(CanvasNodeType.Text, origin, {});
                if (deliveryAction) savedExecution = receipt.metadata;
                receiptIdRef.current = receipt.id;
                if (studio || previousReceipt) setNodes((current) => current.map((node) => (node.id === receipt!.id ? { ...node, metadata: { ...node.metadata, ecommerceWorkbench: work } } : node)));
                else {
                    receipt.title = request.brief.name + " · " + request.action;
                    receipt.metadata = { ...receipt.metadata, content: "准备执行：" + request.brief.name, ecommerceWorkbench: work };
                    setNodes((current) => [...current, receipt!]);
                }
                setSelectedNodeIds(new Set([receipt.id]));
                const reservedResults: CanvasNodeData[] = [];
                const resultPosition = () => ({ x: origin.x + 650, y: origin.y });
                const addResult = (node: CanvasNodeData, connect = true) => {
                    checkSources();
                    if (studio && node.type === CanvasNodeType.Image) node.metadata = { ...node.metadata, ecommerceCandidate: { studioId: studio.id } };
                    node.position = node.metadata?.ecommerceCandidate && studio ? { ...studio.position } : findAvailableGenerationGroupPosition([...nodesRef.current, ...reservedResults], node.position, node);
                    reservedResults.push(node);
                    setNodes((current) => [...current, node]);
                    const studioId = studio?.id;
                    if (studioId && connect) setConnections((current) => [...current, { id: nanoid(), fromNodeId: studioId, toNodeId: node.id }]);
                    return node;
                };
                const localImage = async (blob: Blob, title: string) => {
                    checkSources();
                    const uploaded = await uploadImage(blob);
                    checkSources();
                    const size = fitImageNodeSize(uploaded.width, uploaded.height);
                    const node = addResult({ ...createCanvasNode(CanvasNodeType.Image, resultPosition(), imageMetadata(uploaded)), ...size, title });
                    const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node, source: "canvas-manual" });
                    checkSources();
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: asset.assetId } } : item)));
                    return node;
                };
                const ai = async (mode: "text" | "image", prompt: string, step: string, references = images, shotIndex?: number) => {
                    activeStep = step;
                    checkSources();
                    const inlinePlan = Boolean(studio && mode === "text" && ["planning", "suite-forge"].includes(request.action));
                    const existing = previousWork?.steps.find((item) => item.id === step);
                    let retryTask: GenerationTask | undefined;
                    if (existing?.nodeIds?.length && !existing.taskId) throw new Error("原步骤可能已提交但未收到任务回执，已停止自动重提；请先在任务中心核对");
                    if (existing?.taskId && request.retryFailed) {
                        const original = await queryGenerationTask(existing.taskId, { signal: controller.signal });
                        checkSources();
                        if (original.projectId !== projectId || original.type !== (mode === "text" ? "canvas_text" : "canvas_image")) throw new Error("原任务不属于当前画布或任务类型不符，请到任务中心核对");
                        if (["failed", "cancelled"].includes(original.status)) {
                            if (original.canRecoverMedia || original.billing?.status === "uncertain" || original.providerCancelStatus === "uncertain") throw new Error("原任务存在可恢复素材或状态待核对，请先到任务中心恢复或核对，尚未重新提交");
                            retryTask = original;
                        }
                    }
                    if (existing?.taskId && !retryTask) {
                        const original = await queryGenerationTask(existing.taskId, { signal: controller.signal });
                        if (original.projectId !== projectId || original.type !== (mode === "text" ? "canvas_text" : "canvas_image")) throw new Error("原任务不属于当前画布或任务类型不符，请到任务中心核对");
                        activeTask = original;
                        const targetId = existing.nodeIds?.[0];
                        if (!targetId || !nodesRef.current.some((node) => node.id === targetId && !node.metadata?.locked)) throw new Error("原任务结果节点已删除或锁定，不能恢复；请到任务中心核对");
                        patchStep(step, { status: "running", error: undefined });
                        const task = await waitForGenerationTask(existing.taskId, {
                            signal: controller.signal,
                            onTaskUpdate: (task) => {
                                activeTask = task;
                                checkSources();
                                if (!inlinePlan) bindTask(targetId, task);
                            },
                        });
                        checkSources();
                        if (task.projectId && task.projectId !== projectId) throw new Error("原任务不属于当前画布，不能恢复");
                        if (readLegacyPlan && task.type !== "canvas_text") throw new Error("原任务不是规划文本任务，不能读取");
                        if (!inlinePlan) await applyResult(targetId, task);
                        checkSources();
                        const node = nodesRef.current.find((item) => item.id === targetId);
                        if (!node || (mode === "image" && (!node.metadata?.storageKey || node.metadata.status !== "success"))) throw new Error("原任务结果未落盘，请到任务中心核对");
                        patchStep(step, { status: "succeeded", error: undefined, completedAt: new Date().toISOString() });
                        return { text: mode === "text" ? parseBackendGenerationResult(task).text || "" : "", node };
                    }
                    patchStep(step, { status: "running" });
                    const pending =
                        mode === "image" && shotIndex !== undefined && studio?.metadata?.ecommerceStudio?.plan
                            ? nodesRef.current.find(
                                  (node) =>
                                      node.type === CanvasNodeType.Image &&
                                      node.metadata?.status === "idle" &&
                                      !node.metadata.taskId &&
                                      node.metadata.ecommerceStudioOutput?.studioId === studio!.id &&
                                      node.metadata.ecommerceStudioOutput.shotIndex === shotIndex &&
                                      node.metadata.ecommerceStudioOutput.signature === ecommerceStudioShotSignature(studio!.metadata!.ecommerceStudio!.plan!, shotIndex, request.brief),
                              )
                            : undefined;
                    const target = inlinePlan
                        ? studio!
                        : pending
                          ? { ...pending, metadata: { ...pending.metadata, prompt, model: request.imageModel, status: "loading" as const } }
                          : createCanvasNode(mode === "text" ? CanvasNodeType.Text : CanvasNodeType.Image, resultPosition(), { prompt, status: "loading", model: mode === "text" ? request.textModel : request.imageModel, count: 1 });
                    if (studio?.metadata?.ecommerceStudio?.plan && shotIndex !== undefined) {
                        target.title = studio.metadata.ecommerceStudio.plan.shots[shotIndex].title;
                        target.metadata = {
                            ...target.metadata,
                            ecommerceRunId: nanoid(),
                            ecommerceStudioOutput: {
                                studioId: studio.id,
                                shotIndex,
                                signature: ecommerceStudioShotSignature(studio.metadata.ecommerceStudio.plan, shotIndex, studio.metadata.ecommerceStudio.brief),
                                sourceIds: [...request.sourceIds],
                                sourceSignature: ecommerceStudioInputSignature(request.sourceIds, nodesRef.current, connectionsRef.current),
                                inputIds: [...new Set(inputEdges().map((edge) => edge[0]))].sort(),
                            },
                        };
                    }
                    const refs = references.map(nodeReferenceImage).filter((image): image is NonNullable<typeof image> => Boolean(image));
                    if (refs.length !== references.length) throw new Error("参考图尚未就绪，请核对素材");
                    const referenceManifest = references
                        .map(
                            (node, index) =>
                                `第 ${index + 1} 张附图：${request.action === "suite-forge" ? "套图视觉参考（不作为当前商品事实）" : request.action === "model-cast" ? "模特身份参考" : ecommerceStudioImageRole(node, sources, connectionsRef.current)}`,
                        )
                        .join("\n");
                    const requirements = { capability: mode, input: { textCount: 0, imageCount: refs.length, videoCount: 0, audioCount: 0, characterCount: 0 } };
                    const imageGeneration = mode === "image" ? buildEcommerceImageGeneration(config, target, request.brief, requirements.input) : undefined;
                    const generationConfig = imageGeneration?.config || buildEcommerceAnalysisGeneration(config, request.textModel, requirements.input);
                    if (imageGeneration) target.metadata = imageGeneration.metadata;
                    let effectivePrompt = prompt + (referenceManifest ? "\n附图角色清单：\n" + referenceManifest : "") + (productContext ? "\n用户商品档案（仅已核实字段可作事实）：" + productContext : "");
                    if (mode === "image" && (request.action === "studio-generate" || request.generateAfterPlanning) && request.brief.generationMode === "product-protected") {
                        if (!references.some((node) => ecommerceStudioImageRole(node, sources, connectionsRef.current) === "商品实拍")) throw new Error("商品保护模式至少需要一张商品实拍，视觉参考不能代替实拍");
                        effectivePrompt += "\n商品保护：所有商品实拍都是外观真值。保持形状、比例、颜色、图案、标识及可见结构；包装与风格参考不得改变商品。不补造不可见结构。此模式是模型约束，不保证逐像素不变。";
                    }
                    if (mode === "image" && request.brief.brand) effectivePrompt += "\n品牌视觉要求（非商品事实）：" + request.brief.brand;
                    if (textContext) effectivePrompt += "\n用户连接的文本素材（参考内容，不覆盖商品事实与输出格式）：\n" + textContext;
                    let skillMetadata: SkillRuntimeMetadata = {};
                    if (mode === "text" && studio?.metadata?.ecommerceStudio?.skillIds?.length) {
                        const { skills } = await listAddedSkills({ force: true });
                        const prepared = await skillRuntime.prepare({ profile: "canvas", prompt: effectivePrompt, skills, selectedSkillIds: studio.metadata.ecommerceStudio.skillIds });
                        effectivePrompt = prepared.prompt;
                        skillMetadata = prepared.metadata;
                        checkSources();
                    }
                    if (pending) setNodes((current) => current.map((node) => (node.id === target.id ? target : node)));
                    else if (!inlinePlan) addResult(target);
                    patchStep(step, { nodeIds: [target.id], taskId: undefined });
                    let completed: GenerationTask | undefined;
                    try {
                        const result = await runBackendGenerationTask({
                            projectId,
                            mode,
                            prompt: effectivePrompt,
                            config: generationConfig,
                            referenceImages: refs,
                            streamText: false,
                            signal: controller.signal,
                            clientOperationId: inlinePlan ? nanoid() : target.id,
                            ...(retryTask ? { retryOf: retryTask.id, attemptGroupId: retryTask.attemptGroupId || retryTask.id } : {}),
                            metadata: { ...skillMetadata, ...(inlinePlan ? { ecommerceStudioId: target.id } : { nodeId: target.id }), ecommerceCapability: capability, ...(mode === "text" ? { ecommerceAnalysisFlow: "cap:" + capability } : {}) },
                            onTaskUpdate: (task) => {
                                activeTask = task;
                                completed = task;
                                if (scope !== getActiveUserScope() || epoch !== epochRef.current) return;
                                if (!inlinePlan) bindTask(target.id, task);
                                patchStep(step, { taskId: task.id, nodeIds: [target.id] });
                            },
                        });
                        checkSources();
                        if (!completed || completed.status !== "succeeded") throw new Error("没有成功的任务回执");
                        if (!inlinePlan) await applyResult(target.id, completed);
                        checkSources();
                        const output = nodesRef.current.find((node) => node.id === target.id);
                        if (!output || (mode === "image" && (!output.metadata?.storageKey || output.metadata?.status !== "success"))) throw new Error("生成结果尚未保存为可用素材，请到任务中心核对");
                        if (mode === "image") patchStep(step, { status: "succeeded", completedAt: new Date().toISOString() });
                        return { text: result.text || "", node: output };
                    } catch (error) {
                        let detail = error instanceof Error ? error.message : "执行失败";
                        if (controller.signal.aborted) detail = "已停止后续生成；正在核对已提交任务";
                        if (!inlinePlan && scope === getActiveUserScope() && epoch === epochRef.current)
                            setNodes((current) => current.map((node) => (node.id === target.id ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: detail } } : node)));
                        throw new Error(detail);
                    }
                };
                patchStep(activeStep, { status: "running" });
                const image = images[0];
                if (["seams", "recolor", "print-pack", "pipeline", "export-layers", "pattern-extract", "pattern-derive"].includes(request.action) && !image) throw new Error("请先选择源图片");
                if (request.action === "planning" || request.action === "suite-forge") {
                    if (request.action === "suite-forge" && !images.length) throw new Error("套图反推需要参考图片");
                    const result = await ai("text", ecommerceWorkbenchPrompt(request.action, request.brief), request.action);
                    const plan = parseEcommerceWorkbenchPlan(result.text);
                    if (request.action === "planning" && plan.shots.length !== request.brief.count) throw new Error("模型返回张数与计划不一致，请调整后重新规划");
                    if (studio) {
                        const studioId = studio.id;
                        const samePlan = Boolean(previousWork && canonicalize(studio.metadata?.ecommerceStudio?.plan) === canonicalize(plan));
                        setNodes((current) =>
                            current.map((node) =>
                                node.id === studioId
                                    ? {
                                          ...node,
                                          metadata: {
                                              ...node.metadata,
                                              ecommerceStudio: {
                                                  ...node.metadata?.ecommerceStudio,
                                                  brief: structuredClone(request.brief),
                                                  plan,
                                                  textModel: request.textModel,
                                                  imageModel: request.imageModel,
                                                  ...(samePlan ? {} : { planReview: undefined, deliveryReview: undefined, adoptedResults: {} }),
                                              },
                                          },
                                      }
                                    : node,
                            ),
                        );
                        studio = nodesRef.current.find((node) => node.id === studioId)!;
                        studioSnapshot = ecommerceStudioExecutionSignature(studio.metadata?.ecommerceStudio);
                        setNodes((current) => current.map((node) => (node.id === receipt!.id ? { ...node, metadata: { ...node.metadata, ecommerceWorkbench: { ...node.metadata!.ecommerceWorkbench!, studioSignature: studioSnapshot } } } : node)));
                    }
                    patchStep(request.action, { status: "succeeded", nodeIds: [result.node.id] }, !studio ? JSON.stringify(plan, null, 2) : readLegacyPlan ? "已读取原规划；旧记录没有输入快照，请核对当前商品与方案后生成" : "方案已写入生图台");
                    if (request.generateAfterPlanning) {
                        if (!studio) throw new Error("请从生图台执行规划并生成图片");
                        if (!request.brief.reviewRequired) {
                            for (const [index, shot] of plan.shots.entries())
                                await ai("image", shot.prompt! + "\n整套视觉规范：" + plan.style + "\n已核实事实：" + request.brief.facts + "\n禁止项：" + request.brief.forbidden, "shot-" + (index + 1), images, index);
                        } else patchStep(request.action, { status: "succeeded" }, "方案已创建；请在画面方案中确认审核后生成整组");
                    }
                } else if (request.action === "studio-generate") {
                    if (!studio?.metadata?.ecommerceStudio?.plan) throw new Error("请先规划或手动添加画面");
                    if (!images.length && !hasProduct) throw new Error("请连接商品档案或图片，再开始生成");
                    assertEcommerceStudioReview(studio, nodesRef.current, connectionsRef.current);
                    const originalPlan = studio.metadata.ecommerceStudio.plan;
                    const indices = request.shotIndices ?? originalPlan.shots.map((_, index) => index);
                    if (!indices.length || new Set(indices).size !== indices.length || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= originalPlan.shots.length)) throw new Error("选中画面无效");
                    const plan = parseEcommerceWorkbenchPlan(JSON.stringify({ ...originalPlan, name: request.brief.name, shots: indices.map((index) => originalPlan.shots[index]) }));
                    if (plan.shots.some((shot) => !shot.prompt?.trim())) throw new Error("选中画面缺少完整提示词");
                    for (const [position, index] of indices.entries()) {
                        const shot = plan.shots[position];
                        checkSources();
                        await ai("image", shot.prompt! + "\n整套视觉规范：" + plan.style + "\n已核实事实：" + request.brief.facts + "\n禁止项：" + request.brief.forbidden, "shot-" + (index + 1), images, index);
                    }
                } else if (request.action === "studio-place-results" || request.action === "studio-compose") {
                    if (!studio) throw new Error("请从生图台选择图片");
                    const ids = request.resultIds || [];
                    if (!ids.length || new Set(ids).size !== ids.length) throw new Error("请先勾选需要的图片");
                    const outputs = ids.map((id) => {
                        const output = nodesRef.current.find(
                            (node) =>
                                node.id === id &&
                                !node.metadata?.locked &&
                                node.type === CanvasNodeType.Image &&
                                node.metadata?.status === "success" &&
                                node.metadata.storageKey &&
                                connectionsRef.current.some((edge) => edge.fromNodeId === studio!.id && edge.toNodeId === id),
                        );
                        if (!output) throw new Error("选中的图片已删除、锁定或尚未生成完成");
                        if (output.metadata?.ecommerceStudioOutput) validateEcommerceStudioResultInputs(output, nodesRef.current, connectionsRef.current);
                        return output;
                    });
                    if (request.action === "studio-place-results") {
                        setNodes((current) => {
                            const placed = current.filter((node) => !node.metadata?.ecommerceCandidate);
                            const replacements = new Map<string, CanvasNodeData>();
                            for (const output of outputs) {
                                if (!output.metadata?.ecommerceCandidate) continue;
                                const next = { ...output, position: findAvailableGenerationGroupPosition(placed, resultPosition(), output), metadata: { ...output.metadata, ecommerceCandidate: undefined } };
                                placed.push(next);
                                replacements.set(next.id, next);
                            }
                            return current.map((node) => replacements.get(node.id) || node);
                        });
                        setSelectedNodeIds(new Set(ids));
                    } else {
                        if (
                            !Number.isInteger(request.composeWidth ?? 800) ||
                            (request.composeWidth ?? 800) < 320 ||
                            (request.composeWidth ?? 800) > 2400 ||
                            !Number.isInteger(request.composeGap ?? 0) ||
                            (request.composeGap ?? 0) < 0 ||
                            (request.composeGap ?? 0) > 200
                        )
                            throw new Error("长图宽度须为 320–2400px，间距须为 0–200px 的整数");
                        const outputSnapshot = canonicalize(outputs.map((node) => [node.id, node.metadata?.storageKey, node.metadata?.status]));
                        const checkOutputs = () => {
                            checkSources();
                            if (
                                canonicalize(
                                    ids.map((id) => {
                                        const node = nodesRef.current.find((item) => item.id === id && !item.metadata?.locked);
                                        return [node?.id, node?.metadata?.storageKey, node?.metadata?.status];
                                    }),
                                ) !== outputSnapshot
                            )
                                throw new Error("所选图片已变化，请重新合成");
                        };
                        const urls: string[] = [];
                        for (const output of outputs) {
                            urls.push(await imageToDataUrl({ storageKey: output.metadata?.storageKey, url: output.metadata?.content }));
                            checkOutputs();
                        }
                        const composed = await rasterizeEcommerceLongImage({ imageUrls: urls, width: request.composeWidth || 800, gap: request.composeGap ?? 0 });
                        checkOutputs();
                        const blob = await (await fetch(composed.dataUrl, { signal: controller.signal })).blob();
                        const output = await localImage(blob, request.brief.name + " · 详情长图");
                        patchStep(request.action, { status: "succeeded", nodeIds: [output.id] }, "长图已加入待选区，可预览后添加到画布");
                    }
                } else if (request.action === "studio-export") {
                    if (!studio) throw new Error("请从生图台导出结果");
                    const studioId = studio.id;
                    assertEcommerceStudioReview(studio, nodesRef.current, connectionsRef.current, true);
                    const outputs = nodesRef.current.filter((node) => connectionsRef.current.some((edge) => edge.fromNodeId === studioId && edge.toNodeId === node.id));
                    const selection = ecommerceStudioExportSelection(studio, outputs);
                    for (const output of selection.selected.values()) validateEcommerceStudioResultInputs(output, nodesRef.current, connectionsRef.current);
                    const snapshot = JSON.stringify([...selection.selected.values()].map((node) => [node.id, node.metadata?.storageKey, node.metadata?.taskId, node.metadata?.status]));
                    const archive = await buildEcommerceSuiteArchive(selection.rows, selection.selected);
                    checkSources();
                    const current = ecommerceStudioExportSelection(
                        nodesRef.current.find((node) => node.id === studioId)!,
                        nodesRef.current.filter((node) => connectionsRef.current.some((edge) => edge.fromNodeId === studioId && edge.toNodeId === node.id)),
                    );
                    for (const output of current.selected.values()) validateEcommerceStudioResultInputs(output, nodesRef.current, connectionsRef.current);
                    if (JSON.stringify([...current.selected.values()].map((node) => [node.id, node.metadata?.storageKey, node.metadata?.taskId, node.metadata?.status])) !== snapshot) throw new Error("采用结果或图片已变化，请重新导出");
                    saveAs(archive, downloadName(request.brief.name) + "-suite.zip");
                    patchStep(request.action, { status: "succeeded" }, "已导出当前采用的原图与任务清单；上架前请核对商品、文案与平台要求");
                } else if (request.action === "review-plan" || request.action === "review-delivery") {
                    if (!studio) throw new Error("请在生图台中审核");
                    const studioId = studio.id;
                    const delivery = request.action === "review-delivery";
                    if (!delivery && studio.metadata?.ecommerceStudio?.plan?.shots.some((shot) => !shot.title.trim() || !shot.duty.trim() || !shot.prompt?.trim())) throw new Error("请补全每张画面的职责与提示词后审核");
                    const signature = delivery ? ecommerceStudioDeliveryReviewSignature(studio, nodesRef.current, connectionsRef.current) : ecommerceStudioPlanReviewSignature(studio, nodesRef.current, connectionsRef.current);
                    setNodes((current) =>
                        current.map((node) =>
                            node.id === studioId
                                ? { ...node, metadata: { ...node.metadata, ecommerceStudio: { ...node.metadata!.ecommerceStudio!, [delivery ? "deliveryReview" : "planReview"]: { signature, reviewedAt: new Date().toISOString() } } } }
                                : node,
                        ),
                    );
                    patchStep(request.action, { status: "succeeded" }, delivery ? "当前采用结果已人工确认" : "当前方案已人工确认");
                } else if (request.action === "apply-plan" || request.action === "save-template") {
                    const planNode = sources.find((node) => node.metadata?.content && node.type === CanvasNodeType.Text);
                    const plan = studio?.metadata?.ecommerceStudio?.plan || (planNode ? parseEcommerceWorkbenchPlan(planNode.metadata!.content!) : undefined);
                    if (!plan) throw new Error("请先规划画面，或选择方案文本节点");
                    if (request.action === "save-template") {
                        await useEcommerceTemplateLibrary.getState().save({
                            id: "forge-" + nanoid(),
                            name: plan.name,
                            flow: "detail",
                            category: request.brief.name,
                            style: plan.style,
                            source: "套图工坊 · 人工选用",
                            enabled: true,
                            shots: plan.shots.map((shot) => ({ title: shot.title, duty: [shot.duty, shot.prompt ? "画面参考（须按当前商品事实改写）：" + shot.prompt : ""].filter(Boolean).join("\n") })),
                        });
                        checkSources();
                    } else {
                        const target = addResult(
                            createCanvasNode(
                                CanvasNodeType.EcommerceStudio,
                                { x: origin.x + 1100, y: origin.y },
                                { ecommerceStudio: { brief: structuredClone(request.brief), plan: structuredClone(plan), textModel: request.textModel, imageModel: request.imageModel } },
                            ),
                            false,
                        );
                        setConnections((current) => [...current, ...sources.filter((node) => node.type === CanvasNodeType.Product || node.type === CanvasNodeType.Image).map((node) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: target.id }))]);
                        setSelectedNodeIds(new Set([target.id]));
                    }
                    patchStep(request.action, { status: "succeeded" }, request.action === "save-template" ? "已保存到当前账号的私人浏览器模板库" : "已创建并连接独立电商生图台");
                } else if (request.action === "model-cast") {
                    if (!request.brief.identity.trim() || !request.brief.poses.length || request.brief.poses.length > 8) throw new Error("请填写成年模特身份并选择 1–8 个姿态");
                    let identity = images.slice(0, 1);
                    for (const [index, pose] of request.brief.poses.entries()) {
                        const result = await ai("image", ecommerceWorkbenchPrompt("model-cast", { ...request.brief, poses: [pose] }), "pose-" + (index + 1), identity);
                        if (!identity.length) identity = [result.node];
                    }
                    patchStep(request.action, { status: "succeeded" }, "多姿态结果已生成，请核对同一身份后选中图片保存为模特");
                } else if (request.action === "save-model") {
                    if (!images.length || images.some((node) => !node.metadata?.storageKey)) throw new Error("请选择已保存的模特参考图");
                    await useEcommerceModelLibrary.getState().addModel(
                        createEcommerceModel(
                            request.brief.name,
                            images.map((node) => node.metadata!.storageKey!),
                        ),
                    );
                    checkSources();
                    patchStep(request.action, { status: "succeeded" }, "已保存为当前账号的私人模特");
                } else if (request.action === "save-pattern") {
                    if (!image?.metadata?.storageKey) throw new Error("请选择已保存的花型图片");
                    await useEcommercePatternLibrary.getState().save({ id: nanoid(), name: request.brief.name, storageKey: image.metadata.storageKey, tags: [], createdAt: new Date().toISOString() });
                    checkSources();
                    patchStep(request.action, { status: "succeeded" }, "已保存到当前账号的本机花型库");
                } else if (request.action === "add-pattern") {
                    await useEcommercePatternLibrary.getState().hydrate();
                    checkSources();
                    const pattern = useEcommercePatternLibrary.getState().patterns.find((item) => item.id === request.patternId);
                    if (!pattern) throw new Error("请先选择我的花型");
                    const url = await resolveImageUrl(pattern.storageKey);
                    const raster = await loadRasterImage(url);
                    checkSources();
                    const node = addResult({
                        ...createCanvasNode(CanvasNodeType.Image, resultPosition(), { storageKey: pattern.storageKey, content: url, status: "success" }),
                        ...fitImageNodeSize(raster.naturalWidth, raster.naturalHeight),
                        title: pattern.name,
                    });
                    const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node, source: "canvas-manual" });
                    checkSources();
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: asset.assetId } } : item)));
                    patchStep(request.action, { status: "succeeded", nodeIds: [node.id] }, "私人花型已添加到画布");
                } else if (request.action.startsWith("pattern-")) {
                    await ai("image", ecommerceWorkbenchPrompt(request.action as "pattern-extract", request.brief), request.action);
                } else if (request.action === "listing") {
                    const result = await ai("text", ecommerceWorkbenchPrompt("listing", request.brief), "listing");
                    patchStep("listing", { status: "succeeded" }, result.text);
                } else if (request.action === "recolor") {
                    const result = await localImage(await recolorPatternNode(image, request.from, request.to, request.tolerance), request.brief.name + " · 改色");
                    patchStep("recolor", { status: "succeeded", nodeIds: [result.id] }, "确定性改色完成；源图保留");
                } else if (request.action === "seams") {
                    const verdict = inspectPatternSeams(await readPatternPixels(image));
                    checkSources();
                    patchStep("seams", { status: "succeeded" }, JSON.stringify(verdict, null, 2));
                } else if (request.action === "print-pack" || request.action === "pipeline") {
                    if (request.action === "pipeline") {
                        const verdict = inspectPatternSeams(await readPatternPixels(image));
                        checkSources();
                        patchStep("seams", { status: verdict.passed || request.layout !== "tile" ? "succeeded" : "failed" }, JSON.stringify(verdict, null, 2));
                        if (request.layout === "tile" && !verdict.passed) throw new Error("满印验缝未通过，流水线已停止；请复核图稿或明确改选单区域排版");
                    }
                    activeStep = "print-pack";
                    patchStep(activeStep, { status: "running" });
                    let result = await buildPatternPrintPack(image, request.widthCm, request.heightCm, request.layout, "", checkSources, request.printSpecId);
                    const priorPrint = previousWork?.steps.find((step) => step.id === "print-pack" && step.status === "succeeded");
                    const previousOutput = priorPrint?.nodeIds?.[0] ? nodesRef.current.find((node) => node.id === priorPrint.nodeIds![0] && node.metadata?.storageKey && node.metadata.status === "success") : undefined;
                    if (priorPrint && !previousOutput) throw new Error("原印刷产物已删除或不可用，请重新执行规格包");
                    const output = previousOutput || (await localImage(result.image, request.brief.name + " · 300DPI"));
                    patchStep("print-pack", { status: "succeeded", nodeIds: [output.id] });
                    if (request.action === "pipeline") {
                        const listing = await ai("text", ecommerceWorkbenchPrompt("listing", request.brief), "listing");
                        result = await buildPatternPrintPack(image, request.widthCm, request.heightCm, request.layout, listing.text, checkSources, request.printSpecId);
                        patchStep("listing", { status: "succeeded" });
                    }
                    checkSources();
                    saveAs(result.archive, downloadName(request.brief.name) + "-print-pack.zip");
                    patchStep(request.action, { status: "succeeded" }, JSON.stringify(result.manifest, null, 2));
                } else if (request.action === "export-layers") {
                    const archive = await buildEcommerceLayerArchive(
                        images.map((node) => ({ node, visible: request.layerVisibility[node.id] !== false })),
                        checkSources,
                    );
                    checkSources();
                    saveAs(archive, downloadName(request.brief.name) + "-layers.zip");
                    patchStep(request.action, { status: "succeeded" }, "已导出真实图层 PNG、PSD 与清单");
                }
                patchStep(request.action, { status: "succeeded", completedAt: new Date().toISOString() });
                return receipt.id;
            } catch (error) {
                if (controller.signal.aborted && activeTask && ["queued", "running"].includes(activeTask.status) && scope === getActiveUserScope()) {
                    try {
                        const cancelled = await cancelGenerationTask(activeTask.id);
                        error = new Error(cancelled.providerCancelStatus === "confirmed" ? "已停止后续生成，上游已确认取消" : "已停止后续生成，已请求取消当前任务；上游尚未确认，已提交任务仍可能计费，请到任务中心核对");
                    } catch {
                        error = new Error("已停止后续生成；上游取消未确认，请到任务中心核对，已提交任务仍可能计费");
                    }
                }
                if (receipt) {
                    const detail = error instanceof Error ? error.message : "执行失败";
                    patchStep(activeStep, { status: "failed", error: detail, completedAt: new Date().toISOString() });
                    if (activeStep !== request.action) patchStep(request.action, { status: "failed", error: detail });
                }
                throw error;
            } finally {
                if (receipt && scope === getActiveUserScope() && epoch === epochRef.current)
                    setNodes((current) =>
                        current.map((node) =>
                            node.id === receipt!.id && node.metadata?.ecommerceWorkbench
                                ? { ...node, metadata: { ...node.metadata, ecommerceWorkbench: { ...node.metadata.ecommerceWorkbench, finishedAt: new Date().toISOString(), stopped: controller.signal.aborted } } }
                                : node,
                        ),
                    );
                if (deliveryAction && receipt && savedExecution && scope === getActiveUserScope() && epoch === epochRef.current)
                    setNodes((current) => current.map((node) => (node.id === receipt!.id ? { ...node, metadata: { ...node.metadata, status: savedExecution!.status, ecommerceWorkbench: savedExecution!.ecommerceWorkbench } } : node)));
                if (controllerRef.current === controller) {
                    controllerRef.current = null;
                    receiptIdRef.current = null;
                    setBusy(false);
                }
            }
        },
        [projectId, domainProjectId, nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, center, applyResult, bindTask, config],
    );
    return {
        run,
        busy,
        stop: () => {
            controllerRef.current?.abort();
            setNodes((current) =>
                current.map((node) => (node.id === receiptIdRef.current && node.metadata?.ecommerceWorkbench ? { ...node, metadata: { ...node.metadata, ecommerceWorkbench: { ...node.metadata.ecommerceWorkbench, stopped: true } } } : node)),
            );
        },
        isRunning: (nodeId: string) => Boolean(controllerRef.current && receiptIdRef.current === nodeId),
    };
}
