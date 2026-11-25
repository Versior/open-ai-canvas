import { App, Button, Dropdown, Spin, Tooltip } from "antd";
import { saveAs } from "file-saver";
import { CircleStop, Download, Ellipsis, ImageOff, ImagePlus, Maximize2, RefreshCw, Rows3, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { assertCurrentUserSession, captureUserSession, getActiveUserScope } from "@/lib/user-scope";
import { workspacePath } from "@/lib/workspace-routes";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { TaskSettlement } from "@/components/generation-cost-notice";
import { ImageGenerationPack } from "@/components/image-pack/image-generation-pack";
import { ImagePackProgress } from "@/components/image-pack/image-pack-progress";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioDisplayName } from "@/lib/ecommerce-studio/brief";
import { studioImageSetupBlock } from "@/lib/ecommerce-studio/generation-input";
import { studioAttemptActive, studioAttemptNeedsReview, studioPlanOf, studioShotApproved, studioShotLatestAttempt, studioShotOutputs, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { studioRunTitle } from "@/lib/ecommerce-studio/runs";
import { studioGroupProgress, studioShotDisplay } from "@/lib/ecommerce-studio/task-display";
import { STUDIO_PLAN_META } from "@/lib/ecommerce-studio/shot-specs";
import type { StudioAttemptStatus, StudioGenerationSource, StudioOutput, StudioPlan, StudioPlanKind, StudioProduct, StudioShot, StudioTextMode } from "@/lib/ecommerce-studio/types";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { studioShotHasCopy } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioShotSpec } from "@/lib/ecommerce-studio/shot-specs";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceStorageKey } from "@/services/api/resources";
import { queryGenerationTask, recoverGenerationTaskMedia, subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { bindStudioLongImage, composeStudioShots, downloadStudioComposed, exportStudioZip, releaseComposed, studioOutputNeedsLegacyTypeset, type StudioArchiveKind } from "./studio-delivery";
import { inspectStudioDelivery } from "./studio-delivery-review";
import type { StudioDeliveryReview } from "@/lib/ecommerce-studio/delivery-review";
import { ratioStyle, studioImageUrl } from "./studio-parts";
import { patchStudioShotAt, studioShotPending, type StudioRunner, type StudioShotRef } from "./use-studio-runner";
import { useStudioStore } from "./use-studio-store";
import "./studio-delivery.css";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

/** 结果区里的一组图：表单生成的记录或助手排的方案，界面上按同一种卡片展示。 */
export type StudioShotGroup = {
    key: string;
    ref: StudioShotRef;
    title: string;
    createdAt: string;
    kind?: StudioPlanKind;
    textMode: StudioTextMode;
    shots: StudioShot[];
    fromAgent: boolean;
    plannedDetail?: true;
    styleId?: StudioPlan["styleId"];
    tone?: StudioPlan["tone"];
    source?: StudioGenerationSource;
};

export type StudioViewerTarget = { groupKey: string; shotId: string; resourceId?: string };

const STATUS_LABEL: Record<StudioAttemptStatus | "idle", string> = { idle: "待生成", submitting: "提交中", queued: "排队中", running: "生成中", succeeded: "已完成", failed: "生成失败", cancelled: "已取消" };

export function studioShotGroups(product: StudioProduct): StudioShotGroup[] {
    const plans = product.plans.map((plan) => ({
        key: `plan:${plan.kind}`,
        ref: { planKind: plan.kind },
        title: `${STUDIO_PLAN_META[plan.kind].title}方案`,
        createdAt: plan.createdAt,
        kind: plan.kind,
        textMode: plan.textMode,
        shots: plan.shots,
        styleId: plan.styleId,
        tone: plan.tone,
        fromAgent: true,
    }));
    const runs = product.runs.map((run) => ({
        key: `run:${run.id}`,
        ref: { runId: run.id },
        title: studioRunTitle(run),
        createdAt: run.createdAt,
        kind: run.kind,
        textMode: run.textMode,
        styleId: run.styleId,
        tone: run.suite?.tone,
        shots: run.shots,
        fromAgent: false,
        ...(run.type === "detail-set" && run.kind === "detail" && run.textMode === "model" && run.shots.some((shot) => shot.screenIndex !== undefined || shot.purchaseQuestion?.trim()) ? { plannedDetail: true as const } : {}),
        source: run.source,
    }));
    return [...plans, ...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function studioDetailResultTitle(group: StudioShotGroup, shot: StudioShot, index: number) {
    if (!group.plannedDetail) return undefined;
    const question = shot.purchaseQuestion?.trim();
    return `第 ${index + 1} 屏${question ? ` · ${question}` : ""}`;
}

function downloadName(product: StudioProduct, shot: StudioShot, index: number) {
    const stem = `${studioDisplayName(product)}-${shot.title || "商品图"}`.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
    return `${stem}${index ? `-${index}` : ""}.png`;
}

async function downloadOutputs(items: { output: StudioOutput; fileName: string }[]) {
    for (const [index, item] of items.entries()) {
        if (index) await new Promise((resolve) => setTimeout(resolve, 400));
        await downloadBrowserMedia({ fileName: item.fileName, storageKey: resourceStorageKey(item.output.resourceId) });
    }
}

/** 列表也展示同一份排版成品；仅在进入视口后读取原图、加载字库。 */
function StudioResultArtwork({ product, group, shot, output, full = false, title = shot.title }: { product: StudioProduct; group: StudioShotGroup; shot: StudioShot; output: StudioOutput; full?: boolean; title?: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(false);
    const [preview, setPreview] = useState<{ key: string; url?: string; error?: string }>();
    const overlay = studioShotHasCopy(shot, studioShotSpec(shot.role, product.dossier?.family || "generic")) && studioOutputNeedsLegacyTypeset(group, shot, output);
    const key = JSON.stringify([product.id, product.style, group.styleId, group.tone, group.textMode, shot.role, shot.layout, shot.composition, shot.headline, shot.subline, shot.lines, shot.eyebrow, output.resourceId]);
    useEffect(() => {
        if (!overlay || !ref.current) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "100px" },
        );
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [overlay]);
    useEffect(() => {
        if (!overlay || !visible) return;
        const controller = new AbortController();
        let images: Awaited<ReturnType<typeof composeStudioShots>> = [];
        void composeStudioShots(product, { id: group.key, kind: group.kind || "main", createdAt: group.createdAt, textMode: group.textMode, styleId: group.styleId, tone: group.tone, shots: [{ ...shot, adopted: output }] }, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return releaseComposed(result);
                images = result;
                setPreview({ key, url: result[0]?.url });
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setPreview({ key, error: error instanceof Error ? error.message : "成品预览失败" });
            });
        return () => {
            controller.abort();
            releaseComposed(images);
        };
    }, [key, overlay, visible]);
    return (
        <span ref={ref} className="es-result-artwork">
            {!overlay ? (
                <img src={studioImageUrl(output.resourceId, !full)} alt={title} loading="lazy" />
            ) : preview?.key === key && preview.url ? (
                <img src={preview.url} alt={`${title} · 成品预览`} />
            ) : preview?.key === key && preview.error ? (
                <span role="alert">{preview.error}</span>
            ) : (
                <Spin size="small" />
            )}
        </span>
    );
}

export function ResultTile({
    product,
    group,
    shot,
    caption,
    detailTitle,
    blocked,
    onView,
    onDownload,
    onReference,
    onRerun,
    onSync,
    task,
    acting = false,
    showContext = false,
}: {
    product: StudioProduct;
    group: StudioShotGroup;
    shot: StudioShot;
    caption?: string;
    detailTitle?: string;
    blocked: string;
    onView: () => void;
    onDownload: () => void;
    onReference: () => void;
    onRerun: () => void;
    onSync: () => void;
    task?: GenerationTask;
    acting?: boolean;
    /** 详情页结果需要让用户知道每屏承担的购买任务；主图套图保持紧凑。 */
    showContext?: boolean;
}) {
    const latest = studioShotLatestAttempt(shot);
    const preview = studioShotPreview(shot);
    const active = Boolean(latest && studioAttemptActive(latest));
    const review = latest && studioAttemptNeedsReview(latest);
    const display = studioShotDisplay(shot, task);
    const screenPurpose = showContext && !detailTitle ? shot.purchaseQuestion?.trim() : "";
    const syncAction = review ? (
        <Link to={workspacePath("/tasks")}>到任务中心核对</Link>
    ) : latest?.error ? (
        <Button size="small" onClick={onSync}>
            重新查询
        </Button>
    ) : null;
    const failed = latest && (latest.status === "failed" || latest.status === "cancelled") && !active;
    const status = latest?.status || "idle";
    return (
        <figure className="es-tile-wrap" id={`studio-shot-${group.key}-${shot.id}`} data-shot-id={shot.id}>
            {/* 出好的图按实际宽高显示：模型给的比例和要求的不一样时也不裁掉。 */}
            <div className="es-tile" style={ratioStyle(preview?.width && preview.height ? `${preview.width}:${preview.height}` : shot.ratio)} data-state={preview ? "done" : active ? "active" : failed ? "failed" : "idle"}>
                <ImageGenerationPack
                    pending={active && !review}
                    disabled={group.shots.length > 1}
                    succeeded={studioShotApproved(shot) && status === "succeeded" && Boolean(latest?.outputs.some((output) => output.resourceId === preview?.resourceId))}
                    label={<ImagePackProgress task={task || { status: status === "queued" ? "queued" : "running", createdAt: latest?.createdAt }} phase={status === "submitting" ? "submitting" : undefined} />}
                    pendingActions={syncAction}
                >
                    {preview ? (
                        <button type="button" data-image-pack-result className="es-tile-image" onClick={onView} aria-label={`查看${detailTitle || shot.title}`}>
                            <StudioResultArtwork product={product} group={group} shot={shot} output={preview} title={detailTitle} />
                        </button>
                    ) : null}
                    {!preview && active ? (
                        <div className="es-tile-state">
                            {review ? <span>回执待核对</span> : <ImagePackProgress task={task || { status: status === "queued" ? "queued" : "running", createdAt: latest?.createdAt }} phase={status === "submitting" ? "submitting" : undefined} />}
                            {latest?.error && (
                                <span className="es-tile-error" role="status">
                                    {latest.error}
                                </span>
                            )}
                            {syncAction}
                        </div>
                    ) : null}
                    {!preview && !active && failed ? (
                        <div className="es-tile-state image-pack-notice" data-tone={status === "cancelled" ? "neutral" : display.state === "recover" || display.state === "review" ? "warning" : "error"}>
                            <span className="es-tile-failure-icon" aria-hidden>
                                {status === "cancelled" ? <CircleStop size={24} /> : <ImageOff size={24} />}
                            </span>
                            <strong>{display.label}</strong>
                            <span className="es-tile-error" title={display.detail}>
                                {display.detail || "调整设置后可以重新生成"}
                            </span>
                            {latest?.taskId ? (
                                <Link className="es-tile-task-link" to={workspacePath("/tasks")}>
                                    核对原任务
                                </Link>
                            ) : null}
                            <Tooltip title={blocked || undefined}>
                                {display.state !== "review" ? (
                                    <Button size="small" icon={<RefreshCw size={14} aria-hidden />} loading={acting} disabled={Boolean(blocked)} onClick={onRerun}>
                                        {display.state === "recover" ? "继续保存（不重新生成）" : "重新生成"}
                                    </Button>
                                ) : null}
                            </Tooltip>
                        </div>
                    ) : null}
                    {!preview && !active && !failed ? (
                        <div className="es-tile-state">
                            <span>待生成</span>
                            <Tooltip title={blocked || undefined}>
                                <Button size="small" disabled={Boolean(blocked)} onClick={onRerun}>
                                    生成
                                </Button>
                            </Tooltip>
                        </div>
                    ) : null}
                </ImageGenerationPack>
                {preview && active ? (
                    <span className="es-tile-badge">
                        {!review && <Spin size="small" />} {review ? "回执待核对" : STATUS_LABEL[status]}
                        {syncAction}
                    </span>
                ) : null}
                {preview ? (
                    <div className="es-tile-actions">
                        <Tooltip title="查看大图">
                            <button type="button" className="es-media-btn" aria-label="查看大图" onClick={onView}>
                                <Maximize2 size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip title="下载">
                            <button type="button" className="es-media-btn" aria-label="下载" onClick={onDownload}>
                                <Download size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip title="用作参考图">
                            <button type="button" className="es-media-btn" aria-label="用作参考图" onClick={onReference}>
                                <ImagePlus size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip title={blocked || "再出一张"}>
                            <button type="button" className="es-media-btn" aria-label="再出一张" disabled={Boolean(blocked) || active || acting} onClick={onRerun}>
                                <RefreshCw size={14} />
                            </button>
                        </Tooltip>
                    </div>
                ) : null}
            </div>
            {detailTitle || caption || showContext ? (
                <figcaption className="es-tile-caption" title={detailTitle || caption}>
                    {detailTitle ? <strong>{detailTitle}</strong> : caption || shot.title}
                    {screenPurpose ? <span className="es-tile-context">{screenPurpose}</span> : null}
                    {display.state !== "done" ? <span>{display.label}</span> : null}
                </figcaption>
            ) : null}
        </figure>
    );
}

function GroupCard({
    product,
    group,
    imageModel,
    runner,
    edit,
    onView,
    onReference,
}: {
    product: StudioProduct;
    group: StudioShotGroup;
    imageModel: string;
    runner: StudioRunner;
    edit: Edit;
    onView: (target: StudioViewerTarget) => void;
    onReference: (output: StudioOutput) => void;
}) {
    const { message, modal } = App.useApp();
    const blocked = studioImageSetupBlock(product, imageModel);
    const config = useEffectiveConfig();
    const [exporting, setExporting] = useState<StudioArchiveKind | "long" | "review">();
    const [reading, setReading] = useState(false);
    const [acting, setActing] = useState<string[]>([]);
    const [observation, setObservation] = useState(0);
    const [taskSnapshot, setTaskSnapshot] = useState<{ scope: string; items: Record<string, GenerationTask> }>({ scope: getActiveUserScope(), items: {} });
    const [reviewResult, setReviewResult] = useState<{ signature: string; report: StudioDeliveryReview }>();
    const exportController = useRef<AbortController | undefined>(undefined);
    const scope = getActiveUserScope();
    const signature = JSON.stringify([scope, product.platform, product.sellingPoints, product.dossier, product.style, group]);
    const review = reviewResult?.signature === signature ? reviewResult.report : undefined;
    useEffect(
        () => () => {
            exportController.current?.abort();
        },
        [scope, product.id, group.key],
    );
    const shots = group.shots;
    const taskIds = JSON.stringify([
        ...new Set(
            shots.flatMap((shot) => {
                const attempt = studioShotLatestAttempt(shot);
                return attempt?.taskId ? [attempt.taskId] : [];
            }),
        ),
    ]);
    useEffect(() => subscribeGenerationTasks(JSON.parse(taskIds) as string[], (task) => setTaskSnapshot((current) => ({ scope, items: { ...(current.scope === scope ? current.items : {}), [task.id]: task } }))), [scope, taskIds, observation]);
    const tasks = taskSnapshot.scope === scope ? taskSnapshot.items : {};
    const progress = studioGroupProgress(shots, tasks);
    const done = shots.filter((shot) => studioShotPreview(shot)).length;
    const complete = done > 0 && done === shots.length;
    const active = progress.active;
    const failed = shots.filter((shot) => {
        const latest = studioShotLatestAttempt(shot);
        return !studioShotPreview(shot) && latest && (latest.status === "failed" || latest.status === "cancelled");
    }).length;
    const pending = shots.filter(studioShotPending);
    const ratios = [...new Set(shots.map((shot) => shot.ratio))];
    const model = [...shots.flatMap((shot) => shot.attempts)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.model;
    const platform = ecommercePlatform(product.platform)?.name;
    const isSet = Boolean(group.kind);

    const rerun = async (shotIds: string[], intent: "new" | "resume" = "resume") => {
        if (blocked) return void message.warning(blocked);
        if (acting.length) return;
        setActing(shotIds);
        try {
            const session = captureUserSession();
            const regenerate: string[] = [];
            let recovered = 0;
            let checked = 0;
            for (const shot of shots.filter((item) => shotIds.includes(item.id))) {
                const attempt = studioShotLatestAttempt(shot);
                const task = attempt?.taskId ? await queryGenerationTask(attempt.taskId, { signal: session.signal }) : undefined;
                assertCurrentUserSession(session);
                const display = studioShotDisplay(shot, task);
                if (display.state === "review" || (attempt && studioAttemptNeedsReview(attempt))) {
                    checked += 1;
                    continue;
                }
                if (task && (task.status === "queued" || task.status === "running" || (task.status === "succeeded" && intent === "resume") || (task.status === "failed" && task.canRecoverMedia))) {
                    const next = task.canRecoverMedia && task.status === "failed" ? await recoverGenerationTaskMedia(task.id) : task;
                    assertCurrentUserSession(session);
                    setTaskSnapshot((current) => ({ scope, items: { ...(current.scope === scope ? current.items : {}), [next.id]: next } }));
                    edit(
                        (current) =>
                            patchStudioShotAt(current, group.ref, shot.id, (value) => ({
                                ...value,
                                attempts: value.attempts.map((item) => (item.id === attempt?.id ? { ...item, status: next.status === "succeeded" ? "running" : next.status, error: undefined, completedAt: undefined } : item)),
                            })),
                        { immediate: true },
                    );
                    const current = useStudioStore.getState().products.find((item) => item.id === product.id);
                    if (current) runner.resume(current);
                    recovered += 1;
                } else regenerate.push(shot.id);
            }
            if (regenerate.length) await runner.rerun(product.id, group.ref, regenerate, imageModel);
            if (recovered) setObservation((value) => value + 1);
            if (recovered) message.success(`已接回 ${recovered} 个原任务，不会重新生成`);
            if (checked) message.warning("有原任务费用待核对，未重复提交");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交失败");
        } finally {
            setActing([]);
        }
    };

    const exportSet = async (mode: StudioArchiveKind | "long" | "review") => {
        const plan: StudioPlan = { id: group.key, kind: group.kind || "main", createdAt: group.createdAt, textMode: group.textMode, shots, styleId: group.styleId, tone: group.tone };
        setExporting(mode);
        const controller = new AbortController();
        exportController.current = controller;
        const assertCurrent = () => {
            if (controller.signal.aborted || getActiveUserScope() !== scope) throw new DOMException("导出已停止", "AbortError");
        };
        let composed: Awaited<ReturnType<typeof composeStudioShots>> = [];
        try {
            composed = await composeStudioShots(product, plan, controller.signal);
            if (!composed.length) throw new Error("这一组还没有出好的图");
            const checked = await inspectStudioDelivery(product, shots, composed, group.kind ?? "single", controller.signal);
            assertCurrent();
            setReviewResult({ signature, report: checked });
            if (mode === "review") return;
            const stem = studioDisplayName(product).replace(/[\\/:*?"<>|]+/g, "_");
            if (mode === "long") {
                const longImage = await bindStudioLongImage(product, plan, composed);
                assertCurrent();
                saveAs(longImage.dataUrl, `${stem}-完整原长图.png`);
            } else {
                const zip = await exportStudioZip(product, plan, composed, mode, checked);
                assertCurrent();
                const name = mode === "draft" ? `分屏草稿-${composed.length}of${shots.length}` : mode === "originals" ? "原始分屏" : group.kind === "detail" ? "完整详情包" : "完整商品图";
                saveAs(zip, `${stem}-${name}.zip`);
            }
        } catch (error) {
            if (!controller.signal.aborted && getActiveUserScope() === scope) message.error(error instanceof Error ? error.message : "导出失败，请重试");
        } finally {
            releaseComposed(composed);
            if (exportController.current === controller) exportController.current = undefined;
            setExporting(undefined);
        }
    };

    const remove = () =>
        modal.confirm({
            title: group.fromAgent ? "删除助手排的这套方案？" : "删除这组记录？",
            content: "只从生图台移除，已经生成的图片仍在素材库和任务中心。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () =>
                edit(
                    (current) =>
                        "runId" in group.ref
                            ? { ...current, runs: current.runs.filter((run) => run.id !== (group.ref as { runId: string }).runId) }
                            : {
                                  ...current,
                                  plans: current.plans.filter((plan) => plan.kind !== (group.ref as { planKind: StudioPlanKind }).planKind),
                                  pendingGeneration: current.pendingGeneration?.kind === (group.ref as { planKind: StudioPlanKind }).planKind ? undefined : current.pendingGeneration,
                              },
                    { immediate: true },
                ),
        });

    const downloadAll = () => {
        const plan: StudioPlan = { id: group.key, kind: group.kind || "main", createdAt: group.createdAt, textMode: group.textMode, styleId: group.styleId, tone: group.tone, shots };
        const needsTypeset = shots.some((shot) => {
            const output = studioShotPreview(shot);
            return output && studioOutputNeedsLegacyTypeset(group, shot, output);
        });
        if (needsTypeset) return void downloadStudioComposed(product, plan).catch((error: unknown) => message.error(error instanceof Error ? error.message : "下载失败"));
        const items = shots.flatMap((shot, index) => {
            const preview = studioShotPreview(shot);
            return preview ? [{ output: preview, fileName: downloadName(product, shot, shots.length > 1 ? index + 1 : 0) }] : [];
        });
        if (!items.length) return void message.info("还没有出好的图");
        void downloadOutputs(items).catch((error) => message.error(error instanceof Error ? error.message : "下载失败"));
    };

    const unit = group.kind === "detail" ? "屏" : "张";
    return (
        <article className="es-group">
            <TaskSettlement ids={shots.flatMap((shot) => shot.attempts.flatMap((attempt) => (attempt.taskId ? [attempt.taskId] : [])))} />
            <header className="es-group-head">
                <div className="es-group-title">
                    <strong>{group.title}</strong>
                    <span className="es-group-meta">
                        {[`${shots.length} ${unit}`, ratios.length === 1 ? ratios[0] : "", platform || "", model ? configuredModelDisplayName(config, model) : ""].filter(Boolean).join(" · ")}
                        {" · "}
                        <RelativeTime value={group.createdAt} />
                    </span>
                </div>
                <div className="es-group-actions">
                    {complete && !active && !progress.recover && !progress.review ? <span className="es-group-status">已保存</span> : null}
                    {pending.length || failed ? (
                        <Tooltip title={blocked || undefined}>
                            <Button size="small" loading={Boolean(acting.length)} disabled={Boolean(blocked)} onClick={() => rerun(shots.filter((shot) => !studioShotPreview(shot)).map((shot) => shot.id))}>
                                {progress.recover ? "恢复未完成的" : pending.length && !failed ? `生成 ${pending.length} ${unit}` : "处理未完成的"}
                            </Button>
                        </Tooltip>
                    ) : null}
                    {group.kind === "detail" && done > 0 ? (
                        <Button size="small" aria-pressed={reading} onClick={() => setReading((value) => !value)}>
                            {reading ? "收起整页" : "预览整页"}
                        </Button>
                    ) : null}
                    {isSet ? (
                        <Button size="small" icon={<Download size={13} />} loading={exporting === "complete"} disabled={!complete || Boolean(exporting)} onClick={() => void exportSet("complete")}>
                            下载完整文件包
                        </Button>
                    ) : null}
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "review", label: "文件与文案诊断", disabled: !done || Boolean(exporting) },
                                ...(!isSet ? [{ key: "download", icon: <Download size={14} />, label: "全部下载", disabled: !complete }] : []),
                                ...(group.kind === "detail"
                                    ? [
                                          { key: "long", icon: <Rows3 size={14} />, label: "只下载完整原长图（不切片）", disabled: !complete || Boolean(exporting) },
                                          { key: "originals", label: "下载完整原始分屏（不切片）", disabled: !complete || Boolean(exporting) },
                                      ]
                                    : []),
                                ...(isSet && done > 0 && !complete ? [{ key: "draft", label: `下载已出分屏草稿（${done}/${shots.length}）`, disabled: Boolean(exporting) }] : []),
                                { key: "remove", icon: <Trash2 size={14} />, label: "删除记录", danger: true },
                            ],
                            onClick: ({ key }) => {
                                if (key === "review") void exportSet("review");
                                if (key === "download") downloadAll();
                                if (key === "long") void exportSet("long");
                                if (key === "originals" || key === "draft") void exportSet(key);
                                if (key === "remove") remove();
                            },
                        }}
                    >
                        <button type="button" className="es-icon-btn" aria-label="更多操作">
                            <Ellipsis size={15} />
                        </button>
                    </Dropdown>
                </div>
            </header>
            {(!complete || active > 0 || progress.recover > 0 || progress.review > 0) && shots.length > 1 ? (
                <section className="es-group-progress" aria-label="逐屏生成进度" aria-live="polite">
                    <div className="es-group-progress-head">
                        <strong>
                            已保存 {done} / {progress.total} {unit}
                        </strong>
                        <span>
                            {[
                                progress.active ? `${progress.active} 进行中` : "",
                                progress.pending ? `${progress.pending} 待生成` : "",
                                progress.recover ? `${progress.recover} 待保存` : "",
                                progress.review ? `${progress.review} 待核对` : "",
                                progress.failed ? `${progress.failed} 未生成` : "",
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                    </div>
                    <div className="es-screen-track" aria-label="每屏状态">
                        {progress.screens.map((screen, index) => {
                            const detailTitle = studioDetailResultTitle(group, screen.shot, index);
                            return (
                                <a
                                    key={screen.shot.id}
                                    href={`#studio-shot-${group.key}-${screen.shot.id}`}
                                    data-state={screen.state}
                                    aria-label={`${detailTitle || `第 ${index + 1} ${unit} ${screen.shot.title}`} · ${screen.label}`}
                                    title={`${detailTitle || screen.shot.title} · ${screen.label}`}
                                >
                                    {index + 1}
                                    <span>{screen.label}</span>
                                </a>
                            );
                        })}
                    </div>
                </section>
            ) : null}
            {isSet && done > 0 && !complete ? <p className="es-delivery-note">缺第 {shots.flatMap((shot, index) => (studioShotPreview(shot) ? [] : [index + 1])).join("、")} 张。补齐后可下载完整文件；更多操作可导出分屏草稿。</p> : null}
            {group.kind === "detail" && reading ? (
                <section className="es-delivery-reading" aria-label="消费者整页阅读预览">
                    <strong>{complete ? "整页阅读预览" : `草稿预览 · ${done}/${shots.length} 屏`}</strong>
                    {shots.map((shot, index) => {
                        const output = studioShotPreview(shot);
                        const detailTitle = studioDetailResultTitle(group, shot, index);
                        return output ? (
                            <StudioResultArtwork key={shot.id} product={product} group={group} shot={shot} output={output} title={detailTitle} full />
                        ) : (
                            <div key={shot.id} className="es-delivery-missing">
                                {detailTitle ? `${detailTitle} · 缺图` : `第 ${index + 1} 屏缺图 · ${shot.title}`}
                            </div>
                        );
                    })}
                </section>
            ) : null}
            {review ? (
                <details className="es-delivery-review" open>
                    <summary>
                        文件{review.fileSet === "complete" ? "齐全" : "未齐"} · {review.delivered}/{review.total} 张 · {review.issues.length} 项提醒
                    </summary>
                    <p>检查文件和策划文案，不识别图片里的实字。</p>
                    <ul>
                        {review.issues.map((issue, index) => (
                            <li key={index}>
                                {issue.title}：{issue.message}
                            </li>
                        ))}
                    </ul>
                    <p>{review.manualChecks.join("；")}</p>
                </details>
            ) : null}
            <div className="es-tiles" data-set={isSet || undefined}>
                {shots.map((shot, index) => (
                    <ResultTile
                        key={shot.id}
                        product={product}
                        group={group}
                        shot={shot}
                        caption={isSet ? `${String(index + 1).padStart(2, "0")} ${shot.title}` : undefined}
                        detailTitle={studioDetailResultTitle(group, shot, index)}
                        showContext={group.kind === "detail"}
                        blocked={blocked}
                        task={tasks[studioShotLatestAttempt(shot)?.taskId || ""]}
                        acting={acting.includes(shot.id)}
                        onView={() => onView({ groupKey: group.key, shotId: shot.id })}
                        onDownload={() => {
                            const preview = studioShotPreview(shot);
                            if (preview && studioOutputNeedsLegacyTypeset(group, shot, preview))
                                return void downloadStudioComposed(product, { id: group.key, kind: group.kind || "main", createdAt: group.createdAt, textMode: group.textMode, styleId: group.styleId, tone: group.tone, shots: [shot] }).catch(
                                    (error: unknown) => message.error(error instanceof Error ? error.message : "下载失败"),
                                );
                            if (preview) void downloadOutputs([{ output: preview, fileName: downloadName(product, shot, 0) }]).catch((error) => message.error(error instanceof Error ? error.message : "下载失败"));
                        }}
                        onReference={() => {
                            const preview = studioShotPreview(shot);
                            if (preview) onReference(preview);
                        }}
                        onRerun={() => rerun([shot.id], studioShotPreview(shot) ? "new" : "resume")}
                        onSync={() => runner.resume(product)}
                    />
                ))}
            </div>
        </article>
    );
}

/** 助手排好页面后交来的出图请求；生成是一次明确的计费动作，页面设计本身不需要额外审批。 */
function AgentRequestCard({ product, blocked, onConfirm, onDismiss }: { product: StudioProduct; blocked: string; onConfirm: (shotIds: string[]) => void; onDismiss: () => void }) {
    const request = product.pendingGeneration!;
    const shots = (studioPlanOf(product, request.kind)?.shots || []).filter((shot) => request.shotIds.includes(shot.id));
    const runnable = shots.filter((shot) => !shot.attempts.some(studioAttemptActive));
    return (
        <section className="es-request" aria-label="助手的出图请求">
            <div className="es-request-text">
                <strong>
                    页面设计已准备好 · 生成 {runnable.length} 张{STUDIO_PLAN_META[request.kind].title}
                </strong>
                <span>{request.note || (shots.length ? shots.map((shot) => shot.title).join("、") : "这些页面已不在方案里，可以忽略这条请求。")}</span>
            </div>
            <div className="es-request-actions">
                <Button onClick={onDismiss}>暂不生成</Button>
                <Tooltip title={blocked || "用左侧选中的图片模型逐张提交，按模型计费"}>
                    <Button type="primary" disabled={!runnable.length || Boolean(blocked)} onClick={() => onConfirm(runnable.map((shot) => shot.id))}>
                        生成 {runnable.length} 张
                    </Button>
                </Tooltip>
            </div>
        </section>
    );
}

export function StudioResults({
    product,
    edit,
    runner,
    imageModel,
    onView,
    onReference,
}: {
    product: StudioProduct;
    edit: Edit;
    runner: StudioRunner;
    imageModel: string;
    onView: (target: StudioViewerTarget) => void;
    onReference: (output: StudioOutput) => void;
}) {
    const { message } = App.useApp();
    const groups = studioShotGroups(product);
    const total = groups.reduce((sum, group) => sum + group.shots.reduce((count, shot) => count + studioShotOutputs(shot).length, 0), 0);
    const request = product.pendingGeneration;
    // 只清掉这一条请求：确认期间助手可能又交来一条新的。
    const clearRequest = (id: string) => edit((current) => ({ ...current, pendingGeneration: current.pendingGeneration?.id === id ? undefined : current.pendingGeneration }), { immediate: true });
    return (
        <section className="es-results" aria-label="生成记录">
            <header className="es-workspace-head">
                <h2>生成记录</h2>
                {total ? <span>{total} 张</span> : null}
            </header>
            <div className="es-results-scroll">
                {request ? (
                    <AgentRequestCard
                        product={product}
                        blocked={studioImageSetupBlock(product, imageModel)}
                        onDismiss={() => clearRequest(request.id)}
                        onConfirm={async (shotIds) => {
                            try {
                                await runner.rerun(product.id, { planKind: request.kind }, shotIds, imageModel);
                                clearRequest(request.id);
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "提交失败");
                            }
                        }}
                    />
                ) : null}
                {groups.map((group) => (
                    <GroupCard key={group.key} product={group.source ? { ...product, ...group.source } : product} group={group} imageModel={imageModel} runner={runner} edit={edit} onView={onView} onReference={onReference} />
                ))}
                {!groups.length && !request ? (
                    <div className="es-empty">
                        <strong>还没有生成记录</strong>
                        <span>从页面设计提交出图后，这里会显示各张的进度、候选和交付检查。</span>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
