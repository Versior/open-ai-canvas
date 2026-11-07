import { normalizeInteriorScene, SCENE_MATERIALS, type SceneObject } from "./scene-3d";
import { FACING_ROTATION, FLOOR_FINISHES, FURNITURE_TYPES, furnitureInfo, snap, SPEC_LIMITS, type InteriorSceneData, type SpecFurniture, type SpecSide } from "./scene-spec";

export type SceneEditTarget = { kind: "room"; floor: number; room: string } | { kind: "furniture"; floor: number; index: number } | { kind: "object"; index: number };
export type SceneEditOption = { value: string; label: string; target: SceneEditTarget };

export function sceneEditOptions(scene: InteriorSceneData): SceneEditOption[] {
    if (scene.version === 1) return scene.objects.map((object, index) => ({ value: `object:${index}`, label: `${object.group ? `${object.group} · ` : ""}${object.name || object.shape} #${index + 1}`, target: { kind: "object", index } }));
    return scene.spec.floors.flatMap((floor, floorIndex) => [
        ...floor.rooms.filter((room) => !room.part).map((room) => ({ value: `room:${floorIndex}:${room.name}`, label: `${floor.name} · ${room.name}`, target: { kind: "room" as const, floor: floorIndex, room: room.name } })),
        ...floor.furniture.map((item, index) => ({ value: `furniture:${floorIndex}:${index}`, label: `${floor.name} · ${item.room} · ${furnitureInfo(item.type).name} #${index + 1}`, target: { kind: "furniture" as const, floor: floorIndex, index } })),
    ]);
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("局部调整须返回一个修改对象");
    return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: string[]) {
    if (!Object.keys(value).length || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("修改包含目标范围以外的字段，请缩小调整要求");
}

function numbers(value: unknown, count: number, positive = false) {
    if (!Array.isArray(value) || value.length !== count || value.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 60 || (positive && n <= 0.05))) throw new Error("位置或尺寸无效，单位为米");
}

function color(value: unknown) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("颜色须为六位十六进制色值");
}

function targetData(scene: InteriorSceneData, target: SceneEditTarget) {
    if (!sceneEditOptions(scene).some((option) => sameTarget(option.target, target))) throw new Error("调整目标已不存在，请重新选择");
    if (scene.version === 1 && target.kind === "object") return scene.objects[target.index];
    if (scene.version === 2 && target.kind !== "object") {
        const floor = scene.spec.floors[target.floor];
        if (target.kind === "furniture") return floor.furniture[target.index];
        return { room: floor.rooms.find((room) => room.name === target.room), furniture: floor.furniture.filter((item) => item.room === target.room) };
    }
    throw new Error("模型版本与调整目标不匹配");
}

function sameTarget(a: SceneEditTarget, b: SceneEditTarget) {
    if (a.kind === "room" && b.kind === "room") return a.floor === b.floor && a.room === b.room;
    if (a.kind === "furniture" && b.kind === "furniture") return a.floor === b.floor && a.index === b.index;
    return a.kind === "object" && b.kind === "object" && a.index === b.index;
}

function checkedFurniture(value: unknown, scene: Extract<InteriorSceneData, { version: 2 }>, floorIndex: number, roomName: string): SpecFurniture {
    const item = record(value);
    fields(item, ["type", "room", "at", "rotate", "size", "color", "pos", "facing"]);
    if (typeof item.type !== "string" || !Object.hasOwn(FURNITURE_TYPES, item.type) || item.room !== roomName) throw new Error("家具类型无效或超出了选定房间");
    if (typeof item.at !== "string" || !["n", "s", "e", "w", "c", "ne", "nw", "se", "sw"].includes(item.at)) throw new Error("家具摆放位置无效");
    if (item.facing !== undefined && !["n", "s", "e", "w"].includes(String(item.facing))) throw new Error("家具朝向无效");
    if (item.rotate !== undefined && (typeof item.rotate !== "number" || !Number.isFinite(item.rotate) || Math.abs(item.rotate) > 360 || item.rotate % 90 !== 0)) throw new Error("家具旋转须为 -360 到 360 度内的 90 度倍数");
    if (item.facing !== undefined) item.rotate = FACING_ROTATION[item.facing as SpecSide];
    else if (item.rotate !== undefined) item.rotate = ((item.rotate as number) + 360) % 360;
    if (item.size !== undefined) {
        numbers(item.size, 2, true);
        if ((item.size as number[]).some((n) => n < 0.3 || n > 6)) throw new Error("家具宽深须在 0.3 到 6 米之间");
        item.size = (item.size as number[]).map(snap);
    }
    if (item.color !== undefined) {
        color(item.color);
        item.color = (item.color as string).toLowerCase();
    }
    if (item.pos !== undefined) {
        numbers(item.pos, 2);
        item.pos = (item.pos as number[]).map(snap);
        const [x, z] = item.pos as number[];
        if (!scene.spec.floors[floorIndex].rooms.some((room) => (room.name === roomName || room.part === roomName) && x >= room.rect[0] && x <= room.rect[2] && z >= room.rect[1] && z <= room.rect[3])) throw new Error("家具中心超出了选定房间，未应用调整");
    }
    return item as SpecFurniture;
}

/** 局部修改只写入选定元素；模型不能通过返回整份方案改变其他房间、轴网或结构。 */
export function applySceneLocalEdit(scene: InteriorSceneData, target: SceneEditTarget, value: unknown): InteriorSceneData {
    const original = targetData(scene, target);
    const patch = record(value);
    const next = structuredClone(scene);
    if (next.version === 1 && target.kind === "object") {
        fields(patch, ["position", "rotation", "size", "radius", "height", "color", "material"]);
        if (patch.position !== undefined) numbers(patch.position, 3);
        if (patch.rotation !== undefined) {
            if (!Array.isArray(patch.rotation) || patch.rotation.length !== 3 || patch.rotation.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 360)) throw new Error("旋转角度无效");
        }
        if (patch.size !== undefined) numbers(patch.size, 3, true);
        for (const key of ["radius", "height"]) if (patch[key] !== undefined && (typeof patch[key] !== "number" || !Number.isFinite(patch[key]) || patch[key] <= 0.05 || patch[key] > 60)) throw new Error("物体尺寸无效");
        if (patch.color !== undefined) color(patch.color);
        if (patch.material !== undefined && !SCENE_MATERIALS.includes(patch.material as (typeof SCENE_MATERIALS)[number])) throw new Error("物体材质无效");
        const checked = normalizeInteriorScene({ ...next, objects: [{ ...original, ...patch }] });
        if (checked.dropped || checked.scene.objects.length !== 1) throw new Error("局部修改无法构成有效物体");
        next.objects[target.index] = checked.scene.objects[0];
    } else if (next.version === 2 && target.kind !== "object") {
        const floor = next.spec.floors[target.floor];
        if (target.kind === "furniture") {
            fields(patch, ["type", "at", "rotate", "size", "color", "pos", "facing"]);
            const item = floor.furniture[target.index];
            const merged = { ...item, ...patch };
            if (Object.hasOwn(patch, "rotate") && !Object.hasOwn(patch, "facing")) delete merged.facing;
            if (Object.hasOwn(patch, "at") && !Object.hasOwn(patch, "pos")) delete merged.pos;
            floor.furniture[target.index] = checkedFurniture(merged, next, target.floor, item.room);
        } else {
            fields(patch, ["floor", "furniture"]);
            if (patch.floor !== undefined) {
                if (!(FLOOR_FINISHES as readonly unknown[]).includes(patch.floor)) throw new Error("地面材料无效");
                for (const room of floor.rooms) if (room.name === target.room || room.part === target.room) room.floor = patch.floor as typeof room.floor;
            }
            if (patch.furniture !== undefined) {
                if (!Array.isArray(patch.furniture) || !patch.furniture.length) throw new Error("请提供至少一件家具，避免恢复自动配家具");
                const furniture = patch.furniture.map((item) => checkedFurniture(item, next, target.floor, target.room));
                floor.furniture = [...floor.furniture.filter((item) => item.room !== target.room), ...furniture];
                if (floor.furniture.length > SPEC_LIMITS.furniture) throw new Error("家具数量超过模型上限");
            }
        }
    }
    if (JSON.stringify(scene) === JSON.stringify(next)) throw new Error("没有可应用的局部变化，请明确调整要求");
    return next;
}

export function buildSceneLocalEditPrompt(scene: InteriorSceneData, target: SceneEditTarget, instruction: string) {
    const current = targetData(scene, target);
    const label = sceneEditOptions(scene).find((option) => sameTarget(option.target, target))!.label;
    const floor = scene.version === 2 && target.kind !== "object" ? scene.spec.floors[target.floor] : undefined;
    const roomName = floor && target.kind === "furniture" ? floor.furniture[target.index].room : target.kind === "room" ? target.room : undefined;
    const context = floor ? { rooms: floor.rooms.filter((room) => room.name === roomName || room.part === roomName), height: floor.height, doors: floor.doors, windows: floor.windows } : undefined;
    const schema =
        target.kind === "room"
            ? '返回 {"floor":"wood|tile|marble|stone|carpet|concrete","furniture":[{"type":"家具类型","room":"选定房间名","at":"n|s|e|w|c|ne|nw|se|sw","pos":[x,z],"facing":"n|s|e|w","size":[宽,深],"color":"#RRGGBB"}]}。字段可省略；furniture 若返回则替换该房间的全部家具，须保留未要求修改的家具，至少一件。'
            : target.kind === "furniture"
              ? "仅返回要改变的 type、at、pos、facing、rotate、size、color 字段；不能改变房间。"
              : "仅返回要改变的 position [x,y,z]、rotation [x,y,z]、size [宽,高,深]、radius、height、color、material 字段，不能改变形状或其他物体。";
    return [
        "你是室内三维局部调整助手。只输出 JSON 修改对象，不输出整份场景，不附带说明或代码块。",
        `选定目标：${label}`,
        `当前目标：${JSON.stringify(current)}`,
        ...(context ? [`只读空间参考（不能修改）：${JSON.stringify(context)}`] : []),
        `用户要求：${instruction.trim()}`,
        schema,
        "尺寸和位置单位为米，位置按 0.05 米网格保存；家具宽深为 0.3 至 6 米，家具旋转为 90 度倍数。颜色须是六位十六进制。禁止改变其他房间、墙体、轴网、楼层或模型整体。",
        target.kind === "object" ? `可用物体材质：${SCENE_MATERIALS.join(", ")}` : `可用家具类型：${Object.keys(FURNITURE_TYPES).join(", ")}`,
    ].join("\n");
}

export function sceneTargetBounds(scene: InteriorSceneData, target: SceneEditTarget): { position: [number, number, number]; size: [number, number, number]; rotation?: [number, number, number] } | undefined {
    targetData(scene, target);
    if (scene.version === 1 && target.kind === "object") {
        const item: SceneObject = scene.objects[target.index];
        if (!item.position) return;
        return {
            position: item.position,
            size: item.size || [2 * (item.radius || 0.5), item.height || 2 * (item.radius || 0.5), 2 * (item.radius || 0.5)],
            rotation: item.rotation?.map((angle) => (angle * Math.PI) / 180) as [number, number, number] | undefined,
        };
    }
    if (scene.version === 2 && target.kind !== "object") {
        const floor = scene.spec.floors[target.floor];
        const item = target.kind === "furniture" ? floor.furniture[target.index] : undefined;
        const room = floor.rooms.find((room) => room.name === (target.kind === "room" ? target.room : item?.room))!;
        const [x1, z1, x2, z2] = room.rect;
        const y = scene.spec.floors.slice(0, target.floor).reduce((sum, item) => sum + item.height, scene.spec.scope === "building" ? 0.45 : 0);
        if (item) {
            if (!item.pos) return;
            return { position: [item.pos[0], y + 0.6, item.pos[1]], size: [item.size?.[0] || furnitureInfo(item.type).size[0], 1.2, item.size?.[1] || furnitureInfo(item.type).size[1]], rotation: [0, ((item.rotate || 0) * Math.PI) / 180, 0] };
        }
        return { position: [(x1 + x2) / 2, y + 0.05, (z1 + z2) / 2], size: [x2 - x1, 0.1, z2 - z1] };
    }
}
