import { App, Button, Form, Input, Skeleton, Tabs } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { RefreshCw, Save, Undo2 } from "lucide-react";
import { AdminPageFrame } from "../components/admin-shell";
import { SettingsSectionCard, AdminStatusBadge } from "../components/admin-ui";
import { Switch } from "../ui/controls";
import { ecommerceCapabilitySettings, ecommerceSettingsEqual, getAdminEcommerceDefaults, getAdminEcommerceSetting, getPreviousEcommerceSetting, saveAdminEcommerceSetting, type EcommerceSetting } from "@/services/api/ecommerce-canvas";
import { ECOMMERCE_STUDIO_CAPABILITIES } from "@/lib/ecommerce/ecommerce-capabilities";
import { EcommerceTemplateEditor } from "./ecommerce-template-editor";
import { StudioPromptsEditor } from "./studio-prompts-editor";
import "./ecommerce-settings-page.css";

/** 电商生图台的「商品档案」能力：看图识别商品事实，再按已确认事实写卖点与文案。 */
const DOSSIER = ECOMMERCE_STUDIO_CAPABILITIES[0];
const DOSSIER_DEFAULT_KEY = `cap:${DOSSIER.id}`;

/**
 * 电商生图台配置。
 *
 * 后端仍把整份设置存在 ecommerce_canvas 里并整体校验；页面只编辑商品档案能力和套图模板，
 * 其余字段（旧画布能力、功能开关、公共模特等）保存时按读取到的原样提交。
 */
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
            if (typeof result.defaults?.[DOSSIER_DEFAULT_KEY] !== "string" || !result.defaults[DOSSIER_DEFAULT_KEY].trim()) throw new Error("内置指令响应不完整，请更新后端后重试");
            setDefaults(result.defaults);
        } catch (error) {
            setDefaultsError(error instanceof Error ? error.message : "默认指令读取失败");
        } finally {
            setDefaultsLoading(false);
        }
    }, []);
    const [draft, setDraft] = useState<EcommerceSetting>();
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
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
            message.success("电商生图台配置已保存");
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
    const dossier = draft ? ecommerceCapabilitySettings(draft)[DOSSIER.id] : undefined;
    const patchDossier = (change: Partial<NonNullable<typeof dossier>>) => {
        if (!draft || !dossier) return;
        const capabilities = { ...ecommerceCapabilitySettings(draft), [DOSSIER.id]: { ...dossier, ...change } };
        // 读到的是未配置过能力的旧设置时，改回全默认就保持字段缺省，避免无改动也算脏草稿。
        const originalDefaults = !saved?.capabilities && Object.values(capabilities).every((item) => item.enabled && !item.directorPrompt);
        setDraft({ ...draft, capabilities: originalDefaults ? undefined : capabilities });
    };
    return (
        <AdminPageFrame
            title="电商生图台"
            description="管理电商生图台的商品档案指令、出图提示词与套图模板；电商 Agent 的模型与知识在「电商 Agent」分组配置"
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
            {!draft || !dossier || loading ? (
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
                                key: "dossier",
                                label: DOSSIER.name,
                                children: (
                                    <SettingsSectionCard title={DOSSIER.name} description={`${DOSSIER.description}。修改保存后生效。`} layout="stacked">
                                        <Form layout="vertical" className="admin-ecommerce-capability-editor">
                                            <Form.Item label={DOSSIER.name} extra="关闭后，电商生图台不能再识别商品档案或撰写卖点与文案。">
                                                <Switch aria-label={DOSSIER.name + "开放使用"} disabled={busy} checked={dossier.enabled} onChange={(enabled) => patchDossier({ enabled })} />
                                            </Form.Item>
                                            <div className="admin-ecommerce-prompt-heading">
                                                <span>{dossier.directorPrompt.trim() ? "自定义指令" : "内置默认指令"}</span>
                                                <Button type="text" size="small" icon={<Undo2 className="size-3.5" />} disabled={busy || !dossier.directorPrompt} onClick={() => patchDossier({ directorPrompt: "" })}>
                                                    恢复内置默认
                                                </Button>
                                            </div>
                                            <Form.Item extra="下方展示实际使用的完整指令。编辑后成为自定义覆盖，保存修改后生效。">
                                                <Input.TextArea
                                                    aria-label={DOSSIER.name + "私有分析指令"}
                                                    disabled={busy || (!dossier.directorPrompt && !defaults[DOSSIER_DEFAULT_KEY])}
                                                    rows={8}
                                                    maxLength={20000}
                                                    value={dossier.directorPrompt || defaults[DOSSIER_DEFAULT_KEY] || ""}
                                                    placeholder={defaultsLoading ? "正在读取内置指令…" : "内置指令未读取成功，请点击上方重试"}
                                                    onChange={(event) => patchDossier({ directorPrompt: event.target.value })}
                                                />
                                            </Form.Item>
                                        </Form>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "prompts",
                                label: "出图提示词",
                                children: (
                                    <SettingsSectionCard
                                        title="出图提示词"
                                        description="生图台出图时每一层提示词的写法：镜头规格、拍摄方式、市场、质感、品类规则和微调标签。改过的替换内置写法，恢复内置或改回原样即不再覆盖；商品事实、图上文字和平台硬性要求不在这里改。修改保存后生效。"
                                        layout="stacked"
                                    >
                                        <StudioPromptsEditor
                                            value={draft.studioPrompts}
                                            disabled={busy}
                                            onChange={(studioPrompts) => {
                                                const next = { ...draft, studioPrompts };
                                                if (!studioPrompts) delete next.studioPrompts;
                                                setDraft(next);
                                            }}
                                        />
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "templates",
                                label: "套图模板",
                                children: (
                                    <SettingsSectionCard title="套图模板" description="生图台「模板套图」可以直接选内置的 1173 套模板；这里把常用的加入后台精选并按需改写画面顺序、每张职责与整套视觉规范。修改保存后生效。" layout="stacked">
                                        <EcommerceTemplateEditor templates={draft.templates} disabled={busy} onChange={(templates) => setDraft({ ...draft, templates })} />
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
