import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import { AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH, resolveAgentLauncherAvatarHeight, type AgentLauncherViewport } from "@/lib/canvas/agent-launcher-position";
import { AGENT_PET_ROWS, type AgentPetRow } from "@/services/api/agent-pets";
import { agentSpriteAccent } from "@/lib/canvas/agent-skin";

/** Codex 宠物图集：8 列，单格 192×208；v1 共 9 行动作，v2 另有 2 行 16 个视线方向。 */
export const AGENT_PET_CELL_WIDTH = 192;
export const AGENT_PET_CELL_HEIGHT = 208;
export const AGENT_PET_COLUMNS = 8;
export const AGENT_PET_ASPECT = AGENT_PET_CELL_WIDTH / AGENT_PET_CELL_HEIGHT;
export const AGENT_PET_LOOK_FIRST_ROW = 9;

/** 形象大小：auto 跟随站点设置但不超过小号；固定档位最大到图集单格高度。 */
export type AgentPetSize = "auto" | "s" | "m" | "l" | "xl";
export const AGENT_PET_SIZE_OPTIONS: ReadonlyArray<{ id: AgentPetSize; label: string; height?: number }> = [
    { id: "s", label: "小", height: 96 },
    { id: "m", label: "中", height: 128 },
    { id: "l", label: "大", height: 168 },
    { id: "xl", label: "特大", height: AGENT_PET_CELL_HEIGHT },
    { id: "auto", label: "自动" },
];

/**
 * 宠物入口的高度。自动不超过 96px，避免遮挡画布与输入控件；
 * 桌面上用户选了档位就按所选高度显示；窄屏统一缩小，避免遮住正文。
 */
export function agentPetLauncherHeight(size: AgentPetSize, siteHeight: number, viewport: AgentLauncherViewport, inCanvasEditor: boolean) {
    const height = AGENT_PET_SIZE_OPTIONS.find((option) => option.id === size)?.height;
    if (!height || viewport.width < AGENT_LAUNCHER_COMPACT_VIEWPORT_WIDTH) return resolveAgentLauncherAvatarHeight(height ?? Math.min(siteHeight, 96), AGENT_PET_ASPECT, viewport, inCanvasEditor);
    return Math.max(40, Math.min(height, viewport.height - 60, (viewport.width - 40) / AGENT_PET_ASPECT));
}

/** 每个动作的逐帧时长（毫秒），末项是最后一帧的停留时长；帧数多于规范时中间帧沿用倒数第二项。 */
const ROW_DURATIONS: Record<AgentPetRow, readonly number[]> = {
    idle: [280, 110, 110, 140, 140, 320],
    "running-right": [120, 120, 120, 120, 120, 120, 120, 220],
    "running-left": [120, 120, 120, 120, 120, 120, 120, 220],
    waving: [140, 140, 140, 280],
    jumping: [140, 140, 140, 140, 280],
    failed: [140, 140, 140, 140, 140, 140, 140, 240],
    waiting: [150, 150, 150, 150, 150, 260],
    running: [120, 120, 120, 120, 120, 220],
    review: [150, 150, 150, 150, 150, 280],
};

export const DEFAULT_AGENT_PET_FRAMES: readonly number[] = AGENT_PET_ROWS.map((row) => ROW_DURATIONS[row].length);

/** 助手状态到动作的默认映射；completed 的动作只播一次，随后回到待机。 */
export const DEFAULT_AGENT_PET_STATE_ROWS: Record<AgentAvatarState, AgentPetRow> = {
    idle: "idle",
    queued: "review",
    running: "running",
    waiting_approval: "waiting",
    completed: "jumping",
    failed: "failed",
    cancelled: "idle",
    rejected: "review",
};

export const AGENT_PET_ROW_LABELS: Record<AgentPetRow, string> = {
    idle: "待机",
    "running-right": "向右跑",
    "running-left": "向左跑",
    waving: "挥手",
    jumping: "跳跃",
    failed: "失败",
    waiting: "等待",
    running: "工作中",
    review: "思考",
};

/** 右键互动使用动作表情名称，不把「委屈」描述为任务失败。 */
export const AGENT_PET_INTERACTIONS: ReadonlyArray<{ row: AgentPetRow; label: string }> = [
    { row: "waving", label: "挥挥手" },
    { row: "jumping", label: "跳一下" },
    { row: "review", label: "想一想" },
    { row: "waiting", label: "歇一歇" },
    { row: "running-right", label: "向右跑" },
    { row: "running-left", label: "向左跑" },
    { row: "running", label: "忙起来" },
    { row: "failed", label: "小委屈" },
    { row: "idle", label: "眨眨眼" },
];

export function isAgentPetRow(value: unknown): value is AgentPetRow {
    return typeof value === "string" && (AGENT_PET_ROWS as readonly string[]).includes(value);
}

export function agentPetRowForState(state: AgentAvatarState, overrides?: Partial<Record<string, AgentPetRow>>): AgentPetRow {
    const row = overrides?.[state];
    return isAgentPetRow(row) ? row : DEFAULT_AGENT_PET_STATE_ROWS[state];
}

export function agentPetRowIndex(row: AgentPetRow) {
    return AGENT_PET_ROWS.indexOf(row);
}

export function agentPetSheetRows(version: number) {
    return version === 2 ? 11 : 9;
}

export function agentPetFrameDuration(row: AgentPetRow, frame: number, frameCount: number) {
    const durations = ROW_DURATIONS[row];
    if (frame >= frameCount - 1) return durations[durations.length - 1];
    return durations[Math.min(frame, durations.length - 2)];
}

/**
 * 视线方向：0° 朝上、顺时针每格 22.5°，共 16 格。
 * 第 9 行第 0–7 列是 0°–157.5°，第 10 行是 180°–337.5°。dx、dy 为屏幕坐标（y 向下）。
 */
export function agentPetLookCell(dx: number, dy: number) {
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const index = Math.round(((degrees + 360) % 360) / 22.5) % 16;
    return { row: AGENT_PET_LOOK_FIRST_ROW + Math.floor(index / 8), column: index % 8 };
}

/** 按每格是否有不透明像素推算各行帧数：取从第 0 格起连续非空的格数；空行回退到规范帧数。 */
export function countAgentPetFrames(filled: (column: number, row: number) => boolean, rows: number) {
    const counts: number[] = [];
    for (let row = 0; row < rows; row += 1) {
        let count = 0;
        while (count < AGENT_PET_COLUMNS && filled(count, row)) count += 1;
        counts.push(count || (DEFAULT_AGENT_PET_FRAMES[row] ?? AGENT_PET_COLUMNS));
    }
    return counts;
}

/** 待机第一行里最靠上的不透明像素相对单格高度的位置，用来把头顶气泡贴在头上方。 */
export const DEFAULT_AGENT_PET_HEAD_TOP = 0.12;

export type AgentPetSheetMetrics = { frames: readonly number[]; headTop: number; accent?: string };

/** 待机行各帧最靠上的不透明像素所在行（0 起），没有像素时返回 null。 */
export function agentPetTopRow(filled: (column: number, y: number) => boolean, frames: number, cellHeight: number) {
    for (let y = 0; y < cellHeight; y += 1) {
        for (let column = 0; column < frames; column += 1) {
            if (filled(column, y)) return y;
        }
    }
    return null;
}

const DETECT_SCALE = 4;
const metricsCache = new Map<string, AgentPetSheetMetrics>();
const pendingMetrics = new Map<string, Promise<AgentPetSheetMetrics>>();

export function cachedAgentPetMetrics(src: string) {
    return metricsCache.get(src) ?? null;
}

/** 浏览器里读一次图集透明度（缩小 4 倍采样），得到各行帧数和头顶位置并按 URL 缓存；读不到像素时用规范值。 */
export function detectAgentPetMetrics(src: string, rows: number): Promise<AgentPetSheetMetrics> {
    const cached = metricsCache.get(src);
    if (cached) return Promise.resolve(cached);
    const pending = pendingMetrics.get(src);
    if (pending) return pending;
    const promise = new Promise<AgentPetSheetMetrics>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            let metrics: AgentPetSheetMetrics = { frames: [...DEFAULT_AGENT_PET_FRAMES, AGENT_PET_COLUMNS, AGENT_PET_COLUMNS].slice(0, rows), headTop: DEFAULT_AGENT_PET_HEAD_TOP };
            try {
                const cellWidth = AGENT_PET_CELL_WIDTH / DETECT_SCALE;
                const cellHeight = AGENT_PET_CELL_HEIGHT / DETECT_SCALE;
                const canvas = document.createElement("canvas");
                canvas.width = cellWidth * AGENT_PET_COLUMNS;
                canvas.height = cellHeight * rows;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (context) {
                    context.drawImage(image, 0, 0, canvas.width, canvas.height);
                    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                    const opaque = (x: number, y: number) => pixels[(y * canvas.width + x) * 4 + 3] > 16;
                    const frames = countAgentPetFrames((column, row) => {
                        for (let y = row * cellHeight; y < (row + 1) * cellHeight; y += 1) {
                            for (let x = column * cellWidth; x < (column + 1) * cellWidth; x += 1) {
                                if (opaque(x, y)) return true;
                            }
                        }
                        return false;
                    }, rows);
                    const top = agentPetTopRow(
                        (column, y) => {
                            for (let x = column * cellWidth; x < (column + 1) * cellWidth; x += 1) {
                                if (opaque(x, y)) return true;
                            }
                            return false;
                        },
                        frames[0] ?? 1,
                        cellHeight,
                    );
                    metrics = { frames, headTop: top === null ? DEFAULT_AGENT_PET_HEAD_TOP : top / cellHeight, accent: agentSpriteAccent(pixels.subarray(0, canvas.width * cellHeight * 4)) };
                }
            } catch (error) {
                console.warn("形象图集检测失败，使用规范帧数", error);
            }
            metricsCache.set(src, metrics);
            pendingMetrics.delete(src);
            resolve(metrics);
        };
        image.onerror = () => {
            pendingMetrics.delete(src);
            reject(new Error("形象图集加载失败"));
        };
        image.src = src;
    });
    pendingMetrics.set(src, promise);
    return promise;
}
