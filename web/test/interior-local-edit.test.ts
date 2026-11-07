import { expect, test } from "bun:test";
import { applySceneLocalEdit, buildSceneLocalEditPrompt, sceneEditOptions, sceneTargetBounds, type SceneEditTarget } from "@/lib/interior/scene-local-edit";
import { normalizeSceneV2 } from "@/lib/interior/scene-spec";
import { normalizeInteriorScene } from "@/lib/interior/scene-3d";

function scene() {
    return normalizeSceneV2({
        spec: {
            scope: "home",
            title: "局部调整测试",
            grid: { width: 8, depth: 4, x: [0, 4, 8], z: [0, 4] },
            floors: [
                {
                    name: "一层",
                    height: 2.8,
                    rooms: [
                        { name: "客厅", type: "living", rect: [0, 0, 4, 4], floor: "wood" },
                        { name: "卧室", type: "bedroom", rect: [4, 0, 8, 4], floor: "tile" },
                    ],
                    furniture: [
                        { type: "sofa", room: "客厅", at: "c", pos: [2, 2], facing: "n" },
                        { type: "bed", room: "卧室", at: "c", pos: [6, 2], facing: "n" },
                    ],
                },
            ],
        },
    });
}

test("local furniture edits preserve structure, other rooms and parent version", () => {
    const base = scene(),
        before = JSON.stringify(base);
    const next = applySceneLocalEdit(base, { kind: "furniture", floor: 0, index: 0 }, { color: "#abcdef", pos: [2.5, 2] });
    expect(JSON.stringify(base)).toBe(before);
    expect(next.version).toBe(2);
    if (next.version !== 2) throw new Error("wrong version");
    expect(next.spec.grid).toEqual(base.spec.grid);
    expect(next.spec.floors[0].rooms).toEqual(base.spec.floors[0].rooms);
    expect(next.spec.floors[0].furniture[1]).toEqual(base.spec.floors[0].furniture[1]);
    expect(next.spec.floors[0].furniture[0].color).toBe("#abcdef");
});

test("room replacement touches only its own floor finish and furniture", () => {
    const base = scene();
    const next = applySceneLocalEdit(base, { kind: "room", floor: 0, room: "客厅" }, { floor: "marble", furniture: [{ type: "sofa-l", room: "客厅", at: "c", pos: [2, 2] }] });
    if (next.version !== 2) throw new Error("wrong version");
    expect(next.spec.floors[0].rooms[1]).toEqual(base.spec.floors[0].rooms[1]);
    expect(next.spec.floors[0].rooms[0].floor).toBe("marble");
    expect(next.spec.floors[0].furniture.find((item) => item.room === "卧室")).toEqual(base.spec.floors[0].furniture[1]);
});

test("rejects whole-scene responses, foreign rooms, invalid coordinates and deleted targets", () => {
    const base = scene(),
        target: SceneEditTarget = { kind: "furniture", floor: 0, index: 0 };
    for (const patch of [{ floors: [] }, { room: "卧室" }, { pos: [6, 2] }, { pos: [NaN, 2] }, { size: [-1, 2] }, { type: "invented" }, { color: "red" }, {}]) expect(() => applySceneLocalEdit(base, target, patch)).toThrow();
    expect(() => applySceneLocalEdit(base, { kind: "room", floor: 0, room: "客厅" }, { furniture: [{ type: "bed", room: "卧室", at: "c" }] })).toThrow();
    expect(() => applySceneLocalEdit(base, { kind: "furniture", floor: 0, index: 9 }, { color: "#abcdef" })).toThrow();
});

test("persisted target field ordering does not change its identity", () => {
    const target = JSON.parse('{"floor":0,"index":0,"kind":"furniture"}') as SceneEditTarget;
    expect(() => applySceneLocalEdit(scene(), target, { color: "#abcdef" })).not.toThrow();
    expect(buildSceneLocalEditPrompt(scene(), target, "换颜色")).toContain("沙发");
});

test("rotation, facing and anchor edits survive resource normalization without stale values", () => {
    const base = scene(),
        target: SceneEditTarget = { kind: "furniture", floor: 0, index: 0 };
    const rotated = applySceneLocalEdit(base, target, { rotate: 90 });
    if (rotated.version !== 2) throw new Error("wrong version");
    expect(rotated.spec.floors[0].furniture[0].facing).toBeUndefined();
    expect(normalizeSceneV2(JSON.parse(JSON.stringify(rotated))).spec.floors[0].furniture[0].rotate).toBe(90);
    const faced = applySceneLocalEdit(base, target, { facing: "w" });
    if (faced.version !== 2) throw new Error("wrong version");
    expect(faced.spec.floors[0].furniture[0].rotate).toBe(270);
    expect(normalizeSceneV2(JSON.parse(JSON.stringify(faced)))).toEqual(faced);
    const anchored = applySceneLocalEdit(base, target, { at: "s" });
    if (anchored.version !== 2) throw new Error("wrong version");
    expect(anchored.spec.floors[0].furniture[0].pos).toBeUndefined();
    expect(anchored.spec.floors[0].furniture[0].at).toBe("s");
});

test("furniture edits respect persisted grid, dimensions and orthogonal rotations", () => {
    const base = scene(),
        target: SceneEditTarget = { kind: "furniture", floor: 0, index: 0 };
    for (const patch of [{ rotate: 45 }, { size: [0.1, 2] }, { size: [7, 2] }]) expect(() => applySceneLocalEdit(base, target, patch)).toThrow();
    const next = applySceneLocalEdit(base, target, { pos: [2.03, 2.08], size: [2.21, 0.97], color: "#AABBCC" });
    if (next.version !== 2) throw new Error("wrong version");
    expect(next.spec.floors[0].furniture[0].pos).toEqual([2.05, 2.1]);
    expect(normalizeSceneV2(JSON.parse(JSON.stringify(next)))).toEqual(next);
});

test("legacy object edits preserve all other objects and labels", () => {
    const base = normalizeInteriorScene({
        title: "旧模型",
        objects: [
            { shape: "box", position: [0, 1, 0], size: [1, 2, 1], material: "wood" },
            { shape: "box", position: [3, 1, 0], size: [1, 2, 1], material: "wood" },
        ],
        labels: [{ text: "测试", position: [0, 3, 0] }],
    }).scene;
    const next = applySceneLocalEdit(base, { kind: "object", index: 0 }, { position: [1, 1, 0], color: "#abcdef" });
    if (next.version !== 1) throw new Error("wrong version");
    expect(next.objects[1]).toEqual(base.objects[1]);
    expect(next.labels).toEqual(base.labels);
    expect(next.objects[0].position).toEqual([1, 1, 0]);
});

test("scope selectors and bounds identify real rooms and furniture", () => {
    const base = scene();
    expect(sceneEditOptions(base)).toHaveLength(4);
    expect(sceneTargetBounds(base, { kind: "furniture", floor: 0, index: 0 })?.position[0]).toBe(2);
    expect(sceneTargetBounds(base, { kind: "room", floor: 0, room: "卧室" })?.size[0]).toBe(4);
});
