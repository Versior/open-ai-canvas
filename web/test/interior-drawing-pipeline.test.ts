import { expect, test } from "bun:test";
import { buildSceneAnalysisPrompt, normalizeSceneBrief } from "../src/lib/interior/scene-3d";
import { buildSceneSpecPrompt } from "../src/lib/interior/scene-spec";
import { applyDrawingFinishes, checkSceneCompletion } from "../src/lib/interior/scene-validation";
import { readPartialScene } from "../src/lib/interior/scene-stream";
import { compileSceneSpec } from "../src/lib/interior/scene-compile";
import { drawingBaselineBrief } from "../src/lib/interior/scene-drawing-baseline";

const options = { scope: "auto" as const, roomKeys: [], styleKeys: [], hasReference: true };
const reading = {
    source: "drawing",
    scope: "building",
    description: "单层户型，玄关连接东西两个房间，北侧房间独立。",
    size: { width: 8, depth: 6, floors: 1, storeyHeight: 3 },
    dimensionChains: { x: [3, 2, 3], z: [2, 4] },
    spaces: [{ name: "北侧储藏" }, { name: "西卧室" }, { name: "玄关" }, { name: "东客厅" }],
    layout: {
        grid: { source: "drawing", width: 8, depth: 6, x: [0, 3, 5, 8], z: [0, 2, 6], image: [100, 100, 900, 900] },
        floors: [
            {
                name: "一层",
                height: 3,
                rooms: [
                    { name: "北侧储藏", type: "storage", rect: [0, 0, 8, 2] },
                    { name: "西卧室", type: "bedroom", rect: [0, 2, 3, 6] },
                    { name: "玄关", type: "entry", rect: [3, 2, 5, 6] },
                    { name: "东客厅", type: "living", rect: [5, 2, 8, 6] },
                ],
                doors: [{ between: ["玄关", "西卧室"], at: 4, width: 0.9 }],
                open: [["玄关", "东客厅"]],
                windows: [],
                stairs: [],
                balconies: [],
                pillars: [],
                furniture: [],
            },
        ],
        roof: { type: "none" },
    },
};
const finishes = { title: "还原户型", floors: [{ name: "一层", rooms: [{ name: "西卧室", floor: "wood" }], furniture: [{ type: "sofa", room: "东客厅", pos: [6.5, 4], facing: "s" }] }] };

test("drawing reading must supply validated geometry, not only a room list", () => {
    expect(() => normalizeSceneBrief({ ...reading, layout: undefined }, options)).toThrow("房间坐标");
    expect(() => normalizeSceneBrief({ ...reading, layout: { ...reading.layout, floors: [{ ...reading.layout.floors[0], doors: [{ between: ["西卧室", "东客厅"] }] }] } }, options)).toThrow("没有共用墙");
    expect(() => normalizeSceneBrief({ ...reading, spaces: [...reading.spaces, { name: "消防电梯" }] }, options)).toThrow("漏掉");
    expect(() => normalizeSceneBrief({ ...reading, layout: { ...reading.layout, floors: [{ ...reading.layout.floors[0], stairs: { rect: [3, 2, 5, 6], up: "n" } }] } }, options)).toThrow("必须是数组");
});

test("finishing and reload preserve every accepted room, opening and coordinate", () => {
    const brief = normalizeSceneBrief(reading, options);
    expect(brief.scope).toBe("home");
    const savedBrief = JSON.parse(JSON.stringify(brief));
    const { spec, issues } = checkSceneCompletion(applyDrawingFinishes(finishes, savedBrief.layout), brief.scope);
    expect(issues).toEqual([]);
    const base = brief.layout!;
    expect(spec.grid).toEqual(base.grid);
    expect(spec.floors[0].rooms.map(({ floor: _floor, ...room }) => room)).toEqual(base.floors[0].rooms.map(({ floor: _floor, ...room }) => room));
    expect(spec.floors[0].doors).toEqual(base.floors[0].doors);
    expect(spec.floors[0].open).toEqual(base.floors[0].open);
    expect(spec.floors[0].rooms.find((room) => room.name === "西卧室")?.floor).toBe("wood");
    expect(spec.floors[0].furniture).toHaveLength(1);
    expect(() => applyDrawingFinishes({ ...finishes, grid: { width: 20 } }, base)).toThrow("不得重写");
    expect(() => applyDrawingFinishes({ floors: [{ ...finishes.floors[0], rooms: [{ name: "西卧室", rect: [0, 0, 20, 20] }] }] }, base)).toThrow("不得重排");
    expect(() => applyDrawingFinishes({ floors: [{ ...finishes.floors[0], rooms: [{ name: "虚构茶室" }] }] }, base)).toThrow("未知房间");
});

test("streaming finishes show the locked layout even before a room is written", () => {
    const base = normalizeSceneBrief(reading, options).layout!;
    const partial = readPartialScene('{"reading":["正在摆家具"],"floors":[{"name":"一层","rooms":', "home", base);
    expect(partial.spec?.floors[0].rooms).toEqual(base.floors[0].rooms);
    expect(partial.spec?.grid).toEqual(base.grid);
});

test("material-only finishing preserves original furniture anchors and streaming furniture", () => {
    const base = checkSceneCompletion(applyDrawingFinishes(finishes, normalizeSceneBrief(reading, options).layout!), "home").spec;
    const materials = { floors: [{ name: "一层", rooms: [{ name: "西卧室", floor: "tile" }] }] };
    expect(checkSceneCompletion(applyDrawingFinishes(materials, base), "home").spec.floors[0].furniture).toEqual(base.floors[0].furniture);
    expect(readPartialScene(JSON.stringify(materials), "home", base).spec?.floors[0].furniture).toEqual(base.floors[0].furniture);
    expect(() => applyDrawingFinishes({ floors: [{ ...materials.floors[0], furniture: null }] }, base)).toThrow("家具数组");
    expect(applyDrawingFinishes({ floors: [{ ...materials.floors[0], furniture: [] }] }, base).floors[0].furniture).toEqual([]);
});

test("drawing geometry does not invent doors or default furniture", () => {
    const base = normalizeSceneBrief(reading, options).layout!;
    const drawing = compileSceneSpec(base);
    expect(drawing.objects.some((object) => object.material === "fabric")).toBe(false);
    const invented = compileSceneSpec({ ...base, grid: { ...base.grid!, source: "text" } });
    expect(invented.objects.filter((object) => object.shape === "wall").flatMap((object) => object.openings || []).length).toBeGreaterThan(drawing.objects.filter((object) => object.shape === "wall").flatMap((object) => object.openings || []).length);
});

test("analysis and finishing prompts have distinct structural responsibilities", () => {
    expect(buildSceneAnalysisPrompt({ scope: "auto", description: "", hasReference: true, rooms: [], styles: [] })).toContain("额外输出 layout");
    const brief = normalizeSceneBrief(reading, options);
    const prompt = buildSceneSpecPrompt({ scope: brief.scope, description: "", hasReference: true, brief });
    expect(prompt).toContain("只补充材质和家具");
    expect(prompt).toContain(JSON.stringify(brief.layout));
    expect(prompt).not.toContain("两室两厅");
    expect(prompt).not.toContain("拼成完整的平面");
    expect(prompt).not.toContain("以附图为准");
    expect(prompt).not.toContain("grid 的总尺寸必须");
});

test("drawing acceptance rejects outdoor duplication, misplaced windows and a missing perimeter strip", () => {
    const base = normalizeSceneBrief(reading, options).layout!;
    const duplicateOutdoor = { ...base, floors: [{ ...base.floors[0], balconies: [{ name: "错误庭院", rect: [5, 2, 8, 6], surface: "stone", rail: "none" }] }] };
    expect(checkSceneCompletion(duplicateOutdoor, "home").issues.join("；")).toContain("户外空间");
    expect(checkSceneCompletion({ ...base, floors: [{ ...base.floors[0], windows: [{ room: "东客厅", side: "e", at: 7, width: 2 }] }] }, "home").issues.join("；")).toContain("窗洞超出");
    expect(checkSceneCompletion({ ...base, grid: { ...base.grid, width: 8.3 } }, "home").issues.join("；")).toContain("总尺寸");
});

test("a public stair in a single-storey drawing is not lost without a second floor", () => {
    const base = normalizeSceneBrief(reading, options).layout!;
    const withStair = { ...base, floors: [{ ...base.floors[0], stairs: [{ rect: [0.2, 0.2, 3.8, 1.5] as [number, number, number, number], up: "e" as const }] }] };
    const count = (spec: typeof base, cutFloor?: number) => compileSceneSpec(spec, { cutFloor }).objects.filter((object) => object.texture === "grain").length;
    expect(count(withStair)).toBeGreaterThan(count(base));
    expect(count(withStair, 0)).toBeGreaterThan(count(base, 0));
});

test("narrow service spaces survive drawing acceptance and reload", () => {
    const floor = reading.layout.floors[0];
    const measured = {
        ...reading,
        spaces: [...reading.spaces, { name: "水井" }, { name: "东走道" }],
        layout: {
            ...reading.layout,
            grid: { ...reading.layout.grid, x: [0, 3, 5, 7.4, 8] },
            floors: [
                {
                    ...floor,
                    rooms: [
                        { ...floor.rooms[0], rect: [0, 0, 7.4, 2] },
                        ...floor.rooms.slice(1, 3),
                        { ...floor.rooms[3], rect: [5, 2, 7.4, 6] },
                        { name: "水井", type: "other", rect: [7.4, 0, 8, 2] },
                        { name: "东走道", type: "corridor", rect: [7.4, 2, 8, 6] },
                    ],
                },
            ],
        },
    };
    const brief = normalizeSceneBrief(measured, options);
    const { spec, issues } = checkSceneCompletion(JSON.parse(JSON.stringify(brief.layout)), "home");
    expect(issues).toEqual([]);
    expect(spec.floors[0].rooms.find((room) => room.name === "水井")?.rect).toEqual([7.4, 0, 8, 2]);
    expect(spec.floors[0].rooms.find((room) => room.name === "东走道")?.rect).toEqual([7.4, 2, 8, 6]);
});

test("L-shaped rooms retain their family and connecting doors after reload", () => {
    const floor = reading.layout.floors[0];
    const measured = {
        ...reading,
        spaces: [...reading.spaces, { name: "东储藏" }],
        layout: {
            ...reading.layout,
            grid: { ...reading.layout.grid, x: [0, 3, 5, 6, 8], z: [0, 2, 4, 6] },
            floors: [
                {
                    ...floor,
                    rooms: [
                        ...floor.rooms.slice(0, 3),
                        {
                            name: "东客厅",
                            type: "living",
                            rects: [
                                [5, 2, 8, 4],
                                [6, 4, 8, 6],
                            ],
                        },
                        { name: "东储藏", type: "storage", rect: [5, 4, 6, 6] },
                    ],
                    doors: [...floor.doors, { between: ["东客厅", "东储藏"], at: 5, width: 0.8 }],
                },
            ],
        },
    };
    const base = normalizeSceneBrief(measured, options).layout!;
    const reload = checkSceneCompletion(JSON.parse(JSON.stringify(base)), "home");
    expect(reload.issues).toEqual([]);
    expect(reload.spec).toEqual(base);
});

test("approved drawing structure bypasses geometry regeneration but remains validated", () => {
    const spec = normalizeSceneBrief(reading, options).layout!;
    const scene = { version: 2 as const, title: spec.title, summary: spec.summary, spec };
    const brief = drawingBaselineBrief(scene, "只换木地板");
    expect(brief.layout).toEqual(spec);
    expect(brief.spaces.map((room) => room.name)).toEqual(reading.spaces.map((room) => room.name));
    expect(brief.size).toMatchObject({ width: 8, depth: 6 });
    expect(buildSceneSpecPrompt({ scope: brief.scope, description: brief.description, hasReference: true, brief })).toContain("只补充材质和家具");
    expect(buildSceneSpecPrompt({ scope: brief.scope, description: brief.description, hasReference: true, brief })).toContain("唯一可用房间名单");
    expect(() => drawingBaselineBrief({ ...scene, spec: { ...spec, grid: { ...spec.grid!, source: "text" } } }, "")).toThrow("结构基准");
    expect(() => drawingBaselineBrief({ ...scene, spec: { ...spec, floors: [{ ...spec.floors[0], doors: [{ between: ["西卧室", "东客厅"] }] }] } }, "")).toThrow("没有共用墙");
});
