import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { PackagingHistory } from "../src/lib/packaging/history";
import { planPackagingPrint, estimatePackagingSheet, fitPackagingArtwork, sheetPlacement, type SheetOptions } from "../src/lib/packaging/production";
import { packagingProofPdf } from "../src/lib/packaging/print";
import { compilePackaging } from "../src/lib/packaging/geometry";
import { newPackagingDocument, type PackagingLayout, type PackagingStructure } from "../src/lib/packaging/types";

const document = newPackagingDocument(
    {
        id: "tuck",
        name: "双插盒",
        structure: "tuck",
        category: "折叠纸盒",
        description: "",
        enabled: true,
        defaults: { length: 120, width: 60, height: 80, thickness: 0.45, bleed: 3, glue: 12, tab: 15, gap: 1, frontHeight: 30, windowWidth: 0, windowHeight: 0, inflation: 0.6, spoutRadius: 8 },
    },
    { id: "card", name: "白卡", color: "#ffffff", insideColor: "#eeeeee", thickness: 0.45, roughness: 0.65, metalness: 0, enabled: true },
);
const rectangle: PackagingLayout = {
    panels: [],
    parts: [],
    cuts: [
        [
            [13, -7],
            [113, -7],
            [113, 73],
            [13, 73],
        ],
    ],
    creases: [
        [
            [13, 33],
            [113, 33],
        ],
    ],
    bleed: [],
    bounds: { x: 13, y: -7, width: 100, height: 80 },
    dimensions: [],
    areaMm2: 8000,
    warnings: [],
};
const sheet: SheetOptions = { width: 700, height: 1000, margin: 10, gripper: 10, gap: 3, quantity: 1001, spoilage: 3, pricePerSheet: 2, rotation: "auto" };

describe("包装编辑历史", () => {
    test("同一字段合并，不同字段独立；分支编辑丢弃 redo", () => {
        const history = new PackagingHistory();
        const a = { name: "方案", document };
        const b = { ...a, name: "方案一" };
        const c = { ...a, name: "方案二" };
        const d = { ...c, document: { ...document, notes: "说明" } };
        history.record(a, "name", 1000);
        history.record(b, "name", 1200);
        history.record(c, "notes", 1250);
        expect(history.undo(d)).toEqual(c);
        expect(history.undo(c)).toEqual(a);
        expect(history.redo(a)).toEqual(c);
        history.record(c, "name", 1300);
        expect(history.canRedo).toBe(false);
        expect(history.undo(b)).toEqual(c);
    });
    test("手势边界和容量限制，切换项目/账号后清空", () => {
        const history = new PackagingHistory();
        for (let index = 0; index < 80; index++) history.record({ name: String(index), document });
        for (let index = 79; index >= 20; index--) expect(history.undo({ name: "新状态", document })?.name).toBe(String(index));
        expect(history.canUndo).toBe(false);
        history.clear();
        expect(history.canRedo).toBe(false);
        history.record({ name: "before", document }, "drag", 1000);
        history.endGroup();
        history.record({ name: "after", document }, "drag", 1100);
        expect(history.undo({ name: "now", document })?.name).toBe("after");
        expect(history.undo({ name: "after", document })?.name).toBe("before");
    });
});

describe("真尺寸白样", () => {
    test("横竖版比较、负坐标、大刀版覆盖与重叠", () => {
        const plan = planPackagingPrint({ x: -23, y: -50, width: 400, height: 350 }, { paper: "A4", margin: 12, overlap: 5 });
        expect(plan.orientation).toBe("landscape");
        expect(plan.tiles.length).toBe(4);
        expect(plan.tiles[0].x).toBe(-23);
        expect(plan.tiles[0].y).toBe(-50);
        const last = plan.tiles.at(-1)!;
        expect(last.x + last.width).toBeCloseTo(377, 8);
        expect(last.y + last.height).toBeCloseTo(300, 8);
        for (const tile of plan.tiles) {
            expect(tile.width + 24).toBeLessThanOrEqual(plan.paperWidth);
            expect(tile.height + 24).toBeLessThanOrEqual(plan.paperHeight);
            const right = plan.tiles.find((t) => t.row === tile.row && t.column === tile.column + 1);
            const down = plan.tiles.find((t) => t.column === tile.column && t.row === tile.row + 1);
            if (right) expect(tile.x + tile.width - right.x).toBeCloseTo(5, 8);
            if (down) expect(tile.y + tile.height - down.y).toBeCloseTo(5, 8);
        }
    });
    test("独立 PDF 解析：纸张毫米尺寸、元数据、矢量与 100% 校准", async () => {
        const blob = await packagingProofPdf("校准样", rectangle, { paper: "A4", margin: 12, overlap: 5 });
        const pdf = await PDFDocument.load(await blob.arrayBuffer());
        expect(pdf.getTitle()).toBe("校准样 · 1:1 包装白样");
        expect(pdf.getPageCount()).toBe(1);
        const page = pdf.getPages()[0];
        expect((page.getWidth() * 25.4) / 72).toBeCloseTo(210, 8);
        expect((page.getHeight() * 25.4) / 72).toBeCloseTo(297, 8);
        const contents = page.node.Contents();
        if (!(contents instanceof PDFArray)) throw new Error("PDF 缺少内容流");
        const decoded = contents
            .asArray()
            .map((reference) => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(reference, PDFRawStream)).decode()))
            .join("\n");
        expect(decoded).toContain("113 73 l");
        expect(decoded).toContain(String(72 / 25.4));
        expect(decoded).toContain("W\n");
        expect(page.node.Resources()?.toString()).not.toContain("/Image");
    });
    test("A3 分页数和纸张范围保护", async () => {
        const layout = compilePackaging(document);
        const a4 = planPackagingPrint(layout.bounds, { paper: "A4", margin: 12, overlap: 5 });
        const a3 = planPackagingPrint(layout.bounds, { paper: "A3", margin: 12, overlap: 5 });
        expect(a3.tiles.length).toBeLessThanOrEqual(a4.tiles.length);
        const pdf = await PDFDocument.load(await (await packagingProofPdf("分页", layout, { paper: "A3", margin: 12, overlap: 5 })).arrayBuffer());
        expect(pdf.getPageCount()).toBe(a3.tiles.length);
        expect(() => planPackagingPrint(layout.bounds, { paper: "A4", margin: 2, overlap: 5 })).toThrow();
        expect(() => planPackagingPrint({ ...layout.bounds, width: 4000, height: 4000 }, { paper: "A4", margin: 30, overlap: 15 })).toThrow("200");
    });
});

describe("纸材用量与图稿", () => {
    test("数量、备用、余量和单价可解释；放不下时没有生产结果", () => {
        const result = estimatePackagingSheet(rectangle, sheet);
        expect(result.selected.count).toBe(72);
        expect(result.selected.rotation).toBe(90);
        expect(result.baseSheets).toBe(14);
        expect(result.extraSheets).toBe(1);
        expect(result.sheets).toBe(15);
        expect(result.excess).toBe(7);
        expect(result.paperCost).toBe(30);
        expect(result.unitPaperCost).toBeCloseTo(30 / 1001, 8);
        expect(result.selected.netUtilization).toBeCloseTo(576000 / 700000, 8);
        const zero = estimatePackagingSheet(rectangle, { ...sheet, width: 100, height: 100, margin: 15, rotation: "0" });
        expect(zero.selected.count).toBe(0);
        expect(zero.sheets).toBe(0);
        expect(() => estimatePackagingSheet(rectangle, { ...sheet, quantity: 1.5 })).toThrow();
        expect(() => estimatePackagingSheet(rectangle, { ...sheet, pricePerSheet: NaN })).toThrow();
    });
    test("十二结构含出血排列，逐份检查留白/咬口/间距和面积上限", () => {
        for (const structure of ["tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"] satisfies PackagingStructure[]) {
            const layout = compilePackaging({ ...document, template: { ...document.template, structure } });
            for (const rotation of ["auto", "0", "90"] satisfies SheetOptions["rotation"][]) {
                const options = { ...sheet, rotation };
                const result = estimatePackagingSheet(layout, options);
                expect(result.selected.netUtilization).toBeLessThanOrEqual(1);
                expect(result.selected.envelopeUtilization).toBeLessThanOrEqual(1);
                for (let index = 0; index < result.selected.count; index++) {
                    const x = options.margin + (index % result.selected.columns) * (result.selected.blankWidth + options.gap);
                    const y = options.margin + options.gripper + Math.floor(index / result.selected.columns) * (result.selected.blankHeight + options.gap);
                    expect(x + result.selected.blankWidth).toBeLessThanOrEqual(options.width - options.margin + 1e-8);
                    expect(y + result.selected.blankHeight).toBeLessThanOrEqual(options.height - options.margin + 1e-8);
                    expect(sheetPlacement(layout, result.selected, options, index)).toContain("translate");
                }
                if (rotation !== "auto") expect(result.selected.rotation).toBe(Number(rotation));
            }
        }
    });
    test("放入/铺满均保留比例；居中保留尺寸及角度", () => {
        const art = { id: "a", resourceId: "r", name: "图稿", panelId: "", role: "artwork" as const, x: 0, y: 0, width: 200, height: 100, rotation: 30, opacity: 1 };
        const contain = fitPackagingArtwork(art, rectangle.bounds, "contain");
        expect(contain).toEqual({ x: 13, y: 8, width: 100, height: 50, rotation: 0 });
        const cover = fitPackagingArtwork(art, rectangle.bounds, "cover");
        expect(cover).toEqual({ x: -17, y: -7, width: 160, height: 80, rotation: 0 });
        const center = fitPackagingArtwork(art, rectangle.bounds, "center");
        expect(center).toEqual({ x: -37, y: -17, width: 200, height: 100, rotation: 30 });
    });
});
