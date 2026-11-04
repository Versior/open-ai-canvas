import { Button, Skeleton } from "antd";
import { Clapperboard, LoaderCircle, Plus } from "lucide-react";

import { formatTeardownTime } from "@/lib/canvas/video-teardown";
import { cn } from "@/lib/utils";
import { resourceFileUrl } from "@/services/api/resources";
import type { VideoReplicationRecord } from "@/services/api/video-replication";

type Props = {
    records: VideoReplicationRecord[] | undefined;
    loading: boolean;
    error: string;
    selectedId: string;
    /** 正在后台跑的那条，列表里显示进行中。 */
    runningId: string;
    className?: string;
    onSelect: (id: string) => void;
    onNew: () => void;
};

function recordStatus(record: VideoReplicationRecord, running: boolean) {
    if (running) return { label: "进行中", tone: "running" as const };
    if (record.status === "queued" || record.status === "running") return { label: record.stage || "拆解中", tone: "running" as const };
    if (record.status === "failed" || record.status === "cancelled") return { label: record.status === "cancelled" ? "已取消" : "拆解失败", tone: "failed" as const };
    if (!record.analyzedAt) return { label: "未分析", tone: "pending" as const };
    return null;
}

function recordTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 左栏：新建入口和最近 50 次拆解（含进行中、失败的）；列表自己滚动。 */
export function ReplicationHistory({ records, loading, error, selectedId, runningId, className, onSelect, onNew }: Props) {
    return (
        <section className={cn("flex min-h-0 flex-col gap-3 rounded-[var(--r-lg)] border border-border bg-card p-3", className)} aria-label="拆解记录">
            <Button type={selectedId ? "default" : "primary"} block icon={<Plus className="size-4" />} onClick={onNew} aria-pressed={!selectedId}>
                新建拆解
            </Button>
            <h2 className="px-1 text-xs font-medium text-muted-foreground">拆解记录</h2>
            {loading ? <Skeleton active paragraph={{ rows: 4 }} title={false} /> : null}
            {error ? (
                <p role="alert" className="px-1 text-xs text-destructive">
                    {error}
                </p>
            ) : null}
            {!loading && !error && !records?.length ? <p className="px-1 py-2 text-xs text-muted-foreground">还没有拆解过视频</p> : null}
            <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 max-lg:max-h-64">
                {records?.map((record) => {
                    const running = record.id === runningId;
                    const status = recordStatus(record, running);
                    const active = record.id === selectedId;
                    return (
                        <li key={record.id}>
                            <button
                                type="button"
                                aria-current={active ? "true" : undefined}
                                onClick={() => onSelect(record.id)}
                                className={cn("flex w-full items-center gap-3 rounded-[var(--r-md)] p-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1", active ? "bg-surface-active" : "hover:bg-surface-hover")}
                            >
                                <span className="grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--r-sm)] bg-muted">
                                    {record.coverResourceId ? <img src={resourceFileUrl(record.coverResourceId)} alt="" loading="lazy" className="size-full object-cover" /> : <Clapperboard className="size-4 text-muted-foreground" aria-hidden />}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate text-sm font-medium">{record.title || (record.status === "succeeded" ? "未命名拆解" : "视频拆解")}</span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {[recordTime(record.createdAt), record.shotCount ? `${record.shotCount} 镜` : "", record.durationMs ? formatTeardownTime(record.durationMs) : ""].filter(Boolean).join(" · ")}
                                    </span>
                                    {status ? (
                                        <span className={cn("flex items-center gap-1 text-xs", status.tone === "failed" ? "text-destructive" : status.tone === "running" ? "text-primary" : "text-muted-foreground")}>
                                            {status.tone === "running" ? <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                                            {status.label}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
