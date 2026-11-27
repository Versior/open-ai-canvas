import { studioAttemptForOutput } from "./product";
import type { StudioShot } from "./types";

export const STUDIO_DETAIL_OVERLAP = 0.1;
export const STUDIO_DETAIL_EDGE_DEPTH = 0.024;

export function studioDetailEdgeColors(pixels: Uint8ClampedArray, width: number, height: number) {
    const stops = Math.min(9, width);
    return Array.from({ length: stops }, (_, index) => {
        const left = Math.floor((index * width) / stops);
        const right = Math.floor(((index + 1) * width) / stops);
        const channels = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
        for (let row = 0; row < height; row++) {
            for (let column = left; column < right; column++) {
                const offset = (row * width + column) * 4;
                channels.forEach((histogram, channel) => {
                    histogram[pixels[offset + channel]]++;
                });
            }
        }
        const median = Math.ceil(((right - left) * height) / 2);
        return channels.map((histogram) => {
            let total = 0;
            return histogram.findIndex((count) => (total += count) >= median);
        });
    });
}

export function studioDetailJoinGuide(shot: StudioShot, resourceId: string, previousResourceId: string, previousScreen: number) {
    const continuity = studioAttemptForOutput(shot, resourceId)?.input?.compiled.continuity;
    if (continuity?.previousScreen !== previousScreen || continuity.anchor?.sourceResourceId !== previousResourceId || !continuity.reference?.resourceId) return undefined;
    if (continuity.guide === "context" || continuity.guide === "background" || continuity.guide === "edge") return { kind: continuity.guide };
    if (continuity.guide === "positioned" && continuity.anchor.height && continuity.reference.width) {
        return { kind: "positioned" as const, height: continuity.anchor.height, width: continuity.reference.width };
    }
}

function hasRepeatedAxis(pixels: Uint8ClampedArray, width: number, height: number, vertical: boolean) {
    const length = vertical ? height : width;
    const across = vertical ? width : height;
    const step = vertical ? width : 1;
    const crossStep = vertical ? 1 : width;
    for (let shift = 1; shift <= Math.floor(length / 2); shift++) {
        let distinguishable = false;
        for (let trace = 0; trace < 4 && !distinguishable; trace++) {
            const base = Math.floor(((trace + 0.5) * across) / 4) * crossStep;
            const interval = Math.max(1, Math.floor((length - shift) / 32));
            for (let position = 0; position < length - shift && !distinguishable; position += interval) {
                const start = (base + position * step) * 4;
                const other = start + shift * step * 4;
                for (let channel = 0; channel < 3; channel++) if (Math.abs(pixels[start + channel] - pixels[other + channel]) > 12) distinguishable = true;
            }
        }
        if (!distinguishable) return true;
    }
    return false;
}

function hasDistinctStructure(pixels: Uint8ClampedArray, width: number, height: number, area: "overlap" | "top" | "bottom") {
    const stride = width * 4;
    const requireDepth = area === "overlap";
    const firstRow = requireDepth ? 2 : area === "bottom" ? height - 1 : 0;
    const lastRow = requireDepth ? height - 2 : firstRow + 1;
    for (let region = 0; region < 3; region++) {
        const start = Math.max(2, Math.floor((region * width) / 3));
        const end = Math.min(width - 2, Math.floor(((region + 1) * width) / 3));
        let across = false;
        let depth = !requireDepth;
        for (let row = firstRow; row < lastRow && !(across && depth); row++) {
            for (let column = start; column < end && !(across && depth); column++) {
                const pixel = row * stride + column * 4;
                for (let channel = 0; channel < 3; channel++) {
                    const offset = pixel + channel;
                    const center = 2 * pixels[offset];
                    if (Math.abs(center - pixels[offset - 8] - pixels[offset + 8]) > 12) across = true;
                    if (!depth && Math.abs(center - pixels[offset - 2 * stride] - pixels[offset + 2 * stride]) > 12) depth = true;
                }
            }
        }
        if (!across || !depth) return false;
    }
    if (!requireDepth) return !hasRepeatedAxis(pixels.subarray(firstRow * stride, lastRow * stride), width, 1, false);
    return !hasRepeatedAxis(pixels, width, height, false) && !hasRepeatedAxis(pixels, width, height, true);
}

function matchingBandPixels(previous: Uint8ClampedArray, current: Uint8ClampedArray, width: number, height: number, order: "overlap" | "continuation") {
    const stride = width * 4;
    const boundary = (height - 1) * stride;
    let error = 0;
    for (let row = 0; row < height; row++) {
        const source = (order === "continuation" ? height - 1 - row : row) * stride;
        for (let column = 0; column < stride; column += 4) {
            const offset = source + column;
            const other = row * stride + column;
            if (previous[offset + 3] !== 255 || current[other + 3] !== 255) return false;
            for (let channel = 0; channel < 3; channel++) {
                const expected = order === "overlap" ? previous[offset + channel] : current[column + channel] + previous[boundary + column + channel] - previous[offset + channel];
                const difference = Math.abs(expected - current[other + channel]);
                if (difference > 12) return false;
                error += difference;
            }
        }
    }
    return error <= width * height * 3 * 3;
}

export function verifiedStudioOverlap(previous: Uint8ClampedArray, current: Uint8ClampedArray, width: number, height: number) {
    if (height < 8 || width < 16 || previous.length !== width * height * 4 || previous.length !== current.length) return false;
    return matchingBandPixels(previous, current, width, height, "overlap") && hasDistinctStructure(previous, width, height, "overlap") && hasDistinctStructure(current, width, height, "overlap");
}

export type StudioEdgeStatus = "matched" | "compatible" | "unmatched";

export function studioBackgroundJoin(previous: Uint8ClampedArray, current: Uint8ClampedArray, width: number, height: number): { status: StudioEdgeStatus } {
    const stride = width * 4;
    if (height < 8 || width < 16 || previous.length !== stride * height || current.length !== previous.length) return { status: "unmatched" };
    const boundary = previous.length - stride;
    for (let index = 0; index < stride; index++) {
        if (index % 4 === 3 && (previous[boundary + index] !== 255 || current[index] !== 255)) return { status: "unmatched" };
        if (Math.abs(previous[boundary + index] - current[index]) > 12) return { status: "unmatched" };
    }
    if (hasDistinctStructure(previous, width, height, "bottom") && hasDistinctStructure(current, width, height, "top") && matchingBandPixels(previous, current, width, height, "continuation")) return { status: "matched" };

    for (const band of [previous, current]) {
        const boundaryOffset = band === previous ? boundary : 0;
        for (let row = 0; row < band.length; row += stride) {
            for (let column = 0; column < stride; column += 4) {
                const pixel = row + column;
                if (band[pixel + 3] !== 255) return { status: "unmatched" };
                for (let channel = 0; channel < 3; channel++) {
                    const offset = pixel + channel;
                    if ((column > 0 && Math.abs(band[offset] - band[offset - 4]) > 8) || (row > 0 && Math.abs(band[offset] - band[offset - stride]) > 8) || Math.abs(band[offset] - band[boundaryOffset + column + channel]) > 24)
                        return { status: "unmatched" };
                }
            }
        }
    }
    return { status: "compatible" };
}
