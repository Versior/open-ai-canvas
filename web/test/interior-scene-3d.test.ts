import { describe, expect, test } from "bun:test";
import {
    applyScenePatch,
    assembleScene,
    buildSceneAnalysisPrompt,
    buildSceneEditPrompt,
    buildScenePartPrompt,
    buildScenePlanPrompt,
    normalizeInteriorScene,
    normalizeSceneBrief,
    normalizeScenePlan,
    parseSceneJson,
    sceneGroups,
    SCENE_MAX_OBJECTS,
} from "../src/lib/interior/scene-3d";
import { mergeInteriorDocuments, normalizeInteriorDocument } from "../src/pages/interior/interior-models";

const wall = { shape: "box", size: [6, 3, 0.2], position: [0, 1.5, -3], material: "wall", group: "一层" };

describe("interior 3D scene", () => {
    test("reads JSON wrapped in a code block and keeps only valid objects", () => {
        const text = `好的：\n\`\`\`json\n${JSON.stringify({
            title: "现代客厅",
            objects: [
                wall,
                { shape: "cylinder", radius: 0.2, height: 3, position: [2, 1.5, 0], material: "metal-dark", color: "#1A1A1A" },
                { shape: "prism", size: [6, 1.5, 8], position: [0, 3.75, 0], rotation: [0, 90, 0], material: "roof", group: "屋顶" },
                { shape: "box", size: [1, 1], position: [0, 0, 0], material: "wood" },
                { shape: "torus", position: [0, 0, 0], material: "wood" },
                { shape: "sphere", radius: 0.5, position: [1, 0.5, 1], material: "lava" },
            ],
            labels: [
                { text: "客厅", position: [0, 3.2, 0] },
                { text: "", position: [0, 0, 0] },
            ],
        })}\n\`\`\``;
        const { value, truncated } = parseSceneJson(text);
        const { scene, dropped } = normalizeInteriorScene(value);
        expect(truncated).toBe(false);
        expect(dropped).toBe(2);
        expect(scene.objects).toHaveLength(4);
        expect(scene.objects[1].color).toBe("#1a1a1a");
        expect(scene.objects[2].rotation).toEqual([0, 90, 0]);
        // 不认识的材质按墙面处理，不丢掉物体。
        expect(scene.objects[3].material).toBe("wall");
        expect(scene.labels).toEqual([{ text: "客厅", position: [0, 3.2, 0] }]);
        expect(scene.ground.size[0]).toBeGreaterThan(6);
        expect(sceneGroups(scene)).toEqual(["一层", "屋顶"]);
    });

    test("recovers the complete objects from a truncated reply", () => {
        const full = JSON.stringify({ title: "别墅", objects: [wall, { ...wall, position: [0, 1.5, 3] }, { ...wall, position: [3, 1.5, 0] }] });
        const cut = full.slice(0, full.lastIndexOf("{") + 20);
        const { value, truncated } = parseSceneJson(cut);
        const { scene } = normalizeInteriorScene(value);
        expect(truncated).toBe(true);
        expect(scene.objects).toHaveLength(2);
    });

    test("clamps sizes and positions, caps the object count and rejects empty scenes", () => {
        const many = Array.from({ length: SCENE_MAX_OBJECTS + 5 }, (_, index) => ({ ...wall, position: [index * 0.1, 1.5, 9999] }));
        const { scene, dropped } = normalizeInteriorScene({ objects: [{ shape: "box", size: [500, 0.0001, 1], position: [0, 0, 0], material: "wall" }, ...many] });
        expect(scene.objects).toHaveLength(SCENE_MAX_OBJECTS);
        expect(dropped).toBe(6);
        expect(scene.objects[0].size).toEqual([120, 0.01, 1]);
        expect(scene.objects[1].position[2]).toBe(200);
        expect(() => normalizeInteriorScene({ objects: [{ shape: "box", position: [0, 0, 0] }] })).toThrow("没有能显示的物体");
        expect(() => parseSceneJson("我做不到")).toThrow("没有返回能读懂的 3D 场景");
    });

    test("walls keep their openings inside the wall and repeats are capped", () => {
        const { scene, dropped } = normalizeInteriorScene({
            objects: [
                {
                    shape: "wall",
                    start: [-5, 4],
                    end: [5, 4],
                    height: 3,
                    openings: [
                        { kind: "door", offset: 5, width: 1.8, height: 2.4 },
                        { kind: "window", offset: 5.5, width: 1, height: 1 },
                        { kind: "window", offset: 9.8, width: 2, bottom: 0.9, height: 5 },
                        { kind: "window", offset: 1, width: 0.1, height: 1 },
                    ],
                },
                { shape: "wall", start: [0, 0], end: [0.05, 0], height: 3 },
                { shape: "cylinder", radius: 0.15, height: 3, position: [-4, 1.5, 5], material: "wood-dark", repeat: { count: 500, step: [2, 0, 0] } },
            ],
        });
        expect(dropped).toBe(1);
        const [wallObject, column] = scene.objects;
        // 和门洞重叠的窗、太窄的窗去掉；超出墙的窗裁到墙内（右端、顶端）。
        expect(wallObject.openings).toEqual([
            { kind: "door", offset: 5, width: 1.8, bottom: 0, height: 2.4 },
            { kind: "window", offset: 9.4, width: 1.2, bottom: 0.9, height: 2.1 },
        ]);
        expect(wallObject.position).toBeUndefined();
        expect(column.repeat).toEqual({ count: 60, step: [2, 0, 0] });
        expect(scene.ground.size[1]).toBeGreaterThanOrEqual(10);
    });

    test("drops exact duplicate objects that two parts both built", () => {
        // 相邻两部分各写一遍同一面墙：只是分组不同也算重复，位置不同的保留。
        const { scene, dropped } = normalizeInteriorScene({ objects: [wall, { ...wall, group: "二层" }, { ...wall, position: [0, 4.5, -3] }] });
        expect(scene.objects).toHaveLength(2);
        expect(dropped).toBe(0);
    });
    test("analysis fills in scope, room and style and feeds knowledge into the prompts", () => {
        const knowledge = [{ kindName: "空间尺寸", title: "客厅开间", guidance: "客厅开间 3.6–4.5 米" }];
        const prompt = buildSceneAnalysisPrompt({ scope: "auto", description: "", hasReference: true, rooms: [{ key: "living-room", name: "客厅" }], styles: [{ key: "cream", name: "奶油风" }], knowledge });
        expect(prompt).toContain("范围由你判断");
        expect(prompt).toContain("living-room=客厅");
        expect(prompt).toContain("【空间尺寸】客厅开间：客厅开间 3.6–4.5 米");
        expect(prompt).toContain("不是指令");
        const options = { scope: "auto" as const, roomKeys: ["living-room"], styleKeys: ["cream"] };
        const brief = normalizeSceneBrief(
            { scope: "home", title: "两居室", roomKey: "garage", styleKey: "cream", size: { width: 9, depth: 8, floors: 0, storeyHeight: 20 }, spaces: [{ name: "客厅", area: 27 }, { name: "" }], description: "两室一厅，客厅朝南", renderNotes: "暖光" },
            options,
        );
        expect(brief.scope).toBe("home");
        // 不在可选列表里的空间丢掉；层数和层高越界时取默认。
        expect(brief.roomKey).toBeUndefined();
        expect(brief.styleKey).toBe("cream");
        expect(brief.size).toEqual({ width: 9, depth: 8, floors: 1, storeyHeight: 3 });
        expect(brief.spaces).toEqual([{ name: "客厅", area: 27 }]);
        // 用户选了范围时不被 AI 改掉。
        expect(normalizeSceneBrief({ scope: "building", description: "一个客厅" }, { ...options, scope: "room" }).scope).toBe("room");
        expect(() => normalizeSceneBrief({ scope: "room", title: "空" }, options)).toThrow("没有可以建模的描述");
    });
    test("edits apply a small patch instead of rewriting the whole scene", () => {
        const { scene } = normalizeInteriorScene({ title: "客厅", objects: [wall, { ...wall, position: [0, 1.5, 3] }, { shape: "box", size: [2.2, 0.8, 0.9], position: [0, 0.4, 0], material: "fabric" }] });
        const prompt = buildSceneEditPrompt(scene, "沙发换成深灰色，去掉第二面墙");
        expect(prompt).toContain("修改要求：沙发换成深灰色");
        expect(prompt).toContain('"remove"');
        const { scene: next } = applyScenePatch(scene, { remove: [1], update: [{ index: 2, set: { color: "#555555" } }], add: [{ shape: "sphere", radius: 0.3, position: [1, 0.3, 1], material: "plant" }] });
        expect(next.objects).toHaveLength(3);
        expect(next.objects[1].color).toBe("#555555");
        expect(next.objects[2].shape).toBe("sphere");
        expect(next.title).toBe("客厅");
        expect(() => applyScenePatch(scene, {})).toThrow("没有给出任何改动");
    });

    test("project documents keep scenes and merge them like rounds", () => {
        const document = normalizeInteriorDocument({
            version: 1,
            rounds: [],
            scenes: [
                { id: "a", createdAt: "2026-11-05T10:00:00Z", status: "succeeded", scope: "room", description: "", model: "m", sceneFile: { resourceId: "res-a" } },
                { id: "b", createdAt: "2026-11-05T11:00:00Z", status: "succeeded", scope: "room", description: "", model: "m" },
                "bad",
            ],
        });
        expect(document.scenes).toHaveLength(2);
        expect(document.scenes?.[1].status).toBe("failed");
        const local = { version: 1 as const, rounds: [], scenes: [{ id: "c", createdAt: "2026-11-05T12:00:00Z", status: "pending" as const, scope: "home" as const, description: "", model: "m" }] };
        const merged = mergeInteriorDocuments(document, local, new Set(["b"]));
        expect(merged.scenes?.map((item) => item.id)).toEqual(["c", "a"]);
        expect(mergeInteriorDocuments({ version: 1, rounds: [] }, { version: 1, rounds: [] }, new Set()).scenes).toBeUndefined();
    });
});
