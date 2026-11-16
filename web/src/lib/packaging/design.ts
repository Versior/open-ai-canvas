import ClipperLib from "clipper-lib";
import { artworkBounds } from "./artwork";
import { packagingPanelBounds } from "./production";
import { scalePackagingText } from "./typography";
import type { PackagingArtwork, PackagingLayout, PackagingPanel, Point } from "./types";

export function alignPackagingLayer(art: PackagingArtwork, bounds: PackagingLayout["bounds"], x: 0 | 0.5 | 1, y: 0 | 0.5 | 1) {
    const box = artworkBounds(art);
    return { x: art.x + bounds.x + (bounds.width - box.width) * x - box.x, y: art.y + bounds.y + (bounds.height - box.height) * y - box.y };
}

export function transferPackagingLayer(art: PackagingArtwork, source: PackagingPanel, target: PackagingPanel) {
    const from = packagingPanelBounds(source.points),
        to = packagingPanelBounds(target.points);
    const factor = Math.min(to.width / from.width, to.height / from.height);
    const width = art.width * factor,
        height = art.height * factor;
    return {
        ...art,
        ...scalePackagingText(art, factor),
        panelId: target.id,
        width,
        height,
        x: to.x + ((art.x + art.width / 2 - from.x) / from.width) * to.width - width / 2,
        y: to.y + ((art.y + art.height / 2 - from.y) / from.height) * to.height - height / 2,
    };
}

export function packagingSafeArea(layout: PackagingLayout, margin = 3): Point[][] {
    return layout.panels.flatMap((panel) => {
        const offset = new ClipperLib.ClipperOffset(2, 250);
        const paths = [panel.points, ...panel.holes].map((points) => points.map(([x, y]) => ({ X: Math.round(x * 1000), Y: Math.round(y * 1000) })));
        if (ClipperLib.Clipper.Area(paths[0]) < 0) paths[0].reverse();
        paths.slice(1).forEach((hole) => {
            if (ClipperLib.Clipper.Area(hole) > 0) hole.reverse();
        });
        offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
        const safe: ClipperLib.Paths = [];
        offset.Execute(safe, -margin * 1000);
        return safe.map((path) => path.map(({ X, Y }): Point => [X / 1000, Y / 1000]));
    });
}
