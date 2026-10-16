import { CanvasWorkspacePanel } from "@/components/canvas/canvas-workspace-panel";
import { resolveCanvasKind } from "@/lib/canvas/canvas-kind";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { canCancelGenerationTask } from "@/lib/generation-task-display";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { loadAssetsForUse } from "@/services/user-data-sync";
import { canvasAssetHandoffIds } from "@/lib/canvas/canvas-asset-handoff";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { skillRuntime } from "@/services/skill-runtime";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";
import { modelCompatibilityError } from "@/lib/model-selection";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { navigateToSettings } from "@/lib/settings-navigation";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { createCanvasGenerationLiveProjectAdapter, registerCanvasGenerationLiveProject } from "@/services/canvas-generation-consumer";
import { getActiveUserScope } from "@/lib/user-scope";
import { getResourceAccess, resolveResourceAccessURL, resourceFileUrl, resourceIdFromStorageKey, syncResourceToArkPrivateAsset } from "@/services/api/resources";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { isCanvasImageSourceNode } from "@/lib/canvas/canvas-image-source";
import copyToClipboard from "copy-to-clipboard";
import { nanoid } from "nanoid";
import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, resolveCanvasAppearance, writeCanvasAppearanceDefault, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { persistCanvasMediaPerformanceMode, readCanvasMediaPerformanceMode } from "@/lib/canvas/canvas-performance-mode";
import { filterCanvasDisplayConnections, persistCanvasHideNodeConnections, readCanvasHideNodeConnections } from "@/lib/canvas/canvas-connection-visibility";
import { summarizeCanvasContext } from "@/lib/canvas/canvas-context-summary";
import { refreshCanvasCharacterReferenceNodes } from "@/lib/canvas/canvas-character-reference";
import { useAssetStore } from "@/stores/use-asset-store";
import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useCanvasThemeStore, useCanvasThemeScope } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { App, Button } from "antd";
import { ArrowLeftRight } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { getNodeSpec } from "@/constant/canvas";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasCloudAgentPanel } from "@/components/canvas/canvas-cloud-agent-panel";
import { CanvasActiveTaskPanel } from "@/components/canvas/canvas-active-task-panel";
import { CanvasProjectSidebar } from "@/components/canvas/canvas-project-sidebar";
import { CanvasProjectAssetModal } from "@/components/canvas/canvas-project-asset-modal";
import { CanvasCharacterLibraryModal } from "@/components/canvas/canvas-character-library-modal";
import { CanvasCharacterReferenceNodeContent } from "@/components/canvas/canvas-character-reference-node";
import { CanvasCharacterReferenceModal } from "@/components/canvas/canvas-character-reference-modal";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { createStyleProfileSnapshot, resolveStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { CanvasNodeToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-toolbar";
import { CanvasSubtitleDialog } from "@/components/canvas/canvas-subtitle-dialog";
import { CanvasVideoFrameDialog } from "@/components/canvas/canvas-video-frame-dialog";
import { CanvasVideoSegmentDialog } from "@/components/canvas/canvas-video-segment-dialog";
import { CanvasTimelineDialog } from "@/components/canvas/canvas-timeline-dialog";
import { syncNodeSubtitlesToTimeline } from "@/lib/timeline/timeline-build";
import { CanvasNodeAnglePanel } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeLightingPanel } from "@/components/canvas/canvas-node-lighting-dialog";
import { CanvasTextEditorModal } from "@/components/canvas/canvas-text-editor-modal";
import { CanvasNodeSearchModal } from "@/components/canvas/canvas-node-search-modal";
import { CanvasStylePickerModal } from "@/components/canvas/canvas-style-picker-modal";
import { CanvasPrevisTemplateModal } from "@/components/canvas/previs/canvas-previs-template-modal";
import { CanvasFileDropOverlay } from "@/components/canvas/canvas-file-drop-overlay";
import { CanvasUploadModal } from "@/components/canvas/canvas-upload-modal";
import { CanvasPanoramaConfigModal } from "@/components/canvas/canvas-panorama-config-modal";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { handleListGenerate } from "./list-mode-generator";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { useCanvasCreateCommands } from "@/components/canvas/use-canvas-create-commands";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { getProject, listCharacters, type ProjectAsset } from "@/services/api/projects";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { CanvasShareModal } from "@/components/canvas/canvas-share-modal";
import { CanvasScriptEditor, CanvasScriptNodeContent } from "@/components/canvas/canvas-script-node";
import { CanvasBatchTableNodeContent } from "@/components/canvas/canvas-batch-table-node";
import { BatchGenerationSettingsDialog } from "@/components/canvas/batch-generation-settings-dialog";
import { batchReferenceColumns, promoteLegacyBatchTableSize } from "@/lib/canvas/canvas-batch-table";
import { storyboardMinNodeHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { CanvasPrevisNodePanel } from "@/components/canvas/previs/canvas-previs-node-panel";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import { useFocusMode } from "@/hooks/use-focus-mode";
import { connectCanvasTextMention } from "@/lib/canvas/canvas-text-mention";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import {
    applyCanvasConnectionPromptSync,
    buildCanvasAgentMentionReferences,
    canvasResourceMentionToken,
    buildCanvasNodeMentionReferenceMap,
    buildCanvasResourceReferences,
    getContextDownstreamResourceNodes,
    getContextResourceNodes,
    normalizeCanvasNodeMentionTokens,
    reorderCanvasResourceConnections,
    replaceCanvasReferenceMentions,
    type CanvasResourceReference,
} from "@/lib/canvas/canvas-resource-references";
import { CanvasConnectionCreateMenu, CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasOverlayLayerContainer, CanvasOverlayLayerProvider } from "@/components/canvas/canvas-overlay-layer";
import { CanvasLeaferGraphicsLayer } from "@/components/canvas/canvas-leafer-graphics-layer";
import { CanvasFreeformEmptyState, CanvasLinkedProjectEmptyState, CanvasShortDramaEmptyState, CanvasShortDramaGuide, CanvasStoryInputNodeContent, CanvasStylePlaceholderNodeContent } from "@/components/canvas/canvas-short-drama-entry";
import { resolveCanvasEmptyStateKind } from "@/lib/canvas/canvas-starter";
import { failedImageBatchChildren, markImageBatchRetrying, reconcileImageBatchRoot, restoreUnsubmittedImageBatchChild } from "@/lib/canvas/canvas-image-batch-retry";
import { cinematicStoryboardColumns, createCanvasNode, getInputSummary, isHiddenBatchChild } from "@/lib/canvas/canvas-project-domain";
import { ecommerceModelPresetPrompt, type EcommerceModelPreset } from "@/lib/ecommerce/ecommerce-models";
import { connectedImageNodes, resolveEcommerceInputs } from "@/lib/ecommerce/ecommerce-canvas";
import { buildEcommerceProfileDraftPrompt, parseEcommerceProfileDraft } from "@/lib/ecommerce/ecommerce-draft";
import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { ecommerceOneClickFlow, ecommerceOneClickScreens, type EcommerceOneClickFlowId } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteDraftPrompt, ecommerceSuiteRows, parseEcommerceSuiteDraft } from "@/lib/ecommerce/ecommerce-suite";
import { ecommerceSuiteTargets } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { rasterizeEcommerceDetailPage } from "@/lib/ecommerce/ecommerce-rasterize";
import { generationErrorMessage } from "@/lib/generation-error";
import { saveModelFromImage } from "@/stores/use-ecommerce-model-library";
import { bindStoryboardKeyframes, storyboardKeyframeTime, storyboardRowsFromBatchTable } from "@/lib/canvas/canvas-batch-storyboard";
import { stampCanvasNodeChanges, updateCanvasNode, updateCanvasNodes } from "@/lib/canvas/canvas-node-timestamps";
import { canvasAssetHandoffAttempt, finalizeCanvasAssetHandoff, uninsertedCanvasAssetHandoffPayloads } from "@/lib/canvas/canvas-asset-handoff";
import { batchSourceRestriction } from "@/lib/canvas/canvas-batch-connection";
import { deriveStoryboardPipelineProgress } from "@/lib/canvas/canvas-storyboard-progress";
import { CanvasOperationChangeToast, CanvasMergeStatusToast, CanvasUploadStatusToast } from "./canvas-project-feedback";
import { getGenerationCount } from "@/lib/canvas/canvas-project-generation";
import { cancelGenerationTask } from "@/services/api/task-center";
import { CanvasSyncStatus } from "./canvas-sync-status";
import { CanvasVersionHistory, useCanvasVersionHistory } from "./canvas-version-history";
import { CanvasVersionPreview } from "./canvas-version-preview";
import { CanvasTopBar } from "./canvas-project-top-bar";
import { LibTVImportDialog } from "./components/libtv-import-dialog";
import { TapNowImportDialog } from "./components/tapnow-import-dialog";
import { CanvasFocusModeBar } from "@/components/canvas/canvas-focus-mode-bar";
import { CanvasProjectContextMenu } from "./canvas-project-context-menu";
import { CanvasProjectMediaDialogs } from "./canvas-project-media-dialogs";
import { CanvasProjectSelectionToolbar } from "./canvas-project-selection-toolbar";
import { CanvasProjectStatusDialogs } from "./canvas-project-status-dialogs";
import { CanvasProjectWorldLayers } from "./canvas-project-world-layers";
import { CanvasNodeActionContext, type CanvasNodeActionContextValue } from "@/components/canvas/canvas-node-action-context";
import { bringCanvasNodeToFront, type CanvasNodeStackOrder } from "@/lib/canvas/canvas-node-stack-order";
import { AiArtCritiqueModal } from "@/components/canvas/art-critique/ai-art-critique-modal";
import { CanvasNodeGraphContext, type CanvasNodeGraphContextValue } from "@/components/canvas/canvas-node-graph-context";
import { CanvasRefreshShell } from "./canvas-refresh-shell";
import { queryGenerationTask } from "@/services/api/task-center";
import type { CanvasImageEmotionPayload } from "@/components/canvas/canvas-node-emotion-panel";
import { CanvasEmotionWorkspace } from "@/components/canvas/canvas-emotion-workspace";
import { removeCanvasDrawing } from "@/lib/canvas/canvas-drawing-storage";
import { useCanvasConnectionController } from "./use-canvas-connection-controller";
import { useCanvasOperationHistory } from "./use-canvas-operation-history";
import { useCanvasAssistantVisibility } from "./use-canvas-assistant-visibility";
import { useCanvasActiveTasks } from "./use-canvas-active-tasks";
import { useCanvasStyleWorkflow } from "./use-canvas-style-workflow";
import { useCanvasPrevis } from "./use-canvas-previs";
import { useCanvasGeneration } from "./use-canvas-generation";
import { useCanvasGenerationBatches } from "./use-canvas-generation-batches";
import { useCanvasBatchTable } from "./use-canvas-batch-table";
import { useCanvasGenerationExecutor, type CanvasNodeGenerationOptions } from "./use-canvas-generation-executor";
import { useCanvasGenerationRetry } from "./use-canvas-generation-retry";
import { useCanvasHistory } from "./use-canvas-history";
import { useCanvasKeyboard } from "./use-canvas-keyboard";
import { useCanvasMediaTools } from "./use-canvas-media-tools";
import { useCanvasNodeEditor } from "./use-canvas-node-editor";
import { useCanvasNodeOperations } from "./use-canvas-node-operations";
import { useCanvasProjectLifecycle } from "./use-canvas-project-lifecycle";
import { useCanvasRenderModel } from "./use-canvas-render-model";
import { useCanvasSelectionController } from "./use-canvas-selection-controller";
import { useCanvasShortDrama } from "./use-canvas-short-drama";
import { useCanvasStoryboard } from "./use-canvas-storyboard";
import { useCanvasUpload } from "./use-canvas-upload";
import { useCanvasTimelineAssetInsert } from "./use-canvas-timeline-asset-insert";
import { useCanvasViewportController } from "./use-canvas-viewport-controller";
import {
    CanvasNodeType,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasFolderStyle,
    type CanvasFolderTheme,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type CanvasMediaPerformanceMode,
    type StoryboardColumn,
    type StoryboardShotCount,
    type StoryboardShotDuration,
    type CanvasWorkspaceMode,
    type CanvasToolMode,
    type ContextMenuState,
    type Position,
    type ViewportTransform,
} from "@/types/canvas";
import { ART_CRITIQUE_NODE_TYPE } from "@/lib/art-critique/contracts";
import { copyImageToSystemClipboard } from "./canvas-clipboard";

const CanvasPrevisWorkbench = lazy(() => import("@/components/canvas/previs/canvas-previs-workbench").then((module) => ({ default: module.CanvasPrevisWorkbench })));
const CanvasDrawingEditorModal = lazy(() => import("@/components/canvas/canvas-drawing-editor-modal").then((module) => ({ default: module.CanvasDrawingEditorModal })));

const NODE_STATUS_SUCCESS = "success" as const;
const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];

function visibleGenerationBatch(node: CanvasNodeData) {
    const batches = node.metadata?.generationBatches || [];
    for (let index = batches.length - 1; index >= 0; index -= 1) {
        if (batches[index].status === "queued" || batches[index].status === "running") return batches[index];
    }
    return batches.at(-1);
}

export default function CanvasPage() {
    useCanvasThemeScope();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function InfiniteCanvasPage() {
    // 命令式确认必须走 App.useApp().modal；静态 Modal.confirm 拿不到主题和 App 上下文。
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const params = useParams<{ id: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const projectId = params.id || "";
    const canvasStorageScope = getActiveUserScope();
    const containerRef = useRef<HTMLDivElement>(null);
    const didInitialCenterRef = useRef(false);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const assetHandoffRef = useRef("");

    const effectiveConfig = useEffectiveConfig();
    const assets = useAssetStore((state) => state.assets);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const colorTheme = useCanvasThemeStore((state) => state.theme);
    const setTheme = useCanvasThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const defaultDrawingEngine = useUserStore((state) => state.drawingEngine.defaultEngine);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const previsOnboardingScope = useUserStore((state) => state.user?.id?.trim() || "");
    const nodesRef = useRef<CanvasNodeData[]>([]);
    const [nodes, setNodesState] = useState<CanvasNodeData[]>([]);
    const setNodes = useMemo(() => createCanvasStateWriter(nodesRef, setNodesState, stampCanvasNodeChanges), []);
    const [nodeStackOrder, setNodeStackOrder] = useState<CanvasNodeStackOrder>([]);
    const bringNodeToFront = useCallback((nodeId: string) => {
        setNodeStackOrder((current) => bringCanvasNodeToFront(current, nodeId));
    }, []);
    const [connections, setConnectionsState] = useState<CanvasConnection[]>([]);
    const connectionsRef = useRef<CanvasConnection[]>([]);
    const setConnections = useMemo(() => createCanvasStateWriter(connectionsRef, setConnectionsState), []);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    // 每次发送带递增 id：重复发送同一节点时文本相同，仍需触发一次追加。
    const [agentPrefillRequest, setAgentPrefillRequest] = useState<{ id: number; text: string } | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [canvasAppearance, setCanvasAppearance] = useState<CanvasAppearance>(() => canvasAppearanceForTheme(colorTheme));
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>(DEFAULT_CANVAS_BACKGROUND_MODE);
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [canvasTool, setCanvasTool] = useState<CanvasToolMode>("box-select");
    const [mediaPerformanceMode, setMediaPerformanceMode] = useState<CanvasMediaPerformanceMode>(readCanvasMediaPerformanceMode);
    const [hideNodeConnections, setHideNodeConnections] = useState(readCanvasHideNodeConnections);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const workspaceMode: CanvasWorkspaceMode = "professional";
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [tapNowImportOpen, setTapNowImportOpen] = useState(false);
    const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [arkPrivateAssetUploadNodeId, setArkPrivateAssetUploadNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [textEditorNodeId, setTextEditorNodeId] = useState<string | null>(null);
    const [characterReferenceNodeId, setCharacterReferenceNodeId] = useState<string | null>(null);
    const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false);
    const [characterLibraryPosition, setCharacterLibraryPosition] = useState<Position | undefined>();
    const [drawingNodeId, setDrawingNodeId] = useState<string | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    // 新建预演台镜头必须先选模板：null 表示未在选择中，undefined position 表示用画布中心。
    const [previsTemplateRequest, setPrevisTemplateRequest] = useState<{ position?: Position } | null>(null);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [subtitleNodeId, setSubtitleNodeId] = useState<string | null>(null);
    const [timelineNodeId, setTimelineNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [scriptEditorNodeId, setScriptEditorNodeId] = useState<string | null>(null);
    const [artCritiqueNodeId, setArtCritiqueNodeId] = useState<string | null>(null);
    const artCritiqueRunningRef = useRef(false);
    const [artCritiqueStartRequest, setArtCritiqueStartRequest] = useState<{ nodeId: string; id: string; restart: boolean } | null>(null);
    const [scriptScrollTopById, setScriptScrollTopById] = useState<Record<string, number>>({});
    const [previsNodeId, setPrevisNodeId] = useState<string | null>(null);
    const [versionCompareRootId, setVersionCompareRootId] = useState<string | null>(null);
    const [libTVImportOpen, setLibTVImportOpen] = useState(false);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [shortcutRequestNonce, setShortcutRequestNonce] = useState(0);
    const [cinematicAgentEntry, setCinematicAgentEntry] = useState(false);
    const { assistantOpen, closeAgent, openAgent: openAssistant } = useCanvasAssistantVisibility();
    const agentMentionReferences = useMemo(() => buildCanvasAgentMentionReferences(nodes), [nodes]);

    const { tasks: activeTasks } = useCanvasActiveTasks(projectId, projectLoaded);
    const { focusMode, enterFocusMode, exitFocusMode, toggleFocusMode } = useFocusMode();
    const [focusDockRevealed, setFocusDockRevealed] = useState(false);

    useEffect(() => {
        persistCanvasMediaPerformanceMode(mediaPerformanceMode);
    }, [mediaPerformanceMode]);

    useEffect(() => {
        persistCanvasHideNodeConnections(hideNodeConnections);
    }, [hideNodeConnections]);

    useEffect(() => {
        didInitialCenterRef.current = false;
        setNodeStackOrder([]);
    }, [projectId]);

    useEffect(() => {
        const nodeIds = new Set(nodes.map((node) => node.id));
        setNodeStackOrder((current) => {
            const next = current.filter((nodeId) => nodeIds.has(nodeId));
            return next.length === current.length ? current : next;
        });
    }, [nodes]);

    const chatSessionsRef = useRef(chatSessions);
    const activeChatIdRef = useRef(activeChatId);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const [workspaceOpen, setWorkspaceOpen] = useState(false);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => Promise<void>) | null>(null);

    useEffect(() => {
        if (!projectId) return;
        return registerCanvasGenerationLiveProject({
            scope: canvasStorageScope,
            projectId,
            adapter: createCanvasGenerationLiveProjectAdapter({ nodesRef, connectionsRef, chatSessionsRef, activeChatIdRef, setNodes, setConnections, setChatSessions, setActiveChatId }),
        });
    }, [canvasStorageScope, projectId]);

    const resolvedCanvasAppearance = useMemo(() => resolveCanvasAppearance(canvasAppearance, colorTheme), [canvasAppearance, colorTheme]);
    const applyCanvasAppearance = useCallback(
        (next: CanvasAppearance) => {
            const fallback = canvasAppearanceBaseTheme(next, colorTheme);
            const normalized = normalizeCanvasAppearance(next, fallback);
            setCanvasAppearance(normalized);
            setTheme(canvasAppearanceBaseTheme(normalized, fallback));
        },
        [colorTheme, setTheme],
    );
    const saveCanvasAppearanceDefault = useCallback(
        (next: CanvasAppearance) => {
            writeCanvasAppearanceDefault({ appearance: next, backgroundMode });
            message.success("已保存为当前账号在本机的新建画布默认外观");
        },
        [backgroundMode, message],
    );

    const { getHistoryCleanupContext, historyPausedRef, historyState, redoCanvas, resetHistory, undoCanvas } = useCanvasHistory({
        projectLoaded,
        nodes,
        connections,
        chatSessions,
        activeChatId,
        canvasAppearance,
        backgroundMode,
        showImageInfo,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        applyCanvasAppearance,
        setBackgroundMode,
        setShowImageInfo,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
    });

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, ...getHistoryCleanupContext() });
        },
        [cleanupAssetImages, getHistoryCleanupContext],
    );

    const { loadError, retryLoad, addedSkills, agentCreatedNodes, clearCanvasFiles, createAndOpenProject, currentProject, deleteCurrentProject, renameCurrentProject, reloadLatestCanvasProject, restoreCanvasProjectVersion, saveCanvasProject, forceSaveCanvasProject, updateProject } = useCanvasProjectLifecycle({
        projectId,
        projectLoaded,
        nodes,
        connections,
        chatSessions,
        activeChatId,
        canvasAppearance,
        backgroundMode,
        showImageInfo,
        viewport,
        nodesRef,
        connectionsRef,
        chatSessionsRef,
        activeChatIdRef,
        viewportRef,
        historyPausedRef,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        setCanvasAppearance,
        setBackgroundMode,
        setShowImageInfo,
        setViewport,
        setProjectLoaded,
        resetHistory,
        cleanupAssetImages,
        cleanupCanvasFiles,
    });

    const versions = useCanvasVersionHistory(projectId, restoreCanvasProjectVersion);
    const openVersions = () => { closeAgent(); setVersionCompareRootId(null); versions.show(); };
    const openAgent = useCallback(() => { versions.close(); openAssistant(); }, [versions.close, openAssistant]);

    /**
     * 把选中的节点交给画布助手。
     *
     * instruction 可传：不传只是把节点引用丢进输入框，让用户自己写要干什么；
     * 传了就带上一条准备好的指令——电商节点的「让助手起草档案」走的就是这条路，
     * 用户点一下就有活干，不用自己描述要助手做什么。
     */
    const sendSelectionToAgent = useCallback((nodeId?: string, instruction?: string) => {
        const ids = nodeId ? [nodeId] : Array.from(selectedNodeIdsRef.current);
        const references = ids.map((id) => agentMentionReferences.find((reference) => reference.nodeId === id)).filter((reference): reference is CanvasResourceReference => Boolean(reference));
        if (!references.length) return;
        if (nodeId && !selectedNodeIdsRef.current.has(nodeId)) {
            const selection = new Set([nodeId]);
            selectedNodeIdsRef.current = selection;
            setSelectedNodeIds(selection);
        }
        const text = `${references.map(canvasResourceMentionToken).join(" ")}${instruction?.trim() ? `\n${instruction.trim()}` : " "}`;
        setAgentPrefillRequest((current) => ({ id: (current?.id ?? 0) + 1, text }));
        openAgent();
        setContextMenu(null);
    }, [agentMentionReferences, openAgent]);
    // 修复素材关联仍遵守当前画布版本，不能替用户确认覆盖云端的新内容。
    const confirmForceSaveCanvas = useCallback(() => {
        modal.confirm({
            title: "修复素材关联并保存？",
            content: "核对画布媒体与素材库的关联，补齐缺失素材后保存。若云端已有新版本，会保留本地草稿并提示加载最新版。",
            okText: "修复并保存",
            cancelText: "取消",
            onOk: () => forceSaveCanvasProject(),
        });
    }, [forceSaveCanvasProject, modal]);

    const applyLibTVImport = useCallback(
        async (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => {
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const nextNodes = [...nodesRef.current, ...importedNodes];
            const nextConnections = [...connectionsRef.current, ...importedConnections];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            const saved = await saveCanvasProject({ requireRemote: false });
            if (!saved) {
                nodesRef.current = previousNodes;
                connectionsRef.current = previousConnections;
                setNodes(previousNodes);
                setConnections(previousConnections);
                throw new Error("画布保存失败，已撤销本次 LibTV 导入");
            }
        },
        [saveCanvasProject, setConnections, setNodes],
    );
    const applyTapNowImport = useCallback(
        async (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => {
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const nextNodes = [...nodesRef.current, ...importedNodes];
            const nextConnections = [...connectionsRef.current, ...importedConnections];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            const saved = await saveCanvasProject({ requireRemote: false });
            if (!saved) {
                nodesRef.current = previousNodes;
                connectionsRef.current = previousConnections;
                setNodes(previousNodes);
                setConnections(previousConnections);
                throw new Error("画布保存失败，已撤销本次 TapNow 导入");
            }
        },
        [saveCanvasProject, setConnections, setNodes],
    );
    const linkedProjectId = shortDramaEnabled ? currentProject?.projectId || "" : "";
    // 画布种类决定节点菜单里出现哪一套节点（见 lib/canvas/canvas-kind.ts）。
    // 缺省是自由画布：老画布没有 kind 字段，它们是自由画布。
    const canvasKind = resolveCanvasKind(currentProject?.kind);
    const linkedProjectQuery = useQuery({ queryKey: ["project", linkedProjectId], queryFn: () => getProject(linkedProjectId), enabled: Boolean(linkedProjectId) });
    const refetchLinkedProject = linkedProjectQuery.refetch;
    const archiveNodesToLinkedFolder = useCallback(
        (folder: CanvasNodeData, droppedNodes: CanvasNodeData[]) => {
            const folderId = folder.metadata?.folder?.assetFolderId;
            const domainProjectId = folder.metadata?.folder?.projectId || linkedProjectId;
            if (!folderId || !domainProjectId || !droppedNodes.length) return;
            void Promise.all(droppedNodes.map((node) => ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, folderId, node, source: "canvas-manual" })))
                .then((results) => {
                    const archivedByNodeId = new Map(droppedNodes.map((node, index) => [node.id, { assetId: results[index].assetId, content: node.metadata?.content, previousAssetId: node.metadata?.assetId }]));
                    setNodes((current) =>
                        current.map((node) => {
                            const archived = archivedByNodeId.get(node.id);
                            if (!archived || node.metadata?.content !== archived.content || node.metadata?.assetId !== archived.previousAssetId) return node;
                            return { ...node, metadata: { ...node.metadata, assetId: archived.assetId } };
                        }),
                    );
                    void refetchLinkedProject();
                    message.success(`已归档到“${folder.title}”`);
                })
                .catch((error) => message.error(error instanceof Error ? error.message : "素材归档失败"));
        },
        [linkedProjectId, message, projectId, refetchLinkedProject, setNodes],
    );
    useEffect(() => {
        if (!projectLoaded || !linkedProjectQuery.data) return;
        setNodes((current) => refreshCanvasCharacterReferenceNodes(current, linkedProjectQuery.data.assets));
    }, [linkedProjectQuery.data, projectLoaded, setNodes]);
    const canvasCharacterIds = useMemo(() => {
        const ids = new Set<string>();
        for (const node of nodes) {
            const assetId = node.metadata?.workflowKind === "character" ? node.metadata.characterAssetId?.trim() : "";
            if (assetId) ids.add(assetId);
        }
        return [...ids].sort();
    }, [nodes]);
    const characterCardsQuery = useQuery({ queryKey: ["characters", "canvas-refresh", canvasCharacterIds], queryFn: () => listCharacters({ ids: canvasCharacterIds }), enabled: projectLoaded && canvasCharacterIds.length > 0 });
    useEffect(() => {
        if (!projectLoaded || !characterCardsQuery.data) return;
        const assets = characterCardsQuery.data.characters.map((item) => ({ ...item.asset, character: item.character })) as ProjectAsset[];
        setNodes((current) => refreshCanvasCharacterReferenceNodes(current, assets));
    }, [characterCardsQuery.data, projectLoaded, setNodes]);
    const canvasContext = useMemo(() => summarizeCanvasContext(nodes, selectedNodeIds, linkedProjectQuery.data?.units), [linkedProjectQuery.data?.units, nodes, selectedNodeIds]);
    // 扩展节点（对比/图表/调色）要读自己的上游才能渲染，经 Context 下发；
    // 取上游复用 canvas-resource-references 的实现，别在这里另写一份。必须 memo——
    // 每帧新对象会让所有节点跟着重渲染，错题本里多条崩溃都出在画布高频更新。
    const nodeGraphContext = useMemo<CanvasNodeGraphContextValue>(
        () => ({
            getUpstreamNodes: (nodeId: string) => getContextResourceNodes(nodeId, nodes, connections),
            getDownstreamNodes: (nodeId: string) => getContextDownstreamResourceNodes(nodeId, nodes, connections),
        }),
        [connections, nodes],
    );

    const { applyGenerationTaskResult, bindGenerationTask, finishGenerationRequest, openNodeTaskDetails, runningNodeId, setRunningNodeId, setTaskDetail, startGenerationRequest, taskDetail, taskDetailLoading, taskDetailLogs } = useCanvasGeneration({
        projectId,
        domainProjectId: linkedProjectId,
        projectLoaded,
        nodes,
        nodesRef,
        setNodes,
    });

    const cancelCanvasTask = useCallback(
        (task: import("@/services/api/task-center").GenerationTask) => {
            if (!canCancelGenerationTask(task)) {
                message.info("第三方请求已提交，任务将继续创作，不能取消");
                return;
            }
            modal.confirm({
                title: "取消生成任务？",
                content: "任务会立即停止本地执行；如果已经提交到上游，系统会继续核对取消结果和积分状态。",
                okText: "取消任务",
                okButtonProps: { danger: true },
                cancelText: "继续等待",
                onOk: async () => {
                    const latestTask = taskDetail?.id === task.id ? taskDetail : task;
                    if (!canCancelGenerationTask(latestTask)) {
                        message.info("第三方请求已提交，任务将继续创作，不能取消");
                        return;
                    }
                    try {
                        const next = await cancelGenerationTask(task.id);
                        const node = nodesRef.current.find((item) => item.metadata?.taskId === task.id);
                        if (node) bindGenerationTask(node.id, next);
                        setTaskDetail((current) => (current?.id === task.id ? next : current));
                        await queryClient.invalidateQueries({ queryKey: ["canvas-active-tasks", projectId] });
                        message.success("任务已取消");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "取消任务失败");
                    }
                },
            });
        },
        [bindGenerationTask, message, modal, nodesRef, projectId, queryClient, setTaskDetail, taskDetail],
    );

    useEffect(() => {
        const sessionId = searchParams.get("conversation");
        if (!projectLoaded || !sessionId) return;
        if (!chatSessions.some((session) => session.id === sessionId)) {
            message.warning("未找到要接续的会话，请从首页重新进入。");
        } else {
            activeChatIdRef.current = sessionId;
            setActiveChatId(sessionId);
            openAgent();
        }
        const next = new URLSearchParams(searchParams);
        next.delete("conversation");
        setSearchParams(next, { replace: true });
    }, [projectLoaded, chatSessions, searchParams, setSearchParams, openAgent, message]);

    useEffect(() => {
        if (!projectLoaded || searchParams.get("agent") !== "1") return;
        openAgent();
        const next = new URLSearchParams(searchParams);
        next.delete("agent");
        setSearchParams(next, { replace: true });
    }, [projectLoaded, searchParams, setSearchParams, openAgent]);

    // 沉浸专注进入时收起智能体与小地图、重置 Dock 唤出态；仅响应「进入」瞬间，避免关闭专注内主动唤出的面板。
    const prevFocusModeRef = useRef(focusMode);
    useEffect(() => {
        const enteredFocus = focusMode && !prevFocusModeRef.current;
        prevFocusModeRef.current = focusMode;
        if (!enteredFocus) return;
        closeAgent();
        setIsMiniMapOpen(false);
        setFocusDockRevealed(false);
    }, [closeAgent, focusMode]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useLayoutEffect(() => {
        chatSessionsRef.current = chatSessions;
        activeChatIdRef.current = activeChatId;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
    }, [activeChatId, chatSessions, nodes, connections, selectedNodeIds, viewport]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }));
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                const current = viewportRef.current;
                if (current.x === 0 && current.y === 0 && current.k === 1) {
                    const centered = { x: rect.width / 2, y: rect.height / 2, k: 1 };
                    viewportRef.current = centered;
                    setViewport(centered);
                }
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [projectLoaded]);

    const {
        fitCanvasContent,
        fitCanvasSelection,
        focusCanvasImageNode,
        focusCanvasNode,
        getCanvasCenter,
        handleCanvasDoubleClick,
        handleViewportChange,
        handleViewportPreviewChange,
        previewViewport,
        screenToCanvas,
        setZoomScale,
        zoomCanvasIn,
        zoomCanvasOut,
        zoomToActualSize,
    } = useCanvasViewportController({
        agentCreatedNodes,
        containerRef,
        size,
        viewportRef,
        nodesRef,
        selectedNodeIdsRef,
        setViewport,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        setToolbarNodeId,
    });

    useEffect(() => {
        const project = linkedProjectQuery.data?.project;
        const preset = resolveProjectCanvasStyle(project?.stylePresetId, project?.styleProfileJson);
        if (!projectLoaded || !preset) return;
        const profile = resolveStyleProfile(project?.stylePresetId, project?.styleProfileJson, preset.profile || createStyleProfileSnapshot(preset));
        if (!profile) return;
        const current = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
        const nextMetadata = {
            content: profile.prompt,
            prompt: profile.prompt,
            status: NODE_STATUS_SUCCESS,
            workflowKind: "styleboard" as const,
            workflowTitle: "项目画风",
            workflowDescription: profile.description,
            stylePresetId: profile.presetId,
            styleProfileJson: serializeStyleProfile(profile),
            fontSize: 14,
            locked: true,
        };
        if (current) {
            if (current.metadata?.stylePresetId === profile.presetId && current.metadata?.content === profile.prompt && current.metadata?.styleProfileJson === nextMetadata.styleProfileJson && current.metadata?.locked) return;
            setNodes((nodes) => nodes.map((node) => (node.id === current.id ? { ...node, title: `项目画风 · ${profile.title}`, metadata: { ...node.metadata, ...nextMetadata } } : node)));
            return;
        }
        const node = createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), nextMetadata);
        node.title = `项目画风 · ${profile.title}`;
        node.width = 420;
        node.height = 240;
        setNodes((nodes) => [...nodes, node]);
    }, [getCanvasCenter, linkedProjectQuery.data?.project, projectLoaded, setNodes]);

    const {
        assetPickerOpen,
        closeUploadModal,
        closeAssetPicker,
        createVideoNodeFromBlob,
        fileDropActive,
        handleAssetsInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleProjectAssetsInsert,
        handleProjectChapterInsert,
        handleUploadFiles,
        handleUploadRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteSystemClipboard,
        replaceNodeMedia,
        createFileNode,
        startUploadStatus,
        uploadModalOpen,
        uploadTimelineMedia,
        uploadStatus,
    } = useCanvasUpload({
        canvasId: projectId,
        domainProjectId: linkedProjectId,
        nodesRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        screenToCanvas,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
    });
    const replaceCanvasNodeMedia = useCallback((node: CanvasNodeData) => handleUploadRequest(node.id), [handleUploadRequest]);
    const {
        timelineAddNodeRef,
        timelineMediaAddRef,
        assetInsertScope,
        projectAssetScope,
        projectAssetOpen,
        projectAssetInitialCategory,
        projectAssetInitialFolderId,
        projectAssetInsertPosition,
        handleLibraryAssetsInsert,
        handleTimelineProjectAssetsInsert,
        openProjectAssets,
        openCanvasAssetLibrary,
        openTimelineAssetLibrary,
        closeProjectAssets,
    } = useCanvasTimelineAssetInsert({
        linkedProjectId,
        refetchLinkedProject,
        handleAssetsInsert,
        handleProjectAssetsInsert,
        openAssetsAtPosition,
    });
    const openCharacterLibrary = useCallback((position?: Position) => {
        setCharacterLibraryPosition(position);
        setCharacterLibraryOpen(true);
        setContextMenu(null);
    }, []);
    const selectedCharacterImage = nodes.find((node) => selectedNodeIds.has(node.id) && node.type === CanvasNodeType.Image && resourceIdFromStorageKey(node.metadata?.storageKey));
    const selectedCharacterAudio = nodes.find((node) => selectedNodeIds.has(node.id) && node.type === CanvasNodeType.Audio && resourceIdFromStorageKey(node.metadata?.storageKey));

    useEffect(() => {
        if (!projectLoaded || searchParams.get("mode") !== "handoff") return;
        void loadAssetsForUse(canvasAssetHandoffIds(searchParams)).catch((error) => message.error(error instanceof Error ? error.message : "转入素材读取失败"));
    }, [projectLoaded, searchParams, message]);

    useEffect(() => {
        if (!projectLoaded || !assetsHydrated || searchParams.get("mode") !== "handoff") return;
        const attempt = canvasAssetHandoffAttempt(assets, searchParams);
        const { assetIds, payloads } = attempt;
        if (!assetIds.length) return;
        const assetReadiness = assetIds
            .map((assetId) => {
                const asset = assets.find((candidate) => candidate.id === assetId);
                return `${assetId}:${asset?.kind || "missing"}`;
            })
            .join("|");
        const handoffKey = `${projectId}:${assetReadiness}`;
        if (assetHandoffRef.current === handoffKey) return;
        assetHandoffRef.current = handoffKey;

        if (attempt.kind === "retry") return;
        const pendingPayloads = uninsertedCanvasAssetHandoffPayloads(nodesRef.current, payloads);
        const persistHandoff = async (createdNodes: CanvasNodeData[]) => {
            const finalized = await finalizeCanvasAssetHandoff({
                searchParams,
                currentNodes: nodesRef.current,
                createdNodes,
                persist: async (nextNodes) => {
                    nodesRef.current = nextNodes;
                    updateProject(projectId, { nodes: nextNodes });
                    await flushCanvasStorePersistence();
                },
            });
            setSearchParams(finalized.searchParams, { replace: true });
        };
        const insertion = pendingPayloads.length ? handleProjectAssetsInsert(pendingPayloads) : Promise.resolve([] as CanvasNodeData[]);
        void insertion.then(persistHandoff).catch(() => {
            assetHandoffRef.current = "";
        });
    }, [assets, assetsHydrated, handleProjectAssetsInsert, message, nodesRef, projectId, projectLoaded, searchParams, setSearchParams, updateProject]);

    const {
        angleNodeId,
        lightingNodeId,
        emotionNodeId,
        annotationNodeId,
        annotationEditNodeId,
        createImageReversePromptNodes,
        openPortraitTextureEditor,
        cropImageNode,
        cropNodeId,
        closeFrameDialog,
        closeSegmentDialog,
        extractAudioFromVideo,
        extractVideoFrames,
        extractingVideoFramesNodeId,
        frameDialogNodeId,
        generateNineGridNode,
        generateAngleNode,
        generateLightingNode,
        openPanoramaConfig,
        createPanoramaViewerWithConfig,
        addPanoramaCaptureNode,
        spawnEcommerceMaterials,
        spawnEcommerceShotOutputs,
        exportEcommerceLayout,
        exportEcommerceDetailPage,
        panoramaConfigNodeId,
        setPanoramaConfigNodeId,
        generateEmotionNode,
        handleSegmentConfirm,
        maskEditImageNode,
        maskEditNodeId,
        imageEditNodeId,
        imageEditPreset,
        layerDecompositionNodeId,
        textEditNodeId,
        mergeSelectedVideos,
        mergeVideosByIds,
        mergeVideoProgress,
        saveAnnotatedImageNode,
        segmentDialogMode,
        segmentDialogNodeId,
        segmentRunningMode,
        setFrameDialogNodeId,
        setSegmentDialogNodeId,
        setAngleNodeId,
        setLightingNodeId,
        setEmotionNodeId,
        setAnnotationNodeId,
        setAnnotationEditNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setImageEditNodeId,
        setImageEditPreset,
        openBackgroundRemoval,
        openLayerDecomposition,
        decomposeImageLayers,
        setLayerDecompositionNodeId,
        setTextEditNodeId,
        openTextEditNode,
        openAnnotationEditNode,
        detectImageText,
        editTextImageNode,
        editAnnotatedImageNode,
        editImageNode,
        setUpscaleNodeId,
        splitImageNode,
        openVideoFrameExtractor,
        openVideoSegmentExtractor,
        upscaleImageNode,
        upscaleNodeId,
    } = useCanvasMediaTools({
        projectId,
        domainProjectId: linkedProjectId,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setContextMenu,
        setHoveredNodeId,
        setToolbarNodeId,
        setRunningNodeId,
        startUploadStatus,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
    });

    const handleNodesDeleted = useCallback(
        (removedIds: Set<string>, nextNodes: CanvasNodeData[], removedNodes: CanvasNodeData[]) => {
            const clearDeletedId = (current: string | null) => (current && removedIds.has(current) ? null : current);
            setHoveredNodeId(clearDeletedId);
            setToolbarNodeId(clearDeletedId);
            setDialogNodeId(clearDeletedId);
            setTextEditorNodeId(clearDeletedId);
            setCharacterReferenceNodeId(clearDeletedId);
            setDrawingNodeId(clearDeletedId);
            setInfoNodeId(clearDeletedId);
            setSubtitleNodeId(clearDeletedId);
            setFrameDialogNodeId(clearDeletedId);
            setSegmentDialogNodeId(clearDeletedId);
            setCropNodeId(clearDeletedId);
            setMaskEditNodeId(clearDeletedId);
            setAnnotationNodeId(clearDeletedId);
            setUpscaleNodeId(clearDeletedId);
            setAngleNodeId(clearDeletedId);
            setLightingNodeId(clearDeletedId);
            setEmotionNodeId(clearDeletedId);
            setSuperResolveNodeId(clearDeletedId);
            setPreviewNodeId(clearDeletedId);
            setRunningNodeId(clearDeletedId);
            setScriptEditorNodeId(clearDeletedId);
            setArtCritiqueNodeId(clearDeletedId);
            setPrevisNodeId(clearDeletedId);
            setVersionCompareRootId(clearDeletedId);
            setScriptScrollTopById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))));
            setContextMenu((current) => (current?.type === "node" && removedIds.has(current.nodeId) ? null : current));
            const removedDrawingIds = removedNodes.flatMap((node) => (node.type === CanvasNodeType.Drawing && node.metadata?.drawingId ? [node.metadata.drawingId] : []));
            if (removedDrawingIds.length) {
                void Promise.all(removedDrawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId))).catch(() => message.warning("绘图节点已删除，但本地绘图缓存清理失败"));
            }
            cleanupCanvasFiles({ projectId, nodes: nextNodes, chatSessions });
        },
        [
            chatSessions,
            cleanupCanvasFiles,
            message,
            projectId,
            setAngleNodeId,
            setAnnotationNodeId,
            setArtCritiqueNodeId,
            setCropNodeId,
            setEmotionNodeId,
            setFrameDialogNodeId,
            setLightingNodeId,
            setMaskEditNodeId,
            setSegmentDialogNodeId,
            setUpscaleNodeId,
            setRunningNodeId,
        ],
    );

    const {
        alignSelectedNodes,
        autoArrangeCanvasNodes,
        arrangeSelectedNodes,
        spreadSelectedNodes,
        copyNodesToClipboard,
        copySelectedNodes,
        createFolder,
        createNode,
        createReferenceGroup,
        createStoryboardGroup,
        deleteConnection,
        deleteNodes,
        duplicateNode,
        hasCopiedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        releaseCopiedNodesPastePriority,
        setPrimaryVersion,
        shouldPreferCopiedNodes,
        toggleNodeLocked,
    } = useCanvasNodeOperations({
        projectId,
        defaultDrawingEngine,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        onNodesDeleted: handleNodesDeleted,
    });

    const handleReplaceNodeReference = useCallback(
        (targetNodeId: string, oldReference: { id: string; nodeId?: string; label?: string; title?: string }, sourceNodeId: string) => {
            const sourceNode = nodesRef.current.find((n) => n.id === sourceNodeId);
            if (!sourceNode || sourceNode.id === oldReference.nodeId) return;

            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;

            const configNodeId = previousConnections.find((c) => c.fromNodeId === targetNodeId && previousNodes.find((n) => n.id === c.toNodeId)?.type === CanvasNodeType.Config)?.toNodeId;
            const receiverId = configNodeId || targetNodeId;

            let rewired = false;
            const nextConnections = previousConnections.map((c) => {
                if (!rewired && c.fromNodeId === oldReference.nodeId && (c.toNodeId === targetNodeId || c.toNodeId === configNodeId)) {
                    rewired = true;
                    return { ...c, fromNodeId: sourceNodeId };
                }
                return c;
            });

            if (!rewired) {
                nextConnections.push({
                    id: nanoid(),
                    fromNodeId: sourceNodeId,
                    toNodeId: receiverId,
                });
            }

            const nextReferencesMap = buildCanvasNodeMentionReferenceMap(previousNodes, nextConnections, previousNodes);
            const targetNextReferences = nextReferencesMap.get(targetNodeId) || [];
            const newRef = targetNextReferences.find((r) => r.nodeId === sourceNodeId);

            const targetNode = previousNodes.find((n) => n.id === targetNodeId);
            let nextNodes = previousNodes;
            if (targetNode && newRef) {
                const currentPrompt = targetNode.metadata?.composerContent ?? targetNode.metadata?.prompt ?? "";
                const replacementToken = `@${newRef.label}`;
                const updatedPrompt = replaceCanvasReferenceMentions(currentPrompt, oldReference, replacementToken, sourceNode.title ? sourceNode.title : newRef.label);

                nextNodes = previousNodes.map((n) => (n.id === targetNodeId ? writeCanvasNodePrompt(n, updatedPrompt) : n));
            }

            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            message.success(`已将参考图「${oldReference.label || "参考图"}」替换为「${sourceNode.title || "新图片"}」，提示词已同步更新`);
        },
        [connectionsRef, message, nodesRef, setConnections, setNodes],
    );

    const handleReplaceNodeReferenceFiles = useCallback(
        (_targetNodeId: string, oldReference: { id: string; nodeId?: string; label?: string; title?: string }, files: File[]) => {
            const file = files.find((f) => f.type.startsWith("image/"));
            if (!file || !oldReference.nodeId) return;
            void replaceNodeMedia(oldReference.nodeId, file).then((success: boolean) => {
                if (success) {
                    message.success("参考图片已替换");
                }
            });
        },
        [message, replaceNodeMedia],
    );

    const {
        cancelPendingConnectionCreate,
        closeConnectionCreateMenu,
        connectionTargetAnchorRatio,
        connectionTargetNodeId,
        connectionApproach,
        connectionReplaceHover,
        connectingParams,
        createConnectedNode,
        getConnectionCreateDisabledReason,
        handleConnectStart,
        handleConnectDrop,
        handleBatchConnectionTargetClick,
        batchConnectionPreview,
        beginBatchConnectionMode,
        startBatchConnection,
        mouseWorld,
        pendingConnectionCreate,
    } = useCanvasConnectionController({
        projectId,
        config: effectiveConfig,
        defaultDrawingEngine,
        nodesRef,
        connectionsRef,
        viewportRef,
        scriptScrollTopById,
        screenToCanvas,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        setDrawingNodeId,
        onReplaceReference: handleReplaceNodeReference,
    });

    const batchSourceNodeIds = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id) && !batchSourceRestriction(node)).map((node) => node.id), [nodes, selectedNodeIds]);

    const handleCanvasSelectionStart = useCallback(() => {
        setContextMenu(null);
    }, []);

    const handleNodeInteractionStart = useCallback((selectionModifier: boolean) => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        if (selectionModifier) setDialogNodeId(null);
    }, []);

    const handleSelectedNodeClick = useCallback(
        (node: CanvasNodeData) => {
            // Selection is transient, but the LibTV-style paint order survives
            // deselection so a clicked lower node stays above its neighbours.
            if (node.type !== CanvasNodeType.Frame) bringNodeToFront(node.id);
            if (node.type === CanvasNodeType.Drawing) {
                setDialogNodeId(null);
                setDrawingNodeId(node.id);
            } else if (node.type === CanvasNodeType.Script) {
                setDialogNodeId(null);
            } else if (node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "character" && node.metadata.characterAssetId) {
                setDialogNodeId(null);
                setCharacterReferenceNodeId(node.id);
            } else if (node.type === CanvasNodeType.Text) {
                setDialogNodeId(node.id);
            } else if (node.type === CanvasNodeType.Frame) {
                setDialogNodeId((current) => (current === node.id ? current : null));
            } else if (node.type === ART_CRITIQUE_NODE_TYPE) {
                setDialogNodeId(null);
                setArtCritiqueNodeId(node.id);
            } else if (node.type === CanvasNodeType.Panorama) {
                // 全景节点是纯查看器，没有可编辑提示词，不弹提示词面板。
                setDialogNodeId(null);
            } else {
                // 选择参考媒体时保留当前工作流配置面板，避免点击图片后配置“返回/消失”。
                // 没有工作流配置面板时，媒体节点仍按原逻辑打开自己的面板。
                setDialogNodeId((current) => {
                    const currentNode = current ? nodesRef.current.find((item) => item.id === current) : undefined;
                    return currentNode?.type === CanvasNodeType.Config ? current : node.id;
                });
            }
        },
        [bringNodeToFront, nodesRef],
    );

    const handleNodeBringToFront = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (node && node.type !== CanvasNodeType.Frame) bringNodeToFront(nodeId);
        },
        [bringNodeToFront, nodesRef],
    );

    const handleNodeDragEnd = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node || node.type === CanvasNodeType.Script || node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Panorama || node.type === ART_CRITIQUE_NODE_TYPE || (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId)) {
                setDialogNodeId(null);
                return;
            }
            // A drag selects a new node even though it is not a click. Keep the
            // generation editor bound to the node most recently moved so a stale
            // panel from the previous node cannot reappear after mouse-up.
            setDialogNodeId(node.id);
        },
        [nodesRef],
    );

    const handleCanvasDeselect = useCallback(() => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
    }, []);

    const { alignmentGuides, cancelSelectionBox, deselectCanvas, dragPreview, frameDropTargetId, handleCanvasMouseDown, handleNodeMouseDown, isNodeDragging, nodeDraggingRef, selectionBoundsElementRef, selectionBox } = useCanvasSelectionController({
        containerRef,
        nodesRef,
        viewportRef,
        selectedNodeIdsRef,
        historyPausedRef,
        screenToCanvas,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        cancelPendingConnectionCreate,
        onCanvasSelectionStart: handleCanvasSelectionStart,
        onNodeInteractionStart: handleNodeInteractionStart,
        onNodeBringToFront: handleNodeBringToFront,
        onNodeClick: handleSelectedNodeClick,
        onNodeDragEnd: handleNodeDragEnd,
        onBatchConnectionTarget: handleBatchConnectionTargetClick,
        onLinkedFolderDrop: archiveNodesToLinkedFolder,
        onDeselect: handleCanvasDeselect,
    });

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const {
        collapsingBatchIds,
        downloadNodeImage,
        handleConfigNodeChange,
        handleFolderStyleChange,
        handleFolderThemeChange,
        handleFontSizeChange,
        handleNodeContentChange,
        handleNodePromptChange,
        handleNodeResize,
        handleNodeTitleChange,
        openingBatchIds,
        saveNodeAsset,
        setBatchPrimary,
        toggleBatchExpanded,
        toggleFrameCollapsed,
        toggleNodeFreeResize,
    } = useCanvasNodeEditor({
        canvasId: projectId,
        canvasTitle: currentProject?.title || "未命名画布",
        domainProjectId: linkedProjectId,
        nodesRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setToolbarNodeId,
        setHoveredNodeId,
    });

    const handleRemoveNodeReference = useCallback(
        (targetNodeId: string, reference: CanvasResourceReference) => {
            const referenceNodeId = reference.nodeId;
            if (!referenceNodeId) return;
            // 生成节点可能通过配置节点接收参考，只移除参考来源边，保留目标到配置节点的主链。
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const configNodeId = previousConnections.find((connection) => {
                if (connection.fromNodeId !== targetNodeId) return false;
                return previousNodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config;
            })?.toNodeId;
            const removedConnectionIds = new Set(previousConnections.filter((connection) => connection.fromNodeId === referenceNodeId && (connection.toNodeId === targetNodeId || connection.toNodeId === configNodeId)).map((connection) => connection.id));
            if (!removedConnectionIds.size) return;
            const nextConnections = previousConnections.filter((connection) => !removedConnectionIds.has(connection.id));
            const nextNodes = applyCanvasConnectionPromptSync(previousNodes, previousConnections, previousNodes, nextConnections);
            if (nextNodes !== previousNodes) {
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
            }
            connectionsRef.current = nextConnections;
            setConnections(nextConnections);
            setSelectedConnectionId((current) => (current && removedConnectionIds.has(current) ? null : current));
        },
        [connectionsRef, nodesRef, setConnections, setNodes, setSelectedConnectionId],
    );

    const handleReorderNodeReferences = useCallback(
        (targetNodeId: string, orderedNodeIds: string[]) => {
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const nextConnections = reorderCanvasResourceConnections(targetNodeId, orderedNodeIds, previousNodes, previousConnections);
            if (nextConnections === previousConnections) return;
            const nextNodes = applyCanvasConnectionPromptSync(previousNodes, previousConnections, previousNodes, nextConnections);
            if (nextNodes !== previousNodes) {
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
            }
            connectionsRef.current = nextConnections;
            setConnections(nextConnections);
        },
        [connectionsRef, nodesRef, setConnections, setNodes],
    );

    const handleProjectFolderInsert = useCallback(
        (folderId: string) => {
            const folder = linkedProjectQuery.data?.assetFolders.find((item) => item.id === folderId);
            if (!folder || !linkedProjectId) throw new Error("素材文件夹已不存在，请刷新后重试");
            const style: CanvasFolderStyle = folder.style === "stacked" || folder.style === "midnight" || folder.style === "paper" || folder.style === "cinema" || folder.style === "compact" ? folder.style : "glass";
            const theme: CanvasFolderTheme = folder.theme === "obsidian" || folder.theme === "ember" || folder.theme === "pearl" ? folder.theme : "aurora";
            createFolder(projectAssetInsertPosition, { id: folder.id, projectId: linkedProjectId, title: folder.name, style, theme, createdAt: folder.createdAt });
        },
        [createFolder, linkedProjectId, linkedProjectQuery.data?.assetFolders, projectAssetInsertPosition],
    );

    const handleFrameToggle = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const linkedFolderId = node?.metadata?.folder?.assetFolderId;
            if (linkedFolderId) {
                openProjectAssets("all", node ? { x: node.position.x + node.width + 40, y: node.position.y } : undefined, "canvas", linkedFolderId);
                return;
            }
            toggleFrameCollapsed(nodeId);
        },
        [nodesRef, openProjectAssets, toggleFrameCollapsed],
    );

    const linkedFolderPreviewNodesById = useMemo(() => {
        const result = new Map<string, CanvasNodeData[]>();
        const localById = new Map(assets.map((asset) => [asset.id, asset]));
        for (const asset of linkedProjectQuery.data?.assets || []) {
            if (!asset.folderId) continue;
            const local = localById.get(asset.id);
            const characterCover = asset.character?.representations.find((item) => item.role === "turnaround_sheet") || asset.character?.representations.find((item) => item.role === "primary") || asset.character?.representations[0];
            const type = asset.category === "character" || asset.mediaType === "image" ? CanvasNodeType.Image : asset.mediaType === "video" ? CanvasNodeType.Video : asset.mediaType === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Text;
            const remoteResourceId = resourceIdFromStorageKey(asset.storageKey);
            const storageKey = characterCover
                ? `resource:${characterCover.resourceId}`
                : local?.kind === "image" || local?.kind === "video" || local?.kind === "audio"
                  ? local.data.storageKey
                  : remoteResourceId
                    ? asset.storageKey
                    : undefined;
            const content = characterCover
                ? resourceFileUrl(characterCover.resourceId)
                : local?.kind === "image"
                  ? local.data.dataUrl || local.coverUrl
                  : local?.kind === "video" || local?.kind === "audio"
                    ? local.data.url
                    : local?.kind === "text"
                      ? local.data.content
                      : remoteResourceId
                        ? resourceFileUrl(remoteResourceId)
                        : asset.previewText || "";
            const preview: CanvasNodeData = { id: asset.id, type, title: asset.title, position: { x: 0, y: 0 }, width: 240, height: 160, metadata: { assetId: asset.id, content, storageKey } };
            const current = result.get(asset.folderId) || [];
            current.push(preview);
            result.set(asset.folderId, current);
        }
        return result;
    }, [assets, linkedProjectQuery.data?.assets]);

    useEffect(() => {
        const folders = linkedProjectQuery.data?.assetFolders;
        if (!folders?.length) return;
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const folderId = node.metadata?.folder?.assetFolderId;
                const folder = folderId ? byId.get(folderId) : undefined;
                if (!folder) return node;
                const style: CanvasFolderStyle = folder.style === "stacked" || folder.style === "midnight" || folder.style === "paper" || folder.style === "cinema" || folder.style === "compact" ? folder.style : "glass";
                const theme: CanvasFolderTheme = folder.theme === "obsidian" || folder.theme === "ember" || folder.theme === "pearl" ? folder.theme : "aurora";
                if (node.title === folder.name && node.metadata?.folder?.style === style && node.metadata?.folder?.theme === theme) return node;
                changed = true;
                return { ...node, title: folder.name, metadata: { ...node.metadata, folder: { ...node.metadata!.folder!, style, theme, themeCover: undefined } } };
            });
            return changed ? next : current;
        });
    }, [linkedProjectQuery.data?.assetFolders, setNodes]);

    const {
        activePrevisScene,
        activeNodeId,
        activeScriptNode,
        activeStylePresetId,
        angleNode,
        lightingNode,
        emotionNode,
        annotationNode,
        batchChildCountById,
        batchMotionById,
        configInputsById,
        connectionLayerBounds,
        contextMenuNode,
        cropNode,
        displayConnections,
        frameChildrenById,
        infoNode,
        maskEditNode,
        imageEditNode,
        mentionReferencesByNodeId,
        nodeById,
        nodeRenderLODById,
        previewNode,
        reduceMediaEffects,
        relatedHighlight,
        resourceReferenceByNodeId,
        selectedNodeBounds,
        selectedVideoNodes,
        skillMentionReferences,
        superResolveNode,
        toolbarNode,
        upscaleNode,
        versionCompareNodes,
        visibleNodes,
    } = useCanvasRenderModel({
        nodes,
        connections,
        assets,
        viewport,
        viewportSize: size,
        mediaPerformanceMode,
        selectedNodeIds,
        hoveredNodeId,
        dragPreview,
        collapsingBatchIds,
        addedSkills,
        previsScenes: currentProject?.previsScenes,
        infoNodeId,
        cropNodeId,
        maskEditNodeId,
        imageEditNodeId,
        annotationNodeId,
        splitNodeId: null,
        upscaleNodeId,
        superResolveNodeId,
        angleNodeId,
        lightingNodeId,
        emotionNodeId,
        previewNodeId,
        contextMenu,
        versionCompareRootId,
        previsNodeId,
        scriptEditorNodeId,
        dialogNodeId,
    });

    const visibleDisplayConnections = useMemo(
        () => filterCanvasDisplayConnections(displayConnections, {
            enabled: hideNodeConnections,
            hoveredNodeId,
            selectedNodeIds,
            activeNodeId,
            selectedConnectionId,
        }),
        [activeNodeId, displayConnections, hideNodeConnections, hoveredNodeId, selectedConnectionId, selectedNodeIds],
    );
    useEffect(() => {
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const references = mentionReferencesByNodeId.get(node.id);
                const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt;
                if (!references?.length || !savedPrompt?.includes("@[node:")) return node;
                const normalizedPrompt = normalizeCanvasNodeMentionTokens(savedPrompt, references);
                if (normalizedPrompt === savedPrompt) return node;
                changed = true;
                return {
                    ...node,
                    metadata: node.metadata?.composerContent !== undefined ? { ...node.metadata, composerContent: normalizedPrompt } : { ...node.metadata, prompt: normalizedPrompt },
                };
            });
            return changed ? next : current;
        });
    }, [mentionReferencesByNodeId, setNodes]);
    const dialogNode = dialogNodeId ? nodeById.get(dialogNodeId) || null : null;
    // dragPreview is published on the same pointer-down frame as isNodeDragging.
    // Treat either signal as moving so floating editors disappear before the
    // first preview transform is painted and never affect drag layout.
    const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);
    const subtitleNode = subtitleNodeId ? nodeById.get(subtitleNodeId) || null : null;
    const timelineNode = timelineNodeId ? nodeById.get(timelineNodeId) || null : null;
    const frameNode = frameDialogNodeId ? nodeById.get(frameDialogNodeId) || null : null;
    const segmentNode = segmentDialogNodeId ? nodeById.get(segmentDialogNodeId) || null : null;
    const textEditorNode = textEditorNodeId ? nodeById.get(textEditorNodeId) || null : null;
    const characterReferenceNode = characterReferenceNodeId ? nodeById.get(characterReferenceNodeId) || null : null;
    const drawingNode = drawingNodeId ? nodeById.get(drawingNodeId) || null : null;
    const artCritiqueNode = artCritiqueNodeId ? nodeById.get(artCritiqueNodeId) || null : null;
    const artCritiqueInputs = artCritiqueNode
        ? connections
              .filter((connection) => connection.toNodeId === artCritiqueNode.id)
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((connection) => nodeById.get(connection.fromNodeId))
              .filter((node): node is CanvasNodeData => Boolean(node))
        : [];
    const pendingConnectionSourceNode = pendingConnectionCreate?.connection.handleType === "source" ? nodeById.get(pendingConnectionCreate.connection.nodeId) : null;
    const canCreateDrawingFromConnection = !pendingConnectionCreate?.batchSourceNodeIds?.length && pendingConnectionSourceNode?.type === CanvasNodeType.Image && Boolean(pendingConnectionSourceNode.metadata?.content);

    const openTextNodeEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text && node.type !== CanvasNodeType.Markdown) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        if (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId) {
            setCharacterReferenceNodeId(node.id);
            return;
        }
        setTextEditorNodeId(node.id);
    }, []);

    const openDrawingNode = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Drawing) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        setDrawingNodeId(node.id);
    }, []);

    const openArtCritique = useCallback((node: CanvasNodeData) => {
        if (node.type !== ART_CRITIQUE_NODE_TYPE) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        setArtCritiqueNodeId(node.id);
    }, []);
    const duplicateNodeFromContent = useCallback((node: CanvasNodeData) => duplicateNode(node.id), [duplicateNode]);
    const deleteNodeFromContent = useCallback((node: CanvasNodeData) => deleteNodes(new Set([node.id])), [deleteNodes]);
    const updateNodeFromContent = useCallback((nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => {
        setNodesState((current) => {
            const next = updateCanvasNode(current, nodeId, update);
            nodesRef.current = next;
            return next;
        });
    }, []);
    const pendingMediaUpdatesRef = useRef(new Map<string, (node: CanvasNodeData) => CanvasNodeData>());
    const mediaUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const updateMediaNodeFromContent = useCallback((nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => {
        const previous = pendingMediaUpdatesRef.current.get(nodeId);
        pendingMediaUpdatesRef.current.set(nodeId, previous ? (node) => update(previous(node)) : update);
        if (mediaUpdateTimerRef.current) return;
        mediaUpdateTimerRef.current = setTimeout(() => {
            const updates = pendingMediaUpdatesRef.current;
            pendingMediaUpdatesRef.current = new Map();
            mediaUpdateTimerRef.current = null;
            if (!updates.size) return;
            setNodesState((current) => {
                const next = updateCanvasNodes(current, updates);
                nodesRef.current = next;
                return next;
            });
        }, 120);
    }, []);
    const updateNodeMetadataFromContent = useCallback(
        (nodeId: string, patch: CanvasNodeMetadata) => {
            updateNodeFromContent(nodeId, (node) => ({ ...node, metadata: { ...node.metadata, ...patch } }));
        },
        [updateNodeFromContent],
    );
    /**
     * 电商创作：把画布上的一张图存进模特库。
     *
     * 存的是 storageKey，不是 url——直传失败退回本机时 url 是个重启就失效的
     * blob URL，存它等于模特库过一夜全变空白。
     */
    const saveImageAsModel = useCallback((node: CanvasNodeData) => {
        const ref = node.metadata?.storageKey;
        if (!ref) {
            message.warning("这张图还没落盘，等生成完成后再存");
            return;
        }
        saveModelFromImage(ref, node.title || "新模特");
        message.success(`已把「${node.title || "这张图"}」存为模特，在输入框的「模特」里可以选它`);
    }, [message]);

    /**
     * 电商创作：公共起手式出一张模特参考图。
     *
     * 落一个图片节点再提交生成，而不是在弹窗里悄悄出一张塞进库：
     * 出图要花积分，用户得看得见它、能重出、能删。出完在图上点「存为模特」入库。
     */
    const generateEcommerceModelPreset = useCallback(async (preset: EcommerceModelPreset) => {
        const prompt = ecommerceModelPresetPrompt(preset);
        const imageNode = createCanvasNode(CanvasNodeType.Image, getCanvasCenter(), { prompt });
        imageNode.title = preset.name;
        setNodes((current) => [...current, imageNode]);
        setSelectedNodeIds(new Set([imageNode.id]));
        setSelectedConnectionId(null);
        await generateNodeRef.current?.(imageNode.id, "image", prompt, { skipDuplicateConfirmation: true });
    }, [getCanvasCenter, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    /**
     * 一键流程的收尾：全屏出完 → 装订成详情页长图并切片。
     *
     * 装订是纯装配：九屏已经出好了，长图只是按顺序接起来、按平台上限切开。
     * 交给模型做才是错的——它会顺手重画每一屏，商品就不一致了。
     * 这一步不涉及文字：文字已经和画面一起由模型画在每一屏上了。
     */
    const bindingRef = useRef(new Set<string>());
    useEffect(() => {
        if (!projectLoaded || !exportEcommerceDetailPage) return;
        for (const product of nodes.filter((item) => item.type === CanvasNodeType.Product && item.metadata?.ecommerceOneClick)) {
            const plan = product.metadata!.ecommerceOneClick!;
            if (bindingRef.current.has(product.id)) continue;
            const outputs = plan.nodeIds.map((id) => nodes.find((item) => item.id === id));
            // 有节点被删了就不装订——缺屏的长图交出去比不交更糟
            if (outputs.some((item) => !item)) continue;
            const ready = outputs as CanvasNodeData[];
            if (ready.some((item) => !item.metadata?.content)) continue;
            bindingRef.current.add(product.id);
            void (async () => {
                try {
                    const urls: string[] = [];
                    for (const item of ready) urls.push(await imageToDataUrl({ url: item.metadata?.content, storageKey: item.metadata?.storageKey, name: item.title }));
                    const result = await rasterizeEcommerceDetailPage({ imageUrls: urls, platform: "taobao", code: product.metadata?.productProfile?.name });
                    await exportEcommerceDetailPage(product, result.longImage.dataUrl, result.pieces, result.fileNames);
                    setNodes((current) => current.map((item) => (item.id === product.id ? { ...item, metadata: { ...item.metadata, ecommerceOneClick: undefined } } : item)));
                    message.success(`已装订：${result.longImage.height}px 长图 + ${result.pieces.length} 张切片`);
                } catch (error) {
                    message.error(generationErrorMessage(error));
                    // 装订失败时放开锁，用户可以重试（例如先补上缺的那一屏）
                    bindingRef.current.delete(product.id);
                }
            })();
        }
    }, [exportEcommerceDetailPage, message, nodes, projectLoaded, setNodes]);

    const canvasNodeActions = useMemo<CanvasNodeActionContextValue>(
        () => ({
            upload: replaceCanvasNodeMedia,
            download: downloadNodeImage,
            duplicate: duplicateNodeFromContent,
            deleteNode: deleteNodeFromContent,
            updateMetadata: updateNodeMetadataFromContent,
            updateNode: updateNodeFromContent,
            updateMediaNode: updateMediaNodeFromContent,
            openArtCritique,
            addPanoramaCaptureNode,
            spawnEcommerceMaterials: async (node, planId) => { await spawnEcommerceMaterials(node, planId); },
            generateEcommerceMaterials: async (node, planId) => { await generateEcommerceMaterialsRef.current?.(node, planId); },
            exportEcommerceLayout,
            exportEcommerceDetailPage,
            reversePromptFromNode: (node, prompt) => createImageReversePromptNodes(node, prompt),
            draftWithAgent: (node, instruction) => sendSelectionToAgent(node.id, instruction),
            generateEcommerceNode: async (node, mode, prompt) => { await generateNodeRef.current?.(node.id, mode, prompt, { skipDuplicateConfirmation: true }); },
            generateEcommerceShotSet: async (node, shotIds) => { await generateEcommerceShotSetRef.current?.(node, shotIds); },
            saveImageAsModel,
            generateEcommerceModelPreset,
            generateEcommerceSuite: async (node, flowId, slotIds) => { await generateEcommerceSuiteRef.current?.(node, flowId, slotIds); },
            draftEcommerceSuite: (node, flowId, analysisModel) => draftEcommerceSuiteRef.current?.(node, flowId, analysisModel),
            draftEcommerceProfile: (node) => draftEcommerceProfileRef.current?.(node),
        }),
        [addPanoramaCaptureNode, createImageReversePromptNodes, deleteNodeFromContent, downloadNodeImage, duplicateNodeFromContent, exportEcommerceLayout, generateEcommerceModelPreset, openArtCritique, replaceCanvasNodeMedia, saveImageAsModel, sendSelectionToAgent, spawnEcommerceMaterials, updateMediaNodeFromContent, updateNodeFromContent, updateNodeMetadataFromContent],
    );
    const { dismissLastAgentChange, lastAgentChange, undoAgentOps, viewLastAgentChange } = useCanvasOperationHistory({
        projectId,
        domainProjectId: currentProject?.projectId,
        projectTitle: currentProject?.title || "未命名画布",
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
        focusSelection: fitCanvasSelection,
    });

    const { selectCanvasStyle, styleApplying } = useCanvasStyleWorkflow({
        canvasId: projectId,
        domainProjectId: currentProject?.projectId,
        nodesRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setStylePickerOpen,
    });

    const { applyPrevisOutput, createPrevisShot, openPrevisWorkbench, savePrevisScene } = useCanvasPrevis({
        projectId,
        domainProjectId: currentProject?.projectId,
        previsNodeId,
        previsScenes: currentProject?.previsScenes || [],
        nodesRef,
        connectionsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setPrevisNodeId,
        updateProject,
    });

    const {
        activateStep: activateShortDramaStep,
        createPipeline: createShortDramaPipeline,
        guideCollapsed: shortDramaGuideCollapsed,
        openStoryInput,
        progress: shortDramaProgress,
        setGuideCollapsed: setShortDramaGuideCollapsed,
        skipGuide: skipShortDramaGuide,
    } = useCanvasShortDrama({
        nodes,
        connections,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setStylePickerOpen,
        fitCanvasSelection,
        focusCanvasNode,
        openTextEditor: openTextNodeEditor,
    });

    const shortDramaGuide = shortDramaEnabled && !currentProject?.projectId && shortDramaProgress.active ? { progress: shortDramaProgress, collapsed: shortDramaGuideCollapsed, onToggle: () => setShortDramaGuideCollapsed((value) => !value) } : undefined;

    const clearCanvas = useCallback(() => {
        const drawingIds = nodesRef.current.flatMap((node) => (node.type === CanvasNodeType.Drawing && node.metadata?.drawingId ? [node.metadata.drawingId] : []));
        if (drawingIds.length) {
            void Promise.all(drawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId))).catch(() => message.warning("画布已清空，但部分本地绘图缓存清理失败"));
        }
        setNodes([]);
        setConnections([]);
        setTextEditorNodeId(null);
        setDrawingNodeId(null);
        setInfoNodeId(null);
        setSubtitleNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAnnotationNodeId(null);
        setAngleNodeId(null);
        setLightingNodeId(null);
        setEmotionNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        setArtCritiqueNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        clearCanvasFiles();
    }, [clearCanvasFiles, deselectCanvas, message, nodesRef, projectId, setEmotionNodeId]);

    useCanvasKeyboard({
        enabled: projectLoaded && !versions.preview,
        nodesRef,
        selectedNodeIdsRef,
        selectedConnectionId,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setShortcutRequestNonce,
        setInfoNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setAnnotationNodeId,
        saveCanvasProject,
        zoomToActualSize,
        fitCanvasContent,
        fitCanvasSelection,
        undoCanvas,
        redoCanvas,
        cancelSelectionBox,
        copySelectedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        shouldPreferCopiedNodes,
        pasteSystemClipboard,
        deleteNodes,
        deleteConnection,
        deselectCanvas,
        zoomCanvasIn,
        zoomCanvasOut,
        focusMode,
        exitFocusMode,
        toggleFocusMode,
        onOpenSearch: () => setNodeSearchOpen(true),
        beginBatchConnection: () => beginBatchConnectionMode(Array.from(selectedNodeIdsRef.current)),
    });


    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameCurrentProject(nextTitle);
        setTitleEditing(false);
    }, [renameCurrentProject, titleDraft]);

    const pasteAtPosition = useCallback(
        (position: Position) => {
            if (shouldPreferCopiedNodes() && pasteCopiedNodes(position)) return;
            void (async () => {
                try {
                    // 标记写入成功时仍优先系统图片，兼容截图和从外部应用复制的媒体。
                    const handled = await pasteSystemClipboard(position);
                    if (!handled) pasteCopiedNodes(position);
                } catch {
                    if (!pasteCopiedNodes(position)) message.warning("无法读取剪贴板内容");
                }
            })();
        },
        [message, pasteCopiedNodes, pasteSystemClipboard, shouldPreferCopiedNodes],
    );

    const copyingNodeContentRef = useRef(false);
    const copyNodeContentToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            if (copyingNodeContentRef.current) return;
            copyingNodeContentRef.current = true;
            releaseCopiedNodesPastePriority();
            if (!node) {
                copyingNodeContentRef.current = false;
                message.warning("没有可复制的内容");
                return;
            }

            try {
                const content = node.metadata?.content?.trim();
                const resourceId = resourceIdFromStorageKey(node.metadata?.storageKey);
                // Resource-backed media must use the central access contract. This keeps
                // copy operations on the configured CDN/OSS URL instead of copying the
                // platform file endpoint or a stale URL persisted in canvas metadata.
                const copySource = resourceId
                    ? resolveResourceAccessURL((await getResourceAccess(`resource:${resourceId}`, "copy")).url)
                    : content || "";
                if (!copySource) throw new Error("没有可复制的内容");
                if (node.type === CanvasNodeType.Image) {
                    try {
                        await copyImageToSystemClipboard(copySource, node.metadata?.storageKey);
                        message.success("图片已复制到剪贴板");
                        return;
                    } catch (imageErr) {
                        const fallbackUrl = new URL(copySource, window.location.href).toString();
                        if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(fallbackUrl).catch(() => undefined);
                            message.info("由于浏览器未获得焦点，已为您复制图片地址");
                            return;
                        }
                        if (await copyToClipboard(fallbackUrl)) {
                            message.info("由于浏览器未获得焦点，已为您复制图片地址");
                            return;
                        }
                        throw imageErr;
                    }
                }

                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copySource);
                else if (!copyToClipboard(copySource)) throw new Error("当前浏览器不支持写入剪贴板");
                message.success(node.type === CanvasNodeType.Text ? "文本已复制" : "内容链接已复制");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "复制失败，请检查浏览器剪贴板权限");
            } finally {
                copyingNodeContentRef.current = false;
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const copyNodeMediaUrlToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            releaseCopiedNodesPastePriority();
            try {
                const storageKey = node?.metadata?.storageKey;
                const content = node?.metadata?.content?.trim();
                const resourceId = resourceIdFromStorageKey(storageKey);
                const mediaPath = content && !content.startsWith("data:") && !content.startsWith("blob:") ? content : "";
                const mediaURL = resourceId
                    ? resolveResourceAccessURL((await getResourceAccess(`resource:${resourceId}`, "copy")).url)
                    : mediaPath ? new URL(mediaPath, window.location.href).toString() : "";
                if (!mediaURL) throw new Error("当前媒体只有本地内容，没有可复制的地址");
                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(mediaURL);
                else if (!(await copyToClipboard(mediaURL))) throw new Error("当前浏览器不支持写入剪贴板");
                message.success(node?.type === CanvasNodeType.Video ? "视频地址已复制" : "图片地址已复制");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "媒体地址复制失败");
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const uploadNodeImageToArkPrivateAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("请选择一张可用图片后再上传");
                return;
            }
            if (arkPrivateAssetUploadNodeId === node.id) return;
            const feedbackKey = `ark-private-asset-${node.id}`;
            setArkPrivateAssetUploadNodeId(node.id);
            message.loading({ key: feedbackKey, content: "正在保存并上传到方舟素材库...", duration: 0 });
            try {
                let resourceID = resourceIdFromStorageKey(node.metadata.storageKey);
                let persistedNode = node;
                if (!resourceID) {
                    const uploaded = await uploadImage(node.metadata.content);
                    resourceID = resourceIdFromStorageKey(uploaded.storageKey);
                    if (!resourceID) throw new Error("图片未能保存到系统素材库，请检查对象存储配置后重试");
                    handleConfigNodeChange(node.id, imageMetadata(uploaded));
                    persistedNode = { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded) } };
                }
                const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId: currentProject?.projectId, node: persistedNode, source: "canvas-manual" });
                handleConfigNodeChange(node.id, { assetId: asset.assetId });
                await syncResourceToArkPrivateAsset(resourceID);
                message.success({ key: feedbackKey, content: "已同步到方舟素材库，Seedance 将自动复用该素材", duration: 4 });
            } catch (error) {
                message.error({ key: feedbackKey, content: error instanceof Error ? error.message : "上传到方舟素材库失败", duration: 5 });
            } finally {
                setArkPrivateAssetUploadNodeId((current) => (current === node.id ? null : current));
            }
        },
        [arkPrivateAssetUploadNodeId, currentProject?.projectId, handleConfigNodeChange, message, projectId],
    );

    const confirmUploadNodeImageToArkPrivateAsset = useCallback(
        (node: CanvasNodeData) => {
            modal.confirm({
                title: "上传到方舟素材库",
                content: "仅可上传你拥有肖像、版权或其他合法使用权的图片。方舟审核通过后，Seedance 会使用受控素材标识生成视频。",
                okText: "确认拥有使用权并上传",
                cancelText: "取消",
                onOk: () => uploadNodeImageToArkPrivateAsset(node),
            });
        },
        [modal, uploadNodeImageToArkPrivateAsset],
    );

    const handleCanvasContextMenu = useCallback(
        (event: ReactMouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-node-id],[data-connection-id]")) return;

            event.preventDefault();
            event.stopPropagation();
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown")) {
                setContextMenu(null);
                return;
            }

            closeConnectionCreateMenu();
            setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
        },
        [closeConnectionCreateMenu, screenToCanvas],
    );

    const handleNodeContextMenu = useCallback(
        (event: ReactMouseEvent, id: string) => {
            event.preventDefault();
            event.stopPropagation();
            setSelectedNodeIds((current) => {
                if (current.has(id) && current.size > 1) return current;
                return new Set([id]);
            });
            setSelectedConnectionId(null);
            closeConnectionCreateMenu();
            setToolbarNodeId(null);
            setDialogNodeId(null);
            setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
        },
        [closeConnectionCreateMenu],
    );

    const handleGenerateNode = useCanvasGenerationExecutor({
        projectId,
        domainProjectId: currentProject?.projectId,
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
    });
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const { enqueueGenerationBatch, retryFailedBatchItems, stopRemainingBatchItems } = useCanvasGenerationBatches({
        projectId,
        projectLoaded,
        nodes,
        nodesRef,
        setNodes,
        handleGenerateNode,
    });

    /**
     * 电商创作：铺一套物料并直接推入生成队列。
     *
     * 铺完再让人一张张点「生成」是这条流程里最蠢的一段——五张主图点五次，十三张点十三次。
     * 批次队列（并发上限、失败重试、任务对账）本来就有，电商直接复用它；批次挂在商品节点上，
     * 因为这一套交付物本来就属于这个商品，不属于其中某一张图。
     *
     * 提交前确认张数与模型：一次铺一套会真金白银地跑十几次外部模型调用，不能静默提交。
     */
    const generateEcommerceMaterials = useCallback(async (node: CanvasNodeData, planId: string) => {
        const imageNodeIds = await spawnEcommerceMaterials(node, planId);
        if (!imageNodeIds.length) return;
        const model = effectiveConfig.imageModel || effectiveConfig.model;
        const confirmed = await new Promise<boolean>((resolve) => {
            modal.confirm({
                title: `确认提交 ${imageNodeIds.length} 张生成任务`,
                content: `任务数：${imageNodeIds.length}；模型：${model}。当前没有可用价格数据，将提交 ${imageNodeIds.length} 个外部模型任务。可以先「只铺节点」，改完拍法再一起生成。`,
                okText: "确认生成",
                cancelText: "只铺节点",
                centered: true,
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
        if (!confirmed) return;
        if (enqueueGenerationBatch(node.id, "batch_image", imageNodeIds.map((id) => ({ rowId: id, nodeId: id })))) {
            message.success(`${imageNodeIds.length} 张已加入生成队列`);
        }
    }, [effectiveConfig.imageModel, effectiveConfig.model, enqueueGenerationBatch, message, modal, spawnEcommerceMaterials]);

    // 节点动作 Context 在批次队列之前组装，所以这里用 ref 把处理器递进去，
    // 与 generateNodeRef 同一套做法，避免为一次接线把整个 Context 挪到批次之后。
    const generateEcommerceMaterialsRef = useRef(generateEcommerceMaterials);
    useEffect(() => {
        generateEcommerceMaterialsRef.current = generateEcommerceMaterials;
    }, [generateEcommerceMaterials]);

    /**
     * 电商创作：拍法清单整组出图。
     *
     * 与商品节点的「铺一套并生成」不同：那条路是按交付物方案铺一整套，
     * 这条路是按**当前清单**出图——清单可能已经被改过（加了行、换了拍法、删了行），
     * 所以要按清单对账补齐，而不是按方案重铺。
     *
     * 传 shotIds 只出那几行；不传就出整张清单。缺的产物节点先补齐再进同一个批次，
     * 一次确认覆盖全部外部调用。
     */
    const generateEcommerceShotSet = useCallback(async (node: CanvasNodeData, shotIds?: string[]) => {
        const spawnedIds = await spawnEcommerceShotOutputs(node, shotIds);
        const set = node.metadata?.shotSet;
        if (!set) return;
        // 要出的行 = 本次新铺的 + 之前已认领的（限定在 shotIds 范围内）
        const wanted = shotIds?.length ? new Set(shotIds) : undefined;
        const targetShotIds = set.shots.filter((shot) => !wanted || wanted.has(shot.id)).map((shot) => shot.id);
        if (!targetShotIds.length) return;
        const outputByShot = new Map<string, string>();
        for (const connection of connectionsRef.current) {
            if (connection.fromNodeId !== node.id) continue;
            const child = nodesRef.current.find((item) => item.id === connection.toNodeId);
            const shotId = child?.metadata?.ecommerceShotId;
            if (child?.type === CanvasNodeType.Image && shotId && targetShotIds.includes(shotId)) outputByShot.set(shotId, child.id);
        }
        for (const id of spawnedIds) {
            const child = nodesRef.current.find((item) => item.id === id) || nodes.find((item) => item.id === id);
            const shotId = child?.metadata?.ecommerceShotId;
            if (shotId) outputByShot.set(shotId, id);
        }
        const targets = targetShotIds.map((shotId) => outputByShot.get(shotId)).filter(Boolean) as string[];
        if (!targets.length) return;
        const model = effectiveConfig.imageModel || effectiveConfig.model;
        const confirmed = await new Promise<boolean>((resolve) => {
            modal.confirm({
                title: `确认提交 ${targets.length} 张生成任务`,
                content: `任务数：${targets.length}；模型：${model}。清单里每一行按各自的构图、光线、背景编译提示词，商品特征逐字锁定。`,
                okText: "确认生成",
                cancelText: "再改改",
                centered: true,
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
        if (!confirmed) return;
        if (enqueueGenerationBatch(node.id, "batch_image", targets.map((id) => ({ rowId: id, nodeId: id })))) {
            message.success(`${targets.length} 张已加入生成队列`);
        }
    }, [connectionsRef, effectiveConfig.imageModel, effectiveConfig.model, enqueueGenerationBatch, message, modal, nodes, nodesRef, spawnEcommerceShotOutputs]);

    const generateEcommerceShotSetRef = useRef(generateEcommerceShotSet);
    useEffect(() => {
        generateEcommerceShotSetRef.current = generateEcommerceShotSet;
    }, [generateEcommerceShotSet]);

    /**
     * 商品节点上连着的实拍，转成生成链路的参考图。
     *
     * **这一步是「读图起草」能不能成立的全部。** 模型是多模态的，能看图——
     * 但图必须真的递过去。上一版没传 referenceImages，模型收到的只有一段文字，
     * 于是它只能回一句「系统未传入图片节点的画面像素数据」。
     *
     * 判据与生成链路共用 `connectedImageNodes`：起草时看到的图，
     * 必须和后面出图时用的图是同一批。
     */
    const productReferenceImages = useCallback(
        (productNodeId: string) =>
            connectedImageNodes(productNodeId, nodesRef.current, connectionsRef.current).map((node) => ({
                id: node.id,
                name: node.title || `${node.id}.png`,
                type: node.metadata?.mimeType || "image/png",
                dataUrl: "",
                url: node.metadata?.content,
                storageKey: node.metadata?.storageKey,
            })),
        [connectionsRef, nodesRef],
    );

    /**
     * 跑一次「读图 → 出结论」的文本任务，返回模型的原话。
     *
     * 三件事一件都不能少：**把图递进去、确认这个文本模型看得了图、把结果原样带回来。**
     * 少任何一条，用户拿到的都是一句关于工具链的抱怨而不是内容——
     * 上一版就是这么坏的：走云 agent，那边没有取图工具，模型只好说「未挂载视觉查看工具」。
     *
     * 模型看不了图时直接说清楚并让用户换模型，不静默降级成纯文本——
     * 那会得到一份看起来正常、实际全是编的档案。
     *
     * `modelOverride` 让面板上选的分析模型压过全局配置：分析要读图、出图不用，
     * 两者常常不是同一个模型，而全局配置只有一个。传了就用它，没传才回落到全局。
     *
     * 覆盖走节点 metadata.model 这条既有通道，不是直接改 config.model——
     * 模型选的是「渠道 :: 模型」，直接写 model 字段会留下旧渠道，
     * 走 buildGenerationConfig 才能把渠道与能力一起重新解析。
     */
    const runEcommerceTextDraft = useCallback(async (productNode: CanvasNodeData, prompt: string, modelOverride?: string, skillIds?: string[]) => {
        const referenceImages = productReferenceImages(productNode.id);
        // 技能注入与出图那条链路同一套：`skillRuntime.prepare` 把技能的正文与关联文件
        // 拼进提示词。**没选就不注入**——用户库里可能有二十个技能，全塞进一次分析
        // 会把提示词顶爆，而大部分跟这个品类无关。
        let effectivePrompt = prompt;
        if (skillIds?.length) {
            try {
                const skillExecution = await skillRuntime.prepare({ profile: "canvas", prompt, skills: addedSkills, selectedSkillIds: skillIds });
                effectivePrompt = skillExecution.prompt;
            } catch (error) {
                message.error(error instanceof Error ? error.message : "技能上下文加载失败");
                return undefined;
            }
        }
        const requirements = { capability: "text" as const, input: { textCount: 0, imageCount: referenceImages.length, videoCount: 0, audioCount: 0, characterCount: 0 } };
        const target = modelOverride ? { ...productNode, metadata: { ...productNode.metadata, model: modelOverride } } : productNode;
        const generationConfig = buildGenerationConfig(effectiveConfig, target, "text", requirements);
        if (!useConfigStore.getState().isAiConfigReady(generationConfig, generationConfig.model)) {
            navigateToSettings({ continueCreation: true });
            return undefined;
        }
        const incompatible = modelCompatibilityError(generationConfig, generationConfig.model, requirements);
        if (incompatible) {
            message.error(`这个文本模型看不了图：${incompatible}。分析商品必须能看见实拍，请在面板上换一个支持图片输入的文本模型。`);
            return undefined;
        }
        try {
            const result = await runBackendGenerationTask({
                projectId,
                mode: "text",
                config: generationConfig,
                prompt: effectivePrompt,
                referenceImages,
                streamText: false,
            });
            return result.text || "";
        } catch (error) {
            message.error(generationErrorMessage(error));
            return undefined;
        }
    }, [addedSkills, effectiveConfig, message, productReferenceImages, projectId]);

    /**
     * 电商创作：读商品实拍，起草商品档案。
     *
     * 读的是**图**，不是档案——档案就是它要写的东西。所以这里必须把商品实拍递进去，
     * 这也是「让助手读图起草档案」这句话里「读图」两个字的全部含义。
     */
    const draftEcommerceProfile = useCallback(async (node: CanvasNodeData) => {
        const productNode = nodesRef.current.find((item) => item.id === node.id) || node;
        if (!productReferenceImages(productNode.id).length) {
            message.warning("还没有连入商品实拍——读图起草要先有图");
            return undefined;
        }
        const text = await runEcommerceTextDraft(productNode, buildEcommerceProfileDraftPrompt());
        if (text === undefined) return undefined;
        const parsed = parseEcommerceProfileDraft(text);
        const { unsure, ...fields } = parsed;
        if (!Object.keys(fields).length) {
            message.warning("模型这次没按格式回——换个文本模型再试，或者直接在档案里手填");
            return undefined;
        }
        updateNodeMetadataFromContent(productNode.id, { productProfile: { ...createEcommerceProductProfile(productNode.title || "未命名商品"), ...productNode.metadata?.productProfile, ...fields } });
        message.success(unsure && unsure !== "无" ? `档案已填好。这几条是模型推测的，请核对：${unsure}` : "档案已填好，请核对");
        return parsed;
    }, [message, nodesRef, productReferenceImages, runEcommerceTextDraft, updateNodeMetadataFromContent]);

    /**
     * 电商创作：分析商品，为这一套的每一张写一条完整的出图提示词。
     *
     * 单位是**一张图一条提示词**，不是一张图一句话。图递进去（见 runEcommerceTextDraft）——
     * 主图画什么、模特上身图画什么、细节图画什么，构图光线景别全不一样，
     * 这些只有看过商品实拍才写得出来。
     *
     * 分析用哪个模型由面板上选（`modelOverride`），不跟着全局配置走：
     * 分析要读图，出图不用，两者往往是不同的模型。
     */
    const draftEcommerceSuite = useCallback(async (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, analysisModel?: string) => {
        const flow = ecommerceOneClickFlow(flowId);
        if (!flow) return undefined;
        const productNode = nodesRef.current.find((item) => item.id === node.id) || node;
        if (!productReferenceImages(productNode.id).length) {
            message.warning("还没有连入商品实拍——分析要先有图，模型才知道要画的是什么");
            return undefined;
        }
        // 交给模型的是**当前那张表**，不是行业套路给的骨架：用户可能已经删到六屏、
        // 改过职责，或者在自己的提示词里要求了不同的分工。
        const rows = ecommerceSuiteRows(flow, productNode.metadata?.ecommerceSuite);
        const uniform = {
            platformId: productNode.metadata?.ecommercePlatform,
            languageId: productNode.metadata?.ecommerceLanguage,
            style: productNode.metadata?.ecommerceStyle,
            // 参考图传的是 storageKey，这里换成用户看得懂的名字——提示词里
            // 得说清「哪一张是风格参考」，模型手里那几张图才有主次。
            styleReferenceName: productNode.metadata?.ecommerceStyleReferenceKey
                ? productReferenceImages(productNode.id).find((image) => image.storageKey === productNode.metadata?.ecommerceStyleReferenceKey)?.name
                : undefined,
        };
        const text = await runEcommerceTextDraft(productNode, ecommerceSuiteDraftPrompt(flow, productNode.metadata?.productProfile, rows, productNode.metadata?.ecommerceSuitePrompt, uniform), analysisModel, productNode.metadata?.ecommerceAnalysisSkills);
        if (text === undefined) return undefined;
        const parsed = parseEcommerceSuiteDraft(text, flow);
        if (!parsed) {
            message.warning("模型这次没按格式回——换个能看图的文本模型再试，或者点「按行业套路铺底」自己改");
            return undefined;
        }
        updateNodeMetadataFromContent(productNode.id, { ecommerceSuite: { flow: flow.id, rows: parsed, source: "draft", updatedAt: new Date().toISOString() } });
        // 模型可以重新规划屏数（用户在自己的提示词里要求过），所以报的是它返回的行数，
        // 不是骨架那张表的行数——报错了用户会以为自己的要求没生效。
        message.success(`分析完成：${parsed.length} 张都有提示词${parsed.length === rows.length ? "" : `（模型按你的要求规划了 ${parsed.length} 屏，原来是 ${rows.length} 屏）`}。逐条核对，改完点右下角批量生成`);
        return parsed;
    }, [message, nodesRef, productReferenceImages, runEcommerceTextDraft, updateNodeMetadataFromContent]);

    /**
     * 电商创作：按套图面板里那张表出图。
     *
     * 一张图一条提示词，原样写进那一行对应的图片节点——**不再靠编译时去拼**。
     * 商品锁定与模特锁定由 ecommerce 编译链自动前置，提示词是用户核对过的那一份。
     *
     * **节点只为真正要出的那几张铺，而且按槽位复用。** 上一版点一下先铺九屏，
     * 用户看到的是一堆还没出图的空方块；重出一次又在旁边堆九个。现在铺节点并进出图，
     * 已有的按槽位认回来，重出只是覆盖那几张。
     *
     * 传 `slotIds` 就只出那几行——面板里每张旁边那个「出这一张」走的就是这条路。
     *
     * **每一条提前退出的路都要说话。** 上一版 targets 为空时静默 return，
     * 用户点了「批量生成」看到的是面板关掉、画布上什么都没发生——最难查的一类 bug，
     * 因为它既不报错也不留痕。
     */
    const generateEcommerceSuite = useCallback(async (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, slotIds?: string[]) => {
        const flow = ecommerceOneClickFlow(flowId);
        if (!flow) return;
        const productNode = nodesRef.current.find((item) => item.id === node.id) || node;

        // 出图模型与参数在面板上选，写在每一张节点上——批次调度按节点自己的模型解析，
        // 不读商品节点的字段。
        const imageModel = productNode.metadata?.ecommerceImageModel?.trim();
        const imageSize = productNode.metadata?.ecommerceImageSize?.trim();
        const imageQuality = productNode.metadata?.ecommerceImageQuality?.trim();
        const plan = ecommerceSuiteTargets(
            productNode,
            flow,
            productNode.metadata?.ecommerceSuite,
            { nodes: nodesRef.current, connections: connectionsRef.current },
            { ...(imageModel ? { model: imageModel } : {}), ...(imageSize ? { size: imageSize } : {}), ...(imageQuality ? { quality: imageQuality } : {}) },
            () => nanoid(),
            slotIds,
        );
        if (!plan.rows.length) {
            message.warning(`「${flow.name}」还没有提示词——在面板里点「分析商品」或「按行业套路铺底」`);
            return;
        }
        if (!plan.nodeIds.length) {
            message.error("这一套的产物节点没能铺出来——刷新页面后重试，或先删掉画布上重名的图片节点");
            return;
        }
        const reuseByNodeId = new Map(plan.reuse.map((item) => [item.nodeId, item.prompt]));

        // 流程状态挂在商品节点上：全屏出完之后要自动装订，得记住这一批是哪几张、
        // 落在哪几个节点上。单张出图不写这个状态——只出一张时不该触发装订。
        //
        // **不再挂拍法清单。** 每一张的拍法已经写进那一张自己的提示词里了；
        // 再挂一份通用清单，编译时它会作为「本张：构图…光线…」前置到提示词之前，
        // 与用户核对过的那条打架（用户改成俯拍，清单还写着平视）。
        // 清掉而不是不写：早先版本铺下的清单还留在画布上，不清就会一直压着新提示词。
        const nodeIds = plan.nodeIds;
        const nodeIdSet = new Set(nodeIds);
        const single = Boolean(slotIds?.length);
        const autoBind = productNode.metadata?.ecommerceAutoBind !== false;
        const shotPatch = { ...(imageModel ? { model: imageModel } : {}), ...(imageSize ? { size: imageSize } : {}), ...(imageQuality ? { quality: imageQuality } : {}) };
        setNodes((current) => [
            ...current.map((item) => {
                if (item.id === productNode.id) {
                    // 装订可关：关掉就不写流程状态——装订链路只认这个字段，
                    // 不写它出完就只是出完，想拼时在商品节点上手动点。
                    if (single || !autoBind) return { ...item, metadata: { ...item.metadata, ecommerceShotSet: undefined } };
                    return { ...item, metadata: { ...item.metadata, ecommerceShotSet: undefined, ecommerceOneClick: { flow: flow.id, slotIds: plan.rows.map((row) => row.slotId), nodeIds } } };
                }
                const prompt = reuseByNodeId.get(item.id);
                if (!prompt || !nodeIdSet.has(item.id)) return item;
                // 提示词写进节点自己的 prompt：用户点开那一屏能看见它、能改它、能单独重出。
                //
                // 走 synchronizeGenerationSpec 而不是直接铺 metadata：节点上可能已经有一份
                // generationSpec（用户单独生成过，或上一次批量生成写进去的），它的 prompt 和
                // options 会盖住 metadata 里的同名字段——那样「重出」用的还是上一版提示词、
                // 上一版尺寸，用户改了表却看不出任何变化。
                return synchronizeGenerationSpec(item, { prompt, composerContent: prompt, errorDetails: undefined, ...shotPatch });
            }),
            // 新铺的节点由 ecommerceSuiteTargets 带上自己的提示词与参数——
            // 它们进不了上面那个循环（上面只走画布上已有的节点），
            // 少了那句话每一张都是空提示词，整批会被标成「生成提示词为空」。
            ...plan.spawned,
        ]);
        // 认回来的节点可能没连到商品（连接被删过、或上一次铺节点时没落盘）。
        // 少了那条边，生成时约束链走不上去，商品锁定块静默丢失——出来的图看着正常
        // 却不是同一件商品。补上，而不是让那种图悄悄出街。
        if (plan.connections.length || plan.reconnect.length) setConnections((current) => [...current, ...plan.connections, ...plan.reconnect]);
        setSelectedNodeIds(nodeIdSet);
        if (enqueueGenerationBatch(productNode.id, "batch_image", nodeIds.map((id) => ({ rowId: id, nodeId: id })))) {
            message.success(`${nodeIds.length} 张已加入生成队列${!single && flow.bind && autoBind ? "，出完自动装订成详情页长图" : ""}`);
        }
    }, [connectionsRef, enqueueGenerationBatch, message, nodesRef, setConnections, setNodes, setSelectedNodeIds]);

    // 动作 Context 在批次队列之前组装，所以用 ref 把处理器递进去，
    // 与 generateNodeRef 同一套做法。
    const generateEcommerceSuiteRef = useRef(generateEcommerceSuite);
    useEffect(() => {
        generateEcommerceSuiteRef.current = generateEcommerceSuite;
    }, [generateEcommerceSuite]);
    const draftEcommerceSuiteRef = useRef(draftEcommerceSuite);
    useEffect(() => {
        draftEcommerceSuiteRef.current = draftEcommerceSuite;
    }, [draftEcommerceSuite]);
    const draftEcommerceProfileRef = useRef(draftEcommerceProfile);
    useEffect(() => {
        draftEcommerceProfileRef.current = draftEcommerceProfile;
    }, [draftEcommerceProfile]);

    const {
        addReferenceColumn: addBatchReferenceColumn,
        addRow: addBatchRow,
        batchGenDialogConfig,
        batchGenDialogConcurrency,
        batchGenDialogOpen,
        batchGenDialogRowCount,
        closeBatchGenDialog,
        confirmBatchGenDialog,
        fillRowsFromConnections,
        generateRows: generateBatchRows,
        moveReferenceCell: moveBatchReferenceCell,
        patchTable: patchBatchTable,
        removeReferenceColumn: removeBatchReferenceColumn,
        removeRow: removeBatchRow,
        reorderReferenceColumns: reorderBatchReferenceColumns,
        syncRowsFromConnections,
        updateRow: updateBatchRow,
    } = useCanvasBatchTable({
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        enqueueGenerationBatch,
    });

    useEffect(() => {
        if (!projectLoaded) return;
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const promoted = promoteLegacyBatchTableSize(node);
                if (promoted !== node) changed = true;
                return promoted;
            });
            return changed ? next : current;
        });
        nodesRef.current.filter((node) => node.type === CanvasNodeType.BatchTable).forEach((node) => {
            syncRowsFromConnections(node.id, true);
        });
    }, [connections, projectLoaded, setNodes, syncRowsFromConnections]);

    const handleUploadBatchReference = useCallback(async (tableNodeId: string, rowId: string, columnIndex: number, file: File) => {
        const tableNode = nodesRef.current.find((item) => item.id === tableNodeId);
        const table = tableNode?.metadata?.batchTable;
        const row = table?.rows.find((item) => item.id === rowId);
        if (!tableNode || !table || !row) return;
        const existingId = row.inputNodeIds[columnIndex];
        if (existingId) {
            await replaceNodeMedia(existingId, file);
            return;
        }
        const rowIndex = table.rows.findIndex((item) => item.id === rowId);
        const uploadedNodeId = await createFileNode(file, {
            x: tableNode.position.x - 240,
            y: tableNode.position.y + 170 + Math.max(0, rowIndex) * 220,
        });
        if (!uploadedNodeId) return;
        const inputNodeIds = Array.from({ length: Math.max(batchReferenceColumns(table).length, columnIndex + 1) }, (_, index) => row.inputNodeIds[index] || "");
        inputNodeIds[columnIndex] = uploadedNodeId;
        updateBatchRow(tableNodeId, rowId, { inputNodeIds });
        message.success(`已上传并填入参考图 ${columnIndex + 1}`);
    }, [createFileNode, message, nodesRef, replaceNodeMedia, updateBatchRow]);

    const { addScriptRow, createAndGenerateScriptVideos, createScriptActionBoards, createScriptImageNodes, createScriptVideoNodes, generateScriptImages, generateScriptRows, generateScriptVideos, removeScriptRow, replaceScriptRows, updateScriptRow } =
        useCanvasStoryboard({
            projectId,
            addedSkills,
            nodesRef,
            connectionsRef,
            setNodes,
            setConnections,
            setSelectedNodeIds,
            enqueueGenerationBatch,
        });

    const createStoryboardFromBatchTable = useCallback(async (tableNodeId: string) => {
        const tableNode = nodesRef.current.find((node) => node.id === tableNodeId && node.type === CanvasNodeType.BatchTable);
        const table = tableNode?.metadata?.batchTable;
        if (!tableNode || !table || table.contentKind !== "storyboard") return;
        const rows = storyboardRowsFromBatchTable(table);
        if (!rows.length) return message.warning("当前表格没有可用的分镜行");
        const sourceIds = Array.from(new Set([
            ...(table.storyboardSourceNodeIds || []),
            ...connectionsRef.current.filter((connection) => connection.toNodeId === tableNodeId && connection.relation !== "batch-output").map((connection) => connection.fromNodeId),
        ])).filter((id) => nodesRef.current.some((node) => node.id === id));
        const sourceVideo = sourceIds.map((id) => nodesRef.current.find((node) => node.id === id)).find((node): node is CanvasNodeData => node?.type === CanvasNodeType.Video);
        const keyframeTimesMs = rows.map(storyboardKeyframeTime).filter((value): value is number => value !== undefined);
        const useKeyframes = Boolean(sourceVideo && keyframeTimesMs.length);
        const scriptSpec = getNodeSpec(CanvasNodeType.Script);
        const scriptNode = createCanvasNode(CanvasNodeType.Script, {
            x: tableNode.position.x + tableNode.width + 160 + scriptSpec.width / 2,
            y: tableNode.position.y + Math.max(tableNode.height, scriptSpec.height) / 2,
        }, {
            storyboard: { rows, visibleColumns: cinematicStoryboardColumns(), referenceNodeIds: sourceIds },
            storyboardVideoInputMode: useKeyframes ? "keyframe" : "direct",
            workflowKind: "storyboard",
            workflowTitle: table.storyboardTitle || "视频脚本",
            composerContent: table.storyboardTitle || "来自多维表格的视频分镜脚本",
            status: "idle",
        });
        scriptNode.title = table.storyboardTitle || "视频脚本";
        const nextConnections = [
            ...connectionsRef.current,
            ...sourceIds.map((sourceId) => ({ id: nanoid(), fromNodeId: sourceId, toNodeId: scriptNode.id, toHandleId: "storyboard:context", relation: "storyboard-asset-reference" as const })),
        ];
        const nextNodes = [...nodesRef.current, scriptNode];
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set([scriptNode.id]));
        setDialogNodeId(null);
        if (sourceVideo && keyframeTimesMs.length) {
            const frameNodes = await extractVideoFrames(sourceVideo, { timesMs: keyframeTimesMs });
            if (frameNodes.length) {
                const withFrames = nodesRef.current.map((node) => node.id === scriptNode.id ? { ...node, metadata: { ...node.metadata, storyboard: { ...node.metadata?.storyboard, rows: bindStoryboardKeyframes(node.metadata?.storyboard?.rows || rows, frameNodes, sourceVideo.id), visibleColumns: cinematicStoryboardColumns(), referenceNodeIds: sourceIds } } } : node);
                nodesRef.current = withFrames;
                setNodes(withFrames);
                message.success(`已创建视频脚本并自动抽取 ${frameNodes.length} 个关键帧，点击“生成视频”继续`);
            } else {
                message.warning("视频脚本已创建，但关键帧抽取失败；请检查视频是否已保存或允许跨域读取");
            }
        } else {
            message.success(`已创建视频脚本：${rows.length} 个镜头`);
        }
    }, [connectionsRef, extractVideoFrames, message, nodesRef, setConnections, setDialogNodeId, setNodes, setSelectedNodeIds]);

    const handleRetryNode = useCanvasGenerationRetry({
        projectId,
        domainProjectId: currentProject?.projectId,
        addedSkills,
        assets,
        nodesRef,
        connectionsRef,
        setNodes,
        setRunningNodeId,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
        applyGenerationTaskResult,
    });
    const reloadCanvasNodeResource = useCallback(
        async (node: CanvasNodeData) => {
            const taskId = node.metadata?.taskId;
            if (!taskId || !node.metadata?.resourceReloadAvailable) return;
            setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: "loading", taskStage: "正在重新加载资源", errorDetails: undefined } } : item)));
            try {
                const task = await queryGenerationTask(taskId);
                if (task.status !== "succeeded") throw new Error("原生成任务尚未成功，无法重新加载资源");
                await applyGenerationTaskResult(node.id, task);
            } catch (error) {
                setNodes((current) =>
                    current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "资源重新加载失败", resourceReloadAvailable: true } } : item)),
                );
            }
        },
        [applyGenerationTaskResult, setNodes],
    );
    const reconcileImageBatchRootNode = useCallback(
        (rootId: string) => {
            setNodes((current) => {
                const root = current.find((item) => item.id === rootId);
                if (!root) return current;
                const reconciled = reconcileImageBatchRoot(root, current);
                return current.map((item) => (item.id === root.id ? reconciled : item));
            });
        },
        [setNodes],
    );
    const retryImageBatchChildren = useCallback(
        (rootId: string, children: CanvasNodeData[]) => {
            const childIds = children.map((child) => child.id);
            setNodes((current) => markImageBatchRetrying(rootId, childIds, current));
            void Promise.allSettled(
                children.map(async (child) => {
                    await handleRetryNode(child);
                    setNodes((current) => current.map((item) => (item.id === child.id ? restoreUnsubmittedImageBatchChild(item, child) : item)));
                }),
            ).finally(() => reconcileImageBatchRootNode(rootId));
        },
        [handleRetryNode, reconcileImageBatchRootNode, setNodes],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Image);
            const imageNode = createCanvasNode(
                CanvasNodeType.Image,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "@文本1",
                    composerContent: "@文本1",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    quality: effectiveConfig.quality,
                    transparentBackground: effectiveConfig.transparentBackground,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            imageNode.title = "图片生成";
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: imageNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, richText: undefined, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(imageNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([imageNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(imageNode.id);
        },
        [effectiveConfig, message],
    );

    const renderCanvasNodePanel = useCallback(
        (panelNode: CanvasNodeData) => {
            if (panelNode.type === CanvasNodeType.Script || panelNode.type === CanvasNodeType.Drawing) return null;
            return panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    skillReferences={skillMentionReferences}
                    generationMode={panelNode.metadata?.generationMode}
                    metadata={panelNode.metadata}
                    workspaceMode={workspaceMode}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onMetadataChange={(patch) => handleConfigNodeChange(panelNode.id, patch)}
                    onClose={() => setDialogNodeId(null)}
                />
            ) : (
                <CanvasNodePromptPanel
                    projectId={projectId}
                    node={panelNode}
                    canvasKind={canvasKind}
                    ecommercePromptAvailable={canvasKind === "ecommerce" && Boolean(resolveEcommerceInputs(panelNode.id, nodesRef.current, connectionsRef.current).prompt)}
                    isRunning={isCanvasNodeGenerating(panelNode, runningNodeId)}
                    mentionReferences={[
                        ...(mentionReferencesByNodeId.get(panelNode.id) || EMPTY_RESOURCE_REFERENCES),
                        ...buildCanvasResourceReferences(nodesRef.current, connectionsRef.current).filter((reference) => reference.kind === "text" && reference.nodeId !== panelNode.id && !(mentionReferencesByNodeId.get(panelNode.id) || []).some((active) => active.nodeId === reference.nodeId)),
                    ]}
                    onAddReference={(nodeId, reference) => {
                        if (reference.active || reference.assetId || reference.kind === "skill") return reference;
                        if (reference.kind !== "text" || !reference.nodeId || reference.nodeId === nodeId) return undefined;
                        try {
                            const linked = connectCanvasTextMention(nodesRef.current, connectionsRef.current, nodeId, reference.nodeId, nanoid());
                            nodesRef.current = linked.nodes;
                            connectionsRef.current = linked.connections;
                            setNodes(linked.nodes);
                            setConnections(linked.connections);
                            return linked.reference;
                        } catch (cause) {
                            message.warning(cause instanceof Error ? cause.message : "文本引用失败");
                            return undefined;
                        }
                    }}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onRemoveReference={handleRemoveNodeReference}
                    onReorderReferences={handleReorderNodeReferences}
                    onReplaceReference={handleReplaceNodeReference}
                    onReplaceReferenceFiles={handleReplaceNodeReferenceFiles}
                    onClose={() => setDialogNodeId(null)}
                    onNodeMouseDown={handleNodeMouseDown}
                    workspaceMode={workspaceMode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                    onListGenerate={(nodeId, listPrompt) => {
                        void handleListGenerate({
                            sourceNodeId: nodeId,
                            prompt: listPrompt,
                            nodes: nodesRef.current,
                            connections: connectionsRef.current,
                            config: effectiveConfig,
                            projectId,
                            setNodes,
                            setConnections,
                            setRunningNodeId,
                            setDialogNodeId,
                        });
                    }}
                />
            );
        },
        [
            configInputsById,
            effectiveConfig,
            handleConfigNodeChange,
            handleGenerateNode,
            handleNodePromptChange,
            handleRemoveNodeReference,
            handleReorderNodeReferences,
            handleReplaceNodeReference,
            handleReplaceNodeReferenceFiles,
            mentionReferencesByNodeId,
            message,
            projectId,
            runningNodeId,
            setConnections,
            setDialogNodeId,
            setNodes,
            setRunningNodeId,
            skillMentionReferences,
            workspaceMode,
        ],
    );

    const renderCanvasNodeContent = useCallback(
        (contentNode: CanvasNodeData) => {
            if (contentNode.metadata?.workflowKind === "character" && contentNode.metadata.characterAssetId) {
                return <CanvasCharacterReferenceNodeContent node={contentNode} />;
            }
            if (contentNode.metadata?.workflowKind === "styleboard" && !contentNode.metadata.content) {
                return <CanvasStylePlaceholderNodeContent onChoose={() => setStylePickerOpen(true)} />;
            }
            if (contentNode.metadata?.workflowKind === "story_input") {
                return <CanvasStoryInputNodeContent node={contentNode} onEdit={() => openStoryInput(contentNode.id)} />;
            }
            if (contentNode.type === CanvasNodeType.BatchTable) {
                return (
                    <CanvasBatchTableNodeContent
                        node={contentNode}
                        nodes={nodesRef.current}
                        connections={connections}
                        batch={visibleGenerationBatch(contentNode)}
                        theme={theme}
                        onPatchTable={(patch) => patchBatchTable(contentNode.id, patch)}
                        onAddRow={() => addBatchRow(contentNode.id)}
                        onRemoveRow={(rowId) => removeBatchRow(contentNode.id, rowId)}
                        onUpdateRow={(rowId, patch) => updateBatchRow(contentNode.id, rowId, patch)}
                        onFillRows={() => fillRowsFromConnections(contentNode.id)}
                        onGenerate={(rowIds) => void generateBatchRows(contentNode.id, rowIds)}
                        onCreateStoryboard={() => createStoryboardFromBatchTable(contentNode.id)}
                        onRetryItem={(batchId, itemId) => retryFailedBatchItems(contentNode.id, batchId, itemId)}
                        onAddReferenceColumn={() => addBatchReferenceColumn(contentNode.id)}
                        onRemoveReferenceColumn={() => removeBatchReferenceColumn(contentNode.id)}
                        onFocusOutput={(nodeId) => focusCanvasImageNode(nodeId)}
                        onReorderReferenceColumns={(fromColumnId, toColumnId) => reorderBatchReferenceColumns(contentNode.id, fromColumnId, toColumnId)}
                        onMoveReferenceCell={(sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex) => moveBatchReferenceCell(contentNode.id, sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex)}
                        onUploadReference={(rowId, columnIndex, file) => { void handleUploadBatchReference(contentNode.id, rowId, columnIndex, file); }}
                        onConnectStart={(event, handleId) => handleConnectStart(event, contentNode.id, "target", handleId)}
                        onConnectDrop={(event, handleId) => handleConnectDrop(event, contentNode.id, handleId)}
                    />
                );
            }
            if (contentNode.type === CanvasNodeType.Script) {
                const pipeline = deriveStoryboardPipelineProgress(contentNode, nodesRef.current, connectionsRef.current);
                return (
                    <CanvasScriptNodeContent
                        node={contentNode}
                        nodes={nodesRef.current}
                        batch={visibleGenerationBatch(contentNode)}
                        pipeline={pipeline}
                        scale={viewport.k}
                        mentionReferences={mentionReferencesByNodeId.get(contentNode.id) || EMPTY_RESOURCE_REFERENCES}
                        onOpen={() => setScriptEditorNodeId(contentNode.id)}
                        onCreateImageNodes={() => createScriptImageNodes(contentNode.id)}
                        onCreateVideoNodes={() => createScriptVideoNodes(contentNode.id)}
                        onGenerateImages={(rowIds) => void generateScriptImages(contentNode.id, rowIds)}
                        onGenerateVideos={(rowIds) => (contentNode.metadata?.storyboardVideoInputMode === "keyframe" ? void generateScriptVideos(contentNode.id, rowIds) : void createAndGenerateScriptVideos(contentNode.id, rowIds))}
                        onVideoInputModeChange={(storyboardVideoInputMode) => handleConfigNodeChange(contentNode.id, { storyboardVideoInputMode })}
                        onMergeVideos={() => void mergeVideosByIds(pipeline.successfulVideoNodeIds)}
                        onCreateActionBoards={() => void createScriptActionBoards(contentNode.id)}
                        onRetryBatch={(batchId) => retryFailedBatchItems(contentNode.id, batchId)}
                        onRetryBatchItem={(batchId, itemId) => retryFailedBatchItems(contentNode.id, batchId, itemId)}
                        onStopBatch={(batchId) => stopRemainingBatchItems(contentNode.id, batchId)}
                        onAddRow={() => addScriptRow(contentNode.id)}
                        onRemoveRow={(rowId) => removeScriptRow(contentNode.id, rowId)}
                        onUpdateRow={(rowId, patch) => updateScriptRow(contentNode.id, rowId, patch)}
                        onPromptChange={(composerContent) => handleConfigNodeChange(contentNode.id, { composerContent })}
                        onGenerateScript={(prompt) => void generateScriptRows(contentNode.id, prompt)}
                        onModelChange={(model) => handleConfigNodeChange(contentNode.id, { model })}
                        onShotDurationChange={(duration: StoryboardShotDuration) => handleConfigNodeChange(contentNode.id, { storyboardShotDuration: duration })}
                        onShotCountChange={(count: StoryboardShotCount) => handleConfigNodeChange(contentNode.id, { storyboardShotCount: count })}
                        workspaceMode={workspaceMode}
                        onComposerHeightChange={(height) => {
                            if (contentNode.metadata?.storyboardComposerHeight === height) return;
                            handleConfigNodeChange(contentNode.id, { storyboardComposerHeight: height });
                            const minHeight = storyboardMinNodeHeight(height);
                            if (contentNode.height < minHeight) handleNodeResize(contentNode.id, contentNode.width, minHeight);
                        }}
                        onConnectStart={(event, rowId, handleType) => handleConnectStart(event, contentNode.id, handleType, rowId === "context" ? "storyboard:context" : `row:${rowId}`)}
                        onScrollTopChange={(scrollTop) => setScriptScrollTopById((current) => (current[contentNode.id] === scrollTop ? current : { ...current, [contentNode.id]: scrollTop }))}
                    />
                );
            }
            if (contentNode.metadata?.previsSceneId) {
                return (
                    <CanvasPrevisNodePanel
                        node={contentNode}
                        scene={currentProject?.previsScenes?.find((scene) => scene.id === contentNode.metadata?.previsSceneId) || null}
                        readNodeContent={(nodeId) => {
                            const previewNode = nodeId ? nodesRef.current.find((item) => item.id === nodeId) : undefined;
                            return previewNode ? { content: previewNode.metadata?.content, storageKey: previewNode.metadata?.storageKey } : undefined;
                        }}
                        professional={workspaceMode === "professional"}
                        onOpen={() => openPrevisWorkbench(contentNode.id)}
                    />
                );
            }
            return (
                <CanvasConfigNodePanel
                    node={contentNode}
                    isRunning={isCanvasNodeGenerating(contentNode, runningNodeId)}
                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                    onConfigChange={handleConfigNodeChange}
                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                    onGenerate={(nodeId) => {
                        const target = nodesRef.current.find((item) => item.id === nodeId);
                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                    }}
                    workspaceMode={workspaceMode}
                />
            );
        },
        [
            addBatchReferenceColumn,
            addBatchRow,
            addScriptRow,
            configInputsById,
            connections,
            createAndGenerateScriptVideos,
            createScriptActionBoards,
            createStoryboardFromBatchTable,
            createScriptImageNodes,
            createScriptVideoNodes,
            currentProject?.previsScenes,
            fillRowsFromConnections,
            focusCanvasImageNode,
            generateBatchRows,
            generateScriptImages,
            generateScriptRows,
            generateScriptVideos,
            handleUploadBatchReference,
            moveBatchReferenceCell,
            handleConfigNodeChange,
            handleConnectDrop,
            handleConnectStart,
            handleGenerateNode,
            handleNodeResize,
            mentionReferencesByNodeId,
            mergeVideosByIds,
            openPrevisWorkbench,
            openStoryInput,
            patchBatchTable,
            removeBatchReferenceColumn,
            removeBatchRow,
            reorderBatchReferenceColumns,
            replaceCanvasNodeMedia,
            removeScriptRow,
            retryFailedBatchItems,
            runningNodeId,
            stopRemainingBatchItems,
            theme,
            updateBatchRow,
            updateScriptRow,
            viewport.k,
            workspaceMode,
        ],
    );

    const handleCanvasNodeHoverStart = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current) return;
            setHoveredNodeId(nodeId);
            keepNodeToolbar(nodeId);
        },
        [keepNodeToolbar],
    );
    const handleCanvasNodeHoverEnd = useCallback(
        (nodeId: string) => {
            setHoveredNodeId((current) => (current === nodeId ? null : current));
            hideNodeToolbar();
        },
        [hideNodeToolbar],
    );
    const retryCanvasNode = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Script) {
                const prompt = (node.metadata?.composerContent || node.metadata?.prompt || "").trim();
                if (!prompt) {
                    message.warning("分镜脚本缺少剧情内容，无法重试");
                    return;
                }
                void generateScriptRows(node.id, prompt);
                return;
            }
            if (node.type === CanvasNodeType.Image && node.metadata?.isBatchRoot) {
                const failedChildren = failedImageBatchChildren(node, nodesRef.current);
                if (!failedChildren.length) {
                    message.info("当前批次没有需要重试的失败图片");
                    return;
                }
                message.info(`正在重试 ${failedChildren.length} 个失败图片`);
                retryImageBatchChildren(node.id, failedChildren);
                return;
            }
            if (node.type === CanvasNodeType.Image && node.metadata?.batchRootId) {
                retryImageBatchChildren(node.metadata.batchRootId, [node]);
                return;
            }
            void handleRetryNode(node);
        },
        [generateScriptRows, handleRetryNode, message, nodesRef, retryImageBatchChildren],
    );
    const openCanvasNodeTaskDetails = useCallback(
        (node: CanvasNodeData) => {
            void openNodeTaskDetails(node);
        },
        [openNodeTaskDetails],
    );
    const openCanvasNodeVersions = useCallback((node: CanvasNodeData) => setVersionCompareRootId(node.metadata?.versionOfNodeId || node.id), []);
    const viewCanvasNodeImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const editCanvasPrevis = useCallback((node: CanvasNodeData) => openPrevisWorkbench(node.id), [openPrevisWorkbench]);
    const locateProjectStyleNode = useCallback(() => {
        const styleNode = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
        if (!styleNode) {
            message.info("项目画风节点正在同步，请稍后再试");
            return;
        }
        focusCanvasNode(styleNode.id);
    }, [focusCanvasNode, message, nodesRef]);
    const freeformCreateCommands = useCanvasCreateCommands({
        workspaceMode,
        canvasKind: canvasKind,
        isProjectLinked: Boolean(shortDramaEnabled && currentProject?.projectId),
        handlers: {
            onAddText: () => createNode(CanvasNodeType.Text),
            onAddImage: () => createNode(CanvasNodeType.Image),
            onAddVideo: () => createNode(CanvasNodeType.Video),
            onAddAudio: () => createNode(CanvasNodeType.Audio),
            onAddScript: () => createNode(CanvasNodeType.Script),
            onAddFrame: () => createNode(CanvasNodeType.Frame),
            onAddFolder: createFolder,
            onAddDrawing: () => createNode(CanvasNodeType.Drawing),
            onAddWorkflow: () => createNode(CanvasNodeType.Config),
            onAddExtensionNode: (type) => createNode(type),
            onChooseStyle: () => setStylePickerOpen(true),
            onOpenPrevis: () => setPrevisTemplateRequest({}),
            onUpload: () => handleUploadRequest(),
            onOpenMyAssets: () => openCanvasAssetLibrary(),
            onOpenProjectCharacters: () => openCharacterLibrary(),
        },
    });
    const emptyStateKind = resolveCanvasEmptyStateKind({
        nodeCount: nodes.length,
        shortDramaEnabled,
        isProjectLinked: Boolean(currentProject?.projectId),
        starterMode: currentProject?.starterMode,
    });
    const emptyCanvasState =
        emptyStateKind === "freeform" ? (
            <CanvasFreeformEmptyState commands={freeformCreateCommands} />
        ) : emptyStateKind === "linked" ? (
            <CanvasLinkedProjectEmptyState
                projectName={linkedProjectQuery.data?.project.name || currentProject?.title || "项目画布"}
                hasChapter={Boolean(linkedProjectQuery.data?.units.length)}
                onAddFirstChapter={() => {
                    const first = linkedProjectQuery.data?.units.slice().sort((left, right) => left.position - right.position)[0];
                    if (first) void handleProjectChapterInsert({ id: first.id, projectId: linkedProjectId, title: first.title, position: first.position });
                }}
                onOpenAssets={() => openProjectAssets()}
                onAddText={() => createNode(CanvasNodeType.Text)}
            />
        ) : emptyStateKind === "guided" ? (
            <CanvasShortDramaEmptyState
                onCreatePipeline={createShortDramaPipeline}
                onOpenAgent={() => {
                    setCinematicAgentEntry(true);
                    openAgent();
                }}
                onStartFreeform={() => updateProject(projectId, { starterMode: "freeform" })}
                onUpload={() => handleUploadRequest()}
                onAddText={() => createNode(CanvasNodeType.Text)}
                onAddScript={() => createNode(CanvasNodeType.Script)}
            />
        ) : null;
    if (!projectLoaded && loadError)
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4">
                <p role="alert">{loadError}</p>
                <Button onClick={retryLoad}>重新加载</Button>
                <Link to="/canvas">返回画布库</Link>
            </main>
        );
    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <>
            <a
                href="#canvas-main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
            >
                跳转到画布主内容
            </a>
            <main id="canvas-main" tabIndex={-1} className={`relative flex h-full min-h-0 overflow-hidden outline-none ${!focusMode && !versions.preview ? `canvas-main-with-workspace ${workspaceOpen ? "canvas-workspace-expanded" : ""}` : ""}`} style={{ background: resolvedCanvasAppearance.background, color: theme.node.text }}>
                {!focusMode && !versions.preview ? <CanvasWorkspacePanel key={projectId} open={workspaceOpen} onOpen={() => setWorkspaceOpen(true)} onInsertAssets={handleProjectAssetsInsert} projectId={projectId} nodes={nodes} selectedNodeIds={selectedNodeIds} canvasKind={canvasKind} onClose={() => setWorkspaceOpen(false)} onAssets={() => openCanvasAssetLibrary()} onProjectAssets={currentProject?.projectId ? () => openProjectAssets() : undefined} onCancelTask={cancelCanvasTask} onFocus={nodeId => {
                    const target = nodeById.get(nodeId);
                    const parent = target?.parentId ? nodeById.get(target.parentId) : null;
                    if (parent?.metadata?.frame?.collapsed) toggleFrameCollapsed(parent.id);
                    const batchRoot = target?.metadata?.batchRootId ? nodeById.get(target.metadata.batchRootId) : null;
                    if (batchRoot && !batchRoot.metadata?.imageBatchExpanded) toggleBatchExpanded(batchRoot.id);
                    const selection = new Set([nodeId]); selectedNodeIdsRef.current = selection; setSelectedNodeIds(selection); setSelectedConnectionId(null); focusCanvasNode(nodeId);
                }} /> : null}
                {!workspaceOpen && !focusMode && !versions.preview && shortDramaEnabled && currentProject?.projectId ? (
                    <CanvasProjectSidebar projectId={currentProject.projectId} detail={linkedProjectQuery.data} onAddChapter={handleProjectChapterInsert} onLocateStyle={locateProjectStyleNode} onOpenAssets={() => openProjectAssets()} />
                ) : null}
                <CanvasOverlayLayerProvider>
                    <div className="canvas-editor-shell relative flex min-w-0 flex-1">
                    <section data-canvas-editor inert={Boolean(versions.preview)} style={{ visibility: versions.preview ? "hidden" : undefined, opacity: versions.preview ? 0 : undefined }} className="relative min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                        {!focusMode ? (
                            <CanvasTopBar
                                syncStatus={<CanvasSyncStatus projectId={projectId} onLoadLatest={reloadLatestCanvasProject} onOpenVersions={openVersions} />}
                                versionsOpen={versions.open}
                                onToggleVersions={() => { closeAgent(); setVersionCompareRootId(null); versions.toggle(); }}
                                title={currentProject?.title || "未命名画布"}
                                titleDraft={titleDraft}
                                isTitleEditing={titleEditing}
                                onTitleDraftChange={setTitleDraft}
                                onStartTitleEditing={startTitleEditing}
                                onFinishTitleEditing={finishTitleEditing}
                                onCancelTitleEditing={() => setTitleEditing(false)}
                                canUndo={historyState.canUndo}
                                canRedo={historyState.canRedo}
                                onCreateProject={createAndOpenProject}
                                onDeleteProject={deleteCurrentProject}
                                onSave={() => void saveCanvasProject()}
                                onForceSave={confirmForceSaveCanvas}
                                onImportImage={() => handleUploadRequest()}
                                onImportLibTV={() => setLibTVImportOpen(true)}
                                onImportTapNow={() => setTapNowImportOpen(true)}
                                onUndo={undoCanvas}
                                onRedo={redoCanvas}
                                onShare={() => setShareModalOpen(true)}
                                shortcutRequestNonce={shortcutRequestNonce}
                                mediaPerformanceMode={mediaPerformanceMode}
                                onMediaPerformanceModeChange={setMediaPerformanceMode}
                                onOpenSearch={() => setNodeSearchOpen(true)}
                                projectContext={
                                    shortDramaEnabled && currentProject?.projectId
                                        ? {
                                              ...canvasContext,
                                              projectId: currentProject.projectId,
                                              projectName: linkedProjectQuery.data?.project.name || currentProject.title,
                                          }
                                        : undefined
                                }
                                onEnterFocusMode={enterFocusMode}
                                shortDramaGuide={shortDramaGuide}
                            />
                        ) : null}

                        <CanvasNodeSearchModal
                            open={nodeSearchOpen}
                            nodes={nodes}
                            onClose={() => setNodeSearchOpen(false)}
                            onFocus={(nodeId) => {
                                const target = nodeById.get(nodeId);
                                const parent = target?.parentId ? nodeById.get(target.parentId) : null;
                                if (parent?.metadata?.frame?.collapsed) toggleFrameCollapsed(parent.id);
                                const batchRoot = target?.metadata?.batchRootId ? nodeById.get(target.metadata.batchRootId) : null;
                                if (batchRoot && !batchRoot.metadata?.imageBatchExpanded) toggleBatchExpanded(batchRoot.id);
                                const selection = new Set([nodeId]);
                                selectedNodeIdsRef.current = selection;
                                setSelectedNodeIds(selection);
                                setSelectedConnectionId(null);
                                focusCanvasNode(nodeId);
                            }}
                        />

                        {!focusMode && shortDramaGuide ? (
                            <CanvasShortDramaGuide progress={shortDramaGuide.progress} collapsed={shortDramaGuide.collapsed} onToggle={shortDramaGuide.onToggle} onSkip={skipShortDramaGuide} onStepClick={activateShortDramaStep} />
                        ) : null}

                        <CanvasShareModal projectId={projectId} open={shareModalOpen} onClose={() => setShareModalOpen(false)} beforeCreate={saveCanvasProject} />
                        <LibTVImportDialog open={libTVImportOpen} projectId={projectId} viewport={viewport} viewportSize={size} onClose={() => setLibTVImportOpen(false)} onApply={applyLibTVImport} />
                        <TapNowImportDialog open={tapNowImportOpen} projectId={projectId} viewport={viewport} viewportSize={size} onClose={() => setTapNowImportOpen(false)} onApply={applyTapNowImport} />

                        <CanvasStylePickerModal open={stylePickerOpen} value={activeStylePresetId} applying={styleApplying} onClose={() => setStylePickerOpen(false)} onSelect={selectCanvasStyle} />

                        <CanvasPrevisTemplateModal open={Boolean(previsTemplateRequest)} onClose={() => setPrevisTemplateRequest(null)} onSelect={(templateId) => createPrevisShot(templateId, previsTemplateRequest?.position)} />

                        <div className="relative flex min-h-0 min-w-0 flex-1">
                            <div className="relative min-w-0 flex-1 overflow-hidden">
                                <InfiniteCanvas
                                    interactive={!versions.preview}
                                    containerRef={containerRef}
                                    viewport={viewport}
                                    appearance={canvasAppearance}
                                    backgroundMode={backgroundMode}
                                    graphicsLayer={
                                        <CanvasLeaferGraphicsLayer
                                            containerRef={containerRef}
                                            viewport={viewport}
                                            theme={theme}
                                            displayConnections={visibleDisplayConnections}
                                            selectedConnectionId={selectedConnectionId}
                                            relatedConnectionIds={relatedHighlight.connectionIds}
                                            scriptScrollTopById={scriptScrollTopById}
                                            connectingParams={connectingParams}
                                            batchConnectionPreview={batchConnectionPreview}
                                            mouseWorld={mouseWorld}
                                            connectionTargetNodeId={connectionTargetNodeId}
                                            connectionTargetAnchorRatio={connectionTargetAnchorRatio}
                                            nodeById={nodeById}
                                            selectionBox={selectionBox}
                                            selectedNodeBounds={selectedNodeBounds}
                                            alignmentGuides={alignmentGuides}
                                        />
                                    }
                                    onViewportChange={handleViewportChange}
                                    onViewportPreviewChange={handleViewportPreviewChange}
                                    onCanvasMouseDown={handleCanvasMouseDown}
                                    boxSelectEnabled={canvasTool === "box-select"}
                                    onCanvasDoubleClick={handleCanvasDoubleClick}
                                    onCanvasDeselect={deselectCanvas}
                                    onContextMenu={handleCanvasContextMenu}
                                    onDrop={handleDrop}
                                    onFileDragEnter={handleFileDragEnter}
                                    onFileDragLeave={handleFileDragLeave}
                                    onFileDragOver={handleFileDragOver}
                                >
                                    <CanvasNodeActionContext.Provider value={canvasNodeActions}>
                                        <CanvasNodeGraphContext.Provider value={nodeGraphContext}>
                                            <CanvasProjectWorldLayers
                                                connectionApproach={connectionApproach}
                                                projectId={projectId}
                                                viewportScale={viewport.k}
                                                connectionLayerBounds={connectionLayerBounds}
                                                displayConnections={visibleDisplayConnections}
                                                selectedConnectionId={selectedConnectionId}
                                                relatedConnectionIds={relatedHighlight.connectionIds}
                                                scriptScrollTopById={scriptScrollTopById}
                                                connectingParams={connectingParams}
                                                mouseWorld={mouseWorld}
                                                connectionTargetNodeId={connectionTargetNodeId}
                                                nodeById={nodeById}
                                                visibleNodes={visibleNodes}
                                                nodeRenderLODById={nodeRenderLODById}
                                                nodeStackOrder={nodeStackOrder}
                                                frameChildrenById={frameChildrenById}
                                                linkedFolderPreviewNodesById={linkedFolderPreviewNodesById}
                                                dragPreview={dragPreview}
                                                selectedNodeIds={selectedNodeIds}
                                                frameDropTargetId={frameDropTargetId}
                                                relatedNodeIds={relatedHighlight.nodeIds}
                                                activeNodeId={activeNodeId}
                                                selectionBox={selectionBox}
                                                batchChildCountById={batchChildCountById}
                                                collapsingBatchIds={collapsingBatchIds}
                                                openingBatchIds={openingBatchIds}
                                                batchMotionById={batchMotionById}
                                                showImageInfo={showImageInfo}
                                                reduceMediaEffects={reduceMediaEffects}
                                                resourceReferenceByNodeId={resourceReferenceByNodeId}
                                                mentionReferencesByNodeId={mentionReferencesByNodeId}
                                                mediaEffectsDisabledNodeId={emotionNodeId}
                                                selectedNodeBounds={selectedNodeBounds}
                                                batchSourceNodeIds={batchSourceNodeIds}
                                                batchConnectionPreview={batchConnectionPreview}
                                                isNodeDragging={isNodeDragging}
                                                selectionBoundsElementRef={selectionBoundsElementRef}
                                                renderCanvasNodeContent={renderCanvasNodeContent}
                                                onConnectionSelect={(connectionId) => {
                                                    setSelectedConnectionId(connectionId);
                                                    setSelectedNodeIds(new Set());
                                                    setContextMenu(null);
                                                }}
                                                onConnectionContextMenu={(event, connectionId) => {
                                                    setSelectedConnectionId(connectionId);
                                                    setSelectedNodeIds(new Set());
                                                    closeConnectionCreateMenu();
                                                    setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId });
                                                }}
                                                onNodeMouseDown={handleNodeMouseDown}
                                                onNodeHoverStart={handleCanvasNodeHoverStart}
                                                onNodeHoverEnd={handleCanvasNodeHoverEnd}
                                                onConnectStart={handleConnectStart}
                                                onNodeResize={handleNodeResize}
                                                onToggleFrame={handleFrameToggle}
                                                onFolderStyleChange={handleFolderStyleChange}
                                                onFolderThemeChange={handleFolderThemeChange}
                                                onNodeTitleChange={handleNodeTitleChange}
                                                onNodeContextMenu={handleNodeContextMenu}
                                                onNodeContentChange={handleNodeContentChange}
                                                onToggleBatch={toggleBatchExpanded}
                                                onSetBatchPrimary={setBatchPrimary}
                                                onRetry={retryCanvasNode}
                                                onReloadResource={reloadCanvasNodeResource}
                                                onOpenTaskDetails={openCanvasNodeTaskDetails}
                                                onOpenVersions={openCanvasNodeVersions}
                                                onViewImage={viewCanvasNodeImage}
                                                onReplaceMedia={replaceCanvasNodeMedia}
                                                onOpenTextEditor={openTextNodeEditor}
                                                onOpenPrevis={editCanvasPrevis}
                                                onOpenDrawing={openDrawingNode}
                                                onStartBatchConnection={startBatchConnection}
                                            />
                                        </CanvasNodeGraphContext.Provider>
                                    </CanvasNodeActionContext.Provider>
                                </InfiniteCanvas>

                                <CanvasActiveTaskPanel tasks={activeTasks} onCancelTask={cancelCanvasTask} topInset={focusMode ? "var(--space-3)" : "var(--canvas-topbar-offset)"} />

                                {focusMode ? (
                                    <CanvasFocusModeBar
                                        syncStatus={<CanvasSyncStatus projectId={projectId} onLoadLatest={reloadLatestCanvasProject} onOpenVersions={openVersions} />}
                                        versionsOpen={versions.open}
                                        onToggleVersions={() => { closeAgent(); versions.toggle(); }}
                                        dockRevealed={focusDockRevealed}
                                        zoomPercent={viewport.k}
                                        onToggleDock={() => setFocusDockRevealed((value) => !value)}
                                        onExit={exitFocusMode}
                                        onZoomIn={zoomCanvasIn}
                                        onZoomOut={zoomCanvasOut}
                                        onFit={fitCanvasContent}
                                    />
                                ) : null}

                                <CanvasFileDropOverlay active={fileDropActive} theme={theme} />

                                {emptyCanvasState}

                                {!focusMode || focusDockRevealed ? (
                                    <CanvasToolbar
                                        selectedCount={selectedNodeIds.size}
                                        workspaceMode={workspaceMode}
                                        canvasTool={canvasTool}
                                        onToolChange={setCanvasTool}
                                        isProjectLinked={Boolean(shortDramaEnabled && currentProject?.projectId)}
                                        canUndo={historyState.canUndo}
                                        canRedo={historyState.canRedo}
                                        appearance={canvasAppearance}
                                        backgroundMode={backgroundMode}
                                        showImageInfo={showImageInfo}
                                        onAddImage={() => createNode(CanvasNodeType.Image)}
                                        onAddVideo={() => createNode(CanvasNodeType.Video)}
                                        onAddAudio={() => createNode(CanvasNodeType.Audio)}
                                        onAddText={() => createNode(CanvasNodeType.Text)}
                                        onChooseStyle={() => setStylePickerOpen(true)}
                                        onAddScript={() => createNode(CanvasNodeType.Script)}
                                        onAddFrame={() => createNode(CanvasNodeType.Frame)}
                                        onAddFolder={createFolder}
                                        onAddDrawing={() => createNode(CanvasNodeType.Drawing)}
                                        onAddExtensionNode={(type) => createNode(type)}
                                        onAddWorkflow={() => createNode(CanvasNodeType.Config)}
                                        onOpenPrevis={() => setPrevisTemplateRequest({})}
                                        onUndo={undoCanvas}
                                        onRedo={redoCanvas}
                                        onUpload={() => handleUploadRequest()}
                                        onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                                        onClear={() => setClearConfirmOpen(true)}
                                        onDeselect={deselectCanvas}
                                        onAppearanceChange={applyCanvasAppearance}
                                        onSaveAppearanceDefault={saveCanvasAppearanceDefault}
                                        onBackgroundModeChange={setBackgroundMode}
                                        onShowImageInfoChange={setShowImageInfo}
                                        onOpenWorkspace={() => setWorkspaceOpen(value => !value)}
                                        onOpenMyAssets={() => {
                                            openCanvasAssetLibrary();
                                        }}
                                        onOpenProjectCharacters={() => openCharacterLibrary()}
                                    />
                                ) : null}
                            </div>

                            <div className={versions.open ? "hidden" : "contents"}>
                            <CanvasCloudAgentPanel canvasId={projectId} domainProjectId={currentProject?.projectId} canvasNodes={nodes} runningNodeId={runningNodeId} nodeCount={nodes.length} selectedNodeIds={Array.from(selectedNodeIds)} references={agentMentionReferences} prefillRequest={agentPrefillRequest} open={assistantOpen} onOpen={openAgent} onCollapse={closeAgent} onFocusNode={(nodeId) => {
                                const currentNodes = nodesRef.current;
                                const target = currentNodes.find((node) => node.id === nodeId);
                                if (!target) { message.info("该节点已删除或尚未同步到画布"); return; }

                                const parent = target.parentId ? currentNodes.find((node) => node.id === target.parentId) : null;
                                if (parent?.metadata?.frame?.collapsed) toggleFrameCollapsed(parent.id);

                                const batchRootId = target.metadata?.batchRootId;
                                const batchRoot = batchRootId ? currentNodes.find((node) => node.id === batchRootId) : null;
                                if (batchRoot && isHiddenBatchChild(target, currentNodes) && !batchRoot.metadata?.imageBatchExpanded) toggleBatchExpanded(batchRoot.id);

                                focusCanvasNode(nodeId);
                            }} />
                            </div>
                        </div>

                        {angleNode?.metadata?.content ? (
                            <CanvasNodePanelOverlay
                                node={angleNode}
                                viewport={viewport}
                                containerRef={containerRef}
                                panelWidth={640}
                                panelHeight={540}
                                allowOverflow
                                dragOffset={dragPreview?.nodeIds.has(angleNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                                isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(angleNode.id))}
                            >
                                <CanvasNodeAnglePanel
                                    dataUrl={angleNode.metadata.content}
                                    onClose={() => setAngleNodeId(null)}
                                    onConfirm={(params) => {
                                        void generateAngleNode(angleNode, params);
                                    }}
                                />
                            </CanvasNodePanelOverlay>
                        ) : null}

                        {lightingNode?.metadata?.content ? (
                            <AppModal flush open centered title={null} closable={false} footer={null} width={720} onCancel={() => setLightingNodeId(null)}>
                                <CanvasNodeLightingPanel
                                    dataUrl={lightingNode.metadata.content}
                                    onClose={() => setLightingNodeId(null)}
                                    onConfirm={(options, prompt) => {
                                        generateLightingNode(lightingNode, options, prompt);
                                    }}
                                />
                            </AppModal>
                        ) : null}

                        {emotionNode?.metadata?.content && !isCanvasNodeMoving ? (
                            <CanvasEmotionWorkspace
                                node={emotionNode}
                                viewport={viewport}
                                containerRef={containerRef}
                                dragOffset={dragPreview?.nodeIds.has(emotionNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                                isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(emotionNode.id))}
                                onClose={() => setEmotionNodeId(null)}
                                onConfirm={(payload: CanvasImageEmotionPayload) => {
                                    void generateEmotionNode(emotionNode, payload);
                                }}
                            />
                        ) : null}

                        {dialogNode &&
                        !isCanvasImageSourceNode(dialogNode) &&
                        !dialogNode.metadata?.fileUpload &&
                        dialogNode.type !== CanvasNodeType.Script &&
                        dialogNode.type !== CanvasNodeType.BatchTable &&
                        dialogNode.type !== CanvasNodeType.Drawing &&
                        dialogNode.type !== CanvasNodeType.Panorama &&
                        !(dialogNode.metadata?.workflowKind === "character" && dialogNode.metadata.characterAssetId) &&
                        !dialogNode.metadata?.previsSceneId &&
                        !selectionBox &&
                        !isCanvasNodeMoving ? (
                            <CanvasNodePanelOverlay
                                node={dialogNode}
                                viewport={viewport}
                                containerRef={containerRef}
                                allowOverflow={dialogNode.type !== CanvasNodeType.Config}
                                dragOffset={dragPreview?.nodeIds.has(dialogNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                                isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(dialogNode.id))}
                            >
                                {renderCanvasNodePanel(dialogNode)}
                            </CanvasNodePanelOverlay>
                        ) : null}

                        {pendingConnectionCreate ? (
                            <CanvasConnectionCreateMenu
                                pending={pendingConnectionCreate}
                                viewport={viewport}
                                viewportSize={size}
                                containerRef={containerRef}
                                canCreateDrawing={canCreateDrawingFromConnection}
                                canvasKind={canvasKind}
                                getDisabledReason={(type) => getConnectionCreateDisabledReason(type, pendingConnectionCreate)}
                                onCreate={(type) => void createConnectedNode(type, pendingConnectionCreate)}
                                onClose={cancelPendingConnectionCreate}
                            />
                        ) : null}

                        {connectionReplaceHover ? (
                            <div
                                className="pointer-events-none fixed z-[var(--z-dialog-popover)] flex select-none items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all"
                                style={{
                                    left: connectionReplaceHover.clientX + 14,
                                    top: connectionReplaceHover.clientY + 14,
                                    transform: "translateY(-50%)",
                                }}
                            >
                                <ArrowLeftRight className="size-3 text-blue-400" />
                                <span>松开替换</span>
                                <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">@{connectionReplaceHover.referenceLabel}</span>
                            </div>
                        ) : null}

                        {selectedNodeBounds && !selectionBox && !isCanvasNodeMoving ? (
                            <CanvasProjectSelectionToolbar
                                anchorRef={selectionBoundsElementRef}
                                containerRef={containerRef}
                                count={selectedNodeBounds.count}
                                selectedVideoCount={selectedVideoNodes.length}
                                mergingVideos={Boolean(mergeVideoProgress)}
                                onAlign={alignSelectedNodes}
                                onArrange={arrangeSelectedNodes}
                                onCreateStoryboard={createStoryboardGroup}
                                onCreateReferenceGroup={createReferenceGroup}
                                onBatchConnect={() => beginBatchConnectionMode(Array.from(selectedNodeIds))}
                                onMergeVideos={() => void mergeSelectedVideos()}
                                onSendSelectionToAgent={() => sendSelectionToAgent()}
                            />
                        ) : null}

                        {uploadStatus ? <CanvasUploadStatusToast status={uploadStatus} theme={theme} /> : null}
                        {mergeVideoProgress ? <CanvasMergeStatusToast progress={mergeVideoProgress} theme={theme} /> : null}
                        {lastAgentChange ? (
                            <CanvasOperationChangeToast
                                change={lastAgentChange}
                                theme={theme}
                                onView={viewLastAgentChange}
                                onUndo={() => {
                                    undoAgentOps();
                                }}
                                onClose={dismissLastAgentChange}
                            />
                        ) : null}

                        <CanvasNodeToolbar
                            node={isCanvasNodeMoving || nodeImageSettingsOpen || emotionNodeId || angleNodeId ? null : toolbarNode}
                            workspaceMode={workspaceMode}
                            viewport={viewport}
                            containerRef={containerRef}
                            onKeep={keepNodeToolbar}
                            onLeave={hideNodeToolbar}
                            onInfo={(node) => (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId ? openTextNodeEditor(node) : setInfoNodeId(node.id))}
                            onEditText={openTextNodeEditor}
                            onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                            onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                            onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                            onGenerateImage={generateImageFromTextNode}
                            onUpload={(node) => handleUploadRequest(node.id)}
                            onDownload={downloadNodeImage}
                            onSaveAsset={(node) => void saveNodeAsset(node)}
                            onAnnotate={(node) => setAnnotationNodeId(node.id)}
                            onAnnotationEdit={openAnnotationEditNode}
                            onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                            onRemoveBackground={openBackgroundRemoval}
                            onLayerDecomposition={openLayerDecomposition}
                            onTextEdit={openTextEditNode}
                            onEmotion={(node) => {
                                setDialogNodeId(null);
                                setEmotionNodeId((current) => (current === node.id ? null : node.id));
                            }}
                            onPortraitTexture={openPortraitTextureEditor}
                            onCrop={(node) => setCropNodeId(node.id)}
                            onSplit={(node, params) => void splitImageNode(node, params)}
                            onUpscale={(node) => setUpscaleNodeId(node.id)}
                            onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                            onAngle={(node) => {
                                setDialogNodeId(null);
                                setAngleNodeId((current) => (current === node.id ? null : node.id));
                            }}
                            onLighting={(node) => {
                                setDialogNodeId(null);
                                setLightingNodeId((current) => (current === node.id ? null : node.id));
                            }}
                            onPanorama={openPanoramaConfig}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onExtractVideoFrames={openVideoFrameExtractor}
                            onExtractAudioFromVideo={(node) => void extractAudioFromVideo(node)}
                            onTrimVideoSegments={openVideoSegmentExtractor}
                            onSubtitles={(node) => setSubtitleNodeId(node.id)}
                            onTimeline={(node) => setTimelineNodeId(node.id)}
                            extractingVideoFrames={toolbarNode?.id === extractingVideoFramesNodeId}
                            extractingAudio={segmentRunningMode === "audio"}
                            trimmingVideo={segmentRunningMode === "video"}
                            onNineGrid={(node, id, label, icon) => void generateNineGridNode(node, id, label, icon)}
                            onReversePrompt={createImageReversePromptNodes}
                            onSaveAsModel={saveImageAsModel}
                            canvasKind={canvasKind}
                            onRetry={retryCanvasNode}
                            onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                            onToggleLocked={(node) => toggleNodeLocked(node.id)}
                            onDelete={(node) => deleteNodes(new Set([node.id]))}
                        />

{isMiniMapOpen && !focusMode ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} canvasContainerRef={containerRef} onViewportPreviewChange={previewViewport} onViewportChange={handleViewportChange} /> : null}

                        {!focusMode ? (
                            <CanvasOverlayLayerContainer
                                overlayId="asset-tray"
                                fallbackZIndex="var(--z-panel)"
                                className="canvas-workspace-zoom-controls absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16))] left-[var(--canvas-inset-x)] flex items-end gap-2 lg:bottom-[var(--canvas-inset-y)]"
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <CanvasZoomControls
                                    scale={viewport.k}
                                    containerRef={containerRef}
                                    onScaleChange={setZoomScale}
                                    onFitContent={fitCanvasContent}
                                    onAutoArrange={autoArrangeCanvasNodes}
                                    hideNodeConnections={hideNodeConnections}
                                    onHideNodeConnectionsChange={setHideNodeConnections}
                                    isMiniMapOpen={isMiniMapOpen}
                                    onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
                                    onOpenShortcuts={() => setShortcutRequestNonce((value) => value + 1)}
                                />
                            </CanvasOverlayLayerContainer>
                        ) : null}

                        <CanvasProjectContextMenu
                            menu={contextMenu}
                            node={contextMenuNode}
                            workspaceMode={workspaceMode}
                            canvasKind={canvasKind}
                            isProjectLinked={Boolean(currentProject?.projectId)}
                            canUndo={historyState.canUndo}
                            canRedo={historyState.canRedo}
                            canPaste={hasCopiedNodes || Boolean(navigator.clipboard)}
                            selectedCount={selectedNodeIds.size}
                            screenToCanvas={screenToCanvas}
                            onClose={() => setContextMenu(null)}
                            onAddNode={(type, position) => createNode(type, position)}
                            onAddFolder={createFolder}
                            onChooseStyle={() => setStylePickerOpen(true)}
                            onOpenPrevis={(position) => setPrevisTemplateRequest({ position })}
                            onUpload={(nodeId, position) => handleUploadRequest(nodeId, position)}
                            onOpenAssets={openCanvasAssetLibrary}
                            onOpenProjectCharacters={(position) => openCharacterLibrary(position)}
                            onUndo={undoCanvas}
                            onRedo={redoCanvas}
                            onPaste={pasteAtPosition}
                            onCopyNode={(nodeId) => copyNodesToClipboard(new Set([nodeId]))}
                            onCreateGenerationCopy={(nodeId) => duplicateNode(nodeId, "copy")}
                            onDuplicate={duplicateNode}
                            onDeleteNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                            onDeleteConnection={deleteConnection}
                            onSaveAsset={(node) => {
                                void saveNodeAsset(node);
                            }}
                            onViewMedia={(node) => setPreviewNodeId(node.id)}
                            onEditText={openTextNodeEditor}
                            onOpenDrawing={openDrawingNode}
                            onGenerateImage={generateImageFromTextNode}
                            onCopyContent={(node) => {
                                void copyNodeContentToClipboard(node);
                            }}
                            onCopyMediaUrl={(node) => {
                                void copyNodeMediaUrlToClipboard(node);
                            }}
                            onUploadToArkPrivateAsset={confirmUploadNodeImageToArkPrivateAsset}
                            onSetAssetCategory={(nodeId, assetCategory) => handleConfigNodeChange(nodeId, { assetCategory })}
                            onToggleFrame={(node) => handleFrameToggle(node.id)}
                            onSpreadSelection={spreadSelectedNodes}
                            onCopySelection={copySelectedNodes}
                            onDeleteSelection={() => deleteNodes(selectedNodeIds)}
                            onSendToAgent={() => sendSelectionToAgent(contextMenu?.type === "node" && selectedNodeIds.size <= 1 ? contextMenu.nodeId : undefined)}
                        />

                        <CanvasUploadModal open={uploadModalOpen} onClose={closeUploadModal} onUpload={handleUploadFiles} />

                        <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                        <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} onMetadataChange={handleConfigNodeChange} />

                        {subtitleNode ? (
                            <CanvasSubtitleDialog
                                node={subtitleNode}
                                open={Boolean(subtitleNode)}
                                projectId={projectId}
                                config={effectiveConfig}
                                onClose={() => setSubtitleNodeId(null)}
                                onSave={(nodeId, patch) => {
                                    handleConfigNodeChange(nodeId, patch);
                                    const currentTimeline = currentProject?.timeline;
                                    if (currentTimeline) {
                                        const next = syncNodeSubtitlesToTimeline(currentTimeline, nodeId, patch.subtitleEntries || []);
                                        if (next !== currentTimeline) updateProject(projectId, { timeline: next });
                                    }
                                }}
                            />
                        ) : null}

                        {frameNode ? <CanvasVideoFrameDialog node={frameNode} open={Boolean(frameNode)} onClose={closeFrameDialog} onConfirm={(params) => void extractVideoFrames(frameNode, params)} /> : null}

                        {segmentNode && segmentDialogMode ? (
                            <CanvasVideoSegmentDialog
                                node={segmentNode}
                                nodes={nodes}
                                connections={connections}
                                open={Boolean(segmentNode && segmentDialogMode)}
                                mode={segmentDialogMode}
                                config={effectiveConfig}
                                timeline={currentProject?.timeline || null}
                                onClose={closeSegmentDialog}
                                onConfirm={(params) => void handleSegmentConfirm(segmentNode, params)}
                            />
                        ) : null}

                        {timelineNode ? (
                            <CanvasTimelineDialog
                                node={timelineNode}
                                open={Boolean(timelineNode)}
                                nodes={nodes}
                                timeline={currentProject?.timeline || null}
                                onClose={() => setTimelineNodeId(null)}
                                onOpenSubtitleDialog={(subNodeId) => {
                                    setTimelineNodeId(null);
                                    setSubtitleNodeId(subNodeId);
                                }}
                                onSave={(next) => updateProject(projectId, { timeline: next })}
                                onSaveSubtitles={(subNodeId, entries) =>
                                    handleConfigNodeChange(subNodeId, {
                                        subtitleEntries: entries,
                                        ...(entries.length ? {} : { subtitleHighlights: [] }),
                                        subtitleUpdatedAt: new Date().toISOString(),
                                    })
                                }
                                onOpenAssetLibrary={openTimelineAssetLibrary}
                                onOpenProjectAssets={() => openProjectAssets("all", undefined, "timeline")}
                                onUploadLocalFiles={uploadTimelineMedia}
                                addNodeToTimelineRef={timelineAddNodeRef}
                                addMediaToTimelineRef={timelineMediaAddRef}
                                onCreateAssembledNode={createVideoNodeFromBlob}
                            />
                        ) : null}

                        <CanvasCharacterReferenceModal node={characterReferenceNode} canvasNodes={nodes} open={Boolean(characterReferenceNode)} onClose={() => setCharacterReferenceNodeId(null)} onUpdated={(detail) => setNodes((current) => refreshCanvasCharacterReferenceNodes(current, [{ ...detail.asset, character: detail.character }]))} />

                        <CanvasTextEditorModal
                            node={textEditorNode}
                            open={Boolean(textEditorNode)}
                            onClose={() => setTextEditorNodeId(null)}
                            onSave={(nodeId, title, content, richText) => {
                                setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, title, metadata: { ...node.metadata, content, richText } } : node)));
                            }}
                        />

                        {drawingNode ? (
                            <Suspense
                                fallback={
                                    <div className="fixed inset-0 z-[var(--z-toast)] grid place-items-center px-5" style={{ background: theme.canvas.background, color: theme.node.text }}>
                                        <WorkspaceState icon="loading" title="正在加载绘图编辑器" description="正在准备绘图画布。" />
                                    </div>
                                }
                            >
                                <CanvasDrawingEditorModal
                                    node={drawingNode}
                                    projectId={projectId}
                                    open={Boolean(drawingNode)}
                                    onClose={() => setDrawingNodeId(null)}
                                    onSaved={(nodeId, summary) => {
                                        setNodes((current) =>
                                            current.map((node) =>
                                                node.id === nodeId
                                                    ? {
                                                          ...node,
                                                          metadata: {
                                                              ...node.metadata,
                                                              drawingEngine: summary.engine,
                                                              drawingRevision: summary.revision,
                                                              drawingUpdatedAt: summary.updatedAt,
                                                              drawingShapeCount: summary.shapeCount,
                                                              drawingPageCount: summary.pageCount,
                                                          },
                                                      }
                                                    : node,
                                            ),
                                        );
                                        message.success("绘图已保存");
                                    }}
                                />
                            </Suspense>
                        ) : null}

                        <AiArtCritiqueModal
                            startRequestId={artCritiqueStartRequest && artCritiqueStartRequest.nodeId === artCritiqueNode?.id ? artCritiqueStartRequest.id : undefined}
                            restartRequested={artCritiqueStartRequest?.nodeId === artCritiqueNode?.id && artCritiqueStartRequest?.restart}
                            onRunningChange={(running) => {
                                artCritiqueRunningRef.current = running;
                            }}
                            node={artCritiqueNode}
                            upstreamNodes={artCritiqueInputs}
                            open={Boolean(artCritiqueNode)}
                            onClose={() => setArtCritiqueNodeId(null)}
                            onUpdateState={(nodeId, state) => handleConfigNodeChange(nodeId, { artCritique: state })}
                        />

                        <CanvasPanoramaConfigModal
                            open={Boolean(panoramaConfigNodeId)}
                            onCancel={() => setPanoramaConfigNodeId(null)}
                            onConfirm={(composedPrompt, config) => {
                                const node = nodes.find((n) => n.id === panoramaConfigNodeId);
                                if (node) {
                                    createPanoramaViewerWithConfig(node, composedPrompt, config);
                                }
                            }}
                            onCopyPrompt={(prompt) => {
                                void navigator.clipboard?.writeText(prompt).then(() => message.success("已复制全景提示词"));
                            }}
                            previewImageUrl={panoramaConfigNodeId ? nodes.find((n) => n.id === panoramaConfigNodeId)?.metadata?.content : undefined}
                            nodes={nodes}
                        />

                        <CanvasScriptEditor
                            node={activeScriptNode}
                            nodes={nodes}
                            open={Boolean(activeScriptNode)}
                            onClose={() => setScriptEditorNodeId(null)}
                            onUpdateRows={(rows) => activeScriptNode && replaceScriptRows(activeScriptNode.id, rows)}
                            onVisibleColumnsChange={(visibleColumns: StoryboardColumn[]) => {
                                if (!activeScriptNode || !visibleColumns.length) return;
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        node.id === activeScriptNode.id
                                            ? { ...node, metadata: { ...node.metadata, storyboard: { rows: node.metadata?.storyboard?.rows || [], visibleColumns, referenceNodeIds: node.metadata?.storyboard?.referenceNodeIds || [] } } }
                                            : node,
                                    ),
                                );
                            }}
                            onGenerateImages={(rowIds) => activeScriptNode && void generateScriptImages(activeScriptNode.id, rowIds)}
                            onGenerateVideos={(rowIds) => {
                                if (!activeScriptNode) return;
                                if (activeScriptNode.metadata?.storyboardVideoInputMode === "keyframe") void generateScriptVideos(activeScriptNode.id, rowIds);
                                else void createAndGenerateScriptVideos(activeScriptNode.id, rowIds);
                            }}
                            onVideoInputModeChange={(storyboardVideoInputMode) => activeScriptNode && handleConfigNodeChange(activeScriptNode.id, { storyboardVideoInputMode })}
                        />

                        {previsNodeId && activePrevisScene ? (
                            <Suspense
                                fallback={
                                    <div className="fixed inset-0 z-[var(--z-toast)] grid place-items-center px-5" style={{ background: theme.canvas.background, color: theme.node.text }}>
                                        <WorkspaceState icon="loading" title="正在加载 3D 预演台" description="准备场景、镜头与空间控制。" />
                                    </div>
                                }
                            >
                                <CanvasPrevisWorkbench
                                    open
                                    canvasId={projectId}
                                    scene={activePrevisScene}
                                    imageNodes={nodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content || node.metadata?.storageKey))}
                                    onClose={() => setPrevisNodeId(null)}
                                    onChange={savePrevisScene}
                                    onApply={applyPrevisOutput}
                                    onDeleteImageNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                                    onFlush={() => flushCanvasStorePersistence()}
                                    onboardingScope={previsOnboardingScope}
                                />
                            </Suspense>
                        ) : null}

                        <CanvasVersionCompareModal
                            open={Boolean(versionCompareRootId)}
                            versions={versionCompareNodes}
                            onClose={() => setVersionCompareRootId(null)}
                            onSetPrimary={setPrimaryVersion}
                            onFocus={(nodeId) => {
                                setVersionCompareRootId(null);
                                focusCanvasNode(nodeId);
                            }}
                        />

                        <CanvasProjectMediaDialogs
                            cropNode={cropNode}
                            annotationNode={annotationNode}
                            annotationEditNode={annotationEditNodeId ? nodeById.get(annotationEditNodeId) || null : null}
                            maskEditNode={maskEditNode}
                            imageEditNode={imageEditNode}
                            layerDecompositionNode={layerDecompositionNodeId ? nodeById.get(layerDecompositionNodeId) || null : null}
                            textEditNode={textEditNodeId ? nodeById.get(textEditNodeId) || null : null}
                            imageEditPreset={imageEditPreset}
                            upscaleNode={upscaleNode}
                            onCloseCrop={() => setCropNodeId(null)}
                            onCloseAnnotation={() => setAnnotationNodeId(null)}
                            onCloseAnnotationEdit={() => setAnnotationEditNodeId(null)}
                            onCloseMaskEdit={() => setMaskEditNodeId(null)}
                            onCloseImageEdit={() => { setImageEditNodeId(null); setImageEditPreset(null); }}
                            onCloseLayerDecomposition={() => setLayerDecompositionNodeId(null)}
                            onCloseTextEdit={() => setTextEditNodeId(null)}
                            onCloseUpscale={() => setUpscaleNodeId(null)}
                            onCrop={(node, crop) => void cropImageNode(node, crop)}
                            onAnnotate={(node, dataUrl) => void saveAnnotatedImageNode(node, dataUrl)}
                            onAnnotationEdit={(node, payload) => void editAnnotatedImageNode(node, payload)}
                            onMaskEdit={(node, payload) => void maskEditImageNode(node, payload)}
                            onImageOperation={(node, payload) => void editImageNode(node, payload)}
                            onLayerDecomposition={(node, payload) => void decomposeImageLayers(node, payload)}
                            onDetectText={() => {
                                const node = textEditNodeId ? nodeById.get(textEditNodeId) : null;
                                return node ? detectImageText(node) : Promise.reject(new Error("图片节点已不存在"));
                            }}
                            onTextEdit={(node, payload) => void editTextImageNode(node, payload)}
                            onUpscale={(node, params) => void upscaleImageNode(node, params)}
                            config={effectiveConfig}
                        />

                        <CanvasProjectStatusDialogs
                            theme={theme}
                            task={taskDetail}
                            taskLogs={taskDetailLogs}
                            taskLoading={taskDetailLoading}
                            onCloseTask={() => setTaskDetail(null)}
                            onCancelTask={cancelCanvasTask}
                            superResolveNode={superResolveNode}
                            onCloseSuperResolve={() => setSuperResolveNodeId(null)}
                            previewNode={previewNode}
                            onClosePreview={() => setPreviewNodeId(null)}
                            clearConfirmOpen={clearConfirmOpen}
                            onCancelClear={() => setClearConfirmOpen(false)}
                            onConfirmClear={clearCanvas}
                        />

                        <BatchGenerationSettingsDialog
                            open={batchGenDialogOpen}
                            config={batchGenDialogConfig}
                            rowCount={batchGenDialogRowCount}
                            concurrency={batchGenDialogConcurrency}
                            onClose={closeBatchGenDialog}
                            onConfirm={confirmBatchGenDialog}
                        />

                        <AssetPickerModal open={assetPickerOpen} multiple={assetInsertScope === "canvas"} onInsert={handleLibraryAssetsInsert} onClose={closeAssetPicker} />
                        <CanvasCharacterLibraryModal
                            open={characterLibraryOpen}
                            imageResourceId={resourceIdFromStorageKey(selectedCharacterImage?.metadata?.storageKey) || undefined}
                            audioResourceId={resourceIdFromStorageKey(selectedCharacterAudio?.metadata?.storageKey) || undefined}
                            imageTitle={selectedCharacterImage?.title}
                            audioTitle={selectedCharacterAudio?.title}
                            onClose={() => setCharacterLibraryOpen(false)}
                            onInsert={async (payloads) => {
                                await handleProjectAssetsInsert(payloads, characterLibraryPosition);
                            }}
                        />
                        <CanvasProjectAssetModal
                            open={projectAssetOpen}
                            detail={linkedProjectQuery.data}
                            initialCategory={projectAssetInitialCategory}
                            initialFolderId={projectAssetInitialFolderId}
                            onClose={closeProjectAssets}
                            onInsert={handleTimelineProjectAssetsInsert}
                            onInsertFolder={projectAssetScope === "canvas" ? handleProjectFolderInsert : undefined}
                        />
                    </section>
                    {versions.preview ? <CanvasVersionPreview key={versions.preview.key} preview={versions.preview} onReturn={versions.returnToCurrent} onShowVersions={versions.show} /> : null}
                    </div>
                </CanvasOverlayLayerProvider>
                <CanvasVersionHistory history={versions} />
            </main>
        </>
    );
}
