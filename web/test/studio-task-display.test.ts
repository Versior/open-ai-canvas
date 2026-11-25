import { expect, test } from "bun:test";
import { studioGroupProgress, studioShotDisplay } from "@/lib/ecommerce-studio/task-display";
import { normalizeStudioProduct, studioShotApproved, studioShotPendingReview } from "@/lib/ecommerce-studio/product";
import type { StudioShot } from "@/lib/ecommerce-studio/types";
import type { GenerationTask } from "@/services/api/task-center";

function shot(status: "running" | "failed" | "succeeded", id = "screen"): StudioShot {
    return {
        id,
        role: "detail-scene",
        title: "场景",
        ratio: "3:4",
        headline: "",
        subline: "",
        lines: [],
        tweaks: [],
        sellingPointIds: [],
        attempts: [{ id: `attempt-${id}`, taskId: id, status, model: "image", createdAt: "", tweaks: [], outputs: status === "succeeded" ? [{ resourceId: id, url: "" }] : [], error: status === "failed" ? "下载结果失败" : undefined }],
    };
}

function task(status: GenerationTask["status"], patch: Partial<GenerationTask> = {}): GenerationTask {
    return { id: "screen", status, type: "canvas_image", prompt: "", createdAt: "", updatedAt: "", attempts: 1, ...patch };
}

test("已生成但保存失败提供恢复状态，不冒充重新生成", () => {
    expect(studioShotDisplay(shot("failed"), task("failed", { canRecoverMedia: true, mediaStage: "download" }))).toMatchObject({ state: "recover", label: "保存未完成", detail: expect.stringContaining("不会重新生成") });
    expect(studioShotDisplay(shot("failed"), task("failed", { canRecoverMedia: false }))).toMatchObject({ state: "failed", label: "生成失败" });
});

test("提交未知或费用未确认都要求核对，不引导自动重新生成", () => {
    expect(studioShotDisplay(shot("failed"), task("failed", { stage: "submission_unknown" }))).toMatchObject({ state: "review" });
    expect(studioShotDisplay(shot("failed"), task("failed", { billing: { amountMicrocredits: 1, reservedMicrocredits: 1, refundedMicrocredits: 0, status: "uncertain" } }))).toMatchObject({ state: "review" });
});

test("进行中的状态展示原任务真实保存阶段", () => {
    expect(studioShotDisplay(shot("running"), task("running", { mediaStage: "download", stage: "作品已生成，正在保存" }))).toMatchObject({ state: "active", label: "已生成，正在存入素材库" });
});

test("新成品无需视觉复核即可交付，旧记录保持兼容", () => {
    const generated = shot("succeeded", "visual");
    generated.attempts[0].visualReview = { status: "pending" };
    expect(studioShotPendingReview(generated)).toBe(false);
    expect(studioShotApproved(generated)).toBe(true);
    generated.attempts[0].visualReview = { status: "passed" };
    expect(studioShotPendingReview(generated)).toBe(false);
    expect(studioShotApproved(generated)).toBe(true);
    const legacy = shot("succeeded", "legacy");
    expect(studioShotApproved(legacy)).toBe(true);
});

test("视觉复核结果随商品记录恢复并保留修正要求", () => {
    const product = normalizeStudioProduct({
        id: "review-product",
        plans: [
            {
                id: "plan",
                kind: "main",
                shots: [
                    {
                        id: "screen",
                        role: "main-selling",
                        attempts: [
                            {
                                id: "attempt",
                                status: "succeeded",
                                outputs: [{ resourceId: "output", url: "/api/resources/output/file" }],
                                visualReview: {
                                    status: "failed",
                                    revision: "把商品移到右侧，减少标题占比",
                                    findings: [{ area: "design", status: "fail", evidence: "商品和标题竞争焦点", correction: "把商品移到右侧" }],
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    });
    const attempt = product?.plans[0].shots[0].attempts[0];
    expect(attempt?.visualReview?.status).toBe("failed");
    expect(attempt?.visualReview?.revision).toContain("减少标题");
    expect(studioShotPendingReview(product!.plans[0].shots[0])).toBe(false);
});

test("逐屏概览分别计数完成、生成、未提交、待保存、核对和失败", () => {
    const pending = { ...shot("failed", "pending"), attempts: [] };
    const shots = [shot("succeeded", "done"), shot("running", "active"), pending, shot("failed", "recover"), shot("failed", "review"), shot("failed", "failed")];
    const tasks = { recover: task("failed", { id: "recover", canRecoverMedia: true }), review: task("failed", { id: "review", stage: "submission_unknown" }) };
    expect(studioGroupProgress(shots, tasks)).toMatchObject({ done: 1, active: 1, pending: 1, recover: 1, review: 1, failed: 1, total: 6 });
});
