import { App, Button, Input, Popover, Tooltip } from "antd";
import { useRequireLogin } from "@/hooks/use-require-login";
import { useUserStore } from "@/stores/use-user-store";
import { ArrowRight, Check, ChevronDown, Images, LayoutTemplate, ListChecks, RotateCcw, Rows3, ScanSearch } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type ReactNode } from "react";
import { studioPromptOverridesRevision, subscribeStudioPromptOverrides } from "@/lib/ecommerce-studio/prompt-overrides";
import { studioImageInput, studioImageReferenceSummary, studioLocateRunShot, type StudioImageReferenceSummary } from "@/lib/ecommerce-studio/generation-input";
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
    studioRunRatio,
    studioRatioValid,
    studioInfoPoints,
    studioSingleTypes,
    studioSuggestion,
    studioTitleOf,
    toggleStudioSingleType,
} from "@/lib/ecommerce-studio/brief";
import { studioCopyIssues } from "@/lib/ecommerce-studio/dossier-tasks";
import { studioClaimSources } from "@/lib/ecommerce-studio/claim-evidence";
import { studioEffectiveQuality, studioEffectiveResolution, studioImageRequest, studioQualityOptions, studioRatioOptions, studioResolutionOptions, type StudioImageRequest } from "@/lib/ecommerce-studio/image-options";
import { studioModelAdapter, studioReferencePhotos } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioPlanningImages } from "@/lib/ecommerce-studio/reference-selection";
import { studioChangeStyle } from "@/lib/ecommerce-studio/product";
import { patchStudioDetailPlanScreen, STUDIO_DETAIL_PLAN_LIMITS, STUDIO_DETAIL_SCREEN_OPTIONS, studioDetailScreenCount, studioScreenCopyIssue, STUDIO_PLAN_FIELD, STUDIO_PLAN_SCOPES } from "@/lib/ecommerce-studio/detail-plan";
import { studioPickedDirection } from "@/lib/ecommerce-studio/plan-prep";
import { createStudioRun, moveStudioSetEntry, studioActivePlan, studioEntryRatio, studioPlanScopeOf, studioRevisionPlan, studioSetEntries, studioSetKind, toggleStudioSetEntry } from "@/lib/ecommerce-studio/runs";
import { previewStudioDetailGeometry } from "@/lib/ecommerce-studio/delivery-geometry";
import { studioSuiteUse } from "@/lib/ecommerce-studio/suites";
import { studioPlanInputSignature } from "@/lib/ecommerce-studio/plan-input";
import { STUDIO_STYLES } from "@/lib/ecommerce-studio/shot-specs";
import type { StudioBrief, StudioLanguage, StudioMarket, StudioOutputType, StudioProduct, StudioShooting, StudioStyleId } from "@/lib/ecommerce-studio/types";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { StudioDossierCard } from "./studio-dossier";
import { StudioModelCastSection } from "./studio-model-cast";
import { StudioModelPicker, useStudioModel } from "./studio-parts";
import { StudioPlanPrepPanel, studioPrepStep } from "./studio-plan-prep";
import { StudioPlanDirectionCard } from "./studio-plan-direction";
import { StudioPlanPreview } from "./studio-plan-preview";
import { StudioPlanReceiptPanel } from "./studio-plan-receipt";
import { StudioPlanProgressPanel } from "./studio-plan-progress";
import { StudioShotList, type StudioPlannedScreenPatch } from "./studio-shot-list";
import { StudioSuitePicker } from "./studio-suite-picker";
import { StudioUploadBox, useStudioUploads } from "./studio-uploads";
import { studioImageFiles } from "./studio-upload";
import { useStudioStore } from "./use-studio-store";
import { useStudioEstimate, useStudioTextEstimate } from "./use-studio-estimate";
import { commerceReferenceViewCount } from "@/pages/ecommerce/reference-plan";
import { useStudioAnalysis, type StudioRunner } from "./use-studio-runner";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

const PLATFORM_OPTIONS = ECOMMERCE_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name }));
const MARKET_OPTIONS = STUDIO_MARKETS.map((item) => ({ value: item.id, label: item.label }));
const LANGUAGE_OPTIONS = STUDIO_LANGUAGES.map((item) => ({ value: item.id, label: item.label }));
const STYLE_OPTIONS = [{ value: "auto", label: "由图片模型设计" }, ...STUDIO_STYLES.map((style) => ({ value: style.id, label: style.name, title: style.mood }))];
const SHOOTING_OPTIONS = STUDIO_SHOOTINGS.map((item) => ({ value: item.id, label: item.label }));
const INFO_PLACEHOLDER = "每行一条卖点或商品信息，例如：\n316 不锈钢内胆：长效保温 12 小时\n一键弹盖，单手就能打开\n容量 500ml，重约 280g";
const SINGLE_TYPE_GROUPS = [
    { id: "listing", label: "商品展示", types: ["main", "white", "scene", "selling", "closeup", "angles"] },
    { id: "story", label: "场景与营销", types: ["model", "poster", "campaign", "seeding", "ugc", "collocation", "flatlay"] },
    { id: "info", label: "选购与使用", types: ["compare", "steps", "size", "spec", "package"] },
] as const;

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

export function StudioForm({
    product,
    edit,
    ensure,
    runner,
    onOutputChange,
    onPlanning,
    onGenerated,
}: {
    product: StudioProduct;
    edit: Edit;
    ensure: () => string;
    runner: StudioRunner;
    onOutputChange: () => void;
    onPlanning: () => void;
    onGenerated: () => void;
}) {
    const requireLogin = useRequireLogin();
    const user = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const image = useStudioModel("image");
    const text = useStudioModel("text");
    const uploads = useStudioUploads(ensure);
    const running = useStudioAnalysis((state) => state.running[product.id]);
    const saveFailed = useStudioStore((state) => state.saveStates[product.id] === "error");
    const filling = running === "fill";
    const planning = running === "plan";
    const asking = running === "ask";
    const directing = running === "directions";
    const brief = product.brief;
    // 当前出图类型的策划：详情页、主图套图、单张图和模板套图各有一份；模板套图要先选模板。
    const scope = studioPlanScopeOf(product);
    const activePlan = studioActivePlan(product);
    const scopeMeta = scope ? STUDIO_PLAN_SCOPES[scope] : undefined;
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
    const [expandedPlanId, setExpandedPlanId] = useState<string>();
    const planScroll = useRef<HTMLDivElement>(null);
    const generating = useRef(false);
    const [starting, setStarting] = useState(false);
    const setKind = studioSetKind(product);
    const singles = studioSingleTypes(brief);
    const entries = useMemo(() => studioSetEntries(product), [product]);
    const planSignature = useMemo(() => studioPlanInputSignature(product), [product]);
    const claimSources = useMemo(() => (activePlan || scope === "detail" ? studioClaimSources(product) : []), [activePlan, product, scope]);
    const included = entries.filter((entry) => entry.included);
    const unit = setKind === "detail" ? "屏" : "张";
    // 单张类型可以多选，数量是每种出几张；单张图策划过时按策划清单里勾选的张数。
    const images = scope === "detail" && !activePlan ? studioDetailScreenCount(brief) : setKind || (scope === "single" && activePlan) ? included.length : singles.length * brief.count;
    const truthCount = studioReferencePhotos(product.photos, 8).length;
    // 有模特的图才用模特设定：选了模特图、模特拍法，或者套图清单里有上身效果。
    const castRelevant = singles.some((item) => item.id === "model") || brief.shooting === "model" || entries.some((entry) => entry.included && entry.role === "detail-model");
    const castReferences = castRelevant ? [brief.model?.figure ?? brief.model?.face, brief.model?.pose].filter((pick) => pick?.resourceId).length : 0;
    const referenceCount = Math.min(profile?.references.maxImages || 4, truthCount + castReferences + product.references.length);
    const promptRevision = useSyncExternalStore(subscribeStudioPromptOverrides, studioPromptOverridesRevision);
    const estimateSpec = useMemo(() => {
        const inputs: ReturnType<typeof studioImageInput>[] = [];
        if (!image.value || !product.photos.length) return { inputs, complete: false };
        try {
            let index = 0;
            const run = createStudioRun(product, () => `estimate-${++index}`);
            for (const [index] of run.shots.entries()) inputs.push(studioImageInput(product, studioLocateRunShot(run, index), image.value, image.config));
            return { inputs, complete: true };
        } catch {
            return { inputs: inputs.slice(0, 1), complete: false };
        }
    }, [product, image.value, image.config, promptRevision]);
    const referenceSummary = useMemo<StudioImageReferenceSummary | undefined>(() => {
        const first = estimateSpec.inputs[0];
        return first ? studioImageReferenceSummary(first) : undefined;
    }, [estimateSpec.inputs]);
    const referenceSummaryVaries = useMemo(() => {
        if (estimateSpec.inputs.length < 2) return false;
        const first = studioImageReferenceSummary(estimateSpec.inputs[0]);
        return estimateSpec.inputs.slice(1).some((input) => studioImageReferenceSummary(input).total !== first.total);
    }, [estimateSpec.inputs]);
    const estimate = useStudioEstimate({ model: image.value, inputs: estimateSpec.inputs });
    const suggestion = studioSuggestion(product);
    const issues = useMemo(() => studioCopyIssues(studioInfoPoints(product.sellerNotes), { headline: studioTitleOf(product), subhead: "", listingTitle: "", bullets: [] }), [product]);
    const adapter = studioModelAdapter(image.value);
    const platform = ecommercePlatform(product.platform);
    const uploading = uploads.pending.photos + uploads.pending.references > 0;
    const suiteMissing = brief.outputType === "template-set" && !brief.suite;
    // 详情页必须先按用户选定屏数策划；主图套图没有可用文本模型时仍可按品类清单出。
    // 单张图和模板套图可以直接出，也可以先策划；模板套图按模板的张数策划。
    const requestedPlanScreens =
        scope === "detail" ? studioDetailScreenCount(brief) : scope === "single" ? singles.length * Math.max(1, Math.min(4, brief.count)) : scope === "template" ? brief.suite?.shots.length || 0 : scopeMeta?.screens || STUDIO_DETAIL_PLAN_LIMITS.screens;
    // 用户选定的屏数是策划与出图契约；资料容量只做提醒，不得静默把 6 屏改成 4 屏。
    const planScreens = requestedPlanScreens;
    const planUnit = scope === "template" ? unit : scopeMeta?.unit || "张";
    const geometry =
        setKind === "detail" && (included.length || scope === "detail")
            ? previewStudioDetailGeometry(
                  product.platform,
                  entries.length
                      ? included.map((entry, index) => ({ title: entry.title, ratio: estimateSpec.inputs[index]?.request.aspectRatio || studioEntryRatio(entry, product) }))
                      : Array.from({ length: planScreens }, () => ({ ratio: studioRunRatio("detail-hero", product) })),
              )
            : undefined;
    const planMissing = !activePlan && (scope === "detail" || (scope === "main" && Boolean(text.value)));
    const planningAvailable = Boolean(scope && !activePlan && text.value);
    const detailNeedsPlan = !activePlan && (scope === "detail" || (setKind === "detail" && planningAvailable));
    const planBeforeGenerate = planningAvailable && !detailNeedsPlan;
    const planField = scope ? STUDIO_PLAN_FIELD[scope] : "detailPlan";
    const storedPlan = studioRevisionPlan(product);
    const planOutdated = !activePlan && Boolean(storedPlan || (scope === "detail" && brief.detailPlan));
    const planCapacity = modelCapabilityConfigFor(text.config, text.value).text?.references.maxImages ?? 2;
    const planningImages = studioPlanningImages(product, planCapacity);
    // 明确不收图的文本模型识别不了商品：「AI 分析并策划」跳过识别，直接按表单和档案的文字策划。
    const textSeesPhotos = !text.value || modelCapabilityConfigFor(text.config, text.value).text?.references.maxImages !== 0;
    const analysisBlock = !product.photos.length ? "先上传商品图，再分析或策划" : !truthCount ? "请点亮至少一张非吊牌商品图的星标，再分析或策划" : !text.value ? "请先选择文本模型" : "";
    const planningBlock = uploading ? "图片上传中，请稍候" : analysisBlock;
    const canTryFirst = Boolean(images > 1 && activePlan && (scope === "detail" || scope === "template"));
    const copyChecks = included.map((entry) => ({
        entry,
        issue: brief.language !== "none" && entry.copySource === "user" && entry.copy ? studioScreenCopyIssue({ ...entry.copy, role: entry.role, eyebrow: entry.eyebrow, noText: entry.noText, copySource: entry.copySource }) : undefined,
    }));
    const copyProblem = copyChecks.find((item) => item.issue);
    const setupBlock = !product.photos.length
        ? "先上传商品图"
        : !truthCount
          ? "至少点亮一张商品图的星标，出图以它为外观依据"
          : !image.value
            ? "先选择图片模型"
            : uploading
              ? "图片上传中，请稍候"
              : suiteMissing
                ? "先选择一套模板"
                : scope === "detail" && !activePlan && !text.value
                  ? "请选择策划模型"
                  : !planningAvailable && (setKind || (scope === "single" && activePlan)) && !included.length
                    ? "页面清单里至少留一张"
                    : "";
    const copyBlock = copyProblem ? `${copyProblem.entry.title}：${copyProblem.issue}` : "";
    const blocked = setupBlock || copyBlock;
    const firstBlocked = setupBlock || (copyProblem && copyProblem.entry === included[0] ? copyBlock : "");
    const primaryBlock = detailNeedsPlan ? planningBlock : blocked;
    const setLabel = brief.outputType === "template-set" ? "模板套图" : setKind === "detail" ? "详情页" : "主图套图";

    const editBrief = (patch: Partial<StudioBrief>) => edit((current) => ({ ...current, brief: { ...current.brief, ...patch } }));
    const pickOutput = (pick: (brief: StudioBrief) => StudioBrief) => {
        if (pick(brief) === brief) return;
        edit((current) => ({ ...current, brief: pick(current.brief) }));
        onOutputChange();
    };
    const pickSet = (id: StudioOutputType) => {
        pickOutput((current) => pickStudioSetType(current, id));
        if (id === "template-set" && !brief.suite) setPickerOpen(true);
    };

    /** quiet 时是「AI 分析并策划」的第一步，只提示档案之外仍需要补充的情况。 */
    const fill = async (quiet = false) => {
        if (!requireLogin()) return false;
        try {
            const result = await runner.fill(ensure(), text.value);
            if (quiet) return true;
            const pending = [result.openQuestions ? `${result.openQuestions} 个问题` : "", result.unsureFacts ? `${result.unsureFacts} 条推断` : ""].filter(Boolean);
            message.success(pending.length ? `商品档案已更新，还有${pending.join("、")}待补充` : "商品档案已更新，原有卖家资料未修改");
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "识别失败，请重试");
            return false;
        }
    };

    /** 策划一次，返回是否成功；失败时已经提示过原因。 */
    const runPlan = async (revise: boolean, recheck = false) => {
        if (!requireLogin()) return false;
        if (planScroll.current) planScroll.current.scrollTop = 0;
        const previousReceipt = useStudioStore.getState().products.find(({ id }) => id === product.id)?.planReceipt;
        try {
            const result = await runner.plan(ensure(), text.value, { revise, recheck });
            const count = result.plan.screens.length;
            const notes = [
                result.diagnostics && result.diagnostics.missingEvidence.length ? `按选择完成 ${result.diagnostics.requestedScreens} ${planUnit}，资料缺口：${result.diagnostics.missingEvidence.slice(0, 3).join("、")}` : "",
                result.dropped ? `${result.dropped} ${planUnit}超出请求，已忽略` : "",
                result.ungrounded ? `去掉了 ${result.ungrounded} 处没有出处的数字` : "",
                result.issues.length ? `${result.issues.length} 处用词需要留意` : "",
                result.warnings.length ? `${result.warnings.length} 项生成提示，见最近页面设计结果` : "",
                result.tacky.length ? `文案里有「${result.tacky.join("」「")}」这类说法，可以在补充调整里要求换掉` : "",
            ].filter(Boolean);
            const summary = `已按这件商品排好 ${count} ${planUnit}${notes.length ? `，${notes.join("，")}` : ""}`;
            // 不足预定张数时如实说明，让用户决定直接出还是重新策划。
            if (count < planScreens) message.warning(`${summary}，比 ${planScreens} ${planUnit}少 ${planScreens - count} ${planUnit}，可以重新策划`);
            else message.success(`${summary}，可以展开修改`);
            return true;
        } catch (error) {
            const reason = error instanceof Error ? error.message : "策划失败，请重试";
            const receipt = useStudioStore.getState().products.find(({ id }) => id === product.id)?.planReceipt;
            if (!receipt || receipt === previousReceipt || receipt.message !== reason) message.error(reason);
            return false;
        }
    };

    /** 策划类操作的前置检查：要有星标商品图和文本模型；还没识别过商品时先识别（文本模型看不了图时跳过）。 */
    const prepare = async (reanalyze = false): Promise<boolean> => {
        if (!requireLogin()) return false;
        if (!truthCount) return (void message.warning("先上传商品图并点亮星标，再分析"), false);
        if (!text.value) return (void message.warning("没有可用的文本模型，先到模型设置里添加"), false);
        if (!textSeesPhotos) {
            if (reanalyze) message.info("这个文本模型看不了图，跳过识别商品，按表单里的信息策划");
            return true;
        }
        return reanalyze || !product.dossier ? fill(true) : true;
    };

    /** 还没识别过就先识别，再按当前出图类型策划。revise 时带上这一版策划和补充调整，让模型按意见改。 */
    const analyzeAndPlan = async ({ revise = false } = {}): Promise<boolean> => {
        if (!scope) return fill();
        onPlanning();
        if (planScroll.current) planScroll.current.scrollTop = 0;
        if (!(await prepare())) return false;
        return runPlan(revise);
    };

    /** 可选的补充问题，不阻塞页面设计或出图。 */
    const runAsk = async (quiet = false) => {
        try {
            const asks = await runner.ask(ensure(), text.value);
            message.success(`${quiet ? "识别好了，" : ""}问了 ${asks.length} 个问题，点选答案就行，答得越多策划越准`);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成问题失败，请重试");
            return false;
        }
    };

    const runDirections = async () => {
        if (!(await prepare())) return;
        try {
            const items = await runner.directions(ensure(), text.value);
            message.success(`给了 ${items.length} 个设计方向，挑一个再继续页面设计`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成设计方向失败，请重试");
        }
    };

    /** 顶部的「AI 分析商品」只负责识别商品；补充问题和设计方向是可选上下文。 */
    const analyzeProduct = async () => {
        if (!scope || !text.value) return void fill();
        if (!(await prepare(true))) return;
        message.success("商品已识别；补充问题和设计方向可选，不影响页面设计或出图");
    };
    const planDetail = () => {
        if (!requireLogin()) return;
        const note = brief.planNote?.trim();
        if (note && storedPlan) return void analyzeAndPlan({ revise: true });
        if (!activePlan) return void analyzeAndPlan();
        // 写了补充调整：按意见改这一版；没写时从头重新策划，先确认会替换改过的内容。
        if (note) return void analyzeAndPlan({ revise: true });
        modal.confirm({ title: "重新策划会替换现在的清单", content: "改过的屏名、画面和文案都会换成新的策划。只想改几处的话，先在「补充调整」里写下要改的地方。", okText: "重新策划", cancelText: "取消", onOk: () => void analyzeAndPlan() });
    };

    const needsRecognition = planningAvailable && !product.dossier && textSeesPhotos;
    const fillCount = Math.min(product.photos.length, modelCapabilityConfigFor(text.config, text.value).text?.references.maxImages || product.photos.length);
    const recognitionQuote = useStudioTextEstimate(text.value, needsRecognition ? fillCount : null);
    let planInputCount: number | null = planningImages.images.length;
    for (const ref of planningImages.references) {
        if (planInputCount >= planCapacity) break;
        if (!ref.width || !ref.height) {
            planInputCount = null;
            break;
        }
        try {
            planInputCount = Math.min(planCapacity, planInputCount + commerceReferenceViewCount(ref.width, ref.height));
        } catch {
            planInputCount = null;
            break;
        }
    }
    const planQuote = useStudioTextEstimate(text.value, planningAvailable ? planInputCount : null);
    const planEstimate = planningAvailable && (planQuote || recognitionQuote || (!detailNeedsPlan && estimate.all)) ? `${needsRecognition ? `识别：${recognitionQuote || "待报价"}；` : ""}策划：${planQuote || "待报价"}` : "";
    const imageEstimate =
        (!detailNeedsPlan || scope === "template") && estimate.all
            ? `${canTryFirst && estimate.first ? `首屏：${estimate.first}；` : ""}${detailNeedsPlan ? "按模板直接出图" : "出图"} ×${images}：${estimateSpec.complete ? estimate.all : "按实际出图规格计费"}`
            : "";
    const generate = async ({ direct = false, firstOnly = false } = {}) => {
        if (!requireLogin()) return;
        const reason = firstOnly ? firstBlocked : blocked;
        if (reason) return void message.warning(reason);
        if (generating.current) return;
        generating.current = true;
        setStarting(true);
        try {
            if (planBeforeGenerate && !direct && !(await analyzeAndPlan())) return;
            await runner.generate(ensure(), image.value, { firstOnly, confirmedPlanId: setKind === "detail" ? activePlan?.id : undefined });
            onGenerated();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成失败");
        } finally {
            generating.current = false;
            setStarting(false);
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

    // 策划前的补充信息和设计方向方案：答过的和挑中的方向会带进每一次策划。
    const prepStep = studioPrepStep(brief.prep);
    const pickedDirection = studioPickedDirection(brief.prep);
    const prepPanel = (
        <StudioPlanPrepPanel
            product={product}
            edit={edit}
            asking={asking}
            directing={directing}
            disabled={Boolean(user) && (Boolean(analysisBlock) || Boolean(running && running !== "ask" && running !== "directions"))}
            onAsk={async () => {
                if (await prepare()) await runAsk();
            }}
            onDirections={() => void runDirections()}
        />
    );
    const receipt = product.planReceipt;
    const showReceiptFirst = Boolean(receipt && (saveFailed || (receipt.state !== "accepted" && (receipt.state !== "submitted" || !running))));
    const planReceipt = receipt ? (
        <div className="es-plan-receipt" data-priority={showReceiptFirst || undefined}>
            <StudioPlanReceiptPanel
                productId={product.id}
                receipt={receipt}
                current={scope === receipt.scope && receipt.inputSignature === planSignature}
                busy={Boolean(running)}
                onRecheck={() => void runPlan(false, true)}
                onRetry={() => void runPlan(false)}
            />
        </div>
    ) : null;

    return (
        <>
            <section className="es-form" aria-labelledby="es-input-heading" onPasteCapture={onPaste}>
                <header className="es-workspace-head">
                    <h2 id="es-input-heading">商品与设置</h2>
                </header>
                <div className="es-form-scroll">
                    <div className="es-uploads">
                        <StudioUploadBox
                            kind="photos"
                            hint="必填"
                            product={product}
                            pending={uploads.pending.photos}
                            onFiles={(files) => void uploads.addFiles("photos", files)}
                            onAssets={(assets) => void uploads.addAssets("photos", assets)}
                            onRemove={(photo) => edit((current) => ({ ...current, photos: current.photos.filter((item) => item.id !== photo.id) }))}
                            onPatch={(photo, patch) => edit((current) => ({ ...current, photos: current.photos.map((item) => (item.id === photo.id ? { ...item, ...patch } : item)) }))}
                        />
                        <StudioUploadBox
                            kind="references"
                            hint=""
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
                            <Button
                                size="small"
                                onClick={() => {
                                    if (!suggestion.info) return edit(applyStudioSuggestion, { immediate: true });
                                    modal.confirm({
                                        title: "核对后采用这些卖点",
                                        content: (
                                            <>
                                                <p>它们是识别建议，不是卖家事实。请确认每条都能在商品实物或资料里核实。</p>
                                                <pre className="es-confirm-pre">{suggestion.info}</pre>
                                            </>
                                        ),
                                        okText: "我已核对，填入表单",
                                        cancelText: "暂不采用",
                                        onOk: () => edit((current) => (studioSuggestion(current)?.info === suggestion.info ? applyStudioSuggestion(current) : current), { immediate: true }),
                                    });
                                }}
                            >
                                {suggestion.info ? "查看建议" : "填入表单"}
                            </Button>
                        </div>
                    ) : null}

                    <div className="es-section-head">
                        <h2>商品信息</h2>
                        <span className="es-field-actions">
                            <Tooltip
                                title={!product.photos.length ? "先上传商品图" : scope && text.value ? "看商品图识别品牌、类型、标题和卖点（已经写了的不覆盖），再问你几个商品图看不出来的问题" : "看商品图，自动填品牌、类型、标题和卖点；已经写了的不覆盖"}
                            >
                                <Button size="small" icon={<ScanSearch size={14} />} loading={filling || asking} disabled={Boolean(user) && (Boolean(analysisBlock) || Boolean(running && !filling && !asking))} onClick={() => void analyzeProduct()}>
                                    {filling ? "识别商品中…" : asking ? "生成问题中…" : "AI 分析商品"}
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
                        <Button size="small" icon={<LayoutTemplate size={14} />} onClick={() => setPickerOpen(true)}>
                            套图模板库
                        </Button>
                    </div>
                    <div className="es-grid">
                        <div className="es-field" data-span={6}>
                            <div className="es-type-picker" role="group" aria-label="出图类型">
                                <div className="es-type-set" role="group" aria-labelledby="es-type-set-label">
                                    <h3 id="es-type-set-label">成套页面</h3>
                                    <div className="es-type-set-options">
                                        {STUDIO_SET_TYPES.map((item) => {
                                            const Icon = item.id === "detail-set" ? Rows3 : item.id === "main-set" ? Images : LayoutTemplate;
                                            return (
                                                <button key={item.id} type="button" className="es-type-set-option" data-output-type={item.id} aria-pressed={brief.outputType === item.id} onClick={() => pickSet(item.id)}>
                                                    <Icon size={18} aria-hidden />
                                                    {item.id === "main-set" ? "主图套图" : item.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="es-type-single" role="group" aria-label="单张图片，可多选">
                                    <h3>单张图片</h3>
                                    {SINGLE_TYPE_GROUPS.map((group) => (
                                        <div className="es-type-group" role="group" key={group.id} aria-labelledby={`es-type-group-${group.id}`}>
                                            <h4 id={`es-type-group-${group.id}`}>{group.label}</h4>
                                            <div className="es-type-options">
                                                {group.types.map((id) => {
                                                    const item = STUDIO_SINGLE_TYPES.find((candidate) => candidate.id === id);
                                                    if (!item) return null;
                                                    const selected = singles.some((single) => single.id === item.id);
                                                    return (
                                                        <button key={item.id} type="button" className="es-type-option" data-output-type={item.id} aria-pressed={selected} onClick={() => pickOutput((current) => toggleStudioSingleType(current, item.id))}>
                                                            <span>{item.label}</span>
                                                            {selected ? <Check size={13} aria-hidden /> : null}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <Field label="生图模型" span={6}>
                            <StudioModelPicker kind="image" imageCount={Math.max(1, referenceCount)} placeholder="选择图片模型" />
                        </Field>
                        {referenceSummary ? (
                            <div className="es-field es-reference-audit" data-span={6} aria-label="本次生成实际参考图">
                                <div className="es-reference-audit-head">
                                    <span className="es-field-label">首张图实际发送给图片模型</span>
                                    <strong>{referenceSummary.total} 张参考图</strong>
                                </div>
                                <div className="es-reference-audit-chips">
                                    <span data-kind="product">商品真值 {referenceSummary.product}</span>
                                    {referenceSummary.model ? <span data-kind="model">模特 {referenceSummary.model}</span> : null}
                                    {referenceSummary.style ? <span data-kind="style">风格/淘宝参考 {referenceSummary.style}</span> : null}
                                    {referenceSummary.layoutGuide ? <span data-kind="layout">版式蓝图 {referenceSummary.layoutGuide}</span> : null}
                                    {referenceSummary.revision ? <span data-kind="revision">待修正成品 {referenceSummary.revision}</span> : null}
                                </div>
                                <p className="es-reference-audit-note">
                                    {referenceSummary.notice || "商品真值锁定外观；风格参考只迁移构图、字阶和配色，不会把淘宝商品当成你的商品。"}
                                    {referenceSummaryVaries ? " 后续画面会按本屏是否需要模特或版式蓝图调整参考图。" : ""}
                                </p>
                                <details>
                                    <summary>查看本次会发送的资料</summary>
                                    <p>{referenceSummary.names.join("、")}</p>
                                </details>
                            </div>
                        ) : null}
                        <Field label={scope === "detail" ? "详情屏数" : singles.length > 1 ? "每种数量" : "数量"} span={2}>
                            <Select
                                appearance="field"
                                size="large"
                                value={scope === "detail" ? studioDetailScreenCount(brief) : setKind ? images : brief.count}
                                disabled={Boolean(setKind && scope !== "detail") || Boolean(planning)}
                                options={
                                    scope === "detail"
                                        ? STUDIO_DETAIL_SCREEN_OPTIONS.map((count) => ({ value: count, label: `${count} 屏` }))
                                        : setKind
                                          ? [{ value: images, label: `${images} ${unit}` }]
                                          : STUDIO_COUNT_OPTIONS.map((count) => ({ value: count, label: `${count} 张` }))
                                }
                                ariaLabel={scope === "detail" ? "详情屏数" : "数量"}
                                onChange={(value: number) => editBrief(scope === "detail" ? { detailScreens: value, shotOrder: [], shotSkip: [] } : { count: value })}
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
                    </div>
                    <details className="es-input-details">
                        <summary>
                            平台、受众与拍摄设置{" "}
                            <span>
                                {platform?.name} · {studioMarket(brief.market).label}
                            </span>
                        </summary>
                        <div className="es-grid">
                            {castRelevant ? <StudioModelCastSection product={product} edit={edit} /> : null}
                            <Field label="平台" span={2}>
                                <Select appearance="field" size="large" value={product.platform} options={PLATFORM_OPTIONS} ariaLabel="平台" onChange={(value: EcommercePlatformId) => edit((current) => ({ ...current, platform: value }))} />
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
                            <Field label="语言" span={2} hint={brief.language !== "none" && adapter.textRendering === "weak" && image.value ? `${adapter.label} 的文字可能不清晰，可换支持文字的图片模型。` : undefined}>
                                <Select appearance="field" size="large" value={brief.language} options={LANGUAGE_OPTIONS} ariaLabel="图上文字的语言" onChange={(value: StudioLanguage) => editBrief({ language: value })} />
                            </Field>
                            <Field label="质感" span={3}>
                                <Select appearance="field" size="large" value={product.style} options={STYLE_OPTIONS} ariaLabel="质感" onChange={(value: StudioStyleId) => edit((current) => studioChangeStyle(current, value))} />
                            </Field>
                            <Field label="拍摄方式" span={3}>
                                <Select appearance="field" size="large" value={brief.shooting} options={SHOOTING_OPTIONS} ariaLabel="拍摄方式" onChange={(value: StudioShooting) => editBrief({ shooting: value })} />
                            </Field>
                            <Field label="目标人群" span={3} htmlFor="es-audience">
                                <Input id="es-audience" variant="filled" size="large" value={brief.audience} placeholder="例如：通勤者、第一次配镜的人" maxLength={60} onChange={(event) => editBrief({ audience: event.target.value })} />
                            </Field>
                            <Field label="价格/定位" span={3} htmlFor="es-positioning">
                                <Input id="es-positioning" variant="filled" size="large" value={brief.positioning} placeholder="例如：中高端、性价比、礼盒" maxLength={60} onChange={(event) => editBrief({ positioning: event.target.value })} />
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
                    </details>
                </div>
                <footer className="es-form-foot es-input-next">
                    <Button block onClick={onPlanning} icon={<ArrowRight size={15} />} iconPlacement="end">
                        去页面设计
                    </Button>
                </footer>
            </section>

            <section className="es-plan-workspace" aria-labelledby="es-plan-heading">
                <header className="es-workspace-head">
                    <h2 id="es-plan-heading">逐屏页面设计</h2>
                    <span>{activePlan ? `${included.length}/${entries.length} ${planUnit}已选` : scope ? `${planScreens} ${planUnit}待策划` : "选择出图类型"}</span>
                </header>
                <div className="es-form-scroll es-plan-scroll" ref={planScroll}>
                    {showReceiptFirst ? planReceipt : null}
                    <StudioPlanProgressPanel productId={product.id} inputSignature={planSignature} claimSources={claimSources} />
                    {running && !planning ? (
                        <p className="es-plan-preparing" role="status">
                            {filling ? "正在识别商品图，整理可用于设计的外观与资料…" : asking ? "正在整理需要卖家确认的问题…" : "正在整理可选的设计参考…"}
                        </p>
                    ) : null}
                    {setKind || scope ? (
                        <>
                            {activePlan && !planning && scope !== "detail" ? <StudioPlanDirectionCard key={activePlan.id} plan={activePlan} /> : null}
                            {entries.length && !planMissing ? (
                                <section className="es-plan-review" aria-labelledby="es-plan-review-heading">
                                    <div className="es-plan-review-head es-section-head">
                                        <div>
                                            <h3 id="es-plan-review-heading">页面清单</h3>
                                        </div>
                                        {setKind === "detail" && activePlan ? (
                                            <div className="es-plan-review-preview">
                                                <StudioPlanPreview plan={activePlan} entries={entries} detail={scope === "detail"} claimSources={claimSources} />
                                            </div>
                                        ) : null}
                                    </div>
                                    {scope === "detail" && !planning && activePlan?.summary.trim() ? <p className="es-plan-review-summary">{activePlan.summary}</p> : null}
                                    <StudioShotList
                                        entries={entries}
                                        unit={setKind ? unit : "张"}
                                        detail={scope === "detail"}
                                        sameLayout={brief.sameLayout}
                                        plan={activePlan}
                                        claimSources={claimSources}
                                        onToggle={(key) => edit((current) => ({ ...current, brief: toggleStudioSetEntry(current, key) }))}
                                        onMove={(key, delta) => edit((current) => ({ ...current, brief: moveStudioSetEntry(current, key, delta) }))}
                                        {...(activePlan ? { onEditPlan: (index: number, patch: StudioPlannedScreenPatch) => edit((current) => ({ ...current, brief: patchStudioDetailPlanScreen(current.brief, index, patch, planField) })) } : {})}
                                    />
                                </section>
                            ) : null}
                            {brief.outputType === "template-set" && !activePlan ? (
                                <div className="es-suite-card" data-empty={brief.suite ? undefined : true}>
                                    <span className="es-suite-card-text">
                                        <strong>{brief.suite ? brief.suite.name : "还没选模板"}</strong>
                                        <span>
                                            {brief.suite
                                                ? [brief.suite.source === "admin" ? "后台精选" : "内置模板库", brief.suite.kind === "main" ? "按主图出" : "按详情页出", studioSuiteUse(brief.suite.shots), brief.suite.category].filter(Boolean).join(" · ")
                                                : "从后台精选或内置模板库挑一套，按模板逐张出图。"}
                                        </span>
                                    </span>
                                    <Button icon={<LayoutTemplate size={14} />} onClick={() => setPickerOpen(true)}>
                                        {brief.suite ? "换一套" : "选择模板"}
                                    </Button>
                                </div>
                            ) : null}
                            {scope ? (
                                <details
                                    className="es-plan-adjust"
                                    data-ready={activePlan ? true : undefined}
                                    open={!activePlan || expandedPlanId === activePlan.id}
                                    onToggle={(event) => {
                                        if (activePlan) setExpandedPlanId(event.currentTarget.open ? activePlan.id : undefined);
                                    }}
                                >
                                    <summary>调整或重新策划</summary>
                                    <div className="es-suite-card es-plan-card" data-empty={planMissing ? true : undefined} data-planned={activePlan ? true : undefined}>
                                        {brief.outputType === "template-set" && activePlan ? (
                                            <div className="es-plan-template">
                                                <span>当前模板 · {brief.suite?.name}</span>
                                                <Button size="small" onClick={() => setPickerOpen(true)}>
                                                    换一套
                                                </Button>
                                            </div>
                                        ) : null}
                                        <span className="es-suite-card-text">
                                            <strong>
                                                {activePlan
                                                    ? `已策划 ${activePlan.screens.length} ${planUnit}`
                                                    : !text.value
                                                      ? scope === "single"
                                                          ? "没有可用的文本模型，按出图类型直接出"
                                                          : scope === "template"
                                                            ? "没有可用的文本模型，按模板直接出"
                                                            : scope === "detail"
                                                              ? `先选择文本模型，策划这 ${planScreens} 屏`
                                                              : `按品类默认的 ${entries.length} ${planUnit}`
                                                      : scope === "single"
                                                        ? `可以先让 AI 策划这 ${planScreens} 张`
                                                        : scope === "template"
                                                          ? `可以先让 AI 按模板策划这 ${planScreens} ${planUnit}`
                                                          : `策划 ${planScreens} ${planUnit}`}
                                            </strong>
                                            <span>
                                                {activePlan
                                                    ? activePlan.capacityDiagnostics?.missingEvidence?.length
                                                        ? `可补充的商品资料：${activePlan.capacityDiagnostics.missingEvidence.slice(0, 3).join("、")}`
                                                        : ""
                                                    : planOutdated
                                                      ? "请重新策划。已生成的图片保留在记录中。"
                                                      : text.value
                                                        ? scope === "template"
                                                            ? `模板定每${planUnit}讲什么，AI 按这件商品重写画面和文字素材。`
                                                            : `可直接让 AI 为每一${planUnit}完成页面设计；补充问题和设计方向只是可选参考${scope === "single" ? "，直接点生成也会先完成页面设计" : ""}。`
                                                        : "添加文本模型后可以按商品策划。"}
                                            </span>
                                            {text.value && planningImages.notice ? <span>{planningImages.notice}</span> : null}
                                            {analysisBlock ? <span>{analysisBlock}</span> : null}
                                        </span>
                                        {text.value ? prepPanel : null}
                                        {text.value ? (
                                            <span className="es-plan-card-actions">
                                                {detailNeedsPlan ? null : (
                                                    <Button
                                                        type={!activePlan ? "primary" : "default"}
                                                        icon={<ListChecks size={14} />}
                                                        loading={planning || filling}
                                                        disabled={Boolean(user) && (Boolean(analysisBlock) || asking || directing || starting)}
                                                        onClick={planDetail}
                                                    >
                                                        {filling
                                                            ? "分析商品中…"
                                                            : planning
                                                              ? "策划中…"
                                                              : storedPlan && brief.planNote?.trim()
                                                                ? "按补充调整重新策划"
                                                                : activePlan
                                                                  ? brief.planNote?.trim()
                                                                      ? "按补充调整重新策划"
                                                                      : pickedDirection
                                                                        ? `按「${pickedDirection.angle}」重新策划`
                                                                        : "重新策划"
                                                                  : pickedDirection
                                                                    ? `按「${pickedDirection.angle}」策划 ${planScreens} ${planUnit}`
                                                                    : product.dossier || !textSeesPhotos
                                                                      ? `AI 策划 ${planScreens} ${planUnit}`
                                                                      : `识别商品并策划 ${planScreens} ${planUnit}`}
                                                    </Button>
                                                )}
                                                <FillModelPopover imageCount={planningImages.images.length} purpose="策划" />
                                                {planningAvailable && (scope === "single" || scope === "template") ? (
                                                    <Button type="link" size="small" disabled={Boolean(user) && (Boolean(blocked) || Boolean(running) || starting)} onClick={() => void generate({ direct: true })}>
                                                        {scope === "template" ? "不策划，按模板直接生成" : "不策划，直接生成"}
                                                    </Button>
                                                ) : null}
                                            </span>
                                        ) : null}
                                        {text.value ? (
                                            <label className="es-plan-note">
                                                <span>补充要求（写给 AI，每次页面设计都会带上）</span>
                                                <Input.TextArea
                                                    variant="filled"
                                                    autoSize={{ minRows: 1, maxRows: 4 }}
                                                    maxLength={STUDIO_PLAN_NOTE_MAX}
                                                    value={brief.planNote || ""}
                                                    placeholder="例如：开场做满版使用场景；第二屏用真实局部证明；规格用白底对齐，不引用参考图的数字"
                                                    onChange={(event) => editBrief({ planNote: event.target.value })}
                                                />
                                            </label>
                                        ) : null}
                                    </div>
                                </details>
                            ) : null}
                            {geometry && geometry.issues.length > 0 ? (
                                <details className="es-inline-note" data-tone="warning">
                                    <summary>当前画幅的交付预检：{geometry.longImageAvailable ? "平台切片可能不可用" : "不能按当前规格装订"}</summary>
                                    <ul>
                                        {geometry.issues.map((issue) => (
                                            <li key={issue}>{issue}</li>
                                        ))}
                                    </ul>
                                    <p>按所选画幅估算，不妨碍生成分屏；交付以成品实测为准。</p>
                                </details>
                            ) : null}
                            {showReceiptFirst ? null : planReceipt}
                        </>
                    ) : null}
                </div>
                <StudioSuitePicker
                    open={pickerOpen}
                    query={brief.productType.trim() || product.dossier?.category.trim() || ""}
                    onClose={() => setPickerOpen(false)}
                    onPick={(suite) => {
                        edit((current) => ({ ...current, brief: { ...current.brief, outputType: "template-set", suite, templatePlan: undefined, shotOrder: [], shotSkip: [] } }), { immediate: true });
                        onOutputChange();
                        setPickerOpen(false);
                        message.success(`已选「${suite.name}」，共 ${suite.shots.length} 张`);
                    }}
                />
                <footer className="es-form-foot">
                    {!detailNeedsPlan && copyProblem ? (
                        <span className="es-estimate" role="alert">
                            {copyProblem.entry.title}：{copyProblem.issue}
                        </span>
                    ) : null}
                    {planEstimate || imageEstimate ? (
                        <span className="es-estimate" aria-live="polite">
                            {[planEstimate, imageEstimate].filter(Boolean).join("；")}
                        </span>
                    ) : null}
                    {primaryBlock && (detailNeedsPlan || !copyProblem) && !planning && !filling ? <span className="es-estimate">{primaryBlock}</span> : null}
                    <Button size="large" icon={<RotateCcw size={15} />} onClick={() => edit((current) => ({ ...current, brief: resetStudioBriefParameters(current.brief) }))}>
                        重置参数
                    </Button>
                    {canTryFirst ? (
                        <Button size="large" disabled={Boolean(user) && (Boolean(firstBlocked) || Boolean(running) || starting)} onClick={() => void generate({ firstOnly: true })}>
                            先试首屏
                        </Button>
                    ) : null}
                    <Tooltip title={primaryBlock || undefined}>
                        <Button
                            key={detailNeedsPlan ? "plan" : "generate"}
                            type="primary"
                            size="large"
                            className="es-generate"
                            disabled={Boolean(user) && (Boolean(primaryBlock) || Boolean(running) || starting)}
                            loading={detailNeedsPlan ? planning || filling : starting}
                            onClick={detailNeedsPlan ? planDetail : () => void generate()}
                        >
                            {detailNeedsPlan
                                ? filling
                                    ? "分析商品中…"
                                    : planning
                                      ? "策划中…"
                                      : `策划 ${planScreens} 屏`
                                : setKind === "detail" && activePlan
                                  ? `确认生成 · ${images} 屏`
                                  : planBeforeGenerate
                                    ? setKind
                                        ? `AI 策划并生成${setLabel}（${images} ${unit}）`
                                        : `AI 策划并生成 ${images} 张`
                                    : setKind
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
        </>
    );
}
