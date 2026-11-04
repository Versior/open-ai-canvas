import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { ScanSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { EmptyState } from "@/components/ui/product/empty-state/empty-state";
import { videoTeardownModelError, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { getVideoReplication, listVideoReplications, type VideoTeardownBundle } from "@/services/api/video-replication";
import { modelOptionLabel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { openVideoTeardownInCanvas } from "./replication-canvas";
import { ReplicationForm } from "./replication-form";
import { ReplicationHistory } from "./replication-history";
import { ReplicationResult } from "./replication-result";
import { dismissReplicationError, reanalyzeReplication, REPLICATION_STAGE_LABELS, resumePendingReplication, startReplication, useReplicationRun, useReplicationRunId, videoReplicationKeys, type ReplicationSource } from "./use-replication-runner";

function errorText(error: unknown) {
    return error ? (error instanceof Error ? error.message : "读取失败") : "";
}

/**
 * 视频复刻：左边新建拆解和历史记录，右边看选中的那条。当前记录写在 ?id= 里，刷新和回退都能回到原处。
 * 拆解结果（镜头事实和模型分析）都存在服务端；「在画布中打开」再把它们铺到一张新画布上继续创作。
 */
export default function VideoReplicationPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const [params, setParams] = useSearchParams();
    const scope = getActiveUserScope();
    const models = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const defaultModel = useMemo(() => [config.textModel, ...models].find((item) => item && !videoTeardownModelError(config, item)) || "", [config, models]);
    const [pickedModel, setPickedModel] = useState("");
    const model = pickedModel || defaultModel;
    const [transcribe, setTranscribe] = useState(true);
    const [opening, setOpening] = useState(false);

    const history = useQuery({
        queryKey: videoReplicationKeys.list(scope),
        queryFn: ({ signal }) => listVideoReplications(signal),
        refetchInterval: (query) => (query.state.data?.some((record) => record.status === "queued" || record.status === "running") ? 3000 : false),
    });
    const records = history.data;
    const runId = useReplicationRunId();
    // 地址里没指定记录时，优先显示正在跑的那条（离开页面再回来也能接着看进度）。
    const selectedId = params.get("id") || runId || records?.[0]?.id || "";
    const detail = useQuery({
        queryKey: videoReplicationKeys.detail(scope, selectedId),
        queryFn: ({ signal }) => getVideoReplication(selectedId, signal),
        enabled: Boolean(selectedId),
        refetchInterval: (query) => (query.state.data?.task.status === "queued" || query.state.data?.task.status === "running" ? 2000 : false),
    });

    const select = useCallback((id: string) => setParams({ id }), [setParams]);
    const { run, running } = useReplicationRun(select);
    const configRef = useRef(config);
    configRef.current = config;
    // 记录列表一到就看看有没有上次刷新、关页面打断的拆解，有就接着跑。
    useEffect(() => {
        if (records) resumePendingReplication(records, configRef.current);
    }, [records]);

    const startRun = (source: ReplicationSource, options: { model: string; transcribe: boolean }) => {
        dismissReplicationError();
        void startReplication(source, options, config);
    };
    const reanalyzeSelected = (fallbackTitle: string) => {
        const error = videoTeardownModelError(config, model);
        if (error) {
            message.warning(error);
            return;
        }
        dismissReplicationError();
        void reanalyzeReplication(selectedId, { model, transcribe }, fallbackTitle, config);
    };
    const openInCanvas = async (bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis & { model: string }) => {
        setOpening(true);
        try {
            const created = await openVideoTeardownInCanvas(bundle, analysis, analysis.model || model);
            if (created.syncError) message.warning("画布已在本机创建，云端同步稍后自动重试");
            navigate(`/canvas/${created.id}`);
        } catch (error) {
            message.error(`打开画布失败：${errorText(error)}`);
        } finally {
            setOpening(false);
        }
    };

    // 新建前还没有任务 ID 的步骤（导入、上传）失败时，错误只能显示在表单下面。
    const orphanRun = run && !run.id ? run : null;
    return (
        <WorkspacePage>
            <PageHeader title="视频复刻" description="上传视频或粘贴抖音、TikTok 链接，拆出镜头、口播、运镜和节奏，生成可直接复用的分镜表和拆解报告。" />
            <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
                <aside className="flex min-w-0 flex-col gap-4">
                    <ReplicationForm config={config} model={model} onModelChange={setPickedModel} transcribe={transcribe} onTranscribeChange={setTranscribe} busy={running} onStart={startRun} />
                    {orphanRun ? (
                        <p role={orphanRun.error ? "alert" : "status"} className={orphanRun.error ? "px-1 text-sm text-destructive" : "px-1 text-sm text-muted-foreground"}>
                            {orphanRun.error ? `拆解失败：${orphanRun.error}` : `${REPLICATION_STAGE_LABELS[orphanRun.stage]}${orphanRun.detail ? ` · ${orphanRun.detail}` : ""}${orphanRun.percent !== undefined ? ` ${orphanRun.percent}%` : ""}`}
                        </p>
                    ) : null}
                    <ReplicationHistory records={records} loading={history.isPending} error={errorText(history.error)} selectedId={selectedId} onSelect={select} />
                </aside>
                <div className="min-w-0">
                    {selectedId ? (
                        <ReplicationResult
                            detail={detail.data}
                            loading={detail.isPending}
                            error={errorText(detail.error)}
                            run={run}
                            busy={running}
                            opening={opening}
                            modelLabel={(id) => modelOptionLabel(config, id)}
                            onReanalyze={reanalyzeSelected}
                            onOpenCanvas={(bundle, analysis) => void openInCanvas(bundle, analysis)}
                        />
                    ) : history.isPending ? null : (
                        <EmptyState icon={ScanSearch} title="还没有拆解记录" description="在左边粘贴链接或上传一段 3 分钟以内的视频，开始第一次拆解。" />
                    )}
                </div>
            </div>
        </WorkspacePage>
    );
}
