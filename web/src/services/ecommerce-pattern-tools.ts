import { loadRasterImage } from "@/lib/image-raster";
import { imageToDataUrl } from "@/services/image-storage";
import { createZip } from "@/lib/zip";
import { inspectPatternSeams, printPixelSize, recolorPattern, withPrintDpi, type PatternPixels } from "@/lib/ecommerce/ecommerce-pattern-pixels";
import type { CanvasNodeData } from "@/types/canvas";

export async function readPatternPixels(node: CanvasNodeData): Promise<PatternPixels> {
    const url = await imageToDataUrl({ url: node.metadata?.content, storageKey: node.metadata?.storageKey });
    const image = await loadRasterImage(url);
    if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error("图片超过 3200 万像素");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("浏览器不能处理图片");
    ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}
export function patternCanvas(pixels: PatternPixels) {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不能处理图片");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    return canvas;
}
export const canvasPng = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 编码失败"))), "image/png"));
export async function recolorPatternNode(node: CanvasNodeData, from: string, to: string, tolerance: number) {
    const result = recolorPattern(await readPatternPixels(node), from, to, tolerance);
    if (!result.changed) throw new Error("没有匹配到颜色，请核对源颜色或调整容差");
    return canvasPng(patternCanvas(result));
}
export async function buildPatternPrintPack(node: CanvasNodeData, widthCm: number, heightCm: number, layout: "tile" | "contain" | "cover", listing = "", check?: () => void) {
    const pixels = await readPatternPixels(node);
    check?.();
    const seam = inspectPatternSeams(pixels);
    if (layout === "tile" && !seam.passed) throw new Error("满印验缝未通过，已停止。请检查图稿，或明确改选单区域排版");
    const size = printPixelSize(widthCm, heightCm),
        source = patternCanvas(pixels);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不能处理图片");
    if (layout === "tile") {
        const pattern = ctx.createPattern(source, "repeat");
        if (!pattern) throw new Error("平铺图案创建失败");
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, size.width, size.height);
    } else {
        const scale = (layout === "contain" ? Math.min : Math.max)(size.width / pixels.width, size.height / pixels.height);
        ctx.drawImage(source, (size.width - pixels.width * scale) / 2, (size.height - pixels.height * scale) / 2, pixels.width * scale, pixels.height * scale);
    }
    const png = withPrintDpi(new Uint8Array(await (await canvasPng(canvas)).arrayBuffer()));
    check?.();
    const preview = document.createElement("canvas"),
        previewScale = Math.min(1, 1000 / size.width, 1000 / size.height);
    preview.width = Math.max(1, Math.round(size.width * previewScale));
    preview.height = Math.max(1, Math.round(size.height * previewScale));
    preview.getContext("2d")!.drawImage(canvas, 0, 0, preview.width, preview.height);
    const manifest = {
        format: "yingce.print-pack",
        version: 1,
        sourceNodeId: node.id,
        sourceStorageKey: undefined,
        widthCm,
        heightCm,
        ...size,
        layout,
        seam,
        listingIncluded: Boolean(listing),
        review: "待核对承印商要求、色差、实际清晰度和裁切；不会把放大等同于增加原图细节",
    };
    const archive = await createZip([
        { name: "print-300dpi.png", data: png },
        { name: "preview.png", data: await canvasPng(preview) },
        { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
        ...(listing ? [{ name: "listing.md", data: listing }] : []),
    ]);
    check?.();
    return { archive, image: new Blob([png], { type: "image/png" }), manifest };
}
