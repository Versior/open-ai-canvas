import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://example.test/" });
for (const key of ["window", "document", "navigator", "localStorage"]) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
Object.defineProperty(dom.navigator, "locks", { configurable: true, value: undefined });
const { createGenerationTask, retryGenerationTask, recoverGenerationTaskMedia } = await import("@/services/api/task-center");
const { apiClient } = await import("@/services/api/request");
let sent = 0;
apiClient.defaults.adapter = async () => {
    sent += 1;
    throw new Error("transport reached");
};

afterAll(() => dom.happyDOM.abort());
test("缺少存储锁时，在创建、重试和恢复媒体任务的网络请求前阻止提交", () => {
    for (const type of ["canvas_image", "canvas_video", "canvas_audio"]) {
        expect(() => createGenerationTask({ type, prompt: "test" })).toThrow("HTTPS");
        expect(() => retryGenerationTask("synthetic-task", type)).toThrow("HTTPS");
    }
    expect(() => recoverGenerationTaskMedia("synthetic-task")).toThrow("HTTPS");
    expect(sent).toBe(0);
});
test("文本任务和文本重试不受媒体存储能力限制", async () => {
    await expect(createGenerationTask({ type: "canvas_text", operation: "text", prompt: "test" })).rejects.toThrow("transport reached");
    await expect(retryGenerationTask("synthetic-text", "canvas_text")).rejects.toThrow("transport reached");
    expect(sent).toBe(2);
});
test("具备 Web Locks 时，允许媒体任务进入统一网络入口", async () => {
    Object.defineProperty(dom.navigator, "locks", { configurable: true, value: { request: async (_name: string, operation: () => Promise<unknown>) => operation() } });
    await expect(createGenerationTask({ type: "canvas_image", operation: "image", prompt: "test" })).rejects.toThrow("transport reached");
    expect(sent).toBe(3);
});
