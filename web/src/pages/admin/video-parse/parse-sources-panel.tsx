import { App, Button, Form, Input, InputNumber, Switch } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "@/pages/admin/components/admin-ui";
import { AdminModal } from "@/pages/admin/ui/overlays";
import {
    SOCIAL_VIDEO_PARSE_EXPORT_FORMAT,
    createSocialVideoParseSource,
    deleteSocialVideoParseSource,
    setSocialVideoParseAPIEnabled,
    syncSocialVideoParseSource,
    updateSocialVideoParseSource,
    type SocialVideoParseAPI,
    type SocialVideoParseImportResult,
    type SocialVideoParseSource,
    type SocialVideoParseSourceInput,
} from "@/services/api/social-video-parse";
import { formatParseTime } from "./parse-shared";

const SUBSCRIPTION_EXAMPLE = JSON.stringify(
    {
        format: SOCIAL_VIDEO_PARSE_EXPORT_FORMAT,
        version: 1,
        apis: [{ name: "示例接口", platforms: ["douyin", "kuaishou"], method: "GET", url: "https://api.example.com/parse?url={url}", mapping: { successPath: "code", successValues: "200", videoUrlPath: "data.url" } }],
    },
    null,
    2,
);

export function importResultSummary(result: SocialVideoParseImportResult) {
    return `新增 ${result.created} 条，更新 ${result.updated} 条${result.enabled ? `，测试通过并启用 ${result.enabled} 条` : ""}`;
}

/** 订阅源：定时拉一份接口清单，按请求方式 + 地址 + 请求体去重后并进接口池（自动采集）。 */
export function ParseSourcesPanel({ sources, apis, onChanged }: { sources: SocialVideoParseSource[]; apis: SocialVideoParseAPI[]; onChanged: () => void }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<SocialVideoParseSourceInput>();
    const [editing, setEditing] = useState<SocialVideoParseSource | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState("");

    const open = (source: SocialVideoParseSource | null) => {
        setEditing(source);
        form.resetFields();
        form.setFieldsValue(source ? { name: source.name, url: source.url, enabled: source.enabled, intervalHours: source.intervalHours, autoEnable: source.autoEnable } : { name: "", url: "", enabled: true, intervalHours: 24, autoEnable: true });
        setEditorOpen(true);
    };
    const save = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const input = { ...values, name: values.name.trim(), url: values.url.trim() };
            if (editing) await updateSocialVideoParseSource(editing.id, input);
            else await createSocialVideoParseSource(input);
            message.success(editing ? "订阅源已保存" : "订阅源已添加，可以点「立即同步」先拉一次");
            setEditorOpen(false);
            onChanged();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存订阅源失败");
        } finally {
            setSaving(false);
        }
    };
    const sync = async (source: SocialVideoParseSource) => {
        setSyncing(source.id);
        try {
            const result = await syncSocialVideoParseSource(source.id);
            if (result.errors.length)
                modal.warning({
                    title: `同步完成：${importResultSummary(result)}`,
                    content: (
                        <ul className="admin-video-parse-notes">
                            {result.errors.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    ),
                });
            else message.success(`同步完成：${importResultSummary(result)}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "同步订阅源失败");
        } finally {
            setSyncing("");
            onChanged();
        }
    };
    const remove = async (source: SocialVideoParseSource, removeApis: boolean) => {
        try {
            await deleteSocialVideoParseSource(source.id, removeApis);
            message.success(removeApis ? "订阅源和它采集的接口已删除" : "订阅源已删除，采集来的接口改为手动维护");
            onChanged();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除订阅源失败");
        }
    };
    const toggle = async (source: SocialVideoParseSource, enabled: boolean) => {
        try {
            await updateSocialVideoParseSource(source.id, { name: source.name, url: source.url, enabled, intervalHours: source.intervalHours, autoEnable: source.autoEnable });
            onChanged();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "修改订阅源失败");
        }
    };
    const enableCollected = async (source: SocialVideoParseSource) => {
        const targets = apis.filter((api) => api.sourceId === source.id && !api.enabled);
        await Promise.all(targets.map((api) => setSocialVideoParseAPIEnabled(api.id, true)));
        message.success(`已启用 ${targets.length} 条采集来的接口`);
        onChanged();
    };

    const columns: ColumnsType<SocialVideoParseSource> = [
        {
            title: "订阅源",
            render: (_, source) => (
                <div className="admin-video-parse-main">
                    <strong>{source.name}</strong>
                    <small className="admin-video-parse-mono">{source.url}</small>
                </div>
            ),
        },
        {
            title: "状态",
            width: 130,
            render: (_, source) => (
                <div className="admin-video-parse-status">
                    <AdminStatusBadge label={source.enabled ? "定时同步" : "已停用"} tone={source.enabled ? "success" : "neutral"} />
                    <Switch size="small" checked={source.enabled} aria-label={`${source.enabled ? "停用" : "启用"}${source.name}`} onChange={(checked) => void toggle(source, checked)} />
                </div>
            ),
        },
        { title: "间隔", width: 90, render: (_, source) => `${source.intervalHours} 小时` },
        { title: "新接口", width: 120, render: (_, source) => (source.autoEnable ? "测试通过后启用" : "先停用") },
        {
            title: "上次同步",
            width: 260,
            render: (_, source) => {
                const collected = apis.filter((api) => api.sourceId === source.id);
                return (
                    <div className="admin-video-parse-main">
                        <span>{source.lastSyncedAt ? formatParseTime(source.lastSyncedAt) : "还没同步过"}</span>
                        {source.lastError ? (
                            <small className="admin-video-parse-error">{source.lastError}</small>
                        ) : source.lastSyncedAt ? (
                            <small>{`清单 ${source.lastTotal} 条，新增 ${source.lastCreated}，更新 ${source.lastUpdated}；在池里 ${collected.length} 条（启用 ${collected.filter((api) => api.enabled).length}）`}</small>
                        ) : null}
                    </div>
                );
            },
        },
        {
            title: "操作",
            width: 220,
            render: (_, source) => (
                <AdminRowActions
                    primary={{ label: syncing === source.id ? "同步中…" : "立即同步", icon: <RefreshCw className="size-3.5" />, disabled: Boolean(syncing), onClick: () => sync(source) }}
                    visibleActionCount={1}
                    actions={[
                        { key: "edit", label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => open(source) },
                        { key: "enable", label: "启用采集来的接口", disabled: !apis.some((api) => api.sourceId === source.id && !api.enabled), onClick: () => enableCollected(source) },
                        {
                            key: "delete",
                            label: "删除（保留接口）",
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: `删除订阅源「${source.name}」？`, description: "采集来的接口会保留，改为手动维护。", okText: "删除" },
                            onClick: () => remove(source, false),
                        },
                        {
                            key: "delete-all",
                            label: "删除并移除接口",
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            confirm: { title: `删除「${source.name}」和它采集的接口？`, description: "从这个订阅源采集来的接口会一起删除，不能恢复。", okText: "全部删除" },
                            onClick: () => remove(source, true),
                        },
                    ]}
                />
            ),
        },
    ];

    return (
        <div className="admin-video-parse-panel">
            <div className="admin-video-parse-panel-head">
                <p className="admin-video-parse-muted">
                    订阅源返回一份接口清单（与「导出」的格式相同，也可以直接是接口数组），后台按设置的间隔拉取，新接口按请求方式、地址和请求体去重后加进接口池。打开「测试通过后启用」时，用「设置」里各平台的测试链接测一遍，通过的直接启用。
                </p>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => open(null)}>
                    新增订阅源
                </Button>
            </div>
            <AdminDataTable table={{ rowKey: "id", pagination: false, columns, dataSource: sources, scroll: { x: 960 } }} empty={<AdminTableEmpty title="还没有订阅源" description="添加一个返回接口清单的地址，后台会定时采集新接口。" />} />
            <details className="admin-video-parse-preview">
                <summary>订阅内容格式示例</summary>
                <pre>{SUBSCRIPTION_EXAMPLE}</pre>
            </details>
            <AdminModal title={editing ? "编辑订阅源" : "新增订阅源"} open={editorOpen} onCancel={() => !saving && setEditorOpen(false)} onOk={() => void save()} okText="保存" confirmLoading={saving} width={560}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请填写订阅源名称" }]}>
                        <Input maxLength={60} placeholder="如：社区接口清单" />
                    </Form.Item>
                    <Form.Item name="url" label="订阅地址" rules={[{ required: true, whitespace: true, message: "请填写订阅地址" }]} extra="返回 JSON，最大 1 MiB。">
                        <Input className="admin-video-parse-mono" placeholder="https://example.com/video-parse-apis.json" />
                    </Form.Item>
                    <div className="admin-video-parse-grid is-3">
                        <Form.Item name="intervalHours" label="同步间隔（小时）">
                            <InputNumber min={1} max={168} precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item name="enabled" label="定时同步" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="autoEnable" label="测试通过后启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                </Form>
            </AdminModal>
        </div>
    );
}
