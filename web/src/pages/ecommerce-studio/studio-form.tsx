import { App, Button, Input, Popover, Tooltip } from "antd";
import { ChevronDown, LayoutTemplate, ListChecks, RotateCcw, ScanSearch } from "lucide-react";
import { useMemo, useState, type ClipboardEvent, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Select } from "@/components/ui/base/select";
import { ECOMMERCE_PLATFORMS, ecommercePlatform, type EcommercePlatformId } from "@/lib/ecommerce/ecommerce-platform-specs";
import {
    applyStudioSuggestion,
    pickStudioSetType,
    resetStudioBriefParameters,
    STUDIO_COUNT_OPTIONS,
    STUDIO_PLAN_NOTE_MAX,
    STUDIO_LANGUAGES,
    STUDIO_MARKETS,
    STUDIO_SET_TYPES,
    STUDIO_SHOOTINGS,
    STUDIO_SINGLE_TYPES,
    studioMarket,
    studioOutputSpec,
    studioPlatformForbidsText,
    studioRatioValid,
    studioRunRatio,
    studioInfoPoints,
    studioSingleTypes,
    studioSuggestion,
    studioTitleOf,
    toggleStudioSingleType,
} from "@/lib/ecommerce-studio/brief";
import { studioCopyIssues } from "@/lib/ecommerce-studio/dossier-tasks";
import { studioEffectiveQuality, studioEffectiveResolution, studioImageRequest, studioQualityOptions, studioRatioOptions, studioResolutionOptions, type StudioImageRequest } from "@/lib/ecommerce-studio/image-options";
import { studioModelAdapter, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { patchStudioDetailPlanScreen, STUDIO_DESIGN_TONES, STUDIO_DETAIL_PLAN_LIMITS, STUDIO_PLAN_FIELD, STUDIO_PLAN_SCOPES } from "@/lib/ecommerce-studio/detail-plan";
import { moveStudioSetEntry, studioActivePlan, studioEntryRatio, studioPlanScopeOf, studioSetEntries, studioSetKind, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { STUDIO_STYLES, studioProductStyle } from "@/lib/ecommerce-studio/shot-specs";
import type { StudioBrief, StudioLanguage, StudioMarket, StudioOutputType, StudioProduct, StudioShooting, StudioStyleId } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { StudioDossierCard } from "./studio-dossier";
import { StudioModelCastSection } from "./studio-model-cast";
import { StudioModelPicker, useStudioModel } from "./studio-parts";
import { StudioShotList, type StudioPlannedScreenPatch } from "./studio-shot-list";
import { StudioSuitePicker } from "./studio-suite-picker";
import { StudioUploadBox, useStudioUploads } from "./studio-uploads";
import { studioImageFiles } from "./studio-upload";
import { useStudioEstimate } from "./use-studio-estimate";
import { useStudioAnalysis, type StudioRunner } from "./use-studio-runner";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const PLATFORM_OPTIONS = ECOMMERCE_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name }));
const MARKET_OPTIONS = STUDIO_MARKETS.map((item) => ({ value: item.id, label: item.label }));
const LANGUAGE_OPTIONS = STUDIO_LANGUAGES.map((item) => ({ value: item.id, label: item.label }));
const STYLE_OPTIONS = [{ value: "auto", label: "按商品推荐", title: "策划详情页时由策划挑；不策划时按品类挑" }, ...STUDIO_STYLES.map((style) => ({ value: style.id, label: style.name, title: style.mood }))];
const SHOOTING_OPTIONS = STUDIO_SHOOTINGS.map((item) => ({ value: item.id, label: item.label }));
const INFO_PLACEHOLDER = "每行一条卖点或商品信息，例如：\n316 不锈钢内胆：长效保温 12 小时\n一键弹盖，单手就能打开\n容量 500ml，重约 280g";

function Field({ label, span, hint, children, htmlFor }: { label: string; span: 2 | 3 | 6; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
    return (
        <div className="es-field" data-span={span}>
            <label className="es-field-label" htmlFor={htmlFor}>
                {label}
            </label>
            {children}
            {hint ? <div className="es-field-hint">{hint}</div> : null}
        </div>
    );
}

/** 自定义比例：宽和高各填 1–99，长边不超过短边的 3 倍时才写进表单。 */
function CustomRatioInput({ ratio, onChange }: { ratio: string; onChange: (ratio: string) => void }) {
    const [initialWidth = "", initialHeight = ""] = ratio === "auto" ? [] : ratio.split(":");
    const [width, setWidth] = useState(initialWidth);
    const [height, setHeight] = useState(initialHeight);
    const commit = (nextWidth: string, nextHeight: string) => {
        const [width, height] = [Number(nextWidth), Number(nextHeight)];
        if (!width || !height) return;
        // 约分后再存：33:55 和 3:5 是同一个比例。
        let [a, b] = [width, height];
        while (b) [a, b] = [b, a % b];
        const next = `${width / a}:${height / a}`;
        if (studioRatioValid(next)) onChange(next);
    };
    const digits = (value: string) => value.replace(/\D/g, "").slice(0, 2);
    return (
        <span className="es-ratio-custom">
            <Input
                aria-label="自定义比例的宽"
                inputMode="numeric"
                variant="filled"
                value={width}
                placeholder="宽"
                onChange={(event) => {
                    const value = digits(event.target.value);
                    setWidth(value);
                    commit(value, height);
                }}
            />
            <span aria-hidden>:</span>
            <Input
                aria-label="自定义比例的高"
                inputMode="numeric"
                variant="filled"
                value={height}
                placeholder="高"
                onChange={(event) => {
                    const value = digits(event.target.value);
                    setHeight(value);
                    commit(width, value);
                }}
            />
        </span>
    );
}

/** 自定义比例实际怎么出：能算出具体尺寸就写尺寸，模型不支持时写会落到哪个比例。 */
function CustomRatioNote({ ratio, request }: { ratio: string; request: StudioImageRequest }) {
    if (!studioRatioValid(ratio)) return <>宽高各填 1–99，长边不超过短边的 3 倍</>;
    const size = request.imageSettings.size && /^\d+x\d+$/.test(request.imageSettings.size) ? request.imageSettings.size.replace("x", "×") : "";
    // 落到了别的预设比例时如实说明，不把预设尺寸当成自定义比例的结果。
    if (request.aspectRatio && request.aspectRatio !== ratio) return <>{`这个模型不支持 ${ratio}，按最接近的 ${request.aspectRatio}${size ? `（${size}）` : ""} 出`}</>;
    return <>按 {size || ratio} 出图</>;
}

/** 识别和策划用的文本模型（同一个）：按钮上直接写着当前模型，点开浮层更换。 */
function FillModelPopover({ imageCount, purpose = "识别" }: { imageCount: number; purpose?: "识别" | "策划" }) {
    const { config, models, value } = useStudioModel("text");
    const label = value ? configuredModelDisplayName(config, value) : models.length ? `选择${purpose}模型` : "没有可用的文本模型";
    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            rootClassName="es-portal"
            content={
                <div className="es-popover">
                    <span className="es-popover-title">{purpose}用的模型</span>
                    <StudioModelPicker kind="text" imageCount={Math.max(1, imageCount)} placeholder="选择能看图的文本模型" />
                    <span className="es-popover-note">识别商品和策划详情页用同一个能看图的文本模型，按模型计费。</span>
                </div>
            }
        >
            <button type="button" className="es-model-chip" aria-label={`${purpose}用的模型：${label}，点击更换`} title={`${purpose}用的模型，点击更换`}>
                <span className="es-model-chip-label">{purpose}模型</span>
                <span className="es-model-chip-value">{label}</span>
                <ChevronDown size={12} aria-hidden />
            </button>
        </Popover>
    );
}

export function StudioForm({ product, edit, ensure, runner, onGenerated }: { product: StudioProduct; edit: Edit; ensure: () => string; runner: StudioRunner; onGenerated: () => void }) {
    const { message, modal } = App.useApp();
    const image = useStudioModel("image");
    const text = useStudioModel("text");
    const uploads = useStudioUploads(ensure);
    const filling = useStudioAnalysis((state) => state.running[product.id] === "fill");
    const planning = useStudioAnalysis((state) => state.running[product.id] === "plan");
    const brief = product.brief;
    // 当前出图类型的策划：详情页、主图套图和单张图各有一份，模板套图按模板出。
    const scope = studioPlanScopeOf(product);
    const activePlan = studioActivePlan(product);
    const scopeMeta = scope ? STUDIO_PLAN_SCOPES[scope] : undefined;
    const spec = studioOutputSpec(brief.outputType);
    const profile = image.value ? modelCapabilityConfigFor(image.config, image.value).image : undefined;
    const qualityOptions = useMemo(() => studioQualityOptions(profile), [profile]);
    const quality = studioEffectiveQuality(profile, brief.quality);
    const resolutionOptions = useMemo(() => studioResolutionOptions(profile), [profile]);
    const resolution = studioEffectiveResolution(profile, brief.resolution);
    const ratioOptions = useMemo(() => studioRatioOptions(profile, quality, resolution), [profile, quality, resolution]);
    // 自定义比例：选了「自定义」或者表单里的比例不在这个模型的预设里时，显示宽高输入框。
    const [customRatioOpen, setCustomRatioOpen] = useState(false);
    const customRatio = customRatioOpen || (brief.ratio !== "auto" && !ratioOptions.includes(brief.ratio));
    const [pickerOpen, setPickerOpen] = useState(false);
    const setKind = studioSetKind(product);
    const singles = studioSingleTypes(brief);
    const entries = useMemo(() => studioSetEntries(product), [product]);
    const included = entries.filter((entry) => entry.included);
    const unit = setKind === "detail" ? "屏" : "张";
    // 单张类型可以多选，数量是每种出几张；单张图策划过时按策划清单里勾选的张数。
    const images = setKind || (scope === "single" && activePlan) ? included.length : singles.length * brief.count;
    const firstEntry = included[0] || entries[0];
    const firstRatio = setKind && firstEntry ? studioEntryRatio(firstEntry, product) : studioRunRatio(singles[0]?.role || "main-selling", product);
    const truthCount = studioReferencePhotos(product.photos, 8).length;
    // 有模特的图才用模特设定：选了模特图、模特拍法，或者套图清单里有上身效果。
    const castRelevant = singles.some((item) => item.id === "model") || brief.shooting === "model" || entries.some((entry) => entry.included && entry.role === "detail-model");
    const castReferences = castRelevant ? [brief.model?.figure ?? brief.model?.face, brief.model?.pose].filter((pick) => pick?.resourceId).length : 0;
    const referenceCount = Math.min(profile?.references.maxImages || 4, truthCount + castReferences + product.references.length);
    const estimate = useStudioEstimate({ model: image.value, images, references: referenceCount, quality, resolution, ratio: firstRatio });
    const suggestion = studioSuggestion(product);
    const issues = useMemo(() => studioCopyIssues(studioInfoPoints(product.sellerNotes), { headline: studioTitleOf(product), subhead: "", listingTitle: "", bullets: [] }), [product]);
    const adapter = studioModelAdapter(image.value);
    const platform = ecommercePlatform(product.platform);
    const noTextOnMain = singles.some((item) => item.role && studioPlatformForbidsText(product, item.role));
    const noTextNote = noTextOnMain ? `${platform?.name || "这个平台"}首图不加文字，标题不会写进图里` : "";
    const typeHint = singles.length > 1 ? [`${singles.map((item) => item.label).join("、")}，每种 ${brief.count} 张，共 ${images} 张`, noTextNote].filter(Boolean).join("；") : noTextNote || spec.hint;
    const uploading = uploads.pending.photos + uploads.pending.references > 0;
    const suiteMissing = brief.outputType === "template-set" && !brief.suite;
    // 详情页 10 屏、主图 5 张都由策划按这件商品排，策划前不能生成；只有没有可用的文本模型时才按品类默认的清单出。
    // 单张图可以直接出，也可以先策划。
    const planScreens = scope === "single" ? singles.length * Math.max(1, Math.min(4, brief.count)) : scopeMeta?.screens || STUDIO_DETAIL_PLAN_LIMITS.screens;
    const planUnit = scopeMeta?.unit || "张";
    const planMissing = (scope === "detail" || scope === "main") && !activePlan && Boolean(text.value);
    const planField = scope ? STUDIO_PLAN_FIELD[scope] : "detailPlan";
    const planTone = activePlan?.tone ? STUDIO_DESIGN_TONES[activePlan.tone].label : "";
    // 明确不收图的文本模型识别不了商品：「AI 分析并策划」跳过识别，直接按表单和档案的文字策划。
    const textSeesPhotos = !text.value || modelCapabilityConfigFor(text.config, text.value).text?.references.maxImages !== 0;
    const blocked = !product.photos.length
        ? "先上传商品图"
        : !truthCount
          ? "至少点亮一张商品图的星标，出图以它为外观依据"
          : !image.value
            ? "先选择图片模型"
            : uploading
              ? "图片上传中，请稍候"
              : suiteMissing
                ? "先选择一套模板"
                : planMissing
                  ? `先策划这 ${planScreens} ${planUnit}`
                  : (setKind || (scope === "single" && activePlan)) && !included.length
                    ? "镜头清单里至少留一张"
                    : "";
    const setLabel = brief.outputType === "template-set" ? "模板套图" : setKind === "detail" ? "详情页" : "主图套图";
    // 质感选「按商品推荐」：详情页由策划挑，其他出图类型按品类挑。
    const styleHint =
        product.style !== "auto"
            ? ""
            : activePlan?.styleId
              ? `策划挑了「${studioProductStyle(product, activePlan?.styleId).name}」`
              : scope && text.value
                ? `策划时按这件商品挑，没策划时按品类用「${studioProductStyle(product, activePlan?.styleId).name}」`
                : `按品类用「${studioProductStyle(product, activePlan?.styleId).name}」`;

    const editBrief = (patch: Partial<StudioBrief>) => edit((current) => ({ ...current, brief: { ...current.brief, ...patch } }));
    const pickSet = (id: StudioOutputType) => {
        edit((current) => ({ ...current, brief: pickStudioSetType(current.brief, id) }));
        if (id === "template-set" && !brief.suite) setPickerOpen(true);
    };

    /** 识别商品。quiet 时是「AI 分析并策划」的第一步：不弹替换确认，卖家写过的内容保留。返回是否成功。 */
    const fill = async (quiet = false) => {
        try {
            const result = await runner.fill(ensure(), text.value);
            if (quiet) return true;
            const pending = [result.openQuestions ? `${result.openQuestions} 个问题` : "", result.unsureFacts ? `${result.unsureFacts} 条推断` : ""].filter(Boolean);
            message.success(pending.length ? `已填好，还有${pending.join("、")}，在「商品档案」里核对` : "已按商品图填好");
            if (result.infoKept)
                modal.confirm({
                    title: "用识别出的卖点替换现在的内容？",
                    content: <pre className="es-confirm-pre">{result.info}</pre>,
                    okText: "替换",
                    cancelText: "保留我写的",
                    onOk: () => edit((current) => ({ ...current, sellerNotes: result.info }), { immediate: true }),
                });
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "识别失败，请重试");
            return false;
        }
    };

    const runPlan = async (revise: boolean) => {
        try {
            const result = await runner.plan(ensure(), text.value, { revise });
            const count = result.plan.screens.length;
            const notes = [
                result.dropped ? `${result.dropped} ${planUnit}依据不够没收进来` : "",
                result.ungrounded ? `去掉了 ${result.ungrounded} 处没有出处的数字` : "",
                result.issues.length ? `${result.issues.length} 处用词需要留意` : "",
                result.tacky.length ? `文案里有「${result.tacky.join("」「")}」这类说法，可以在补充调整里要求换掉` : "",
            ].filter(Boolean);
            const summary = `已按这件商品排好 ${count} ${planUnit}${notes.length ? `，${notes.join("，")}` : ""}`;
            // 不足预定张数时如实说明，让用户决定直接出还是重新策划。
            if (count < planScreens) message.warning(`${summary}，比 ${planScreens} ${planUnit}少 ${planScreens - count} ${planUnit}，可以重新策划`);
            else message.success(`${summary}，可以展开修改`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "策划失败，请重试");
        }
    };

    /**
     * AI 分析并策划：还没识别过商品（或要求重新识别）时先识别，再按当前出图类型策划；模板套图只识别。
     * revise 时带上这一版策划和补充调整，让模型按意见改。
     */
    const analyzeAndPlan = async ({ revise = false, reanalyze = false } = {}) => {
        if (!truthCount) return void message.warning("先上传商品图并点亮星标，再分析");
        if (!text.value) return void message.warning("没有可用的文本模型，先到模型设置里添加");
        if (!scope) return void fill();
        if (!textSeesPhotos) {
            if (reanalyze) message.info("这个文本模型看不了图，跳过识别商品，按表单里的信息策划");
        } else if ((reanalyze || !product.dossier) && !(await fill(true))) return;
        await runPlan(revise);
    };
    const planDetail = () => {
        const note = brief.planNote?.trim();
        if (!activePlan) return void analyzeAndPlan();
        // 写了补充调整：按意见改这一版；没写时从头重新策划，先确认会替换改过的内容。
        if (note) return void analyzeAndPlan({ revise: true });
        modal.confirm({ title: "重新策划会替换现在的清单", content: "改过的屏名、画面和文案都会换成新的策划。只想改几处的话，先在「补充调整」里写下要改的地方。", okText: "重新策划", cancelText: "取消", onOk: () => void analyzeAndPlan() });
    };

    const generate = () => {
        if (blocked) return void message.warning(blocked);
        try {
            runner.generate(ensure(), image.value);
            onGenerated();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        }
    };

    // 粘贴图片默认加到商品图；在输入框里粘贴文字不受影响。
    const onPaste = (event: ClipboardEvent<HTMLElement>) => {
        const files = studioImageFiles(event.clipboardData?.files);
        if (!files.length) return;
        event.preventDefault();
        void uploads.addFiles("photos", files);
    };

    const ratioLabel = brief.sameLayout && product.references.length ? "自动（跟参考图）" : "自动（推荐）";

    return (
        <section className="es-form" aria-label="生图表单" onPasteCapture={onPaste}>
            <div className="es-form-scroll">
                <div className="es-uploads">
                    <StudioUploadBox
                        kind="photos"
                        hint="必填 · 出图以它为准"
                        product={product}
                        pending={uploads.pending.photos}
                        onFiles={(files) => void uploads.addFiles("photos", files)}
                        onAssets={(assets) => void uploads.addAssets("photos", assets)}
                        onRemove={(photo) => edit((current) => ({ ...current, photos: current.photos.filter((item) => item.id !== photo.id) }))}
                        onPatch={(photo, patch) => edit((current) => ({ ...current, photos: current.photos.map((item) => (item.id === photo.id ? { ...item, ...patch } : item)) }))}
                    />
                    <StudioUploadBox
                        kind="references"
                        hint="可选 · 风格或版式"
                        product={product}
                        pending={uploads.pending.references}
                        onFiles={(files) => void uploads.addFiles("references", files)}
                        onAssets={(assets) => void uploads.addAssets("references", assets)}
                        onRemove={(photo) => edit((current) => ({ ...current, references: current.references.filter((item) => item.id !== photo.id) }))}
                    />
                </div>

                {suggestion ? (
                    <div className="es-banner">
                        <span>
                            助手给出了
                            {[suggestion.brand ? "品牌" : "", suggestion.productType ? "商品类型" : "", suggestion.points ? `${suggestion.points} 条卖点` : ""].filter(Boolean).join("、")}
                            ，还没填进表单。
                        </span>
                        <Button size="small" onClick={() => edit(applyStudioSuggestion, { immediate: true })}>
                            填入表单
                        </Button>
                    </div>
                ) : null}

                <div className="es-section-head">
                    <h2>商品信息</h2>
                    <span className="es-field-actions">
                        <Tooltip
                            title={!product.photos.length ? "先上传商品图" : scope ? `看商品图识别品牌、类型、标题和卖点（已经写了的不覆盖），再按当前出图类型策划这 ${planScreens} ${planUnit}` : "看商品图，自动填品牌、类型、标题和卖点；已经写了的不覆盖"}
                        >
                            <Button size="small" icon={<ScanSearch size={14} />} loading={filling || planning} disabled={!product.photos.length} onClick={() => void analyzeAndPlan({ reanalyze: true })}>
                                {filling ? "分析商品中…" : planning ? "策划中…" : scope ? "AI 分析并策划" : "AI 分析商品"}
                            </Button>
                        </Tooltip>
                        <FillModelPopover imageCount={product.photos.length} />
                    </span>
                </div>
                <div className="es-grid">
                    <Field label="品牌名" span={3} htmlFor="es-brand">
                        <Input id="es-brand" variant="filled" size="large" value={brief.brand} placeholder="例如：NORDA" maxLength={40} onChange={(event) => editBrief({ brand: event.target.value })} />
                    </Field>
                    <Field label="商品类型" span={3} htmlFor="es-type">
                        <Input id="es-type" variant="filled" size="large" value={brief.productType} placeholder="例如：保温杯" maxLength={40} onChange={(event) => editBrief({ productType: event.target.value })} />
                    </Field>
                    <Field label="核心标题" span={6} htmlFor="es-title">
                        <Input
                            id="es-title"
                            variant="filled"
                            size="large"
                            value={studioTitleOf(product)}
                            placeholder="图上的主标题，例如：12 小时长效保温（可留空）"
                            maxLength={30}
                            onChange={(event) => edit((current) => ({ ...current, copy: { headline: event.target.value, subhead: current.copy?.subhead || "", listingTitle: current.copy?.listingTitle || "", bullets: current.copy?.bullets || [] } }))}
                        />
                    </Field>
                    <Field
                        label="卖点与商品信息"
                        span={6}
                        htmlFor="es-info"
                        hint={
                            issues.length ? (
                                <div className="es-hints">
                                    {issues.slice(0, 3).map((issue, index) => (
                                        <span key={`${issue.term}-${index}`} data-tone="warning">
                                            {issue.field}「{issue.term}」：{issue.reason}
                                        </span>
                                    ))}
                                </div>
                            ) : undefined
                        }
                    >
                        <Input.TextArea
                            id="es-info"
                            variant="filled"
                            value={product.sellerNotes}
                            placeholder={INFO_PLACEHOLDER}
                            autoSize={{ minRows: 4, maxRows: 10 }}
                            maxLength={600}
                            onChange={(event) => edit((current) => ({ ...current, sellerNotes: event.target.value }))}
                        />
                    </Field>
                </div>

                {product.dossier ? <StudioDossierCard key={product.dossier.recognizedAt || "dossier"} dossier={product.dossier} edit={edit} /> : null}
                <div className="es-section-head">
                    <h2>出图设置</h2>
                    <Tooltip title="从后台精选或 1173 套内置模板里挑一套，按模板逐张出图">
                        <Button size="small" icon={<LayoutTemplate size={14} />} onClick={() => setPickerOpen(true)}>
                            套图模板库
                        </Button>
                    </Tooltip>
                </div>
                <div className="es-grid">
                    {/* 单张类型可多选，一次出几种；套图只能单选。换类型时清掉套图的顺序和勾选，已选的模板保留。 */}
                    <div className="es-field" data-span={6}>
                        <div className="es-field-row">
                            <span className="es-field-label" id="es-type-label">
                                出图类型
                            </span>
                            <span className="es-field-hint">单张可以多选，一次出几种</span>
                        </div>
                        <div className="es-type-picker" role="group" aria-labelledby="es-type-label">
                            <div className="es-chips" role="group" aria-label="单张类型，可多选">
                                {STUDIO_SINGLE_TYPES.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="es-chip"
                                        aria-pressed={singles.some((single) => single.id === item.id)}
                                        title={item.hint}
                                        onClick={() => edit((current) => ({ ...current, brief: toggleStudioSingleType(current.brief, item.id) }))}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <div className="es-type-sets" role="group" aria-label="成套出图，单选">
                                <span>成套</span>
                                <div className="es-chips">
                                    {STUDIO_SET_TYPES.map((item) => (
                                        <button key={item.id} type="button" className="es-chip" aria-pressed={brief.outputType === item.id} title={item.hint} onClick={() => pickSet(item.id)}>
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {typeHint ? <div className="es-field-hint">{typeHint}</div> : null}
                    </div>
                    {castRelevant ? <StudioModelCastSection product={product} edit={edit} /> : null}
                    <Field label="视觉方向" span={2}>
                        <Select appearance="field" size="large" value={product.platform} options={PLATFORM_OPTIONS} ariaLabel="视觉方向（平台）" onChange={(value: EcommercePlatformId) => edit((current) => ({ ...current, platform: value }))} />
                    </Field>
                    <Field label="市场" span={2}>
                        <Select
                            appearance="field"
                            size="large"
                            value={brief.market}
                            options={MARKET_OPTIONS}
                            ariaLabel="市场"
                            onChange={(value: StudioMarket) => editBrief({ market: value, language: brief.language === "none" ? "none" : studioMarket(value).language })}
                        />
                    </Field>
                    <Field label="语言" span={2} hint={brief.language !== "none" && adapter.textRendering === "weak" && image.value ? `${adapter.label} 写字不稳定，建议选「不加文字」` : undefined}>
                        <Select appearance="field" size="large" value={brief.language} options={LANGUAGE_OPTIONS} ariaLabel="图上文字的语言" onChange={(value: StudioLanguage) => editBrief({ language: value })} />
                    </Field>
                    <Field label="质感" span={3} hint={styleHint || undefined}>
                        <Select appearance="field" size="large" value={product.style} options={STYLE_OPTIONS} ariaLabel="质感" onChange={(value: StudioStyleId) => edit((current) => ({ ...current, style: value }))} />
                    </Field>
                    <Field label="拍摄方式" span={3}>
                        <Select appearance="field" size="large" value={brief.shooting} options={SHOOTING_OPTIONS} ariaLabel="拍摄方式" onChange={(value: StudioShooting) => editBrief({ shooting: value })} />
                    </Field>
                    <Field label="目标人群" span={3} htmlFor="es-audience">
                        <Input id="es-audience" variant="filled" size="large" value={brief.audience} placeholder="例如：宝妈、上班族、送礼人" maxLength={60} onChange={(event) => editBrief({ audience: event.target.value })} />
                    </Field>
                    <Field label="价格/定位" span={3} htmlFor="es-positioning">
                        <Input id="es-positioning" variant="filled" size="large" value={brief.positioning} placeholder="例如：中高端、性价比、礼盒" maxLength={60} onChange={(event) => editBrief({ positioning: event.target.value })} />
                    </Field>

                    <Field label="生图模型" span={6}>
                        <StudioModelPicker kind="image" imageCount={Math.max(1, referenceCount)} placeholder="选择图片模型" />
                    </Field>
                    <Field label={singles.length > 1 ? "每种数量" : "数量"} span={2}>
                        <Select
                            appearance="field"
                            size="large"
                            value={setKind ? images : brief.count}
                            disabled={Boolean(setKind)}
                            options={setKind ? [{ value: images, label: `${images} ${unit}` }] : STUDIO_COUNT_OPTIONS.map((count) => ({ value: count, label: `${count} 张` }))}
                            ariaLabel="数量"
                            onChange={(value: number) => editBrief({ count: value })}
                        />
                    </Field>
                    <Field label={resolutionOptions.length ? "清晰度 · 质量" : "质量"} span={2}>
                        <span className={resolutionOptions.length ? "es-field-pair" : undefined}>
                            {resolutionOptions.length ? <Select appearance="field" size="large" value={resolution} options={resolutionOptions} ariaLabel="清晰度" onChange={(value: string) => editBrief({ resolution: value })} /> : null}
                            <Select
                                appearance="field"
                                size="large"
                                value={qualityOptions.length ? quality : "default"}
                                disabled={!qualityOptions.length}
                                options={qualityOptions.length ? qualityOptions : [{ value: "default", label: "模型默认" }]}
                                ariaLabel="质量"
                                onChange={(value: string) => editBrief({ quality: value })}
                            />
                        </span>
                    </Field>
                    <Field label="比例" span={2} hint={customRatio ? <CustomRatioNote ratio={brief.ratio} request={studioImageRequest(profile, quality, brief.ratio, resolution)} /> : undefined}>
                        <Select
                            appearance="field"
                            size="large"
                            value={customRatio ? "custom" : brief.ratio === "auto" || ratioOptions.includes(brief.ratio) ? brief.ratio : "auto"}
                            disabled={!ratioOptions.length}
                            options={[{ value: "auto", label: ratioOptions.length ? ratioLabel : "模型决定" }, ...ratioOptions.map((ratio) => ({ value: ratio, label: ratio })), ...(ratioOptions.length ? [{ value: "custom", label: "自定义" }] : [])]}
                            ariaLabel="比例"
                            onChange={(value: string) => {
                                setCustomRatioOpen(value === "custom");
                                if (value !== "custom") editBrief({ ratio: value });
                            }}
                        />
                        {customRatio ? <CustomRatioInput ratio={brief.ratio} onChange={(ratio) => editBrief({ ratio })} /> : null}
                    </Field>
                    <Field label="补充要求" span={6} htmlFor="es-extra">
                        <Input id="es-extra" variant="filled" size="large" value={brief.extra} placeholder="例如：白底、强质感、不要多余文字、保留商品结构" maxLength={300} onChange={(event) => editBrief({ extra: event.target.value })} />
                    </Field>
                    <div className="es-field" data-span={6}>
                        <Tooltip title={product.references.length ? "照着参考图的构图、文字位置和配色出图，商品换成你的" : "先上传一张参考图"}>
                            <span className="es-check">
                                <Checkbox checked={brief.sameLayout && product.references.length > 0} disabled={!product.references.length} onChange={(event) => editBrief({ sameLayout: event.target.checked })}>
                                    一键同款参考图版式
                                </Checkbox>
                            </span>
                        </Tooltip>
                    </div>
                </div>

                {setKind || scope ? (
                    <>
                        <div className="es-section-head">
                            <h2>{setKind ? "镜头清单" : "出图策划"}</h2>
                            <span className="es-section-note">
                                {planMissing || (!setKind && !activePlan) ? `策划好后可以逐${planUnit}修改、勾掉这次不出的、调整顺序` : `已选 ${included.length}/${entries.length} ${setKind ? unit : "张"} · 勾掉这次不出的，箭头调整顺序`}
                            </span>
                        </div>
                        {brief.outputType === "template-set" ? (
                            <div className="es-suite-card" data-empty={brief.suite ? undefined : true}>
                                <span className="es-suite-card-text">
                                    <strong>{brief.suite ? brief.suite.name : "还没选模板"}</strong>
                                    <span>
                                        {brief.suite
                                            ? [brief.suite.source === "admin" ? "后台精选" : "内置模板库", brief.suite.kind === "main" ? "按主图出" : "按详情页出", brief.suite.category].filter(Boolean).join(" · ")
                                            : "从后台精选或内置模板库挑一套，按模板逐张出图。"}
                                    </span>
                                </span>
                                <Button icon={<LayoutTemplate size={14} />} onClick={() => setPickerOpen(true)}>
                                    {brief.suite ? "换一套" : "选择模板"}
                                </Button>
                            </div>
                        ) : null}
                        {scope ? (
                            <div className="es-suite-card es-plan-card" data-empty={planMissing ? true : undefined} data-planned={activePlan ? true : undefined}>
                                <span className="es-suite-card-text">
                                    <strong>
                                        {activePlan
                                            ? `已按这件商品策划 ${activePlan.screens.length} ${planUnit}${planTone ? ` · ${planTone}` : ""}`
                                            : !text.value
                                              ? scope === "single"
                                                  ? "没有可用的文本模型，按出图类型直接出"
                                                  : `按品类默认的 ${entries.length} ${planUnit}`
                                              : scope === "single"
                                                ? `可以先让 AI 策划这 ${planScreens} 张`
                                                : `先策划这 ${planScreens} ${planUnit}`}
                                    </strong>
                                    <span>
                                        {activePlan
                                            ? activePlan.summary || `每一${planUnit}的画面和文案按这件商品写好，点笔形按钮可以修改。`
                                            : text.value
                                              ? `AI 先分析商品图和卖点，再参考电商知识库挑设计调性，定每一${planUnit}讲什么、怎么排版、怎么拍、文案怎么写；排好后可以逐${planUnit}修改再生成${scope === "single" ? "。不策划也可以直接生成" : ""}。`
                                              : "添加文本模型后可以按商品策划。"}
                                    </span>
                                </span>
                                {text.value ? (
                                    <span className="es-plan-card-actions">
                                        <Button type={activePlan ? "default" : "primary"} icon={<ListChecks size={14} />} loading={planning || filling} disabled={!product.photos.length} onClick={planDetail}>
                                            {filling
                                                ? "分析商品中…"
                                                : planning
                                                  ? "策划中…"
                                                  : activePlan
                                                    ? brief.planNote?.trim()
                                                        ? "按补充调整重新策划"
                                                        : "重新策划"
                                                    : product.dossier || !textSeesPhotos
                                                      ? `AI 策划 ${planScreens} ${planUnit}`
                                                      : "AI 分析并策划"}
                                        </Button>
                                        <FillModelPopover imageCount={Math.min(2, truthCount)} purpose="策划" />
                                    </span>
                                ) : null}
                                {text.value ? (
                                    <label className="es-plan-note">
                                        <span>补充调整（写给 AI 策划，每次策划都会带上）</span>
                                        <Input.TextArea
                                            variant="filled"
                                            autoSize={{ minRows: 1, maxRows: 4 }}
                                            maxLength={STUDIO_PLAN_NOTE_MAX}
                                            value={brief.planNote || ""}
                                            placeholder="例如：做成苹果官网那种极简高级感；多放生活场景，少放参数；标题更有画面感，别用口号"
                                            onChange={(event) => editBrief({ planNote: event.target.value })}
                                        />
                                    </label>
                                ) : null}
                            </div>
                        ) : null}
                        {entries.length && !planMissing ? (
                            <StudioShotList
                                entries={entries}
                                unit={setKind ? unit : "张"}
                                onToggle={(key) => edit((current) => ({ ...current, brief: toggleStudioSetEntry(current, key) }))}
                                onMove={(key, delta) => edit((current) => ({ ...current, brief: moveStudioSetEntry(current, key, delta) }))}
                                {...(activePlan ? { onEditPlan: (index: number, patch: StudioPlannedScreenPatch) => edit((current) => ({ ...current, brief: patchStudioDetailPlanScreen(current.brief, index, patch, planField) })) } : {})}
                            />
                        ) : null}
                    </>
                ) : null}
            </div>
            <StudioSuitePicker
                open={pickerOpen}
                query={brief.productType.trim() || product.dossier?.category.trim() || ""}
                onClose={() => setPickerOpen(false)}
                onPick={(suite) => {
                    edit((current) => ({ ...current, brief: { ...current.brief, outputType: "template-set", suite, shotOrder: [], shotSkip: [] } }), { immediate: true });
                    setPickerOpen(false);
                    message.success(`已选「${suite.name}」，共 ${suite.shots.length} 张`);
                }}
            />
            <footer className="es-form-foot">
                <span className="es-estimate">{estimate}</span>
                <Button size="large" icon={<RotateCcw size={15} />} onClick={() => edit((current) => ({ ...current, brief: resetStudioBriefParameters(current.brief) }))}>
                    重置参数
                </Button>
                <Tooltip title={blocked || undefined}>
                    <Button type="primary" size="large" className="es-generate" disabled={Boolean(blocked)} onClick={generate}>
                        {setKind
                            ? `生成${setLabel}${images ? `（${images} ${unit}）` : ""}`
                            : activePlan
                              ? `按策划生成 ${images} 张`
                              : singles.length > 1
                                ? `生成 ${singles.length} 种共 ${images} 张`
                                : brief.count > 1
                                  ? `生成 ${brief.count} 张商品图`
                                  : "生成商品图"}
                    </Button>
                </Tooltip>
            </footer>
        </section>
    );
}
