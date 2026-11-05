import { translate } from "@/i18n";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig, isGenerationCanceled } from "@/lib/canvas/canvas-project-generation";
import { canvasReferenceImageDimensions } from "@/lib/canvas/canvas-reference-image-size";
import { canvasGenerationPromptMetadata, canvasGenerationRequestFingerprint, runCanvasGenerationSubmissionOnce } from "@/lib/canvas/canvas-generation-submission";
import { isGenerationTaskCapacityError } from "@/lib/canvas/canvas-generation-batch";
import { canvasGenerationInputPrompt } from "@/lib/canvas/canvas-generation-input-prompt";
import { resolveCanvasBatchInputContext } from "@/lib/canvas/canvas-batch-input-snapshot";
import { isRetiredEcommerceNode } from "@/lib/canvas/canvas-retired-nodes";
import { buildTextRewritePrompt } from "@/lib/prompts";
import { resolveCanvasStyleExecution } from "@/lib/canvas/canvas-style-execution";
import { generationFailureMetadata } from "@/lib/generation-error";
import { modelCompatibilityError, modelGroupReferenceLimits, modelPromptLengthError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import { getActiveUserScope } from "@/lib/user-scope";
import type { Skill } from "@/services/api/skills";
import { skillRuntime } from "@/services/skill-runtime";
import { loadPromptMentionedAssets } from "@/services/user-data-sync";
import type { GenerationTask } from "@/services/api/task-center";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasBatchInputSnapshot, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import { executeImageGeneration } from "./canvas-image-generation-executor";
import { executeAudioGeneration, executeVideoGeneration } from "./canvas-media-generation-executors";
import { executeTextGeneration } from "./canvas-text-generation-executor";

type UseCanvasGenerationExecutorOptions = {
    projectId: string;
    domainProjectId?: string;
    addedSkills: Skill[];
    assets: Asset[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    applyGenerationTaskResult: (targetNodeId: string, task: GenerationTask) => Promise<void>;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_ERROR = "error" as const;

export type CanvasNodeGenerationOptions = {
    controller?: AbortController;
    userScope?: string;
    waitForTaskCapacity?: boolean;
    context?: { conversationId?: string; messageId?: string };
    retryContext?: { retryOf: string; attemptGroupId: string; clientOperationId: string };
    onTaskUpdate?: (task: GenerationTask) => void;
    skipDuplicateConfirmation?: boolean;
    inputSnapshot?: CanvasBatchInputSnapshot;
};

export function useCanvasGenerationExecutor({
    projectId,
    domainProjectId,
    addedSkills,
    assets,
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    setRunningNodeId,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    applyGenerationTaskResult,
}: UseCanvasGenerationExecutorOptions) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const submissionLocksRef = useRef(new Map<string, Promise<unknown>>());
    const preparationOwnersRef = useRef(new WeakMap<object, AbortController>());
    const confirmDuplicateSubmission = useCallback(
        () =>
            new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: translate("canvasPage.generation.duplicateTitle"),
                    content: translate("canvasPage.generation.duplicateContent"),
                    okText: translate("canvasPage.generation.duplicateOk"),
                    cancelText: translate("common.cancel"),
                    centered: true,
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        [modal],
    );

    return useCallback(
        (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => {
            const expectedUserScope = options?.userScope ?? getActiveUserScope();
            return runCanvasGenerationSubmissionOnce(
                submissionLocksRef.current,
                nodeId,
                async () => {
                    let requestController = options?.controller;
                    const assertUserScope = () => {
                        if (getActiveUserScope() === expectedUserScope) return;
                        requestController?.abort();
                        throw new DOMException("Account changed during generation", "AbortError");
                    };
                    assertUserScope();
                    const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
                    const failPreflight = (error: unknown) => {
                        const failure = generationFailureMetadata(error, prompt);
                        message.error(failure.errorDetails);
                        if (!options?.waitForTaskCapacity) return;
                        setNodes((current) =>
                            current.map((node) => {
                                if (node.id !== nodeId || node.metadata?.content || node.metadata?.taskId) return node;
                                return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } };
                            }),
                        );
                    };
                    // 旧版电商画布的节点已下线，只保留数据，不再发起生成。
                    if (isRetiredEcommerceNode(sourceNode)) {
                        message.info("该节点类型已下线，不能生成");
                        return;
                    }
                    if (isCanvasNodeGenerating(sourceNode)) {
                        message.info(translate("canvasPage.generation.stillRunning"));
                        return;
                    }
                    if (sourceNode?.type === CanvasNodeType.Video && sourceNode.metadata?.videoEditOperation === "concat") {
                        message.info(translate("canvasPage.generation.mergedNodeNoRegenerate"));
                        return;
                    }
                    // 与提示词面板同一来源：第一张上游参考图决定未选尺寸时的默认比例。
                    const referenceImageSize = mode === "image" ? canvasReferenceImageDimensions(nodeId, nodesRef.current, connectionsRef.current) : undefined;
                    // 节点上存着一份不可用的模型/渠道时 buildGenerationConfig 会抛。
                    // 不接住它，异常会冲出整个提交（批次调度那条路已经单独接了一次），
                    // 节点状态停在「提交中」、用户看到的是点了没反应。
                    let generationConfig;
                    try {
                        generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode, undefined, false, referenceImageSize);
                    } catch (error) {
                        failPreflight(error);
                        return;
                    }
                    const hasLiveBatchChildren =
                        sourceNode?.type === CanvasNodeType.Image && (sourceNode.metadata?.batchChildIds || []).some((childId) => nodesRef.current.some((node) => node.id === childId && node.metadata?.batchRootId === sourceNode.id));
                    const hasStaleImageBatchState =
                        mode === "image" && sourceNode?.type === CanvasNodeType.Image && !sourceNode.metadata?.content && Boolean(sourceNode.metadata?.isBatchRoot || sourceNode.metadata?.batchChildIds?.length) && !hasLiveBatchChildren;
                    if (hasStaleImageBatchState) {
                        setNodes((current) =>
                            current.map((node) => {
                                if (node.id !== sourceNode.id) return node;
                                const metadata = { ...node.metadata };
                                delete metadata.isBatchRoot;
                                delete metadata.batchChildIds;
                                delete metadata.primaryImageId;
                                delete metadata.imageBatchExpanded;
                                delete metadata.batchUsesReferenceImages;
                                return { ...node, metadata };
                            }),
                        );
                    }
                    if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                        navigateToSettings({ continueCreation: true });
                        return;
                    }

                    const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
                    const editingTextNode = mode === "text" && Boolean(sourceTextContent);
                    const markSourceStatus = !sourceNode?.metadata?.content && !editingTextNode;
                    const generationPrompt = options?.inputSnapshot?.context.prompt ?? canvasGenerationInputPrompt(sourceNode, mode, prompt);
                    const isPreparingEmptyImage = mode === "image" && sourceNode?.type === CanvasNodeType.Image && !sourceNode.metadata?.content;
                    const preparationController = startGenerationRequest(nodeId, nodeId, nodeId, options?.controller);
                    requestController = preparationController;
                    const ownPreparationMetadata = <T extends object>(metadata: T) => {
                        preparationOwnersRef.current.set(metadata, preparationController);
                        return metadata;
                    };
                    const finishOwnedPreparation = () => {
                        const currentMetadata = nodesRef.current.find((node) => node.id === nodeId)?.metadata;
                        const ownsNodeState = Boolean(currentMetadata && preparationOwnersRef.current.get(currentMetadata) === preparationController);
                        const superseded = preparationController.signal.aborted && getActiveUserScope() === expectedUserScope && !ownsNodeState;
                        finishGenerationRequest(nodeId, preparationController);
                        if (superseded) return;
                        setRunningNodeId((current) => (current === nodeId ? null : current));
                        setNodes((current) =>
                            current.map((node) => {
                                if (node.id !== nodeId || !node.metadata || preparationOwnersRef.current.get(node.metadata) !== preparationController || node.metadata.status !== NODE_STATUS_LOADING || node.metadata.taskId) return node;
                                const metadata = { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined };
                                delete metadata.taskId;
                                delete metadata.taskStatus;
                                delete metadata.taskProgress;
                                delete metadata.taskStage;
                                delete metadata.taskCreatedAt;
                                delete metadata.taskUpdatedAt;
                                delete metadata.taskStartedAt;
                                delete metadata.taskCompletedAt;
                                delete metadata.taskDurationMs;
                                return { ...node, metadata };
                            }),
                        );
                    };
                    try {
                        setRunningNodeId(nodeId);
                        if (markSourceStatus)
                            setNodes((current) =>
                                current.map((node) =>
                                    node.id === nodeId
                                        ? {
                                              ...node,
                                              metadata: ownPreparationMetadata({
                                                  ...node.metadata,
                                                  ...canvasGenerationPromptMetadata(prompt, prompt),
                                                  status: NODE_STATUS_LOADING,
                                                  taskStage: "正在准备参考素材",
                                                  taskProgress: 0,
                                                  taskCreatedAt: new Date().toISOString(),
                                                  errorDetails: undefined,
                                                  generationErrorCode: undefined,
                                                  resourceReloadAvailable: undefined,
                                                  failedPromptFingerprint: undefined,
                                              }),
                                          }
                                        : node,
                                ),
                            );

                        let rawGenerationContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>>;
                        // AutoDL/其他声明式视频协议需要结构化参考素材；只有普通
                        // 模型视频接口才把提示词视为纯文本输入。
                        const usesWorkflowProvider = Boolean(mode !== "text" && generationConfig.taskWorkflowProvider && generationConfig.taskWorkflowProvider !== "model");
                        // 普通视频协议只保留输入框文本（显式 @文本 引用仍会展开为真实内容）；声明式工作流还要保留连接媒体。
                        const promptOnly = mode === "video" && !usesWorkflowProvider;
                        try {
                            const contextPrompt = editingTextNode ? buildTextRewritePrompt(sourceTextContent, prompt) : generationPrompt;
                            // 批量快照已在入队时解析过引用；其余路径先补齐提示词引用的素材，再用最新列表解析。
                            const contextAssets = options?.inputSnapshot ? assets : await loadPromptMentionedAssets(contextPrompt);
                            const baseContext = resolveCanvasBatchInputContext(options?.inputSnapshot, () => buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, contextPrompt, contextAssets, promptOnly));
                            const requirements = generationModelRequirements(mode, baseContext, sourceNode, generationConfig, true);
                            generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode, requirements, false, referenceImageSize);
                            const compatibilityError = usesWorkflowProvider ? "" : modelCompatibilityError(generationConfig, generationConfig.model, requirements);
                            if (compatibilityError) throw new Error(translate("canvasPage.generation.modelIncompatible", { error: compatibilityError }));
                            const referenceLimits = usesWorkflowProvider ? undefined : modelGroupReferenceLimits(effectiveConfig, generationConfig.model, mode, requirements);
                            rawGenerationContext = await hydrateNodeGenerationContext(baseContext, projectId, domainProjectId, mode, mode === "video" && Boolean(referenceLimits?.maxAudios), !promptOnly, referenceLimits, false);
                            const hydratedRequirements = generationModelRequirements(mode, rawGenerationContext, sourceNode, generationConfig);
                            generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode, hydratedRequirements, false, referenceImageSize);
                            const hydratedCompatibilityError = usesWorkflowProvider ? "" : modelCompatibilityError(generationConfig, generationConfig.model, hydratedRequirements);
                            if (hydratedCompatibilityError) throw new Error(translate("canvasPage.generation.modelIncompatible", { error: hydratedCompatibilityError }));
                        } catch (error) {
                            failPreflight(error);
                            return;
                        }

                        let skillExecution: Awaited<ReturnType<typeof skillRuntime.prepare<"canvas">>>;
                        try {
                            skillExecution = await skillRuntime.prepare({ profile: "canvas", prompt: rawGenerationContext.prompt, skills: addedSkills });
                        } catch (error) {
                            failPreflight(error);
                            return;
                        }
                        let effectivePrompt = skillExecution.prompt.trim();
                        let styleMetadata = {};
                        if (mode === "image") {
                            try {
                                const styleRuntime = resolveCanvasStyleExecution(nodesRef.current, sourceNode, effectivePrompt, generationConfig, mode);
                                if (styleRuntime) {
                                    effectivePrompt = styleRuntime.prompt;
                                    styleMetadata = { styleProfileJson: styleRuntime.profileJson, styleExecutionPlan: styleRuntime.plan };
                                }
                            } catch (error) {
                                failPreflight(error);
                                return;
                            }
                        }
                        const promptLengthError = mode === "video" ? modelPromptLengthError(generationConfig, generationConfig.model, mode, effectivePrompt) : "";
                        if (promptLengthError) {
                            failPreflight(new Error(promptLengthError));
                            return;
                        }
                        const generationContext = { ...rawGenerationContext, prompt: effectivePrompt };
                        if (mode === "audio" && generationContext.characterReferences.length) {
                            if (generationContext.characterReferences.length !== 1) {
                                message.error(translate("canvasPage.generation.voiceOneCharacter"));
                                return;
                            }
                            const voice = generationContext.resolvedCharacterVoices[0];
                            if (!voice) {
                                message.error(translate("canvasPage.generation.voiceNotBound"));
                                return;
                            }
                            generationConfig = { ...generationConfig, audioVoice: voice.voiceKey, audioInstructions: [voice.instructions, generationConfig.audioInstructions].filter(Boolean).join("；") };
                        }
                        if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                            return;
                        }

                        const requestFingerprint = canvasGenerationRequestFingerprint({
                            nodeId,
                            mode,
                            prompt: effectivePrompt,
                            model: generationConfig.model,
                            options: modelRequestOptions(generationConfig, mode),
                            workflow:
                                generationConfig.taskWorkflowProvider && generationConfig.taskWorkflowProvider !== "model"
                                    ? {
                                          provider: generationConfig.taskWorkflowProvider,
                                          workflowId: generationConfig.runningHub.workflowId,
                                          workflowKind: generationConfig.runningHub.selectedKind,
                                          parameters: sourceNode?.metadata?.workflowParameters,
                                      }
                                    : undefined,
                            operation: sourceNode?.metadata?.videoEditOperation,
                            audioInstructions: generationConfig.audioInstructions,
                            audioEmotionControlMethod: generationConfig.audioEmotionControlMethod,
                            audioEmotionRandom: generationConfig.audioEmotionRandom,
                            audioEmotionHappy: generationConfig.audioEmotionHappy,
                            audioEmotionAngry: generationConfig.audioEmotionAngry,
                            audioEmotionSad: generationConfig.audioEmotionSad,
                            audioEmotionAfraid: generationConfig.audioEmotionAfraid,
                            audioEmotionDisgusted: generationConfig.audioEmotionDisgusted,
                            audioEmotionMelancholic: generationConfig.audioEmotionMelancholic,
                            audioEmotionSurprised: generationConfig.audioEmotionSurprised,
                            audioEmotionCalm: generationConfig.audioEmotionCalm,
                            promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation,
                            promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables,
                            context: generationContext,
                        });
                        const duplicateConfirmationRequired = !options?.skipDuplicateConfirmation && !options?.retryContext && sourceNode?.metadata?.lastGenerationRequestFingerprint === requestFingerprint;
                        if (duplicateConfirmationRequired && !(await confirmDuplicateSubmission())) {
                            return;
                        }

                        const controller = preparationController;
                        if (controller.signal.aborted) {
                            return;
                        }
                        if (isPreparingEmptyImage) {
                            setNodes((current) =>
                                current.map((node) =>
                                    node.id === nodeId
                                        ? {
                                              ...node,
                                              metadata: ownPreparationMetadata({
                                                  ...node.metadata,
                                                  prompt,
                                                  composerContent: prompt,
                                                  status: NODE_STATUS_LOADING,
                                                  taskStage: "正在准备生成任务",
                                                  taskProgress: 0,
                                                  taskCreatedAt: new Date().toISOString(),
                                                  errorDetails: undefined,
                                                  generationErrorCode: undefined,
                                                  resourceReloadAvailable: undefined,
                                                  failedPromptFingerprint: undefined,
                                              }),
                                          }
                                        : node,
                                ),
                            );
                        }

                        // 已有内容节点只是本次生成的来源；任务状态归新目标所有，不能覆盖已成功结果。
                        const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
                        if (markSourceStatus)
                            setNodes((current) =>
                                current.map((node) =>
                                    node.id === nodeId
                                        ? {
                                              ...node,
                                              metadata: ownPreparationMetadata({
                                                  ...node.metadata,
                                                  ...canvasGenerationPromptMetadata(prompt, statusPrompt),
                                                  status: NODE_STATUS_LOADING,
                                                  errorDetails: undefined,
                                                  generationErrorCode: undefined,
                                                  resourceReloadAvailable: undefined,
                                                  failedPromptFingerprint: undefined,
                                              }),
                                          }
                                        : node,
                                ),
                            );

                        let pendingNodeIds: string[] = [];
                        const execution = {
                            projectId,
                            nodeId,
                            sourceNode,
                            canvasNodes: nodesRef.current,
                            canvasConnections: connectionsRef.current,
                            prompt,
                            effectivePrompt,
                            generationConfig,
                            generationContext,
                            controller,
                            expectedUserScope,
                            editingTextNode,
                            styleMetadata,
                            skillMetadata: skillExecution.metadata,
                            taskContext: options?.context,
                            retryContext: options?.retryContext,
                            setNodes,
                            setConnections,
                            setSelectedNodeIds,
                            setSelectedConnectionId,
                            setDialogNodeId,
                            startGenerationRequest,
                            finishGenerationRequest,
                            bindGenerationTask: (targetNodeId: string, task: GenerationTask) => {
                                assertUserScope();
                                bindGenerationTask(targetNodeId, task);
                                setNodes((current) => {
                                    const source = current.find((node) => node.id === nodeId);
                                    if (!source || source.metadata?.lastGenerationRequestFingerprint === requestFingerprint) return current;
                                    return current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, lastGenerationRequestFingerprint: requestFingerprint } } : node));
                                });
                                options?.onTaskUpdate?.(task);
                            },
                            applyGenerationTaskResult: async (targetNodeId: string, task: GenerationTask) => {
                                assertUserScope();
                                await applyGenerationTaskResult(targetNodeId, task);
                            },
                            showError: (content: string) => message.error(content),
                            registerPendingNodeIds: (nodeIds: string[]) => {
                                pendingNodeIds = nodeIds;
                            },
                        };

                        try {
                            assertUserScope();
                            if (mode === "image") await executeImageGeneration(execution);
                            else if (mode === "video") await executeVideoGeneration(execution);
                            else if (mode === "audio") await executeAudioGeneration(execution);
                            else await executeTextGeneration(execution);
                        } catch (error) {
                            if (isGenerationCanceled(error)) return;
                            const failure = generationFailureMetadata(error, prompt);
                            if (options?.waitForTaskCapacity && isGenerationTaskCapacityError(error)) {
                                setNodes((current) =>
                                    current.map((node) => {
                                        if (node.id !== nodeId && !pendingNodeIds.includes(node.id)) return node;
                                        const metadata = { ...(node.metadata || {}), status: NODE_STATUS_IDLE, errorDetails: undefined };
                                        delete metadata.taskId;
                                        delete metadata.taskStatus;
                                        delete metadata.taskProgress;
                                        delete metadata.taskStage;
                                        delete metadata.taskCreatedAt;
                                        delete metadata.taskUpdatedAt;
                                        delete metadata.taskStartedAt;
                                        delete metadata.taskCompletedAt;
                                        delete metadata.taskDurationMs;
                                        return { ...node, metadata };
                                    }),
                                );
                                return;
                            }
                            message.error(failure.errorDetails);
                            setNodes((current) =>
                                current.map((node) => (node.id === nodeId || pendingNodeIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } }) : node)),
                            );
                        }
                    } finally {
                        finishOwnedPreparation();
                    }
                },
                () => message.info({ key: `canvas-generation-submission-${nodeId}`, content: translate("canvasPage.generation.submissionInProgress") }),
            );
        },
        [
            addedSkills,
            applyGenerationTaskResult,
            bindGenerationTask,
            confirmDuplicateSubmission,
            domainProjectId,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            nodesRef,
            connectionsRef,
            projectId,
            setConnections,
            setDialogNodeId,
            setNodes,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startGenerationRequest,
        ],
    );
}

function generationModelRequirements(
    mode: CanvasNodeGenerationMode,
    input: Pick<Awaited<ReturnType<typeof hydrateNodeGenerationContext>>, "textCount" | "imageCount" | "videoCount" | "audioCount" | "characterReferences">,
    sourceNode: CanvasNodeData | undefined,
    config: ReturnType<typeof useEffectiveConfig>,
    includeCharacterMinimum = false,
): ModelRequirements {
    return {
        capability: mode,
        input: {
            textCount: input.textCount,
            imageCount: input.imageCount,
            videoCount: input.videoCount,
            audioCount: input.audioCount,
            characterCount: includeCharacterMinimum ? input.characterReferences.length : 0,
        },
        videoOperation: sourceNode?.metadata?.videoEditOperation,
        videoSeconds: config.videoSeconds,
        options: config.taskWorkflowProvider === "model" ? modelRequestOptions(config, mode) : undefined,
    };
}
