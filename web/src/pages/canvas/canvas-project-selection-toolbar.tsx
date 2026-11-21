import { useTranslation } from "react-i18next";
import type { RefObject } from "react";

import { CanvasSelectionToolbar } from "@/components/canvas/canvas-workspace-overlays";
import { FloatingDock } from "@/components/ui/aceternity/floating-dock";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasSelectionRect } from "@/lib/canvas/canvas-overlay-layout";
import type { CanvasViewportSize } from "@/lib/canvas/canvas-viewport";
import type { ViewportTransform } from "@/types/canvas";
import { defaultToolbarPrefs, readToolbarPrefs, resolveToolbarEntries, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import type { CanvasAlignmentMode } from "@/lib/canvas/canvas-layout";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";

type CanvasProjectSelectionToolbarProps = {
    selection: CanvasSelectionRect & { count: number };
    suppressed: boolean;
    viewport: ViewportTransform;
    viewportSize: CanvasViewportSize;
    containerRef: RefObject<HTMLDivElement | null>;
    selectedVideoCount: number;
    mergingVideos: boolean;
    onAlign: (mode: CanvasAlignmentMode) => void;
    onArrange: (mode: "row" | "column" | "grid" | "flow") => void;
    onCreateStoryboard: () => void;
    onCreateFrame: () => void;
    onCreateReferenceGroup: () => void;
    onBatchConnect: () => void;
    onCompareImages?: () => void;
    onSendSelectionToAgent: () => void;
};

export function CanvasProjectSelectionToolbar({
    selection,
    suppressed,
    viewport,
    viewportSize,
    containerRef,
    selectedVideoCount,
    mergingVideos,
    onAlign,
    onArrange,
    onCreateStoryboard,
    onCreateFrame,
    onCreateReferenceGroup,
    onBatchConnect,
    onCompareImages,
    onSendSelectionToAgent,
}: CanvasProjectSelectionToolbarProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useCanvasThemeStore((state) => state.theme)];

    const handlers = {
        onAlign,
        onArrange,
        onCreateStoryboard,
        onCreateFrame,
        onCreateReferenceGroup,
        onBatchConnect,
        onCompareImages,
        onSendSelectionToAgent,
    } as Partial<ToolbarHandlers> as ToolbarHandlers;

    const ctx: ToolContext = {
        selectedCount: selection.count,
        selectedNodeTypes: new Set(),
        selectedVideoCount,
        canvasTool: "move",
        workspaceMode: "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        extractingVideoFrames: false,
        extractingAudio: false,
        trimmingVideo: false,
        mergingVideos,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers,
    };

    const prefs = readToolbarPrefs("selection") ?? defaultToolbarPrefs("selection");
    const items = resolveToolbarEntries("selection", ctx, prefs);

    return (
        <CanvasSelectionToolbar selection={selection} suppressed={suppressed} viewport={viewport} viewportSize={viewportSize} containerRef={containerRef}>
            <FloatingDock items={items} size="compact" className="canvas-floating-dock" style={canvasDockStyle(theme)} ariaLabel={t("canvasPage.selectionToolbar.ariaLabel")} />
        </CanvasSelectionToolbar>
    );
}
