import { expect, test } from "bun:test";
import { createEcommerceLayoutFromPreset, ecommerceLayoutBlockStyle } from "../src/lib/ecommerce/ecommerce-layout";
import { rasterizeEcommerceComposition, rasterizeEcommerceDetailPage, rasterizeEcommerceLayout, rasterizeEcommerceLongImage } from "../src/lib/ecommerce/ecommerce-rasterize";

test("bottom bar rasterization matches the DOM offsets without overlapping headline and subhead", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const writes: Array<{ text: string; y: number }> = [];
    const context = {
        beginPath() {},
        fill() {},
        fillRect() {},
        fillText(text: string, _x: number, y: number) {
            writes.push({ text, y });
        },
        measureText: (text: string) => ({ width: text.length * 10 }),
        roundRect() {},
        fillStyle: "",
        font: "",
        textBaseline: "",
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png,test" }) } });
    try {
        const size = { width: 400, height: 600 };
        const shortSide = Math.min(size.width, size.height);
        const layout = createEcommerceLayoutFromPreset("bottom-bar")!;
        await rasterizeEcommerceLayout({ imageUrl: "", layout, copy: { headline: "Headline", subhead: "Subhead", cta: "", price: "" }, size });

        const headline = layout.blocks.find((block) => block.field === "headline")!;
        const subhead = layout.blocks.find((block) => block.field === "subhead")!;
        const headlineStyle = ecommerceLayoutBlockStyle(headline, size) as Record<string, string | number>;
        const headlinePadding = headline.plate ? ((headline.inset * 0.22) / 100) * shortSide : 0;
        const headlineLineHeight = ((headline.size * 1.25) / 100) * shortSide;
        const expectedHeadlineTextY = size.height - Number(headlineStyle.bottom) - headlineLineHeight - headlinePadding;
        const headlineWrite = writes.find((write) => write.text === "Headline")!;
        const subheadWrite = writes.find((write) => write.text === "Subhead")!;

        expect(headlineWrite.y).toBeCloseTo(expectedHeadlineTextY);
        expect(headlineWrite.y + headlineLineHeight).toBeLessThanOrEqual(subheadWrite.y);
    } finally {
        if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
});

test("English copy wraps whole words before splitting an oversized word", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const writes: string[] = [];
    const context = {
        fillRect() {},
        fillText(text: string) {
            writes.push(text);
        },
        measureText: (text: string) => ({ width: text.length * 10 }),
        fillStyle: "",
        font: "",
        textBaseline: "",
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => "data:image/png,test" }) } });
    try {
        await rasterizeEcommerceLayout({
            imageUrl: "",
            layout: { name: "English", blocks: [{ id: "headline", field: "headline", anchor: "top-left", size: 10, color: "#000000", plate: "", align: "left", inset: 10, bold: true }] },
            copy: { headline: "Fresh extraordinary sale", subhead: "", cta: "", price: "" },
            size: { width: 100, height: 100 },
        });

        expect(writes).toEqual(["Fresh", "extraord", "inary", "sale"]);
    } finally {
        if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
});

test("composition keeps legacy images unchanged and otherwise uses the source natural size", async () => {
    expect(await rasterizeEcommerceComposition({ imageUrl: "legacy", copy: undefined, layout: undefined })).toBe("legacy");

    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const releases: string[] = [];
    class TestImage {
        naturalWidth = 640;
        naturalHeight = 480;
        onload?: () => void;
        source = "";
        set src(value: string) {
            this.source = value;
            queueMicrotask(() => this.onload?.());
        }
        removeAttribute(name: string) {
            if (name === "src") releases.push(this.source);
        }
    }
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            drawImage() {},
            fillRect() {},
            fillText() {},
            measureText: (text: string) => ({ width: text.length * 10 }),
            fillStyle: "",
            font: "",
            textBaseline: "",
        }),
        toDataURL: () => `data:image/png,${canvas.width}x${canvas.height}`,
    };
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
    try {
        const result = await rasterizeEcommerceComposition({
            imageUrl: "source",
            copy: { headline: "标题", subhead: "", cta: "", price: "" },
            layout: { name: "test", blocks: [{ id: "headline", field: "headline", anchor: "top-left", size: 8, color: "#000000", plate: "", align: "left", inset: 6, bold: true }] },
        });
        expect(result).toBe("data:image/png,640x480");
        expect(releases).toEqual(["source", "source"]);
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});

test("composition returns the source URL untouched when the layout renders no visible copy", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let loads = 0;
    let canvases = 0;
    class TestImage {
        naturalWidth = 640;
        naturalHeight = 480;
        onload?: () => void;
        set src(_value: string) {
            loads += 1;
            queueMicrotask(() => this.onload?.());
        }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => {
                canvases += 1;
                return { width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, fillText() {}, measureText: (text: string) => ({ width: text.length * 10 }), fillStyle: "", font: "", textBaseline: "" }), toDataURL: () => "data:image/png,transcoded" };
            },
        },
    });
    try {
        const layout = { name: "空字", blocks: [{ id: "headline", field: "headline" as const, anchor: "top-left" as const, size: 8, color: "#000000", plate: "", align: "left" as const, inset: 6, bold: true }] };
        expect(await rasterizeEcommerceComposition({ imageUrl: "image:untouched", copy: { headline: "", subhead: "", cta: "", price: "" }, layout })).toBe("image:untouched");
        expect({ loads, canvases }).toEqual({ loads: 0, canvases: 0 });
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
test("composition rejects oversized source pixels before creating a canvas", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let canvasCreates = 0;
    class TestImage {
        naturalWidth = 8000;
        naturalHeight = 5000;
        onload?: () => void;
        set src(_value: string) {
            queueMicrotask(() => this.onload?.());
        }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => {
                canvasCreates += 1;
                return {};
            },
        },
    });
    try {
        await expect(
            rasterizeEcommerceComposition({
                imageUrl: "oversized-source",
                copy: { headline: "Title", subhead: "", cta: "", price: "" },
                // 必须有真会画出来的字，否则会先走「无字原样返回」，测不到尺寸守卫。
                layout: { name: "test", blocks: [{ id: "headline", field: "headline" as const, anchor: "top-left" as const, size: 8, color: "#000000", plate: "", align: "left" as const, inset: 6, bold: true }] },
            }),
        ).rejects.toThrow("\u5b89\u5168\u5408\u6210\u5c3a\u5bf8");
        expect(canvasCreates).toBe(0);
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});

test("long image rasterization decodes and draws one source image at a time", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let activeDecodes = 0;
    let peakDecodes = 0;
    let loads = 0;
    let draws = 0;
    class TestImage {
        naturalWidth = 100;
        naturalHeight = 100;
        onload?: () => void;
        onerror?: () => void;
        set src(_value: string) {
            loads += 1;
            activeDecodes += 1;
            peakDecodes = Math.max(peakDecodes, activeDecodes);
            queueMicrotask(() => {
                activeDecodes -= 1;
                this.onload?.();
            });
        }
        removeAttribute() {}
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => ({
                    fillRect() {},
                    drawImage() {
                        draws += 1;
                    },
                    fillStyle: "",
                }),
                toDataURL: () => "data:image/png,sequential",
            }),
        },
    });
    try {
        await rasterizeEcommerceLongImage({ imageUrls: ["first", "second", "third"] });
        expect(peakDecodes).toBe(1);
        expect(loads).toBe(6);
        expect(draws).toBe(3);
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});

test("oversized long image stops after the sequential size pass", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const loads: string[] = [];
    const releases: string[] = [];
    let canvasCreates = 0;
    class TestImage {
        naturalWidth = 1000;
        naturalHeight = 1000;
        onload?: () => void;
        onerror?: () => void;
        source = "";
        set src(value: string) {
            this.source = value;
            loads.push(value);
            if (value === "too-tall") this.naturalHeight = 100000;
            queueMicrotask(() => this.onload?.());
        }
        removeAttribute(name: string) {
            if (name === "src") releases.push(this.source);
        }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => {
                canvasCreates += 1;
                return {};
            },
        },
    });
    try {
        await expect(rasterizeEcommerceLongImage({ imageUrls: ["first", "too-tall", "third"] })).rejects.toThrow("安全合成尺寸");
        expect(loads).toEqual(["first", "too-tall", "third"]);
        expect(releases).toEqual(loads);
        expect(canvasCreates).toBe(0);
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
test("long images use a stricter pixel budget before allocating a canvas", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let canvasCreates = 0;
    class TestImage {
        naturalWidth = 1000;
        naturalHeight = 26000;
        onload?: () => void;
        onerror?: () => void;
        set src(_value: string) {
            queueMicrotask(() => this.onload?.());
        }
        removeAttribute() {}
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => {
                canvasCreates += 1;
                return {};
            },
        },
    });
    try {
        await expect(rasterizeEcommerceLongImage({ imageUrls: ["large"], width: 800 })).rejects.toThrow("安全合成尺寸");
        expect(canvasCreates).toBe(0);
    } finally {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
test("detail rasterization uses platform width, contiguous safe slices and matching PNG names", async () => {
    const originals = Object.fromEntries(["Image", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const canvases: { width: number; height: number }[] = [];
    const loads: string[] = [];
    const releases: string[] = [];
    class TestImage {
        naturalWidth = 1500;
        naturalHeight = 2000;
        onload?: () => void;
        crossOrigin = "";
        source = "";
        set src(value: string) {
            this.source = value;
            loads.push(value);
            if (value.startsWith("data:")) {
                const [, width, height] = value.split(",");
                this.naturalWidth = Number(width);
                this.naturalHeight = Number(height);
            }
            if (value === "oversize") this.naturalHeight = 100000;
            queueMicrotask(() => this.onload?.());
        }
        removeAttribute(name: string) {
            if (name === "src") releases.push(this.source);
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
        expect(loads).toEqual(["first", "second", "first", "second"]);
        expect(releases).toEqual(loads);
        expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
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
