import { expect, test } from "bun:test";
import { normalizeSceneSpec } from "@/lib/interior/scene-spec";
import { compileSceneSpec } from "@/lib/interior/scene-compile";
import { DESIGN_LAYERS, designObjects, designQuantities, emptyDesignPlan, floorPlanElements, offlinePlanHtml, planDxf, validateDesignPlan } from "@/lib/interior/design-plan";
import { canWalk, moveWalk, walkStart } from "@/lib/interior/scene-walk";
import { interiorDeliveryFiles } from "@/lib/interior/scene-delivery";
import { normalizeInteriorDocument, mergeInteriorDocuments } from "@/pages/interior/interior-models";
import { readPartialScene } from "@/lib/interior/scene-stream";

const spec = () =>
    normalizeSceneSpec(
        {
            title: "合成测试户型",
            scope: "home",
            grid: { source: "drawing", width: 8, depth: 4, x: [0, 4, 8], z: [0, 4] },
            floors: [
                {
                    name: "测试层",
                    height: 3,
                    rooms: [
                        { name: "客厅<测试>", type: "living", rect: [0, 0, 4, 4], floor: "wood" },
                        { name: "书房", type: "study", rect: [4, 0, 8, 4], floor: "tile" },
                    ],
                    doors: [{ between: ["客厅<测试>", "书房"], at: 2, width: 1, into: "书房", kind: "door" }],
                    windows: [{ room: "客厅<测试>", side: "n", at: 2, width: 1.2 }],
                    furniture: [{ type: "sofa", room: "客厅<测试>", at: "n", pos: [2, 0.8], size: [2, 0.9] }],
                },
            ],
            roof: { type: "none" },
        },
        "home",
    );

test("2D doors and furniture use the actual compiled 3D coordinates, without mutating the source", () => {
    const source = spec(),
        before = JSON.stringify(source),
        model = compileSceneSpec(source),
        plan = model.plans[0];
    const furniture = plan.furniture.find((f) => f.index === 0)!;
    expect(furniture.type).toBe("sofa");
    const shape = floorPlanElements(source, plan, "layout").find((e) => e.kind === "polygon" && e.furniture === 0)!;
    if (shape.kind !== "polygon") throw new Error("missing furniture");
    expect(shape.points.reduce((s, p) => s + p[0], 0) / 4).toBeCloseTo(furniture.x);
    expect(shape.points.reduce((s, p) => s + p[1], 0) / 4).toBeCloseTo(furniture.z);
    const door = plan.walls.flatMap((w) => w.holes).find((h) => h.kind === "door");
    expect(door?.center).toBe(2);
    expect(floorPlanElements(source, plan, "layout").some((e) => e.layer === "DOORS")).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
});

test("walk crosses actual doorways but stops at walls, furniture, boundaries and large frame deltas", () => {
    const source = spec(),
        floor = source.floors[0],
        plan = compileSceneSpec(source).plans[0];
    expect(walkStart(floor, plan)).not.toBeNull();
    expect(canWalk([4, 2], floor, plan)).toBe(true);
    expect(canWalk([4, 0.6], floor, plan)).toBe(false);
    expect(canWalk([2, 0.8], floor, plan)).toBe(false);
    expect(moveWalk([3, 2], [2, 0], floor, plan)[0]).toBeCloseTo(5);
    expect(moveWalk([3, 0.6], [10, 0], floor, plan)[0]).toBeLessThan(4);
    expect(canWalk([-0.2, 2], floor, plan)).toBe(false);
});

test("net floor takeoff excludes walls; missing prices never become a zero quotation", () => {
    const source = spec(),
        design = emptyDesignPlan(),
        rows = designQuantities(source, design);
    const floor = rows.find((r) => r.key === "0:floor:wood")!;
    expect(floor.quantity).toBeLessThan(16);
    expect(floor.quantity).toBeGreaterThan(13);
    expect(floor.total).toBeNull();
    design.prices[floor.key] = { material: 100, labor: 20, waste: 10 };
    const quoted = designQuantities(source, design).find((r) => r.key === floor.key)!;
    expect(quoted.purchase).toBeCloseTo(Math.round(quoted.quantity * 1.1 * 100) / 100, 1);
    expect(quoted.total).toBeCloseTo(Math.round((quoted.purchase * 100 + quoted.quantity * 20) * 100) / 100, 1);
    design.prices[floor.key] = { material: 0, labor: 0, waste: 0 };
    expect(designQuantities(source, design).find((r) => r.key === floor.key)?.total).toBe(0);
});

test("invalid prices, nonfinite positions, foreign floors and self crossing contours cannot be saved", () => {
    const source = spec();
    expect(() => validateDesignPlan({ ...emptyDesignPlan(), budget: -1 }, source)).toThrow();
    expect(() => validateDesignPlan({ ...emptyDesignPlan(), prices: { x: { material: -10, labor: null, waste: 0 } } }, source)).toThrow();
    const mark = {
        id: "fixture-shape",
        floor: 0,
        layer: "custom" as const,
        label: "合成定制",
        points: [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
        ] as [number, number][],
        height: 0.2,
        depth: 0.5,
        closed: true,
    };
    const design = { ...emptyDesignPlan(), marks: [mark] };
    expect(designObjects(source, design)[0].shape).toBe("extrude");
    expect(designObjects(source, design)[0].depth).toBe(0.5);
    expect(canWalk([1.5, 1.5], source.floors[0], compileSceneSpec(source).plans[0], design.marks)).toBe(false);
    expect(() =>
        validateDesignPlan(
            {
                ...design,
                marks: [
                    {
                        ...mark,
                        points: [
                            [1, 1],
                            [2, 2],
                            [1, 2],
                            [2, 1],
                        ],
                    },
                ],
            },
            source,
        ),
    ).toThrow();
    expect(() => validateDesignPlan({ ...design, marks: [{ ...mark, floor: 99 }] }, source)).toThrow();
    expect(() =>
        validateDesignPlan(
            {
                ...design,
                marks: [
                    {
                        ...mark,
                        points: [
                            [NaN, 1],
                            [2, 1],
                            [2, 2],
                        ],
                    },
                ],
            },
            source,
        ),
    ).toThrow();
});

test("preserve furnishing also keeps streaming preview on the confirmed structure", () => {
    const source = spec();
    const text = JSON.stringify({ scope: "home", floors: [{ name: "测试层", furniture: [{ type: "bed", room: "书房", at: "c" }] }] });
    const preview = readPartialScene(text, "home", source, true);
    expect(preview.spec?.floors[0].furniture).toEqual(source.floors[0].furniture);
    expect(preview.spec?.grid).toEqual(source.grid);
});

test("DXF uses millimetres, UTF-8 text and real editable entities; offline HTML is self contained", () => {
    const source = spec(),
        plan = compileSceneSpec(source).plans[0],
        dxf = planDxf(source, plan, "layout");
    expect(dxf).toContain("$INSUNITS\r\n70\r\n4");
    expect(dxf).toContain("LWPOLYLINE");
    expect(dxf).toContain("客厅<测试>");
    expect(dxf).toContain("DIMENSIONS");
    expect(dxf).toContain("DOORS");
    const html = offlinePlanHtml({ ...source, title: "</script><script>fake()</script>" });
    expect(html).not.toContain("<script>fake()");
    expect(html).not.toMatch(/src=["']https?:/);
    expect(html).toContain("&lt;/script&gt;");
    const files = interiorDeliveryFiles(source);
    expect(files.some((f) => f.name.endsWith(".dxf"))).toBe(true);
    expect(files.some((f) => f.name === "离线方案.html")).toBe(true);
    expect(files.some((f) => f.name === "工程量与报价.csv")).toBe(true);
    expect(Object.keys(DESIGN_LAYERS)).toContain("demolition");
});

test("design layers persist and independently edited marks and quotes survive project conflict merging", () => {
    const design = emptyDesignPlan();
    const entry = { id: "scene", createdAt: "2026-01-01", status: "succeeded" as const, scope: "home" as const, model: "fixture", description: "fixture", sceneFile: { resourceId: "fixture-resource" }, design };
    const base = normalizeInteriorDocument({ version: 1, rounds: [], scenes: [entry] });
    const remote = structuredClone(base),
        local = structuredClone(base);
    remote.scenes![0].design!.prices.a = { material: 20, labor: 10, waste: 0 };
    local.scenes![0].design!.budget = 1000;
    const merged = mergeInteriorDocuments(remote, local, new Set(), base);
    expect(merged.scenes![0].design!.prices.a.material).toBe(20);
    expect(merged.scenes![0].design!.budget).toBe(1000);
});
