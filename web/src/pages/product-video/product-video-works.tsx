import { App, Button, Input, Popover, Progress, Spin } from "antd";
import { ChevronDown, Download, Pencil, Play, RefreshCw, RotateCcw, Square, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { PRODUCT_VIDEO_ACTIVE, PRODUCT_VIDEO_AUDIO_LABEL, PRODUCT_VIDEO_STATUS_LABEL, productVideoProgress, type ProductVideoJob, type ProductVideoShot } from "@/lib/product-video/job";
import { formatProductVideoSeconds } from "@/lib/product-video/media";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { productVideoThumbUrl } from "./product-video-assets";
import { useProductVideoRuntime } from "./product-video-runner";
import { formatProductVideoCredits } from "./use-product-video-estimate";

export type ProductVideoWorkActions = {
    onEdit: (job: ProductVideoJob) => void;
    onRegenerate: (job: ProductVideoJob) => void;
    onDelete: (job: ProductVideoJob) => void;
    onStop: (job: ProductVideoJob) => void;
    onRetry: (job: ProductVideoJob) => void;
    onApprovePreview: (job: ProductVideoJob) => void;
    onRedoShot: (job: ProductVideoJob, index: number, fix: string) => void;
};

function replacedTags(job: ProductVideoJob) {
    return [job.products.length ? "换商品" : "", job.models.length ? "换人" : "", job.backgrounds.length ? "换背景" : ""].filter(Boolean);
}

function cover(job: ProductVideoJob) {
    const frame = job.split?.segments?.[0]?.keyframeResourceId;
    if (frame) return productVideoThumbUrl(frame);
    const image = job.products[0] || job.models[0] || job.backgrounds[0];
    return image ? productVideoThumbUrl(image.resourceId) : "";
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function RedoShot({ job, shot, onRedo }: { job: ProductVideoJob; shot: ProductVideoShot; onRedo: ProductVideoWorkActions["onRedoShot"] }) {
    const [open, setOpen] = useState(false);
    const [fix, setFix] = useState(shot.fix || "");
    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="topRight"
            content={
                <div className="pv-redo">
                    <strong>重做第 {shot.index} 段</strong>
                    <span>写下这一段的问题，只修正它，不重复提交同样的要求。</span>
                    <Input.TextArea value={fix} maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：商品 Logo 变形，保持正面文字清晰；模特转头时脸变了" onChange={(event) => setFix(event.target.value)} />
                    <div className="pv-redo-actions">
                        <Button size="small" onClick={() => setOpen(false)}>
                            取消
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            onClick={() => {
                                setOpen(false);
                                onRedo(job, shot.index, fix);
                            }}
                        >
                            重做这一段
                        </Button>
                    </div>
                </div>
            }
        >
            <Button size="small" icon={<RotateCcw size={13} />}>
                重做
            </Button>
        </Popover>
    );
}

function ShotList({ job, active, actions }: { job: ProductVideoJob; active: boolean; actions: ProductVideoWorkActions }) {
    const segments = job.split?.segments || [];
    if (!segments.length) return null;
    const shots = new Map(job.shots.map((shot) => [shot.index, shot]));
    return (
        <ol className="pv-shots">
            {segments.map((segment) => {
                const shot = shots.get(segment.index);
                return (
                    <li key={segment.index} className="pv-shot" data-status={shot?.status}>
                        <div className="pv-shot-media">
                            {shot?.resourceId ? (
                                // 缩略图太小放不下播放控件：悬停或聚焦时静音循环播放这一段。
                                <video
                                    src={resourceFileUrl(shot.resourceId)}
                                    poster={segment.keyframeResourceId ? productVideoThumbUrl(segment.keyframeResourceId) : undefined}
                                    muted
                                    loop
                                    playsInline
                                    preload="none"
                                    tabIndex={0}
                                    aria-label={`第 ${segment.index} 段生成结果，悬停播放`}
                                    onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)}
                                    onFocus={(event) => void event.currentTarget.play().catch(() => undefined)}
                                    onMouseLeave={(event) => event.currentTarget.pause()}
                                    onBlur={(event) => event.currentTarget.pause()}
                                />
                            ) : segment.keyframeResourceId ? (
                                <img src={productVideoThumbUrl(segment.keyframeResourceId)} alt={`第 ${segment.index} 段参考画面`} loading="lazy" />
                            ) : null}
                        </div>
                        <div className="pv-shot-text">
                            <strong>
                                第 {segment.index} 段 · {formatProductVideoSeconds(segment.durationMs)}
                            </strong>
                            <span>
                                {shot?.status === "succeeded" ? "已生成" : shot?.status === "running" ? "生成中" : shot?.status === "failed" ? shot.error || "没有生成成功" : "等待生成"}
                                {shot && shot.attempt > 1 ? ` · 第 ${shot.attempt} 次` : ""}
                            </span>
                            {shot?.fix ? <span className="pv-shot-fix">修正：{shot.fix}</span> : null}
                        </div>
                        {shot && !active && shot.status !== "running" && job.status !== "assembling" ? <RedoShot job={job} shot={shot} onRedo={actions.onRedoShot} /> : null}
                    </li>
                );
            })}
        </ol>
    );
}

function WorkCard({ job, actions }: { job: ProductVideoJob; actions: ProductVideoWorkActions }) {
    const { message } = App.useApp();
    const active = useProductVideoRuntime((state) => Boolean(state.active[job.id]));
    const progress = useProductVideoRuntime((state) => state.progress[job.id]);
    const [expanded, setExpanded] = useState(false);
    const busy = active || PRODUCT_VIDEO_ACTIVE.includes(job.status);
    const counts = productVideoProgress(job);
    const result = job.render?.resourceId;
    const poster = cover(job);
    const lengthMs = job.endMs - job.startMs;

    const download = async () => {
        if (!result) return;
        try {
            await downloadBrowserMedia({ fileName: `${job.title || "商品视频"}.mp4`, storageKey: resourceStorageKey(result) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        }
    };

    return (
        <article className="pv-work" data-status={job.status}>
            <div className="pv-work-media">
                {result ? (
                    <video src={resourceFileUrl(result)} poster={poster || undefined} controls playsInline preload="metadata" aria-label={`${job.title} 成片`} />
                ) : poster ? (
                    <img src={poster} alt="" loading="lazy" />
                ) : (
                    <Video size={22} aria-hidden />
                )}
                {busy && !result ? (
                    <div className="pv-work-overlay" role="status">
                        <Spin size="small" />
                        <span>{progress?.stage || PRODUCT_VIDEO_STATUS_LABEL[job.status]}</span>
                    </div>
                ) : null}
            </div>
            <div className="pv-work-body">
                <div className="pv-work-tags">
                    <span className="pv-tag" data-tone="accent">
                        组合替换
                    </span>
                    {replacedTags(job).map((tag) => (
                        <span key={tag} className="pv-tag">
                            {tag}
                        </span>
                    ))}
                    <span className="pv-tag" data-status={job.status}>
                        {PRODUCT_VIDEO_STATUS_LABEL[job.status]}
                    </span>
                </div>
                <strong className="pv-work-title" title={job.title}>
                    {job.title}
                </strong>
                <span className="pv-work-meta">
                    {[formatTime(job.createdAt), lengthMs > 0 ? formatProductVideoSeconds(lengthMs) : "", PRODUCT_VIDEO_AUDIO_LABEL[job.audio], job.credits !== undefined ? `预计 ${formatProductVideoCredits(job.credits)} 积分` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
                {busy && counts.total ? (
                    <div className="pv-work-progress">
                        <Progress percent={progress?.percent ?? Math.round((counts.done / counts.total) * 100)} size="small" showInfo={false} />
                        <span>
                            {counts.done}/{counts.total} 段
                        </span>
                    </div>
                ) : null}
                {job.status === "previewed" ? <p className="pv-work-note">第一段预览已生成，满意的话继续生成其余 {Math.max(0, counts.total - counts.done)} 段并拼成片。</p> : null}
                {job.status === "failed" && job.error ? <p className="pv-work-error">{job.error}</p> : null}
                {job.split?.warnings?.length ? <p className="pv-work-note">{job.split.warnings.join("；")}</p> : null}
                <div className="pv-work-actions">
                    {busy ? (
                        <Button size="small" icon={<Square size={12} />} onClick={() => actions.onStop(job)}>
                            停止
                        </Button>
                    ) : null}
                    {job.status === "previewed" && !busy ? (
                        <Button size="small" type="primary" icon={<Play size={13} />} onClick={() => actions.onApprovePreview(job)}>
                            继续生成
                        </Button>
                    ) : null}
                    {job.status === "failed" && !busy ? (
                        <Button size="small" icon={<RefreshCw size={13} />} onClick={() => actions.onRetry(job)}>
                            接着生成
                        </Button>
                    ) : null}
                    <Button size="small" icon={<Pencil size={13} />} onClick={() => actions.onEdit(job)}>
                        编辑
                    </Button>
                    <Button size="small" icon={<RotateCcw size={13} />} disabled={!job.reference} onClick={() => actions.onRegenerate(job)}>
                        再次生成
                    </Button>
                    {result ? (
                        <Button size="small" icon={<Download size={13} />} onClick={() => void download()}>
                            下载
                        </Button>
                    ) : null}
                    <Button size="small" danger icon={<Trash2 size={13} />} onClick={() => actions.onDelete(job)} aria-label={`删除 ${job.title}`}>
                        删除
                    </Button>
                </div>
                {job.split?.segments?.length ? (
                    <button type="button" className="pv-work-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                        <ChevronDown size={14} aria-hidden />
                        {expanded ? "收起分段" : `查看 ${job.split.segments.length} 个分段`}
                    </button>
                ) : null}
                {expanded ? <ShotList job={job} active={busy} actions={actions} /> : null}
            </div>
        </article>
    );
}

export function ProductVideoWorks({ jobs, status, error, onReload, actions }: { jobs: ProductVideoJob[]; status: "idle" | "loading" | "ready" | "error"; error?: string; onReload: () => void; actions: ProductVideoWorkActions }) {
    return (
        <section className="pv-works" aria-label="视频作品">
            <header className="pv-works-head">
                <h2>视频作品</h2>
                <span>{jobs.length ? `${jobs.length} 条` : ""}</span>
            </header>
            <div className="pv-works-scroll">
                {status === "error" ? (
                    <EmptyState size="compact" title="作品列表读取失败" description={error} action={<Button onClick={onReload}>重试</Button>} />
                ) : status !== "ready" && !jobs.length ? (
                    <div className="pv-works-loading" role="status">
                        <Spin size="small" /> 正在读取作品…
                    </div>
                ) : !jobs.length ? (
                    <EmptyState size="compact" icon={Video} title="还没有视频作品" description="放好素材和参考视频，点「开始生成」，作品会出现在这里。" />
                ) : (
                    jobs.map((job) => <WorkCard key={job.id} job={job} actions={actions} />)
                )}
            </div>
        </section>
    );
}
