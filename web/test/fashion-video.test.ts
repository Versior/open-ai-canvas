import { afterEach, expect, test } from "bun:test";
import { emptyFashionVideoDraft, fashionVideoProblem, fashionVideoRenderMatches, fashionVideoTimeline, planFashionVideos, type FashionVideoDraft, type FashionVideoWork } from "@/lib/fashion/video-workflow";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { setActiveUserScope } from "@/lib/user-scope";
import { parseFashionVideoWork } from "@/services/api/fashion-video";
import { fashionVideoGenerationConfig, runFashionVideoWork } from "@/services/fashion-video-generation";
import { apiClient } from "@/services/api/request";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});
function draft(tool: FashionVideoDraft["tool"] = "tryon"): FashionVideoDraft {
    return {
        ...emptyFashionVideoDraft(),
        tool,
        authorized: true,
        startMs: 2000,
        source: { resourceId: "original", name: "原片", durationMs: 12000, width: 720, height: 1280, hasAudio: true },
        models: [{ resourceId: "person", name: "角色" }],
        garments: [{ resourceId: "garment", name: "衣物" }],
        faces: [{ resourceId: "identity", name: "面部" }],
    };
}
function setup() {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { dispatchEvent: () => true, setTimeout, clearTimeout, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, val: string) => storage.set(key, val), removeItem: (key: string) => storage.delete(key) } },
    });
    setActiveUserScope("synthetic-video-owner");
    const channel = createModelChannel({ id: "test-video", name: "Synthetic video", baseUrl: "/api", apiKey: "", interfaceType: "volcengine-ark-video", models: ["test-video"] });
    const profile = defaultModelCapabilityConfig("volcengine-ark-video");
    channel.modelCosts = [{ model: "test-video", capabilityConfig: profile }];
    const model = encodeChannelModel(channel.id, "test-video");
    const config = { ...defaultConfig, channels: [channel], videoModel: model, model };
    let id = 0;
    const work: FashionVideoWork = {
        kind: "fashion-video",
        id: "work",
        revision: 1,
        title: "视频工作",
        createdAt: new Date().toISOString(),
        model,
        ratio: "9:16",
        resolution: "720p",
        draft: draft(),
        units: planFashionVideos(draft(), () => `unit-${++id}`),
    };
    return { work, config };
}
test("source selections preserve millisecond duration and original frame instead of model output defaults", () => {
    const value = { ...draft("face"), startMs: 0, seconds: 28.544, source: { ...draft().source!, durationMs: 28544, width: 808, height: 720 } };
    expect(fashionVideoProblem(value)).toBe("");
    const { work } = setup();
    work.draft = { ...value, seconds: 12.345 };
    const unit = { ...work.units[0], resourceId: "generated", durationMs: 13000, width: 720, height: 1280 };
    const timeline = fashionVideoTimeline(work, unit);
    expect(timeline.durationMs).toBe(12345);
    expect([timeline.width, timeline.height]).toEqual([808, 720]);
});
test("long face replacement shares source clips and anchor, then joins the exact source range", async () => {
    const { work, config } = setup();
    work.draft = { ...draft("face"), startMs: 0, seconds: 28.544, source: { ...draft().source!, durationMs: 28544, width: 808, height: 720 } };
    work.units = planFashionVideos(work.draft, () => "whole");
    const calls: { url: string; body: Record<string, any> }[] = [];
    const tasks = new Map<string, Record<string, any>>();
    apiClient.defaults.adapter = async (request) => {
        const body = typeof request.data === "string" ? JSON.parse(request.data) : request.data || {};
        const url = request.url!;
        calls.push({ url, body });
        let task: Record<string, any>;
        if (request.method === "get") task = tasks.get(url.split("/").at(-1)!)!;
        else {
            const type = url.endsWith("splits") ? "product_video_split" : url.endsWith("renders") ? "timeline_render" : "canvas_video";
            const id = `task-${tasks.size}`;
            const result =
                type === "product_video_split"
                    ? {
                          source: { hasAudio: true },
                          segments: body.ranges.map((range: { startMs: number; endMs: number }, index: number) => ({
                              ...range,
                              index: index + 1,
                              resourceId: `cut-${index}`,
                              keyframeResourceId: `anchor-${index}`,
                              durationMs: range.endMs - range.startMs,
                              width: 808,
                              height: 720,
                          })),
                      }
                    : type === "canvas_video"
                      ? { video: { storageKey: `resource:generated-${id}`, durationMs: 15000, width: 720, height: 1280 } }
                      : { resourceId: `render-${id}` };
            task = { id, type, status: "succeeded", prompt: "test", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resultJson: JSON.stringify(result) };
            tasks.set(id, task);
        }
        return { status: 200, statusText: "OK", headers: {}, config: request, data: { code: 0, msg: "", data: task } };
    };
    const result = await runFashionVideoWork(work, config, async (value) => parseFashionVideoWork({ ...value, revision: value.revision + 1 })!, new AbortController().signal);
    const cuts = calls.filter((call) => call.url.endsWith("splits"));
    expect(cuts).toHaveLength(1);
    expect(cuts[0].body.ranges).toEqual([
        { startMs: 0, endMs: 14272 },
        { startMs: 14272, endMs: 28544 },
    ]);
    const generated = calls.filter((call) => call.url === "/tasks");
    expect(generated).toHaveLength(2);
    for (const call of generated) {
        expect(call.body.input.referenceImages.map((image: { storageKey: string }) => image.storageKey)).toEqual(["resource:identity", "resource:anchor-0"]);
        expect(call.body.input.referenceVideos[0].durationMs).toBe(14272);
    }
    const assembled = calls.filter((call) => call.url.endsWith("renders")).at(-1)!.body.timeline;
    expect([assembled.width, assembled.height, assembled.durationMs]).toEqual([808, 720, 28544]);
    expect(assembled.clips.map((clip: { startMs: number; durationMs: number }) => [clip.startMs, clip.durationMs])).toEqual([
        [0, 14272],
        [14272, 14272],
    ]);
    expect(result.units[0].status).toBe("succeeded");
    const expected = fashionVideoTimeline(result, result.units[0]);
    expect(fashionVideoRenderMatches(assembled, expected)).toBe(true);
    expect(fashionVideoRenderMatches({ ...assembled, clips: assembled.clips.slice(0, 1) }, expected)).toBe(false);
    expect(fashionVideoRenderMatches({ ...assembled, width: 720, height: 1280 }, expected)).toBe(false);
    const reloaded = parseFashionVideoWork(JSON.parse(JSON.stringify(result)))!;
    const before = calls.length;
    await runFashionVideoWork(reloaded, { ...config, channels: [] }, async (value) => value, new AbortController().signal);
    expect(calls).toHaveLength(before);
    expect(() => parseFashionVideoWork({ ...result, clip: { ...result.clip, segments: result.clip!.segments!.slice(0, 1) } })).toThrow("无效");
    const duplicated = structuredClone(result);
    duplicated.units[0].parts![1].id = duplicated.units[0].parts![0].id;
    expect(() => parseFashionVideoWork(duplicated)).toThrow("无效");
    const incomplete = structuredClone(result);
    delete incomplete.units[0].parts;
    expect(() => parseFashionVideoWork(incomplete)).toThrow("无效");
    const retry = structuredClone(result);
    retry.id = "new-version";
    retry.units = [
        {
            id: "new-whole",
            title: result.units[0].title,
            prompt: result.units[0].prompt,
            references: result.units[0].references,
            status: "pending",
            parts: [result.units[0].parts![0], { ...result.units[0].parts![1], id: "new-part", status: "pending", taskId: undefined, resourceId: undefined, render: undefined }],
        },
    ];
    const beforeRetry = calls.length;
    await runFashionVideoWork(parseFashionVideoWork(retry)!, config, async (value) => parseFashionVideoWork({ ...value, revision: value.revision + 1 })!, new AbortController().signal);
    expect(calls.slice(beforeRetry).filter((call) => call.url === "/tasks")).toHaveLength(1);
    expect(calls.slice(beforeRetry).some((call) => call.url.endsWith("splits"))).toBe(false);
});
test("video tools require source video and use distinct identity, garment and motion instructions", () => {
    for (const tool of ["tryon", "face", "head", "motion", "print"] as const) {
        const value = draft(tool);
        expect(fashionVideoProblem({ ...value, source: undefined })).toContain("原视频");
        const plan = planFashionVideos(value, () => "unit")[0];
        expect(plan.prompt).toContain("@视频1");
        expect(plan.prompt).toContain("遮挡");
    }
    expect(planFashionVideos(draft("face"), () => "unit")[0].prompt).toContain("只修改面部");
    expect(planFashionVideos(draft("head"), () => "unit")[0].prompt).toContain("完整头部");
    expect(planFashionVideos(draft("print"), () => "unit")[0].prompt).toContain("褶皱");
    expect(fashionVideoProblem({ ...draft(), startMs: 8000 })).toContain("范围");
});
test("batch video pairing follows selected people and garments; saved records reject unrelated references", () => {
    const value = {
        ...draft("multi-model"),
        models: [
            { resourceId: "person-a", name: "A" },
            { resourceId: "person-b", name: "B" },
        ],
    };
    let id = 0;
    const plans = planFashionVideos(value, () => `unit-${++id}`);
    expect(plans.map((unit) => unit.references.map((image) => image.resourceId))).toEqual([
        ["person-a", "garment"],
        ["person-b", "garment"],
    ]);
    const { work } = setup();
    expect(parseFashionVideoWork(work)).toEqual(work);
    expect(() => parseFashionVideoWork({ ...work, units: [{ ...work.units[0], references: [{ resourceId: "wrong", name: "wrong" }] }] })).toThrow("无效");
});
test("timeline preserves precise original sound and refuses short or unconfirmed outputs", () => {
    const { work } = setup();
    work.draft.audio = "original";
    work.clip = { key: "cut", resourceId: "selected-clip", hasAudio: true };
    const unit = { ...work.units[0], resourceId: "generated", durationMs: 6000, width: 720, height: 1280 };
    const timeline = fashionVideoTimeline(work, unit);
    expect(timeline.durationMs).toBe(5000);
    expect(timeline.clips[1].directMedia?.storageKey).toBe("resource:selected-clip");
    expect(timeline.clips[1].sourceStartMs).toBe(0);
    expect(timeline.tracks[0].muted).toBe(true);
    expect(() => fashionVideoTimeline(work, { ...unit, durationMs: 4000 })).toThrow("短于");
    work.clip.hasAudio = false;
    expect(() => fashionVideoTimeline(work, unit)).toThrow("音轨");
});
function mockTransport(calls: { url: string; body: Record<string, any> }[], splitAudio = true, generatedDurationMs = 5000) {
    apiClient.defaults.adapter = async (config) => {
        const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data || {};
        calls.push({ url: config.url!, body });
        const url = config.url || "";
        const type = url.includes("splits") || url.includes("product_video_split") ? "product_video_split" : url.includes("renders") || url.includes("timeline_render") ? "timeline_render" : "canvas_video";
        const result =
            type === "product_video_split"
                ? { source: { hasAudio: splitAudio }, startMs: 2000, endMs: 7000, segments: [{ index: 1, startMs: 2000, endMs: 7000, durationMs: 5000, resourceId: "selected-clip", keyframeResourceId: "keyframe", width: 720, height: 1280 }] }
                : type === "timeline_render"
                  ? { resourceId: "delivered" }
                  : { video: { storageKey: "resource:generated", durationMs: generatedDurationMs, width: 720, height: 1280 } };
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            data: { code: 0, msg: "", data: { id: `${type}-task`, type, status: "succeeded", prompt: "test", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resultJson: JSON.stringify(result) } },
        };
    };
}
test("completed short output is marked failed and remains available for review instead of getting stuck running", async () => {
    const { work, config } = setup();
    const calls: { url: string; body: Record<string, any> }[] = [];
    mockTransport(calls, true, 4000);
    const result = await runFashionVideoWork(work, config, async (value) => value, new AbortController().signal);
    expect(result.units[0].status).toBe("failed");
    expect(result.units[0].resourceId).toBe("generated");
    expect(result.units[0].error).toContain("短于");
    expect(calls.some((call) => call.url.endsWith("renders"))).toBe(false);
    expect(result.units[0].render).toBeUndefined();
});
test("actual generation request receives the cut video and image; all delivery stages persist", async () => {
    const { work, config } = setup();
    const calls: { url: string; body: Record<string, any> }[] = [];
    mockTransport(calls);
    const snapshots: FashionVideoWork[] = [];
    const result = await runFashionVideoWork(
        work,
        config,
        async (value) => {
            snapshots.push(structuredClone(value));
            return { ...value, revision: value.revision + 1 };
        },
        new AbortController().signal,
    );
    const split = calls.find((call) => call.url.endsWith("splits"))!;
    expect(split.body.ranges).toEqual([{ startMs: 2000, endMs: 7000 }]);
    expect(split.body.maxSegmentSeconds).toBe(8);
    const generated = calls.find((call) => call.url === "/tasks")!;
    const input = generated.body.input;
    expect(input.referenceVideos[0].storageKey).toBe("resource:selected-clip");
    expect(input.referenceImages[0].storageKey).toBe("resource:garment");
    expect(input.metadata.clientOperationId).toBe("fashion-video-unit-1");
    expect(generated.body.operation).toBe("reference_to_video");
    expect(result.units[0].render?.resourceId).toBe("delivered");
    expect(result.units[0].status).toBe("succeeded");
    expect(snapshots.some((value) => value.units[0].render?.started && !value.units[0].render.taskId)).toBe(true);
});
test("showcase submits first frame without video even when an old source remains", async () => {
    const { work, config } = setup();
    work.draft = draft("showcase");
    work.units = planFashionVideos(work.draft, () => "showcase");
    work.clip = { key: "old", resourceId: "old-video" };
    const calls: { url: string; body: Record<string, any> }[] = [];
    mockTransport(calls);
    await runFashionVideoWork(work, config, async (value) => value, new AbortController().signal);
    const generated = calls.find((call) => call.url === "/tasks")!;
    const input = generated.body.input;
    expect(input.referenceVideos || []).toHaveLength(0);
    expect(input.referenceImages[0].role).toBe("first_frame");
    expect(generated.body.operation).toBe("image_to_video");
    expect(calls.some((call) => call.url.endsWith("splits"))).toBe(false);
});
test("an incorrect cut range is rejected before model submission", async () => {
    const { work, config } = setup();
    const requests: string[] = [];
    apiClient.defaults.adapter = async (request) => {
        requests.push(`${request.method} ${request.url}`);
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config: request,
            data: {
                code: 0,
                msg: "",
                data: {
                    id: "wrong-cut",
                    type: "product_video_split",
                    status: "succeeded",
                    resultJson: JSON.stringify({ source: { hasAudio: true }, segments: [{ index: 1, startMs: 0, endMs: 5000, durationMs: 5000, resourceId: "wrong-clip", width: 720, height: 1280 }] }),
                },
            },
        };
    };
    await expect(runFashionVideoWork(work, config, async (value) => value, new AbortController().signal)).rejects.toThrow("选定范围");
    expect(requests).toEqual(["post /ecommerce/product-videos/splits", "get /tasks/wrong-cut"]);
});
test("known model and render tasks recover without paid resubmission, even if model was removed", async () => {
    const { work } = setup();
    work.clip = { key: "cut", resourceId: "selected-clip", hasAudio: true };
    work.units[0] = { ...work.units[0], status: "rendering", taskId: "known-video", resourceId: "generated", durationMs: 5000, width: 720, height: 1280, render: { started: true, taskId: "known-render" } };
    const calls: { url: string; body: Record<string, any> }[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push({ url: config.url!, body: {} });
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, msg: "", data: { id: "known-render", type: "timeline_render", status: "succeeded", resultJson: JSON.stringify({ resourceId: "delivered" }) } } };
    };
    const result = await runFashionVideoWork(work, defaultConfig, async (value) => value, new AbortController().signal);
    expect(result.units[0].status).toBe("succeeded");
    expect(calls.map((call) => call.url)).toEqual(["/tasks/known-render", "/tasks/known-render"]);
});
test("unknown render submission never resubmits; missing original audio blocks resume before generation", async () => {
    const { work, config } = setup();
    work.clip = { key: "cut", resourceId: "selected-clip", hasAudio: true };
    work.units[0] = { ...work.units[0], status: "rendering", resourceId: "generated", durationMs: 5000, width: 720, height: 1280, render: { started: true } };
    const calls: { url: string; body: Record<string, any> }[] = [];
    mockTransport(calls);
    await expect(runFashionVideoWork(work, config, async (value) => value, new AbortController().signal)).rejects.toThrow("不自动重复合成");
    expect(calls).toHaveLength(0);
    work.draft.audio = "original";
    work.clip.hasAudio = false;
    await expect(runFashionVideoWork(work, config, async (value) => value, new AbortController().signal)).rejects.toThrow("没有音轨");
    expect(calls).toHaveLength(0);
});
test("image-only video model cannot perform source-video editing; scope changes stop writes", async () => {
    const { work, config } = setup();
    const profile = defaultModelCapabilityConfig("volcengine-ark-video");
    profile.video!.references.maxVideos = 0;
    profile.video!.operations = ["text_to_video", "image_to_video"];
    config.channels[0].modelCosts![0].capabilityConfig = profile;
    expect(() => fashionVideoGenerationConfig(config, work, 1)).toThrow();
    let writes = 0;
    setActiveUserScope("different-owner");
    await expect(
        runFashionVideoWork(
            work,
            config,
            async (value) => {
                writes++;
                return value;
            },
            new AbortController().signal,
            "synthetic-video-owner",
        ),
    ).rejects.toThrow("账号已切换");
    expect(writes).toBe(0);
});
