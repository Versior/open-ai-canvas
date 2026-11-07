import { afterEach, expect, test } from "bun:test";
import { generateFashion } from "@/services/fashion-generation";
import { apiClient } from "@/services/api/request";
import { defaultConfig } from "@/stores/use-config-store";
import type { FashionUnit } from "@/lib/fashion/workflow";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

test("restoring known image and video tasks reads original IDs without creating paid tasks", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true, localStorage: { getItem: () => "fashion-test" }, setTimeout, clearTimeout } });
    const calls: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push(`${config.method} ${config.url}`);
        const video = config.url?.endsWith("fashion-history-video");
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: {
                code: 0,
                msg: "",
                data: {
                    id: video ? "fashion-history-video" : "fashion-history-image",
                    type: video ? "canvas_video" : "canvas_image",
                    status: "succeeded",
                    prompt: "历史处理",
                    attempts: 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    resultJson: JSON.stringify(video ? { video: { storageKey: "resource:history-video" } } : { images: [{ storageKey: "resource:history-image" }] }),
                },
            },
        };
    };
    const unit: FashionUnit = { id: "history-unit", title: "历史处理", prompt: "历史提示", references: [], status: "running", taskId: "fashion-history-image" };
    const onSubmitted = async () => {
        throw new Error("恢复任务不得重新提交");
    };
    expect((await generateFashion(unit, defaultConfig, "image", onSubmitted)).resourceId).toBe("history-image");
    expect((await generateFashion({ ...unit, resourceId: "history-image", video: { taskId: "fashion-history-video", model: "removed-model", seconds: 5, prompt: "原动作" } }, defaultConfig, "video", onSubmitted)).resourceId).toBe("history-video");
    expect(calls).toEqual(["get /tasks/fashion-history-image", "get /tasks/fashion-history-video"]);
});
