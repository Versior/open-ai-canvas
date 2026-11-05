import { Alert, App, AutoComplete, Button, Form, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { InteriorCoverUpload, type InteriorCover } from "./interior-cover-upload";
import { ApiError } from "@/services/api/request";
import { INTERIOR_VERSION_CONFLICT, interiorPresetInput, listAdminInteriorPresets, saveAdminInteriorPreset, type InteriorPreset, type InteriorPresetInput, type InteriorPresetType } from "@/services/api/interior";

type PresetForm = { key: string; groupName: string; name: string; summary: string; prompt: string; tags: string[]; sortOrder: number; enabled: boolean };

const COPY: Record<InteriorPresetType, { noun: string; intro: string; promptLabel: string; promptHelp: string }> = {
    style: {
        noun: "风格",
        intro: "用户在出图时选择的装修风格。提示词片段替换模板里的 {{style_prompt}}，写清配色、材质、家具和灯光。",
        promptLabel: "风格要点（提示词片段）",
        promptHelp: "例如：以白色、浅灰为主；平板无把手柜门；哑光墙面，浅色木地板；软装少而精。",
    },
    room: {
        noun: "空间",
        intro: "房间类型。提示词片段替换模板里的 {{room_prompt}}，写这个空间必须有的家具和布局要求。",
        promptLabel: "空间要点（提示词片段）",
        promptHelp: "例如：客厅需要有沙发、茶几、电视墙或背景墙，留出通往其他房间的通道。",
    },
};

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

function formValues(preset?: InteriorPreset): PresetForm {
    return {
        key: preset?.key || "",
        groupName: preset?.groupName || "",
        name: preset?.name || "",
        summary: preset?.summary || "",
        prompt: preset?.prompt || "",
        tags: preset?.tags || [],
        sortOrder: preset?.sortOrder || 0,
        enabled: preset?.enabled ?? true,
    };
}

export function InteriorPresetsPanel({ type }: { type: InteriorPresetType }) {
    const { message } = App.useApp();
    const copy = COPY[type];
    const [presets, setPresets] = useState<InteriorPreset[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<{ preset?: InteriorPreset; cover: InteriorCover } | null>(null);
    const [coverUploading, setCoverUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toggling, setToggling] = useState("");
    const [query, setQuery] = useState("");
    const [form] = Form.useForm<PresetForm>();

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setPresets(await listAdminInteriorPresets(type));
            setError("");
        } catch (cause) {
            setError(errorText(cause, `读取${COPY[type].noun}失败`));
        } finally {
            setLoading(false);
        }
    }, [type]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const groups = useMemo(() => [...new Set(presets.map((item) => item.groupName).filter(Boolean))].map((value) => ({ value, label: value })), [presets]);
    const visible = useMemo(() => {
        const text = query.trim().toLowerCase();
        if (!text) return presets;
        return presets.filter((item) => `${item.name} ${item.key} ${item.groupName} ${item.summary}`.toLowerCase().includes(text));
    }, [presets, query]);

    const open = (preset?: InteriorPreset) => {
        form.setFieldsValue(formValues(preset));
        setEditing({ preset, cover: { resourceId: preset?.coverResourceId || "", ...(preset?.coverUrl ? { url: preset.coverUrl } : {}) } });
    };

    const saveFailed = (cause: unknown) => {
        if (cause instanceof ApiError && cause.reason === INTERIOR_VERSION_CONFLICT) {
            message.error("这条配置已被其他管理员修改，已刷新列表，请重新编辑");
            void reload();
            return;
        }
        message.error(errorText(cause, "保存失败"));
    };

    const save = async () => {
        if (!editing) return;
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        const input: InteriorPresetInput = {
            type,
            key: values.key.trim(),
            groupName: (values.groupName || "").trim(),
            name: values.name.trim(),
            summary: (values.summary || "").trim(),
            coverResourceId: editing.cover.resourceId,
            prompt: (values.prompt || "").trim(),
            tags: values.tags || [],
            sortOrder: values.sortOrder || 0,
            enabled: values.enabled,
            version: editing.preset?.version || 0,
        };
        setSaving(true);
        try {
            await saveAdminInteriorPreset(editing.preset?.id, input);
            message.success("已保存");
            setEditing(null);
            await reload();
        } catch (cause) {
            saveFailed(cause);
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (preset: InteriorPreset, enabled: boolean) => {
        setToggling(preset.id);
        try {
            await saveAdminInteriorPreset(preset.id, interiorPresetInput(preset, { enabled }));
            await reload();
        } catch (cause) {
            saveFailed(cause);
        } finally {
            setToggling("");
        }
    };

    return (
        <div className="itd-admin-panel">
            <div className="itd-admin-toolbar">
                <Typography.Text type="secondary">{copy.intro}</Typography.Text>
                <Space>
                    <Input.Search allowClear placeholder={`搜索${copy.noun}`} value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: 200 }} />
                    <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus size={14} />} onClick={() => open()}>
                        新增{copy.noun}
                    </Button>
                </Space>
            </div>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Table<InteriorPreset>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={visible}
                pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
                columns={[
                    {
                        title: copy.noun,
                        key: "name",
                        render: (_, preset) => (
                            <div>
                                <Typography.Text strong>{preset.name}</Typography.Text> {preset.builtin ? <Tag>内置</Tag> : null}
                                <br />
                                <Typography.Text type="secondary">{preset.summary || preset.key}</Typography.Text>
                            </div>
                        ),
                    },
                    { title: "分组", dataIndex: "groupName", width: 100 },
                    { title: "提示词片段", key: "prompt", ellipsis: true, render: (_, preset) => <Typography.Text type="secondary">{preset.prompt || "—"}</Typography.Text> },
                    { title: "排序", dataIndex: "sortOrder", width: 70 },
                    {
                        title: "开放",
                        key: "enabled",
                        width: 80,
                        render: (_, preset) => <Switch size="small" checked={preset.enabled} loading={toggling === preset.id} onChange={(checked) => void toggle(preset, checked)} aria-label={`开放${preset.name}`} />,
                    },
                    {
                        title: "操作",
                        key: "actions",
                        width: 80,
                        render: (_, preset) => (
                            <Button size="small" onClick={() => open(preset)}>
                                编辑
                            </Button>
                        ),
                    },
                ]}
            />
            <AppModal
                open={Boolean(editing)}
                title={editing?.preset ? `编辑：${editing.preset.name}` : `新增${copy.noun}`}
                width={640}
                okText={coverUploading ? "等待封面上传" : "保存"}
                okButtonProps={{ disabled: coverUploading }}
                cancelText="取消"
                confirmLoading={saving}
                onOk={() => void save()}
                onCancel={() => !coverUploading && setEditing(null)}
                cancelButtonProps={{ disabled: coverUploading }}
                closable={!coverUploading}
                maskClosable={!coverUploading}
                keyboard={!coverUploading}
                forceRender
                destroyOnHidden={false}
            >
                <Form<PresetForm> form={form} layout="vertical" className="itd-admin-form">
                    <div className="itd-admin-grid">
                        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
                            <Input maxLength={120} />
                        </Form.Item>
                        <Form.Item name="key" label="标识" tooltip="小写字母、数字和短横线，保存后不能修改" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9-]{0,62}$/, message: "只能用小写字母、数字和短横线" }]}>
                            <Input maxLength={63} disabled={Boolean(editing?.preset)} />
                        </Form.Item>
                        <Form.Item name="groupName" label="分组">
                            <AutoComplete allowClear options={groups} placeholder="例如：现代、东方、住宅" filterOption={(input, option) => String(option?.value || "").includes(input)} />
                        </Form.Item>
                        <Form.Item name="summary" label="一句话简介">
                            <Input maxLength={240} />
                        </Form.Item>
                    </div>
                    <Form.Item label="封面" extra={type === "style" ? "显示在前台风格按钮上，建议用这个风格的代表效果图。" : "可选，前台暂未展示空间封面。"}>
                        <InteriorCoverUpload value={editing?.cover || { resourceId: "" }} disabled={saving} onUploadingChange={setCoverUploading} onChange={(cover) => setEditing((current) => (current ? { ...current, cover } : current))} />
                    </Form.Item>
                    <Form.Item name="prompt" label={copy.promptLabel} extra={copy.promptHelp} rules={type === "style" ? [{ required: true, message: "风格必须填写提示词片段" }] : []}>
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={2000} showCount />
                    </Form.Item>
                    <div className="itd-admin-grid">
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车" />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber min={0} max={100000} />
                        </Form.Item>
                        <Form.Item name="enabled" label="对用户开放" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </div>
                </Form>
            </AppModal>
        </div>
    );
}
