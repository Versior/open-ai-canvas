import { mock } from "bun:test";

let scenario: "before-local-write" | "during-local-write" = "before-local-write";
let markRequestStarted = () => {};
let releaseRequest = () => {};
let markWriteStarted = () => {};
let releaseWrite = () => {};
const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
});
const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
});
const writeStarted = new Promise<void>((resolve) => {
    markWriteStarted = resolve;
});
const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
});
const stored = new Map<string, unknown>();
const removedKeys: string[] = [];
const revoked: string[] = [];
const localStorageValues = new Map<string, string>();

Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
        addEventListener: () => {},
        removeEventListener: () => {},
        localStorage: {
            getItem: (key: string) => localStorageValues.get(key) ?? null,
            setItem: (key: string, value: string) => localStorageValues.set(key, value),
        },
    },
});

URL.createObjectURL = () => "blob:image-fallback";
URL.revokeObjectURL = (url) => {
    revoked.push(url);
};

mock.module("localforage", () => ({
    default: {
        config: () => {},
        createInstance: () => ({
            setItem: async (key: string, value: unknown) => {
                markWriteStarted();
                if (scenario === "during-local-write") await writeGate;
                stored.set(key, value);
                return value;
            },
            removeItem: async (key: string) => {
                removedKeys.push(key);
                stored.delete(key);
            },
            getItem: async (key: string) => stored.get(key) ?? null,
            iterate: async () => undefined,
        }),
    },
}));

mock.module("@/lib/image-utils", () => ({
    readImageMeta: async () => ({ width: 1200, height: 800, mimeType: "image/png" }),
}));

const { apiClient } = await import("../../src/services/api/request");
apiClient.defaults.adapter = async () => {
    markRequestStarted();
    if (scenario === "before-local-write") await requestGate;
    throw new Error("network unavailable");
};

self.onmessage = async (event: MessageEvent<typeof scenario>) => {
    try {
        scenario = event.data;
        const { setActiveUserScope } = await import("../../src/lib/user-scope");
        const { uploadImage } = await import("../../src/services/image-storage?fallback-account-scope-regression");
        setActiveUserScope("account-a");
        const upload = uploadImage(new Blob(["image"], { type: "image/png" }), undefined, { width: 1200, height: 800 }, { expectedScope: "account-a" });
        await (scenario === "before-local-write" ? requestStarted : writeStarted);
        setActiveUserScope("account-b");
        if (scenario === "before-local-write") releaseRequest();
        else releaseWrite();
        let errorName = "";
        try {
            await upload;
        } catch (error) {
            errorName = error instanceof Error ? error.name : "";
        }
        self.postMessage({ ok: true, result: { errorName, storedKeys: [...stored.keys()], removedKeys, revoked } });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) });
    }
};
