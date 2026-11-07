/**
 * 把第二版 3D 方案（scene-spec.ts）编译成渲染用的几何体列表。
 *
 * 墙：按房间矩形自动求出外墙（一侧没有房间）和内墙（两侧是不同房间），同一条线上连续的合成一面墙。
 * 拐角和丁字口按固定规则一面延长、一面截短，墙体之间不重叠、没有共面，所以不会闪。
 * 门窗按方案写的位置开洞（没写就居中或均匀排开），平开门按开向半开，另有飘窗、窗帘、踢脚线、柱子、挂画；
 * 楼板、楼梯、栏杆、屋顶、庭院和家具都由程序按真实尺寸生成。房间标注带开间 × 进深和面积，外围出尺寸线，方便和图纸对照。
 * 户型和单个房间的外墙带 facade 标记，查看器把朝向镜头的外墙剖开，从外面能直接看到室内。
 */
import type { SceneLabel, SceneMaterial, SceneObject, SceneOpening, SceneTexture, SceneVector } from "./scene-3d";
import { buildFurniture, place, type FurniturePart } from "./scene-furniture";
import {
    floorBounds,
    furnitureInfo,
    rectArea,
    sharedEdge,
    type InteriorSceneData,
    type SceneSpec,
    type SpecAnchor,
    type SpecDoor,
    type SpecFloor,
    type SpecFloorFinish,
    type SpecFurnitureType,
    type SpecRect,
    type SpecRoom,
    type SpecRoomType,
    type SpecSide,
} from "./scene-spec";

/** 尺寸线：平面上从 a 到 b，text 是毫米数；total 是最外一道总尺寸。 */
export type SceneDimension = { a: [number, number]; b: [number, number]; text: string; y: number; total?: boolean };

export type CompiledScene = {
    title: string;
    summary: string;
    ground: { material: SceneMaterial; size: [number, number]; center: [number, number]; y: number; holes: SpecRect[]; texture?: SceneTexture; color?: string };
    objects: SceneObject[];
    labels: SceneLabel[];
    dimensions: SceneDimension[];
    floors: string[];
    /** 第一层平面（含阳台）的外包框，叠图纸、取景用。 */
    plan: SpecRect;
};

/** cutFloor：剖切看某一层（更高的楼层和屋顶不显示，这层的墙只砌到 1.2 米）。 */
export type CompileOptions = { cutFloor?: number; onLayoutIssue?: (message: string) => void };

export const ROOF_GROUP = "屋顶";
export const SITE_GROUP = "庭院";

const EXT_T = 0.24;
const INT_T = 0.12;
const SLAB = 0.18;
const PLINTH = 0.45;
const FINISH = 0.012;
const EPS = 1e-4;
const CUT_HEIGHT = 1.2;
/** 外墙剖开后留下的矮墙高度。 */
const CURB = 0.12;
const BASE_H = 0.08;
const BASE_T = 0.012;

type Adj = { sign: -1 | 0 | 1; other: number };
type HoleKind = "window" | "floor" | "high" | "bay" | "door" | "double" | "slide" | "entry" | "opening";
/** swing：门扇开向墙的哪一侧（沿垂直墙的方向，+1 是坐标变大的一侧）；hinge：门轴在洞口哪一头（沿墙方向）。 */
type Hole = { center: number; width: number; bottom: number; height: number; kind: HoleKind; swing?: -1 | 1; hinge?: -1 | 1; depth?: number };
type Seg = { axis: "x" | "z"; line: number; a: number; b: number; ext: boolean; out: -1 | 0 | 1; t: number; adjA: Adj; adjB: Adj; holes: Hole[] };
type Facade = NonNullable<SceneObject["facade"]>;
type Interval = { seg: Seg; from: number; to: number };

const NONE: Adj = { sign: 0, other: 0 };
const DOOR_KINDS = new Set<HoleKind>(["door", "double", "slide", "entry", "opening"]);
const SIDES: SpecSide[] = ["n", "s", "w", "e"];
const OPPOSITE: Record<SpecSide, SpecSide> = { n: "s", s: "n", e: "w", w: "e" };
/** 靠在哪面墙 → 家具绕竖轴转多少度（家具局部正面朝 +z）。 */
const ANCHOR_ROTATION: Record<SpecSide, number> = { n: 0, s: 180, w: 90, e: 270 };

function r3(value: number) {
    return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value: number) {
    return ((Math.round(value) % 360) + 360) % 360;
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
    marble: { material: "marble", color: "#ece9e4", texture: "marble" },
    stone: { material: "stone", color: "#a9a49c", texture: "paving" },
    concrete: { material: "concrete", color: "#bdbab4" },
    carpet: { material: "fabric", color: "#cfc6b8", texture: "weave" },
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
function edgeIntervals(segs: Seg[], edge: Edge, ext: boolean): Interval[] {
    return segs
        .filter((seg) => seg.axis === edge.axis && Math.abs(seg.line - edge.line) < EPS && seg.ext === ext)
        .map((seg) => ({ seg, from: Math.max(seg.a, edge.from), to: Math.min(seg.b, edge.to) }))
        .filter((item) => item.to - item.from > 0.3)
        .sort((x, y) => y.to - y.from - (x.to - x.from));
}

/** 写了 at 就用 at 落在的那段（落在外面取最近的），没写取最长的一段。 */
function chooseInterval<T extends Interval>(intervals: T[], at?: number): T | undefined {
    if (!intervals.length) return undefined;
    if (at === undefined) return intervals.reduce((best, item) => (item.to - item.from > best.to - best.from ? item : best));
    const distance = (item: Interval) => (at < item.from ? item.from - at : at > item.to ? at - item.to : 0);
    return intervals.reduce((best, item) => (distance(item) < distance(best) ? item : best));
}

/** 两个矩形共用的那条边（不相邻时是 null）。 */
function sharedLine(a: SpecRect, b: SpecRect): Edge | null {
    if (Math.abs(a[3] - b[1]) < EPS || Math.abs(a[1] - b[3]) < EPS) {
        const from = Math.max(a[0], b[0]);
        const to = Math.min(a[2], b[2]);
        return to - from > 0.3 ? { axis: "x", line: Math.abs(a[3] - b[1]) < EPS ? a[3] : a[1], from, to } : null;
    }
    if (Math.abs(a[2] - b[0]) < EPS || Math.abs(a[0] - b[2]) < EPS) {
        const from = Math.max(a[1], b[1]);
        const to = Math.min(a[3], b[3]);
        return to - from > 0.3 ? { axis: "z", line: Math.abs(a[2] - b[0]) < EPS ? a[2] : a[0], from, to } : null;
    }
    return null;
}

/** 矩形在一条边线的哪一侧。 */
function sideOfLine(edge: Pick<Edge, "axis" | "line">, rect: SpecRect): -1 | 1 {
    const center = edge.axis === "x" ? (rect[1] + rect[3]) / 2 : (rect[0] + rect[2]) / 2;
    return center > edge.line ? 1 : -1;
}

/** 房间连同 L 形拆出来的几块。 */
function family(floor: SpecFloor, name: string) {
    return floor.rooms.filter((room) => room.name === name || room.part === name);
}

function subtractIntervals(list: [number, number][], blocks: [number, number][], min = 0.3) {
    let result = list;
    for (const [left, right] of blocks)
        result = result.flatMap(([a, b]): [number, number][] =>
            right <= a || left >= b
                ? [[a, b]]
                : (
                      [
                          [a, left],
                          [right, b],
                      ] as [number, number][]
                  ).filter(([p, q]) => q - p > min),
        );
    return result;
}

function longestRun(list: [number, number][]) {
    return list.reduce((max, [a, b]) => Math.max(max, b - a), 0);
}

type FloorLevel = { floor: SpecFloor; index: number; top: number; wallBase: number; wallTop: number; segs: Seg[]; group: string; facades: boolean };

/** 户型和单个房间的外墙标上剖开用的 id 和朝外方向；建筑外观、剖切的那层不标。 */
function facadeOf(level: FloorLevel, seg: Seg): Facade | undefined {
    if (!level.facades || !seg.ext) return undefined;
    const out = seg.out || 1;
    return { id: `${level.index}:${seg.axis}:${r3(seg.line)}:${r3(seg.a)}`, normal: seg.axis === "x" ? [0, out] : [out, 0] };
}

function windowSize(kind: HoleKind, clear: number, height?: number, bottom?: number) {
    if (kind === "floor") return { bottom: 0, height: Math.min(height ?? clear - 0.3, clear - 0.25) };
    if (kind === "high") {
        const low = bottom ?? Math.min(1.5, clear - 0.9);
        return { bottom: low, height: Math.max(0.4, Math.min(height ?? 0.6, clear - low - 0.2)) };
    }
    if (kind === "bay") {
        const low = bottom ?? 0.45;
        return { bottom: low, height: Math.max(0.8, Math.min(height ?? clear - low - 0.4, clear - low - 0.25)) };
    }
    const low = bottom ?? 0.9;
    return { bottom: low, height: Math.max(0.5, Math.min(height ?? 1.6, clear - low - 0.3)) };
}

/** 在墙的 [from, to] 一段里给洞口找位置：尽量靠近 desired，避开已有的洞口；放不下时收窄，窄过 minWidth 就不开。 */
function placeHole(seg: Seg, from: number, to: number, desired: number, width: number, minWidth: number, hole: Omit<Hole, "center" | "width">) {
    let free: [number, number][] = [[Math.max(from, seg.a + 0.12), Math.min(to, seg.b - 0.12)]];
    for (const other of seg.holes) free = subtractIntervals(free, [[other.center - other.width / 2 - 0.12, other.center + other.width / 2 + 0.12]], 0.05);
    const distance = ([x, y]: [number, number]) => (desired < x ? x - desired : desired > y ? desired - y : 0);
    const fits = free.filter(([x, y]) => y - x >= width).sort((p, q) => distance(p) - distance(q));
    let size = width;
    let slot = fits[0];
    if (!slot) {
        slot = [...free].sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
        if (!slot || slot[1] - slot[0] < minWidth) return null;
        size = slot[1] - slot[0];
    }
    const center = clamp(desired, slot[0] + size / 2, slot[1] - size / 2);
    const placed: Hole = { ...hole, center: r3(center), width: r3(size) };
    seg.holes.push(placed);
    return placed;
}

/** 门默认开向更私密的房间（卫生间、卧室开向自己，客厅、过道一侧不占地方）。 */
const PRIVACY: Partial<Record<SpecRoomType, number>> = { bathroom: 4, closet: 4, storage: 4, laundry: 3, master: 3, bedroom: 3, kids: 3, study: 3, tea: 2, gym: 2, theater: 2, kitchen: 1, garage: 1 };

function doorWidth(kind: SpecDoor["kind"], scope: SceneSpec["scope"], rooms: SpecRoom[]) {
    if (kind === "double") return 1.5;
    if (kind === "slide") return rooms.some((room) => room.type === "balcony") ? 2.4 : 1.6;
    if (kind === "entry") return scope === "building" ? 1.2 : 1.0;
    if (kind === "opening") return 1.2;
    return rooms.some((room) => room.type === "bathroom") ? 0.8 : 0.9;
}

function doorHeight(kind: HoleKind, clear: number, exterior: boolean, scope: SceneSpec["scope"]) {
    const height = kind === "slide" ? (exterior ? 2.4 : 2.3) : kind === "entry" ? (scope === "building" ? 2.4 : 2.2) : 2.1;
    return r3(Math.min(height, clear - 0.2));
}

function hingeOf(axis: "x" | "z", hinge: SpecSide | undefined, hole: Hole, from: number, to: number): -1 | 1 {
    if (hinge && axis === "x" && (hinge === "w" || hinge === "e")) return hinge === "w" ? -1 : 1;
    if (hinge && axis === "z" && (hinge === "n" || hinge === "s")) return hinge === "n" ? -1 : 1;
    // 默认门轴靠近墙角那头，门开到底时贴着旁边的墙。
    return hole.center - from <= to - hole.center ? -1 : 1;
}

/**
 * 把方案里的门窗落到墙上。门窗写了 at 就按 at 开，没写门放在共用墙中间、窗在外墙上均匀排开；
 * 和已有洞口挤在一起时就近挪开。没有门也没有连通的房间自动开一扇门，建筑首层没写入户门时自动开一扇。
 */
function placeOpenings(level: FloorLevel, scope: SceneSpec["scope"]) {
    const { floor, segs } = level;
    const clear = level.wallTop - level.top;
    const mainOf = (name: string) => floor.rooms.find((room) => room.name === name)?.part || name;
    const connected = new Set<string>();
    for (const [a, b] of floor.open) if (mainOf(a) !== mainOf(b)) connected.add(mainOf(a)).add(mainOf(b));
    const interiorDoor = (nameA: string, nameB: string, door: Pick<SpecDoor, "kind" | "width" | "at" | "into" | "hinge">) => {
        const intervals: (Interval & { ra: SpecRoom; rb: SpecRoom; edge: Edge })[] = [];
        for (const ra of family(floor, nameA))
            for (const rb of family(floor, nameB)) {
                const edge = sharedLine(ra.rect, rb.rect);
                if (edge) for (const interval of edgeIntervals(segs, edge, false)) intervals.push({ ...interval, ra, rb, edge });
            }
        const pick = chooseInterval(intervals, door.at);
        if (!pick) return false;
        const kind: HoleKind = door.kind;
        const width = door.width ?? doorWidth(door.kind, scope, [pick.ra, pick.rb]);
        const into = door.into === nameA ? pick.ra : door.into === nameB ? pick.rb : (PRIVACY[pick.ra.type] || 0) > (PRIVACY[pick.rb.type] || 0) ? pick.ra : pick.rb;
        const hole = placeHole(pick.seg, pick.from + 0.05, pick.to - 0.05, door.at ?? (pick.from + pick.to) / 2, width, 0.6, { bottom: 0, height: doorHeight(kind, clear, false, scope), kind, swing: sideOfLine(pick.edge, into.rect) });
        if (!hole) return false;
        hole.hinge = hingeOf(pick.edge.axis, door.hinge, hole, pick.from, pick.to);
        return true;
    };
    for (const door of floor.doors) {
        if (door.between) {
            if (interiorDoor(door.between[0], door.between[1], door)) connected.add(mainOf(door.between[0])).add(mainOf(door.between[1]));
            continue;
        }
        if (!door.room || !door.side) continue;
        const rooms = family(floor, door.room);
        const edges = rooms.map((room) => ({ room, edge: roomEdge(room.rect, door.side!) }));
        // 写成通向室外的门其实开在内墙上时，照样在那面墙上开，门扇开向这个房间。
        const exterior = edges.flatMap(({ room, edge }) => edgeIntervals(segs, edge, true).map((item) => ({ ...item, room, edge })));
        const list = exterior.length ? exterior : edges.flatMap(({ room, edge }) => edgeIntervals(segs, edge, false).map((item) => ({ ...item, room, edge })));
        const pick = chooseInterval(list, door.at);
        if (!pick) continue;
        const kind: HoleKind = door.kind;
        const width = door.width ?? doorWidth(door.kind, scope, rooms);
        const swing = sideOfLine(pick.edge, pick.room.rect);
        const hole = placeHole(pick.seg, pick.from + 0.05, pick.to - 0.05, door.at ?? (pick.from + pick.to) / 2, width, 0.7, { bottom: 0, height: doorHeight(kind, clear, exterior.length > 0, scope), kind, swing });
        if (hole) hole.hinge = hingeOf(pick.edge.axis, door.hinge, hole, pick.from, pick.to);
    }
    // 没有门也没有连通的房间：和共用边最长的相邻房间之间开一扇门（优先通向走廊、客厅、门厅）。
    const mains = floor.rooms.filter((room) => !room.part);
    for (const room of mains) {
        if (connected.has(room.name)) continue;
        const neighbors = mains
            .filter((other) => other !== room)
            .map((other) => ({ other, length: Math.max(0, ...family(floor, room.name).flatMap((a) => family(floor, other.name).map((b) => sharedEdge(a.rect, b.rect)))) }))
            .filter((item) => item.length >= 1)
            .sort((x, y) => preferNeighbor(y.other.type) - preferNeighbor(x.other.type) || y.length - x.length);
        for (const { other } of neighbors) {
            if (interiorDoor(room.name, other.name, { kind: "door" })) {
                connected.add(room.name).add(other.name);
                break;
            }
        }
    }
    if (scope === "building" && level.index === 0 && !segs.some((seg) => seg.holes.some((hole) => hole.kind === "entry"))) {
        const order: Partial<Record<SpecRoomType, number>> = { entry: 5, living: 4, corridor: 3, dining: 2, stair: 1 };
        const candidates = [...mains].sort((x, y) => (order[y.type] || 0) - (order[x.type] || 0));
        candidates.some((room) =>
            (["s", "e", "w", "n"] as SpecSide[]).some((side) => {
                const interval = edgeIntervals(segs, roomEdge(room.rect, side), true)[0];
                if (!interval || interval.to - interval.from < 1.6) return false;
                const hole = placeHole(interval.seg, interval.from, interval.to, (interval.from + interval.to) / 2, 1.2, 1.0, { bottom: 0, height: doorHeight("entry", clear, true, scope), kind: "entry", swing: -(interval.seg.out || 1) as -1 | 1 });
                if (hole) hole.hinge = -1;
                return Boolean(hole);
            }),
        );
    }
    for (const spec of floor.windows) {
        const rooms = family(floor, spec.room);
        const intervals = rooms.flatMap((room) => edgeIntervals(segs, roomEdge(room.rect, spec.side), true));
        if (!intervals.length) continue;
        const kind: HoleKind = spec.kind;
        const { bottom, height } = windowSize(kind, clear, spec.height, spec.bottom);
        const props = { bottom: r3(bottom), height: r3(height), kind, ...(kind === "bay" ? { depth: spec.depth ?? 0.6 } : {}) };
        if (spec.at !== undefined) {
            const pick = chooseInterval(intervals, spec.at)!;
            placeHole(pick.seg, pick.from + 0.1, pick.to - 0.1, spec.at, spec.width, 0.4, props);
            continue;
        }
        const pick = chooseInterval(intervals)!;
        const from = pick.from + 0.25;
        const to = pick.to - 0.25;
        const slot = (to - from) / spec.count;
        const width = Math.min(spec.width, slot - 0.3);
        if (width < 0.4) continue;
        for (let index = 0; index < spec.count; index += 1) placeHole(pick.seg, from + slot * index, from + slot * (index + 1), from + slot * (index + 0.5), width, 0.4, props);
    }
}

function preferNeighbor(type: SpecRoomType) {
    return type === "corridor" ? 4 : type === "living" ? 3 : type === "entry" ? 3 : type === "stair" ? 2 : type === "dining" ? 2 : 0;
}

type Push = (object: SceneObject) => void;

/** 窗框（边框、竖梃、高窗的横档）和玻璃，plane 是窗框中心离墙中线的偏移。 */
function windowFrame(seg: Seg, center: number, plane: number, bottomY: number, width: number, height: number, trim: string, push: Push) {
    const frame = 0.06;
    const depth = 0.08;
    const half = width / 2;
    push(segBox(seg, center - half + frame / 2, plane, bottomY + height / 2, frame, height, depth, "metal-dark", trim));
    push(segBox(seg, center + half - frame / 2, plane, bottomY + height / 2, frame, height, depth, "metal-dark", trim));
    push(segBox(seg, center, plane, bottomY + frame / 2, width - frame * 2, frame, depth, "metal-dark", trim));
    push(segBox(seg, center, plane, bottomY + height - frame / 2, width - frame * 2, frame, depth, "metal-dark", trim));
    const mullions = Math.max(0, Math.round(width / 1.1) - 1);
    for (let index = 1; index <= mullions; index += 1) push(segBox(seg, center - half + (width / (mullions + 1)) * index, plane, bottomY + height / 2, 0.04, height - frame * 2, depth - 0.01, "metal-dark", trim));
    if (height > 2.4) push(segBox(seg, center, plane, bottomY + height - 0.55, width - frame * 2, 0.04, depth - 0.01, "metal-dark", trim));
    push(segBox(seg, center, plane, bottomY + height / 2, width - frame * 2, height - frame * 2, 0.02, "glass"));
}

/** 飘窗：窗台板从室内伸到外沿，外面一圈上下板和两侧玻璃，正面是窗；台面放坐垫和靠枕。 */
function bayWindow(seg: Seg, hole: Hole, level: FloorLevel, spec: SceneSpec, push: Push) {
    const out = seg.out || 1;
    const depth = hole.depth ?? 0.6;
    const t = seg.t;
    const outer = t / 2 + depth;
    const bottomY = level.top + hole.bottom;
    const topY = bottomY + hole.height;
    const length = hole.width + 0.1;
    const inner = -(t / 2 + 0.04);
    push(segBox(seg, hole.center, (out * (outer + inner)) / 2, bottomY - 0.01, length, 0.06, outer - inner, "stone", "#e4e0d9"));
    push(segBox(seg, hole.center, out * (t / 2 + depth / 2), bottomY - 0.1, length, 0.12, depth, "wall", spec.palette.wall));
    push(segBox(seg, hole.center, out * (t / 2 + depth / 2), topY + 0.06, length, 0.12, depth, "wall", spec.palette.wall));
    for (const end of [-1, 1]) push(segBox(seg, hole.center + end * (hole.width / 2 + 0.03), out * (t / 2 + depth / 2), (bottomY + 0.02 + topY) / 2, 0.02, topY - bottomY - 0.02, depth - 0.02, "glass"));
    windowFrame(seg, hole.center, out * (outer - 0.05), bottomY + 0.02, hole.width, hole.height - 0.02, spec.palette.trim, push);
    const cushionAcross = (out * (outer - 0.12 + inner + 0.04)) / 2;
    const [x, z] = onSeg(seg, hole.center, cushionAcross);
    const cushionDepth = outer - 0.12 - (inner + 0.04);
    push({
        shape: "rbox",
        position: [x, r3(bottomY + 0.06), z],
        size: seg.axis === "x" ? [r3(hole.width - 0.12), 0.08, r3(cushionDepth)] : [r3(cushionDepth), 0.08, r3(hole.width - 0.12)],
        round: 0.03,
        material: "fabric",
        color: shade(spec.palette.fabric, 0.04),
        texture: "weave",
    });
    for (const end of [-1, 1]) {
        const [px, pz] = onSeg(seg, hole.center + end * (hole.width / 2 - 0.3), cushionAcross);
        push({ shape: "rbox", position: [px, r3(bottomY + 0.27), pz], size: seg.axis === "x" ? [0.42, 0.36, 0.14] : [0.14, 0.36, 0.42], rotation: [0, end * 12, 0], round: 0.05, material: "fabric", color: spec.palette.accent });
    }
}

/** 窗框、玻璃、窗台、飘窗、门框、门扇（按开向半开）、推拉门、入户门、台阶和雨棚。tag 是外墙剖开的标记。 */
function openingDetails(level: FloorLevel, seg: Seg, hole: Hole, spec: SceneSpec, objects: SceneObject[], tag: Partial<SceneObject>) {
    const trim = spec.palette.trim;
    const out = seg.out || 1;
    const bottomY = level.top + hole.bottom;
    const half = hole.width / 2;
    const push: Push = (object) => objects.push({ ...object, group: level.group, ...tag });
    if (hole.kind === "window" || hole.kind === "floor" || hole.kind === "high") {
        windowFrame(seg, hole.center, out * (seg.t / 2 - 0.07), bottomY, hole.width, hole.height, trim, push);
        // 窗台顶面比洞口下沿低 5 毫米，不和墙洞的底面共面。
        if (hole.kind !== "floor") push(segBox(seg, hole.center, out * (seg.t / 2 + 0.03), bottomY - 0.025, hole.width + 0.14, 0.04, 0.2, "stone", "#d9d4cc"));
        if (hole.kind === "window") push(segBox(seg, hole.center, -out * (seg.t / 2 + 0.015), bottomY - 0.02, hole.width + 0.1, 0.03, 0.05, "stone", "#e4e0d9"));
        return;
    }
    if (hole.kind === "bay") {
        bayWindow(seg, hole, level, spec, push);
        return;
    }
    const jamb = 0.05;
    const depth = seg.t + 0.02;
    const wood = spec.palette.wood;
    const frameColor = hole.kind === "door" || hole.kind === "double" || hole.kind === "opening" ? shade(wood, -0.1) : trim;
    push(segBox(seg, hole.center - half + jamb / 2, 0, bottomY + hole.height / 2, jamb, hole.height, depth, "wood-dark", frameColor));
    push(segBox(seg, hole.center + half - jamb / 2, 0, bottomY + hole.height / 2, jamb, hole.height, depth, "wood-dark", frameColor));
    push(segBox(seg, hole.center, 0, bottomY + hole.height - jamb / 2, hole.width - jamb * 2, jamb, depth, "wood-dark", frameColor));
    const inner = hole.width - jamb * 2;
    const leafHeight = hole.height - jamb - 0.01;
    const leafColor = shade(wood, -0.35);
    if (hole.kind === "opening") return;
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
        if (spec.scope === "building") push(segBox(seg, hole.center, out * (seg.t / 2 + 0.6), bottomY + hole.height + 0.3, hole.width + 1.2, 0.12, 1.2, "concrete", shade(spec.palette.wall, -0.06)));
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
        return;
    }
    // 平开门：门扇按开向转开 78 度，门轴在 hinge 那头；双开门两扇各自从两头开。
    const leaves = hole.kind === "double" ? 2 : 1;
    const swing = hole.swing ?? 1;
    const leafWidth = inner / leaves - 0.01;
    const angle = (78 * Math.PI) / 180;
    for (let index = 0; index < leaves; index += 1) {
        const end = leaves === 2 ? (index === 0 ? -1 : 1) : (hole.hinge ?? -1);
        const hingeAlong = hole.center + end * (inner / 2 - 0.005);
        const hingeAcross = swing * (seg.t / 2 - 0.025);
        const dirAlong = -end * Math.cos(angle);
        const dirAcross = swing * Math.sin(angle);
        const [dx, dz] = seg.axis === "x" ? [dirAlong, dirAcross] : [dirAcross, dirAlong];
        const yaw = r3((Math.atan2(-dz, dx) * 180) / Math.PI);
        const [x, z] = onSeg(seg, hingeAlong + (dirAlong * leafWidth) / 2, hingeAcross + (dirAcross * leafWidth) / 2);
        push({ shape: "box", position: [x, r3(bottomY + leafHeight / 2), z], size: [r3(leafWidth), r3(leafHeight), 0.04], rotation: [0, yaw, 0], material: "wood", color: leafColor, texture: "grain" });
        const [hx, hz] = onSeg(seg, hingeAlong + dirAlong * (leafWidth - 0.08), hingeAcross + dirAcross * (leafWidth - 0.08));
        push({ shape: "box", position: [hx, r3(bottomY + 1.0), hz], size: [0.12, 0.02, 0.09], rotation: [0, yaw, 0], material: "metal", color: "#c9a46a" });
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
            objects.push({ shape: "box", position, size, material: "wood", color: spec.palette.wood, texture: "grain", group: level.group });
        }
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
type RoomFurniture = { type: SpecFurnitureType; at: SpecAnchor; rotate?: number; size?: [number, number]; color?: string; pos?: [number, number] };
/** 一面墙的情况：free 是去掉门洞、落地窗、飘窗和柱子后能靠墙摆的区间；open 再去掉普通窗（高柜、床头不挡窗）。 */
type SideInfo = { walled: boolean; length: number; depth: number; free: [number, number][]; open: [number, number][]; window: boolean; door: boolean };
type RoomContext = { room: SpecRoom; clear: SpecRect; width: number; depth: number; area: number; sides: Record<SpecSide, SideInfo>; obstacles: SpecRect[] };

function clearRect(room: SpecRoom, segs: Seg[]): SpecRect {
    const inset = (side: SpecSide) => {
        const edge = roomEdge(room.rect, side);
        const middle = (edge.from + edge.to) / 2;
        const seg = segs.find((item) => item.axis === edge.axis && Math.abs(item.line - edge.line) < EPS && item.a <= middle + EPS && item.b >= middle - EPS);
        return seg ? seg.t / 2 : 0;
    };
    return [room.rect[0] + inset("w"), room.rect[1] + inset("n"), room.rect[2] - inset("e"), room.rect[3] - inset("s")];
}

function roomContext(room: SpecRoom, segs: Seg[], pillars: SpecRect[]): RoomContext {
    const obstacles: SpecRect[] = [...pillars];
    const clear = clearRect(room, segs);
    const width = clear[2] - clear[0];
    const depth = clear[3] - clear[1];
    const sides = {} as Record<SpecSide, SideInfo>;
    for (const side of SIDES) {
        const edge = roomEdge(room.rect, side);
        const horizontal = side === "n" || side === "s";
        const along: [number, number] = horizontal ? [clear[0] + 0.05, clear[2] - 0.05] : [clear[1] + 0.05, clear[3] - 0.05];
        const onLine = segs.filter((seg) => seg.axis === edge.axis && Math.abs(seg.line - edge.line) < EPS);
        const covered = onLine.reduce((sum, seg) => sum + Math.max(0, Math.min(seg.b, edge.to) - Math.max(seg.a, edge.from)), 0);
        const walled = covered >= (edge.to - edge.from) * 0.6;
        const runs = walled ? onLine.map((seg): [number, number] => [Math.max(seg.a, along[0]), Math.min(seg.b, along[1])]).filter(([a, b]) => b - a > 0.3) : [];
        const blocked: [number, number][] = [];
        const windows: [number, number][] = [];
        let door = false;
        for (const seg of onLine)
            for (const hole of seg.holes) {
                if (hole.center < edge.from - EPS || hole.center > edge.to + EPS) continue;
                const pad = DOOR_KINDS.has(hole.kind) ? 0.15 : 0.05;
                const span: [number, number] = [hole.center - hole.width / 2 - pad, hole.center + hole.width / 2 + pad];
                if (DOOR_KINDS.has(hole.kind)) {
                    door = true;
                    const reach = Math.min(hole.width, 1.2);
                    obstacles.push(
                        side === "n"
                            ? [span[0], clear[1], span[1], clear[1] + reach]
                            : side === "s"
                              ? [span[0], clear[3] - reach, span[1], clear[3]]
                              : side === "w"
                                ? [clear[0], span[0], clear[0] + reach, span[1]]
                                : [clear[2] - reach, span[0], clear[2], span[1]],
                    );
                }
                if (DOOR_KINDS.has(hole.kind) || hole.kind === "floor" || hole.kind === "bay") blocked.push(span);
                else windows.push(span);
            }
        for (const [px1, pz1, px2, pz2] of pillars) {
            const near = side === "n" ? pz1 <= clear[1] + 0.3 && pz2 > clear[1] : side === "s" ? pz2 >= clear[3] - 0.3 && pz1 < clear[3] : side === "w" ? px1 <= clear[0] + 0.3 && px2 > clear[0] : px2 >= clear[2] - 0.3 && px1 < clear[2];
            const span: [number, number] = horizontal ? [px1 - 0.05, px2 + 0.05] : [pz1 - 0.05, pz2 + 0.05];
            if (near && span[1] > along[0] && span[0] < along[1]) blocked.push(span);
        }
        const free = subtractIntervals(runs, blocked);
        sides[side] = { walled, length: along[1] - along[0], depth: horizontal ? depth : width, free, open: subtractIntervals(free, windows), window: windows.length > 0, door };
    }
    return { room, clear, width, depth, area: width * depth, sides, obstacles };
}

/** 在有墙的几面里挑分数最高的一面；分数都不大于 0 时返回 undefined。 */
function bestSide(ctx: RoomContext, score: (side: SpecSide, info: SideInfo) => number, sides: SpecSide[] = SIDES) {
    let best: SpecSide | undefined;
    let bestScore = 0;
    for (const side of sides) {
        const info = ctx.sides[side];
        if (!info.walled) continue;
        const value = score(side, info);
        if (value > bestScore) {
            bestScore = value;
            best = side;
        }
    }
    return best;
}

function adjacentSides(side: SpecSide): SpecSide[] {
    return side === "n" || side === "s" ? ["w", "e"] : ["n", "s"];
}

/** 两面墙夹出来的那个角。 */
function cornerOf(a: SpecSide, b: SpecSide): SpecAnchor {
    const ns = a === "n" || a === "s" ? a : b;
    const ew = a === "e" || a === "w" ? a : b;
    return `${ns}${ew}` as SpecAnchor;
}

/**
 * 没写家具的房间按类型配一套，并按墙的情况选位置：沙发和电视墙选一对相对、都够长的墙，床头靠不开窗的实墙，
 * 衣柜靠床旁边的墙，书桌靠窗，卫生间的淋浴、马桶靠门对面的墙。
 */
function defaultFurniture(ctx: RoomContext): RoomFurniture[] {
    const { room, sides, area, width, depth } = ctx;
    const longest = (pick: (info: SideInfo) => [number, number][], exclude: SpecSide[] = []) => bestSide(ctx, (side, info) => (exclude.includes(side) ? 0 : longestRun(pick(info))));
    switch (room.type) {
        case "living": {
            const sofaSide =
                bestSide(ctx, (side, info) => {
                    const tv = sides[OPPOSITE[side]];
                    const sofaRun = longestRun(info.free);
                    if (sofaRun < 1.6) return 0;
                    const tvRun = tv.walled ? longestRun(tv.open) : 0;
                    return Math.min(sofaRun, 3.2) + Math.min(tvRun, 2.4) + (info.depth >= 3 && info.depth <= 6 ? 1.5 : 0) - (info.window ? 0.3 : 0);
                }) || "n";
            const run = longestRun(sides[sofaSide].free);
            const items: RoomFurniture[] = [{ type: run >= 2.9 && sides[sofaSide].depth >= 3.9 ? "sofa-l" : "sofa", at: sofaSide }];
            if (sides[OPPOSITE[sofaSide]].walled) items.push({ type: "tv-cabinet", at: OPPOSITE[sofaSide] });
            items.push({ type: "rug", at: "c" }, { type: "coffee-table", at: "c" });
            if (sides[sofaSide].length >= 4.4 && sides[sofaSide].depth >= 3.6) items.push({ type: "armchair", at: "c" });
            items.push({ type: "floor-lamp", at: "c" }, { type: "side-table", at: "c" }, { type: "plant", at: cornerOf(OPPOSITE[sofaSide], adjacentSides(sofaSide)[1]) });
            return items;
        }
        case "dining": {
            const side = longest((info) => info.free);
            return [{ type: "dining-table", at: "c" }, { type: "pendant", at: "c" }, ...(side && longestRun(sides[side].free) >= 1.4 && Math.min(width, depth) >= 2.8 ? [{ type: "cabinet", at: side } as RoomFurniture] : [])];
        }
        case "kitchen": {
            const side = longest((info) => info.free) || "n";
            const items: RoomFurniture[] = [{ type: "kitchen-line", at: side, size: [Math.min(longestRun(sides[side].free), 3.6), 0.62] }];
            const fridgeSide = bestSide(ctx, (other, info) => (other === side ? 0 : longestRun(info.open) - (other === OPPOSITE[side] ? 0.2 : 0)));
            if (fridgeSide && longestRun(sides[fridgeSide].open) >= 0.8) items.push({ type: "fridge", at: fridgeSide });
            if (area >= 13) items.push({ type: "kitchen-island", at: "c" });
            return items;
        }
        case "master":
        case "bedroom": {
            const bedSide =
                bestSide(ctx, (side, info) => {
                    const open = longestRun(info.open);
                    const fits = Math.max(open, longestRun(info.free) * 0.8);
                    if (fits < 1.7 || info.depth < 2.6) return 0;
                    return fits + (open >= 1.8 ? 1 : 0) - (info.window ? 0.5 : 0) - (info.door ? 0.3 : 0);
                }) || "n";
            const items: RoomFurniture[] = [{ type: "bed", at: bedSide, size: [Math.min(2.8, Math.max(1.8, longestRun(sides[bedSide].free))), 2.1] }];
            const neighbors = adjacentSides(bedSide);
            const wardSide = bestSide(ctx, (side, info) => (neighbors.includes(side) ? longestRun(info.open) : side === OPPOSITE[bedSide] ? longestRun(info.open) - 0.4 : 0));
            if (wardSide && longestRun(sides[wardSide].open) >= 1.0) items.push({ type: "wardrobe", at: wardSide, size: [Math.min(2.4, longestRun(sides[wardSide].open)), 0.6] });
            const rest = SIDES.filter((side) => side !== bedSide && side !== wardSide);
            if (room.type === "master" && area >= 12.5) {
                const dressSide = bestSide(ctx, (side, info) => (rest.includes(side) ? longestRun(info.free) : 0));
                if (dressSide && longestRun(sides[dressSide].free) >= 1.0) items.push({ type: "dresser", at: dressSide });
            }
            if (sides[bedSide].depth >= 3.6) items.push({ type: "bench", at: "c" });
            items.push({ type: "plant", at: cornerOf(OPPOSITE[bedSide], neighbors[0]) });
            return items;
        }
        case "kids": {
            const bedSide = longest((info) => info.open) || "n";
            const deskSide = bestSide(ctx, (side, info) => (side === bedSide ? 0 : longestRun(info.free) + (info.window ? 1.5 : 0)));
            const items: RoomFurniture[] = [{ type: "bed-single", at: bedSide }];
            if (deskSide) items.push({ type: "desk", at: deskSide, size: [1.2, 0.6] });
            const wardSide = bestSide(ctx, (side, info) => (side === bedSide || side === deskSide ? 0 : longestRun(info.open)));
            if (wardSide && longestRun(sides[wardSide].open) >= 1.0) items.push({ type: "wardrobe", at: wardSide, size: [Math.min(1.8, longestRun(sides[wardSide].open)), 0.6] });
            items.push({ type: "rug", at: "c", size: [1.6, 1.2] });
            return items;
        }
        case "study": {
            const deskSide = bestSide(ctx, (side, info) => longestRun(info.free) + (info.window ? 1.5 : 0)) || "n";
            const shelfSide = bestSide(ctx, (side, info) => (side === deskSide ? 0 : longestRun(info.open)));
            return [
                { type: "desk", at: deskSide },
                ...(shelfSide ? [{ type: "bookshelf", at: shelfSide, size: [Math.min(2.4, longestRun(sides[shelfSide].open)), 0.35] } as RoomFurniture] : []),
                { type: "armchair", at: "se" },
                { type: "plant", at: "ne" },
            ];
        }
        case "bathroom": {
            const doorSide = SIDES.find((side) => sides[side].door);
            const back = (doorSide && sides[OPPOSITE[doorSide]].walled ? OPPOSITE[doorSide] : longest((info) => info.free)) || "n";
            const wet: RoomFurniture = area >= 5.5 && longestRun(sides[back].free) >= 2.4 ? { type: "bathtub", at: back } : { type: "shower", at: back };
            const vanitySide = bestSide(ctx, (side, info) => (side === back ? 0 : longestRun(info.free) + (side === doorSide ? 0.2 : 0)));
            return [wet, { type: "toilet", at: back }, ...(vanitySide ? [{ type: "vanity", at: vanitySide } as RoomFurniture] : [{ type: "vanity", at: back } as RoomFurniture])];
        }
        case "entry": {
            const side = longest((info) => info.free) || "w";
            return [
                { type: "shoe-cabinet", at: side, size: [Math.min(1.8, longestRun(sides[side].free)), 0.36] },
                { type: "plant", at: "ne" },
            ];
        }
        case "tea":
            return [{ type: "tea-table", at: "c" }, ...(longest((info) => info.open) ? [{ type: "bookshelf", at: longest((info) => info.open)! } as RoomFurniture] : []), { type: "plant", at: "se" }];
        case "theater": {
            const screenSide = longest((info) => info.open) || "s";
            return [
                { type: "screen", at: screenSide },
                { type: "sofa", at: OPPOSITE[screenSide] },
                { type: "rug", at: "c" },
                { type: "coffee-table", at: "c" },
            ];
        }
        case "gym":
            return [
                { type: "treadmill", at: "c" },
                { type: "mirror", at: longest((info) => info.open) || "n" },
                { type: "plant", at: "ne" },
            ];
        case "garage":
            return width >= 2.4 && depth >= 4.8 ? [{ type: "car", at: "c" }] : [];
        case "laundry": {
            const side = longest((info) => info.free) || "n";
            return [
                { type: "washer", at: side },
                { type: "washer", at: side },
                { type: "cabinet", at: side, size: [0.8, 0.45] },
            ];
        }
        case "closet": {
            const first = longest((info) => info.open) || "n";
            const second = bestSide(ctx, (side, info) => (side === first ? 0 : longestRun(info.open)));
            return [
                { type: "wardrobe", at: first, size: [Math.min(3, longestRun(sides[first].open)), 0.6] },
                ...(second ? [{ type: "wardrobe", at: second, size: [Math.min(3, longestRun(sides[second].open)), 0.6] } as RoomFurniture] : []),
                { type: "bench", at: "c" },
            ];
        }
        case "balcony": {
            const end = bestSide(ctx, (side, info) => (info.length <= Math.min(width, depth) + 0.3 ? longestRun(info.free) : 0));
            return [...(end && Math.max(width, depth) >= 3.2 ? [{ type: "washer", at: end } as RoomFurniture] : []), { type: "armchair", at: "c" }, { type: "plant", at: "ne" }, { type: "plant", at: "sw" }];
        }
        case "storage":
            return [{ type: "bookshelf", at: longest((info) => info.open) || "n" }];
        default:
            return [];
    }
}

/** 家具朝向转角 → 背靠哪面墙。 */
function backSide(rotation: number): SpecSide {
    const angle = normalizeAngle(rotation);
    return angle === 90 ? "w" : angle === 180 ? "s" : angle === 270 ? "e" : "n";
}

function nearestWallRotation(ctx: RoomContext, [x, z]: [number, number]) {
    const [cx1, cz1, cx2, cz2] = ctx.clear;
    const distances: [SpecSide, number][] = [
        ["n", z - cz1],
        ["s", cz2 - z],
        ["w", x - cx1],
        ["e", cx2 - x],
    ];
    const walled = distances.filter(([side]) => ctx.sides[side].walled);
    return ANCHOR_ROTATION[(walled.length ? walled : distances).sort((a, b) => a[1] - b[1])[0][0]];
}

const SCALABLE = new Set<SpecFurnitureType>(["rug", "dining-table", "round-table", "kitchen-island", "tea-table", "bar-counter"]);
const SEATS = new Set<SpecFurnitureType>(["sofa", "sofa-l"]);
const BEDS = new Set<SpecFurnitureType>(["bed", "bed-single", "bunk-bed"]);

function footprint(placement: Pick<Placement, "x" | "z" | "w" | "d" | "rotation">): SpecRect {
    const turned = Math.round(placement.rotation / 90) % 2 !== 0;
    const hw = (turned ? placement.d : placement.w) / 2;
    const hd = (turned ? placement.w : placement.d) / 2;
    return [placement.x - hw, placement.z - hd, placement.x + hw, placement.z + hd];
}

/** 家具局部坐标（x 向右、z 向前）→ 平面坐标。 */
function localPoint(anchor: Placement, lx: number, lz: number): [number, number] {
    const angle = (anchor.rotation * Math.PI) / 180;
    return [anchor.x + lx * Math.cos(angle) + lz * Math.sin(angle), anchor.z - lx * Math.sin(angle) + lz * Math.cos(angle)];
}

/**
 * 摆家具：方案写了 pos 的按 pos（离墙不到 0.4 米的贴墙）；靠墙的按顺序沿那面墙排，避开门、落地窗和柱子，高柜不挡窗；
 * 茶几、地毯、单椅、落地灯、边几跟着沙发摆，床尾凳跟着床；其余放在剩下空间的中央或角上，互相不重叠。
 * 家具大于可用空间时按比例缩小，缩到原来六成以下就不摆。
 */
function layoutRoom(ctx: RoomContext, requested: RoomFurniture[], within: SpecRect[], onIssue?: (message: string) => void): Placement[] {
    const placements: Placement[] = [];
    const taken: SpecRect[] = [...ctx.obstacles];
    const [cx1, cz1, cx2, cz2] = ctx.clear;
    const covered = (x: number, z: number) => within.some((rect) => x >= rect[0] - 0.03 && x <= rect[2] + 0.03 && z >= rect[1] - 0.03 && z <= rect[3] + 0.03);
    const inside = (rect: SpecRect) => covered(rect[0], rect[1]) && covered(rect[2], rect[1]) && covered(rect[0], rect[3]) && covered(rect[2], rect[3]) && covered((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
    const overlaps = (a: SpecRect, b: SpecRect) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.03 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.03;
    const free = (rect: SpecRect) => inside(rect) && !taken.some((other) => overlaps(rect, other));
    const flat = (type: SpecFurnitureType) => type === "rug" || type === "pendant";
    const commit = (placement: Placement) => {
        placements.push({ ...placement, rotation: normalizeAngle(placement.rotation) });
        if (!flat(placement.type)) taken.push(footprint(placement));
    };
    const sizeOf = (item: RoomFurniture): [number, number] => (item.size ? [item.size[0], item.size[1]] : [furnitureInfo(item.type).size[0], furnitureInfo(item.type).size[1]]);
    const pending: RoomFurniture[] = [];
    for (const item of requested) {
        if (!item.pos) {
            pending.push(item);
            continue;
        }
        const info = furnitureInfo(item.type);
        let [w, d] = sizeOf(item);
        const rotation = item.rotate ?? (info.wall ? nearestWallRotation(ctx, item.pos) : 0);
        const [px, pz] = item.pos;
        const area = within.find((rect) => px >= rect[0] - 0.3 && px <= rect[2] + 0.3 && pz >= rect[1] - 0.3 && pz <= rect[3] + 0.3) || ctx.clear;
        const turned = Math.round(rotation / 90) % 2 !== 0;
        const scale = Math.min(1, (area[2] - area[0] - 0.04) / (turned ? d : w), (area[3] - area[1] - 0.04) / (turned ? w : d));
        if (scale < 0.5) continue;
        if (scale < 1 && item.type !== "pendant") {
            w *= scale;
            d *= scale;
        }
        const hw = (turned ? d : w) / 2;
        const hd = (turned ? w : d) / 2;
        let x = clamp(px, area[0] + hw + 0.02, area[2] - hw - 0.02);
        let z = clamp(pz, area[1] + hd + 0.02, area[3] - hd - 0.02);
        if (info.wall) {
            const back = backSide(rotation);
            const gap = back === "n" ? z - hd - area[1] : back === "s" ? area[3] - z - hd : back === "w" ? x - hw - area[0] : area[2] - x - hw;
            if (gap > 0.025 && gap < 0.4) {
                if (back === "n") z = area[1] + hd + 0.02;
                else if (back === "s") z = area[3] - hd - 0.02;
                else if (back === "w") x = area[0] + hw + 0.02;
                else x = area[2] - hw - 0.02;
            }
        }
        const placement = { type: item.type, x, z, w, d, rotation, color: item.color };
        if (!flat(item.type) && !free(footprint(placement))) {
            onIssue?.(`${ctx.room.name}的${info.name}与家具、柱子或门前通道冲突，请修正 pos 和尺寸`);
            continue;
        }
        commit(placement);
    }
    const isWallItem = (item: RoomFurniture) => SIDES.includes(item.at as SpecSide) && furnitureInfo(item.type).wall;
    const redirect: Record<SpecSide, SpecSide[]> = { n: ["s", "w", "e"], s: ["n", "w", "e"], w: ["e", "n", "s"], e: ["w", "n", "s"] };
    const items = pending.map((item) => {
        if (!isWallItem(item) || ctx.sides[item.at as SpecSide].walled) return item;
        const side = redirect[item.at as SpecSide].find((candidate) => ctx.sides[candidate].walled);
        return { ...item, at: side || ("c" as SpecAnchor) };
    });
    const used: Record<SpecSide, number> = { n: 0, s: 0, e: 0, w: 0 };
    for (const side of SIDES) {
        const onWall = items.filter((item) => item.at === side && isWallItem(item));
        if (!onWall.length) continue;
        const info = ctx.sides[side];
        const horizontal = side === "n" || side === "s";
        const lanes = { tall: (info.open.some(([a, b]) => b - a >= 0.6) ? info.open : info.free).map(([a, b]): [number, number] => [a, b]), low: info.free.map(([a, b]): [number, number] => [a, b]) };
        const sizes = onWall.map(sizeOf);
        const anyTall = onWall.some((item) => furnitureInfo(item.type).tall);
        const total = sizes.reduce((sum, [w]) => sum + w, 0) + 0.06 * (onWall.length - 1);
        const widest = [...(anyTall ? lanes.tall : lanes.low)].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        let cursor = widest && widest[1] - widest[0] >= total ? (widest[0] + widest[1]) / 2 - total / 2 : null;
        onWall.forEach((item, index) => {
            let [w, d] = sizes[index];
            const tall = Boolean(furnitureInfo(item.type).tall);
            d = Math.min(d, info.depth * 0.7);
            let center: number;
            if (cursor !== null) {
                center = cursor + w / 2;
                cursor += w + 0.06;
            } else {
                const lane = tall ? lanes.tall : lanes.low;
                let fit = lane.find(([a, b]) => b - a >= w);
                if (!fit) {
                    fit = [...lane].sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
                    if (!fit || fit[1] - fit[0] < w * 0.6) return;
                    w = fit[1] - fit[0];
                }
                center = fit[0] + w / 2;
                lanes.tall = subtractIntervals(lanes.tall, [[center - w / 2 - 0.03, center + w / 2 + 0.03]], 0.2);
                lanes.low = subtractIntervals(lanes.low, [[center - w / 2 - 0.03, center + w / 2 + 0.03]], 0.2);
            }
            const across = side === "n" ? cz1 + d / 2 + 0.02 : side === "s" ? cz2 - d / 2 - 0.02 : side === "w" ? cx1 + d / 2 + 0.02 : cx2 - d / 2 - 0.02;
            let placement: Placement = { type: item.type, x: horizontal ? center : across, z: horizontal ? across : center, w, d, rotation: ANCHOR_ROTATION[side], color: item.color };
            if (!free(footprint(placement))) {
                // 和别的墙上的家具在墙角撞了：沿墙挪到最近的空位，挪不开就不摆。
                const options: number[] = [];
                for (const [a, b] of tall ? info.open : info.free) for (let value = a + w / 2; value <= b - w / 2 + 1e-6; value += 0.05) options.push(value);
                options.sort((p, q) => Math.abs(p - center) - Math.abs(q - center));
                const value = options.find((option) => free(footprint({ ...placement, ...(horizontal ? { x: option } : { z: option }) })));
                if (value === undefined) return;
                placement = { ...placement, ...(horizontal ? { x: value } : { z: value }) };
            }
            commit(placement);
            used[side] = Math.max(used[side], d);
        });
    }
    const seat = placements.find((item) => SEATS.has(item.type));
    const bed = placements.find((item) => BEDS.has(item.type));
    const seatFront = (anchor: Placement) => (anchor.type === "sofa-l" ? -anchor.d / 2 + Math.min(0.92, anchor.d - 0.5) : anchor.d / 2);
    const seatShift = (anchor: Placement) => (anchor.type === "sofa-l" ? -Math.min(0.95, anchor.w * 0.35) / 2 : 0);
    const relate = (item: RoomFurniture): Placement[] => {
        const [w, d] = sizeOf(item);
        const build = (anchor: Placement, lx: number, lz: number, rotation: number, size: [number, number] = [w, d]): Placement => {
            const [x, z] = localPoint(anchor, lx, lz);
            return { type: item.type, x, z, w: size[0], d: size[1], rotation, color: item.color };
        };
        if (seat && item.type === "coffee-table") return [build(seat, seatShift(seat), seatFront(seat) + 0.42 + d / 2, seat.rotation)];
        if (seat && item.type === "rug") {
            const size: [number, number] = item.size ? [w, d] : [clamp(seat.w * 0.95, 1.6, 3.0), 1.7];
            return [build(seat, seatShift(seat), seatFront(seat) + size[1] / 2 - 0.3, seat.rotation, size)];
        }
        if (seat && item.type === "armchair") {
            const table = placements.find((other) => other.type === "coffee-table");
            const lz = seatFront(seat) + 0.42 + (table?.d ?? 0.62) / 2;
            return [1, -1].map((sign) => build(seat, seatShift(seat) + sign * ((table?.w ?? 1.2) / 2 + 0.62), lz, seat.rotation - sign * 90));
        }
        if (seat && (item.type === "floor-lamp" || item.type === "side-table")) return (item.type === "floor-lamp" ? [-1, 1] : [1, -1]).map((sign) => build(seat, sign * (seat.w / 2 + w / 2 + 0.06), -seat.d / 2 + d / 2 + 0.06, seat.rotation));
        if (bed && item.type === "bench") return [build(bed, 0, bed.d / 2 + d / 2 + 0.1, bed.rotation)];
        if (bed && item.type === "rug") {
            const size: [number, number] = item.size ? [w, d] : [Math.min(bed.w, 2.4), 1.6];
            return [build(bed, 0, bed.d / 2 - 0.35, bed.rotation, size)];
        }
        return [];
    };
    const region: SpecRect = [cx1 + used.w, cz1 + used.n, cx2 - used.e, cz2 - used.s];
    const regionW = Math.max(0.6, region[2] - region[0]);
    const regionD = Math.max(0.6, region[3] - region[1]);
    const corners: SpecAnchor[] = ["ne", "nw", "se", "sw"];
    for (const item of items) {
        if (isWallItem(item) && ctx.sides[item.at as SpecSide]?.walled) continue;
        const related = relate(item).find((candidate) => flat(candidate.type) || free(footprint(candidate)));
        if (related) {
            commit(related);
            continue;
        }
        if (relate(item).length && (item.type === "floor-lamp" || item.type === "side-table" || item.type === "armchair" || item.type === "bench")) continue;
        let [w, d] = sizeOf(item);
        let rotation = item.rotate ?? 0;
        if (item.rotate === undefined && w > d && regionD > regionW && item.type !== "car") rotation = 90;
        if (item.type === "car" && regionW > regionD) rotation = 90;
        const turned = rotation % 180 !== 0;
        const scale = Math.min(1, (regionW - 0.1) / (turned ? d : w), (regionD - 0.1) / (turned ? w : d));
        if (item.type !== "pendant" && scale < 0.6) continue;
        if (SCALABLE.has(item.type)) {
            w *= Math.min(1, scale);
            d *= Math.min(1, scale);
        }
        const anchors: SpecAnchor[] = corners.includes(item.at) ? [item.at, ...corners.filter((corner) => corner !== item.at)] : [item.at];
        for (const anchor of anchors) {
            const footW = (turned ? d : w) / 2 + 0.05;
            const footD = (turned ? w : d) / 2 + 0.05;
            let placement: Placement = {
                type: item.type,
                x: anchor.includes("e") ? region[2] - footW : anchor.includes("w") ? region[0] + footW : (region[0] + region[2]) / 2,
                z: anchor.includes("n") ? region[1] + footD : anchor.includes("s") ? region[3] - footD : (region[1] + region[3]) / 2,
                w,
                d,
                rotation,
                color: item.color,
            };
            if (item.type === "pendant") {
                const target = placements.find((other) => other.type === "dining-table" || other.type === "round-table" || other.type === "tea-table" || other.type === "kitchen-island");
                placement = { ...placement, x: target?.x ?? (cx1 + cx2) / 2, z: target?.z ?? (cz1 + cz2) / 2 };
            }
            if (flat(item.type) || free(footprint(placement))) {
                commit(placement);
                break;
            }
        }
    }
    return placements;
}

/** 家具背靠的那面外墙（剖开用的标记）：背面离外墙中线不到半个墙厚加 0.4 米，且家具中心在这段墙的范围里。 */
function backFacade(level: FloorLevel, segs: Seg[], placement: Placement): Facade | undefined {
    if (!level.facades) return undefined;
    const side = backSide(placement.rotation);
    const axis: "x" | "z" = side === "n" || side === "s" ? "x" : "z";
    const back = side === "n" ? placement.z - placement.d / 2 : side === "s" ? placement.z + placement.d / 2 : side === "w" ? placement.x - placement.d / 2 : placement.x + placement.d / 2;
    const along = axis === "x" ? placement.x : placement.z;
    const seg = segs.find((item) => item.ext && item.axis === axis && Math.abs(item.line - back) < item.t / 2 + 0.4 && along > item.a && along < item.b);
    return seg ? facadeOf(level, seg) : undefined;
}

/** 拼出一件家具放到位；挂墙的零件（mount）带上背靠那面外墙的标记，墙剖开时一起隐藏。 */
function furnitureObjects(placement: Placement, spec: SceneSpec, y: number, ceiling: number, group: string, seed: number, facade?: Facade): SceneObject[] {
    const parts: FurniturePart[] = buildFurniture(placement.type, placement.w, placement.d, { palette: spec.palette, color: placement.color, ceiling, seed });
    return parts.map(({ mount, ...part }) => ({ ...place(part, [r3(placement.x), r3(y), r3(placement.z)], placement.rotation), euler: "YXZ", group, ...(mount && facade ? { facade } : {}) }));
}

/** 踢脚线：沿房间每面墙的内侧，门洞、落地窗、推拉门处断开。 */
function baseboards(level: FloorLevel, room: SpecRoom, segs: Seg[], spec: SceneSpec, objects: SceneObject[]) {
    const clear = clearRect(room, segs);
    const color = shade(spec.palette.interior, -0.16);
    const y = level.top + FINISH + BASE_H / 2;
    for (const side of SIDES) {
        const edge = roomEdge(room.rect, side);
        const horizontal = side === "n" || side === "s";
        const range: [number, number] = horizontal ? [clear[0], clear[2]] : [clear[1], clear[3]];
        const inward = side === "n" || side === "w" ? 1 : -1;
        for (const seg of segs) {
            if (seg.axis !== edge.axis || Math.abs(seg.line - edge.line) > EPS) continue;
            const span: [number, number] = [Math.max(seg.a, edge.from, range[0]), Math.min(seg.b, edge.to, range[1])];
            if (span[1] - span[0] < 0.1) continue;
            const pieces = subtractIntervals(
                [span],
                seg.holes.filter((hole) => hole.bottom < 0.1).map((hole): [number, number] => [hole.center - hole.width / 2, hole.center + hole.width / 2]),
                0.1,
            );
            const facade = facadeOf(level, seg);
            for (const [from, to] of pieces) objects.push({ ...segBox(seg, (from + to) / 2, inward * (seg.t / 2 + BASE_T / 2), y, to - from, BASE_H, BASE_T, "wood", color), group: level.group, ...(facade ? { facade } : {}) });
        }
    }
}

const CURTAIN_ROOMS = new Set<SpecRoomType>(["living", "dining", "master", "bedroom", "kids", "study", "tea", "theater", "other"]);

/** 一片窗帘：俯视是一条波浪形的布，沿竖直方向挤出。 */
function curtainShape(width: number, height: number): Pick<SceneObject, "shape" | "outline" | "depth" | "axis"> {
    const folds = Math.max(2, Math.round(width / 0.14));
    const steps = folds * 4;
    const front: [number, number][] = [];
    for (let index = 0; index <= steps; index += 1) front.push([r3(-width / 2 + (width * index) / steps), r3(Math.sin((index / steps) * folds * Math.PI * 2) * 0.03)]);
    const back = front.map(([x, z]): [number, number] => [x, r3(z - 0.016)]).reverse();
    return { shape: "extrude", outline: [...front, ...back], depth: r3(height), axis: "y" };
}

/** 窗帘和窗帘轨：客厅、卧室、书房这些房间的外窗两侧各挂一片，落地长度。 */
function curtains(level: FloorLevel, type: SpecRoomType, rooms: SpecRoom[], segs: Seg[], spec: SceneSpec, objects: SceneObject[]) {
    if (!CURTAIN_ROOMS.has(type)) return;
    const color = shade(spec.palette.fabric, 0.06);
    for (const room of rooms)
        for (const side of SIDES) {
            const edge = roomEdge(room.rect, side);
            const inward = side === "n" || side === "w" ? 1 : -1;
            for (const seg of segs) {
                if (!seg.ext || seg.axis !== edge.axis || Math.abs(seg.line - edge.line) > EPS) continue;
                for (const hole of seg.holes) {
                    if ((hole.kind !== "window" && hole.kind !== "floor" && hole.kind !== "bay") || hole.center < edge.from || hole.center > edge.to) continue;
                    const facade = facadeOf(level, seg);
                    const push = (object: SceneObject) => objects.push({ ...object, group: level.group, ...(facade ? { facade } : {}) });
                    const trackY = Math.min(level.wallTop - 0.04, level.top + hole.bottom + hole.height + 0.15);
                    const bottom = level.top + FINISH + 0.02;
                    const across = inward * (seg.t / 2 + 0.1);
                    const panel = clamp(hole.width * 0.2, 0.3, 0.55);
                    const low = Math.max(edge.from + 0.15, Math.max(seg.a, edge.from) + 0.1);
                    const high = Math.min(edge.to - 0.15, Math.min(seg.b, edge.to) - 0.1);
                    const left = clamp(hole.center - hole.width / 2 + panel / 2 - 0.1, low + panel / 2, high - panel / 2);
                    const right = clamp(hole.center + hole.width / 2 - panel / 2 + 0.1, low + panel / 2, high - panel / 2);
                    const trackFrom = Math.max(low, left - panel / 2);
                    const trackTo = Math.min(high, right + panel / 2);
                    if (trackTo - trackFrom < 0.6) continue;
                    push(segBox(seg, (trackFrom + trackTo) / 2, across, trackY, trackTo - trackFrom, 0.03, 0.05, "metal-dark", spec.palette.trim));
                    for (const along of [left, right]) {
                        const [x, z] = onSeg(seg, along, across);
                        push({ ...curtainShape(panel, trackY - 0.02 - bottom), position: [x, r3((bottom + trackY - 0.02) / 2), z], rotation: [0, seg.axis === "x" ? 0 : 90, 0], material: "fabric", color, texture: "weave" });
                    }
                }
            }
        }
}

/** 挂画：沙发背后、床头上方的墙上挂一两幅，墙上有窗的地方不挂。 */
function wallArt(level: FloorLevel, ctx: RoomContext, placements: Placement[], segs: Seg[], spec: SceneSpec, objects: SceneObject[]) {
    const anchor = placements.find((item) => SEATS.has(item.type)) || placements.find((item) => item.type === "bed" || item.type === "bed-single");
    if (!anchor) return;
    const side = backSide(anchor.rotation);
    if (!ctx.sides[side].walled) return;
    const edge = roomEdge(ctx.room.rect, side);
    const along = edge.axis === "x" ? anchor.x : anchor.z;
    const seg = segs.find((item) => item.axis === edge.axis && Math.abs(item.line - edge.line) < EPS && along > item.a && along < item.b);
    if (!seg) return;
    const inward = side === "n" || side === "w" ? 1 : -1;
    const facade = facadeOf(level, seg);
    const pair = anchor.w >= 2.1;
    const [artW, artH] = pair ? [0.6, 0.8] : [0.8, 0.6];
    const y = level.top + (BEDS.has(anchor.type) ? 1.62 : 1.5);
    const colors = [spec.palette.accent, shade(spec.palette.fabric, -0.18)];
    (pair ? [-1, 1] : [0]).forEach((offset, index) => {
        const center = along + offset * (artW / 2 + 0.06);
        if (seg.holes.some((hole) => Math.abs(hole.center - center) < hole.width / 2 + artW / 2 + 0.05 && hole.bottom < y + artH / 2 && hole.bottom + hole.height > y - artH / 2)) return;
        if (center - artW / 2 < seg.a + 0.2 || center + artW / 2 > seg.b - 0.2) return;
        const tag = facade ? { facade } : {};
        objects.push({ ...segBox(seg, center, inward * (seg.t / 2 + 0.015), y, artW, artH, 0.03, "wood-dark", "#2b2d30"), group: level.group, ...tag });
        objects.push({ ...segBox(seg, center, inward * (seg.t / 2 + 0.035), y, artW - 0.07, artH - 0.07, 0.01, "fabric", colors[index % 2]), group: level.group, ...tag });
    });
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
        const [w, d] = item.size || [furnitureInfo(item.type).size[0], furnitureInfo(item.type).size[1]];
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

function roofRects(footprintRects: SpecRect[]): SpecRect[] {
    const bounds: SpecRect = [Math.min(...footprintRects.map((rect) => rect[0])), Math.min(...footprintRects.map((rect) => rect[1])), Math.max(...footprintRects.map((rect) => rect[2])), Math.max(...footprintRects.map((rect) => rect[3]))];
    const area = footprintRects.reduce((sum, rect) => sum + (rect[2] - rect[0]) * (rect[3] - rect[1]), 0);
    if (area >= (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) * 0.85) return [bounds];
    return [...footprintRects].sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1])).slice(0, 4);
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

/** 外围尺寸线：北面和西面各两道，里面一道是轴线分段（有轴网用轴网），外面一道是总尺寸，单位毫米，和图纸的标注一样。 */
function dimensionChains(floor: SpecFloor, spec: SceneSpec, y: number): SceneDimension[] {
    const [x1, z1, x2, z2] = floorBounds(floor);
    const rects = [...floor.rooms.map((room) => room.rect), ...floor.balconies.map((item) => item.rect)];
    const values = (grid: number[] | undefined, edges: number[], low: number, high: number) => {
        const fromGrid = (grid || []).filter((value) => value > low + 0.05 && value < high - 0.05);
        return uniqueSorted([low, high, ...(fromGrid.length ? fromGrid : edges.filter((value) => value > low + 0.05 && value < high - 0.05))]);
    };
    const mm = (value: number) => String(Math.round(value * 1000));
    const xs = values(
        spec.grid?.x,
        rects.flatMap((rect) => [rect[0], rect[2]]),
        x1,
        x2,
    );
    const zs = values(
        spec.grid?.z,
        rects.flatMap((rect) => [rect[1], rect[3]]),
        z1,
        z2,
    );
    const result: SceneDimension[] = [];
    for (let index = 0; index < xs.length - 1; index += 1) if (xs[index + 1] - xs[index] >= 0.3) result.push({ a: [xs[index], z1 - 1], b: [xs[index + 1], z1 - 1], text: mm(xs[index + 1] - xs[index]), y });
    if (xs.length > 2) result.push({ a: [x1, z1 - 1.7], b: [x2, z1 - 1.7], text: mm(x2 - x1), y, total: true });
    for (let index = 0; index < zs.length - 1; index += 1) if (zs[index + 1] - zs[index] >= 0.3) result.push({ a: [x1 - 1, zs[index]], b: [x1 - 1, zs[index + 1]], text: mm(zs[index + 1] - zs[index]), y });
    if (zs.length > 2) result.push({ a: [x1 - 1.7, z1], b: [x1 - 1.7, z2], text: mm(z2 - z1), y, total: true });
    return result;
}

function formatMeters(value: number) {
    return String(Math.round(value * 100) / 100);
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
        const level: FloorLevel = { floor, index, top, wallBase: top, wallTop, segs: solveWalls(floor.rooms, floor.open), group: floor.name, facades: !building && cut !== index };
        placeOpenings(level, spec.scope);
        levels.push(level);
        top += floor.height;
    });
    const groundY = building ? 0 : -0.12;
    for (const [index, level] of levels.entries()) {
        if (index >= visibleFloors.length) break;
        const { floor, segs, group } = level;
        const capped = cut === index;
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
        for (const balcony of [...terraces.map((rect) => ({ rect, surface: undefined })), ...floor.balconies]) {
            const { rect } = balcony;
            objects.push({
                shape: "box",
                position: [r3((rect[0] + rect[2]) / 2), r3(level.top + FINISH / 2), r3((rect[1] + rect[3]) / 2)],
                size: [r3(rect[2] - rect[0]), FINISH, r3(rect[3] - rect[1])],
                material: balcony.surface === "water" ? "water" : balcony.surface === "wood" ? "wood" : "stone",
                color: balcony.surface === "water" ? "#5aa5b8" : balcony.surface === "wood" ? spec.palette.wood : "#c4bfb6",
                ...(balcony.surface === "water" ? {} : { texture: balcony.surface === "wood" ? ("planks" as const) : ("paving" as const) }),
                group,
            });
        }
        // 墙：户型和单个房间的外墙另出一截矮墙，剖开时换上。
        const extMaterial: SceneMaterial = floor.wallMaterial || "wall";
        const extColor = floor.wallColor || (extMaterial === "wall" ? spec.palette.wall : undefined);
        for (const seg of segs) {
            const cap = capped ? Math.min(level.wallTop, level.top + CUT_HEIGHT) : level.wallTop;
            const height = cap - level.wallBase;
            const facade = facadeOf(level, seg);
            const tag = facade ? { facade } : {};
            const openings: SceneOpening[] = [];
            const { a, b } = segEnds(seg);
            for (const hole of seg.holes) {
                const bottom = level.top - level.wallBase + hole.bottom;
                const holeHeight = Math.min(hole.height, height - bottom - 0.05);
                // 墙被剖低时：门洞照样开着，窗洞只开一截就不开了（矮墙上留个缺口很难看）。
                if (holeHeight < 0.3 || (!DOOR_KINDS.has(hole.kind) && holeHeight < hole.height - 0.01)) continue;
                openings.push({ kind: "hole", offset: r3(hole.center - a), width: hole.width, bottom: r3(bottom), height: r3(holeHeight) });
                if (holeHeight >= hole.height - 0.01) openingDetails(level, seg, hole, spec, objects, tag);
            }
            const [sx, sz] = onSeg(seg, a, 0);
            const [ex, ez] = onSeg(seg, b, 0);
            const look = {
                material: seg.ext ? extMaterial : ("wall" as SceneMaterial),
                ...(seg.ext ? (extColor ? { color: extColor } : {}) : { color: spec.palette.interior }),
                ...(seg.ext && extMaterial === "brick" ? { texture: "brick" as const } : seg.ext && extMaterial === "stone" ? { texture: "stone" as const } : {}),
            };
            objects.push({ shape: "wall", start: [sx, sz], end: [ex, ez], base: r3(level.wallBase), height: r3(height), thickness: seg.t, ...(openings.length ? { openings } : {}), ...look, group, ...tag });
            if (facade) objects.push({ shape: "wall", start: [sx, sz], end: [ex, ez], base: r3(level.wallBase), height: CURB, thickness: seg.t, ...look, group, facade: { ...facade, curb: true } });
        }
        // 柱子、烟道：到顶的实心块，和墙重叠的部分去掉。
        const wallRects = segs.map((seg) => segRect(seg));
        const pillarTop = capped ? Math.min(level.wallTop, level.top + CUT_HEIGHT) : level.wallTop;
        for (const pillar of floor.pillars)
            for (const [x1, z1, x2, z2] of gridRegion([pillar], wallRects)) {
                if (x2 - x1 < 0.02 || z2 - z1 < 0.02) continue;
                objects.push({ shape: "box", position: [r3((x1 + x2) / 2), r3((level.top + pillarTop) / 2), r3((z1 + z2) / 2)], size: [r3(x2 - x1), r3(pillarTop - level.top), r3(z2 - z1)], material: "wall", color: spec.palette.interior, group });
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
            if (balcony.name) labels.push({ text: balcony.name, position: [(balcony.rect[0] + balcony.rect[2]) / 2, level.top + 0.3, (balcony.rect[1] + balcony.rect[3]) / 2] });
            if (balcony.rail === "none") continue;
            const breaks = floor.rooms.flatMap((room) => [room.rect[0], room.rect[1], room.rect[2], room.rect[3]]);
            const covered = (x: number, z: number) => roomAt(floor.rooms, x, z) >= 0;
            for (const side of SIDES) {
                const edge = roomEdge(balcony.rect, side);
                const outward = side === "n" || side === "w" ? -1 : 1;
                for (const [from, to] of exposedIntervals(edge, outward, covered, breaks)) objects.push(...railing(edge.axis, edge.line + outward * -0.04, from, to, level.top, balcony.rail, spec, group));
            }
        }
        const next = levels[index + 1];
        if (next && index + 1 < visibleFloors.length) stairs(level, next, spec, objects);
        // 家具、踢脚线、窗帘、挂画和标注。
        const ceiling = level.wallTop - level.top;
        floor.rooms.forEach((main, roomIndex) => {
            if (main.part) return;
            const members = family(floor, main.name);
            const ctx = roomContext(main, segs, floor.pillars);
            const within = members.map((room) => clearRect(room, segs));
            const listed = floor.furniture.filter((item) => item.room === main.name);
            const placements = layoutRoom(ctx, listed.length ? listed : defaultFurniture(ctx), within, options.onLayoutIssue);
            const lampCeiling = capped ? Math.min(ceiling, CUT_HEIGHT + 1.4) : ceiling;
            placements.forEach((placement, order) => objects.push(...furnitureObjects(placement, spec, level.top + FINISH, lampCeiling, group, roomIndex * 7 + order, backFacade(level, segs, placement))));
            for (const room of members) baseboards(level, room, segs, spec, objects);
            if (!capped) {
                curtains(level, main.type, members, segs, spec, objects);
                wallArt(level, ctx, placements, segs, spec, objects);
            }
            const area = members.reduce((sum, room) => sum + rectArea(room.rect), 0);
            if (main.type === "stair" || area < 1.5) return;
            const detail = members.length > 1 ? `约 ${formatMeters(area)} ㎡` : `${formatMeters(main.rect[2] - main.rect[0])} × ${formatMeters(main.rect[3] - main.rect[1])} m · ${formatMeters(area)} ㎡`;
            labels.push({ text: main.name, detail, position: [r3((main.rect[0] + main.rect[2]) / 2), r3(level.top + Math.min(1.4, ceiling * 0.5)), r3((main.rect[1] + main.rect[3]) / 2)] });
        });
    }
    // 屋顶。
    const topLevel = levels[levels.length - 1];
    if (cut === undefined && spec.roof.type !== "none") {
        const roofFootprint = gridRegion([...topLevel.floor.rooms.map((room) => room.rect), ...topLevel.segs.filter((seg) => seg.ext).map((seg) => segRect(seg))]);
        const y = topLevel.wallTop;
        if (spec.roof.type === "flat") {
            for (const rect of roofFootprint)
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
                const capEnds = segEnds(seg, 0.06);
                objects.push({ ...segBox(seg, (capEnds.a + capEnds.b) / 2, 0, y + 0.85, capEnds.b - capEnds.a, 0.06, seg.t + 0.06, "stone", "#d9d4cc"), group: ROOF_GROUP });
            }
        } else {
            roofRects(roofFootprint).forEach((rect, index) => pitchedRoof({ rect, pitch: spec.roof.pitch * (1 - index * 0.06) }, spec, y, objects));
        }
    }
    if (cut === undefined) site(spec, objects);
    // 地面：建筑按庭院大小，房间和户型按平面外扩一圈（留出尺寸线的位置）。
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
        : { material: "concrete", color: "#e4e1dc", size: [r3(bounds[2] - bounds[0] + (building ? 12 : 5)), r3(bounds[3] - bounds[1] + (building ? 12 : 5))], center, y: groundY, holes: [] };
    const dimensionLevel = levels[cut ?? 0];
    const dimensions = dimensionChains(dimensionLevel.floor, spec, building ? 0.08 : groundY + 0.01);
    return { title: spec.title, summary: spec.summary, ground, objects, labels, dimensions, floors: spec.floors.map((floor) => floor.name), plan: floorBounds(levels[0].floor) };
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
    const [width, depth] = scene.ground.size;
    return {
        title: scene.title,
        summary: scene.summary,
        ground: { material: scene.ground.material, size: scene.ground.size, center: [0, 0], y: -0.005, holes: [] },
        objects: scene.objects,
        labels: scene.labels,
        dimensions: [],
        floors: [],
        plan: [-width / 2, -depth / 2, width / 2, depth / 2],
        legacy: true,
        groups,
    };
}

/** 模型列表和说明里的规模：第二版按房间和家具数，第一版按物体数。 */
export function sceneStats(scene: InteriorSceneData) {
    if (scene.version !== 2) return `${scene.objects.length} 个物体`;
    const rooms = scene.spec.floors.reduce((sum, floor) => sum + floor.rooms.filter((room) => !room.part).length, 0);
    const floors = scene.spec.floors.length;
    const [x1, z1, x2, z2] = floorBounds(scene.spec.floors[0]);
    return [floors > 1 ? `${floors} 层` : "", `${rooms} 个空间`, `${formatMeters(x2 - x1)} × ${formatMeters(z2 - z1)} m`].filter(Boolean).join(" · ");
}
