import { App, Button, Progress, Spin } from "antd";
import { Download, Film, FolderOpen, RefreshCw, Square, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { PRODUCT_VIDEO_ACTIVE, PRODUCT_VIDEO_STATUS_LABEL, type ProductVideoJob } from "@/lib/product-video/job";
import { formatProductVideoSeconds } from "@/lib/product-video/media";
import { isRemakeJob, REMAKE_ACTIVE, REMAKE_STATUS_LABEL, remakeKeptDurationMs, remakeLanguage, type RemakeJob } from "@/lib/remake/job";
import { CREATIVE_SCENES } from "@/lib/remake/creative";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import type { StoredWork } from "@/services/api/product-video";
import type { AiConfig } from "@/stores/use-config-store";
import { productVideoThumbUrl } from "../replace/product-video-assets";
import { isProductVideoRunning, retryProductVideo, stopProductVideo, useProductVideoRuntime } from "../replace/product-video-runner";
import { removeProductVideo } from "../replace/use-product-video-store";
import { formatProductVideoCredits } from "../replace/use-product-video-estimate";
import { isRemakeRunning, stopRemake, useRemakeRuntime } from "./remake-runner";

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function useDownload() {
    const { message } = App.useApp();
    return async (resourceId: string, title: string) => {
        try {
            await downloadBrowserMedia({ fileName: `${title || "复刻成片"}.mp4`, storageKey: resourceStorageKey(resourceId) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        }
    };
}

function useRemove() {
    const { message, modal } = App.useApp();
    return (job: StoredWork) =>
        modal.confirm({
            title: "删除这条作品？",
            content: "只删除作品记录，已上传的素材、生成好的片段和成片仍在素材里。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    if (isRemakeJob(job) && isRemakeRunning(job.id)) await stopRemake(job.id);
                    if (!isRemakeJob(job) && isProductVideoRunning(job.id)) await stopProductVideo(job.id);
                    await removeProductVideo(job.id);
                } catch (error) {
                    message.error(`删除失败：${error instanceof Error ? error.message : "请重试"}`);
                }
            },
        });
}

function RemakeCard({ job, onOpen }: { job: RemakeJob; onOpen: (id: string) => void }) {
    const active = useRemakeRuntime((state) => Boolean(state.active[job.id]));
    const progress = useRemakeRuntime((state) => state.progress[job.id]);
    const download = useDownload();
    const remove = useRemove();
    const busy = active || REMAKE_ACTIVE.includes(job.status);
    const done = job.units.filter((unit) => unit.status === "succeeded").length;
    const cover = job.shots.find((shot) => shot.treatment !== "skip")?.keyframeResourceId || job.product.images[0]?.resourceId;
    return (
        <article className="rw-work" data-status={job.status}>
            <button type="button" className="rw-work-media" onClick={() => onOpen(job.id)} aria-label={`打开 ${job.title}`}>
                {job.render?.resourceId ? (
                    <video src={`${resourceFileUrl(job.render.resourceId)}#t=0.5`} muted playsInline preload="metadata" aria-hidden />
                ) : cover ? (
                    <img src={productVideoThumbUrl(cover)} alt="" loading="lazy" />
                ) : (
                    <Film size={22} aria-hidden />
                )}
                {busy ? (
                    <span className="rw-work-overlay">
                        <Spin size="small" /> {progress?.stage || REMAKE_STATUS_LABEL[job.status]}
                    </span>
                ) : null}
            </button>
            <div className="rw-work-body">
                <div className="rw-work-tags">
                    <span className="rw-tag" data-tone="accent">
                        {job.creative ? CREATIVE_SCENES.find((scene) => scene.id === job.creative!.brief.scene)!.name : "逐镜复刻"}
                    </span>
                    <span className="rw-tag" data-status={job.status}>
                        {REMAKE_STATUS_LABEL[job.status]}
                    </span>
                    {job.variantOf ? (
                        <span className="rw-tag" title={`从「${job.variantOf.title}」复制`}>
                            复制版
                        </span>
                    ) : null}
                    {job.language !== "zh" ? <span className="rw-tag">{remakeLanguage(job.language).label}</span> : null}
                </div>
                <strong className="rw-work-title" title={job.title}>
                    {job.title}
                </strong>
                <span className="rw-work-meta">
                    {[
                        formatTime(job.createdAt),
                        `${job.shots.filter((shot) => shot.treatment !== "skip").length} 镜`,
                        formatProductVideoSeconds(remakeKeptDurationMs(job)),
                        job.credits !== undefined ? `预计 ${formatProductVideoCredits(job.credits)} 积分` : "",
                    ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
                {busy && job.units.length ? <Progress percent={progress?.percent ?? Math.round((done / job.units.length) * 100)} size="small" showInfo={false} /> : null}
                {job.status === "failed" && job.error ? <p className="rw-warn">{job.error}</p> : null}
                <div className="rw-work-actions">
                    <Button size="small" icon={<FolderOpen size={13} />} onClick={() => onOpen(job.id)}>
                        打开
                    </Button>
                    {job.render?.resourceId ? (
                        <Button size="small" icon={<Download size={13} />} onClick={() => void download(job.render!.resourceId!, job.title)}>
                            下载
                        </Button>
                    ) : null}
                    <Button size="small" danger icon={<Trash2 size={13} />} onClick={() => remove(job)}>
                        删除
                    </Button>
                </div>
            </div>
        </article>
    );
}

/** 元素替换的旧作品：只保留看、下载、删除和接着生成。 */
function LegacyCard({ job, config }: { job: ProductVideoJob; config: AiConfig }) {
    const active = useProductVideoRuntime((state) => Boolean(state.active[job.id]));
    const progress = useProductVideoRuntime((state) => state.progress[job.id]);
    const download = useDownload();
    const remove = useRemove();
    const busy = active || PRODUCT_VIDEO_ACTIVE.includes(job.status);
    const frame = job.split?.segments?.[0]?.keyframeResourceId;
    return (
        <article className="rw-work" data-status={job.status}>
            <div className="rw-work-media">
                {job.render?.resourceId ? (
                    <video src={resourceFileUrl(job.render.resourceId)} controls playsInline preload="metadata" aria-label={job.title} />
                ) : frame ? (
                    <img src={productVideoThumbUrl(frame)} alt="" loading="lazy" />
                ) : (
                    <Film size={22} aria-hidden />
                )}
                {busy ? (
                    <span className="rw-work-overlay">
                        <Spin size="small" /> {progress?.stage || PRODUCT_VIDEO_STATUS_LABEL[job.status]}
                    </span>
                ) : null}
            </div>
            <div className="rw-work-body">
                <div className="rw-work-tags">
                    <span className="rw-tag">元素替换（旧版）</span>
                    <span className="rw-tag" data-status={job.status}>
                        {PRODUCT_VIDEO_STATUS_LABEL[job.status]}
                    </span>
                </div>
                <strong className="rw-work-title" title={job.title}>
                    {job.title}
                </strong>
                <span className="rw-work-meta">{[formatTime(job.createdAt), formatProductVideoSeconds(Math.max(0, job.endMs - job.startMs))].join(" · ")}</span>
                {job.status === "failed" && job.error ? <p className="rw-warn">{job.error}</p> : null}
                <div className="rw-work-actions">
                    {busy ? (
                        <Button size="small" icon={<Square size={12} />} onClick={() => void stopProductVideo(job.id)}>
                            停止
                        </Button>
                    ) : null}
                    {job.status === "failed" && !busy ? (
                        <Button size="small" icon={<RefreshCw size={13} />} onClick={() => void retryProductVideo(job.id, config)}>
                            接着生成
                        </Button>
                    ) : null}
                    {job.render?.resourceId ? (
                        <Button size="small" icon={<Download size={13} />} onClick={() => void download(job.render!.resourceId!, job.title)}>
                            下载
                        </Button>
                    ) : null}
                    <Button size="small" danger icon={<Trash2 size={13} />} onClick={() => remove(job)}>
                        删除
                    </Button>
                </div>
            </div>
        </article>
    );
}

export function RemakeWorks({ jobs, status, error, config, onReload, onOpen, onNew }: { jobs: StoredWork[]; status: string; error?: string; config: AiConfig; onReload: () => void; onOpen: (id: string) => void; onNew: () => void }) {
    if (status === "error") return <EmptyState title="作品列表读取失败" description={error} action={<Button onClick={onReload}>重试</Button>} />;
    if (status !== "ready" && !jobs.length)
        return (
            <div className="rw-works-loading" role="status">
                <Spin size="small" /> 正在读取作品…
            </div>
        );
    if (!jobs.length) return <EmptyState icon={Film} title="还没有复刻作品" description="放一条爆款视频，拆解完点「开始复刻」，作品会出现在这里。" action={<Button onClick={onNew}>新建复刻</Button>} />;
    return <div className="rw-works">{jobs.map((job) => (isRemakeJob(job) ? <RemakeCard key={job.id} job={job} onOpen={onOpen} /> : <LegacyCard key={job.id} job={job} config={config} />))}</div>;
}
