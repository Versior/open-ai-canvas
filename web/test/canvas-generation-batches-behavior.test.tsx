import { afterEach, expect, test } from "bun:test";
import React, { act, useMemo, useRef, useState } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { createCanvasStateWriter } from "../src/lib/canvas/canvas-editor-state";
import { ecommerceSuiteTargets } from "../src/lib/ecommerce/ecommerce-canvas-preset";
import { ecommerceOneClickFlow } from "../src/lib/ecommerce/ecommerce-oneclick";
import { useCanvasContentUpdates } from "../src/pages/canvas/use-canvas-content-updates";
import { useCanvasGenerationBatches } from "../src/pages/canvas/use-canvas-generation-batches";
import { useCanvasGenerationExecutor } from "../src/pages/canvas/use-canvas-generation-executor";
import { apiClient } from "../src/services/api/request";
import type { CreateTaskInput, GenerationTask } from "../src/services/api/task-center";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";
import { useUserStore } from "../src/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
const originalUseApp = App.useApp;
const originalRequest = apiClient.request;
const originalConfig = useConfigStore.getState().config;
const originalUserState = useUserStore.getState();
let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    App.useApp = originalUseApp;
    apiClient.request = originalRequest;
    useConfigStore.setState({ config: originalConfig });
    useUserStore.setState(originalUserState);
    for (const [key, descriptor] of [["window", originalWindow], ["IS_REACT_ACT_ENVIRONMENT", originalAct]] as const) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "Product", position: { x: 0, y: 0 }, width: 460, height: 660 };
const image = (id: string): CanvasNodeData => ({ ...product, id, type: CanvasNodeType.Image, metadata: { prompt: "Original " + id, model: "test::gpt-image-2" } });
const envelope = () => ({ data: { code: 0, data: [], msg: "ok" }, status: 200, headers: {} });

async function mountQueue(initial: CanvasNodeData[], realExecutor = false) {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const intervals = new Set<() => void>();
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
        setInterval(callback: () => void) { intervals.add(callback); return callback; },
        clearInterval(callback: () => void) { intervals.delete(callback); },
        dispatchEvent() { return true; },
    } });
    const errors: string[] = [];
    const app = { message: { warning() {}, info() {}, success() {}, error(value: string) { errors.push(value); } }, modal: { confirm() {} } };
    App.useApp = (() => app) as typeof App.useApp;
    useConfigStore.setState({ config: { ...defaultConfig, channels: [{ id: "test", name: "Test", scope: "system", baseUrl: "/api", apiKey: "test-boundary", apiFormat: "openai", models: ["gpt-image-2"], modelCosts: [{ model: "gpt-image-2", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1 }] }], imageModel: "test::gpt-image-2" } });
    useUserStore.setState({ runtimeLimits: { activeTaskLimit: 9, resourceUploadMB: 50 } });
    apiClient.request = (async () => envelope()) as typeof apiClient.request;
    const submitted: Array<{ id: string; prompt: string }> = [];
    let api!: ReturnType<typeof useCanvasGenerationBatches> & ReturnType<typeof useCanvasContentUpdates> & {
        nodes: CanvasNodeData[]; ref: { current: CanvasNodeData[] }; write: ReturnType<typeof createCanvasStateWriter<CanvasNodeData[]>>;
    };
    function Probe() {
        const ref = useRef(initial);
        const [nodes, publish] = useState(ref.current);
        const write = useMemo(() => createCanvasStateWriter(ref, publish), []);
        const fakeGenerate = useMemo(() => async (id: string, _mode: unknown, prompt: string) => {
            submitted.push({ id, prompt });
            write((current) => current.map((node) => node.id === id ? { ...node, metadata: { ...node.metadata, status: "success", content: "data:image/png;base64,test-result" } } : node));
        }, [write]);
        const executorOptions = useMemo<Parameters<typeof useCanvasGenerationExecutor>[0]>(() => ({ projectId: "test-project", addedSkills: [], assets: [], nodesRef: ref, connectionsRef: { current: [] }, setNodes: write,
            setConnections() {}, setSelectedNodeIds() {}, setSelectedConnectionId() {}, setDialogNodeId() {}, setRunningNodeId() {},
            startGenerationRequest: (_target, _origin, _running, controller) => controller ?? new AbortController(), finishGenerationRequest() {},
            bindGenerationTask(targetId, task) {
                write((current) => current.map((node) => node.id === targetId ? { ...node, metadata: { ...node.metadata, taskId: task.id, taskStatus: task.status } } : node));
            },
            async applyGenerationTaskResult(targetId, task) {
                const result = JSON.parse(task.resultJson || "{}");
                write((current) => current.map((node) => node.id === targetId ? { ...node, metadata: { ...node.metadata, status: "success", content: result.images[0].dataUrl } } : node));
            },
        }), [ref, write]);
        const executor = useCanvasGenerationExecutor(executorOptions);
        const handleGenerateNode = realExecutor ? executor : fakeGenerate;
        api = { nodes, ref, write, ...useCanvasContentUpdates(ref, publish), ...useCanvasGenerationBatches({ projectId: "test-project", projectLoaded: true, nodes, nodesRef: ref, connectionsRef: executorOptions.connectionsRef, assets: [], setNodes: write, handleGenerateNode }) };
        return null;
    }
    const fail = (error: unknown) => { throw error; };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    await act(async () => { reconciler.updateContainer(<Probe />, root, null, null); });
    unmount = async () => { await act(async () => { reconciler.updateContainer(null, root, null, null); }); };
    return { api: () => api, submitted, errors, tick: () => { for (const callback of intervals) callback(); } };
}

test("draft save, suite creation and actual queue scheduling preserve both generation rounds", async () => {
    const queue = await mountQueue([product]);
    const flow = ecommerceOneClickFlow("main")!;
    for (let round = 1; round <= 2; round++) {
        const rows = Array.from({ length: 5 }, (_, index) => ({ slotId: "main-" + index, title: "Image " + index, duty: "Product", prompt: "Round " + round + " image " + index }));
        await act(async () => {
            const api = queue.api();
            api.write((current) => [...current]);
            api.updateNode(product.id, (node) => ({ ...node, metadata: { ...node.metadata, ecommerceSuite: { flow: flow.id, rows, source: "draft", updatedAt: "test" } } }));
            let sequence = 0;
            const plan = ecommerceSuiteTargets(api.ref.current[0], flow, api.ref.current[0].metadata?.ecommerceSuite, { nodes: api.ref.current, connections: [] }, { model: "test::gpt-image-2" }, () => "edge-" + round + "-" + sequence++);
            api.write((current) => [...current, ...plan.spawned]);
            expect(api.enqueueGenerationBatch(product.id, "batch_image", plan.nodeIds.map((nodeId) => ({ nodeId, rowId: nodeId })))).toBeString();
        });
        expect(queue.api().ref.current).toEqual(queue.api().nodes);
        await act(async () => { queue.tick(); });
        expect(queue.submitted).toHaveLength(round * 5);
        expect(queue.submitted.slice(-5).map((item) => item.prompt)).toEqual(rows.map((row) => row.prompt));
        expect(queue.api().nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.status === "success")).toHaveLength(round * 5);
        expect(queue.api().nodes[0].metadata?.generationBatches).toHaveLength(round);
        expect(queue.api().nodes[0].metadata?.generationBatches?.every((batch) => batch.status === "completed")).toBe(true);
        expect(queue.api().ref.current).toEqual(queue.api().nodes);
    }
    expect(new Set(queue.submitted.map((item) => item.id)).size).toBe(10);
});

test("task listing skips deleted nodes and submits the queued prompt snapshot while awaiting capacity", async () => {
    const queue = await mountQueue([product, image("deleted"), image("edited")]);
    let release!: (value: ReturnType<typeof envelope>) => void;
    const pending = new Promise<ReturnType<typeof envelope>>((resolve) => { release = resolve; });
    apiClient.request = (() => pending) as typeof apiClient.request;
    await act(async () => {
        queue.api().enqueueGenerationBatch(product.id, "batch_image", ["deleted", "edited"].map((nodeId) => ({ nodeId, rowId: nodeId })));
        queue.tick();
    });
    expect(queue.submitted).toHaveLength(0);
    await act(async () => {
        queue.api().write((current) => current.filter((node) => node.id !== "deleted"));
        queue.api().updateNode("edited", (node) => ({ ...node, metadata: { ...node.metadata, prompt: "Latest edited prompt" } }));
    });
    await act(async () => { release(envelope()); });
    expect(queue.submitted).toEqual([{ id: "edited", prompt: "Original edited" }]);
});

test("invalid references are rejected before a batch is queued", async () => {
    const target = image("invalid-reference");
    target.metadata = { ...target.metadata, prompt: "Use @[node:missing-reference]" };
    const queue = await mountQueue([product, target], true);
    await act(async () => {
        expect(queue.api().enqueueGenerationBatch(product.id, "batch_image", [{ nodeId: target.id, rowId: target.id }])).toBeUndefined();
        queue.tick();
    });
    expect(queue.errors).toHaveLength(1);
    expect(queue.errors[0]).toContain("引用");
    expect(queue.api().nodes[0].metadata?.generationBatches).toBeUndefined();
});

test("invalid references fail a legacy batch without a snapshot instead of requeueing forever", async () => {
    const target = image("invalid-reference");
    const queue = await mountQueue([product, target], true);
    await act(async () => {
        queue.api().enqueueGenerationBatch(product.id, "batch_image", [{ nodeId: target.id, rowId: target.id }]);
        queue.api().updateNode(product.id, (node) => ({ ...node, metadata: { ...node.metadata, generationBatches: node.metadata!.generationBatches!.map((batch) => ({ ...batch, items: batch.items.map((item) => ({ ...item, inputSnapshot: undefined })) })) } }));
        queue.api().updateNode(target.id, (node) => ({ ...node, metadata: { ...node.metadata, prompt: "Use @[node:missing-reference]" } }));
        queue.tick();
    });
    const result = queue.api().nodes.find((node) => node.id === target.id)!;
    expect(result.metadata?.status).toBe("error");
    expect(result.metadata?.errorDetails).toBeString();
    const batch = queue.api().nodes[0].metadata?.generationBatches?.[0];
    expect(batch?.items[0].status).toBe("failed");
    expect(batch?.items[0].errorDetails).toBe(result.metadata?.errorDetails);
    await act(async () => { queue.tick(); });
    expect(queue.api().nodes[0].metadata?.generationBatches?.[0].items[0].status).toBe("failed");
});

test("real executor submits and queries distinct backend tasks for two suite rounds", async () => {
    const queue = await mountQueue([product], true);
    const requests: CreateTaskInput[] = [];
    const tasks = new Map<string, GenerationTask>();
    const reply = (data: unknown) => ({ data: { code: 0, data, msg: "ok" }, status: 200, headers: {} });
    apiClient.request = (async (config: { url?: string; method?: string; data?: CreateTaskInput }) => {
        if (config.url === "/tasks" && config.method?.toLowerCase() === "post") {
            const input = config.data!;
            requests.push(input);
            const task: GenerationTask = { id: "task-" + requests.length, projectId: "test-project", type: "canvas_image", status: "queued", prompt: input.prompt, attempts: 1, createdAt: "test", updatedAt: "test" };
            tasks.set(task.id, task);
            return reply(task);
        }
        if (config.url?.startsWith("/tasks/")) {
            const task = tasks.get(config.url.slice("/tasks/".length))!;
            return reply({ ...task, status: "succeeded", resultJson: JSON.stringify({ images: [{ dataUrl: "data:image/png;base64," + task.id }] }) });
        }
        if (config.url === "/tasks") return reply([]);
        throw new Error("Unexpected API boundary: " + config.url);
    }) as typeof apiClient.request;
    const flow = ecommerceOneClickFlow("main")!;
    for (let round = 1; round <= 2; round++) {
        await act(async () => {
            const api = queue.api();
            const rows = Array.from({ length: 5 }, (_, index) => ({ slotId: "main-" + index, title: "Image " + index, duty: "Product", prompt: "Round " + round + " image " + index }));
            api.updateNode(product.id, (node) => ({ ...node, metadata: { ...node.metadata, ecommerceSuite: { flow: flow.id, rows, source: "draft", updatedAt: "test" } } }));
            let sequence = 0;
            const plan = ecommerceSuiteTargets(api.ref.current[0], flow, api.ref.current[0].metadata?.ecommerceSuite, { nodes: api.ref.current, connections: [] }, { model: "test::gpt-image-2" }, () => "edge-" + round + "-" + sequence++);
            api.write((current) => [...current, ...plan.spawned]);
            api.enqueueGenerationBatch(product.id, "batch_image", plan.nodeIds.map((nodeId) => ({ nodeId, rowId: nodeId })));
            queue.tick();
        });
        expect(requests).toHaveLength(round * 5);
        expect(requests.slice(-5).map((request) => request.prompt)).toEqual(Array.from({ length: 5 }, (_, index) => "Round " + round + " image " + index));
        expect(queue.api().nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.content)).toHaveLength(round * 5);
        expect(queue.api().nodes[0].metadata?.generationBatches?.every((batch) => batch.status === "completed")).toBe(true);
    }
    expect(new Set(requests.map((request) => request.input?.metadata && (request.input.metadata as { nodeId: string }).nodeId)).size).toBe(10);
    expect(tasks.size).toBe(10);
});
