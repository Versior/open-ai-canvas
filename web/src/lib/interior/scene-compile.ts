/**
 * 把第二版 3D 方案（scene-spec.ts）编译成渲染用的几何体列表。
 *
 * 墙：按房间矩形自动求出外墙（一侧没有房间）和内墙（两侧是不同房间），同一条线上连续的合成一面墙。
 * 拐角和丁字口按固定规则一面延长、一面截短，墙体之间不重叠、没有共面，所以不会闪。
 * 楼板：每层一块结构板（盖住这层和下一层的平面，外沿露在立面上就是层间线），房间地面另铺一层薄面层。
 * 门窗、窗框、窗台、门扇、台阶、雨棚、栏杆、楼梯踏步、屋顶、庭院和家具都由程序按真实尺寸生成。
 */
import type { SceneLabel, SceneMaterial, SceneObject, SceneOpening, SceneTexture, SceneVector } from "./scene-3d";
import { buildFurniture, place, type FurniturePart } from "./scene-furniture";
import { FURNITURE_TYPES, type InteriorSceneData, type SceneSpec, type SpecAnchor, type SpecFloor, type SpecFloorFinish, type SpecFurnitureType, type SpecRect, type SpecRoom, type SpecRoomType, type SpecSide } from "./scene-spec";

export type CompiledScene = {
    title: string;
    summary: string;
    ground: { material: SceneMaterial; size: [number, number]; center: [number, number]; y: number; holes: SpecRect[]; texture?: SceneTexture; color?: string };
    objects: SceneObject[];
    labels: SceneLabel[];
    floors: string[];
};

/** cutFloor：剖切看某一层（更高的楼层和屋顶不显示，这层的墙只砌到 1.2 米）。 */
export type CompileOptions = { cutFloor?: number };

export const ROOF_GROUP = "屋顶";
export const SITE_GROUP = "庭院";

const EXT_T = 0.24;
const INT_T = 0.12;
const SLAB = 0.18;
const PLINTH = 0.45;
const FINISH = 0.012;
const EPS = 1e-4;
const CUT_HEIGHT = 1.2;
const DOLLHOUSE_HEIGHT = 0.9;

type Adj = { sign: -1 | 0 | 1; other: number };
type Hole = { center: number; width: number; bottom: number; height: number; kind: "window" | "floor" | "high" | "door" | "entry" | "slide" };
type Seg = { axis: "x" | "z"; line: number; a: number; b: number; ext: boolean; out: -1 | 0 | 1; t: number; adjA: Adj; adjB: Adj; holes: Hole[] };

const NONE: Adj = { sign: 0, other: 0 };

function r3(value: number) {
    return Math.round(value * 1000) / 1000;
}

function inRect(rect: SpecRect, x: number, z: number) {
    return x > rect[0] + EPS && x < rect[2] - EPS && z > rect[1] + EPS && z < rect[3] - EPS;
}

function roomAt(rooms: SpecRoom[], x: number, z: number) {
    return rooms.findIndex((room) => inRect(room.rect, x, z));
}

function uniqueSorted(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const result: number[] = [];
    for (const value of sorted) if (!result.length || value - result[result.length - 1] > EPS) result.push(value);
    return result;
}

/** 网格求区域：include 的并集减去 exclude，结果拆成互不重叠的矩形（先按行合并，再把上下宽度一样的行接起来）。 */
export function gridRegion(include: SpecRect[], exclude: SpecRect[] = []): SpecRect[] {
    if (!include.length) return [];
    const all = [...include, ...exclude];
    const xs = uniqueSorted(all.flatMap((rect) => [rect[0], rect[2]]));
    const zs = uniqueSorted(all.flatMap((rect) => [rect[1], rect[3]]));
    const rects: SpecRect[] = [];
    let open = new Map<string, SpecRect>();
    for (let j = 0; j < zs.length - 1; j += 1) {
        const cz = (zs[j] + zs[j + 1]) / 2;
        const next = new Map<string, SpecRect>();
        let start = -1;
        for (let i = 0; i <= xs.length - 1; i += 1) {
            const filled =
                i < xs.length - 1 &&
                (() => {
                    const cx = (xs[i] + xs[i + 1]) / 2;
                    return include.some((rect) => inRect(rect, cx, cz)) && !exclude.some((rect) => inRect(rect, cx, cz));
                })();
            if (filled && start < 0) start = i;
            if (!filled && start >= 0) {
                const key = `${start}-${i}`;
                const current = open.get(key);
                if (current) {
                    current[3] = zs[j + 1];
                    next.set(key, current);
                } else {
                    const rect: SpecRect = [xs[start], zs[j], xs[i], zs[j + 1]];
                    rects.push(rect);
                    next.set(key, rect);
                }
                start = -1;
            }
        }
        open = next;
    }
    return rects;
}

function pairKey(a: number, b: number) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

type Classified = { ext: boolean; out: -1 | 0 | 1 } | null;

function classify(rooms: SpecRoom[], open: Set<string>, axis: "x" | "z", line: number, position: number): Classified {
    const negative = axis === "x" ? roomAt(rooms, position, line - 0.02) : roomAt(rooms, line - 0.02, position);
    const positive = axis === "x" ? roomAt(rooms, position, line + 0.02) : roomAt(rooms, line + 0.02, position);
    if (negative === positive) return null;
    if (negative < 0 || positive < 0) return { ext: true, out: negative < 0 ? -1 : 1 };
    if (open.has(pairKey(negative, positive))) return null;
    return { ext: false, out: 0 };
}

/**
 * 求一层的墙。沿 x 的墙（横墙）在同一条线上连续不断；沿 z 的墙（竖墙）在被横墙穿过的地方断开。
 * 端点处理：横墙端点碰到穿过去的竖墙就截短半个竖墙厚，碰到同样到头的竖墙（L 形拐角）就延长半个竖墙厚；
 * 竖墙端点碰到横墙一律截短半个横墙厚。这样拐角、丁字口、十字口都正好填满、互不重叠。
 */
export function solveWalls(rooms: SpecRoom[], openPairs: [string, string][]): Seg[] {
    const names = rooms.map((room) => room.name);
    const open = new Set(openPairs.map(([a, b]) => pairKey(names.indexOf(a), names.indexOf(b))));
    const xs = uniqueSorted(rooms.flatMap((room) => [room.rect[0], room.rect[2]]));
    const zs = uniqueSorted(rooms.flatMap((room) => [room.rect[1], room.rect[3]]));
    const make = (axis: "x" | "z", line: number, a: number, b: number, kind: NonNullable<Classified>): Seg => ({ axis, line, a, b, ext: kind.ext, out: kind.out, t: kind.ext ? EXT_T : INT_T, adjA: NONE, adjB: NONE, holes: [] });
    const horizontal: Seg[] = [];
    for (const line of zs) {
        let current: Seg | null = null;
        for (let i = 0; i < xs.length - 1; i += 1) {
            const kind = classify(rooms, open, "x", line, (xs[i] + xs[i + 1]) / 2);
            if (!kind) {
                current = null;
                continue;
            }
            if (current && current.ext === kind.ext && current.out === kind.out && Math.abs(current.b - xs[i]) < EPS) current.b = xs[i + 1];
            else {
                current = make("x", line, xs[i], xs[i + 1], kind);
                horizontal.push(current);
            }
        }
    }
    const vertical: Seg[] = [];
    for (const line of xs) {
        let current: Seg | null = null;
        for (let j = 0; j < zs.length - 1; j += 1) {
            const kind = classify(rooms, open, "z", line, (zs[j] + zs[j + 1]) / 2);
            if (!kind) {
                current = null;
                continue;
            }
            const crossed = horizontal.some((seg) => Math.abs(seg.line - zs[j]) < EPS && seg.a < line - EPS && seg.b > line + EPS);
            if (current && !crossed && current.ext === kind.ext && current.out === kind.out && Math.abs(current.b - zs[j]) < EPS) current.b = zs[j + 1];
            else {
                current = make("z", line, zs[j], zs[j + 1], kind);
                vertical.push(current);
            }
        }
    }
    for (const seg of horizontal) {
        const at = (x: number): Adj => {
            const touching = vertical.filter((other) => Math.abs(other.line - x) < EPS && other.a <= seg.line + EPS && other.b >= seg.line - EPS);
            if (!touching.length) return NONE;
            const thickness = Math.max(...touching.map((other) => other.t));
            const through = touching.some((other) => other.a < seg.line - EPS && other.b > seg.line + EPS);
            return { sign: through ? -1 : 1, other: thickness };
        };
        seg.adjA = at(seg.a);
        seg.adjB = at(seg.b);
    }
    for (const seg of vertical) {
        const at = (z: number): Adj => {
            const touching = horizontal.filter((other) => Math.abs(other.line - z) < EPS && other.a <= seg.line + EPS && other.b >= seg.line - EPS);
            return touching.length ? { sign: -1, other: Math.max(...touching.map((other) => other.t)) } : NONE;
        };
        seg.adjA = at(seg.a);
        seg.adjB = at(seg.b);
    }
    return [...horizontal, ...vertical];
}

/** 墙按厚度增量 delta（层间线、女儿墙比墙厚一点）算出实际的起止位置。 */
function segEnds(seg: Seg, delta = 0) {
    const amount = (adj: Adj) => (adj.sign * (adj.other + delta)) / 2;
    return { a: r3(seg.a - amount(seg.adjA)), b: r3(seg.b + amount(seg.adjB)) };
}

function segRect(seg: Seg, delta = 0): SpecRect {
    const { a, b } = segEnds(seg, delta);
    const half = (seg.t + delta) / 2;
    return seg.axis === "x" ? [a, r3(seg.line - half), b, r3(seg.line + half)] : [r3(seg.line - half), a, r3(seg.line + half), b];
}

/** 沿墙方向的位置 along、离墙中线的偏移 across → 世界坐标 [x, z]。 */
function onSeg(seg: Pick<Seg, "axis" | "line">, along: number, across: number): [number, number] {
    return seg.axis === "x" ? [r3(along), r3(seg.line + across)] : [r3(seg.line + across), r3(along)];
}

/** 沿墙摆的方块：沿墙长 length、高 height、垂直墙方向 depth。 */
function segBox(seg: Pick<Seg, "axis" | "line">, along: number, across: number, y: number, length: number, height: number, depth: number, material: SceneMaterial, color?: string): SceneObject {
    const [x, z] = onSeg(seg, along, across);
    return { shape: "box", position: [x, r3(y), z], size: seg.axis === "x" ? [r3(length), r3(height), r3(depth)] : [r3(depth), r3(height), r3(length)], material, ...(color ? { color } : {}) };
}

function shade(hex: string, amount: number) {
    const value = Number.parseInt(hex.slice(1), 16);
    const channel = (shift: number) => Math.round(Math.min(255, Math.max(0, ((value >> shift) & 255) * (1 + amount))));
    return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

const FINISH_LOOK: Record<SpecFloorFinish, { material: SceneMaterial; color?: string; texture?: SceneTexture }> = {
    wood: { material: "wood", texture: "planks" },
    tile: { material: "tile", color: "#dcd9d3", texture: "tiles" },
    marble: { material: "marble", color: "#ece9e4", texture: "tiles" },
    stone: { material: "stone", color: "#a9a49c", texture: "paving" },
    concrete: { material: "concrete", color: "#bdbab4" },
    carpet: { material: "fabric", color: "#cfc6b8" },
};

function defaultFinish(type: SpecRoomType): SpecFloorFinish {
    if (type === "bathroom" || type === "kitchen" || type === "laundry" || type === "balcony") return "tile";
    if (type === "entry") return "marble";
    if (type === "garage" || type === "storage") return "concrete";
    if (type === "theater") return "carpet";
    return "wood";
}

type Edge = { axis: "x" | "z"; line: number; from: number; to: number };

function roomEdge(rect: SpecRect, side: SpecSide): Edge {
    if (side === "n") return { axis: "x", line: rect[1], from: rect[0], to: rect[2] };
    if (side === "s") return { axis: "x", line: rect[3], from: rect[0], to: rect[2] };
    if (side === "w") return { axis: "z", line: rect[0], from: rect[1], to: rect[3] };
    return { axis: "z", line: rect[2], from: rect[1], to: rect[3] };
}

/** 一条边上属于某类墙的区间（裁到边的范围内），从长到短排。 */
function edgeIntervals(segs: Seg[], edge: Edge, ext: boolean) {
    return segs
        .filter((seg) => seg.axis === edge.axis && Math.abs(seg.line - edge.line) < EPS && seg.ext === ext)
        .map((seg) => ({ seg, from: Math.max(seg.a, edge.from), to: Math.min(seg.b, edge.to) }))
        .filter((item) => item.to - item.from > 0.3)
        .sort((x, y) => y.to - y.from - (x.to - x.from));
}

function addHole(seg: Seg, hole: Hole) {
    const left = hole.center - hole.width / 2;
    const right = hole.center + hole.width / 2;
    if (left < seg.a + 0.12 || right > seg.b - 0.12) return false;
    if (seg.holes.some((other) => left < other.center + other.width / 2 + 0.15 && right > other.center - other.width / 2 - 0.15)) return false;
    seg.holes.push(hole);
    return true;
}

type FloorLevel = { floor: SpecFloor; index: number; top: number; wallBase: number; wallTop: number; segs: Seg[]; group: string };

function windowSize(kind: Hole["kind"], clear: number, height?: number) {
    if (kind === "floor") return { bottom: 0, height: Math.min(height ?? clear - 0.3, clear - 0.25) };
    if (kind === "high") return { bottom: Math.min(1.5, clear - 0.9), height: Math.min(height ?? 0.6, 0.8) };
    const bottom = 0.9;
    return { bottom, height: Math.max(0.5, Math.min(height ?? 1.6, clear - bottom - 0.35)) };
}

/** 把方案里的门窗落到墙上；没写门的房间自动开一扇门通向相邻的房间，首层没写入户门时自动开一扇。 */
function placeOpenings(level: FloorLevel, scope: SceneSpec["scope"]) {
    const { floor, segs } = level;
    const clear = level.wallTop - level.top;
    const byName = new Map(floor.rooms.map((room) => [room.name, room]));
    // 只算房间之间的连通：只有通向室外或阳台的门的房间，也还要一扇通往室内的门。
    const connected = new Set<string>();
    for (const [a, b] of floor.open) connected.add(a).add(b);
    const doorBetween = (a: SpecRoom, b: SpecRoom, kind: Hole["kind"], width?: number) => {
        const candidates: Edge[] = [];
        const overlap = (from1: number, to1: number, from2: number, to2: number) => [Math.max(from1, from2), Math.min(to1, to2)] as const;
        if (Math.abs(a.rect[3] - b.rect[1]) < EPS || Math.abs(a.rect[1] - b.rect[3]) < EPS) {
            const [from, to] = overlap(a.rect[0], a.rect[2], b.rect[0], b.rect[2]);
            candidates.push({ axis: "x", line: Math.abs(a.rect[3] - b.rect[1]) < EPS ? a.rect[3] : a.rect[1], from, to });
        }
        if (Math.abs(a.rect[2] - b.rect[0]) < EPS || Math.abs(a.rect[0] - b.rect[2]) < EPS) {
            const [from, to] = overlap(a.rect[1], a.rect[3], b.rect[1], b.rect[3]);
            candidates.push({ axis: "z", line: Math.abs(a.rect[2] - b.rect[0]) < EPS ? a.rect[2] : a.rect[0], from, to });
        }
        for (const edge of candidates) {
            const interval = edgeIntervals(segs, edge, false)[0];
            if (!interval) continue;
            const doorWidth = Math.min(width ?? (kind === "slide" ? 1.6 : 0.9), interval.to - interval.from - 0.3);
            if (doorWidth < 0.7) continue;
            const height = Math.min(kind === "slide" ? 2.3 : 2.1, clear - 0.2);
            if (addHole(interval.seg, { center: r3((interval.from + interval.to) / 2), width: r3(doorWidth), bottom: 0, height: r3(height), kind })) return true;
        }
        return false;
    };
    for (const door of floor.doors) {
        if (door.between) {
            const [a, b] = door.between.map((name) => byName.get(name));
            if (a && b && doorBetween(a, b, door.kind === "slide" ? "slide" : "door", door.width)) connected.add(a.name).add(b.name);
            continue;
        }
        const room = door.room ? byName.get(door.room) : undefined;
        if (!room || !door.side) continue;
        const interval = edgeIntervals(segs, roomEdge(room.rect, door.side), true)[0];
        if (!interval) continue;
        const kind: Hole["kind"] = door.kind === "door" ? "door" : door.kind;
        const width = Math.min(door.width ?? (kind === "entry" ? 1.2 : kind === "slide" ? 2.4 : 0.9), interval.to - interval.from - 0.3);
        const height = Math.min(kind === "entry" ? 2.4 : kind === "slide" ? 2.6 : 2.1, clear - 0.2);
        if (width >= 0.7) addHole(interval.seg, { center: r3((interval.from + interval.to) / 2), width: r3(width), bottom: 0, height: r3(height), kind });
    }
    // 没有门也没有连通的房间：和共用边最长的相邻房间之间开一扇门。
    for (const room of floor.rooms) {
        if (connected.has(room.name)) continue;
        const neighbors = floor.rooms
            .filter((other) => other !== room)
            .map((other) => ({ other, length: sharedLength(room.rect, other.rect) }))
            .filter((item) => item.length >= 1)
            .sort((x, y) => preferNeighbor(y.other.type) - preferNeighbor(x.other.type) || y.length - x.length);
        for (const { other } of neighbors) {
            if (doorBetween(room, other, "door")) {
                connected.add(room.name).add(other.name);
                break;
            }
        }
    }
    if (scope === "building" && level.index === 0 && !level.segs.some((seg) => seg.holes.some((hole) => hole.kind === "entry"))) {
        const order: Partial<Record<SpecRoomType, number>> = { entry: 5, living: 4, corridor: 3, dining: 2, stair: 1 };
        const candidates = [...floor.rooms].sort((x, y) => (order[y.type] || 0) - (order[x.type] || 0));
        const sides: SpecSide[] = ["s", "e", "w", "n"];
        candidates.some((room) =>
            sides.some((side) => {
                const interval = edgeIntervals(segs, roomEdge(room.rect, side), true)[0];
                return Boolean(interval && interval.to - interval.from >= 1.6 && addHole(interval.seg, { center: r3((interval.from + interval.to) / 2), width: 1.2, bottom: 0, height: Math.min(2.4, clear - 0.2), kind: "entry" }));
            }),
        );
    }
    for (const spec of floor.windows) {
        const room = byName.get(spec.room);
        if (!room) continue;
        const interval = edgeIntervals(segs, roomEdge(room.rect, spec.side), true)[0];
        if (!interval) continue;
        const from = interval.from + 0.25;
        const to = interval.to - 0.25;
        const slot = (to - from) / spec.count;
        const width = Math.min(spec.width, slot - 0.3);
        if (width < 0.4) continue;
        const { bottom, height } = windowSize(spec.kind, clear, spec.height);
        for (let index = 0; index < spec.count; index += 1) addHole(interval.seg, { center: r3(from + slot * (index + 0.5)), width: r3(width), bottom: r3(bottom), height: r3(height), kind: spec.kind });
    }
}

function sharedLength(a: SpecRect, b: SpecRect) {
    if (Math.abs(a[3] - b[1]) < EPS || Math.abs(a[1] - b[3]) < EPS) return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    if (Math.abs(a[2] - b[0]) < EPS || Math.abs(a[0] - b[2]) < EPS) return Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return 0;
}

function preferNeighbor(type: SpecRoomType) {
    return type === "corridor" ? 4 : type === "living" ? 3 : type === "entry" ? 3 : type === "stair" ? 2 : type === "dining" ? 2 : 0;
}

/** 窗框、玻璃、窗台、门框、门扇、推拉门、入户台阶和雨棚。 */
function openingDetails(level: FloorLevel, seg: Seg, hole: Hole, spec: SceneSpec, objects: SceneObject[]) {
    const trim = spec.palette.trim;
    const out = seg.out || 1;
    const bottomY = level.top + hole.bottom;
    const half = hole.width / 2;
    const frame = 0.06;
    const push = (object: SceneObject) => objects.push({ ...object, group: level.group });
    if (hole.kind === "window" || hole.kind === "floor" || hole.kind === "high") {
        const plane = out * (seg.t / 2 - 0.07);
        const depth = 0.08;
        push(segBox(seg, hole.center - half + frame / 2, plane, bottomY + hole.height / 2, frame, hole.height, depth, "metal-dark", trim));
        push(segBox(seg, hole.center + half - frame / 2, plane, bottomY + hole.height / 2, frame, hole.height, depth, "metal-dark", trim));
        push(segBox(seg, hole.center, plane, bottomY + frame / 2, hole.width - frame * 2, frame, depth, "metal-dark", trim));
        push(segBox(seg, hole.center, plane, bottomY + hole.height - frame / 2, hole.width - frame * 2, frame, depth, "metal-dark", trim));
        const mullions = Math.max(0, Math.round(hole.width / 1.1) - 1);
        for (let index = 1; index <= mullions; index += 1) push(segBox(seg, hole.center - half + (hole.width / (mullions + 1)) * index, plane, bottomY + hole.height / 2, 0.04, hole.height - frame * 2, depth - 0.01, "metal-dark", trim));
        if (hole.height > 2.4) push(segBox(seg, hole.center, plane, bottomY + hole.height - 0.55, hole.width - frame * 2, 0.04, depth - 0.01, "metal-dark", trim));
        push(segBox(seg, hole.center, plane, bottomY + hole.height / 2, hole.width - frame * 2, hole.height - frame * 2, 0.02, "glass"));
        // 窗台顶面比洞口下沿低 5 毫米，不和墙洞的底面共面。
        if (hole.kind !== "floor") push(segBox(seg, hole.center, out * (seg.t / 2 + 0.03), bottomY - 0.025, hole.width + 0.14, 0.04, 0.2, "stone", "#d9d4cc"));
        return;
    }
    const jamb = 0.05;
    const depth = seg.t + 0.02;
    const leafColor = shade(spec.palette.wood, -0.35);
    push(segBox(seg, hole.center - half + jamb / 2, 0, bottomY + hole.height / 2, jamb, hole.height, depth, "wood-dark", hole.kind === "door" ? spec.palette.wood : trim));
    push(segBox(seg, hole.center + half - jamb / 2, 0, bottomY + hole.height / 2, jamb, hole.height, depth, "wood-dark", hole.kind === "door" ? spec.palette.wood : trim));
    push(segBox(seg, hole.center, 0, bottomY + hole.height - jamb / 2, hole.width - jamb * 2, jamb, depth, "wood-dark", hole.kind === "door" ? spec.palette.wood : trim));
    const inner = hole.width - jamb * 2;
    const leafHeight = hole.height - jamb - 0.01;
    if (hole.kind === "entry") {
        const leaves = hole.width > 1.4 ? 2 : 1;
        for (let index = 0; index < leaves; index += 1) {
            const leafWidth = inner / leaves - 0.005;
            const center = hole.center - inner / 2 + (inner / leaves) * (index + 0.5);
            push(segBox(seg, center, out * (seg.t / 2 - 0.08), bottomY + leafHeight / 2, leafWidth, leafHeight, 0.05, "wood-dark", leafColor));
            const handle = center + (leaves === 2 ? (index ? -1 : 1) : 1) * (leafWidth / 2 - 0.12);
            push(segBox(seg, handle, out * (seg.t / 2 - 0.04), bottomY + 1.0, 0.03, 0.35, 0.03, "metal", "#c9a46a"));
        }
        if (level.index === 0 && level.top > 0.05) {
            const steps = Math.max(1, Math.round(level.top / 0.15));
            for (let index = 0; index < steps; index += 1) {
                const height = level.top - index * (level.top / steps);
                push(segBox(seg, hole.center, out * (seg.t / 2 + 0.16 + index * 0.32), height / 2, hole.width + 0.8, height, 0.32, "stone", "#b8b3aa"));
            }
        }
        push(segBox(seg, hole.center, out * (seg.t / 2 + 0.6), bottomY + hole.height + 0.3, hole.width + 1.2, 0.12, 1.2, "concrete", shade(spec.palette.wall, -0.06)));
        return;
    }
    if (hole.kind === "slide") {
        const panel = inner / 2 + 0.04;
        for (let index = 0; index < 2; index += 1) {
            const center = hole.center + (index ? 1 : -1) * (inner / 4 - 0.02);
            const across = (index ? 1 : -1) * 0.025;
            push(segBox(seg, center, across, bottomY + leafHeight / 2, panel - 0.08, leafHeight - 0.08, 0.02, "glass"));
            push(segBox(seg, center - panel / 2 + 0.02, across, bottomY + leafHeight / 2, 0.04, leafHeight, 0.04, "metal-dark", trim));
            push(segBox(seg, center + panel / 2 - 0.02, across, bottomY + leafHeight / 2, 0.04, leafHeight, 0.04, "metal-dark", trim));
            push(segBox(seg, center, across, bottomY + 0.02, panel - 0.08, 0.04, 0.04, "metal-dark", trim));
            push(segBox(seg, center, across, bottomY + leafHeight - 0.02, panel - 0.08, 0.04, 0.04, "metal-dark", trim));
        }
    }
}

/** 栏杆：玻璃栏板、金属栏杆或实心栏板，沿 edge 从 from 到 to，底面在 y。 */
function railing(axis: "x" | "z", line: number, from: number, to: number, y: number, style: "glass" | "metal" | "solid", spec: SceneSpec, group: string): SceneObject[] {
    const seg = { axis, line };
    const length = to - from;
    if (length < 0.2) return [];
    const center = (from + to) / 2;
    const trim = spec.palette.trim;
    if (style === "solid")
        return [
            { ...segBox(seg, center, 0, y + 0.5, length, 1.0, 0.12, "wall", spec.palette.wall), group },
            { ...segBox(seg, center, 0, y + 1.02, length + 0.02, 0.04, 0.16, "stone", "#d9d4cc"), group },
        ];
    const parts: SceneObject[] = [{ ...segBox(seg, center, 0, y + 1.05, length, 0.05, 0.06, "metal-dark", trim), group }];
    if (style === "glass") {
        // 玻璃两头各让出 5 厘米，拐角处不和另一边的立柱共面。
        parts.push({ ...segBox(seg, center, 0, y + 0.53, length - 0.1, 0.9, 0.02, "glass", "#cfe0e6"), group });
        const posts = Math.max(2, Math.round(length / 1.5) + 1);
        for (let index = 0; index < posts; index += 1) parts.push({ ...segBox(seg, from + 0.02 + ((length - 0.04) / (posts - 1)) * index, 0, y + 0.53, 0.04, 1.05, 0.04, "metal-dark", trim), group });
        return parts;
    }
    parts.push({ ...segBox(seg, center, 0, y + 0.1, length, 0.04, 0.04, "metal-dark", trim), group });
    const count = Math.min(60, Math.max(2, Math.floor(length / 0.14)));
    const step = (length - 0.04) / (count - 1);
    const first = segBox(seg, from + 0.02, 0, y + 0.58, 0.02, 0.92, 0.02, "metal-dark", trim);
    parts.push({ ...first, group, repeat: { count, step: axis === "x" ? [r3(step), 0, 0] : [0, 0, r3(step)] } });
    return parts;
}

/** 沿一条边找出外侧不是房间（也没有墙）的区间：栏杆、女儿墙只做这些地方。 */
function exposedIntervals(edge: Edge, outward: -1 | 1, covered: (x: number, z: number) => boolean, breaks: number[]) {
    const points = uniqueSorted([edge.from, edge.to, ...breaks.filter((value) => value > edge.from + EPS && value < edge.to - EPS)]);
    const result: [number, number][] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const middle = (points[index] + points[index + 1]) / 2;
        const [x, z] = edge.axis === "x" ? [middle, edge.line + outward * 0.05] : [edge.line + outward * 0.05, middle];
        if (covered(x, z)) continue;
        const last = result[result.length - 1];
        if (last && Math.abs(last[1] - points[index]) < EPS) last[1] = points[index + 1];
        else result.push([points[index], points[index + 1]]);
    }
    return result;
}

function stairs(level: FloorLevel, next: FloorLevel, spec: SceneSpec, objects: SceneObject[]) {
    for (const stair of level.floor.stairs) {
        const [x1, z1, x2, z2] = stair.rect;
        const alongZ = stair.up === "n" || stair.up === "s";
        const run = alongZ ? z2 - z1 : x2 - x1;
        const width = alongZ ? x2 - x1 : z2 - z1;
        const rise = next.top - level.top;
        const steps = Math.max(8, Math.min(30, Math.round(rise / 0.175)));
        const tread = run / steps;
        const stepRise = rise / steps;
        const forward = stair.up === "n" || stair.up === "w" ? -1 : 1;
        const start = forward > 0 ? (alongZ ? z1 : x1) : alongZ ? z2 : x2;
        for (let index = 0; index < steps; index += 1) {
            const along = start + forward * tread * (index + 0.5);
            const height = stepRise * (index + 1);
            const center = alongZ ? (x1 + x2) / 2 : (z1 + z2) / 2;
            // 踏步不取整：相邻两级的侧面在同一平面上，取整后会互相压住一点点而闪烁。
            const position: SceneVector = alongZ ? [center, level.top + height / 2, along] : [along, level.top + height / 2, center];
            const size: SceneVector = alongZ ? [width, height, tread] : [tread, height, width];
            objects.push({ shape: "box", position, size, material: "wood", color: spec.palette.wood, group: level.group });
        }
        // 扶手：沿楼梯一侧斜着上去。
        const slope = Math.atan2(rise, run);
        const length = Math.hypot(run, rise);
        const side = alongZ ? x1 + 0.06 : z1 + 0.06;
        const middleAlong = start + (forward * run) / 2;
        const position: SceneVector = alongZ ? [r3(side), r3(level.top + rise / 2 + 0.9), r3(middleAlong)] : [r3(middleAlong), r3(level.top + rise / 2 + 0.9), r3(side)];
        const degrees = r3((slope * 180) / Math.PI) * (alongZ ? forward * -1 : forward);
        objects.push({ shape: "box", position, size: alongZ ? [0.05, 0.05, r3(length)] : [r3(length), 0.05, 0.05], rotation: alongZ ? [degrees, 0, 0] : [0, 0, degrees], material: "metal-dark", color: spec.palette.trim, group: level.group });
        const glassPosition: SceneVector = [position[0], r3(position[1] - 0.45), position[2]];
        objects.push({ shape: "box", position: glassPosition, size: alongZ ? [0.02, 0.85, r3(length)] : [r3(length), 0.85, 0.02], rotation: alongZ ? [degrees, 0, 0] : [0, 0, degrees], material: "glass", group: level.group });
    }
}

type Placement = { type: SpecFurnitureType; x: number; z: number; w: number; d: number; rotation: number; color?: string };

type RoomFurniture = { type: SpecFurnitureType; at: SpecAnchor; rotate?: number; size?: [number, number]; color?: string };

/** 没写家具的房间按类型自动配一套。 */
function defaultFurniture(room: SpecRoom, width: number, depth: number): RoomFurniture[] {
    const area = width * depth;
    switch (room.type) {
        case "living":
            return [
                { type: width >= 4.2 && depth >= 4 ? "sofa-l" : "sofa", at: "n" },
                { type: "tv-cabinet", at: "s" },
                { type: "rug", at: "c" },
                { type: "coffee-table", at: "c" },
                { type: "floor-lamp", at: "nw" },
                { type: "plant", at: "se" },
                { type: "pendant", at: "c" },
            ];
        case "dining":
            return [{ type: "dining-table", at: "c" }, { type: "pendant", at: "c" }, ...(width >= 3 ? [{ type: "cabinet", at: "w" } as RoomFurniture] : [])];
        case "kitchen":
            return [{ type: "kitchen-line", at: "n" }, ...(depth >= 2.4 ? [{ type: "fridge", at: "e" } as RoomFurniture] : []), ...(area >= 12 ? [{ type: "kitchen-island", at: "c" } as RoomFurniture] : [])];
        case "master":
        case "bedroom":
            return [{ type: "bed", at: "n" }, { type: "wardrobe", at: "w" }, ...(room.type === "master" && width >= 3.6 ? [{ type: "dresser", at: "e" } as RoomFurniture] : []), { type: "plant", at: "se" }, { type: "pendant", at: "c" }];
        case "kids":
            return [
                { type: "bed-single", at: "w" },
                { type: "desk", at: "e" },
                { type: "wardrobe", at: "n" },
                { type: "rug", at: "c" },
            ];
        case "study":
            return [
                { type: "desk", at: "n" },
                { type: "bookshelf", at: "w" },
                { type: "armchair", at: "se" },
                { type: "plant", at: "ne" },
            ];
        case "bathroom":
            return [{ type: "vanity", at: "n" }, { type: "toilet", at: "n" }, area >= 6 ? { type: "bathtub", at: "s" } : { type: "shower", at: "e" }];
        case "entry":
            return [
                { type: "shoe-cabinet", at: "w" },
                { type: "plant", at: "ne" },
            ];
        case "tea":
            return [
                { type: "tea-table", at: "c" },
                { type: "bookshelf", at: "n" },
                { type: "plant", at: "se" },
            ];
        case "theater":
            return [
                { type: "sofa", at: "n" },
                { type: "tv-cabinet", at: "s" },
                { type: "rug", at: "c" },
            ];
        case "garage":
            return width >= 2.4 && depth >= 4.8 ? [{ type: "car", at: "c" }] : [];
        case "laundry":
            return [
                { type: "washer", at: "n" },
                { type: "washer", at: "n" },
            ];
        case "closet":
            return [
                { type: "wardrobe", at: "n" },
                { type: "wardrobe", at: "w" },
            ];
        case "balcony":
            return [
                { type: "plant", at: "ne" },
                { type: "armchair", at: "c" },
            ];
        default:
            return [];
    }
}

const ANCHOR_ROTATION: Record<SpecSide, number> = { n: 0, s: 180, w: 90, e: -90 };

/**
 * 摆家具：靠墙的按顺序沿那面墙排（避开门），不靠墙的放在剩下空间的中央或角上。
 * 家具大于可用空间时按比例缩小，缩到原来六成以下就不摆。
 */
function layoutRoom(clear: SpecRect, doors: Record<SpecSide, [number, number][]>, walled: Set<SpecSide>, requested: RoomFurniture[]): Placement[] {
    const placements: Placement[] = [];
    // 靠墙的家具写在没有墙的一边（开放式连通）时，改靠对面的墙，再不行靠两侧，四面都没墙就放中间。
    const opposite: Record<SpecSide, SpecSide[]> = { n: ["s", "w", "e"], s: ["n", "w", "e"], w: ["e", "n", "s"], e: ["w", "n", "s"] };
    const items = requested.map((item) => {
        if (!(["n", "s", "e", "w"] as SpecAnchor[]).includes(item.at) || !FURNITURE_TYPES[item.type].wall || walled.has(item.at as SpecSide)) return item;
        const side = opposite[item.at as SpecSide].find((candidate) => walled.has(candidate));
        return { ...item, at: side || ("c" as SpecAnchor) };
    });
    const used: Record<SpecSide, number> = { n: 0, s: 0, e: 0, w: 0 };
    const [cx1, cz1, cx2, cz2] = clear;
    for (const side of ["n", "s", "w", "e"] as SpecSide[]) {
        const onWall = items.filter((item) => item.at === side && FURNITURE_TYPES[item.type].wall);
        if (!onWall.length) continue;
        const [from, to] = side === "n" || side === "s" ? [cx1 + 0.05, cx2 - 0.05] : [cz1 + 0.05, cz2 - 0.05];
        let free: [number, number][] = [[from, to]];
        for (const [doorFrom, doorTo] of doors[side]) {
            free = free.flatMap(([a, b]) => {
                if (doorTo <= a || doorFrom >= b) return [[a, b] as [number, number]];
                return [
                    [a, doorFrom],
                    [doorTo, b],
                ].filter(([x, y]) => y - x > 0.3) as [number, number][];
            });
        }
        const sizes = onWall.map((item) => item.size || ([...FURNITURE_TYPES[item.type].size] as [number, number]));
        const total = sizes.reduce((sum, [w]) => sum + w, 0) + 0.1 * (onWall.length - 1);
        const largest = [...free].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        let cursor: number | null = largest && largest[1] - largest[0] >= total ? (largest[0] + largest[1]) / 2 - total / 2 : null;
        onWall.forEach((item, index) => {
            let [w, d] = sizes[index];
            let center: number | null = null;
            if (cursor !== null) {
                center = cursor + w / 2;
                cursor += w + 0.1;
            } else {
                const fit = free.find(([a, b]) => b - a >= w) || [...free].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
                if (!fit) return;
                if (fit[1] - fit[0] < w) {
                    if (fit[1] - fit[0] < w * 0.6) return;
                    w = fit[1] - fit[0];
                }
                center = fit[0] + w / 2;
                fit[0] += w + 0.1;
            }
            const roomDepth = side === "n" || side === "s" ? cz2 - cz1 : cx2 - cx1;
            d = Math.min(d, roomDepth * 0.7);
            used[side] = Math.max(used[side], d);
            const across = side === "n" ? cz1 + d / 2 + 0.02 : side === "s" ? cz2 - d / 2 - 0.02 : side === "w" ? cx1 + d / 2 + 0.02 : cx2 - d / 2 - 0.02;
            const [x, z] = side === "n" || side === "s" ? [center, across] : [across, center];
            placements.push({ type: item.type, x, z, w, d, rotation: ANCHOR_ROTATION[side], color: item.color });
        });
    }
    // 剩下的空间：去掉靠墙家具占的深度。
    const region: SpecRect = [cx1 + used.w, cz1 + used.n, cx2 - used.e, cz2 - used.s];
    const regionW = Math.max(0.6, region[2] - region[0]);
    const regionD = Math.max(0.6, region[3] - region[1]);
    for (const item of items) {
        const isWall = (["n", "s", "e", "w"] as SpecAnchor[]).includes(item.at) && FURNITURE_TYPES[item.type].wall && walled.has(item.at as SpecSide);
        if (isWall) continue;
        let [w, d] = item.size || ([...FURNITURE_TYPES[item.type].size] as [number, number]);
        let rotation = item.rotate ?? 0;
        if (item.rotate === undefined && w > d && regionD > regionW && item.type !== "car") rotation = 90;
        if (item.type === "car" && regionW > regionD) rotation = 90;
        const turned = rotation % 180 !== 0;
        const spanW = turned ? d : w;
        const spanD = turned ? w : d;
        const scale = Math.min(1, (regionW - 0.1) / spanW, (regionD - 0.1) / spanD);
        if (item.type !== "pendant" && scale < 0.6) continue;
        if (item.type === "rug" || item.type === "dining-table" || item.type === "kitchen-island" || item.type === "tea-table") {
            w *= Math.min(1, scale);
            d *= Math.min(1, scale);
        }
        const footW = (turned ? d : w) / 2 + 0.05;
        const footD = (turned ? w : d) / 2 + 0.05;
        const anchor = item.at;
        const centerX = (region[0] + region[2]) / 2;
        const centerZ = (region[1] + region[3]) / 2;
        const x = anchor.includes("e") ? region[2] - footW : anchor.includes("w") ? region[0] + footW : centerX;
        const z = anchor.includes("n") ? region[1] + footD : anchor.includes("s") ? region[3] - footD : centerZ;
        placements.push({ type: item.type, x: item.type === "pendant" ? (cx1 + cx2) / 2 : x, z: item.type === "pendant" ? (cz1 + cz2) / 2 : z, w, d, rotation, color: item.color });
    }
    return placements;
}

/** 房间哪几面有墙（墙占这条边六成以上）。 */
function walledSides(room: SpecRoom, segs: Seg[]) {
    const sides = new Set<SpecSide>();
    for (const side of ["n", "s", "e", "w"] as SpecSide[]) {
        const edge = roomEdge(room.rect, side);
        const covered = segs.filter((seg) => seg.axis === edge.axis && Math.abs(seg.line - edge.line) < EPS).reduce((sum, seg) => sum + Math.max(0, Math.min(seg.b, edge.to) - Math.max(seg.a, edge.from)), 0);
        if (covered >= (edge.to - edge.from) * 0.6) sides.add(side);
    }
    return sides;
}

function clearRect(room: SpecRoom, segs: Seg[]): SpecRect {
    const inset = (side: SpecSide) => {
        const edge = roomEdge(room.rect, side);
        const middle = (edge.from + edge.to) / 2;
        const seg = segs.find((item) => item.axis === edge.axis && Math.abs(item.line - edge.line) < EPS && item.a <= middle + EPS && item.b >= middle - EPS);
        return seg ? seg.t / 2 : 0;
    };
    return [room.rect[0] + inset("w"), room.rect[1] + inset("n"), room.rect[2] - inset("e"), room.rect[3] - inset("s")];
}

function doorIntervals(room: SpecRoom, segs: Seg[]): Record<SpecSide, [number, number][]> {
    const result: Record<SpecSide, [number, number][]> = { n: [], s: [], e: [], w: [] };
    for (const side of ["n", "s", "e", "w"] as SpecSide[]) {
        const edge = roomEdge(room.rect, side);
        for (const seg of segs) {
            if (seg.axis !== edge.axis || Math.abs(seg.line - edge.line) > EPS) continue;
            for (const hole of seg.holes) {
                if (hole.kind !== "door" && hole.kind !== "entry" && hole.kind !== "slide") continue;
                const from = hole.center - hole.width / 2 - 0.15;
                const to = hole.center + hole.width / 2 + 0.15;
                if (to > edge.from && from < edge.to) result[side].push([from, to]);
            }
        }
    }
    return result;
}

function furnitureObjects(placement: Placement, spec: SceneSpec, y: number, ceiling: number, group: string, seed: number): SceneObject[] {
    const parts: FurniturePart[] = buildFurniture(placement.type, placement.w, placement.d, { palette: spec.palette, color: placement.color, ceiling, seed });
    return parts.map((part) => ({ ...place(part, [r3(placement.x), r3(y), r3(placement.z)], placement.rotation), euler: "YXZ", group }));
}

function tree(at: [number, number], size: "s" | "m" | "l", kind: "round" | "cone" | "shrub", seed: number): SceneObject[] {
    const scale = size === "s" ? 0.65 : size === "l" ? 1.4 : 1;
    const greens = ["#4f8a4a", "#5d9450", "#3f7a45", "#6a9a58"];
    const [x, z] = at;
    const group = SITE_GROUP;
    if (kind === "shrub") {
        return [0, 1, 2].map(
            (index) =>
                ({
                    shape: "sphere",
                    radius: r3(0.42 * scale * (1 - index * 0.15)),
                    position: [r3(x + (index - 1) * 0.35 * scale), r3(0.32 * scale), r3(z + ((index * 7 + seed) % 3) * 0.12 - 0.12)],
                    scale: [1, 0.8, 1],
                    material: "plant",
                    color: greens[(seed + index) % greens.length],
                    group,
                }) as SceneObject,
        );
    }
    const trunk: SceneObject = { shape: "cylinder", radius: r3(0.1 * scale), radiusTop: r3(0.07 * scale), height: r3(2.2 * scale), position: [x, r3(1.1 * scale), z], material: "wood-dark", color: "#6b4a33", group };
    if (kind === "cone")
        return [
            trunk,
            ...[0, 1, 2].map(
                (index) =>
                    ({
                        shape: "cone",
                        radius: r3((1.3 - index * 0.32) * scale),
                        height: r3((1.8 - index * 0.3) * scale),
                        position: [x, r3((2.0 + index * 1.0) * scale), z],
                        material: "plant",
                        color: greens[(seed + index) % greens.length],
                        group,
                    }) as SceneObject,
            ),
        ];
    return [
        trunk,
        { shape: "sphere", radius: r3(1.25 * scale), position: [x, r3(3.0 * scale), z], material: "plant", color: greens[seed % greens.length], scale: [1, 0.9, 1], group },
        { shape: "sphere", radius: r3(0.85 * scale), position: [r3(x + 0.7 * scale), r3(3.5 * scale), r3(z + 0.3 * scale)], material: "plant", color: greens[(seed + 1) % greens.length], group },
        { shape: "sphere", radius: r3(0.8 * scale), position: [r3(x - 0.6 * scale), r3(3.6 * scale), r3(z - 0.4 * scale)], material: "plant", color: greens[(seed + 2) % greens.length], group },
    ];
}

function site(spec: SceneSpec, objects: SceneObject[]) {
    const yard = spec.site;
    if (!yard) return;
    const group = SITE_GROUP;
    let layer = 0;
    // 铺装让开泳池（含池边 0.3 米的压顶），不然会盖住水面。
    const poolRims = yard.pools.map(([x1, z1, x2, z2]): SpecRect => [x1 - 0.3, z1 - 0.3, x2 + 0.3, z2 + 0.3]);
    for (const paving of yard.paving) {
        const height = 0.04 + layer * 0.006;
        layer += 1;
        const look =
            paving.material === "wood"
                ? { material: "wood" as const, color: "#a07a55", texture: "planks" as const }
                : paving.material === "concrete"
                  ? { material: "concrete" as const, color: "#c7c3bc" }
                  : { material: "stone" as const, color: "#b9b4ab", texture: "paving" as const };
        for (const [x1, z1, x2, z2] of gridRegion([paving.rect], poolRims)) objects.push({ shape: "box", position: [r3((x1 + x2) / 2), r3(height / 2), r3((z1 + z2) / 2)], size: [r3(x2 - x1), r3(height), r3(z2 - z1)], ...look, group });
    }
    for (const path of yard.paths) {
        const height = 0.03 + layer * 0.006;
        layer += 1;
        const dx = path.to[0] - path.from[0];
        const dz = path.to[1] - path.from[1];
        const length = Math.hypot(dx, dz);
        objects.push({
            shape: "box",
            position: [r3((path.from[0] + path.to[0]) / 2), r3(height / 2), r3((path.from[1] + path.to[1]) / 2)],
            size: [r3(path.width), r3(height), r3(length)],
            rotation: [0, r3((Math.atan2(dx, dz) * 180) / Math.PI), 0],
            material: "stone",
            color: "#c9c4ba",
            texture: "paving",
            group,
        });
    }
    for (const pool of yard.pools) {
        const [x1, z1, x2, z2] = pool;
        const depth = 1.2;
        const w = x2 - x1;
        const d = z2 - z1;
        const cx = (x1 + x2) / 2;
        const cz = (z1 + z2) / 2;
        objects.push({ shape: "box", position: [r3(cx), -depth, r3(cz)], size: [r3(w - 0.1), 0.05, r3(d - 0.1)], material: "tile", color: "#7fb4c8", group });
        for (const [px, pz, sw, sd] of [
            [cx, z1 + 0.025, w, 0.05],
            [cx, z2 - 0.025, w, 0.05],
            [x1 + 0.025, cz, 0.05, d - 0.1],
            [x2 - 0.025, cz, 0.05, d - 0.1],
        ])
            objects.push({ shape: "box", position: [r3(px), r3(-depth / 2), r3(pz)], size: [r3(sw), depth, r3(sd)], material: "tile", color: "#9cc6d4", group });
        objects.push({ shape: "box", position: [r3(cx), -0.2, r3(cz)], size: [r3(w - 0.1), 0.02, r3(d - 0.1)], material: "water", group });
        for (const [px, pz, sw, sd] of [
            [cx, z1 - 0.15, w + 0.6, 0.3],
            [cx, z2 + 0.15, w + 0.6, 0.3],
            [x1 - 0.15, cz, 0.3, d],
            [x2 + 0.15, cz, 0.3, d],
        ])
            objects.push({ shape: "box", position: [r3(px), 0.03, r3(pz)], size: [r3(sw), 0.06, r3(sd)], material: "stone", color: "#e3dfd8", group });
    }
    yard.trees.forEach((item, index) => objects.push(...tree(item.at, item.size, item.kind, index)));
    for (const [x, z] of yard.lights)
        objects.push({ shape: "cylinder", radius: 0.04, height: 0.7, position: [x, 0.35, z], material: "metal-dark", color: "#2b2d30", group }, { shape: "box", size: [0.14, 0.14, 0.14], position: [x, 0.75, z], material: "light", group });
    yard.furniture.forEach((item, index) => {
        const [w, d] = item.size || [...FURNITURE_TYPES[item.type].size];
        objects.push(...furnitureObjects({ type: item.type, x: item.at[0], z: item.at[1], w, d, rotation: item.rotate ?? 0, color: item.color }, spec, 0, 3, group, index));
    });
    const fence = yard.fence;
    if (!fence) return;
    const [x1, z1, x2, z2] = fence.rect;
    const t = fence.style === "hedge" ? 0.6 : 0.2;
    // 南北两边伸到角上，东西两边让开；墙帽比墙厚 6 厘米，按同样的规则算，拐角不重叠。
    const sides = (delta: number): { side: SpecSide; axis: "x" | "z"; line: number; from: number; to: number }[] => [
        { side: "n", axis: "x", line: z1, from: x1 - (t + delta) / 2, to: x2 + (t + delta) / 2 },
        { side: "s", axis: "x", line: z2, from: x1 - (t + delta) / 2, to: x2 + (t + delta) / 2 },
        { side: "w", axis: "z", line: x1, from: z1 + (t + delta) / 2, to: z2 - (t + delta) / 2 },
        { side: "e", axis: "z", line: x2, from: z1 + (t + delta) / 2, to: z2 - (t + delta) / 2 },
    ];
    const pieces = (item: { side: SpecSide; from: number; to: number }): [number, number][] =>
        fence.gate === item.side
            ? [
                  [item.from, (item.from + item.to) / 2 - fence.gateWidth / 2],
                  [(item.from + item.to) / 2 + fence.gateWidth / 2, item.to],
              ]
            : [[item.from, item.to]];
    const caps = sides(0.06);
    sides(0).forEach((item, index) => {
        for (const [from, to] of pieces(item)) {
            if (to - from < 0.2) continue;
            if (fence.style === "rail") objects.push(...railing(item.axis, item.line, from, to, 0, "metal", spec, group));
            else if (fence.style === "hedge") objects.push({ ...segBox(item, (from + to) / 2, 0, fence.height / 2, to - from, fence.height, t, "plant", "#4f8a4a"), shape: "rbox", round: 0.15, group });
            else objects.push({ ...segBox(item, (from + to) / 2, 0, fence.height / 2, to - from, fence.height, t, "wall", spec.palette.wall), group });
        }
        if (fence.style === "wall") for (const [from, to] of pieces(caps[index])) if (to - from > 0.2) objects.push({ ...segBox(item, (from + to) / 2, 0, fence.height + 0.03, to - from, 0.06, t + 0.06, "stone", "#d9d4cc"), group });
        if (fence.gate === item.side && fence.style !== "hedge") {
            const center = (item.from + item.to) / 2;
            objects.push({ ...segBox(item, center, 0, 0.75, fence.gateWidth - 0.1, 1.3, 0.04, "metal-dark", spec.palette.trim), group });
        }
    });
}

type Roofed = { rect: SpecRect; pitch: number };

function roofRects(footprint: SpecRect[]): SpecRect[] {
    const bounds: SpecRect = [Math.min(...footprint.map((rect) => rect[0])), Math.min(...footprint.map((rect) => rect[1])), Math.max(...footprint.map((rect) => rect[2])), Math.max(...footprint.map((rect) => rect[3]))];
    const area = footprint.reduce((sum, rect) => sum + (rect[2] - rect[0]) * (rect[3] - rect[1]), 0);
    if (area >= (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) * 0.85) return [bounds];
    return [...footprint].sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1])).slice(0, 4);
}

function pitchedRoof(item: Roofed, spec: SceneSpec, y: number, objects: SceneObject[]) {
    const { overhang } = spec.roof;
    const color = spec.roof.color || spec.palette.roof;
    const [x1, z1, x2, z2] = item.rect;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const w = x2 - x1;
    const d = z2 - z1;
    const tan = Math.tan((item.pitch * Math.PI) / 180);
    const group = ROOF_GROUP;
    if (spec.roof.type === "hip") {
        const ow = w + overhang * 2;
        const od = d + overhang * 2;
        const rise = (Math.min(ow, od) / 2) * tan;
        objects.push({ shape: "hip", size: [r3(ow), r3(rise), r3(od)], position: [r3(cx), r3(y + rise / 2), r3(cz)], material: "roof", color, texture: "roof", group });
        for (const [px, pz, sw, sd] of [
            [cx, cz - od / 2 + 0.03, ow, 0.06],
            [cx, cz + od / 2 - 0.03, ow, 0.06],
            [cx - ow / 2 + 0.03, cz, 0.06, od - 0.12],
            [cx + ow / 2 - 0.03, cz, 0.06, od - 0.12],
        ])
            objects.push({ shape: "box", position: [r3(px), r3(y - 0.09), r3(pz)], size: [r3(sw), 0.18, r3(sd)], material: "wood-dark", color: shade(color, -0.2), group });
        return;
    }
    // 双坡：两块有厚度的屋面板搭在三角形山墙上。
    const ridgeX = spec.roof.ridge ? spec.roof.ridge === "x" : w >= d;
    const span = ridgeX ? d : w;
    const length = ridgeX ? w : d;
    const rise = (span / 2) * tan;
    const thickness = 0.14;
    objects.push({ shape: "prism", size: [r3(span), r3(rise), r3(length)], position: [r3(cx), r3(y + rise / 2), r3(cz)], ...(ridgeX ? { rotation: [0, 90, 0] as SceneVector } : {}), material: "wall", color: spec.palette.wall, group });
    const slope = Math.atan(tan);
    const plateLength = (span / 2 + overhang) / Math.cos(slope);
    for (const sideSign of [-1, 1]) {
        const midAcross = (sideSign * (span / 2 + overhang)) / 2;
        const midY = y + (rise - overhang * tan) / 2;
        const normalAcross = Math.sin(slope) * sideSign;
        const normalY = Math.cos(slope);
        const across = midAcross + (normalAcross * thickness) / 2;
        const py = midY + (normalY * thickness) / 2;
        const degrees = r3((slope * 180) / Math.PI);
        if (ridgeX) objects.push({ shape: "box", position: [r3(cx), r3(py), r3(cz + across)], size: [r3(length + overhang * 2), thickness, r3(plateLength)], rotation: [sideSign * degrees, 0, 0], material: "roof", color, texture: "roof", group });
        else objects.push({ shape: "box", position: [r3(cx + across), r3(py), r3(cz)], size: [r3(plateLength), thickness, r3(length + overhang * 2)], rotation: [0, 0, -sideSign * degrees], material: "roof", color, texture: "roof", group });
    }
    objects.push(
        ridgeX
            ? { shape: "box", position: [r3(cx), r3(y + rise + thickness), r3(cz)], size: [r3(length + overhang * 2), 0.1, 0.22], material: "roof", color: shade(color, -0.15), group }
            : { shape: "box", position: [r3(cx), r3(y + rise + thickness), r3(cz)], size: [0.22, 0.1, r3(length + overhang * 2)], material: "roof", color: shade(color, -0.15), group },
    );
}

/** 编译整份方案。 */
export function compileSceneSpec(spec: SceneSpec, options: CompileOptions = {}): CompiledScene {
    const objects: SceneObject[] = [];
    const labels: SceneLabel[] = [];
    const building = spec.scope === "building";
    const cut = options.cutFloor !== undefined && options.cutFloor >= 0 && options.cutFloor < spec.floors.length ? options.cutFloor : undefined;
    const visibleFloors = cut === undefined ? spec.floors : spec.floors.slice(0, cut + 1);
    const levels: FloorLevel[] = [];
    let top = building ? PLINTH : 0;
    spec.floors.forEach((floor, index) => {
        const last = index === spec.floors.length - 1;
        const wallTop = last ? top + floor.height : top + floor.height - SLAB;
        const level: FloorLevel = { floor, index, top, wallBase: top, wallTop, segs: solveWalls(floor.rooms, floor.open), group: floor.name };
        placeOpenings(level, spec.scope);
        levels.push(level);
        top += floor.height;
    });
    const groundY = building ? 0 : -0.12;
    for (const [index, level] of levels.entries()) {
        if (index >= visibleFloors.length) break;
        const { floor, segs, group } = level;
        const below = levels[index - 1];
        const extRects = (item: FloorLevel) => item.segs.filter((seg) => seg.ext).map((seg) => segRect(seg));
        // 结构板：盖住这一层和下一层的平面（下一层多出来的部分就是露台），减去下面一层的楼梯洞。
        const include = [...floor.rooms.map((room) => room.rect), ...extRects(level), ...floor.balconies.map((item) => item.rect), ...(below ? [...below.floor.rooms.map((room) => room.rect), ...extRects(below)] : [])];
        const holes = below ? below.floor.stairs.map((item) => item.rect) : [];
        const slabBottom = index === 0 ? groundY : level.top - SLAB;
        const slabColor = index === 0 && building ? "#9d978d" : shade(spec.palette.wall, -0.1);
        for (const rect of gridRegion(include, holes))
            objects.push({
                shape: "box",
                position: [r3((rect[0] + rect[2]) / 2), r3((slabBottom + level.top) / 2), r3((rect[1] + rect[3]) / 2)],
                size: [r3(rect[2] - rect[0]), r3(level.top - slabBottom), r3(rect[3] - rect[1])],
                material: index === 0 && building ? "stone" : "concrete",
                color: slabColor,
                group,
            });
        // 地面面层：每个房间一块，露台和阳台铺石材。
        for (const room of floor.rooms) {
            const look = FINISH_LOOK[room.floor || defaultFinish(room.type)];
            for (const rect of gridRegion([room.rect], holes))
                objects.push({
                    shape: "box",
                    position: [r3((rect[0] + rect[2]) / 2), r3(level.top + FINISH / 2), r3((rect[1] + rect[3]) / 2)],
                    size: [r3(rect[2] - rect[0]), FINISH, r3(rect[3] - rect[1])],
                    material: look.material,
                    ...(look.color ? { color: look.color } : {}),
                    ...(look.texture ? { texture: look.texture } : {}),
                    group,
                });
        }
        const terraces = below
            ? gridRegion(
                  below.floor.rooms.map((room) => room.rect),
                  floor.rooms.map((room) => room.rect),
              )
            : [];
        for (const rect of [...terraces, ...floor.balconies.map((item) => item.rect)])
            objects.push({
                shape: "box",
                position: [r3((rect[0] + rect[2]) / 2), r3(level.top + FINISH / 2), r3((rect[1] + rect[3]) / 2)],
                size: [r3(rect[2] - rect[0]), FINISH, r3(rect[3] - rect[1])],
                material: "stone",
                color: "#c4bfb6",
                texture: "paving",
                group,
            });
        // 墙。
        const extMaterial: SceneMaterial = floor.wallMaterial || "wall";
        const extColor = floor.wallColor || (extMaterial === "wall" ? spec.palette.wall : undefined);
        for (const seg of segs) {
            let cap = level.wallTop;
            if (cut === index) cap = Math.min(cap, level.top + CUT_HEIGHT);
            if (spec.scope === "room" && seg.ext && seg.out === 1) cap = Math.min(cap, level.top + DOLLHOUSE_HEIGHT);
            const height = cap - level.wallBase;
            const openings: SceneOpening[] = [];
            const { a } = segEnds(seg);
            for (const hole of seg.holes) {
                const bottom = level.top - level.wallBase + hole.bottom;
                const holeHeight = Math.min(hole.height, height - bottom - 0.05);
                // 墙被剖低时：门洞照样开着，窗洞只开一截就不开了（矮墙上留个缺口很难看）。
                const isDoor = hole.kind === "door" || hole.kind === "entry" || hole.kind === "slide";
                if (holeHeight < 0.3 || (!isDoor && holeHeight < hole.height - 0.01)) continue;
                openings.push({ kind: "hole", offset: r3(hole.center - a), width: hole.width, bottom: r3(bottom), height: r3(holeHeight) });
                if (holeHeight >= hole.height - 0.01) openingDetails(level, seg, hole, spec, objects);
            }
            const { b } = segEnds(seg);
            const [sx, sz] = onSeg(seg, a, 0);
            const [ex, ez] = onSeg(seg, b, 0);
            objects.push({
                shape: "wall",
                start: [sx, sz],
                end: [ex, ez],
                base: r3(level.wallBase),
                height: r3(height),
                thickness: seg.t,
                ...(openings.length ? { openings } : {}),
                material: seg.ext ? extMaterial : "wall",
                ...(seg.ext ? (extColor ? { color: extColor } : {}) : { color: spec.palette.interior }),
                ...(seg.ext && extMaterial === "brick" ? { texture: "brick" as const } : seg.ext && extMaterial === "stone" ? { texture: "stone" as const } : {}),
                group,
            });
        }
        // 露台边：下一层外墙露在外面的地方加栏杆。
        if (below) {
            const breaks = floor.rooms.flatMap((room) => [room.rect[0], room.rect[1], room.rect[2], room.rect[3]]);
            for (const seg of below.segs) {
                if (!seg.ext || !seg.out) continue;
                const edge: Edge = { axis: seg.axis, line: seg.line, from: seg.a, to: seg.b };
                const covered = (x: number, z: number) => {
                    const insideX = seg.axis === "x" ? x : seg.line - seg.out * 0.05;
                    const insideZ = seg.axis === "x" ? seg.line - seg.out * 0.05 : z;
                    return roomAt(floor.rooms, insideX, insideZ) >= 0 || segs.some((other) => other.axis === seg.axis && Math.abs(other.line - seg.line) < EPS && (seg.axis === "x" ? x : z) > other.a && (seg.axis === "x" ? x : z) < other.b);
                };
                for (const [from, to] of exposedIntervals(edge, seg.out as -1 | 1, covered, breaks)) objects.push(...railing(seg.axis, seg.line, from + 0.02, to - 0.02, level.top, "glass", spec, group));
            }
        }
        for (const balcony of floor.balconies) {
            const breaks = floor.rooms.flatMap((room) => [room.rect[0], room.rect[1], room.rect[2], room.rect[3]]);
            const covered = (x: number, z: number) => roomAt(floor.rooms, x, z) >= 0;
            for (const side of ["n", "s", "e", "w"] as SpecSide[]) {
                const edge = roomEdge(balcony.rect, side);
                const outward = side === "n" || side === "w" ? -1 : 1;
                for (const [from, to] of exposedIntervals(edge, outward, covered, breaks)) objects.push(...railing(edge.axis, edge.line + outward * -0.04, from, to, level.top, balcony.rail, spec, group));
            }
        }
        const next = levels[index + 1];
        if (next && index + 1 < visibleFloors.length) stairs(level, next, spec, objects);
        // 家具和标注。
        floor.rooms.forEach((room, roomIndex) => {
            const clear = clearRect(room, segs);
            const width = clear[2] - clear[0];
            const depth = clear[3] - clear[1];
            const listed = floor.furniture.filter((item) => item.room === room.name);
            const items = listed.length ? listed : defaultFurniture(room, width, depth);
            const ceiling = level.wallTop - level.top;
            for (const placement of layoutRoom(clear, doorIntervals(room, segs), walledSides(room, segs), items))
                objects.push(...furnitureObjects(placement, spec, level.top + FINISH, cut === index ? Math.min(ceiling, CUT_HEIGHT + 1.4) : ceiling, group, roomIndex));
            if (width * depth >= 2.5 && room.type !== "stair") labels.push({ text: room.name, position: [r3((room.rect[0] + room.rect[2]) / 2), r3(level.top + Math.min(1.5, ceiling * 0.5)), r3((room.rect[1] + room.rect[3]) / 2)] });
        });
    }
    // 屋顶。
    const topLevel = levels[levels.length - 1];
    if (cut === undefined && spec.roof.type !== "none") {
        const footprint = gridRegion([...topLevel.floor.rooms.map((room) => room.rect), ...topLevel.segs.filter((seg) => seg.ext).map((seg) => segRect(seg))]);
        const y = topLevel.wallTop;
        if (spec.roof.type === "flat") {
            for (const rect of footprint)
                objects.push({
                    shape: "box",
                    position: [r3((rect[0] + rect[2]) / 2), r3(y + 0.11), r3((rect[1] + rect[3]) / 2)],
                    size: [r3(rect[2] - rect[0]), 0.22, r3(rect[3] - rect[1])],
                    material: "concrete",
                    color: shade(spec.palette.wall, -0.12),
                    group: ROOF_GROUP,
                });
            for (const seg of topLevel.segs) {
                if (!seg.ext) continue;
                const { a, b } = segEnds(seg);
                const [sx, sz] = onSeg(seg, a, 0);
                const [ex, ez] = onSeg(seg, b, 0);
                objects.push({
                    shape: "wall",
                    start: [sx, sz],
                    end: [ex, ez],
                    base: r3(y + 0.22),
                    height: 0.6,
                    thickness: seg.t,
                    material: topLevel.floor.wallMaterial || "wall",
                    ...(topLevel.floor.wallColor || !topLevel.floor.wallMaterial ? { color: topLevel.floor.wallColor || spec.palette.wall } : {}),
                    group: ROOF_GROUP,
                });
                const cap = segEnds(seg, 0.06);
                objects.push({ ...segBox(seg, (cap.a + cap.b) / 2, 0, y + 0.85, cap.b - cap.a, 0.06, seg.t + 0.06, "stone", "#d9d4cc"), group: ROOF_GROUP });
            }
        } else {
            roofRects(footprint).forEach((rect, index) => pitchedRoof({ rect, pitch: spec.roof.pitch * (1 - index * 0.06) }, spec, y, objects));
        }
    }
    if (cut === undefined) site(spec, objects);
    // 地面：建筑按庭院大小，房间和户型按平面外扩一圈。
    const allRooms = spec.floors.flatMap((floor) => floor.rooms.map((room) => room.rect));
    const bounds: SpecRect = [Math.min(...allRooms.map((rect) => rect[0])), Math.min(...allRooms.map((rect) => rect[1])), Math.max(...allRooms.map((rect) => rect[2])), Math.max(...allRooms.map((rect) => rect[3]))];
    const center: [number, number] = [r3((bounds[0] + bounds[2]) / 2), r3((bounds[1] + bounds[3]) / 2)];
    const ground: CompiledScene["ground"] = spec.site
        ? {
              material: spec.site.ground === "grass" ? "grass" : spec.site.ground === "soil" ? "soil" : spec.site.ground === "stone" ? "stone" : "concrete",
              size: spec.site.size,
              center: [0, 0],
              y: 0,
              holes: cut === undefined ? spec.site.pools : [],
              ...(spec.site.ground === "grass" ? { texture: "grass" as const } : spec.site.ground === "stone" ? { texture: "paving" as const } : {}),
          }
        : { material: "concrete", color: "#e4e1dc", size: [r3(bounds[2] - bounds[0] + (building ? 12 : 3)), r3(bounds[3] - bounds[1] + (building ? 12 : 3))], center, y: groundY, holes: [] };
    return { title: spec.title, summary: spec.summary, ground, objects, labels, floors: spec.floors.map((floor) => floor.name) };
}

/** 页面渲染用：第一版场景直接用模型写的物体，第二版按方案现算。legacy 的场景物体可能互相重叠，渲染时要错开一点。 */
export type RenderModel = CompiledScene & { legacy: boolean; groups: string[] };

export function renderModel(scene: InteriorSceneData, options: CompileOptions = {}): RenderModel {
    if (scene.version === 2) {
        const compiled = compileSceneSpec(scene.spec, options);
        const groups = [...compiled.floors.slice(0, options.cutFloor !== undefined ? options.cutFloor + 1 : undefined)];
        if (options.cutFloor === undefined && scene.spec.roof.type !== "none") groups.push(ROOF_GROUP);
        if (options.cutFloor === undefined && scene.spec.site) groups.push(SITE_GROUP);
        return { ...compiled, legacy: false, groups };
    }
    const groups: string[] = [];
    for (const object of scene.objects) if (object.group && !groups.includes(object.group)) groups.push(object.group);
    return { title: scene.title, summary: scene.summary, ground: { material: scene.ground.material, size: scene.ground.size, center: [0, 0], y: -0.005, holes: [] }, objects: scene.objects, labels: scene.labels, floors: [], legacy: true, groups };
}

/** 模型列表和说明里的规模：第二版按房间和家具数，第一版按物体数。 */
export function sceneStats(scene: InteriorSceneData) {
    if (scene.version !== 2) return `${scene.objects.length} 个物体`;
    const rooms = scene.spec.floors.reduce((sum, floor) => sum + floor.rooms.length, 0);
    const floors = scene.spec.floors.length;
    return [floors > 1 ? `${floors} 层` : "", `${rooms} 个空间`].filter(Boolean).join(" · ");
}
