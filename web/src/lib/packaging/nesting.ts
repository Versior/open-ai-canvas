import ClipperLib from "clipper-lib";
import { estimatePackagingSheet, type SheetLayout, type SheetOptions } from "./production";
import type { PackagingLayout, Point } from "./types";

export type SheetPlacement = { x: number; y: number; rotation: 0 | 90 };
export type PackagingSheetPlan = {
    method: "grid" | "contour";
    placements: SheetPlacement[];
    gridCount: number;
    elapsedMs: number;
    trials: number;
    stop: "complete" | "budget" | "limit";
};
export type NestingRequest = { layout: PackagingLayout; options: SheetOptions; budgetMs: number };
export type NestingResponse = { type: "progress" | "done"; plan: PackagingSheetPlan } | { type: "error"; message: string };
const scale = 1000;

export function sheetPoint(point: Point, bounds: PackagingLayout["bounds"], placement: SheetPlacement): Point {
    const x = point[0] - bounds.x;
    const y = point[1] - bounds.y;
    return placement.rotation === 0 ? [placement.x + x, placement.y + y] : [placement.x + bounds.height - y, placement.y + x];
}

export function sheetTransform(bounds: PackagingLayout["bounds"], placement: SheetPlacement) {
    return placement.rotation === 0 ? `translate(${placement.x - bounds.x} ${placement.y - bounds.y})` : `translate(${placement.x + bounds.y + bounds.height} ${placement.y - bounds.x}) rotate(90)`;
}

export function gridPackagingSheet(layout: PackagingLayout, options: SheetOptions, grid: SheetLayout = estimatePackagingSheet(layout, options).selected): PackagingSheetPlan {
    if (grid.count > 2000) throw new Error("整纸超过 2000 套，请缩小纸张或增大结构尺寸");
    return {
        method: "grid",
        placements: Array.from({ length: grid.count }, (_, index) => ({
            x: options.margin + (index % grid.columns) * (grid.blankWidth + options.gap),
            y: options.margin + options.gripper + Math.floor(index / grid.columns) * (grid.blankHeight + options.gap),
            rotation: grid.rotation,
        })),
        gridCount: grid.count,
        elapsedMs: 0,
        trials: 0,
        stop: "complete",
    };
}

function filledUnion(paths: ClipperLib.Paths) {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(
        paths.map((path) => (ClipperLib.Clipper.Orientation(path) ? path : [...path].reverse())),
        ClipperLib.PolyType.ptSubject,
        true,
    );
    const result: ClipperLib.Paths = [];
    if (!clipper.Execute(ClipperLib.ClipType.ctUnion, result, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) throw new Error("轮廓合并失败");
    // Windows and internal voids stay filled: this pass only nests complete sets around their outer contours.
    return result.filter(ClipperLib.Clipper.Orientation);
}

function contours(layout: PackagingLayout, gap: number, rotation: 0 | 90) {
    const source = layout.bleed.length ? layout.bleed : layout.panels.length ? layout.panels.map((panel) => panel.points) : layout.cuts;
    const paths = filledUnion(
        source.map((path) =>
            path.map((point) => {
                const [x, y] = sheetPoint(point, layout.bounds, { x: 0, y: 0, rotation });
                return { X: Math.round(x * scale), Y: Math.round(y * scale) };
            }),
        ),
    );
    if (!gap) return paths;
    const offset = new ClipperLib.ClipperOffset(2, 0.01 * scale);
    offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const expanded: ClipperLib.Paths = [];
    offset.Execute(expanded, Math.ceil((gap * scale) / 2));
    return filledUnion(expanded);
}

const shifted = (paths: ClipperLib.Paths, x: number, y: number) => paths.map((path) => path.map((point) => ({ X: point.X + x, Y: point.Y + y })));

function overlap(a: ClipperLib.Paths, b: ClipperLib.Paths) {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
    clipper.AddPaths(b, ClipperLib.PolyType.ptClip, true);
    const intersection: ClipperLib.Paths = [];
    if (!clipper.Execute(ClipperLib.ClipType.ctIntersection, intersection, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) throw new Error("轮廓碰撞检查失败");
    return intersection.some((path) => Math.abs(ClipperLib.Clipper.Area(path)) > 1);
}

function collides(a: ClipperLib.Paths, b: ClipperLib.Paths, gap: number) {
    const aa = a.flat();
    const bb = b.flat();
    const ax = aa.map((p) => p.X),
        ay = aa.map((p) => p.Y);
    const bx = bb.map((p) => p.X),
        by = bb.map((p) => p.Y);
    const distance = Math.max(0, gap * scale - 2);
    if (Math.min(...ax) - Math.max(...bx) >= distance || Math.min(...bx) - Math.max(...ax) >= distance || Math.min(...ay) - Math.max(...by) >= distance || Math.min(...by) - Math.max(...ay) >= distance) return false;
    if (overlap(a, b)) return true;
    if (!gap) return false;
    const near = (p: ClipperLib.IntPoint, start: ClipperLib.IntPoint, end: ClipperLib.IntPoint) => {
        const dx = end.X - start.X,
            dy = end.Y - start.Y;
        const t = Math.max(0, Math.min(1, ((p.X - start.X) * dx + (p.Y - start.Y) * dy) / (dx * dx + dy * dy || 1)));
        return (p.X - start.X - t * dx) ** 2 + (p.Y - start.Y - t * dy) ** 2 < distance ** 2;
    };
    return a.some((path) => b.some((other) => path.some((p, index) => other.some((q, j) => near(p, q, other[(j + 1) % other.length]) || near(q, p, path[(index + 1) % path.length])))));
}

export function verifyPackagingSheet(layout: PackagingLayout, options: SheetOptions, placements: SheetPlacement[]) {
    estimatePackagingSheet(layout, options);
    if (!placements.length || placements.length > 2000) throw new Error("整纸须包含 1–2000 套完整刀版");
    const shapes = new Map(([0, 90] as const).map((rotation) => [rotation, contours(layout, 0, rotation)]));
    const placed: ClipperLib.Paths[] = [];
    for (const placement of placements) {
        const width = placement.rotation === 0 ? layout.bounds.width : layout.bounds.height;
        const height = placement.rotation === 0 ? layout.bounds.height : layout.bounds.width;
        if (![placement.x, placement.y].every(Number.isFinite) || (placement.rotation !== 0 && placement.rotation !== 90) || (options.rotation !== "auto" && String(placement.rotation) !== options.rotation)) throw new Error("拼版位置或方向无效");
        if (placement.x < options.margin - 0.001 || placement.y < options.margin + options.gripper - 0.001 || placement.x + width > options.width - options.margin + 0.001 || placement.y + height > options.height - options.margin + 0.001)
            throw new Error("刀版超出留白或咬口边界");
        const shape = shifted(shapes.get(placement.rotation)!, Math.round(placement.x * scale), Math.round(placement.y * scale));
        if (placed.some((previous) => collides(shape, previous, options.gap))) throw new Error("拼版出血轮廓重叠或间距不足");
        placed.push(shape);
    }
}

export function nestPackagingSheet(layout: PackagingLayout, options: SheetOptions, budgetMs: number, onProgress?: (plan: PackagingSheetPlan) => void): PackagingSheetPlan {
    const baseline = gridPackagingSheet(layout, options);
    if (!Number.isFinite(budgetMs) || budgetMs < 100 || budgetMs > 30000) throw new Error("搜索时间须为 0.1–30 秒");
    if (baseline.gridCount > 500) throw new Error("轮廓搜索最多 500 套，请使用网格拼版或缩小纸张");
    const start = performance.now();
    const rotations = ([0, 90] as const).filter((rotation) => options.rotation === "auto" || String(rotation) === options.rotation);
    const shapes = new Map(rotations.map((rotation) => [rotation, contours(layout, options.gap, rotation)]));
    const actual = new Map(rotations.map((rotation) => [rotation, contours(layout, 0, rotation)]));
    const nfps = new Map<string, ClipperLib.Paths>();
    let best: PackagingSheetPlan = { ...baseline, method: "contour" };
    let trials = 0;
    const finish = (stop: PackagingSheetPlan["stop"]) => ({ ...best, elapsedMs: Math.round(performance.now() - start), trials, stop });
    onProgress?.(best);
    for (const a of rotations)
        for (const b of rotations) {
            const forbidden = shapes.get(a)!.flatMap((fixed) =>
                shapes.get(b)!.flatMap((moving) =>
                    filledUnion(
                        ClipperLib.Clipper.MinkowskiSum(
                            fixed,
                            moving.map((p) => ({ X: -p.X, Y: -p.Y })),
                            true,
                        ),
                    ),
                ),
            );
            nfps.set(`${a}-${b}`, filledUnion(forbidden));
            if (performance.now() - start >= budgetMs) return finish("budget");
        }
    const left = Math.ceil(options.margin * scale);
    const top = Math.ceil((options.margin + options.gripper) * scale);
    for (const vertical of [false, true])
        for (const seed of rotations) {
            trials++;
            const placements: SheetPlacement[] = [];
            const placed: ClipperLib.Paths[] = [];
            while (placements.length < 500) {
                let winner: { placement: SheetPlacement; shape: ClipperLib.Paths; score: number } | undefined;
                for (const rotation of placements.length ? rotations : [seed]) {
                    const right = Math.floor((options.width - options.margin - (rotation === 0 ? layout.bounds.width : layout.bounds.height)) * scale);
                    const bottom = Math.floor((options.height - options.margin - (rotation === 0 ? layout.bounds.height : layout.bounds.width)) * scale);
                    if (right < left || bottom < top) continue;
                    const allowed = [
                        { X: left, Y: top },
                        { X: right, Y: top },
                        { X: right, Y: bottom },
                        { X: left, Y: bottom },
                    ];
                    const forbidden = placements.flatMap((placement) => shifted(nfps.get(`${placement.rotation}-${rotation}`)!, Math.round(placement.x * scale), Math.round(placement.y * scale)));
                    const clipper = new ClipperLib.Clipper();
                    clipper.AddPath(allowed, ClipperLib.PolyType.ptSubject, true);
                    clipper.AddPaths(forbidden, ClipperLib.PolyType.ptClip, true);
                    const free: ClipperLib.Paths = [];
                    if (!clipper.Execute(ClipperLib.ClipType.ctDifference, free, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) throw new Error("允许区域计算失败");
                    // Boundary-only fits disappear from polygon difference; keep contact vertices too.
                    const candidates = [...allowed, ...free.flat(), ...forbidden.flat()].filter((p) => p.X >= left && p.Y >= top && p.X <= right && p.Y <= bottom);
                    const unique = new Map(candidates.map((point) => [`${point.X},${point.Y}`, point]));
                    const ordered = [...unique.values()].sort((a, b) => (vertical ? a.X - b.X || a.Y - b.Y : a.Y - b.Y || a.X - b.X));
                    for (const point of ordered) {
                        if (performance.now() - start >= budgetMs) return finish("budget");
                        const score = vertical ? point.X * (options.height * scale + 1) + point.Y : point.Y * (options.width * scale + 1) + point.X;
                        if (winner && score >= winner.score) break;
                        const shape = shifted(actual.get(rotation)!, point.X, point.Y);
                        if (placed.some((previous) => collides(shape, previous, options.gap))) continue;
                        winner = { placement: { x: point.X / scale, y: point.Y / scale, rotation }, shape, score };
                        break;
                    }
                }
                if (!winner) break;
                placements.push(winner.placement);
                placed.push(winner.shape);
                if (placements.length > best.placements.length) {
                    best = { ...best, placements: [...placements], elapsedMs: Math.round(performance.now() - start), trials };
                    onProgress?.(best);
                }
            }
            if (placements.length === 500) return finish("limit");
        }
    return finish("complete");
}
