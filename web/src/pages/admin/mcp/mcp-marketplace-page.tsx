import { App, Alert, Button, Checkbox, Input, Modal, Switch } from "antd";
import { Cable, CheckCircle2, PackagePlus, RefreshCw, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import {
    deleteDomainMCPInstallation,
    fetchDomainMCPCatalog,
    fetchDomainMCPInstallations,
    installDomainMCPPack,
    testDomainMCPInstallation,
    updateDomainMCPInstallation,
    type AdminDomainMCPInstallation,
    type AdminDomainMCPPack,
} from "@/services/api/domain-mcp";

import "./mcp-marketplace-page.css";

type MarketplaceTab = "recommended" | "installed" | "connections";
type ConnectionDraft = { name: string; endpoint: string; apiKey: string; allowedTools: string[]; enabled: boolean };

const defaultAnySearchEndpoint = "https://api.anysearch.com/mcp";

export default function MCPMarketplacePage() {
    const { message, modal } = App.useApp();
    const [catalog, setCatalog] = useState<AdminDomainMCPPack[]>([]);
    const [installations, setInstallations] = useState<AdminDomainMCPInstallation[]>([]);
    const [tab, setTab] = useState<MarketplaceTab>("recommended");
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState("");
    const [error, setError] = useState("");
    const [installPack, setInstallPack] = useState<AdminDomainMCPPack | null>(null);
    const [installKey, setInstallKey] = useState("");
    const [installEndpoint, setInstallEndpoint] = useState(defaultAnySearchEndpoint);
    const [selectedInstallTools, setSelectedInstallTools] = useState<string[]>([]);
    const [drafts, setDrafts] = useState<Record<string, ConnectionDraft>>({});

    const reload = async () => {
        setLoading(true);
        setError("");
        try {
            const [nextCatalog, nextInstallations] = await Promise.all([fetchDomainMCPCatalog(), fetchDomainMCPInstallations()]);
            setCatalog(nextCatalog);
            setInstallations(nextInstallations);
            setDrafts(Object.fromEntries(nextInstallations.map((item) => [item.id, installationDraft(item)])));
        } catch (reason) {
            setError(errorMessage(reason, "读取领域能力市场失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const packById = useMemo(() => new Map(catalog.map((pack) => [pack.id, pack])), [catalog]);

    const openInstall = (pack: AdminDomainMCPPack) => {
        setInstallPack(pack);
        setInstallKey("");
        setInstallEndpoint(defaultAnySearchEndpoint);
        setSelectedInstallTools(pack.tools.map((tool) => tool.name));
        setError("");
    };

    const install = async () => {
        if (!installPack) return;
        setBusyId(installPack.id);
        setError("");
        try {
            await installDomainMCPPack({
                packId: installPack.id,
                allowedTools: selectedInstallTools,
                endpoint: installEndpoint.trim(),
                apiKey: installKey.trim(),
                enabled: true,
            });
            await reload();
            setInstallPack(null);
            message.success(`${installPack.displayName}已安装`);
            setTab("installed");
        } catch (reason) {
            setError(errorMessage(reason, "安装领域能力包失败"));
        } finally {
            setBusyId("");
        }
    };

    const testConnection = async (installation: AdminDomainMCPInstallation) => {
        setBusyId(installation.id);
        setError("");
        try {
            const result = await testDomainMCPInstallation(installation.id);
            message.success(`连接正常：${result.tools.join("、")}`);
        } catch (reason) {
            setError(errorMessage(reason, "连接测试失败"));
        } finally {
            setBusyId("");
        }
    };

    const saveConnection = async (installation: AdminDomainMCPInstallation) => {
        const draft = drafts[installation.id];
        if (!draft) return;
        setBusyId(installation.id);
        setError("");
        try {
            await updateDomainMCPInstallation(installation.id, {
                name: draft.name.trim(),
                endpoint: draft.endpoint.trim(),
                apiKey: draft.apiKey.trim(),
                allowedTools: draft.allowedTools,
                enabled: draft.enabled,
            });
            await reload();
            message.success("连接配置已保存");
        } catch (reason) {
            setError(errorMessage(reason, "保存连接配置失败"));
        } finally {
            setBusyId("");
        }
    };

    const removeInstallation = (installation: AdminDomainMCPInstallation) => {
        modal.confirm({
            title: `卸载 ${installation.name}？`,
            content: "能力包将立即从 Agent 工具目录移除，已生成的画布内容不会删除。",
            okText: "确认卸载",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                setBusyId(installation.id);
                setError("");
                try {
                    await deleteDomainMCPInstallation(installation.id);
                    await reload();
                    message.success("能力包已卸载");
                } catch (reason) {
                    setError(errorMessage(reason, "卸载领域能力包失败"));
                    throw reason;
                } finally {
                    setBusyId("");
                }
            },
        });
    };

    return (
        <AdminPageFrame
            title="领域 MCP 市场"
            description="一键安装可追溯的行业能力，并统一管理工具权限与外部检索凭据"
            scroll
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                    刷新
                </Button>
            }
        >
            <div className="domain-mcp-page-content">
                <nav className="domain-mcp-tabs" aria-label="领域 MCP 市场分区">
                    <TabButton active={tab === "recommended"} onClick={() => setTab("recommended")}>
                        推荐能力包
                    </TabButton>
                    <TabButton active={tab === "installed"} onClick={() => setTab("installed")}>
                        已安装 ({installations.length})
                    </TabButton>
                    <TabButton active={tab === "connections"} onClick={() => setTab("connections")}>
                        自定义连接
                    </TabButton>
                </nav>
                {error ? <Alert className="domain-mcp-error" type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
                {tab === "recommended" ? (
                    <section className="domain-mcp-grid" aria-label="推荐能力包">
                        {catalog.map((pack) => (
                            <PackCard key={pack.id} pack={pack} busy={busyId === pack.id} onInstall={() => openInstall(pack)} />
                        ))}
                    </section>
                ) : null}
                {tab === "installed" ? (
                    <section className="domain-mcp-grid" aria-label="已安装能力包">
                        {installations.length ? (
                            installations.map((installation) => (
                                <InstalledCard
                                    key={installation.id}
                                    installation={installation}
                                    pack={packById.get(installation.packId)}
                                    busy={busyId === installation.id}
                                    onTest={() => void testConnection(installation)}
                                    onConfigure={() => setTab("connections")}
                                    onDelete={() => removeInstallation(installation)}
                                />
                            ))
                        ) : (
                            <EmptyState text="还没有安装能力包，请先从推荐能力包中选择。" />
                        )}
                    </section>
                ) : null}
                {tab === "connections" ? (
                    <section className="domain-mcp-grid" aria-label="自定义连接">
                        {installations.length ? (
                            installations.map((installation) => (
                                <ConnectionCard
                                    key={installation.id}
                                    installation={installation}
                                    pack={packById.get(installation.packId)}
                                    draft={drafts[installation.id] ?? installationDraft(installation)}
                                    busy={busyId === installation.id}
                                    onChange={(next) => setDrafts((current) => ({ ...current, [installation.id]: next }))}
                                    onSave={() => void saveConnection(installation)}
                                    onTest={() => void testConnection(installation)}
                                />
                            ))
                        ) : (
                            <EmptyState text="安装需要外部 Provider 的能力包后，可在这里管理连接。" />
                        )}
                    </section>
                ) : null}
            </div>
            <InstallModal
                pack={installPack}
                apiKey={installKey}
                endpoint={installEndpoint}
                selectedTools={selectedInstallTools}
                busy={Boolean(installPack && busyId === installPack.id)}
                onAPIKeyChange={setInstallKey}
                onEndpointChange={setInstallEndpoint}
                onToolsChange={setSelectedInstallTools}
                onCancel={() => setInstallPack(null)}
                onInstall={() => void install()}
            />
        </AdminPageFrame>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className={`domain-mcp-tab${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
            {children}
        </button>
    );
}

function PackCard({ pack, busy, onInstall }: { pack: AdminDomainMCPPack; busy: boolean; onInstall: () => void }) {
    return (
        <article className="domain-mcp-card">
            <div className="domain-mcp-card-header">
                <div>
                    <h2 className="domain-mcp-card-title">{pack.displayName}</h2>
                    <p className="domain-mcp-help">
                        v{pack.version} · 服务来源：{sourceLabel(pack.source)}
                    </p>
                </div>
                <span className="domain-mcp-chip">{pack.installed ? (pack.enabled ? "已启用" : "已停用") : pack.executable ? "可安装" : "即将开放"}</span>
            </div>
            <p className="domain-mcp-card-description">{pack.description}</p>
            <div className="domain-mcp-meta">
                <span className="domain-mcp-chip">
                    <Wrench className="mr-1 size-3" />
                    工具数量 {pack.tools.length}
                </span>
                <span className="domain-mcp-chip">
                    <ShieldCheck className="mr-1 size-3" />
                    权限：{permissionSummary(pack)}
                </span>
                <span className="domain-mcp-chip">Provider：{pack.providerRequirements.join("、") || "无需外部服务"}</span>
            </div>
            <p className="domain-mcp-data-notice">
                <strong>数据说明：</strong>
                {pack.dataNotice || "仅处理管理员与用户明确提供的数据。"}
            </p>
            <ToolList pack={pack} selected={pack.tools.map((tool) => tool.name)} readOnly />
            <div className="domain-mcp-card-actions">
                <Button type="primary" icon={<PackagePlus className="size-4" />} disabled={!pack.executable || pack.installed} loading={busy} onClick={onInstall}>
                    {pack.installed ? "已安装" : pack.executable ? "安装" : "即将开放"}
                </Button>
            </div>
        </article>
    );
}

function InstalledCard({ installation, pack, busy, onTest, onConfigure, onDelete }: { installation: AdminDomainMCPInstallation; pack?: AdminDomainMCPPack; busy: boolean; onTest: () => void; onConfigure: () => void; onDelete: () => void }) {
    return (
        <article className="domain-mcp-card">
            <div className="domain-mcp-card-header">
                <div>
                    <h2 className="domain-mcp-card-title">{installation.name}</h2>
                    <p className="domain-mcp-help">
                        {pack?.displayName ?? installation.packId} · {installation.provider || "本地"}
                    </p>
                </div>
                <span className="domain-mcp-chip">{installation.enabled ? "已启用" : "已停用"}</span>
            </div>
            <div className="domain-mcp-status-line">
                <span className="domain-mcp-chip">工具数量 {installation.allowedTools.length}</span>
                <span className="domain-mcp-chip">凭据{installation.credentialConfigured ? "已配置" : "未配置"}</span>
            </div>
            <p className="domain-mcp-data-notice">
                <strong>数据说明：</strong>
                {pack?.dataNotice || "外部结果按不可信数据处理，并保留来源。"}
            </p>
            <ToolList pack={pack} selected={installation.allowedTools} readOnly />
            <div className="domain-mcp-card-actions">
                <Button icon={<CheckCircle2 className="size-4" />} loading={busy} onClick={onTest}>
                    测试连接
                </Button>
                <Button icon={<Cable className="size-4" />} onClick={onConfigure}>
                    配置
                </Button>
                <Button danger icon={<Trash2 className="size-4" />} onClick={onDelete}>
                    卸载
                </Button>
            </div>
        </article>
    );
}

function ConnectionCard({
    installation,
    pack,
    draft,
    busy,
    onChange,
    onSave,
    onTest,
}: {
    installation: AdminDomainMCPInstallation;
    pack?: AdminDomainMCPPack;
    draft: ConnectionDraft;
    busy: boolean;
    onChange: (next: ConnectionDraft) => void;
    onSave: () => void;
    onTest: () => void;
}) {
    return (
        <article className="domain-mcp-card">
            <div className="domain-mcp-card-header">
                <div>
                    <h2 className="domain-mcp-card-title">{installation.name}</h2>
                    <p className="domain-mcp-help">服务来源：{installation.provider || "本地能力"}</p>
                </div>
                <Switch checked={draft.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={(enabled) => onChange({ ...draft, enabled })} />
            </div>
            <div className="domain-mcp-form-grid">
                <label className="domain-mcp-field">
                    <span>连接名称</span>
                    <Input value={draft.name} maxLength={80} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
                </label>
                <label className="domain-mcp-field">
                    <span>Endpoint</span>
                    <Input value={draft.endpoint} onChange={(event) => onChange({ ...draft, endpoint: event.target.value })} />
                </label>
                <label className="domain-mcp-field">
                    <span>API Key（凭据只写不回显）</span>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        value={draft.apiKey}
                        placeholder={installation.credentialConfigured ? "已配置；留空则保留现有凭据" : "输入 Provider API Key"}
                        onChange={(event) => onChange({ ...draft, apiKey: event.target.value })}
                    />
                    <small className="domain-mcp-help">留空则保留现有凭据；保存成功后输入框会再次清空。</small>
                </label>
                <div className="domain-mcp-field">
                    <span>允许工具</span>
                    <ToolList pack={pack} selected={draft.allowedTools} onChange={(allowedTools) => onChange({ ...draft, allowedTools })} />
                </div>
            </div>
            <div className="domain-mcp-card-actions">
                <Button type="primary" loading={busy} onClick={onSave}>
                    保存配置
                </Button>
                <Button loading={busy} onClick={onTest}>
                    测试连接
                </Button>
            </div>
        </article>
    );
}

function InstallModal({
    pack,
    apiKey,
    endpoint,
    selectedTools,
    busy,
    onAPIKeyChange,
    onEndpointChange,
    onToolsChange,
    onCancel,
    onInstall,
}: {
    pack: AdminDomainMCPPack | null;
    apiKey: string;
    endpoint: string;
    selectedTools: string[];
    busy: boolean;
    onAPIKeyChange: (value: string) => void;
    onEndpointChange: (value: string) => void;
    onToolsChange: (value: string[]) => void;
    onCancel: () => void;
    onInstall: () => void;
}) {
    return (
        <Modal
            title={pack ? `安装 ${pack.displayName}` : "安装能力包"}
            open={Boolean(pack)}
            okText="安装并启用"
            cancelText="取消"
            confirmLoading={busy}
            okButtonProps={{ disabled: !pack || selectedTools.length === 0 || (pack.providerRequirements.length > 0 && !apiKey.trim()) }}
            onCancel={onCancel}
            onOk={onInstall}
            destroyOnHidden
        >
            {pack ? (
                <div className="domain-mcp-form-grid">
                    <p className="domain-mcp-data-notice">
                        <strong>数据说明：</strong>
                        {pack.dataNotice}
                    </p>
                    {pack.providerRequirements.length ? (
                        <>
                            <label className="domain-mcp-field">
                                <span>Endpoint</span>
                                <Input value={endpoint} onChange={(event) => onEndpointChange(event.target.value)} />
                            </label>
                            <label className="domain-mcp-field">
                                <span>API Key（凭据只写不回显）</span>
                                <Input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => onAPIKeyChange(event.target.value)} />
                            </label>
                        </>
                    ) : null}
                    <div className="domain-mcp-field">
                        <span>允许工具</span>
                        <ToolList pack={pack} selected={selectedTools} onChange={onToolsChange} />
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function ToolList({ pack, selected, readOnly = false, onChange }: { pack?: AdminDomainMCPPack; selected: string[]; readOnly?: boolean; onChange?: (value: string[]) => void }) {
    const tools =
        pack?.tools.filter((tool) => (readOnly ? selected.includes(tool.name) || selected.length === pack.tools.length : true)) ??
        selected.map((name) => ({ name, description: "已授权工具", permission: "read_only" as const, inputSchema: {}, outputSchemaVersion: 1 }));
    return (
        <div className="domain-mcp-tool-list" data-canvas-wheel-scroll="true">
            {tools.map((tool) => {
                const checked = selected.includes(tool.name);
                return (
                    <label className="domain-mcp-tool-row" key={tool.name}>
                        <Checkbox checked={checked} disabled={readOnly} onChange={(event) => onChange?.(event.target.checked ? [...selected, tool.name] : selected.filter((name) => name !== tool.name))} />
                        <span>
                            <span className="domain-mcp-tool-name">{tool.name}</span>
                            <span className="domain-mcp-help block">{tool.description}</span>
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="domain-mcp-card">
            <h2 className="domain-mcp-card-title">暂无内容</h2>
            <p className="domain-mcp-card-description">{text}</p>
        </div>
    );
}

function installationDraft(item: AdminDomainMCPInstallation): ConnectionDraft {
    return { name: item.name, endpoint: item.endpoint, apiKey: "", allowedTools: [...item.allowedTools], enabled: item.enabled };
}

function permissionSummary(pack: AdminDomainMCPPack) {
    return [...new Set(pack.tools.map((tool) => (tool.permission === "read_only" ? "只读" : tool.permission)))].join("、");
}

function sourceLabel(source: string) {
    return source === "builtin" ? "影策内置" : source;
}

function errorMessage(reason: unknown, fallback: string) {
    return reason instanceof Error && reason.message ? reason.message : fallback;
}
