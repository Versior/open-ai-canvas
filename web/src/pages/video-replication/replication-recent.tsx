import { ChevronDown, ChevronUp, Clapperboard, History, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { App, Button, Checkbox } from "antd";
import { useQueryClient } from "@tanstack/react-query";

import { RelativeTime } from "@/components/ui/product/relative-time";
import { orientationLabel } from "@/lib/canvas/video-teardown";
import { resourceFileUrl } from "@/services/api/resources";
import { deleteVideoReplication, type VideoReplicationRecord } from "@/services/api/video-replication";
import { getActiveUserScope } from "@/lib/user-scope";
import { videoReplicationKeys } from "./use-replication-runner";
import { formatClock } from "./replication-timeline";

type Props = {
    records: VideoReplicationRecord[] | undefined;
    loading: boolean;
    error: string;
    /** 正在后台跑的那条，卡片上显示进行中。 */
    runningId: string;
    onOpen: (id: string) => void;
};

type Status = { label: string; tone: "running" | "failed" | "pending" };

function recordStatus(record: VideoReplicationRecord, running: boolean): Status | null {
    if (running) return { label: "进行中", tone: "running" };
    if (record.status === "queued" || record.status === "running") return { label: record.stage || "拆解中", tone: "running" };
    if (record.status === "failed" || record.status === "cancelled") return { label: record.status === "cancelled" ? "已取消" : "拆解失败", tone: "failed" };
    if (!record.analyzedAt) return { label: "未分析", tone: "pending" };
    return null;
}

/**
 * 最近拆解：卡片上是均匀取自全片的几张关键帧（竖屏排成一行，横屏拼成四宫格），角标是状态和时长。
 * 默认排成一行、可以横向滚动，首页一屏放得下；点「展开全部」换成多行网格。
 */
export function ReplicationRecent({ records, loading, error, runningId, onOpen }: Props) {
    const { modal, message } = App.useApp();
    const queryClient = useQueryClient();
    const scope = getActiveUserScope();
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [deleting, setDeleting] = useState(false);
    const deletable = records?.filter((record) => record.id !== runningId && ["succeeded", "failed", "cancelled"].includes(record.status)) || [];
    const selectedIds = selected.filter((id) => deletable.some((record) => record.id === id));
    const remove = () =>
        modal.confirm({
            title: `删除选中的 ${selectedIds.length} 条拆解记录？`,
            content: "会删除拆解分析、方案和日志。原视频、关键帧及已有复刻作品会保留。",
            okText: "删除记录",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setDeleting(true);
                try {
                    const results = await Promise.allSettled(selectedIds.map((id) => deleteVideoReplication(id)));
                    const removed = selectedIds.filter((_, index) => results[index].status === "fulfilled");
                    setSelected((ids) => ids.filter((id) => !removed.includes(id)));
                    removed.forEach((id) => queryClient.removeQueries({ queryKey: videoReplicationKeys.detail(scope, id) }));
                    await queryClient.invalidateQueries({ queryKey: videoReplicationKeys.list(scope) });
                    if (removed.length) message.success(`已删除 ${removed.length} 条记录`);
                    const failure = results.find((result) => result.status === "rejected");
                    if (failure?.status === "rejected") {
                        const text = failure.reason instanceof Error ? failure.reason.message : "删除失败";
                        message.error(`有 ${results.length - removed.length} 条未删除：${text}`);
                        throw new Error(text);
                    }
                } finally {
                    setDeleting(false);
                }
            },
        });
    const [expanded, setExpanded] = useState(false);
    const empty = !loading && !error && !records?.length;
    const expandable = (records?.length || 0) > 4;
    return (
        <section className="vr-recent" aria-labelledby="vr-recent-title">
            <header className="vr-section-head">
                <h2 id="vr-recent-title" className="vr-section-title">
                    <History aria-hidden />
                    最近拆解
                </h2>
                <span className="vr-section-end">
                    {records?.length ? (
                        <Button
                            size="small"
                            disabled={deleting}
                            onClick={() => {
                                setSelecting(!selecting);
                                setSelected([]);
                            }}
                        >
                            {selecting ? "取消选择" : "选择记录"}
                        </Button>
                    ) : null}
                    {selecting ? (
                        <>
                            <Checkbox
                                checked={Boolean(deletable.length) && selectedIds.length === deletable.length}
                                indeterminate={Boolean(selectedIds.length) && selectedIds.length < deletable.length}
                                disabled={deleting || !deletable.length}
                                onChange={(event) => setSelected(event.target.checked ? deletable.map((record) => record.id) : [])}
                            >
                                全选可删除
                            </Checkbox>
                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} loading={deleting} disabled={!selectedIds.length} onClick={remove}>
                                删除 {selectedIds.length || ""}
                            </Button>
                        </>
                    ) : null}
                    {records?.length ? <span className="vr-section-meta">{`共 ${records.length} 条`}</span> : null}
                    {expandable ? (
                        <button type="button" className="vr-text-button" aria-expanded={expanded} aria-controls="vr-recent-list" onClick={() => setExpanded((value) => !value)}>
                            {expanded ? "收起" : "展开全部"}
                            {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
                        </button>
                    ) : null}
                </span>
            </header>
            {error ? (
                <p role="alert" className="vr-recent-note" data-tone="error">
                    {`读取拆解记录失败：${error}`}
                </p>
            ) : null}
            {empty ? <p className="vr-recent-note">还没有拆解过视频。拆完的视频会留在这里，随时回来看分镜、复制提示词。</p> : null}
            {loading || records?.length ? (
                <ul id="vr-recent-list" className="vr-recent-grid" data-layout={expanded ? "grid" : "row"} aria-busy={loading || undefined}>
                    {loading
                        ? [0, 1, 2, 3].map((item) => <SkeletonCard key={item} />)
                        : records?.map((record) => (
                              <RecordCard
                                  key={record.id}
                                  record={record}
                                  running={record.id === runningId}
                                  onOpen={onOpen}
                                  selection={
                                      selecting ? (
                                          <Checkbox
                                              aria-label={`选择 ${record.title || "视频拆解"}`}
                                              checked={selectedIds.includes(record.id)}
                                              disabled={deleting || !deletable.some((item) => item.id === record.id)}
                                              onChange={(event) => setSelected((ids) => (event.target.checked ? [...ids, record.id] : ids.filter((id) => id !== record.id)))}
                                          />
                                      ) : null
                                  }
                              />
                          ))}
                </ul>
            ) : null}
        </section>
    );
}

function RecordCard({ record, running, onOpen, selection }: { record: VideoReplicationRecord; running: boolean; onOpen: (id: string) => void; selection: React.ReactNode }) {
    const status = recordStatus(record, running);
    const frames = record.previewResourceIds?.length ? record.previewResourceIds : record.coverResourceId ? [record.coverResourceId] : [];
    const landscape = Boolean(record.width && record.height && record.width > record.height);
    const layout = landscape ? (frames.length >= 4 ? "grid" : "single") : "row";
    const shown = layout === "single" ? frames.slice(0, 1) : frames.slice(0, 4);
    const title = record.title || (record.status === "succeeded" ? "未命名拆解" : "视频拆解");
    const meta = [record.shotCount ? `${record.shotCount} 个镜头` : "", record.width && record.height ? orientationLabel(record.width, record.height) : ""].filter(Boolean);
    // 走到了哪一步：建过画布 > 有复刻方案 > 只拆解分析了。
    const progress = record.canvasCount ? `已建 ${record.canvasCount} 块画布` : record.planUpdatedAt ? "有复刻方案" : "";
    return (
        <li className="vr-card-item" data-replication-id={record.id}>
            {selection ? <div className="vr-card-selection">{selection}</div> : null}
            <button type="button" className="vr-card" onClick={() => onOpen(record.id)}>
                <span className="vr-card-strip" data-layout={layout}>
                    {shown.length ? (
                        shown.map((id, index) => <img key={`${index}-${id}`} src={resourceFileUrl(id)} alt="" loading="lazy" draggable={false} />)
                    ) : (
                        <span className="vr-card-empty">
                            <Clapperboard aria-hidden />
                        </span>
                    )}
                    {status ? (
                        <span className="vr-card-badge" data-position="start" data-tone={status.tone}>
                            {status.tone === "running" ? <LoaderCircle className="vr-spin" aria-hidden /> : null}
                            {status.label}
                        </span>
                    ) : progress ? (
                        <span className="vr-card-badge" data-position="start">
                            {progress}
                        </span>
                    ) : null}
                    {record.durationMs ? (
                        <span className="vr-card-badge" data-position="end">
                            {formatClock(record.durationMs)}
                        </span>
                    ) : null}
                </span>
                <span className="vr-card-body">
                    <span className="vr-card-title" title={title}>
                        {title}
                    </span>
                    <span className="vr-card-meta">
                        <RelativeTime value={record.createdAt} />
                        {meta.map((item) => (
                            <span key={item}>{item}</span>
                        ))}
                    </span>
                </span>
            </button>
        </li>
    );
}

function SkeletonCard() {
    return (
        <li className="vr-card-item" aria-hidden>
            <span className="vr-card" data-skeleton>
                <span className="vr-card-strip vr-skeleton" />
                <span className="vr-card-body">
                    <span className="vr-skeleton" style={{ display: "block", width: "68%", height: 14 }} />
                    <span className="vr-skeleton" style={{ display: "block", width: "42%", height: 11, marginTop: 6 }} />
                </span>
            </span>
        </li>
    );
}
