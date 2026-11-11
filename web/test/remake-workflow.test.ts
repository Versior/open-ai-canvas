import { expect, test } from "bun:test";
import { addRemakeModels, createRemakeJob, normalizeRemakeJob, remakeJobError } from "@/lib/remake/job";
import { createRemakeEditTimeline, remakeDefaultStep } from "@/lib/remake/editor";
import { remakeRenderSize, remakeTimeline, remakeVoiceSignature } from "@/lib/remake/timeline";
import { remakeModelLimits } from "@/pages/video-replication/remake/remake-config";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { remakeReferenceImages, buildRemakeUnitPrompt } from "@/lib/remake/prompts";
import { applyRemakeCreativeSignature, planRemakeUnits, remakeTakeError } from "@/lib/remake/units";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { remakeContinuityInput } from "@/lib/remake/continuity";

const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "source", durationMs: 8000, width: 720, height: 1280, hasAudio: false },
    shots: [{ index: 1, startMs: 2000, endMs: 6000, boundary: "cut", keyframeTimeMs: 3000, keyframeResourceId: "frame", keyframeWidth: 720, keyframeHeight: 1280 }],
    grids: [],
    transcript: { source: "none", segments: [] },
    warnings: [],
};
test("复刻各段共用确认后的目标视觉锚点，短候选不能以静止尾帧冒充完整选段", () => {
    const job = fixture();
    job.shots[0].treatment = "replace";
    job.units = planRemakeUnits(job.shots, { maxMs: 10000, sourceDurationMs: 8000 });
    job.units[0].takes = [{ resourceId: "short", taskId: "done", createdAt: "", durationMs: 3000, width: 1280, height: 720 }];
    job.continuity = { input: remakeContinuityInput(job), model: "image", attempt: 1, confirmed: true, image: { id: "anchor", resourceId: "target-frame", name: "目标定妆图" } };
    expect(remakeReferenceImages(job).anchor).toBe("@图片2");
    const prompt = buildRemakeUnitPrompt(job, job.units[0], job.shots, 5);
    expect(prompt).toContain("全片视觉基准：@图片2");
    expect(prompt).toContain("参考片段 0.000–4.000 秒");
    expect(() => remakeTimeline(job, remakeRenderSize(job))).toThrow("生成时长不足");
    expect(remakeRenderSize(job)).toEqual({ width: 720, height: 1280 });
});
test("正式交付拒绝漏镜与重叠，候选时长包含参考片段的前置偏移", () => {
    const job = fixture();
    const unit = job.units[0];
    unit.takes = [{ resourceId: "take", taskId: "done", createdAt: "", durationMs: 4000 }];
    job.shots.push({ ...job.shots[0], index: 2, startMs: 6000, endMs: 8000 });
    expect(() => remakeTimeline(job, remakeRenderSize(job))).toThrow("镜头 2 的生成片段没有完整覆盖");
    job.shots.pop();
    job.units.push({ ...unit, key: "overlap" });
    expect(() => remakeTimeline(job, remakeRenderSize(job))).toThrow("重叠");
    expect(remakeTakeError({ ...unit, treatment: "replace", clipStartMs: 1000 }, { durationMs: 4000 })).toContain("时长不足");
    expect(remakeTakeError({ ...unit, treatment: "replace", clipStartMs: 1000 }, { durationMs: 5000 })).toBe("");
});
function fixture() {
    const job = createRemakeJob("remake", { teardownId: "teardown", bundle, analysis: null, sourceName: "参考视频" });
    job.product.images = [{ id: "product", resourceId: "product", name: "本地商品.png" }];
    job.model = "video-a";
    job.shots[0].treatment = "remake";
    job.units = planRemakeUnits(job.shots, { maxMs: 10000, sourceDurationMs: 8000 });
    return job;
}
test("未生成和失败的作品可剪辑原片占位，成功素材保留；成片拼接继续拒绝缺失候选", () => {
    const job = fixture();
    job.units[0].status = "failed";
    const before = JSON.stringify(job);
    expect(() => remakeTimeline(job, { width: 720, height: 1280 })).toThrow("还有镜头没有生成好");
    const timeline = createRemakeEditTimeline(job);
    const clip = timeline.clips.find((item) => item.kind === "video")!;
    expect(clip.directMedia?.id).toBe("source");
    expect(clip.title).toContain("待生成");
    expect(clip.sourceStartMs).toBe(2000);
    expect(clip.durationMs).toBe(4000);
    expect(JSON.stringify(job)).toBe(before);
    const unplanned = fixture();
    unplanned.units = [];
    expect(createRemakeEditTimeline(unplanned).clips.some((item) => item.directMedia?.id === "source")).toBe(true);
});
test("剪辑草稿保留成功配音和字幕，缺失配音仍阻止直接拼接", () => {
    const job = fixture();
    job.units[0].takes = [{ resourceId: "take", taskId: "done", createdAt: "", durationMs: 4000 }];
    job.audio = "voice";
    job.shots[0].dialogue = "新口播";
    expect(() => remakeTimeline(job, { width: 720, height: 1280 })).toThrow("配音没有生成好");
    const timeline = createRemakeEditTimeline(job);
    expect(timeline.clips.find((clip) => clip.kind === "subtitle")?.text).toBe("新口播");
    expect(timeline.clips.some((clip) => clip.trackId.startsWith("audio"))).toBe(false);
    job.voiceLines = [{ shotIndex: 1, text: "新口播", signature: remakeVoiceSignature(job, "新口播"), status: "succeeded", attempt: 1, resourceId: "voice", durationMs: 1500 }];
    expect(createRemakeEditTimeline(job).clips.find((clip) => clip.kind === "audio")?.directMedia?.id).toBe("voice");
});
test("不出人时隐藏的模特素材不占额度，也不能代替有效生成素材", () => {
    const job = fixture();
    job.people = "none";
    job.models = [{ id: "person", resourceId: "person", name: "模特" }];
    expect(remakeJobError(job, { maxImages: 2, generateAudio: false })).toBe("");
    job.product.images = [];
    expect(remakeJobError(job)).toContain("请先放上");
});
test("全部重拍能选仅支持图片的模型，换元素允许四秒参考模型并保留能力约束", () => {
    const profile = defaultModelCapabilityConfig("seedance", "seedance-2.0").video!;
    profile.references.maxVideos = 0;
    expect(typeof remakeModelLimits(profile, false)).toBe("object");
    expect(remakeModelLimits(profile, true)).toContain("换元素需要");
    profile.references.maxVideos = 1;
    profile.references.maxVideoDurationSeconds = 4;
    expect(remakeModelLimits(profile, true)).toMatchObject({ maxSegmentSeconds: 4 });
});
test("上传全身模特替换人脸，姿势独立保留", () => {
    const models = addRemakeModels(
        [
            { id: "face", resourceId: "face", name: "人脸", role: "face" },
            { id: "pose", resourceId: "pose", name: "姿势", role: "pose" },
        ],
        [{ id: "upload", resourceId: "upload", name: "上传的全身图" }],
    );
    expect(models.map((image) => image.id)).toEqual(["pose", "upload"]);
});
test("作品默认回到生成台，剪辑保留源内裁剪位置和完整媒体尺寸", () => {
    const job = fixture();
    expect(remakeDefaultStep(job)).toBe("produce");
    job.units[0] = { ...job.units[0], treatment: "replace", clipStartMs: 1000, takes: [{ taskId: "done", resourceId: "take", createdAt: "", durationMs: 6000, width: 720, height: 1280 }], status: "succeeded" };
    const timeline = createRemakeEditTimeline(job);
    const clip = timeline.clips.find((item) => item.kind === "video")!;
    expect(clip.startMs).toBe(0);
    expect(clip.durationMs).toBe(4000);
    expect(clip.sourceStartMs).toBe(1000);
    expect(clip.sourceDurationMs).toBe(6000);
    expect(clip.directMedia?.height).toBe(1280);
    job.editTimeline = timeline;
    job.editRender = { taskId: "render", resourceId: "edited" };
    const restored = normalizeRemakeJob(JSON.parse(JSON.stringify(job)))!;
    expect(restored.editTimeline?.clips[0].sourceStartMs).toBe(1000);
    expect(restored.editRender?.resourceId).toBe("edited");
    expect(restored.editTimeline?.tracks.find((track) => track.id === "video-1")?.muted).toBe(true);
    expect(restored.editTimeline?.tracks.filter((track) => track.kind === "video")).toHaveLength(1);
});
test("人脸与姿势用途往返保存，姿势不作为人物身份", () => {
    const job = fixture();
    job.models = [
        { id: "face", resourceId: "face", name: "人脸", role: "face" },
        { id: "pose", resourceId: "pose", name: "站姿", role: "pose", prompt: "自然站立" },
    ];
    const restored = normalizeRemakeJob(JSON.parse(JSON.stringify(job)))!;
    expect(restored.models[1].role).toBe("pose");
    const refs = remakeReferenceImages(restored);
    expect(refs.images.map((image) => image.resourceId)).toEqual(["product", "face", "pose"]);
    const prompt = buildRemakeUnitPrompt(restored, restored.units[0], restored.shots, 4);
    expect(prompt).toContain("人脸");
    expect(prompt).toContain("仅参考动作");
});
test("没有导演策略的配方更换商品也使旧片段待重新生成，保留候选", () => {
    const job = fixture();
    const signed = applyRemakeCreativeSignature(job, job.units);
    signed[0] = { ...signed[0], status: "succeeded", takes: [{ resourceId: "take", taskId: "task", createdAt: "" }] };
    job.product.images[0].resourceId = "new-product";
    const changed = applyRemakeCreativeSignature(job, signed);
    expect(changed[0].status).toBe("pending");
    expect(changed[0].takes[0].resourceId).toBe("take");
    expect(() => applyRemakeCreativeSignature(job, [{ ...signed[0], taskId: "running-task" }])).toThrow("尚未确认结束");
});
