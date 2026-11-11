import { describe, expect, it } from "bun:test";
import type { VideoCapabilityConfig } from "../src/lib/model-capabilities";
import {
    createProductVideoJob,
    emptyProductVideoInputs,
    normalizeProductVideoJob,
    pendingProductVideoShots,
    productVideoInputsError,
    productVideoTargetShots,
    reusableProductVideoSplit,
    type ProductVideoInputs,
    type ProductVideoJob,
    type ProductVideoSegment,
} from "../src/lib/product-video/job";
import { plannedProductVideoSegments, productVideoDefaultRatio, productVideoModelLimits, productVideoRenderSize, productVideoShotSeconds, productVideoTimeline } from "../src/lib/product-video/media";
import { assessProductVideo, buildProductVideoShotPrompt, productVideoReferenceImages } from "../src/lib/product-video/prompt";

const image = (id: string) => ({ id, resourceId: `res-${id}`, name: `${id}.png` });

function inputs(patch: Partial<ProductVideoInputs> = {}): ProductVideoInputs {
    return {
        ...emptyProductVideoInputs(),
        products: [image("p1")],
        reference: { resourceId: "res-ref", name: "参考.mp4", durationMs: 30_000, width: 720, height: 1280 },
        startMs: 0,
        endMs: 20_000,
        model: "seedance",
        ...patch,
    };
}

function profile(patch: Partial<VideoCapabilityConfig> = {}, references: Partial<VideoCapabilityConfig["references"]> = {}): VideoCapabilityConfig {
    return {
        references: { promptMaxChars: 2000, minImages: 0, maxImages: 9, maxImageBytes: 0, maxVideos: 3, maxVideoBytes: 0, maxVideoDurationSeconds: 15, maxAudios: 0, maxAudioBytes: 0, maxAudioDurationSeconds: 0, ...references },
        duration: { selection: "range", min: 4, max: 15, step: 1, default: 5 },
        ratios: ["adaptive", "9:16", "16:9"],
        defaultRatio: "adaptive",
        resolutions: ["480p", "720p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: true },
        watermark: { supported: false, default: false },
        operations: [],
        defaultOperation: "",
        ...patch,
    };
}

const segments: ProductVideoSegment[] = [
    { index: 1, startMs: 2000, endMs: 9000, durationMs: 7000, resourceId: "res-s1", width: 720, height: 1280, keyframeResourceId: "res-k1" },
    { index: 2, startMs: 9000, endMs: 15000, durationMs: 6000, resourceId: "res-s2", width: 720, height: 1280, keyframeResourceId: "res-k2" },
];

function job(patch: Partial<ProductVideoJob> = {}): ProductVideoJob {
    const base = createProductVideoJob("video_abc123", inputs({ startMs: 2000, endMs: 15000 }), { splitKey: "split-key-0001", maxSegmentSeconds: 15 }, new Date("2026-11-05T08:00:00Z"));
    return { ...base, split: { ...base.split!, segments, hasAudio: true }, shots: pendingProductVideoShots(segments).map((shot) => ({ ...shot, status: "succeeded", resourceId: `res-g${shot.index}`, durationMs: 8000 })), ...patch };
}

describe("product video inputs", () => {
    it("asks for at least one replacement image, a reference, a 4–120 s range and a model that fits the image count", () => {
        expect(productVideoInputsError(inputs({ products: [] }))).toContain("至少放一张");
        expect(productVideoInputsError(inputs({ reference: undefined }))).toContain("参考视频");
        expect(productVideoInputsError(inputs({ endMs: 3000 }))).toContain("4–120 秒");
        expect(productVideoInputsError(inputs({ endMs: 121_000 }))).toContain("4–120 秒");
        expect(productVideoInputsError(inputs({ model: "" }))).toContain("视频模型");
        expect(productVideoInputsError(inputs({ products: [image("a"), image("b")], models: [image("c")] }), 2)).toContain("最多参考 2 张图");
        expect(productVideoInputsError(inputs())).toBe("");
    });

    it("reuses the cut segments only for the same reference, range and segment length", () => {
        const source = job();
        expect(reusableProductVideoSplit(source, { ...source }, 15)?.segments).toHaveLength(2);
        expect(reusableProductVideoSplit(source, { ...source, endMs: 14_000 }, 15)).toBeUndefined();
        expect(reusableProductVideoSplit(source, { ...source }, 10)).toBeUndefined();
    });

    it("generates only the first segment until a preview is approved", () => {
        const pending = job({ preview: true, shots: pendingProductVideoShots(segments) });
        expect(productVideoTargetShots(pending).map((shot) => shot.index)).toEqual([1]);
        expect(productVideoTargetShots({ ...pending, previewApproved: true }).map((shot) => shot.index)).toEqual([1, 2]);
    });

    it("normalizes stored jobs defensively", () => {
        const stored = normalizeProductVideoJob({ ...job(), status: "bogus", audio: "loud", products: [image("p1"), { name: "no resource" }], shots: [{ index: 1, status: "running", attempt: 0 }] });
        expect(stored?.status).toBe("failed");
        expect(stored?.audio).toBe("original");
        expect(stored?.products).toHaveLength(1);
        expect(stored?.shots[0]).toMatchObject({ index: 1, status: "running", attempt: 1 });
        expect(normalizeProductVideoJob({ title: "no id" })).toBeUndefined();
    });
});

describe("product video model limits", () => {
    it("needs reference video support and at least 8 seconds per segment", () => {
        expect(productVideoModelLimits(profile({}, { maxVideos: 0 }))).toBe("不支持参考视频");
        expect(productVideoModelLimits(profile({}, { maxVideoDurationSeconds: 5 }))).toContain("5 秒");
        expect(productVideoModelLimits(profile({ duration: { selection: "range", min: 4, max: 10, step: 1, default: 5 } }))).toMatchObject({ maxSegmentSeconds: 10, maxImages: 9 });
        expect(productVideoModelLimits(profile())).toMatchObject({ maxSegmentSeconds: 15, generateAudio: true });
    });

    it("picks the shortest allowed duration that covers the segment", () => {
        expect(productVideoShotSeconds(6200, [4, 5, 6, 7, 8])).toBe(7);
        expect(productVideoShotSeconds(6000, [4, 5, 6, 7, 8])).toBe(6);
        expect(productVideoShotSeconds(4300, [5, 10])).toBe(5);
        expect(productVideoShotSeconds(14_000, [5, 10])).toBe(10);
        expect(productVideoShotSeconds(4300, [])).toBe(5);
    });

    it("estimates segments evenly before the split and picks a ratio close to the reference", () => {
        expect(plannedProductVideoSegments(40_000, 15)).toEqual([13333, 13334, 13333]);
        expect(plannedProductVideoSegments(9000, 15)).toEqual([9000]);
        expect(productVideoDefaultRatio(["adaptive", "16:9"], 720, 1280)).toBe("adaptive");
        expect(productVideoDefaultRatio(["16:9", "9:16", "1:1"], 720, 1280)).toBe("9:16");
        expect(productVideoDefaultRatio(["16:9", "4:3"], 1920, 1080)).toBe("16:9");
    });
});

describe("product video prompt", () => {
    it("binds every image to its role in reference order and keeps what was not provided", () => {
        const value = inputs({ products: [image("p1"), image("p2")], backgrounds: [image("b1")], note: "商品始终正面朝向镜头" });
        expect(productVideoReferenceImages(value).roles).toEqual(["product", "product", "background"]);
        const prompt = buildProductVideoShotPrompt({ ...value, index: 2, total: 3, seconds: 8, fix: "Logo 变形" });
        expect(prompt).toContain("@视频1");
        expect(prompt).toContain("@图片1、@图片2里的商品");
        expect(prompt).toContain("换成@图片3的场景");
        expect(prompt).toContain("人物保持原样");
        expect(prompt).toContain("第 2 段（共 3 段）");
        expect(prompt).toContain("补充要求：商品始终正面朝向镜头");
        expect(prompt).toContain("重点修正：Logo 变形");
        expect(prompt).toContain("只需要画面");
    });

    it("rates difficulty from what is replaced and how many segments there are", () => {
        expect(assessProductVideo(inputs({ products: [image("a"), image("b")] }), 1).difficulty).toBe("低");
        const hard = assessProductVideo(inputs({ models: [image("m")], backgrounds: [image("b")], endMs: 90_000 }), 6);
        expect(hard.difficulty).toBe("高");
        expect(hard.risks.some((risk) => risk.includes("6 段"))).toBe(true);
    });
});

describe("product video timeline", () => {
    it("lays generated segments end to end at the reference length and keeps the original sound", () => {
        const timeline = productVideoTimeline(job(), { width: 721, height: 1281 });
        expect(timeline.durationMs).toBe(13_000);
        expect(timeline.width).toBe(722);
        expect(timeline.tracks.find((track) => track.id === "video")?.muted).toBe(true);
        expect(timeline.clips.filter((clip) => clip.kind === "video").map((clip) => [clip.startMs, clip.durationMs, clip.directMedia?.storageKey])).toEqual([
            [0, 7000, "resource:res-g1"],
            [7000, 6000, "resource:res-g2"],
        ]);
        expect(timeline.clips.find((clip) => clip.kind === "audio")).toMatchObject({ startMs: 0, durationMs: 13_000, sourceStartMs: 2000, directMedia: { storageKey: "resource:res-ref" } });
    });

    it("uses the model sound or silence without the original track", () => {
        const model = productVideoTimeline(job({ audio: "model" }), { width: 720, height: 1280 });
        expect(model.tracks.find((track) => track.id === "video")?.muted).toBe(false);
        expect(model.clips.some((clip) => clip.kind === "audio")).toBe(false);
        const silent = productVideoTimeline(job({ audio: "mute", split: { ...job().split!, hasAudio: false } }), { width: 720, height: 1280 });
        expect(silent.clips.some((clip) => clip.kind === "audio")).toBe(false);
        expect(() => productVideoTimeline(job({ audio: "original", split: { ...job().split!, hasAudio: false } }), { width: 720, height: 1280 })).toThrow("音轨");
        expect(() => productVideoTimeline(job({ shots: pendingProductVideoShots(segments) }), { width: 720, height: 1280 })).toThrow("第 1 段");
    });
    it("legacy element replacement preserves source ratio and rejects short, unknown or missing segments", () => {
        const value = job();
        value.reference = { ...value.reference!, width: 808, height: 720 };
        value.shots[0].width = 720;
        value.shots[0].height = 1280;
        expect(productVideoRenderSize(value)).toEqual({ width: 808, height: 720 });
        value.shots[0].durationMs = 6000;
        expect(() => productVideoTimeline(value, productVideoRenderSize(value))).toThrow("时长不足");
        delete value.shots[0].durationMs;
        expect(() => productVideoTimeline(value, productVideoRenderSize(value))).toThrow("时长不足");
        value.shots[0].durationMs = 8000;
        value.split = { ...value.split!, segments: [{ ...segments[0] }, { ...segments[1], startMs: 9500 }] };
        expect(() => productVideoTimeline(value, productVideoRenderSize(value))).toThrow("连续覆盖");
    });
});
