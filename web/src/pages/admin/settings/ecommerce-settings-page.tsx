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
import { useEcommerceSettings } from "@/stores/use-ecommerce-settings";
import { EcommerceTemplateEditor } from "./ecommerce-template-editor";
import "./ecommerce-settings-page.css";
import { ECOMMERCE_CAPABILITIES, type EcommerceCapability } from "@/lib/ecommerce/ecommerce-capabilities";
import { ecommerceCapabilitySettings } from "@/services/api/ecommerce";
import { getAdminEcommerceDefaults } from "@/services/api/ecommerce";
import { ECOMMERCE_PRINT_SPECS } from "@/lib/ecommerce/ecommerce-print-specs";

export default function EcommerceSettingsPage() {
    const { message, modal } = App.useApp();
    const [saved, setSaved] = useState<EcommerceSetting>();
    const [defaults, setDefaults] = useState<Record<string, string>>({});
    const [defaultsError, setDefaultsError] = useState("");
    const [defaultsLoading, setDefaultsLoading] = useState(true);
    const loadDefaults = useCallback(async () => {
        setDefaultsLoading(true);
        setDefaultsError("");
        try {
            const result = await getAdminEcommerceDefaults();
            const keys = [...ECOMMERCE_FLOW_IDS, ...ECOMMERCE_CAPABILITIES.map((item) => "cap:" + item.id)];
            if (keys.some((key) => typeof result.defaults?.[key] !== "string" || !result.defaults[key].trim())) throw new Error("内置指令响应不完整，请更新后端后重试");
            setDefaults(result.defaults);
        } catch (error) {
            setDefaultsError(error instanceof Error ? error.message : "默认指令读取失败");
        } finally {
            setDefaultsLoading(false);
        }
    }, []);
    const [draft, setDraft] = useState<EcommerceSetting>();
    const [promptFlow, setPromptFlow] = useState<(typeof ECOMMERCE_FLOW_IDS)[number]>("detail");
    const [selectedCapability, setSelectedCapability] = useState<EcommerceCapability>("planning");
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
        void loadDefaults();
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
    }, [loadDefaults]);
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
                    <Button className="admin-ecommerce-save" loading={busy} disabled={!dirty || loading} onClick={() => void save()} icon={<Save className="size-4" />}>
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
                <div className="admin-settings-stack admin-ecommerce">
                    <div className="admin-settings-status-bar">
                        <AdminStatusBadge label={dirty ? "有未保存修改" : "已保存"} tone={dirty ? "warning" : "success"} />
                        <Button disabled={busy || loading} onClick={() => (dirty ? modal.confirm({ title: "载入上一版会覆盖当前草稿", okText: "载入上一版", cancelText: "继续编辑", onOk: previous }) : void previous())}>
                            载入上一版
                        </Button>
                        <span>修改保存后生效</span>
                    </div>
                    {defaultsError ? (
                        <p role="alert">
                            {defaultsError}
                            <Button type="text" disabled={defaultsLoading} onClick={() => void loadDefaults()}>
                                重试读取默认指令
                            </Button>
                        </p>
                    ) : null}
                    <Tabs
                        className="admin-ecommerce-tabs"
                        items={[
                            {
                                key: "capabilities",
                                label: "工作台能力",
                                children: (
                                    <SettingsSectionCard title="电商工作台" description="选择左侧功能，配置开放状态与专用指令。修改保存后生效。" layout="stacked">
                                        <div className="admin-ecommerce-capability-workspace">
                                            <nav className="admin-ecommerce-capability-nav" aria-label="选择工作台能力">
                                                {ECOMMERCE_CAPABILITIES.map((item) => (
                                                    <button key={item.id} type="button" aria-pressed={selectedCapability === item.id} onClick={() => setSelectedCapability(item.id)}>
                                                        <strong>{item.name}</strong>
                                                        <span>
                                                            {ecommerceCapabilitySettings(draft)[item.id].enabled ? "已开放" : "已停用"} ·{" "}
                                                            {["print-pack", "layers"].includes(item.id) ? "图片处理与导出" : ecommerceCapabilitySettings(draft)[item.id].directorPrompt.trim() ? "自定义指令" : "内置指令"}
                                                        </span>
                                                    </button>
                                                ))}
                                            </nav>
                                            <Form layout="vertical" className="admin-ecommerce-capability-editor">
                                                {ECOMMERCE_CAPABILITIES.filter((item) => item.id === selectedCapability).map((item) => {
                                                    const config = ecommerceCapabilitySettings(draft)[item.id];
                                                    const patch = (change: Partial<typeof config>) => {
                                                        const capabilities = { ...ecommerceCapabilitySettings(draft), [item.id]: { ...config, ...change } };
                                                        const originalDefaults = !saved?.capabilities && Object.values(capabilities).every((item) => item.enabled && !item.directorPrompt);
                                                        setDraft({ ...draft, capabilities: originalDefaults ? undefined : capabilities });
                                                    };
                                                    const localOnly = item.id === "print-pack" || item.id === "layers";
                                                    return (
                                                        <div key={item.id}>
                                                            <Form.Item label={item.name} extra={item.description}>
                                                                <Switch aria-label={item.name + "开放使用"} disabled={busy} checked={config.enabled} onChange={(enabled) => patch({ enabled })} />
                                                            </Form.Item>
                                                            {item.id === "pipeline" ? (
                                                                <p className="admin-ecommerce-note">
                                                                    成包流水线需要同时开放花型工坊、印刷规格包和 Listing 文案。
                                                                    {["pattern", "print-pack", "listing"].some((id) => !ecommerceCapabilitySettings(draft)[id as EcommerceCapability].enabled) ? "当前有依赖功能停用，流水线执行会被阻止。" : ""}
                                                                </p>
                                                            ) : null}
                                                            {["print-pack", "pipeline"].includes(item.id) ? (
                                                                <div className="admin-ecommerce-specs">
                                                                    <p>内置印刷规格 · 300 DPI</p>
                                                                    <ul>{ECOMMERCE_PRINT_SPECS.map((spec) => <li key={spec.id}><span>{spec.label}</span><span>{spec.width} × {spec.height} px · 安全边距 {spec.safeMarginPct}%</span></li>)}</ul>
                                                                    <p className="admin-ecommerce-note">居中排版自动留出安全边距；满印和铺满只显示裁切参考线。规格包包含原稿、预览、品类示意和清单。手机壳为通用初稿，生产前须核对承印商模板。</p>
                                                                </div>
                                                            ) : null}
                                                            {item.id === "pattern" ? <p className="admin-ecommerce-note">支持提取、起稿、衍生、确定性改色、像素验缝和私人花型库。私人模板、模特与花型可由用户核对后同步云端；公共发布仍由管理员维护。</p> : null}
                                                            {localOnly ? (
                                                                <p>使用专用图片处理与导出流程，无需配置分析指令。</p>
                                                            ) : (
                                                                <>
                                                                    <div className="admin-ecommerce-prompt-heading">
                                                                        <span>{config.directorPrompt.trim() ? "自定义指令" : "内置默认指令"}</span>
                                                                        <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} disabled={busy || !config.directorPrompt} onClick={() => patch({ directorPrompt: "" })}>
                                                                            恢复内置默认
                                                                        </Button>
                                                                    </div>
                                                                    <Form.Item extra="下方展示实际使用的完整指令。编辑后成为自定义覆盖，保存修改后生效。">
                                                                        <Input.TextArea
                                                                            aria-label={item.name + "私有分析指令"}
                                                                            disabled={busy || (!config.directorPrompt && !defaults["cap:" + item.id])}
                                                                            rows={8}
                                                                            maxLength={20000}
                                                                            value={config.directorPrompt || defaults["cap:" + item.id] || ""}
                                                                            placeholder={defaultsLoading ? "正在读取内置指令…" : "内置指令未读取成功，请点击上方重试"}
                                                                            onChange={(event) => patch({ directorPrompt: event.target.value })}
                                                                        />
                                                                    </Form.Item>
                                                                </>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </Form>
                                        </div>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "features",
                                label: "使用功能",
                                children: (
                                    <SettingsSectionCard title="功能开放" description="控制新创作入口与后续套图操作，已有画布内容保留">
                                        <Form layout="vertical" className="admin-ecommerce-features">
                                            <Form.Item label="电商画布" extra="允许用户创建电商画布">
                                                <Switch aria-label="电商画布" disabled={busy} checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
                                            </Form.Item>
                                            <Form.Item label="模特库" extra="使用公共与私人模特参考图">
                                                <Switch aria-label="模特库" disabled={busy} checked={draft.modelLibraryEnabled} onChange={(modelLibraryEnabled) => setDraft({ ...draft, modelLibraryEnabled })} />
                                            </Form.Item>
                                            <Form.Item label="自动装订" extra="图片生成后拼接与切片">
                                                <Switch aria-label="自动装订" disabled={busy} checked={draft.autoBindEnabled} onChange={(autoBindEnabled) => setDraft({ ...draft, autoBindEnabled })} />
                                            </Form.Item>
                                            {ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => (
                                                <Form.Item key={flow.id} label={flow.name.replace(/^一键/, "")} extra={flow.hint}>
                                                    <Switch
                                                        aria-label={flow.name}
                                                        disabled={busy}
                                                        checked={draft.flows[flow.id].enabled}
                                                        onChange={(enabled) => setDraft({ ...draft, flows: { ...draft.flows, [flow.id]: { ...draft.flows[flow.id], enabled } } })}
                                                    />
                                                </Form.Item>
                                            ))}
                                        </Form>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "prompts",
                                label: "分析指令",
                                children: (
                                    <SettingsSectionCard title="分析提示词" description="已内置 EcomGen 默认规划规则，留空即可使用。仅需定制时填写覆盖指令，用户端不可见。" layout="stacked">
                                        <div className="admin-ecommerce-prompt-nav" role="group" aria-label="选择分析用途">
                                            {ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => (
                                                <button key={flow.id} type="button" aria-pressed={promptFlow === flow.id} onClick={() => setPromptFlow(flow.id)}>
                                                    {flow.name.replace(/^一键/, "")}
                                                </button>
                                            ))}
                                        </div>
                                        <Form layout="vertical" className="admin-ecommerce-prompt-editor">
                                            {[promptFlow].map((id) => {
                                                const flow = ECOMMERCE_ONE_CLICK_FLOWS.find((item) => item.id === id)!;
                                                return (
                                                    <Form.Item
                                                        key={id}
                                                        label={
                                                            <div className="admin-ecommerce-prompt-heading">
                                                                <span>
                                                                    {flow.name} · {draft.flows[id].directorPrompt ? "自定义" : "内置默认"}
                                                                </span>
                                                                <Button
                                                                    type="text"
                                                                    size="small"
                                                                    icon={<Undo2 className="size-3.5" />}
                                                                    disabled={busy || !draft.flows[id].directorPrompt}
                                                                    onClick={() => setDraft({ ...draft, flows: { ...draft.flows, [id]: { ...draft.flows[id], directorPrompt: "" } } })}
                                                                >
                                                                    恢复内置默认
                                                                </Button>
                                                            </div>
                                                        }
                                                    >
                                                        <Input.TextArea
                                                            aria-label={`${flow.name}默认提示词`}
                                                            disabled={busy || (!draft.flows[id].directorPrompt && !defaults[id])}
                                                            rows={16}
                                                            maxLength={20000}
                                                            showCount
                                                            value={draft.flows[id].directorPrompt || defaults[id] || ""}
                                                            placeholder="留空使用服务端内置指令：遵守商品事实、禁止项、计划张数及整套视觉规范，逐行生成完整出图提示词。"
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
                                key: "templates",
                                label: `套图模板（${draft.templates.length}）`,
                                children: (
                                    <SettingsSectionCard title="套图模板" description="维护画面顺序、每张职责与整套视觉规范。已选用的创作表保存快照，后续修改不会覆盖已有创作。" layout="stacked">
                                        <EcommerceTemplateEditor templates={draft.templates} disabled={busy} onChange={(templates) => setDraft({ ...draft, templates })} />
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
                                                <div key={model.id} className="admin-ecommerce-model">
                                                    <Form layout="vertical" className="admin-ecommerce-model-fields">
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
                                                    <label className="admin-ecommerce-upload">
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
