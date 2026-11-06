import { App, Button, Input, Spin } from "antd";
import { ArrowLeft, Check, Download, FileText, Play, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { EmptyState } from "@/components/ui/product/empty-state";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { productVideoDefaultRatio } from "@/lib/product-video/media";
import { isRemakeJob, REMAKE_ACTIVE, REMAKE_AUDIO_LABEL, REMAKE_STATUS_LABEL, REMAKE_TREATMENT_LABEL, REMAKE_TREATMENTS, remakeJobError, remakeKeptDurationMs, type RemakeJob } from "@/lib/remake/job";
import { remakeSubtitleSRT } from "@/lib/remake/timeline";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceStorageKey } from "@/services/api/resources";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { productVideoThumbUrl } from "../replace/product-video-assets";
import { productVideoLimitsFor } from "../replace/product-video-config";
import { useProductVideoStore, updateRemake } from "../replace/use-product-video-store";
import { formatProductVideoCredits } from "../replace/use-product-video-estimate";
import { rewriteRemakeDialogue } from "./remake-dialogue";
import { RemakeProduce } from "./remake-produce";
import { RemakeRecipeCards, RemakeStoryboard, type RemakeEdit } from "./remake-recipe";
import { assembleRemake, remakeUnitsFor, retryRemake, startRemake, stopRemake, useRemakeRuntime } from "./remake-runner";
import { useRemakeEstimate } from "./use-remake-estimate";
import "./remake.css";

export type RemakeStep = "recipe" | "produce";

/** 配方里用户能改的字段：保存时只把这些套到服务端最新版本上，不覆盖生成流程写入的单元和状态。 */
function recipeFields(job: RemakeJob) {
    const { title, product, people, models, backgrounds, audio, authorized, note, model, ratio, resolution, shots } = job;
    return { title, product, people, models, backgrounds, audio, authorized, note, model, ratio, resolution, shots };
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
export function RemakeWorkbench({ id, step, onStep, onBack, onOpenTeardown }: { id: string; step: RemakeStep; onStep: (step: RemakeStep) => void; onBack: () => void; onOpenTeardown: (teardownId: string) => void }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const configRef = useRef(config);
    configRef.current = config;
    const stored = useProductVideoStore((state) => state.jobs.find((item) => item.id === id));
    const status = useProductVideoStore((state) => state.status);
    const job = isRemakeJob(stored) ? stored : undefined;
    const active = useRemakeRuntime((state) => Boolean(state.active[id]));
    const progress = useRemakeRuntime((state) => state.progress[id]);
    const [draft, setDraft] = useState<RemakeJob | undefined>(job);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const timer = useRef<number | undefined>(undefined);
    const [rewriting, setRewriting] = useState(false);
    const [textModel, setTextModel] = useState("");
    const [starting, setStarting] = useState(false);
    const locked = Boolean(job && (REMAKE_ACTIVE.includes(job.status) || active));

    // 换了作品或生成流程改了作品（单元、状态）时，配方之外的字段跟着服务端走；配方以本地为准，直到保存。
    useEffect(() => {
        if (!job) return;
        setDraft((current) => (current && current.id === job.id && timer.current ? { ...job, ...recipeFields(current) } : job));
    }, [job]);

    const flush = useCallback(async () => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        const value = draftRef.current;
        if (value) await updateRemake(value.id, (latest) => ({ ...latest, ...recipeFields(value) }));
    }, []);
    useEffect(() => () => void flush().catch(() => undefined), [flush]);

    const edit: RemakeEdit = useCallback(
        (updater) => {
            setDraft((current) => (current ? updater(current) : current));
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void flush().catch((error) => message.error(`配方没有保存：${errorText(error, "请重试")}`)), 700);
        },
        [flush, message],
    );

    // 默认模型、画幅和清晰度：沿用全局默认的视频模型，画幅尽量跟随原片。
    const suitable = useMemo(() => selectableModelsByCapability(config, "video").filter((model) => typeof productVideoLimitsFor(config, model) !== "string"), [config]);
    const profile = useMemo(() => (draft?.model ? modelCapabilityConfigFor(config, draft.model).video : undefined), [config, draft?.model]);
    useEffect(() => {
        if (!draft || locked) return;
        const model = draft.model && suitable.includes(draft.model) ? draft.model : suitable.includes(config.videoModel) ? config.videoModel : suitable[0] || "";
        const videoProfile = model ? modelCapabilityConfigFor(config, model).video : undefined;
        const ratio = videoProfile && !videoProfile.ratios.includes(draft.ratio) ? productVideoDefaultRatio(videoProfile.ratios, draft.source.width, draft.source.height, videoProfile.defaultRatio) : draft.ratio;
        const resolution = videoProfile && !videoProfile.resolutions.includes(draft.resolution) ? videoProfile.defaultResolution || videoProfile.resolutions[0] || "" : draft.resolution;
        if (model !== draft.model || ratio !== draft.ratio || resolution !== draft.resolution) edit((value) => ({ ...value, model, ratio, resolution }));
    }, [config, draft, edit, locked, suitable, profile]);
    useEffect(() => {
        if (!textModel && config.textModel) setTextModel(config.textModel);
    }, [config.textModel, textModel]);

    const limits = useMemo(() => (draft ? productVideoLimitsFor(config, draft.model) : "不是视频生成模型"), [config, draft]);
    const usable = typeof limits === "string" ? undefined : limits;
    const plannedUnits = useMemo(() => (draft ? remakeUnitsFor(draft, config) : []), [config, draft]);
    const estimate = useRemakeEstimate(draft || ({ shots: [], product: { images: [] }, models: [], backgrounds: [] } as unknown as RemakeJob), plannedUnits, usable);

    if (!job || !draft) {
        return (
            <WorkspacePage fluid>
                <div className="rw-center">{status === "ready" ? <EmptyState title="作品不存在或已被删除" action={<Button onClick={onBack}>返回</Button>} /> : <Spin />}</div>
            </WorkspacePage>
        );
    }

    const inputError = remakeJobError(draft, usable);
    const startedBefore = job.units.length > 0 || job.status !== "draft";
    const currentStep: RemakeStep = step === "produce" && startedBefore ? "produce" : "recipe";
    const allSucceeded = job.units.length > 0 && job.units.every((unit) => unit.status === "succeeded");
    const pendingChanges = startedBefore && plannedUnits.some((unit) => !unit.takes.length);
    const keptMs = remakeKeptDurationMs(draft);
    const productCover = draft.product.images[0];

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
                <Button type="primary" size="large" block loading={starting} disabled={locked || Boolean(inputError)} icon={<Play size={16} />} onClick={() => void start()} title={inputError || undefined}>
                    {pendingChanges || !startedBefore ? "开始生成" : "按新配方重新拼"}
                </Button>
            );
        if (locked)
            return (
                <Button size="large" block icon={<Square size={14} />} onClick={() => void stopRemake(id)}>
                    停止
                </Button>
            );
        if (job.render?.resourceId)
            return (
                <Button type="primary" size="large" block icon={<Download size={16} />} onClick={() => void download()}>
                    下载成片
                </Button>
            );
        if (allSucceeded)
            return (
                <Button type="primary" size="large" block icon={<Check size={16} />} onClick={() => void assembleRemake(id, configRef.current)}>
                    拼成片
                </Button>
            );
        return (
            <Button type="primary" size="large" block icon={<RefreshCw size={16} />} onClick={() => void retryRemake(id, configRef.current)}>
                接着生成
            </Button>
        );
    })();

    return (
        <WorkspacePage fluid scroll={false} className="rw-page">
            <div className="rw-shell">
                <aside className="rw-rail" aria-label="复刻步骤">
                    <button type="button" className="rw-back" onClick={onBack}>
                        <ArrowLeft size={14} aria-hidden /> 我的作品
                    </button>
                    <Input className="rw-title" value={draft.title} maxLength={60} variant="borderless" disabled={locked} onChange={(event) => edit((value) => ({ ...value, title: event.target.value }))} aria-label="作品名称" />
                    <ol className="rw-steps">
                        <li data-state="done">
                            <button type="button" onClick={() => onOpenTeardown(job.source.teardownId)} disabled={!job.source.teardownId}>
                                <span className="rw-step-no">
                                    <Check size={12} />
                                </span>
                                放爆款
                                <small>{job.source.name}</small>
                            </button>
                        </li>
                        <li data-state={currentStep === "recipe" ? "current" : "done"}>
                            <button type="button" onClick={() => onStep("recipe")}>
                                <span className="rw-step-no">{currentStep === "recipe" ? 2 : <Check size={12} />}</span>
                                换成我的
                                <small>商品、人物、口播和逐镜做法</small>
                            </button>
                        </li>
                        <li data-state={currentStep === "produce" ? "current" : startedBefore ? "done" : "todo"}>
                            <button type="button" disabled={!startedBefore} onClick={() => onStep("produce")}>
                                <span className="rw-step-no">3</span>
                                出片对比
                                <small>
                                    {REMAKE_STATUS_LABEL[job.status]}
                                    {progress?.stage ? ` · ${progress.stage}` : ""}
                                </small>
                            </button>
                        </li>
                    </ol>
                    <div className="rw-summary">
                        <div className="rw-summary-product">
                            <span className="rw-summary-cover">{productCover ? <img src={productVideoThumbUrl(productCover.resourceId)} alt="" /> : null}</span>
                            <span>
                                <strong>{draft.product.name || "还没选商品"}</strong>
                                <small>{draft.product.images.length} 张商品图</small>
                            </span>
                        </div>
                        <dl>
                            <dt>人物</dt>
                            <dd>{draft.people === "model" ? (draft.models.length ? `换成模特（${draft.models.length} 张）` : "换成普通人") : draft.people === "original" ? "保留原人物" : "不出人"}</dd>
                            <dt>场景</dt>
                            <dd>{draft.backgrounds.length ? `换成背景图（${draft.backgrounds.length} 张）` : "沿用原片布局"}</dd>
                            <dt>口播</dt>
                            <dd>{REMAKE_AUDIO_LABEL[draft.audio]}</dd>
                            <dt>做法</dt>
                            <dd>
                                {REMAKE_TREATMENTS.map((treatment) => [treatment, draft.shots.filter((shot) => shot.treatment === treatment).length] as const)
                                    .filter(([, value]) => value)
                                    .map(([treatment, value]) => `${REMAKE_TREATMENT_LABEL[treatment]} ${value}`)
                                    .join(" · ")}
                            </dd>
                        </dl>
                    </div>
                    <div className="rw-rail-foot">
                        <div className="rw-estimate">
                            {estimate.enabled && estimate.state !== "idle" ? (
                                <strong>{estimate.state === "ready" && estimate.credits !== null ? `${formatProductVideoCredits(estimate.credits)} 积分起` : estimate.state === "loading" ? "正在计算积分…" : "暂时算不出积分"}</strong>
                            ) : null}
                            <span>
                                成片约 {(keptMs / 1000).toFixed(1).replace(/\.0$/, "")} 秒{estimate.units ? ` · 要生成 ${estimate.units} 段` : ""}
                            </span>
                        </div>
                        {currentStep === "recipe" && inputError ? <p className="rw-warn">{inputError}</p> : null}
                        {currentStep === "produce" && job.error ? <p className="rw-warn">{job.error}</p> : null}
                        {cta}
                        {currentStep === "produce" && job.audio === "rewrite" ? (
                            <Button block icon={<FileText size={14} />} onClick={() => downloadText(`${job.title || "复刻成片"}.srt`, remakeSubtitleSRT(draft) || "")} disabled={!draft.shots.some((shot) => shot.dialogue.trim())}>
                                导出字幕（SRT）
                            </Button>
                        ) : null}
                    </div>
                </aside>
                <main className="rw-main">
                    {currentStep === "recipe" ? (
                        <div className="rw-recipe-layout">
                            <RemakeRecipeCards job={draft} config={config} edit={edit} disabled={locked} />
                            <RemakeStoryboard job={draft} edit={edit} disabled={locked} config={config} textModel={textModel} onTextModel={setTextModel} rewriting={rewriting} onRewrite={() => void rewrite()} />
                        </div>
                    ) : (
                        <RemakeProduce job={job} config={config} onEditRecipe={() => onStep("recipe")} />
                    )}
                </main>
            </div>
        </WorkspacePage>
    );
}
