import { packagingPath } from "./delivery";
import { planPackagingPrint, type PrintOptions } from "./production";
import type { PackagingLayout } from "./types";

export async function packagingProofPdf(name: string, layout: PackagingLayout, options: PrintOptions) {
    const plan = planPackagingPrint(layout.bounds, options);
    const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${name} · 1:1 包装白样`);
    pdf.setCreator("影策包装刀板");
    pdf.setSubject("Vector white sample. Print at 100% actual size. Verify the 50 mm ruler.");
    const mm = 72 / 25.4;
    const gray = rgb(0.45, 0.45, 0.45);
    for (const [index, tile] of plan.tiles.entries()) {
        const page = pdf.addPage([plan.paperWidth * mm, plan.paperHeight * mm]);
        const left = plan.margin + (plan.tiles.length === 1 ? (plan.paperWidth - plan.margin * 2 - tile.width) / 2 : 0);
        const top = plan.margin + (plan.tiles.length === 1 ? (plan.paperHeight - plan.margin * 2 - tile.height) / 2 : 0);
        page.pushOperators(pushGraphicsState(), rectangle(left * mm, (plan.paperHeight - top - tile.height) * mm, tile.width * mm, tile.height * mm), clip(), endPath());
        for (const [paths, color, dash] of [
            [layout.cuts.map((p) => packagingPath(p)), rgb(0.82, 0.15, 0.22), []],
            [layout.creases.map((p) => packagingPath(p, false)), rgb(0.15, 0.35, 0.7), [2, 1]],
        ] as const)
            page.drawSvgPath(paths.join(" "), { x: (left - tile.x) * mm, y: (plan.paperHeight - top + tile.y) * mm, scale: mm, borderColor: color, borderWidth: 0.2, borderDashArray: [...dash] });
        page.pushOperators(popGraphicsState());
        const line = (x1: number, y1: number, x2: number, y2: number, dashed = false) =>
            page.drawLine({ start: { x: x1 * mm, y: (plan.paperHeight - y1) * mm }, end: { x: x2 * mm, y: (plan.paperHeight - y2) * mm }, thickness: 0.15 * mm, color: gray, dashArray: dashed ? [mm, mm] : undefined });
        const cross = (x: number, y: number) => {
            line(x - 1.5, y, x + 1.5, y);
            line(x, y - 1.5, x, y + 1.5);
        };
        const vertical = [tile.column > 0 ? left + plan.overlap / 2 : undefined, tile.column < plan.columns - 1 ? left + tile.width - plan.overlap / 2 : undefined];
        for (const x of vertical) {
            if (x === undefined) continue;
            line(x, top, x, top + tile.height, true);
            cross(x, top + tile.height / 4);
            cross(x, top + (tile.height * 3) / 4);
        }
        const horizontal = [tile.row > 0 ? top + plan.overlap / 2 : undefined, tile.row < plan.rows - 1 ? top + tile.height - plan.overlap / 2 : undefined];
        for (const y of horizontal) {
            if (y === undefined) continue;
            line(left, y, left + tile.width, y, true);
            cross(left + tile.width / 4, y);
            cross(left + (tile.width * 3) / 4, y);
        }
        page.drawText(`1:1 WHITE SAMPLE | ${options.paper} ${plan.orientation} | R${tile.row + 1} C${tile.column + 1} | ${index + 1}/${plan.tiles.length}`, { x: plan.margin * mm, y: (plan.paperHeight - 6) * mm, size: 7, color: gray });
        page.drawText(`CUT red | CREASE blue | ASSEMBLY gray | overlap ${plan.overlap} mm`, { x: plan.margin * mm, y: (plan.paperHeight - 9) * mm, size: 6, color: gray });
        line(plan.margin, plan.paperHeight - 5, plan.margin + 50, plan.paperHeight - 5);
        for (const x of [plan.margin, plan.margin + 50]) line(x, plan.paperHeight - 6, x, plan.paperHeight - 4);
        page.drawText("50 mm", { x: (plan.margin + 19) * mm, y: 6 * mm, size: 6, color: gray });
        page.drawText("PRINT 100% / ACTUAL SIZE - NO FIT TO PAGE", { x: (plan.margin + 55) * mm, y: 5 * mm, size: 6, color: gray });
    }
    return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}
