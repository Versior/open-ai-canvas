import { describe, expect, test } from "bun:test";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { compilePackaging } from "../src/lib/packaging/geometry";
import { gridPackagingSheet, nestPackagingSheet, sheetPoint, verifyPackagingSheet, type NestingResponse } from "../src/lib/packaging/nesting";
import { packagingSheetDxf, packagingSheetPdf, packagingSheetSvg } from "../src/lib/packaging/sheet-export";
import { newPackagingDocument, type PackagingLayout, type PackagingStructure, type Point } from "../src/lib/packaging/types";
import type { SheetOptions } from "../src/lib/packaging/production";

const cross: Point[] = [
    [30, 0],
    [70, 0],
    [70, 30],
    [100, 30],
    [100, 70],
    [70, 70],
    [70, 100],
    [30, 100],
    [30, 70],
    [0, 70],
    [0, 30],
    [30, 30],
];
const layout: PackagingLayout = {
    panels: [],
    parts: [],
    cuts: [cross],
    creases: [
        [
            [30, 30],
            [70, 30],
        ],
    ],
    bleed: [],
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    dimensions: [],
    areaMm2: 6400,
    warnings: [],
};
const options: SheetOptions = { width: 310, height: 310, margin: 5, gripper: 0, gap: 3, rotation: "auto", quantity: 100, spoilage: 3, pricePerSheet: 0 };
const document = newPackagingDocument(
    {
        id: "tuck",
        name: "双插盒",
        category: "折叠盒",
        structure: "tuck",
        enabled: true,
        description: "",
        defaults: { length: 120, width: 60, height: 80, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 30, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 },
    },
    { id: "card", name: "白卡", enabled: true, color: "#ffffff", insideColor: "#eeeeee", thickness: 0.45, roughness: 0.65, metalness: 0 },
);

function segmentDistance(p: Point, a: Point, b: Point) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function checkDistances(paths: Point[][][], gap: number) {
    for (let i = 0; i < paths.length; i++)
        for (let j = 0; j < i; j++) {
            const distances = paths[i].flatMap((a) => paths[j].flatMap((b) => a.flatMap((p, index) => b.flatMap((q, other) => [segmentDistance(p, q, b[(other + 1) % b.length]), segmentDistance(q, p, a[(index + 1) % a.length])]))));
            expect(Math.min(...distances)).toBeGreaterThanOrEqual(gap - 0.003);
        }
}

describe("完整刀版轮廓排料", () => {
    test("真实凹形比网格多放，独立测量全部轮廓间距", () => {
        const plan = nestPackagingSheet(layout, options, 2000);
        expect(plan.gridCount).toBe(4);
        expect(plan.placements.length).toBe(8);
        expect(plan.stop).toBe("complete");
        checkDistances(
            plan.placements.map((placement) => [cross.map((point) => sheetPoint(point, layout.bounds, placement))]),
            3,
        );
        expect(() => verifyPackagingSheet(layout, options, plan.placements)).not.toThrow();
    });
    test("固定方向、负坐标和恰好满纸的边界接触", () => {
        const rectangle: PackagingLayout = {
            ...layout,
            cuts: [
                [
                    [13, -7],
                    [113, -7],
                    [113, 73],
                    [13, 73],
                ],
            ],
            creases: [],
            bounds: { x: 13, y: -7, width: 100, height: 80 },
            areaMm2: 8000,
        };
        for (const rotation of ["0", "90"] as const) {
            const sheet = { ...options, width: 200, height: 200, margin: 0, gap: 0, rotation };
            const plan = nestPackagingSheet(rectangle, sheet, 2000);
            expect(plan.placements.length).toBeGreaterThanOrEqual(4);
            expect(plan.placements.every((placement) => String(placement.rotation) === rotation)).toBe(true);
            expect(() => verifyPackagingSheet(rectangle, sheet, plan.placements)).not.toThrow();
        }
        expect(nestPackagingSheet(rectangle, { ...options, width: 100, height: 100, margin: 15 }, 100).placements).toEqual([]);
    });
    test("十二结构、开窗与复合部件均保留完整一套，出血不会越界", () => {
        for (const structure of ["tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"] satisfies PackagingStructure[]) {
            const box = compilePackaging({ ...document, template: { ...document.template, structure } });
            const sheet = { ...options, width: 700, height: 1000, margin: 10, gripper: 15 };
            const plan = nestPackagingSheet(box, sheet, 100);
            expect(plan.placements.length).toBeGreaterThanOrEqual(plan.gridCount);
            expect(() => verifyPackagingSheet(box, sheet, plan.placements)).not.toThrow();
            for (const placement of plan.placements)
                for (const point of box.bleed.flat()) {
                    const [x, y] = sheetPoint(point, box.bounds, placement);
                    expect(x).toBeGreaterThanOrEqual(10 - 0.001);
                    expect(y).toBeGreaterThanOrEqual(25 - 0.001);
                    expect(x).toBeLessThanOrEqual(690 + 0.001);
                    expect(y).toBeLessThanOrEqual(990 + 0.001);
                }
        }
        const windowed = compilePackaging({ ...document, parameters: { ...document.parameters, windowWidth: 50, windowHeight: 30 } });
        const sheet = { ...options, width: 700, height: 1000 };
        const plan = nestPackagingSheet(windowed, sheet, 500);
        const svg = packagingSheetSvg("开窗", windowed, sheet, plan);
        const cut = svg.match(/<g id="CUT"[^>]*>(.*?)<\/g>/)![1];
        expect((cut.match(/<path /g) ?? []).length).toBe(windowed.cuts.length * plan.placements.length);
        const hole: PackagingLayout = {
            ...layout,
            cuts: [
                [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                    [0, 100],
                ],
                [
                    [10, 10],
                    [90, 10],
                    [90, 90],
                    [10, 90],
                ],
            ],
            bleed: [
                [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                    [0, 100],
                ],
            ],
        };
        expect(() =>
            verifyPackagingSheet(hole, { ...options, gap: 0 }, [
                { x: 5, y: 5, rotation: 0 },
                { x: 15, y: 15, rotation: 0 },
            ]),
        ).toThrow("重叠");
        const compound = compilePackaging({ ...document, template: { ...document.template, structure: "book" } });
        expect(compound.parts.length).toBeGreaterThan(1);
        const compoundPlan = nestPackagingSheet(compound, sheet, 500);
        const compoundCuts = packagingSheetSvg("完整套件", compound, sheet, compoundPlan).match(/<g id="CUT"[^>]*>(.*?)<\/g>/)![1];
        expect((compoundCuts.match(/<path /g) ?? []).length).toBe(compound.cuts.length * compoundPlan.placements.length);
    });
    test("保存或导出拒绝碰撞、咬口越界、禁用方向及非有限位置", () => {
        const first = { x: 5, y: 5, rotation: 0 as const };
        expect(() => verifyPackagingSheet(layout, options, [first, first])).toThrow("重叠");
        expect(() => verifyPackagingSheet(layout, { ...options, gripper: 10 }, [first])).toThrow("咬口");
        expect(() => verifyPackagingSheet(layout, { ...options, rotation: "90" }, [first])).toThrow("方向");
        expect(() => verifyPackagingSheet(layout, options, [{ ...first, x: NaN }])).toThrow();
        expect(() => packagingSheetSvg("碰撞", layout, options, { ...gridPackagingSheet(layout, options), placements: [first, first] })).toThrow("重叠");
    });
    test("搜索预算与数量上限明确结束，进度始终带完整可用坐标", () => {
        const small: PackagingLayout = {
            ...layout,
            cuts: [
                [
                    [0, 0],
                    [50, 0],
                    [50, 50],
                    [0, 50],
                ],
            ],
            bounds: { x: 0, y: 0, width: 50, height: 50 },
            areaMm2: 2500,
        };
        const seen: number[] = [];
        const plan = nestPackagingSheet(small, { ...options, width: 1000, height: 1000 }, 100, (current) => seen.push(current.placements.length));
        expect(plan.stop).toBe("budget");
        expect(plan.elapsedMs).toBeLessThan(2000);
        expect(seen[0]).toBe(plan.gridCount);
        expect(plan.placements.length).toBeGreaterThanOrEqual(plan.gridCount);
        expect(() => nestPackagingSheet(small, { ...options, width: 1500, height: 1500 }, 100)).toThrow("500");
        expect(() => gridPackagingSheet(small, { ...options, width: 4000, height: 4000 })).toThrow("2000");
        expect(() => nestPackagingSheet(layout, options, NaN)).toThrow("搜索时间");
    });
    test("真实 Worker 可计算与终止，不靠主线程同步搜索", async () => {
        const worker = new Worker(new URL("../src/lib/packaging/nesting.worker.ts", import.meta.url), { type: "module" });
        const done = new Promise<NestingResponse>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<NestingResponse>) => {
                if (event.data.type !== "progress") resolve(event.data);
            };
            worker.onerror = reject;
        });
        worker.postMessage({ layout, options, budgetMs: 1000 });
        const response = await done;
        expect(response.type).toBe("done");
        if (response.type === "done") expect(response.plan.placements.length).toBe(8);
        worker.terminate();
    });
});

describe("整张纸 1:1 结构交付", () => {
    test("SVG、DXF、PDF共用毫米坐标，实际文件包含全部套数与孔洞", async () => {
        const plan = nestPackagingSheet(layout, options, 2000);
        const svg = packagingSheetSvg("<测试>", layout, options, plan);
        expect(svg).toContain('width="310mm" height="310mm" viewBox="0 0 310 310"');
        expect(svg).toContain("&lt;测试&gt;");
        expect(svg).toContain('id="REFERENCE"');
        const cut = svg.match(/<g id="CUT"[^>]*>(.*?)<\/g>/)![1];
        expect((cut.match(/<path /g) ?? []).length).toBe(8);
        const dxf = packagingSheetDxf(layout, options, plan);
        const entities = dxf.split("\r\n");
        expect(entities.slice(entities.indexOf("$INSUNITS"), entities.indexOf("$INSUNITS") + 3)).toEqual(["$INSUNITS", "70", "4"]);
        expect(dxf).toContain("10\r\n35\r\n20\r\n-5");
        expect((dxf.match(/8\r\nCUT\r\n/g) ?? []).length).toBe(8);
        const pdf = await PDFDocument.load(await (await packagingSheetPdf("整纸测试", layout, options, plan)).arrayBuffer());
        expect(pdf.getPageCount()).toBe(1);
        expect(pdf.getTitle()).toBe("整纸测试 · 1:1 整纸刀版");
        const page = pdf.getPages()[0];
        expect(page.getWidth() / (72 / 25.4)).toBeCloseTo(310, 8);
        expect(page.getHeight() / (72 / 25.4)).toBeCloseTo(310, 8);
        const contents = page.node.Contents();
        if (!(contents instanceof PDFArray)) throw new Error("PDF 缺少内容流");
        const decoded = contents
            .asArray()
            .map((reference) => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(reference, PDFRawStream)).decode()))
            .join("\n");
        expect(decoded).toContain("35 5 m");
        expect(decoded).toContain("[2 1] 0 d");
        expect(page.node.Resources()?.toString()).not.toContain("/Image");
    });
});
