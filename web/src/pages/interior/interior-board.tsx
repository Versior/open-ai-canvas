import { Button, Tooltip } from "antd";
import { Download, Images, LoaderCircle, PencilLine, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { useState } from "react";
import type { InteriorImageRef, InteriorProjectDocument, InteriorRound, InteriorRoundItem } from "@/services/api/interior";
import { interiorImageUrl } from "./interior-models";

export type InteriorOutputTarget = { round: InteriorRound; item: InteriorRoundItem; output: InteriorImageRef; index: number };

type BoardProps = {
    document: InteriorProjectDocument;
    stalled: Record<string, string>;
    onRetryWatch: (taskId: string) => void;
    onOpen: (target: InteriorOutputTarget) => void;
    onDownload: (target: InteriorOutputTarget) => void;
    onContinue: (target: InteriorOutputTarget) => void;
    onDeleteRound: (round: InteriorRound) => void;
};

function roundSummary(round: InteriorRound) {
    return [round.modeName, round.roomName, round.model].filter(Boolean).join(" · ");
}

function roundTime(value: string) {
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? "" : time.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ItemStatus({ item, stalled, onRetryWatch }: { item: InteriorRoundItem; stalled?: string; onRetryWatch: (taskId: string) => void }) {
    if (item.status === "succeeded") return null;
    if (item.status === "failed") return <span className="itd-item-status is-error">{item.error || "生成失败"}</span>;
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

export function InteriorBoard({ document, stalled, onRetryWatch, onOpen, onDownload, onContinue, onDeleteRound }: BoardProps) {
    if (!document.rounds.length) {
        return <EmptyState icon={Images} title="还没有效果图" description="上传一张房间照片，选好空间和风格，就能生成装修效果图。" className="itd-empty" />;
    }
    return (
        <div className="itd-rounds">
            {document.rounds.map((round) => (
                <article key={round.id} className="itd-round">
                    <header className="itd-round-head">
                        <div className="itd-round-title">
                            <strong>{roundSummary(round)}</strong>
                            <span>{roundTime(round.createdAt)}</span>
                        </div>
                        <Tooltip title="删除这一轮记录（图片仍保留在资产里）">
                            <button type="button" className="itd-icon-button" aria-label="删除这一轮" onClick={() => onDeleteRound(round)}>
                                <Trash2 className="size-4" aria-hidden />
                            </button>
                        </Tooltip>
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
                                        <ItemStatus item={item} stalled={item.taskId ? stalled[item.taskId] : undefined} onRetryWatch={onRetryWatch} />
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
                                                                  <button type="button" aria-label="用这张继续改" onClick={() => onContinue(target)}>
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
            ))}
        </div>
    );
}

/** 效果图和原图切换对比，下载或拿去继续改。 */
export function InteriorViewer({ target, onClose, onDownload, onContinue }: { target: InteriorOutputTarget | null; onClose: () => void; onDownload: (target: InteriorOutputTarget) => void; onContinue: (target: InteriorOutputTarget) => void }) {
    const [side, setSide] = useState<"after" | "before">("after");
    const resourceId = target ? (side === "after" ? target.output.resourceId : target.round.source.resourceId) : "";
    return (
        <AppModal
            open={Boolean(target)}
            onCancel={() => {
                setSide("after");
                onClose();
            }}
            footer={null}
            width={1080}
            centered
            title={target ? target.item.styleName || target.round.modeName : ""}
        >
            {target ? (
                <div className="itd-viewer">
                    <div className="itd-viewer-stage">
                        <img src={interiorImageUrl(resourceId)} alt={side === "after" ? "效果图" : "原图"} />
                    </div>
                    <div className="itd-viewer-bar">
                        <SegmentedControl<"after" | "before">
                            size="sm"
                            ariaLabel="对比"
                            value={side}
                            onChange={setSide}
                            options={[
                                { value: "after", label: "效果图" },
                                { value: "before", label: "原图" },
                            ]}
                        />
                        <div className="itd-viewer-actions">
                            <Button icon={<Download className="size-4" aria-hidden />} onClick={() => onDownload(target)}>
                                下载
                            </Button>
                            <Button
                                type="primary"
                                icon={<PencilLine className="size-4" aria-hidden />}
                                onClick={() => {
                                    setSide("after");
                                    onContinue(target);
                                }}
                            >
                                用这张继续改
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}
