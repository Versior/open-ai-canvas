import { Button } from "antd";
import { BarChart3, ChevronRight } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { AdminStatTile, AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import type { SocialVideoParseOverview } from "@/services/api/social-video-parse";
import { adminUserLabel, type AdminVideoReplicationOverview } from "@/services/api/video-replication-admin";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { formatParseClock, formatParseTime, platformName } from "./parse-shared";
import { percentOf } from "./replication-admin-shared";

export type VideoReplicationAdminTab = "overview" | "records" | "parse" | "settings";

type Props = {
    overview: AdminVideoReplicationOverview | null;
    parse: SocialVideoParseOverview | null;
    features: Pick<FeatureAvailability, "videoReplicationEnabled" | "socialVideoImportEnabled"> | null;
    loading: boolean;
    onOpenTab: (tab: VideoReplicationAdminTab) => void;
    onOpenRecord: (id: string) => void;
};

function rateText(succeeded: number, failed: number) {
    const rate = percentOf(succeeded, succeeded + failed);
    return rate === null ? "—" : `${rate}%`;
}

/** 概览：开关和口播识别的现状、拆解与链接导入的数量、近 14 天趋势、各平台导入和最近失败。 */
export function ReplicationOverviewPanel({ overview, parse, features, loading, onOpenTab, onOpenRecord }: Props) {
    const teardowns = overview?.teardowns;
    const imports = overview?.imports;
    const apis = parse?.apis || [];
    const activeAPIs = apis.filter((api) => api.status === "active").length;
    const coveredPlatforms = (parse?.platforms || []).filter((platform) => platform.available);
    const daily = overview?.daily || [];
    const hasTrend = daily.some((day) => day.teardowns || day.imports);
    const transcription = overview?.transcription;
    const statusItems = [
        {
            key: "replication",
            label: "视频复刻",
            badge: features ? <AdminStatusBadge label={features.videoReplicationEnabled ? "已开放" : "已关闭"} tone={features.videoReplicationEnabled ? "success" : "neutral"} /> : null,
            detail: features?.videoReplicationEnabled === false ? "侧栏不显示入口，用户不能新建拆解" : "用户可以在侧栏进入视频复刻",
            tab: "settings" as const,
        },
        {
            key: "import",
            label: "视频链接导入",
            badge: features ? <AdminStatusBadge label={features.socialVideoImportEnabled ? "已开放" : "已关闭"} tone={features.socialVideoImportEnabled ? "success" : "neutral"} /> : null,
            detail: features?.socialVideoImportEnabled === false ? "只能上传文件，画布按普通文字粘贴链接" : coveredPlatforms.length ? `可导入：${coveredPlatforms.map((item) => item.name).join("、")}` : "还没有可用的解析接口",
            tab: features?.socialVideoImportEnabled === false ? ("settings" as const) : ("parse" as const),
        },
        {
            key: "transcription",
            label: "口播识别",
            badge: transcription ? <AdminStatusBadge label={transcription.available ? "可用" : "不可用"} tone={transcription.available ? "success" : "warning"} /> : null,
            detail: transcription ? transcription.note || "拆解时用转写服务识别口播" : "",
            tab: "settings" as const,
        },
    ];

    return (
        <div className="admin-vr-overview">
            <ul className="admin-vr-status" aria-label="视频复刻现状">
                {statusItems.map((item) => (
                    <li key={item.key}>
                        <button type="button" className="admin-vr-status-item" onClick={() => onOpenTab(item.tab)}>
                            <span className="admin-vr-status-head">
                                <strong>{item.label}</strong>
                                {item.badge}
                            </span>
                            <span className="admin-vr-status-detail">{item.detail || (loading ? "正在读取…" : "")}</span>
                            <ChevronRight className="admin-vr-status-arrow size-4" aria-hidden="true" />
                        </button>
                    </li>
                ))}
            </ul>

            <div className="admin-vr-stats">
                <AdminStatTile label="拆解次数" value={teardowns?.total ?? "—"} detail={teardowns ? `今天 ${teardowns.today} · 近 7 天 ${teardowns.last7Days}` : undefined} />
                <AdminStatTile
                    label="拆解成功率"
                    value={teardowns ? rateText(teardowns.succeeded, teardowns.failed) : "—"}
                    detail={teardowns ? `完成 ${teardowns.succeeded} · 失败 ${teardowns.failed}` : undefined}
                    trend={teardowns && teardowns.running + teardowns.queued ? { value: `${teardowns.running + teardowns.queued} 个进行中`, tone: "info" } : undefined}
                />
                <AdminStatTile label="已分析" value={overview?.analyzed ?? "—"} detail={teardowns && overview ? `占已完成的 ${percentOf(overview.analyzed, teardowns.succeeded) ?? 0}%` : undefined} />
                <AdminStatTile label="用过的人" value={teardowns?.users ?? "—"} detail={imports ? `链接导入 ${imports.users} 人` : undefined} />
                <AdminStatTile label="链接导入" value={imports?.total ?? "—"} detail={imports ? `成功率 ${rateText(imports.succeeded, imports.failed)} · 今天 ${imports.today}` : undefined} />
                <AdminStatTile label="正常解析接口" value={parse ? `${activeAPIs} / ${apis.length}` : "—"} detail={parse ? `覆盖 ${coveredPlatforms.length} 个平台` : undefined} />
            </div>

            <div className="admin-vr-columns">
                <section className="admin-vr-card" aria-labelledby="admin-vr-trend-title">
                    <header className="admin-vr-card-head">
                        <div>
                            <h2 id="admin-vr-trend-title">近 14 天</h2>
                            <p>每天新建的拆解和链接导入任务，按 UTC 自然日统计；折线是其中失败的。</p>
                        </div>
                    </header>
                    {hasTrend ? (
                        <div className="admin-vr-chart" role="img" aria-label="近 14 天拆解与链接导入数量图">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={daily} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                                    <CartesianGrid stroke="currentColor" className="text-foreground/10" vertical={false} />
                                    <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 11 }} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                    <ChartTooltip labelFormatter={(value) => `日期 ${value}`} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="teardowns" name="拆解" stackId="tasks" fill="var(--admin-chart-primary)" maxBarSize={22} />
                                    <Bar dataKey="imports" name="链接导入" stackId="tasks" fill="var(--admin-chart-secondary)" maxBarSize={22} />
                                    <Line type="monotone" dataKey="failed" name="失败" stroke="var(--admin-status-error)" strokeWidth={2} dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="admin-vr-empty">
                            <BarChart3 className="size-5" aria-hidden="true" />
                            <span>{loading && !overview ? "正在读取…" : "近 14 天还没有拆解或链接导入"}</span>
                        </div>
                    )}
                </section>

                <section className="admin-vr-card" aria-labelledby="admin-vr-platforms-title">
                    <header className="admin-vr-card-head">
                        <div>
                            <h2 id="admin-vr-platforms-title">各平台链接导入</h2>
                            <p>累计次数和成功率；导入失败多的平台去「解析接口」里看接口状态。</p>
                        </div>
                        <Button size="small" onClick={() => onOpenTab("parse")}>
                            解析接口
                        </Button>
                    </header>
                    {overview?.importPlatforms.length ? (
                        <ul className="admin-vr-platforms">
                            {overview.importPlatforms.map((item) => {
                                const rate = percentOf(item.succeeded, item.succeeded + item.failed);
                                return (
                                    <li key={item.platform}>
                                        <span className="admin-vr-platform-name">{parse ? platformName(parse.platforms, item.platform) : item.name}</span>
                                        <span className="admin-vr-platform-bar" aria-hidden="true">
                                            <span style={{ width: `${rate ?? 0}%` }} />
                                        </span>
                                        <span className="admin-vr-platform-numbers">{`${item.total} 次 · ${rate === null ? "—" : `${rate}%`}`}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="admin-vr-empty">
                            <span>{loading && !overview ? "正在读取…" : "还没有人用链接导入过视频"}</span>
                        </div>
                    )}
                </section>
            </div>

            <section className="admin-vr-card" aria-labelledby="admin-vr-failures-title">
                <header className="admin-vr-card-head">
                    <div>
                        <h2 id="admin-vr-failures-title">最近失败</h2>
                        <p>最近 8 次失败的拆解和链接导入，原因不做用户侧的改写。</p>
                    </div>
                    <Button size="small" onClick={() => onOpenTab("records")}>
                        全部记录
                    </Button>
                </header>
                {overview?.recentFailures.length ? (
                    <ul className="admin-vr-failures">
                        {overview.recentFailures.map((failure) => {
                            const body = (
                                <>
                                    <span className="admin-vr-failure-time" title={formatParseTime(failure.createdAt)}>
                                        {formatParseClock(failure.createdAt)}
                                    </span>
                                    <AdminStatusBadge label={failure.kind === "teardown" ? "拆解" : `导入 · ${parse ? platformName(parse.platforms, failure.platform || "") : failure.platform || ""}`} tone="neutral" />
                                    <span className="admin-vr-failure-user">{adminUserLabel(failure.user)}</span>
                                    <span className="admin-vr-failure-error" title={failure.error}>
                                        {failure.error || "没有记录失败原因"}
                                    </span>
                                </>
                            );
                            return (
                                <li key={failure.id}>
                                    {failure.kind === "teardown" ? (
                                        <button type="button" className="admin-vr-failure" onClick={() => onOpenRecord(failure.id)}>
                                            {body}
                                            <ChevronRight className="size-4" aria-hidden="true" />
                                        </button>
                                    ) : (
                                        <div className="admin-vr-failure">{body}</div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="admin-vr-empty">
                        <span>{loading && !overview ? "正在读取…" : "最近没有失败"}</span>
                    </div>
                )}
            </section>
        </div>
    );
}
