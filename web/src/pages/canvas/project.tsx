import { openEcommerceTable, syncEcommerceTables, ecommerceTableSource, connectEcommerceTableOutputs, ecommerceAnalysisSnapshot, ecommerceSelectedOutputs, ecommerceSuiteMetadata } from "@/lib/ecommerce/ecommerce-table";
import { CanvasEcommerceTableNodeContent } from "@/components/canvas/canvas-ecommerce-table-node";
import { CanvasEcommerceWorkbench } from "@/components/canvas/canvas-ecommerce-workbench";
import { useEcommerceWorkbench } from "./use-ecommerce-workbench";
import { openEcommerceStudio } from "@/lib/ecommerce/ecommerce-studio";
import { CanvasWorkspacePanel } from "@/components/canvas/canvas-workspace-panel";
import { resolveCanvasKind } from "@/lib/canvas/canvas-kind";
import "@/lib/plugins/builtin/ai-art-critique";
import "@/lib/plugins/builtin/media-conversion";
import { useCanvasImageLayerGroups } from "./use-canvas-image-layer-groups";
import { useCanvasImageLayerMaterials } from "./use-canvas-image-layer-materials";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { createCanvasNodeGraph } from "@/lib/canvas/canvas-node-graph";
import { useCanvasImageWheelResize } from "./use-canvas-image-wheel-resize";
import { canCancelGenerationTask } from "@/lib/generation-task-display";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { loadAssetsForUse } from "@/services/user-data-sync";
import { canvasAssetHandoffIds } from "@/lib/canvas/canvas-asset-handoff";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { skillRuntime, type SkillRuntimeMetadata } from "@/services/skill-runtime";
import { listAddedSkills } from "@/services/api/skills";
import { ECOMMERCE_PRODUCT_VIEWS } from "@/lib/ecommerce/ecommerce-contract";
import { ecommerceBindingImages, ecommerceBindingKey, finishEcommerceBinding } from "@/lib/ecommerce/ecommerce-binding";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { ecommerceSliceSpec, type EcommerceSlicePlatform } from "@/lib/ecommerce/ecommerce-slice";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";
import { modelCompatibilityError } from "@/lib/model-selection";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { navigateToSettings } from "@/lib/settings-navigation";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { createCanvasGenerationLiveProjectAdapter, registerCanvasGenerationLiveProject } from "@/services/canvas-generation-consumer";
import { getActiveUserScope } from "@/lib/user-scope";
import { getResource, getResourceAccess, resolveResourceAccessURL, resourceFileUrl, resourceIdFromStorageKey, syncResourceToArkPrivateAsset } from "@/services/api/resources";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { isCanvasImageSourceNode, hasEmbeddedEcommerceControls } from "@/lib/canvas/canvas-image-source";
import copyToClipboard from "copy-to-clipboard";
import { nanoid } from "nanoid";
import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, resolveCanvasAppearance, writeCanvasAppearanceDefault, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
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
import { CanvasViewport } from "@/components/canvas/canvas-viewport";
import { CanvasCollaborationLayer } from "@/components/canvas/canvas-collaboration-layer";
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
import { StoryboardAssetPickerModal } from "@/components/canvas/storyboard-asset-picker-modal";
import { bindingForConnectedNode, replaceStoryboardRowAssets, storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import { normalizeStoryboardAssetBindings } from "@/lib/canvas/canvas-storyboard-assets";
import { normalizeAssetCategory } from "@/lib/asset-category";
import { CanvasBatchTableNodeContent } from "@/components/canvas/canvas-batch-table-node";
import { BatchGenerationSettingsDialog } from "@/components/canvas/batch-generation-settings-dialog";
import { promoteLegacyBatchTableSize } from "@/lib/canvas/canvas-batch-table";
import { filterBatchCellConnections, reconcileBatchCellConnections, syncBatchColumnReferences, type BatchScroll } from "@/lib/canvas/canvas-batch-references";
import { useCanvasBatchReferences } from "./use-canvas-batch-references";
import { useCanvasImageRotation } from "./use-canvas-image-rotation";
import { storyboardMinNodeHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { CanvasPrevisNodePanel } from "@/components/canvas/previs/canvas-previs-node-panel";
import { useFocusMode } from "@/hooks/use-focus-mode";
import { connectCanvasTextMention } from "@/lib/canvas/canvas-text-mention";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import {
    applyCanvasConnectionPromptSync,
    buildCanvasAgentMentionReferences,
    canvasResourceMentionToken,
    buildCanvasNodeMentionReferenceMap,
    buildCanvasResourceReferences,
    normalizeCanvasNodeMentionTokens,
    reorderCanvasResourceConnections,
    replaceCanvasReferenceMentions,
    type CanvasResourceReference,
} from "@/lib/canvas/canvas-resource-references";
import { buildImageToPrevisAgentPrompt, buildImageToPrevisDisplayText } from "@/lib/canvas/image-to-previs-agent";
import type { CloudAgentMessagePresentation } from "@/services/cloud-agent-conversations";
import { CanvasConnectionCreateMenu, CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasOverlayLayerContainer, CanvasOverlayLayerProvider } from "@/components/canvas/canvas-overlay-layer";
import { CanvasLeaferGraphicsLayer } from "@/components/canvas/canvas-leafer-graphics-layer";
import { CanvasFreeformEmptyState, CanvasLinkedProjectEmptyState, CanvasShortDramaEmptyState, CanvasShortDramaGuide, CanvasStoryInputNodeContent, CanvasStylePlaceholderNodeContent } from "@/components/canvas/canvas-short-drama-entry";
import { resolveCanvasEmptyStateKind } from "@/lib/canvas/canvas-starter";
import { failedImageBatchChildren, markImageBatchRetrying, reconcileImageBatchRoot, restoreUnsubmittedImageBatchChild } from "@/lib/canvas/canvas-image-batch-retry";
import { cinematicStoryboardColumns, createCanvasNode, getInputSummary, isHiddenBatchChild } from "@/lib/canvas/canvas-project-domain";
import { canSaveCanvasImageAsModel, ecommerceModelPresetPrompt, type EcommerceModelPreset } from "@/lib/ecommerce/ecommerce-models";
import { ecommerceProductReferenceImages, ecommerceReferenceImageGuide, connectedStyleReferenceNodes, resolveEcommerceInputs, withImageAsEcommerceReference } from "@/lib/ecommerce/ecommerce-canvas";
import { buildEcommerceProfileDraftPrompt, parseEcommerceProfileDraft } from "@/lib/ecommerce/ecommerce-draft";
import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { ecommerceOneClickFlow, ecommerceOneClickScreens, type EcommerceOneClickFlowId } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceBriefBlock, ecommerceBriefRows, ecommerceBriefSlicePlatform } from "@/lib/ecommerce/ecommerce-brief";
import { ecommerceSuiteDraftPrompt, ecommerceSuiteRows, parseEcommerceSuiteDraft, type EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import { createEcommerceStyleReference, ecommerceSuiteTargets } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { isEcommerceInputHandle, withEcommerceInputConnection } from "@/lib/ecommerce/ecommerce-canvas";
import { rasterizeEcommerceDetailPage } from "@/lib/ecommerce/ecommerce-rasterize";
import { generationErrorMessage } from "@/lib/generation-error";
import { useEcommerceSuitePrompt } from "@/stores/use-ecommerce-suite-prompt";
import { CanvasEcommerceModelLibraryModal } from "@/components/canvas/canvas-ecommerce-model-library";
import { bindStoryboardKeyframes, storyboardKeyframeTime, storyboardRowsFromBatchTable } from "@/lib/canvas/canvas-batch-storyboard";
import { stampCanvasNodeChanges } from "@/lib/canvas/canvas-node-timestamps";
import { useCanvasContentUpdates } from "./use-canvas-content-updates";
import { canvasAssetHandoffAttempt, finalizeCanvasAssetHandoff, uninsertedCanvasAssetHandoffPayloads } from "@/lib/canvas/canvas-asset-handoff";
import { batchSourceRestriction } from "@/lib/canvas/canvas-batch-connection";
import { deriveStoryboardPipelineProgress } from "@/lib/canvas/canvas-storyboard-progress";
import { CanvasOperationChangeToast, CanvasMergeStatusToast, CanvasUploadStatusToast } from "./canvas-project-feedback";
import { getGenerationCount } from "@/lib/canvas/canvas-project-generation";
import { cancelGenerationTask } from "@/services/api/task-center";
import { CanvasTopBar } from "./canvas-project-top-bar";
import { CanvasSyncStatus } from "./canvas-sync-status";
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

    return <CanvasViewportPage />;
}

function CanvasViewportPage() {
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
    const [agentPrefillRequest, setAgentPrefillRequest] = useState<(CloudAgentMessagePresentation & { id: number; text: string; autoSubmit?: boolean; requiresVision?: boolean }) | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [canvasAppearance, setCanvasAppearance] = useState<CanvasAppearance>(() => canvasAppearanceForTheme(colorTheme));
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>(DEFAULT_CANVAS_BACKGROUND_MODE);
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [canvasTool, setCanvasTool] = useState<CanvasToolMode>("box-select");
    const [hideNodeConnections, setHideNodeConnections] = useState(readCanvasHideNodeConnections);
    const [projectLoaded, setProjectLoaded] = useState(false);
    useLayoutEffect(() => {
        if (!projectLoaded) return;
        const nextNodes = syncBatchColumnReferences(syncEcommerceTables(nodesRef.current, connectionsRef.current), connectionsRef.current);
        const nextConnections = reconcileBatchCellConnections(nextNodes, connectionsRef.current);
        if (nextNodes !== nodesRef.current) setNodes(nextNodes);
        if (nextConnections !== connectionsRef.current) setConnections(nextConnections);
    }, [projectLoaded, nodes, connections, setNodes, setConnections]);
    const workspaceMode: CanvasWorkspaceMode = "professional";
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [ecommerceWorkbenchOpen, setEcommerceWorkbenchOpen] = useState(false);
    const [ecommerceWorkbenchStudioId, setEcommerceWorkbenchStudioId] = useState<string | undefined>();
    const [ecommerceWorkbenchCapability, setEcommerceWorkbenchCapability] = useState<import("@/lib/ecommerce/ecommerce-capabilities").EcommerceCapability>("planning");
    const ecommerceWorkbenchRunRef = useRef<ReturnType<typeof useEcommerceWorkbench>["run"] | null>(null);
    const ecommerceWorkbenchStopRef = useRef<(() => void) | null>(null);
    const ecommerceWorkbenchRunningRef = useRef<((nodeId: string) => boolean) | null>(null);
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
    const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
    const [modelImageToAdd, setModelImageToAdd] = useState<{ storageKey: string; name: string } | null>(null);
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
    const [batchScrollById, setBatchScrollById] = useState<Record<string, BatchScroll>>({});
    const [previsNodeId, setPrevisNodeId] = useState<string | null>(null);
    const [libTVImportOpen, setLibTVImportOpen] = useState(false);
    const [libTVImportTemplateUuid, setLibTVImportTemplateUuid] = useState<string>();

    useEffect(() => {
        const templateUuid = searchParams.get("importTemplate");
        if (!projectLoaded || !templateUuid) return;
        setLibTVImportOpen(true);
        setLibTVImportTemplateUuid(templateUuid);
        const next = new URLSearchParams(searchParams);
        next.delete("importTemplate");
        setSearchParams(next, { replace: true });
    }, [projectLoaded, searchParams, setSearchParams]);
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
    const [storyboardAssetTarget, setStoryboardAssetTarget] = useState<{ nodeId: string; rowId: string } | null>(null);
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

    const { loadError, retryLoad, addedSkills, agentCreatedNodes, clearCanvasFiles, createAndOpenProject, currentProject, deleteCurrentProject, renameCurrentProject, saveCanvasProject, updateProject } = useCanvasProjectLifecycle({
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

    const openAgent = useCallback(() => {
        openAssistant();
    }, [openAssistant]);

    const sendSelectionToAgent = useCallback(
        (nodeId?: string, instruction?: string) => {
            const ids = nodeId ? [nodeId] : Array.from(selectedNodeIdsRef.current);
            const references = ids.map((id) => agentMentionReferences.find((reference) => reference.nodeId === id)).filter((reference): reference is CanvasResourceReference => Boolean(reference));
            if (!references.length) return;
            if (nodeId && !selectedNodeIdsRef.current.has(nodeId)) {
                const selection = new Set([nodeId]);
                selectedNodeIdsRef.current = selection;
                setSelectedNodeIds(selection);
            }
            const text = `${references.map(canvasResourceMentionToken).join(" ")}${
                instruction?.trim()
                    ? `
${instruction.trim()}`
                    : " "
            }`;
            setAgentPrefillRequest((current) => ({ id: (current?.id ?? 0) + 1, text }));
            openAgent();
            setContextMenu(null);
        },
        [agentMentionReferences, openAgent],
    );

    const sendImageToPrevisAgent = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image) return;
            const reference = agentMentionReferences.find((item) => item.nodeId === node.id && item.kind === "image");
            if (!reference) {
                message.warning("这张图片暂时没有可供 Agent 引用的画布资源");
                return;
            }
            if (!selectedNodeIdsRef.current.has(node.id)) {
                const selection = new Set([node.id]);
                selectedNodeIdsRef.current = selection;
                setSelectedNodeIds(selection);
            }
            setAgentPrefillRequest((current) => ({
                id: (current?.id ?? 0) + 1,
                text: buildImageToPrevisAgentPrompt(reference),
                displayText: buildImageToPrevisDisplayText(),
                canvasReferenceNodeId: reference.nodeId,
                autoSubmit: true,
                requiresVision: true,
            }));
            openAgent();
            setContextMenu(null);
        },
        [agentMentionReferences, message, openAgent],
    );
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
    useEffect(() => {
        if (canvasKind === "ecommerce")
            void useEcommerceSettings
                .getState()
                .load()
                .catch((error) => message.error(error instanceof Error ? error.message : "电商配置读取失败"));
    }, [canvasKind, message]);
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
    const nodeGraphContext = useMemo<CanvasNodeGraphContextValue>(() => createCanvasNodeGraph(nodes, connections), [connections, nodes]);

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
            if (rect.width <= 0 || rect.height <= 0) return;
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
        focusCanvasImageNodes,
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

    const applyLibTVDialogImport = useCallback(
        async (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => {
            const fitAfterImport = Boolean(libTVImportTemplateUuid) && nodesRef.current.length === 0;
            await applyLibTVImport(importedNodes, importedConnections);
            if (fitAfterImport) fitCanvasContent();
        },
        [applyLibTVImport, fitCanvasContent, libTVImportTemplateUuid],
    );

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
        createAssetPayloadNode,
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
    const { actions: batchReferences, pickerModal: batchReferencePickerModal } = useCanvasBatchReferences({ nodesRef, connectionsRef, setNodes, setConnections, createFileNode });
    const { rotateImageNode, rotatingNodeId } = useCanvasImageRotation({ projectId, nodesRef, setNodes, setConnections, setSelectedNodeIds, readOnly: false });
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
        activeLayerGroupIds,
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
        applyGenerationTaskResult,
    });

    useCanvasImageLayerGroups({ projectId, enabled: projectLoaded, nodes, nodesRef, setNodes, runningNodeId, activeLayerGroupIds });
    const extractLayerMaterials = useCanvasImageLayerMaterials({ projectId, domainProjectId: currentProject?.projectId, enabled: projectLoaded, nodes, nodesRef, setNodes, setConnections });

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
        connectionTargetAnchorXRatio,
        connectionTargetHandleId,
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
        batchScrollById,
        onBatchCellConnect: batchReferences.connectCell,
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
            if (
                !node ||
                node.type === CanvasNodeType.Script ||
                node.type === CanvasNodeType.Drawing ||
                node.type === CanvasNodeType.Panorama ||
                node.type === ART_CRITIQUE_NODE_TYPE ||
                (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId)
            ) {
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
            const storageKey = characterCover ? `resource:${characterCover.resourceId}` : local?.kind === "image" || local?.kind === "video" || local?.kind === "audio" ? local.data.storageKey : remoteResourceId ? asset.storageKey : undefined;
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
        relatedHighlight,
        resourceReferenceByNodeId,
        selectedNodeBounds,
        selectedVideoNodes,
        skillMentionReferences,
        superResolveNode,
        toolbarNode,
        upscaleNode,
        visibleNodes,
    } = useCanvasRenderModel({
        nodes,
        connections,
        assets,
        viewport,
        viewportSize: size,
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
        previsNodeId,
        scriptEditorNodeId,
        dialogNodeId,
    });

    const handleSelectedImageWheel = useCanvasImageWheelResize({ projectId, nodesRef, selectedNodeIdsRef, historyPausedRef, setNodes, onResize: handleNodeResize });
    const visibleDisplayConnections = useMemo(
        () =>
            filterBatchCellConnections(
                filterCanvasDisplayConnections(displayConnections, {
                    enabled: hideNodeConnections,
                    hoveredNodeId,
                    selectedNodeIds,
                    activeNodeId,
                    selectedConnectionId,
                }),
                batchScrollById,
                selectedConnectionId,
            ),
        [activeNodeId, batchScrollById, displayConnections, hideNodeConnections, hoveredNodeId, selectedConnectionId, selectedNodeIds],
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
    const { updateNode: updateNodeFromContent, updateMediaNode: updateMediaNodeFromContent } = useCanvasContentUpdates(nodesRef, setNodesState);
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
    const saveImageAsModel = useCallback(
        (node: CanvasNodeData) => {
            const ref = node.metadata?.storageKey;
            if (!ref || !canSaveCanvasImageAsModel(node)) {
                message.warning("这张图还没落盘，等生成完成后再存");
                return;
            }
            setModelImageToAdd({ storageKey: ref, name: node.title || "新模特" });
            setModelLibraryOpen(true);
        },
        [message],
    );

    const addEcommerceInput = useCallback(
        (product: CanvasNodeData, handle: string) => {
            if (!isEcommerceInputHandle(handle)) return;
            const plan = createEcommerceStyleReference(product, nodesRef.current, handle);
            if (handle.startsWith("product-view:")) {
                const view = ECOMMERCE_PRODUCT_VIEWS.find((item) => handle === `product-view:${item.id}`);
                plan.node.title = view?.label || "商品图";
                plan.node.metadata = { ...plan.node.metadata, ecommerceReferenceRole: undefined };
            }
            const wrapper = Array.from(document.querySelectorAll<HTMLElement>("[data-node-id]")).find((element) => element.dataset.nodeId === product.id);
            const slot = Array.from(wrapper?.querySelectorAll<HTMLElement>("[data-ecommerce-input]") || []).find((element) => element.dataset.ecommerceInput === handle);
            const rect = wrapper?.getBoundingClientRect();
            const pin = slot?.querySelector(".ecom-input-pin")?.getBoundingClientRect();
            const connection = { ...plan.connection, ...(rect?.width && rect.height && pin ? { toAnchorRatio: (pin.top + pin.height / 2 - rect.top) / rect.height, toAnchorXRatio: (pin.left + pin.width / 2 - rect.left) / rect.width } : {}) };
            const nextNodes = [...nodesRef.current, plan.node];
            const nextConnections = withEcommerceInputConnection(connectionsRef.current, connection);
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([plan.node.id]));
            setSelectedConnectionId(null);
            handleUploadRequest(plan.node.id);
        },
        [handleUploadRequest, nodesRef, setConnections, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const addEcommerceReference = useCallback(
        (product: CanvasNodeData) => {
            const used = new Set(connectionsRef.current.filter((edge) => edge.toNodeId === product.id).map((edge) => edge.toHandleId));
            let index = 0;
            while (used.has(`visual-reference:${index}`)) index += 1;
            addEcommerceInput(product, `visual-reference:${index}`);
        },
        [addEcommerceInput],
    );

    const ecommerceInputAnchor = (element: Element) => {
        const slot = element.closest("[data-ecommerce-input]");
        const rect = slot?.closest("[data-node-id]")?.getBoundingClientRect();
        const pin = slot?.querySelector(".ecom-input-pin")?.getBoundingClientRect();
        return rect?.width && rect.height && pin ? ([(pin.top + pin.height / 2 - rect.top) / rect.height, (pin.left + pin.width / 2 - rect.left) / rect.width] as const) : ([undefined, undefined] as const);
    };
    const connectEcommerceInput = useCallback(
        (event: React.PointerEvent, nodeId: string, handle: string) => {
            const [y, x] = ecommerceInputAnchor(event.currentTarget);
            handleConnectStart(event, nodeId, "target", handle, y, x);
        },
        [handleConnectStart],
    );
    const dropEcommerceInput = useCallback(
        (event: React.PointerEvent, nodeId: string, handle: string) => {
            const [y, x] = ecommerceInputAnchor(event.currentTarget);
            handleConnectDrop(event, nodeId, handle, y, x);
        },
        [handleConnectDrop],
    );
    const disconnectEcommerceInput = useCallback(
        (nodeId: string, handle: string, sourceId: string) => {
            const next = connectionsRef.current.filter((edge) => !(edge.toNodeId === nodeId && edge.fromNodeId === sourceId));
            connectionsRef.current = next;
            setConnections(next);
            const product = nodesRef.current.find((node) => node.id === nodeId);
            if (product?.metadata?.productProfile && handle.startsWith("product-view:")) {
                const views = { ...product.metadata.productProfile.views };
                for (const key of ECOMMERCE_PRODUCT_VIEWS) if (views[key.id] === sourceId || handle === `product-view:${key.id}`) views[key.id] = "";
                updateNodeMetadataFromContent(nodeId, { productProfile: { ...product.metadata.productProfile, views } });
            }
            setSelectedConnectionId(null);
        },
        [setConnections, updateNodeMetadataFromContent],
    );
    const updateEcommerceInputAnchor = useCallback(
        (nodeId: string, handle: string, y: number, x: number) => {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            let changed = false;
            const next = connectionsRef.current.map((edge) => {
                if (edge.toNodeId !== nodeId || edge.toHandleId !== handle || (Math.abs((edge.toAnchorRatio ?? -1) - y) < 0.001 && Math.abs((edge.toAnchorXRatio ?? -1) - x) < 0.001)) return edge;
                changed = true;
                return { ...edge, toAnchorRatio: y, toAnchorXRatio: x };
            });
            if (changed) {
                connectionsRef.current = next;
                setConnections(next);
            }
        },
        [setConnections],
    );

    const useImageAsStyleReference = useCallback(
        (node: CanvasNodeData) => {
            const productIds = nodesRef.current.filter((item) => item.type === CanvasNodeType.Product).map((item) => item.id);
            const next = withImageAsEcommerceReference(connectionsRef.current, node.id, productIds);
            connectionsRef.current = next;
            setConnections(next);
            updateNodeMetadataFromContent(node.id, { ecommerceReferenceRole: "style" });
        },
        [setConnections, updateNodeMetadataFromContent],
    );

    /**
     * 电商创作：公共起手式出一张模特参考图。
     *
     * 落一个图片节点再提交生成，而不是在弹窗里悄悄出一张塞进库：
     * 出图要花积分，用户得看得见它、能重出、能删。出完在图上点「存为模特」入库。
     */
    const generateEcommerceModelPreset = useCallback(
        async (preset: EcommerceModelPreset) => {
            const prompt = ecommerceModelPresetPrompt(preset);
            const imageNode = createCanvasNode(CanvasNodeType.Image, getCanvasCenter(), { prompt });
            imageNode.title = preset.name;
            setNodes((current) => [...current, imageNode]);
            setSelectedNodeIds(new Set([imageNode.id]));
            setSelectedConnectionId(null);
            await generateNodeRef.current?.(imageNode.id, "image", prompt, { skipDuplicateConfirmation: true });
        },
        [getCanvasCenter, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    /**
     * 一键流程的收尾：全屏出完 → 装订成详情页长图并切片。
     *
     * 装订是纯装配：九屏已经出好了，长图只是按顺序接起来、按平台上限切开。
     * 交给模型做才是错的——它会顺手重画每一屏，商品就不一致了。
     * 这一步不涉及文字：文字已经和画面一起由模型画在每一屏上了。
     */
    const bindingRef = useRef(new Set<string>());
    const bindEcommerceSuite = useCallback(
        async (node: CanvasNodeData, rows: EcommerceSuiteRow[]) => {
            if (bindingRef.current.has(node.id)) throw new Error("正在装订，请稍候");
            const bindingProduct = ecommerceTableSource(node, nodesRef.current, connectionsRef.current).product;
            if (bindingProduct.metadata?.ecommerceOneClick) throw new Error("请先完成或取消当前自动装订");
            bindingRef.current.add(node.id);
            const scope = getActiveUserScope();
            try {
                const setting = await useEcommerceSettings.getState().load();
                const { source, product } = ecommerceTableSource(node, nodesRef.current, connectionsRef.current);
                const flow = ecommerceOneClickFlow(source.metadata?.ecommerceFlowId);
                if (!flow?.bind || !setting.enabled || !setting.autoBindEnabled || !setting.flows[flow.id].enabled) throw new Error("当前用途未开放长图装订");
                const platform = ecommerceBriefSlicePlatform(source.metadata?.ecommerceBrief, source.metadata?.ecommercePlatform || product.metadata?.ecommercePlatform);
                const outputs = ecommerceSelectedOutputs(source, rows, nodesRef.current, connectionsRef.current);
                const snapshot = JSON.stringify([product.id, platform, outputs.map((image) => [image.id, image.metadata?.storageKey])]);
                const urls: string[] = [];
                for (const image of outputs) urls.push(await imageToDataUrl({ url: image.metadata?.content, storageKey: image.metadata?.storageKey, name: image.title }));
                const result = await rasterizeEcommerceDetailPage({ imageUrls: urls, platform, code: product.metadata?.productProfile?.name });
                if (scope !== getActiveUserScope()) throw new Error("账号已切换，已取消装订");
                const validateSelection = () => {
                    const { source: latest, product: latestProduct } = ecommerceTableSource(node, nodesRef.current, connectionsRef.current);
                    const selected = ecommerceSelectedOutputs(latest, latest.metadata?.ecommerceSuite?.rows || [], nodesRef.current, connectionsRef.current);
                    const latestPlatform = ecommerceBriefSlicePlatform(latest.metadata?.ecommerceBrief, latest.metadata?.ecommercePlatform || latestProduct.metadata?.ecommercePlatform);
                    if (snapshot !== JSON.stringify([latestProduct.id, latestPlatform, selected.map((image) => [image.id, image.metadata?.storageKey])])) throw new Error("商品、切片规格、采用结果或顺序已变化，请重新装订");
                };
                validateSelection();
                if (result.plan.conflicts.length || result.plan.overTotalHeight) throw new Error("当前图片无法按平台限制安全切片，请使用交付节点检查尺寸与切点");
                await exportEcommerceDetailPage(source, result.longImage.dataUrl, result.pieces, result.fileNames, validateSelection);
                message.success("已按采用版本生成长图与切片");
            } finally {
                bindingRef.current.delete(node.id);
            }
        },
        [exportEcommerceDetailPage, message],
    );
    useEffect(() => {
        if (!projectLoaded || !exportEcommerceDetailPage) return;
        for (const product of nodes.filter((item) => item.type === CanvasNodeType.Product && item.metadata?.ecommerceOneClick)) {
            const plan = product.metadata!.ecommerceOneClick!;
            const bindingKey = ecommerceBindingKey(product.id, plan);
            if (plan.status === "failed" || bindingRef.current.has(bindingKey) || !plan.nodeIds.length) continue;
            const ready = ecommerceBindingImages(plan, nodes);
            if (!ready) continue;
            bindingRef.current.add(bindingKey);
            const scope = getActiveUserScope();
            void (async () => {
                try {
                    const urls: string[] = [];
                    for (const item of ready) urls.push(await imageToDataUrl({ url: item.metadata?.content, storageKey: item.metadata?.storageKey, name: item.title }));
                    const platform = (plan.platform || product.metadata?.ecommercePlatform || "taobao") as EcommerceSlicePlatform;
                    if (!ecommerceSliceSpec(platform)) throw new Error("当前平台不支持自动切片，请选择支持的平台或手动导出");
                    const result = await rasterizeEcommerceDetailPage({ imageUrls: urls, platform, code: product.metadata?.productProfile?.name });
                    if (scope !== getActiveUserScope()) return;
                    const validatePlan = () => {
                        const currentPlan = nodesRef.current.find((item) => item.id === product.id)?.metadata?.ecommerceOneClick;
                        if (!currentPlan || ecommerceBindingKey(product.id, currentPlan) !== bindingKey) throw new Error("装订计划已取消或替换");
                        const currentImages = ecommerceBindingImages(currentPlan, nodesRef.current);
                        if (
                            !currentImages ||
                            currentImages.length !== ready.length ||
                            ready.some((image, index) => {
                                const current = currentImages[index];
                                return current.id !== image.id || current.metadata?.storageKey !== image.metadata?.storageKey || current.metadata?.content !== image.metadata?.content || current.metadata?.taskId !== image.metadata?.taskId;
                            })
                        )
                            throw new Error("装订图片已变化，请重新装订");
                    };
                    validatePlan();
                    await exportEcommerceDetailPage(product, result.longImage.dataUrl, result.pieces, result.fileNames, validatePlan);
                    setNodes((current) => finishEcommerceBinding(current, product.id, bindingKey));
                    message.success(`已装订：${result.longImage.height}px 长图 + ${result.pieces.length} 张切片`);
                } catch (error) {
                    if (scope !== getActiveUserScope()) return;
                    message.error(generationErrorMessage(error));
                    setNodes((current) => finishEcommerceBinding(current, product.id, bindingKey, generationErrorMessage(error)));
                } finally {
                    bindingRef.current.delete(bindingKey);
                }
            })();
        }
    }, [exportEcommerceDetailPage, message, nodes, projectLoaded, setNodes]);

    const canvasNodeActions = useMemo<CanvasNodeActionContextValue>(
        () => ({
            stopEcommerceWorkbench: () => ecommerceWorkbenchStopRef.current?.(),
            isEcommerceWorkbenchRunning: (nodeId) => ecommerceWorkbenchRunningRef.current?.(nodeId) || false,
            runEcommerceWorkbench: (request) => {
                if (!ecommerceWorkbenchRunRef.current) return Promise.reject(new Error("电商工作台尚未就绪"));
                return ecommerceWorkbenchRunRef.current(request);
            },
            openEcommerceWorkbench: (node, capability = "planning") => {
                setEcommerceWorkbenchStudioId(node.id);
                setEcommerceWorkbenchCapability(capability);
                setEcommerceWorkbenchOpen(true);
            },
            openEcommerceStudio: (product) => {
                try {
                    const result = openEcommerceStudio(nodesRef.current, connectionsRef.current, product.id);
                    setNodes(result.nodes);
                    setConnections(result.connections);
                    setSelectedNodeIds(new Set([result.studio.id]));
                    focusCanvasNode(result.studio.id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "创建生图台失败");
                }
            },
            upload: replaceCanvasNodeMedia,
            download: downloadNodeImage,
            duplicate: duplicateNodeFromContent,
            deleteNode: deleteNodeFromContent,
            updateMetadata: updateNodeMetadataFromContent,
            updateNode: updateNodeFromContent,
            updateMediaNode: updateMediaNodeFromContent,
            openArtCritique,
            addPanoramaCaptureNode,
            extractLayerMaterials,
            spawnEcommerceMaterials: async (node, planId) => {
                await spawnEcommerceMaterials(node, planId);
            },
            generateEcommerceMaterials: async (node, planId) => {
                await generateEcommerceMaterialsRef.current?.(node, planId);
            },
            exportEcommerceLayout,
            exportEcommerceDetailPage,
            reversePromptFromNode: (node, prompt) => createImageReversePromptNodes(node, prompt),
            draftWithAgent: (node, instruction) => sendSelectionToAgent(node.id, instruction),
            generateEcommerceNode: async (node, mode, prompt) => {
                await generateNodeRef.current?.(node.id, mode, prompt, { skipDuplicateConfirmation: true });
            },
            generateEcommerceShotSet: async (node, shotIds) => {
                await generateEcommerceShotSetRef.current?.(node, shotIds);
            },
            saveImageAsModel,
            addEcommerceReference,
            addEcommerceInput,
            connectEcommerceInput,
            dropEcommerceInput,
            disconnectEcommerceInput,
            updateEcommerceInputAnchor,
            viewImage: (node) => setPreviewNodeId(node.id),
            focusNode: focusCanvasNode,
            generateEcommerceModelPreset,
            openEcommerceTable: (node, flowId) => {
                try {
                    const plan = openEcommerceTable(nodesRef.current, connectionsRef.current, node.id, flowId);
                    setNodes(plan.nodes);
                    setConnections(plan.connections);
                    setSelectedNodeIds(new Set([plan.table.id]));
                    focusCanvasNode(plan.table.id);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "创建创作表失败");
                }
            },
            generateEcommerceSuite: async (node, flowId, slotIds, rows) => Boolean(await generateEcommerceSuiteRef.current?.(node, flowId, slotIds, rows)),
            draftEcommerceSuite: (node, flowId, analysisModel, rows) => draftEcommerceSuiteRef.current?.(node, flowId, analysisModel, rows),
            reverseEcommerceSuite: (node, flowId, analysisModel) => reverseEcommerceSuiteRef.current?.(node, flowId, analysisModel),
            bindEcommerceSuite,
            draftEcommerceProfile: (node) => draftEcommerceProfileRef.current?.(node),
        }),
        [
            bindEcommerceSuite,
            extractLayerMaterials,
            addEcommerceInput,
            addEcommerceReference,
            connectEcommerceInput,
            dropEcommerceInput,
            disconnectEcommerceInput,
            updateEcommerceInputAnchor,
            addPanoramaCaptureNode,
            createImageReversePromptNodes,
            deleteNodeFromContent,
            downloadNodeImage,
            duplicateNodeFromContent,
            exportEcommerceLayout,
            focusCanvasNode,
            generateEcommerceModelPreset,
            openArtCritique,
            replaceCanvasNodeMedia,
            saveImageAsModel,
            sendSelectionToAgent,
            spawnEcommerceMaterials,
            updateMediaNodeFromContent,
            updateNodeFromContent,
            updateNodeMetadataFromContent,
        ],
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
        enabled: projectLoaded,
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
                const resourceId = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type as CanvasNodeType) ? resourceIdFromStorageKey(node.metadata?.storageKey) : "";
                // Resource-backed media must use the central access contract. This keeps
                // copy operations on the configured CDN/OSS URL instead of copying the
                // platform file endpoint or a stale URL persisted in canvas metadata.
                const copySource = resourceId ? resolveResourceAccessURL((await getResourceAccess(`resource:${resourceId}`, "copy")).url) : content || "";
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
                const mediaURL = resourceId ? resolveResourceAccessURL((await getResourceAccess(`resource:${resourceId}`, "copy")).url) : mediaPath ? new URL(mediaPath, window.location.href).toString() : "";
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
        connectionsRef,
        assets,
        setNodes,
        handleGenerateNode,
    });
    const ecommerceWorkbench = useEcommerceWorkbench({
        projectId,
        domainProjectId: linkedProjectId,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        center: getCanvasCenter,
        applyResult: applyGenerationTaskResult,
        bindTask: bindGenerationTask,
    });
    ecommerceWorkbenchRunRef.current = ecommerceWorkbench.run;
    ecommerceWorkbenchStopRef.current = ecommerceWorkbench.stop;
    ecommerceWorkbenchRunningRef.current = ecommerceWorkbench.isRunning;
    const addEcommerceStudio = useCallback(() => {
        const studio = createCanvasNode(CanvasNodeType.EcommerceStudio, getCanvasCenter());
        setNodes((current) => [...current, studio]);
        setSelectedNodeIds(new Set([studio.id]));
        focusCanvasNode(studio.id);
    }, [getCanvasCenter, setNodes, focusCanvasNode]);

    /**
     * 电商创作：铺一套物料并直接推入生成队列。
     *
     * 铺完再让人一张张点「生成」是这条流程里最蠢的一段——五张主图点五次，十三张点十三次。
     * 批次队列（并发上限、失败重试、任务对账）本来就有，电商直接复用它；批次挂在商品节点上，
     * 因为这一套交付物本来就属于这个商品，不属于其中某一张图。
     *
     * 提交前确认张数与模型：一次铺一套会真金白银地跑十几次外部模型调用，不能静默提交。
     */
    const generateEcommerceMaterials = useCallback(
        async (node: CanvasNodeData, planId: string) => {
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
            focusCanvasImageNodes(imageNodeIds);
            if (
                enqueueGenerationBatch(
                    node.id,
                    "batch_image",
                    imageNodeIds.map((id) => ({ rowId: id, nodeId: id })),
                )
            ) {
                message.success(`${imageNodeIds.length} 张已加入生成队列`);
            }
        },
        [effectiveConfig.imageModel, effectiveConfig.model, enqueueGenerationBatch, focusCanvasImageNodes, message, modal, spawnEcommerceMaterials],
    );

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
    const generateEcommerceShotSet = useCallback(
        async (node: CanvasNodeData, shotIds?: string[]) => {
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
            if (
                enqueueGenerationBatch(
                    node.id,
                    "batch_image",
                    targets.map((id) => ({ rowId: id, nodeId: id })),
                )
            ) {
                message.success(`${targets.length} 张已加入生成队列`);
            }
        },
        [connectionsRef, effectiveConfig.imageModel, effectiveConfig.model, enqueueGenerationBatch, message, modal, nodes, nodesRef, spawnEcommerceShotOutputs],
    );

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
     * 判据与生成链路共用视图解析：起草时看到的图，
     * 必须和后面出图时用的图是同一批。
     */
    const productReferenceImages = useCallback(
        (productNodeId: string, includeVisualReferences = false) => {
            const product = nodesRef.current.find((node) => node.id === productNodeId);
            return [
                ...(product ? ecommerceProductReferenceImages(product, nodesRef.current, connectionsRef.current) : []),
                ...(includeVisualReferences
                    ? connectedStyleReferenceNodes(productNodeId, nodesRef.current, connectionsRef.current).map((node) => ({
                          id: node.id,
                          name: `视觉参考：${node.title || node.id}`,
                          type: node.metadata?.mimeType || "image/png",
                          dataUrl: "",
                          url: node.metadata?.content,
                          storageKey: node.metadata?.storageKey,
                      }))
                    : []),
            ];
        },
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
    const runEcommerceTextDraft = useCallback(
        async (productNode: CanvasNodeData, prompt: string, modelOverride?: string, skillIds?: string[], includeVisualReferences = false, ecommerceAnalysisFlow?: EcommerceOneClickFlowId) => {
            const scope = getActiveUserScope();
            const referenceImages = productReferenceImages(productNode.id, includeVisualReferences);
            // 技能注入与出图那条链路同一套：`skillRuntime.prepare` 把技能的正文与关联文件
            // 拼进提示词。**没选就不注入**——用户库里可能有二十个技能，全塞进一次分析
            // 会把提示词顶爆，而大部分跟这个品类无关。
            let effectivePrompt = [prompt, ecommerceReferenceImageGuide(referenceImages)].filter(Boolean).join("\n\n");
            let skillMetadata: SkillRuntimeMetadata = {};
            if (skillIds?.length) {
                try {
                    const { skills } = await listAddedSkills({ force: true });
                    const skillExecution = await skillRuntime.prepare({ profile: "canvas", prompt: effectivePrompt, skills, selectedSkillIds: skillIds });
                    effectivePrompt = skillExecution.prompt;
                    skillMetadata = skillExecution.metadata;
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "技能上下文加载失败");
                    return undefined;
                }
            }
            if (getActiveUserScope() !== scope) return undefined;
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
                    metadata: { ...skillMetadata, nodeId: productNode.id, ...(ecommerceAnalysisFlow ? { ecommerceAnalysisFlow } : {}) },
                });
                return getActiveUserScope() === scope ? result.text || "" : undefined;
            } catch (error) {
                message.error(generationErrorMessage(error));
                return undefined;
            }
        },
        [effectiveConfig, message, productReferenceImages, projectId],
    );

    /**
     * 电商创作：读商品实拍，起草商品档案。
     *
     * 读的是**图**，不是档案——档案就是它要写的东西。所以这里必须把商品实拍递进去，
     * 这也是「让助手读图起草档案」这句话里「读图」两个字的全部含义。
     */
    const draftEcommerceProfile = useCallback(
        async (node: CanvasNodeData) => {
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
        },
        [message, nodesRef, productReferenceImages, runEcommerceTextDraft, updateNodeMetadataFromContent],
    );

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
    const draftEcommerceSuite = useCallback(
        async (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, analysisModel?: string, rowsOverride?: EcommerceSuiteRow[]) => {
            const flow = ecommerceOneClickFlow(flowId);
            if (!flow) return undefined;
            const setting = await useEcommerceSettings.getState().load();
            if (!setting.enabled || !setting.flows[flowId].enabled) throw new Error("管理员已停用此电商创作用途");
            const { source: suiteNode, product: productNode } = ecommerceTableSource(node, nodesRef.current, connectionsRef.current);
            if (!analysisModel?.trim()) {
                message.warning("未选择分析模型，请先在面板中选择一个支持看图的文本模型");
                return undefined;
            }
            if (!productReferenceImages(productNode.id).length) {
                message.warning("还没有连入商品实拍——分析要先有图，模型才知道要画的是什么");
                return undefined;
            }
            // 交给模型的是**当前那张表**，不是行业套路给的骨架：用户可能已经删到六屏、
            // 改过职责，或者在自己的提示词里要求了不同的分工。
            const rows = ecommerceBriefRows(flow, rowsOverride || ecommerceSuiteRows(flow, suiteNode.metadata?.ecommerceSuitesByFlow?.[flowId] || suiteNode.metadata?.ecommerceSuite), suiteNode.metadata?.ecommerceBrief);
            const uniform = {
                styleReferenceNames: connectedStyleReferenceNodes(productNode.id, nodesRef.current, connectionsRef.current).map((item) => item.title || item.id),
            };
            const skillIds = suiteNode.metadata?.ecommerceAnalysisSkillsByFlow?.[flowId];
            const analysisSnapshot = ecommerceAnalysisSnapshot(suiteNode, productNode, nodesRef.current, connectionsRef.current);
            const text = await runEcommerceTextDraft(
                productNode,
                [ecommerceSuiteDraftPrompt(flow, productNode.metadata?.productProfile, rows, null, uniform), ecommerceBriefBlock(suiteNode.metadata?.ecommerceBrief)].filter(Boolean).join("\n\n"),
                analysisModel,
                skillIds,
                true,
                flowId,
            );
            if (text === undefined) return undefined;
            const parsed = parseEcommerceSuiteDraft(text, flow);
            if (!parsed) {
                message.warning("模型返回的提示词格式不完整，请重试或直接编辑提示词表");
                return undefined;
            }
            if (suiteNode.metadata?.ecommerceBrief?.imageCount && parsed.length !== suiteNode.metadata.ecommerceBrief.imageCount) {
                message.warning(`要求 ${suiteNode.metadata.ecommerceBrief.imageCount} 张，模型返回 ${parsed.length} 张，当前表格已保留，请重试`);
                return undefined;
            }
            const latest = nodesRef.current.find((item) => item.id === suiteNode.id);
            if (!latest) return undefined;
            const latestProduct = nodesRef.current.find((item) => item.id === productNode.id);
            if (!latestProduct || analysisSnapshot !== ecommerceAnalysisSnapshot(latest, latestProduct, nodesRef.current, connectionsRef.current)) {
                message.warning("分析期间表格、商品资料或参考图已变化，保留当前编辑，请重新分析");
                return undefined;
            }
            const suite = { flow: flow.id, rows: parsed.map((row) => ({ ...row, resultNodeId: rows.find((previous) => previous.slotId === row.slotId)?.resultNodeId })), source: "draft" as const, updatedAt: new Date().toISOString() };
            updateNodeMetadataFromContent(suiteNode.id, ecommerceSuiteMetadata(latest.metadata, suite));
            // 模型可以重新规划屏数（用户在自己的提示词里要求过），所以报的是它返回的行数，
            // 不是骨架那张表的行数——报错了用户会以为自己的要求没生效。
            message.success(`分析完成：${parsed.length} 张都有提示词${parsed.length === rows.length ? "" : `（模型按你的要求规划了 ${parsed.length} 屏，原来是 ${rows.length} 屏）`}。逐条核对，改完点右下角批量生成`);
            return parsed;
        },
        [message, nodesRef, productReferenceImages, runEcommerceTextDraft, updateNodeMetadataFromContent],
    );

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
    const generateEcommerceSuite = useCallback(
        async (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, slotIds?: string[], rowsOverride?: EcommerceSuiteRow[]) => {
            const flow = ecommerceOneClickFlow(flowId);
            if (!flow) return false;
            const setting = await useEcommerceSettings.getState().load();
            if (!setting.enabled || !setting.flows[flowId].enabled) throw new Error("管理员已停用此电商创作用途");
            const { source: suiteNode, product: productNode } = ecommerceTableSource(node, nodesRef.current, connectionsRef.current);

            // 出图模型与参数在面板上选，写在每一张节点上——批次调度按节点自己的模型解析，
            if (productNode.metadata?.ecommerceOneClick) throw new Error("请先完成或取消当前自动装订，再开始新一轮套图");
            // 不读商品节点的字段。
            const imageModel = suiteNode.metadata?.ecommerceImageModel?.trim();
            const imageSize = suiteNode.metadata?.ecommerceImageSize?.trim();
            const imageQuality = suiteNode.metadata?.ecommerceImageQuality?.trim();
            if (!imageModel) {
                message.warning("未选择生图模型，请先在面板中选择生图模型");
                return false;
            }
            const plan = connectEcommerceTableOutputs(
                ecommerceSuiteTargets(
                    productNode,
                    flow,
                    rowsOverride ? { flow: flow.id, rows: rowsOverride, source: "draft", updatedAt: new Date().toISOString() } : suiteNode.metadata?.ecommerceSuitesByFlow?.[flowId] || suiteNode.metadata?.ecommerceSuite,
                    { nodes: nodesRef.current, connections: connectionsRef.current },
                    { ...(imageModel ? { model: imageModel } : {}), ...(imageSize ? { size: imageSize } : {}), ...(imageQuality ? { quality: imageQuality } : {}) },
                    () => nanoid(),
                    slotIds,
                ),
                suiteNode,
                nodesRef.current,
            );
            if (!plan.rows.length) {
                message.warning(`「${flow.name}」还没有提示词，请先分析商品或编辑提示词表`);
                return false;
            }
            if (!plan.nodeIds.length) {
                message.error("这一套的产物节点没能铺出来——刷新页面后重试，或先删掉画布上重名的图片节点");
                return false;
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
            const autoBind = suiteNode.metadata?.ecommerceAutoBind === true && setting.autoBindEnabled && flow.bind;
            const slicePlatform = !single && autoBind ? ecommerceBriefSlicePlatform(suiteNode.metadata?.ecommerceBrief, suiteNode.metadata?.ecommercePlatform || productNode.metadata?.ecommercePlatform) : undefined;
            const runId = nanoid();
            const shotPatch = { ...(imageModel ? { model: imageModel } : {}), ...(imageSize ? { size: imageSize } : {}), ...(imageQuality ? { quality: imageQuality } : {}) };
            setNodes((current) => [
                ...current.map((item) => {
                    if (item.id === productNode.id) {
                        // 装订可关：关掉就不写流程状态——装订链路只认这个字段，
                        // 不写它出完就只是出完，想拼时在商品节点上手动点。
                        if (single || !autoBind) return { ...item, metadata: { ...item.metadata, ecommerceShotSet: undefined } };
                        return {
                            ...item,
                            metadata: { ...item.metadata, ecommerceShotSet: undefined, ecommerceOneClick: { flow: flow.id, slotIds: plan.rows.map((row) => row.slotId), nodeIds, runId, platform: slicePlatform, status: "running" as const } },
                        };
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
                ...plan.spawned.map((item) => ({ ...item, metadata: { ...item.metadata, ecommerceRunId: runId } })),
            ]);
            // 认回来的节点可能没连到商品（连接被删过、或上一次铺节点时没落盘）。
            // 少了那条边，生成时约束链走不上去，商品锁定块静默丢失——出来的图看着正常
            // 却不是同一件商品。补上，而不是让那种图悄悄出街。
            if (plan.connections.length || plan.reconnect.length) setConnections((current) => [...current, ...plan.connections, ...plan.reconnect]);
            focusCanvasImageNodes(nodeIds);
            let batchId: ReturnType<typeof enqueueGenerationBatch>;
            try {
                batchId = enqueueGenerationBatch(
                    productNode.id,
                    "batch_image",
                    nodeIds.map((id) => ({ rowId: id, nodeId: id })),
                );
            } catch (error) {
                setNodes((current) => finishEcommerceBinding(current, productNode.id, `${productNode.id}:${runId}`));
                throw error;
            }
            if (!batchId) setNodes((current) => finishEcommerceBinding(current, productNode.id, `${productNode.id}:${runId}`));
            if (batchId) {
                message.success(`${nodeIds.length} 张已加入生成队列${!single && flow.bind && autoBind ? "，出完自动装订成详情页长图" : ""}`);
            }
            return Boolean(batchId);
        },
        [connectionsRef, enqueueGenerationBatch, focusCanvasImageNodes, message, nodesRef, setConnections, setNodes],
    );

    // 动作 Context 在批次队列之前组装，所以用 ref 把处理器递进去，
    // 与 generateNodeRef 同一套做法。
    const generateEcommerceSuiteRef = useRef(generateEcommerceSuite);
    useEffect(() => {
        generateEcommerceSuiteRef.current = generateEcommerceSuite;
    }, [generateEcommerceSuite]);
    const reverseEcommerceSuite = useCallback(
        async (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, analysisModel?: string) => {
            const { source, product } = ecommerceTableSource(node, nodesRef.current, connectionsRef.current);
            const refs = connectedStyleReferenceNodes(product.id, nodesRef.current, connectionsRef.current);
            if (!refs.length) {
                message.warning("请先把参考套图连接到商品节点的参考图槽位");
                return;
            }
            if (!analysisModel) {
                message.warning("请先选择支持看图的分析模型");
                return;
            }
            const snapshot = ecommerceAnalysisSnapshot(source, product, nodesRef.current, connectionsRef.current);
            const flow = ecommerceOneClickFlow(flowId)!;
            const count = source.metadata?.ecommerceBrief?.imageCount || refs.length;
            if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error("参考套图张数须为 1–30 张");
            const prompt = [
                ecommerceSuiteDraftPrompt(flow, product.metadata?.productProfile, [], null),
                ecommerceBriefBlock(source.metadata?.ecommerceBrief),
                `根据独立视觉参考图的顺序反推 ${count} 张套图。只借鉴叙事顺序、构图、布光、配色与文字层级，主体始终是当前商品。不得把参考图的参数、认证、价格、品牌、人物身份或卖点当成商品事实。输出可以直接生成的新画面提示词；整套视觉一致。`,
            ]
                .filter(Boolean)
                .join(String.fromCharCode(10, 10));
            const text = await runEcommerceTextDraft(product, prompt, analysisModel, source.metadata?.ecommerceAnalysisSkillsByFlow?.[flowId], true, flowId);
            if (text === undefined) return;
            const rows = parseEcommerceSuiteDraft(text, flow);
            if (!rows || rows.length !== count) {
                message.warning(`参考套图分析须返回 ${count} 张，当前表格已保留，请重试`);
                return;
            }
            const latest = nodesRef.current.find((item) => item.id === source.id);
            const latestProduct = nodesRef.current.find((item) => item.id === product.id);
            if (!latest || !latestProduct || ecommerceAnalysisSnapshot(latest, latestProduct, nodesRef.current, connectionsRef.current) !== snapshot) {
                message.warning("分析期间表格、商品资料或参考图已变化，保留当前编辑，请重试");
                return;
            }
            const suite = {
                flow: flowId,
                rows: rows.map((row) => ({ ...row, resultNodeId: source.metadata?.ecommerceSuite?.rows.find((previous) => previous.slotId === row.slotId)?.resultNodeId })),
                source: "draft" as const,
                updatedAt: new Date().toISOString(),
            };
            updateNodeMetadataFromContent(source.id, ecommerceSuiteMetadata(latest.metadata, suite));
            message.success(`参考套图已规划 ${rows.length} 张，请逐条核对商品事实和提示词`);
        },
        [connectionsRef, message, nodesRef, runEcommerceTextDraft, updateNodeMetadataFromContent],
    );
    const reverseEcommerceSuiteRef = useRef(reverseEcommerceSuite);
    useEffect(() => {
        reverseEcommerceSuiteRef.current = reverseEcommerceSuite;
    }, [reverseEcommerceSuite]);
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
        generateRows: generateBatchRows,
        patchTable: patchBatchTable,
        removeReferenceColumn: removeBatchReferenceColumn,
        removeRow: removeBatchRow,
        reorderReferenceColumns: reorderBatchReferenceColumns,
        updateRow: updateBatchRow,
    } = useCanvasBatchTable({
        assets,
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
    }, [projectLoaded, setNodes]);

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

    const createStoryboardFromBatchTable = useCallback(
        async (tableNodeId: string) => {
            const tableNode = nodesRef.current.find((node) => node.id === tableNodeId && node.type === CanvasNodeType.BatchTable);
            const table = tableNode?.metadata?.batchTable;
            if (!tableNode || !table || table.contentKind !== "storyboard") return;
            const rows = storyboardRowsFromBatchTable(table);
            if (!rows.length) return message.warning("当前表格没有可用的分镜行");
            const sourceIds = Array.from(
                new Set([...(table.storyboardSourceNodeIds || []), ...connectionsRef.current.filter((connection) => connection.toNodeId === tableNodeId && connection.relation !== "batch-output").map((connection) => connection.fromNodeId)]),
            ).filter((id) => nodesRef.current.some((node) => node.id === id));
            const sourceVideo = sourceIds.map((id) => nodesRef.current.find((node) => node.id === id)).find((node): node is CanvasNodeData => node?.type === CanvasNodeType.Video);
            const keyframeTimesMs = rows.map(storyboardKeyframeTime).filter((value): value is number => value !== undefined);
            const useKeyframes = Boolean(sourceVideo && keyframeTimesMs.length);
            const scriptSpec = getNodeSpec(CanvasNodeType.Script);
            const scriptNode = createCanvasNode(
                CanvasNodeType.Script,
                {
                    x: tableNode.position.x + tableNode.width + 160 + scriptSpec.width / 2,
                    y: tableNode.position.y + Math.max(tableNode.height, scriptSpec.height) / 2,
                },
                {
                    storyboard: { rows, visibleColumns: cinematicStoryboardColumns(), referenceNodeIds: sourceIds },
                    storyboardVideoInputMode: useKeyframes ? "keyframe" : "direct",
                    workflowKind: "storyboard",
                    workflowTitle: table.storyboardTitle || "视频脚本",
                    composerContent: table.storyboardTitle || "来自多维表格的视频分镜脚本",
                    status: "idle",
                },
            );
            scriptNode.title = table.storyboardTitle || "视频脚本";
            const nextConnections = [...connectionsRef.current, ...sourceIds.map((sourceId) => ({ id: nanoid(), fromNodeId: sourceId, toNodeId: scriptNode.id, toHandleId: "storyboard:context", relation: "storyboard-asset-reference" as const }))];
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
                    const withFrames = nodesRef.current.map((node) =>
                        node.id === scriptNode.id
                            ? {
                                  ...node,
                                  metadata: {
                                      ...node.metadata,
                                      storyboard: {
                                          ...node.metadata?.storyboard,
                                          rows: bindStoryboardKeyframes(node.metadata?.storyboard?.rows || rows, frameNodes, sourceVideo.id),
                                          visibleColumns: cinematicStoryboardColumns(),
                                          referenceNodeIds: sourceIds,
                                      },
                                  },
                              }
                            : node,
                    );
                    nodesRef.current = withFrames;
                    setNodes(withFrames);
                    message.success(`已创建视频脚本并自动抽取 ${frameNodes.length} 个关键帧，点击“生成视频”继续`);
                } else {
                    message.warning("视频脚本已创建，但关键帧抽取失败；请检查视频是否已保存或允许跨域读取");
                }
            } else {
                message.success(`已创建视频脚本：${rows.length} 个镜头`);
            }
        },
        [connectionsRef, extractVideoFrames, message, nodesRef, setConnections, setDialogNodeId, setNodes, setSelectedNodeIds],
    );

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
            if (hasEmbeddedEcommerceControls(panelNode) || panelNode.type === CanvasNodeType.Script || panelNode.type === CanvasNodeType.Drawing) return null;
            return panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    nodeId={panelNode.id}
                    canvasId={projectId}
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
                        ...buildCanvasResourceReferences(nodesRef.current, connectionsRef.current).filter(
                            (reference) => reference.kind === "text" && reference.nodeId !== panelNode.id && !(mentionReferencesByNodeId.get(panelNode.id) || []).some((active) => active.nodeId === reference.nodeId),
                        ),
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
            if (contentNode.type === CanvasNodeType.BatchTable && contentNode.metadata?.ecommerceFlowId) return <CanvasEcommerceTableNodeContent node={contentNode} />;
            if (contentNode.type === CanvasNodeType.BatchTable) {
                return (
                    <CanvasBatchTableNodeContent
                        node={contentNode}
                        nodes={nodesRef.current}
                        connections={connections}
                        batch={visibleGenerationBatch(contentNode)}
                        theme={theme}
                        onPatchTable={(patch) => patchBatchTable(contentNode.id, patch)}
                        onAddRow={(afterRowId) => addBatchRow(contentNode.id, afterRowId)}
                        onRemoveRow={(rowId) => removeBatchRow(contentNode.id, rowId)}
                        onUpdateRow={(rowId, patch) => updateBatchRow(contentNode.id, rowId, patch)}
                        onFillRows={() => void batchReferences.fillColumns(contentNode.id)}
                        onGenerate={(rowIds) => void generateBatchRows(contentNode.id, rowIds)}
                        onCreateStoryboard={() => createStoryboardFromBatchTable(contentNode.id)}
                        onRetryItem={(batchId, itemId) => retryFailedBatchItems(contentNode.id, batchId, itemId)}
                        onAddReferenceColumn={() => addBatchReferenceColumn(contentNode.id)}
                        onRemoveReferenceColumn={() => removeBatchReferenceColumn(contentNode.id)}
                        onFocusOutput={(nodeId) => focusCanvasImageNode(nodeId)}
                        onReorderReferenceColumns={(fromColumnId, toColumnId) => reorderBatchReferenceColumns(contentNode.id, fromColumnId, toColumnId)}
                        readOnly={Boolean(contentNode.metadata?.locked)}
                        onPickReference={(rowId, columnIndex) => batchReferences.pick(contentNode.id, rowId, columnIndex)}
                        onRemoveReference={(rowId, columnIndex) => batchReferences.remove(contentNode.id, rowId, columnIndex)}
                        onScrollChange={(scroll) => setBatchScrollById((previous) => (previous[contentNode.id]?.top === scroll.top && previous[contentNode.id]?.left === scroll.left ? previous : { ...previous, [contentNode.id]: scroll }))}
                        onMoveReferenceCell={(sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex) => void batchReferences.move(contentNode.id, sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex)}
                        onUploadReference={(rowId, columnIndex, file) => {
                            batchReferences.upload(contentNode.id, rowId, columnIndex, file);
                        }}
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
                        onEditAssets={(rowId) => setStoryboardAssetTarget({ nodeId: contentNode.id, rowId })}
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
            batchReferences,
            focusCanvasImageNode,
            generateBatchRows,
            generateScriptImages,
            generateScriptRows,
            generateScriptVideos,
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
            if (node.type === CanvasNodeType.EcommerceStudio) {
                const work = node.metadata?.ecommerceWorkbench;
                if (!work?.request) { message.warning("请在生图台选择电商操作后执行"); return; }
                void ecommerceWorkbench.run({ ...structuredClone(work.request), resumeReceiptId: node.id, retryFailed: Boolean(work.inputSignature && work.steps.some((step) => step.status === "failed")) }).catch((error) => message.error(error instanceof Error ? error.message : "电商任务重试失败"));
                return;
            }
            if (node.metadata?.imageLayerWorkflow && !node.metadata.experimentalLayerPlan && !node.metadata.layerDecomposition) {
                const source = nodesRef.current.find((item) => item.id === node.metadata!.imageLayerWorkflow!.sourceNodeId);
                if (source?.metadata?.content) setLayerDecompositionNodeId(source.id);
                else message.error("拆层源图片已不存在，请重新选择图片");
                return;
            }
            if (node.type === CanvasNodeType.Script) {
                const prompt = (node.metadata?.composerContent || node.metadata?.prompt || "").trim();
                if (!prompt) {
                    message.warning("分镜脚本缺少剧情内容，无法重试");
                    return;
                }
                void generateScriptRows(node.id, prompt);
                return;
            }
            if (node.metadata?.experimentalLayerPlan || node.metadata?.layerExtraction) {
                void handleRetryNode(node);
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
        [ecommerceWorkbench.run, generateScriptRows, handleRetryNode, message, nodesRef, retryImageBatchChildren, setLayerDecompositionNodeId],
    );
    const openCanvasNodeTaskDetails = useCallback(
        (node: CanvasNodeData) => {
            void openNodeTaskDetails(node);
        },
        [openNodeTaskDetails],
    );
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
    const storyboardAssetNode = nodes.find((node) => node.id === storyboardAssetTarget?.nodeId);
    const storyboardAssetRow = storyboardAssetNode?.metadata?.storyboard?.rows.find((row) => row.id === storyboardAssetTarget?.rowId);
    const storyboardAssetBindings =
        storyboardAssetNode && storyboardAssetRow
            ? normalizeStoryboardAssetBindings([
                  ...(storyboardAssetRow.assetBindings || []),
                  ...storyboardRowReferenceNodeIds(storyboardAssetNode, storyboardAssetRow, nodes, connections, false)
                      .filter((id) => !storyboardAssetNode.metadata?.storyboard?.referenceNodeIds.includes(id))
                      .flatMap((id) => {
                          const node = nodes.find((item) => item.id === id);
                          const binding = node && bindingForConnectedNode(node);
                          return binding ? [binding] : [];
                      }),
              ])
            : [];
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
            <main
                id="canvas-main"
                tabIndex={-1}
                className={`relative flex h-full min-h-0 overflow-clip outline-none ${!focusMode ? `canvas-main-with-workspace ${workspaceOpen ? "canvas-workspace-expanded" : ""}` : ""}`}
                style={{ background: resolvedCanvasAppearance.background, color: theme.node.text }}
            >
                {!focusMode ? (
                    <CanvasWorkspacePanel
                        key={projectId}
                        open={workspaceOpen}
                        onOpen={() => setWorkspaceOpen(true)}
                        onInsertAssets={handleProjectAssetsInsert}
                        projectId={projectId}
                        nodes={nodes}
                        selectedNodeIds={selectedNodeIds}
                        canvasKind={canvasKind}
                        onClose={() => setWorkspaceOpen(false)}
                        onAssets={() => openCanvasAssetLibrary()}
                        onProjectAssets={currentProject?.projectId ? () => openProjectAssets() : undefined}
                        onCancelTask={cancelCanvasTask}
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
                ) : null}
                {!workspaceOpen && !focusMode && shortDramaEnabled && currentProject?.projectId ? (
                    <CanvasProjectSidebar projectId={currentProject.projectId} detail={linkedProjectQuery.data} onAddChapter={handleProjectChapterInsert} onLocateStyle={locateProjectStyleNode} onOpenAssets={() => openProjectAssets()} />
                ) : null}
                <CanvasOverlayLayerProvider>
                    <div className="canvas-editor-shell relative flex min-w-0 flex-1">
                        <section data-canvas-editor className="relative min-w-0 flex-1 flex flex-col min-h-0 overflow-clip">
                            {!focusMode ? (
                                <CanvasTopBar
                                    ecommerce={currentProject?.kind === "ecommerce"}
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
                                    onImportImage={() => handleUploadRequest()}
                                    onImportLibTV={() => setLibTVImportOpen(true)}
                                    onImportTapNow={() => setTapNowImportOpen(true)}
                                    onUndo={undoCanvas}
                                    onRedo={redoCanvas}
                                    onShare={() => setShareModalOpen(true)}
                                    shortcutRequestNonce={shortcutRequestNonce}
                                    syncIcon={<CanvasSyncStatus projectId={projectId} />}
                                    onOpenSearch={() => setNodeSearchOpen(true)}
                                    onOpenModelLibrary={canvasKind === "ecommerce" ? () => setModelLibraryOpen(true) : undefined}
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

                            {batchReferencePickerModal}
                            <CanvasShareModal projectId={projectId} open={shareModalOpen} onClose={() => setShareModalOpen(false)} beforeCreate={saveCanvasProject} />
                            <LibTVImportDialog
                                open={libTVImportOpen}
                                projectId={projectId}
                                viewport={viewport}
                                viewportSize={size}
                                onClose={() => {
                                    setLibTVImportOpen(false);
                                    setLibTVImportTemplateUuid(undefined);
                                }}
                                onApply={applyLibTVDialogImport}
                                templateUuid={libTVImportTemplateUuid}
                            />
                            <TapNowImportDialog open={tapNowImportOpen} projectId={projectId} viewport={viewport} viewportSize={size} onClose={() => setTapNowImportOpen(false)} onApply={applyTapNowImport} />

                            <CanvasStylePickerModal open={stylePickerOpen} value={activeStylePresetId} applying={styleApplying} onClose={() => setStylePickerOpen(false)} onSelect={selectCanvasStyle} />
                            <CanvasEcommerceModelLibraryModal
                                open={modelLibraryOpen}
                                imageToAdd={modelImageToAdd || undefined}
                                onClose={() => {
                                    setModelLibraryOpen(false);
                                    setModelImageToAdd(null);
                                }}
                            />

                            <CanvasPrevisTemplateModal open={Boolean(previsTemplateRequest)} onClose={() => setPrevisTemplateRequest(null)} onSelect={(templateId) => createPrevisShot(templateId, previsTemplateRequest?.position)} />

                            <div className="relative flex min-h-0 min-w-0 flex-1">
                                <div className="relative min-w-0 flex-1 overflow-clip">
                                    <CanvasViewport
                                        interactive
                                        onSelectedImageWheel={handleSelectedImageWheel}
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
                                                batchScrollById={batchScrollById}
                                                connectionTargetHandleId={connectionTargetHandleId}
                                                connectingParams={connectingParams}
                                                batchConnectionPreview={batchConnectionPreview}
                                                mouseWorld={mouseWorld}
                                                connectionTargetNodeId={connectionTargetNodeId}
                                                connectionTargetAnchorRatio={connectionTargetAnchorRatio}
                                                connectionTargetAnchorXRatio={connectionTargetAnchorXRatio}
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
                                                    batchScrollById={batchScrollById}
                                                    connectionTargetHandleId={connectionTargetHandleId}
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
                                                    onViewImage={viewCanvasNodeImage}
                                                    onReplaceMedia={replaceCanvasNodeMedia}
                                                    onOpenTextEditor={openTextNodeEditor}
                                                    onOpenPrevis={editCanvasPrevis}
                                                    onOpenDrawing={openDrawingNode}
                                                    onStartBatchConnection={startBatchConnection}
                                                />
                                            </CanvasNodeGraphContext.Provider>
                                        </CanvasNodeActionContext.Provider>
                                    </CanvasViewport>

                                    <CanvasCollaborationLayer key={`${canvasStorageScope}:${projectId}`} canvasId={projectId} enabled={projectLoaded} containerRef={containerRef} nodesRef={nodesRef} viewportRef={viewportRef} />

                                    <CanvasActiveTaskPanel tasks={activeTasks} onCancelTask={cancelCanvasTask} topInset={focusMode ? "var(--space-3)" : "var(--canvas-topbar-offset)"} />

                                    {focusMode ? (
                                        <CanvasFocusModeBar
                                            syncIcon={<CanvasSyncStatus projectId={projectId} />}
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
                                            canvasKind={currentProject?.kind}
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
                                            onOpenWorkspace={() => setWorkspaceOpen((value) => !value)}
                                            onOpenMyAssets={() => {
                                                openCanvasAssetLibrary();
                                            }}
                                            onOpenProjectCharacters={() => openCharacterLibrary()}
                                            onOpenEcommerceWorkbench={addEcommerceStudio}
                                        />
                                    ) : null}
                                </div>

                                <div className="contents">
                                    <CanvasEcommerceWorkbench
                                        key={projectId}
                                        studioId={ecommerceWorkbenchStudioId}
                                        initialCapability={ecommerceWorkbenchCapability}
                                        open={ecommerceWorkbenchOpen}
                                        onClose={() => setEcommerceWorkbenchOpen(false)}
                                        nodes={nodes}
                                        connections={connections}
                                        selectedIds={selectedNodeIds}
                                        busy={ecommerceWorkbench.busy}
                                        onRun={ecommerceWorkbench.run}
                                        onStop={ecommerceWorkbench.stop}
                                        onLayers={openLayerDecomposition}
                                        onFocus={focusCanvasNode}
                                        onAssets={() => openCanvasAssetLibrary()}
                                    />
                                    <CanvasCloudAgentPanel
                                        canvasId={projectId}
                                        domainProjectId={currentProject?.projectId}
                                        canvasNodes={nodes}
                                        runningNodeId={runningNodeId}
                                        nodeCount={nodes.length}
                                        selectedNodeIds={Array.from(selectedNodeIds)}
                                        references={agentMentionReferences}
                                        prefillRequest={agentPrefillRequest}
                                        open={assistantOpen}
                                        onOpen={openAgent}
                                        onCollapse={closeAgent}
                                        onFocusNode={(nodeId) => {
                                            const currentNodes = nodesRef.current;
                                            const target = currentNodes.find((node) => node.id === nodeId);
                                            if (!target) {
                                                message.info("该节点已删除或尚未同步到画布");
                                                return;
                                            }

                                            const parent = target.parentId ? currentNodes.find((node) => node.id === target.parentId) : null;
                                            if (parent?.metadata?.frame?.collapsed) toggleFrameCollapsed(parent.id);

                                            const batchRootId = target.metadata?.batchRootId;
                                            const batchRoot = batchRootId ? currentNodes.find((node) => node.id === batchRootId) : null;
                                            if (batchRoot && isHiddenBatchChild(target, currentNodes) && !batchRoot.metadata?.imageBatchExpanded) toggleBatchExpanded(batchRoot.id);

                                            focusCanvasNode(nodeId);
                                        }}
                                    />
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
                            !hasEmbeddedEcommerceControls(dialogNode) &&
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
                                canvasKind={canvasKind}
                                onSaveAsModel={saveImageAsModel}
                                onRotateImage={(node, direction) => void rotateImageNode(node.id, direction)}
                                onCreateEditCopy={(node) => duplicateNode(node.id, "linked-copy")}
                                rotatingImage={rotatingNodeId !== null}
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
                                onPrevis={sendImageToPrevisAgent}
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
                                canvasKind={canvasKind}
                                onSaveAsModel={saveImageAsModel}
                                onUseAsStyleReference={useImageAsStyleReference}
                                onOpenModelLibrary={() => setModelLibraryOpen(true)}
                                menu={contextMenu}
                                node={contextMenuNode}
                                workspaceMode={workspaceMode}
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

                            <CanvasCharacterReferenceModal
                                node={characterReferenceNode}
                                canvasNodes={nodes}
                                open={Boolean(characterReferenceNode)}
                                onClose={() => setCharacterReferenceNodeId(null)}
                                onUpdated={(detail) => setNodes((current) => refreshCanvasCharacterReferenceNodes(current, [{ ...detail.asset, character: detail.character }]))}
                            />

                            <CanvasTextEditorModal
                                node={textEditorNode}
                                open={Boolean(textEditorNode)}
                                onClose={() => setTextEditorNodeId(null)}
                                onChange={(nodeId, title, content, richText) => {
                                    setNodes((current) => {
                                        const next = current.map((node) => (node.id === nodeId ? { ...node, title, metadata: { ...node.metadata, content, richText } } : node));
                                        nodesRef.current = next;
                                        return next;
                                    });
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

                            {storyboardAssetNode && storyboardAssetRow ? (
                                <StoryboardAssetPickerModal
                                    key={`${storyboardAssetNode.id}:${storyboardAssetRow.id}`}
                                    nodes={nodes}
                                    bindings={storyboardAssetBindings}
                                    shotNumber={storyboardAssetRow.shotNumber}
                                    detail={linkedProjectQuery.data}
                                    onClose={() => setStoryboardAssetTarget(null)}
                                    onSave={(bindings) => {
                                        const result = replaceStoryboardRowAssets(nodesRef.current, connectionsRef.current, storyboardAssetNode.id, storyboardAssetRow.id, bindings);
                                        nodesRef.current = result.nodes;
                                        connectionsRef.current = result.connections;
                                        setNodes(result.nodes);
                                        setConnections(result.connections);
                                        setStoryboardAssetTarget(null);
                                    }}
                                    onImport={async (payloads) => {
                                        const existing: CanvasNodeData[] = [];
                                        const pending = payloads.filter((payload) => {
                                            const node = payload.assetId ? nodesRef.current.find((item) => item.metadata?.assetId === payload.assetId || item.metadata?.characterAssetId === payload.assetId) : undefined;
                                            if (node) existing.push(node);
                                            return !node;
                                        });
                                        const imported = await Promise.all(
                                            pending.map(async (payload, index) => {
                                                const resourceId = payload.kind !== "text" && payload.kind !== "character" ? resourceIdFromStorageKey(payload.storageKey) : "";
                                                const resource = resourceId ? await getResource(resourceId) : undefined;
                                                const input =
                                                    resource && payload.kind !== "text" && payload.kind !== "character"
                                                        ? {
                                                              ...payload,
                                                              width: resource.width ?? ("width" in payload ? payload.width : undefined),
                                                              height: resource.height ?? ("height" in payload ? payload.height : undefined),
                                                              durationMs: resource.durationMs ?? ("durationMs" in payload ? payload.durationMs : undefined),
                                                              bytes: resource.size,
                                                              mimeType: resource.mimeType,
                                                          }
                                                        : payload;
                                                const node = await createAssetPayloadNode(input, { x: storyboardAssetNode.position.x - 440, y: storyboardAssetNode.position.y + index * 260 });
                                                const source = linkedProjectQuery.data?.assets.find((asset) => asset.id === payload.assetId);
                                                return source ? { ...node, metadata: { ...node.metadata, assetCategory: normalizeAssetCategory(source.category) } } : node;
                                            }),
                                        );
                                        if (!nodesRef.current.some((node) => node.id === storyboardAssetNode.id && node.metadata?.storyboard?.rows.some((row) => row.id === storyboardAssetRow.id))) throw new Error("镜头已不存在，请重新选择");
                                        if (imported.length) {
                                            nodesRef.current = [...nodesRef.current, ...imported];
                                            setNodes(nodesRef.current);
                                        }
                                        return [...existing, ...imported];
                                    }}
                                />
                            ) : null}

                            <CanvasScriptEditor
                                node={activeScriptNode}
                                nodes={nodes}
                                open={Boolean(activeScriptNode)}
                                onClose={() => setScriptEditorNodeId(null)}
                                onUpdateRows={(rows) => activeScriptNode && replaceScriptRows(activeScriptNode.id, rows)}
                                onEditAssets={(rowId) => activeScriptNode && setStoryboardAssetTarget({ nodeId: activeScriptNode.id, rowId })}
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
                                onCloseImageEdit={() => {
                                    setImageEditNodeId(null);
                                    setImageEditPreset(null);
                                }}
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

                            <BatchGenerationSettingsDialog open={batchGenDialogOpen} config={batchGenDialogConfig} rowCount={batchGenDialogRowCount} concurrency={batchGenDialogConcurrency} onClose={closeBatchGenDialog} onConfirm={confirmBatchGenDialog} />

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
                    </div>
                </CanvasOverlayLayerProvider>
            </main>
        </>
    );
}
