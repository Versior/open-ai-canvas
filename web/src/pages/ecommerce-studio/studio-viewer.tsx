import { Button } from "antd";
import { Check, ChevronLeft, ChevronRight, Download, ImagePlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { studioAttemptActive, studioShotLatestAttempt, studioShotOutputs, studioShotPreview } from "@/lib/ecommerce-studio/product";
import type { StudioOutput, StudioShot } from "@/lib/ecommerce-studio/types";
import { studioImageUrl } from "./studio-parts";
import type { StudioShotGroup, StudioViewerTarget } from "./studio-results";

/** 大图查看：←/→ 在这一组出过图的镜头之间切换；套图里有多张候选时可以挑一张作为导出用图。 */
export function StudioViewer({
    groups,
    target,
    blocked,
    onChange,
    onClose,
    onDownload,
    onReference,
    onRerun,
    onAdopt,
}: {
    groups: StudioShotGroup[];
    target?: StudioViewerTarget;
    blocked: string;
    onChange: (target: StudioViewerTarget) => void;
    onClose: () => void;
    onDownload: (shot: StudioShot, output: StudioOutput) => void;
    onReference: (output: StudioOutput) => void;
    onRerun: (group: StudioShotGroup, shot: StudioShot) => void;
    onAdopt: (group: StudioShotGroup, shot: StudioShot, output: StudioOutput) => void;
}) {
    const group = groups.find((item) => item.key === target?.groupKey);
    const viewable = group ? group.shots.filter((shot) => Boolean(studioShotPreview(shot))) : [];
    const position = viewable.findIndex((shot) => shot.id === target?.shotId);
    const shot = position >= 0 ? viewable[position] : undefined;
    const outputs = shot ? studioShotOutputs(shot) : [];
    const current = shot ? outputs.find((output) => output.resourceId === target?.resourceId) || studioShotPreview(shot) : undefined;
    const latest = shot ? studioShotLatestAttempt(shot) : undefined;
    const active = Boolean(latest && studioAttemptActive(latest));
    const adopted = Boolean(shot?.adopted && current && shot.adopted.resourceId === current.resourceId);

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
                    <div className="es-viewer-stage">
                        <img key={current.resourceId} src={studioImageUrl(current.resourceId)} alt={shot.title} />
                    </div>
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
                            <Button icon={<Download size={14} />} onClick={() => onDownload(shot, current)}>
                                下载原图
                            </Button>
                            <Button icon={<ImagePlus size={14} />} onClick={() => onReference(current)}>
                                用作参考图
                            </Button>
                            <Button icon={<RefreshCw size={14} />} disabled={Boolean(blocked) || active} title={blocked || undefined} onClick={() => onRerun(group, shot)}>
                                {active ? "正在出新的一张…" : "再出一张"}
                            </Button>
                        </div>
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
