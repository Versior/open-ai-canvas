export type AgentLauncherPosition = { right: number; bottom: number; dock?: "left" | "right" };
export type AgentLauncherViewport = { width: number; height: number };
export type AgentLauncherGesture = { x: number; y: number; start: AgentLauncherPosition; dragged: boolean };

export const AGENT_LAUNCHER_POSITION_KEY = "canvas:agent-launcher-position:v1";
export const AGENT_LAUNCHER_SIZE = 76;
const MARGIN = 20; // Includes the label below the orb.
/** 画布编辑器以外的页面和窄屏上，大形象会压住页面右下角的按钮，高度封顶到这个值。 */
export const AGENT_LAUNCHER_COMPACT_AVATAR_HEIGHT = 120;
export const AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH = 768;

/** 大形象（Live2D / 动画包）的入口高度：受外观设置、视口和宽高比约束，离开画布编辑器或窄屏时再封顶。 */
export function resolveAgentLauncherAvatarHeight(preferred: number, aspectRatio: number, viewport: AgentLauncherViewport, inCanvasEditor: boolean) {
    const compact = !inCanvasEditor || viewport.width < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH;
    const maximum = viewport.width < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH ? AGENT_LAUNCHER_SIZE : compact ? AGENT_LAUNCHER_COMPACT_AVATAR_HEIGHT : Infinity;
    return Math.max(40, Math.min(preferred, viewport.height - 60, (viewport.width - 40) / aspectRatio, maximum));
}

export function clampAgentLauncherPosition(position: AgentLauncherPosition, viewport: AgentLauncherViewport, size = { width: AGENT_LAUNCHER_SIZE, height: AGENT_LAUNCHER_SIZE }): AgentLauncherPosition {
    const clamp = (value: number, extent: number, dimension: number) => {
        const available = Math.max(0, extent - dimension);
        const margin = Math.min(MARGIN, available / 2);
        return Math.min(Math.max(value, margin), available - margin);
    };
    const bottom = clamp(position.bottom, viewport.height, size.height);
    if (position.dock === "left" || position.dock === "right") {
        return { right: position.dock === "right" ? -size.width * 0.45 : viewport.width - size.width * 0.55, bottom, dock: position.dock };
    }
    return { right: clamp(position.right, viewport.width, size.width), bottom };
}

/** 主动拖到窗边才吸附；留出一半身体，向内拖动即可恢复。 */
export function dockAgentLauncherPosition(position: AgentLauncherPosition, viewport: AgentLauncherViewport, size: AgentLauncherViewport): AgentLauncherPosition {
    const available = Math.max(0, viewport.width - size.width);
    const dock = position.right <= 12 ? "right" : position.right >= available - 12 ? "left" : undefined;
    return dock ? clampAgentLauncherPosition({ ...position, dock }, viewport, size) : position;
}

export function restoreAgentLauncherPosition(raw: string | null, viewport: AgentLauncherViewport, size?: AgentLauncherViewport): AgentLauncherPosition {
    if (raw) {
        try {
            const value = JSON.parse(raw);
            if (value && Number.isFinite(value.right) && Number.isFinite(value.bottom)) return clampAgentLauncherPosition(value, viewport, size);
        } catch {
            // Damaged UI preferences must not hide the launcher.
        }
    }
    return clampAgentLauncherPosition({ right: MARGIN, bottom: MARGIN }, viewport, size);
}

export function moveAgentLauncher(gesture: AgentLauncherGesture, x: number, y: number, viewport: AgentLauncherViewport, size?: AgentLauncherViewport, allowDock = false) {
    const dx = x - gesture.x;
    const dy = y - gesture.y;
    const dragged = gesture.dragged || Math.hypot(dx, dy) >= 6;
    const candidate = dragged ? { right: gesture.start.right - dx, bottom: gesture.start.bottom - dy } : gesture.start;
    const position = clampAgentLauncherPosition(candidate, viewport, size);
    if (allowDock && dragged) position.right = Math.min(Math.max(candidate.right, 0), Math.max(0, viewport.width - (size?.width ?? AGENT_LAUNCHER_SIZE)));
    return { dragged, position };
}
