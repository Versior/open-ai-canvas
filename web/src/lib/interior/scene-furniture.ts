/**
 * 室内设计 3D 模型的家具库：每件家具用几个到十几个几何体按真实尺寸拼出来（沙发有底座、坐垫、靠背和扶手，
 * 床有床架、床垫、被子和枕头）。局部坐标：原点在家具占地的中心、落在地面上，正面朝 +z（背面贴墙）。
 */
import type { SceneMaterial, SceneObject, SceneVector } from "./scene-3d";
import type { SpecFurnitureType, SpecPalette } from "./scene-spec";

export type FurniturePart = Omit<SceneObject, "group">;

type Context = { palette: SpecPalette; color?: string; ceiling: number; seed: number };

const LEG = "#2b2d30";
const WHITE = "#f4f2ee";

function box(size: SceneVector, position: SceneVector, material: SceneMaterial, color?: string, round = 0): FurniturePart {
    return round > 0 ? { shape: "rbox", size, position, material, round: Math.min(round, Math.min(...size) / 2 - 0.001), ...(color ? { color } : {}) } : { shape: "box", size, position, material, ...(color ? { color } : {}) };
}

function cylinder(radius: number, height: number, position: SceneVector, material: SceneMaterial, color?: string, radiusTop?: number): FurniturePart {
    return { shape: "cylinder", radius, height, position, material, ...(radiusTop !== undefined ? { radiusTop } : {}), ...(color ? { color } : {}) };
}

function sphere(radius: number, position: SceneVector, material: SceneMaterial, color?: string, scale?: SceneVector): FurniturePart {
    return { shape: "sphere", radius, position, material, ...(scale ? { scale } : {}), ...(color ? { color } : {}) };
}

/** 四条腿：在 w × d 的范围内往里缩 inset，腿高 height。 */
function legs(w: number, d: number, height: number, inset: number, radius = 0.02, color = LEG): FurniturePart[] {
    const x = w / 2 - inset;
    const z = d / 2 - inset;
    return [
        [-x, -z],
        [x, -z],
        [-x, z],
        [x, z],
    ].map(([px, pz]) => cylinder(radius, height, [px, height / 2, pz], "metal-dark", color));
}

function shade(hex: string, amount: number) {
    const value = Number.parseInt(hex.slice(1), 16);
    const channel = (shift: number) => Math.round(Math.min(255, Math.max(0, ((value >> shift) & 255) * (1 + amount))));
    return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

function sofa(w: number, d: number, fabric: string): FurniturePart[] {
    const arm = 0.18;
    const seatW = w - arm * 2;
    const cushions = Math.max(1, Math.round(seatW / 0.7));
    const parts: FurniturePart[] = [
        box([w, 0.24, d], [0, 0.2, 0], "fabric", shade(fabric, -0.08), 0.04),
        box([w, 0.5, 0.2], [0, 0.55, -d / 2 + 0.1], "fabric", fabric, 0.06),
        box([arm, 0.38, d], [-w / 2 + arm / 2, 0.45, 0], "fabric", fabric, 0.06),
        box([arm, 0.38, d], [w / 2 - arm / 2, 0.45, 0], "fabric", fabric, 0.06),
        ...legs(w, d, 0.08, 0.08, 0.025),
    ];
    for (let index = 0; index < cushions; index += 1) {
        const cw = seatW / cushions;
        const x = -seatW / 2 + cw * (index + 0.5);
        parts.push(box([cw - 0.02, 0.14, d - 0.26], [x, 0.39, 0.06], "fabric", shade(fabric, 0.05), 0.05));
        parts.push(box([cw - 0.04, 0.38, 0.16], [x, 0.6, -d / 2 + 0.26], "fabric", shade(fabric, 0.08), 0.07));
    }
    return parts;
}

function sofaL(w: number, d: number, fabric: string): FurniturePart[] {
    // 靠背一侧是普通沙发，右边往前接一段贵妃位。
    const depth = Math.min(0.92, d - 0.5);
    const chaise = Math.min(0.95, w * 0.35);
    const length = d - depth;
    const x = w / 2 - chaise / 2;
    const z = -d / 2 + depth + length / 2;
    return [
        ...sofa(w, depth, fabric).map((part) => offset(part, [0, 0, -(d - depth) / 2])),
        box([chaise, 0.24, length], [x, 0.2, z], "fabric", shade(fabric, -0.08), 0.04),
        box([chaise - 0.22, 0.14, length - 0.04], [x - 0.09, 0.39, z], "fabric", shade(fabric, 0.05), 0.05),
        box([0.18, 0.38, length], [w / 2 - 0.09, 0.45, z], "fabric", fabric, 0.06),
    ];
}

function offset(part: FurniturePart, by: SceneVector): FurniturePart {
    return part.position ? { ...part, position: [part.position[0] + by[0], part.position[1] + by[1], part.position[2] + by[2]] } : part;
}

function armchair(w: number, d: number, fabric: string): FurniturePart[] {
    return [
        box([w, 0.2, d], [0, 0.25, 0], "fabric", shade(fabric, -0.06), 0.05),
        box([w - 0.3, 0.12, d - 0.2], [0, 0.41, 0.06], "fabric", shade(fabric, 0.06), 0.05),
        box([w, 0.45, 0.16], [0, 0.6, -d / 2 + 0.08], "fabric", fabric, 0.06),
        box([0.15, 0.3, d], [-w / 2 + 0.075, 0.5, 0], "fabric", fabric, 0.05),
        box([0.15, 0.3, d], [w / 2 - 0.075, 0.5, 0], "fabric", fabric, 0.05),
        ...legs(w, d, 0.15, 0.07, 0.02, "#6b4a33"),
    ];
}

function table(w: number, d: number, height: number, wood: string, top = 0.04): FurniturePart[] {
    return [box([w, top, d], [0, height - top / 2, 0], "wood", wood, 0.01), ...legs(w, d, height - top, 0.08, 0.025)];
}

function chair(position: SceneVector, rotation: number, wood: string, fabric: string): FurniturePart[] {
    const parts = [box([0.44, 0.05, 0.44], [0, 0.45, 0], "wood", wood, 0.01), box([0.4, 0.06, 0.4], [0, 0.5, 0.01], "fabric", fabric, 0.02), box([0.42, 0.42, 0.04], [0, 0.72, -0.2], "wood", wood, 0.01), ...legs(0.44, 0.44, 0.43, 0.04, 0.016)];
    return parts.map((part) => place(part, position, rotation));
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

function round3(value: number) {
    return Math.round(value * 1000) / 1000;
}

function diningTable(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    const tableW = Math.max(0.9, w - 0.2);
    const tableD = Math.max(0.7, d - 0.1);
    const parts = table(tableW, tableD, 0.75, wood);
    const perSide = Math.max(1, Math.floor(tableW / 0.6));
    for (let index = 0; index < perSide; index += 1) {
        const x = -tableW / 2 + (tableW / perSide) * (index + 0.5);
        parts.push(...chair([x, 0, tableD / 2 + 0.22], 180, wood, fabric), ...chair([x, 0, -tableD / 2 - 0.22], 0, wood, fabric));
    }
    if (tableW >= 1.8) parts.push(...chair([tableW / 2 + 0.25, 0, 0], -90, wood, fabric), ...chair([-tableW / 2 - 0.25, 0, 0], 90, wood, fabric));
    return parts;
}

function roundTable(w: number, wood: string, fabric: string): FurniturePart[] {
    const radius = Math.max(0.45, w / 2 - 0.25);
    const parts: FurniturePart[] = [cylinder(radius, 0.04, [0, 0.73, 0], "wood", wood), cylinder(0.06, 0.7, [0, 0.36, 0], "metal-dark", LEG), cylinder(0.3, 0.03, [0, 0.015, 0], "metal-dark", LEG)];
    const count = Math.max(3, Math.min(8, Math.round((radius * 2 * Math.PI) / 0.65)));
    for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2;
        parts.push(...chair([Math.sin(angle) * (radius + 0.22), 0, Math.cos(angle) * (radius + 0.22)], (angle * 180) / Math.PI + 180, wood, fabric));
    }
    return parts;
}

function lamp(position: SceneVector, height = 0.5): FurniturePart[] {
    return [
        cylinder(0.07, 0.02, [position[0], position[1] + 0.01, position[2]], "metal-dark", LEG),
        cylinder(0.012, height - 0.18, [position[0], position[1] + (height - 0.18) / 2, position[2]], "metal", "#c9a46a"),
        cylinder(0.13, 0.18, [position[0], position[1] + height - 0.09, position[2]], "light", "#fff1d6", 0.09),
    ];
}

function nightstand(position: SceneVector, wood: string): FurniturePart[] {
    return [
        box([0.46, 0.5, 0.4], [position[0], 0.27, position[2]], "wood", wood, 0.02),
        box([0.4, 0.005, 0.005], [position[0], 0.3, position[2] + 0.2], "metal-dark", LEG),
        ...legs(0.46, 0.4, 0.04, 0.04, 0.015).map((part) => offset(part, [position[0], 0, position[2]])),
        ...lamp([position[0], 0.52, position[2]]),
    ];
}

function bed(w: number, d: number, context: Context, withStands: boolean): FurniturePart[] {
    const stand = withStands && w >= 2.4 ? 0.5 : 0;
    const bedW = w - stand * 2;
    const fabric = context.color || context.palette.fabric;
    const wood = context.palette.wood;
    const parts: FurniturePart[] = [
        box([bedW, 0.3, d], [0, 0.2, 0], "wood", wood, 0.03),
        box([bedW + 0.06, 1.0, 0.1], [0, 0.6, -d / 2 + 0.05], "fabric", shade(fabric, -0.12), 0.04),
        box([bedW - 0.08, 0.22, d - 0.16], [0, 0.46, 0.04], "fabric", WHITE, 0.06),
        box([bedW - 0.02, 0.06, d * 0.62], [0, 0.6, d / 2 - d * 0.31 - 0.02], "fabric", fabric, 0.03),
        ...legs(bedW, d, 0.06, 0.06, 0.03),
    ];
    const pillows = bedW >= 1.4 ? 2 : 1;
    for (let index = 0; index < pillows; index += 1) {
        const x = pillows === 1 ? 0 : (index ? 1 : -1) * (bedW / 4);
        parts.push(box([Math.min(0.66, bedW / pillows - 0.12), 0.14, 0.38], [x, 0.63, -d / 2 + 0.36], "fabric", WHITE, 0.06));
    }
    if (stand) parts.push(...nightstand([-w / 2 + 0.25, 0, -d / 2 + 0.25], wood), ...nightstand([w / 2 - 0.25, 0, -d / 2 + 0.25], wood));
    return parts;
}

function cabinet(w: number, d: number, height: number, wood: string, doors: number): FurniturePart[] {
    const parts: FurniturePart[] = [box([w, height, d], [0, height / 2 + 0.06, 0], "wood", wood, 0.015), box([w - 0.04, 0.06, d - 0.04], [0, 0.03, 0], "wood-dark", shade(wood, -0.35))];
    for (let index = 1; index < doors; index += 1) parts.push(box([0.006, height - 0.04, 0.004], [-w / 2 + (w / doors) * index, height / 2 + 0.06, d / 2 + 0.002], "wood-dark", shade(wood, -0.4)));
    for (let index = 0; index < doors; index += 1) {
        const x = -w / 2 + (w / doors) * (index + 0.5) + (index % 2 ? -1 : 1) * (w / doors / 2 - 0.06);
        parts.push(box([0.015, Math.min(0.3, height * 0.3), 0.02], [x, height * 0.55 + 0.06, d / 2 + 0.012], "metal", "#b9b4ab"));
    }
    return parts;
}

function wardrobe(w: number, d: number, wood: string): FurniturePart[] {
    return cabinet(w, d, 2.3, wood, Math.max(2, Math.round(w / 0.5)));
}

function tvCabinet(w: number, d: number, wood: string): FurniturePart[] {
    const tvW = Math.min(1.65, w * 0.75);
    return [
        ...cabinet(w, d, 0.42, wood, Math.max(2, Math.round(w / 0.6))),
        box([tvW, tvW * 0.57, 0.05], [0, 1.25, -d / 2 + 0.04], "metal-dark", "#121314", 0.01),
        box([tvW - 0.04, tvW * 0.57 - 0.04, 0.005], [0, 1.25, -d / 2 + 0.067], "glass", "#20262c"),
        box([0.5, 0.06, 0.15], [-w / 2 + 0.4, 0.51, 0], "wood-dark", shade(wood, -0.3)),
        sphere(0.07, [w / 2 - 0.3, 0.55, 0], "plant", "#4f8a4a"),
    ];
}

function desk(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    return [
        box([w, 0.035, d], [0, 0.74, 0], "wood", wood, 0.01),
        box([0.04, 0.72, d - 0.04], [-w / 2 + 0.03, 0.36, 0], "metal-dark", LEG),
        box([0.04, 0.72, d - 0.04], [w / 2 - 0.03, 0.36, 0], "metal-dark", LEG),
        box([0.4, 0.4, d - 0.08], [w / 2 - 0.27, 0.22, 0], "wood", shade(wood, -0.1), 0.01),
        box([0.56, 0.34, 0.03], [0, 1.0, -d / 2 + 0.12], "metal-dark", "#15171a", 0.01),
        cylinder(0.015, 0.16, [0, 0.83, -d / 2 + 0.14], "metal-dark", LEG),
        box([0.42, 0.015, 0.14], [0, 0.765, 0.05], "metal-dark", "#3a3d42"),
        ...lamp([-w / 2 + 0.18, 0.76, -d / 2 + 0.15], 0.42),
        ...officeChair([0, 0, d / 2 + 0.28], fabric),
    ];
}

function officeChair(position: SceneVector, fabric: string): FurniturePart[] {
    const parts: FurniturePart[] = [
        box([0.5, 0.08, 0.48], [0, 0.48, 0], "fabric", shade(fabric, -0.25), 0.03),
        box([0.46, 0.5, 0.06], [0, 0.82, 0.22], "fabric", shade(fabric, -0.25), 0.03),
        cylinder(0.025, 0.36, [0, 0.27, 0], "metal", "#8c9096"),
        cylinder(0.28, 0.03, [0, 0.06, 0], "metal-dark", LEG, 0.24),
    ];
    return parts.map((part) => offset(part, position));
}

function bookshelf(w: number, d: number, height: number, context: Context): FurniturePart[] {
    const wood = context.palette.wood;
    const shelves = Math.max(3, Math.round(height / 0.38));
    const parts: FurniturePart[] = [
        box([0.03, height, d], [-w / 2 + 0.015, height / 2, 0], "wood", wood),
        box([0.03, height, d], [w / 2 - 0.015, height / 2, 0], "wood", wood),
        box([w - 0.06, height, 0.015], [0, height / 2, -d / 2 + 0.008], "wood", shade(wood, -0.1)),
    ];
    const bookColors = ["#7a5236", "#3e5a6b", "#a85a43", "#d8cdb8", "#4f6b4a", "#2b2d30", "#c4a46a"];
    for (let index = 0; index <= shelves; index += 1) {
        const y = (height / shelves) * index;
        parts.push(box([w - 0.06, 0.025, d - 0.02], [0, Math.max(0.0125, Math.min(height - 0.0125, y)), 0.005], "wood", wood));
        if (index === shelves) continue;
        let x = -w / 2 + 0.06;
        for (let book = 0; x < w / 2 - 0.12; book += 1) {
            const seed = (index * 7 + book * 3 + context.seed) % bookColors.length;
            const bw = 0.03 + ((seed * 13) % 5) * 0.008;
            const bh = Math.min(height / shelves - 0.06, 0.22 + ((seed * 5) % 4) * 0.025);
            if ((book + index + context.seed) % 6 === 5) {
                x += 0.12;
                continue;
            }
            parts.push(box([bw, bh, d - 0.1], [x + bw / 2, y + 0.0125 + bh / 2, 0.01], "fabric", bookColors[seed]));
            x += bw + 0.004;
        }
    }
    return parts;
}

function kitchenLine(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const counter = "#e9e6e1";
    const doors = Math.max(2, Math.round(w / 0.6));
    const parts: FurniturePart[] = [
        ...cabinet(w, d - 0.02, 0.8, wood, doors),
        box([w + 0.02, 0.04, d + 0.02], [0, 0.88, 0.01], "marble", counter),
        box([0.6, 0.02, 0.42], [-w / 4, 0.895, 0.02], "metal", "#b9bec4"),
        cylinder(0.015, 0.25, [-w / 4, 1.02, -d / 2 + 0.1], "metal", "#c0c4c8"),
        box([0.6, 0.012, 0.5], [w / 4, 0.906, 0.02], "glass", "#141516"),
        box([w, 0.7, 0.34], [0, 1.85, -d / 2 + 0.17], "wood", shade(wood, 0.08), 0.01),
        box([0.7, 0.3, 0.45], [w / 4, 1.55, -d / 2 + 0.24], "metal", "#c0c4c8"),
        box([w - 0.1, 0.012, 0.02], [0, 1.49, -d / 2 + 0.3], "light", "#fff4d6"),
    ];
    for (let index = 0; index < 4; index += 1) parts.push(cylinder(0.08, 0.006, [w / 4 + (index % 2 ? 0.14 : -0.14), 0.915, (index < 2 ? -0.1 : 0.12) + 0.02], "metal-dark", "#3a3d42"));
    return parts;
}

function island(w: number, d: number, context: Context): FurniturePart[] {
    const wood = context.color || context.palette.wood;
    const parts: FurniturePart[] = [...cabinet(w, d - 0.2, 0.84, wood, Math.max(2, Math.round(w / 0.6))).map((part) => offset(part, [0, 0, -0.1])), box([w + 0.1, 0.05, d], [0, 0.925, 0], "marble", "#ece9e4")];
    const stools = Math.max(1, Math.floor(w / 0.55));
    for (let index = 0; index < stools; index += 1) {
        const x = -w / 2 + (w / stools) * (index + 0.5);
        parts.push(cylinder(0.18, 0.05, [x, 0.66, d / 2 + 0.3], "leather", "#7a5236"), cylinder(0.02, 0.62, [x, 0.32, d / 2 + 0.3], "metal-dark", LEG), cylinder(0.2, 0.02, [x, 0.01, d / 2 + 0.3], "metal-dark", LEG));
    }
    return parts;
}

function fridge(w: number, d: number): FurniturePart[] {
    return [
        box([w, 1.85, d], [0, 0.925, 0], "metal", "#d4d7da", 0.03),
        box([w - 0.02, 0.006, 0.006], [0, 1.25, d / 2 + 0.002], "metal-dark", LEG),
        box([0.02, 0.4, 0.03], [w / 2 - 0.08, 1.45, d / 2 + 0.02], "metal", "#9ea3a8"),
        box([0.02, 0.5, 0.03], [w / 2 - 0.08, 0.85, d / 2 + 0.02], "metal", "#9ea3a8"),
    ];
}

function toilet(): FurniturePart[] {
    return [box([0.38, 0.36, 0.18], [0, 0.6, -0.26], "ceramic", WHITE, 0.04), cylinder(0.17, 0.38, [0, 0.19, 0.05], "ceramic", WHITE, 0.2), { ...cylinder(0.2, 0.04, [0, 0.4, 0.06], "ceramic", "#ffffff"), scale: [1, 1, 1.2] }];
}

function vanity(w: number, d: number, wood: string): FurniturePart[] {
    return [
        box([w, 0.5, d], [0, 0.55, 0], "wood", wood, 0.02),
        box([w + 0.02, 0.04, d + 0.02], [0, 0.82, 0], "ceramic", WHITE, 0.01),
        { ...cylinder(0.2, 0.12, [0, 0.9, 0.03], "ceramic", "#ffffff", 0.22), scale: [1.2, 1, 0.9] },
        cylinder(0.015, 0.2, [0, 0.95, -d / 2 + 0.06], "metal", "#c0c4c8"),
        box([Math.min(w, 0.9), 0.8, 0.02], [0, 1.55, -d / 2 + 0.01], "glass", "#cfd8dc"),
        box([Math.min(w, 0.9) + 0.03, 0.83, 0.015], [0, 1.55, -d / 2 + 0.003], "metal-dark", LEG),
    ];
}

function shower(w: number, d: number): FurniturePart[] {
    return [
        box([w, 0.05, d], [0, 0.025, 0], "ceramic", "#e8e8e6"),
        box([w, 2.0, 0.01], [0, 1.05, d / 2 - 0.01], "glass", "#cfe0e6"),
        box([0.01, 2.0, d], [-w / 2 + 0.01, 1.05, 0], "glass", "#cfe0e6"),
        cylinder(0.012, 1.1, [w / 4, 1.5, -d / 2 + 0.06], "metal", "#c0c4c8"),
        cylinder(0.11, 0.015, [w / 4, 2.05, -d / 2 + 0.17], "metal", "#c0c4c8"),
    ];
}

function bathtub(w: number, d: number): FurniturePart[] {
    const wall = 0.08;
    return [
        box([w, 0.08, d], [0, 0.04, 0], "ceramic", WHITE),
        box([w, 0.5, wall], [0, 0.29, -d / 2 + wall / 2], "ceramic", WHITE, 0.03),
        box([w, 0.5, wall], [0, 0.29, d / 2 - wall / 2], "ceramic", WHITE, 0.03),
        box([wall, 0.5, d - wall * 2], [-w / 2 + wall / 2, 0.29, 0], "ceramic", WHITE, 0.03),
        box([wall, 0.5, d - wall * 2], [w / 2 - wall / 2, 0.29, 0], "ceramic", WHITE, 0.03),
        box([w - wall * 2, 0.02, d - wall * 2], [0, 0.4, 0], "water", "#8ec5d6"),
    ];
}

function washer(w: number, d: number): FurniturePart[] {
    return [box([w, 0.85, d], [0, 0.425, 0], "ceramic", "#eceeef", 0.03), { ...cylinder(0.2, 0.04, [0, 0.45, d / 2 + 0.01], "glass", "#5a6a74"), rotation: [90, 0, 0] }, box([w - 0.06, 0.08, 0.01], [0, 0.78, d / 2 + 0.005], "metal-dark", "#3a3d42")];
}

function rug(w: number, d: number, color: string): FurniturePart[] {
    return [box([w, 0.012, d], [0, 0.008, 0], "fabric", color, 0.004)];
}

function floorLamp(): FurniturePart[] {
    return [cylinder(0.14, 0.03, [0, 0.015, 0], "metal-dark", LEG), cylinder(0.014, 1.45, [0, 0.75, 0], "metal-dark", LEG), cylinder(0.2, 0.3, [0, 1.55, 0], "light", "#fff1d6", 0.14)];
}

function plant(w: number, seed: number): FurniturePart[] {
    const scale = Math.max(0.6, w / 0.5);
    const greens = ["#4f8a4a", "#5f9a55", "#3f7a45"];
    return [
        cylinder(0.16 * scale, 0.36 * scale, [0, 0.18 * scale, 0], "ceramic", seed % 2 ? "#d9d4cc" : "#3a3d42", 0.18 * scale),
        sphere(0.26 * scale, [0, 0.62 * scale, 0], "plant", greens[seed % 3], [1, 1.2, 1]),
        sphere(0.2 * scale, [0.12 * scale, 0.86 * scale, 0.05 * scale], "plant", greens[(seed + 1) % 3]),
        sphere(0.16 * scale, [-0.1 * scale, 0.95 * scale, -0.06 * scale], "plant", greens[(seed + 2) % 3]),
    ];
}

function pendant(ceiling: number): FurniturePart[] {
    const drop = Math.min(0.9, Math.max(0.4, ceiling - 2.1));
    return [cylinder(0.006, drop, [0, ceiling - drop / 2, 0], "metal-dark", LEG), cylinder(0.28, 0.16, [0, ceiling - drop - 0.06, 0], "fabric", "#e6ddcd", 0.12), cylinder(0.24, 0.01, [0, ceiling - drop - 0.14, 0], "light", "#fff1d6")];
}

function teaTable(w: number, d: number, wood: string, fabric: string): FurniturePart[] {
    const parts = [box([w, 0.08, d], [0, 0.4, 0], "wood-dark", shade(wood, -0.35), 0.01), box([w - 0.1, 0.36, d - 0.1], [0, 0.18, 0], "wood-dark", shade(wood, -0.45), 0.01), box([0.6, 0.015, 0.35], [0, 0.448, 0], "stone", "#3a3d42")];
    for (const [x, z] of [
        [-w / 4, d / 2 + 0.35],
        [w / 4, d / 2 + 0.35],
        [-w / 4, -d / 2 - 0.35],
        [w / 4, -d / 2 - 0.35],
    ])
        parts.push(cylinder(0.24, 0.16, [x, 0.08, z], "fabric", fabric));
    return parts;
}

function piano(w: number, d: number): FurniturePart[] {
    return [box([w, 1.2, d], [0, 0.65, 0], "wood-dark", "#1a1a1c", 0.02), box([w - 0.1, 0.03, 0.22], [0, 0.74, d / 2 + 0.1], "ceramic", "#f6f6f4"), box([0.8, 0.48, 0.38], [0, 0.24, d / 2 + 0.55], "wood-dark", "#1a1a1c", 0.02)];
}

function car(w: number, d: number, color: string): FurniturePart[] {
    const parts: FurniturePart[] = [box([w, 0.55, d], [0, 0.5, 0], "metal", color, 0.12), box([w - 0.2, 0.45, d * 0.48], [0, 0.98, -0.1], "glass", "#2a3238", 0.12)];
    for (const [x, z] of [
        [-w / 2 + 0.1, d / 2 - 0.75],
        [w / 2 - 0.1, d / 2 - 0.75],
        [-w / 2 + 0.1, -d / 2 + 0.75],
        [w / 2 - 0.1, -d / 2 + 0.75],
    ])
        parts.push({ ...cylinder(0.32, 0.22, [x, 0.32, z], "metal-dark", "#1b1c1e"), rotation: [0, 0, 90] });
    return parts;
}

function patioSet(w: number, wood: string): FurniturePart[] {
    const radius = Math.min(0.5, w / 4);
    const parts: FurniturePart[] = [
        cylinder(radius, 0.04, [0, 0.72, 0], "wood", wood),
        cylinder(0.03, 0.7, [0, 0.35, 0], "metal-dark", LEG),
        cylinder(0.025, 2.3, [0, 1.15, 0], "metal", "#c0c4c8"),
        { shape: "cone", radius: Math.min(1.3, w / 2), height: 0.5, position: [0, 2.35, 0], material: "fabric", color: "#efe8dc" },
    ];
    for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push(...chair([Math.sin(angle) * (radius + 0.3), 0, Math.cos(angle) * (radius + 0.3)], (angle * 180) / Math.PI + 180, wood, "#efe8dc"));
    }
    return parts;
}

function sunbed(w: number, d: number): FurniturePart[] {
    return [box([w, 0.1, d * 0.7], [0, 0.32, d * 0.15], "fabric", "#f2efe9", 0.03), { ...box([w, 0.08, d * 0.32], [0, 0.48, -d / 2 + d * 0.15], "fabric", "#f2efe9", 0.03), rotation: [-35, 0, 0] }, ...legs(w, d * 0.9, 0.28, 0.05, 0.02, "#b9bec4")];
}

/** 按类型拼出一件家具；w、d 是占地宽深（已按房间收好）。 */
export function buildFurniture(type: SpecFurnitureType, w: number, d: number, context: Context): FurniturePart[] {
    const { palette } = context;
    const fabric = context.color || palette.fabric;
    const wood = context.color || palette.wood;
    switch (type) {
        case "sofa":
            return sofa(w, d, fabric);
        case "sofa-l":
            return sofaL(w, d, fabric);
        case "armchair":
            return armchair(w, d, context.color || palette.accent);
        case "coffee-table":
            return [
                box([w, 0.05, d], [0, 0.4, 0], "wood", wood, 0.015),
                box([w - 0.1, 0.02, d - 0.1], [0, 0.14, 0], "wood", shade(wood, -0.1)),
                ...legs(w, d, 0.375, 0.06, 0.02),
                box([0.3, 0.06, 0.22], [w / 4, 0.455, 0], "fabric", palette.accent),
                ...plant(0.25, context.seed).map((part) => offset(part, [-w / 4, 0.425, 0])),
            ];
        case "side-table":
            return [cylinder(w / 2, 0.03, [0, 0.54, 0], "wood", wood), cylinder(0.02, 0.52, [0, 0.27, 0], "metal-dark", LEG), cylinder(w / 3, 0.02, [0, 0.01, 0], "metal-dark", LEG), ...lamp([0, 0.555, 0], 0.4)];
        case "tv-cabinet":
            return tvCabinet(w, d, wood);
        case "dining-table":
            return diningTable(w, d, wood, palette.fabric);
        case "round-table":
            return roundTable(w, wood, palette.fabric);
        case "bed":
            return bed(w, d, context, true);
        case "bed-single":
            return bed(w, d, context, false);
        case "wardrobe":
            return wardrobe(w, d, wood);
        case "dresser":
            return [...cabinet(w, d, 0.74, wood, 2), box([0.6, 0.8, 0.02], [0, 1.35, -d / 2 + 0.02], "glass", "#cfd8dc"), box([0.63, 0.83, 0.015], [0, 1.35, -d / 2 + 0.008], "metal", "#c9a46a")];
        case "desk":
            return desk(w, d, wood, palette.fabric);
        case "bookshelf":
            return bookshelf(w, d, 2.0, context);
        case "cabinet":
            return [...cabinet(w, d, 0.74, wood, Math.max(2, Math.round(w / 0.5))), sphere(0.12, [w / 3, 0.92, 0], "ceramic", palette.accent, [1, 1.3, 1]), box([0.32, 0.04, 0.22], [-w / 4, 0.82, 0], "fabric", "#3e5a6b")];
        case "shoe-cabinet":
            return [...cabinet(w, d, 1.0, wood, Math.max(2, Math.round(w / 0.45))), box([w, 0.03, d + 0.02], [0, 1.075, 0], "stone", "#d9d4cc")];
        case "kitchen-line":
            return kitchenLine(w, d, context);
        case "kitchen-island":
            return island(w, d, context);
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
            return rug(w, d, context.color || shade(palette.fabric, -0.1));
        case "floor-lamp":
            return floorLamp();
        case "pendant":
            return pendant(context.ceiling);
        case "plant":
            return plant(w, context.seed);
        case "tea-table":
            return teaTable(w, d, wood, fabric);
        case "piano":
            return piano(w, d);
        case "car":
            return car(w, d, context.color || "#5d6670");
        case "patio-set":
            return patioSet(w, wood);
        case "sunbed":
            return sunbed(w, d);
    }
}
