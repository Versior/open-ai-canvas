import { App, Button, Input, Popover, Tooltip } from "antd";
import { ChevronDown, LayoutTemplate, RotateCcw, ScanSearch, Sparkles } from "lucide-react";
import { useMemo, useState, type ClipboardEvent, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Select } from "@/components/ui/base/select";
import { ECOMMERCE_PLATFORMS, ecommercePlatform, type EcommercePlatformId } from "@/lib/ecommerce/ecommerce-platform-specs";
import {
    applyStudioSuggestion,
    pickStudioSetType,
    resetStudioBriefParameters,
    STUDIO_COUNT_OPTIONS,
    STUDIO_LANGUAGES,
    STUDIO_MARKETS,
    STUDIO_SET_TYPES,
    STUDIO_SHOOTINGS,
    STUDIO_SINGLE_TYPES,
    studioMarket,
    studioOutputSpec,
    studioPlatformForbidsText,
    studioRunRatio,
    studioInfoPoints,
    studioSingleTypes,
    studioSuggestion,
    studioTitleOf,
    toggleStudioSingleType,
} from "@/lib/ecommerce-studio/brief";
import { studioCopyIssues } from "@/lib/ecommerce-studio/dossier-tasks";
import { studioEffectiveQuality, studioQualityOptions, studioRatioOptions } from "@/lib/ecommerce-studio/image-options";
import { studioModelAdapter, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { moveStudioSetEntry, studioEntryRatio, studioSetEntries, studioSetKind, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { STUDIO_STYLES } from "@/lib/ecommerce-studio/shot-specs";
import type { StudioBrief, StudioLanguage, StudioMarket, StudioOutputType, StudioProduct, StudioShooting, StudioStyleId } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { StudioDossierCard } from "./studio-dossier";
import { StudioModelCastSection } from "./studio-model-cast";
import { StudioModelPicker, useStudioModel } from "./studio-parts";
import { StudioShotList } from "./studio-shot-list";
import { StudioSuitePicker } from "./studio-suite-picker";
import { StudioUploadBox, useStudioUploads } from "./studio-uploads";
import { studioImageFiles } from "./studio-upload";
import { useStudioEstimate } from "./use-studio-estimate";
import { useStudioAnalysis, type StudioRunner } from "./use-studio-runner";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const PLATFORM_OPTIONS = ECOMMERCE_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name }));
const MARKET_OPTIONS = STUDIO_MARKETS.map((item) => ({ value: item.id, label: item.label }));
const LANGUAGE_OPTIONS = STUDIO_LANGUAGES.map((item) => ({ value: item.id, label: item.label }));
const STYLE_OPTIONS = STUDIO_STYLES.map((style) => ({ value: style.id, label: style.name, title: style.mood }));
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

/** 识别用的文本模型：按钮上直接写着当前模型，点开浮层更换。 */
function FillModelPopover({ imageCount }: { imageCount: number }) {
    const { config, models, value } = useStudioModel("text");
    const label = value ? configuredModelDisplayName(config, value) : models.length ? "选择识别模型" : "没有可用的文本模型";
    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            rootClassName="es-portal"
            content={
                <div className="es-popover">
                    <span className="es-popover-title">识别用的模型</span>
                    <StudioModelPicker kind="text" imageCount={Math.max(1, imageCount)} placeholder="选择能看图的文本模型" />
                    <span className="es-popover-note">需要能看图的文本模型，按模型计费。</span>
                </div>
            }
        >
            <button type="button" className="es-model-chip" aria-label={`识别用的模型：${label}，点击更换`} title="识别用的模型，点击更换">
                <span className="es-model-chip-label">识别模型</span>
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
    const brief = product.brief;
    const spec = studioOutputSpec(brief.outputType);
    const profile = image.value ? modelCapabilityConfigFor(image.config, image.value).image : undefined;
    const qualityOptions = useMemo(() => studioQualityOptions(profile), [profile]);
    const quality = studioEffectiveQuality(profile, brief.quality);
    const ratioOptions = useMemo(() => studioRatioOptions(profile, quality), [profile, quality]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const setKind = studioSetKind(product);
    const singles = studioSingleTypes(brief);
    const entries = useMemo(() => studioSetEntries(product), [product]);
    const included = entries.filter((entry) => entry.included);
    const unit = setKind === "detail" ? "屏" : "张";
    // 单张类型可以多选，数量是每种出几张。
    const images = setKind ? included.length : singles.length * brief.count;
    const firstEntry = included[0] || entries[0];
    const firstRatio = setKind && firstEntry ? studioEntryRatio(firstEntry, product) : studioRunRatio(singles[0]?.role || "main-selling", product);
    const truthCount = studioReferencePhotos(product.photos, 8).length;
    // 有模特的图才用模特设定：选了模特图、模特拍法，或者套图清单里有上身效果。
    const castRelevant = singles.some((item) => item.id === "model") || brief.shooting === "model" || entries.some((entry) => entry.included && entry.role === "detail-model");
    const castReferences = castRelevant ? [brief.model?.face, brief.model?.pose].filter((pick) => pick?.resourceId).length : 0;
    const referenceCount = Math.min(profile?.references.maxImages || 4, truthCount + castReferences + product.references.length);
    const estimate = useStudioEstimate({ model: image.value, images, references: referenceCount, quality, ratio: firstRatio });
    const suggestion = studioSuggestion(product);
    const issues = useMemo(() => studioCopyIssues(studioInfoPoints(product.sellerNotes), { headline: studioTitleOf(product), subhead: "", listingTitle: "", bullets: [] }), [product]);
    const adapter = studioModelAdapter(image.value);
    const platform = ecommercePlatform(product.platform);
    const noTextOnMain = singles.some((item) => item.role && studioPlatformForbidsText(product, item.role));
    const noTextNote = noTextOnMain ? `${platform?.name || "这个平台"}首图不加文字，标题不会写进图里` : "";
    const typeHint = singles.length > 1 ? [`${singles.map((item) => item.label).join("、")}，每种 ${brief.count} 张，共 ${images} 张`, noTextNote].filter(Boolean).join("；") : noTextNote || spec.hint;
    const uploading = uploads.pending.photos + uploads.pending.references > 0;
    const suiteMissing = brief.outputType === "template-set" && !brief.suite;
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
                : setKind && !included.length
                  ? "镜头清单里至少留一张"
                  : "";
    const setLabel = brief.outputType === "template-set" ? "模板套图" : setKind === "detail" ? "详情页" : "主图套图";

    const editBrief = (patch: Partial<StudioBrief>) => edit((current) => ({ ...current, brief: { ...current.brief, ...patch } }));
    const pickSet = (id: StudioOutputType) => {
        edit((current) => ({ ...current, brief: pickStudioSetType(current.brief, id) }));
        if (id === "template-set" && !brief.suite) setPickerOpen(true);
    };

    const fill = async () => {
        if (!product.photos.length) return void message.warning("先上传商品图，再识别");
        if (!text.value) return void message.warning("没有可用的文本模型，先到模型设置里添加");
        try {
            const result = await runner.fill(ensure(), text.value);
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
        } catch (error) {
            message.error(error instanceof Error ? error.message : "识别失败，请重试");
        }
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
                        <Tooltip title={product.photos.length ? "看商品图，自动填品牌、类型、标题和卖点；已经写了的不覆盖" : "先上传商品图"}>
                            <Button size="small" icon={<ScanSearch size={14} />} loading={filling} disabled={!product.photos.length} onClick={() => void fill()}>
                                {filling ? "识别中…" : "识别商品自动填写"}
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
                    <Field label="质感" span={3}>
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
                    <Field label="质量" span={2}>
                        <Select
                            appearance="field"
                            size="large"
                            value={qualityOptions.length ? quality : "default"}
                            disabled={!qualityOptions.length}
                            options={qualityOptions.length ? qualityOptions : [{ value: "default", label: "模型默认" }]}
                            ariaLabel="质量"
                            onChange={(value: string) => editBrief({ quality: value })}
                        />
                    </Field>
                    <Field label="比例" span={2}>
                        <Select
                            appearance="field"
                            size="large"
                            value={brief.ratio === "auto" || ratioOptions.includes(brief.ratio) ? brief.ratio : "auto"}
                            disabled={!ratioOptions.length}
                            options={[{ value: "auto", label: ratioOptions.length ? ratioLabel : "模型决定" }, ...ratioOptions.map((ratio) => ({ value: ratio, label: ratio }))]}
                            ariaLabel="比例"
                            onChange={(value: string) => editBrief({ ratio: value })}
                        />
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

                {setKind ? (
                    <>
                        <div className="es-section-head">
                            <h2>镜头清单</h2>
                            <span className="es-section-note">
                                已选 {included.length}/{entries.length} {unit} · 勾掉这次不出的，箭头调整顺序
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
                        {entries.length ? (
                            <StudioShotList
                                entries={entries}
                                unit={unit}
                                onToggle={(key) => edit((current) => ({ ...current, brief: toggleStudioSetEntry(current, key) }))}
                                onMove={(key, delta) => edit((current) => ({ ...current, brief: moveStudioSetEntry(current, key, delta) }))}
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
                    <Button type="primary" size="large" className="es-generate" icon={<Sparkles size={16} />} disabled={Boolean(blocked)} onClick={generate}>
                        {setKind ? `生成${setLabel}${images ? `（${images} ${unit}）` : ""}` : singles.length > 1 ? `生成 ${singles.length} 种共 ${images} 张` : brief.count > 1 ? `生成 ${brief.count} 张商品图` : "生成商品图"}
                    </Button>
                </Tooltip>
            </footer>
        </section>
    );
}
