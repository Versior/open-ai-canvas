import { Button, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminSearchInput } from "@/pages/admin/components/admin-search-input";
import { AdminDataTable, AdminTableEmpty } from "@/pages/admin/components/admin-ui";
import { listAdminInteriorKnowledge, listAdminInteriorPresets, type InteriorKnowledgeEntry } from "@/services/api/interior";

const SCOPE_NAMES: Record<string, string> = { room: "单个房间", home: "整套户型", building: "建筑外观" };

/**
 * 内置的室内设计知识库（只读）：AI 方案分析和 3D 建模按范围、空间、风格和需求取相关条目当参考数据。
 * 知识随程序发布，改内容要改 backend/internal/interior/knowledge.json。
 */
export function InteriorKnowledgePanel() {
    const [entries, setEntries] = useState<InteriorKnowledgeEntry[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [kind, setKind] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setLoading(true);
        try {
            const result = await listAdminInteriorKnowledge(controller.signal);
            if (controller.signal.aborted) return;
            setEntries(result);
            setError("");
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取知识库失败");
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        return () => controllerRef.current?.abort();
    }, [load]);

    useEffect(() => {
        // 空间和风格的中文名只用来显示；读不到时显示标识。
        void Promise.all([listAdminInteriorPresets("room"), listAdminInteriorPresets("style")])
            .then(([rooms, styles]) => setNames(Object.fromEntries([...rooms, ...styles].map((item) => [item.key, item.name]))))
            .catch(() => undefined);
    }, []);

    const kindOptions = useMemo(() => {
        const kinds = new Map<string, string>();
        for (const entry of entries) kinds.set(entry.kind, entry.kindName || entry.kind);
        return [{ value: "all", label: "全部类别" }, ...Array.from(kinds, ([value, label]) => ({ value, label }))];
    }, [entries]);

    const query = keyword.trim().toLowerCase();
    const rows = useMemo(
        () =>
            entries.filter((entry) => {
                if (kind !== "all" && entry.kind !== kind) return false;
                if (!query) return true;
                const keys = [...(entry.rooms || []), ...(entry.styles || [])];
                return [entry.id, entry.title, entry.guidance, ...(entry.tags || []), ...keys, ...keys.map((key) => names[key] || "")].some((text) => text.toLowerCase().includes(query));
            }),
        [entries, kind, names, query],
    );
    const filtered = kind !== "all" || Boolean(query);
    const label = (keys: string[] | undefined, fallback: string) => (keys?.length ? keys.map((key) => names[key] || key).join("、") : fallback);

    const columns: ColumnsType<InteriorKnowledgeEntry> = [
        { title: "类别", key: "kind", width: 110, render: (_, entry) => entry.kindName || entry.kind },
        {
            title: "知识",
            key: "content",
            render: (_, entry) => (
                <div className="itd-admin-cell">
                    <strong>{entry.title}</strong>
                    <small className="itd-admin-knowledge-text">{entry.guidance}</small>
                </div>
            ),
        },
        {
            title: "适用于",
            key: "scope",
            width: 260,
            render: (_, entry) => (
                <div className="itd-admin-cell">
                    <small>{`范围：${entry.scopes?.length ? entry.scopes.map((key) => SCOPE_NAMES[key] || key).join("、") : "不限"}`}</small>
                    <small>{`空间：${label(entry.rooms, "不限")}`}</small>
                    <small>{`风格：${label(entry.styles, "不限")}`}</small>
                    {entry.tags?.length ? <small>{`关键词：${entry.tags.join("、")}`}</small> : null}
                </div>
            ),
        },
    ];

    return (
        <div className="itd-admin-panel">
            {error ? (
                <div className="itd-admin-load-error" role="alert">
                    <span>{error}</span>
                    <Button size="small" onClick={() => void load()}>
                        重新加载
                    </Button>
                </div>
            ) : null}
            <AdminDataTable<InteriorKnowledgeEntry>
                toolbar={
                    <div className="itd-admin-records-toolbar">
                        <AdminSearchInput allowClear prefix={<Search className="size-4" />} value={keyword} aria-label="搜索知识" placeholder="标题、内容、关键词、空间或风格" onValueChange={setKeyword} />
                        <Select aria-label="按类别筛选" value={kind} options={kindOptions} onChange={setKind} />
                    </div>
                }
                trailing={
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                }
                footer={<span className="itd-admin-knowledge-count">{filtered ? `${rows.length} / ${entries.length} 条` : `共 ${entries.length} 条`}</span>}
                table={{ rowKey: "id", loading, pagination: false, columns, dataSource: rows, scroll: { x: 900 } }}
                empty={filtered ? <AdminTableEmpty filtered /> : <AdminTableEmpty title="知识库是空的" description="内置知识随程序发布，读不到时检查后端版本。" />}
            />
        </div>
    );
}
