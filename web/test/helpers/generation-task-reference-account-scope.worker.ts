import { mock } from "bun:test";

type Scenario = "indexeddb-switch" | "local-blob-switch" | "upload-options" | "image-upload-abort" | "media-upload-abort";

let scenario: Scenario = "upload-options";
let currentScope = "user-a";
let createCalls = 0;
const uploadCalls: Array<{ kind: string; expectedScope?: string; signalMatches: boolean }> = [];
let expectedSignal: AbortSignal | undefined;

Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
        localStorage: {
            getItem: () => currentScope,
            setItem: (_key: string, value: string) => {
                currentScope = value;
            },
        },
    },
});

mock.module("@/services/image-storage", () => ({
    imageToDataUrl: async () => "data:image/png;base64,eA==",
    getImageBlob: async () => {
        await Promise.resolve();
        if (scenario === "indexeddb-switch") currentScope = "user-b";
        return new Blob(["image"], { type: "image/png" });
    },
}));

mock.module("@/services/file-storage", () => ({
    getMediaBlob: async () => new Blob(["video"], { type: "video/mp4" }),
}));

mock.module("@/services/api/resources", () => ({
    resourceIdFromStorageKey: (key?: string) => (key?.startsWith("resource:") ? key.slice("resource:".length) : ""),
    resourceStorageKey: (id: string) => `resource:${id}`,
    uploadResourceFile: async (_blob: Blob, kind: string, _meta?: unknown, _onProgress?: unknown, options?: { expectedScope?: string; signal?: AbortSignal }) => {
        uploadCalls.push({ kind, expectedScope: options?.expectedScope, signalMatches: options?.signal === expectedSignal });
        if (scenario === "image-upload-abort" && kind === "image") throw new DOMException("image upload canceled", "AbortError");
        if (scenario === "media-upload-abort" && kind === "video") throw new DOMException("media upload canceled", "AbortError");
        return { id: `resource-${kind}`, mimeType: _blob.type };
    },
}));

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    if (scenario === "local-blob-switch") {
        await Promise.resolve();
        currentScope = "user-b";
        return new Response(new Blob(["image"], { type: "image/png" }));
    }
    return nativeFetch(input, init);
};

const { runBackendGenerationTask } = await import("../../src/services/api/generation-task?reference-account-scope-regression");
const { createModelChannel, defaultConfig, encodeChannelModel } = await import("../../src/stores/use-config-store");

function textConfig() {
    const channel = createModelChannel({
        id: "reference-account-scope-test",
        name: "Reference account scope test",
        baseUrl: "/api",
        apiKey: "test-key",
        interfaceType: "openai",
        models: ["text-model"],
    });
    const model = encodeChannelModel(channel.id, "text-model");
    return { ...defaultConfig, channels: [channel], model, textModel: model };
}

function task(status: "pending" | "completed") {
    const now = new Date().toISOString();
    return { id: "task-1", type: "canvas_text", status, prompt: "test", attempts: 1, createdAt: now, updatedAt: now, resultJson: JSON.stringify({ text: "done" }) };
}

async function run(input: Scenario) {
    scenario = input;
    currentScope = "user-a";
    createCalls = 0;
    uploadCalls.length = 0;
    const controller = new AbortController();
    expectedSignal = controller.signal;
    const referenceImages =
        input === "indexeddb-switch"
            ? [{ id: "image-1", name: "image.png", type: "image/png", dataUrl: "", storageKey: "image:user-a:reference" }]
            : input === "local-blob-switch"
              ? [{ id: "image-1", name: "image.png", type: "image/png", dataUrl: "data:image/png;base64,eA==" }]
              : input === "media-upload-abort"
                ? []
                : [{ id: "image-1", name: "image.png", type: "image/png", dataUrl: "", storageKey: "image:user-a:reference" }];
    const referenceVideos = input === "upload-options" || input === "media-upload-abort" ? [{ id: "video-1", name: "video.mp4", type: "video/mp4", url: "", storageKey: "video:user-a:reference" }] : [];

    let errorName = "";
    let errorMessage = "";
    try {
        await runBackendGenerationTask(
            {
                mode: "text",
                prompt: "test",
                config: textConfig(),
                expectedUserScope: "user-a",
                signal: controller.signal,
                referenceImages,
                referenceVideos,
            },
            {
                createId: () => "operation-1",
                createTask: async () => {
                    createCalls += 1;
                    return task("pending");
                },
                waitTask: async () => task("completed"),
            },
        );
    } catch (error) {
        errorName = error instanceof Error ? error.name : "";
        errorMessage = error instanceof Error ? error.message : String(error);
    }
    return { createCalls, uploadCalls, errorName, errorMessage };
}

self.onmessage = async (event: MessageEvent<Scenario>) => {
    try {
        self.postMessage({ ok: true, result: await run(event.data) });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) });
    }
};
