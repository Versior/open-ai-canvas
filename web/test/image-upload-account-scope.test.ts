import { expect, test } from "bun:test";

async function runDelayedDecodeScenario() {
    return await new Promise<{ requests: number; errorName: string; errorMessage: string; revoked: string[] }>((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/image-upload-account-scope.worker.ts", import.meta.url).href, { type: "module" });
        worker.onmessage = (event: MessageEvent<{ ok: true; result: { requests: number; errorName: string; errorMessage: string; revoked: string[] } } | { ok: false; error: string }>) => {
            worker.terminate();
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error));
        };
        worker.onerror = (event) => {
            worker.terminate();
            reject(event.error ?? new Error(event.message));
        };
        worker.postMessage("run");
    });
}

test("switching accounts while image metadata decodes prevents the authenticated upload", async () => {
    const result = await runDelayedDecodeScenario();
    expect(result.requests).toBe(0);
    expect(result.errorName).toBe("AbortError");
    expect(result.errorMessage).toContain("账号已切换");
    expect(result.revoked).toEqual(["blob:image-account-scope"]);
});

async function runFallbackScenario(scenario: "before-local-write" | "during-local-write") {
    return await new Promise<{ errorName: string; storedKeys: string[]; removedKeys: string[]; revoked: string[] }>((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/image-upload-fallback-account-scope.worker.ts", import.meta.url).href, { type: "module" });
        worker.onmessage = (event: MessageEvent<{ ok: true; result: { errorName: string; storedKeys: string[]; removedKeys: string[]; revoked: string[] } } | { ok: false; error: string }>) => {
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

for (const scenario of ["before-local-write", "during-local-write"] as const) {
    test(`${scenario} account switch aborts fallback without retaining local data or object URL`, async () => {
        const result = await runFallbackScenario(scenario);
        expect(result.errorName).toBe("AbortError");
        expect(result.storedKeys).toEqual([]);
        if (scenario === "during-local-write") expect(result.removedKeys).toHaveLength(1);
        expect(result.revoked).toEqual(["blob:image-fallback"]);
    });
}
