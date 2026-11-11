import { createRemakeJob } from "@/lib/remake/job";
import { setReferenceReplicationMode, type ReferenceReplicationMode } from "@/lib/remake/reference-replication";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

export function referenceFixture(mode: ReferenceReplicationMode = "structure") {
    const bundle: VideoTeardownBundle = {
        version: 1,
        source: { resourceId: "source-video", durationMs: 8000, width: 720, height: 1280, hasAudio: false },
        shots: [0, 1].map((index) => ({
            index: index + 1,
            startMs: index * 4000,
            endMs: (index + 1) * 4000,
            boundary: "cut",
            keyframeTimeMs: index * 4000 + 1000,
            keyframeResourceId: `source-frame-${index + 1}`,
            keyframeWidth: 720,
            keyframeHeight: 1280,
        })),
        grids: [],
        transcript: { source: "none", segments: [] },
        warnings: [],
    };
    const job = createRemakeJob("reference-work", { teardownId: "teardown", bundle, analysis: null, sourceName: "参考广告" }, new Date("2026-01-01"));
    job.product = { name: "扶手椅", sellingPoints: "木制扶手", images: [{ id: "target", resourceId: "target-product", name: "目标扶手椅" }] };
    job.people = "none";
    job.audio = "mute";
    job.model = "video-model";
    return setReferenceReplicationMode(job, mode, job.shots);
}

export function referencePlanOutput(style = false) {
    return {
        title: "扶手细节与日常休息",
        style: { palette: "暖色低饱和，商品保持本色", lighting: "窗边柔和侧光", texture: "真实木纹与织物质感", composition: "主体留白，细节近景", camera: "克制推近", editing: "按镜头作用切换", sound: "拟用轻环境声，无人声" },
        beats: [
            { shotNumber: 1, purpose: "交代使用情境", adaptation: "改为扶手椅入座，避免摇动" },
            { shotNumber: 2, purpose: "展示可见细节", adaptation: "展示目标木制扶手" },
        ],
        shots: (style
            ? [
                  [0, 2000],
                  [2000, 5000],
                  [5000, 8000],
              ]
            : [
                  [0, 4000],
                  [4000, 8000],
              ]
        ).map(([startMs, endMs], index) => ({
            index: index + 1,
            startMs,
            endMs,
            speaker: false,
            dialogue: "",
            director: {
                beat: index === 1 ? "proof" : "context",
                framing: "close",
                camera: "locked",
                transition: "cut",
                purpose: index === 1 ? "展示木制扶手" : "交代休息情境",
                start: "椅子稳定置于窗边",
                action: index === 1 ? "镜头缓慢推近木制扶手" : "镜头展示椅子与窗边环境",
                end: "椅子保持稳定，目标细节可见",
                lighting: "窗边柔和侧光",
                evidence: index === 1 ? "木制扶手" : "",
                sound: "环境声",
            },
        })),
    };
}
