import { describe, expect, test } from "bun:test";
import { checkSceneCompletion } from "../src/lib/interior/scene-validation";
import { normalizeSceneBrief } from "../src/lib/interior/scene-3d";
import { compileSceneSpec } from "../src/lib/interior/scene-compile";

const plan = {
    grid: { source: "drawing", width: 8, depth: 4, x: [0, 4, 8], z: [0, 4] },
    floors: [
        {
            rooms: [
                { name: "客厅", rect: [0, 0, 4, 4] },
                { name: "卧室", rect: [4, 0, 8, 4] },
            ],
            doors: [{ between: ["客厅", "卧室"], at: 2, width: 0.9 }],
        },
    ],
};

describe("completed interior model acceptance", () => {
    test("a reference image cannot skip source detection and drawing geometry by omitting source", () => {
        const failedReading = { scope: "building", description: "315㎡CAD大平层，北侧电梯厅，外包尺寸30.3m×15.6m", size: { width: 30.3, depth: 15.6 }, spaces: [{ name: "户内空间主体" }] };
        const options = { scope: "auto" as const, roomKeys: [], styleKeys: [], hasReference: true };
        expect(() => normalizeSceneBrief(failedReading, options)).toThrow("来源");
    });
    test("accepts a complete adjacent plan", () => {
        expect(checkSceneCompletion(plan, "home").issues).toEqual([]);
    });
    test("does not silently drop a stair room contained in an elevator hall", () => {
        const floor = {
            rooms: [
                { name: "电梯厅", rect: [0, 0, 12.3, 3.5] },
                { name: "楼梯间", rect: [0, 0, 7.3, 3.5] },
            ],
        };
        expect(checkSceneCompletion({ floors: [floor] }, "home").issues.join(";")).toContain("房间被丢弃");
    });
    test("rejects a door between rooms that only meet at a corner", () => {
        const rooms = [
            { name: "客厅", rect: [0, 0, 4, 4] },
            { name: "卧室", rect: [4, 4, 8, 8] },
        ];
        expect(checkSceneCompletion({ floors: [{ rooms, doors: [{ between: ["客厅", "卧室"] }] }] }, "home").issues.join(";")).toContain("没有共用墙");
    });
    test("rejects incorrect door centers and overlapping rooms", () => {
        expect(checkSceneCompletion({ ...plan, floors: [{ ...plan.floors[0], doors: [{ between: ["客厅", "卧室"], at: 8 }] }] }, "home").issues.join(";")).toContain("门洞超出");
        const rooms = [
            { name: "客厅", rect: [0, 0, 4, 4] },
            { name: "卧室", rect: [3, 0, 7, 4] },
        ];
        expect(checkSceneCompletion({ floors: [{ rooms }] }, "home").issues.join(";")).toContain("房间重叠");
    });
    test("rejects truncated results, dimension loss and spaces missing from the reading", () => {
        expect(checkSceneCompletion(plan, "home", { truncated: true }).issues.join(";")).toContain("截断");
        expect(checkSceneCompletion({ ...plan, grid: { ...plan.grid, depth: 5 } }, "home").issues.join(";")).toContain("总尺寸");
        expect(checkSceneCompletion(plan, "home", { spaces: [{ name: "楼梯间" }] }).issues.join(";")).toContain("漏掉");
    });
    test("detects explicit furniture collisions and blocked door approaches", () => {
        const rooms = [{ name: "客厅", rect: [0, 0, 5, 5] }];
        const furniture = [
            { type: "sofa", room: "客厅", pos: [2.5, 2.5] },
            { type: "coffee-table", room: "客厅", pos: [2.5, 2.5] },
        ];
        expect(checkSceneCompletion({ floors: [{ rooms, furniture }] }, "room").issues.join(";")).toContain("冲突");
        const doors = [{ room: "客厅", side: "s", at: 2.5, width: 1 }];
        expect(checkSceneCompletion({ floors: [{ rooms, doors, furniture: [{ type: "sofa", room: "客厅", pos: [2.5, 4.5] }] }] }, "room").issues.join(";")).toContain("门前通道");
    });
    test("checks independent drawing dimension chains before modeling", () => {
        const brief = { source: "drawing", description: "原图大平层", size: { width: 30.3, depth: 15 }, dimensionChains: { x: [0.6, 3.7, 2.3, 4.2, 3.7, 3.7, 3.7, 3.9, 4.5], z: [1.2, 3.4, 3, 5.6, 1.8] } };
        const options = { scope: "home" as const, roomKeys: [], styleKeys: [] };
        expect(normalizeSceneBrief(brief, options).size?.depth).toBe(15);
        expect(() => normalizeSceneBrief({ ...brief, size: { width: 30.3, depth: 15.6 } }, options)).toThrow("尺寸链不一致");
        expect(checkSceneCompletion(plan, "home", { size: { width: 8, depth: 5 } }).issues.join(";")).toContain("读图校核");
    });
    test("keeps named terraces and rooftop pools outside enclosed rooms", () => {
        const balconies = [{ name: "泳池", rect: [8, 0, 10, 4], rail: "none", surface: "water" }];
        const value = { ...plan, grid: { ...plan.grid, width: 10 }, floors: [{ ...plan.floors[0], balconies }] };
        const { spec, issues } = checkSceneCompletion(value, "home", { spaces: [{ name: "泳池" }] });
        expect(issues).toEqual([]);
        const rendered = compileSceneSpec(spec);
        expect(rendered.objects.some((object) => object.material === "water")).toBe(true);
        expect(rendered.labels.some((label) => label.text === "泳池")).toBe(true);
    });
});
