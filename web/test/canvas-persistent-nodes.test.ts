import { expect, test } from "bun:test";
import { canvasPersistentNodes } from "@/lib/canvas/canvas-persistent-nodes";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

function image(index: number, metadata: CanvasNodeMetadata): CanvasNodeData {
    return { id: String(index), type: CanvasNodeType.Image, title: String(index), position: { x: index * 160, y: 10 }, width: 160, height: 90, metadata };
}

test.each([500, 1000])("%s 个节点的位置变化和回撤不再为比较相等而遍历媒体、提示词或任务结果", (count) => {
    const reads = { media: 0, prompt: 0, task: 0 };
    const metadata: CanvasNodeMetadata = {
        taskId: "finished",
        status: "success",
        get storageKey() {
            reads.media++;
            return "resource:preview";
        },
        get prompt() {
            reads.prompt++;
            return "室内远景";
        },
        get taskStatus() {
            reads.task++;
            return "succeeded";
        },
    };
    const original = Array.from({ length: 1000 }, (_, index) => image(index, metadata));
    const before = canvasPersistentNodes(original);
    const drag = original.map((node, index) => (index >= count ? node : { ...node, position: index % 2 ? { ...node.position, y: 12 } : { ...node.position, x: node.position.x + 8 } }));
    const after = canvasPersistentNodes(drag, before);
    const undo = canvasPersistentNodes(original, after);
    expect(reads).toEqual({ media: 0, prompt: 0, task: 0 });
    expect(after.every((node, index) => node === drag[index])).toBe(true);
    expect(undo.every((node, index) => node === original[index])).toBe(true);
});

test("移动中仍先剥离任务瞬态进度，同时保留任务身份和新改的提示词", () => {
    const original = image(0, { taskId: "live", status: "loading", prompt: "旧提示", taskProgress: 10, taskUpdatedAt: "09:30" });
    const before = canvasPersistentNodes([original]);
    const move = { ...original, position: { x: 24, y: 10 }, metadata: { ...original.metadata, prompt: "新提示", taskProgress: 40, taskUpdatedAt: "09:31" } };
    const after = canvasPersistentNodes([move], before);
    expect(after[0].position).toEqual({ x: 24, y: 10 });
    expect(after[0].metadata).toEqual({ taskId: "live", status: "loading", prompt: "新提示" });
    expect(move.metadata.taskProgress).toBe(40);
    expect(canvasPersistentNodes([original], after)[0]).toBe(before[0]);
});

test("坐标未变时继续按规范化后的持久数据比较，而不是仅凭坐标或对象引用去重", () => {
    const original = image(1, { taskId: "live", status: "loading", prompt: "远景", taskProgress: 10 });
    const before = canvasPersistentNodes([original]);
    const polling = { ...original, position: { ...original.position }, metadata: { taskProgress: 60, prompt: "远景", status: "loading" as const, taskId: "live" } };
    expect(canvasPersistentNodes([polling], before)).toBe(before);
    const edit = canvasPersistentNodes([{ ...polling, metadata: { ...polling.metadata, prompt: "近景" } }], before);
    expect(edit).not.toBe(before);
    expect(edit[0].metadata).toEqual({ taskId: "live", status: "loading", prompt: "近景" });
    const nonFinite = { ...original, position: { x: Infinity, y: 0 } };
    const canonical = canvasPersistentNodes([nonFinite]);
    expect(canvasPersistentNodes([{ ...nonFinite, position: { x: NaN, y: 0 } }], canonical)).toBe(canonical);
});
