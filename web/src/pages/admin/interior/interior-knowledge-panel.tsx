import { App, Button, Form, Input, InputNumber, Select, Switch, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { AdminSearchInput } from "@/pages/admin/components/admin-search-input";
import { AdminDataTable, AdminTableEmpty } from "@/pages/admin/components/admin-ui";
import { ApiError } from "@/services/api/request";
import {
    INTERIOR_VERSION_CONFLICT,
    deleteAdminInteriorKnowledge,
    interiorKnowledgeInput,
    listAdminInteriorKnowledge,
    listAdminInteriorPresets,
    resetAdminInteriorKnowledge,
    saveAdminInteriorKnowledge,
    type AdminInteriorKnowledgeEntry,
    type InteriorKnowledgeKind,
} from "@/services/api/interior";

const SCOPE_OPTIONS = [
    { value: "room", label: "单个房间" },
    { value: "home", label: "整套户型" },
    { value: "building", label: "建筑外观" },
];
const SCOPE_NAMES: Record<string, string> = Object.fromEntries(SCOPE_OPTIONS.map((item) => [item.value, item.label]));
const STATUS_OPTIONS = [
    { value: "all", label: "全部状态" },
    { value: "enabled", label: "启用中" },
    { value: "disabled", label: "已停用" },
    { value: "edited", label: "改过的内置" },
    { value: "custom", label: "后台新增" },
];

type KnowledgeForm = { key: string; kind: string; title: string; guidance: string; scopes: string[]; rooms: string[]; styles: string[]; tags: string[]; sortOrder: number; enabled: boolean };

type Option = { value: string; label: string };

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function formValues(entry: AdminInteriorKnowledgeEntry | undefined, nextSort: number): KnowledgeForm {
    return {
        key: entry?.key || "",
        kind: entry?.kind || "dimension",
        title: entry?.title || "",
        guidance: entry?.guidance || "",
        scopes: entry?.scopes || [],
        rooms: entry?.rooms || [],
        styles: entry?.styles || [],
        tags: entry?.tags || [],
        sortOrder: entry?.sortOrder ?? nextSort,
        enabled: entry?.enabled ?? true,
    };
}

/**
 * 室内设计知识库：AI 方案分析和 3D 建模按范围、空间、风格和需求里的关键词取启用的相关条目当参考数据。
 * 内置条目随程序发布，可以修改和停用，改过的可以恢复原内容；后台新增的条目可以删除。
 */
export function InteriorKnowledgePanel() {
    const { message, modal } = App.useApp();
    const [entries, setEntries] = useState<AdminInteriorKnowledgeEntry[]>([]);
    const [kinds, setKinds] = useState<InteriorKnowledgeKind[]>([]);
    const [rooms, setRooms] = useState<Option[]>([]);
    const [styles, setStyles] = useState<Option[]>([]);
    const [kind, setKind] = useState("all");
    const [status, setStatus] = useState("all");
    const [keyword, setKeyword] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<{ entry?: AdminInteriorKnowledgeEntry } | null>(null);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState("");
    const [form] = Form.useForm<KnowledgeForm>();
    const controllerRef = useRef<AbortController | null>(null);

    const load = useCallback(async () => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        setLoading(true);
        try {
            const result = await listAdminInteriorKnowledge(controller.signal);
            if (controller.signal.aborted) return;
            setEntries(result.entries);
            setKinds(result.kinds);
            setError("");
        } catch (cause) {
            if (!controller.signal.aborted) setError(errorText(cause, "读取知识库失败"));
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
        return () => controllerRef.current?.abort();
    }, [load]);

    useEffect(() => {
        // 空间和风格的中文名用来显示和选择；读不到时显示标识，表单里也能直接输入标识。
        void Promise.all([listAdminInteriorPresets("room"), listAdminInteriorPresets("style")])
            .then(([roomList, styleList]) => {
                setRooms(roomList.map((item) => ({ value: item.key, label: item.name })));
                setStyles(styleList.map((item) => ({ value: item.key, label: item.name })));
            })
            .catch(() => undefined);
    }, []);

    const names = useMemo(() => Object.fromEntries([...rooms, ...styles].map((item) => [item.value, item.label])), [rooms, styles]);
    const kindOptions = useMemo(() => [{ value: "all", label: "全部类别" }, ...kinds.map((item) => ({ value: item.value, label: item.label }))], [kinds]);

    const query = keyword.trim().toLowerCase();
    const rows = useMemo(
        () =>
            entries.filter((entry) => {
                if (kind !== "all" && entry.kind !== kind) return false;
                if (status === "enabled" && !entry.enabled) return false;
                if (status === "disabled" && entry.enabled) return false;
                if (status === "edited" && !entry.edited) return false;
                if (status === "custom" && entry.builtin) return false;
                if (!query) return true;
                const keys = [...entry.rooms, ...entry.styles];
                return [entry.key, entry.title, entry.guidance, ...entry.tags, ...keys, ...keys.map((key) => names[key] || "")].some((text) => text.toLowerCase().includes(query));
            }),
        [entries, kind, names, query, status],
    );
    const filtered = kind !== "all" || status !== "all" || Boolean(query);
    const label = (keys: string[], fallback: string) => (keys.length ? keys.map((key) => names[key] || key).join("、") : fallback);
    const disabledCount = entries.filter((entry) => !entry.enabled).length;

    const failed = (cause: unknown, fallback: string) => {
        if (cause instanceof ApiError && cause.reason === INTERIOR_VERSION_CONFLICT) {
            message.error("这条知识已被其他管理员修改，已刷新列表，请重新操作");
            void load();
            return;
        }
        message.error(errorText(cause, fallback));
    };

    const open = (entry?: AdminInteriorKnowledgeEntry) => {
        const nextSort = Math.max(0, ...entries.map((item) => item.sortOrder)) + 10;
        form.setFieldsValue(formValues(entry, nextSort));
        setEditing({ entry });
    };

    const save = async () => {
        if (!editing) return;
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            await saveAdminInteriorKnowledge(editing.entry?.id, {
                key: values.key.trim(),
                kind: values.kind,
                title: values.title.trim(),
                guidance: values.guidance.trim(),
                scopes: values.scopes || [],
                rooms: values.rooms || [],
                styles: values.styles || [],
                tags: values.tags || [],
                sortOrder: values.sortOrder || 0,
                enabled: values.enabled,
                version: editing.entry?.version || 0,
            });
            message.success("已保存，之后的 AI 分析和 3D 建模按新内容取知识");
            setEditing(null);
            await load();
        } catch (cause) {
            failed(cause, "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (entry: AdminInteriorKnowledgeEntry, enabled: boolean) => {
        setBusyId(entry.id);
        try {
            await saveAdminInteriorKnowledge(entry.id, interiorKnowledgeInput(entry, { enabled }));
            await load();
        } catch (cause) {
            failed(cause, enabled ? "启用失败" : "停用失败");
        } finally {
            setBusyId("");
        }
    };

    const remove = (entry: AdminInteriorKnowledgeEntry) =>
        modal.confirm({
            title: `删除「${entry.title}」？`,
            content: "删除后 AI 分析和 3D 建模不再参考这条知识，已经生成的模型不受影响。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteAdminInteriorKnowledge(entry);
                    message.success("已删除");
                    await load();
                } catch (cause) {
                    failed(cause, "删除失败");
                }
            },
        });

    const reset = (entry: AdminInteriorKnowledgeEntry) =>
        modal.confirm({
            title: `恢复「${entry.title}」的内置内容？`,
            content: "标题、正文、适用范围和关键词恢复成程序自带的版本，之后随程序更新；启用状态不变。",
            okText: "恢复",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await resetAdminInteriorKnowledge(entry);
                    message.success("已恢复内置内容");
                    await load();
                } catch (cause) {
                    failed(cause, "恢复失败");
                }
            },
        });

    const columns: ColumnsType<AdminInteriorKnowledgeEntry> = [
        { title: "类别", key: "kind", width: 110, render: (_, entry) => entry.kindName || entry.kind },
        {
            title: "知识",
            key: "content",
            render: (_, entry) => (
                <div className="itd-admin-cell" data-disabled={!entry.enabled || undefined}>
                    <strong>
                        {entry.title}
                        {entry.builtin ? null : <Tag className="itd-admin-knowledge-tag">后台新增</Tag>}
                        {entry.edited ? (
                            <Tag color="gold" className="itd-admin-knowledge-tag">
                                已修改
                            </Tag>
                        ) : null}
                    </strong>
                    <small className="itd-admin-knowledge-text">{entry.guidance}</small>
                </div>
            ),
        },
        {
            title: "适用于",
            key: "scope",
            width: 240,
            render: (_, entry) => (
                <div className="itd-admin-cell">
                    <small>{`范围：${entry.scopes.length ? entry.scopes.map((key) => SCOPE_NAMES[key] || key).join("、") : "不限"}`}</small>
                    <small>{`空间：${label(entry.rooms, "不限")}`}</small>
                    <small>{`风格：${label(entry.styles, "不限")}`}</small>
                    {entry.tags.length ? <small>{`关键词：${entry.tags.join("、")}`}</small> : null}
                </div>
            ),
        },
        {
            title: "启用",
            key: "enabled",
            width: 70,
            render: (_, entry) => <Switch size="small" checked={entry.enabled} loading={busyId === entry.id} onChange={(checked) => void toggle(entry, checked)} aria-label={`启用${entry.title}`} />,
        },
        {
            title: "操作",
            key: "actions",
            width: 150,
            render: (_, entry) => (
                <div className="itd-admin-knowledge-actions">
                    <Button size="small" onClick={() => open(entry)}>
                        编辑
                    </Button>
                    {entry.builtin ? (
                        entry.edited ? (
                            <Button size="small" type="text" onClick={() => reset(entry)}>
                                恢复
                            </Button>
                        ) : null
                    ) : (
                        <Button size="small" type="text" danger onClick={() => remove(entry)}>
                            删除
                        </Button>
                    )}
                </div>
            ),
        },
    ];

    const editingKind = Form.useWatch("kind", form);
    const kindLimit = kinds.find((item) => item.value === editingKind)?.limit;

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
            <AdminDataTable<AdminInteriorKnowledgeEntry>
                toolbar={
                    <div className="itd-admin-records-toolbar">
                        <AdminSearchInput allowClear prefix={<Search className="size-4" />} value={keyword} aria-label="搜索知识" placeholder="标题、内容、关键词、空间或风格" onValueChange={setKeyword} />
                        <Select aria-label="按类别筛选" value={kind} options={kindOptions} onChange={setKind} />
                        <Select aria-label="按状态筛选" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
                    </div>
                }
                trailing={
                    <>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                            刷新
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => open()}>
                            新增知识
                        </Button>
                    </>
                }
                footer={
                    <span className="itd-admin-knowledge-count">
                        {filtered ? `${rows.length} / ${entries.length} 条` : `共 ${entries.length} 条`}
                        {disabledCount ? ` · 停用 ${disabledCount} 条` : ""}
                    </span>
                }
                table={{ rowKey: "id", loading, pagination: false, columns, dataSource: rows, scroll: { x: 1000 } }}
                empty={filtered ? <AdminTableEmpty filtered /> : <AdminTableEmpty title="知识库是空的" description="内置知识在后端启动时补齐，读不到时检查后端版本和启动日志。" />}
            />
            <AppModal
                open={Boolean(editing)}
                title={editing?.entry ? `编辑：${editing.entry.title}` : "新增知识"}
                width={680}
                okText="保存"
                cancelText="取消"
                confirmLoading={saving}
                onOk={() => void save()}
                onCancel={() => setEditing(null)}
                forceRender
                destroyOnHidden={false}
            >
                <Form<KnowledgeForm> form={form} layout="vertical" className="itd-admin-form">
                    {editing?.entry?.builtin ? (
                        <p className="itd-admin-muted">{editing.entry.edited ? "这是改过的内置知识，程序更新不会覆盖它；需要时可以在列表里恢复原内容。" : "这是内置知识。改了标题、正文、范围或关键词后，程序更新不再覆盖它。"}</p>
                    ) : null}
                    <div className="itd-admin-grid">
                        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: "请填写标题" }]}>
                            <Input maxLength={60} />
                        </Form.Item>
                        <Form.Item name="key" label="标识" tooltip="小写字母、数字和短横线，保存后不能修改" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9-]{0,62}$/, message: "只能用小写字母、数字和短横线" }]}>
                            <Input maxLength={63} disabled={Boolean(editing?.entry)} placeholder="例如：dim-garage" />
                        </Form.Item>
                        <Form.Item name="kind" label="类别" extra={kindLimit ? `这一类每次最多取 ${kindLimit} 条` : undefined} rules={[{ required: true }]}>
                            <Select options={kinds.map((item) => ({ value: item.value, label: item.label }))} />
                        </Form.Item>
                        <Form.Item name="scopes" label="适用范围" extra="不选表示不限范围">
                            <Select mode="multiple" allowClear options={SCOPE_OPTIONS} placeholder="不限" />
                        </Form.Item>
                    </div>
                    <Form.Item name="guidance" label="内容" tooltip="写成可以直接照做的规范或数值，例如尺寸范围、间距、配色比例。会原样写进提示词，标明是参考数据。" rules={[{ required: true, whitespace: true, message: "请填写内容" }]}>
                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={1200} showCount />
                    </Form.Item>
                    <div className="itd-admin-grid">
                        <Form.Item name="rooms" label="适用空间" extra="选了空间后，只在这些空间或需求里写到关键词时才取">
                            <Select mode="tags" allowClear options={rooms} optionFilterProp="label" placeholder="不限" />
                        </Form.Item>
                        <Form.Item name="styles" label="适用风格" extra="选了风格后，只在选中这些风格或需求里写到关键词时才取">
                            <Select mode="tags" allowClear options={styles} optionFilterProp="label" placeholder="不限" />
                        </Form.Item>
                        <Form.Item name="tags" label="关键词" extra="用户需求里出现这些词时优先取，最多 16 个">
                            <Select mode="tags" tokenSeparators={[",", "，", " "]} placeholder="输入后回车" />
                        </Form.Item>
                        <div className="itd-admin-grid">
                            <Form.Item name="sortOrder" label="排序" tooltip="同样相关时排在前面的先取">
                                <InputNumber min={0} max={100000} />
                            </Form.Item>
                            <Form.Item name="enabled" label="启用" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                        </div>
                    </div>
                </Form>
            </AppModal>
        </div>
    );
}
