/// <reference lib="webworker" />
import { nestPackagingSheet, type NestingRequest, type NestingResponse } from "./nesting";

self.onmessage = (event: MessageEvent<NestingRequest>) => {
    const send = (response: NestingResponse) => self.postMessage(response);
    try {
        send({ type: "done", plan: nestPackagingSheet(event.data.layout, event.data.options, event.data.budgetMs, (plan) => send({ type: "progress", plan })) });
    } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "轮廓排料失败" });
    }
};
