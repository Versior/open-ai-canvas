import { afterEach, expect, mock, test } from "bun:test";
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
        await buildEcommerceSuiteArchive(rows, new Map([["hero", node]]), {
            readBlob: async () => new Blob(["original"], { type: "image/png" }),
            readTask: async (id) => ({ id, prompt: "Actual submitted prompt", model: "image-model", status: "succeeded", type: "canvas_image", attempts: 1, createdAt: "", updatedAt: "", inputJson: "PRIVATE_INPUT", resultJson: "PRIVATE_RESULT" }),
        }),
    );
    const text = await zip.get("manifest.json")!.text();
    const manifest = JSON.parse(text);
    expect(manifest.version).toBe(3);
    expect(manifest.entries[0].planning.prompt).toBe(rows[0].prompt);
    expect(manifest.entries[0].generation).toMatchObject({ taskId: "task-old", prompt: "Actual submitted prompt", status: "verified-task" });
    expect(text).not.toContain("Editable node prompt");
    expect(text).not.toContain("PRIVATE_INPUT");
    expect(text).not.toContain("PRIVATE_RESULT");
});
test("failed or missing task receipts never masquerade as verified generation", async () => {
    const node = { ...image, metadata: { ...image.metadata, taskId: "task" } };
    await expect(
        buildEcommerceSuiteArchive(rows, new Map([["hero", node]]), {
            readBlob: async () => new Blob(),
            readTask: async () => {
                throw new Error("Receipt unavailable");
            },
        }),
    ).rejects.toThrow("Receipt unavailable");
    await expect(
        buildEcommerceSuiteArchive(rows, new Map([["hero", node]]), {
            readBlob: async () => new Blob(),
            readTask: async (id) => ({ id, prompt: "", status: "running", type: "canvas_image", attempts: 1, createdAt: "", updatedAt: "" }),
        }),
    ).rejects.toThrow("生成任务未成功");
});
test("suite archive preserves original bytes and exports only explicit metadata", async () => {
    const original = new Blob(["original-image-bytes"], { type: "image/png" });
    const compose = mock(async () => new Blob(["must-not-run"], { type: "image/png" }));
    const zip = await readZip(await buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), { readBlob: async () => original, compose }));
    const manifestText = await zip.get("manifest.json")!.text();
    const manifest = JSON.parse(manifestText);
    expect(manifest.entries[0]).toMatchObject({ slotId: "hero", nodeId: "output", width: 1000, height: 1500, bytes: original.size, composition: { applied: false } });
    expect(manifestText).not.toContain("TEST_PRIVATE_VALUE");
    expect(manifestText).not.toContain("storageKey");
    expect(manifest.entries[0].file).not.toContain("../");
    expect(await zip.get(manifest.entries[0].file)!.text()).toBe(await original.text());
    expect(compose).not.toHaveBeenCalled();
    expect(zip.size).toBe(2);
});
test("suite archive rasterizes row copy and layout to PNG and records the composition", async () => {
    const copy = { headline: "轻盈防晒", subhead: "UPF50+", cta: "立即选购", price: "¥199" };
    const layout = { name: "主图", blocks: [{ id: "headline", field: "headline" as const, anchor: "top-left" as const, size: 8, color: "#000000", plate: "", align: "left" as const, inset: 6, bold: true }] };
    const compose = mock(async (blob: Blob, receivedCopy: typeof copy, receivedLayout: typeof layout) => {
        expect(await blob.text()).toBe("source");
        expect(receivedCopy).toEqual(copy);
        expect(receivedLayout).toEqual(layout);
        return new Blob(["composed"], { type: "image/png" });
    });
    const composedRows = [{ ...rows[0], copy, layout }];

    const zip = await readZip(await buildEcommerceSuiteArchive(composedRows, new Map([["hero", image]]), { readBlob: async () => new Blob(["source"], { type: "image/jpeg" }), compose }));
    const manifest = JSON.parse(await zip.get("manifest.json")!.text());
    expect(manifest.version).toBe(3);
    expect(manifest.entries[0]).toMatchObject({ copy, layout, composition: { applied: true } });
    expect(manifest.entries[0].file).toEndWith(".png");
    expect(await zip.get(manifest.entries[0].file)!.text()).toBe("composed");
});
test("a composition failure rejects the archive instead of returning partial files", async () => {
    const composedRows = [{ ...rows[0], copy: { headline: "标题", subhead: "", cta: "", price: "" }, layout: { name: "主图", blocks: [] } }];
    await expect(
        buildEcommerceSuiteArchive(composedRows, new Map([["hero", image]]), {
            readBlob: async () => new Blob(["source"], { type: "image/png" }),
            compose: async () => {
                throw new Error("composition failed");
            },
        }),
    ).rejects.toThrow("composition failed");
});
test("source images above the memory-safe archive limit are rejected before composition", async () => {
    const composedRows = [{ ...rows[0], copy: { headline: "标题", subhead: "", cta: "", price: "" }, layout: { name: "主图", blocks: [] } }];
    const compose = mock(async () => new Blob(["small"], { type: "image/png" }));
    const oversized = { type: "image/png", size: 65 * 1024 * 1024 } as Blob;
    await expect(buildEcommerceSuiteArchive(composedRows, new Map([["hero", image]]), { readBlob: async () => oversized, compose })).rejects.toThrow("超过 64MB");
    expect(compose).not.toHaveBeenCalled();
});
test("skipped rows do not require images or appear in the archive", async () => {
    const skipped = { slotId: "skip", title: "Skip", duty: "Skip it", prompt: "", enabled: false };
    const zip = await readZip(await buildEcommerceSuiteArchive([skipped, ...rows], new Map([["hero", image]]), { readBlob: async () => new Blob(["original"], { type: "image/png" }) }));
    const manifest = JSON.parse(await zip.get("manifest.json")!.text());
    expect(manifest.entries.map((entry: { slotId: string }) => entry.slotId)).toEqual(["hero"]);
    expect(manifest.entries[0].file).toContain("images/01_");
    await expect(buildEcommerceSuiteArchive([skipped], new Map())).rejects.toThrow("没有可导出的图片");
});
test("missing, failed, loading and unsupported images reject the entire export", async () => {
    for (const nodes of [new Map<string, CanvasNodeData>(), new Map([["hero", { ...image, metadata: { ...image.metadata, status: "error" as const } }]]), new Map([["hero", { ...image, metadata: { ...image.metadata, status: "loading" as const } }]])]) {
        await expect(buildEcommerceSuiteArchive(rows, nodes, { readBlob: async () => new Blob(["x"], { type: "image/png" }) })).rejects.toThrow("成功图片");
    }
    await expect(buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), { readBlob: async () => undefined })).rejects.toThrow("原图缺失");
    await expect(buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), { readBlob: async () => new Blob(["x"], { type: "text/html" }) })).rejects.toThrow("格式不支持");
    await expect(buildEcommerceSuiteArchive([], new Map())).rejects.toThrow("没有可导出的图片");
});
test("switching accounts during image retrieval cancels the export", async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } } });
    setActiveUserScope("account-a");
    await expect(
        buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), {
            readBlob: async () => {
                setActiveUserScope("account-b");
                return new Blob(["x"], { type: "image/png" });
            },
        }),
    ).rejects.toThrow("账号已切换");
});

test("source validation cancels a stale export after every async boundary and before ZIP creation", async () => {
    const copy = { headline: "标题", subhead: "副标题", cta: "立即购买", price: "¥199" };
    const layout = { name: "主图", blocks: [] };
    const composedRows = [{ ...rows[0], copy, layout }];
    const node = { ...image, metadata: { ...image.metadata, taskId: "task-current" } };
    const checkpoints: string[] = [];
    let phase = "start";
    const validateSource = () => {
        checkpoints.push(phase);
        if (checkpoints.length === 4) throw new Error("导出内容已变化");
    };

    await expect(
        buildEcommerceSuiteArchive(composedRows, new Map([["hero", node]]), {
            readBlob: async () => {
                phase = "blob";
                return new Blob(["source"], { type: "image/png" });
            },
            readTask: async (id) => {
                phase = "task";
                return { id, prompt: "Prompt", model: "image-model", status: "succeeded", type: "canvas_image", attempts: 1, createdAt: "", updatedAt: "" };
            },
            compose: async () => {
                phase = "composition";
                return new Blob(["composed"], { type: "image/png" });
            },
            assertSourceCurrent: validateSource,
        }),
    ).rejects.toThrow("导出内容已变化");
    expect(checkpoints).toEqual(["start", "task", "blob", "composition"]);
});

test("source validation rejects stale input before reading tasks, blobs or composing images", async () => {
    let reads = 0;

    await expect(
        buildEcommerceSuiteArchive(rows, new Map([["hero", image]]), {
            readTask: async () => {
                reads += 1;
                throw new Error("task must not be read");
            },
            readBlob: async () => {
                reads += 1;
                throw new Error("blob must not be read");
            },
            compose: async () => {
                reads += 1;
                throw new Error("image must not be composed");
            },
            assertSourceCurrent: () => {
                throw new Error("导出内容已变化");
            },
        }),
    ).rejects.toThrow("导出内容已变化");
    expect(reads).toBe(0);
});
