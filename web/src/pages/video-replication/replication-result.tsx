import { App, Button, Progress, Skeleton } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, Download, LayoutPanelLeft, RefreshCw } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { formatTeardownTime, orientationLabel, readVideoReplicationAnalysis, teardownTimeRange, videoTeardownReportMarkdown, videoTeardownStoryboardRows, type VideoTeardownAnalysis, type VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
import { resourceFileUrl } from "@/services/api/resources";
import { parseVideoTeardownBundle, type VideoReplicationDetail, type VideoTeardownBundle, type VideoTeardownShot } from "@/services/api/video-replication";
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

const DIALOGUE_SOURCE_LABELS: Record<VideoTeardownAnalysisRow["dialogueSource"], string> = { asr: "转写", subtitle: "字幕", none: "" };

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

/** 一条拆解记录：头部信息与操作、全片结构、逐镜分镜表；拆解未完成或没分析时给出对应状态。 */
export function ReplicationResult({ detail, loading, error, run, busy, opening, modelLabel, onReanalyze, onOpenCanvas }: Props) {
    const { message } = App.useApp();
    const { bundle, error: bundleError } = useMemo(() => parseBundle(detail), [detail]);
    const analysis = useMemo(() => (bundle ? readVideoReplicationAnalysis(detail?.analysis, bundle.shots.length) : null), [bundle, detail?.analysis]);
    const ownRun = run && detail && run.id === detail.task.id ? run : null;

    if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
    if (error) return <StateCard tone="error" title="读取拆解记录失败" description={error} />;
    if (!detail) return null;
    const task = detail.task;
    if (task.status === "queued" || task.status === "running") {
        return (
            <StateCard title={ownRun?.step || "正在拆解"} description={ownRun?.detail || task.stage || "排队中"}>
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
    const rows = new Map(analysis?.rows.map((row) => [row.shotNumber, row]));
    const { source } = bundle;
    return (
        <div className="flex flex-col gap-4">
            <header className="flex flex-col gap-4 rounded-[var(--r-lg)] border border-border bg-card p-4 md:flex-row">
                <video src={resourceFileUrl(source.resourceId)} controls preload="metadata" className="max-h-72 w-full shrink-0 rounded-[var(--r-md)] bg-black object-contain md:w-56" aria-label="原视频" />
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div>
                        <h2 className="text-lg font-semibold leading-7">{title}</h2>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <Chip>{`${(source.durationMs / 1000).toFixed(1)} 秒`}</Chip>
                            <Chip>{`${bundle.shots.length} 个镜头`}</Chip>
                            <Chip>{`${source.width}×${source.height} ${orientationLabel(source.width, source.height)}`}</Chip>
                            <Chip>{bundle.transcript.source === "asr" ? "口播来自语音转写" : "口播来自画面字幕"}</Chip>
                            {analysis?.model ? <Chip>{`分析模型 ${modelLabel(analysis.model)}`}</Chip> : null}
                            {analysis?.summary?.genre ? <Chip>{analysis.summary.genre}</Chip> : null}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button type="primary" icon={<LayoutPanelLeft className="size-4" />} disabled={!analysis} loading={opening} onClick={() => analysis && onOpenCanvas(bundle, analysis)}>
                            在画布中打开
                        </Button>
                        <Button icon={<Download className="size-4" />} disabled={!analysis} onClick={downloadReport}>
                            下载报告
                        </Button>
                        <Button icon={<RefreshCw className="size-4" />} disabled={busy} onClick={() => onReanalyze(analysis?.title || "")}>
                            {analysis ? "重新分析" : "开始分析"}
                        </Button>
                    </div>
                    {ownRun ? (
                        <p role={ownRun.error ? "alert" : "status"} className={ownRun.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                            {ownRun.error ? `分析失败：${ownRun.error}` : `${ownRun.step}${ownRun.detail ? ` · ${ownRun.detail}` : ""}`}
                        </p>
                    ) : null}
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
            {analysis?.summary ? <SummarySection bundle={bundle} analysis={analysis} /> : null}
            <section className="rounded-[var(--r-lg)] border border-border bg-card" aria-label="拆解分镜表">
                <h3 className="px-4 pt-4 text-base font-semibold">拆解分镜表</h3>
                <p className="px-4 pt-1 text-xs text-muted-foreground">切点和时间码由程序检测；画面、口播和制作方式是模型判断。</p>
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr className="border-y border-border">
                                <th className="w-40 px-4 py-2 font-medium">镜头</th>
                                <th className="px-3 py-2 font-medium">画面</th>
                                <th className="w-48 px-3 py-2 font-medium">口播</th>
                                <th className="w-48 px-3 py-2 font-medium">镜头语言</th>
                                <th className="w-32 px-3 py-2 font-medium">制作方式</th>
                                <th className="w-64 px-3 py-2 font-medium">复刻提示词</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bundle.shots.map((shot) => (
                                <ShotRow key={shot.index} shot={shot} row={rows.get(shot.index)} onCopy={copy} />
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function ShotRow({ shot, row, onCopy }: { shot: VideoTeardownShot; row: VideoTeardownAnalysisRow | undefined; onCopy: (text: string) => void }) {
    const language = [row?.shotSize, row?.camera, row?.motion].filter(Boolean);
    const mood = [row?.lightingAndAtmosphere, row?.emotion].filter(Boolean).join("；");
    return (
        <tr className="border-b border-border align-top last:border-b-0">
            <td className="px-4 py-3">
                <div className="flex gap-3">
                    <img src={resourceFileUrl(shot.keyframeResourceId)} alt={`镜头 ${shot.index} 关键帧`} loading="lazy" className="h-24 w-auto max-w-[5.5rem] shrink-0 rounded-[var(--r-sm)] bg-muted object-contain" />
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        <span className="text-sm font-semibold text-foreground">{shot.index}</span>
                        <span className="tabular-nums">{teardownTimeRange(shot)}</span>
                        <span className="tabular-nums">{`${((shot.endMs - shot.startMs) / 1000).toFixed(1)} 秒`}</span>
                        {shot.boundary === "split" ? <span>长镜头切开</span> : null}
                    </div>
                </div>
            </td>
            <td className="px-3 py-3">
                <p className="leading-6">{row?.plotDescription || "—"}</p>
                {row?.onScreenText ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{`画面文字：${row.onScreenText}`}</p> : null}
                {mood ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{mood}</p> : null}
            </td>
            <td className="px-3 py-3">
                <p className="leading-6">{row?.dialogue || "—"}</p>
                {row?.dialogue && DIALOGUE_SOURCE_LABELS[row.dialogueSource] ? <p className="mt-1 text-xs text-muted-foreground">{`来自${DIALOGUE_SOURCE_LABELS[row.dialogueSource]}`}</p> : null}
            </td>
            <td className="px-3 py-3 leading-6">{language.length ? language.join(" · ") : "—"}</td>
            <td className="px-3 py-3 leading-6">
                {row?.production || "—"}
                {row?.production && row.productionConfidence ? <span className="block text-xs text-muted-foreground">{`把握${row.productionConfidence}`}</span> : null}
            </td>
            <td className="px-3 py-3">
                <PromptLine label="首帧" text={row?.imageGenerationPrompt || ""} onCopy={onCopy} />
                <PromptLine label="视频" text={row?.videoMotionPrompt || ""} onCopy={onCopy} />
            </td>
        </tr>
    );
}

function PromptLine({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string) => void }) {
    if (!text) return null;
    return (
        <div className="mb-2 flex items-start gap-1.5 last:mb-0">
            <span className="mt-0.5 shrink-0 rounded-[var(--r-xs)] bg-muted px-1.5 text-xs text-muted-foreground">{label}</span>
            <p className="min-w-0 flex-1 text-xs leading-5">{text}</p>
            <button
                type="button"
                aria-label={`复制${label}提示词`}
                title={`复制${label}提示词`}
                onClick={() => onCopy(text)}
                className="grid size-6 shrink-0 place-items-center rounded-[var(--r-sm)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2"
            >
                <Copy className="size-3.5" />
            </button>
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
        <section className="grid gap-4 rounded-[var(--r-lg)] border border-border bg-card p-4 lg:grid-cols-2" aria-label="全片结构">
            {summary.hook ? <SummaryBlock title="钩子">{summary.hook}</SummaryBlock> : null}
            {summary.beats.length ? (
                <SummaryBlock title="节拍">
                    <ol className="flex flex-col gap-1.5">
                        {summary.beats.map((beat, index) => (
                            <li key={`${beat.name}-${index}`} className="flex gap-2">
                                <span className="shrink-0 font-medium">{beat.name}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">{beatTime(beat.shots)}</span>
                                <span className="min-w-0 text-muted-foreground">{beat.purpose}</span>
                            </li>
                        ))}
                    </ol>
                </SummaryBlock>
            ) : null}
            {summary.whyItWorks.length ? <SummaryList title="为什么能吸引人" items={summary.whyItWorks} /> : null}
            {summary.replicationTips.length ? <SummaryList title="复刻建议" items={summary.replicationTips} /> : null}
            {summary.music || summary.textStyle ? (
                <SummaryBlock title="声音与花字">
                    {summary.music ? <p>{`节奏与配乐：${summary.music}`}</p> : null}
                    {summary.textStyle ? <p>{`字幕与花字：${summary.textStyle}`}</p> : null}
                </SummaryBlock>
            ) : null}
        </section>
    );
}

function SummaryBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">{title}</h3>
            <div className="flex flex-col gap-1 text-sm leading-6">{children}</div>
        </div>
    );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
    return (
        <SummaryBlock title={title}>
            <ul className="list-disc space-y-1 pl-4">
                {items.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                ))}
            </ul>
        </SummaryBlock>
    );
}

function Chip({ children }: { children: ReactNode }) {
    return <span className="max-w-full truncate rounded-full bg-muted px-2 py-1 text-foreground/70">{children}</span>;
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
