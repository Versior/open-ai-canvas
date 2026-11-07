import { Alert, App, Button, Form, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { ApiError } from "@/services/api/request";
import {
    INTERIOR_VERSION_CONFLICT,
    interiorModeInput,
    listAdminInteriorModes,
    saveAdminInteriorMode,
    type InteriorAudience,
    type InteriorInputSlot,
    type InteriorMode,
    type InteriorModeInput,
    type InteriorModelRef,
    type InteriorParamDef,
} from "@/services/api/interior";
import { InteriorCoverUpload, type InteriorCover } from "./interior-cover-upload";
import { InteriorModelMultiSelect, InteriorModelSelect } from "./interior-model-select";

const AUDIENCE_OPTIONS: Array<{ value: InteriorAudience; label: string }> = [
    { value: "both", label: "快速出图 + 专业模式" },
    { value: "quick", label: "只在快速出图" },
    { value: "pro", label: "只在专业模式" },
];
const AUDIENCE_LABEL: Record<InteriorAudience, string> = { both: "两者", quick: "快速出图", pro: "专业模式" };
const TEMPLATE_HELP = "可用变量：{{room}} 空间名、{{room_prompt}} 空间要点、{{style}} 风格名、{{style_prompt}} 风格要点、{{params}} 参数片段、{{notes}} 用户补充、{{notes_line}} 带说明的用户补充。一行里的变量都为空时整行省略。";

type ModeForm = {
    key: string;
    name: string;
    subtitle: string;
    description: string;
    audience: InteriorAudience;
    promptTemplate: string;
    paramsJson: string;
    sourceName: string;
    referenceEnabled: boolean;
    referenceName: string;
    referenceRequired: boolean;
    referenceMaxCount: number;
    requiresRoom: boolean;
    requiresStyle: boolean;
    notesRequired: boolean;
    maxCount: number;
    sortOrder: number;
    enabled: boolean;
};

type Editing = { mode?: InteriorMode; defaultModel?: InteriorModelRef; allowedModels: InteriorModelRef[]; cover: InteriorCover };

function formValues(mode?: InteriorMode): ModeForm {
    const source = mode?.slots.find((slot) => slot.key === "source");
    const reference = mode?.slots.find((slot) => slot.key === "reference");
    return {
        key: mode?.key || "",
        name: mode?.name || "",
        subtitle: mode?.subtitle || "",
        description: mode?.description || "",
        audience: mode?.audience || "both",
        promptTemplate: mode?.promptTemplate || "",
        paramsJson: JSON.stringify(mode?.params || [], null, 2),
        sourceName: source?.name || "房间照片",
        referenceEnabled: Boolean(reference),
        referenceName: reference?.name || "参考图",
        referenceRequired: reference?.required ?? true,
        referenceMaxCount: reference?.maxCount || 1,
        requiresRoom: mode?.requiresRoom ?? true,
        requiresStyle: mode?.requiresStyle ?? true,
        notesRequired: mode?.notesRequired ?? false,
        maxCount: mode?.maxCount || 4,
        sortOrder: mode?.sortOrder || 0,
        enabled: mode?.enabled ?? false,
    };
}

function parseParams(text: string): InteriorParamDef[] {
    const value: unknown = JSON.parse(text.trim() || "[]");
    if (!Array.isArray(value)) throw new Error("参数必须是数组");
    return value as InteriorParamDef[];
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 出图方式：每种方式的输入、参数、提示词模板和可用模型。模板在服务端拼接，前台目录不返回。 */
export function InteriorModesPanel() {
    const { message } = App.useApp();
    const [modes, setModes] = useState<InteriorMode[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<Editing | null>(null);
    const [saving, setSaving] = useState(false);
    const [toggling, setToggling] = useState("");
    const [coverUploading, setCoverUploading] = useState(false);
    const [form] = Form.useForm<ModeForm>();

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setModes(await listAdminInteriorModes());
            setError("");
        } catch (cause) {
            setError(errorText(cause, "读取出图方式失败"));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const open = (mode?: InteriorMode) => {
        form.setFieldsValue(formValues(mode));
        setEditing({ mode, ...(mode?.defaultModel ? { defaultModel: mode.defaultModel } : {}), allowedModels: mode?.allowedModels || [], cover: { resourceId: mode?.coverResourceId || "", ...(mode?.coverUrl ? { url: mode.coverUrl } : {}) } });
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
        let params: InteriorParamDef[];
        try {
            params = parseParams(values.paramsJson);
        } catch (cause) {
            message.error(`参数 JSON 无效：${errorText(cause, "格式错误")}`);
            return;
        }
        const slots: InteriorInputSlot[] = [{ key: "source", name: values.sourceName.trim(), required: true, maxCount: 1 }];
        if (values.referenceEnabled) slots.push({ key: "reference", name: values.referenceName.trim(), required: values.referenceRequired, maxCount: values.referenceMaxCount });
        const input: InteriorModeInput = {
            key: values.key.trim(),
            name: values.name.trim(),
            subtitle: values.subtitle.trim(),
            description: values.description.trim(),
            audience: values.audience,
            coverResourceId: editing.cover.resourceId,
            slots,
            params,
            promptTemplate: values.promptTemplate,
            requiresRoom: values.requiresRoom,
            requiresStyle: values.requiresStyle,
            notesRequired: values.notesRequired,
            ...(editing.defaultModel ? { defaultModel: editing.defaultModel } : {}),
            allowedModels: editing.allowedModels,
            maxCount: values.maxCount,
            sortOrder: values.sortOrder,
            enabled: values.enabled,
            version: editing.mode?.version || 0,
        };
        setSaving(true);
        try {
            await saveAdminInteriorMode(editing.mode?.id, input);
            message.success(input.enabled ? "已保存并对用户开放" : "已保存，暂不对用户开放");
            setEditing(null);
            await reload();
        } catch (cause) {
            saveFailed(cause);
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (mode: InteriorMode, enabled: boolean) => {
        setToggling(mode.id);
        try {
            await saveAdminInteriorMode(mode.id, interiorModeInput(mode, { enabled }));
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
                <Typography.Text type="secondary">出图方式决定用户要上传什么、能调哪些参数，以及服务端用哪段提示词出图。</Typography.Text>
                <Space>
                    <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus size={14} />} onClick={() => open()}>
                        新增出图方式
                    </Button>
                </Space>
            </div>
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Table<InteriorMode>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={modes}
                pagination={false}
                columns={[
                    {
                        title: "出图方式",
                        key: "name",
                        render: (_, mode) => (
                            <div>
                                <Typography.Text strong>{mode.name}</Typography.Text> {mode.builtin ? <Tag>内置</Tag> : null}
                                <br />
                                <Typography.Text type="secondary">{mode.subtitle || mode.key}</Typography.Text>
                            </div>
                        ),
                    },
                    { title: "面向", key: "audience", width: 110, render: (_, mode) => AUDIENCE_LABEL[mode.audience] },
                    { title: "参数", key: "params", width: 80, render: (_, mode) => `${mode.params.length} 项` },
                    { title: "每风格最多", key: "maxCount", width: 100, render: (_, mode) => `${mode.maxCount} 张` },
                    { title: "默认模型", key: "model", width: 180, render: (_, mode) => mode.defaultModel?.label || mode.defaultModel?.model || <Typography.Text type="secondary">用全局默认</Typography.Text> },
                    { title: "排序", dataIndex: "sortOrder", width: 70 },
                    {
                        title: "开放",
                        key: "enabled",
                        width: 80,
                        render: (_, mode) => <Switch size="small" checked={mode.enabled} loading={toggling === mode.id} onChange={(checked) => void toggle(mode, checked)} aria-label={`开放${mode.name}`} />,
                    },
                    {
                        title: "操作",
                        key: "actions",
                        width: 80,
                        render: (_, mode) => (
                            <Button size="small" onClick={() => open(mode)}>
                                编辑
                            </Button>
                        ),
                    },
                ]}
            />
            <AppModal
                open={Boolean(editing)}
                title={editing?.mode ? `编辑：${editing.mode.name}` : "新增出图方式"}
                width={820}
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
                <Form<ModeForm> form={form} layout="vertical" className="itd-admin-form">
                    <div className="itd-admin-grid">
                        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
                            <Input maxLength={120} />
                        </Form.Item>
                        <Form.Item name="key" label="标识" tooltip="小写字母、数字和短横线，保存后不能修改" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9-]{0,62}$/, message: "只能用小写字母、数字和短横线" }]}>
                            <Input maxLength={63} disabled={Boolean(editing?.mode)} />
                        </Form.Item>
                        <Form.Item name="subtitle" label="副标题">
                            <Input maxLength={240} />
                        </Form.Item>
                        <Form.Item name="audience" label="面向">
                            <Select options={AUDIENCE_OPTIONS} />
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label="说明">
                        <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={2000} />
                    </Form.Item>
                    <Form.Item label="封面" extra="显示在前台出图方式卡片上，建议 16:9 的示例效果图。">
                        <InteriorCoverUpload value={editing?.cover || { resourceId: "" }} disabled={saving} onUploadingChange={setCoverUploading} onChange={(cover) => setEditing((current) => (current ? { ...current, cover } : current))} />
                    </Form.Item>
                    <div className="itd-admin-grid">
                        <Form.Item name="sourceName" label="原图输入名称" rules={[{ required: true, message: "请填写名称" }]}>
                            <Input maxLength={40} />
                        </Form.Item>
                        <Form.Item name="referenceEnabled" label="需要参考图" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate={(prev, next) => prev.referenceEnabled !== next.referenceEnabled}>
                            {({ getFieldValue }) =>
                                getFieldValue("referenceEnabled") ? (
                                    <>
                                        <Form.Item name="referenceName" label="参考图名称" rules={[{ required: true, message: "请填写名称" }]}>
                                            <Input maxLength={40} />
                                        </Form.Item>
                                        <Form.Item name="referenceRequired" label="参考图必填" valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                        <Form.Item name="referenceMaxCount" label="参考图数量上限">
                                            <InputNumber min={1} max={3} />
                                        </Form.Item>
                                    </>
                                ) : null
                            }
                        </Form.Item>
                    </div>
                    <div className="itd-admin-grid is-four">
                        <Form.Item name="requiresRoom" label="必选空间" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="requiresStyle" label="必选风格" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="notesRequired" label="必须写修改要求" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="enabled" label="对用户开放" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="maxCount" label="每风格最多出图（张）">
                            <InputNumber min={1} max={4} />
                        </Form.Item>
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber min={0} max={100000} />
                        </Form.Item>
                    </div>
                    <div className="itd-admin-grid">
                        <Form.Item label="默认模型" tooltip="快速出图固定用这个模型；不设置时用「设置」里的全局默认模型">
                            <InteriorModelSelect value={editing?.defaultModel} onChange={(defaultModel) => setEditing((current) => (current ? { ...current, defaultModel } : current))} placeholder="用全局默认模型" />
                        </Form.Item>
                        <Form.Item label="快速 / 专业可选模型">
                            <InteriorModelMultiSelect value={editing?.allowedModels || []} onChange={(allowedModels) => setEditing((current) => (current ? { ...current, allowedModels } : current))} />
                        </Form.Item>
                    </div>
                    <Form.Item name="promptTemplate" label="提示词模板" extra={TEMPLATE_HELP} rules={[{ required: true, message: "请填写提示词模板" }]}>
                        <Input.TextArea autoSize={{ minRows: 6, maxRows: 16 }} maxLength={8000} showCount />
                    </Form.Item>
                    <Form.Item
                        name="paramsJson"
                        label="参数（JSON）"
                        extra='每项：{"key":"strength","label":"改造强度","default":"hard","proOnly":false,"options":[{"value":"soft","label":"只换软装","prompt":"写进 {{params}} 的片段"}]}。proOnly 的参数只在专业模式展示。'
                    >
                        <Input.TextArea autoSize={{ minRows: 4, maxRows: 14 }} className="itd-admin-code" spellCheck={false} />
                    </Form.Item>
                </Form>
            </AppModal>
        </div>
    );
}
