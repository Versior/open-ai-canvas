import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { ecommerceBindingImages, ecommerceBindingKey, finishEcommerceBinding } from "../src/lib/ecommerce/ecommerce-binding";
import { ecommerceBriefSlicePlatform } from "../src/lib/ecommerce/ecommerce-brief";
import { ecommerceOneClickFlow } from "../src/lib/ecommerce/ecommerce-oneclick";
import { connectEcommerceTableOutputs, ecommerceSelectedOutputs, ecommerceTableSource, openEcommerceTable } from "../src/lib/ecommerce/ecommerce-table";
import { ecommerceSuiteTargets } from "../src/lib/ecommerce/ecommerce-canvas-preset";
import { synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import { DEFAULT_ECOMMERCE_SETTING } from "../src/services/api/ecommerce";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

// Execute the real page callbacks with isolated media I/O; do not duplicate their guards.
const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
const start = page.indexOf("    const bindingRef = useRef(new Set<string>());");
const end = page.indexOf("    const canvasNodeActions =", start);
if (start < 0 || end < 0) throw new Error("Canvas binding callbacks not found");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(page.slice(start, end));
const generateStart = page.indexOf("    const generateEcommerceSuite = useCallback(");
const generateEnd = page.indexOf("    // 动作 Context", generateStart);
if (generateStart < 0 || generateEnd < 0) throw new Error("Canvas suite callback not found");
const generationCode = new Bun.Transpiler({ loader: "tsx" }).transformSync(page.slice(generateStart, generateEnd));

function bindingFixture(status: "running" | "failed" = "failed") {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 });
    const opened = openEcommerceTable([product], [], product.id, "detail");
    const images = ["hero", "detail"].map((slot) => createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { status: "success", storageKey: slot, content: `/${slot}.png`, ecommerceShotId: slot, ecommerceFlowId: "detail", ecommerceRunId: "run" }));
    const rows = images.map((image) => ({ slotId: image.metadata!.ecommerceShotId!, title: "", duty: "", prompt: "Show product", resultNodeId: image.id }));
    const table = { ...opened.table, metadata: { ...opened.table.metadata, ecommerceImageModel: "image", ecommerceSuite: { flow: "detail", source: "draft" as const, updatedAt: "", rows } } };
    product.metadata = { ...product.metadata, ecommerceOneClick: { flow: "detail", nodeIds: images.map((image) => image.id), slotIds: rows.map((row) => row.slotId), runId: "run", status } };
    const nodesRef = { current: [product, table, ...images] };
    const connectionsRef = { current: [...opened.connections, ...images.map((image) => ({ id: image.id, fromNodeId: table.id, toNodeId: image.id }))] };
    const bindingRef = { current: new Set<string>() };
    const exportEcommerceDetailPage = mock(async () => {});
    const rasterizeEcommerceDetailPage = mock(async (_input: { imageUrls: string[] }) => ({
        plan: { conflicts: [], overTotalHeight: false },
        longImage: { dataUrl: "long", height: 2000 },
        pieces: [{ index: 1, top: 0, height: 2000, dataUrl: "slice" }],
        fileNames: ["slice.png"],
    }));
    const setNodes = (update: (current: CanvasNodeData[]) => CanvasNodeData[]) => {
        nodesRef.current = update(nodesRef.current);
    };
    const dependencies = {
        useRef: () => bindingRef,
        useCallback: <T>(callback: T) => callback,
        useEffect: (callback: () => void) => {
            autoBind = callback;
        },
        nodesRef,
        connectionsRef,
        nodes: nodesRef.current,
        setNodes,
        projectLoaded: true,
        ecommerceTableSource,
        ecommerceOneClickFlow,
        ecommerceBriefSlicePlatform,
        ecommerceSelectedOutputs,
        ecommerceBindingImages,
        ecommerceBindingKey,
        finishEcommerceBinding,
        CanvasNodeType,
        nanoid,
        connectEcommerceTableOutputs,
        ecommerceSuiteTargets,
        synchronizeGenerationSpec,
        setConnections: (update: (current: typeof connectionsRef.current) => typeof connectionsRef.current) => {
            connectionsRef.current = update(connectionsRef.current);
        },
        enqueueGenerationBatch: mock(() => "batch"),
        focusCanvasImageNodes() {},
        getActiveUserScope: () => "test-account",
        useEcommerceSettings: { getState: () => ({ load: async () => DEFAULT_ECOMMERCE_SETTING }) },
        imageToDataUrl: async ({ storageKey }: { storageKey: string }) => `data:${storageKey}`,
        ecommerceSliceSpec: () => ({}),
        rasterizeEcommerceDetailPage,
        exportEcommerceDetailPage,
        generationErrorMessage: (error: Error) => error.message,
        message: { success() {}, error() {}, warning() {} },
    };
    let autoBind!: () => void;
    const render = () => {
        dependencies.nodes = nodesRef.current;
        return new Function(...Object.keys(dependencies), `${code}\nreturn bindEcommerceSuite;`)(...Object.values(dependencies)) as (node: CanvasNodeData, selectedRows: typeof rows) => Promise<void>;
    };
    const generate = () => {
        const context = { ...dependencies, bindingRef };
        return new Function(...Object.keys(context), `${generationCode}\nreturn generateEcommerceSuite;`)(...Object.values(context)) as (node: CanvasNodeData, flow: string) => Promise<boolean>;
    };
    return { product, table, rows, images, nodesRef, bindingRef, dependencies, exportEcommerceDetailPage, rasterizeEcommerceDetailPage, render, generate, runAutoBind: () => autoBind() };
}

test("failed automatic binding permits stitching the adopted images and clears the old plan", async () => {
    const f = bindingFixture();
    await f.render()(f.table, f.rows);
    expect(f.rasterizeEcommerceDetailPage).toHaveBeenCalledTimes(1);
    expect(f.rasterizeEcommerceDetailPage.mock.calls[0][0].imageUrls).toEqual(["data:hero", "data:detail"]);
    expect(f.exportEcommerceDetailPage).toHaveBeenCalledTimes(1);
    expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toBeUndefined();
});

test("a completed waiting plan can be taken over manually without triggering a second automatic export", async () => {
    const f = bindingFixture("running");
    const pending = f.render()(f.table, f.rows);
    void pending.catch(() => {});
    f.render();
    f.runAutoBind();
    await pending;
    expect(f.exportEcommerceDetailPage).toHaveBeenCalledTimes(1);
    expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toBeUndefined();
});

test("an active automatic export still blocks manual stitching", async () => {
    const f = bindingFixture("running");
    f.bindingRef.current.add(ecommerceBindingKey(f.product.id, f.product.metadata!.ecommerceOneClick!));
    await expect(f.render()(f.table, f.rows)).rejects.toThrow("正在装订");
    expect(f.rasterizeEcommerceDetailPage).not.toHaveBeenCalled();
    expect(f.exportEcommerceDetailPage).not.toHaveBeenCalled();
});

test("missing adopted images preserve the plan and release the manual lock", async () => {
    const f = bindingFixture();
    const plan = f.product.metadata!.ecommerceOneClick;
    f.nodesRef.current = f.nodesRef.current.filter((node) => node.id !== f.images[1].id);
    await expect(f.render()(f.table, f.rows)).rejects.toThrow("第 2 张尚无有效采用结果");
    expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toEqual(plan);
    expect(f.bindingRef.current.size).toBe(0);
    expect(f.exportEcommerceDetailPage).not.toHaveBeenCalled();
});

test("manual export failures release the lock and can be retried without regenerating images", async () => {
    const f = bindingFixture();
    f.exportEcommerceDetailPage.mockRejectedValueOnce(new Error("upload failed"));
    await expect(f.render()(f.table, f.rows)).rejects.toThrow("upload failed");
    expect(f.bindingRef.current.size).toBe(0);
    await f.render()(f.table, f.rows);
    expect(f.exportEcommerceDetailPage).toHaveBeenCalledTimes(2);
    expect(f.nodesRef.current).toHaveLength(4);
});

test("changing the connected product before settings finish cannot cancel a different product's plan", async () => {
    const f = bindingFixture();
    const original = f.product.metadata!.ecommerceOneClick;
    const pending = f.render()(f.table, f.rows);
    f.nodesRef.current[1] = { ...f.table, metadata: { ...f.table.metadata, ecommerceProductId: undefined } };
    const other = { ...f.product, id: "other-product" };
    f.nodesRef.current.push(other);
    f.dependencies.connectionsRef.current[0].fromNodeId = other.id;
    await expect(pending).rejects.toThrow("商品连接已变化");
    expect(other.metadata?.ecommerceOneClick).toEqual(original);
    expect(f.exportEcommerceDetailPage).not.toHaveBeenCalled();
    expect(f.bindingRef.current.size).toBe(0);
});

test("automatic export retains the product lock after cancellation until its I/O stops", async () => {
    const f = bindingFixture("running");
    let release!: () => void;
    const imageReady = new Promise<string>((resolve) => {
        release = () => resolve("data:image");
    });
    f.dependencies.imageToDataUrl = () => imageReady;
    f.render();
    f.runAutoBind();
    f.nodesRef.current[0] = { ...f.product, metadata: { ...f.product.metadata, ecommerceOneClick: undefined } };
    await expect(f.render()(f.table, f.rows)).rejects.toThrow("正在装订");
    // Let both image reads finish so the cancelled plan is rejected before upload.
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(f.exportEcommerceDetailPage).not.toHaveBeenCalled();
    expect(f.bindingRef.current.size).toBe(0);
});

test("a failed binding does not prevent a fresh suite with automatic binding disabled", async () => {
    const f = bindingFixture();
    expect(await f.generate()(f.table, "detail")).toBe(true);
    expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toBeUndefined();
    expect(f.dependencies.enqueueGenerationBatch).toHaveBeenCalledTimes(1);
    expect(f.nodesRef.current).toHaveLength(6);
});

test("a fresh automatic suite replaces only the failed plan with its new run and outputs", async () => {
    const f = bindingFixture();
    f.nodesRef.current[1].metadata!.ecommerceAutoBind = true;
    expect(await f.generate()(f.table, "detail")).toBe(true);
    const plan = f.nodesRef.current[0].metadata!.ecommerceOneClick!;
    expect(plan.runId).not.toBe("run");
    expect(plan.status).toBe("running");
    expect(plan.nodeIds).toEqual(f.nodesRef.current.slice(4).map((node) => node.id));
    expect(f.nodesRef.current.slice(4).every((node) => node.metadata?.ecommerceRunId === plan.runId)).toBe(true);
});

test("active manual stitching blocks a fresh suite even after it has cleared the old plan", async () => {
    const f = bindingFixture();
    f.nodesRef.current[0].metadata!.ecommerceOneClick = undefined;
    f.bindingRef.current.add(f.product.id);
    await expect(f.generate()(f.table, "detail")).rejects.toThrow("正在装订");
    expect(f.dependencies.enqueueGenerationBatch).not.toHaveBeenCalled();
});
