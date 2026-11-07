import { App, Button, Spin } from "antd";
import { Check, ChevronLeft, ChevronRight, Download, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { studioAttemptActive, studioShotLatestAttempt, studioShotOutputs, studioShotPreview } from "@/lib/ecommerce-studio/product";
import type { StudioOutput, StudioProduct, StudioShot } from "@/lib/ecommerce-studio/types";
import { studioImageUrl } from "./studio-parts";
import type { StudioShotGroup, StudioViewerTarget } from "./studio-results";
import { StudioShotTuner, type StudioShotPatch } from "./studio-shot-tuner";
import { StudioViewerStage } from "./studio-viewer-stage";
import { composeStudioShots, downloadStudioComposed, releaseComposed } from "./studio-delivery";
import { studioEffectiveTextMode, studioModelAdapter, studioShotHasCopy } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioShotSpec } from "@/lib/ecommerce-studio/shot-specs";

/** 大图查看：←/→ 在这一组出过图的镜头之间切换，图片可以点击、滚轮放大；套图里有多张候选时可以挑一张作为导出用图；右侧可以调整这一张再出。 */
export function StudioViewer({
    product,
    groups,
    target,
    blocked,
    imageModel,
    onChange,
    onClose,
    onDownload,
    onReference,
    onTune,
    onApplyCopy,
    onAdopt,
}: {
    product?: StudioProduct;
    groups: StudioShotGroup[];
    target?: StudioViewerTarget;
    blocked: string;
    imageModel: string;
    onChange: (target: StudioViewerTarget) => void;
    onClose: () => void;
    onDownload: (shot: StudioShot, output: StudioOutput) => void;
    onReference: (output: StudioOutput) => void;
    onTune: (group: StudioShotGroup, shot: StudioShot, patch: StudioShotPatch) => void;
    onApplyCopy: (group: StudioShotGroup, shot: StudioShot, patch: StudioShotPatch) => void;
    onAdopt: (group: StudioShotGroup, shot: StudioShot, output: StudioOutput) => void;
}) {
    const { message } = App.useApp();
    const [composedPreview, setComposedPreview] = useState<{ key: string; url?: string; error?: string }>();
    const group = groups.find((item) => item.key === target?.groupKey);
    const viewable = group ? group.shots.filter((shot) => Boolean(studioShotPreview(shot))) : [];
    const position = viewable.findIndex((shot) => shot.id === target?.shotId);
    const shot = position >= 0 ? viewable[position] : undefined;
    const outputs = shot ? studioShotOutputs(shot) : [];
    const current = shot ? outputs.find((output) => output.resourceId === target?.resourceId) || studioShotPreview(shot) : undefined;
    const latest = shot ? studioShotLatestAttempt(shot) : undefined;
    const active = Boolean(latest && studioAttemptActive(latest));
    const adopted = Boolean(shot?.adopted && current && shot.adopted.resourceId === current.resourceId);
    const sourceModel = shot?.attempts.find((attempt) => attempt.outputs.some((output) => output.resourceId === current?.resourceId))?.model || "";
    const overlay = Boolean(group && shot && product && studioShotHasCopy(shot, studioShotSpec(shot.role, product.dossier?.family || "generic")) && studioEffectiveTextMode(group, studioModelAdapter(sourceModel)).mode === "overlay");
    const previewKey = JSON.stringify([product?.id, product?.style, group?.key, group?.styleId, group?.tone, shot?.role, shot?.layout, shot?.composition, shot?.headline, shot?.subline, shot?.lines, shot?.eyebrow, current?.resourceId, overlay]);
    useEffect(() => {
        if (!overlay || !group || !shot || !current || !product) return;
        const controller = new AbortController();
        let images: Awaited<ReturnType<typeof composeStudioShots>> = [];
        const plan = { id: group.key, kind: group.kind || ("main" as const), createdAt: group.createdAt, textMode: group.textMode, styleId: group.styleId, tone: group.tone, shots: [{ ...shot, adopted: current }] };
        void composeStudioShots(product, plan, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) {
                    releaseComposed(result);
                    return;
                }
                images = result;
                setComposedPreview({ key: previewKey, url: result[0]?.url });
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setComposedPreview({ key: previewKey, error: error instanceof Error ? error.message : "排版预览失败" });
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
                            <StudioViewerStage key={previewKey} src={composedPreview.url} alt={`${shot.title} · 程序排版成品`} />
                        ) : composedPreview?.key === previewKey && composedPreview.error ? (
                            <p role="alert">{composedPreview.error}</p>
                        ) : (
                            <Spin tip="正在排版…">
                                <div className="es-viewer-stage" />
                            </Spin>
                        )
                    ) : (
                        <StudioViewerStage key={current.resourceId} src={studioImageUrl(current.resourceId)} alt={shot.title} />
                    )}
                    <aside className="es-viewer-side">
                        <span className="es-viewer-count">
                            {group.title} · 第 {position + 1}/{viewable.length} 张
                        </span>
                        <h3>{shot.title}</h3>
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
                                    if (!overlay || !product) return onDownload(shot, current);
                                    void downloadStudioComposed(product, {
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
                                {overlay ? "下载排版成品" : "下载原图"}
                            </Button>
                            <Button icon={<ImagePlus size={14} />} onClick={() => onReference(current)}>
                                用作参考图
                            </Button>
                        </div>
                        {product ? (
                            <StudioShotTuner
                                key={`${shot.id}:${shot.headline}:${shot.subline}`}
                                product={product}
                                shotRef={group.ref}
                                shot={shot}
                                imageModel={imageModel}
                                blocked={blocked}
                                active={active}
                                onRun={(patch) => onTune(group, shot, patch)}
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
