import { App, Button, Spin } from "antd";
import { Check, ChevronLeft, ChevronRight, Download, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { locateStudioShot, studioImageSetupBlock } from "@/lib/ecommerce-studio/generation-input";
import { studioAttemptActive, studioShotLatestAttempt, studioShotOutputs, studioShotPreview } from "@/lib/ecommerce-studio/product";
import type { StudioOutput, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { studioImageUrl } from "./studio-parts";
import { studioDetailResultTitle, type StudioShotGroup, type StudioViewerTarget } from "./studio-results";
import { StudioShotTuner, type StudioShotPatch } from "./studio-shot-tuner";
import { StudioViewerStage } from "./studio-viewer-stage";
import { composeStudioShots, downloadStudioComposed, releaseComposed, studioOutputNeedsLegacyTypeset } from "./studio-delivery";
import { studioShotHasCopy } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioShotSpec } from "@/lib/ecommerce-studio/shot-specs";
import { StudioArtworkCheck } from "./studio-design-check";
import type { StudioDesignCheck } from "@/lib/ecommerce-studio/design-check";

/** 大图查看：←/→ 在这一组出过图的页面之间切换，图片可以点击、滚轮放大；套图里有多张候选时可以挑一张作为导出用图；右侧可以调整这一张再出。 */
export function StudioViewer({
    product,
    groups,
    target,
    imageModel,
    onChange,
    onClose,
    onDownload,
    onReference,
    onTune,
    onApplyCopy,
    onAdopt,
    onReview,
}: {
    product?: StudioProduct;
    groups: StudioShotGroup[];
    target?: StudioViewerTarget;
    imageModel: string;
    onChange: (target: StudioViewerTarget) => void;
    onClose: () => void;
    onDownload: (shot: StudioShot, output: StudioOutput) => void;
    onReference: (output: StudioOutput) => void;
    onTune: (group: StudioShotGroup, shot: StudioShot, patch: StudioShotPatch, revisionResourceId?: string) => void;
    onApplyCopy: (group: StudioShotGroup, shot: StudioShot, patch: StudioShotPatch) => void;
    onAdopt: (group: StudioShotGroup, shot: StudioShot, output: StudioOutput) => void;
    onReview: (group: StudioShotGroup, shot: StudioShot, output: StudioOutput, result: StudioDesignCheck) => void;
}) {
    const { message } = App.useApp();
    const [composedPreview, setComposedPreview] = useState<{ key: string; url?: string; error?: string }>();
    const [reviewRevision, setReviewRevision] = useState<{ key: string; value: string }>();
    const group = groups.find((item) => item.key === target?.groupKey);
    const viewable = group ? group.shots.filter((shot) => Boolean(studioShotPreview(shot))) : [];
    const position = viewable.findIndex((shot) => shot.id === target?.shotId);
    const shot = position >= 0 ? viewable[position] : undefined;
    const located = product && group && shot ? locateStudioShot(product, group.ref, shot.id) : undefined;
    const source = product && group?.source ? { ...product, ...group.source } : product;
    const detailTitle = group && shot ? studioDetailResultTitle(group, shot, group.shots.indexOf(shot)) : undefined;
    const outputs = shot ? studioShotOutputs(shot) : [];
    const current = shot ? outputs.find((output) => output.resourceId === target?.resourceId) || studioShotPreview(shot) : undefined;
    const latest = shot ? studioShotLatestAttempt(shot) : undefined;
    const active = Boolean(latest && studioAttemptActive(latest));
    const adopted = Boolean(shot?.adopted && current && shot.adopted.resourceId === current.resourceId);
    const overlay = Boolean(group && shot && source && current && studioShotHasCopy(shot, studioShotSpec(shot.role, source.dossier?.family || "generic")) && studioOutputNeedsLegacyTypeset(group, shot, current));
    const previewKey = JSON.stringify([source?.id, source?.style, group?.key, group?.styleId, group?.tone, shot?.role, shot?.layout, shot?.composition, shot?.headline, shot?.subline, shot?.lines, shot?.eyebrow, current?.resourceId, overlay]);
    useEffect(() => {
        if (!overlay || !group || !shot || !current || !source) return;
        const controller = new AbortController();
        let images: Awaited<ReturnType<typeof composeStudioShots>> = [];
        const plan = { id: group.key, kind: group.kind || ("main" as const), createdAt: group.createdAt, textMode: group.textMode, styleId: group.styleId, tone: group.tone, shots: [{ ...shot, adopted: current }] };
        void composeStudioShots(source, plan, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) {
                    releaseComposed(result);
                    return;
                }
                images = result;
                setComposedPreview({ key: previewKey, url: result[0]?.url });
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setComposedPreview({ key: previewKey, error: error instanceof Error ? error.message : "成品预览失败" });
            });
        return () => {
            controller.abort();
            releaseComposed(images);
        };
    }, [previewKey]);

    const move = useCallback(
        (delta: number) => {
            if (!group || viewable.length < 2) return;
            onChange({ groupKey: group.key, shotId: viewable[(position + delta + viewable.length) % viewable.length].id });
        },
        [group, onChange, position, viewable],
    );

    useEffect(() => {
        if (!shot) return;
        const onKey = (event: KeyboardEvent) => {
            const element = event.target as HTMLElement | null;
            if (element?.closest("input, textarea, [contenteditable='true']") || event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                move(event.key === "ArrowLeft" ? -1 : 1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [move, shot]);

    return (
        <AppModal open={Boolean(group && shot && current)} onCancel={onClose} footer={null} width={1120} centered flush rootClassName="es-portal" title={null}>
            {group && shot && current ? (
                <div className="es-viewer">
                    {overlay ? (
                        composedPreview?.key === previewKey && composedPreview.url ? (
                            <StudioViewerStage key={previewKey} src={composedPreview.url} alt={`${detailTitle || shot.title} · 成品预览`} />
                        ) : composedPreview?.key === previewKey && composedPreview.error ? (
                            <p role="alert">{composedPreview.error}</p>
                        ) : (
                            <Spin tip="正在准备预览…">
                                <div className="es-viewer-stage" />
                            </Spin>
                        )
                    ) : (
                        <StudioViewerStage key={current.resourceId} src={studioImageUrl(current.resourceId)} alt={detailTitle || shot.title} />
                    )}
                    <aside className="es-viewer-side" data-detail-title={detailTitle ? true : undefined}>
                        {!detailTitle ? (
                            <span className="es-viewer-count">
                                {group.title} · 第 {position + 1}/{viewable.length} 张
                            </span>
                        ) : null}
                        <h3>{detailTitle || shot.title}</h3>
                        <span className="es-viewer-meta">{shot.ratio}</span>
                        {outputs.length > 1 ? (
                            <div className="es-candidates" role="group" aria-label="这张图的所有结果">
                                {outputs.map((output, index) => (
                                    <button
                                        key={output.resourceId}
                                        type="button"
                                        className="es-candidate"
                                        aria-pressed={output.resourceId === current.resourceId}
                                        aria-label={`第 ${index + 1} 张结果`}
                                        onClick={() => onChange({ groupKey: group.key, shotId: shot.id, resourceId: output.resourceId })}
                                    >
                                        <img src={studioImageUrl(output.resourceId, true)} alt="" />
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <div className="es-viewer-actions">
                            {group.kind && outputs.length > 1 ? (
                                <Button type={adopted ? "default" : "primary"} icon={<Check size={14} />} disabled={adopted} onClick={() => onAdopt(group, shot, current)}>
                                    {adopted ? "已选为导出用图" : "导出时用这张"}
                                </Button>
                            ) : null}
                            <Button
                                icon={<Download size={14} />}
                                onClick={() => {
                                    if (!overlay || !source) return onDownload(shot, current);
                                    void downloadStudioComposed(source, {
                                        id: group.key,
                                        kind: group.kind || "main",
                                        createdAt: group.createdAt,
                                        textMode: group.textMode,
                                        styleId: group.styleId,
                                        tone: group.tone,
                                        shots: [{ ...shot, adopted: current }],
                                    }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "下载失败"));
                                }}
                            >
                                {overlay ? "下载成品" : "下载原图"}
                            </Button>
                            <Button icon={<ImagePlus size={14} />} onClick={() => onReference(current)}>
                                用作参考图
                            </Button>
                        </div>
                        {source && !overlay ? <StudioArtworkCheck product={source} shot={shot} output={current} onRevision={(value) => setReviewRevision({ key: previewKey, value })} onReview={(result) => onReview(group, shot, current, result)} /> : null}
                        {product && source && located ? (
                            <StudioShotTuner
                                key={`${shot.id}:${current.resourceId}:${shot.headline}:${shot.subline}`}
                                product={product}
                                located={located}
                                imageModel={imageModel}
                                blocked={studioImageSetupBlock(source, imageModel)}
                                active={active}
                                reviewRevision={reviewRevision?.key === previewKey ? reviewRevision.value : undefined}
                                revisionResourceId={overlay ? undefined : current.resourceId}
                                onRun={(patch) =>
                                    onTune(
                                        group,
                                        shot,
                                        patch,
                                        !overlay && (patch.adjust || patch.tweaks.length || patch.headline !== shot.headline || patch.subline !== shot.subline || JSON.stringify(patch.lines) !== JSON.stringify(shot.lines)) ? current.resourceId : undefined,
                                    )
                                }
                                onApplyCopy={overlay ? (patch) => onApplyCopy(group, shot, patch) : undefined}
                            />
                        ) : null}
                        <div className="es-viewer-nav">
                            <Button block icon={<ChevronLeft size={14} />} disabled={viewable.length < 2} onClick={() => move(-1)}>
                                上一张
                            </Button>
                            <Button block icon={<ChevronRight size={14} />} iconPlacement="end" disabled={viewable.length < 2} onClick={() => move(1)}>
                                下一张
                            </Button>
                        </div>
                    </aside>
                </div>
            ) : null}
        </AppModal>
    );
}
