import { afterEach, expect, test } from "bun:test";
import { buildEcommerceSuiteArchive } from "../src/services/ecommerce-suite-export";
import { readZip } from "../src/lib/zip";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { setActiveUserScope } from "../src/lib/user-scope";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});
const rows = [{ slotId: "hero", title: "../主图/产品", duty: "真实展示", prompt: "白底商品" }];
const image: CanvasNodeData = { id: "output", type: CanvasNodeType.Image, title: "Output", position: { x: 0, y: 0 }, metadata: { storageKey: "image:original", naturalWidth: 1000, naturalHeight: 1500, config: { apiKey: "TEST_PRIVATE_VALUE" } } };
test("old adopted images export their task prompt separately from the edited plan", async () => {
    const node = { ...image, metadata: { ...image.metadata, taskId: "task-old", prompt: "Editable node prompt" } };
    const zip = await readZip(
        await buildEcommerceSuiteArchive(
            rows,
            new Map([["hero", node]]),
            async () => new Blob(["original"], { type: "image/png" }),
            async (id) => ({ id, prompt: "Actual submitted prompt", model: "image-model", status: "succeeded", type: "canvas_image", attempts: 1, createdAt: "", updatedAt: "", inputJson: "PRIVATE_INPUT", resultJson: "PRIVATE_RESULT" }),
        ),
    );
    const text = await zip.get("manifest.json")!.text();
    const manifest = JSON.parse(text);
    expect(manifest.version).toBe(2);
    expect(manifest.entries[0].planning.prompt).toBe(rows[0].prompt);
    expect(manifest.entries[0].generation).toMatchObject({ taskId: "task-old", prompt: "Actual submitted prompt", status: "verified-task" });
    expect(text).not.toContain("Editable node prompt");
    expect(text).not.toContain("PRIVATE_INPUT");
    expect(text).not.toContain("PRIVATE_RESULT");
});
test("failed or missing task receipts never masquerade as verified generation", async () => {
    const node = { ...image, metadata: { ...image.metadata, taskId: "task" } };
    await expect(
        buildEcommerceSuiteArchive(
            rows,
            new Map([["hero", node]]),
            async () => new Blob(),
            async () => {
                throw new Error("Receipt unavailable");
            },
        ),
    ).rejects.toThrow("Receipt unavailable");
    await expect(
        buildEcommerceSuiteArchive(
            rows,
            new Map([["hero", node]]),
            async () => new Blob(),
            async (id) => ({ id, prompt: "", status: "running", type: "canvas_image", attempts: 1, createdAt: "", updatedAt: "" }),
        ),
    ).rejects.toThrow("生成任务未成功");
});
test("suite archive preserves original bytes and exports only explicit metadata", async () => {
    const original = new Blob(["original-image-bytes"], { type: "image/png" });
    const zip = await readZip(await buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), async () => original));
    const manifestText = await zip.get("manifest.json")!.text();
    const manifest = JSON.parse(manifestText);
    expect(manifest.entries[0]).toMatchObject({ slotId: "hero", nodeId: "output", width: 1000, height: 1500, bytes: original.size });
    expect(manifestText).not.toContain("TEST_PRIVATE_VALUE");
    expect(manifestText).not.toContain("storageKey");
    expect(manifest.entries[0].file).not.toContain("../");
    expect(await zip.get(manifest.entries[0].file)!.text()).toBe(await original.text());
    expect(zip.size).toBe(2);
});
test("missing, failed, loading and unsupported images reject the entire export", async () => {
    for (const nodes of [new Map<string, CanvasNodeData>(), new Map([["hero", { ...image, metadata: { ...image.metadata, status: "error" as const } }]]), new Map([["hero", { ...image, metadata: { ...image.metadata, status: "loading" as const } }]])]) {
        await expect(buildEcommerceSuiteArchive(rows, nodes, async () => new Blob(["x"], { type: "image/png" }))).rejects.toThrow("成功图片");
    }
    await expect(buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), async () => undefined)).rejects.toThrow("原图缺失");
    await expect(buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), async () => new Blob(["x"], { type: "text/html" }))).rejects.toThrow("格式不支持");
    await expect(buildEcommerceSuiteArchive([], new Map())).rejects.toThrow("没有可导出的图片");
});
test("switching accounts during image retrieval cancels the export", async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } } });
    setActiveUserScope("account-a");
    await expect(
        buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), async () => {
            setActiveUserScope("account-b");
            return new Blob(["x"], { type: "image/png" });
        }),
    ).rejects.toThrow("账号已切换");
});
