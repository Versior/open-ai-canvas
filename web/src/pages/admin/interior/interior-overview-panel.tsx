import { Alert, Button } from "antd";
import { BarChart3, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { AdminStatTile, AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { getAdminInteriorOverview, type AdminInteriorOverview, type InteriorAdminCount } from "@/services/api/interior";
import { adminUserLabel } from "@/services/api/video-replication-admin";
import { formatInteriorTime, interiorPercent } from "./interior-admin-shared";

export type InteriorAdminTab = "overview" | "records" | "modes" | "styles" | "rooms" | "knowledge" | "settings";

function rateText(succeeded: number, failed: number) {
    const rate = interiorPercent(succeeded, succeeded + failed);
    return rate === null ? "—" : `${rate}%`;
}

/** 一组按次数排的条目：名称、占最多那项的比例条、次数和失败数。 */
function CountList({ items, empty }: { items: InteriorAdminCount[]; empty: string }) {
    if (!items.length) return <div className="itd-admin-empty">{empty}</div>;
    const max = Math.max(...items.map((item) => item.total), 1);
    return (
        <ul className="itd-admin-counts">
            {items.map((item) => (
                <li key={item.key}>
                    <span className="itd-admin-count-name" title={item.name}>
                        {item.name}
                    </span>
                    <span className="itd-admin-count-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((item.total / max) * 100)}%` }} />
                    </span>
                    <span className="itd-admin-count-numbers">{item.failed ? `${item.total} 次 · 失败 ${item.failed}` : `${item.total} 次`}</span>
                </li>
            ))}
        </ul>
    );
}

/** 概览：近 30 天出图量、成功率、人数和项目数，配置提醒，近 14 天趋势，按出图方式、风格、空间、模型的分布和最近失败。 */
export function InteriorOverviewPanel({ active, onOpenTab, onOpenRecord }: { active: boolean; onOpenTab: (tab: InteriorAdminTab) => void; onOpenRecord: (id: string) => void }) {
    const [overview, setOverview] = useState<AdminInteriorOverview | null>(null);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        void getAdminInteriorOverview(controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setOverview(result);
                setError("");
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取室内设计统计失败");
            });
        return () => controller.abort();
    }, [active, reloadKey]);

    const generations = overview?.generations;
    const projects = overview?.projects;
    const config = overview?.config;
    const loading = !overview && !error;
    const hasTrend = Boolean(overview?.daily.some((day) => day.total));
    const missingModels = config ? config.modesWithoutModel.length : 0;

    return (
        <div className="itd-admin-overview">
            {error ? (
                <div className="itd-admin-load-error" role="alert">
                    <span>{`读取统计失败：${error}`}</span>
                    <Button size="small" onClick={() => setReloadKey((value) => value + 1)}>
                        重新加载
                    </Button>
                </div>
            ) : null}
            {config && !config.siteDefaultModel && missingModels ? (
                <Alert
                    type="warning"
                    showIcon
                    title="还没有设默认出图模型"
                    description={`站点默认模型没设，${missingModels} 个开着的出图方式（${config.modesWithoutModel.join("、")}）也没有自己的默认模型。快速出图会用用户当前选的图片模型，效果不稳定；建议在「设置」里选一个默认模型。`}
                    action={
                        <Button size="small" onClick={() => onOpenTab("settings")}>
                            去设置
                        </Button>
                    }
                />
            ) : null}

            <div className="itd-admin-stats">
                <AdminStatTile label="出图次数" value={generations?.total ?? "—"} detail={generations ? `今天 ${generations.today} · 近 7 天 ${generations.last7Days}` : undefined} />
                <AdminStatTile
                    label="成功率"
                    value={generations ? rateText(generations.succeeded, generations.failed) : "—"}
                    detail={generations ? `完成 ${generations.succeeded} · 失败 ${generations.failed}` : undefined}
                    trend={generations && generations.running + generations.queued ? { value: `${generations.running + generations.queued} 个进行中`, tone: "info" } : undefined}
                />
                <AdminStatTile label="出过图的人" value={generations?.users ?? "—"} detail={generations ? `快速出图 ${generations.quick} · 专业模式 ${generations.pro}` : undefined} />
                <AdminStatTile label="项目" value={projects?.total ?? "—"} detail={projects ? `我的房子 ${projects.home} · 客户方案 ${projects.client}` : undefined} />
                <AdminStatTile label="建过项目的人" value={projects?.users ?? "—"} detail="项目数不限时间" />
            </div>
            <p className="itd-admin-footnote">
                {`出图次数按任务算，一个风格出一次算一次；统计近 ${overview?.windowDays ?? 30} 天，按 UTC 自然日。`}
                {overview?.truncated ? " 近 30 天任务太多，只统计了最新的 5000 次。" : ""}
            </p>

            <div className="itd-admin-columns">
                <section className="itd-admin-card" aria-labelledby="itd-admin-trend-title">
                    <header className="itd-admin-card-head">
                        <div>
                            <h2 id="itd-admin-trend-title">近 14 天</h2>
                            <p>每天新建的出图任务；折线是其中失败的。</p>
                        </div>
                    </header>
                    {hasTrend ? (
                        <div className="itd-admin-chart" role="img" aria-label="近 14 天出图数量图">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={overview?.daily || []} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                                    <CartesianGrid stroke="currentColor" className="text-foreground/10" vertical={false} />
                                    <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 11 }} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                    <ChartTooltip labelFormatter={(value) => `日期 ${value}`} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="total" name="出图" fill="var(--admin-chart-primary)" maxBarSize={22} />
                                    <Line type="monotone" dataKey="failed" name="失败" stroke="var(--admin-status-error)" strokeWidth={2} dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="itd-admin-empty">
                            <BarChart3 className="size-5" aria-hidden="true" />
                            <span>{loading ? "正在读取…" : "近 14 天还没有人出图"}</span>
                        </div>
                    )}
                </section>
                <section className="itd-admin-card" aria-labelledby="itd-admin-modes-title">
                    <header className="itd-admin-card-head">
                        <div>
                            <h2 id="itd-admin-modes-title">出图方式</h2>
                            <p>近 30 天各出图方式的次数，失败多的去看提示词模板和模型。</p>
                        </div>
                        <Button size="small" onClick={() => onOpenTab("modes")}>
                            管理
                        </Button>
                    </header>
                    <CountList items={overview?.modes || []} empty={loading ? "正在读取…" : "还没有出图"} />
                </section>
            </div>

            <div className="itd-admin-columns is-three">
                <section className="itd-admin-card" aria-labelledby="itd-admin-styles-title">
                    <header className="itd-admin-card-head">
                        <div>
                            <h2 id="itd-admin-styles-title">热门风格</h2>
                            <p>前 10 个。</p>
                        </div>
                    </header>
                    <CountList items={overview?.styles || []} empty={loading ? "正在读取…" : "还没有选过风格"} />
                </section>
                <section className="itd-admin-card" aria-labelledby="itd-admin-rooms-title">
                    <header className="itd-admin-card-head">
                        <div>
                            <h2 id="itd-admin-rooms-title">热门空间</h2>
                            <p>前 10 个。</p>
                        </div>
                    </header>
                    <CountList items={overview?.rooms || []} empty={loading ? "正在读取…" : "还没有选过空间"} />
                </section>
                <section className="itd-admin-card" aria-labelledby="itd-admin-models-title">
                    <header className="itd-admin-card-head">
                        <div>
                            <h2 id="itd-admin-models-title">用到的模型</h2>
                            <p>前 10 个。</p>
                        </div>
                    </header>
                    <CountList items={overview?.models || []} empty={loading ? "正在读取…" : "还没有出图"} />
                </section>
            </div>

            <section className="itd-admin-card" aria-labelledby="itd-admin-failures-title">
                <header className="itd-admin-card-head">
                    <div>
                        <h2 id="itd-admin-failures-title">最近失败</h2>
                        <p>近 30 天最近 8 次失败的出图，原因不做用户侧改写。</p>
                    </div>
                    <Button size="small" onClick={() => onOpenTab("records")}>
                        全部记录
                    </Button>
                </header>
                {overview?.recentFailures.length ? (
                    <ul className="itd-admin-failures">
                        {overview.recentFailures.map((failure) => (
                            <li key={failure.id}>
                                <button type="button" className="itd-admin-failure" onClick={() => onOpenRecord(failure.id)}>
                                    <span className="itd-admin-muted">{formatInteriorTime(failure.createdAt)}</span>
                                    <AdminStatusBadge label={failure.modeName || "出图"} tone="neutral" />
                                    <span className="itd-admin-ellipsis">{adminUserLabel(failure.user)}</span>
                                    <span className="itd-admin-error itd-admin-ellipsis" title={failure.error}>
                                        {failure.error || "没有记录失败原因"}
                                    </span>
                                    <ChevronRight className="size-4" aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="itd-admin-empty">{loading ? "正在读取…" : "最近没有失败"}</div>
                )}
            </section>
        </div>
    );
}
