import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import { AGENT_PET_ROWS, type AgentPetRow } from "@/services/api/agent-pets";

/** Codex 宠物图集：8 列，单格 192×208；v1 共 9 行动作，v2 另有 2 行 16 个视线方向。 */
export const AGENT_PET_CELL_WIDTH = 192;
export const AGENT_PET_CELL_HEIGHT = 208;
export const AGENT_PET_COLUMNS = 8;
export const AGENT_PET_ASPECT = AGENT_PET_CELL_WIDTH / AGENT_PET_CELL_HEIGHT;
export const AGENT_PET_LOOK_FIRST_ROW = 9;

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

const DETECT_SCALE = 4;
const frameCache = new Map<string, number[]>();
const pendingFrames = new Map<string, Promise<number[]>>();

export function cachedAgentPetFrames(src: string) {
    return frameCache.get(src) ?? null;
}

/** 浏览器里读一次图集透明度（缩小 4 倍采样），结果按 URL 缓存；读不到像素时用规范帧数。 */
export function detectAgentPetFrames(src: string, rows: number): Promise<number[]> {
    const cached = frameCache.get(src);
    if (cached) return Promise.resolve(cached);
    const pending = pendingFrames.get(src);
    if (pending) return pending;
    const promise = new Promise<number[]>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            let counts = [...DEFAULT_AGENT_PET_FRAMES, AGENT_PET_COLUMNS, AGENT_PET_COLUMNS].slice(0, rows);
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
                    counts = countAgentPetFrames((column, row) => {
                        for (let y = row * cellHeight; y < (row + 1) * cellHeight; y += 1) {
                            for (let x = column * cellWidth; x < (column + 1) * cellWidth; x += 1) {
                                if (pixels[(y * canvas.width + x) * 4 + 3] > 16) return true;
                            }
                        }
                        return false;
                    }, rows);
                }
            } catch (error) {
                console.warn("形象图集帧数检测失败，使用规范帧数", error);
            }
            frameCache.set(src, counts);
            pendingFrames.delete(src);
            resolve(counts);
        };
        image.onerror = () => {
            pendingFrames.delete(src);
            reject(new Error("形象图集加载失败"));
        };
        image.src = src;
    });
    pendingFrames.set(src, promise);
    return promise;
}
