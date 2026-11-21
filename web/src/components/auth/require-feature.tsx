import { Activity, useEffect, useState, type ReactNode } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";

type FeatureKey =
    | "shortDramaEnabled"
    | "taskCenterEnabled"
    | "creditsEnabled"
    | "teamsEnabled"
    | "frontendModelsEnabled"
    | "pluginCenterEnabled"
    | "imageWorkbenchEnabled"
    | "videoWorkbenchEnabled"
    | "ecommerceStudioEnabled"
    | "videoReplicationEnabled"
    | "interiorEnabled";

const featureNames: Record<FeatureKey, string> = {
    shortDramaEnabled: "短剧创作",
    taskCenterEnabled: "任务中心",
    creditsEnabled: "积分中心",
    teamsEnabled: "团队空间",
    frontendModelsEnabled: "前台模型",
    pluginCenterEnabled: "插件中心",
    imageWorkbenchEnabled: "生图",
    videoWorkbenchEnabled: "视频",
    ecommerceStudioEnabled: "电商生图台",
    videoReplicationEnabled: "视频创作",
    interiorEnabled: "室内设计",
};

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const userId = useUserStore((state) => state.user?.id);
    if (!userId) return children;
    return (
        <SignedInFeature key={`${userId}:${feature}`} feature={feature}>
            {children}
        </SignedInFeature>
    );
}

function SignedInFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const navigate = useNavigate();
    const enabled = useUserStore((state) => state.features[feature]);
    const [checking, setChecking] = useState(() => !useUserStore.getState().features[feature]);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        refreshFeatureAvailability(controller.signal)
            .then(() => {
                if (!controller.signal.aborted) setError("");
            })
            .catch((reason) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取功能开放状态失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setChecking(false);
            });
        return () => controller.abort();
    }, [attempt]);

    if (checking && !error)
        return (
            <WorkspacePage>
                <WorkspaceLoadingState label="正在确认功能状态" detail={featureNames[feature]} rows={3} />
            </WorkspacePage>
        );
    if (!enabled && !error) {
        // 管理员页面返回到管理后台首页，用户页面返回到创作台
        const isAdminFeature = feature === "frontendModelsEnabled";
        const backPath = isAdminFeature ? "/admin" : "/";
        const backLabel = isAdminFeature ? "返回管理后台" : "返回创作台";

        return (
            <WorkspacePage>
                <WorkspaceState
                    kind="forbidden"
                    icon="settings"
                    title={`${featureNames[feature]}暂未开放`}
                    description="当前功能已由平台管理员关闭。"
                    action={
                        <Button type="primary" onClick={() => navigate(backPath, { replace: true })}>
                            {backLabel}
                        </Button>
                    }
                />
            </WorkspacePage>
        );
    }
    return (
        <>
            {enabled ? <Activity mode={error ? "hidden" : "visible"}>{children}</Activity> : null}
            {error ? (
                <WorkspacePage>
                    <WorkspaceErrorState
                        title="无法确认功能状态"
                        description={error}
                        actionLabel={checking ? "正在重试…" : "重新确认"}
                        onRetry={() => {
                            if (!checking) {
                                setChecking(true);
                                setAttempt((previous) => previous + 1);
                            }
                        }}
                    />
                </WorkspacePage>
            ) : null}
        </>
    );
}
