import { ArrowUpRight, Box, Image, Layers, PaintRoller, Ruler } from "lucide-react";
import type { InteriorCatalog, InteriorMode, InteriorSurface } from "@/services/api/interior";
import { resourceFileUrl } from "@/services/api/resources";

export type InteriorWorkspace = "images" | "scene" | "materials";

export function availableInteriorTasks(catalog: InteriorCatalog, surface: InteriorSurface) {
    return catalog.modes.filter((mode) => mode.enabled && (catalog.settings.allowSurfaceSwitch || mode.audience === "both" || mode.audience === surface));
}

export function InteriorNavigator({
    catalog,
    surface,
    workspace,
    modeId,
    disabled,
    rounds,
    hasMaterial,
    sourceReady,
    outputs,
    sceneReady,
    onWorkspace,
    onMode,
}: {
    catalog: InteriorCatalog;
    surface: InteriorSurface;
    workspace: InteriorWorkspace;
    modeId: string;
    disabled: boolean;
    rounds: number;
    hasMaterial: boolean;
    sourceReady: boolean;
    outputs: number;
    sceneReady: boolean;
    onWorkspace: (workspace: InteriorWorkspace) => void;
    onMode: (mode: InteriorMode) => void;
}) {
    return (
        <div className="itd-navigator" data-compact={workspace === "scene" || undefined}>
            <div className="itd-navigator-title">
                <div>
                    <span>SPACE DESIGN STUDIO</span>
                    <h1>把空间方案，做得更具体</h1>
                    <p>从房间照片到风格比选，再到三维布局、选材排板和预算交付。</p>
                </div>
                <span className="itd-project-progress">
                    {rounds} 轮效果图 · {hasMaterial ? "已有材料方案" : "尚未建立材料方案"}
                </span>
            </div>
            <ol className="itd-workflow-status" aria-label="项目准备与交付状态">
                {[
                    { ready: sourceReady, title: "空间输入", text: sourceReady ? "原图已准备" : "效果图需上传空间原图", workspace: "images" as const },
                    { ready: outputs > 0, title: "方案比选", text: outputs ? `${outputs} 张可核对的效果图` : "选风格，生成并对比方案", workspace: "images" as const },
                    { ready: sceneReady, title: "三维布局", text: sceneReady ? "已有三维场景" : "输入尺寸，检查家具与动线", workspace: "scene" as const },
                    { ready: hasMaterial, title: "材料交付", text: hasMaterial ? "可编辑排板与预算" : "建立选材与排板方案", workspace: "materials" as const },
                ].map((step, index) => (
                    <li key={step.title} data-ready={step.ready}>
                        <button type="button" disabled={disabled} onClick={() => onWorkspace(step.workspace)}>
                            <b>{step.ready ? "✓" : index + 1}</b>
                            <span>
                                <strong>{step.title}</strong>
                                <small>{step.text}</small>
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
            <div className="itd-workspace-cards" role="group" aria-label="室内设计工作台">
                {[
                    { id: "images" as const, icon: Image, title: "空间效果图", text: "风格改造 · 毛坯精装 · 局部换材", tag: "照片 → 方案" },
                    { id: "scene" as const, icon: Box, title: "三维空间", text: "平面与家具布局 · 多视角预览", tag: "尺寸 → 布局" },
                    { id: "materials" as const, icon: Layers, title: "装修与石材", text: "实板对纹 · 排板分块 · 材料预算", tag: "选材 → 交付" },
                ].map(({ id, icon: Icon, title, text, tag }) => (
                    <button type="button" key={id} aria-pressed={workspace === id} disabled={disabled} onClick={() => onWorkspace(id)}>
                        <Icon aria-hidden />
                        <span>
                            <small>{tag}</small>
                            <strong>{title}</strong>
                            <p>{text}</p>
                        </span>
                        <ArrowUpRight aria-hidden />
                    </button>
                ))}
            </div>
            {workspace === "images" ? (
                <div className="itd-mode-cards" role="group" aria-label="选择设计任务">
                    {availableInteriorTasks(catalog, surface).map((mode) => (
                        <button key={mode.id} type="button" aria-pressed={modeId === mode.id} disabled={disabled} onClick={() => onMode(mode)}>
                            {mode.coverResourceId || mode.coverUrl ? (
                                <img src={mode.coverResourceId ? resourceFileUrl(mode.coverResourceId) : mode.coverUrl} alt="" loading="lazy" />
                            ) : mode.key === "sketch-render" ? (
                                <Ruler aria-hidden />
                            ) : (
                                <PaintRoller aria-hidden />
                            )}
                            <strong>{mode.name}</strong>
                            <span>{mode.subtitle}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
