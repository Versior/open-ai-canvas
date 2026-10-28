import { mock } from "bun:test";

type Scenario = "remote-success-account-switch" | "during-local-write" | "cleanup-unused";

let scenario: Scenario = "remote-success-account-switch";
let localWrites = 0;
let requests = 0;
let createdUrls = 0;
let markWriteStarted = () => {};
let releaseWrite = () => {};
const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
});
const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
});
const localStorageValues = new Map<string, string>();
const stored = new Map<string, unknown>();
const removedKeys: string[] = [];
const revoked: string[] = [];

URL.createObjectURL = () => `blob:file-upload-${++createdUrls}`;
URL.revokeObjectURL = (url) => {
    revoked.push(url);
};

mock.module("localforage", () => ({
    default: {
        config: () => {},
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
        iterate: async () => {},
        createInstance: () => ({
            setItem: async (key: string, value: unknown) => {
                localWrites += 1;
                if (scenario === "during-local-write") {
                    markWriteStarted();
                    await writeGate;
                }
                stored.set(key, value);
                return value;
            },
            getItem: async (key: string) => stored.get(key) ?? null,
            removeItem: async (key: string) => {
                removedKeys.push(key);
                stored.delete(key);
            },
            iterate: async (callback: (value: unknown, key: string) => void) => {
                stored.forEach((value, key) => callback(value, key));
            },
        }),
    },
}));

Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
        location: { href: "http://localhost/" },
        addEventListener: () => {},
        removeEventListener: () => {},
        localStorage: {
            getItem: (key: string) => localStorageValues.get(key) ?? null,
            setItem: (key: string, value: string) => localStorageValues.set(key, value),
        },
    },
});

Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        createElement: () => {
            const audio = {
                duration: 1,
                onloadedmetadata: null as null | (() => void),
                onerror: null as null | (() => void),
                set src(_value: string) {
                    queueMicrotask(() => audio.onloadedmetadata?.());
                },
            };
            return audio;
        },
    },
});

const { apiClient } = await import("../../src/services/api/request");
apiClient.defaults.adapter = async (config) => {
    requests += 1;
    if (scenario === "during-local-write") throw new Error("network unavailable");
    const { setActiveUserScope } = await import("../../src/lib/user-scope");
    setActiveUserScope("account-b");
    return {
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: { code: 0, data: { resource: { id: "account-a-audio", kind: "audio", status: "ready", publicUrl: "", size: 5, mimeType: "audio/mpeg" } } },
    };
};

self.onmessage = async (event: MessageEvent<Scenario>) => {
    try {
        scenario = event.data;
        const { setActiveUserScope } = await import("../../src/lib/user-scope");
        const fileStorage = await import("../../src/services/file-storage?account-scope-regression");
        setActiveUserScope("account-a");
        if (scenario === "cleanup-unused") {
            const storageKey = "audio:account-a:cleanup";
            await fileStorage.setMediaBlob(storageKey, new Blob(["audio"], { type: "audio/mpeg" }));
            await fileStorage.cleanupUnusedMedia({}, "account-a");
            const resolvedUrl = await fileStorage.resolveMediaUrl(storageKey, "missing");
            self.postMessage({ ok: true, result: { requests, localWrites, errorName: "", storedKeys: [...stored.keys()], removedKeys, revoked, resolvedUrl } });
            return;
        }
        const upload = fileStorage.uploadMediaFile(new File(["audio"], "voice.mp3", { type: "audio/mpeg" }), "audio", undefined, { expectedScope: "account-a" });
        if (scenario === "during-local-write") {
            await writeStarted;
            setActiveUserScope("account-b");
            releaseWrite();
        }
        let errorName = "";
        try {
            await upload;
        } catch (error) {
            errorName = error instanceof Error ? error.name : "";
        }
        self.postMessage({ ok: true, result: { requests, localWrites, errorName, storedKeys: [...stored.keys()], removedKeys, revoked, resolvedUrl: "" } });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) });
    }
};
