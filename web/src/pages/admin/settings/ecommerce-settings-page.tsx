import { App, Button, Skeleton, Tabs } from "antd";
import { canonicalize } from "json-canonicalize";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { History, RefreshCw, Save, Undo2 } from "lucide-react";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge } from "../components/admin-ui";
import { AdminCallout } from "../ui/controls";
import { ecommerceCapabilitySettings, ecommerceSettingsEqual, getAdminEcommerceDefaults, getAdminEcommerceSetting, getPreviousEcommerceSetting, saveAdminEcommerceSetting, type EcommerceSetting } from "@/services/api/ecommerce-canvas";
import { DOSSIER, DOSSIER_DEFAULT_KEY, renderDossierPanel } from "./ecommerce-dossier-panel";
import { EcommerceTemplateEditor } from "./ecommerce-template-editor";
import { StudioPromptsEditor } from "./studio-prompts-editor";
import "./ecommerce-settings-page.css";

/** 页签名后面的状态小字；这一组有没保存的修改时加一个圆点。 */
function tabLabel(name: string, meta: string, changed: boolean): ReactNode {
    return (
        <span className="ecm-tab">
            {name}
            <em>{meta}</em>
            {changed ? (
                <span className="ecm-tab-dot" title="有未保存修改">
                    <span className="sr-only">有未保存修改</span>
                </span>
            ) : null}
        </span>
    );
}

const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/**
 * 电商生图台配置。
 *
 * 后端仍把整份设置存在 ecommerce_canvas 里并整体校验；页面只编辑商品档案能力、出图提示词和套图模板，
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
    const ready = Boolean(draft && dossier && !loading);
    const promptCount = Object.keys(draft?.studioPrompts ?? {}).length;
    const enabledTemplates = draft?.templates.filter((item) => item.enabled).length ?? 0;
    return (
        <AdminPageFrame
            title="电商生图台"
            description="商品档案指令、出图提示词与套图模板；电商 Agent 的模型与知识在「电商 Agent」分组配置"
            scroll
            actions={
                <>
                    {ready ? (
                        <span className="ecm-save-state">
                            <AdminStatusBadge label={dirty ? "有未保存修改" : "已保存"} tone={dirty ? "warning" : "success"} />
                        </span>
                    ) : null}
                    <Button
                        disabled={busy || loading || !draft}
                        onClick={() => (dirty ? modal.confirm({ title: "载入上一版会覆盖当前草稿", okText: "载入上一版", cancelText: "继续编辑", onOk: previous }) : void previous())}
                        icon={<History className="size-4" />}
                    >
                        载入上一版
                    </Button>
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
            <div className="ecm">
                {error ? (
                    <AdminCallout
                        tone="error"
                        title="电商生图台配置读取失败"
                        action={
                            <Button size="small" onClick={() => void load()}>
                                重试
                            </Button>
                        }
                    >
                        {error}
                    </AdminCallout>
                ) : null}
                {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
                {ready && draft && dossier && saved ? (
                    <Tabs
                        className="ecm-tabs"
                        items={[
                            {
                                key: "dossier",
                                label: tabLabel(DOSSIER.name, dossier.enabled ? "已开启" : "已关闭", !same(dossier, ecommerceCapabilitySettings(saved)[DOSSIER.id])),
                                children: renderDossierPanel({
                                    value: dossier,
                                    defaultText: defaults[DOSSIER_DEFAULT_KEY] || "",
                                    defaultsLoading,
                                    defaultsError,
                                    disabled: busy,
                                    onChange: patchDossier,
                                    onRetryDefaults: loadDefaults,
                                }),
                            },
                            {
                                key: "prompts",
                                label: tabLabel("出图提示词", promptCount ? `已改 ${promptCount}` : "内置", !same(draft.studioPrompts, saved.studioPrompts)),
                                children: (
                                    <>
                                        <p className="ecm-intro">生图台出图时每一层提示词的写法：镜头规格、拍摄方式、市场、质感、品类规则和微调标签。改过的条目替换内置写法；商品事实、图上文字和平台硬性要求不在这里改。</p>
                                        <StudioPromptsEditor
                                            value={draft.studioPrompts}
                                            disabled={busy}
                                            onChange={(studioPrompts) => {
                                                const next = { ...draft, studioPrompts };
                                                if (!studioPrompts) delete next.studioPrompts;
                                                setDraft(next);
                                            }}
                                        />
                                    </>
                                ),
                            },
                            {
                                key: "templates",
                                label: tabLabel("套图模板", draft.templates.length ? `启用 ${enabledTemplates}` : "未精选", !same(draft.templates, saved.templates)),
                                children: <EcommerceTemplateEditor templates={draft.templates} disabled={busy} onChange={(templates) => setDraft({ ...draft, templates })} />,
                            },
                        ]}
                    />
                ) : null}
            </div>
        </AdminPageFrame>
    );
}
