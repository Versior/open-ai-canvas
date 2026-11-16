import ClipperLib from "clipper-lib";
import { artworkPoint } from "./artwork";
import { parsePackagingDocument } from "./import-contract";
import type { PackagingDocument, PackagingLayout, Point } from "./types";
import { packagingTextLayout, type PackagingTextMeasureFactory } from "./typography";
import { packagingSafeArea } from "./design";

export type PackagingImageSize = { width: number; height: number };
export type PackagingPreflightIssue = { severity: "error" | "warning"; code: string; message: string; artworkId?: string };

export function packagingPreflight(document: PackagingDocument, layout: PackagingLayout, images: Map<string, PackagingImageSize>, textMeasure?: PackagingTextMeasureFactory) {
    parsePackagingDocument(document);
    const issues: PackagingPreflightIssue[] = [];
    const safe = packagingSafeArea(layout);
    const artworks = document.artworks.map((art) => {
        const image = images.get(art.resourceId);
        const dpi = image ? Math.min(image.width / art.width, image.height / art.height) * 25.4 : null;
        const panel = layout.panels.find((p) => p.id === art.panelId);
        if (art.panelId && !panel) issues.push({ severity: "error", code: "panel_missing", artworkId: art.id, message: `${art.name}：目标面板不存在` });
        if (!image && !art.content) issues.push({ severity: "error", code: "resource_missing", artworkId: art.id, message: `${art.name}：图稿未加载，不能完整交付` });
        if (dpi !== null && dpi < 300) issues.push({ severity: "warning", code: "low_resolution", artworkId: art.id, message: `${art.name}：有效分辨率 ${Math.round(dpi)} DPI，低于 300 DPI 检查参考值` });
        const path = (points: Point[]) => points.map(([x, y]) => ({ X: Math.round(x * 1000), Y: Math.round(y * 1000) }));
        const text = art.content?.kind === "text" && textMeasure ? packagingTextLayout(art, textMeasure(art)) : undefined;
        if (art.visible !== false && art.opacity > 0 && art.content?.kind === "text") {
            if (!art.content.value.trim()) issues.push({ severity: "warning", code: "empty_text", artworkId: art.id, message: `${art.name}：文字内容为空` });
            if (text && (text.width! > art.width + 0.01 || text.height > art.height + 0.01))
                issues.push({ severity: "error", code: "text_overflow", artworkId: art.id, message: `${art.name}：文字超出文本框，实际需要 ${text.width!.toFixed(1)} × ${text.height.toFixed(1)} mm；请扩大文本框或调整字号` });
            const safety = new ClipperLib.Clipper();
            safety.AddPath(
                path(
                    [
                        [0, 0],
                        [art.width, 0],
                        [art.width, art.height],
                        [0, art.height],
                    ].map(([x, y]) => artworkPoint(art, x - art.width / 2, y - art.height / 2)),
                ),
                ClipperLib.PolyType.ptSubject,
                true,
            );
            safety.AddPaths(safe.map(path), ClipperLib.PolyType.ptClip, true);
            const unsafe: ClipperLib.Paths = [];
            safety.Execute(ClipperLib.ClipType.ctDifference, unsafe, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
            if (Math.abs(unsafe.reduce((sum, polygon) => sum + ClipperLib.Clipper.Area(polygon), 0)) > 100)
                issues.push({ severity: "warning", code: "text_safety", artworkId: art.id, message: `${art.name}：文本框越过 3 mm 安全区，靠近切边、折线或开窗，请核对实际文字位置` });
        }
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
        if ((visibleAreaMm2 < 0.0001 || art.opacity === 0) && art.visible !== false) issues.push({ severity: "warning", code: "invisible_artwork", artworkId: art.id, message: `${art.name}：位于裁切区域外／开窗内，或透明度为 0` });
        return {
            id: art.id,
            name: art.name,
            kind: art.content?.kind || "image",
            visible: art.visible !== false,
            role: art.role,
            panelId: art.panelId,
            dpi,
            visibleAreaMm2,
            visibleFraction: visibleAreaMm2 / (art.width * art.height),
            ...(text ? { text: { lines: text.lines.length, widthMm: text.width, heightMm: text.height, fontSizeMm: text.fontSize } } : {}),
        };
    });
    if (document.artworks.some((a) => a.role === "artwork" && a.visible !== false)) issues.push({ severity: "warning", code: "bleed_review", message: "图稿允许延伸到出血区，但不会自动补图；请检查所有切边的实际出血覆盖" });
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
        scope: `设计文件自动检查；300 DPI 与 3 mm 文字安全区为检查参考值。${textMeasure ? "文字尺寸按当前浏览器字体测量。" : "未测量文字字形宽度。"}未验证色彩、印刷套准、最小工艺线宽或工厂白样。`,
    };
}
