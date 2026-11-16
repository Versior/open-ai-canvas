import type { PackagingArtwork, PackagingLayout, Point } from "./types";
import { scalePackagingText } from "./typography";

export type PrintOptions = { paper: "A4" | "A3"; margin: number; overlap: number };
export type PrintTile = { row: number; column: number; x: number; y: number; width: number; height: number };
export type PrintPlan = { paperWidth: number; paperHeight: number; orientation: "portrait" | "landscape"; rows: number; columns: number; tiles: PrintTile[]; margin: number; overlap: number };

export function planPackagingPrint(bounds: PackagingLayout["bounds"], options: PrintOptions): PrintPlan {
    if (![options.margin, options.overlap].every(Number.isFinite) || options.margin < 10 || options.margin > 30 || options.overlap < 2 || options.overlap > 15) throw new Error("打印边距须为 10–30 mm，重叠须为 2–15 mm");
    const paper = options.paper === "A4" ? [210, 297] : [297, 420];
    const alternatives = (["portrait", "landscape"] as const).map((orientation) => {
        const paperWidth = orientation === "portrait" ? paper[0] : paper[1];
        const paperHeight = orientation === "portrait" ? paper[1] : paper[0];
        const width = paperWidth - options.margin * 2;
        const height = paperHeight - options.margin * 2;
        const columns = Math.max(1, Math.ceil((bounds.width - options.overlap) / (width - options.overlap)));
        const rows = Math.max(1, Math.ceil((bounds.height - options.overlap) / (height - options.overlap)));
        return { paperWidth, paperHeight, width, height, columns, rows, orientation };
    });
    const best = alternatives.sort((a, b) => a.columns * a.rows - b.columns * b.rows)[0];
    if (best.columns * best.rows > 200) throw new Error("白样超过 200 页，请使用 A3 或缩小结构尺寸");
    const tiles = Array.from({ length: best.rows * best.columns }, (_, index) => {
        const row = Math.floor(index / best.columns);
        const column = index % best.columns;
        const x = bounds.x + column * (best.width - options.overlap);
        const y = bounds.y + row * (best.height - options.overlap);
        return { row, column, x, y, width: Math.min(best.width, bounds.x + bounds.width - x), height: Math.min(best.height, bounds.y + bounds.height - y) };
    });
    return { ...best, margin: options.margin, overlap: options.overlap, tiles };
}

export type SheetOptions = { width: number; height: number; margin: number; gripper: number; gap: number; rotation: "auto" | "0" | "90"; quantity: number; spoilage: number; pricePerSheet: number };
export type SheetLayout = { rotation: 0 | 90; columns: number; rows: number; count: number; blankWidth: number; blankHeight: number; netUtilization: number; envelopeUtilization: number };

export function estimatePackagingSheet(layout: PackagingLayout, options: SheetOptions) {
    if (!Number.isFinite(options.width) || !Number.isFinite(options.height) || options.width < 100 || options.height < 100 || options.width > 4000 || options.height > 4000) throw new Error("纸张长宽须为 100–4000 mm");
    if (
        ![options.margin, options.gripper, options.gap, options.spoilage, options.pricePerSheet].every(Number.isFinite) ||
        options.margin < 0 ||
        options.margin > 100 ||
        options.gripper < 0 ||
        options.gripper > 100 ||
        options.gap < 0 ||
        options.gap > 50 ||
        options.spoilage < 0 ||
        options.spoilage > 50 ||
        options.pricePerSheet < 0 ||
        options.pricePerSheet > 100000 ||
        !Number.isInteger(options.quantity) ||
        options.quantity < 1 ||
        options.quantity > 10000000
    )
        throw new Error("核对边距、咬口、间距、数量、损耗与单张纸价");
    const usableWidth = options.width - options.margin * 2;
    const usableHeight = options.height - options.margin * 2 - options.gripper;
    if (usableWidth <= 0 || usableHeight <= 0) throw new Error("边距与咬口已占满纸张");
    const alternatives: SheetLayout[] = ([0, 90] as const).map((rotation) => {
        const blankWidth = rotation === 0 ? layout.bounds.width : layout.bounds.height;
        const blankHeight = rotation === 0 ? layout.bounds.height : layout.bounds.width;
        const columns = Math.max(0, Math.floor((usableWidth + options.gap) / (blankWidth + options.gap)));
        const rows = Math.max(0, Math.floor((usableHeight + options.gap) / (blankHeight + options.gap)));
        const count = columns * rows;
        return { rotation, blankWidth, blankHeight, columns, rows, count, netUtilization: (count * layout.areaMm2) / (options.width * options.height), envelopeUtilization: (count * blankWidth * blankHeight) / (options.width * options.height) };
    });
    const selected = alternatives.filter((a) => options.rotation === "auto" || String(a.rotation) === options.rotation).sort((a, b) => b.count - a.count)[0];
    const baseSheets = selected.count ? Math.ceil(options.quantity / selected.count) : 0;
    const extraSheets = Math.ceil((baseSheets * options.spoilage) / 100);
    const sheets = baseSheets + extraSheets;
    return {
        alternatives,
        selected,
        usableWidth,
        usableHeight,
        baseSheets,
        extraSheets,
        sheets,
        excess: baseSheets * selected.count - (selected.count ? options.quantity : 0),
        paperCost: sheets * options.pricePerSheet,
        unitPaperCost: (sheets * options.pricePerSheet) / options.quantity,
    };
}

export function sheetPlacement(layout: PackagingLayout, sheet: SheetLayout, options: SheetOptions, index: number) {
    const x = options.margin + (index % sheet.columns) * (sheet.blankWidth + options.gap);
    const y = options.margin + options.gripper + Math.floor(index / sheet.columns) * (sheet.blankHeight + options.gap);
    return sheet.rotation === 0 ? `translate(${x - layout.bounds.x} ${y - layout.bounds.y})` : `translate(${x + layout.bounds.y + layout.bounds.height} ${y - layout.bounds.x}) rotate(90)`;
}

export function fitPackagingArtwork(artwork: PackagingArtwork, bounds: PackagingLayout["bounds"], mode: "contain" | "cover" | "center") {
    const factor = mode === "center" ? 1 : (mode === "contain" ? Math.min : Math.max)(bounds.width / artwork.width, bounds.height / artwork.height);
    const width = artwork.width * factor;
    const height = artwork.height * factor;
    return { ...scalePackagingText(artwork, factor), x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height, rotation: mode === "center" ? artwork.rotation : 0 };
}

export function packagingPanelBounds(points: Point[]) {
    const x = Math.min(...points.map((p) => p[0]));
    const y = Math.min(...points.map((p) => p[1]));
    return { x, y, width: Math.max(...points.map((p) => p[0])) - x, height: Math.max(...points.map((p) => p[1])) - y };
}
