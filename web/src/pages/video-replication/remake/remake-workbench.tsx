import { App, Button, Dropdown, Input, Spin } from "antd";
import { ArrowLeft, Check, Clapperboard, Copy, Download, FileText, MoreHorizontal, PackagePlus, Play, RefreshCw, Square } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { EmptyState } from "@/components/ui/product/empty-state";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { productVideoDefaultRatio } from "@/lib/product-video/media";
import { isCommercialCreativeScene } from "@/lib/remake/creative";
import {
    duplicateRemakeJob,
    isRemakeJob,
    REMAKE_ACTIVE,
    REMAKE_AUDIO_LABEL,
    REMAKE_STATUS_LABEL,
    REMAKE_TREATMENT_LABEL,
    REMAKE_TREATMENTS,
    remakeJobError,
    remakeKeptDurationMs,
    remakeLanguage,
    type RemakeJob,
    type RemakeProduct,
} from "@/lib/remake/job";
import { remakeLines, remakeSubtitleSRT } from "@/lib/remake/timeline";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceStorageKey } from "@/services/api/resources";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { productVideoThumbUrl } from "../replace/product-video-assets";
import { remakeLimitsFor } from "./remake-config";
import { createProductVideo, loadProductVideos, useProductVideoStore, updateRemake } from "../replace/use-product-video-store";
import { formatProductVideoCredits } from "../replace/use-product-video-estimate";
import { rewriteRemakeDialogue } from "./remake-dialogue";
import { RemakeJianyingModal } from "./remake-jianying";
import { RemakeProduce } from "./remake-produce";
import { remakeReviewError } from "@/lib/remake/units";
import { RemakeProductPicker } from "./remake-product-picker";
import { RemakeRecipeCards, RemakeStoryboard, remakeWritesDialogue, type RemakeEdit } from "./remake-recipe";
import { assembleRemake, remakeUnitsFor, retryRemake, startRemake, stopRemake, useRemakeRuntime } from "./remake-runner";
import { useRemakeEstimate } from "./use-remake-estimate";
import "./remake.css";
import { createRemakeEditTimeline, type RemakeStep } from "@/lib/remake/editor";
import { RemakeEditor } from "./remake-editor";
import type { EditorStore } from "@/stores/editor/editor-store";
import type { StoreApi, UseBoundStore } from "zustand";
import { CreativePlanner } from "./creative-planner";
import { referenceReplicationInput } from "@/lib/remake/reference-replication";
import "./creative.css";

export type { RemakeStep } from "@/lib/remake/editor";

/** 配方里用户能改的字段：保存时只把这些套到服务端最新版本上，不覆盖生成流程写入的单元和状态。 */
function recipeFields(job: RemakeJob) {
    const { title, product, people, models, backgrounds, audio, language, voice, voiceReference, subtitles, music, authorized, note, model, ratio, resolution, shots, campaign, directorPlans, activeDirectorPlanId } = job;
    return { title, product, people, models, backgrounds, audio, language, voice, voiceReference, subtitles, music, authorized, note, model, ratio, resolution, shots, campaign, directorPlans, activeDirectorPlanId };
}

function applyRecipe(latest: RemakeJob, draft: RemakeJob): RemakeJob {
    if (latest.replication?.mode !== draft.replication?.mode) throw new Error("复刻方式已在另一窗口改变，请重新打开配方");
    const next = { ...latest, ...recipeFields(draft), ...(latest.creative && draft.creative ? { creative: { ...latest.creative, brief: draft.creative.brief, confirmedInput: draft.creative.confirmedInput } } : {}) };
    if (next.replication && draft.replication) {
        next.replication = { ...next.replication, brief: draft.replication.brief, targetDurationMs: draft.replication.targetDurationMs };
        if (next.replication.plan?.input !== referenceReplicationInput(next)) next.replication.confirmed = false;
    }
    return next;
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function downloadText(fileName: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/x-subrip;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 复刻工作台：一条拆解过的爆款视频 → 换成我的（配方 + 逐镜做法）→ 出片对比。
 * 配方在本地先改、停手 0.7 秒后保存；生成开始后配方锁定，改做法要等停止或完成。
 */
export function RemakeWorkbench({
    id,
    step,
    onStep,
    onBack,
    onOpen,
    onOpenTeardown,
    creativeRunning = false,
}: {
    id: string;
    step: RemakeStep;
    onStep: (step: RemakeStep) => void;
    onBack: () => void;
    /** 打开另一条作品（再做一版之后）。 */
    onOpen: (id: string) => void;
    onOpenTeardown: (teardownId: string) => void;
    creativeRunning?: boolean;
}) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const configRef = useRef(config);
    configRef.current = config;
    const stored = useProductVideoStore((state) => state.jobs.find((item) => item.id === id));
    const status = useProductVideoStore((state) => state.status);
    const loadError = useProductVideoStore((state) => state.error);
    const job = isRemakeJob(stored) ? stored : undefined;
    const active = useRemakeRuntime((state) => Boolean(state.active[id]));
    const progress = useRemakeRuntime((state) => state.progress[id]);
    const [draft, setDraft] = useState<RemakeJob | undefined>(job);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const timer = useRef<number | undefined>(undefined);
    const editVersion = useRef(0);
    const savedVersion = useRef(0);
    const [saveError, setSaveError] = useState("");
    const editorStore = useRef<UseBoundStore<StoreApi<EditorStore>> | undefined>(undefined);
    const [rewriting, setRewriting] = useState(false);
    const [planningDirector, setPlanningDirector] = useState(false);
    const [textModel, setTextModel] = useState("");
    const [starting, setStarting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [editPanel, setEditPanel] = useState<"inspector" | "lut">("inspector");
    const [exporting, setExporting] = useState(false);
    const [applying, setApplying] = useState(false);
    const versions = useProductVideoStore((state) => state.jobs.filter((item) => isRemakeJob(item) && item.variantOf?.id === id).length);
    const locked = Boolean(job && (REMAKE_ACTIVE.includes(job.status) || active || starting || creativeRunning));

    // 换了作品或生成流程改了作品（单元、状态）时，配方之外的字段跟着服务端走；配方以本地为准，直到保存。
    useEffect(() => {
        if (!job) return;
        const current = draftRef.current;
        const pending = current && current.id === job.id && editVersion.current > savedVersion.current;
        if (pending && current.replication?.mode !== job.replication?.mode) {
            setSaveError("复刻方式已在另一窗口改变，本地未保存配方仍保留，请重新核对作品");
            return;
        }
        const next = pending ? applyRecipe(job, current) : job;
        draftRef.current = next;
        setDraft(next);
    }, [job]);

    const flush = useCallback(async () => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        const value = draftRef.current;
        const version = editVersion.current;
        if (!value || version <= savedVersion.current) return;
        try {
            await updateRemake(value.id, (latest) => applyRecipe(latest, value));
            savedVersion.current = Math.max(savedVersion.current, version);
            setSaveError("");
        } catch (error) {
            setSaveError(errorText(error, "请重试"));
            throw error;
        }
    }, []);
    useEffect(() => () => void flush().catch((error) => message.error(`配方没有保存：${errorText(error, "请重试")}`)), [flush, message]);

    const edit: RemakeEdit = useCallback(
        (updater) => {
            if (locked) return;
            const current = draftRef.current;
            if (!current) return;
            const next = updater(current);
            draftRef.current = next;
            editVersion.current += 1;
            setDraft(next);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void flush().catch((error) => message.error(`配方没有保存：${errorText(error, "请重试")}`)), 700);
        },
        [flush, message, locked],
    );

    // 默认模型、画幅和清晰度：沿用全局默认的视频模型，画幅尽量跟随原片。
    const suitable = useMemo(() => selectableModelsByCapability(config, "video").filter((model) => typeof remakeLimitsFor(config, model, draft?.shots || []) !== "string"), [config, draft?.shots]);
    const profile = useMemo(() => (draft?.model ? modelCapabilityConfigFor(config, draft.model).video : undefined), [config, draft?.model]);
    useEffect(() => {
        if (!draft || locked) return;
        const model = draft.model || (suitable.includes(config.videoModel) ? config.videoModel : suitable[0] || "");
        if (model && !suitable.includes(model)) return;
        const videoProfile = model ? modelCapabilityConfigFor(config, model).video : undefined;
        const ratio = videoProfile && !videoProfile.ratios.includes(draft.ratio) ? productVideoDefaultRatio(videoProfile.ratios, draft.source?.width || 720, draft.source?.height || 1280, videoProfile.defaultRatio) : draft.ratio;
        const resolution = videoProfile && !videoProfile.resolutions.includes(draft.resolution) ? videoProfile.defaultResolution || videoProfile.resolutions[0] || "" : draft.resolution;
        if (model !== draft.model || ratio !== draft.ratio || resolution !== draft.resolution) edit((value) => ({ ...value, model, ratio, resolution }));
    }, [config, draft, edit, locked, suitable, profile]);
    useEffect(() => {
        if (!textModel && config.textModel) setTextModel(config.textModel);
    }, [config.textModel, textModel]);

    const limits = useMemo(() => (draft ? remakeLimitsFor(config, draft.model, draft.shots) : "不是视频生成模型"), [config, draft]);
    const usable = typeof limits === "string" ? undefined : limits;
    const planning = useMemo(() => {
        try {
            return { units: draft ? remakeUnitsFor(draft, config) : [], error: "" };
        } catch (error) {
            return { units: [], error: errorText(error, "无法规划生成单元") };
        }
    }, [config, draft]);
    const plannedUnits = planning.units;
    const estimate = useRemakeEstimate(draft || ({ shots: [], product: { images: [] }, models: [], backgrounds: [] } as unknown as RemakeJob), plannedUnits, usable);

    if (!job || !draft) {
        return (
            <WorkspacePage fluid>
                <div className="rw-center">
                    {status === "error" ? (
                        <EmptyState title="作品读取失败" description={loadError} action={<Button onClick={() => void loadProductVideos(true)}>重试</Button>} />
                    ) : status === "ready" ? (
                        <EmptyState title="作品不存在或已被删除" action={<Button onClick={onBack}>返回</Button>} />
                    ) : (
                        <Spin />
                    )}
                </div>
            </WorkspacePage>
        );
    }

    const generates = draft.shots.some((shot) => shot.treatment === "replace" || shot.treatment === "remake");
    const inputError = planning.error || (generates && draft.model && !suitable.includes(draft.model) ? "当前模型不支持这些镜头做法或已不可用，请更换模型" : generates && typeof limits === "string" ? limits : remakeJobError(draft, usable));
    const startedBefore = job.units.length > 0 || job.status !== "draft";
    const canEdit = Boolean(
        job.editTimeline ||
        (job.source?.resourceId && job.replication?.mode !== "style" && job.shots.some((shot) => shot.treatment !== "skip")) ||
        ((job.creative || job.replication?.mode === "style") && job.units.length && job.units.every((unit) => unit.status === "succeeded")),
    );
    const currentStep: RemakeStep = step === "edit" && job.editTimeline ? "edit" : step === "produce" && startedBefore ? "produce" : "recipe";
    const allSucceeded = job.units.length > 0 && job.units.every((unit) => unit.status === "succeeded");
    const reviewError = allSucceeded ? remakeReviewError(job) : "";
    const pendingChanges = startedBefore && plannedUnits.some((unit) => unit.status !== "succeeded");
    const keptMs = remakeKeptDurationMs(draft);
    const productCover = draft.product.images[0];
    const subject = draft.creative && !isCommercialCreativeScene(draft.creative.brief.scene);
    const navigate = async (action: () => void) => {
        if (uploading) {
            message.info("素材正在上传，完成后再切换页面");
            return;
        }
        try {
            do {
                await flush();
            } while (editVersion.current > savedVersion.current);
            await editorStore.current?.getState().flushSave();
            if (editorStore.current?.getState().saveError) throw new Error(editorStore.current.getState().saveError!);
            action();
        } catch (error) {
            message.error(`修改没有保存：${errorText(error, "请重试")}`);
        }
    };
    const openEdit = async () => {
        if (uploading) {
            message.info("素材正在上传，完成后再进入剪辑台");
            return;
        }
        try {
            do {
                await flush();
            } while (editVersion.current > savedVersion.current);
            if (!job.editTimeline) await updateRemake(id, (latest) => ({ ...latest, editTimeline: createRemakeEditTimeline(latest) }));
            onStep("edit");
        } catch (error) {
            message.error(`没能打开剪辑台：${errorText(error, "请重试")}`);
        }
    };
    const perform = async (operation: () => Promise<void>) => {
        try {
            await operation();
        } catch (error) {
            message.error(errorText(error, "操作失败，请重试"));
        }
    };

    const start = async () => {
        if (inputError) {
            message.warning(inputError);
            return;
        }
        setStarting(true);
        try {
            await flush();
            await startRemake(id, configRef.current, estimate.state === "ready" && estimate.credits !== null ? estimate.credits : undefined);
            onStep("produce");
        } catch (error) {
            message.error(`没能开始：${errorText(error, "请重试")}`);
        } finally {
            setStarting(false);
        }
    };
    const rewrite = async () => {
        setRewriting(true);
        try {
            await flush();
            const lines = await rewriteRemakeDialogue(draftRef.current!, { config: configRef.current, model: textModel });
            edit((value) => ({ ...value, shots: value.shots.map((shot) => (lines.has(shot.index) ? { ...shot, dialogue: lines.get(shot.index) || "" } : shot)) }));
            message.success("口播已改写，可以逐镜再改");
        } catch (error) {
            message.error(errorText(error, "改写失败"));
        } finally {
            setRewriting(false);
        }
    };
    // 再做一版：同一条爆款、同一份配方复制一条新作品，已有候选都带过去，只重做改了的部分。
    const another = async () => {
        try {
            await flush();
            const copy = duplicateRemakeJob(draftRef.current!, nanoid(12), { title: `${job.title} · 版本 ${versions + 2}` });
            await createProductVideo(copy);
            message.success("已复制成新的一版，改完做法或口播再开始生成");
            onOpen(copy.id);
        } catch (error) {
            message.error(`没能复制：${errorText(error, "请重试")}`);
        }
    };
    // 套用到其他商品：同一套做法和节奏，每件商品各做一条（口播和候选清空，参考片段照用）。
    const applyTo = async (products: RemakeProduct[]) => {
        setApplying(false);
        try {
            await flush();
            for (const product of products) await createProductVideo(duplicateRemakeJob(draftRef.current!, nanoid(12), { title: `复刻 · ${product.name || "新商品"}`, product }));
            message.success(`已新建 ${products.length} 条作品，在「我的作品」里逐条改写口播后开始生成`);
            onBack();
        } catch (error) {
            message.error(`没能新建：${errorText(error, "请重试")}`);
        }
    };
    const download = async () => {
        if (!job.render?.resourceId) return;
        try {
            await downloadBrowserMedia({ fileName: `${job.title || "复刻成片"}.mp4`, storageKey: resourceStorageKey(job.render.resourceId) });
        } catch (error) {
            message.error(errorText(error, "下载失败"));
        }
    };

    const cta = (() => {
        if (currentStep === "recipe")
            return (
                <Button type="primary" loading={starting} disabled={locked || uploading || planningDirector || rewriting || Boolean(inputError)} icon={<Play size={16} />} onClick={() => void start()} title={inputError || undefined}>
                    {pendingChanges || !startedBefore ? "开始生成" : "按新配方重新拼"}
                </Button>
            );
        if (locked)
            return (
                <Button icon={<Square size={14} />} onClick={() => void perform(() => stopRemake(id))}>
                    停止
                </Button>
            );
        if (job.render?.resourceId)
            return (
                <Button type="primary" icon={<Download size={16} />} onClick={() => void download()}>
                    下载成片
                </Button>
            );
        if (allSucceeded)
            return (
                <Button type="primary" disabled={Boolean(reviewError)} title={reviewError || undefined} icon={<Check size={16} />} onClick={() => void perform(() => assembleRemake(id, configRef.current))}>
                    {reviewError ? "先核对每段候选" : "拼成片"}
                </Button>
            );
        return (
            <Button type="primary" icon={<RefreshCw size={16} />} onClick={() => void perform(() => retryRemake(id, configRef.current))}>
                接着生成
            </Button>
        );
    })();

    return (
        <WorkspacePage fluid scroll={false} className="rw-page">
            <div className="rw-shell" data-step={currentStep} data-creative={Boolean(draft.creative)}>
                <header className="rw-rail" aria-label="作品步骤与操作">
                    <button type="button" className="rw-back" onClick={() => void navigate(onBack)}>
                        <ArrowLeft size={14} aria-hidden /> 我的作品
                    </button>
                    <Input className="rw-title" value={draft.title} maxLength={60} variant="borderless" disabled={locked} onChange={(event) => edit((value) => ({ ...value, title: event.target.value }))} aria-label="作品名称" />
                    <ol className="rw-steps">
                        <li data-state="done">
                            <button type="button" onClick={() => void navigate(() => (job.source ? onOpenTeardown(job.source.teardownId) : onStep("recipe")))} disabled={!job.creative && !job.source?.teardownId}>
                                <span className="rw-step-no">
                                    <Check size={12} />
                                </span>
                                {job.creative ? (subject ? "主体素材" : "商品素材") : "放爆款"}
                                <small>{job.source?.name || job.product.name || (subject ? "添加主体参考图" : "上传商品照片")}</small>
                            </button>
                        </li>
                        <li data-state={currentStep === "recipe" ? "current" : "done"}>
                            <button type="button" aria-current={currentStep === "recipe" ? "step" : undefined} onClick={() => void navigate(() => onStep("recipe"))}>
                                <span className="rw-step-no">{currentStep === "recipe" ? 2 : <Check size={12} />}</span>
                                {job.creative ? "策划与分镜" : "换成我的"}
                                <small>{job.creative ? "确认资料、比较脚本、逐镜编辑" : "商品、人物、口播和逐镜做法"}</small>
                            </button>
                        </li>
                        <li data-state={currentStep === "produce" ? "current" : startedBefore ? "done" : "todo"}>
                            <button type="button" aria-current={currentStep === "produce" ? "step" : undefined} disabled={!startedBefore} onClick={() => void navigate(() => onStep("produce"))}>
                                <span className="rw-step-no">3</span>
                                {job.creative ? "生成与候选" : "出片对比"}
                                <small>
                                    {REMAKE_STATUS_LABEL[job.status]}
                                    {progress?.stage ? ` · ${progress.stage}` : ""}
                                </small>
                            </button>
                        </li>
                        <li data-state={currentStep === "edit" ? "current" : canEdit ? "done" : "todo"}>
                            <button type="button" aria-current={currentStep === "edit" ? "step" : undefined} disabled={!canEdit || locked} onClick={() => void openEdit()}>
                                <span className="rw-step-no">4</span>剪辑台<small>裁剪、分割、字幕和导出</small>
                            </button>
                        </li>
                    </ol>
                    <details className="rw-summary-toggle">
                        <summary>配方摘要</summary>
                        <div className="rw-summary">
                            <div className="rw-summary-product">
                                <span className="rw-summary-cover">{productCover ? <img src={productVideoThumbUrl(productCover.resourceId)} alt="" /> : null}</span>
                                <span>
                                    <strong>{draft.product.name || (subject ? (productCover ? "已添加主体" : "还没添加主体") : productCover ? "已上传商品" : "还没选商品")}</strong>
                                    <small>
                                        {draft.product.images.length} 张{subject ? "主体参考图" : "商品图"}
                                    </small>
                                </span>
                            </div>
                            <dl>
                                <dt>人物</dt>
                                <dd>{draft.people === "model" ? (draft.models.length ? `换成模特（${draft.models.length} 张）` : "换成普通人") : draft.people === "original" ? "保留原人物" : "不出人"}</dd>
                                {draft.people === "model" && draft.models.length ? (
                                    <>
                                        <dt>参考</dt>
                                        <dd className="rw-summary-references">
                                            {draft.models.map((image) => (
                                                <figure key={image.id}>
                                                    <img src={productVideoThumbUrl(image.resourceId)} alt={image.name} />
                                                    <figcaption>{image.role === "face" ? "人脸" : image.role === "pose" ? "姿势" : "模特"}</figcaption>
                                                </figure>
                                            ))}
                                        </dd>
                                    </>
                                ) : null}
                                <dt>模型</dt>
                                <dd title={draft.model}>
                                    {draft.model || "未选择"}
                                    <small>{[draft.ratio, draft.resolution].filter(Boolean).join(" · ")}</small>
                                </dd>
                                <dt>场景</dt>
                                <dd>{draft.backgrounds.length ? `参考背景（${draft.backgrounds.length} 张）` : job.creative ? "按脚本设计" : "沿用原片布局"}</dd>
                                <dt>口播</dt>
                                <dd>
                                    {draft.creative && draft.audio === "rewrite" ? "原生口播" : REMAKE_AUDIO_LABEL[draft.audio]}
                                    {remakeWritesDialogue(draft.audio) ? ` · ${remakeLanguage(draft.language).label}` : ""}
                                </dd>
                                <dt>收尾</dt>
                                <dd>{[draft.subtitles.burn && draft.audio !== "mute" ? "烧录字幕" : "不烧字幕", draft.music ? "有背景音乐" : ""].filter(Boolean).join(" · ")}</dd>
                                <dt>做法</dt>
                                <dd>
                                    {REMAKE_TREATMENTS.map((treatment) => [treatment, draft.shots.filter((shot) => shot.treatment === treatment).length] as const)
                                        .filter(([, value]) => value)
                                        .map(([treatment, value]) => `${REMAKE_TREATMENT_LABEL[treatment]} ${value}`)
                                        .join(" · ")}
                                </dd>
                            </dl>
                        </div>
                    </details>
                    <div className="rw-rail-foot">
                        <div className="rw-estimate">
                            {estimate.enabled && estimate.state !== "idle" ? (
                                <strong>{estimate.state === "ready" && estimate.credits !== null ? `${formatProductVideoCredits(estimate.credits)} 积分起` : estimate.state === "loading" ? "正在计算积分…" : "暂时算不出积分"}</strong>
                            ) : null}
                            <span>
                                成片约 {(keptMs / 1000).toFixed(1).replace(/\.0$/, "")} 秒{estimate.units ? ` · 要生成 ${estimate.units} 段` : ""}
                                {draft.audio === "voice" ? " · 配音按配音模型另计" : ""}
                            </span>
                        </div>
                        {currentStep === "recipe" && inputError ? <p className="rw-warn">{inputError}</p> : null}
                        {currentStep === "produce" && job.error ? <p className="rw-warn">{job.error}</p> : null}
                        {saveError ? (
                            <p className="rw-warn" role="alert">
                                配方未保存：{saveError}
                                <Button size="small" onClick={() => void flush().catch(() => undefined)}>
                                    重试保存
                                </Button>
                            </p>
                        ) : null}
                        {currentStep !== "edit" ? cta : null}
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    ...(currentStep === "produce" && job.render?.resourceId ? [{ key: "jianying", icon: <Clapperboard size={14} />, label: "导出剪映草稿", onClick: () => setExporting(true) }] : []),
                                    ...(currentStep === "produce" && remakeLines(draft, true).length
                                        ? [{ key: "srt", icon: <FileText size={14} />, label: "导出字幕（SRT）", onClick: () => downloadText(`${job.title || "复刻成片"}.srt`, remakeSubtitleSRT(draft)) }]
                                        : []),
                                    { key: "another", icon: <Copy size={14} />, label: "再做一版", disabled: locked || uploading, onClick: () => void another() },
                                    ...(!subject ? [{ key: "product", icon: <PackagePlus size={14} />, label: "套用到其他商品", disabled: locked || uploading, onClick: () => setApplying(true) }] : []),
                                ],
                            }}
                        >
                            <Button icon={<MoreHorizontal size={16} />} aria-label="更多作品操作">
                                更多
                            </Button>
                        </Dropdown>
                    </div>
                </header>
                <main className="rw-main">
                    {currentStep === "recipe" ? (
                        <div className="rw-recipe-layout">
                            <RemakeRecipeCards
                                flush={flush}
                                job={draft}
                                config={config}
                                edit={edit}
                                disabled={locked || planningDirector || rewriting || Boolean(draft.creative?.run && !draft.creative.run.settled)}
                                onPlanningChange={setPlanningDirector}
                                onUploadingChange={setUploading}
                            />
                            <div className="cv-planner">
                                {draft.creative ? <CreativePlanner job={draft} config={config} edit={edit} disabled={locked || uploading} running={creativeRunning} flush={flush} onBusy={setPlanningDirector} /> : null}
                                {draft.shots.length ? (
                                    <RemakeStoryboard
                                        job={draft}
                                        edit={edit}
                                        disabled={locked || planningDirector || rewriting || Boolean(draft.creative?.run && !draft.creative.run.settled)}
                                        config={config}
                                        textModel={textModel}
                                        onTextModel={setTextModel}
                                        rewriting={rewriting}
                                        onRewrite={() => void rewrite()}
                                    />
                                ) : null}
                            </div>
                        </div>
                    ) : currentStep === "edit" ? (
                        <RemakeEditor
                            initialPanel={editPanel}
                            key={id}
                            job={job}
                            onReady={(store) => {
                                editorStore.current = store;
                            }}
                            onUploadingChange={setUploading}
                        />
                    ) : (
                        <RemakeProduce
                            job={job}
                            config={config}
                            onEditRecipe={() => onStep("recipe")}
                            onAddLut={() => {
                                setEditPanel("lut");
                                void openEdit();
                            }}
                        />
                    )}
                </main>
            </div>
            {exporting ? <RemakeJianyingModal job={job} onClose={() => setExporting(false)} /> : null}
            {applying ? <RemakeProductPicker multiple title="套用到其他商品：选商品，每件做一条" onClose={() => setApplying(false)} onPickMany={(products) => void applyTo(products)} /> : null}
        </WorkspacePage>
    );
}
