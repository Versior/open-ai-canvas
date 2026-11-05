import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { videoTeardownModelError, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { getVideoReplication, getVideoReplicationConfig, listVideoReplications, type VideoTeardownBundle } from "@/services/api/video-replication";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { openVideoTeardownInCanvas, type VideoReplicaOptions } from "./replication-canvas";
import { ReplicationHome } from "./replication-home";
import { ReplicationWorkspace, type ReplicationView } from "./replication-workspace";
import { dismissReplicationError, reanalyzeReplication, resumePendingReplication, startReplication, useReplicationRun, videoReplicationKeys, type ReplicationSource } from "./use-replication-runner";
import "./video-replication.css";

function errorText(error: unknown) {
    return error ? (error instanceof Error ? error.message : "读取失败") : "";
}

/**
 * 视频复刻：没有 ?id= 时是首页（拆解入口 + 最近拆解），有 ?id= 时是这条记录的工作区（时间线、原视频、分镜）。
 * 新建的拆解任务一建好就跳到它的工作区看进度；拆解结果（镜头事实和模型分析）都存在服务端，
 * 「去画布复刻」再把它们铺到一张新画布上（复刻分镜、关键帧、商品图和报告），在画布里生成首帧、视频和成片。
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
    const rootRef = useRef<HTMLDivElement>(null);
    const linkImportEnabled = useUserStore((state) => state.features.socialVideoImportEnabled);

    // 时长、镜头数上限和能不能识别口播以后台设置为准；没读到时不在前端拦，由服务端校验。
    const limitsQuery = useQuery({ queryKey: videoReplicationKeys.config(scope), queryFn: ({ signal }) => getVideoReplicationConfig(signal), staleTime: 60_000 });
    const limits = limitsQuery.data;
    const transcribeNote = limits && !limits.transcribeAvailable ? limits.transcribeNote || "暂时不能识别口播，口播从画面字幕识别" : "";
    const effectiveTranscribe = transcribe && !transcribeNote;

    const history = useQuery({
        queryKey: videoReplicationKeys.list(scope),
        queryFn: ({ signal }) => listVideoReplications(signal),
        refetchInterval: (query) => (query.state.data?.some((record) => record.status === "queued" || record.status === "running") ? 3000 : false),
    });
    const records = history.data;
    const selectedId = params.get("id") || "";
    const view: ReplicationView = params.get("view") === "plan" ? "plan" : "teardown";
    const detail = useQuery({
        queryKey: videoReplicationKeys.detail(scope, selectedId),
        queryFn: ({ signal }) => getVideoReplication(selectedId, signal),
        enabled: Boolean(selectedId),
        refetchInterval: (query) => (query.state.data?.task.status === "queued" || query.state.data?.task.status === "running" ? 2000 : false),
    });

    const select = useCallback((id: string) => setParams(id ? { id } : {}), [setParams]);
    const changeView = useCallback((next: ReplicationView) => setParams(next === "plan" ? { id: selectedId, view: next } : { id: selectedId }), [selectedId, setParams]);
    const { run, running } = useReplicationRun(select);
    const configRef = useRef(config);
    configRef.current = config;
    // 记录列表一到就看看有没有上次刷新、关页面打断的拆解，有就接着跑。
    useEffect(() => {
        if (records) resumePendingReplication(records, configRef.current);
    }, [records]);
    // 首页、记录和复刻方案之间切换时回到页面顶部。
    useEffect(() => {
        rootRef.current?.closest(".app-workspace-scroll")?.scrollTo({ top: 0 });
    }, [selectedId, view]);

    const startRun = (source: ReplicationSource, options: { model: string; transcribe: boolean }) => {
        dismissReplicationError();
        void startReplication(source, options, config, limits).then((started) => {
            if (!started) message.info("已有一条拆解在进行，等它结束再开始");
        });
    };
    const reanalyzeSelected = (fallbackTitle: string) => {
        const error = videoTeardownModelError(config, model);
        if (error) {
            message.warning(error);
            return;
        }
        dismissReplicationError();
        void reanalyzeReplication(selectedId, { model, transcribe: effectiveTranscribe }, fallbackTitle, config).then((started) => {
            if (!started) message.info("已有一条拆解在进行，等它结束再分析");
        });
    };
    const openInCanvas = async (bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis & { model: string }, options: VideoReplicaOptions) => {
        setOpening(true);
        try {
            const created = await openVideoTeardownInCanvas(bundle, analysis, analysis.model || model, options);
            if (created.syncError) message.warning("画布已在本机创建，云端同步稍后自动重试");
            navigate(`/canvas/${created.id}`);
        } catch (error) {
            message.error(`打开画布失败：${errorText(error)}`);
        } finally {
            setOpening(false);
        }
    };

    return (
        <WorkspacePage fluid>
            {/* 复刻方案整页滚动；拆解结果在宽屏下是一屏布局。 */}
            <div ref={rootRef} className="vr-page" data-view={selectedId ? (view === "plan" && detail.data?.analysis ? "plan" : "record") : "home"}>
                {selectedId ? (
                    <ReplicationWorkspace
                        detail={detail.data}
                        loading={detail.isPending}
                        error={errorText(detail.error)}
                        run={run}
                        busy={running}
                        opening={opening}
                        config={config}
                        model={model}
                        onModelChange={setPickedModel}
                        onReanalyze={reanalyzeSelected}
                        onOpenCanvas={openInCanvas}
                        onBack={() => select("")}
                        view={view}
                        onViewChange={changeView}
                    />
                ) : (
                    <ReplicationHome
                        composer={{
                            config,
                            model,
                            onModelChange: setPickedModel,
                            transcribe: effectiveTranscribe,
                            transcribeNote,
                            onTranscribeChange: setTranscribe,
                            limits,
                            linkImportEnabled,
                            busy: running,
                            run: run && !run.id ? run : null,
                            onStart: startRun,
                        }}
                        records={records}
                        loading={history.isPending}
                        error={errorText(history.error)}
                        activeRun={running && run?.id ? run : null}
                        onOpen={select}
                    />
                )}
            </div>
        </WorkspacePage>
    );
}
