import { Button, Tooltip } from "antd";
import { Box, Download, Images, LoaderCircle, Maximize2, PencilLine, RefreshCw, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { cn } from "@/lib/utils";
import type { InteriorImageRef, InteriorProjectDocument, InteriorRound, InteriorRoundItem } from "@/services/api/interior";
import { TaskSettlement } from "@/components/generation-cost-notice";
import { interiorImageUrl } from "./interior-models";

export type InteriorOutputTarget = { round: InteriorRound; item: InteriorRoundItem; output: InteriorImageRef; index: number };

type BoardProps = {
    document: InteriorProjectDocument;
    stalled: Record<string, string>;
    busy: boolean;
    downloadingRound: string;
    onRetryWatch: (taskId: string) => void;
    onOpen: (target: InteriorOutputTarget) => void;
    onDownload: (target: InteriorOutputTarget) => void;
    onDownloadRound: (round: InteriorRound) => void;
    onContinue: (target: InteriorOutputTarget) => void;
    /** 用这张效果图生成 3D 模型。 */
    onTo3D: (target: InteriorOutputTarget) => void;
    onReuse: (round: InteriorRound, styleKey?: string) => void;
    onDeleteRound: (round: InteriorRound) => void;
};

function roundTime(value: string) {
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? "" : time.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function roundOutputCount(round: InteriorRound) {
    return round.items.reduce((total, item) => total + (item.status === "succeeded" ? item.outputs.length : 0), 0);
}

/** 卡片按原图的比例排，生成中的占位和结果一样大，图出来时不跳。 */
function aspectOf(image: InteriorImageRef) {
    return image.width && image.height ? `${image.width} / ${image.height}` : "4 / 3";
}

/** 已经等了多久（每秒刷新）；图一般要几十秒，给个数让人知道还在跑。 */
function Elapsed({ since }: { since: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
    return <span className="itd-card-elapsed">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
}

type ItemProps = {
    round: InteriorRound;
    item: InteriorRoundItem;
    stalled?: string;
    busy: boolean;
    onRetryWatch: (taskId: string) => void;
    onReuse: (round: InteriorRound, styleKey?: string) => void;
};

/** 还没出图的风格：生成中是带计时的占位，失败和查询中断给出原因和下一步。 */
function PendingCard({ round, item, stalled, busy, onRetryWatch, onReuse, index }: ItemProps & { index: number }) {
    const label = item.styleName || round.modeName;
    if (item.status === "failed") {
        return (
            <div className="itd-card is-failed" role="group" aria-label={`${label}：生成失败`}>
                <TriangleAlert className="size-5" aria-hidden />
                <strong>{label} 没有生成出来</strong>
                <span title={item.error}>{item.error || "生成失败"}</span>
                <Button size="small" icon={<RotateCcw className="size-3.5" aria-hidden />} disabled={busy} onClick={() => onReuse(round, item.styleKey)}>
                    用这组设置重试
                </Button>
            </div>
        );
    }
    if (stalled && item.taskId) {
        return (
            <div className="itd-card is-failed is-warning" role="group" aria-label={`${label}：查询中断`}>
                <RefreshCw className="size-5" aria-hidden />
                <strong>结果查询中断</strong>
                <span>图可能已经生成好了，重新查询一下</span>
                <Button size="small" onClick={() => onRetryWatch(item.taskId!)}>
                    重新查询
                </Button>
            </div>
        );
    }
    return (
        <div className="itd-card is-pending" role="status" aria-label={`${label}：生成中`}>
            <span className="itd-card-shimmer" aria-hidden />
            <span className="itd-card-badge">{round.count > 1 ? `${label} · ${index + 1}` : label}</span>
            <span className="itd-card-progress">
                <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                生成中
                <Elapsed since={round.createdAt} />
            </span>
        </div>
    );
}

export function InteriorBoard({ document, stalled, busy, downloadingRound, onRetryWatch, onOpen, onDownload, onDownloadRound, onContinue, onTo3D, onReuse, onDeleteRound }: BoardProps) {
    if (!document.rounds.length) {
        return <EmptyState icon={Images} title="还没有效果图" description="上传一张房间照片，选好空间和风格，就能生成装修效果图。也可以直接按 Ctrl+V 粘贴图片。" className="itd-empty" />;
    }
    return (
        <div className="itd-rounds">
            {document.rounds.map((round) => {
                const outputCount = roundOutputCount(round);
                const pending = round.items.filter((item) => item.status === "pending").length;
                const failed = round.items.filter((item) => item.status === "failed").length;
                const styles = round.items.map((item) => item.styleName).filter(Boolean);
                const meta = [round.roomName, styles.length > 1 ? `${styles.length} 个风格对比` : styles[0], round.count > 1 ? `每个 ${round.count} 张` : "", round.size, round.model].filter(Boolean);
                return (
                    <article key={round.id} className="itd-round" style={{ ["--itd-aspect" as string]: aspectOf(round.source) } as CSSProperties}>
                        <header className="itd-round-head">
                            <div className="itd-round-title">
                                <strong>{round.modeName}</strong>
                                <span className={cn("itd-round-state", pending ? "is-pending" : failed ? "is-failed" : "is-done")}>{pending ? `${pending} 个生成中` : failed ? `${failed} 个失败` : `${outputCount} 张`}</span>
                                <span className="itd-round-time">{roundTime(round.createdAt)}</span>
                            </div>
                            <div className="itd-round-actions">
                                <Button size="small" type="text" icon={<RotateCcw className="size-3.5" aria-hidden />} disabled={busy} onClick={() => onReuse(round)}>
                                    再来一次
                                </Button>
                                <Tooltip title={outputCount ? `下载这一轮的 ${outputCount} 张图` : "这一轮还没有可下载的图"}>
                                    <button type="button" className="itd-icon-button" aria-label="下载这一轮" disabled={!outputCount || Boolean(downloadingRound)} onClick={() => onDownloadRound(round)}>
                                        {downloadingRound === round.id ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                                    </button>
                                </Tooltip>
                                <Tooltip title="删除这一轮记录（图片仍保留在资产里）">
                                    <button type="button" className="itd-icon-button" aria-label="删除这一轮" onClick={() => onDeleteRound(round)}>
                                        <Trash2 className="size-4" aria-hidden />
                                    </button>
                                </Tooltip>
                            </div>
                        </header>
                        {meta.length ? (
                            <div className="itd-round-meta">
                                {meta.map((text) => (
                                    <span key={text}>{text}</span>
                                ))}
                            </div>
                        ) : null}
                        {round.notes ? <p className="itd-round-notes">「{round.notes}」</p> : null}
                        <TaskSettlement ids={round.items.flatMap((item) => (item.taskId ? [item.taskId] : []))} />
                        <div className="itd-gallery">
                            <figure className="itd-card is-source">
                                <img src={interiorImageUrl(round.source.resourceId, true)} alt="原图" loading="lazy" />
                                <figcaption className="itd-card-badge">原图</figcaption>
                                {round.references.length ? <span className="itd-card-badge is-corner">{`+${round.references.length} 张参考图`}</span> : null}
                            </figure>
                            {round.items.flatMap((item) => {
                                const label = item.styleName || round.modeName;
                                if (item.status !== "succeeded") {
                                    const count = item.status === "pending" && !(item.taskId && stalled[item.taskId]) ? Math.max(1, round.count) : 1;
                                    return Array.from({ length: count }, (_, index) => (
                                        <PendingCard key={`${item.id}-${index}`} round={round} item={item} stalled={item.taskId ? stalled[item.taskId] : undefined} busy={busy} onRetryWatch={onRetryWatch} onReuse={onReuse} index={index} />
                                    ));
                                }
                                return item.outputs.map((output, index) => {
                                    const target = { round, item, output, index };
                                    return (
                                        <div key={output.resourceId} className="itd-card is-output">
                                            <button type="button" className="itd-card-media" aria-label={`放大查看「${label}」第 ${index + 1} 张，和原图对比`} onClick={() => onOpen(target)}>
                                                <img src={interiorImageUrl(output.resourceId, true)} alt="" loading="lazy" />
                                            </button>
                                            <span className="itd-card-badge">{item.outputs.length > 1 ? `${label} · ${index + 1}` : label}</span>
                                            <span className="itd-card-zoom" aria-hidden>
                                                <Maximize2 className="size-3.5" />
                                            </span>
                                            <div className="itd-card-actions">
                                                <button type="button" onClick={() => onDownload(target)}>
                                                    <Download className="size-3.5" aria-hidden />
                                                    下载
                                                </button>
                                                <button type="button" disabled={busy} onClick={() => onContinue(target)}>
                                                    <PencilLine className="size-3.5" aria-hidden />
                                                    继续改
                                                </button>
                                                <button type="button" disabled={busy} onClick={() => onTo3D(target)}>
                                                    <Box className="size-3.5" aria-hidden />
                                                    生成 3D
                                                </button>
                                            </div>
                                        </div>
                                    );
                                });
                            })}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}

type ViewSide = "compare" | "after" | "before";

/** 原图和效果图叠在一起，拖动分隔线对比；也可以单独看效果图或原图。 */
function CompareStage({ before, after }: { before: string; after: string }) {
    const [split, setSplit] = useState(50);
    return (
        <div className="itd-compare" style={{ ["--itd-split" as string]: `${split}%` } as CSSProperties}>
            <img className="itd-compare-after" src={after} alt="效果图" />
            <img className="itd-compare-before" src={before} alt="原图" />
            {/* 滑块放在分隔线前面，键盘聚焦时用兄弟选择器加粗分隔线。 */}
            <input className="itd-compare-range" type="range" min={0} max={100} step={1} value={split} onChange={(event) => setSplit(Number(event.target.value))} aria-label="左右拖动，对比原图和效果图" />
            <span className="itd-compare-line" aria-hidden />
            <span className="itd-compare-tag is-before" aria-hidden>
                原图
            </span>
            <span className="itd-compare-tag is-after" aria-hidden>
                效果图
            </span>
        </div>
    );
}

export function InteriorViewer({
    target,
    onClose,
    onDownload,
    onContinue,
    onTo3D,
}: {
    target: InteriorOutputTarget | null;
    onClose: () => void;
    onDownload: (target: InteriorOutputTarget) => void;
    onContinue: (target: InteriorOutputTarget) => void;
    onTo3D: (target: InteriorOutputTarget) => void;
}) {
    const [side, setSide] = useState<ViewSide>("compare");
    // 每次打开新图都回到拖动对比。
    useEffect(() => {
        if (target) setSide("compare");
    }, [target]);
    return (
        <AppModal open={Boolean(target)} onCancel={onClose} footer={null} width={1080} centered title={target ? target.item.styleName || target.round.modeName : ""}>
            {target ? (
                <div className="itd-viewer">
                    <div className="itd-viewer-stage">
                        {side === "compare" ? (
                            <CompareStage before={interiorImageUrl(target.round.source.resourceId)} after={interiorImageUrl(target.output.resourceId)} />
                        ) : (
                            <img src={interiorImageUrl(side === "after" ? target.output.resourceId : target.round.source.resourceId)} alt={side === "after" ? "效果图" : "原图"} />
                        )}
                    </div>
                    <div className="itd-viewer-bar">
                        <SegmentedControl<ViewSide>
                            size="sm"
                            ariaLabel="查看方式"
                            value={side}
                            onChange={setSide}
                            options={[
                                { value: "compare", label: "拖动对比" },
                                { value: "after", label: "效果图" },
                                { value: "before", label: "原图" },
                            ]}
                        />
                        <div className="itd-viewer-actions">
                            <Button icon={<Download className="size-4" aria-hidden />} onClick={() => onDownload(target)}>
                                下载
                            </Button>
                            <Button icon={<Box className="size-4" aria-hidden />} onClick={() => onTo3D(target)}>
                                生成 3D 模型
                            </Button>
                            <Button type="primary" icon={<PencilLine className="size-4" aria-hidden />} onClick={() => onContinue(target)}>
                                用这张继续改
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}
