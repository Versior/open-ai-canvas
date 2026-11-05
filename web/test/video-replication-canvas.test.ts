import { describe, expect, test } from "bun:test";

import { storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import { defaultReplicaPlan, type ReplicaShotTreatment, type VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { buildVideoTeardownCanvas } from "@/pages/video-replication/replication-canvas";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const shots = [1, 2, 3].map((index) => ({
    index,
    startMs: (index - 1) * 3000,
    endMs: index * 3000,
    boundary: index === 1 ? ("start" as const) : ("cut" as const),
    keyframeTimeMs: (index - 1) * 3000 + 1500,
    keyframeResourceId: `kf-${index}`,
    keyframeWidth: 288,
    keyframeHeight: 512,
}));
const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "res-src", durationMs: 9000, width: 1080, height: 1920, hasAudio: true },
    shots,
    grids: [{ resourceId: "grid-1", shotIndexes: [1, 2, 3], width: 896, height: 1568 }],
    transcript: { source: "none", language: "", segments: [] },
    warnings: [],
} as VideoTeardownBundle;
const row = (shotNumber: number, product: string, productRole: string) => ({
    shotNumber,
    plotDescription: `画面 ${shotNumber}`,
    dialogue: "",
    dialogueSource: "none",
    onScreenText: "",
    shotSize: "近景",
    camera: "",
    motion: "",
    lightingAndAtmosphere: "",
    emotion: "",
    audioEffects: "",
    production: "",
    productionConfidence: "",
    imageGenerationPrompt: `首帧 ${shotNumber}`,
    videoMotionPrompt: `视频 ${shotNumber}`,
    continuityOut: "",
    product,
    productRole,
    keyColors: "",
});
const analysis = { title: "纸巾测评", summary: null, rows: [row(1, "手拿一包绿色纸巾", "hero_real"), row(2, "", "none"), row(3, "纸巾堆在桌上", "dynamic")] } as unknown as VideoTeardownAnalysis;
const video: CanvasNodeData = { id: "video-1", type: CanvasNodeType.Video, title: "纸巾测评", position: { x: 0, y: 0 }, width: 270, height: 480, metadata: {} };
const product = (resourceId: string) => ({ resourceId, width: 800, height: 800, bytes: 1000, mimeType: "image/png" });

function planWith(treatments: ReplicaShotTreatment[], patch: Partial<VideoReplicaPlan> = {}): VideoReplicaPlan {
    const plan = defaultReplicaPlan(bundle, analysis);
    return { ...plan, ...patch, shots: plan.shots.map((shot, index) => ({ ...shot, treatment: treatments[index] })) };
}

function build(plan: VideoReplicaPlan) {
    const placed = buildVideoTeardownCanvas(video, bundle, analysis, "text-model", [video], { plan });
    const nodes = [video, ...placed.nodes];
    const script = nodes.find((node) => node.id === placed.scriptId)!;
    const frames = nodes.filter((node) => node.metadata?.videoFrameSourceNodeId === video.id);
    return { ...placed, nodes, script, rows: script.metadata!.storyboard!.rows, frames };
}

describe("去画布复刻", () => {
    test("creates a keyframe-mode storyboard instead of an image-only batch table", () => {
        const { nodes, script, rows } = build(planWith(["remake", "remake", "remake"]));
        expect(nodes.some((node) => node.type === CanvasNodeType.BatchTable)).toBe(false);
        expect(script.type).toBe(CanvasNodeType.Script);
        expect(script.metadata?.storyboardVideoInputMode).toBe("keyframe");
        expect(script.metadata?.storyboard?.referenceNodeIds).toEqual([]);
        expect(script.metadata?.storyboard?.visibleColumns).toContain("imageGenerationPrompt");
        // 重拍：不用原片画面，首帧都要重新生成。
        expect(rows.map((item) => item.imageNodeId)).toEqual([undefined, undefined, undefined]);
        expect(nodes.filter((node) => node.type === CanvasNodeType.Markdown)).toHaveLength(1);
    });

    test("original binds the keyframes as first frames only when authorized", () => {
        const { rows, frames } = build(planWith(["original", "original", "original"], { authorized: true }));
        expect(rows.map((item) => item.imageNodeId)).toEqual(frames.map((frame) => frame.id));
        expect(build(planWith(["original", "original", "original"])).rows.map((item) => item.imageNodeId)).toEqual([undefined, undefined, undefined]);
    });

    test("reuse with product photos prepares product-swap first frames referencing the keyframe then the product", () => {
        const base = planWith(["product", "original", "product"], { authorized: true });
        const { nodes, connections, script, rows, frames, swappedShots } = build({ ...base, product: { ...base.product, look: "白色包装", images: [product("p1")] } });
        expect(swappedShots).toEqual([1, 3]);
        const productNode = nodes.find((node) => node.title === "商品图 1")!;
        expect(productNode.metadata?.assetCategory).toBe("prop");
        expect(rows[1].imageNodeId).toBe(frames[1].id);
        for (const index of [0, 2]) {
            const firstFrame = nodes.find((node) => node.id === rows[index].imageNodeId)!;
            expect(firstFrame.metadata?.content).toBeFalsy();
            expect(rows[index].imageGenerationPrompt).toStartWith("第一张参考图是原画面");
            expect(rows[index].imageGenerationPrompt).toContain("白色包装");
            // 首帧生成：原画面在前、商品图在后；视频生成：只带首帧，商品图不进视频请求。
            expect(storyboardRowReferenceNodeIds(script, rows[index], nodes, connections, false, firstFrame.id)).toEqual([frames[index].id, productNode.id]);
            expect(storyboardRowReferenceNodeIds(script, rows[index], nodes, connections, true, "future-video")).toEqual([firstFrame.id]);
            expect(firstFrame.metadata?.composerContent).toContain("参考资产：");
        }
    });

    test("remake with product photos references only the product photos", () => {
        const base = planWith(["product", "remake", "remake"]);
        const { nodes, connections, script, rows } = build({ ...base, product: { ...base.product, images: [product("p1"), product("p2")] } });
        const productIds = nodes.filter((node) => node.title?.startsWith("商品图")).map((node) => node.id);
        const firstFrame = nodes.find((node) => node.id === rows[0].imageNodeId)!;
        expect(storyboardRowReferenceNodeIds(script, rows[0], nodes, connections, false, firstFrame.id)).toEqual(productIds);
        expect(rows[1].imageNodeId).toBeUndefined();
        expect(rows[0].videoMotionPrompt).toContain("首帧里的那件");
    });

    test("skipped shots leave the storyboard and edited dialogue, captions and prompts are used", () => {
        const base = planWith(["remake", "skip", "product"]);
        const plan = {
            ...base,
            product: { ...base.product, name: "保温杯", look: "奶白色杯身" },
            shots: base.shots.map((shot) => (shot.shotNumber === 1 ? { ...shot, dialogue: "早八人必备", onScreenText: "保温 12 小时", imagePrompt: "桌上一只保温杯" } : shot)),
        };
        const { rows, frames, nodes } = build(plan);
        expect(rows.map((item) => item.shotNumber)).toEqual([1, 3]);
        expect(frames).toHaveLength(3);
        expect(rows[0].dialogue).toBe("早八人必备");
        expect(rows[0].sourceAnalysis?.onScreenText).toBe("保温 12 小时");
        expect(rows[0].imageGenerationPrompt).toBe("桌上一只保温杯");
        // 换商品但没有商品图：商品写进提示词，不建预置首帧。
        expect(rows[1].imageNodeId).toBeUndefined();
        expect(rows[1].imageGenerationPrompt).toStartWith("画面里的商品是：保温杯，奶白色杯身");
        expect(nodes.some((node) => node.title?.startsWith("商品图"))).toBe(false);
    });
});
