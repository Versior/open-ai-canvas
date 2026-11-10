import type { CompiledFloorPlan } from "./scene-compile";
import { type SpecFloor, type SpecRect } from "./scene-spec";
import type { DesignPoint, DesignMark } from "./design-plan";

const RADIUS = 0.16;
const inside = ([x, z]: DesignPoint, [x1, z1, x2, z2]: SpecRect, margin = 0) => x > x1 - margin && x < x2 + margin && z > z1 - margin && z < z2 + margin;

/** 漫游只允许在本层房间并集内行走；保留完整墙体，仅从实际门洞通过。 */
export function canWalk(point: DesignPoint, floor: SpecFloor, plan: CompiledFloorPlan, obstacles: DesignMark[] = []) {
    if (!floor.rooms.some((room) => inside(point, room.rect, 0.0001))) return false;
    if ([...floor.pillars, ...floor.stairs.map((s) => s.rect)].some((rect) => inside(point, rect, RADIUS))) return false;
    for (const wall of plan.walls) {
        const horizontal = Math.abs(wall.start[1] - wall.end[1]) < 0.001;
        const along = horizontal ? point[0] : point[1],
            across = horizontal ? point[1] : point[0];
        const line = horizontal ? wall.start[1] : wall.start[0],
            from = horizontal ? wall.start[0] : wall.start[1],
            to = horizontal ? wall.end[0] : wall.end[1];
        if (Math.abs(across - line) >= wall.thickness / 2 + RADIUS || along < from - RADIUS || along > to + RADIUS) continue;
        const door = wall.holes.some((h) => ["door", "double", "slide", "entry", "opening"].includes(h.kind) && h.bottom < 0.1 && along > h.center - h.width / 2 + RADIUS && along < h.center + h.width / 2 - RADIUS);
        if (!door) return false;
    }
    for (const furniture of plan.furniture) {
        if (["rug", "pendant", "mirror", "screen", "floor-lamp", "plant"].includes(furniture.type)) continue;
        const turned = Math.round(furniture.rotation / 90) % 2 !== 0,
            w = turned ? furniture.d : furniture.w,
            d = turned ? furniture.w : furniture.d;
        if (inside(point, [furniture.x - w / 2, furniture.z - d / 2, furniture.x + w / 2, furniture.z + d / 2], RADIUS)) return false;
    }
    for (const mark of obstacles) {
        if (!mark.closed || mark.layer !== "custom" || mark.height >= 1.8 || mark.height + mark.depth < 0.15) continue;
        let contained = false;
        for (let i = 0, j = mark.points.length - 1; i < mark.points.length; j = i++) {
            const a = mark.points[i],
                b = mark.points[j];
            if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) contained = !contained;
            const dx = b[0] - a[0],
                dz = b[1] - a[1],
                length = dx * dx + dz * dz;
            const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length)) : 0;
            if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz) < RADIUS) return false;
        }
        if (contained) return false;
    }
    return true;
}

export function walkStart(floor: SpecFloor, plan: CompiledFloorPlan, roomName?: string, obstacles: DesignMark[] = []): DesignPoint | null {
    const rooms = roomName ? floor.rooms.filter((r) => r.name === roomName || r.part === roomName) : [...floor.rooms].sort((a, b) => Number(b.type === "entry") - Number(a.type === "entry"));
    for (const room of rooms) {
        const [x1, z1, x2, z2] = room.rect,
            center: DesignPoint = [(x1 + x2) / 2, (z1 + z2) / 2];
        if (canWalk(center, floor, plan, obstacles)) return center;
        let nearest: DesignPoint | null = null;
        let best = Infinity;
        for (let z = z1 + 0.3; z < z2 - 0.2; z += 0.3)
            for (let x = x1 + 0.3; x < x2 - 0.2; x += 0.3) {
                const distance = Math.hypot(x - center[0], z - center[1]);
                if (distance < best && canWalk([x, z], floor, plan, obstacles)) {
                    nearest = [x, z];
                    best = distance;
                }
            }
        if (nearest) return nearest;
    }
    return null;
}

/** 分段推进防止低帧率穿墙，并允许沿墙滑动。 */
export function moveWalk(from: DesignPoint, delta: DesignPoint, floor: SpecFloor, plan: CompiledFloorPlan, obstacles: DesignMark[] = []): DesignPoint {
    const steps = Math.max(1, Math.ceil(Math.hypot(...delta) / 0.06));
    let point: DesignPoint = [...from];
    for (let i = 0; i < steps; i++) {
        const x: DesignPoint = [point[0] + delta[0] / steps, point[1]];
        if (canWalk(x, floor, plan, obstacles)) point = x;
        const z: DesignPoint = [point[0], point[1] + delta[1] / steps];
        if (canWalk(z, floor, plan, obstacles)) point = z;
    }
    return point;
}
