import { useCallback, useEffect, useRef, useState } from "react";

import { appQueryClient } from "@/lib/query-client";
import { readReplicaPlan, replicaPlanIssues, type VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { saveVideoReplicationPlan, type VideoReplicationDetail, type VideoTeardownBundle } from "@/services/api/video-replication";
import { videoReplicationKeys } from "./use-replication-runner";

export type ReplicaPlanSaveState = { status: "idle" | "saving" | "saved" | "error"; error?: string };

const SAVE_DELAY_MS = 800;

/**
 * 复刻方案的编辑状态：改动后停 0.8 秒自动保存到服务端，一次只发一个保存请求，保存期间的改动等它结束再存。
 * 保存失败照实显示，改动留在页面上可以重试；切换账号后不再保存到这条记录。
 */
export function useReplicaPlan(id: string, bundle: VideoTeardownBundle, analysis: Pick<VideoTeardownAnalysis, "rows">, saved: unknown, savedAt: string | undefined) {
    const [plan, setPlanState] = useState(() => readReplicaPlan(saved, bundle, analysis));
    const [save, setSave] = useState<ReplicaPlanSaveState>({ status: savedAt ? "saved" : "idle" });
    const [version, setVersion] = useState(0);
    const planRef = useRef(plan);
    const dirty = useRef(false);
    const inflight = useRef<Promise<boolean> | null>(null);
    const scope = useRef(getActiveUserScope());

    const update = useCallback((change: (current: VideoReplicaPlan) => VideoReplicaPlan) => {
        const next = change(planRef.current);
        planRef.current = next;
        dirty.current = true;
        setPlanState(next);
        setVersion((value) => value + 1);
    }, []);

    const flush = useCallback(async (): Promise<boolean> => {
        while (inflight.current) await inflight.current;
        if (!dirty.current) return true;
        if (getActiveUserScope() !== scope.current) return false;
        const snapshot = planRef.current;
        const { errors } = replicaPlanIssues(snapshot);
        if (errors.length) {
            setSave({ status: "error", error: errors[0] });
            return false;
        }
        dirty.current = false;
        setSave({ status: "saving" });
        const request = saveVideoReplicationPlan(id, snapshot)
            .then((detail) => {
                appQueryClient.setQueryData<VideoReplicationDetail>(videoReplicationKeys.detail(scope.current, id), (old) => (old ? { ...old, plan: detail.plan, planUpdatedAt: detail.planUpdatedAt } : detail));
                if (!dirty.current) setSave({ status: "saved" });
                return true;
            })
            .catch((error: unknown) => {
                dirty.current = true;
                setSave({ status: "error", error: error instanceof Error ? error.message : "保存失败" });
                return false;
            })
            .finally(() => {
                inflight.current = null;
            });
        inflight.current = request;
        return request;
    }, [id]);

    useEffect(() => {
        if (!version) return;
        const timer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [flush, version]);

    // 离开工作区（切到拆解结果、返回列表）时把没存的改动存掉。
    useEffect(() => () => void flush(), [flush]);

    return { plan, update, save, flush };
}
