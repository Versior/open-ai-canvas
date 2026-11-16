import { packagingPanelBounds } from "./production";
import ClipperLib from "clipper-lib";
import { xmlText } from "@/lib/delivery-text";
import type { PackagingArtwork, PackagingDocument, PackagingLayout, PackagingRole, Point } from "./types";
import { packagingFonts, packagingTextLayout, preparePackagingTextContext, scalePackagingText, type PackagingTextMeasure } from "./typography";
export { packagingTextSize } from "./typography";

export const packagingResourceIds = (document: PackagingDocument) => [...new Set(document.artworks.filter((a) => !a.content).map((a) => a.resourceId))];
export const packagingVisibleLayers = (document: PackagingDocument, role?: PackagingRole) => document.artworks.filter((a) => a.visible !== false && (role === undefined || a.role === role));

export function packagingLayerMarkup(art: PackagingArtwork, image: string, color?: string, measure?: PackagingTextMeasure) {
    if (!art.content) return `<image href="${xmlText(image)}" x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" preserveAspectRatio="none"/>`;
    const c = art.content;
    const fill = xmlText(color || c.color);
    const text = c.kind === "text" ? packagingTextLayout(art, measure) : undefined;
    const body =
        c.kind === "shape"
            ? c.shape === "ellipse"
                ? `<ellipse cx="${art.width / 2}" cy="${art.height / 2}" rx="${art.width / 2}" ry="${art.height / 2}" fill="${fill}"/>`
                : `<rect width="${art.width}" height="${art.height}" fill="${fill}"/>`
            : text!.lines
                  .map(
                      (line, i) =>
                          `<text xml:space="preserve" x="${c.align === "center" ? art.width / 2 : c.align === "right" ? art.width : 0}" y="${text!.fontSize + i * text!.lineHeight}" text-anchor="${c.align === "center" ? "middle" : c.align === "right" ? "end" : "start"}" font-family="${packagingFonts[c.font]}" font-weight="${c.weight}" font-size="${text!.fontSize}" letter-spacing="${c.letterSpacing ?? 0}" fill="${fill}">${xmlText(line)}</text>`,
                  )
                  .join("");
    return `<svg x="${art.x}" y="${art.y}" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}" overflow="hidden">${body}</svg>`;
}

export function packagingLayerClip(art: PackagingArtwork, layout: PackagingLayout, bleed = 0): Point[][] {
    const panel = layout.panels.find((p) => p.id === art.panelId);
    if (!panel) return bleed && layout.bleed.length ? layout.bleed : layout.cuts;
    const original = [panel.points, ...panel.holes];
    if (!bleed) return original;
    const path = (points: Point[]) => points.map(([x, y]) => ({ X: Math.round(x * 1000), Y: Math.round(y * 1000) }));
    const offset = new ClipperLib.ClipperOffset(2, 250);
    offset.AddPath(path(panel.points), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const expanded: ClipperLib.Paths = [];
    offset.Execute(expanded, bleed * 1000);
    const outside = new ClipperLib.Clipper();
    outside.AddPaths(expanded, ClipperLib.PolyType.ptSubject, true);
    outside.AddPaths(layout.cuts.map(path), ClipperLib.PolyType.ptClip, true);
    const extra: ClipperLib.Paths = [];
    outside.Execute(ClipperLib.ClipType.ctDifference, extra, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
    const intersection = new ClipperLib.Clipper();
    intersection.AddPaths(extra, ClipperLib.PolyType.ptSubject, true);
    intersection.AddPaths(layout.bleed.map(path), ClipperLib.PolyType.ptClip, true);
    const bleedArea: ClipperLib.Paths = [];
    intersection.Execute(ClipperLib.ClipType.ctIntersection, bleedArea, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
    return [...original, ...bleedArea.map((polygon) => polygon.map(({ X, Y }): Point => [X / 1000, Y / 1000]))];
}

export function renderPackagingArtworkCanvas(document: PackagingDocument, layout: PackagingLayout, images: Map<string, HTMLImageElement>, resolution: number, role: PackagingRole, bleed = false) {
    const canvas = globalThis.document.createElement("canvas");
    const scale = resolution / Math.max(layout.bounds.width, layout.bounds.height);
    canvas.width = Math.max(1, Math.round(layout.bounds.width * scale));
    canvas.height = Math.max(1, Math.round(layout.bounds.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = role === "artwork" ? (bleed ? "white" : document.material.color) : "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.translate(-layout.bounds.x, -layout.bounds.y);
    for (const art of packagingVisibleLayers(document, role)) {
        if (!art.content && !images.has(art.resourceId)) throw new Error(`${art.name}：图稿尚未加载`);
        ctx.save();
        ctx.beginPath();
        for (const points of packagingLayerClip(art, layout, bleed && role === "artwork" ? document.parameters.bleed : 0)) {
            ctx.moveTo(...points[0]);
            points.slice(1).forEach((p) => ctx.lineTo(...p));
            ctx.closePath();
        }
        ctx.clip("evenodd");
        paintPackagingLayer(ctx, art, images, role !== "artwork");
        ctx.restore();
    }
    return canvas;
}

export function reflowPackagingLayers(document: PackagingDocument, oldLayout: PackagingLayout, layout: PackagingLayout) {
    return document.artworks.map((art) => {
        const before = oldLayout.panels.find((p) => p.id === art.panelId);
        const after = layout.panels.find((p) => p.id === art.panelId);
        if (!before || !after) return art;
        const a = packagingPanelBounds(before.points),
            b = packagingPanelBounds(after.points);
        const scale = Math.min(b.width / a.width, b.height / a.height);
        const width = art.width * scale,
            height = art.height * scale;
        return { ...art, ...scalePackagingText(art, scale), width, height, x: b.x + ((art.x + art.width / 2 - a.x) / a.width) * b.width - width / 2, y: b.y + ((art.y + art.height / 2 - a.y) / a.height) * b.height - height / 2 };
    });
}

// All canvas outputs use this painter; masks and printed artwork share coordinates and clipping.
export function paintPackagingLayer(ctx: CanvasRenderingContext2D, art: PackagingArtwork, images: Map<string, HTMLImageElement>, mask = false) {
    ctx.save();
    ctx.globalAlpha = art.opacity;
    ctx.translate(art.x + art.width / 2, art.y + art.height / 2);
    ctx.rotate((art.rotation * Math.PI) / 180);
    ctx.translate(-art.width / 2, -art.height / 2);
    ctx.beginPath();
    ctx.rect(0, 0, art.width, art.height);
    ctx.clip();
    if (art.content?.kind === "text") {
        preparePackagingTextContext(ctx, art, art.content);
        const text = packagingTextLayout(art, (value) => ctx.measureText(value));
        ctx.fillStyle = mask ? "white" : art.content.color;
        ctx.textAlign = art.content.align;
        ctx.textBaseline = "alphabetic";
        const x = art.content.align === "center" ? art.width / 2 : art.content.align === "right" ? art.width : 0;
        text.lines.forEach((line, i) => ctx.fillText(line, x, text.fontSize + i * text.lineHeight));
        ctx.restore();
        return;
    }
    if (art.content?.kind === "shape") {
        ctx.fillStyle = mask ? "white" : art.content.color;
        ctx.beginPath();
        if (art.content.shape === "ellipse") ctx.ellipse(art.width / 2, art.height / 2, art.width / 2, art.height / 2, 0, 0, Math.PI * 2);
        if (art.content.shape === "rectangle") ctx.rect(0, 0, art.width, art.height);
        ctx.fill();
        ctx.restore();
        return;
    }
    ctx.drawImage(images.get(art.resourceId)!, 0, 0, art.width, art.height);
    ctx.restore();
}
