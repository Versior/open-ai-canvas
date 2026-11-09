import { normalizeSceneSpec, sharedEdge, specDimensionCheck, type SpecRect } from "./scene-spec";
import type { InteriorSceneScope } from "./scene-3d";
import { compileSceneSpec } from "./scene-compile";

/** 完整回复的保存边界；流式预览仍允许半成品，保存时不能把被解析器丢掉的空间当作建模成功。 */
export function checkSceneCompletion(value: unknown, scope: InteriorSceneScope, options: { truncated?: boolean; spaces?: { name: string }[]; size?: { width: number; depth: number } } = {}) {
    const spec = normalizeSceneSpec(value, scope);
    const raw = value as { floors?: { rooms?: { rect?: unknown; rects?: unknown[] }[]; doors?: unknown[]; windows?: unknown[]; furniture?: unknown[]; stairs?: unknown[]; balconies?: unknown[]; pillars?: unknown[] }[] };
    const issues: string[] = [];
    if (options.truncated) issues.push("回复被截断，需要输出完整方案");
    if (raw.floors?.length !== spec.floors.length) issues.push("楼层被丢弃，请完整保留每层");
    spec.floors.forEach((floor, index) => {
        const source = raw.floors?.[index];
        for (const key of ["rooms", "doors", "windows", "stairs", "balconies", "pillars", "furniture"] as const) {
            const field = source?.[key];
            if (field !== undefined && !Array.isArray(field)) issues.push(`${floor.name}的${key}必须是数组，不能丢弃结构`);
        }
        const count = Array.isArray(source?.rooms) ? source.rooms.reduce((sum, room) => sum + (room.rect ? 1 : 0) + (room.rects?.length || 0), 0) : 0;
        if (count !== floor.rooms.length) issues.push(`${floor.name}房间被丢弃：检查重叠、尺寸、重复名称和数量，不要用一个大矩形盖住多个空间`);
        for (const key of ["doors", "windows", "furniture", "stairs", "balconies", "pillars"] as const) {
            if ((source?.[key]?.length || 0) !== floor[key].length) issues.push(`${floor.name}的${key}含无效类型或不存在的房间引用`);
        }
        const overlap = (a: SpecRect, b: SpecRect) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.05 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.05;
        floor.rooms.forEach((room, i) => {
            for (const other of floor.rooms.slice(i + 1)) if (overlap(room.rect, other.rect)) issues.push(`${floor.name}房间重叠：${room.name} / ${other.name}`);
            for (const balcony of floor.balconies) if (overlap(room.rect, balcony.rect)) issues.push(`${room.name}与户外空间${balcony.name || "露台"}重叠，不能重复砌墙或铺水面`);
        });
        const family = (name: string) => floor.rooms.filter((room) => room.name === name || room.part === name);
        for (const pair of [...floor.open, ...floor.doors.flatMap((door) => (door.between ? [door.between] : []))]) {
            const touching = family(pair[0]).some((a) => family(pair[1]).some((b) => sharedEdge(a.rect, b.rect) >= 0.6));
            if (!touching) issues.push(`${pair.join(" / ")}没有共用墙，不能开门或设为开放连通`);
        }
        for (const door of floor.doors) {
            if (door.at === undefined) continue;
            const spans: [number, number][] = [];
            if (door.between) {
                for (const a of family(door.between[0]))
                    for (const b of family(door.between[1])) {
                        if (!sharedEdge(a.rect, b.rect)) continue;
                        const horizontal = Math.abs(a.rect[1] - b.rect[3]) < 0.001 || Math.abs(a.rect[3] - b.rect[1]) < 0.001;
                        const axis = horizontal ? 0 : 1;
                        spans.push([Math.max(a.rect[axis], b.rect[axis]), Math.min(a.rect[axis + 2], b.rect[axis + 2])]);
                    }
            } else if (door.room && door.side) {
                const axis = door.side === "n" || door.side === "s" ? 0 : 1;
                for (const room of family(door.room)) spans.push([room.rect[axis], room.rect[axis + 2]]);
            }
            const half = (door.width || 0.9) / 2;
            if (spans.length && !spans.some(([a, b]) => door.at! - half >= a - 0.05 && door.at! + half <= b + 0.05)) issues.push(`${door.between?.join(" / ") || door.room}门洞超出共用墙段，at 要写沿墙坐标，不是墙所在轴线`);
        }
        for (const window of floor.windows) {
            if (window.at === undefined) continue;
            const axis = window.side === "n" || window.side === "s" ? 0 : 1;
            if (!family(window.room).some(({ rect }) => window.at! - window.width / 2 >= rect[axis] - 0.05 && window.at! + window.width / 2 <= rect[axis + 2] + 0.05)) issues.push(`${window.room}窗洞超出房间墙段`);
        }
    });
    const names = new Set(spec.floors.flatMap((floor) => [...floor.rooms.map((room) => room.part || room.name), ...floor.balconies.map((balcony) => balcony.name)]));
    for (const space of options.spaces || []) if (!names.has(space.name)) issues.push(`读图中的空间漏掉：${space.name}，请使用读图清单中的原名`);
    const dimensions = specDimensionCheck(spec);
    if (dimensions) issues.push(dimensions);
    if (options.size && (Math.abs((spec.grid?.width || 0) - options.size.width) > 0.1 || Math.abs((spec.grid?.depth || 0) - options.size.depth) > 0.1)) issues.push("建模总尺寸与读图校核的尺寸不一致，不能修改读图总尺寸来绕过检查");
    compileSceneSpec(spec, { onLayoutIssue: (issue) => issues.push(issue) });
    return { spec, issues: [...new Set(issues)] };
}

/** 用已校核图纸构造最终方案。装修阶段只能填材质与家具，不能通过重写房间掩盖错误。 */
export function applyDrawingFinishes(value: unknown, layout: ReturnType<typeof normalizeSceneSpec>) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型没有给出材质与家具方案");
    const raw = value as Record<string, unknown>;
    const floors = raw.floors;
    if (!Array.isArray(floors) || floors.length !== layout.floors.length) throw new Error("材质方案未保留图纸楼层");
    const issues: string[] = [];
    for (const field of ["grid", "roof", "site"]) if (raw[field] !== undefined) issues.push(`材质阶段不得重写${field}`);
    const assembled = layout.floors.map((base) => {
        const match = floors.filter((floor) => floor?.name === base.name);
        if (match.length !== 1) throw new Error(`材质方案缺少或重复楼层：${base.name}`);
        const floor = match[0];
        for (const field of ["height", "open", "doors", "windows", "stairs", "pillars", "balconies"]) if (floor[field] !== undefined) issues.push(`材质阶段不得重写${base.name}的${field}`);
        const finishes = floor.rooms;
        if (!Array.isArray(finishes)) throw new Error(`${base.name}缺少房间材质列表`);
        for (const room of finishes) {
            if (!base.rooms.some((entry) => entry.name === room?.name || entry.part === room?.name)) issues.push(`材质方案引用未知房间：${room?.name}`);
            if (room?.rect !== undefined || room?.rects !== undefined || room?.type !== undefined) issues.push(`材质阶段不得重排房间：${room?.name}`);
            if (room?.floor !== undefined && !["wood", "tile", "marble", "stone", "concrete", "carpet"].includes(room.floor)) issues.push(`房间地面材料无效：${room?.name}`);
        }
        if (floor.furniture !== undefined && !Array.isArray(floor.furniture)) throw new Error(`${base.name}家具数组格式无效`);
        return {
            ...base,
            ...(floor.wallColor ? { wallColor: floor.wallColor } : {}),
            rooms: base.rooms.map((room) => {
                const finish = finishes.find((entry) => entry.name === (room.part || room.name))?.floor;
                return { ...room, ...(finish ? { floor: finish } : {}) };
            }),
            furniture: floor.furniture === undefined ? base.furniture : floor.furniture,
        };
    });
    if (issues.length) throw new Error(issues.join("；"));
    return { ...layout, ...(raw.palette ? { palette: raw.palette } : {}), title: raw.title || layout.title, summary: raw.summary || layout.summary, floors: assembled };
}
