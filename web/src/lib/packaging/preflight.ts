import ClipperLib from "clipper-lib";
import { artworkPoint } from "./artwork";
import { parsePackagingDocument } from "./import-contract";
import type { PackagingDocument, PackagingLayout, Point } from "./types";

export type PackagingImageSize = { width: number; height: number };
export type PackagingPreflightIssue = { severity: "error" | "warning"; code: string; message: string; artworkId?: string };

export function packagingPreflight(document: PackagingDocument, layout: PackagingLayout, images: Map<string, PackagingImageSize>) {
    parsePackagingDocument(document);
    const issues: PackagingPreflightIssue[] = [];
    const artworks = document.artworks.map((art) => {
        const image = images.get(art.resourceId);
        const dpi = image ? Math.min(image.width / art.width, image.height / art.height) * 25.4 : null;
        const panel = layout.panels.find((p) => p.id === art.panelId);
        if (art.panelId && !panel) issues.push({ severity: "error", code: "panel_missing", artworkId: art.id, message: `${art.name}：目标面板不存在` });
        if (!image) issues.push({ severity: "error", code: "resource_missing", artworkId: art.id, message: `${art.name}：图稿未加载，不能完整交付` });
        if (dpi !== null && dpi < 300) issues.push({ severity: "warning", code: "low_resolution", artworkId: art.id, message: `${art.name}：有效分辨率 ${Math.round(dpi)} DPI，低于 300 DPI 检查参考值` });
        const path = (points: Point[]) => points.map(([x, y]) => ({ X: Math.round(x * 1000), Y: Math.round(y * 1000) }));
        const clipper = new ClipperLib.Clipper();
        clipper.AddPath(
            path(
                [
                    [-1, -1],
                    [1, -1],
                    [1, 1],
                    [-1, 1],
                ].map(([x, y]) => artworkPoint(art, (x * art.width) / 2, (y * art.height) / 2)),
            ),
            ClipperLib.PolyType.ptSubject,
            true,
        );
        clipper.AddPaths((art.panelId ? (panel ? [panel.points, ...panel.holes] : []) : layout.cuts).map(path), ClipperLib.PolyType.ptClip, true);
        const intersection: ClipperLib.Paths = [];
        clipper.Execute(ClipperLib.ClipType.ctIntersection, intersection, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
        const visibleAreaMm2 = Math.abs(intersection.reduce((sum, polygon) => sum + ClipperLib.Clipper.Area(polygon), 0)) / 1_000_000;
        if (visibleAreaMm2 < 0.0001 || art.opacity === 0) issues.push({ severity: "warning", code: "invisible_artwork", artworkId: art.id, message: `${art.name}：位于裁切区域外／开窗内，或透明度为 0` });
        return { id: art.id, name: art.name, role: art.role, panelId: art.panelId, dpi, visibleAreaMm2, visibleFraction: visibleAreaMm2 / (art.width * art.height) };
    });
    if (document.artworks.some((a) => a.role === "artwork")) issues.push({ severity: "warning", code: "bleed_review", message: "当前印刷图稿按裁切面裁剪；出血线是结构参考，须在印前软件中补足图稿出血" });
    const length = (points: Point[], closed: boolean) =>
        points.reduce((sum, p, index) => sum + (index || closed ? Math.hypot(p[0] - points[(index + points.length - 1) % points.length][0], p[1] - points[(index + points.length - 1) % points.length][1]) : 0), 0);
    return {
        status: issues.some((i) => i.severity === "error") ? ("blocked" as const) : issues.length ? ("review" as const) : ("ready" as const),
        structure: document.template.structure,
        boundsMm: layout.bounds,
        areaMm2: layout.areaMm2,
        cutLengthMm: layout.cuts.reduce((sum, points) => sum + length(points, true), 0),
        creaseLengthMm: layout.creases.reduce((sum, points) => sum + length(points, false), 0),
        artworks,
        issues,
        scope: "设计文件自动检查；300 DPI 为提示参考值。未验证色彩、印刷套准、最小工艺线宽或工厂白样。",
    };
}
