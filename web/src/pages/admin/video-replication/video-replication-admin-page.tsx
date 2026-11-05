import { Button, Tabs } from "antd";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { getAdminFeatureAvailability } from "@/services/api/auth";
import { getSocialVideoParseOverview, type SocialVideoParseOverview } from "@/services/api/social-video-parse";
import { getAdminVideoReplicationOverview, type AdminVideoReplicationOverview } from "@/services/api/video-replication-admin";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { ParsePoolPanel } from "./parse-pool-panel";
import { ReplicationOverviewPanel, type VideoReplicationAdminTab } from "./replication-overview-panel";
import { ReplicationRecordsPanel } from "./replication-records-panel";
import { ReplicationSettingsPanel } from "./replication-settings-panel";
import "./video-replication-admin.css";

const TABS: VideoReplicationAdminTab[] = ["overview", "records", "parse", "settings"];

function errorText(cause: unknown, fallback: string) {
    return cause instanceof Error ? cause.message : fallback;
}

/**
 * 后台「视频复刻」：概览（开关现状、使用统计、最近失败）、所有用户的拆解记录、链接导入用的第三方解析接口，
 * 以及开关、拆解限制和口播识别的设置。当前页签和打开的记录记在地址里（?tab=、?record=），刷新和分享都能回到原处。
 */
export default function VideoReplicationAdminPage() {
    const [params, setParams] = useSearchParams();
    const requested = params.get("tab") as VideoReplicationAdminTab | null;
    const tab: VideoReplicationAdminTab = requested && TABS.includes(requested) ? requested : "overview";
    const recordId = params.get("record") || "";
    const [overview, setOverview] = useState<AdminVideoReplicationOverview | null>(null);
    const [parse, setParse] = useState<SocialVideoParseOverview | null>(null);
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [loading, setLoading] = useState(true);
    const [overviewError, setOverviewError] = useState("");
    const [featuresError, setFeaturesError] = useState("");
    const requestRef = useRef(0);

    const reload = useCallback(async () => {
        const request = ++requestRef.current;
        setLoading(true);
        // 三份数据互不依赖，一份失败不挡另外两份；各自的错误分开显示。
        const [overviewResult, parseResult, featuresResult] = await Promise.allSettled([getAdminVideoReplicationOverview(), getSocialVideoParseOverview(), getAdminFeatureAvailability()]);
        if (request !== requestRef.current) return;
        if (overviewResult.status === "fulfilled") setOverview(overviewResult.value);
        if (parseResult.status === "fulfilled") setParse(parseResult.value);
        if (featuresResult.status === "fulfilled") setFeatures(featuresResult.value.features);
        const failures = [overviewResult.status === "rejected" ? errorText(overviewResult.reason, "读取视频复刻统计失败") : "", parseResult.status === "rejected" ? errorText(parseResult.reason, "读取解析接口失败") : ""].filter(Boolean);
        setOverviewError(failures.join("；"));
        setFeaturesError(featuresResult.status === "rejected" ? errorText(featuresResult.reason, "读取功能开放配置失败") : "");
        setLoading(false);
    }, []);
    useEffect(() => {
        void reload();
        return () => {
            requestRef.current += 1;
        };
    }, [reload]);

    const navigate = useCallback(
        (next: { tab?: VideoReplicationAdminTab; record?: string }) => {
            setParams(
                (current) => {
                    const updated = new URLSearchParams(current);
                    const nextTab = next.tab ?? tab;
                    if (nextTab === "overview") updated.delete("tab");
                    else updated.set("tab", nextTab);
                    if (next.record) updated.set("record", next.record);
                    else updated.delete("record");
                    return updated;
                },
                { replace: next.tab === undefined },
            );
        },
        [setParams, tab],
    );

    return (
        <AdminPageFrame
            title="视频复刻"
            description="用户拆解视频的统计和记录、链接导入用的第三方解析接口，以及拆解的开关和限制。"
            scroll
            actions={
                tab === "overview" ? (
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                        刷新
                    </Button>
                ) : null
            }
        >
            {overviewError && tab !== "parse" ? (
                <div className="admin-vr-load-error" role="alert">
                    <span>{overviewError}</span>
                    <Button size="small" onClick={() => void reload()}>
                        重新加载
                    </Button>
                </div>
            ) : null}
            <Tabs
                className="admin-vr-tabs"
                activeKey={tab}
                onChange={(key) => navigate({ tab: key as VideoReplicationAdminTab })}
                items={[
                    {
                        key: "overview",
                        label: "概览",
                        children: <ReplicationOverviewPanel overview={overview} parse={parse} features={features} loading={loading} onOpenTab={(next) => navigate({ tab: next })} onOpenRecord={(id) => navigate({ tab: "records", record: id })} />,
                    },
                    {
                        key: "records",
                        label: `拆解记录${overview ? `（${overview.teardowns.total}）` : ""}`,
                        children: <ReplicationRecordsPanel recordId={recordId} onOpenRecord={(id) => navigate({ record: id })} />,
                    },
                    {
                        key: "parse",
                        label: "解析接口",
                        children: <ParsePoolPanel linkImportEnabled={features?.socialVideoImportEnabled} onOpenSettings={() => navigate({ tab: "settings" })} />,
                    },
                    {
                        key: "settings",
                        label: "设置",
                        children: <ReplicationSettingsPanel features={features} featuresError={featuresError} onFeaturesChange={setFeatures} overview={overview} onSaved={() => void reload()} />,
                    },
                ]}
            />
        </AdminPageFrame>
    );
}
