export type StudioFinishedDuplicate = { first: number; second: number; kind: "identical" | "near" };

type Signature = { width: number; height: number; pixels: Uint8ClampedArray; distinct: boolean };
const side = 64;

export function studioFinishedSampleIsDistinct(pixels: Uint8ClampedArray) {
    if (pixels.length !== side * side * 4) throw new Error("成品采样尺寸无效");
    let edges = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] !== 255) return false;
        if (offset % (side * 4) >= 4 && Math.max(Math.abs(pixels[offset] - pixels[offset - 4]), Math.abs(pixels[offset + 1] - pixels[offset - 3]), Math.abs(pixels[offset + 2] - pixels[offset - 2])) > 12) edges++;
    }
    return edges >= side * side * 0.04;
}

export function studioFinishedNearMatch(left: Signature, right: Signature) {
    if (!left.distinct || !right.distinct || left.width * right.height !== right.width * left.height) return false;
    const count = side * side;
    let total = 0;
    let changed = 0;
    for (let offset = 0; offset < left.pixels.length; offset += 4) {
        const delta = Math.max(Math.abs(left.pixels[offset] - right.pixels[offset]), Math.abs(left.pixels[offset + 1] - right.pixels[offset + 1]), Math.abs(left.pixels[offset + 2] - right.pixels[offset + 2]));
        total += delta;
        if (delta > 10) changed++;
        if (total > count * 2 || changed > count * 0.008) return false;
    }
    return true;
}

export async function inspectStudioFinishedDuplicates(images: readonly { url: string; output: { resourceId: string }; composed: boolean }[], signal: AbortSignal) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器无法读取成品像素");
    const samples: (Signature & { blob: Blob })[] = [];
    const findings: StudioFinishedDuplicate[] = [];
    try {
        for (const [second, image] of images.entries()) {
            signal.throwIfAborted();
            const reused = !image.composed && image.output.resourceId ? images.slice(0, second).findIndex((other) => !other.composed && other.output.resourceId === image.output.resourceId) : -1;
            if (reused >= 0) {
                samples.push(samples[reused]);
                findings.push({ first: reused, second, kind: "identical" });
                continue;
            }
            const response = await fetch(image.url, { signal });
            if (!response.ok) throw new Error("成品文件读取失败");
            const blob = await response.blob();
            signal.throwIfAborted();
            const bitmap = await createImageBitmap(blob);
            try {
                signal.throwIfAborted();
                context.clearRect(0, 0, side, side);
                context.imageSmoothingQuality = "high";
                context.drawImage(bitmap, 0, 0, side, side);
                const pixels = context.getImageData(0, 0, side, side).data;
                const current = { width: bitmap.width, height: bitmap.height, blob, pixels, distinct: studioFinishedSampleIsDistinct(pixels) };
                let nearest: StudioFinishedDuplicate | undefined;
                let bytes: Uint8Array | undefined;
                for (const [first, prior] of samples.entries()) {
                    if (prior.blob.size === blob.size && prior.width === current.width && prior.height === current.height) {
                        bytes ??= new Uint8Array(await blob.arrayBuffer());
                        const earlier = new Uint8Array(await prior.blob.arrayBuffer());
                        signal.throwIfAborted();
                        if (bytes.every((value, index) => value === earlier[index])) {
                            nearest = { first, second, kind: "identical" };
                            break;
                        }
                    }
                    if (!nearest && studioFinishedNearMatch(prior, current)) nearest = { first, second, kind: "near" };
                }
                samples.push(current);
                if (nearest) findings.push(nearest);
            } finally {
                bitmap.close();
            }
        }
        return findings;
    } finally {
        canvas.width = canvas.height = 0;
    }
}
