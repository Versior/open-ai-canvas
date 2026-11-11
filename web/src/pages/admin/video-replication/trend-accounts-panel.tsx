import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Popconfirm, Select, Switch } from "antd";
import { ExternalLink, LogIn, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VIDEO_TREND_SOURCES } from "@/lib/remake/trends";
import { getActiveUserScope } from "@/lib/user-scope";
import { AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import {
    authorizeAdminVideoTrends,
    connectAdminVideoTrends,
    disconnectAdminVideoTrends,
    getAdminVideoTrendSources,
    refreshAdminVideoTrends,
    setAdminVideoTrendVisibility,
    type AdminVideoTrendSource,
    type SiteTrendSource,
} from "@/services/api/video-trends-admin";
import { useUserStore } from "@/stores/use-user-store";

const SOURCES: SiteTrendSource[] = ["douhot", "qianchuan", "oceanengine"];
function accountStatus(item?: AdminVideoTrendSource) {
    if (item?.lastError) return { label: "同步失败", tone: "warning" as const };
    if (item?.enabled) return { label: "前台展示中", tone: "success" as const };
    if (item?.board && item.configured) return { label: "已连接", tone: "neutral" as const };
    if (item?.authorized) return { label: "待选账户", tone: "warning" as const };
    return { label: "未连接", tone: "neutral" as const };
}

export function TrendAccountsPanel({ active, source: requested, onSourceChange }: { active: boolean; source?: string; onSourceChange: (source: SiteTrendSource) => void }) {
    const source = SOURCES.includes(requested as SiteTrendSource) ? (requested as SiteTrendSource) : "douhot";
    const userId = useUserStore((store) => store.user?.id);
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ["admin-video-trend-sources", userId], queryFn: ({ signal }) => getAdminVideoTrendSources(signal), enabled: active && Boolean(userId), retry: false, refetchOnWindowFocus: false });
    const item = query.data?.find((entry) => entry.source === source);
    const [advertiserId, setAdvertiserId] = useState("");
    const [projectId, setProjectId] = useState("");
    const [credential, setCredential] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef<AbortController | null>(null);
    useEffect(() => {
        setAdvertiserId(item?.advertiserId || "");
        setProjectId(item?.projectId || "");
        setCredential("");
        setError("");
    }, [source, item]);
    useEffect(() => {
        setBusy(false);
        return () => {
            pending.current?.abort();
            pending.current = null;
        };
    }, [source, userId]);
    const run = async (operation: (signal: AbortSignal) => Promise<unknown>, redirect = false) => {
        if (pending.current) return;
        const scope = getActiveUserScope();
        const controller = new AbortController();
        pending.current = controller;
        setBusy(true);
        setError("");
        try {
            const result = await operation(controller.signal);
            if (controller.signal.aborted || scope !== getActiveUserScope()) return;
            if (redirect) {
                window.location.assign((result as { url: string }).url);
                return;
            }
            setCredential("");
            await query.refetch();
            void queryClient.invalidateQueries({ queryKey: ["video-trends"] });
        } catch (cause) {
            if (!controller.signal.aborted && scope === getActiveUserScope()) setError(cause instanceof Error ? cause.message : "平台操作失败");
        } finally {
            if (pending.current === controller) pending.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        void run((signal) =>
            connectAdminVideoTrends(
                source,
                {
                    enabled: item?.enabled ?? false,
                    ...(source === "douhot" ? { cookie: credential.trim() } : { advertiserId: advertiserId.trim(), ...(source === "oceanengine" ? { projectId: projectId.trim() } : {}), ...(!item?.authorized ? { accessToken: credential.trim() } : {}) }),
                },
                signal,
            ),
        );
    };
    const status = accountStatus(item);
    const canSave = source === "douhot" ? Boolean(credential.trim() || item?.cookieConfigured) : Boolean(advertiserId.trim() && (item?.authorized || credential.trim()) && (source !== "oceanengine" || projectId.trim()));
    return (
        <div className="admin-vr-trend-accounts">
            <div className="admin-vr-trend-intro">
                <div>
                    <h2>平台账号与选题</h2>
                    <p>管理员统一连接和同步，用户端只展示选题。确认预览内容后开启前台展示。</p>
                </div>
                <Button size="small" icon={<RefreshCw size={14} />} loading={query.isFetching} disabled={busy} onClick={() => void query.refetch()}>
                    刷新状态
                </Button>
            </div>
            {query.error ? <p role="alert">平台配置读取失败，请刷新重试。</p> : null}
            <div className="admin-vr-trend-sources" role="group" aria-label="管理平台账号">
                {SOURCES.map((key) => {
                    const current = query.data?.find((entry) => entry.source === key);
                    const badge = accountStatus(current);
                    return (
                        <button key={key} type="button" disabled={busy} aria-pressed={source === key} onClick={() => onSourceChange(key)}>
                            <strong>{VIDEO_TREND_SOURCES[key].name}</strong>
                            <AdminStatusBadge {...badge} />
                            <small>{current?.board ? `${current.board.topics.length} 条选题` : "连接后同步选题"}</small>
                        </button>
                    );
                })}
            </div>
            <div className="admin-vr-trend-workspace">
                <section className="admin-vr-card">
                    <div className="admin-vr-card-head">
                        <h2>{VIDEO_TREND_SOURCES[source].name} · 站点账号</h2>
                        <AdminStatusBadge {...status} />
                    </div>
                    <div className="admin-vr-trend-visibility">
                        <span>前台展示</span>
                        <Switch aria-label="前台展示" checked={item?.enabled ?? false} disabled={busy || !item || (!item.configured && !item.enabled)} onChange={(next) => void run((signal) => setAdminVideoTrendVisibility(source, next, signal))} />
                    </div>
                    {source !== "douhot" ? (
                        <>
                            <Button icon={<LogIn size={15} />} disabled={busy || !item?.oauthAvailable} onClick={() => void run((signal) => authorizeAdminVideoTrends(source, signal), true)}>
                                {item?.authorized ? "重新授权账号" : "登录并授权账号"}
                            </Button>
                            {!item?.oauthAvailable && item ? (
                                <details className="admin-vr-trend-help">
                                    <summary>应用尚未配置</summary>
                                    <p>请在服务器配置本平台已获批应用和本站HTTPS回调地址。账号登录完成后，授权回调本后台，服务器保存并刷新令牌。</p>
                                </details>
                            ) : null}
                        </>
                    ) : (
                        <div className="admin-vr-trend-help">
                            <a href={VIDEO_TREND_SOURCES.douhot.url} target="_blank" rel="noreferrer">
                                登录热点宝 <ExternalLink size={13} />
                            </a>
                            <p>热点宝当前使用网页接口。完成登录后，将有效登录凭据保存到本站；打开登录页不会自动完成连接。</p>
                        </div>
                    )}
                    <form className="admin-vr-trend-form" autoComplete="off" onSubmit={submit}>
                        {source === "douhot" ? (
                            <label>
                                登录凭据
                                <Input.Password
                                    aria-label="热点宝登录凭据"
                                    autoComplete="new-password"
                                    maxLength={16384}
                                    value={credential}
                                    disabled={busy}
                                    onChange={(event) => setCredential(event.target.value)}
                                    placeholder={item?.cookieConfigured ? "已保存，留空使用现有凭据" : "仅在后台填写，保存后不回显"}
                                />
                            </label>
                        ) : (
                            <>
                                <label>
                                    广告主账户
                                    {item?.authorized ? (
                                        <Select aria-label="授权广告主" value={advertiserId || undefined} disabled={busy} onChange={setAdvertiserId} options={item.advertiserIds?.map((id) => ({ value: id, label: id }))} />
                                    ) : (
                                        <Input aria-label="广告主 ID" inputMode="numeric" pattern="[0-9]+" maxLength={19} value={advertiserId} disabled={busy} onChange={(event) => setAdvertiserId(event.target.value)} />
                                    )}
                                </label>
                                {source === "oceanengine" ? (
                                    <label>
                                        广告项目
                                        <Input aria-label="广告项目 ID" inputMode="numeric" pattern="[0-9]+" maxLength={19} value={projectId} disabled={busy} onChange={(event) => setProjectId(event.target.value)} />
                                        <small>此接口读取广告项目推荐，未提供巨量创意全站榜单。</small>
                                    </label>
                                ) : null}
                                {!item?.authorized ? (
                                    <label>
                                        已有官方访问令牌
                                        <Input.Password aria-label="平台访问令牌" autoComplete="new-password" maxLength={4096} value={credential} disabled={busy} onChange={(event) => setCredential(event.target.value)} />
                                        <small>已保存的令牌不会回显；手动令牌过期后需要更新。</small>
                                    </label>
                                ) : null}
                            </>
                        )}
                        <Button htmlType="submit" type="primary" loading={busy} disabled={!canSave || query.isPending || Boolean(query.error)}>
                            保存并同步
                        </Button>
                    </form>
                    {error || item?.lastError ? (
                        <p className="admin-vr-trend-error" role="alert">
                            {error || item?.lastError}
                        </p>
                    ) : null}
                    {item?.configured || item?.authorized ? (
                        <Popconfirm title="断开本站账号连接？" description="前台停止展示此来源，本站保存的凭据将移除。" onConfirm={() => run((signal) => disconnectAdminVideoTrends(source, signal))}>
                            <Button size="small" disabled={busy}>
                                断开连接
                            </Button>
                        </Popconfirm>
                    ) : null}
                </section>
                <section className="admin-vr-card admin-vr-trend-preview">
                    <div className="admin-vr-card-head">
                        <div>
                            <h2>前台内容预览</h2>
                            <p>{item?.board?.fetchedAt ? `同步于 ${new Date(item.board.fetchedAt).toLocaleString("zh-CN", { hour12: false })}` : "先连接账号并同步数据"}</p>
                        </div>
                        <Button size="small" icon={<RefreshCw size={14} />} disabled={busy || !item?.configured} onClick={() => void run((signal) => refreshAdminVideoTrends(source, signal))}>
                            同步数据
                        </Button>
                    </div>
                    {item?.board?.topics.length ? (
                        <ol>
                            {item.board.topics.map((entry) => (
                                <li key={`${entry.title}:${entry.url}`}>
                                    <span>{entry.rank}</span>
                                    <span>{entry.title}</span>
                                    <a href={entry.url} target="_blank" rel="noreferrer" aria-label={`查看来源：${entry.title}`}>
                                        <ExternalLink size={14} />
                                    </a>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="admin-vr-empty" role="status">
                            {query.isPending ? "正在读取平台状态…" : "暂无同步内容"}
                        </p>
                    )}
                    <small>前台只读取标题和来源链接，不展示账号凭据、消耗、预算或收益报表。</small>
                </section>
            </div>
        </div>
    );
}
