import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { inspectStudioFinishedDuplicates, studioFinishedNearMatch, studioFinishedSampleIsDistinct } from "@/pages/ecommerce-studio/studio-finished-duplicates";

const pixels = (value: (column: number, row: number) => number) => Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, index) => (index % 4 === 3 ? 255 : value(Math.floor(index / 4) % 64, Math.floor(index / 256))));
const pattern = (column: number, row: number) => (column < 32 ? 75 : 180) + ((column * 29 + row * 7) % 32);
const sample = (rgba: Uint8ClampedArray, width = 300, height = 400) => ({ width, height, pixels: rgba, distinct: studioFinishedSampleIsDistinct(rgba) });

test("同样配色、镜像构图、局部改排、低信息背景或透明不判为近乎同图，微小压缩差可识别", () => {
    const source = sample(pixels(pattern));
    expect(source.distinct).toBe(true);
    expect(
        studioFinishedNearMatch(
            source,
            sample(
                pixels((column, row) => pattern(column, row) + ((row % 3) - 1)),
                600,
                800,
            ),
        ),
    ).toBe(true);
    expect(studioFinishedNearMatch(source, sample(pixels((column, row) => pattern(63 - column, row))))).toBe(false);
    expect(studioFinishedNearMatch(source, sample(pixels((column, row) => (row < 8 && column < 12 ? 230 : pattern(column, row)))))).toBe(false);
    expect(studioFinishedNearMatch(source, sample(source.pixels, 400, 300))).toBe(false);
    expect(studioFinishedNearMatch(sample(pixels(() => 100)), sample(pixels(() => 101)))).toBe(false);
    const transparent = source.pixels.slice();
    transparent[3] = 250;
    expect(studioFinishedNearMatch(source, sample(transparent))).toBe(false);
});

function browserSampling(setup?: () => void) {
    const browser = new Window();
    const saved = ["document", "createImageBitmap"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    const canvas = browser.document.createElement("canvas");
    const closes: string[] = [];
    let key = "";
    let reads = 0;
    const urls: string[] = [];
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
    Object.defineProperty(canvas, "getContext", {
        value: () => ({
            clearRect() {},
            drawImage(bitmap: { key: string }) {
                key = bitmap.key;
            },
            getImageData: () => ({ data: pixels((column, row) => (key === "different" ? pattern(63 - column, row) : pattern(column, row) + (key === "compressed" ? 1 : 0))) }),
        }),
    });
    Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        value: async (blob: Blob) => {
            const value = await blob.text();
            reads++;
            setup?.();
            return { width: 300, height: 400, key: value, close: () => closes.push(value) };
        },
    });
    const image = (resourceId: string, value: string, composed = false) => {
        const url = URL.createObjectURL(new Blob([value], { type: "image/png" }));
        urls.push(url);
        return { output: { resourceId }, url, composed };
    };
    return {
        canvas,
        closes,
        image,
        readCount: () => reads,
        release: () => {
            for (const url of urls) URL.revokeObjectURL(url);
            for (const [name, item] of saved)
                if (item) Object.defineProperty(globalThis, name, item);
                else Reflect.deleteProperty(globalThis, name);
            void browser.close();
        },
    };
}

test("真实读取 Blob：同资源和异资源同文件均为精确重复；已排字旧底图须比较最终文件", async () => {
    const runtime = browserSampling();
    try {
        const images = [runtime.image("first", "actual"), runtime.image("second", "different"), runtime.image("first", "not-read"), runtime.image("fourth", "actual"), runtime.image("fifth", "compressed"), runtime.image("first", "different", true)];
        expect(await inspectStudioFinishedDuplicates(images, new AbortController().signal)).toEqual([
            { first: 0, second: 2, kind: "identical" },
            { first: 0, second: 3, kind: "identical" },
            { first: 0, second: 4, kind: "near" },
            { first: 1, second: 5, kind: "identical" },
        ]);
        expect(runtime.readCount()).toBe(5);
        expect(runtime.closes).toHaveLength(5);
        expect(runtime.canvas.width).toBe(0);
        expect(runtime.canvas.height).toBe(0);
    } finally {
        runtime.release();
    }
});

test("关闭预览中断读取，不继续读取后续成品、释放已解码像素，不修改原件 URL", async () => {
    const controller = new AbortController();
    const runtime = browserSampling(() => controller.abort());
    try {
        const images = [runtime.image("first", "first"), runtime.image("second", "second")];
        await expect(inspectStudioFinishedDuplicates(images, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(runtime.closes).toEqual(["first"]);
        expect(runtime.canvas.width).toBe(0);
        expect(await (await fetch(images[0].url)).text()).toBe("first");
    } finally {
        runtime.release();
    }
});
