import { expect, test } from "bun:test";
import { rasterizeEcommerceDetailPage, rasterizeEcommerceLongImage } from "../src/lib/ecommerce/ecommerce-rasterize";

test("detail rasterization uses platform width, contiguous safe slices and matching PNG names", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const canvases: { width: number; height: number }[] = [];
    class TestImage {
        naturalWidth = 1500;
        naturalHeight = 2000;
        onload?: () => void;
        crossOrigin = "";
        set src(value: string) {
            if (value.startsWith("data:")) {
                const [, width, height] = value.split(",");
                this.naturalWidth = Number(width);
                this.naturalHeight = Number(height);
            }
            if (value === "oversize") this.naturalHeight = 100000;
            queueMicrotask(() => this.onload?.());
        }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => {
                const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: "" }), toDataURL: () => `data:image/png,${canvas.width},${canvas.height}` };
                canvases.push(canvas);
                return canvas;
            },
        },
    });
    try {
        const result = await rasterizeEcommerceDetailPage({ imageUrls: ["first", "second"], platform: "jd", code: "ITEM" });
        expect(result.longImage.width).toBe(790);
        expect(result.pieces).toHaveLength(2);
        expect(result.pieces.every((piece) => piece.height <= 1200)).toBe(true);
        expect(result.fileNames.every((name) => name.endsWith(".png"))).toBe(true);
        expect(result.plan.conflicts).toEqual([]);
        const count = canvases.length;
        await expect(rasterizeEcommerceLongImage({ imageUrls: ["oversize"] })).rejects.toThrow("安全合成尺寸");
        expect(canvases).toHaveLength(count);
        await expect(rasterizeEcommerceDetailPage({ imageUrls: ["first"], platform: "taobao", width: 1500 })).rejects.toThrow("安全切点");
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
