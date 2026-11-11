import { expect, test } from "bun:test";
import { createRemakeJob, normalizeRemakeJob, remakeJobError } from "@/lib/remake/job";
import { remakeContinuityImage, remakeContinuityInput, remakeContinuityMaterials } from "@/lib/remake/continuity";
import { buildRemakeUnitPrompt, remakeReferenceImages } from "@/lib/remake/prompts";
import { remakeTimeline, remakeVoiceSignature } from "@/lib/remake/timeline";
import { applyRemakeCreativeSignature, planRemakeUnits, remakeTakeReviewError } from "@/lib/remake/units";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

function fixture() {
    const bundle: VideoTeardownBundle = {
        version: 1,
        source: { resourceId: "source", durationMs: 20000, width: 720, height: 1280, hasAudio: true },
        shots: [{ index: 1, startMs: 6000, endMs: 10000, boundary: "cut", keyframeTimeMs: 6500, keyframeResourceId: "old-face-and-product", keyframeWidth: 720, keyframeHeight: 1280 }],
        grids: [],
        transcript: { source: "none", segments: [] },
        warnings: [],
    };
    const job = createRemakeJob("quality", { teardownId: "teardown", bundle, analysis: null, sourceName: "原片" });
    job.model = "video";
    job.product.images = [{ id: "product", resourceId: "target-product", name: "目标商品" }];
    job.models = [{ id: "model", resourceId: "target-model", name: "目标模特", role: "figure" }];
    job.shots[0] = { ...job.shots[0], speaker: true, risks: ["face", "product"], dialogue: "看这包纸巾" };
    job.units = planRemakeUnits(job.shots, { maxMs: 15000, sourceDurationMs: 20000 });
    return job;
}

test("换模特与商品时不把原脸和原包装关键帧作为共同身份图提交", () => {
    const job = fixture();
    expect(remakeReferenceImages(job).images.map((image) => image.resourceId)).toEqual(["target-product", "target-model"]);
});

test("一个口播镜头也必须提供身份图和商品图，不能随机选演员或借原商品", () => {
    const job = fixture();
    job.models = [];
    expect(remakeJobError(job)).toContain("人脸或模特参考图");
    job.models = [{ id: "model", resourceId: "target-model", name: "模特" }];
    job.product.images = [];
    expect(remakeJobError(job)).toContain("商品图");
});

test("台词按生成片段相对秒数绑定，不在补齐的前后镜头说话", () => {
    const job = fixture();
    job.units[0].clipStartMs = 5000;
    const prompt = buildRemakeUnitPrompt(job, job.units[0], job.shots, 6);
    expect(prompt).toContain("1.000–5.000 秒");
    expect(prompt).toContain("补齐区间不说台词");
});

test("有口播的长镜头不能把完整台词重复发给两个生成单元", () => {
    const job = fixture();
    job.shots[0].startMs = 0;
    job.shots[0].endMs = 20000;
    job.units = planRemakeUnits(job.shots, { maxMs: 10000, sourceDurationMs: 20000 });
    expect(() => buildRemakeUnitPrompt(job, job.units[0], job.shots, 10)).toThrow("拆分镜头与台词");
});

test("配音放不进镜头时拒绝拼接，不能截掉半句后宣布完成", () => {
    const job = fixture();
    job.audio = "voice";
    job.units[0].takes = [{ taskId: "done", resourceId: "take", createdAt: "", durationMs: 4000 }];
    job.voiceLines = [{ shotIndex: 1, text: job.shots[0].dialogue, signature: remakeVoiceSignature(job, job.shots[0].dialogue), status: "succeeded", attempt: 1, resourceId: "voice", durationMs: 5000 }];
    expect(() => remakeTimeline(job, { width: 720, height: 1280 })).toThrow("配音超出镜头时长");
});

test("目标定妆往返保存，换商品或模特后旧图失效，改台词不失效", () => {
    const job = fixture();
    job.continuity = { input: remakeContinuityInput(job), model: "image", attempt: 1, confirmed: true, image: { id: "anchor", resourceId: "target-frame", name: "目标定妆" } };
    const restored = normalizeRemakeJob(JSON.parse(JSON.stringify(job)))!;
    expect(remakeContinuityImage(restored)?.resourceId).toBe("target-frame");
    expect(remakeReferenceImages(restored).images.map((image) => image.resourceId)).toEqual(["target-product", "target-model", "target-frame"]);
    restored.shots[0].dialogue = "看看这包纸";
    expect(remakeContinuityImage(restored)?.resourceId).toBe("target-frame");
    restored.product.images[0].resourceId = "another-product";
    expect(remakeContinuityImage(restored)).toBeUndefined();
    expect(remakeReferenceImages(restored).images.map((image) => image.resourceId)).not.toContain("target-frame");
    expect(remakeContinuityMaterials(job).prompt).toContain("保留模特图的脸、发型、体型和同一套服装");
});

test("线上纸巾作品的原声加图片重拍不能伪装成对口型", () => {
    const job = fixture();
    job.audio = "original";
    job.authorized = true;
    job.shots[0].treatment = "remake";
    job.units = planRemakeUnits(job.shots, { maxMs: 15000, sourceDurationMs: 20000 });
    expect(remakeJobError(job)).toContain("不能重新拍");
    expect(() => buildRemakeUnitPrompt(job, job.units[0], job.shots, 4)).toThrow("需要参考原视频");
    job.shots[0].treatment = "replace";
    expect(remakeJobError(job)).toBe("");
});

test("换音色参考会使旧视频待重做，旧配方候选不能重新确认成新配方", () => {
    const job = fixture();
    job.voiceReference = { resourceId: "speaker-a", name: "干声", durationMs: 4000 };
    const units = applyRemakeCreativeSignature(job, job.units);
    units[0].status = "succeeded";
    units[0].takes = [{ taskId: "done", resourceId: "take", durationMs: 4000, createdAt: "", inputSignature: units[0].creativeSignature, approvedSignature: units[0].creativeSignature }];
    job.voiceReference.resourceId = "speaker-b";
    const changed = applyRemakeCreativeSignature(job, units);
    expect(changed[0].status).toBe("pending");
    expect(remakeTakeReviewError(changed[0], changed[0].takes[0])).toContain("旧配方");
});
