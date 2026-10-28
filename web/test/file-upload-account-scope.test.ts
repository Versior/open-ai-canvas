import { expect, test } from "bun:test";

type Scenario = "remote-success-account-switch" | "during-local-write" | "cleanup-unused";
type ScenarioResult = {
    requests: number;
    localWrites: number;
    errorName: string;
    storedKeys: string[];
    removedKeys: string[];
    revoked: string[];
    resolvedUrl: string;
};

async function runScenario(scenario: Scenario) {
    return await new Promise<ScenarioResult>((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/file-upload-account-scope.worker.ts", import.meta.url).href, { type: "module" });
        worker.onmessage = (event: MessageEvent<{ ok: true; result: ScenarioResult } | { ok: false; error: string }>) => {
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

test("account switch during media upload aborts without local fallback", async () => {
    const result = await runScenario("remote-success-account-switch");
    expect(result.errorName).toBe("AbortError");
    expect(result.requests).toBe(1);
    expect(result.localWrites).toBe(0);
});

test("account switch during the fallback write removes the old-scope blob", async () => {
    const result = await runScenario("during-local-write");
    expect(result.errorName).toBe("AbortError");
    expect(result.storedKeys).toEqual([]);
    expect(result.removedKeys).toHaveLength(1);
});

test("unused media cleanup revokes and forgets its cached object URL", async () => {
    const result = await runScenario("cleanup-unused");
    expect(result.revoked).toEqual(["blob:file-upload-1"]);
    expect(result.resolvedUrl).toBe("missing");
});
