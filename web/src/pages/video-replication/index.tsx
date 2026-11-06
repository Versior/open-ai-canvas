import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { nanoid } from "nanoid";
import { readReplicaPlan } from "@/lib/canvas/video-replica-plan";
import { readVideoReplicationAnalysis, videoTeardownModelError, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { createRemakeJob, isRemakeJob } from "@/lib/remake/job";
import { getActiveUserScope } from "@/lib/user-scope";
import { getVideoReplication, getVideoReplicationConfig, listVideoReplications, parseVideoTeardownBundle, type VideoReplicationDetail, type VideoTeardownBundle } from "@/services/api/video-replication";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { openVideoTeardownInCanvas, type VideoReplicaOptions } from "./replication-canvas";
import { ReplicationHome } from "./replication-home";
import { ReplicationTabs, type ReplicationTab } from "./replication-mode-switch";
import { ReplicationWorkspace, type ReplicationView } from "./replication-workspace";
import { dismissReplicationError, reanalyzeReplication, resumePendingReplication, startReplication, useReplicationRun, videoReplicationKeys, type ReplicationSource } from "./use-replication-runner";
import { RemakeWorkbench, type RemakeStep } from "./remake/remake-workbench";
import { RemakeWorks } from "./remake/remake-works";
import { resumeRemakes } from "./remake/remake-runner";
import { resumeProductVideos } from "./replace/product-video-runner";
import { createProductVideo, loadProductVideos, useProductVideoStore } from "./replace/use-product-video-store";
import "./remake/remake.css";
import "./video-replication.css";

function errorText(error: unknown) {
    return error ? (error instanceof Error ? error.message : "读取失败") : "";
}

/**
 * 视频复刻：首页两个页签「新建复刻」和「我的作品」（?tab=works；旧地址 ?mode=replace 也进作品页）。
 * 拆解记录（?id=）拆完后点「开始复刻」建一条复刻作品，进复刻工作台（?remake=，见 remake/remake-workbench.tsx）。
 * 没有 ?id= 时是首页（拆解入口 + 最近拆解），有 ?id= 时是这条记录的工作区（时间线、原视频、分镜）。
 * 新建的拆解任务一建好就跳到它的工作区看进度；拆解结果（镜头事实和模型分析）都存在服务端，
 * 「去画布复刻」再把它们铺到一张新画布上（复刻分镜、关键帧、商品图和报告），在画布里生成首帧、视频和成片。
 */
export default function VideoReplicationPage() {
    const { message } = App.useApp();
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
    const requestedView = params.get("view");
    const view: ReplicationView = requestedView === "plan" || requestedView === "canvas" ? requestedView : "teardown";
    const detail = useQuery({
        queryKey: videoReplicationKeys.detail(scope, selectedId),
        queryFn: ({ signal }) => getVideoReplication(selectedId, signal),
        enabled: Boolean(selectedId),
        refetchInterval: (query) => (query.state.data?.task.status === "queued" || query.state.data?.task.status === "running" ? 2000 : false),
    });

    const remakeId = params.get("remake") || "";
    const remakeStep: RemakeStep = params.get("step") === "produce" ? "produce" : "recipe";
    const tab: ReplicationTab = !selectedId && (params.get("tab") === "works" || params.get("mode") === "replace") ? "works" : "new";
    const works = useProductVideoStore((state) => state.jobs);
    const worksStatus = useProductVideoStore((state) => state.status);
    const worksError = useProductVideoStore((state) => state.error);
    const changeTab = useCallback((next: ReplicationTab) => setParams(next === "works" ? { tab: "works" } : {}), [setParams]);
    const tabs = <ReplicationTabs value={tab} onChange={changeTab} works={works.length} />;
    const select = useCallback((id: string) => setParams(id ? { id } : {}), [setParams]);
    const changeView = useCallback((next: ReplicationView) => setParams(next === "teardown" ? { id: selectedId } : { id: selectedId, view: next }), [selectedId, setParams]);
    const { run, running } = useReplicationRun(select);
    const configRef = useRef(config);
    configRef.current = config;
    // 作品列表一到就接着跑上次没跑完的复刻（刷新或关页面时打断的）。
    useEffect(() => {
        void loadProductVideos(true);
    }, []);
    const resumedWorks = useRef(false);
    useEffect(() => {
        if (worksStatus !== "ready" || resumedWorks.current) return;
        resumedWorks.current = true;
        const jobs = useProductVideoStore.getState().jobs;
        resumeRemakes(jobs.filter(isRemakeJob), configRef.current);
        resumeProductVideos(jobs.filter((job) => !isRemakeJob(job)) as Parameters<typeof resumeProductVideos>[0], configRef.current);
    }, [worksStatus]);
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
            // 跳转交给画布生成这一步：它先把新画布记进方案再打开。
            return { id: created.id, title: `复刻 · ${analysis.title || "视频拆解"}` };
        } catch (error) {
            message.error(`打开画布失败：${errorText(error)}`);
            return null;
        } finally {
            setOpening(false);
        }
    };

    // 拆解记录 → 复刻作品：带上镜头、AI 解读和复刻方案里填过的商品，进工作台的「换成我的」。
    const startRemakeFrom = async (record: VideoReplicationDetail, fallbackTitle: string) => {
        try {
            const bundle = parseVideoTeardownBundle(record.task);
            const analysis = readVideoReplicationAnalysis(record.analysis, bundle.shots.length);
            const job = createRemakeJob(nanoid(12), { teardownId: record.task.id, bundle, analysis, sourceName: fallbackTitle });
            if (analysis && record.plan) {
                const planned = readReplicaPlan(record.plan, bundle, analysis).product;
                if (planned.name || planned.images.length)
                    job.product = {
                        name: planned.name,
                        sellingPoints: planned.sellingPoints,
                        images: planned.images.map((image) => ({ id: image.resourceId, resourceId: image.resourceId, name: planned.name, width: image.width, height: image.height })),
                    };
            }
            await createProductVideo(job);
            setParams({ remake: job.id });
        } catch (error) {
            message.error(`没能开始复刻：${errorText(error)}`);
        }
    };

    if (remakeId)
        return (
            <RemakeWorkbench
                key={remakeId}
                id={remakeId}
                step={remakeStep}
                onStep={(next) => setParams(next === "produce" ? { remake: remakeId, step: "produce" } : { remake: remakeId })}
                onBack={() => setParams({ tab: "works" })}
                onOpen={(next) => setParams({ remake: next })}
                onOpenTeardown={(teardownId) => setParams({ id: teardownId })}
            />
        );

    return (
        <WorkspacePage fluid>
            {/* 复刻方案整页滚动；拆解结果在宽屏下是一屏布局。 */}
            <div ref={rootRef} className="vr-page" data-view={selectedId ? (view !== "teardown" && detail.data?.analysis ? "plan" : "record") : "home"}>
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
                        onRemake={(record, fallbackTitle) => void startRemakeFrom(record, fallbackTitle)}
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
                        tabs={tabs}
                        tab={tab}
                        works={<RemakeWorks jobs={works} status={worksStatus} error={worksError} config={config} onReload={() => void loadProductVideos(true)} onOpen={(id) => setParams({ remake: id })} onNew={() => changeTab("new")} />}
                    />
                )}
            </div>
        </WorkspacePage>
    );
}
