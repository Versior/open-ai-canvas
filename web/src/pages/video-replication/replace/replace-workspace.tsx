import { App } from "antd";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { createClientId } from "@/lib/client-id";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { createProductVideoJob, emptyProductVideoInputs, pendingProductVideoShots, productVideoInputs, productVideoInputsError, reusableProductVideoSplit, type ProductVideoInputs, type ProductVideoJob } from "@/lib/product-video/job";
import { productVideoDefaultRatio } from "@/lib/product-video/media";
import { getVideoReplication, parseVideoTeardownBundle } from "@/services/api/video-replication";
import { selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { defaultProductVideoRange } from "./product-video-reference";
import { ProductVideoComposer } from "./product-video-composer";
import { productVideoLimitsFor } from "./product-video-config";
import { approveProductVideoPreview, isProductVideoRunning, redoProductVideoShot, resumeProductVideos, retryProductVideo, runProductVideo, stopProductVideo } from "./product-video-runner";
import { ProductVideoWorks, type ProductVideoWorkActions } from "./product-video-works";
import { createProductVideo, loadProductVideos, removeProductVideo, useProductVideoStore } from "./use-product-video-store";
import "./product-video.css";

type Patch = Partial<ProductVideoInputs> | ((current: ProductVideoInputs) => Partial<ProductVideoInputs>);

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** 拆解记录的标题：保存过分析时用分析标题，否则空着，由参考视频名兜底。 */
function analysisTitle(analysis: unknown) {
    const title = analysis && typeof analysis === "object" ? (analysis as { title?: unknown }).title : undefined;
    return typeof title === "string" ? title.trim() : "";
}

/**
 * 视频复刻 · 元素替换：用一条参考视频的动作、镜头和节奏，换上自己的商品、模特和背景。
 * 左边放素材和参考视频，右边是视频作品；作品存在服务端，生成流程见 product-video-runner。
 * sourceTeardownId 是从拆解记录点「用它做元素替换」带过来的拆解，载入后把它的原视频放进参考视频。
 */
export function ReplaceWorkspace({ modeSwitch, sourceTeardownId, onSourceConsumed }: { modeSwitch: ReactNode; sourceTeardownId?: string; onSourceConsumed: () => void }) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const configRef = useRef(config);
    configRef.current = config;
    const jobs = useProductVideoStore((state) => state.jobs);
    const status = useProductVideoStore((state) => state.status);
    const loadError = useProductVideoStore((state) => state.error);
    const [inputs, setInputs] = useState<ProductVideoInputs>(emptyProductVideoInputs);
    const [editing, setEditing] = useState<string>();
    const [starting, setStarting] = useState(false);
    const composerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        void loadProductVideos(true);
    }, []);
    // 列表一到就接着跑上次没跑完的作品（刷新或关页面时打断的）。
    const resumed = useRef(false);
    useEffect(() => {
        if (status !== "ready" || resumed.current) return;
        resumed.current = true;
        resumeProductVideos(useProductVideoStore.getState().jobs, configRef.current);
    }, [status]);

    // 从拆解记录带过来的视频：读出原视频资源和时长放进参考视频，读完就从地址里去掉。
    useEffect(() => {
        if (!sourceTeardownId) return;
        const controller = new AbortController();
        getVideoReplication(sourceTeardownId, controller.signal)
            .then((detail) => {
                const { source } = parseVideoTeardownBundle(detail.task);
                const name = analysisTitle(detail.analysis) || "拆解过的视频";
                setInputs((current) => ({ ...current, reference: { resourceId: source.resourceId, name, durationMs: source.durationMs, width: source.width, height: source.height }, ...defaultProductVideoRange(source.durationMs), ratio: "" }));
                message.success("已放入参考视频，再放上要换进去的商品、模特或背景");
            })
            .catch((error) => {
                if (!controller.signal.aborted) message.error(`没能载入这条拆解的视频：${errorText(error, "请重试")}`);
            })
            .finally(() => {
                if (!controller.signal.aborted) onSourceConsumed();
            });
        return () => controller.abort();
        // onSourceConsumed 只在读完时调用一次，不作为依赖。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message, sourceTeardownId]);

    const change = useCallback((patch: Patch) => setInputs((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) })), []);

    // 默认模型：全局默认的视频模型能做元素替换就用它，否则用第一个能参考视频的模型。
    const suitable = useMemo(() => selectableModelsByCapability(config, "video").filter((model) => typeof productVideoLimitsFor(config, model) !== "string"), [config]);
    useEffect(() => {
        setInputs((current) => {
            if (current.model && suitable.includes(current.model)) return current;
            const model = suitable.includes(config.videoModel) ? config.videoModel : suitable[0] || "";
            return model === current.model ? current : { ...current, model, ratio: "", resolution: "" };
        });
    }, [config.videoModel, suitable]);

    // 画幅、清晰度跟着模型能力归一：换模型或换参考视频后不支持的值改回默认（画幅尽量贴近参考视频）。
    const profile = useMemo(() => (inputs.model ? modelCapabilityConfigFor(config, inputs.model).video : undefined), [config, inputs.model]);
    useEffect(() => {
        if (!profile) return;
        setInputs((current) => {
            const ratio = profile.ratios.includes(current.ratio) ? current.ratio : productVideoDefaultRatio(profile.ratios, current.reference?.width, current.reference?.height, profile.defaultRatio);
            const resolution = profile.resolutions.includes(current.resolution) ? current.resolution : profile.defaultResolution || profile.resolutions[0] || "";
            const audio = current.audio === "model" && !profile.generateAudio.supported ? "original" : current.audio;
            return ratio === current.ratio && resolution === current.resolution && audio === current.audio ? current : { ...current, ratio, resolution, audio };
        });
    }, [profile, inputs.reference, inputs.ratio]);

    const limits = productVideoLimitsFor(config, inputs.model);
    const inputError = productVideoInputsError(inputs, typeof limits === "string" ? undefined : limits.maxImages) || (typeof limits === "string" && inputs.model ? `所选模型${limits}，请换一个能参考视频的模型` : "");

    const start = async (value: ProductVideoInputs, source?: ProductVideoJob, credits?: number) => {
        const modelLimits = productVideoLimitsFor(configRef.current, value.model);
        const problem = productVideoInputsError(value, typeof modelLimits === "string" ? undefined : modelLimits.maxImages) || (typeof modelLimits === "string" ? `所选模型${modelLimits}` : "");
        if (problem || typeof modelLimits === "string") {
            message.warning(problem);
            return false;
        }
        const id = nanoid(12);
        let job = createProductVideoJob(id, value, { splitKey: createClientId(), maxSegmentSeconds: modelLimits.maxSegmentSeconds, credits });
        // 再次生成：参考视频和选段没变时沿用切好的片段，不再切一次。
        const reuse = source ? reusableProductVideoSplit(source, value, modelLimits.maxSegmentSeconds) : undefined;
        if (reuse?.segments) job = { ...job, status: "generating", split: reuse, shots: pendingProductVideoShots(reuse.segments) };
        setStarting(true);
        try {
            await createProductVideo(job);
            runProductVideo(id, configRef.current);
            message.success("已开始生成，进度在右边的视频作品里");
            return true;
        } catch (error) {
            message.error(`没能保存作品：${errorText(error, "请重试")}`);
            return false;
        } finally {
            setStarting(false);
        }
    };

    const actions: ProductVideoWorkActions = {
        onEdit: (job) => {
            setInputs(productVideoInputs(job));
            setEditing(job.title);
            composerRef.current?.querySelector(".pv-composer-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
        },
        onRegenerate: (job) => void start({ ...productVideoInputs(job), title: job.title }, job, job.credits),
        onDelete: (job) =>
            modal.confirm({
                title: "删除这条作品？",
                content: "只删除作品记录，已上传的素材和生成好的视频仍在素材里。",
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: async () => {
                    try {
                        if (isProductVideoRunning(job.id)) await stopProductVideo(job.id);
                        await removeProductVideo(job.id);
                    } catch (error) {
                        message.error(`删除失败：${errorText(error, "请重试")}`);
                    }
                },
            }),
        onStop: (job) => void stopProductVideo(job.id).catch((error) => message.error(`停止失败：${errorText(error, "请重试")}`)),
        onRetry: (job) => void retryProductVideo(job.id, configRef.current).catch((error) => message.error(errorText(error, "请重试"))),
        onApprovePreview: (job) => void approveProductVideoPreview(job.id, configRef.current).catch((error) => message.error(errorText(error, "请重试"))),
        onRedoShot: (job, index, fix) => void redoProductVideoShot(job.id, index, fix, configRef.current).catch((error) => message.error(errorText(error, "请重试"))),
    };

    return (
        <WorkspacePage fluid scroll={false} className="pv-page">
            <div className="pv-shell">
                <header className="pv-head">
                    <div className="pv-head-title">
                        <h1>视频复刻</h1>
                        {modeSwitch}
                    </div>
                    <p>元素替换：沿用参考视频的动作、镜头和节奏，换上你的商品、模特和背景。复刻请用你有权使用的素材和形象。</p>
                </header>
                <div className="pv-body">
                    <div ref={composerRef} className="pv-left">
                        <ProductVideoComposer
                            config={config}
                            inputs={inputs}
                            editing={editing}
                            starting={starting}
                            error={inputError}
                            onChange={change}
                            onStart={(credits) => void start(inputs, undefined, credits).then((started) => started && setEditing(undefined))}
                            onReset={() => {
                                setInputs({ ...emptyProductVideoInputs(), model: inputs.model });
                                setEditing(undefined);
                            }}
                        />
                    </div>
                    <ProductVideoWorks jobs={jobs} status={status} error={loadError} onReload={() => void loadProductVideos(true)} actions={actions} />
                </div>
            </div>
        </WorkspacePage>
    );
}
