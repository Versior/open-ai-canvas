import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { videoTeardownModelError, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { getVideoReplication, listVideoReplications, type VideoTeardownBundle } from "@/services/api/video-replication";
import { modelOptionLabel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { openVideoTeardownInCanvas } from "./replication-canvas";
import { ReplicationForm } from "./replication-form";
import { ReplicationHistory } from "./replication-history";
import { ReplicationResult } from "./replication-result";
import { dismissReplicationError, reanalyzeReplication, resumePendingReplication, startReplication, useReplicationRun, useReplicationRunId, videoReplicationKeys, type ReplicationSource } from "./use-replication-runner";

function errorText(error: unknown) {
    return error ? (error instanceof Error ? error.message : "读取失败") : "";
}

/**
 * 视频复刻：左栏是「新建拆解」和拆解记录，右栏是新建表单或选中的记录，两栏各自滚动。
 * 当前记录写在 ?id= 里，?new 打开新建表单；地址里都没有时，有正在跑的拆解就显示它，否则显示新建表单。
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
    const contentRef = useRef<HTMLDivElement>(null);

    const history = useQuery({
        queryKey: videoReplicationKeys.list(scope),
        queryFn: ({ signal }) => listVideoReplications(signal),
        refetchInterval: (query) => (query.state.data?.some((record) => record.status === "queued" || record.status === "running") ? 3000 : false),
    });
    const records = history.data;
    const runId = useReplicationRunId();
    const selectedId = params.get("id") || (params.has("new") ? "" : runId);
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
    // 换一条记录时右栏回到顶部。
    useEffect(() => {
        contentRef.current?.scrollTo({ top: 0 });
    }, [selectedId]);

    const startRun = (source: ReplicationSource, options: { model: string; transcribe: boolean }) => {
        dismissReplicationError();
        void startReplication(source, options, config);
    };
    const reanalyzeSelected = (fallbackTitle: string) => {
        const error = videoTeardownModelError(config, model);
        if (error) {
            message.warning(`${error}（在「新建拆解」里换一个分析模型）`);
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

    // 导入、上传这两步还没有拆解任务，进度和错误显示在新建表单里。
    const formRun = run && !run.id ? run : null;
    return (
        <WorkspacePage fluid scroll={false}>
            <div className="flex h-full flex-col gap-3 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 lg:overflow-hidden xl:px-5">
                <PageHeader title="视频复刻" description="上传视频或粘贴抖音、TikTok 链接，拆出镜头、口播、运镜和节奏，得到可直接复用的分镜和复刻提示词。" />
                <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[288px_minmax(0,1fr)]">
                    <ReplicationHistory
                        records={records}
                        loading={history.isPending}
                        error={errorText(history.error)}
                        selectedId={selectedId}
                        runningId={running ? runId : ""}
                        className="lg:h-full"
                        onSelect={select}
                        onNew={() => setParams({ new: "1" })}
                    />
                    <div ref={contentRef} className="min-w-0 lg:h-full lg:overflow-y-auto lg:pr-1">
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
                        ) : (
                            <ReplicationForm config={config} model={model} onModelChange={setPickedModel} transcribe={transcribe} onTranscribeChange={setTranscribe} busy={running} run={formRun} onStart={startRun} />
                        )}
                    </div>
                </div>
            </div>
        </WorkspacePage>
    );
}
