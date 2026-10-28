import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { ecommerceBindingImages, ecommerceBindingKey, finishEcommerceBinding } from "../src/lib/ecommerce/ecommerce-binding";
import { ecommerceBriefSlicePlatform } from "../src/lib/ecommerce/ecommerce-brief";
import { ecommerceOneClickFlow } from "../src/lib/ecommerce/ecommerce-oneclick";
import { connectEcommerceTableOutputs, ecommerceSelectedOutputs, ecommerceTableSource, openEcommerceTable } from "../src/lib/ecommerce/ecommerce-table";
import { ecommerceSuiteTargets } from "../src/lib/ecommerce/ecommerce-canvas-preset";
import { synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-project-generation";
import { resetGenerationTaskMetadata } from "../src/lib/canvas/canvas-task-state";
import { createCanvasBatchInputSnapshot } from "../src/lib/canvas/canvas-batch-input-snapshot";
import { connectedStyleReferenceNodes, ecommerceProductReferenceImages } from "../src/lib/ecommerce/ecommerce-canvas";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import { DEFAULT_ECOMMERCE_SETTING } from "../src/services/api/ecommerce";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { defaultConfig } from "../src/stores/use-config-store";

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
    const images = ["hero", "detail"].map((slot) =>
        createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { status: "success", storageKey: slot, content: `/${slot}.png`, ecommerceShotId: slot, ecommerceFlowId: "detail", ecommerceRunId: "run", batchResultInputSignature: "source-signature" }),
    );
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
    const rasterizeEcommerceComposition = mock(async ({ imageUrl }: { imageUrl: string }) => imageUrl);
    const setNodes = (update: (current: CanvasNodeData[]) => CanvasNodeData[]) => {
        nodesRef.current = update(nodesRef.current);
    };
    const selectedNodeIdsRef = { current: new Set([table.id]) };
    const setSelectedNodeIds = (next: Set<string>) => {
        selectedNodeIdsRef.current = next;
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
        ecommerceGenerationSourceSignature: () => "source-signature",
        ecommerceProductReferenceImages,
        connectedStyleReferenceNodes,
        buildGenerationConfig,
        resetGenerationTaskMetadata,
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
        selectedNodeIdsRef,
        setSelectedNodeIds,
        focusCanvasImageNodes(nodeIds: string[]) {
            setSelectedNodeIds(new Set(nodeIds));
        },
        getActiveUserScope: () => "test-account",
        useEcommerceSettings: { getState: () => ({ load: async () => DEFAULT_ECOMMERCE_SETTING }) },
        assets: [],
        useEcommerceModelLibrary: { getState: () => ({ models: [] }) },
        createCanvasBatchInputSnapshot,
        imageToDataUrl: async ({ storageKey }: { storageKey: string }) => `data:${storageKey}`,
        ecommerceSliceSpec: () => ({}),
        rasterizeEcommerceComposition,
        rasterizeEcommerceDetailPage,
        exportEcommerceDetailPage,
        generationErrorMessage: (error: Error) => error.message,
        effectiveConfig: { ...defaultConfig, imageModel: "default-image" },
        resolveEcommerceTableModels: mock((_config: unknown, overrides: { imageModel?: string }) => ({
            analysisModel: "",
            imageModel: overrides.imageModel === "deleted-image" ? "" : overrides.imageModel || "default-image",
        })),
        message: { success: mock(() => {}), error: mock(() => {}), warning: mock(() => {}) },
    };
    let autoBind!: () => void;
    const render = () => {
        dependencies.nodes = nodesRef.current;
        return new Function(...Object.keys(dependencies), `${code}\nreturn bindEcommerceSuite;`)(...Object.values(dependencies)) as (node: CanvasNodeData, selectedRows: typeof rows) => Promise<void>;
    };
    const generate = () => {
        const context = { ...dependencies, bindingRef, ecommerceResultSourceSignature: () => "suite-signature" };
        return new Function(...Object.keys(context), `${generationCode}\nreturn generateEcommerceSuite;`)(...Object.values(context)) as (
            node: CanvasNodeData,
            flow: string,
            slotIds?: string[],
            rows?: typeof rows,
            completeSuite?: boolean,
        ) => Promise<boolean>;
    };
    return { product, table, rows, images, nodesRef, bindingRef, dependencies, exportEcommerceDetailPage, rasterizeEcommerceComposition, rasterizeEcommerceDetailPage, render, generate, runAutoBind: () => autoBind() };
}

test("failed automatic binding permits stitching the adopted images and clears the old plan", async () => {
    const f = bindingFixture();
    await f.render()(f.table, f.rows);
    expect(f.rasterizeEcommerceDetailPage).toHaveBeenCalledTimes(1);
    expect(f.rasterizeEcommerceDetailPage.mock.calls[0][0].imageUrls).toEqual(["data:hero", "data:detail"]);
    expect(f.exportEcommerceDetailPage).toHaveBeenCalledTimes(1);
    expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toBeUndefined();
});

test("manual binding composes each adopted image from its suite row before stitching", async () => {
    const f = bindingFixture();
    const copy = { headline: "轻盈防晒", subhead: "UPF50+", cta: "", price: "" };
    const layout = { name: "详情屏", blocks: [] };
    Object.assign(f.rows[0], { copy, layout });
    f.dependencies.rasterizeEcommerceComposition = mock(async ({ imageUrl }: { imageUrl: string }) => `composed:${imageUrl}`);

    await f.render()(f.table, f.rows);

    expect(f.dependencies.rasterizeEcommerceComposition.mock.calls[0][0]).toEqual({ imageUrl: "data:hero", copy, layout });
    expect(f.rasterizeEcommerceDetailPage.mock.calls[0][0].imageUrls).toEqual(["composed:data:hero", "composed:data:detail"]);
});

test("automatic binding follows the current enabled suite rows by slot instead of stale image metadata", async () => {
    const f = bindingFixture("running");
    const detailCopy = { headline: "Current detail", subhead: "", cta: "", price: "" };
    const detailLayout = { name: "Current detail layout", blocks: [] };
    const heroCopy = { headline: "Current hero", subhead: "", cta: "", price: "" };
    const heroLayout = { name: "Current hero layout", blocks: [] };
    Object.assign(f.images[0].metadata!, { ecommerceCopy: { headline: "Stale", subhead: "", cta: "", price: "" }, ecommerceLayout: { name: "Stale layout", blocks: [] } });
    f.nodesRef.current[1] = {
        ...f.table,
        metadata: {
            ...f.table.metadata,
            ecommerceSuite: {
                ...f.table.metadata!.ecommerceSuite!,
                rows: [
                    { ...f.rows[1], copy: detailCopy, layout: detailLayout },
                    { slotId: "skipped", title: "Skipped", duty: "", prompt: "", enabled: false },
                    { ...f.rows[0], copy: heroCopy, layout: heroLayout },
                ],
            },
        },
    };
    f.dependencies.rasterizeEcommerceComposition = mock(async ({ imageUrl }: { imageUrl: string }) => `composed:${imageUrl}`);

    f.render();
    f.runAutoBind();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(f.dependencies.rasterizeEcommerceComposition.mock.calls.map((call) => call[0])).toEqual([
        { imageUrl: "data:detail", copy: detailCopy, layout: detailLayout },
        { imageUrl: "data:hero", copy: heroCopy, layout: heroLayout },
    ]);
    expect(f.rasterizeEcommerceDetailPage.mock.calls[0][0].imageUrls).toEqual(["composed:data:detail", "composed:data:hero"]);
});

test("terminal image states fail automatic binding and release single-image retry", async () => {
    for (const terminal of [{ status: "error" as const }, { taskStatus: "failed" as const }, { taskStatus: "cancelled" as const }]) {
        const f = bindingFixture("running");
        const successfulImage = f.nodesRef.current[2];
        f.nodesRef.current[3] = { ...f.images[1], metadata: { ...f.images[1].metadata, ...terminal } };

        f.render();
        f.runAutoBind();

        expect(f.nodesRef.current[0].metadata?.ecommerceOneClick?.status).toBe("failed");
        expect(f.nodesRef.current[2]).toBe(successfulImage);
        expect(f.rasterizeEcommerceDetailPage).not.toHaveBeenCalled();
        expect(await f.generate()(f.table, "detail", ["detail"])).toBe(true);
        expect(f.dependencies.enqueueGenerationBatch).toHaveBeenCalledTimes(1);
        expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toBeUndefined();
        expect(f.nodesRef.current[2]).toBe(successfulImage);
    }
});

test("automatic binding abandons a stale suite during export without overwriting the current plan", async () => {
    const f = bindingFixture("running");
    const plan = structuredClone(f.product.metadata!.ecommerceOneClick!);
    let persisted = false;
    f.exportEcommerceDetailPage.mockImplementationOnce(async (_node, _long, _pieces, _names, validateSource) => {
        await Promise.resolve();
        const table = f.nodesRef.current[1];
        f.nodesRef.current[1] = {
            ...table,
            metadata: {
                ...table.metadata,
                ecommerceSuite: {
                    ...table.metadata!.ecommerceSuite!,
                    updatedAt: "changed-during-export",
                    rows: table.metadata!.ecommerceSuite!.rows.map((row) => (row.slotId === "hero" ? { ...row, copy: { headline: "New copy", subhead: "", cta: "", price: "" } } : row)),
                },
            },
        };
        validateSource?.();
        persisted = true;
    });

    f.render();
    f.runAutoBind();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(persisted).toBe(false);
    expect(f.nodesRef.current[0].metadata?.ecommerceOneClick).toEqual(plan);
    expect(f.nodesRef.current[1].metadata?.ecommerceSuite?.updatedAt).toBe("changed-during-export");
    expect(f.bindingRef.current.size).toBe(0);
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

test("suite without an image model override inherits the effective global default", async () => {
    const f = bindingFixture();
    f.table.metadata!.ecommerceImageModel = undefined;

    expect(await f.generate()(f.table, "detail")).toBe(true);
    expect(f.dependencies.resolveEcommerceTableModels).toHaveBeenCalledWith(f.dependencies.effectiveConfig, { imageModel: undefined });
    expect(f.dependencies.enqueueGenerationBatch).toHaveBeenCalledTimes(1);
    expect(f.nodesRef.current.slice(4).every((node) => node.metadata?.model === "default-image")).toBe(true);
});

test("an unavailable explicit suite image model never falls back to the global default", async () => {
    const f = bindingFixture();
    f.table.metadata!.ecommerceImageModel = "deleted-image";
    const before = f.nodesRef.current.length;

    expect(await f.generate()(f.table, "detail")).toBe(false);
    expect(f.dependencies.resolveEcommerceTableModels).toHaveBeenCalledWith(f.dependencies.effectiveConfig, { imageModel: "deleted-image" });
    expect(f.dependencies.enqueueGenerationBatch).not.toHaveBeenCalled();
    expect(f.nodesRef.current).toHaveLength(before);
    expect(f.dependencies.message.warning).toHaveBeenCalled();
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

test("generating the remaining screen keeps every ready screen in the automatic binding plan", async () => {
    const f = bindingFixture();
    f.nodesRef.current[1].metadata!.ecommerceAutoBind = true;
    f.nodesRef.current = f.nodesRef.current.map((node) =>
        node.type === CanvasNodeType.Image
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      ecommerceProductId: f.product.id,
                      batchSourceNodeId: f.table.id,
                      batchResultInputSignature: "suite-signature",
                  },
              }
            : node,
    );

    expect(await f.generate()(f.table, "detail", ["detail"], f.rows, true)).toBe(true);

    const plan = f.nodesRef.current[0].metadata!.ecommerceOneClick!;
    expect(plan.slotIds).toEqual(["hero", "detail"]);
    expect(plan.nodeIds).toEqual(f.images.map((image) => image.id));
    expect(f.dependencies.enqueueGenerationBatch.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ nodeId: f.images[1].id })]);
    expect(f.nodesRef.current.find((node) => node.id === f.images[0].id)?.metadata).toMatchObject({
        storageKey: "hero",
        ecommerceRunId: plan.runId,
        batchResultInputSignature: "suite-signature",
    });
});

test("active manual stitching blocks a fresh suite even after it has cleared the old plan", async () => {
    const f = bindingFixture();
    f.nodesRef.current[0].metadata!.ecommerceOneClick = undefined;
    f.bindingRef.current.add(f.product.id);
    await expect(f.generate()(f.table, "detail")).rejects.toThrow("正在装订");
    expect(f.dependencies.enqueueGenerationBatch).not.toHaveBeenCalled();
});

function generationRollbackFixture() {
    const fixture = bindingFixture();
    const reused = {
        ...fixture.images[0],
        metadata: {
            ...fixture.images[0].metadata,
            prompt: "old prompt",
            composerContent: "old composer",
            model: "old-model",
            size: "1:1",
            quality: "standard",
            errorDetails: "old error",
        },
    };
    fixture.nodesRef.current = fixture.nodesRef.current.map((node) => (node.id === reused.id ? reused : node));
    const spawned = createCanvasNode(CanvasNodeType.Image, { x: 100, y: 100 }, { ecommerceShotId: "new-slot", prompt: "new prompt" });
    const plan: ReturnType<typeof ecommerceSuiteTargets> = {
        rows: [
            { slotId: "hero", title: "Hero", duty: "Sell", prompt: "new reused prompt" },
            { slotId: "new-slot", title: "Detail", duty: "Explain", prompt: "new prompt" },
        ],
        reuse: [{ slotId: "hero", nodeId: reused.id, prompt: "new reused prompt" }],
        spawned: [spawned],
        connections: [{ id: "new-product-edge", fromNodeId: fixture.product.id, toNodeId: spawned.id }],
        reconnect: [{ id: "reconnect-edge", fromNodeId: fixture.product.id, toNodeId: reused.id }],
        nodeIds: [reused.id, spawned.id],
    };
    fixture.dependencies.ecommerceSuiteTargets = (() => plan) as typeof ecommerceSuiteTargets;
    return { ...fixture, reused, spawned, previousPlan: structuredClone(fixture.product.metadata!.ecommerceOneClick!) };
}

test("empty suite enqueue rolls back only the prepared generation state", async () => {
    const fixture = generationRollbackFixture();
    const connectionIds = fixture.dependencies.connectionsRef.current.map((edge) => edge.id);
    const selection = [...fixture.dependencies.selectedNodeIdsRef.current];
    fixture.dependencies.enqueueGenerationBatch.mockImplementation(() => undefined as never);

    expect(await fixture.generate()(fixture.table, "detail")).toBe(false);

    expect(fixture.nodesRef.current.find((node) => node.id === fixture.product.id)?.metadata?.ecommerceOneClick).toEqual(fixture.previousPlan);
    expect(fixture.nodesRef.current.find((node) => node.id === fixture.reused.id)?.metadata).toMatchObject({
        prompt: "old prompt",
        composerContent: "old composer",
        model: "old-model",
        size: "1:1",
        quality: "standard",
        errorDetails: "old error",
    });
    expect(fixture.nodesRef.current.some((node) => node.id === fixture.spawned.id)).toBe(false);
    expect(fixture.dependencies.connectionsRef.current.map((edge) => edge.id)).toEqual(connectionIds);
    expect([...fixture.dependencies.selectedNodeIdsRef.current]).toEqual(selection);
});

test("throwing suite enqueue preserves concurrent user edits while rolling back its own fields", async () => {
    const fixture = generationRollbackFixture();
    const unrelated = createCanvasNode(CanvasNodeType.Text, { x: 600, y: 100 }, { content: "user note" });
    const userConnection = { id: "user-edge", fromNodeId: fixture.table.id, toNodeId: unrelated.id };
    fixture.dependencies.enqueueGenerationBatch.mockImplementation(() => {
        fixture.nodesRef.current = fixture.nodesRef.current
            .map((node) =>
                node.id === fixture.product.id
                    ? { ...node, title: "user product title", metadata: { ...node.metadata, userFlag: true } }
                    : node.id === fixture.reused.id
                      ? { ...node, title: "user image title", metadata: { ...node.metadata, userNote: "keep" } }
                      : node,
            )
            .concat(unrelated);
        fixture.dependencies.connectionsRef.current = [...fixture.dependencies.connectionsRef.current, userConnection];
        fixture.dependencies.setSelectedNodeIds(new Set([unrelated.id]));
        throw new Error("queue failed");
    });

    await expect(fixture.generate()(fixture.table, "detail")).rejects.toThrow("queue failed");

    const product = fixture.nodesRef.current.find((node) => node.id === fixture.product.id)!;
    const reused = fixture.nodesRef.current.find((node) => node.id === fixture.reused.id)!;
    expect(product.title).toBe("user product title");
    expect(product.metadata?.userFlag).toBe(true);
    expect(product.metadata?.ecommerceOneClick).toEqual(fixture.previousPlan);
    expect(reused.title).toBe("user image title");
    expect(reused.metadata).toMatchObject({ prompt: "old prompt", composerContent: "old composer", model: "old-model", size: "1:1", quality: "standard", errorDetails: "old error", userNote: "keep" });
    expect(fixture.nodesRef.current.some((node) => node.id === fixture.spawned.id)).toBe(false);
    expect(fixture.nodesRef.current.some((node) => node.id === unrelated.id)).toBe(true);
    expect(fixture.dependencies.connectionsRef.current.some((edge) => edge.id === userConnection.id)).toBe(true);
    expect(fixture.dependencies.connectionsRef.current.some((edge) => edge.id === "new-product-edge" || edge.id === "reconnect-edge")).toBe(false);
    expect([...fixture.dependencies.selectedNodeIdsRef.current]).toEqual([unrelated.id]);
});
