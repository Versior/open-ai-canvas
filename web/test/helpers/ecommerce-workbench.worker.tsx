import assert from "node:assert/strict";
import { mock } from "bun:test";
import React, { act } from "react";
import { reconciler } from "@react-three/fiber";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../../src/types/canvas";
import { DEFAULT_ECOMMERCE_BRIEF, studioWorkbenchRequest } from "../../src/lib/ecommerce/ecommerce-capabilities";
import { DEFAULT_ECOMMERCE_SETTING } from "../../src/services/api/ecommerce";
import { createEcommerceProductProfile } from "../../src/lib/ecommerce/ecommerce-contract";
import type { GenerationTask } from "../../src/services/api/task-center";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
let scope = "account-a";
Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: { getItem: () => scope } }) });
const configModule = await import("../../src/stores/use-config-store");
mock.module("@/stores/use-config-store", () => ({ ...configModule, useEffectiveConfig: () => configModule.defaultConfig }));
const selectionModule = await import("../../src/lib/model-selection");
mock.module("@/lib/model-selection", () => ({ ...selectionModule, modelCompatibilityError: () => "" }));
const generationModule = await import("../../src/lib/canvas/canvas-project-generation");
mock.module("@/lib/canvas/canvas-project-generation", () => ({ ...generationModule, buildGenerationConfig: () => configModule.defaultConfig }));
const { useEcommerceSettings } = await import("../../src/stores/use-ecommerce-settings");
useEcommerceSettings.setState({ load: async () => structuredClone(DEFAULT_ECOMMERCE_SETTING) });
let submitted = 0,
    cancelled = 0;
let afterSubmit = () => {};
let captured: { prompt: string; referenceImages?: { storageKey?: string }[]; metadata?: Record<string, unknown> } | undefined;
let preparedSkills: string[] | undefined;
let archives = 0,
    downloads = 0;
mock.module("@/services/ecommerce-suite-export", () => ({
    buildEcommerceSuiteArchive: async () => {
        archives++;
        return new Blob(["test archive"]);
    },
}));
mock.module("file-saver", () => ({
    saveAs: () => {
        downloads++;
    },
}));
mock.module("@/services/api/skills", () => ({ listAddedSkills: async () => ({ skills: [] }) }));
mock.module("@/services/skill-runtime", () => ({
    skillRuntime: {
        prepare: async (input: { prompt: string; selectedSkillIds: string[] }) => {
            preparedSkills = input.selectedSkillIds;
            return { prompt: "selected-skill-context\n" + input.prompt, metadata: { skillIds: input.selectedSkillIds } };
        },
    },
}));
mock.module("@/services/api/task-center", () => ({
    cancelGenerationTask: async () => {
        cancelled++;
    },
}));
mock.module("@/services/api/generation-task", () => ({
    runBackendGenerationTask: async (input: { prompt: string; referenceImages?: { storageKey?: string }[]; signal: AbortSignal; onTaskUpdate: (task: GenerationTask) => void }) => {
        submitted++;
        captured = input;
        const task: GenerationTask = { id: "task-" + submitted, type: "canvas_image", status: "running", prompt: "", attempts: 1, createdAt: "", updatedAt: "" };
        input.onTaskUpdate(task);
        afterSubmit();
        if (input.signal.aborted) throw new Error("aborted");
        input.onTaskUpdate({ ...task, status: "succeeded" });
        return { text: "" };
    },
}));
const { useEcommerceWorkbench } = await import("../../src/pages/canvas/use-ecommerce-workbench");
const image: CanvasNodeData = { id: "photo", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 500, metadata: { storageKey: "test-product", status: "success" } };
const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, position: { x: 400, y: 0 }, width: 460, height: 660, metadata: { productProfile: { ...createEcommerceProductProfile("Test"), appearance: "blue cup" } } };
const studio: CanvasNodeData = {
    id: "studio",
    type: CanvasNodeType.EcommerceStudio,
    position: { x: 1000, y: 0 },
    width: 640,
    height: 740,
    metadata: {
        ecommerceStudio: {
            brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Test" },
            plan: {
                name: "Test",
                style: "navy studio",
                shots: [
                    { title: "Hero", duty: "show product", prompt: "photo of product" },
                    { title: "Draft", duty: "", prompt: "" },
                ],
            },
        },
    },
};
const nodesRef = { current: [] as CanvasNodeData[] };
const connectionsRef = { current: [] as CanvasConnection[] };
let hook!: ReturnType<typeof useEcommerceWorkbench>;
let applyCount = 0;
function Probe() {
    hook = useEcommerceWorkbench({
        projectId: "test-canvas",
        nodesRef,
        connectionsRef,
        center: () => ({ x: 0, y: 0 }),
        setNodes: (update) => {
            nodesRef.current = typeof update === "function" ? update(nodesRef.current) : update;
        },
        setConnections: (update) => {
            connectionsRef.current = typeof update === "function" ? update(connectionsRef.current) : update;
        },
        setSelectedNodeIds: () => {},
        bindTask: () => {},
        applyResult: async (id) => {
            applyCount++;
            nodesRef.current = nodesRef.current.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, storageKey: "test-output", status: "success" } } : node));
        },
    });
    return null;
}
const fail = (error: unknown) => {
    throw error;
};
const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
const reset = () => {
    nodesRef.current = structuredClone([image, product, studio]);
    connectionsRef.current = [
        { id: "photo-product", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front" },
        { id: "product-studio", fromNodeId: product.id, toNodeId: studio.id },
    ];
    submitted = 0;
    cancelled = 0;
    applyCount = 0;
    afterSubmit = () => {};
    scope = "account-a";
};
const request = () => ({ ...studioWorkbenchRequest(studio.id, studio.metadata!.ecommerceStudio!.brief, [product.id], "studio-generate"), shotIndices: [0] });
try {
    await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
    reset();
    await act(async () => {
        await hook.run(request());
    });
    assert.equal(submitted, 1);
    assert.equal(applyCount, 1);
    assert.equal(captured?.referenceImages?.[0].storageKey, "test-product");
    assert.ok(captured?.prompt.includes("商品实拍"));
    assert.ok(captured?.prompt.includes("blue cup"));
    assert.ok(nodesRef.current.find((node) => node.id === studio.id)?.metadata?.ecommerceWorkbench?.steps.every((step) => step.status === "succeeded"));
    assert.ok(connectionsRef.current.some((edge) => edge.fromNodeId === studio.id && edge.toNodeId !== product.id));
    assert.ok(nodesRef.current.some((node) => node.metadata?.ecommerceStudioOutput?.studioId === studio.id && node.metadata.ecommerceStudioOutput.shotIndex === 0));
    // A complete selected shot can run even while another shot is still a draft.
    assert.equal(nodesRef.current.find((node) => node.id === studio.id)?.metadata?.ecommerceStudio?.plan?.shots[1].duty, "");
    // Export a complete adopted plan, then reject a replaced product photo before downloading.
    nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.plan!.shots.pop();
    await act(async () => {
        await hook.run({ ...request(), action: "studio-export" });
    });
    assert.equal(archives, 1);
    assert.equal(downloads, 1);
    nodesRef.current.find((node) => node.id === image.id)!.metadata!.storageKey = "replaced-product";
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "studio-export" }), /素材已变化/);
    });
    assert.equal(archives, 1);
    assert.equal(downloads, 1);
    reset();
    let derivedId = "";
    await act(async () => {
        await hook.run({ ...request(), action: "apply-plan" });
    });
    derivedId = nodesRef.current.find((node) => node.type === CanvasNodeType.EcommerceStudio && node.id !== studio.id)!.id;
    assert.ok(connectionsRef.current.some((edge) => edge.fromNodeId === product.id && edge.toNodeId === derivedId));
    assert.ok(!connectionsRef.current.some((edge) => edge.fromNodeId === studio.id && edge.toNodeId === derivedId));
    assert.equal(submitted, 0);
    reset();
    afterSubmit = () => {
        connectionsRef.current = connectionsRef.current.filter((edge) => edge.id !== "product-studio");
    };
    await act(async () => {
        await assert.rejects(() => hook.run(request()), /输入连线已变化/);
    });
    assert.equal(applyCount, 0);
    assert.equal(submitted, 1);
    assert.ok(nodesRef.current.find((node) => node.id === studio.id)?.metadata?.ecommerceWorkbench?.steps.every((step) => step.status === "failed"));
    reset();
    afterSubmit = () => {
        connectionsRef.current = connectionsRef.current.filter((edge) => edge.id !== "product-studio");
    };
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), requireStudioInputs: false }), /输入连线已变化/);
    });
    assert.equal(applyCount, 0);
    reset();
    const text = { ...image, id: "brief-text", type: CanvasNodeType.Text, metadata: { content: "Verified text from the connected brief" } };
    nodesRef.current.push(text);
    await act(async () => {
        await hook.run({ ...request(), sourceIds: [product.id, text.id] });
    });
    assert.ok(captured?.prompt.includes("Verified text from the connected brief"));
    reset();
    nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.skillIds = ["product-analysis"];
    await act(async () => {
        await hook.run({ ...request(), action: "listing" });
    });
    assert.deepEqual(preparedSkills, ["product-analysis"]);
    assert.deepEqual(captured?.metadata?.skillIds, ["product-analysis"]);
    assert.ok(captured?.prompt.includes("selected-skill-context"));
    reset();
    afterSubmit = () => {
        assert.ok(hook.isRunning(studio.id));
        hook.stop();
    };
    await act(async () => {
        await assert.rejects(() => hook.run(request()), /aborted/);
    });
    assert.equal(cancelled, 1);
    assert.equal(applyCount, 0);
    assert.equal(hook.isRunning(studio.id), false);
    reset();
    afterSubmit = () => {
        scope = "account-b";
    };
    await act(async () => {
        await assert.rejects(() => hook.run(request()), /账号已切换/);
    });
    assert.equal(applyCount, 0);
    assert.equal(cancelled, 0);
    console.log("Studio execution covers product references, partial generation, disconnected inputs, cancellation and account isolation.");
} finally {
    await act(async () => reconciler.updateContainer(null, root, null, null));
}
