import { Button, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminSearchInput } from "@/pages/admin/components/admin-search-input";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "@/pages/admin/components/admin-ui";
import { listAdminInteriorGenerations, listAdminInteriorModes, type AdminInteriorGeneration, type AdminInteriorGenerationPage } from "@/services/api/interior";
import { adminUserLabel } from "@/services/api/video-replication-admin";
import { formatInteriorTime, INTERIOR_STATUS_FILTERS, INTERIOR_SURFACE_LABELS, InteriorAdminThumb, interiorInProgress, interiorModelLabel, interiorStatusMeta } from "./interior-admin-shared";
import { InteriorGenerationDrawer } from "./interior-generation-drawer";

const SEARCH_DEBOUNCE_MS = 300;
const IN_PROGRESS_REFRESH_MS = 4000;

/**
 * 所有用户的室内设计出图：按状态、出图方式和用户筛选，点开看原图、效果图和完整提示词。
 * 页签打开着、列表里有排队或生成中的记录时定时刷新。
 */
export function InteriorRecordsPanel({ active, recordId, onOpenRecord }: { active: boolean; recordId: string; onOpenRecord: (id: string) => void }) {
    const [status, setStatus] = useState("all");
    const [mode, setMode] = useState("all");
    const [modeOptions, setModeOptions] = useState([{ value: "all", label: "全部出图方式" }]);
    const [keyword, setKeyword] = useState("");
    const [appliedKeyword, setAppliedKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [data, setData] = useState<AdminInteriorGenerationPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        // 出图方式的名称只用来做筛选项；读不到时只剩「全部」，不影响列表。
        void listAdminInteriorModes()
            .then((modes) => setModeOptions([{ value: "all", label: "全部出图方式" }, ...modes.map((item) => ({ value: item.key, label: item.name }))]))
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAppliedKeyword(keyword.trim());
            setPage(1);
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [keyword]);

    const load = useCallback(
        async (silent = false) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            if (!silent) setLoading(true);
            try {
                const result = await listAdminInteriorGenerations({ status, mode, keyword: appliedKeyword, page, pageSize }, controller.signal);
                if (controller.signal.aborted) return;
                setData(result);
                setError("");
            } catch (cause) {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取出图记录失败");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        },
        [appliedKeyword, mode, page, pageSize, status],
    );
    useEffect(() => {
        void load();
        return () => controllerRef.current?.abort();
    }, [load, reloadKey]);
    const hasInProgress = Boolean(data?.records.some((record) => interiorInProgress(record.status)));
    useEffect(() => {
        if (!active || !hasInProgress) return;
        const timer = window.setTimeout(() => void load(true), IN_PROGRESS_REFRESH_MS);
        return () => window.clearTimeout(timer);
    }, [active, data, hasInProgress, load]);

    const records = data?.records || [];
    const filtered = status !== "all" || mode !== "all" || Boolean(appliedKeyword);
    const columns: ColumnsType<AdminInteriorGeneration> = [
        {
            title: "原图 → 效果图",
            key: "images",
            width: 236,
            render: (_, record) => (
                <div className="itd-admin-pair">
                    <InteriorAdminThumb id={record.sourceResourceId} label="原图" className="itd-admin-pair-image" />
                    <span className="itd-admin-pair-arrow" aria-hidden="true">
                        →
                    </span>
                    <InteriorAdminThumb id={record.outputResourceIds[0]} label="效果图" className="itd-admin-pair-image" />
                    {record.outputResourceIds.length > 1 ? <span className="itd-admin-pair-more">{`+${record.outputResourceIds.length - 1}`}</span> : null}
                </div>
            ),
        },
        {
            title: "出图",
            key: "what",
            render: (_, record) => (
                <div className="itd-admin-cell">
                    <strong>{[record.roomName, record.styleName].filter(Boolean).join(" · ") || record.modeName || "—"}</strong>
                    <small>{[record.modeName, record.surface ? INTERIOR_SURFACE_LABELS[record.surface] : "", record.referenceResourceIds.length ? `${record.referenceResourceIds.length} 张参考图` : ""].filter(Boolean).join(" · ")}</small>
                </div>
            ),
        },
        {
            title: "用户",
            key: "user",
            width: 170,
            render: (_, record) => (
                <span className="itd-admin-ellipsis" title={record.user.id}>
                    {adminUserLabel(record.user)}
                </span>
            ),
        },
        {
            title: "状态",
            key: "status",
            width: 170,
            render: (_, record) => {
                const meta = interiorStatusMeta(record.status, record.progress);
                return (
                    <div className="itd-admin-cell">
                        <AdminStatusBadge label={meta.label} tone={meta.tone} />
                        {record.status === "failed" && record.error ? (
                            <small className="itd-admin-error itd-admin-ellipsis" title={record.error}>
                                {record.error}
                            </small>
                        ) : null}
                    </div>
                );
            },
        },
        {
            title: "模型",
            key: "model",
            width: 160,
            render: (_, record) => (
                <span className="itd-admin-ellipsis" title={record.model}>
                    {interiorModelLabel(record.model) || "—"}
                </span>
            ),
        },
        { title: "时间", key: "createdAt", width: 120, render: (_, record) => <span title={record.createdAt}>{formatInteriorTime(record.createdAt)}</span> },
        {
            title: "操作",
            key: "actions",
            width: 80,
            fixed: "right",
            render: (_, record) => (
                <Button size="small" aria-label={`查看 ${adminUserLabel(record.user)} 的出图记录`} onClick={() => onOpenRecord(record.id)}>
                    查看
                </Button>
            ),
        },
    ];

    return (
        <div className="itd-admin-panel">
            {error ? (
                <div className="itd-admin-load-error" role="alert">
                    <span>{error}</span>
                    <Button size="small" onClick={() => setReloadKey((value) => value + 1)}>
                        重新加载
                    </Button>
                </div>
            ) : null}
            <AdminDataTable<AdminInteriorGeneration>
                toolbar={
                    <div className="itd-admin-records-toolbar">
                        <AdminSearchInput allowClear prefix={<Search className="size-4" />} value={keyword} aria-label="搜索出图记录" placeholder="用户名、昵称、邮箱或任务 ID" onValueChange={setKeyword} />
                        <Select
                            aria-label="按出图方式筛选"
                            value={mode}
                            options={modeOptions}
                            onChange={(value) => {
                                setMode(value);
                                setPage(1);
                            }}
                        />
                        <Select
                            aria-label="按状态筛选"
                            value={status}
                            options={INTERIOR_STATUS_FILTERS}
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
                table={{ rowKey: "id", loading, pagination: false, columns, dataSource: records, scroll: { x: 1100 } }}
                empty={filtered ? <AdminTableEmpty filtered /> : <AdminTableEmpty title="还没有出图记录" description="用户在「室内设计」里出图后，记录会出现在这里。" />}
            />
            <InteriorGenerationDrawer id={recordId} onClose={() => onOpenRecord("")} />
        </div>
    );
}
