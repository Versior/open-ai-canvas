import { App } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eraser, FileText, ImagePlus, LoaderCircle, Plus, Sparkles, X, RefreshCw, Library } from "lucide-react";
import { Link } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { SkillRuntimePicker } from "@/components/skills/skill-runtime-picker";
import { EcommerceChoiceInput, ECOMMERCE_BRIEF_CHOICES } from "./ecommerce-choice-input";
import type { Skill } from "@/services/api/skills";
import { ModelPicker } from "@/components/model-picker";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import type { EcommerceOneClickFlow } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteRowId, type EcommerceSuite, type EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import { resolveImageUrl } from "@/services/image-storage";
import { useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { EcommerceBrief } from "@/lib/ecommerce/ecommerce-brief";
import { ECOMMERCE_SLICE_SPECS, type EcommerceSlicePlatform } from "@/lib/ecommerce/ecommerce-slice";
import { ecommerceTemplateRows } from "@/lib/ecommerce/ecomgen-template";
import { EcommerceTemplateCatalogDetails } from "./ecommerce-template-catalog";
import type { EcommerceSuiteTemplate } from "@/services/api/ecommerce";
import { buildEcommerceSuiteArchive } from "@/services/ecommerce-suite-export";
import { ecommerceTableResults } from "@/lib/ecommerce/ecommerce-table";
import { useEcommerceTemplateLibrary } from "@/stores/use-ecommerce-template-library";
import { downloadName } from "@/lib/media-package";
import { saveAs } from "file-saver";
import type { CanvasNodeData } from "@/types/canvas";
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
    /** 分析用的文本模型（要能看图）。 */
    analysisModel: string;
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
    onAnalyze: (rows: EcommerceSuiteRow[]) => void;
    onReverse?: () => void;
    onBind?: (rows: EcommerceSuiteRow[]) => Promise<unknown>;
    /** 改某一行的一格：标题 / 职责 / 提示词。 */
    onRowChange: (slotId: string, patch: Partial<Pick<EcommerceSuiteRow, "title" | "duty" | "prompt">>) => void;
    onRowsChange: (rows: EcommerceSuiteRow[]) => void;
    onAddRow: () => void;
    onRemoveRow: (slotId: string) => void;
    /** 出整张表。 */
    onGenerate: (rows?: EcommerceSuiteRow[]) => void | Promise<unknown>;
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
    analysisModel,
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
    const { modal, message } = App.useApp();
    const [exporting, setExporting] = useState(false);
    const [binding, setBinding] = useState(false);
    const [templateName, setTemplateName] = useState("");
    const [savingTemplate, setSavingTemplate] = useState(false);
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
    const draftRows = embedded ? rows : localRows;
    const nodeBySlot = useMemo(() => (candidatesBySlot ? ecommerceTableResults(draftRows, [...candidatesBySlot.values()].flat(), flow.id).selected : providedNodes), [draftRows, candidatesBySlot, flow.id, providedNodes]);
    const setDraftRows = (update: EcommerceSuiteRow[] | ((current: EcommerceSuiteRow[]) => EcommerceSuiteRow[])) => {
        const next = typeof update === "function" ? update(draftRows) : update;
        if (embedded) onRowsChange(next);
        else setLocalRows(next);
    };
    const previousInput = useRef({ rows, open });
    useEffect(() => {
        const previous = previousInput.current;
        const sameRows =
            previous.rows.length === rows.length &&
            previous.rows.every((row, index) => {
                const next = rows[index];
                return row.slotId === next.slotId && row.title === next.title && row.duty === next.duty && row.prompt === next.prompt && row.resultNodeId === next.resultNodeId;
            });
        // Model and skill changes can recreate equivalent rows without changing the draft.
        if (!sameRows || previous.open !== open) setLocalRows(rows);
        previousInput.current = { rows, open };
    }, [rows, open]);
    const total = draftRows.length;
    const missing = draftRows.filter((row) => !row.prompt.trim()).length;
    const ready = total > 0 && missing === 0;
    const generated = draftRows.filter((row) => {
        const metadata = nodeBySlot.get(row.slotId)?.metadata;
        return metadata?.storageKey && metadata.status !== "loading" && metadata.status !== "error";
    }).length;

    // 参数浮层读的是完整配置：模型换成面板上选的那个，尺寸/画质用节点上存的。
    // 少了这一步，浮层会按全局模型算能力，面板上选了另一个模型就看不到它的档位。
    const settingsConfig: AiConfig = {
        ...config,
        ...(imageModel ? { model: imageModel, imageModel } : {}),
        ...(imageSize ? { size: imageSize } : {}),
        ...(imageQuality ? { quality: imageQuality } : {}),
    };

    const updateDraftRows = (update: (current: EcommerceSuiteRow[]) => EcommerceSuiteRow[]) => setDraftRows(update);
    const commitDraftRows = () => {
        if (!embedded) onRowsChange(draftRows);
    };
    const closeDraft = () => {
        commitDraftRows();
        onClose();
    };
    const generateDraft = () => {
        commitDraftRows();
        void onGenerate(draftRows);
    };
    const generateDraftOne = (slotId: string) => {
        commitDraftRows();
        void onGenerateOne(slotId, draftRows);
    };

    const confirmGenerate = () => {
        // 一条提示词都没有时不能给「只出有的」——那等于出 0 张，
        // 面板关掉、画布上什么都没发生，用户只会以为按钮坏了。
        if (!ready) {
            const empty = missing >= total;
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
                    {total - missing}/{total} 条提示词
                </span>
            </header>

            <div className="ecom-suite-bar">
                <label className="ecom-suite-field">
                    <span>分析模型</span>
                    <ModelPicker
                        className="!h-7 !w-56 !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                        config={config}
                        value={analysisModel}
                        onChange={onAnalysisModelChange}
                        capability="text"
                        requirements={{ capability: "text", input: { textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } }}
                        showSelectedPrice={false}
                        showOptionPrices={false}
                        variant="creation"
                        showConfiguredModelName
                    />
                </label>
                <button
                    type="button"
                    className="ecom-suite-primary"
                    disabled={analyzing || !analysisModel}
                    onClick={() => {
                        commitDraftRows();
                        onAnalyze(draftRows);
                    }}
                    title={!analysisModel ? "请先选择分析模型" : "分析商品图与参考图"}
                >
                    {analyzing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {analyzing ? "分析中…" : "分析商品"}
                </button>
                {onReverse ? (
                    <button
                        type="button"
                        className="ecom-suite-ghost"
                        disabled={analyzing || !analysisModel}
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
                <div className="ecom-suite-skills">
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
                    <button type="button" className="ecom-suite-icon" title="刷新 Skills 库" aria-label="刷新 Skills 库" disabled={skillsLoading || !onRefreshSkills} onClick={onRefreshSkills}>
                        <RefreshCw className={`size-3.5${skillsLoading ? " animate-spin" : ""}`} />
                    </button>
                    <Link className="ecom-suite-library-link" to="/skills" target="_blank" rel="noopener noreferrer" title="打开技能库管理并添加更多技能">
                        <Library className="size-3.5" />
                        技能库
                    </Link>
                </div>
                {skillsError ? (
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

            <div className="ecom-suite-grid thin-scrollbar">
                <div className="ecom-suite-grid-head">
                    <span>屏次</span>
                    <span>这一张要什么</span>
                    <span>提示词</span>
                    <span>结果</span>
                </div>
                {draftRows.map((row, index) => {
                    const node = nodeBySlot.get(row.slotId);
                    const status = node?.metadata?.status;
                    const hasPrompt = Boolean(row.prompt.trim());
                    const label = row.title.trim() || row.slotId;
                    return (
                        <div key={row.slotId} className="ecom-suite-grid-row" data-empty={hasPrompt ? undefined : "true"}>
                            <span className="ecom-suite-screen">
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
                                <button type="button" className="ecom-suite-row-move" disabled={index === 0} title="往前挪一格" aria-label={`把「${label}」往前挪一格`} onClick={() => updateDraftRows((current) => moveDraftRow(current, row.slotId, -1))}>
                                    <ArrowUp className="size-3" />
                                </button>
                                <button
                                    type="button"
                                    className="ecom-suite-row-move"
                                    disabled={index === rows.length - 1}
                                    title="往后挪一格"
                                    aria-label={`把「${label}」往后挪一格`}
                                    onClick={() => updateDraftRows((current) => moveDraftRow(current, row.slotId, 1))}
                                >
                                    <ArrowDown className="size-3" />
                                </button>
                                <button
                                    type="button"
                                    className="ecom-suite-row-remove"
                                    title={`删掉这一屏：${label}`}
                                    aria-label={`删掉这一屏：${label}`}
                                    onClick={() => updateDraftRows((current) => (current.length > 1 ? current.filter((item) => item.slotId !== row.slotId) : current))}
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                            <textarea
                                className="ecom-suite-duty thin-scrollbar"
                                rows={2}
                                value={row.duty}
                                placeholder="这一张要解决什么"
                                aria-label={`${label} 要解决什么`}
                                onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, duty: event.target.value } : item)))}
                            />
                            <textarea
                                className="ecom-suite-prompt thin-scrollbar"
                                rows={3}
                                value={row.prompt}
                                placeholder="这一张要画什么——主体与状态、场景与背景、光线与镜头、图上文字。点「分析商品」让模型读图来写，或者自己填。"
                                aria-label={`${label} 提示词`}
                                onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, prompt: event.target.value } : item)))}
                            />
                            <span className="ecom-suite-result" data-status={status || "idle"}>
                                {status === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <SuiteThumb node={node} />}
                                {candidatesBySlot?.get(row.slotId)?.length ? (
                                    <select
                                        className="ecom-suite-result-select"
                                        aria-label={`${label} 采用结果`}
                                        value={row.resultNodeId || ""}
                                        onChange={(event) => setDraftRows((current) => current.map((item) => (item.slotId === row.slotId ? { ...item, resultNodeId: event.target.value || undefined } : item)))}
                                    >
                                        <option value="">最近成功结果</option>
                                        {row.resultNodeId && !candidatesBySlot.get(row.slotId)?.some((item) => item.id === row.resultNodeId) ? (
                                            <option value={row.resultNodeId} disabled>
                                                已选结果已移除
                                            </option>
                                        ) : null}
                                        {candidatesBySlot.get(row.slotId)!.map((candidate, index) => (
                                            <option key={candidate.id} value={candidate.id} disabled={!candidate.metadata?.storageKey || candidate.metadata.status === "loading" || candidate.metadata.status === "error"}>
                                                版本 {index + 1} · {candidate.metadata?.status === "loading" ? "生成中" : candidate.metadata?.status === "error" ? "失败" : candidate.title || "图片"}
                                            </option>
                                        ))}
                                    </select>
                                ) : row.resultNodeId ? (
                                    <span>已选结果已移除</span>
                                ) : null}
                                <button
                                    type="button"
                                    className="ecom-suite-row-run"
                                    disabled={!hasPrompt || generating || status === "loading"}
                                    title={hasPrompt ? `只出这一张：${label}` : "这一张还没有提示词"}
                                    aria-label={`只出这一张：${label}`}
                                    onClick={() => generateDraftOne(row.slotId)}
                                >
                                    {status === "loading" ? <LoaderCircle className="size-3 animate-spin" /> : <ImagePlus className="size-3" />}
                                    {node?.metadata?.content ? "重出" : "出图"}
                                </button>
                            </span>
                        </div>
                    );
                })}
                {/* 加一屏：这一套出几张由用户定，不是行业套路定 */}
                <button type="button" className="ecom-suite-add-row" onClick={() => updateDraftRows((current) => [...current, { slotId: ecommerceSuiteRowId(flow, current), title: "", duty: "", prompt: "" }])}>
                    <Plus className="size-3" />
                    加一屏
                </button>
            </div>

            <footer className="ecom-suite-foot">
                <label className="ecom-suite-field">
                    <span>出图模型</span>
                    <ModelPicker
                        className="!h-7 !w-56 !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                        config={config}
                        value={imageModel}
                        onChange={onImageModelChange}
                        capability="image"
                        showSelectedPrice={false}
                        showOptionPrices={false}
                        variant="creation"
                        showConfiguredModelName
                    />
                </label>
                {/* 尺寸 / 画质：按模型能力自动只显示这个模型真支持的档位。
                        透明背景与张数在这里关掉——套图不出透明底，张数由表里的行数决定，
                        留着就是两个点了没反应的开关。 */}
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
                {/* 自动装订由用户开启，也可选好结果后再手动装订。 */}
                {flow.bind ? (
                    <label className="ecom-suite-field">
                        <input type="checkbox" checked={autoBind && autoBindAvailable} disabled={!autoBindAvailable} onChange={(event) => onAutoBindChange(event.target.checked)} />
                        <span>出完自动拼长图</span>
                    </label>
                ) : null}
                <span className="ecom-suite-foot-hint">
                    {generated ? `已出 ${generated} 张 · ` : ""}
                    {missing ? `还差 ${missing} 条提示词` : `${total} 张全部可出`}
                </span>
                {flow.bind && onBind ? (
                    <button
                        type="button"
                        className="ecom-suite-ghost"
                        disabled={binding || generating || !autoBindAvailable || generated !== total || !total}
                        title="按当前行顺序和采用版本拼长图"
                        onClick={async () => {
                            if (binding) return;
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
                    disabled={exporting || generated !== total || !total}
                    title="下载当前套图原图与 manifest.json"
                    onClick={async () => {
                        if (exporting) return;
                        setExporting(true);
                        try {
                            saveAs(await buildEcommerceSuiteArchive(structuredClone(draftRows), new Map(nodeBySlot)), `${downloadName(flow.name.replace(/^一键/, ""))}.zip`);
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "导出失败");
                        } finally {
                            setExporting(false);
                        }
                    }}
                >
                    {exporting ? "打包中…" : "导出套图"}
                </button>
                <button
                    type="button"
                    className="ecom-suite-ghost"
                    disabled={total - missing === 0}
                    title="清空所有提示词"
                    onClick={() => {
                        modal.confirm({
                            title: "清空所有提示词？",
                            content: `表里 ${total - missing} 条提示词会被抹掉，屏次、职责和画布上已经出的图都不动。`,
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
                <button type="button" className="ecom-suite-primary" disabled={analyzing || generating || !imageModel} onClick={confirmGenerate} title={!imageModel ? "请先选择生图模型" : "按这张表批量提交出图任务"}>
                    <ImagePlus className="size-3.5" />
                    批量生成 {total - missing} 张
                </button>
            </footer>
        </div>
    );
    return embedded ? (
        content
    ) : (
        <AppModal open={open} onCancel={closeDraft} footer={null} width={1080} centered destroyOnHidden flush title={null} className="ecom-suite-modal">
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

/** 结果缩略图。按 storageKey 解析——url 在退回本机时会失效。 */
function SuiteThumb({ node }: { node: CanvasNodeData | undefined }) {
    const [src, setSrc] = useState("");
    const key = node?.metadata?.storageKey;
    useEffect(() => {
        let cancelled = false;
        if (!node?.metadata?.content) {
            setSrc("");
            return;
        }
        void resolveImageUrl(key, node.metadata.content || "")
            .then((url) => {
                if (!cancelled) setSrc(url);
            })
            .catch(() => {
                if (!cancelled) setSrc("");
            });
        return () => {
            cancelled = true;
        };
    }, [key, node?.metadata?.content]);
    if (!src) return <span className="ecom-suite-result-empty">{node ? "待生成" : "未铺"}</span>;
    return <img src={src} alt="" loading="lazy" draggable={false} />;
}
