import { App, Button, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminSearchInput } from "@/pages/admin/components/admin-search-input";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "@/pages/admin/components/admin-ui";
import { formatTeardownTime, orientationLabel } from "@/lib/canvas/video-teardown";
import { adminUserLabel, deleteAdminVideoReplication, listAdminVideoReplications, type AdminVideoReplicationPage, type AdminVideoReplicationRecord } from "@/services/api/video-replication-admin";
import { formatParseClock, formatParseTime } from "./parse-shared";
import { AdminResourceThumb, modelLabel, TEARDOWN_STATUS_FILTERS, teardownInProgress, teardownStatusMeta, TRANSCRIPT_LABELS } from "./replication-admin-shared";
import { ReplicationRecordDrawer } from "./replication-record-drawer";

const SEARCH_DEBOUNCE_MS = 300;
const IN_PROGRESS_REFRESH_MS = 4000;

/**
 * 所有用户的拆解记录：按状态和用户筛选，点开看镜头、口播和分析；已结束的记录可以删除。
 * 页签打开着、列表里有排队或拆解中的记录时定时刷新，进度跟着走。
 */
export function ReplicationRecordsPanel({ active, recordId, onOpenRecord, onRecordsChanged }: { active: boolean; recordId: string; onOpenRecord: (id: string) => void; onRecordsChanged: () => void }) {
    const { message, modal } = App.useApp();
    const [deletingId, setDeletingId] = useState("");
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

    // silent 用于后台定时刷新：不转圈，表格不闪。
    const load = useCallback(
        async (silent = false) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            if (!silent) setLoading(true);
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
        },
        [appliedKeyword, page, pageSize, status],
    );
    useEffect(() => {
        void load();
        return () => controllerRef.current?.abort();
    }, [load, reloadKey]);
    const hasInProgress = Boolean(data?.records.some((record) => teardownInProgress(record.status)));
    // 每拿到一份新数据就重新排下一次刷新；记录都结束了或切走页签就停。
    useEffect(() => {
        if (!active || !hasInProgress) return;
        const timer = window.setTimeout(() => void load(true), IN_PROGRESS_REFRESH_MS);
        return () => window.clearTimeout(timer);
    }, [active, data, hasInProgress, load]);

    const records = data?.records || [];
    const filtered = status !== "all" || Boolean(appliedKeyword);

    const removeRecord = async (record: AdminVideoReplicationRecord) => {
        setDeletingId(record.id);
        try {
            const result = await deleteAdminVideoReplication(record.id);
            if (result.imagesError) message.warning(`记录已删除；${result.imagesError}，可以到「存储资源」里再删。`);
            else if (result.keptResources.length) message.success(`已删除，${result.keptResources.length} 张图片还被画布等用到，已保留`);
            else message.success("已删除");
            if (recordId === record.id) onOpenRecord("");
            // 删掉的是这一页最后一条时回到上一页，不停在空页。
            if (records.length === 1 && page > 1) setPage(page - 1);
            else setReloadKey((value) => value + 1);
            onRecordsChanged();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "删除失败");
        } finally {
            setDeletingId("");
        }
    };
    const confirmRemove = (record: AdminVideoReplicationRecord) => {
        modal.confirm({
            title: `删除「${record.title || adminUserLabel(record.user)}」这条拆解记录？`,
            content: "拆解结果、模型分析和这条拆解存的关键帧、宫格会一起删掉，用户那边也看不到这条记录。原视频保留在用户的素材里，被画布用到的关键帧也会保留。删除后不能恢复。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => removeRecord(record),
        });
    };
    const columns: ColumnsType<AdminVideoReplicationRecord> = [
        {
            title: "视频",
            key: "video",
            render: (_, record) => (
                <div className="admin-vr-record">
                    {/* 封面框固定大小，各行文字对齐；画面在框里按原比例完整显示。 */}
                    <span className="admin-vr-record-cover">
                        <AdminResourceThumb id={record.coverResourceId} label={record.title || "第一镜关键帧"} />
                    </span>
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
            width: 150,
            render: (_, record) => {
                const meta = teardownStatusMeta(record.status, record.progress);
                return (
                    <div className="admin-vr-record-state">
                        <AdminStatusBadge label={meta.label} tone={meta.tone} />
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
            width: 150,
            render: (_, record) =>
                record.transcript ? (
                    <div className="admin-vr-record-state">
                        <span>{TRANSCRIPT_LABELS[record.transcript]}</span>
                        {/* 没有转写的原因只在这里写一次，「状态」那栏不再重复成「1 条提示」。 */}
                        {record.transcriptNote ? (
                            <small className="admin-vr-ellipsis" title={record.transcriptNote}>
                                {record.transcriptNote}
                            </small>
                        ) : null}
                    </div>
                ) : (
                    "—"
                ),
        },
        {
            title: "分析",
            key: "analysis",
            width: 190,
            render: (_, record) =>
                record.analyzedAt ? (
                    <div className="admin-vr-record-state">
                        <span className="admin-vr-ellipsis" title={record.model}>
                            {modelLabel(record.model) || "—"}
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
            width: 116,
            fixed: "right",
            render: (_, record) => {
                const name = record.title || adminUserLabel(record.user);
                const inProgress = teardownInProgress(record.status);
                return (
                    <div className="admin-vr-record-actions">
                        <Button size="small" aria-label={`查看「${name}」的拆解记录`} onClick={() => onOpenRecord(record.id)}>
                            查看
                        </Button>
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<Trash2 className="size-3.5" aria-hidden="true" />}
                            aria-label={`删除「${name}」的拆解记录`}
                            title={inProgress ? "拆解结束后才能删除" : "删除这条记录"}
                            disabled={inProgress || Boolean(deletingId)}
                            loading={deletingId === record.id}
                            onClick={() => confirmRemove(record)}
                        />
                    </div>
                );
            },
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
                table={{ rowKey: "id", loading, pagination: false, columns, dataSource: records, scroll: { x: 1220 } }}
                empty={filtered ? <AdminTableEmpty filtered /> : <AdminTableEmpty title="还没有拆解记录" description="用户在「视频创作」里拆解参考视频后，记录会出现在这里。" />}
            />
            <ReplicationRecordDrawer id={recordId} onClose={() => onOpenRecord("")} />
        </div>
    );
}
