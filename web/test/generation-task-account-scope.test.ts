import { afterEach, expect, test } from "bun:test";

import { setActiveUserScope } from "../src/lib/user-scope";
import { runBackendGenerationTask, runBackendGenerationTaskBatch } from "../src/services/api/generation-task";
import type { GenerationTask } from "../src/services/api/task-center";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

function installUserScope(scope: string) {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    storage.set(key, value);
                },
                removeItem: (key: string) => {
                    storage.delete(key);
                },
            },
        },
    });
    setActiveUserScope(scope);
}

function textConfig() {
    const channel = createModelChannel({
        id: "account-scope-test",
        name: "Account scope test",
        baseUrl: "/api",
        apiKey: "test-key",
        interfaceType: "openai",
        models: ["text-model"],
    });
    const model = encodeChannelModel(channel.id, "text-model");
    return { ...defaultConfig, channels: [channel], model, textModel: model };
}

function task(status: GenerationTask["status"], id = "task-1"): GenerationTask {
    const now = new Date().toISOString();
    return { id, type: "canvas_text", status, prompt: "test", attempts: 1, createdAt: now, updatedAt: now, resultJson: JSON.stringify({ text: "done" }) };
}

function deferred<T>() {
    let resolve!: (value?: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test("account scope is rechecked after reference preparation and before task creation", async () => {
    installUserScope("user-a");
    let createCalls = 0;
    const pending = runBackendGenerationTask(
        {
            mode: "text",
            prompt: "test",
            config: textConfig(),
            expectedUserScope: "user-a",
            referenceImages: [
                {
                    id: "reference-1",
                    name: "reference.png",
                    type: "image/png",
                    dataUrl: "",
                    url: "https://cdn.example.com/reference.png",
                },
            ],
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

    setActiveUserScope("user-b");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(createCalls).toBe(0);
});
type ReferenceScenario = "indexeddb-switch" | "local-blob-switch" | "upload-options" | "image-upload-abort" | "media-upload-abort";
type ReferenceScenarioResult = {
    createCalls: number;
    uploadCalls: Array<{ kind: string; expectedScope?: string; signalMatches: boolean }>;
    errorName: string;
    errorMessage: string;
};

async function runReferenceScenario(scenario: ReferenceScenario) {
    return await new Promise<ReferenceScenarioResult>((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/generation-task-reference-account-scope.worker.ts", import.meta.url).href, { type: "module" });
        worker.onmessage = (event: MessageEvent<{ ok: true; result: ReferenceScenarioResult } | { ok: false; error: string }>) => {
            worker.terminate();
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error));
        };
        worker.onerror = (event) => {
            worker.terminate();
            reject(event.error ?? new Error(event.message));
        };
        worker.postMessage(scenario);
    });
}

test("switching accounts while loading an IndexedDB reference prevents upload", async () => {
    const result = await runReferenceScenario("indexeddb-switch");
    expect(result.uploadCalls).toHaveLength(0);
    expect(result.createCalls).toBe(0);
    expect(result.errorName).toBe("AbortError");
});

test("switching accounts while resolving a local Blob reference prevents upload", async () => {
    const result = await runReferenceScenario("local-blob-switch");
    expect(result.uploadCalls).toHaveLength(0);
    expect(result.createCalls).toBe(0);
    expect(result.errorName).toBe("AbortError");
});

test("reference uploads receive the account boundary and cancellation signal", async () => {
    const result = await runReferenceScenario("upload-options");
    expect(result.errorName).toBe("");
    expect(result.createCalls).toBe(1);
    expect(result.uploadCalls).toEqual([
        { kind: "image", expectedScope: "user-a", signalMatches: true },
        { kind: "video", expectedScope: "user-a", signalMatches: true },
    ]);
});

test("reference upload cancellation preserves AbortError semantics", async () => {
    for (const scenario of ["image-upload-abort", "media-upload-abort"] as const) {
        const result = await runReferenceScenario(scenario);
        expect(result.createCalls).toBe(0);
        expect(result.errorName).toBe("AbortError");
        expect(result.errorMessage).toContain("upload canceled");
        expect(result.errorMessage).not.toContain("参考");
    }
});

test("generation captures the current account scope when the caller omits it", async () => {
    installUserScope("user-a");
    let createCalls = 0;
    const pending = runBackendGenerationTask(
        { mode: "text", prompt: "test", config: textConfig() },
        {
            createId: () => "operation-1",
            createTask: async () => {
                createCalls += 1;
                return task("pending");
            },
            waitTask: async () => task("completed"),
        },
    );

    setActiveUserScope("user-b");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(createCalls).toBe(0);
});

test("switching accounts while waiting blocks stale task updates and the completed result", async () => {
    installUserScope("user-a");
    const waitStarted = deferred<void>();
    const releaseWait = deferred<void>();
    const updates: GenerationTask["status"][] = [];
    let callbackError: unknown;
    const pending = runBackendGenerationTask(
        {
            mode: "text",
            prompt: "test",
            config: textConfig(),
            onTaskUpdate: (value) => updates.push(value.status),
        },
        {
            createId: () => "operation-1",
            createTask: async () => task("pending"),
            waitTask: async (_id, options) => {
                waitStarted.resolve();
                await releaseWait.promise;
                try {
                    options?.onTaskUpdate?.(task("running"));
                } catch (error) {
                    callbackError = error;
                }
                return task("completed");
            },
        },
    );

    await waitStarted.promise;
    setActiveUserScope("user-b");
    releaseWait.resolve();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(callbackError).toMatchObject({ name: "AbortError" });
    expect(updates).toEqual(["pending"]);
});

test("switching accounts while waiting blocks stale text deltas", async () => {
    installUserScope("user-a");
    const waitStarted = deferred<void>();
    const releaseWait = deferred<void>();
    const deltas: string[] = [];
    let callbackError: unknown;
    const pending = runBackendGenerationTask(
        {
            mode: "text",
            prompt: "test",
            config: textConfig(),
            streamText: true,
            onTextDelta: (text) => deltas.push(text),
        },
        {
            createId: () => "operation-1",
            createTask: async () => task("pending"),
            waitTask: async (_id, options) => {
                waitStarted.resolve();
                await releaseWait.promise;
                try {
                    options?.onTextDelta?.("stale delta");
                } catch (error) {
                    callbackError = error;
                }
                return task("completed");
            },
        },
    );

    await waitStarted.promise;
    setActiveUserScope("user-b");
    releaseWait.resolve();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(callbackError).toMatchObject({ name: "AbortError" });
    expect(deltas).toEqual([]);
});

test("switching accounts while a batch waits rejects every result and blocks stale updates", async () => {
    installUserScope("user-a");
    const allWaitsStarted = deferred<void>();
    const releaseWaits = deferred<void>();
    const updates: GenerationTask["status"][] = [];
    const callbackErrors: unknown[] = [];
    let createCalls = 0;
    let waitCalls = 0;
    const pending = runBackendGenerationTaskBatch(
        {
            mode: "text",
            prompt: "test",
            config: textConfig(),
            count: 2,
            onTaskUpdate: (value) => updates.push(value.status),
        },
        {
            createId: () => `operation-${createCalls + 1}`,
            createTask: async () => task("pending", `task-${++createCalls}`),
            waitTask: async (id, options) => {
                waitCalls += 1;
                if (waitCalls === 2) allWaitsStarted.resolve();
                await releaseWaits.promise;
                try {
                    options?.onTaskUpdate?.(task("running", id));
                } catch (error) {
                    callbackErrors.push(error);
                }
                return task("completed", id);
            },
        },
    );

    await allWaitsStarted.promise;
    setActiveUserScope("user-b");
    releaseWaits.resolve();

    const results = await pending;
    expect(results).toHaveLength(2);
    for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") expect(result.reason).toMatchObject({ name: "AbortError" });
    }
    expect(callbackErrors).toHaveLength(2);
    for (const error of callbackErrors) expect(error).toMatchObject({ name: "AbortError" });
    expect(updates).toEqual(["pending", "pending"]);
});
