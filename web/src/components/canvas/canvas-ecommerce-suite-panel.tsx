import { App, Image as AntImage } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eraser, FileText, ImagePlus, LoaderCircle, Plus, Sparkles, X, RefreshCw, Library } from "lucide-react";
import { Link } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { SkillRuntimePicker } from "@/components/skills/skill-runtime-picker";
import { EcommerceChoiceInput, ECOMMERCE_BRIEF_CHOICES } from "./ecommerce-choice-input";
import type { Skill } from "@/services/api/skills";
import { ModelPicker } from "@/components/model-picker";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { ecommerceOneClickLayoutPreset, type EcommerceOneClickFlow } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteRowId, type EcommerceSuite, type EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import { ECOMMERCE_LAYOUT_PRESETS, createEcommerceLayoutFromPreset, ecommerceLayoutBlockStyle, ecommerceLayoutVisibleBlocks } from "@/lib/ecommerce/ecommerce-layout";
import { resolveImageUrl } from "@/services/image-storage";
import { selectableModelsByCapability, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { EcommerceBrief } from "@/lib/ecommerce/ecommerce-brief";
import { ECOMMERCE_SLICE_SPECS, type EcommerceSlicePlatform } from "@/lib/ecommerce/ecommerce-slice";
import { ecommerceTemplateRows } from "@/lib/ecommerce/ecomgen-template";
import { EcommerceTemplateCatalogDetails } from "./ecommerce-template-catalog";
import type { EcommerceSuiteTemplate } from "@/services/api/ecommerce";
import { buildEcommerceSuiteArchive } from "@/services/ecommerce-suite-export";
import { ecommerceResultSourceCurrent, ecommerceTableResults, type EcommerceResultSourceSignature } from "@/lib/ecommerce/ecommerce-table";
import { useEcommerceTemplateLibrary } from "@/stores/use-ecommerce-template-library";
import { downloadName } from "@/lib/media-package";
import { saveAs } from "file-saver";
import type { CanvasNodeData } from "@/types/canvas";
import { configuredModelDisplayName, modelCompatibilityError, resolveCompatibleModel } from "@/lib/model-selection";
import { generationErrorMessage } from "@/lib/generation-error";
import { imageNodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import "./canvas-ecommerce-suite-panel.css";

export type EcommerceSuitePanelProps = {
    embedded?: boolean;
    open: boolean;
    flow: EcommerceOneClickFlow;
    suite: EcommerceSuite | undefined;
    /**
     * 当前那张表——屏次、职责、提示词的真相。
     *
     * 面板不自己算行：几张、每张干什么由它决定，行业套路只是它的初始值。
     * 用户删到六屏就是六屏，加一行就是十行；模型分析时也可以重新规划几屏。
     */
    rows: EcommerceSuiteRow[];
    /** 已经铺出去的产物节点，按槽位索引。用来在表里显示缩略图与生成状态。 */
    nodeBySlot: Map<string, CanvasNodeData>;
    candidatesBySlot?: Map<string, CanvasNodeData[]>;
    activeGenerationNodeIds?: ReadonlySet<string>;
    sourceSignature?: EcommerceResultSourceSignature;
    /** 分析用的文本模型（要能看图）。 */
    analysisModel: string;
    /** 本次分析实际会提交的商品实拍与视觉参考图数量。 */
    analysisReferenceImageCount: number;
    /** 本次生图实际会提交的商品实拍、视觉参考与模特参考图总数。 */
    generationReferenceImageCount?: number;
    /** 出图用的图片模型。 */
    imageModel: string;
    /** 出图参数：尺寸与画质。空着跟着全局配置走。 */
    imageSize: string;
    imageQuality: string;
    brief?: EcommerceBrief;
    onBriefChange?: (value: EcommerceBrief) => void;
    templates?: EcommerceSuiteTemplate[];
    autoBindAvailable?: boolean;
    /** 分析时注入哪几个技能。空数组就是不用。 */
    skillIds: string[];
    /** 可选的技能——用户「已加入」的整库。 */
    availableSkills: Skill[];
    skillsLoading: boolean;
    skillsError?: string;
    onRefreshSkills?: () => void;
    /** 出完自动拼长图并按平台切片。 */
    autoBind: boolean;
    analyzing: boolean;
    generating?: boolean;
    onAnalysisModelChange: (model: string) => void;
    onImageModelChange: (model: string) => void;
    onImageOptionChange: (key: "size" | "quality", value: string) => void;
    onSkillIdsChange: (skillIds: string[]) => void;
    onAutoBindChange: (value: boolean) => void;
    /** 清空表里所有提示词——结构留着，只把每行的提示词抹掉。 */
    onClearPrompts: () => void;
    onAnalyze: (rows: EcommerceSuiteRow[]) => Promise<EcommerceSuiteRow[] | undefined> | EcommerceSuiteRow[] | undefined;
    onReverse?: () => void;
    onBind?: (rows: EcommerceSuiteRow[]) => Promise<unknown>;
    /** 改某一行的一格：标题 / 职责 / 提示词。 */
    onRowChange: (slotId: string, patch: Partial<Pick<EcommerceSuiteRow, "title" | "duty" | "prompt">>) => void;
    onRowsChange: (rows: EcommerceSuiteRow[]) => void;
    onAddRow: () => void;
    onRemoveRow: (slotId: string) => void;
    /** 出整张表。 */
    onGenerate: (rows?: EcommerceSuiteRow[], slotIds?: string[]) => boolean | void | Promise<boolean | void>;
    /** 只出某一张——不传就出整张表。 */
    onGenerateOne: (slotId: string, rows?: EcommerceSuiteRow[]) => void | Promise<unknown>;
    /** 把某一行往前（-1）或往后（+1）挪一格。顺序决定叙事，也决定长图接法。 */
    onMoveRow: (slotId: string, delta: number) => void;
    onClose: () => void;
};

/**
 * 套图面板——一次出图的控制台。
 *
 * **单位是「一张图一条提示词」，不是「一张图一句话」。**
 * 前面几版让模型写每屏的一句话文案，然后指望编译时拼进提示词——那是错的：
 * 文案只是图上那几个字，而每张图真正要的是完整的出图指令。
 * 主图画什么、模特上身图画什么、细节图画什么，构图光线景别全都不一样。
 *
 * 面板里三件事，按顺序：
 * 1. **选分析模型**（要能看图的文本模型）→ 分析商品 → 每一行得到一条完整提示词
 * 2. **逐条核对、改** —— 表里没有的图不生成，表里的字不编
 * 3. **选出图模型与参数 → 出图** —— 整批一次提交，或者只出某一张
 *
 * 为什么不做成「先铺九个节点再逐张点」：铺出来的是结果，不是过程。
 * 过程是这张表——用户要在这里看清楚每一张要画什么，而不是在画布上找九个方块。
 */
export function CanvasEcommerceSuitePanel({
    embedded = false,
    open,
    flow,
    suite,
    nodeBySlot: providedNodes,
    candidatesBySlot,
    activeGenerationNodeIds,
    sourceSignature,
    analysisModel,
    analysisReferenceImageCount,
    generationReferenceImageCount = analysisReferenceImageCount,
    imageModel,
    rows,
    imageSize,
    imageQuality,
    brief = {},
    onBriefChange,
    templates = [],
    autoBindAvailable = true,
    skillIds,
    availableSkills,
    skillsLoading,
    skillsError,
    onRefreshSkills,
    autoBind,
    analyzing,
    generating = false,
    onAnalysisModelChange,
    onImageModelChange,
    onImageOptionChange,
    onSkillIdsChange,
    onAutoBindChange,
    onClearPrompts,
    onAnalyze,
    onReverse,
    onBind,
    onRowChange,
    onRowsChange,
    onAddRow,
    onRemoveRow,
    onGenerate,
    onGenerateOne,
    onMoveRow,
    onClose,
}: EcommerceSuitePanelProps) {
    const config = useEffectiveConfig();
    const showProfessionalControls = useCanvasNodeActions().workspaceMode !== "simple";
    const analysisRequirements = {
        capability: "text" as const,
        input: { textCount: 0, imageCount: analysisReferenceImageCount, videoCount: 0, audioCount: 0, characterCount: 0 },
    };
    const routedAnalysisModel = analysisModel ? resolveCompatibleModel(config, analysisModel, analysisRequirements) || analysisModel : "";
    const analysisModelError = analysisModel ? modelCompatibilityError(config, routedAnalysisModel, analysisRequirements) : "请先选择分析模型";
    const analysisModelReady = Boolean(analysisModel) && !analysisModelError;
    const hasAnalysisModelOptions = selectableModelsByCapability(config, "text").some((model) => {
        const routed = resolveCompatibleModel(config, model, analysisRequirements) || model;
        return !modelCompatibilityError(config, routed, analysisRequirements);
    });
    const imageRequirements = {
        capability: "image" as const,
        input: { textCount: 0, imageCount: generationReferenceImageCount, videoCount: 0, audioCount: 0, characterCount: 0 },
    };
    const routedImageModel = imageModel ? resolveCompatibleModel(config, imageModel, imageRequirements) || imageModel : "";
    const imageModelError = imageModel ? modelCompatibilityError(config, routedImageModel, imageRequirements) : "请先选择生图模型";
    const imageModelReady = Boolean(imageModel) && !imageModelError;
    const hasImageModelOptions = selectableModelsByCapability(config, "image").some((model) => {
        const routed = resolveCompatibleModel(config, model, imageRequirements) || model;
        return !modelCompatibilityError(config, routed, imageRequirements);
    });
    const { modal, message } = App.useApp();
    const [exporting, setExporting] = useState(false);
    const [binding, setBinding] = useState(false);
    const [templateName, setTemplateName] = useState("");
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [firstVersionRunning, setFirstVersionRunning] = useState(false);
    const firstVersionInFlight = useRef(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [expandedDesignSlotId, setExpandedDesignSlotId] = useState<string>();
    const [focusedPromptSlotId, setFocusedPromptSlotId] = useState<string>();
    const [detailSlotId, setDetailSlotId] = useState<string>();
    const showAdvanced = showProfessionalControls || advancedOpen;
    const privateTemplates = useEcommerceTemplateLibrary((state) => state.templates);
    const templateScope = useEcommerceTemplateLibrary((state) => state.scope);
    useEffect(() => {
        void useEcommerceTemplateLibrary
            .getState()
            .hydrate()
            .catch((error) => message.error(error instanceof Error ? error.message : "模板读取失败"));
    }, [templateScope, message]);
    const [promptOpen, setPromptOpen] = useState(false);
    const [localRows, setLocalRows] = useState(rows);
    const draftRows = localRows;
    const detailQuickView = flow.id === "detail" && !showProfessionalControls;
    const activeDetailSlotId = draftRows.some((row) => row.slotId === detailSlotId) ? detailSlotId : draftRows[0]?.slotId;
    const latestDraftRows = useRef(rows);
    const pendingCopyCommit = useRef(false);
    const copyCommitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    latestDraftRows.current = draftRows;
    const clearCopyCommitTimer = () => {
        if (copyCommitTimer.current) clearTimeout(copyCommitTimer.current);
        copyCommitTimer.current = undefined;
    };
    const discardPendingCopyCommit = () => {
        const pending = pendingCopyCommit.current;
        pendingCopyCommit.current = false;
        clearCopyCommitTimer();
        return pending;
    };
    const commitPendingCopy = () => {
        if (!discardPendingCopyCommit()) return latestDraftRows.current;
        onRowsChange(latestDraftRows.current);
        return latestDraftRows.current;
    };
    const replaceDraftRows = (next: EcommerceSuiteRow[]) => {
        latestDraftRows.current = next;
        setLocalRows(next);
    };
    const setDraftRows = (update: EcommerceSuiteRow[] | ((current: EcommerceSuiteRow[]) => EcommerceSuiteRow[])) => {
        const next = typeof update === "function" ? update(latestDraftRows.current) : update;
        const copyWasPending = discardPendingCopyCommit();
        replaceDraftRows(next);
        if (embedded || copyWasPending) onRowsChange(next);
    };
    const updateCopyDraft = (slotId: string, field: "headline" | "subhead" | "cta" | "price", value: string, fallbackCopy: NonNullable<EcommerceSuiteRow["copy"]>, fallbackLayout: NonNullable<EcommerceSuiteRow["layout"]>) => {
        const next = latestDraftRows.current.map((row) =>
            row.slotId === slotId
                ? {
                      ...row,
                      copy: { ...fallbackCopy, ...row.copy, [field]: value },
                      layout: row.layout ?? fallbackLayout,
                  }
                : row,
        );
        replaceDraftRows(next);
        pendingCopyCommit.current = true;
        clearCopyCommitTimer();
        copyCommitTimer.current = setTimeout(commitPendingCopy, 250);
    };
    const commitPendingCopyRef = useRef(commitPendingCopy);
    commitPendingCopyRef.current = commitPendingCopy;
    useEffect(
        () => () => {
            commitPendingCopyRef.current();
        },
        [],
    );
    const resultState = useMemo(() => (candidatesBySlot ? ecommerceTableResults(draftRows, [...candidatesBySlot.values()].flat(), flow.id, sourceSignature) : undefined), [draftRows, candidatesBySlot, flow.id, sourceSignature]);
    const nodeBySlot = resultState?.selected || providedNodes;
    const exportSourceSignature = JSON.stringify(
        draftRows.map((row) => {
            const node = nodeBySlot.get(row.slotId);
            return [
                row.slotId,
                row.enabled ?? true,
                row.title,
                row.duty,
                row.prompt,
                row.copy,
                row.layout,
                row.resultNodeId || null,
                node?.id || null,
                node?.metadata?.storageKey || null,
                node?.metadata?.taskId || null,
                node?.metadata?.taskStatus || null,
                node?.metadata?.status || null,
                node?.metadata?.ecommerceRunId || null,
                node?.metadata?.batchInputSignature || null,
                node?.metadata?.batchResultInputSignature || null,
            ];
        }),
    );
    const latestExportSourceSignature = useRef(exportSourceSignature);
    latestExportSourceSignature.current = exportSourceSignature;
    const previousInput = useRef({ rows, open });
    useEffect(() => {
        const previous = previousInput.current;
        const sameRows =
            previous.rows.length === rows.length &&
            previous.rows.every((row, index) => {
                const next = rows[index];
                const previousDesign = row;
                const nextDesign = next;
                return (
                    row.slotId === next.slotId &&
                    row.title === next.title &&
                    row.duty === next.duty &&
                    row.prompt === next.prompt &&
                    row.enabled === next.enabled &&
                    row.resultNodeId === next.resultNodeId &&
                    JSON.stringify(previousDesign.copy) === JSON.stringify(nextDesign.copy) &&
                    JSON.stringify(previousDesign.layout) === JSON.stringify(nextDesign.layout)
                );
            });
        // Model and skill changes can recreate equivalent rows without changing the draft.
        if (!sameRows || previous.open !== open) {
            discardPendingCopyCommit();
            replaceDraftRows(rows);
        }
        previousInput.current = { rows, open };
    }, [rows, open]);
    const total = draftRows.length;
    const enabledRows = draftRows.filter((row) => row.enabled !== false);
    const enabledTotal = enabledRows.length;
    const skipped = total - enabledTotal;
    const missing = enabledRows.filter((row) => !row.prompt.trim()).length;
    const generationCount = enabledTotal - missing;
    const ready = enabledTotal > 0 && missing === 0;
    const generated = enabledRows.filter((row) => {
        const metadata = nodeBySlot.get(row.slotId)?.metadata;
        return metadata?.storageKey && metadata.status !== "loading" && metadata.status !== "error";
    }).length;
    const unfinishedRows = enabledRows.filter((row) => {
        const metadata = nodeBySlot.get(row.slotId)?.metadata;
        return !metadata?.storageKey || metadata.status === "loading" || metadata.status === "error";
    });
    const busySlotIds = new Set(
        enabledRows
            .filter((row) => {
                const selectedNode = nodeBySlot.get(row.slotId);
                const candidates = candidatesBySlot?.get(row.slotId) || [];
                return (
                    selectedNode?.metadata?.status === "loading" ||
                    Boolean(selectedNode && activeGenerationNodeIds?.has(selectedNode.id)) ||
                    candidates.some((candidate) => candidate.metadata?.status === "loading" || activeGenerationNodeIds?.has(candidate.id))
                );
            })
            .map((row) => row.slotId),
    );
    const busyCount = busySlotIds.size;
    const completedInCurrentRun = enabledRows.filter((row) => {
        const metadata = nodeBySlot.get(row.slotId)?.metadata;
        return !busySlotIds.has(row.slotId) && metadata?.storageKey && metadata.status !== "error";
    }).length;
    const batchBusy = generating || Boolean(activeGenerationNodeIds?.size) || busyCount > 0;
    const batchLabel = generationCount === 0 ? "补充生成方案" : busyCount > 0 ? `正在生成 ${Math.min(completedInCurrentRun, generationCount)}/${generationCount}` : batchBusy ? `正在生成 ${generationCount} 张…` : `批量生成 ${generationCount} 张`;
    const firstVersionLabel = firstVersionRunning ? "正在准备第一版…" : batchBusy ? batchLabel : generated === enabledTotal && enabledTotal > 0 ? "第一版已完成" : generated ? `生成剩余 ${unfinishedRows.length} 张` : "生成第一版";

    // 参数浮层读的是完整配置：模型换成面板上选的那个，尺寸/画质用节点上存的。
    // 少了这一步，浮层会按全局模型算能力，面板上选了另一个模型就看不到它的档位。
    const settingsConfig: AiConfig = {
        ...config,
        ...(imageModel ? { model: imageModel, imageModel } : {}),
        ...(imageSize ? { size: imageSize } : {}),
        ...(imageQuality ? { quality: imageQuality } : {}),
    };

    const updateDraftRows = (update: (current: EcommerceSuiteRow[]) => EcommerceSuiteRow[]) => setDraftRows(update);
    const updateDesignRow = (slotId: string, update: (row: EcommerceSuiteRow) => EcommerceSuiteRow) => {
        const next = latestDraftRows.current.map((row) => (row.slotId === slotId ? update(row) : row));
        discardPendingCopyCommit();
        replaceDraftRows(next);
        onRowsChange(next);
    };
    const focusPrompt = (slotId: string) => {
        setFocusedPromptSlotId(slotId);
        setAdvancedOpen(true);
    };
    const commitDraftRows = () => {
        const latest = latestDraftRows.current;
        const copyWasPending = discardPendingCopyCommit();
        if (!embedded || copyWasPending) onRowsChange(latest);
        return latest;
    };
    const closeDraft = () => {
        commitDraftRows();
        onClose();
    };
    const generateDraft = () => {
        const latest = commitDraftRows();
        void onGenerate(latest);
    };
    const generateDraftOne = (slotId: string) => {
        const latest = commitDraftRows();
        void onGenerateOne(slotId, latest);
    };
    const generateFirstVersion = async () => {
        if (firstVersionInFlight.current || batchBusy || !enabledTotal || !imageModelReady) return;
        const original = commitDraftRows();
        const needsAnalysis = original.some((row) => row.enabled !== false && !row.prompt.trim());
        if (needsAnalysis && !analysisModelReady) return;
        firstVersionInFlight.current = true;
        setFirstVersionRunning(true);
        try {
            let planned = original;
            if (needsAnalysis) {
                const analyzed = await onAnalyze(original);
                if (!analyzed) return;
                const analyzedBySlot = new Map(analyzed.map((row) => [row.slotId, row]));
                planned = original.map((row) => (row.prompt.trim() ? row : analyzedBySlot.get(row.slotId) || row));
                if (planned.some((row) => row.enabled !== false && !row.prompt.trim())) return;
                replaceDraftRows(planned);
                onRowsChange(planned);
            }
            const pendingSlotIds = planned.filter((row) => row.enabled !== false && unfinishedRows.some((pending) => pending.slotId === row.slotId)).map((row) => row.slotId);
            if (!pendingSlotIds.length) return;
            await onGenerate(planned, pendingSlotIds.length === planned.filter((row) => row.enabled !== false).length ? undefined : pendingSlotIds);
        } finally {
            firstVersionInFlight.current = false;
            setFirstVersionRunning(false);
        }
    };

    const confirmGenerate = () => {
        const firstMissing = draftRows.find((row) => row.enabled !== false && !row.prompt.trim());
        if (!showProfessionalControls) {
            const generationScreens = draftRows.flatMap((row, index) => (row.enabled !== false && row.prompt.trim() ? [`第 ${index + 1} 屏`] : []));
            const skippedScreens = draftRows.flatMap((row, index) => (row.enabled === false ? [`第 ${index + 1} 屏`] : []));
            const missingScreens = draftRows.flatMap((row, index) => (row.enabled !== false && !row.prompt.trim() ? [`第 ${index + 1} 屏`] : []));
            const imageModelLabel = imageModel ? configuredModelDisplayName(config, routedImageModel || imageModel) : "未选择";
            modal.confirm({
                title: generationCount ? `确认生成 ${generationCount} 张？` : "暂无可生成内容",
                content: `本次范围：${generationScreens.join("、") || "无"}；已跳过：${skippedScreens.join("、") || "无"}；缺少方案：${missingScreens.join("、") || "无"}；出图模型：${imageModelLabel}；尺寸：${imageSize || "跟随模型默认"}；画质：${imageQuality || "跟随模型默认"}；参考图：${generationReferenceImageCount} 张；自动拼接详情长图：${flow.bind && autoBind && autoBindAvailable ? "是" : "否"}；费用以模型渠道结算为准`,
                okText: generationCount ? `生成 ${generationCount} 张` : "去补充方案",
                centered: true,
                ...(generationCount ? { cancelText: "再检查一下", onOk: generateDraft } : { cancelButtonProps: { style: { display: "none" } }, onOk: () => firstMissing && focusPrompt(firstMissing.slotId) }),
            });
            return;
        }
        // 一条提示词都没有时不能给「只出有的」——那等于出 0 张，
        // 面板关掉、画布上什么都没发生，用户只会以为按钮坏了。
        if (!ready) {
            const empty = generationCount === 0;
            modal.confirm({
                title: `还有 ${missing} 张没有提示词`,
                content: empty ? "请先分析商品，或为需要生成的图片填写提示词。" : "没有提示词的图不会生成。要先把它们补上，还是只出已经有提示词的那几张？",
                okText: empty ? "去补提示词" : "只出有的",
                centered: true,
                ...(empty ? { cancelButtonProps: { style: { display: "none" } } } : { cancelText: "回去补", onOk: generateDraft }),
            });
            return;
        }
        generateDraft();
    };
    const applyTemplate = (id: string, builtin?: EcommerceSuiteTemplate) => {
        const template = builtin || [...templates, ...privateTemplates].find((item) => item.id === id && item.flow === flow.id && item.enabled);
        if (!template) return;
        const apply = () => {
            const adapted = { ...template, flow: flow.id };
            setDraftRows(ecommerceTemplateRows(adapted));
            onBriefChange?.({ ...brief, template: structuredClone(adapted), imageCount: template.shots.length, style: template.style });
        };
        modal.confirm({
            title: `使用「${template.name}」替换当前 ${draftRows.length} 行？`,
            content: "现有行的标题、职责和提示词将被替换，已生成图片保留。模板只提供画面方向，商品事实以实拍和补充信息为准。",
            okText: "替换表格",
            cancelText: "保留当前表格",
            onOk: apply,
        });
    };

    const content = (
        <div className={embedded ? "ecom-suite-shell ecom-suite-embedded" : "ecom-suite-shell"}>
            <header className="ecom-suite-head">
                <div className="min-w-0">
                    <span className="ecom-suite-kicker">电商 / 套图</span>
                    <h2 className="ecom-suite-title">{flow.name}</h2>
                </div>
                <span className="ecom-suite-count tabular-nums" data-warn={missing ? "true" : undefined}>
                    {generationCount}/{enabledTotal} 条提示词
                </span>
            </header>

            <div className="ecom-suite-bar">
                {!showProfessionalControls ? (
                    <button
                        type="button"
                        className="ecom-suite-ghost"
                        aria-label={advancedOpen ? "关闭高级设置" : "打开高级设置"}
                        aria-expanded={advancedOpen}
                        title={advancedOpen ? "收起模型、Skills 和完整提示词" : "调整模型、Skills 和完整提示词"}
                        onClick={() => setAdvancedOpen((value) => !value)}
                    >
                        高级设置
                    </button>
                ) : null}
                {showAdvanced || !analysisModelReady ? (
                    <fieldset disabled={analyzing} aria-label="分析模型设置" style={{ display: "contents" }}>
                        <label className="ecom-suite-field">
                            <span>分析模型</span>
                            <ModelPicker
                                className="!h-7 !w-56 !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                                config={config}
                                value={analysisModel}
                                onChange={onAnalysisModelChange}
                                capability="text"
                                requirements={analysisRequirements}
                                showSelectedPrice={false}
                                showOptionPrices={false}
                                variant="creation"
                                showConfiguredModelName
                            />
                        </label>
                    </fieldset>
                ) : null}
                {!analysisModelReady ? (
                    <>
                        <span role="alert" className="ecom-suite-error">
                            {analysisModel ? `当前分析模型${analysisModelError}，本次将提交 ${analysisReferenceImageCount} 张参考图，请更换模型` : "分析模型不可用，请重新选择"}
                        </span>
                        {!hasAnalysisModelOptions ? (
                            <Link className="ecom-suite-library-link" to="/settings?section=models" target="_blank" rel="noopener noreferrer">
                                打开模型设置
                            </Link>
                        ) : null}
                    </>
                ) : null}
                <button
                    type="button"
                    className={showProfessionalControls ? "ecom-suite-primary" : "ecom-suite-ghost"}
                    disabled={analyzing || !analysisModelReady}
                    onClick={() => {
                        commitDraftRows();
                        onAnalyze(draftRows);
                    }}
                    title={!analysisModelReady ? (analysisModel ? `当前分析模型${analysisModelError}` : "请先选择分析模型") : "分析商品图与参考图"}
                >
                    {analyzing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {analyzing ? "分析中…" : "分析商品"}
                </button>
                {onReverse ? (
                    <button
                        type="button"
                        className="ecom-suite-ghost"
                        disabled={analyzing || !analysisModelReady}
                        onClick={() => {
                            commitDraftRows();
                            onReverse();
                        }}
                        title="根据商品节点的参考图规划套图"
                    >
                        参考套图分析
                    </button>
                ) : null}
                <button type="button" className="ecom-suite-ghost" data-active={promptOpen ? "true" : undefined} aria-expanded={promptOpen} title="补充平台、张数和商品信息" onClick={() => setPromptOpen((value) => !value)}>
                    <FileText className="size-3.5" />
                    补充信息
                </button>
                {/* 技能：用户库里攒的写法，按品类挑几个注入这次分析。
                        默认不选——库里可能二十个，全塞进去会把提示词顶爆。 */}
                {showAdvanced ? (
                    <div className="ecom-suite-skills">
                        <fieldset disabled={analyzing} aria-label="分析 Skills 设置" style={{ display: "contents" }}>
                            <label className="ecom-suite-field">
                                <span>Skills</span>
                                <SkillRuntimePicker
                                    skills={availableSkills}
                                    loading={skillsLoading}
                                    value={skillIds}
                                    onChange={onSkillIdsChange}
                                    className="!h-7 !w-48 !min-w-0 !text-[var(--fs-tiny)]"
                                    placeholder={skillsLoading ? "读取技能库…" : "不使用技能"}
                                    ariaLabel="本次分析使用的技能"
                                />
                            </label>
                        </fieldset>
                        <button type="button" className="ecom-suite-icon" title="刷新 Skills 库" aria-label="刷新 Skills 库" disabled={analyzing || skillsLoading || !onRefreshSkills} onClick={onRefreshSkills}>
                            <RefreshCw className={`size-3.5${skillsLoading ? " animate-spin" : ""}`} />
                        </button>
                        <Link className="ecom-suite-library-link" to="/skills" target="_blank" rel="noopener noreferrer" title="打开技能库管理并添加更多技能">
                            <Library className="size-3.5" />
                            技能库
                        </Link>
                    </div>
                ) : null}
                {showAdvanced && skillsError ? (
                    <span role="alert" className="ecom-suite-error">
                        {skillsError}
                    </span>
                ) : null}
            </div>

            {promptOpen ? (
                <div className="ecom-suite-brief" aria-label="补充信息">
                    <label className="ecom-suite-brief-wide">
                        套图模板
                        <select aria-label="套图模板" className="ecom-suite-director-input" value="" onChange={(e) => applyTemplate(e.target.value)}>
                            <option value="">{brief.template ? `已使用：${brief.template.name}` : "选择套图模板"}</option>
                            <optgroup label="后台发布">
                                {templates
                                    .filter((item) => item.flow === flow.id && item.enabled)
                                    .map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.category ? `${item.category} · ` : ""}
                                            {item.name}（{item.shots.length} 张）
                                        </option>
                                    ))}
                            </optgroup>
                            <optgroup label="我的模板 · 当前浏览器">
                                {privateTemplates
                                    .filter((item) => item.flow === flow.id)
                                    .map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name}（{item.shots.length} 张）
                                        </option>
                                    ))}
                            </optgroup>
                        </select>
                    </label>
                    <div className="ecom-suite-brief-wide">
                        <EcommerceTemplateCatalogDetails disabled={generating || analyzing} onApply={(template) => applyTemplate(template.id, template)} />
                    </div>
                    <div className="ecom-suite-brief-wide ecom-suite-private-templates">
                        <label>
                            保存当前画面结构
                            <input aria-label="私人模板名称" className="ecom-suite-director-input" maxLength={100} value={templateName} placeholder="模板名称" onChange={(event) => setTemplateName(event.target.value)} />
                        </label>
                        <button
                            type="button"
                            className="ecom-suite-ghost"
                            disabled={savingTemplate || !templateName.trim() || !draftRows.length}
                            onClick={async () => {
                                setSavingTemplate(true);
                                try {
                                    const template = {
                                        id: `private-${crypto.randomUUID()}`,
                                        name: templateName.trim(),
                                        flow: flow.id,
                                        category: "",
                                        enabled: true,
                                        style: brief.style || "",
                                        source: "私人画面结构",
                                        shots: draftRows.map((row) => ({ title: row.title.trim(), duty: row.duty.trim() })),
                                    };
                                    await useEcommerceTemplateLibrary.getState().save(template);
                                    setTemplateName("");
                                    message.success("模板已保存到当前账号的浏览器，下次可跨画布复用");
                                } catch (error) {
                                    message.error(error instanceof Error ? error.message : "模板保存失败");
                                } finally {
                                    setSavingTemplate(false);
                                }
                            }}
                        >
                            {savingTemplate ? "保存中…" : "存为我的模板"}
                        </button>
                        <span>只保存标题、职责和视觉规范，使用时重新分析商品。</span>
                        {privateTemplates
                            .filter((item) => item.flow === flow.id)
                            .map((item) => (
                                <div key={item.id}>
                                    <span>{item.name}</span>
                                    <button
                                        type="button"
                                        className="ecom-suite-ghost"
                                        aria-label={`删除私人模板 ${item.name}`}
                                        onClick={() =>
                                            modal.confirm({
                                                title: `删除「${item.name}」？`,
                                                content: "已使用的创作表快照会保留。",
                                                okText: "删除",
                                                cancelText: "保留",
                                                onOk: () =>
                                                    useEcommerceTemplateLibrary
                                                        .getState()
                                                        .remove(item.id)
                                                        .catch((error) => {
                                                            message.error(error instanceof Error ? error.message : "删除失败");
                                                            throw error;
                                                        }),
                                            })
                                        }
                                    >
                                        删除
                                    </button>
                                </div>
                            ))}
                    </div>
                    <label>
                        发布平台
                        <EcommerceChoiceInput label="发布平台" value={brief.platform || ""} choices={ECOMMERCE_BRIEF_CHOICES.platform} onChange={(platform) => onBriefChange?.({ ...brief, platform })} />
                    </label>
                    {flow.bind ? (
                        <label>
                            长图切片规格
                            <select
                                aria-label="长图切片规格"
                                className="ecom-suite-director-input"
                                value={brief.slicePlatform || ""}
                                onChange={(event) => onBriefChange?.({ ...brief, slicePlatform: (event.target.value as EcommerceSlicePlatform) || undefined })}
                            >
                                <option value="">跟随商品设置（默认淘宝 / 天猫）</option>
                                {ECOMMERCE_SLICE_SPECS.map((spec) => (
                                    <option key={spec.id} value={spec.id}>
                                        {spec.name} · {spec.width}px 宽
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    <label>
                        计划张数
                        <input
                            aria-label="计划张数"
                            className="ecom-suite-director-input"
                            type="number"
                            min={1}
                            max={30}
                            value={brief.imageCount ?? ""}
                            placeholder="按当前表格"
                            onChange={(e) => {
                                const count = Number(e.target.value);
                                if (!e.target.value || (Number.isInteger(count) && count >= 1 && count <= 30)) onBriefChange?.({ ...brief, imageCount: e.target.value ? count : undefined });
                            }}
                        />
                    </label>
                    <label>
                        文案语言
                        <EcommerceChoiceInput label="文案语言" value={brief.language || ""} maxLength={64} choices={ECOMMERCE_BRIEF_CHOICES.language} onChange={(language) => onBriefChange?.({ ...brief, language })} />
                    </label>
                    <label>
                        人群与场景
                        <EcommerceChoiceInput label="人群与场景" value={brief.audience || ""} maxLength={2000} choices={ECOMMERCE_BRIEF_CHOICES.audience} onChange={(audience) => onBriefChange?.({ ...brief, audience })} />
                    </label>
                    <label className="ecom-suite-brief-wide">
                        卖点与依据
                        <textarea
                            aria-label="卖点与依据"
                            className="ecom-suite-director-input"
                            rows={2}
                            maxLength={6000}
                            placeholder="填写可以确认的商品信息"
                            value={brief.sellingPoints || ""}
                            onChange={(e) => onBriefChange?.({ ...brief, sellingPoints: e.target.value })}
                        />
                    </label>
                    <label>
                        整套视觉规范
                        <EcommerceChoiceInput label="整套视觉规范" value={brief.style || ""} maxLength={2000} choices={ECOMMERCE_BRIEF_CHOICES.style} onChange={(style) => onBriefChange?.({ ...brief, style })} />
                    </label>
                    <label>
                        禁止项
                        <EcommerceChoiceInput label="禁止项" value={brief.forbidden || ""} maxLength={2000} choices={ECOMMERCE_BRIEF_CHOICES.forbidden} onChange={(forbidden) => onBriefChange?.({ ...brief, forbidden })} />
                    </label>
                </div>
            ) : null}

            <div className={showProfessionalControls ? "ecom-suite-grid thin-scrollbar" : detailQuickView ? "ecom-suite-detail-workspace" : "ecom-suite-storyboard thin-scrollbar"}>
                {showProfessionalControls ? (
                    <div className="ecom-suite-grid-head">
                        <span>屏次</span>
                        <span>这一张要什么</span>
                        <span>提示词</span>
                        <span>结果</span>
                    </div>
                ) : null}
                {detailQuickView ? (
                    <>
                        <nav className="ecom-suite-detail-nav thin-scrollbar" aria-label="详情页屏次">
                            {draftRows.map((row, index) => {
                                const label = row.title.trim() || row.slotId;
                                const node = nodeBySlot.get(row.slotId);
                                const status = node?.metadata?.status;
                                const state = row.enabled === false ? "已跳过" : status === "loading" ? "生成中" : status === "error" ? "失败" : node?.metadata?.storageKey ? "已生成" : "待生成";
                                return (
                                    <button
                                        key={row.slotId}
                                        type="button"
                                        aria-label={`编辑第 ${index + 1} 屏：${label}`}
                                        aria-current={activeDetailSlotId === row.slotId ? "page" : undefined}
                                        data-status={status || "idle"}
                                        onClick={() => setDetailSlotId(row.slotId)}
                                    >
                                        <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                                        <span>
                                            <strong>{label}</strong>
                                            <small>{state}</small>
                                        </span>
                                    </button>
                                );
                            })}
                        </nav>
                        <section className="ecom-suite-detail-preview thin-scrollbar" aria-label="连续详情页预览">
                            {draftRows
                                .filter((row) => row.enabled !== false)
                                .map((row, index) => {
                                    const node = nodeBySlot.get(row.slotId);
                                    const status = node?.metadata?.status;
                                    const label = row.title.trim() || row.slotId;
                                    const copy = row.copy ?? { headline: "", subhead: "", cta: "", price: "" };
                                    const layout = row.layout ?? createEcommerceLayoutFromPreset(ecommerceOneClickLayoutPreset(flow.id, row.slotId))!;
                                    const visibleBlocks = ecommerceLayoutVisibleBlocks(layout, copy);
                                    const previewSize = ecommerceSuitePreviewSize(node, imageSize, SUITE_DETAIL_PREVIEW_EDGE);
                                    const hasImage = Boolean(node && (node.metadata?.storageKey || node.metadata?.content) && status !== "loading" && status !== "error");
                                    return (
                                        <button
                                            key={row.slotId}
                                            type="button"
                                            className="ecom-suite-detail-preview-page"
                                            aria-label={`在编辑区打开第 ${index + 1} 屏：${label}`}
                                            aria-current={activeDetailSlotId === row.slotId ? "true" : undefined}
                                            data-disabled={row.enabled === false ? "true" : undefined}
                                            onClick={() => setDetailSlotId(row.slotId)}
                                        >
                                            <span className="ecom-suite-detail-preview-label">
                                                {String(index + 1).padStart(2, "0")} · {label}
                                            </span>
                                            <span className="ecom-suite-detail-preview-artboard" style={previewSize}>
                                                {status === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : <SuiteThumb node={node} />}
                                                {hasImage && visibleBlocks.length ? (
                                                    <span className="ecom-suite-layout-overlay ecom-suite-detail-overlay" aria-hidden="true">
                                                        {visibleBlocks.map((block) => (
                                                            <span key={block.id} data-layout-field={block.field} style={ecommerceLayoutBlockStyle(block, previewSize)}>
                                                                {copy[block.field].trim()}
                                                            </span>
                                                        ))}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </button>
                                    );
                                })}
                        </section>
                    </>
                ) : null}
                <div className={detailQuickView ? "ecom-suite-detail-editor thin-scrollbar" : "ecom-suite-row-list"} aria-label={detailQuickView ? "当前屏编辑" : undefined}>
                    {draftRows.map((row, index) => {
                        const node = nodeBySlot.get(row.slotId);
                        const status = node?.metadata?.status;
                        const hasPrompt = Boolean(row.prompt.trim());
                        const label = row.title.trim() || row.slotId;
                        const enabled = row.enabled !== false;
                        const candidates = candidatesBySlot?.get(row.slotId) || [];
                        const candidateIsStale = (candidate: CanvasNodeData) => Boolean(sourceSignature && !ecommerceResultSourceCurrent(candidate, sourceSignature(row, candidate)));
                        const rowBusy = busySlotIds.has(row.slotId);
                        const designedCopy = row.copy ?? { headline: "", subhead: "", cta: "", price: "" };
                        const designedLayout = row.layout ?? createEcommerceLayoutFromPreset(ecommerceOneClickLayoutPreset(flow.id, row.slotId))!;
                        const designedRow = { ...row, copy: designedCopy, layout: designedLayout };
                        const visibleBlocks = ecommerceLayoutVisibleBlocks(designedRow.layout, designedRow.copy);
                        const previewSize = ecommerceSuitePreviewSize(node, imageSize);
                        const hasAdoptedImage = Boolean(node && (node.metadata?.storageKey || node.metadata?.content) && status !== "loading" && status !== "error");
                        const rowActionLabel = rowBusy ? "生成中" : status === "error" ? "重试" : hasAdoptedImage ? "重出" : "生成";
                        const copyEditorId = `ecom-suite-copy-${row.slotId}`;
                        const copyEditor = (
                            <fieldset id={copyEditorId} className="ecom-suite-copy-editor" aria-label={`${label} 文案与版式`}>
                                <legend>文案与版式</legend>
                                <div className="ecom-suite-copy-fields">
                                    <label>
                                        <span>主标题</span>
                                        <input value={designedRow.copy.headline} aria-label={`${label} 主标题`} onChange={(event) => updateCopyDraft(row.slotId, "headline", event.target.value, designedCopy, designedLayout)} onBlur={commitPendingCopy} />
                                    </label>
                                    <label>
                                        <span>副文案</span>
                                        <input value={designedRow.copy.subhead} aria-label={`${label} 副文案`} onChange={(event) => updateCopyDraft(row.slotId, "subhead", event.target.value, designedCopy, designedLayout)} onBlur={commitPendingCopy} />
                                    </label>
                                    <label>
                                        <span>行动引导</span>
                                        <input value={designedRow.copy.cta} aria-label={`${label} 行动引导`} onChange={(event) => updateCopyDraft(row.slotId, "cta", event.target.value, designedCopy, designedLayout)} onBlur={commitPendingCopy} />
                                    </label>
                                    <label>
                                        <span>价格</span>
                                        <input value={designedRow.copy.price} aria-label={`${label} 价格`} onChange={(event) => updateCopyDraft(row.slotId, "price", event.target.value, designedCopy, designedLayout)} onBlur={commitPendingCopy} />
                                    </label>
                                </div>
                                <div className="ecom-suite-layout-presets" role="group" aria-label={`${label} 版式预设`}>
                                    {ECOMMERCE_LAYOUT_PRESETS.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            className="ecom-suite-layout-preset"
                                            aria-label={`使用版式：${preset.layout.name}`}
                                            aria-pressed={designedRow.layout?.name === preset.layout.name}
                                            title={preset.hint}
                                            onClick={() => {
                                                const layout = createEcommerceLayoutFromPreset(preset.id);
                                                if (layout) updateDesignRow(row.slotId, (current) => ({ ...current, copy: current.copy ?? designedCopy, layout }));
                                            }}
                                        >
                                            {preset.layout.name}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        );
                        return (
                            <div
                                key={row.slotId}
                                className={showProfessionalControls ? "ecom-suite-grid-row" : "ecom-suite-story-card"}
                                data-empty={hasPrompt ? undefined : "true"}
                                data-disabled={enabled ? undefined : "true"}
                                role="group"
                                aria-label={`第 ${index + 1} 屏：${label}`}
                                hidden={detailQuickView && row.slotId !== activeDetailSlotId}
                            >
                                <span className="ecom-suite-screen">
                                    {!showProfessionalControls ? (
                                        <button
                                            type="button"
                                            className="ecom-suite-row-toggle"
                                            role="switch"
                                            aria-label={`启用这一屏：${label}`}
                                            aria-checked={enabled}
                                            onClick={() => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, enabled: !enabled } : item)))}
                                        >
                                            {enabled ? "启用" : "已跳过"}
                                        </button>
                                    ) : null}
                                    <b className="tabular-nums">{String(index + 1).padStart(2, "0")}</b>
                                    {/* 屏次可改。行业套路只是起手式——用户按自己的结构改，
                                        加行删行就是改屏数，不必接受别人给的九屏。 */}
                                    <input
                                        className="ecom-suite-screen-input"
                                        value={row.title}
                                        placeholder="这一屏叫什么"
                                        aria-label={`第 ${index + 1} 屏的标题`}
                                        onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, title: event.target.value } : item)))}
                                    />
                                    <button
                                        type="button"
                                        className="ecom-suite-row-move"
                                        disabled={index === 0}
                                        title="往前挪一格"
                                        aria-label={`把「${label}」往前挪一格`}
                                        onClick={() => updateDraftRows((current) => moveDraftRow(current, row.slotId, -1))}
                                    >
                                        <ArrowUp className="size-3" />
                                    </button>
                                    <button
                                        type="button"
                                        className="ecom-suite-row-move"
                                        disabled={index === draftRows.length - 1}
                                        title="往后挪一格"
                                        aria-label={`把「${label}」往后挪一格`}
                                        onClick={() => updateDraftRows((current) => moveDraftRow(current, row.slotId, 1))}
                                    >
                                        <ArrowDown className="size-3" />
                                    </button>
                                    <button
                                        type="button"
                                        className="ecom-suite-row-remove"
                                        disabled={draftRows.length === 1}
                                        title={draftRows.length === 1 ? "至少保留一屏" : `删掉这一屏：${label}`}
                                        aria-label={`删掉这一屏：${label}`}
                                        onClick={() => updateDraftRows((current) => (current.length > 1 ? current.filter((item) => item.slotId !== row.slotId) : current))}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                                {showProfessionalControls ? (
                                    <textarea
                                        className="ecom-suite-duty thin-scrollbar"
                                        rows={2}
                                        value={row.duty}
                                        placeholder="这一张要解决什么"
                                        aria-label={`${label} 要解决什么`}
                                        onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, duty: event.target.value } : item)))}
                                    />
                                ) : (
                                    <label className="ecom-suite-story-duty">
                                        <span>这一张解决什么</span>
                                        <textarea
                                            className="ecom-suite-duty thin-scrollbar"
                                            rows={2}
                                            value={row.duty}
                                            placeholder="例如：快速建立商品认知，突出核心卖点"
                                            aria-label={`${label} 要解决什么`}
                                            onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, duty: event.target.value } : item)))}
                                        />
                                    </label>
                                )}
                                {showAdvanced ? (
                                    <textarea
                                        className={showProfessionalControls ? "ecom-suite-prompt thin-scrollbar" : "ecom-suite-prompt ecom-suite-story-prompt thin-scrollbar"}
                                        rows={3}
                                        value={row.prompt}
                                        placeholder="这一张要画什么——主体与状态、场景与背景、光线与镜头、图上文字。点「分析商品」让模型读图来写，或者自己填。"
                                        aria-label={`${label} 提示词`}
                                        autoFocus={focusedPromptSlotId === row.slotId}
                                        onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, prompt: event.target.value } : item)))}
                                    />
                                ) : null}
                                {!showProfessionalControls && !showAdvanced && enabled && !hasPrompt ? (
                                    <div className="ecom-suite-missing-plan" role="status">
                                        <span>缺少生成方案</span>
                                        <button type="button" aria-label={`手动填写生成方案：${label}`} onClick={() => focusPrompt(row.slotId)}>
                                            手动填写
                                        </button>
                                    </div>
                                ) : null}
                                <div className={showProfessionalControls ? "ecom-suite-result" : "ecom-suite-story-result"} data-status={status || "idle"}>
                                    {showProfessionalControls ? (
                                        <>
                                            {status === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <SuiteThumb node={node} />}
                                            {candidates.length ? (
                                                <select
                                                    className="ecom-suite-result-select"
                                                    aria-label={`${label} 采用结果`}
                                                    value={row.resultNodeId || ""}
                                                    onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, resultNodeId: event.target.value || undefined } : item)))}
                                                >
                                                    <option value="">最近成功结果</option>
                                                    {row.resultNodeId && !candidates.some((item) => item.id === row.resultNodeId) ? (
                                                        <option value={row.resultNodeId} disabled>
                                                            已选结果已移除
                                                        </option>
                                                    ) : null}
                                                    {candidates.map((candidate, candidateIndex) => (
                                                        <option
                                                            key={candidate.id}
                                                            value={candidate.id}
                                                            disabled={!candidate.metadata?.storageKey || candidate.metadata.status === "loading" || candidate.metadata.status === "error" || candidateIsStale(candidate)}
                                                        >
                                                            版本 {candidateIndex + 1} ·{" "}
                                                            {candidateIsStale(candidate) ? "旧方案，请重新生成" : candidate.metadata?.status === "loading" ? "生成中" : candidate.metadata?.status === "error" ? "失败" : candidate.title || "图片"}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : row.resultNodeId ? (
                                                <span>已选结果已移除</span>
                                            ) : null}
                                        </>
                                    ) : (
                                        <>
                                            <div className="ecom-suite-story-preview" style={previewSize}>
                                                {status === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : <SuiteThumb node={node} />}
                                                {hasAdoptedImage && visibleBlocks.length ? (
                                                    <div className="ecom-suite-layout-overlay" aria-hidden="true">
                                                        {visibleBlocks.map((block) => (
                                                            <span key={block.id} data-layout-field={block.field} style={ecommerceLayoutBlockStyle(block, previewSize)}>
                                                                {designedRow.copy?.[block.field].trim()}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                            {candidates.length ? (
                                                <div className="ecom-suite-candidates" role="group" aria-label={`${label} 候选结果`}>
                                                    <button
                                                        type="button"
                                                        className="ecom-suite-candidate ecom-suite-candidate-auto"
                                                        aria-label={`自动采用最新成功结果：${label}`}
                                                        aria-pressed={!row.resultNodeId}
                                                        onClick={() => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, resultNodeId: undefined } : item)))}
                                                    >
                                                        自动
                                                    </button>
                                                    {candidates.map((candidate, candidateIndex) => {
                                                        const stale = candidateIsStale(candidate);
                                                        const unusable = !candidate.metadata?.storageKey || candidate.metadata.status === "loading" || candidate.metadata.status === "error" || stale;
                                                        return (
                                                            <div key={candidate.id} className="ecom-suite-candidate-card" data-selected={row.resultNodeId === candidate.id ? "true" : undefined}>
                                                                <div className="ecom-suite-candidate-preview">
                                                                    <SuiteThumb node={candidate} previewLabel={`查看大图：版本 ${candidateIndex + 1} · ${candidate.title || "图片"}`} />
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="ecom-suite-candidate"
                                                                    aria-label={`采用版本 ${candidateIndex + 1}：${candidate.title || "图片"}`}
                                                                    aria-pressed={row.resultNodeId === candidate.id}
                                                                    disabled={unusable}
                                                                    onClick={() => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, resultNodeId: candidate.id } : item)))}
                                                                >
                                                                    {stale ? "旧方案" : candidate.metadata?.status === "loading" ? "生成中" : candidate.metadata?.status === "error" ? "失败" : `采用 ${candidateIndex + 1}`}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : row.resultNodeId ? (
                                                <span className="ecom-suite-result-missing">已选结果已移除</span>
                                            ) : null}
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        className="ecom-suite-row-run"
                                        disabled={!enabled || !hasPrompt || batchBusy || !imageModelReady}
                                        title={!enabled ? "这一屏已跳过" : rowBusy ? "这一屏正在生成" : batchBusy ? "已有生成任务正在进行" : imageModelError || (hasPrompt ? `只出这一张：${label}` : "这一张还没有提示词")}
                                        aria-label={`${rowActionLabel}：${label}`}
                                        aria-busy={rowBusy}
                                        onClick={() => generateDraftOne(row.slotId)}
                                    >
                                        {rowBusy ? <LoaderCircle className="size-3 animate-spin" /> : <ImagePlus className="size-3" />}
                                        {rowActionLabel}
                                    </button>
                                </div>
                                {showProfessionalControls ? (
                                    copyEditor
                                ) : (
                                    <div className="ecom-suite-copy-section">
                                        <button
                                            type="button"
                                            className="ecom-suite-copy-toggle"
                                            aria-label={`${label} 文案与版式`}
                                            aria-expanded={expandedDesignSlotId === row.slotId}
                                            aria-controls={copyEditorId}
                                            onClick={() => setExpandedDesignSlotId((current) => (current === row.slotId ? undefined : row.slotId))}
                                        >
                                            <span>文案与版式</span>
                                            <span>{expandedDesignSlotId === row.slotId ? "收起" : "展开"}</span>
                                        </button>
                                        {expandedDesignSlotId === row.slotId ? copyEditor : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {/* 加一屏：这一套出几张由用户定，不是行业套路定 */}
                    <button type="button" className="ecom-suite-add-row" onClick={() => updateDraftRows((current) => [...current, { slotId: ecommerceSuiteRowId(flow, current), title: "", duty: "", prompt: "" }])}>
                        <Plus className="size-3" />
                        加一屏
                    </button>
                </div>
            </div>

            <footer className="ecom-suite-foot">
                {showAdvanced || !imageModelReady ? (
                    <label className="ecom-suite-field">
                        <span>出图模型</span>
                        <ModelPicker
                            className="!h-7 !w-56 !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                            config={config}
                            value={imageModel}
                            onChange={onImageModelChange}
                            capability="image"
                            requirements={imageRequirements}
                            showSelectedPrice={false}
                            showOptionPrices={false}
                            variant="creation"
                            showConfiguredModelName
                        />
                    </label>
                ) : null}
                {/* 尺寸 / 画质：按模型能力自动只显示这个模型真支持的档位。
                        透明背景与张数在这里关掉——套图不出透明底，张数由表里的行数决定，
                        留着就是两个点了没反应的开关。 */}
                {showAdvanced ? (
                    <CanvasImageSettingsPopover
                        config={settingsConfig}
                        onConfigChange={(key, value) => {
                            if (key === "size" || key === "quality") onImageOptionChange(key, value);
                        }}
                        buttonClassName="!h-7 !max-w-[220px] !rounded-full !px-2.5 !text-[var(--fs-tiny)]"
                        placement="topRight"
                        showCount={false}
                        showTransparent={false}
                    />
                ) : null}
                {!imageModelReady ? (
                    <>
                        <span role="alert" className="ecom-suite-error">
                            {imageModel ? `生图模型不兼容：${imageModelError}` : "生图模型不可用，请重新选择"}
                        </span>
                        {!hasImageModelOptions ? (
                            <Link className="ecom-suite-library-link" to="/settings?section=models" target="_blank" rel="noopener noreferrer">
                                打开模型设置
                            </Link>
                        ) : null}
                    </>
                ) : null}
                {/* 自动装订由用户开启，也可选好结果后再手动装订。 */}
                {flow.bind ? (
                    <label className="ecom-suite-field">
                        <input type="checkbox" checked={autoBind && autoBindAvailable} disabled={!autoBindAvailable} onChange={(event) => onAutoBindChange(event.target.checked)} />
                        <span>出完自动拼长图</span>
                    </label>
                ) : null}
                <span className="ecom-suite-foot-hint">
                    {!showProfessionalControls ? (
                        <span aria-label="生成摘要">{`将生成 ${generationCount} 张 · 已跳过 ${skipped} 张 · 缺少提示词 ${missing} 张`}</span>
                    ) : (
                        <>
                            {generated ? `已出 ${generated} 张 · ` : ""}
                            {missing ? `还差 ${missing} 条提示词` : `${enabledTotal} 张全部可出`}
                        </>
                    )}
                </span>
                {flow.bind && onBind ? (
                    <button
                        type="button"
                        className="ecom-suite-ghost"
                        disabled={binding || batchBusy || !autoBindAvailable || generated !== enabledTotal || !enabledTotal}
                        title="按当前行顺序和采用版本拼长图"
                        onClick={async () => {
                            if (binding || batchBusy) return;
                            setBinding(true);
                            try {
                                await onBind(structuredClone(draftRows));
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "装订失败");
                            } finally {
                                setBinding(false);
                            }
                        }}
                    >
                        {binding ? "装订中…" : "采用结果拼长图"}
                    </button>
                ) : null}
                <button
                    type="button"
                    className="ecom-suite-ghost"
                    disabled={exporting || generated !== enabledTotal || !enabledTotal}
                    title="下载带文字排版的 PNG 与 manifest v3 清单（ZIP）"
                    onClick={async () => {
                        if (exporting) return;
                        setExporting(true);
                        try {
                            const exportRows = commitDraftRows();
                            const sourceSignature = exportSourceSignature;
                            const assertSourceCurrent = () => {
                                if (latestExportSourceSignature.current !== sourceSignature) throw new Error("导出内容已变化，请重新导出");
                            };
                            const archive = await buildEcommerceSuiteArchive(structuredClone(exportRows), new Map(nodeBySlot), { assertSourceCurrent });
                            assertSourceCurrent();
                            saveAs(archive, `${downloadName(flow.name.replace(/^一键/, ""))}.zip`);
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "导出失败");
                        } finally {
                            setExporting(false);
                        }
                    }}
                >
                    {exporting ? "打包中…" : "导出排版套图"}
                </button>
                <button
                    type="button"
                    className="ecom-suite-ghost"
                    disabled={draftRows.every((row) => !row.prompt.trim())}
                    title="清空所有提示词"
                    onClick={() => {
                        modal.confirm({
                            title: "清空所有提示词？",
                            content: `表里 ${draftRows.filter((row) => row.prompt.trim()).length} 条提示词会被抹掉，屏次、职责和画布上已经出的图都不动。`,
                            okText: "清空",
                            cancelText: "算了",
                            centered: true,
                            onOk: () => {
                                setDraftRows((current) => current.map((row) => ({ ...row, prompt: "" })));
                                onClearPrompts();
                            },
                        });
                    }}
                >
                    <Eraser className="size-3" />
                    清空提示词
                </button>
                {!embedded ? (
                    <button type="button" className="ecom-suite-ghost" onClick={closeDraft}>
                        关闭
                    </button>
                ) : null}
                <button
                    type="button"
                    className="ecom-suite-primary"
                    aria-label={showProfessionalControls ? batchLabel : firstVersionLabel.replace("…", "")}
                    aria-busy={batchBusy || firstVersionRunning}
                    disabled={
                        analyzing ||
                        batchBusy ||
                        firstVersionRunning ||
                        (!showProfessionalControls && (!enabledTotal || generated === enabledTotal || !imageModelReady || (missing > 0 && !analysisModelReady))) ||
                        (showProfessionalControls && generationCount > 0 && !imageModelReady)
                    }
                    onClick={showProfessionalControls ? confirmGenerate : () => void generateFirstVersion()}
                    title={(generationCount > 0 && imageModelError) || "按这张表批量提交出图任务"}
                >
                    {batchBusy || firstVersionRunning ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                    {showProfessionalControls ? batchLabel : firstVersionLabel}
                </button>
            </footer>
        </div>
    );
    return embedded ? (
        content
    ) : (
        <AppModal open={open} onCancel={closeDraft} footer={null} width={1080} centered destroyOnHidden flush title={flow.name} classNames={{ header: "sr-only" }} className="ecom-suite-modal">
            {content}
        </AppModal>
    );
}

function moveDraftRow(rows: EcommerceSuiteRow[], slotId: string, delta: number) {
    const index = rows.findIndex((row) => row.slotId === slotId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= rows.length) return rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

const SUITE_PREVIEW_EDGE = 112;
const SUITE_DETAIL_PREVIEW_EDGE = 280;

function ecommerceSuitePreviewSize(node: CanvasNodeData | undefined, requestedSize: string, edge = SUITE_PREVIEW_EDGE) {
    const natural = node?.metadata?.naturalWidth && node.metadata.naturalHeight ? { width: node.metadata.naturalWidth, height: node.metadata.naturalHeight } : undefined;
    const requested = imageNodeSizeFromRatio(node?.metadata?.size || requestedSize, edge, edge);
    const source = natural || requested || (node && node.width > 0 && node.height > 0 ? node : undefined) || { width: edge, height: edge };
    const scale = edge / Math.max(source.width, source.height);
    return { width: source.width * scale, height: source.height * scale };
}

/** 结果缩略图。按 storageKey 解析——url 在退回本机时会失效。 */
function SuiteThumb({ node, previewLabel }: { node: CanvasNodeData | undefined; previewLabel?: string }) {
    const [src, setSrc] = useState("");
    const [previewOpen, setPreviewOpen] = useState(false);
    const key = node?.metadata?.storageKey;
    const failed = node?.metadata?.status === "error";
    const errorReason = failed && node?.metadata?.errorDetails ? generationErrorMessage(node.metadata.errorDetails) : "生成失败";
    useEffect(() => {
        let cancelled = false;
        setSrc("");
        if (failed || (!key && !node?.metadata?.content)) return;
        void resolveImageUrl(key, node?.metadata?.content || "")
            .then((url) => {
                if (!cancelled) setSrc(url);
            })
            .catch(() => {
                if (!cancelled) setSrc("");
            });
        return () => {
            cancelled = true;
        };
    }, [failed, key, node?.metadata?.content]);
    if (failed)
        return (
            <span className="ecom-suite-result-error" role="status" aria-live="polite" title={errorReason}>
                <strong>生成失败</strong>
                {errorReason !== "生成失败" ? <small>{errorReason}</small> : null}
            </span>
        );
    if (!src) return <span className="ecom-suite-result-empty">{node ? "待生成" : "未铺"}</span>;
    if (!previewLabel) return <img src={src} alt="" loading="lazy" draggable={false} />;
    return (
        <>
            <AntImage src={src} alt={node?.title || "候选图片"} preview={{ visible: previewOpen, mask: false, onVisibleChange: setPreviewOpen }} />
            <button type="button" className="ecom-suite-candidate-view" aria-label={previewLabel} onClick={() => setPreviewOpen(true)}>
                查看大图
            </button>
        </>
    );
}
