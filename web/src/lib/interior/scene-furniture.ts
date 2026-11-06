/**
 * 室内设计 3D 模型的家具库：每件家具用十几到几十个零件按真实尺寸拼出来。沙发有底座、坐垫、斜靠的靠垫和抱枕，
 * 床有软包床头、床垫、被子翻边和搭毯，灯罩、花盆、洁具用旋转体（lathe），桌面、浴缸、窗帘用挤出体（extrude）。
 * 局部坐标：原点在家具占地的中心、落在地面上，正面朝 +z（背面贴墙）。
 * 平的零件（方块）互相之间留出几毫米，不和别的零件同向共面，不会闪烁。
 */
import type { SceneMaterial, SceneObject, SceneTexture, SceneVector } from "./scene-3d";
import type { SpecFurnitureType, SpecPalette } from "./scene-spec";

/** mount：挂在墙上的零件（电视、背景墙、吊柜、烟机、镜子），这面外墙剖开时跟着墙一起隐藏。 */
export type FurniturePart = Omit<SceneObject, "group"> & { mount?: boolean };

type Context = { palette: SpecPalette; color?: string; ceiling: number; seed: number };
type Outline = [number, number][];

const LEG = "#2b2d30";
const WHITE = "#f4f2ee";
const BRASS = "#b9a07a";
const CHROME = "#c0c4c8";
const MIRROR = "#dfe4e8";

function box(size: SceneVector, position: SceneVector, material: SceneMaterial, color?: string, round = 0, texture?: SceneTexture): FurniturePart {
    const base = round > 0 ? { shape: "rbox" as const, round: Math.min(round, Math.min(...size) / 2 - 0.001) } : { shape: "box" as const };
    return { ...base, size, position, material, ...(color ? { color } : {}), ...(texture ? { texture } : {}) };
}

function cylinder(radius: number, height: number, position: SceneVector, material: SceneMaterial, color?: string, radiusTop?: number): FurniturePart {
    return { shape: "cylinder", radius, height, position, material, ...(radiusTop !== undefined ? { radiusTop } : {}), ...(color ? { color } : {}) };
}

function sphere(radius: number, position: SceneVector, material: SceneMaterial, color?: string, scale?: SceneVector): FurniturePart {
    return { shape: "sphere", radius, position, material, ...(scale ? { scale } : {}), ...(color ? { color } : {}) };
}

/** 旋转体：profile 是 [半径, 高度]，从下往上，position 是底面中心。 */
function lathe(profile: Outline, position: SceneVector, material: SceneMaterial, color?: string, segments = 32): FurniturePart {
    return { shape: "lathe", profile, segments, position, material, ...(color ? { color } : {}) };
}

/** 水平的板：outline 是俯视轮廓 [x, z]，厚 height，position 是板的中心。 */
function slab(outline: Outline, height: number, position: SceneVector, material: SceneMaterial, color?: string, texture?: SceneTexture): FurniturePart {
    return { shape: "extrude", outline, depth: height, axis: "y", position, material, ...(color ? { color } : {}), ...(texture ? { texture } : {}) };
}

/** 竖直的板：outline 是正视轮廓 [x, y]，沿 z 厚 depth，position 是板的中心（轮廓的 y 相对 position）。 */
function panel(outline: Outline, depth: number, position: SceneVector, material: SceneMaterial, color?: string): FurniturePart {
    return { shape: "extrude", outline, depth, axis: "z", position, material, ...(color ? { color } : {}) };
}

function mounted(part: FurniturePart): FurniturePart {
    return { ...part, mount: true };
}

function tilt(part: FurniturePart, rotation: SceneVector): FurniturePart {
    return { ...part, rotation };
}

function roundedRect(w: number, d: number, radius: number, steps = 4): Outline {
    const r = Math.max(0.002, Math.min(radius, w / 2 - 0.002, d / 2 - 0.002));
    const points: Outline = [];
    const corners: [number, number, number][] = [
        [w / 2 - r, d / 2 - r, 0],
        [-w / 2 + r, d / 2 - r, 90],
        [-w / 2 + r, -d / 2 + r, 180],
        [w / 2 - r, -d / 2 + r, 270],
    ];
    for (const [cx, cz, start] of corners)
        for (let index = 0; index <= steps; index += 1) {
            const angle = ((start + (90 * index) / steps) * Math.PI) / 180;
            points.push([cx + Math.cos(angle) * r, cz + Math.sin(angle) * r]);
        }
    return points;
}

function ellipse(w: number, d: number, steps = 32): Outline {
    return Array.from({ length: steps }, (_, index): [number, number] => {
        const angle = (index / steps) * Math.PI * 2;
        return [(Math.cos(angle) * w) / 2, (Math.sin(angle) * d) / 2];
    });
}

function vase(radius: number, height: number): Outline {
    return [
        [0, 0],
        [radius * 0.55, 0],
        [radius, height * 0.35],
        [radius * 0.82, height * 0.72],
        [radius * 0.38, height * 0.88],
        [radius * 0.46, height],
        [0, height],
    ];
}

function pot(radius: number, height: number): Outline {
    return [
        [0, 0],
        [radius * 0.72, 0],
        [radius, height * 0.9],
        [radius * 1.07, height * 0.93],
        [radius * 1.07, height],
        [radius * 0.95, height],
        [radius * 0.93, height * 0.95],
        [0, height * 0.95],
    ];
}

function drum(bottom: number, top: number, height: number): Outline {
    return [
        [0, 0],
        [bottom, 0],
        [top, height],
        [0, height],
    ];
}

function shade(hex: string, amount: number) {
    const value = Number.parseInt(hex.slice(1), 16);
    const channel = (shift: number) => Math.round(Math.min(255, Math.max(0, ((value >> shift) & 255) * (1 + amount))));
    return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

function offset(part: FurniturePart, by: SceneVector): FurniturePart {
    return part.position ? { ...part, position: [part.position[0] + by[0], part.position[1] + by[1], part.position[2] + by[2]] } : part;
}

function round3(value: number) {
    return Math.round(value * 1000) / 1000;
}

/** 局部旋转（度，绕 y）加平移，用来把椅子、床头柜等放到家具里的位置。 */
export function place(part: FurniturePart, position: SceneVector, rotation: number): FurniturePart {
    const angle = (rotation * Math.PI) / 180;
    const [x, y, z] = part.position || [0, 0, 0];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const next: FurniturePart = { ...part, position: [round3(x * cos + z * sin + position[0]), round3(y + position[1]), round3(-x * sin + z * cos + position[2])] };
    const current = part.rotation || [0, 0, 0];
    const yaw = current[1] + rotation;
    if (current[0] || current[2] || yaw % 360) next.rotation = [current[0], yaw, current[2]];
    else delete next.rotation;
    return next;
}

/** 四条腿：在 w × d 的范围内，上粗下细；splay 是腿往外撇的角度。 */
function legs(w: number, d: number, height: number, color = LEG, radius = 0.02, splay = 0): FurniturePart[] {
    const x = w / 2;
    const z = d / 2;
    return [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
    ].map(([sx, sz]) => {
        const leg = cylinder(radius * 0.7, height, [sx * x, height / 2, sz * z], "wood-dark", color, radius);
        return splay ? tilt(leg, [-sz * splay, 0, sx * splay]) : leg;
    });
}

function tableLamp(position: SceneVector, height = 0.5, glow = "#efe2cc"): FurniturePart[] {
    const [x, y, z] = position;
    return [
        lathe(
            [
                [0, 0],
                [0.07, 0],
                [0.075, 0.015],
                [0.03, 0.045],
                [0.012, 0.06],
                [0, 0.06],
            ],
            [x, y, z],
            "ceramic",
            "#e6dfd3",
        ),
        cylinder(0.008, height - 0.24, [x, y + 0.06 + (height - 0.24) / 2, z], "metal", BRASS),
        lathe(drum(0.13, 0.09, 0.2), [x, y + height - 0.2, z], "light", glow),
    ];
}

function cushionedSeat(w: number, d: number, fabric: string, accent: string, arms = 0.16): FurniturePart[] {
    const seatW = w - arms * 2;
    const count = Math.max(1, Math.round(seatW / 0.68));
    const width = seatW / count;
    const parts: FurniturePart[] = [
        box([w - 0.02, 0.2, d - 0.04], [0, 0.2, 0], "fabric", shade(fabric, -0.1), 0.04, "weave"),
        box([w, 0.5, 0.18], [0, 0.5, -d / 2 + 0.09], "fabric", fabric, 0.06, "weave"),
        box([arms, 0.32, d], [-w / 2 + arms / 2, 0.42, 0], "fabric", fabric, 0.06, "weave"),
        box([arms, 0.32, d], [w / 2 - arms / 2, 0.42, 0], "fabric", fabric, 0.06, "weave"),
        ...legs(w - 0.12, d - 0.14, 0.1, "#5a4030", 0.022),
    ];
    for (let index = 0; index < count; index += 1) {
        const x = -seatW / 2 + width * (index + 0.5);
        parts.push(box([width - 0.015, 0.13, d - 0.24], [x, 0.365, 0.07], "fabric", shade(fabric, 0.05), 0.05, "weave"));
        parts.push(tilt(box([width - 0.03, 0.4, 0.15], [x, 0.63, -d / 2 + 0.25], "fabric", shade(fabric, 0.08), 0.07, "weave"), [-10, 0, 0]));
    }
    if (seatW >= 1.2) {
        parts.push(tilt(box([0.42, 0.4, 0.13], [-seatW / 2 + 0.3, 0.62, -d / 2 + 0.4], "fabric", accent, 0.06), [-14, 12, 0]));
        parts.push(tilt(box([0.4, 0.38, 0.12], [seatW / 2 - 0.3, 0.62, -d / 2 + 0.4], "fabric", shade(accent, 0.25), 0.06), [-14, -12, 0]));
    }
    return parts;
}

function sofaL(w: number, d: number, fabric: string, accent: string): FurniturePart[] {
    // 靠墙一边是普通沙发，右边往前接一段贵妃位。
    const depth = Math.min(0.92, d - 0.5);
    const chaise = Math.min(0.95, w * 0.35);
    const length = d - depth;
    const x = w / 2 - chaise / 2;
    const z = -d / 2 + depth + length / 2;
    return [
        ...cushionedSeat(w, depth, fabric, accent).map((part) => offset(part, [0, 0, -(d - depth) / 2])),
        box([chaise - 0.02, 0.2, length + 0.02], [x, 0.2, z - 0.01], "fabric", shade(fabric, -0.1), 0.04, "weave"),
        box([chaise - 0.2, 0.13, length - 0.04], [x - 0.09, 0.365, z], "fabric", shade(fabric, 0.05), 0.05, "weave"),
        box([0.16, 0.32, length], [w / 2 - 0.08, 0.42, z], "fabric", fabric, 0.06, "weave"),
        cylinder(0.015, 0.1, [w / 2 - 0.08, 0.05, d / 2 - 0.08], "wood-dark", "#5a4030", 0.022),
        cylinder(0.015, 0.1, [w / 2 - chaise + 0.08, 0.05, d / 2 - 0.08], "wood-dark", "#5a4030", 0.022),
    ];
}

function armchair(w: number, d: number, fabric: string, wood: string): FurniturePart[] {
    return [
        box([w - 0.04, 0.16, d - 0.06], [0, 0.29, 0.01], "fabric", shade(fabric, -0.06), 0.05, "weave"),
        box([w - 0.3, 0.11, d - 0.22], [0, 0.42, 0.07], "fabric", shade(fabric, 0.06), 0.05, "weave"),
        tilt(box([w - 0.06, 0.5, 0.14], [0, 0.64, -d / 2 + 0.11], "fabric", fabric, 0.06, "weave"), [-8, 0, 0]),
        box([0.13, 0.26, d - 0.08], [-w / 2 + 0.085, 0.47, 0], "fabric", fabric, 0.05, "weave"),
        box([0.13, 0.26, d - 0.08], [w / 2 - 0.085, 0.47, 0], "fabric", fabric, 0.05, "weave"),
        ...legs(w - 0.14, d - 0.16, 0.22, shade(wood, -0.3), 0.02, 7),
    ];
}

function coffeeTable(w: number, d: number, wood: string, accent: string, seed: number): FurniturePart[] {
    const round = Math.abs(w - d) < 0.15;
    const outline = round ? ellipse(w, d) : roundedRect(w, d, 0.08);
    return [
        slab(outline, 0.035, [0, 0.4, 0], "wood", wood, "grain"),
        slab(round ? ellipse(w - 0.16, d - 0.16) : roundedRect(w - 0.14, d - 0.14, 0.05), 0.02, [0, 0.14, 0], "wood", shade(wood, -0.12), "grain"),
        ...legs(w - (round ? 0.36 : 0.16), d - (round ? 0.36 : 0.14), 0.3825, shade(wood, -0.3), 0.018),
        box([0.34, 0.015, 0.22], [w / 4, 0.425, 0], "metal", BRASS, 0.004),
        lathe(vase(0.06, 0.2), [w / 4 + 0.07, 0.4325, 0.02], "ceramic", seed % 2 ? accent : "#e8e2d8"),
        box([0.24, 0.03, 0.17], [-w / 4, 0.433, 0.02], "fabric", "#3e5a6b", 0.004),
        box([0.22, 0.025, 0.16], [-w / 4 + 0.01, 0.461, 0.02], "fabric", "#d8cdb8", 0.004),
    ];
}

function sideTable(w: number, wood: string): FurniturePart[] {
    return [
        cylinder(w / 2, 0.03, [0, 0.545, 0], "wood", wood),
        lathe(
            [
                [0, 0],
                [w / 3, 0],
                [w / 3, 0.02],
                [0.025, 0.06],
                [0.02, 0.53],
                [0, 0.53],
            ],
            [0, 0, 0],
            "metal-dark",
            LEG,
        ),
        ...tableLamp([0, 0.56, 0], 0.42),
    ];
}

function tvCabinet(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const dark = shade(wood, -0.4);
    const lift = 0.12;
    const body = 0.42;
    const doors = Math.max(2, Math.round(w / 0.6));
    const tvW = Math.min(1.65, w * 0.75);
    const tvH = tvW * 0.57;
    const wallHeight = Math.min(2.5, context.ceiling - 0.25);
    const parts: FurniturePart[] = [
        mounted(box([w + 0.6, wallHeight, 0.006], [0, wallHeight / 2, -d / 2 - 0.004], "stone", shade(context.palette.interior, -0.05), 0, "marble")),
        box([w, body, d - 0.03], [0, lift + body / 2, 0.015], "wood", wood, 0, "grain"),
        box([w - 0.1, lift, d - 0.14], [0, lift / 2, 0], "wood-dark", dark),
        mounted(box([tvW, tvH, 0.035], [0, 1.25, -d / 2 + 0.0175], "metal-dark", "#121314")),
        mounted(box([tvW - 0.03, tvH - 0.03, 0.004], [0, 1.25, -d / 2 + 0.037], "glass", "#1d2329")),
        box([Math.min(0.9, w * 0.5), 0.06, 0.08], [0, lift + body + 0.03, 0.02], "metal-dark", "#1b1c1e", 0.01),
        lathe(vase(0.07, 0.26), [w / 2 - 0.22, lift + body, 0], "ceramic", context.palette.accent),
        ...plant(0.3, context.seed).map((part) => offset(part, [-w / 2 + 0.22, lift + body, 0])),
    ];
    for (let index = 1; index < doors; index += 1) parts.push(box([0.006, body - 0.06, 0.004], [-w / 2 + (w / doors) * index, lift + body / 2, d / 2 + 0.002], "wood-dark", dark));
    for (let index = 0; index < doors; index += 1) parts.push(box([0.16, 0.012, 0.02], [-w / 2 + (w / doors) * (index + 0.5), lift + body - 0.07, d / 2 + 0.01], "metal", BRASS));
    return parts;
}

function diningChair(position: SceneVector, rotation: number, wood: string, fabric: string): FurniturePart[] {
    const parts: FurniturePart[] = [
        box([0.44, 0.04, 0.42], [0, 0.43, 0], "wood", wood, 0.008, "grain"),
        box([0.4, 0.05, 0.37], [0, 0.475, 0.015], "fabric", fabric, 0.02, "weave"),
        tilt(box([0.42, 0.3, 0.03], [0, 0.75, -0.2], "wood", wood, 0.012, "grain"), [-9, 0, 0]),
        cylinder(0.012, 0.36, [-0.18, 0.63, -0.2], "wood-dark", shade(wood, -0.2), 0.015),
        cylinder(0.012, 0.36, [0.18, 0.63, -0.2], "wood-dark", shade(wood, -0.2), 0.015),
        ...legs(0.36, 0.36, 0.41, shade(wood, -0.2), 0.017, 4),
    ];
    return parts.map((part) => place(part, position, rotation));
}

function diningTable(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    const tableW = Math.max(0.9, w - 0.2);
    const tableD = Math.max(0.7, d - 0.1);
    const parts: FurniturePart[] = [
        slab(roundedRect(tableW, tableD, 0.04), 0.035, [0, 0.7425, 0], "wood", wood, "grain"),
        box([tableW - 0.18, 0.07, tableD - 0.18], [0, 0.69, 0], "wood", shade(wood, -0.1)),
        ...legs(tableW - 0.2, tableD - 0.2, 0.725, shade(wood, -0.2), 0.03),
    ];
    const perSide = Math.max(1, Math.floor(tableW / 0.6));
    for (let index = 0; index < perSide; index += 1) {
        const x = -tableW / 2 + (tableW / perSide) * (index + 0.5);
        parts.push(...diningChair([x, 0, tableD / 2 + 0.2], 180, wood, fabric), ...diningChair([x, 0, -tableD / 2 - 0.2], 0, wood, fabric));
    }
    if (tableW >= 1.8) parts.push(...diningChair([tableW / 2 + 0.24, 0, 0], -90, wood, fabric), ...diningChair([-tableW / 2 - 0.24, 0, 0], 90, wood, fabric));
    parts.push(lathe(vase(0.07, 0.24), [0, 0.76, 0], "ceramic", "#e8e2d8"));
    return parts;
}

function roundTable(w: number, wood: string, fabric: string): FurniturePart[] {
    const radius = Math.max(0.45, w / 2 - 0.25);
    const parts: FurniturePart[] = [
        cylinder(radius, 0.035, [0, 0.7425, 0], "wood", wood),
        lathe(
            [
                [0, 0],
                [0.32, 0],
                [0.32, 0.03],
                [0.08, 0.08],
                [0.06, 0.725],
                [0, 0.725],
            ],
            [0, 0, 0],
            "wood",
            shade(wood, -0.15),
        ),
    ];
    const count = Math.max(3, Math.min(8, Math.round((radius * 2 * Math.PI) / 0.65)));
    for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2;
        parts.push(...diningChair([Math.sin(angle) * (radius + 0.2), 0, Math.cos(angle) * (radius + 0.2)], (angle * 180) / Math.PI + 180, wood, fabric));
    }
    return parts;
}

function nightstand(x: number, z: number, wood: string): FurniturePart[] {
    const dark = shade(wood, -0.35);
    return [
        box([0.46, 0.42, 0.4], [x, 0.31, z], "wood", wood, 0.015, "grain"),
        box([0.4, 0.004, 0.006], [x, 0.36, z + 0.2], "wood-dark", dark),
        box([0.12, 0.012, 0.02], [x, 0.45, z + 0.21], "metal", BRASS),
        ...legs(0.38, 0.32, 0.1, dark, 0.014).map((part) => offset(part, [x, 0, z])),
        ...tableLamp([x - 0.06, 0.52, z - 0.04], 0.46),
        box([0.16, 0.03, 0.22], [x + 0.12, 0.535, z + 0.04], "fabric", "#3e5a6b", 0.004),
    ];
}

function bed(w: number, d: number, context: Context, withStands: boolean): FurniturePart[] {
    const stand = withStands && w >= 2.4 ? 0.5 : 0;
    const bedW = w - stand * 2;
    const fabric = context.color || context.palette.fabric;
    const wood = context.palette.wood;
    const accent = context.palette.accent;
    const head = shade(fabric, -0.18);
    const duvetDepth = d * 0.66;
    const duvetZ = d / 2 - duvetDepth / 2 - 0.02;
    const parts: FurniturePart[] = [
        box([bedW, 0.26, d - 0.06], [0, 0.2, 0.03], "fabric", shade(fabric, -0.12), 0.03, "weave"),
        box([bedW - 0.08, 0.22, d - 0.2], [0, 0.44, 0.06], "fabric", WHITE, 0.07),
        box([bedW + 0.02, 0.07, duvetDepth], [0, 0.565, duvetZ], "fabric", fabric, 0.03, "weave"),
        box([bedW + 0.03, 0.08, 0.22], [0, 0.6, duvetZ - duvetDepth / 2 + 0.11], "fabric", shade(fabric, 0.12), 0.035, "weave"),
        box([0.03, 0.24, duvetDepth], [-bedW / 2 - 0.01, 0.46, duvetZ], "fabric", fabric, 0.012, "weave"),
        box([0.03, 0.24, duvetDepth], [bedW / 2 + 0.01, 0.46, duvetZ], "fabric", fabric, 0.012, "weave"),
        box([bedW + 0.06, 0.025, 0.42], [0, 0.612, d / 2 - 0.32], "fabric", shade(accent, 0.1), 0.01, "weave"),
        box([bedW + 0.12, 1.05, 0.1], [0, 0.56, -d / 2 + 0.05], "fabric", head, 0.04, "weave"),
        ...legs(bedW - 0.12, d - 0.2, 0.07, shade(wood, -0.3), 0.025),
    ];
    const channels = Math.max(3, Math.round(bedW / 0.3));
    const channel = bedW / channels;
    for (let index = 0; index < channels; index += 1) parts.push(box([channel - 0.014, 0.7, 0.05], [-bedW / 2 + channel * (index + 0.5), 0.74, -d / 2 + 0.115], "fabric", shade(head, 0.08), 0.022, "weave"));
    const pillows = bedW >= 1.4 ? 2 : 1;
    for (let index = 0; index < pillows; index += 1) {
        const x = pillows === 1 ? 0 : (index ? 1 : -1) * (bedW / 4);
        parts.push(tilt(box([Math.min(0.64, bedW / pillows - 0.12), 0.15, 0.4], [x, 0.66, -d / 2 + 0.38], "fabric", WHITE, 0.07), [-16, 0, 0]));
        if (bedW >= 1.4) parts.push(tilt(box([0.38, 0.3, 0.1], [x * 0.7, 0.72, -d / 2 + 0.55], "fabric", index ? accent : shade(accent, 0.25), 0.05), [-14, index ? -8 : 8, 0]));
    }
    if (stand) parts.push(...nightstand(-w / 2 + 0.25, -d / 2 + 0.24, wood), ...nightstand(w / 2 - 0.25, -d / 2 + 0.24, wood));
    return parts;
}

function bunkBed(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.palette.wood;
    const fabric = context.color || context.palette.fabric;
    const parts: FurniturePart[] = [];
    for (const [x, z] of [
        [-w / 2 + 0.03, -d / 2 + 0.03],
        [w / 2 - 0.03, -d / 2 + 0.03],
        [-w / 2 + 0.03, d / 2 - 0.03],
        [w / 2 - 0.03, d / 2 - 0.03],
    ])
        parts.push(box([0.06, 1.75, 0.06], [x, 0.875, z], "wood", wood, 0.01, "grain"));
    for (const y of [0.3, 1.32]) {
        parts.push(box([w - 0.1, 0.08, d - 0.1], [0, y, 0], "wood", wood, 0.01, "grain"));
        parts.push(box([w - 0.14, 0.16, d - 0.16], [0, y + 0.12, 0], "fabric", WHITE, 0.05));
        parts.push(box([w - 0.12, 0.05, d * 0.6], [0, y + 0.22, d * 0.18], "fabric", fabric, 0.02, "weave"));
        parts.push(box([w - 0.3, 0.12, 0.34], [0, y + 0.26, -d / 2 + 0.26], "fabric", WHITE, 0.05));
    }
    parts.push(box([0.03, 0.2, d * 0.6], [w / 2 - 0.03, 1.62, -d * 0.18], "wood", wood, 0.01), box([0.03, 0.2, d - 0.12], [-w / 2 + 0.03, 1.62, 0], "wood", wood, 0.01));
    for (let rung = 0; rung < 4; rung += 1) parts.push(box([0.03, 0.03, 0.36], [w / 2 + 0.02, 0.45 + rung * 0.3, d / 2 - 0.3], "wood", shade(wood, -0.1), 0.01));
    return parts;
}

/** 柜体：柜身、踢脚、门板（门缝 6 毫米）和拉手，门板在柜身前面 2 厘米。 */
function cabinetBody(w: number, d: number, height: number, wood: string, doors: number, plinth = 0.08, handle: "bar" | "knob" = "bar"): FurniturePart[] {
    const dark = shade(wood, -0.4);
    const front = d / 2 - 0.02;
    const parts: FurniturePart[] = [box([w, height - plinth, d - 0.02], [0, plinth + (height - plinth) / 2, -0.01], "wood", shade(wood, -0.06), 0, "grain"), box([w - 0.04, plinth, d - 0.08], [0, plinth / 2, -0.03], "wood-dark", dark)];
    const doorW = w / doors;
    for (let index = 0; index < doors; index += 1) {
        const x = -w / 2 + doorW * (index + 0.5);
        parts.push(box([doorW - 0.006, height - plinth - 0.02, 0.018], [x, plinth + 0.01 + (height - plinth - 0.02) / 2, front + 0.009], "wood", wood, 0, "grain"));
        const edge = x + (index % 2 ? -1 : 1) * (doorW / 2 - 0.05);
        if (handle === "bar") parts.push(box([0.016, Math.min(0.32, height * 0.3), 0.022], [edge, Math.min(1.05, plinth + (height - plinth) * 0.55), front + 0.029], "metal", BRASS));
        else parts.push(cylinder(0.014, 0.022, [edge, plinth + (height - plinth) * 0.75, front + 0.029], "metal", BRASS));
    }
    return parts;
}

function wardrobe(w: number, d: number, wood: string, ceiling: number): FurniturePart[] {
    return cabinetBody(w, d, Math.min(2.4, ceiling - 0.05), wood, Math.max(2, Math.round(w / 0.5)));
}

function sideboard(w: number, d: number, height: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    return [
        ...cabinetBody(w, d, height, wood, Math.max(2, Math.round(w / 0.5)), 0.1),
        box([w + 0.02, 0.03, d + 0.01], [0, height + 0.015, 0.005], "stone", "#e6e1d9", 0, "marble"),
        lathe(vase(0.09, 0.32), [w / 3, height + 0.03, -0.02], "ceramic", context.palette.accent),
        box([0.3, 0.04, 0.22], [-w / 4, height + 0.05, 0], "fabric", "#3e5a6b", 0.005),
        ...plant(0.26, context.seed).map((part) => offset(part, [-w / 4 - 0.25, height + 0.03, 0])),
    ];
}

function dresser(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    return [
        ...cabinetBody(w, d, 0.74, wood, 2, 0.08, "knob"),
        box([w + 0.01, 0.025, d + 0.005], [0, 0.7525, 0.0025], "wood", shade(wood, 0.06), 0, "grain"),
        mounted(panel(roundedRect(0.6, 0.8, 0.3, 6), 0.012, [0, 1.36, -d / 2 + 0.03], "metal", MIRROR)),
        mounted(panel(roundedRect(0.64, 0.84, 0.32, 6), 0.012, [0, 1.36, -d / 2 + 0.015], "metal", BRASS)),
        lathe(
            [
                [0, 0],
                [0.17, 0],
                [0.18, 0.3],
                [0.17, 0.44],
                [0, 0.46],
            ],
            [0, 0, d / 2 + 0.3],
            "fabric",
            fabric,
        ),
        ...tableLamp([w / 2 - 0.15, 0.765, -0.05], 0.4),
    ];
}

function desk(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    return [
        slab(roundedRect(w, d, 0.02), 0.035, [0, 0.74, 0], "wood", wood, "grain"),
        box([0.04, 0.72, d - 0.04], [-w / 2 + 0.04, 0.36, 0], "metal-dark", LEG),
        box([0.04, 0.72, d - 0.04], [w / 2 - 0.04, 0.36, 0], "metal-dark", LEG),
        box([0.4, 0.42, d - 0.1], [w / 2 - 0.29, 0.23, 0], "wood", shade(wood, -0.1), 0.01, "grain"),
        box([0.56, 0.34, 0.025], [0, 1.03, -d / 2 + 0.14], "metal-dark", "#15171a", 0.008),
        box([0.53, 0.31, 0.004], [0, 1.03, -d / 2 + 0.1545], "glass", "#25303a"),
        cylinder(0.015, 0.16, [0, 0.84, -d / 2 + 0.12], "metal", CHROME),
        box([0.22, 0.012, 0.16], [0, 0.763, -d / 2 + 0.12], "metal", CHROME, 0.004),
        box([0.42, 0.015, 0.14], [0, 0.765, 0.05], "metal-dark", "#3a3d42", 0.004),
        box([0.06, 0.02, 0.1], [0.3, 0.767, 0.06], "metal-dark", "#3a3d42", 0.008),
        ...tableLamp([-w / 2 + 0.18, 0.7575, -d / 2 + 0.15], 0.42),
        ...officeChair([0, 0, d / 2 + 0.3], fabric),
    ];
}

function officeChair(position: SceneVector, fabric: string): FurniturePart[] {
    const color = shade(fabric, -0.3);
    const parts: FurniturePart[] = [
        box([0.5, 0.08, 0.48], [0, 0.48, 0], "fabric", color, 0.03, "weave"),
        tilt(box([0.46, 0.52, 0.06], [0, 0.84, 0.23], "fabric", color, 0.03, "weave"), [10, 0, 0]),
        cylinder(0.025, 0.34, [0, 0.27, 0], "metal", CHROME),
        cylinder(0.04, 0.06, [0, 0.11, 0], "metal-dark", LEG),
    ];
    for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * 360;
        const radians = (angle * Math.PI) / 180;
        parts.push(tilt(box([0.3, 0.03, 0.04], [Math.cos(radians) * 0.15, 0.08, -Math.sin(radians) * 0.15], "metal-dark", LEG, 0.01), [0, angle, 0]));
        parts.push(sphere(0.025, [Math.cos(radians) * 0.3, 0.025, -Math.sin(radians) * 0.3], "metal-dark", LEG));
    }
    return parts.map((part) => offset(part, position));
}

function bookshelf(w: number, d: number, height: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const shelves = Math.max(3, Math.round(height / 0.38));
    const parts: FurniturePart[] = [
        box([0.03, height, d], [-w / 2 + 0.015, height / 2, 0], "wood", wood, 0, "grain"),
        box([0.03, height, d], [w / 2 - 0.015, height / 2, 0], "wood", wood, 0, "grain"),
        box([w - 0.06, height, 0.015], [0, height / 2, -d / 2 + 0.008], "wood", shade(wood, -0.1)),
    ];
    const bookColors = ["#7a5236", "#3e5a6b", "#a85a43", "#d8cdb8", "#4f6b4a", "#2b2d30", "#c4a46a"];
    for (let index = 0; index <= shelves; index += 1) {
        const y = (height / shelves) * index;
        parts.push(box([w - 0.06, 0.025, d - 0.02], [0, Math.max(0.0125, Math.min(height - 0.0125, y)), 0.005], "wood", wood, 0, "grain"));
        if (index === shelves) continue;
        let x = -w / 2 + 0.06;
        for (let book = 0; x < w / 2 - 0.12; book += 1) {
            const seed = (index * 7 + book * 3 + context.seed) % bookColors.length;
            const bw = 0.03 + ((seed * 13) % 5) * 0.008;
            const bh = Math.min(height / shelves - 0.06, 0.22 + ((seed * 5) % 4) * 0.025);
            if ((book + index + context.seed) % 6 === 5) {
                if ((book + index) % 2) parts.push(lathe(vase(0.05, 0.18), [x + 0.06, y + 0.025, 0], "ceramic", context.palette.accent));
                x += 0.14;
                continue;
            }
            parts.push(box([bw, bh, d - 0.1], [x + bw / 2, y + 0.0125 + bh / 2, 0.01], "fabric", bookColors[seed]));
            x += bw + 0.004;
        }
    }
    return parts;
}

/** 一排地柜：柜体、门板、石英石台面（前沿出 3 厘米）。 */
function baseRun(w: number, d: number, wood: string): FurniturePart[] {
    return [...cabinetBody(w, d - 0.02, 0.86, wood, Math.max(2, Math.round(w / 0.6)), 0.1).map((part) => offset(part, [0, 0, -0.01])), box([w, 0.04, d + 0.01], [0, 0.88, 0.005], "marble", "#ebe8e3", 0, "marble")];
}

/** 一字橱柜：地柜、台面、水槽和龙头、灶台、挡水墙砖、吊柜（让开烟机）、烟机和灯带。 */
function kitchenLine(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const sinkX = -w / 4;
    const hobX = w / 4;
    const parts: FurniturePart[] = [
        ...baseRun(w, d, wood),
        box([0.62, 0.006, 0.44], [sinkX, 0.903, 0.02], "metal", "#9aa0a6"),
        box([0.56, 0.004, 0.38], [sinkX, 0.908, 0.02], "metal-dark", "#5d636a"),
        cylinder(0.016, 0.32, [sinkX, 1.06, -d / 2 + 0.08], "metal", CHROME),
        tilt(cylinder(0.012, 0.18, [sinkX, 1.21, -d / 2 + 0.16], "metal", CHROME), [90, 0, 0]),
        box([0.6, 0.008, 0.5], [hobX, 0.904, 0.02], "glass", "#141516"),
        mounted(box([w, 0.6, 0.008], [0, 1.2, -d / 2 + 0.004], "tile", "#f1efea", 0, "tiles")),
        mounted(box([0.9, 0.1, 0.5], [hobX, 1.6, -d / 2 + 0.25], "metal", CHROME, 0.01)),
        mounted(box([0.32, 0.65, 0.26], [hobX, 1.975, -d / 2 + 0.13], "metal", CHROME, 0.01)),
    ];
    for (const [dx, dz] of [
        [-0.14, -0.08],
        [0.14, -0.08],
        [-0.14, 0.13],
        [0.14, 0.13],
    ])
        parts.push(cylinder(0.075, 0.004, [hobX + dx, 0.91, dz], "metal-dark", "#3a3d42"));
    // 吊柜让开烟机：分成左右两段。
    for (const [from, to] of [
        [-w / 2, hobX - 0.48],
        [hobX + 0.48, w / 2],
    ]) {
        const length = to - from;
        if (length < 0.3) continue;
        const center = (from + to) / 2;
        const doors = Math.max(1, Math.round(length / 0.45));
        parts.push(mounted(box([length, 0.68, 0.33], [center, 1.84, -d / 2 + 0.165], "wood", shade(wood, 0.06), 0, "grain")));
        for (let index = 0; index < doors; index += 1) {
            const x = from + (length / doors) * (index + 0.5);
            parts.push(mounted(box([length / doors - 0.006, 0.66, 0.018], [x, 1.84, -d / 2 + 0.339], "wood", shade(wood, 0.1), 0, "grain")));
            parts.push(mounted(box([0.12, 0.012, 0.02], [x, 1.53, -d / 2 + 0.358], "metal", BRASS)));
        }
        parts.push(mounted(box([length - 0.06, 0.012, 0.02], [center, 1.494, -d / 2 + 0.3], "light", "#fff4d6")));
    }
    return parts;
}

/** L 型橱柜：背面一排一字橱柜，右侧再接一排地柜（和背面那排留 1 厘米缝，台面不重叠）。 */
function kitchenL(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const depth = 0.62;
    const length = d - depth - 0.02;
    const parts = kitchenLine(w, depth, context).map((part) => offset(part, [0, 0, -d / 2 + depth / 2]));
    if (length >= 0.5) parts.push(...baseRun(length, depth, wood).map((part) => place(part, [w / 2 - depth / 2, 0, -d / 2 + depth + 0.02 + length / 2], -90)));
    return parts;
}

function island(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const parts: FurniturePart[] = [...cabinetBody(w - 0.04, d - 0.24, 0.86, wood, Math.max(2, Math.round(w / 0.6)), 0.1).map((part) => offset(part, [0, 0, -0.12])), box([w + 0.06, 0.05, d], [0, 0.885, 0], "marble", "#ece9e4", 0, "marble")];
    const stools = Math.max(1, Math.floor(w / 0.55));
    for (let index = 0; index < stools; index += 1) parts.push(...barStool([-w / 2 + (w / stools) * (index + 0.5), 0, d / 2 + 0.28], 0.66));
    return parts;
}

function barStool(position: SceneVector, height: number): FurniturePart[] {
    const [x, , z] = position;
    return [
        lathe(
            [
                [0, 0],
                [0.19, 0],
                [0.2, 0.03],
                [0.18, 0.06],
                [0, 0.07],
            ],
            [x, height - 0.03, z],
            "leather",
            "#7a5236",
        ),
        cylinder(0.022, height - 0.05, [x, (height - 0.05) / 2, z], "metal-dark", LEG),
        cylinder(0.2, 0.018, [x, 0.009, z], "metal-dark", LEG),
        cylinder(0.15, 0.012, [x, height * 0.42, z], "metal", CHROME, 0.15),
    ];
}

function barCounter(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const parts: FurniturePart[] = [
        box([w, 1.0, d - 0.15], [0, 0.5, -0.075], "wood", wood, 0.01, "grain"),
        box([w + 0.04, 0.05, d], [0, 1.025, 0], "marble", "#ece9e4", 0, "marble"),
        tilt(cylinder(0.015, w - 0.1, [0, 0.25, d / 2 - 0.12], "metal", BRASS), [0, 0, 90]),
    ];
    const stools = Math.max(1, Math.floor(w / 0.55));
    for (let index = 0; index < stools; index += 1) parts.push(...barStool([-w / 2 + (w / stools) * (index + 0.5), 0, d / 2 + 0.25], 0.76));
    return parts;
}

function fridge(w: number, d: number): FurniturePart[] {
    const front = d / 2;
    return [
        box([w, 1.85, d - 0.02], [0, 0.935, -0.01], "metal", "#d4d7da", 0.025),
        box([w / 2 - 0.006, 1.05, 0.02], [-w / 4, 1.32, front], "metal", "#dcdfe2", 0.01),
        box([w / 2 - 0.006, 1.05, 0.02], [w / 4, 1.32, front], "metal", "#dcdfe2", 0.01),
        box([w - 0.01, 0.66, 0.02], [0, 0.44, front], "metal", "#dcdfe2", 0.01),
        box([0.018, 0.42, 0.03], [-0.03, 1.3, front + 0.025], "metal", "#9ea3a8", 0.006),
        box([0.018, 0.42, 0.03], [0.03, 1.3, front + 0.025], "metal", "#9ea3a8", 0.006),
        box([w * 0.5, 0.018, 0.03], [0, 0.72, front + 0.025], "metal", "#9ea3a8", 0.006),
    ];
}

function toilet(): FurniturePart[] {
    return [
        {
            ...lathe(
                [
                    [0, 0],
                    [0.12, 0],
                    [0.14, 0.05],
                    [0.17, 0.3],
                    [0.19, 0.38],
                    [0, 0.38],
                ],
                [0, 0, 0.05],
                "ceramic",
                WHITE,
            ),
            scale: [1, 1, 1.22],
        },
        { ...cylinder(0.19, 0.03, [0, 0.395, 0.05], "ceramic", "#ffffff"), scale: [1, 1, 1.22] },
        box([0.38, 0.36, 0.17], [0, 0.58, -0.255], "ceramic", WHITE, 0.04),
        box([0.4, 0.03, 0.19], [0, 0.775, -0.255], "ceramic", "#ffffff", 0.012),
        cylinder(0.025, 0.012, [0, 0.796, -0.255], "metal", CHROME),
    ];
}

function vanity(w: number, d: number, wood: string): FurniturePart[] {
    return [
        box([w, 0.44, d - 0.02], [0, 0.6, -0.01], "wood", wood, 0.015, "grain"),
        box([w - 0.04, 0.006, 0.006], [0, 0.6, d / 2 - 0.02], "wood-dark", shade(wood, -0.4)),
        box([w + 0.02, 0.03, d + 0.01], [0, 0.835, 0.005], "ceramic", WHITE, 0.008),
        lathe(
            [
                [0, 0],
                [0.12, 0],
                [0.19, 0.08],
                [0.2, 0.13],
                [0.186, 0.13],
                [0.176, 0.085],
                [0.11, 0.025],
                [0, 0.025],
            ],
            [0, 0.85, 0.03],
            "ceramic",
            "#ffffff",
            40,
        ),
        cylinder(0.014, 0.3, [0, 1.0, -d / 2 + 0.06], "metal", CHROME),
        tilt(cylinder(0.01, 0.12, [0, 1.14, -d / 2 + 0.115], "metal", CHROME), [90, 0, 0]),
        mounted(panel(roundedRect(Math.min(w, 0.8), 0.8, 0.08), 0.012, [0, 1.55, -d / 2 + 0.024], "metal", MIRROR)),
        mounted(panel(roundedRect(Math.min(w, 0.8) + 0.04, 0.84, 0.1), 0.012, [0, 1.55, -d / 2 + 0.01], "light", "#fff4dc")),
    ];
}

function shower(w: number, d: number): FurniturePart[] {
    return [
        box([w, 0.05, d], [0, 0.025, 0], "ceramic", "#e8e8e6", 0.01),
        box([w - 0.01, 1.95, 0.01], [0.005, 1.025, d / 2 - 0.005], "glass", "#cfe0e6"),
        box([0.01, 1.95, d], [-w / 2 + 0.005, 1.025, 0], "glass", "#cfe0e6"),
        box([w - 0.01, 0.025, 0.02], [0.005, 2.0125, d / 2 - 0.005], "metal", CHROME, 0.006),
        mounted(cylinder(0.012, 1.15, [w / 4, 1.5, -d / 2 + 0.05], "metal", CHROME)),
        mounted(tilt(cylinder(0.01, 0.26, [w / 4, 2.07, -d / 2 + 0.17], "metal", CHROME), [90, 0, 0])),
        mounted(cylinder(0.12, 0.015, [w / 4, 2.06, -d / 2 + 0.3], "metal", CHROME)),
        cylinder(0.04, 0.004, [0, 0.052, 0], "metal-dark", "#5d636a"),
        mounted(box([0.32, 0.02, 0.12], [-w / 4, 1.15, -d / 2 + 0.06], "ceramic", "#f6f5f2", 0.005)),
    ];
}

function bathtub(w: number, d: number): FurniturePart[] {
    const inner = roundedRect(w - 0.14, d - 0.14, 0.1, 6);
    return [
        { ...slab(roundedRect(w, d, 0.14, 6), 0.55, [0, 0.275, 0], "ceramic", WHITE), holes: [inner] },
        slab(inner, 0.06, [0, 0.1, 0], "ceramic", "#f2f0ec"),
        slab(roundedRect(w - 0.15, d - 0.15, 0.09, 6), 0.012, [0, 0.42, 0], "water", "#8ec5d6"),
        cylinder(0.014, 0.18, [w / 2 - 0.12, 0.64, -d / 2 + 0.035], "metal", CHROME),
        tilt(cylinder(0.01, 0.12, [w / 2 - 0.12, 0.72, -d / 2 + 0.09], "metal", CHROME), [90, 0, 0]),
    ];
}

function washer(w: number, d: number): FurniturePart[] {
    return [
        box([w, 0.85, d], [0, 0.425, 0], "ceramic", "#eceeef", 0.03),
        tilt(cylinder(0.22, 0.02, [0, 0.45, d / 2 + 0.005], "metal", "#b9bec4"), [90, 0, 0]),
        tilt(cylinder(0.18, 0.03, [0, 0.45, d / 2 + 0.012], "glass", "#5a6a74"), [90, 0, 0]),
        box([w - 0.06, 0.09, 0.012], [0, 0.78, d / 2 + 0.004], "metal-dark", "#3a3d42", 0.004),
        cylinder(0.025, 0.02, [w / 4, 0.78, d / 2 + 0.016], "metal", CHROME),
    ];
}

function rug(w: number, d: number, color: string, accent: string): FurniturePart[] {
    return [
        slab(roundedRect(w, d, 0.04), 0.01, [0, 0.006, 0], "fabric", color, "weave"),
        slab(roundedRect(w - 0.22, d - 0.22, 0.03), 0.004, [0, 0.0125, 0], "fabric", shade(accent, 0.35), "weave"),
        slab(roundedRect(w - 0.32, d - 0.32, 0.03), 0.004, [0, 0.0145, 0], "fabric", color, "weave"),
    ];
}

function floorLamp(): FurniturePart[] {
    return [cylinder(0.15, 0.025, [0, 0.0125, 0], "metal-dark", LEG), cylinder(0.012, 1.42, [0, 0.735, 0], "metal", BRASS), lathe(drum(0.21, 0.16, 0.32), [0, 1.42, 0], "light", "#efe2cc")];
}

function pendant(ceiling: number, size: number): FurniturePart[] {
    const radius = Math.min(0.32, Math.max(0.18, size / 2));
    const drop = Math.min(1.0, Math.max(0.35, ceiling - 2.05));
    const bottom = ceiling - drop - 0.22;
    return [
        cylinder(0.005, drop, [0, ceiling - drop / 2, 0], "metal-dark", LEG),
        cylinder(0.06, 0.02, [0, ceiling - 0.01, 0], "metal-dark", LEG),
        lathe(
            [
                [0.02, 0.22],
                [0.05, 0.22],
                [radius * 0.5, 0.19],
                [radius * 0.9, 0.08],
                [radius, 0],
            ],
            [0, bottom, 0],
            "metal",
            BRASS,
        ),
        sphere(0.05, [0, bottom + 0.06, 0], "light", "#fff1d6"),
    ];
}

/** 绿植：花盆是旋转体，叶丛是几团大小不一的椭球；seed 单数是高挑的琴叶榕，双数是矮胖的一盆。 */
function plant(w: number, seed: number): FurniturePart[] {
    const scale = Math.max(0.5, w / 0.5);
    const greens = ["#4f8a4a", "#5f9a55", "#3f7a45", "#6aa25e"];
    const potColor = seed % 3 === 0 ? "#3a3d42" : seed % 3 === 1 ? "#d9d4cc" : "#b5764f";
    const parts: FurniturePart[] = [lathe(pot(0.16 * scale, 0.34 * scale), [0, 0, 0], "ceramic", potColor), cylinder(0.15 * scale, 0.01, [0, 0.33 * scale, 0], "soil", "#4a3a2c")];
    if (seed % 2) {
        parts.push(cylinder(0.018 * scale, 0.9 * scale, [0, 0.78 * scale, 0], "wood-dark", "#6b4a33"));
        for (let index = 0; index < 7; index += 1) {
            const angle = (index / 7) * Math.PI * 2 + seed;
            const height = (0.95 + (index % 3) * 0.22) * scale;
            parts.push(sphere(0.12 * scale, [Math.cos(angle) * 0.16 * scale, height, Math.sin(angle) * 0.16 * scale], "plant", greens[(seed + index) % 4], [1.25, 0.55, 1]));
        }
        parts.push(sphere(0.14 * scale, [0, 1.5 * scale, 0], "plant", greens[seed % 4], [1, 0.8, 1]));
        return parts;
    }
    for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2 + seed;
        parts.push(sphere(0.15 * scale, [Math.cos(angle) * 0.13 * scale, (0.5 + (index % 2) * 0.12) * scale, Math.sin(angle) * 0.13 * scale], "plant", greens[(seed + index) % 4], [1.1, 0.8, 1.1]));
    }
    parts.push(sphere(0.18 * scale, [0, 0.7 * scale, 0], "plant", greens[(seed + 2) % 4], [1, 1.1, 1]));
    return parts;
}

function teaTable(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    const dark = shade(wood, -0.4);
    const parts: FurniturePart[] = [
        slab(roundedRect(w, d, 0.02), 0.06, [0, 0.42, 0], "wood-dark", dark),
        box([w - 0.12, 0.36, d - 0.12], [0, 0.2, 0], "wood-dark", shade(dark, -0.1), 0.01),
        box([0.62, 0.015, 0.36], [0, 0.4575, 0], "stone", "#3a3d42", 0.004),
        lathe(vase(0.06, 0.12), [-0.12, 0.465, 0], "ceramic", "#e8e2d8", 24),
        ...[-0.02, 0.06, 0.14].map((x) => cylinder(0.03, 0.04, [x, 0.485, 0.08], "ceramic", "#f4f2ee")),
    ];
    for (const [x, z] of [
        [-w / 4, d / 2 + 0.36],
        [w / 4, d / 2 + 0.36],
        [-w / 4, -d / 2 - 0.36],
        [w / 4, -d / 2 - 0.36],
    ])
        parts.push(
            lathe(
                [
                    [0, 0],
                    [0.24, 0],
                    [0.26, 0.08],
                    [0.24, 0.16],
                    [0, 0.17],
                ],
                [x, 0, z],
                "fabric",
                fabric,
            ),
        );
    return parts;
}

function piano(w: number, d: number): FurniturePart[] {
    const black = "#151517";
    const parts: FurniturePart[] = [
        box([w, 1.22, d - 0.25], [0, 0.65, -0.125], "wood-dark", black, 0.015),
        box([w, 0.1, 0.27], [0, 0.72, d / 2 - 0.135], "wood-dark", black, 0.01),
        box([w - 0.14, 0.02, 0.15], [0, 0.78, d / 2 - 0.09], "ceramic", "#f6f6f4"),
        box([0.06, 0.6, 0.06], [-w / 2 + 0.05, 0.36, d / 2 - 0.05], "wood-dark", black, 0.01),
        box([0.06, 0.6, 0.06], [w / 2 - 0.05, 0.36, d / 2 - 0.05], "wood-dark", black, 0.01),
        box([0.8, 0.48, 0.36], [0, 0.24, d / 2 + 0.5], "wood-dark", black, 0.02),
    ];
    const keys = Math.floor((w - 0.16) / 0.024);
    for (let index = 0; index < keys; index += 1) if (index % 7 !== 2 && index % 7 !== 6) parts.push(box([0.012, 0.014, 0.09], [-w / 2 + 0.08 + index * 0.024 + 0.012, 0.797, d / 2 - 0.115], "wood-dark", black));
    return parts;
}

function projectionScreen(w: number, ceiling: number): FurniturePart[] {
    const height = Math.min(w * 0.5625, ceiling - 0.9);
    const top = ceiling - 0.2;
    return [
        box([w + 0.12, 0.1, 0.1], [0, top + 0.05, 0], "metal-dark", "#2b2d30", 0.02),
        box([w + 0.04, height + 0.06, 0.008], [0, top - (height + 0.06) / 2, 0.004], "metal-dark", "#1b1c1e"),
        box([w, height, 0.004], [0, top - 0.03 - height / 2, 0.01], "ceramic", "#f7f7f5"),
    ].map(mounted);
}

function treadmill(w: number, d: number): FurniturePart[] {
    return [
        box([w, 0.16, d], [0, 0.1, 0], "metal-dark", "#2b2d30", 0.03),
        box([w - 0.16, 0.012, d - 0.25], [0, 0.186, 0.08], "fabric", "#151517"),
        tilt(box([0.05, 1.1, 0.06], [-w / 2 + 0.05, 0.7, -d / 2 + 0.2], "metal-dark", "#2b2d30", 0.015), [-14, 0, 0]),
        tilt(box([0.05, 1.1, 0.06], [w / 2 - 0.05, 0.7, -d / 2 + 0.2], "metal-dark", "#2b2d30", 0.015), [-14, 0, 0]),
        tilt(box([w, 0.24, 0.12], [0, 1.25, -d / 2 + 0.08], "metal-dark", "#3a3d42", 0.03), [-30, 0, 0]),
    ];
}

function tatami(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    const mats = Math.max(2, Math.round(w / 0.9));
    const parts: FurniturePart[] = [box([w, 0.36, d], [0, 0.18, 0], "wood", wood, 0.01, "grain")];
    for (let index = 0; index < mats; index += 1) parts.push(box([w / mats - 0.012, 0.03, d - 0.04], [-w / 2 + (w / mats) * (index + 0.5), 0.375, 0], "fabric", "#cdbf95", 0.006, "weave"));
    parts.push(box([0.8, 0.04, 0.5], [0, 0.56, 0.1], "wood", shade(wood, -0.2), 0.01, "grain"), ...legs(0.7, 0.4, 0.17, shade(wood, -0.3), 0.02).map((part) => offset(part, [0, 0.39, 0.1])));
    for (const x of [-0.6, 0.6]) parts.push(box([0.48, 0.08, 0.48], [x, 0.43, 0.1], "fabric", fabric, 0.03, "weave"));
    return parts;
}

function fullMirror(w: number): FurniturePart[] {
    return [panel(roundedRect(w, 1.7, 0.06), 0.03, [0, 1.0, 0], "metal-dark", "#2b2d30"), panel(roundedRect(w - 0.06, 1.64, 0.04), 0.008, [0, 1.0, 0.019], "metal", MIRROR)].map(mounted);
}

function bench(w: number, d: number, fabric: string, wood: string): FurniturePart[] {
    return [box([w, 0.1, d], [0, 0.4, 0], "fabric", fabric, 0.03, "weave"), box([w - 0.06, 0.03, d - 0.06], [0, 0.335, 0], "wood", wood, 0.008, "grain"), ...legs(w - 0.12, d - 0.1, 0.32, shade(wood, -0.3), 0.018)];
}

/** 汽车：侧面轮廓挤出车身，车窗是稍宽一点的深色轮廓，四个轮子带轮毂。 */
function car(w: number, d: number, color: string): FurniturePart[] {
    const k = d / 4.6;
    const body: Outline = [
        [-2.3, 0.3],
        [2.3, 0.3],
        [2.3, 0.78],
        [2.12, 0.92],
        [1.55, 1.05],
        [0.85, 1.42],
        [-0.45, 1.45],
        [-1.3, 1.08],
        [-2.18, 0.95],
        [-2.3, 0.8],
    ].map(([x, y]): [number, number] => [x * k, y]);
    const glass: Outline = [
        [1.45, 1.03],
        [0.82, 1.38],
        [-0.42, 1.41],
        [-1.2, 1.06],
    ].map(([x, y]): [number, number] => [x * k, y]);
    const parts: FurniturePart[] = [
        tilt(panel(body, w - 0.06, [0, 0, 0], "metal", color), [0, 90, 0]),
        tilt(panel(glass, w - 0.04, [0, 0, 0], "glass", "#2a3238"), [0, 90, 0]),
        box([w - 0.1, 0.12, 0.08], [0, 0.42, d / 2 - 0.04], "metal-dark", "#1b1c1e", 0.03),
        box([w - 0.1, 0.12, 0.08], [0, 0.42, -d / 2 + 0.04], "metal-dark", "#1b1c1e", 0.03),
    ];
    for (const [x, z] of [
        [-w / 2 + 0.14, d / 2 - 0.78],
        [w / 2 - 0.14, d / 2 - 0.78],
        [-w / 2 + 0.14, -d / 2 + 0.78],
        [w / 2 - 0.14, -d / 2 + 0.78],
    ]) {
        parts.push(tilt(cylinder(0.33, 0.24, [x, 0.33, z], "metal-dark", "#1b1c1e"), [0, 0, 90]));
        parts.push(tilt(cylinder(0.2, 0.25, [x, 0.33, z], "metal", CHROME), [0, 0, 90]));
    }
    return parts;
}

function patioSet(w: number, wood: string): FurniturePart[] {
    const radius = Math.min(0.5, w / 4);
    const parts: FurniturePart[] = [
        cylinder(radius, 0.04, [0, 0.72, 0], "wood", wood),
        cylinder(0.03, 0.7, [0, 0.35, 0], "metal-dark", LEG),
        cylinder(0.025, 2.3, [0, 1.15, 0], "metal", CHROME),
        { shape: "cone", radius: Math.min(1.3, w / 2), height: 0.5, position: [0, 2.35, 0], material: "fabric", color: "#efe8dc" },
    ];
    for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push(...diningChair([Math.sin(angle) * (radius + 0.3), 0, Math.cos(angle) * (radius + 0.3)], (angle * 180) / Math.PI + 180, wood, "#efe8dc"));
    }
    return parts;
}

function sunbed(w: number, d: number): FurniturePart[] {
    return [box([w, 0.1, d * 0.7], [0, 0.32, d * 0.15], "fabric", "#f2efe9", 0.03), tilt(box([w, 0.08, d * 0.32], [0, 0.48, -d / 2 + d * 0.15], "fabric", "#f2efe9", 0.03), [-35, 0, 0]), ...legs(w - 0.1, d * 0.8, 0.28, "#b9bec4", 0.02)];
}

/** 按类型拼出一件家具；w、d 是占地宽深（已按房间收好）。 */
export function buildFurniture(type: SpecFurnitureType, w: number, d: number, context: Context): FurniturePart[] {
    const { palette } = context;
    const fabric = context.color || palette.fabric;
    const wood = context.color || palette.wood;
    switch (type) {
        case "sofa":
            return cushionedSeat(w, d, fabric, palette.accent);
        case "sofa-l":
            return sofaL(w, d, fabric, palette.accent);
        case "armchair":
            return armchair(w, d, context.color || palette.accent, palette.wood);
        case "coffee-table":
            return coffeeTable(w, d, wood, palette.accent, context.seed);
        case "side-table":
            return sideTable(w, wood);
        case "tv-cabinet":
            return tvCabinet(w, d, context);
        case "dining-table":
            return diningTable(w, d, wood, palette.fabric);
        case "round-table":
            return roundTable(w, wood, palette.fabric);
        case "bed":
            return bed(w, d, context, true);
        case "bed-single":
            return bed(w, d, context, false);
        case "bunk-bed":
            return bunkBed(w, d, context);
        case "nightstand":
            return nightstand(0, 0, wood);
        case "wardrobe":
            return wardrobe(w, d, wood, context.ceiling);
        case "dresser":
            return dresser(w, d, wood, palette.fabric);
        case "desk":
            return desk(w, d, wood, palette.fabric);
        case "bookshelf":
            return bookshelf(w, d, Math.min(2.1, context.ceiling - 0.3), context);
        case "cabinet":
            return sideboard(w, d, 0.74, context);
        case "shoe-cabinet":
            return [...cabinetBody(w, d, 1.0, wood, Math.max(2, Math.round(w / 0.45)), 0.12), box([w + 0.02, 0.03, d + 0.01], [0, 1.015, 0.005], "stone", "#d9d4cc", 0, "marble")];
        case "bench":
            return bench(w, d, fabric, palette.wood);
        case "tatami":
            return tatami(w, d, palette.wood, fabric);
        case "mirror":
            return fullMirror(w);
        case "kitchen-line":
            return kitchenLine(w, d, context);
        case "kitchen-l":
            return kitchenL(w, d, context);
        case "kitchen-island":
            return island(w, d, context);
        case "bar-counter":
            return barCounter(w, d, context);
        case "fridge":
            return fridge(w, d);
        case "toilet":
            return toilet();
        case "vanity":
            return vanity(w, d, wood);
        case "shower":
            return shower(w, d);
        case "bathtub":
            return bathtub(w, d);
        case "washer":
            return washer(w, d);
        case "rug":
            return rug(w, d, context.color || shade(palette.fabric, -0.1), palette.accent);
        case "floor-lamp":
            return floorLamp();
        case "pendant":
            return pendant(context.ceiling, w);
        case "plant":
            return plant(w, context.seed);
        case "tea-table":
            return teaTable(w, d, wood, fabric);
        case "piano":
            return piano(w, d);
        case "screen":
            return projectionScreen(w, context.ceiling);
        case "treadmill":
            return treadmill(w, d);
        case "car":
            return car(w, d, context.color || "#5d6670");
        case "patio-set":
            return patioSet(w, wood);
        case "sunbed":
            return sunbed(w, d);
    }
}
