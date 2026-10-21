import { loadRasterImage } from "@/lib/image-raster";
import { imageToDataUrl } from "@/services/image-storage";
import { createZip } from "@/lib/zip";
import { inspectPatternSeams, printPixelSize, recolorPattern, withPrintDpi, type PatternPixels } from "@/lib/ecommerce/ecommerce-pattern-pixels";
import type { CanvasNodeData } from "@/types/canvas";
import { ecommercePrintSpec, ECOMMERCE_PRINT_SPEC_VERSION, ECOMMERCE_MOCKUP_SCENE_VERSION } from "@/lib/ecommerce/ecommerce-print-specs";
import { renderPrintMockup } from "@/lib/ecommerce/ecommerce-print-mockups";

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
export async function buildPatternPrintPack(node: CanvasNodeData, widthCm: number, heightCm: number, layout: "tile" | "contain" | "cover", listing = "", check?: () => void, printSpecId?: string) {
    const spec = ecommercePrintSpec(printSpecId);
    const pixels = await readPatternPixels(node);
    check?.();
    const seam = inspectPatternSeams(pixels);
    if (layout === "tile" && !seam.passed) throw new Error("满印验缝未通过，已停止。请检查图稿，或明确改选单区域排版");
    const size = spec ? { width: spec.width, height: spec.height, dpi: 300 } : printPixelSize(widthCm, heightCm),
        source = patternCanvas(pixels);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    if (size.width * size.height > 40_000_000 || size.width > 16384 || size.height > 16384) throw new Error("印刷规格超过本地处理上限");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不能处理图片");
    if (layout === "tile") {
        const pattern = ctx.createPattern(source, "repeat");
        if (!pattern) throw new Error("平铺图案创建失败");
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, size.width, size.height);
    } else {
        const inset = layout === "contain" && spec ? spec.safeMarginPct / 100 : 0;
        const scale = (layout === "contain" ? Math.min : Math.max)(size.width * (1 - inset * 2) / pixels.width, size.height * (1 - inset * 2) / pixels.height);
        ctx.drawImage(source, (size.width - pixels.width * scale) / 2, (size.height - pixels.height * scale) / 2, pixels.width * scale, pixels.height * scale);
    }
    const png = withPrintDpi(new Uint8Array(await (await canvasPng(canvas)).arrayBuffer()));
    check?.();
    const preview = document.createElement("canvas"),
        previewScale = Math.min(1, 1000 / size.width, 1000 / size.height);
    preview.width = Math.max(1, Math.round(size.width * previewScale));
    preview.height = Math.max(1, Math.round(size.height * previewScale));
    preview.getContext("2d")!.drawImage(canvas, 0, 0, preview.width, preview.height);
    const safeArea = spec ? { x: Math.round(size.width * spec.safeMarginPct / 100), y: Math.round(size.height * spec.safeMarginPct / 100), width: Math.round(size.width * (1 - spec.safeMarginPct / 50)), height: Math.round(size.height * (1 - spec.safeMarginPct / 50)) } : undefined;
    if (safeArea) {
        const guide = preview.getContext("2d")!;
        guide.strokeStyle = "#c54c32";
        guide.lineWidth = 2;
        guide.setLineDash([6, 4]);
        guide.strokeRect(safeArea.x * previewScale, safeArea.y * previewScale, safeArea.width * previewScale, safeArea.height * previewScale);
    }
    const manifest = {
        format: "yingce.print-pack",
        version: 2,
        sourceNodeId: node.id,
        sourceStorageKey: undefined,
        widthCm: spec ? spec.width / 300 * 2.54 : widthCm,
        heightCm: spec ? spec.height / 300 * 2.54 : heightCm,
        ...(spec ? { specId: spec.id, category: spec.category, specVersion: ECOMMERCE_PRINT_SPEC_VERSION, safeMarginPct: spec.safeMarginPct, mockupScene: ECOMMERCE_MOCKUP_SCENE_VERSION, mockupNote: "品类示意图，不是实拍或生产打样；量产前必须按目标机型、尺码与工厂模板核对" } : {}),
        ...size,
        layout,
        safeArea,
        safeAreaApplied: Boolean(safeArea && layout === "contain"),
        seam,
        listingIncluded: Boolean(listing),
        sourcePixels: { width: pixels.width, height: pixels.height },
        upscaled: size.width > pixels.width || size.height > pixels.height,
        review: "待核对承印商要求、色差、实际清晰度和裁切；不会把放大等同于增加原图细节",
    };
    const mockup = spec ? await canvasPng(await renderPrintMockup(spec.category, canvas)) : undefined;
    canvas.width = canvas.height = source.width = source.height = 0;
    check?.();
    const archive = await createZip([
        { name: "print-300dpi.png", data: png },
        { name: "preview.png", data: await canvasPng(preview) },
        { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
        ...(mockup ? [{ name: "product-mockup.png", data: mockup }] : []),
        ...(listing ? [{ name: "listing.md", data: listing }] : []),
    ]);
    check?.();
    return { archive, image: new Blob([png], { type: "image/png" }), manifest };
}
