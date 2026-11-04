import { App, Button, Progress, Skeleton } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, Download, LayoutPanelLeft, Play, RefreshCw } from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";

import { formatTeardownTime, orientationLabel, readVideoReplicationAnalysis, teardownTimeRange, videoTeardownReportMarkdown, videoTeardownStoryboardRows, type VideoTeardownAnalysis, type VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
import { cn } from "@/lib/utils";
import { resourceFileUrl } from "@/services/api/resources";
import { parseVideoTeardownBundle, type VideoReplicationDetail, type VideoTeardownBundle, type VideoTeardownShot } from "@/services/api/video-replication";
import { ReplicationProgress } from "./replication-progress";
import type { ReplicationRun } from "./use-replication-runner";

type Props = {
    detail: VideoReplicationDetail | undefined;
    loading: boolean;
    error: string;
    /** 当前页面正在跑的拆解，只在属于这条记录时显示进度。 */
    run: ReplicationRun | null;
    busy: boolean;
    opening: boolean;
    /** 模型 ID 换成界面上的显示名。 */
    modelLabel: (model: string) => string;
    onReanalyze: (fallbackTitle: string) => void;
    onOpenCanvas: (bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis & { model: string }) => void;
};

const DIALOGUE_SOURCE_LABELS: Record<VideoTeardownAnalysisRow["dialogueSource"], string> = { asr: "语音转写", subtitle: "画面字幕", none: "" };

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

const shotAnchor = (index: number) => `replication-shot-${index}`;

/** 一条拆解记录：头部（原视频、信息、操作）、镜头条、全片结构和逐镜卡片；拆解未完成或没分析时给出对应状态。 */
export function ReplicationResult({ detail, loading, error, run, busy, opening, modelLabel, onReanalyze, onOpenCanvas }: Props) {
    const { message } = App.useApp();
    const videoRef = useRef<HTMLVideoElement>(null);
    const { bundle, error: bundleError } = useMemo(() => parseBundle(detail), [detail]);
    const analysis = useMemo(() => (bundle ? readVideoReplicationAnalysis(detail?.analysis, bundle.shots.length) : null), [bundle, detail?.analysis]);
    const ownRun = run && detail && run.id === detail.task.id ? run : null;

    if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
    if (error) return <StateCard tone="error" title="读取拆解记录失败" description={error} />;
    if (!detail) return null;
    const task = detail.task;
    if (task.status === "queued" || task.status === "running") {
        return ownRun ? (
            <ReplicationProgress run={ownRun} />
        ) : (
            <StateCard title="正在拆解" description={task.stage || "排队中"}>
                <Progress percent={Math.round(Math.min(Math.max(task.progress || 0, 0), 100))} size="small" />
            </StateCard>
        );
    }
    if (task.status !== "succeeded") return <StateCard tone="error" title={task.status === "cancelled" ? "拆解已取消" : "拆解失败"} description={task.error || "请换一个视频再试"} />;
    if (!bundle) return <StateCard tone="error" title="拆解结果无法读取" description={bundleError || "请重新拆解这个视频"} />;

    const title = analysis?.title || "未命名拆解";
    const copy = (text: string) => {
        if (!text) return;
        copyToClipboard(text);
        message.success("已复制");
    };
    const downloadReport = () => {
        if (!analysis) return;
        downloadText(`${title}-拆解报告.md`, videoTeardownReportMarkdown(bundle, analysis, videoTeardownStoryboardRows(bundle, analysis.rows)));
    };
    // 点关键帧：原视频跳到这一镜开头播放，并把播放器带回视野。
    const playShot = (shot: VideoTeardownShot) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = shot.startMs / 1000;
        void video.play().catch(() => undefined);
        video.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    const jumpToShot = (shot: VideoTeardownShot) => document.getElementById(shotAnchor(shot.index))?.scrollIntoView({ behavior: "smooth", block: "start" });
    const rows = new Map(analysis?.rows.map((row) => [row.shotNumber, row]));
    const { source } = bundle;
    const analyzing = Boolean(ownRun && !ownRun.error);
    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-4 rounded-[var(--r-lg)] border border-border bg-card p-4 md:flex-row">
                <video ref={videoRef} src={resourceFileUrl(source.resourceId)} controls preload="metadata" className="max-h-80 w-full shrink-0 rounded-[var(--r-md)] bg-black object-contain md:w-52" aria-label="原视频" />
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div>
                        <h2 className="text-xl font-semibold leading-8">{title}</h2>
                        {analysis?.summary?.genre ? <p className="mt-0.5 text-sm text-muted-foreground">{analysis.summary.genre}</p> : null}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                        <Fact label="时长" value={`${(source.durationMs / 1000).toFixed(1)} 秒`} />
                        <Fact label="镜头" value={`${bundle.shots.length} 个`} />
                        <Fact label="画幅" value={`${source.width}×${source.height} ${orientationLabel(source.width, source.height)}`} />
                        <Fact label="口播" value={bundle.transcript.source === "asr" ? "语音转写" : "画面字幕"} />
                    </dl>
                    {analysis?.model ? <p className="text-xs text-muted-foreground">{`分析模型：${modelLabel(analysis.model)}`}</p> : null}
                    <div className="flex flex-wrap gap-2">
                        <Button type="primary" icon={<LayoutPanelLeft className="size-4" />} disabled={!analysis || analyzing} loading={opening} onClick={() => analysis && onOpenCanvas(bundle, analysis)}>
                            在画布中打开
                        </Button>
                        <Button icon={<Download className="size-4" />} disabled={!analysis || analyzing} onClick={downloadReport}>
                            下载报告
                        </Button>
                        <Button icon={<RefreshCw className="size-4" />} disabled={busy} onClick={() => onReanalyze(analysis?.title || "")}>
                            {analysis ? "重新分析" : "开始分析"}
                        </Button>
                    </div>
                    {!analysis && !ownRun ? <p className="text-sm text-muted-foreground">镜头已经切好，还没有模型分析。选好分析模型后点「开始分析」。</p> : null}
                    {bundle.warnings.length ? (
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                            {bundle.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            </header>
            {ownRun ? <ReplicationProgress run={ownRun} /> : null}
            <ShotStrip bundle={bundle} onPick={jumpToShot} />
            {analysis?.summary ? <SummarySection bundle={bundle} analysis={analysis} /> : null}
            <section className="flex flex-col gap-3" aria-label="拆解分镜表">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                    <h3 className="text-base font-semibold">逐镜拆解</h3>
                    <p className="text-xs text-muted-foreground">切点和时间码由程序检测；画面、口播和制作方式是模型判断。点关键帧从这一镜开始播放。</p>
                </div>
                {bundle.shots.map((shot) => (
                    <ShotCard key={shot.index} shot={shot} row={rows.get(shot.index)} onPlay={playShot} onCopy={copy} />
                ))}
            </section>
        </div>
    );
}

/** 镜头条：全部关键帧按顺序排开，宽度按时长分配（有最小宽度），点一下跳到对应的镜头卡片。 */
function ShotStrip({ bundle, onPick }: { bundle: VideoTeardownBundle; onPick: (shot: VideoTeardownShot) => void }) {
    return (
        <nav aria-label="镜头条" className="overflow-x-auto rounded-[var(--r-lg)] border border-border bg-card p-3">
            <ol className="flex min-w-full gap-1.5">
                {bundle.shots.map((shot) => (
                    <li key={shot.index} style={{ flexGrow: shot.endMs - shot.startMs }} className="min-w-14 basis-0">
                        <button
                            type="button"
                            onClick={() => onPick(shot)}
                            title={`镜头 ${shot.index} · ${teardownTimeRange(shot)}`}
                            className="group flex w-full flex-col gap-1 rounded-[var(--r-sm)] text-left focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                            <span className="relative block h-16 w-full overflow-hidden rounded-[var(--r-sm)] bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-border after:ring-inset">
                                <img src={resourceFileUrl(shot.keyframeResourceId)} alt="" loading="lazy" className="size-full object-cover transition-opacity group-hover:opacity-80" />
                            </span>
                            <span className="truncate text-[11px] tabular-nums text-muted-foreground">{`${shot.index} · ${formatTeardownTime(shot.startMs)}`}</span>
                        </button>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

function ShotCard({ shot, row, onPlay, onCopy }: { shot: VideoTeardownShot; row: VideoTeardownAnalysisRow | undefined; onPlay: (shot: VideoTeardownShot) => void; onCopy: (text: string) => void }) {
    const tags = [row?.shotSize, row?.motion, row?.production ? `${row.production}${row.productionConfidence ? `（把握${row.productionConfidence}）` : ""}` : "", shot.boundary === "split" ? "长镜头切开" : ""].filter(Boolean);
    const mood = [row?.lightingAndAtmosphere, row?.emotion].filter(Boolean).join("；");
    return (
        <article id={shotAnchor(shot.index)} className="scroll-mt-4 rounded-[var(--r-lg)] border border-border bg-card p-4">
            <div className="flex flex-col gap-4 sm:flex-row">
                <button
                    type="button"
                    onClick={() => onPlay(shot)}
                    aria-label={`从镜头 ${shot.index} 开始播放`}
                    className="group relative h-40 w-full shrink-0 overflow-hidden rounded-[var(--r-md)] bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-border after:ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-28"
                >
                    <img src={resourceFileUrl(shot.keyframeResourceId)} alt={`镜头 ${shot.index} 关键帧`} loading="lazy" className="size-full object-contain" />
                    <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100" aria-hidden>
                        <Play className="size-6" />
                    </span>
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h4 className="text-base font-semibold">{`镜头 ${shot.index}`}</h4>
                        <span className="text-sm tabular-nums text-muted-foreground">{`${teardownTimeRange(shot)} · ${((shot.endMs - shot.startMs) / 1000).toFixed(1)} 秒`}</span>
                        {tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/75">
                                {tag}
                            </span>
                        ))}
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                        <div className="flex flex-col gap-2 text-sm leading-6">
                            <p>{row?.plotDescription || "还没有模型分析"}</p>
                            {row?.camera ? <Detail label="镜头设计">{row.camera}</Detail> : null}
                            {row?.dialogue ? <Detail label={`口播${DIALOGUE_SOURCE_LABELS[row.dialogueSource] ? `（${DIALOGUE_SOURCE_LABELS[row.dialogueSource]}）` : ""}`}>{row.dialogue}</Detail> : null}
                            {row?.onScreenText ? <Detail label="画面文字">{row.onScreenText}</Detail> : null}
                            {mood ? <Detail label="光影情绪">{mood}</Detail> : null}
                            {row?.audioEffects ? <Detail label="声音线索">{row.audioEffects}</Detail> : null}
                        </div>
                        {row?.imageGenerationPrompt || row?.videoMotionPrompt ? (
                            <div className="flex flex-col gap-2 rounded-[var(--r-md)] bg-muted/60 p-3">
                                <PromptLine label="首帧提示词" text={row?.imageGenerationPrompt || ""} onCopy={onCopy} />
                                <PromptLine label="视频提示词" text={row?.videoMotionPrompt || ""} onCopy={onCopy} />
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </article>
    );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
    return (
        <p className="text-sm leading-6">
            <span className="mr-2 text-xs text-muted-foreground">{label}</span>
            {children}
        </p>
    );
}

function PromptLine({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string) => void }) {
    if (!text) return null;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                <button
                    type="button"
                    aria-label={`复制${label}`}
                    title={`复制${label}`}
                    onClick={() => onCopy(text)}
                    className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2"
                >
                    <Copy className="size-3.5" />
                </button>
            </div>
            <p className="text-xs leading-5">{text}</p>
        </div>
    );
}

function SummarySection({ bundle, analysis }: { bundle: VideoTeardownBundle; analysis: VideoTeardownAnalysis }) {
    const summary = analysis.summary;
    if (!summary) return null;
    const beatTime = (shots: number[]) => {
        const first = bundle.shots[shots[0] - 1];
        const last = bundle.shots[shots[shots.length - 1] - 1];
        return first && last ? `${formatTeardownTime(first.startMs)}–${formatTeardownTime(last.endMs)}` : "";
    };
    return (
        <section className="flex flex-col gap-5 rounded-[var(--r-lg)] border border-border bg-card p-4 sm:p-5" aria-label="全片结构">
            {summary.hook ? (
                <div className="border-l-2 border-primary pl-3">
                    <h3 className="text-xs font-medium text-muted-foreground">钩子</h3>
                    <p className="mt-1 text-base leading-7">{summary.hook}</p>
                </div>
            ) : null}
            {summary.beats.length ? (
                <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">节拍</h3>
                    <ol className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                        {summary.beats.map((beat, index) => (
                            <li key={`${beat.name}-${index}`} className="flex flex-col gap-1 rounded-[var(--r-md)] bg-muted/60 p-3">
                                <span className="flex items-baseline justify-between gap-2">
                                    <span className="text-sm font-medium">{beat.name}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{beatTime(beat.shots)}</span>
                                </span>
                                <span className="text-xs leading-5 text-muted-foreground">{beat.purpose}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            ) : null}
            <div className={cn("grid gap-5", (summary.whyItWorks.length || summary.music || summary.textStyle) && summary.replicationTips.length ? "lg:grid-cols-2" : "")}>
                {summary.whyItWorks.length || summary.music || summary.textStyle ? (
                    <div className="flex flex-col gap-4">
                        {summary.whyItWorks.length ? <SummaryList title="为什么能吸引人" items={summary.whyItWorks} /> : null}
                        {summary.music || summary.textStyle ? <SummaryList title="声音与花字" items={[summary.music ? `节奏与配乐：${summary.music}` : "", summary.textStyle ? `字幕与花字：${summary.textStyle}` : ""].filter(Boolean)} /> : null}
                    </div>
                ) : null}
                {summary.replicationTips.length ? <SummaryList title="复刻建议" items={summary.replicationTips} /> : null}
            </div>
        </section>
    );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
    return (
        <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">{title}</h3>
            <ul className="list-disc space-y-1 pl-4 text-sm leading-6">
                {items.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                ))}
            </ul>
        </div>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate">{value}</dd>
        </div>
    );
}

function StateCard({ title, description, tone, children }: { title: string; description: string; tone?: "error"; children?: ReactNode }) {
    return (
        <div role={tone === "error" ? "alert" : "status"} className="flex flex-col gap-2 rounded-[var(--r-lg)] border border-border bg-card p-6">
            <h2 className={tone === "error" ? "text-base font-semibold text-destructive" : "text-base font-semibold"}>{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
            {children}
        </div>
    );
}
