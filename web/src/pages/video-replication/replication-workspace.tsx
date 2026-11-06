import { App, Button, Popover } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { ArrowLeft, ArrowRight, Check, Download, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { ModelPicker } from "@/components/model-picker";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { readVideoReplicationAnalysis, videoTeardownModelError, videoTeardownReportMarkdown, videoTeardownStoryboardRows, videoTeardownTextRequirements, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { parseVideoTeardownBundle, type VideoReplicationDetail, type VideoTeardownBundle } from "@/services/api/video-replication";
import { modelOptionLabel, type AiConfig } from "@/stores/use-config-store";
import { ReplicationPlayer } from "./replication-player";
import { ReplicationProgress } from "./replication-progress";
import { ReplicationShots } from "./replication-shots";
import { ReplicationStructure } from "./replication-structure";
import { ReplicationTimeline } from "./replication-timeline";
import { useReplicationPlayback } from "./use-replication-playback";
import type { ReplicationRun } from "./use-replication-runner";
import type { VideoReplicaOptions } from "./replication-canvas";
import { ReplicationCanvasStep, ReplicationPlan } from "./replication-plan";
import { useReplicaPlan } from "./use-replica-plan";
import type { VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";

/** 工作区的三步：拆解分析、复刻方案、画布生成；没有分析时只有拆解分析。 */
export type ReplicationView = "teardown" | "plan" | "canvas";

const EMPTY_ANALYSIS = { rows: [] };

type Analysis = VideoTeardownAnalysis & { model: string };

type Props = {
    detail: VideoReplicationDetail | undefined;
    loading: boolean;
    error: string;
    /** 当前页面正在跑（或刚失败）的拆解，只在属于这条记录时显示进度。 */
    run: ReplicationRun | null;
    busy: boolean;
    opening: boolean;
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    onReanalyze: (fallbackTitle: string) => void;
    onOpenCanvas: (bundle: VideoTeardownBundle, analysis: Analysis, options: VideoReplicaOptions) => Promise<{ id: string; title: string } | null>;
    onBack: () => void;
    /** 拆解结果还是复刻方案；没有分析时只有拆解结果。 */
    view: ReplicationView;
    onViewChange: (view: ReplicationView) => void;
};

function parseBundle(detail: VideoReplicationDetail | undefined): { bundle?: VideoTeardownBundle; error?: string } {
    if (!detail || detail.task.status !== "succeeded") return {};
    try {
        return { bundle: parseVideoTeardownBundle(detail.task) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : "拆解结果无效" };
    }
}

function downloadText(filename: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 一条拆解记录的工作区：标题和操作、镜头时间线，下面左栏原视频、右栏分镜 / 全片结构。
 * 宽屏下整页放进一屏，分镜和结构在右栏里滚动；窄屏退回整页滚动。
 * 拆解进行中、失败、结果读不出来时换成对应状态；还没分析时在时间线上方给出分析入口。
 */
export function ReplicationWorkspace(props: Props) {
    const { detail, loading, error, run, onBack } = props;
    const { bundle, error: bundleError } = useMemo(() => parseBundle(detail), [detail]);
    const analysis = useMemo(() => (bundle ? readVideoReplicationAnalysis(detail?.analysis, bundle.shots.length) : null), [bundle, detail?.analysis]);
    const ownRun = run && detail && run.id === detail.task.id ? run : null;

    if (loading) return <WorkspaceSkeleton onBack={onBack} />;
    if (error)
        return (
            <WorkspaceShell title="读取失败" onBack={onBack}>
                <StatePanel tone="error" title="读取拆解记录失败" description={error} />
            </WorkspaceShell>
        );
    if (!detail) return null;
    const { task } = detail;
    if (task.status === "queued" || task.status === "running") {
        const progress = ownRun || { stage: "teardown" as const, detail: task.stage || "排队中", percent: typeof task.progress === "number" ? Math.round(Math.min(Math.max(task.progress, 0), 100)) : undefined };
        return (
            <WorkspaceShell title="正在拆解" meta={<MetaTime label="开始于" value={task.createdAt} />} onBack={onBack}>
                <ReplicationProgress run={progress} />
                <ProcessingSkeleton />
            </WorkspaceShell>
        );
    }
    if (task.status !== "succeeded")
        return (
            <WorkspaceShell title={task.status === "cancelled" ? "拆解已取消" : "拆解失败"} meta={<MetaTime label="开始于" value={task.createdAt} />} onBack={onBack}>
                <StatePanel tone="error" title={task.status === "cancelled" ? "这次拆解已取消" : "这次拆解没有完成"} description={task.error || "换一个视频再试一次。"} action={<Button onClick={onBack}>重新拆解</Button>} />
            </WorkspaceShell>
        );
    if (!bundle)
        return (
            <WorkspaceShell title="拆解结果无法读取" onBack={onBack}>
                <StatePanel tone="error" title="拆解结果无法读取" description={bundleError || "请重新拆解这个视频。"} action={<Button onClick={onBack}>重新拆解</Button>} />
            </WorkspaceShell>
        );
    // 按记录重建：换一条记录时切换栏、浮层和播放位置都从头开始。分析从无到有时也重建一次，复刻方案按分析结果初始化。
    return <RecordWorkspace key={`${task.id}:${analysis ? "analyzed" : "pending"}`} {...props} bundle={bundle} analysis={analysis} ownRun={ownRun} />;
}

function RecordWorkspace({
    detail,
    bundle,
    analysis,
    ownRun,
    busy,
    opening,
    config,
    model,
    onModelChange,
    onReanalyze,
    onOpenCanvas,
    onBack,
    view: requestedView,
    onViewChange,
}: Props & { bundle: VideoTeardownBundle; analysis: Analysis | null; ownRun: ReplicationRun | null }) {
    const { message } = App.useApp();
    const [tab, setTab] = useState<"shots" | "structure">("shots");
    const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
    const view: ReplicationView = analysis ? requestedView : "teardown";
    // 方案状态放在这一层：切到拆解分析再回来时，没存上的改动还在；步骤条也要读方案的进度。
    // 没有分析时用空分析占位，不显示也不保存（没有改动就不会触发保存）。
    const planState = useReplicaPlan(detail?.task.id || "", bundle, analysis ?? EMPTY_ANALYSIS, detail?.plan, detail?.planUpdatedAt);
    const playback = useReplicationPlayback(bundle.shots);
    const rows = useMemo(() => new Map(analysis?.rows.map((row) => [row.shotNumber, row])), [analysis]);
    const analyzing = Boolean(ownRun && !ownRun.error);
    const title = analysis?.title || "未命名拆解";
    const summary = analysis?.summary;

    const copy = (text: string) => {
        if (!text) return;
        copyToClipboard(text);
        message.success("已复制");
    };
    const downloadReport = () => {
        if (analysis) downloadText(`${title}-拆解报告.md`, videoTeardownReportMarkdown(bundle, analysis, videoTeardownStoryboardRows(bundle, analysis.rows)));
    };
    const switchTab = (event: KeyboardEvent) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const next = tab === "shots" ? "structure" : "shots";
        setTab(next);
        document.getElementById(`vr-tab-${next}`)?.focus();
    };

    const meta = (
        <>
            {summary?.genre ? <span>{summary.genre}</span> : null}
            {detail?.analyzedAt ? <MetaTime label="分析于" value={detail.analyzedAt} /> : detail ? <MetaTime label="拆解于" value={detail.task.createdAt} /> : null}
            {analysis?.model ? <span>{modelOptionLabel(config, analysis.model)}</span> : null}
        </>
    );
    const actions = (
        <>
            {analysis && view === "teardown" ? (
                <Popover
                    trigger="click"
                    placement="bottomRight"
                    arrow={false}
                    open={reanalyzeOpen}
                    onOpenChange={setReanalyzeOpen}
                    content={
                        <div className="vr-reanalyze">
                            <p className="vr-reanalyze-title">换个模型重新分析</p>
                            <p className="vr-reanalyze-text">切镜结果不变，只重做逐镜分析和全片结构，按所选模型计费。复刻方案里已经改过的口播和提示词不会被覆盖。</p>
                            <AnalyzeControls
                                config={config}
                                model={model}
                                onModelChange={onModelChange}
                                busy={busy}
                                label="开始重新分析"
                                onStart={() => {
                                    setReanalyzeOpen(false);
                                    onReanalyze(analysis.title);
                                }}
                            />
                        </div>
                    }
                >
                    <Button icon={<RefreshCw className="size-4" />} disabled={busy}>
                        重新分析
                    </Button>
                </Popover>
            ) : null}
            {view === "teardown" ? (
                <Button icon={<Download className="size-4" />} disabled={!analysis || analyzing} onClick={downloadReport}>
                    下载报告
                </Button>
            ) : null}
            {view === "teardown" && analysis ? (
                <Button type="primary" disabled={analyzing} onClick={() => onViewChange("plan")}>
                    下一步：复刻方案
                    <ArrowRight className="size-4" aria-hidden />
                </Button>
            ) : null}
        </>
    );
    const openCanvas = (plan: VideoReplicaPlan) => (analysis ? onOpenCanvas(bundle, analysis, { plan }) : Promise.resolve(null));
    const steps = <ReplicationSteps view={view} bundle={bundle} analysis={analysis} analyzing={analyzing} plan={analysis ? planState.plan : null} planSaved={Boolean(detail?.planUpdatedAt) || planState.save.status === "saved"} onChange={onViewChange} />;

    return (
        <WorkspaceShell title={title} meta={meta} actions={actions} steps={steps} onBack={onBack}>
            {ownRun ? <ReplicationProgress run={ownRun} /> : null}
            {analysis && view === "plan" ? (
                <ReplicationPlan bundle={bundle} analysis={analysis} {...planState} config={config} model={model} onModelChange={onModelChange} opening={opening} onOpenCanvas={openCanvas} onNext={() => onViewChange("canvas")} />
            ) : null}
            {analysis && view === "canvas" ? (
                <ReplicationCanvasStep bundle={bundle} analysis={analysis} {...planState} config={config} model={model} onModelChange={onModelChange} opening={opening} onOpenCanvas={openCanvas} onBack={() => onViewChange("plan")} />
            ) : null}
            {view !== "teardown" ? null : (
                <>
                    {/* 还没有分析、也没在分析（含上次分析失败）时，在这里选模型开始或重试。 */}
                    {!analysis && !analyzing ? (
                        <div className="vr-panel vr-analyze">
                            <div className="vr-analyze-copy">
                                <p className="vr-analyze-title">{ownRun?.error ? "这次分析没有完成" : "镜头已经切好，还差模型分析"}</p>
                                <p className="vr-analyze-text">{ownRun?.error ? "镜头和关键帧都还在，可以直接重试，或换一个能看图的模型再分析。" : "选一个能看图的文本模型，逐镜补全画面、口播、运镜和复刻提示词，按所选模型计费。"}</p>
                            </div>
                            <AnalyzeControls config={config} model={model} onModelChange={onModelChange} busy={busy} label={ownRun?.error ? "重试分析" : "开始分析"} onStart={() => onReanalyze("")} />
                        </div>
                    ) : null}
                    <ReplicationTimeline bundle={bundle} summary={summary} activeIndex={playback.activeIndex} video={playback.video} onPick={playback.playShot} />
                    <div className="vr-ws-body" style={{ "--vr-ratio": `${bundle.source.width || 9} / ${bundle.source.height || 16}` } as CSSProperties}>
                        <ReplicationPlayer bundle={bundle} videoRef={playback.videoRef} />
                        <div className="vr-ws-main">
                            <div className="vr-tabs" role="tablist" aria-label="拆解内容">
                                <button type="button" role="tab" id="vr-tab-shots" className="vr-tab" aria-selected={tab === "shots"} aria-controls="vr-tabpanel" tabIndex={tab === "shots" ? 0 : -1} onClick={() => setTab("shots")} onKeyDown={switchTab}>
                                    逐镜分镜
                                    <span className="vr-tab-count">{bundle.shots.length}</span>
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    id="vr-tab-structure"
                                    className="vr-tab"
                                    aria-selected={tab === "structure"}
                                    aria-controls="vr-tabpanel"
                                    tabIndex={tab === "structure" ? 0 : -1}
                                    onClick={() => setTab("structure")}
                                    onKeyDown={switchTab}
                                >
                                    全片结构
                                </button>
                                <span className="vr-tabs-hint">切点和时间码由程序检测；画面、口播和制作方式是模型判断。</span>
                            </div>
                            {/* 宽屏下这里是分镜和结构自己的滚动区，页面本身不滚。 */}
                            <div id="vr-tabpanel" className="vr-tabpanel" data-vr-scroll role="tabpanel" aria-labelledby={`vr-tab-${tab}`} tabIndex={0}>
                                {tab === "shots" ? (
                                    <ReplicationShots bundle={bundle} rows={rows} activeIndex={playback.activeIndex} playing={playback.playing} onPlay={playback.playShot} onCopy={copy} />
                                ) : summary ? (
                                    <ReplicationStructure bundle={bundle} summary={summary} onPlay={playback.playShot} />
                                ) : (
                                    <StatePanel title="还没有全片结构" description="模型分析完成后，这里会给出开头钩子、节拍结构、吸引人的原因和复刻建议。" />
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </WorkspaceShell>
    );
}

type StepProps = {
    view: ReplicationView;
    bundle: VideoTeardownBundle;
    analysis: Analysis | null;
    analyzing: boolean;
    plan: VideoReplicaPlan | null;
    planSaved: boolean;
    onChange: (view: ReplicationView) => void;
};

/**
 * 工作区顶部的三步：拆解分析 → 复刻方案 → 画布生成。每一步写着现在的进度，点哪一步就切到哪一步；
 * 还没分析完时后两步不能点。
 */
function ReplicationSteps({ view, bundle, analysis, analyzing, plan, planSaved, onChange }: StepProps) {
    const kept = plan ? plan.shots.filter((shot) => shot.treatment !== "skip").length : 0;
    const swapped = plan ? plan.shots.filter((shot) => shot.treatment === "product").length : 0;
    const canvases = plan?.canvases.length || 0;
    const items: { value: ReplicationView; title: string; detail: string; done: boolean; disabled: boolean }[] = [
        { value: "teardown", title: "拆解分析", detail: analyzing ? "正在分析…" : analysis ? `${bundle.shots.length} 个镜头 · 已分析` : `${bundle.shots.length} 个镜头 · 还没分析`, done: Boolean(analysis), disabled: false },
        {
            value: "plan",
            title: "复刻方案",
            detail: !analysis ? "分析完成后可以做" : planSaved && plan ? [plan.product.name || "还没填商品", `${kept} 镜`, swapped ? `换商品 ${swapped} 镜` : ""].filter(Boolean).join(" · ") : "换成你的商品、改写口播",
            done: planSaved && Boolean(plan?.product.name || plan?.activeScriptId),
            disabled: !analysis,
        },
        { value: "canvas", title: "画布生成", detail: !analysis ? "分析完成后可以做" : canvases ? `已建 ${canvases} 块画布` : "首帧、视频、合并成片", done: canvases > 0, disabled: !analysis },
    ];
    return (
        <nav className="vr-stepbar" aria-label="复刻步骤">
            <ol>
                {items.map((item, index) => (
                    <li key={item.value}>
                        <button type="button" className="vr-stepbar-item" aria-current={view === item.value ? "step" : undefined} data-done={item.done || undefined} disabled={item.disabled} onClick={() => onChange(item.value)}>
                            <span className="vr-stepbar-index" aria-hidden>
                                {item.done && view !== item.value ? <Check /> : index + 1}
                            </span>
                            <span className="vr-stepbar-copy">
                                <strong>{item.title}</strong>
                                <small>{item.detail}</small>
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

function AnalyzeControls({ config, model, onModelChange, busy, label, onStart }: { config: AiConfig; model: string; onModelChange: (model: string) => void; busy: boolean; label: string; onStart: () => void }) {
    const modelError = videoTeardownModelError(config, model);
    return (
        <div className="vr-analyze-controls">
            <div className="vr-analyze-model">
                <ModelPicker config={config} capability="text" value={model} onChange={onModelChange} requirements={videoTeardownTextRequirements(config, 1)} fullWidth placeholder="选择能看图的文本模型" />
            </div>
            <Button type="primary" icon={<Sparkles className="size-4" />} disabled={busy || Boolean(modelError)} onClick={onStart}>
                {busy ? "有拆解在进行" : label}
            </Button>
            {modelError ? (
                <p role="alert" className="vr-field-error">
                    {modelError}
                </p>
            ) : null}
        </div>
    );
}

function WorkspaceShell({ title, meta, actions, steps, onBack, children }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; steps?: ReactNode; onBack: () => void; children: ReactNode }) {
    return (
        <div className="vr-workspace">
            <header className="vr-ws-head">
                <div className="vr-ws-heading">
                    <button type="button" className="vr-back" onClick={onBack} aria-label="返回全部拆解" title="返回全部拆解">
                        <ArrowLeft aria-hidden />
                        <span>全部</span>
                    </button>
                    <h1 className="vr-ws-title">{title}</h1>
                    {meta ? <p className="vr-ws-subtitle">{meta}</p> : null}
                </div>
                {actions ? <div className="vr-ws-actions">{actions}</div> : null}
            </header>
            {steps}
            <div className="vr-ws-stack">{children}</div>
        </div>
    );
}

function MetaTime({ label, value }: { label: string; value: string }) {
    return (
        <span>
            {label} <RelativeTime value={value} />
        </span>
    );
}

function StatePanel({ title, description, tone, action }: { title: string; description: string; tone?: "error"; action?: ReactNode }) {
    return (
        <div role={tone === "error" ? "alert" : "status"} className="vr-panel vr-state" data-tone={tone}>
            <p className="vr-state-title">{title}</p>
            <p className="vr-state-text">{description}</p>
            {action ? <div className="vr-state-action">{action}</div> : null}
        </div>
    );
}

function ProcessingSkeleton() {
    return (
        <div className="vr-ws-stack" aria-hidden>
            <div className="vr-panel vr-timeline">
                <span className="vr-skeleton" style={{ display: "block", width: 160, height: 14 }} />
                <span className="vr-skeleton" style={{ display: "block", height: 84, marginTop: 16 }} />
            </div>
            <div className="vr-ws-body">
                <span className="vr-skeleton vr-skeleton-video" />
                <div className="vr-panel vr-shots">
                    {[0, 1, 2].map((item) => (
                        <div key={item} className="vr-shot">
                            <span className="vr-skeleton" style={{ width: 84, height: 148 }} />
                            <span className="flex flex-col gap-3 pt-1">
                                <span className="vr-skeleton" style={{ width: "32%", height: 14 }} />
                                <span className="vr-skeleton" style={{ width: "86%", height: 12 }} />
                                <span className="vr-skeleton" style={{ width: "64%", height: 12 }} />
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function WorkspaceSkeleton({ onBack }: { onBack: () => void }) {
    return (
        <WorkspaceShell
            title={
                <>
                    <span className="sr-only">正在读取拆解记录</span>
                    <span className="vr-skeleton" aria-hidden style={{ display: "block", width: 240, height: 28 }} />
                </>
            }
            onBack={onBack}
        >
            <ProcessingSkeleton />
        </WorkspaceShell>
    );
}
