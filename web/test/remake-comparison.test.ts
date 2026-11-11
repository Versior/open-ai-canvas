import { describe, expect, it } from "bun:test";
import { remakeComparison } from "../src/lib/remake/comparison";
import { createRemakeJob, normalizeRemakeJob, duplicateRemakeJob } from "../src/lib/remake/job";
import { remakeEditRenderSignature } from "../src/lib/remake/editor";

function jobFixture() {
    const job = createRemakeJob("comparison", {
        teardownId: "teardown",
        sourceName: "对比验收",
        analysis: null,
        bundle: { version: 1, source: { resourceId: "original", durationMs: 6000, width: 720, height: 1280, hasAudio: true }, shots: [], grids: [], transcript: { source: "asr", segments: [] }, warnings: [] },
    });
    job.authorized = true;
    job.render = {
        resourceId: "render",
        width: 720,
        height: 1280,
        durationMs: 2000,
        sourcePieces: [
            { sourceStartMs: 500, durationMs: 1000 },
            { sourceStartMs: 4000, durationMs: 1000 },
        ],
    };
    return job;
}

describe("原片左右对比", () => {
    it("按成片的冻结镜头映射跳过已删范围，输出合计画幅", () => {
        const timeline = remakeComparison(jobFixture(), "render");
        expect(timeline.width).toBe(1440);
        expect(timeline.height).toBe(1280);
        expect(timeline.durationMs).toBe(2000);
        expect(timeline.clips[0].directMedia?.storageKey).toBe("resource:render");
        expect(timeline.comparison?.clips.map((clip) => [clip.startMs, clip.sourceStartMs, clip.durationMs])).toEqual([
            [0, 500, 1000],
            [1000, 4000, 1000],
        ]);
    });
    it("拒绝无原片、无成片、未授权和超时范围", () => {
        const job = jobFixture();
        expect(() => remakeComparison({ ...job, source: undefined }, "render")).toThrow("没有原片");
        expect(() => remakeComparison({ ...job, authorized: false }, "render")).toThrow("授权");
        expect(() => remakeComparison({ ...job, render: undefined }, "render")).toThrow("先拼成片");
        expect(() => remakeComparison({ ...job, render: { ...job.render, sourcePieces: undefined } }, "render")).toThrow("对齐记录");
        job.render!.sourcePieces![1].sourceStartMs = 5900;
        expect(() => remakeComparison(job, "render")).toThrow("超出");
    });
    it("声音和成片变化改变快照，刷新保留任务，复制清除产物", () => {
        const job = jobFixture();
        const signature = JSON.stringify(remakeComparison(job, "mute"));
        expect(JSON.stringify(remakeComparison(job, "reference"))).not.toBe(signature);
        job.comparisonRender = { signature, audio: "mute", taskId: "task", resourceId: "comp" };
        const normalized = normalizeRemakeJob(job)!;
        expect(normalized.comparisonRender?.resourceId).toBe("comp");
        expect(normalized.render?.sourcePieces).toEqual(job.render!.sourcePieces);
        expect(duplicateRemakeJob(job, "copy", { title: "副本" }).comparisonRender).toBeUndefined();
    });
    it("剪辑的裁剪和烧录变化使旧导出过期，单纯保存不会过期", () => {
        const timeline = remakeComparison(jobFixture(), "render");
        const size = { width: 720, height: 1280 };
        const signature = remakeEditRenderSignature(timeline, size, false);
        expect(remakeEditRenderSignature({ ...timeline, updatedAt: "2026-11-11" }, size, false)).toBe(signature);
        expect(remakeEditRenderSignature(timeline, size, true)).not.toBe(signature);
        expect(remakeEditRenderSignature({ ...timeline, clips: timeline.clips.map((clip) => ({ ...clip, sourceStartMs: 500 })) }, size, false)).not.toBe(signature);
    });
});
