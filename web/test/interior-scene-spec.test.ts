import { describe, expect, test } from "bun:test";
import type { SceneObject } from "../src/lib/interior/scene-3d";
import { compileSceneSpec, gridRegion, renderModel, sceneStats, solveWalls } from "../src/lib/interior/scene-compile";
import { buildSceneSpecEditPrompt, buildSceneSpecPrompt, normalizeSceneSpec, normalizeSceneV2 } from "../src/lib/interior/scene-spec";

/** 两个物体的同向面落在同一平面上并且互相压住，屏幕上就会来回闪（z-fighting）。只查轴对齐的方块和墙。 */
function coplanarOverlaps(objects: SceneObject[], minArea = 0.004) {
    type Face = { axis: number; sign: number; plane: number; a: [number, number]; b: [number, number]; owner: number };
    const faces: Face[] = [];
    objects.forEach((object, owner) => {
        let size: number[];
        let position: number[];
        if (object.shape === "wall") {
            const [sx, sz] = object.start!;
            const [ex, ez] = object.end!;
            const thickness = object.thickness ?? 0.2;
            const base = object.base ?? 0;
            const height = object.height!;
            if (Math.abs(sz - ez) < 1e-6)
                [size, position] = [
                    [Math.abs(ex - sx), height, thickness],
                    [(sx + ex) / 2, base + height / 2, sz],
                ];
            else if (Math.abs(sx - ex) < 1e-6)
                [size, position] = [
                    [thickness, height, Math.abs(ez - sz)],
                    [sx, base + height / 2, (sz + ez) / 2],
                ];
            else return;
        } else if (object.shape === "box" && !object.rotation && !object.repeat) [size, position] = [object.size!, object.position!];
        else return;
        for (let axis = 0; axis < 3; axis += 1) {
            const [u, v] = [0, 1, 2].filter((other) => other !== axis);
            for (const sign of [-1, 1]) faces.push({ axis, sign, plane: position[axis] + (sign * size[axis]) / 2, a: [position[u] - size[u] / 2, position[u] + size[u] / 2], b: [position[v] - size[v] / 2, position[v] + size[v] / 2], owner });
        }
    });
    const hits: string[] = [];
    for (let i = 0; i < faces.length; i += 1) {
        for (let j = i + 1; j < faces.length; j += 1) {
            const [f, g] = [faces[i], faces[j]];
            // 朝下的面贴在楼板上，看不见。
            if (f.owner === g.owner || f.axis !== g.axis || f.sign !== g.sign || (f.axis === 1 && f.sign < 0) || Math.abs(f.plane - g.plane) > 1e-4) continue;
            const overlap = Math.max(0, Math.min(f.a[1], g.a[1]) - Math.max(f.a[0], g.a[0])) * Math.max(0, Math.min(f.b[1], g.b[1]) - Math.max(f.b[0], g.b[0]));
            if (overlap > minArea) hits.push(`${objects[f.owner].shape}/${objects[f.owner].material} × ${objects[g.owner].shape}/${objects[g.owner].material} @${f.plane}`);
        }
    }
    return hits;
}

const villa = {
    title: "两层小别墅",
    floors: [
        {
            name: "一层",
            height: 3.2,
            rooms: [
                { name: "客厅", type: "living", rect: [-6, 0, 0, 5] },
                { name: "餐厅", type: "dining", rect: [0, 0, 4, 5] },
                { name: "楼梯间", type: "stair", rect: [-6, -4, -3.6, 0] },
                { name: "卫生间", rect: [-3.6, -4, 0, 0] },
                { name: "厨房", type: "kitchen", rect: [0, -4, 4, 0], floor: "tile" },
            ],
            open: [["客厅", "餐厅"]],
            doors: [{ room: "客厅", side: "s", kind: "slide", width: 3 }, { between: ["餐厅", "厨房"] }, { room: "餐厅", side: "e", kind: "entry" }],
            windows: [
                { room: "客厅", side: "w", width: 2 },
                { room: "厨房", side: "n", width: 1.5, count: 2 },
                { room: "不存在", side: "n", width: 1 },
            ],
            stairs: [{ rect: [-5.9, -3.9, -4.7, -0.1], up: "n" }],
            furniture: [
                { type: "sofa", room: "客厅", at: "n" },
                { type: "dining-table", room: "餐厅", at: "c" },
                { type: "spaceship", room: "客厅" },
            ],
        },
        {
            name: "二层",
            height: 3,
            rooms: [
                { name: "主卧", type: "master", rect: [-6, 0, 0, 5] },
                { name: "楼梯间", type: "stair", rect: [-6, -4, -3.6, 0] },
                { name: "书房", type: "study", rect: [-3.6, -4, 0, 0] },
            ],
            balconies: [{ rect: [-6, 5, 0, 6.4], rail: "glass" }],
            doors: [{ room: "主卧", side: "s", kind: "slide" }],
            windows: [{ room: "主卧", side: "w", width: 1.8 }],
        },
    ],
    roof: { type: "hip", pitch: 28, overhang: 0.6 },
    site: { size: [30, 26], fence: { rect: [-10, -8, 9, 11], height: 1.8, style: "wall", gate: "n" }, paving: [{ rect: [1, 5, 8, 10] }], pools: [[3, 6, 7, 9]], trees: [{ at: [-8, 8], size: "l" }] },
};

describe("interior 3D scene plan (v2)", () => {
    test("normalizes the plan: snaps to 5 cm, drops unknown rooms, furniture and references", () => {
        const spec = normalizeSceneSpec({ ...villa, floors: [{ ...villa.floors[0], rooms: [...villa.floors[0].rooms, { name: "客厅副本", rect: [-5.98, 0.02, 0, 5] }, { name: "太小", rect: [0, 0, 0.3, 3] }] }, villa.floors[1]] }, "building");
        const [first] = spec.floors;
        expect(first.rooms.map((room) => room.name)).toEqual(["客厅", "餐厅", "楼梯间", "卫生间", "厨房"]);
        expect(first.rooms[3].type).toBe("bathroom");
        expect(first.windows.map((item) => item.room)).toEqual(["客厅", "厨房"]);
        expect(first.furniture.map((item) => item.type)).toEqual(["sofa", "dining-table"]);
        expect(spec.roof.type).toBe("hip");
        expect(spec.site?.pools).toHaveLength(1);
        // 单个房间只留一层，不要屋顶和庭院。
        const room = normalizeSceneSpec(villa, "room");
        expect(room.floors).toHaveLength(1);
        expect(room.roof.type).toBe("none");
        expect(room.site).toBeUndefined();
        expect(() => normalizeSceneSpec({ floors: [{ rooms: [] }] }, "home")).toThrow("没有能用的房间");
        expect(normalizeSceneV2({ version: 2, spec: { ...villa, scope: "building" } }).spec.floors).toHaveLength(2);
    });

    test("solves walls: exterior around the plan, interior between rooms, none between open rooms", () => {
        const rooms = normalizeSceneSpec(villa, "building").floors[0].rooms;
        const walls = solveWalls(rooms, [["客厅", "餐厅"]]);
        const exterior = walls.filter((wall) => wall.ext);
        // 外轮廓是一个 10 × 9 的矩形：四面外墙。
        expect(exterior).toHaveLength(4);
        expect(walls.some((wall) => wall.axis === "z" && wall.line === 0 && wall.a < 2.5 && wall.b > 2.5)).toBe(false);
        const north = exterior.find((wall) => wall.axis === "x" && wall.line === -4)!;
        const west = exterior.find((wall) => wall.axis === "z" && wall.line === -6)!;
        // L 形拐角：横墙延长半个墙厚，竖墙截短半个墙厚。
        expect(north.adjA).toEqual({ sign: 1, other: 0.24 });
        expect(west.adjA).toEqual({ sign: -1, other: 0.24 });
    });

    test("subtracts regions on a grid", () => {
        const region = gridRegion([[0, 0, 4, 4]], [[1, 1, 2, 2]]);
        const area = region.reduce((sum, [x1, z1, x2, z2]) => sum + (x2 - x1) * (z2 - z1), 0);
        expect(area).toBe(15);
        expect(
            gridRegion([
                [0, 0, 2, 2],
                [2, 0, 4, 2],
            ]),
        ).toEqual([[0, 0, 4, 2]]);
    });

    test("compiles a full building without overlapping coplanar faces (no flicker)", () => {
        const spec = normalizeSceneSpec(villa, "building");
        const compiled = compileSceneSpec(spec);
        expect(compiled.floors).toEqual(["一层", "二层"]);
        expect(compiled.objects.some((object) => object.shape === "hip")).toBe(true);
        expect(compiled.objects.some((object) => object.material === "water")).toBe(true);
        expect(compiled.labels.map((label) => label.text)).toContain("主卧");
        // 每个房间都能进去：没写门的卫生间、书房自动开了门。
        const doors = compiled.objects.filter((object) => object.shape === "wall").flatMap((object) => object.openings || []);
        expect(doors.filter((opening) => opening.height >= 2).length).toBeGreaterThanOrEqual(6);
        expect(coplanarOverlaps(compiled.objects)).toEqual([]);
        const flat = compileSceneSpec({ ...spec, roof: { ...spec.roof, type: "flat" } });
        expect(coplanarOverlaps(flat.objects)).toEqual([]);
        // 剖切一层：二层和屋顶不显示，一层的墙只砌到 1.2 米。
        const cut = renderModel({ version: 2, title: spec.title, summary: "", spec }, { cutFloor: 0 });
        expect(cut.groups).toEqual(["一层"]);
        expect(Math.max(...cut.objects.filter((object) => object.shape === "wall").map((object) => (object.base ?? 0) + object.height!))).toBeCloseTo(1.65, 2);
        expect(sceneStats({ version: 2, title: "", summary: "", spec })).toBe("2 层 · 8 个空间");
    });

    test("prompts carry the brief and knowledge; edits send the whole plan back", () => {
        const prompt = buildSceneSpecPrompt({ scope: "home", description: "三室两厅", hasReference: true, knowledge: [{ kindName: "空间尺寸", title: "卧室", guidance: "不小于 3 米" }] });
        expect(prompt).toContain("三室两厅");
        expect(prompt).toContain("【空间尺寸】卧室：不小于 3 米");
        expect(prompt).toContain("不要自己写墙");
        const spec = normalizeSceneSpec(villa, "building");
        const edit = buildSceneSpecEditPrompt(spec, "主卧加一个衣柜");
        expect(edit).toContain("主卧加一个衣柜");
        expect(edit).toContain('"name":"主卧"');
    });
});
