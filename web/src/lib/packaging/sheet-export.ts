import { xmlText } from "@/lib/delivery-text";
import { packagingDxf, packagingPath } from "./delivery";
import { sheetPoint, verifyPackagingSheet, type PackagingSheetPlan } from "./nesting";
import type { SheetOptions } from "./production";
import type { PackagingLayout, Point } from "./types";

function sheetGeometry(layout: PackagingLayout, options: SheetOptions, plan: PackagingSheetPlan) {
    verifyPackagingSheet(layout, options, plan.placements);
    const repeat = (paths: Point[][]) => plan.placements.flatMap((placement) => paths.map((path) => path.map((point) => sheetPoint(point, layout.bounds, placement))));
    const frame = (x: number, y: number, width: number, height: number): Point[] => [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
        [x, y],
    ];
    const references = [frame(0, 0, options.width, options.height), frame(options.margin, options.margin + options.gripper, options.width - options.margin * 2, options.height - options.margin * 2 - options.gripper)];
    const hasRuler = options.margin + options.gripper >= 9;
    if (hasRuler)
        references.push(
            [
                [5, 5],
                [55, 5],
            ],
            [
                [5, 4],
                [5, 6],
            ],
            [
                [55, 4],
                [55, 6],
            ],
        );
    const creases = plan.placements.flatMap((placement) => layout.creases.map(([a, b]): [Point, Point] => [sheetPoint(a, layout.bounds, placement), sheetPoint(b, layout.bounds, placement)]));
    return { cuts: repeat(layout.cuts), creases, bleed: repeat(layout.bleed), references, hasRuler };
}

export function packagingSheetSvg(name: string, layout: PackagingLayout, options: SheetOptions, plan: PackagingSheetPlan) {
    const geometry = sheetGeometry(layout, options, plan);
    const group = (id: string, color: string, paths: Point[][], close: boolean, dash = "") => `<g id="${id}" stroke="${color}"${dash ? ` stroke-dasharray="${dash}"` : ""}>${paths.map((path) => `<path d="${packagingPath(path, close)}"/>`).join("")}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}mm" height="${options.height}mm" viewBox="0 0 ${options.width} ${options.height}"><title>${xmlText(name)} · ${plan.placements.length} 套整纸刀版</title><desc>1:1 毫米结构拼版；CUT 切线，CREASE 折线，BLEED 出血，REFERENCE 纸张与可用区域参考。${geometry.hasRuler ? "上侧有 50 mm 校准尺。" : "上侧空间不足，未添加校准尺。"}完整一套保持部件相对位置；不含彩稿、共刀或孔内嵌套。</desc><g fill="none" stroke-width="0.2">${group("CUT", "#d83243", geometry.cuts, true)}${group("CREASE", "#386dc2", geometry.creases, false, "2 1")}${group("BLEED", "#529858", geometry.bleed, true)}${group("REFERENCE", "#777777", geometry.references, false, "1 1")}</g>${geometry.hasRuler ? '<text x="25" y="3" font-size="2" fill="#777777">50 mm / PRINT 100%</text>' : ""}</svg>`;
}

export function packagingSheetDxf(layout: PackagingLayout, options: SheetOptions, plan: PackagingSheetPlan) {
    const geometry = sheetGeometry(layout, options, plan);
    return packagingDxf({ ...layout, ...geometry, dimensions: geometry.references.flatMap((path) => path.slice(1).map((point, index) => ({ a: path[index], b: point, label: "" }))) });
}

export async function packagingSheetPdf(name: string, layout: PackagingLayout, options: SheetOptions, plan: PackagingSheetPlan) {
    const geometry = sheetGeometry(layout, options, plan);
    const { PDFDocument, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${name} · 1:1 整纸刀版`);
    pdf.setCreator("影策包装刀板");
    pdf.setSubject(`${plan.placements.length} complete sets; ${options.width} x ${options.height} mm; CUT red, CREASE blue, BLEED green, REFERENCE gray. Structure only. Print at 100%.`);
    const mm = 72 / 25.4;
    const page = pdf.addPage([options.width * mm, options.height * mm]);
    for (const [paths, close, color, dash] of [
        [geometry.cuts, true, rgb(0.82, 0.15, 0.22), []],
        [geometry.creases, false, rgb(0.15, 0.35, 0.7), [2, 1]],
        [geometry.bleed, true, rgb(0.25, 0.55, 0.3), []],
        [geometry.references, false, rgb(0.45, 0.45, 0.45), [1, 1]],
    ] as const) {
        if (!paths.length) continue;
        page.drawSvgPath(paths.map((path) => packagingPath(path, close)).join(" "), { x: 0, y: options.height * mm, scale: mm, borderColor: color, borderWidth: 0.2, borderDashArray: [...dash] });
    }
    if (geometry.hasRuler) page.drawText(`50 mm | PRINT 100% | ${plan.placements.length} SETS | ${plan.method.toUpperCase()}`, { x: 5 * mm, y: (options.height - 3) * mm, size: 6, color: rgb(0.45, 0.45, 0.45) });
    return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}
