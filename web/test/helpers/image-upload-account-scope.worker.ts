import { mock } from "bun:test";

let releaseDecode = () => {};
let markDecodeStarted = () => {};
const decodeStarted = new Promise<void>((resolve) => {
    markDecodeStarted = resolve;
});
const decodeGate = new Promise<void>((resolve) => {
    releaseDecode = resolve;
});
let requests = 0;
const revoked: string[] = [];
const localStorageValues = new Map<string, string>();

URL.createObjectURL = () => "blob:image-account-scope";
URL.revokeObjectURL = (url) => {
    revoked.push(url);
};

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

mock.module("@/lib/image-utils", () => ({
    readImageMeta: async () => {
        markDecodeStarted();
        await decodeGate;
        return { width: 1200, height: 1600, mimeType: "image/png" };
    },
}));

const { apiClient } = await import("../../src/services/api/request");
apiClient.defaults.adapter = async (config) => {
    requests += 1;
    return {
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: { code: 0, data: { resource: { id: "wrong-account-resource", publicUrl: "", width: 1200, height: 1600, size: 1, mimeType: "image/png" } } },
    };
};

self.onmessage = async () => {
    try {
        const { setActiveUserScope } = await import("../../src/lib/user-scope");
        const { uploadImage } = await import("../../src/services/image-storage?account-scope-regression");
        setActiveUserScope("account-a");
        const upload = uploadImage(new Blob(["image"], { type: "image/png" }), undefined, undefined, { expectedScope: "account-a" });
        await decodeStarted;
        setActiveUserScope("account-b");
        releaseDecode();
        let errorName = "";
        let errorMessage = "";
        try {
            await upload;
        } catch (error) {
            errorName = error instanceof Error ? error.name : "";
            errorMessage = error instanceof Error ? error.message : String(error);
        }
        self.postMessage({ ok: true, result: { requests, errorName, errorMessage, revoked } });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack || error.message : String(error) });
    }
};
