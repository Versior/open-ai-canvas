/**
 * 流式建模：模型的方案回复边收边读。每收到一段就把半截 JSON 退回到最后一个写完的元素、补齐括号，
 * 再按 normalizeSceneSpec 同样的规则收紧，得到「目前写到哪」的方案和进度；页面据此现搭现看。
 * 没写完的房间、门窗和家具不会出现，所以预览里不会闪出尺寸错一半的东西。
 */
import { jsonrepair } from "jsonrepair";
import { extractSceneJson, type InteriorSceneScope } from "./scene-3d";
import { normalizeSceneMeta, normalizeSceneSpec, normalizeSpecGrid, type SceneSpec, type SpecGrid } from "./scene-spec";

export type SceneBuildPhase = "waiting" | "reading" | "grid" | "rooms" | "openings" | "furniture" | "exterior";

export type SceneBuildProgress = {
    phase: SceneBuildPhase;
    reading: string[];
    title: string;
    scope?: InteriorSceneScope;
    grid?: SpecGrid;
    /** 已经写出来、能搭的方案（至少有一个房间）。 */
    spec?: SceneSpec;
    floors: number;
    rooms: number;
    doors: number;
    windows: number;
    furniture: number;
    chars: number;
};

/** 回复里各段的标记：最后出现的那个就是模型正在写的部分。 */
const PHASE_MARKERS: [SceneBuildPhase, string[]][] = [
    ["reading", ['"reading"']],
    ["grid", ['"grid"', '"palette"']],
    ["rooms", ['"rooms"', '"open"']],
    ["openings", ['"doors"', '"windows"', '"stairs"', '"balconies"', '"pillars"']],
    ["furniture", ['"furniture"']],
    ["exterior", ['"roof"', '"site"']],
];

function currentPhase(json: string): SceneBuildPhase {
    let phase: SceneBuildPhase = json.includes("{") ? "reading" : "waiting";
    let at = -1;
    for (const [name, markers] of PHASE_MARKERS) {
        for (const marker of markers) {
            const index = json.lastIndexOf(marker);
            if (index > at) {
                at = index;
                phase = name;
            }
        }
    }
    return phase;
}

/** 退回到最后一个写完的元素（对象、数组或一个完整的字符串元素），再补齐还开着的括号。 */
export function completedPrefix(json: string) {
    const cut = Math.max(json.lastIndexOf("}"), json.lastIndexOf("]"), json.lastIndexOf('",'));
    if (cut < 0) return "";
    return json.slice(0, cut + 1);
}

function parseLoose(json: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(json);
        return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    } catch {
        // 还没写完，退回到写完的部分再补齐。
    }
    const prefix = completedPrefix(json);
    if (!prefix) return null;
    try {
        const value: unknown = JSON.parse(jsonrepair(prefix));
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** 读到目前为止的回复。读不出来时只给阶段和字数，调用方保留上一次能读的结果。 */
export function readPartialScene(text: string, scope: InteriorSceneScope | "auto"): SceneBuildProgress {
    const json = extractSceneJson(text);
    const empty: SceneBuildProgress = { phase: currentPhase(json), reading: [], title: "", floors: 0, rooms: 0, doors: 0, windows: 0, furniture: 0, chars: text.length };
    const value = parseLoose(json);
    if (!value) return empty;
    const meta = normalizeSceneMeta(value, { scope, roomKeys: [], styleKeys: [] });
    const progress: SceneBuildProgress = { ...empty, reading: meta.reading, title: typeof value.title === "string" ? value.title.trim().slice(0, 40) : "", scope: meta.scope };
    const grid = normalizeSpecGrid(value.grid);
    if (grid) progress.grid = grid;
    if (!Array.isArray(value.floors) || !value.floors.length) return progress;
    try {
        const spec = normalizeSceneSpec(value, meta.scope);
        progress.spec = spec;
        if (spec.grid) progress.grid = spec.grid;
        progress.floors = spec.floors.length;
        for (const floor of spec.floors) {
            progress.rooms += floor.rooms.filter((room) => !room.part).length;
            progress.doors += floor.doors.length;
            progress.windows += floor.windows.length;
            progress.furniture += floor.furniture.length;
        }
    } catch {
        // 第一个房间还没写完。
    }
    return progress;
}
