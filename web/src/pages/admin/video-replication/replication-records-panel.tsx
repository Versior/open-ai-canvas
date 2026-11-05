import { Button, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminSearchInput } from "@/pages/admin/components/admin-search-input";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "@/pages/admin/components/admin-ui";
import { formatTeardownTime, orientationLabel } from "@/lib/canvas/video-teardown";
import { adminUserLabel, listAdminVideoReplications, type AdminVideoReplicationPage, type AdminVideoReplicationRecord } from "@/services/api/video-replication-admin";
import { formatParseClock, formatParseTime } from "./parse-shared";
import { AdminResourceThumb, TEARDOWN_STATUS_FILTERS, TEARDOWN_STATUS_META, TRANSCRIPT_LABELS } from "./replication-admin-shared";
import { ReplicationRecordDrawer } from "./replication-record-drawer";

const SEARCH_DEBOUNCE_MS = 300;

/** 所有用户的拆解记录：按状态和用户筛选，点开看镜头、口播和分析。只读，不改用户数据。 */
export function ReplicationRecordsPanel({ recordId, onOpenRecord }: { recordId: string; onOpenRecord: (id: string) => void }) {
    const [status, setStatus] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [appliedKeyword, setAppliedKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [data, setData] = useState<AdminVideoReplicationPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAppliedKeyword(keyword.trim());
            setPage(1);
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [keyword]);

    const load = useCallback(async () => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setLoading(true);
        try {
            const result = await listAdminVideoReplications({ status, keyword: appliedKeyword, page, pageSize }, controller.signal);
            if (controller.signal.aborted) return;
            setData(result);
            setError("");
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取拆解记录失败");
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, [appliedKeyword, page, pageSize, status]);
    useEffect(() => {
        void load();
        return () => controllerRef.current?.abort();
    }, [load, reloadKey]);

    const records = data?.records || [];
    const filtered = status !== "all" || Boolean(appliedKeyword);
    const columns: ColumnsType<AdminVideoReplicationRecord> = [
        {
            title: "视频",
            key: "video",
            render: (_, record) => (
                <div className="admin-vr-record">
                    <AdminResourceThumb id={record.coverResourceId} label={record.title || "第一镜关键帧"} className="admin-vr-record-cover" />
                    <div className="admin-vr-record-copy">
                        <strong className={record.title ? undefined : "is-muted"} title={record.title || undefined}>
                            {record.title || (record.status === "succeeded" ? "还没有分析" : "—")}
                        </strong>
                        <small>
                            {record.status === "succeeded"
                                ? [formatTeardownTime(record.durationMs), record.width && record.height ? `${orientationLabel(record.width, record.height)} ${record.width}×${record.height}` : "", `${record.shotCount} 个镜头`].filter(Boolean).join(" · ")
                                : record.stage || ""}
                        </small>
                    </div>
                </div>
            ),
        },
        {
            title: "用户",
            key: "user",
            width: 180,
            render: (_, record) => (
                <span className="admin-vr-ellipsis" title={record.user.id}>
                    {adminUserLabel(record.user)}
                </span>
            ),
        },
        {
            title: "状态",
            key: "status",
            width: 200,
            render: (_, record) => {
                const meta = TEARDOWN_STATUS_META[record.status];
                return (
                    <div className="admin-vr-record-state">
                        <AdminStatusBadge label={record.status === "running" ? `${meta.label} ${record.progress}%` : meta.label} tone={meta.tone} />
                        {record.status === "failed" && record.error ? (
                            <small className="admin-vr-error admin-vr-ellipsis" title={record.error}>
                                {record.error}
                            </small>
                        ) : record.warnings?.length ? (
                            <small className="admin-vr-ellipsis" title={record.warnings.join("\n")}>{`${record.warnings.length} 条提示`}</small>
                        ) : null}
                    </div>
                );
            },
        },
        {
            title: "口播",
            key: "transcript",
            width: 96,
            render: (_, record) => (record.transcript ? TRANSCRIPT_LABELS[record.transcript] : "—"),
        },
        {
            title: "分析",
            key: "analysis",
            width: 190,
            render: (_, record) =>
                record.analyzedAt ? (
                    <div className="admin-vr-record-state">
                        <span className="admin-vr-ellipsis" title={record.model}>
                            {record.model || "—"}
                        </span>
                        <small title={formatParseTime(record.analyzedAt)}>{formatParseClock(record.analyzedAt)}</small>
                    </div>
                ) : (
                    <span className="admin-vr-muted">未分析</span>
                ),
        },
        {
            title: "创建时间",
            key: "createdAt",
            width: 120,
            render: (_, record) => <span title={formatParseTime(record.createdAt)}>{formatParseClock(record.createdAt)}</span>,
        },
        {
            title: "操作",
            key: "actions",
            width: 84,
            fixed: "right",
            render: (_, record) => (
                <Button size="small" onClick={() => onOpenRecord(record.id)}>
                    查看
                </Button>
            ),
        },
    ];

    return (
        <div className="admin-vr-records">
            {error ? (
                <div className="admin-vr-load-error" role="alert">
                    <span>{error}</span>
                    <Button size="small" onClick={() => setReloadKey((value) => value + 1)}>
                        重新加载
                    </Button>
                </div>
            ) : null}
            <AdminDataTable<AdminVideoReplicationRecord>
                toolbar={
                    <div className="admin-vr-records-toolbar">
                        <AdminSearchInput allowClear prefix={<Search className="size-4" />} value={keyword} aria-label="搜索拆解记录" placeholder="用户名、昵称、邮箱或任务 ID" onValueChange={setKeyword} />
                        <Select
                            aria-label="按状态筛选"
                            value={status}
                            options={TEARDOWN_STATUS_FILTERS}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                        />
                    </div>
                }
                trailing={
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => setReloadKey((value) => value + 1)}>
                        刷新
                    </Button>
                }
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={data?.total || 0}
                        onChange={(next, size) => {
                            setPage(size === pageSize ? next : 1);
                            setPageSize(size);
                        }}
                    />
                }
                table={{ rowKey: "id", loading, pagination: false, columns, dataSource: records, scroll: { x: 1180 } }}
                empty={filtered ? <AdminTableEmpty filtered /> : <AdminTableEmpty title="还没有拆解记录" description="用户在「视频复刻」里拆解视频后，记录会出现在这里。" />}
            />
            <ReplicationRecordDrawer id={recordId} onClose={() => onOpenRecord("")} />
        </div>
    );
}
