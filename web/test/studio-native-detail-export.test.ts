import { expect, mock, spyOn, test } from "bun:test";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import { createStudioRun } from "@/lib/ecommerce-studio/runs";
import { captureUserSession, setActiveUserScope } from "@/lib/user-scope";
import { exportStudioNativeDetail } from "@/pages/ecommerce-studio/studio-delivery";
import * as resources from "@/services/api/resources";

function chapter(id: string, status: "succeeded" | "failed") {
    const product = createStudioProduct(id);
    product.brief.outputType = "poster";
    const run = createStudioRun(product, () => crypto.randomUUID());
    const output = { resourceId: `${id}-image`, url: "" };
    run.shots[0].attempts.push({ id: `${id}-attempt`, status, model: "image", textMode: "model", createdAt: run.createdAt, outputs: [output], tweaks: [] });
    product.runs.push(run);
    return { product, output };
}

test("原图解码期间取消章节导出：释放刚解码的位图，不绘图也不返回 ZIP", async () => {
    const previousUser = captureUserSession().userId;
    const globals = ["createImageBitmap", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    const controller = new AbortController();
    const close = mock(() => {});
    const getContext = mock(() => null);
    const source = new Blob(["original"], { type: "image/png" });
    const read = spyOn(resources, "getResourceBlob").mockResolvedValue(source);
    const decode = mock(async (_source: Blob) => {
        controller.abort();
        return { width: 1080, height: 1920, close };
    });
    try {
        setActiveUserScope("chapter-owner");
        Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: decode });
        Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ getContext }) } });
        const { product, output } = chapter("glasses", "succeeded");
        await expect(exportStudioNativeDetail(product, output, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(decode).toHaveBeenCalledWith(source);
        expect(close).toHaveBeenCalledTimes(1);
        expect(getContext).not.toHaveBeenCalled();
    } finally {
        read.mockRestore();
        for (const [key, descriptor] of globals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        setActiveUserScope(previousUser);
    }
});

test("当前商品的失败候选和其他商品的成功候选均在读取原图前被拒绝", async () => {
    const previousUser = captureUserSession().userId;
    const read = spyOn(resources, "getResourceBlob").mockResolvedValue(null);
    try {
        setActiveUserScope("chapter-owner");
        const current = chapter("glasses", "failed");
        const other = chapter("case", "succeeded");
        for (const output of [current.output, other.output]) await expect(exportStudioNativeDetail(current.product, output)).rejects.toThrow("当前商品已完成的原生图片");
        expect(read).not.toHaveBeenCalled();
    } finally {
        read.mockRestore();
        setActiveUserScope(previousUser);
    }
});
