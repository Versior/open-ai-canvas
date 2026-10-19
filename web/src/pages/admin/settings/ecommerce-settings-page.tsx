import { App, Button, Form, Input, Skeleton, Tabs } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { RefreshCw, Save, Undo2, Plus, Trash2 } from "lucide-react";
import { AdminPageFrame } from "../components/admin-shell";
import { SettingsSectionCard, AdminStatusBadge } from "../components/admin-ui";
import { Switch } from "../ui/controls";
import { ECOMMERCE_FLOW_IDS, ecommercePublicImageUrl, ecommerceSettingsEqual, getAdminEcommerceSetting, getPreviousEcommerceSetting, saveAdminEcommerceSetting, uploadEcommerceModelImage, type EcommerceSetting } from "@/services/api/ecommerce";
import { resourceFileUrl } from "@/services/api/resources";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "@/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteDirectorPrompt } from "@/lib/ecommerce/ecommerce-suite";
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";

export default function EcommerceSettingsPage() {
    const { message, modal } = App.useApp();
    const [saved, setSaved] = useState<EcommerceSetting>();
    const [draft, setDraft] = useState<EcommerceSetting>();
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [uploadedIds, setUploadedIds] = useState<Set<string>>(new Set());
    const operationRef = useRef(false);
    const dirty = Boolean(draft && saved && !ecommerceSettingsEqual(draft, saved));
    const blocker = useBlocker(dirty || busy);
    const load = useCallback(async () => {
        if (operationRef.current) return;
        operationRef.current = true;
        setLoading(true);
        setError("");
        try {
            const value = await getAdminEcommerceSetting();
            setSaved(value);
            setDraft(structuredClone(value));
        } catch (error) {
            setError(error instanceof Error ? error.message : "读取失败");
        } finally {
            operationRef.current = false;
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        if (!dirty && !busy) return;
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirty, busy]);
    useEffect(() => {
        if (blocker.state !== "blocked") return;
        if (busy) {
            blocker.reset();
            message.info("正在处理修改，请完成后再离开");
            return;
        }
        const dialog = modal.confirm({ title: "离开并放弃未保存修改？", okText: "放弃并离开", cancelText: "继续编辑", onOk: () => blocker.proceed(), onCancel: () => blocker.reset() });
        return () => dialog.destroy();
    }, [blocker, busy, message, modal]);
    const refresh = () => (dirty ? modal.confirm({ title: "刷新会覆盖当前草稿", okText: "刷新", cancelText: "继续编辑", onOk: load }) : void load());
    const save = async () => {
        if (!draft || operationRef.current || loading) return;
        const expected = structuredClone(draft);
        operationRef.current = true;
        setBusy(true);
        try {
            const result = await saveAdminEcommerceSetting(expected);
            if (!ecommerceSettingsEqual(result, expected, true)) throw new Error("保存响应与提交不一致，请刷新核对");
            setSaved(result);
            setDraft(structuredClone(result));
            useEcommerceSettings.getState().commit(result);
            message.success("电商画布配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            operationRef.current = false;
            setBusy(false);
        }
    };
    const previous = async () => {
        if (!draft || operationRef.current || loading) return;
        operationRef.current = true;
        setBusy(true);
        try {
            const value = await getPreviousEcommerceSetting();
            setDraft({ ...value, revision: draft.revision });
            message.info("上一版已载入草稿，保存后生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取上一版失败");
        } finally {
            operationRef.current = false;
            setBusy(false);
        }
    };
    const upload = async (modelId: string, file: File) => {
        if (operationRef.current || loading) return;
        if (file.size > 10 * 1024 * 1024) {
            message.error("图片不能超过 10MB");
            return;
        }
        operationRef.current = true;
        setBusy(true);
        try {
            const { resource } = await uploadEcommerceModelImage(file);
            if (!resource?.id) throw new Error("上传结果无效");
            setUploadedIds((current) => new Set([...current, resource.id]));
            setDraft((current) => current && { ...current, models: current.models.map((item) => (item.id === modelId ? { ...item, resourceIds: [...item.resourceIds, resource.id] } : item)) });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            operationRef.current = false;
            setBusy(false);
        }
    };
    const patchModel = (id: string, patch: Partial<EcommerceSetting["models"][number]>) => setDraft((current) => current && { ...current, models: current.models.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
    return (
        <AdminPageFrame
            title="电商画布"
            description="管理创作用途、默认提示词和公共模特库"
            scroll
            actions={
                <>
                    <Button disabled={busy || loading} onClick={refresh} icon={<RefreshCw className="size-4" />}>
                        刷新
                    </Button>
                    <Button disabled={!dirty || busy} onClick={() => setDraft(saved && structuredClone(saved))} icon={<Undo2 className="size-4" />}>
                        撤销
                    </Button>
                    <Button type="primary" loading={busy} disabled={!dirty || loading} onClick={() => void save()} icon={<Save className="size-4" />}>
                        保存修改
                    </Button>
                </>
            }
        >
            {error ? (
                <div role="alert">
                    {error}
                    <Button onClick={() => void load()}>重试</Button>
                </div>
            ) : null}
            {!draft || loading ? (
                loading ? (
                    <Skeleton active />
                ) : null
            ) : (
                <div className="admin-settings-stack">
                    <div className="admin-settings-status-bar">
                        <AdminStatusBadge label={dirty ? "有未保存修改" : "已保存"} tone={dirty ? "warning" : "success"} />
                        <Button disabled={busy || loading} onClick={() => dirty ? modal.confirm({ title: "载入上一版会覆盖当前草稿", okText: "载入上一版", cancelText: "继续编辑", onOk: previous }) : void previous()}>
                            载入上一版
                        </Button>
                        <span>保存保留上一版；公共模特停用不会删除用户已导入的私人副本。</span>
                    </div>
                    <Tabs
                        items={[
                            {
                                key: "features",
                                label: "使用功能",
                                children: (
                                    <SettingsSectionCard title="功能开放" description="控制新创作入口与后续套图操作，已有画布内容保留">
                                        <Form layout="vertical">
                                            <Form.Item label="电商画布">
                                                <Switch aria-label="电商画布" disabled={busy} checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
                                            </Form.Item>
                                            <Form.Item label="模特库">
                                                <Switch aria-label="模特库" disabled={busy} checked={draft.modelLibraryEnabled} onChange={(modelLibraryEnabled) => setDraft({ ...draft, modelLibraryEnabled })} />
                                            </Form.Item>
                                            <Form.Item label="自动装订">
                                                <Switch aria-label="自动装订" disabled={busy} checked={draft.autoBindEnabled} onChange={(autoBindEnabled) => setDraft({ ...draft, autoBindEnabled })} />
                                            </Form.Item>
                                            {ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => (
                                                <Form.Item key={flow.id} label={flow.name}>
                                                    <Switch aria-label={flow.name} disabled={busy} checked={draft.flows[flow.id].enabled} onChange={(enabled) => setDraft({ ...draft, flows: { ...draft.flows, [flow.id]: { ...draft.flows[flow.id], enabled } } })} />
                                                </Form.Item>
                                            ))}
                                        </Form>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "prompts",
                                label: "默认提示词",
                                children: (
                                    <SettingsSectionCard title="分析提示词" description="用户自定义优先；这里配置全站默认写法。留空使用内置版本，商品事实与输出格式由系统追加。" layout="stacked">
                                        <Form layout="vertical">
                                            {ECOMMERCE_FLOW_IDS.map((id) => {
                                                const flow = ECOMMERCE_ONE_CLICK_FLOWS.find((item) => item.id === id)!;
                                                return (
                                                    <Form.Item key={id} label={flow.name}>
                                                        <Input.TextArea
                                                            aria-label={`${flow.name}默认提示词`}
                                                            disabled={busy}
                                                            rows={8}
                                                            maxLength={20000}
                                                            showCount
                                                            value={draft.flows[id].directorPrompt}
                                                            placeholder={ecommerceSuiteDirectorPrompt(undefined, flow)}
                                                            onChange={(event) => setDraft({ ...draft, flows: { ...draft.flows, [id]: { ...draft.flows[id], directorPrompt: event.target.value } } })}
                                                        />
                                                    </Form.Item>
                                                );
                                            })}
                                        </Form>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "models",
                                label: `公共模特（${draft.models.length}）`,
                                children: (
                                    <SettingsSectionCard title="公共模特库" description="上传多角度参考图，发布后供用户导入。上传文件先保存，点击保存修改才发布。移除记录不会删除图片文件。" layout="stacked">
                                        <Button
                                            disabled={busy || draft.models.length >= 200}
                                            icon={<Plus className="size-4" />}
                                            onClick={() => setDraft({ ...draft, models: [...draft.models, { id: crypto.randomUUID(), name: "新模特", enabled: false, tags: [], resourceIds: [] }] })}
                                        >
                                            新增模特
                                        </Button>
                                        {draft.models.length ? (
                                            draft.models.map((model) => (
                                                <div key={model.id} className="mt-4 border-b pb-4">
                                                    <Form layout="vertical">
                                                        <Form.Item label="名称">
                                                            <Input aria-label="公共模特名称" disabled={busy} maxLength={100} value={model.name} onChange={(event) => patchModel(model.id, { name: event.target.value })} />
                                                        </Form.Item>
                                                        <Form.Item label="标签（逗号分隔）">
                                                            <Input
                                                                aria-label={`${model.name}标签`}
                                                                disabled={busy}
                                                                value={model.tags.join(",")}
                                                                onChange={(event) => patchModel(model.id, { tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()) })}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label="开放使用">
                                                            <Switch aria-label={`${model.name}开放使用`} disabled={busy || !model.resourceIds.length} checked={model.enabled} onChange={(enabled) => patchModel(model.id, { enabled })} />
                                                        </Form.Item>
                                                    </Form>
                                                    <div className="flex flex-wrap gap-3">
                                                        {model.resourceIds.map((id) => (
                                                            <div key={id}>
                                                                <img
                                                                    className="h-24 w-24 rounded object-cover"
                                                                    src={uploadedIds.has(id) ? resourceFileUrl(id) : ecommercePublicImageUrl(model.id, id)}
                                                                    alt={`${model.name}参考图`}
                                                                    onError={(event) => {
                                                                        event.currentTarget.alt = "参考图加载失败";
                                                                    }}
                                                                />
                                                                <Button
                                                                    disabled={busy}
                                                                    size="small"
                                                                    onClick={() => patchModel(model.id, { resourceIds: model.resourceIds.filter((item) => item !== id), enabled: model.resourceIds.length > 1 && model.enabled })}
                                                                >
                                                                    移除参考图
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <label className="mt-3 inline-block">
                                                        添加参考图
                                                        <input
                                                            aria-label={`${model.name}上传参考图`}
                                                            type="file"
                                                            accept="image/png,image/jpeg,image/webp"
                                                            disabled={busy || model.resourceIds.length >= 12}
                                                            onChange={(event) => {
                                                                const file = event.target.files?.[0];
                                                                event.target.value = "";
                                                                if (file) void upload(model.id, file);
                                                            }}
                                                        />
                                                    </label>
                                                    <Button danger disabled={busy} icon={<Trash2 className="size-4" />} onClick={() => setDraft({ ...draft, models: draft.models.filter((item) => item.id !== model.id) })}>
                                                        移除模特
                                                    </Button>
                                                </div>
                                            ))
                                        ) : (
                                            <p>暂无公共模特。新增并上传参考图后即可发布。</p>
                                        )}
                                    </SettingsSectionCard>
                                ),
                            },
                        ]}
                    />
                </div>
            )}
        </AdminPageFrame>
    );
}
