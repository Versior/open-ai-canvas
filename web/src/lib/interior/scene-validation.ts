import { normalizeSceneSpec, sharedEdge, specDimensionCheck, type SpecRect } from "./scene-spec";
import type { InteriorSceneScope } from "./scene-3d";
import { compileSceneSpec } from "./scene-compile";

/** 完整回复的保存边界；流式预览仍允许半成品，保存时不能把被解析器丢掉的空间当作建模成功。 */
export function checkSceneCompletion(value: unknown, scope: InteriorSceneScope, options: { truncated?: boolean; spaces?: { name: string }[]; size?: { width: number; depth: number } } = {}) {
    const spec = normalizeSceneSpec(value, scope);
    const raw = value as { floors?: { rooms?: { rect?: unknown; rects?: unknown[] }[]; doors?: unknown[]; windows?: unknown[]; furniture?: unknown[] }[] };
    const issues: string[] = [];
    if (options.truncated) issues.push("回复被截断，需要输出完整方案");
    if (raw.floors?.length !== spec.floors.length) issues.push("楼层被丢弃，请完整保留每层");
    spec.floors.forEach((floor, index) => {
        const source = raw.floors?.[index];
        const count = source?.rooms?.reduce((sum, room) => sum + (room.rect ? 1 : 0) + (room.rects?.length || 0), 0);
        if (count !== floor.rooms.length) issues.push(`${floor.name}房间被丢弃：检查重叠、尺寸、重复名称和数量，不要用一个大矩形盖住多个空间`);
        for (const key of ["doors", "windows", "furniture"] as const) {
            if ((source?.[key]?.length || 0) !== floor[key].length) issues.push(`${floor.name}的${key}含无效类型或不存在的房间引用`);
        }
        const overlap = (a: SpecRect, b: SpecRect) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.05 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.05;
        floor.rooms.forEach((room, i) => {
            for (const other of floor.rooms.slice(i + 1)) if (overlap(room.rect, other.rect)) issues.push(`${floor.name}房间重叠：${room.name} / ${other.name}`);
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
    });
    const names = new Set(spec.floors.flatMap((floor) => [...floor.rooms.map((room) => room.part || room.name), ...floor.balconies.map((balcony) => balcony.name)]));
    for (const space of options.spaces || []) if (!names.has(space.name)) issues.push(`读图中的空间漏掉：${space.name}，请使用读图清单中的原名`);
    const dimensions = specDimensionCheck(spec);
    if (dimensions) issues.push(dimensions);
    if (options.size && (Math.abs((spec.grid?.width || 0) - options.size.width) > 0.1 || Math.abs((spec.grid?.depth || 0) - options.size.depth) > 0.1)) issues.push("建模总尺寸与读图校核的尺寸不一致，不能修改读图总尺寸来绕过检查");
    compileSceneSpec(spec, { onLayoutIssue: (issue) => issues.push(issue) });
    return { spec, issues: [...new Set(issues)] };
}
