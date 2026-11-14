import type { PackagingArtwork, PackagingLayout, Point } from "./types";

export const artworkHandles = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
] as const;
export type ArtworkHandle = (typeof artworkHandles)[number];

export function artworkPoint(art: PackagingArtwork, x: number, y: number): Point {
    const angle = (art.rotation * Math.PI) / 180;
    return [art.x + art.width / 2 + x * Math.cos(angle) - y * Math.sin(angle), art.y + art.height / 2 + x * Math.sin(angle) + y * Math.cos(angle)];
}

export function artworkBounds(art: PackagingArtwork) {
    const points = ([-1, 1] as const).flatMap((x) => ([-1, 1] as const).map((y) => artworkPoint(art, (x * art.width) / 2, (y * art.height) / 2)));
    const x = Math.min(...points.map((p) => p[0]));
    const y = Math.min(...points.map((p) => p[1]));
    return { x, y, width: Math.max(...points.map((p) => p[0])) - x, height: Math.max(...points.map((p) => p[1])) - y };
}

export function artworkEditorBounds(layout: PackagingLayout, artworks: PackagingArtwork[]) {
    const boxes = [layout.bounds, ...artworks.map(artworkBounds)];
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

export function resizePackagingArtwork(art: PackagingArtwork, handle: ArtworkHandle, delta: Point, keepRatio: boolean) {
    const angle = (art.rotation * Math.PI) / 180;
    const dx = delta[0] * Math.cos(angle) + delta[1] * Math.sin(angle);
    const dy = -delta[0] * Math.sin(angle) + delta[1] * Math.cos(angle);
    const desiredWidth = art.width + handle[0] * dx;
    const desiredHeight = art.height + handle[1] * dy;
    const factor = Math.max(0.1 / Math.min(art.width, art.height), Math.min(8000 / Math.max(art.width, art.height), (art.width * desiredWidth + art.height * desiredHeight) / (art.width ** 2 + art.height ** 2)));
    const proportional = keepRatio && handle[0] !== 0 && handle[1] !== 0;
    const width = Math.max(0.1, Math.min(8000, proportional ? art.width * factor : desiredWidth));
    const height = Math.max(0.1, Math.min(8000, proportional ? art.height * factor : desiredHeight));
    // Shift the centre in the rotated frame so the opposite anchor stays fixed.
    const center = artworkPoint(art, (handle[0] * (width - art.width)) / 2, (handle[1] * (height - art.height)) / 2);
    return { x: center[0] - width / 2, y: center[1] - height / 2, width, height };
}

export function rotatePackagingArtwork(art: PackagingArtwork, start: Point, current: Point, snap: boolean) {
    const center: Point = [art.x + art.width / 2, art.y + art.height / 2];
    const angle = art.rotation + ((Math.atan2(current[1] - center[1], current[0] - center[0]) - Math.atan2(start[1] - center[1], start[0] - center[0])) * 180) / Math.PI;
    const rotation = snap ? Math.round(angle / 15) * 15 : angle;
    return { rotation: ((((rotation + 180) % 360) + 360) % 360) - 180 };
}

export function movePackagingArtwork(art: PackagingArtwork, delta: Point, target: PackagingLayout["bounds"], tolerance: number, snap: boolean) {
    const moved = { ...art, x: art.x + delta[0], y: art.y + delta[1] };
    if (!snap) return { x: moved.x, y: moved.y, guides: [] as { axis: "x" | "y"; value: number }[] };
    const bounds = artworkBounds(moved);
    const align = (axis: "x" | "y", size: "width" | "height") => {
        const matches = [target[axis], target[axis] + target[size] / 2, target[axis] + target[size]].flatMap((value) => [bounds[axis], bounds[axis] + bounds[size] / 2, bounds[axis] + bounds[size]].map((source) => ({ value, offset: value - source })));
        const nearest = matches.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))[0];
        return Math.abs(nearest.offset) <= tolerance ? { position: moved[axis] + nearest.offset, guide: { axis, value: nearest.value } } : { position: Math.round(moved[axis]) };
    };
    const x = align("x", "width");
    const y = align("y", "height");
    return { x: x.position, y: y.position, guides: [x.guide, y.guide].filter((g) => g !== undefined) };
}

export function packagingMaskLuminance(red: number, green: number, blue: number) {
    return Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
}
