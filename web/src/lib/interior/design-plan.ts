import { xmlText } from "@/lib/delivery-text";
import { compileSceneSpec, gridRegion, type CompiledFloorPlan } from "./scene-compile";
import { floorBounds, furnitureInfo, type SceneSpec, type SpecRect, type SpecFurnitureType } from "./scene-spec";
import type { SceneObject } from "./scene-3d";

export const DESIGN_LAYERS = {
    layout: { name: "家具布置", color: "#75604d" },
    flooring: { name: "地面铺装", color: "#b58d55" },
    ceiling: { name: "顶面造型", color: "#856ab0" },
    power: { name: "强电", color: "#c84b46" },
    lighting: { name: "照明 / 灯带", color: "#b98a13" },
    network: { name: "网线", color: "#3979b4" },
    water: { name: "给水", color: "#26898b" },
    drain: { name: "排水", color: "#5a8d4d" },
    custom: { name: "定制家具", color: "#93633e" },
    demolition: { name: "拆改标记", color: "#b74883" },
} as const;
export type DesignLayer = keyof typeof DESIGN_LAYERS;
export type DesignPoint = [number, number];
export type DesignMark = { id: string; floor: number; layer: DesignLayer; label: string; points: DesignPoint[]; height: number; depth: number; closed: boolean };
export type DesignPrice = { material: number | null; labor: number | null; waste: number };
export type InteriorDesignPlan = { version: 1; marks: DesignMark[]; prices: Record<string, DesignPrice>; budget: number | null };
export const emptyDesignPlan = (): InteriorDesignPlan => ({ version: 1, marks: [], prices: {}, budget: null });

const round = (value: number) => Math.round(value * 100) / 100;
const distance = (a: DesignPoint, b: DesignPoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const inRect = (point: DesignPoint, rect: SpecRect, margin = 0) => point[0] >= rect[0] + margin && point[0] <= rect[2] - margin && point[1] >= rect[1] + margin && point[1] <= rect[3] - margin;
export const polygonArea = (points: DesignPoint[]) =>
    Math.abs(
        points.reduce((sum, p, i) => {
            const q = points[(i + 1) % points.length];
            return sum + p[0] * q[1] - q[0] * p[1];
        }, 0),
    ) / 2;

function intersects(a: DesignPoint, b: DesignPoint, c: DesignPoint, d: DesignPoint) {
    const cross = (p: DesignPoint, q: DesignPoint, r: DesignPoint) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
        Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))
    );
}

/** 图层数据独立于结构。拆改只标记，不能借助辅助图层删除墙体或改变图纸基准。 */
export function validateDesignPlan(plan: InteriorDesignPlan, spec: SceneSpec) {
    if (!plan || plan.version !== 1 || !Array.isArray(plan.marks) || plan.marks.length > 300 || !plan.prices || typeof plan.prices !== "object" || Array.isArray(plan.prices)) throw new Error("设计图层格式无效");
    const money = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000000);
    if (!money(plan.budget)) throw new Error("总预算须为非负金额或未设定");
    if (Object.keys(plan.prices).length > 1000) throw new Error("报价项目过多");
    for (const price of Object.values(plan.prices)) if (!price || !money(price.material) || !money(price.labor) || !Number.isFinite(price.waste) || price.waste < 0 || price.waste > 50) throw new Error("单价须为非负金额，损耗须为 0–50%");
    const ids = new Set<string>();
    for (const mark of plan.marks) {
        const floor = spec.floors[mark.floor];
        if (!mark || !Number.isInteger(mark.floor) || !floor || typeof mark.id !== "string" || !mark.id || ids.has(mark.id) || !Object.hasOwn(DESIGN_LAYERS, mark.layer) || typeof mark.label !== "string" || !mark.label.trim() || mark.label.length > 40)
            throw new Error("点位或轮廓的楼层、图层、名称无效");
        ids.add(mark.id);
        if (!Array.isArray(mark.points) || !mark.points.length || mark.points.length > 80 || mark.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isFinite(n)) || !inRect(p, floorBounds(floor))))
            throw new Error("点位坐标必须在当前楼层范围内");
        if (typeof mark.closed !== "boolean" || !Number.isFinite(mark.height) || !Number.isFinite(mark.depth) || mark.height < 0 || mark.depth < 0.01 || mark.height + mark.depth > floor.height) throw new Error("标记高度和拉伸厚度须在本层层高内");
        if (mark.closed) {
            if (!["custom", "ceiling", "flooring"].includes(mark.layer) || mark.points.length < 3 || polygonArea(mark.points) < 0.01) throw new Error("造型须为至少三个顶点的有效封闭轮廓");
            for (let i = 0; i < mark.points.length; i++)
                for (let j = i + 1; j < mark.points.length; j++) {
                    if (j === i + 1 || (i === 0 && j === mark.points.length - 1)) continue;
                    if (intersects(mark.points[i], mark.points[(i + 1) % mark.points.length], mark.points[j], mark.points[(j + 1) % mark.points.length])) throw new Error("轮廓不能自相交");
                }
            if (["custom", "ceiling"].includes(mark.layer)) {
                const fits = floor.rooms
                    .filter((r) => !r.part)
                    .some((main) => {
                        const family = floor.rooms.filter((r) => r.name === main.name || r.part === main.name);
                        return mark.points.every((p, i) => {
                            const next = mark.points[(i + 1) % mark.points.length];
                            const steps = Math.max(1, Math.ceil(distance(p, next) / 0.1));
                            for (let n = 0; n <= steps; n++) {
                                const sample: DesignPoint = [p[0] + ((next[0] - p[0]) * n) / steps, p[1] + ((next[1] - p[1]) * n) / steps];
                                if (!family.some((r) => inRect(sample, r.rect))) return false;
                            }
                            return true;
                        });
                    });
                if (!fits) throw new Error("定制与顶面轮廓须在同一房间内，不能跨墙或越出室内");
            }
        }
    }
    return plan;
}

export type PlanElement =
    | { kind: "line"; layer: string; a: DesignPoint; b: DesignPoint; color: string; width: number }
    | { kind: "polygon"; layer: string; points: DesignPoint[]; color: string; fill: string; width: number; furniture?: number; room?: string }
    | { kind: "text"; layer: string; at: DesignPoint; text: string; color: string; size: number };

function corners(rect: SpecRect): DesignPoint[] {
    return [
        [rect[0], rect[1]],
        [rect[2], rect[1]],
        [rect[2], rect[3]],
        [rect[0], rect[3]],
    ];
}
function wallRect(wall: CompiledFloorPlan["walls"][number]): SpecRect {
    return [Math.min(wall.start[0], wall.end[0]) - wall.thickness / 2, Math.min(wall.start[1], wall.end[1]) - wall.thickness / 2, Math.max(wall.start[0], wall.end[0]) + wall.thickness / 2, Math.max(wall.start[1], wall.end[1]) + wall.thickness / 2];
}

/** 平面门窗使用三维编译器的实际洞口位置；家具使用实际摆放结果，自动摆放也一致。 */
export function floorPlanElements(spec: SceneSpec, plan: CompiledFloorPlan, layer: DesignLayer, design = emptyDesignPlan()): PlanElement[] {
    const floor = spec.floors[plan.index];
    const elements: PlanElement[] = [];
    const line = (a: DesignPoint, b: DesignPoint, color: string, width = 0.025, group = "STRUCTURE") => elements.push({ kind: "line", layer: group, a, b, color, width });
    for (const room of floor.rooms) {
        elements.push({
            kind: "polygon",
            layer: "ROOMS",
            points: corners(room.rect),
            color: "#c5c0b8",
            fill: layer === "flooring" ? { wood: "#ddc39b", tile: "#dde4e4", marble: "#e8dfd8", stone: "#cec7bd", carpet: "#ded2cb", concrete: "#d0d1d0" }[room.floor || "concrete"] : "#f6f4ef",
            width: 0.01,
            room: room.part || room.name,
        });
        if (!room.part) {
            const [x1, z1, x2, z2] = room.rect;
            const area = floor.rooms.filter((r) => r.name === room.name || r.part === room.name).reduce((sum, r) => sum + (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]), 0);
            elements.push({ kind: "text", layer: "LABELS", at: [(x1 + x2) / 2, (z1 + z2) / 2], text: room.name, color: "#333333", size: 0.17 });
            elements.push({ kind: "text", layer: "LABELS", at: [(x1 + x2) / 2, (z1 + z2) / 2 + 0.24], text: `${round(x2 - x1)} × ${round(z2 - z1)} m · ${round(area)} ㎡`, color: "#777777", size: 0.12 });
        }
    }
    for (const balcony of floor.balconies) elements.push({ kind: "polygon", layer: "OUTDOOR", points: corners(balcony.rect), color: "#879c8c", fill: balcony.surface === "water" ? "#c1dfe9" : "#e2ebe0", width: 0.025 });
    for (const wall of plan.walls) {
        const horizontal = Math.abs(wall.start[1] - wall.end[1]) < 0.001;
        const from = horizontal ? wall.start[0] : wall.start[1],
            to = horizontal ? wall.end[0] : wall.end[1];
        const point = (at: number): DesignPoint => (horizontal ? [at, wall.start[1]] : [wall.start[0], at]);
        let cursor = from;
        for (const hole of [...wall.holes].sort((a, b) => a.center - b.center)) {
            const a = Math.max(from, hole.center - hole.width / 2),
                b = Math.min(to, hole.center + hole.width / 2);
            if (a > cursor) line(point(cursor), point(a), "#383b3d", wall.thickness);
            const isDoor = ["door", "double", "slide", "entry", "opening"].includes(hole.kind);
            if (!isDoor) {
                line(point(a), point(b), "#5596b1", 0.035, "WINDOWS");
                line(horizontal ? [a, wall.start[1] + 0.04] : [wall.start[0] + 0.04, a], horizontal ? [b, wall.start[1] + 0.04] : [wall.start[0] + 0.04, b], "#5596b1", 0.015, "WINDOWS");
            } else if (hole.kind !== "opening") {
                const pivot = point(hole.hinge === 1 ? b : a),
                    radius = b - a,
                    sign = hole.swing || 1;
                const leaf: DesignPoint = horizontal ? [pivot[0], pivot[1] + sign * radius] : [pivot[0] + sign * radius, pivot[1]];
                line(pivot, leaf, "#8b7054", 0.025, "DOORS");
                let previous = point(hole.hinge === 1 ? a : b);
                for (let i = 1; i <= 12; i++) {
                    const angle = (i * Math.PI) / 24,
                        along = (hole.hinge === 1 ? -1 : 1) * radius * Math.cos(angle),
                        across = sign * radius * Math.sin(angle);
                    const next: DesignPoint = horizontal ? [pivot[0] + along, pivot[1] + across] : [pivot[0] + across, pivot[1] + along];
                    line(previous, next, "#ab977e", 0.01, "DOORS");
                    previous = next;
                }
            }
            cursor = Math.max(cursor, b);
        }
        if (cursor < to) line(point(cursor), point(to), "#383b3d", wall.thickness);
    }
    for (const rect of floor.pillars) elements.push({ kind: "polygon", layer: "PILLARS", points: corners(rect), color: "#555555", fill: "#666666", width: 0.02 });
    if (layer === "layout")
        for (const item of plan.furniture) {
            const angle = (item.rotation * Math.PI) / 180;
            const points = corners([-item.w / 2, -item.d / 2, item.w / 2, item.d / 2]).map(([x, z]): DesignPoint => [item.x + x * Math.cos(angle) + z * Math.sin(angle), item.z - x * Math.sin(angle) + z * Math.cos(angle)]);
            elements.push({ kind: "polygon", layer: "FURNITURE", points, color: "#8d7057", fill: "#d9c6af", width: 0.025, furniture: item.index, room: item.room });
            elements.push({ kind: "text", layer: "FURNITURE_LABELS", at: [item.x, item.z], text: furnitureInfo(item.type).name, color: "#715a44", size: 0.11 });
        }
    for (const mark of design.marks.filter((m) => m.floor === plan.index && m.layer === layer)) {
        const color = DESIGN_LAYERS[mark.layer].color;
        if (mark.closed) elements.push({ kind: "polygon", layer: layer.toUpperCase(), points: mark.points, color, fill: `${color}30`, width: 0.035 });
        else if (mark.points.length > 1) for (let i = 1; i < mark.points.length; i++) line(mark.points[i - 1], mark.points[i], color, 0.045, layer.toUpperCase());
        else {
            const [x, z] = mark.points[0];
            line([x - 0.08, z], [x + 0.08, z], color, 0.04, layer.toUpperCase());
            line([x, z - 0.08], [x, z + 0.08], color, 0.04, layer.toUpperCase());
        }
        elements.push({ kind: "text", layer: layer.toUpperCase(), at: [mark.points[0][0], mark.points[0][1] - 0.16], text: mark.label, color, size: 0.14 });
    }
    const [x1, z1, x2, z2] = floorBounds(floor);
    const axesX = spec.grid?.x.length ? spec.grid.x : [x1, x2],
        axesZ = spec.grid?.z.length ? spec.grid.z : [z1, z2];
    const dimension = (a: DesignPoint, b: DesignPoint, text: string) => {
        line(a, b, "#77828b", 0.012, "DIMENSIONS");
        for (const [x, z] of [a, b]) line([x - 0.06, z - 0.06], [x + 0.06, z + 0.06], "#77828b", 0.012, "DIMENSIONS");
        elements.push({ kind: "text", layer: "DIMENSIONS", at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.1], text, color: "#5c6870", size: 0.13 });
    };
    for (let i = 1; i < axesX.length; i++) dimension([axesX[i - 1], z1 - 0.55], [axesX[i], z1 - 0.55], String(Math.round((axesX[i] - axesX[i - 1]) * 1000)));
    for (let i = 1; i < axesZ.length; i++) dimension([x2 + 0.55, axesZ[i - 1]], [x2 + 0.55, axesZ[i]], String(Math.round((axesZ[i] - axesZ[i - 1]) * 1000)));
    dimension([x1, z1 - 1], [x2, z1 - 1], String(Math.round((x2 - x1) * 1000)));
    dimension([x2 + 1, z1], [x2 + 1, z2], String(Math.round((z2 - z1) * 1000)));
    return elements;
}

export function planViewBox(spec: SceneSpec, floor: number) {
    const [x1, z1, x2, z2] = floorBounds(spec.floors[floor]);
    return [x1 - 1.3, z1 - 1.5, x2 - x1 + 2.8, z2 - z1 + 2.5].join(" ");
}
export function planSvg(spec: SceneSpec, plan: CompiledFloorPlan, layer: DesignLayer, design = emptyDesignPlan()) {
    const body = floorPlanElements(spec, plan, layer, design)
        .map((e) =>
            e.kind === "line"
                ? `<line data-layer="${e.layer}" x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}" stroke="${e.color}" stroke-width="${e.width}"/>`
                : e.kind === "polygon"
                  ? `<polygon data-layer="${e.layer}" points="${e.points.map((p) => p.join(",")).join(" ")}" fill="${e.fill}" stroke="${e.color}" stroke-width="${e.width}"/>`
                  : `<text data-layer="${e.layer}" x="${e.at[0]}" y="${e.at[1]}" fill="${e.color}" font-size="${e.size}" text-anchor="middle">${xmlText(e.text)}</text>`,
        )
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${planViewBox(spec, plan.index)}" width="1200" height="900"><title>${xmlText(spec.title)} · ${xmlText(plan.name)} · ${DESIGN_LAYERS[layer].name}</title><rect x="-100" y="-100" width="300" height="300" fill="white"/><g font-family="sans-serif">${body}</g></svg>`;
}

/** AutoCAD 2007 UTF-8 DXF，坐标换算成毫米，CAD 的 Y 轴向上；中文直接用 UTF-8。 */
export function planDxf(spec: SceneSpec, plan: CompiledFloorPlan, layer: DesignLayer, design = emptyDesignPlan()) {
    const pairs: (string | number)[] = [];
    const add = (...values: (string | number)[]) => pairs.push(...values);
    const layers = [...new Set(floorPlanElements(spec, plan, layer, design).map((e) => e.layer))];
    add(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 9, "$INSUNITS", 70, 4, 9, "$MEASUREMENT", 70, 1, 0, "ENDSEC", 0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 5, "1", 330, "0", 100, "AcDbSymbolTable", 70, layers.length);
    for (const [index, name] of layers.entries()) add(0, "LAYER", 5, (index + 2).toString(16), 330, "1", 100, "AcDbSymbolTableRecord", 100, "AcDbLayerTableRecord", 2, name, 70, 0, 62, 7, 6, "CONTINUOUS");
    add(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
    const coordinate = (point: DesignPoint) => [round(point[0] * 1000), round(-point[1] * 1000)];
    const text = (value: string) => value.replace(/[\r\n]/g, " ").replace(/\\/g, "\\U+005c");
    for (const e of floorPlanElements(spec, plan, layer, design)) {
        if (e.kind === "line") {
            const a = coordinate(e.a),
                b = coordinate(e.b);
            if (e.layer === "STRUCTURE") add(0, "LWPOLYLINE", 100, "AcDbEntity", 8, e.layer, 420, parseInt(e.color.slice(1), 16), 100, "AcDbPolyline", 90, 2, 70, 0, 43, e.width * 1000, 10, a[0], 20, a[1], 10, b[0], 20, b[1]);
            else add(0, "LINE", 100, "AcDbEntity", 8, e.layer, 420, parseInt(e.color.slice(1), 16), 100, "AcDbLine", 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0);
        } else if (e.kind === "polygon") {
            add(0, "LWPOLYLINE", 100, "AcDbEntity", 8, e.layer, 420, parseInt(e.color.slice(1), 16), 100, "AcDbPolyline", 90, e.points.length, 70, 1, 43, e.width * 1000);
            for (const point of e.points) {
                const p = coordinate(point);
                add(10, p[0], 20, p[1]);
            }
        } else {
            const p = coordinate(e.at);
            add(0, "TEXT", 100, "AcDbEntity", 8, e.layer, 420, parseInt(e.color.slice(1), 16), 100, "AcDbText", 10, p[0], 20, p[1], 30, 0, 40, e.size * 1000, 1, text(e.text), 72, 1, 11, p[0], 21, p[1], 31, 0, 100, "AcDbText", 73, 0);
        }
    }
    add(0, "ENDSEC", 0, "EOF");
    return pairs.join("\r\n") + "\r\n";
}

export type QuantityRow = { key: string; category: string; name: string; unit: string; quantity: number; purchase: number; material: number | null; labor: number | null; total: number | null };
/** 工程量只从已有几何和人工标记算出；空单价保留未知，已知为零的报价仍可计入。 */
export function designQuantities(spec: SceneSpec, design = emptyDesignPlan()): QuantityRow[] {
    validateDesignPlan(design, spec);
    const rows: QuantityRow[] = [];
    const push = (key: string, category: string, name: string, unit: string, quantity: number) => {
        quantity = round(quantity);
        const price = design.prices[key];
        const purchase = round(quantity * (1 + (price?.waste || 0) / 100));
        const material = price?.material ?? null,
            labor = price?.labor ?? null;
        rows.push({ key, category, name, unit, quantity: round(quantity), purchase, material, labor, total: material === null || labor === null ? null : round(purchase * material + quantity * labor) });
    };
    for (const plan of compileSceneSpec(spec).plans) {
        const floor = spec.floors[plan.index];
        const exclude = [...floor.pillars, ...floor.stairs.map((s) => s.rect), ...plan.walls.map(wallRect)];
        const materials = new Map<string, SpecRect[]>();
        for (const room of floor.rooms) {
            const finish = room.floor || "未指定";
            materials.set(finish, [...(materials.get(finish) || []), room.rect]);
        }
        for (const [finish, rects] of materials) {
            const area = gridRegion(rects, exclude).reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);
            push(`${plan.index}:floor:${finish}`, "硬装", `${floor.name} · ${finish}地面`, "㎡", area);
        }
        const netArea = gridRegion(
            floor.rooms.map((r) => r.rect),
            exclude,
        ).reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);
        push(`${plan.index}:ceiling`, "硬装", `${floor.name} · 顶面基层（投影）`, "㎡", netArea);
        const wallArea = plan.walls.reduce((sum, w) => sum + Math.max(0, distance(w.start, w.end) * floor.height - w.holes.reduce((s, h) => s + h.width * h.height, 0)) * (w.exterior ? 1 : 2), 0);
        push(`${plan.index}:wall`, "硬装", `${floor.name} · 墙面（扣门窗）`, "㎡", wallArea);
        const items = new Map<string, number>();
        for (const f of plan.furniture) items.set(f.type, (items.get(f.type) || 0) + 1);
        for (const [type, count] of items) push(`${plan.index}:furniture:${type}`, "家具", `${floor.name} · ${furnitureInfo(type as SpecFurnitureType).name}`, "件", count);
    }
    for (const m of design.marks) {
        const qty = m.closed ? polygonArea(m.points) : m.points.length === 1 ? 1 : m.points.slice(1).reduce((sum, p, i) => sum + distance(m.points[i], p), 0);
        push(`mark:${m.id}`, m.layer === "custom" ? "定制" : m.closed ? "硬装" : "水电 / 标记", `${spec.floors[m.floor].name} · ${m.label}`, m.closed ? "㎡" : m.points.length === 1 ? "个" : "m", qty);
    }
    return rows;
}

export function designObjects(spec: SceneSpec, design: InteriorDesignPlan): SceneObject[] {
    validateDesignPlan(design, spec);
    return design.marks
        .filter((m) => m.closed && ["custom", "ceiling", "flooring"].includes(m.layer))
        .map((m) => {
            const x = m.points.reduce((s, p) => s + p[0], 0) / m.points.length,
                z = m.points.reduce((s, p) => s + p[1], 0) / m.points.length;
            const y = spec.floors.slice(0, m.floor).reduce((s, f) => s + f.height, spec.scope === "building" ? 0.45 : 0);
            return {
                shape: "extrude",
                axis: "y",
                outline: m.points.map((p) => [p[0] - x, p[1] - z]),
                depth: m.depth,
                position: [x, y + m.height + m.depth / 2, z],
                material: m.layer === "custom" ? "wood" : "wall",
                color: DESIGN_LAYERS[m.layer].color,
                group: spec.floors[m.floor].name,
                name: m.label,
            };
        });
}

/** 无 CDN、无外部脚本的离线方案页；图纸直接使用同一份平面数据。 */
export function offlinePlanHtml(spec: SceneSpec, design = emptyDesignPlan()) {
    const plans = compileSceneSpec(spec).plans;
    const drawings = plans.flatMap((p) => Object.keys(DESIGN_LAYERS).map((l) => `<section data-floor="${p.index}" data-kind="${l}">${planSvg(spec, p, l as DesignLayer, design)}</section>`)).join("");
    const rows = designQuantities(spec, design);
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xmlText(spec.title)}</title><style>body{margin:0;font:15px system-ui;background:#f5f4f0;color:#303438}header,aside{padding:20px}header{background:white;display:flex;gap:16px;flex-wrap:wrap;align-items:center}h1{font-size:20px;margin:0}select{padding:8px}section{display:none}section svg{width:100%;height:65vh}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;border:1px solid #ddd;text-align:left}small{color:#666}</style><header><h1>${xmlText(spec.title)}</h1><label>楼层 <select id="floor">${plans.map((p) => `<option value="${p.index}">${xmlText(p.name)}</option>`).join("")}</select></label><label>图层 <select id="kind">${Object.entries(
        DESIGN_LAYERS,
    )
        .map(([key, v]) => `<option value="${key}">${v.name}</option>`)
        .join(
            "",
        )}</select></label></header><main>${drawings}</main><aside><p>${xmlText(spec.summary)}</p><small>尺寸单位：毫米。尺寸与材料来自方案数据；水电和拆改是人工辅助标记，须现场及专业复核。此页支持离线查看平面与报价；三维模型另见 GLB。</small><h2>算量与报价</h2><table><tr><th>项目</th><th>工程量</th><th>含损耗</th><th>报价</th></tr>${rows.map((r) => `<tr><td>${xmlText(r.name)}</td><td>${r.quantity} ${r.unit}</td><td>${r.purchase} ${r.unit}</td><td>${r.total === null ? "待报价" : r.total.toFixed(2) + " 元"}</td></tr>`).join("")}</table></aside><script>const floor=document.getElementById('floor'),kind=document.getElementById('kind');function show(){document.querySelectorAll('section').forEach(s=>s.style.display=s.dataset.floor===floor.value&&s.dataset.kind===kind.value?'block':'none')}floor.onchange=kind.onchange=show;show();</script></html>`;
}
