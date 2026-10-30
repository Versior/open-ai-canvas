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
const { defaultImageCapabilityConfig, defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const imageProfile = defaultImageCapabilityConfig("openai-image", "fixture-image");
const textProfile = defaultModelCapabilityConfig("openai-chat", "fixture-text");
textProfile.text!.references.maxImages = 8;
imageProfile.size = { parameter: "size", values: ["1024x1024", "1080x1440"], default: "1024x1024", allowCustom: false, presets: [{ tier: "1k", ratio: "3:4", size: "1080x1440", width: 1080, height: 1440 }] };
const fixtureChannel = configModule.createModelChannel({
    id: "fixture",
    models: ["fixture-image", "fixture-text"],
    modelCosts: [
        { model: "fixture-image", capability: "image", protocol: "openai-image", capabilityConfig: { version: 1, image: imageProfile }, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
        { model: "fixture-text", capability: "text", protocol: "openai-chat", capabilityConfig: textProfile, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
    ],
});
const fixtureConfig = {
    ...configModule.defaultConfig,
    channels: [fixtureChannel],
    imageModel: "fixture::fixture-image",
    textModel: "fixture::fixture-text",
    model: "fixture::fixture-image",
    imageModels: ["fixture::fixture-image"],
    textModels: ["fixture::fixture-text"],
};
mock.module("@/stores/use-config-store", () => ({ ...configModule, useEffectiveConfig: () => fixtureConfig }));
const { useEcommerceSettings } = await import("../../src/stores/use-ecommerce-settings");
useEcommerceSettings.setState({ load: async () => structuredClone(DEFAULT_ECOMMERCE_SETTING) });
let submitted = 0,
    cancelled = 0,
    resumed = 0;
let afterSubmit = () => {};
let duringResume = () => {};
let generatedText = "";
let failSubmission = 0;
let queriedStatus: GenerationTask["status"] = "succeeded";
let queryFailure = false;
let recoverable = false;
let queriedType = "canvas_image";
const queriedStatuses = new Map<string, GenerationTask["status"]>();
const submittedModes: string[] = [];
let captured: { prompt: string; config: import("../../src/stores/use-config-store").AiConfig; referenceImages?: { storageKey?: string }[]; metadata?: Record<string, unknown> } | undefined;
const imageRequests: import("../../src/stores/use-config-store").AiConfig[] = [];
let preparedSkills: string[] | undefined;
let archives = 0,
    downloads = 0;
let localUploads = 0;
let composedInput: { imageUrls: string[]; width?: number; gap?: number } | undefined;
mock.module("@/lib/ecommerce/ecommerce-rasterize", () => ({
    rasterizeEcommerceLongImage: async (input: { imageUrls: string[]; width?: number; gap?: number }) => {
        composedInput = input;
        return { dataUrl: "data:image/png;base64,dGVzdA==", width: input.width, height: 100 };
    },
}));
const patternTools = await import("../../src/services/ecommerce-pattern-tools");
mock.module("@/services/ecommerce-pattern-tools", () => ({
    ...patternTools,
    readPatternPixels: async () => ({ width: 3, height: 3, data: new Uint8ClampedArray(36) }),
    recolorPatternNode: async () => new Blob(["recolored"]),
    buildPatternPrintPack: async () => ({ archive: new Blob(["print archive"]), image: new Blob(["print image"]), manifest: { dpi: 300 } }),
}));
const imageStorage = await import("../../src/services/image-storage");
mock.module("@/services/image-storage", () => ({
    ...imageStorage,
    imageToDataUrl: async (input: { storageKey?: string }) => "data:" + input.storageKey,
    uploadImage: async () => {
        localUploads++;
        return { url: "blob:test", storageKey: "resource:test-local", width: 3, height: 3, bytes: 36, mimeType: "image/png" };
    },
}));
mock.module("@/services/project-asset-sync", () => ({ ensureCanvasNodeAsset: async () => ({ assetId: "test-asset" }) }));
mock.module("@/services/ecommerce-layer-export", () => ({ buildEcommerceLayerArchive: async () => new Blob(["layer archive"]) }));
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
const taskCenterModule = await import("../../src/services/api/task-center");
mock.module("@/services/api/task-center", () => ({
    ...taskCenterModule,
    queryGenerationTask: async (id: string) => {
        if (queryFailure) throw new Error("query unavailable");
        return {
            id,
            type: id === "legacy-plan" || submittedModes[Number(id.replace("task-", "")) - 1] === "text" ? "canvas_text" : queriedType,
            projectId: "test-canvas",
            status: queriedStatuses.get(id) || queriedStatus,
            canRecoverMedia: recoverable,
            attempts: 1,
            createdAt: "",
            updatedAt: "",
        };
    },
    waitForGenerationTask: async (id: string, options?: { signal?: AbortSignal; onTaskUpdate?: (task: GenerationTask) => void }) => {
        resumed++;
        options?.onTaskUpdate?.({ id, type: "canvas_image", projectId: "test-canvas", status: queriedStatus, attempts: 1, prompt: "", createdAt: "", updatedAt: "" });
        duringResume();
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return { id, type: submittedModes[Number(id.replace("task-", "")) - 1] === "text" || id === "legacy-plan" ? "canvas_text" : "canvas_image", projectId: "test-canvas", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" };
    },
    cancelGenerationTask: async () => {
        cancelled++;
        return { providerCancelStatus: "confirmed" };
    },
}));
const taskModule = await import("../../src/services/api/generation-task");
mock.module("@/services/api/generation-task", () => ({
    ...taskModule,
    parseBackendGenerationResult: () => ({ text: generatedText }),
    runBackendGenerationTask: async (input: {
        mode: string;
        prompt: string;
        config: import("../../src/stores/use-config-store").AiConfig;
        referenceImages?: { storageKey?: string }[];
        signal: AbortSignal;
        onTaskUpdate: (task: GenerationTask) => void;
    }) => {
        submitted++;
        submittedModes.push(input.mode);
        captured = input;
        if (input.mode === "image") imageRequests.push(input.config);
        const task: GenerationTask = { id: "task-" + submitted, type: "canvas_image", status: "running", prompt: "", attempts: 1, createdAt: "", updatedAt: "" };
        input.onTaskUpdate(task);
        afterSubmit();
        if (submitted === failSubmission) throw new Error("provider unavailable");
        if (input.signal.aborted) throw new Error("aborted");
        input.onTaskUpdate({ ...task, status: "succeeded" });
        return { text: generatedText };
    },
}));
const { useEcommerceWorkbench } = await import("../../src/pages/canvas/use-ecommerce-workbench");
const image: CanvasNodeData = { id: "photo", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 500, metadata: { storageKey: "test-product", status: "success" } };
const product: CanvasNodeData = {
    id: "product",
    type: CanvasNodeType.Product,
    position: { x: 400, y: 0 },
    width: 460,
    height: 660,
    metadata: { productProfile: { ...createEcommerceProductProfile("Test"), category: "insulated cup", appearance: "blue cup", audience: "commuters", facts: "500ml capacity: verified by packaging" } },
};
const studio: CanvasNodeData = {
    id: "studio",
    type: CanvasNodeType.EcommerceStudio,
    position: { x: 1000, y: 0 },
    width: 640,
    height: 740,
    metadata: {
        ecommerceStudio: {
            brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Test", imageTypes: ["商品主图", "细节特写"] },
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
            nodesRef.current = nodesRef.current.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, storageKey: "test-output-" + id, status: "success" } } : node));
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
    resumed = 0;
    generatedText = "";
    failSubmission = 0;
    queriedStatus = "succeeded";
    queryFailure = false;
    recoverable = false;
    queriedType = "canvas_image";
    queriedStatuses.clear();
    localUploads = 0;
    downloads = 0;
    archives = 0;
    submittedModes.length = 0;
    imageRequests.length = 0;
    applyCount = 0;
    afterSubmit = () => {};
    duringResume = () => {};
    scope = "account-a";
};
const request = () => ({ ...studioWorkbenchRequest(studio.id, studio.metadata!.ecommerceStudio!.brief, [product.id], "studio-generate"), shotIndices: [0] });
try {
    await act(async () => reconciler.updateContainer(<Probe />, root, null, null));
    reset();
    const configuredStudio = nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!;
    configuredStudio.brief.aspectRatio = "3:4";
    configuredStudio.brief.imageSettings = { size: "1080x1440", quality: "high" };
    configuredStudio.plan!.shots[1] = { title: "Detail", duty: "show detail", prompt: "product detail photo" };
    await act(async () => {
        await hook.run({ ...request(), brief: structuredClone(configuredStudio.brief), shotIndices: [0, 1] });
    });
    assert.equal(imageRequests.length, 2);
    for (const generation of imageRequests) {
        assert.equal(generation.size, "1080x1440");
        assert.equal(generation.quality, "high");
        assert.equal(generation.count, "1");
    }
    const clearCopyFacts = () => {
        const profile = nodesRef.current.find((node) => node.id === product.id)!.metadata!.productProfile!;
        Object.assign(profile, { category: "", facts: "", audience: "" });
    };
    const missingCopyFacts = /商品资料还缺：品类、卖点与依据、目标人群与场景/;
    for (const action of ["listing", "pipeline"] as const) {
        reset();
        clearCopyFacts();
        await act(async () => {
            await assert.rejects(() => hook.run({ ...request(), action }), missingCopyFacts);
        });
        assert.equal(submitted, 0);
        assert.equal(localUploads, 0);
        assert.equal(downloads, 0);
    }
    reset();
    generatedText = "Stored listing";
    await act(async () => {
        await hook.run({ ...request(), action: "listing" });
    });
    const listingHistoryRequest = structuredClone(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!);
    clearCopyFacts();
    await act(async () => {
        await assert.rejects(() => hook.run({ ...listingHistoryRequest, resumeReceiptId: studio.id }), missingCopyFacts);
    });
    assert.equal(submitted, 1);
    reset();
    failSubmission = 1;
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "listing" }), /provider unavailable/);
    });
    const failedListingRequest = structuredClone(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!);
    clearCopyFacts();
    failSubmission = 0;
    queriedStatus = "failed";
    queriedType = "canvas_text";
    await act(async () => {
        await assert.rejects(() => hook.run({ ...failedListingRequest, resumeReceiptId: studio.id, retryFailed: true }), missingCopyFacts);
    });
    assert.equal(submitted, 1);
    reset();
    generatedText = "Pipeline listing";
    await act(async () => {
        await hook.run({ ...request(), action: "pipeline" });
    });
    const pipelineHistoryRequest = structuredClone(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!);
    clearCopyFacts();
    const pipelineSubmissions = submitted;
    const pipelineUploads = localUploads;
    const pipelineDownloads = downloads;
    await act(async () => {
        await assert.rejects(() => hook.run({ ...pipelineHistoryRequest, resumeReceiptId: studio.id, rerunFrom: "listing" }), missingCopyFacts);
    });
    assert.equal(submitted, pipelineSubmissions);
    assert.equal(localUploads, pipelineUploads);
    assert.equal(downloads, pipelineDownloads);
    // Selecting an output version changes delivery state, not the inputs of a paid task.
    reset();
    await act(async () => {
        await hook.run(request());
    });
    const savedForResume = structuredClone(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!);
    nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.adoptedResults = { "0": nodesRef.current.find((node) => node.metadata?.ecommerceStudioOutput)!.id };
    await act(async () => {
        await hook.run({ ...savedForResume, resumeReceiptId: studio.id });
    });
    assert.equal(submitted, 1);
    assert.equal(resumed, 1);
    // Explicit restoration may reuse a paid task, but cannot restore over changed photos.
    const changedStudio = nodesRef.current.find((node) => node.id === studio.id)!;
    changedStudio.metadata!.ecommerceStudio!.brief.name = "Changed name";
    await act(async () => {
        await assert.rejects(() => hook.run({ ...savedForResume, resumeReceiptId: studio.id }), /输入或配置已变化/);
    });
    await act(async () => {
        await hook.run({ ...savedForResume, resumeReceiptId: studio.id, restoreStudioInputs: true });
    });
    assert.equal(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.brief.name, savedForResume.brief.name);
    assert.equal(submitted, 1);
    const currentPhoto = nodesRef.current.find((node) => node.id === image.id)!;
    currentPhoto.metadata!.storageKey = "changed-photo";
    nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.brief.name = "Keep current name";
    await act(async () => {
        await assert.rejects(() => hook.run({ ...savedForResume, resumeReceiptId: studio.id, restoreStudioInputs: true }), /输入或配置已变化/);
    });
    assert.equal(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.brief.name, "Keep current name");
    // Explicit retry verifies a failed task before creating a new charged attempt.
    for (const action of ["planning", "suite-forge", "listing", "model-cast", "pattern-extract", "pattern-draft", "pattern-derive", "studio-generate"] as const) {
        reset();
        const retryRequest = { ...request(), action, brief: { ...request().brief, identity: "adult model", poses: ["front"] } };
        queriedType = ["planning", "suite-forge", "listing"].includes(action) ? "canvas_text" : "canvas_image";
        failSubmission = 1;
        await act(async () => {
            await assert.rejects(() => hook.run(retryRequest), /provider unavailable/);
        });
        const savedRequest = nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!;
        queryFailure = true;
        await act(async () => {
            await assert.rejects(() => hook.run({ ...savedRequest, resumeReceiptId: studio.id, retryFailed: true }), /query unavailable/);
        });
        assert.equal(submitted, 1);
        queryFailure = false;
        queriedStatus = "failed";
        recoverable = true;
        await act(async () => {
            await assert.rejects(() => hook.run({ ...savedRequest, resumeReceiptId: studio.id, retryFailed: true }), /恢复|核对/);
        });
        assert.equal(submitted, 1);
        recoverable = false;
        generatedText = ["planning", "suite-forge"].includes(action) ? JSON.stringify({ name: "Test", style: "studio", shots: Array.from({ length: 5 }, (_, i) => ({ title: "Shot " + i, duty: "show", prompt: "photo" })) }) : "Listing text";
        failSubmission = 0;
        await act(async () => {
            await hook.run({ ...savedRequest, resumeReceiptId: studio.id, retryFailed: true });
        });
        assert.equal(submitted, 2);
        assert.equal((captured as { retryOf?: string })?.retryOf, "task-1");
        assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.every((step) => step.status === "succeeded"));
    }
    // Local tools dispatch actual outputs; a failed Listing does not re-upload the finished print.
    for (const action of ["recolor", "seams", "print-pack", "export-layers"] as const) {
        reset();
        const beforeDownloads = downloads;
        await act(async () => {
            await hook.run({ ...request(), action });
        });
        assert.equal(submitted, 0);
        assert.equal(localUploads, ["recolor", "print-pack"].includes(action) ? 1 : 0);
        assert.equal(downloads - beforeDownloads, ["print-pack", "export-layers"].includes(action) ? 1 : 0);
        assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.every((step) => step.status === "succeeded"));
    }
    reset();
    failSubmission = 1;
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "pipeline" }), /provider unavailable/);
    });
    assert.equal(localUploads, 1);
    const savedPipeline = nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!;
    queriedStatus = "failed";
    queriedType = "canvas_text";
    generatedText = "Recovered listing";
    failSubmission = 0;
    const beforePipelineDownload = downloads;
    await act(async () => {
        await hook.run({ ...savedPipeline, resumeReceiptId: studio.id, retryFailed: true });
    });
    assert.equal(submitted, 2);
    assert.equal(localUploads, 1);
    assert.equal(downloads, beforePipelineDownload + 1);
    assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.every((step) => step.status === "succeeded"));
    // Full planning -> pending image nodes -> real image task -> applied results.
    reset();
    const planned = {
        name: "Test",
        style: "white studio",
        shots: [
            { title: "Hero", duty: "show product", prompt: 'Keep the "blue cup" unchanged' },
            { title: "Detail", duty: "show detail", prompt: "Close-up of the real cup" },
        ],
    };
    // Resume a multi-step operation: completed tasks stay paid once; only failed tasks resubmit.
    for (const action of ["planning", "model-cast"] as const) {
        reset();
        generatedText = JSON.stringify(planned);
        const multiRequest = { ...request(), action, brief: { ...request().brief, count: 2, identity: "adult model", poses: ["front", "side"] }, generateAfterPlanning: action === "planning" };
        failSubmission = action === "planning" ? 3 : 2;
        await act(async () => {
            await assert.rejects(() => hook.run(multiRequest), /provider unavailable/);
        });
        const successful = nodesRef.current.filter((node) => node.type === CanvasNodeType.Image && node.id !== image.id && node.metadata?.status === "success").map((node) => node.id);
        assert.equal(successful.length, 1);
        queriedStatuses.set("task-" + failSubmission, "failed");
        const priorCount = submitted;
        const saved = nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!;
        failSubmission = 0;
        await act(async () => {
            await hook.run({ ...saved, resumeReceiptId: studio.id, retryFailed: true });
        });
        assert.equal(submitted, priorCount + 1);
        assert.ok(successful.every((id) => nodesRef.current.find((node) => node.id === id)?.metadata?.status === "success"));
        assert.equal(nodesRef.current.filter((node) => node.type === CanvasNodeType.Image && node.id !== image.id && node.metadata?.status === "success").length, 2);
        assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.every((step) => step.status === "succeeded"));
    }
    reset();
    generatedText = JSON.stringify(planned).replace('\\\"blue cup\\\"', '\"blue cup\"');
    await act(async () => {
        await hook.run({ ...request(), action: "planning", brief: { ...request().brief, count: 2 }, generateAfterPlanning: true });
    });
    assert.deepEqual(submittedModes, ["text", "image", "image"]);
    assert.equal(applyCount, 2);
    assert.equal(nodesRef.current.filter((node) => node.type === CanvasNodeType.Text).length, 0);
    const plannedImages = nodesRef.current.filter((node) => node.metadata?.ecommerceStudioOutput?.studioId === studio.id);
    assert.equal(plannedImages.length, 2);
    assert.ok(plannedImages.every((node) => node.type === CanvasNodeType.Image && node.metadata?.status === "success" && node.metadata.storageKey));
    assert.ok(plannedImages.every((node) => connectionsRef.current.some((edge) => edge.fromNodeId === studio.id && edge.toNodeId === node.id)));
    assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.every((step) => step.status === "succeeded"));
    // Results stay candidates; placing a subset keeps all paid task records and node identities.
    assert.ok(plannedImages.every((node) => node.metadata?.ecommerceCandidate?.studioId === studio.id));
    const savedExecution = structuredClone(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench);
    const deliveryRequest = { ...request(), brief: nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.brief };
    await act(async () => {
        await hook.run({ ...deliveryRequest, action: "studio-place-results", resultIds: [plannedImages[0].id] });
    });
    assert.equal(nodesRef.current.find((node) => node.id === plannedImages[0].id)!.metadata!.ecommerceCandidate, undefined);
    assert.ok(nodesRef.current.find((node) => node.id === plannedImages[1].id)!.metadata!.ecommerceCandidate);
    assert.deepEqual(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench, savedExecution);
    const countBeforePlace = nodesRef.current.length;
    await act(async () => {
        await hook.run({ ...deliveryRequest, action: "studio-place-results", resultIds: plannedImages.map((node) => node.id) });
    });
    assert.equal(nodesRef.current.length, countBeforePlace);
    assert.equal(submitted, 3);
    // Long image respects explicit order and uploads one real output without model submissions.
    await act(async () => {
        await hook.run({ ...deliveryRequest, action: "studio-compose", resultIds: [plannedImages[1].id, plannedImages[0].id], composeWidth: 1000, composeGap: 16 });
    });
    assert.deepEqual(composedInput, { imageUrls: ["data:test-output-" + plannedImages[1].id, "data:test-output-" + plannedImages[0].id], width: 1000, gap: 16 });
    assert.equal(localUploads, 1);
    assert.equal(submitted, 3);
    assert.ok(nodesRef.current.find((node) => node.title?.endsWith("详情长图"))?.metadata?.ecommerceCandidate);
    assert.deepEqual(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench, savedExecution);
    // A later provider failure preserves completed images and allows only missing shots to run.
    reset();
    generatedText = JSON.stringify(planned);
    failSubmission = 3;
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "planning", brief: { ...request().brief, count: 2 }, generateAfterPlanning: true }), /provider unavailable/);
    });
    const completedImageId = nodesRef.current.find((node) => node.metadata?.ecommerceStudioOutput && node.metadata.status === "success")!.id;
    assert.equal(applyCount, 1);
    failSubmission = 0;
    const currentStudio = nodesRef.current.find((node) => node.id === studio.id)!;
    await act(async () => {
        await hook.run({ ...request(), brief: currentStudio.metadata!.ecommerceStudio!.brief, shotIndices: [1] });
    });
    assert.equal(submitted, 4);
    assert.equal(applyCount, 2);
    assert.equal(nodesRef.current.find((node) => node.id === completedImageId)!.metadata!.status, "success");
    assert.equal(nodesRef.current.filter((node) => node.metadata?.ecommerceStudioOutput && node.metadata.status === "success").length, 2);
    // Planning alone stays in the studio without pre-creating empty canvas nodes.
    reset();
    generatedText = JSON.stringify(planned);
    await act(async () => {
        await hook.run({ ...request(), action: "planning", brief: { ...request().brief, count: 2 } });
    });
    assert.deepEqual(submittedModes, ["text"]);
    assert.equal(nodesRef.current.filter((node) => node.metadata?.ecommerceStudioOutput && node.metadata.status === "idle").length, 0);
    // Recovery reuses the paid planning task and the existing image nodes.
    await act(async () => {
        await hook.run({ ...nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.request!, resumeReceiptId: studio.id });
    });
    assert.equal(submitted, 1);
    assert.equal(resumed, 1);
    assert.equal(nodesRef.current.filter((node) => node.metadata?.ecommerceStudioOutput).length, 0);
    assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.every((step) => !step.error));
    // Old failed records predate input signatures: read the paid text, never auto-generate.
    reset();
    generatedText = JSON.stringify(planned);
    const legacyRequest = { ...request(), action: "planning" as const, brief: { ...request().brief, count: 2 } };
    nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench = {
        capability: "planning",
        brief: legacyRequest.brief,
        sourceIds: legacyRequest.sourceIds,
        request: legacyRequest,
        steps: [{ id: "planning", status: "failed", taskId: "legacy-plan", nodeIds: [studio.id], error: "bad json" }],
    };
    await act(async () => {
        await hook.run({ ...legacyRequest, resumeReceiptId: studio.id });
    });
    assert.equal(submitted, 0);
    assert.equal(resumed, 1);
    assert.equal(nodesRef.current.filter((node) => node.metadata?.ecommerceStudioOutput).length, 0);
    assert.ok(nodesRef.current.find((node) => node.id === studio.id)!.metadata!.content!.includes("旧记录没有输入快照"));
    // Malformed/incomplete plans do not trigger paid image requests.
    reset();
    generatedText = '{"name":"Test","shots":[';
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "planning", generateAfterPlanning: true }), /规划结果不完整/);
    });
    assert.deepEqual(submittedModes, ["text"]);
    assert.equal(nodesRef.current.filter((node) => node.metadata?.ecommerceStudioOutput).length, 0);
    reset();
    nodesRef.current = nodesRef.current.filter((node) => node.id !== image.id);
    connectionsRef.current = connectionsRef.current.filter((edge) => edge.fromNodeId !== image.id);
    generatedText = JSON.stringify(planned);
    await act(async () => {
        await hook.run({ ...request(), action: "planning", brief: { ...request().brief, count: 2 }, generateAfterPlanning: true });
    });
    assert.deepEqual(submittedModes, ["text", "image", "image"]);
    assert.equal(captured?.referenceImages?.length, 0);
    reset();
    nodesRef.current = nodesRef.current.filter((node) => node.id !== image.id);
    connectionsRef.current = connectionsRef.current.filter((edge) => edge.fromNodeId !== image.id);
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "planning", brief: { ...request().brief, generationMode: "product-protected" }, generateAfterPlanning: true }), /商品保护模式需要连接商品实拍/);
    });
    assert.equal(submitted, 0);
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
    // Reconnect to the original paid task instead of submitting another generation.
    await act(async () => {
        await hook.run({ ...request(), resumeReceiptId: studio.id });
    });
    assert.equal(submitted, 1);
    assert.equal(resumed, 1);
    const receiptStep = nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceWorkbench!.steps.find((step) => step.taskId)!;
    receiptStep.taskId = undefined;
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), resumeReceiptId: studio.id }), /未收到任务回执/);
    });
    assert.equal(submitted, 1);
    assert.equal(resumed, 1);
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
    nodesRef.current.find((node) => node.id === studio.id)!.metadata!.ecommerceStudio!.brief.generationMode = "product-protected";
    connectionsRef.current = [{ id: "style-studio", fromNodeId: image.id, toNodeId: studio.id }];
    nodesRef.current.find((node) => node.id === image.id)!.metadata!.ecommerceReferenceRole = "style";
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), brief: { ...request().brief, generationMode: "product-protected" }, sourceIds: [image.id] }), /至少需要一张商品实拍/);
    });
    assert.equal(submitted, 0);
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
    preparedSkills = ["sentinel"];
    await act(async () => {
        await hook.run({ ...request(), action: "listing" });
    });
    // 电商 Skill 由后端自动选择，旧画布保存的手选项不能再触发前端 Skill runtime。
    assert.deepEqual(preparedSkills, ["sentinel"]);
    assert.equal(captured?.metadata?.skillIds, undefined);
    reset();
    afterSubmit = () => {
        assert.ok(hook.isRunning(studio.id));
        hook.stop();
    };
    await act(async () => {
        await assert.rejects(() => hook.run(request()), /已停止/);
    });
    assert.equal(cancelled, 1);
    assert.equal(applyCount, 0);
    assert.equal(hook.isRunning(studio.id), false);
    // Stopping the first image in a suite must prevent all later submissions.
    reset();
    generatedText = JSON.stringify(planned);
    afterSubmit = () => {
        if (submitted === 2) hook.stop();
    };
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), action: "planning", brief: { ...request().brief, count: 2 }, generateAfterPlanning: true }), /已停止/);
    });
    assert.deepEqual(submittedModes, ["text", "image"]);
    assert.equal(cancelled, 1);
    assert.equal(applyCount, 0);
    // Cancellation also reaches tasks resumed from an old receipt.
    reset();
    failSubmission = 1;
    await act(async () => {
        await assert.rejects(() => hook.run(request()), /provider unavailable/);
    });
    failSubmission = 0;
    queriedStatus = "running";
    duringResume = () => hook.stop();
    await act(async () => {
        await assert.rejects(() => hook.run({ ...request(), resumeReceiptId: studio.id }), /已停止/);
    });
    assert.equal(submitted, 1);
    assert.equal(cancelled, 1);
    assert.equal(applyCount, 0);
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
