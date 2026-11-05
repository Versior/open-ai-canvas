import { App, Button, Dropdown, Spin, Tooltip } from "antd";
import { saveAs } from "file-saver";
import { Download, Ellipsis, ImageOff, ImagePlus, Maximize2, RefreshCw, Rows3, Trash2 } from "lucide-react";
import { useState } from "react";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { ecommercePlatform } from "@/lib/ecommerce/ecommerce-platform-specs";
import { studioDisplayName, studioOutputSpec } from "@/lib/ecommerce-studio/brief";
import { studioAttemptActive, studioPlanOf, studioShotLatestAttempt, studioShotOutputs, studioShotPreview } from "@/lib/ecommerce-studio/product";
import { STUDIO_PLAN_META } from "@/lib/ecommerce-studio/shot-specs";
import type { StudioAttemptStatus, StudioOutput, StudioPlan, StudioPlanKind, StudioProduct, StudioShot, StudioTextMode } from "@/lib/ecommerce-studio/types";
import { configuredModelDisplayName } from "@/lib/model-selection";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resourceStorageKey } from "@/services/api/resources";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { bindStudioDetailPage, composeStudioShots, exportStudioZip, releaseComposed } from "./studio-delivery";
import { ratioStyle, studioImageUrl } from "./studio-parts";
import { studioShotPending, type StudioRunner, type StudioShotRef } from "./use-studio-runner";

type Edit = (updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => void;

/** 结果区里的一组图：表单生成的记录或助手排的方案，界面上按同一种卡片展示。 */
export type StudioShotGroup = { key: string; ref: StudioShotRef; title: string; createdAt: string; kind?: StudioPlanKind; textMode: StudioTextMode; shots: StudioShot[]; fromAgent: boolean };

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
        fromAgent: true,
    }));
    const runs = product.runs.map((run) => ({
        key: `run:${run.id}`,
        ref: { runId: run.id },
        title: run.suite ? `${studioOutputSpec(run.type).label} · ${run.suite.name}` : studioOutputSpec(run.type).label,
        createdAt: run.createdAt,
        kind: run.kind,
        textMode: run.textMode,
        shots: run.shots,
        fromAgent: false,
    }));
    return [...plans, ...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

function ResultTile({ shot, caption, blocked, onView, onDownload, onReference, onRerun }: { shot: StudioShot; caption?: string; blocked: string; onView: () => void; onDownload: () => void; onReference: () => void; onRerun: () => void }) {
    const latest = studioShotLatestAttempt(shot);
    const preview = studioShotPreview(shot);
    const active = Boolean(latest && studioAttemptActive(latest));
    const failed = latest && (latest.status === "failed" || latest.status === "cancelled") && !active;
    const status = latest?.status || "idle";
    return (
        <figure className="es-tile-wrap">
            {/* 出好的图按实际宽高显示：模型给的比例和要求的不一样时也不裁掉。 */}
            <div className="es-tile" style={ratioStyle(preview?.width && preview.height ? `${preview.width}:${preview.height}` : shot.ratio)} data-state={preview ? "done" : active ? "active" : failed ? "failed" : "idle"}>
                {preview ? (
                    <button type="button" className="es-tile-image" onClick={onView} aria-label={`查看${shot.title}`}>
                        <img src={studioImageUrl(preview.resourceId, true)} alt={shot.title} loading="lazy" />
                    </button>
                ) : null}
                {!preview && active ? (
                    <div className="es-tile-state">
                        <Spin size="small" />
                        <span>{STATUS_LABEL[status]}</span>
                    </div>
                ) : null}
                {!preview && !active && failed ? (
                    <div className="es-tile-state" data-tone="error">
                        <ImageOff size={18} strokeWidth={1.5} aria-hidden />
                        <span className="es-tile-error" title={latest?.error}>
                            {latest?.error || STATUS_LABEL[status]}
                        </span>
                        <Tooltip title={blocked || undefined}>
                            <Button size="small" disabled={Boolean(blocked)} onClick={onRerun}>
                                重试
                            </Button>
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
                {preview && active ? (
                    <span className="es-tile-badge">
                        <Spin size="small" /> {STATUS_LABEL[status]}
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
                            <button type="button" className="es-media-btn" aria-label="再出一张" disabled={Boolean(blocked) || active} onClick={onRerun}>
                                <RefreshCw size={14} />
                            </button>
                        </Tooltip>
                    </div>
                ) : null}
            </div>
            {caption ? <figcaption className="es-tile-caption">{caption}</figcaption> : null}
        </figure>
    );
}

function GroupCard({
    product,
    group,
    blocked,
    imageModel,
    runner,
    edit,
    onView,
    onReference,
}: {
    product: StudioProduct;
    group: StudioShotGroup;
    blocked: string;
    imageModel: string;
    runner: StudioRunner;
    edit: Edit;
    onView: (target: StudioViewerTarget) => void;
    onReference: (output: StudioOutput) => void;
}) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const [exporting, setExporting] = useState<"zip" | "long">();
    const shots = group.shots;
    const done = shots.filter((shot) => studioShotPreview(shot)).length;
    const active = shots.filter((shot) => shot.attempts.some(studioAttemptActive)).length;
    const failed = shots.filter((shot) => {
        const latest = studioShotLatestAttempt(shot);
        return !studioShotPreview(shot) && latest && (latest.status === "failed" || latest.status === "cancelled");
    }).length;
    const pending = shots.filter(studioShotPending);
    const ratios = [...new Set(shots.map((shot) => shot.ratio))];
    const model = [...shots.flatMap((shot) => shot.attempts)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.model;
    const platform = ecommercePlatform(product.platform)?.name;
    const isSet = Boolean(group.kind);

    const rerun = (shotIds: string[]) => {
        if (blocked) return void message.warning(blocked);
        try {
            const count = runner.rerun(product.id, group.ref, shotIds, imageModel);
            if (!count) message.info("这些图正在生成，等它们完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交失败");
        }
    };

    const exportSet = async (mode: "zip" | "long") => {
        if (!group.kind) return;
        const plan: StudioPlan = { id: group.key, kind: group.kind, createdAt: group.createdAt, textMode: group.textMode, shots };
        setExporting(mode);
        let composed: Awaited<ReturnType<typeof composeStudioShots>> = [];
        try {
            composed = await composeStudioShots(product, plan);
            if (!composed.length) throw new Error("这一组还没有出好的图");
            const stem = studioDisplayName(product).replace(/[\\/:*?"<>|]+/g, "_");
            if (mode === "long") {
                const detail = await bindStudioDetailPage(product, composed);
                saveAs(detail.longImage.dataUrl, `${stem}-详情长图.png`);
            } else {
                const detail = group.kind === "detail" ? await bindStudioDetailPage(product, composed) : undefined;
                saveAs(await exportStudioZip(product, plan, composed, detail), `${stem}-${group.kind === "detail" ? "详情页" : "主图"}.zip`);
            }
            if (composed.length < shots.length) message.info(`还有 ${shots.length - composed.length} 张没出好，导出时跳过了`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败，请重试");
        } finally {
            releaseComposed(composed);
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
        const items = shots.flatMap((shot, index) => {
            const preview = studioShotPreview(shot);
            return preview ? [{ output: preview, fileName: downloadName(product, shot, shots.length > 1 ? index + 1 : 0) }] : [];
        });
        if (!items.length) return void message.info("还没有出好的图");
        void downloadOutputs(items).catch((error) => message.error(error instanceof Error ? error.message : "下载失败"));
    };

    const status = active ? `进行中 ${active}` : failed ? `${failed} 张失败` : done === shots.length ? "已完成" : `已出 ${done}/${shots.length}`;
    return (
        <article className="es-group">
            <header className="es-group-head">
                <div className="es-group-title">
                    <strong>{group.title}</strong>
                    <span className="es-group-meta">
                        {[`${shots.length} ${group.kind === "detail" ? "屏" : "张"}`, ratios.length === 1 ? ratios[0] : "", platform || "", model ? configuredModelDisplayName(config, model) : ""].filter(Boolean).join(" · ")}
                        {" · "}
                        <RelativeTime value={group.createdAt} />
                    </span>
                </div>
                <div className="es-group-actions">
                    <span className="es-group-status" data-tone={failed && !active ? "warning" : undefined}>
                        {status}
                    </span>
                    {pending.length || failed ? (
                        <Tooltip title={blocked || undefined}>
                            <Button size="small" disabled={Boolean(blocked)} onClick={() => rerun(shots.filter((shot) => !studioShotPreview(shot)).map((shot) => shot.id))}>
                                {pending.length && !failed ? `生成 ${pending.length} 张` : "重试失败的"}
                            </Button>
                        </Tooltip>
                    ) : null}
                    {isSet ? (
                        <Button size="small" icon={<Download size={13} />} loading={exporting === "zip"} disabled={!done || Boolean(exporting)} onClick={() => void exportSet("zip")}>
                            下载整套
                        </Button>
                    ) : null}
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                ...(!isSet ? [{ key: "download", icon: <Download size={14} />, label: "全部下载", disabled: !done }] : []),
                                ...(group.kind === "detail" ? [{ key: "long", icon: <Rows3 size={14} />, label: "只下载详情长图", disabled: !done || Boolean(exporting) }] : []),
                                { key: "remove", icon: <Trash2 size={14} />, label: "删除记录", danger: true },
                            ],
                            onClick: ({ key }) => {
                                if (key === "download") downloadAll();
                                if (key === "long") void exportSet("long");
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
            <div className="es-tiles" data-set={isSet || undefined}>
                {shots.map((shot, index) => (
                    <ResultTile
                        key={shot.id}
                        shot={shot}
                        caption={isSet ? `${String(index + 1).padStart(2, "0")} ${shot.title}` : undefined}
                        blocked={blocked}
                        onView={() => onView({ groupKey: group.key, shotId: shot.id })}
                        onDownload={() => {
                            const preview = studioShotPreview(shot);
                            if (preview) void downloadOutputs([{ output: preview, fileName: downloadName(product, shot, 0) }]).catch((error) => message.error(error instanceof Error ? error.message : "下载失败"));
                        }}
                        onReference={() => {
                            const preview = studioShotPreview(shot);
                            if (preview) onReference(preview);
                        }}
                        onRerun={() => rerun([shot.id])}
                    />
                ))}
            </div>
        </article>
    );
}

/** 助手排好镜头后交来的出图请求：这里就是审批单，用户点确认才提交任务。 */
function AgentRequestCard({ product, blocked, onConfirm, onDismiss }: { product: StudioProduct; blocked: string; onConfirm: (shotIds: string[]) => void; onDismiss: () => void }) {
    const request = product.pendingGeneration!;
    const shots = (studioPlanOf(product, request.kind)?.shots || []).filter((shot) => request.shotIds.includes(shot.id));
    const runnable = shots.filter((shot) => !shot.attempts.some(studioAttemptActive));
    return (
        <section className="es-request" aria-label="助手的出图请求">
            <div className="es-request-text">
                <strong>
                    助手排好了{STUDIO_PLAN_META[request.kind].title}，请你确认出图 {runnable.length} 张
                </strong>
                <span>{request.note || (shots.length ? shots.map((shot) => shot.title).join("、") : "这些镜头已不在方案里，可以忽略这条请求。")}</span>
            </div>
            <div className="es-request-actions">
                <Button onClick={onDismiss}>暂不生成</Button>
                <Tooltip title={blocked || "用左侧选中的图片模型逐张提交，按模型计费"}>
                    <Button type="primary" disabled={!runnable.length || Boolean(blocked)} onClick={() => onConfirm(runnable.map((shot) => shot.id))}>
                        确认生成 {runnable.length} 张
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
    blocked,
    onView,
    onReference,
}: {
    product: StudioProduct;
    edit: Edit;
    runner: StudioRunner;
    imageModel: string;
    blocked: string;
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
            <header className="es-results-head">
                <h2>生成记录</h2>
                {total ? <span>{total} 张</span> : null}
            </header>
            <div className="es-results-scroll">
                {request ? (
                    <AgentRequestCard
                        product={product}
                        blocked={blocked}
                        onDismiss={() => clearRequest(request.id)}
                        onConfirm={(shotIds) => {
                            clearRequest(request.id);
                            try {
                                runner.rerun(product.id, { planKind: request.kind }, shotIds, imageModel);
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "提交失败");
                            }
                        }}
                    />
                ) : null}
                {groups.map((group) => (
                    <GroupCard key={group.key} product={product} group={group} blocked={blocked} imageModel={imageModel} runner={runner} edit={edit} onView={onView} onReference={onReference} />
                ))}
                {!groups.length && !request ? (
                    <div className="es-empty">
                        <strong>还没有生成记录</strong>
                        <span>上传商品图、填好信息后点「生成商品图」，出好的图会按组出现在这里。</span>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
