import { Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "@/pages/admin/components/admin-ui";
import type { SocialVideoPlatform } from "@/services/api/social-video";
import type { SocialVideoParseLog } from "@/services/api/social-video-parse";
import { PARSE_KIND_LABELS, PARSE_STAGE_LABELS, formatLatency, formatParseTime, platformName } from "./parse-shared";

/** 最近 100 次调用（用户导入、后台测试、自动巡检），新的在上面。 */
export function ParseLogsPanel({ logs, platforms }: { logs: SocialVideoParseLog[]; platforms: readonly SocialVideoPlatform[] }) {
    const [kind, setKind] = useState("all");
    const [result, setResult] = useState("all");
    const visible = useMemo(() => logs.filter((log) => (kind === "all" || log.kind === kind) && (result === "all" || (result === "ok") === log.ok)), [kind, logs, result]);
    const columns: ColumnsType<SocialVideoParseLog> = [
        { title: "时间", width: 150, render: (_, log) => <span className="admin-video-parse-nowrap">{formatParseTime(log.at)}</span> },
        { title: "接口", render: (_, log) => <strong>{log.apiName || log.apiId}</strong> },
        { title: "平台", width: 100, render: (_, log) => (log.platform ? platformName(platforms, log.platform) : "—") },
        { title: "来源", width: 100, render: (_, log) => PARSE_KIND_LABELS[log.kind] || log.kind },
        { title: "结果", width: 130, render: (_, log) => <AdminStatusBadge label={log.ok ? "成功" : log.stage ? `失败 · ${PARSE_STAGE_LABELS[log.stage] || log.stage}` : "失败"} tone={log.ok ? "success" : "error"} /> },
        { title: "耗时", width: 90, render: (_, log) => formatLatency(log.latencyMs) },
        { title: "说明", render: (_, log) => <span className="admin-video-parse-break">{log.message || "—"}</span> },
    ];
    return (
        <div className="admin-video-parse-panel">
            <div className="admin-video-parse-toolbar">
                <Select
                    aria-label="按来源筛选"
                    value={kind}
                    onChange={setKind}
                    options={[
                        { label: "全部来源", value: "all" },
                        { label: "用户导入", value: "import" },
                        { label: "后台测试", value: "test" },
                        { label: "自动巡检", value: "health" },
                    ]}
                />
                <Select
                    aria-label="按结果筛选"
                    value={result}
                    onChange={setResult}
                    options={[
                        { label: "全部结果", value: "all" },
                        { label: "只看成功", value: "ok" },
                        { label: "只看失败", value: "fail" },
                    ]}
                />
                <span className="admin-video-parse-muted">只保留最近 100 条</span>
            </div>
            <AdminDataTable
                table={{ rowKey: (log) => `${log.at}-${log.apiId}-${log.kind}`, pagination: false, columns, dataSource: visible, scroll: { x: 900 } }}
                empty={<AdminTableEmpty filtered={logs.length > 0} title={logs.length ? undefined : "还没有调用记录"} description={logs.length ? undefined : "用户导入、测试和巡检都会记在这里。"} />}
            />
        </div>
    );
}
