import { Button, Tooltip } from "antd";
import { Download, Images, LoaderCircle, PencilLine, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import type { InteriorImageRef, InteriorProjectDocument, InteriorRound, InteriorRoundItem } from "@/services/api/interior";
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
    onReuse: (round: InteriorRound, styleKey?: string) => void;
    onDeleteRound: (round: InteriorRound) => void;
};

function roundSummary(round: InteriorRound) {
    return [round.modeName, round.roomName, round.model].filter(Boolean).join(" · ");
}

function roundTime(value: string) {
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? "" : time.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function roundOutputCount(round: InteriorRound) {
    return round.items.reduce((total, item) => total + (item.status === "succeeded" ? item.outputs.length : 0), 0);
}

function ItemStatus({ item, stalled, busy, onRetryWatch, onRetry }: { item: InteriorRoundItem; stalled?: string; busy: boolean; onRetryWatch: (taskId: string) => void; onRetry: () => void }) {
    if (item.status === "succeeded") return null;
    if (item.status === "failed") {
        return (
            <span className="itd-item-status is-error">
                {item.error || "生成失败"}
                <button type="button" className="itd-link-button" onClick={onRetry} disabled={busy}>
                    <RotateCcw className="size-3" aria-hidden />
                    用这组设置重试
                </button>
            </span>
        );
    }
    if (stalled && item.taskId) {
        return (
            <span className="itd-item-status is-warning">
                结果查询中断
                <button type="button" className="itd-link-button" onClick={() => onRetryWatch(item.taskId!)}>
                    <RefreshCw className="size-3" aria-hidden />
                    重新查询
                </button>
            </span>
        );
    }
    return (
        <span className="itd-item-status">
            <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />
            生成中
        </span>
    );
}

export function InteriorBoard({ document, stalled, busy, downloadingRound, onRetryWatch, onOpen, onDownload, onDownloadRound, onContinue, onReuse, onDeleteRound }: BoardProps) {
    if (!document.rounds.length) {
        return <EmptyState icon={Images} title="还没有效果图" description="上传一张房间照片，选好空间和风格，就能生成装修效果图。也可以直接按 Ctrl+V 粘贴图片。" className="itd-empty" />;
    }
    return (
        <div className="itd-rounds">
            {document.rounds.map((round) => {
                const outputCount = roundOutputCount(round);
                return (
                    <article key={round.id} className="itd-round">
                        <header className="itd-round-head">
                            <div className="itd-round-title">
                                <strong>{roundSummary(round)}</strong>
                                <span>{roundTime(round.createdAt)}</span>
                            </div>
                            <div className="itd-round-actions">
                                <Tooltip title="用这一轮的设置再来一次">
                                    <button type="button" className="itd-icon-button" aria-label="用这一轮的设置再来一次" disabled={busy} onClick={() => onReuse(round)}>
                                        <RotateCcw className="size-4" aria-hidden />
                                    </button>
                                </Tooltip>
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
                        {round.notes ? <p className="itd-round-notes">{round.notes}</p> : null}
                        <div className="itd-round-body">
                            <figure className="itd-source">
                                <img src={interiorImageUrl(round.source.resourceId, true)} alt="原图" loading="lazy" />
                                <figcaption>原图</figcaption>
                            </figure>
                            <div className="itd-items">
                                {round.items.map((item) => (
                                    <section key={item.id} className="itd-item">
                                        <div className="itd-item-head">
                                            <strong>{item.styleName || round.modeName}</strong>
                                            <ItemStatus item={item} stalled={item.taskId ? stalled[item.taskId] : undefined} busy={busy} onRetryWatch={onRetryWatch} onRetry={() => onReuse(round, item.styleKey)} />
                                        </div>
                                        <div className="itd-grid">
                                            {item.status === "succeeded"
                                                ? item.outputs.map((output, index) => {
                                                      const target = { round, item, output, index };
                                                      return (
                                                          <div key={output.resourceId} className="itd-tile">
                                                              <button type="button" className="itd-tile-media" aria-label={`查看第 ${index + 1} 张效果图`} onClick={() => onOpen(target)}>
                                                                  <img src={interiorImageUrl(output.resourceId, true)} alt="" loading="lazy" />
                                                              </button>
                                                              <div className="itd-tile-actions">
                                                                  <Tooltip title="下载">
                                                                      <button type="button" aria-label="下载" onClick={() => onDownload(target)}>
                                                                          <Download className="size-3.5" aria-hidden />
                                                                      </button>
                                                                  </Tooltip>
                                                                  <Tooltip title="用这张继续改">
                                                                      <button type="button" aria-label="用这张继续改" disabled={busy} onClick={() => onContinue(target)}>
                                                                          <PencilLine className="size-3.5" aria-hidden />
                                                                      </button>
                                                                  </Tooltip>
                                                              </div>
                                                          </div>
                                                      );
                                                  })
                                                : item.status === "pending"
                                                  ? Array.from({ length: Math.max(1, round.count) }, (_, index) => <div key={index} className="itd-tile is-placeholder" aria-hidden />)
                                                  : null}
                                        </div>
                                    </section>
                                ))}
                            </div>
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

export function InteriorViewer({ target, onClose, onDownload, onContinue }: { target: InteriorOutputTarget | null; onClose: () => void; onDownload: (target: InteriorOutputTarget) => void; onContinue: (target: InteriorOutputTarget) => void }) {
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
