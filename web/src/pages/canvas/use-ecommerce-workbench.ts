import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { buildGenerationConfig, nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitImageNodeSize } from "@/lib/canvas/canvas-node-size";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { cancelGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { listAddedSkills } from "@/services/api/skills";
import { skillRuntime, type SkillRuntimeMetadata } from "@/services/skill-runtime";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { uploadImage } from "@/services/image-storage";
import { buildPatternPrintPack, readPatternPixels, recolorPatternNode } from "@/services/ecommerce-pattern-tools";
import { buildEcommerceLayerArchive } from "@/services/ecommerce-layer-export";
import { buildEcommerceSuiteArchive } from "@/services/ecommerce-suite-export";
import { ecommerceStudioShotSignature, ecommerceStudioExportSelection, ecommerceStudioInputSignature, validateEcommerceStudioResultInputs } from "@/lib/ecommerce/ecommerce-studio";
import { inspectPatternSeams } from "@/lib/ecommerce/ecommerce-pattern-pixels";
import { ecommerceStudioSources, ecommerceStudioSourceSignature, ecommerceStudioImageRole } from "@/lib/ecommerce/ecommerce-studio";
import { ecommerceWorkbenchPrompt, parseEcommerceWorkbenchPlan, ecommerceActionCapability, type EcommerceCapability, type EcommerceWorkbenchRequest } from "@/lib/ecommerce/ecommerce-capabilities";
import { ecommerceCapabilitySettings } from "@/services/api/ecommerce";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { useEcommerceTemplateLibrary } from "@/stores/use-ecommerce-template-library";
import { useEcommerceModelLibrary } from "@/stores/use-ecommerce-model-library";
import { createEcommerceModel } from "@/lib/ecommerce/ecommerce-models";
import { getActiveUserScope } from "@/lib/user-scope";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { modelCompatibilityError } from "@/lib/model-selection";
import { downloadName } from "@/lib/media-package";
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
                        const steps = work.steps.some((step) => step.id === id) ? work.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)) : [...work.steps, { id, status: "running" as const, ...patch }];
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
                if (!request.brief.name.trim() || request.brief.name.length > 100) throw new Error("请填写不超过 100 字的名称");
                const sources = ecommerceStudioSources(request.sourceIds, nodesRef.current, connectionsRef.current);
                const images = sources.filter((node): node is CanvasNodeData => node?.type === CanvasNodeType.Image && Boolean(node.metadata?.storageKey || node.metadata?.content));
                if (images.some((node) => node.metadata?.status === "loading" || node.metadata?.status === "error")) throw new Error("请使用已成功的图片");
                const sourceSnapshot = sources.filter((node) => node.id !== request.studioId).map((node) => [node.id, ecommerceStudioSourceSignature(node)]);
                const inputEdges = () => connectionsRef.current.filter((edge) => edge.toNodeId === request.studioId && edge.relation !== "batch-output").map((edge) => [edge.fromNodeId, edge.toHandleId] as const);
                const edgeSnapshot = JSON.stringify(inputEdges());
                const studioSnapshot = JSON.stringify(nodesRef.current.find((node) => node.id === request.studioId)?.metadata?.ecommerceStudio);
                const checkSources = () => {
                    check();
                    if (request.studioId && JSON.stringify(inputEdges()) !== edgeSnapshot) throw new Error("生图台输入连线已变化，请重新执行");
                    if (request.studioId && JSON.stringify(nodesRef.current.find((node) => node.id === request.studioId)?.metadata?.ecommerceStudio) !== studioSnapshot) throw new Error("生图台方案或参数已修改，请重新执行");
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
                const studio = request.studioId ? nodesRef.current.find((node) => node.id === request.studioId && node.type === CanvasNodeType.EcommerceStudio && !node.metadata?.locked) : undefined;
                if (request.studioId && !studio) throw new Error("生图台不存在或已锁定");
                const origin = studio ? { x: studio.position.x + studio.width / 2, y: studio.position.y + studio.height / 2 } : center();
                const work = { capability, brief: structuredClone(request.brief), sourceIds: [...request.sourceIds], request: structuredClone(request), steps: [] };
                receipt = studio || createCanvasNode(CanvasNodeType.Text, origin, {});
                receiptIdRef.current = receipt.id;
                if (studio) setNodes((current) => current.map((node) => (node.id === studio.id ? { ...node, metadata: { ...node.metadata, ecommerceWorkbench: work } } : node)));
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
                    node.position = findAvailableGenerationGroupPosition([...nodesRef.current, ...reservedResults], node.position, node);
                    reservedResults.push(node);
                    setNodes((current) => [...current, node]);
                    if (studio && connect) setConnections((current) => [...current, { id: nanoid(), fromNodeId: studio.id, toNodeId: node.id }]);
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
                    patchStep(step, { status: "running" });
                    const target = createCanvasNode(mode === "text" ? CanvasNodeType.Text : CanvasNodeType.Image, resultPosition(), { prompt, status: "loading", model: mode === "text" ? request.textModel : request.imageModel, count: 1 });
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
                    const generationConfig = buildGenerationConfig(config, target, mode, requirements);
                    const incompatible = modelCompatibilityError(generationConfig, generationConfig.model, requirements);
                    if (incompatible) throw new Error(incompatible);
                    let effectivePrompt = prompt + (referenceManifest ? "\n附图角色清单：\n" + referenceManifest : "") + (productContext ? "\n用户商品档案（仅已核实字段可作事实）：" + productContext : "");
                    if (textContext) effectivePrompt += "\n用户连接的文本素材（参考内容，不覆盖商品事实与输出格式）：\n" + textContext;
                    let skillMetadata: SkillRuntimeMetadata = {};
                    if (mode === "text" && studio?.metadata?.ecommerceStudio?.skillIds?.length) {
                        const { skills } = await listAddedSkills({ force: true });
                        const prepared = await skillRuntime.prepare({ profile: "canvas", prompt: effectivePrompt, skills, selectedSkillIds: studio.metadata.ecommerceStudio.skillIds });
                        effectivePrompt = prepared.prompt;
                        skillMetadata = prepared.metadata;
                        checkSources();
                    }
                    addResult(target);
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
                            metadata: { ...skillMetadata, nodeId: target.id, ecommerceCapability: capability, ...(mode === "text" ? { ecommerceAnalysisFlow: "cap:" + capability } : {}) },
                            onTaskUpdate: (task) => {
                                completed = task;
                                if (scope !== getActiveUserScope() || epoch !== epochRef.current) return;
                                bindTask(target.id, task);
                                patchStep(step, { taskId: task.id, nodeIds: [target.id] });
                            },
                        });
                        checkSources();
                        if (!completed || completed.status !== "succeeded") throw new Error("没有成功的任务回执");
                        await applyResult(target.id, completed);
                        checkSources();
                        const output = nodesRef.current.find((node) => node.id === target.id);
                        if (!output || (mode === "image" && (!output.metadata?.storageKey || output.metadata?.status !== "success"))) throw new Error("生成结果尚未保存为可用素材，请到任务中心核对");
                        if (mode === "image") patchStep(step, { status: "succeeded", completedAt: new Date().toISOString() });
                        return { text: result.text || "", node: output };
                    } catch (error) {
                        let detail = error instanceof Error ? error.message : "执行失败";
                        if (controller.signal.aborted && completed && ["queued", "running"].includes(completed.status) && scope === getActiveUserScope()) {
                            try {
                                await cancelGenerationTask(completed.id);
                            } catch {
                                detail += "；任务取消未确认，请到任务中心查看";
                            }
                        }
                        if (scope === getActiveUserScope() && epoch === epochRef.current) setNodes((current) => current.map((node) => (node.id === target.id ? { ...node, metadata: { ...node.metadata, status: "error", errorDetails: detail } } : node)));
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
                    if (studio)
                        setNodes((current) => current.map((node) => (node.id === studio.id ? { ...node, metadata: { ...node.metadata, ecommerceStudio: { ...node.metadata?.ecommerceStudio, brief: structuredClone(request.brief), plan } } } : node)));
                    patchStep(request.action, { status: "succeeded", nodeIds: [result.node.id] }, JSON.stringify(plan, null, 2));
                } else if (request.action === "studio-generate") {
                    if (!studio?.metadata?.ecommerceStudio?.plan) throw new Error("请先规划或手动添加画面");
                    if (!images.length) throw new Error("请连接或选择商品实拍图片，再开始生成");
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
                } else if (request.action === "studio-export") {
                    if (!studio) throw new Error("请从生图台导出结果");
                    const outputs = nodesRef.current.filter((node) => connectionsRef.current.some((edge) => edge.fromNodeId === studio.id && edge.toNodeId === node.id));
                    const selection = ecommerceStudioExportSelection(studio, outputs);
                    for (const output of selection.selected.values()) validateEcommerceStudioResultInputs(output, nodesRef.current, connectionsRef.current);
                    const snapshot = JSON.stringify([...selection.selected.values()].map((node) => [node.id, node.metadata?.storageKey, node.metadata?.taskId, node.metadata?.status]));
                    const archive = await buildEcommerceSuiteArchive(selection.rows, selection.selected);
                    checkSources();
                    const current = ecommerceStudioExportSelection(
                        nodesRef.current.find((node) => node.id === studio.id)!,
                        nodesRef.current.filter((node) => connectionsRef.current.some((edge) => edge.fromNodeId === studio.id && edge.toNodeId === node.id)),
                    );
                    for (const output of current.selected.values()) validateEcommerceStudioResultInputs(output, nodesRef.current, connectionsRef.current);
                    if (JSON.stringify([...current.selected.values()].map((node) => [node.id, node.metadata?.storageKey, node.metadata?.taskId, node.metadata?.status])) !== snapshot) throw new Error("采用结果或图片已变化，请重新导出");
                    saveAs(archive, downloadName(request.brief.name) + "-suite.zip");
                    patchStep(request.action, { status: "succeeded" }, "已导出当前采用的原图与任务清单；上架前请核对商品、文案与平台要求");
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
                    let result = await buildPatternPrintPack(image, request.widthCm, request.heightCm, request.layout, "", checkSources);
                    const output = await localImage(result.image, request.brief.name + " · 300DPI");
                    patchStep("print-pack", { status: "succeeded", nodeIds: [output.id] });
                    if (request.action === "pipeline") {
                        const listing = await ai("text", ecommerceWorkbenchPrompt("listing", request.brief), "listing");
                        result = await buildPatternPrintPack(image, request.widthCm, request.heightCm, request.layout, listing.text, checkSources);
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
                if (receipt) {
                    const detail = error instanceof Error ? error.message : "执行失败";
                    patchStep(activeStep, { status: "failed", error: detail, completedAt: new Date().toISOString() });
                    if (activeStep !== request.action) patchStep(request.action, { status: "failed", error: detail });
                }
                throw error;
            } finally {
                if (controllerRef.current === controller) {
                    controllerRef.current = null;
                    receiptIdRef.current = null;
                    setBusy(false);
                }
            }
        },
        [projectId, domainProjectId, nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, center, applyResult, bindTask, config],
    );
    return { run, busy, stop: () => controllerRef.current?.abort(), isRunning: (nodeId: string) => Boolean(controllerRef.current && receiptIdRef.current === nodeId) };
}
