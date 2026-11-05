import { describe, expect, test } from "bun:test";

import {
    buildVideoTeardownPrompt,
    buildVideoTeardownSummaryPrompt,
    formatDurationLimit,
    formatTeardownTime,
    parseVideoTeardownAnalysis,
    parseVideoTeardownSummary,
    videoTeardownBatchTable,
    videoTeardownReportMarkdown,
    videoTeardownShotTranscripts,
    videoTeardownStoryboardRows,
} from "@/lib/canvas/video-teardown";
import { parseVideoTeardownBundle, type VideoTeardownBundle } from "@/services/api/video-replication";
import type { GenerationTask } from "@/services/api/task-center";

function bundle(overrides: Partial<VideoTeardownBundle> = {}): VideoTeardownBundle {
    return {
        version: 1,
        source: { resourceId: "res-src", durationMs: 9000, width: 1080, height: 1920, hasAudio: true },
        shots: [
            { index: 1, startMs: 0, endMs: 1800, boundary: "start", keyframeTimeMs: 900, keyframeResourceId: "kf-1", keyframeWidth: 288, keyframeHeight: 512 },
            { index: 2, startMs: 1800, endMs: 4200, boundary: "cut", keyframeTimeMs: 3000, keyframeResourceId: "kf-2", keyframeWidth: 288, keyframeHeight: 512 },
            { index: 3, startMs: 4200, endMs: 6600, boundary: "split", keyframeTimeMs: 5400, keyframeResourceId: "kf-3", keyframeWidth: 288, keyframeHeight: 512 },
            { index: 4, startMs: 6600, endMs: 9000, boundary: "cut", keyframeTimeMs: 7800, keyframeResourceId: "kf-4", keyframeWidth: 288, keyframeHeight: 512 },
        ],
        grids: [
            { resourceId: "grid-1", shotIndexes: [1, 2, 3], width: 896, height: 1568 },
            { resourceId: "grid-2", shotIndexes: [4], width: 896, height: 528 },
        ],
        transcript: {
            source: "asr",
            language: "zh",
            segments: [
                { startMs: 100, endMs: 1500, text: "姐妹们看过来" },
                { startMs: 1500, endMs: 2900, text: "这个杯子真的好用" },
                { startMs: 7000, endMs: 8800, text: "链接在下面" },
            ],
        },
        warnings: [],
        ...overrides,
    };
}

function task(result: unknown): GenerationTask {
    return { id: "vt1", type: "replication_teardown", status: "succeeded", prompt: "视频拆解", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify(result) } as unknown as GenerationTask;
}

function row(shotNumber: number, extra: Record<string, unknown> = {}) {
    return {
        shotNumber,
        plotDescription: `画面 ${shotNumber}`,
        dialogue: "",
        dialogueSource: "none",
        onScreenText: "",
        shotSize: "近景",
        camera: "平视",
        motion: "固定",
        production: "实拍",
        productionConfidence: "中",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        ...extra,
    };
}

describe("video replication duration limit", () => {
    test("matches the server wording for whole minutes, seconds and mixed values", () => {
        expect([180, 60, 45, 10, 90, 125].map(formatDurationLimit)).toEqual(["3 分钟", "1 分钟", "45 秒", "10 秒", "1 分 30 秒", "2 分 5 秒"]);
    });
});

describe("video teardown bundle", () => {
    test("keeps the transcription reason in transcript.note and splits it out of legacy warnings", () => {
        const current = parseVideoTeardownBundle(task(bundle({ transcript: { source: "none", segments: [], note: "服务器没有配置转写服务" }, warnings: [] })));
        expect(current.transcript.note).toBe("服务器没有配置转写服务");
        expect(current.warnings).toEqual([]);
        // 早期结果：原因在 warnings 里，句尾带着「口播改从画面字幕识别」。
        const legacy = parseVideoTeardownBundle(task(bundle({ transcript: { source: "none", segments: [] }, warnings: ["后台已关闭口播识别，口播改从画面字幕识别"] })));
        expect(legacy.transcript.note).toBe("后台已关闭口播识别");
        expect(legacy.warnings).toEqual([]);
        const failed = parseVideoTeardownBundle(task(bundle({ transcript: { source: "none", segments: [] }, warnings: ["口播识别失败（超时），改从画面字幕识别"] })));
        expect(failed.transcript.note).toBe("口播识别失败（超时）");
        // 有转写时提示原样保留。
        expect(parseVideoTeardownBundle(task(bundle({ warnings: ["别的提示"] }))).warnings).toEqual(["别的提示"]);
    });

    test("accepts a well-formed bundle", () => {
        expect(parseVideoTeardownBundle(task(bundle())).shots).toHaveLength(4);
    });

    test("rejects bundles whose timings or grids do not line up", () => {
        const broken = bundle();
        expect(() => parseVideoTeardownBundle(task({ ...broken, shots: broken.shots.map((shot) => (shot.index === 2 ? { ...shot, startMs: 5000 } : shot)) }))).toThrow("第 2 个镜头");
        expect(() => parseVideoTeardownBundle(task({ ...broken, grids: [broken.grids[0]] }))).toThrow("没有覆盖全部镜头");
        expect(() => parseVideoTeardownBundle(task({ ...broken, grids: [broken.grids[0], { ...broken.grids[1], shotIndexes: [3, 4] }] }))).toThrow("镜头编号无效");
        expect(() => parseVideoTeardownBundle(task({ ...broken, shots: [] }))).toThrow("没有镜头");
        expect(() => parseVideoTeardownBundle({ ...task(bundle()), resultJson: "{" } as GenerationTask)).toThrow("拆解结果无效");
        expect(() => parseVideoTeardownBundle(task(bundle({ transcript: { source: "none", segments: [], note: 3 as unknown as string } })))).toThrow("口播转写无效");
    });
});

describe("video teardown prompt", () => {
    test("assigns each transcript segment to the shot containing its midpoint", () => {
        const transcripts = videoTeardownShotTranscripts(bundle());
        expect(transcripts.get(1)).toBe("姐妹们看过来");
        expect(transcripts.get(2)).toBe("这个杯子真的好用");
        expect(transcripts.get(3)).toBeUndefined();
        expect(transcripts.get(4)).toBe("链接在下面");
    });

    test("describes the grid layout, the fixed shot list and the transcript", () => {
        const prompt = buildVideoTeardownPrompt(bundle(), [bundle().grids[0]], true);
        expect(prompt).toContain("第 1 张宫格：从上到下是镜头 1、2、3");
        expect(prompt).toContain("每行最左边黑底白字的数字就是镜头编号");
        expect(prompt).toContain("三格从左到右是这个镜头的开头、中间、结尾画面");
        expect(prompt).toContain("镜头 2｜0:01.8–0:04.2｜切点");
        expect(prompt).toContain("镜头 3｜0:04.2–0:06.6｜同一长镜头切开，画面连续");
        expect(prompt).toContain("镜头 1：姐妹们看过来");
        expect(prompt).toContain("只填写这些镜头：1、2、3");
        expect(prompt).toContain('"summary"');
        expect(prompt).not.toContain("镜头 4｜");
    });

    test("asks the model to read subtitles when there is no transcript", () => {
        const prompt = buildVideoTeardownPrompt(bundle({ transcript: { source: "none", segments: [] } }), [bundle().grids[1]], false);
        expect(prompt).toContain("没有语音转写");
        expect(prompt).not.toContain('"summary"');
        expect(buildVideoTeardownSummaryPrompt(bundle(), [parseVideoTeardownAnalysis(JSON.stringify({ rows: [row(4, { dialogue: "链接在下面" })] }), [4], false).rows[0]])).toContain("口播：链接在下面");
    });

    test("formats times as minutes, seconds and tenths", () => {
        expect(formatTeardownTime(0)).toBe("0:00.0");
        expect(formatTeardownTime(1840)).toBe("0:01.8");
        expect(formatTeardownTime(65_250)).toBe("1:05.3");
    });
});

describe("video teardown analysis", () => {
    test("parses rows from fenced JSON and keeps the requested shots only", () => {
        const reply =
            "好的，结果如下：\n```json\n" +
            JSON.stringify({
                title: "杯子种草",
                summary: { genre: "口播种草", hook: "开头直接喊人", beats: [{ name: "钩子", shots: [1], purpose: "留人" }], whyItWorks: ["节奏快"], music: "轻快", textStyle: "大字幕", replicationTips: ["换成自己的产品"] },
                rows: [row(1, { dialogue: "姐妹们看过来", dialogueSource: "asr" }), row(2), row(3), row(9)],
            }) +
            "\n```";
        const analysis = parseVideoTeardownAnalysis(reply, [1, 2, 3], true);
        expect(analysis.title).toBe("杯子种草");
        expect(analysis.summary?.beats).toEqual([{ name: "钩子", shots: [1], purpose: "留人" }]);
        expect(analysis.rows.map((item) => item.shotNumber)).toEqual([1, 2, 3]);
        expect(analysis.rows[0].dialogueSource).toBe("asr");
        expect(analysis.rows[1].dialogueSource).toBe("none");
    });

    test("fails instead of filling in missing shots", () => {
        expect(() => parseVideoTeardownAnalysis(JSON.stringify({ rows: [row(1), row(3)] }), [1, 2, 3], false)).toThrow("缺少镜头 2");
        expect(() => parseVideoTeardownAnalysis("我无法完成", [1], false)).toThrow("没有返回可用的拆解 JSON");
        expect(() => parseVideoTeardownSummary("{}")).toThrow("全片总结");
    });

    test("merges model semantics with the detected timings into storyboard rows and a table", () => {
        const analysis = parseVideoTeardownAnalysis(JSON.stringify({ rows: [row(1, { dialogue: "姐妹们看过来", dialogueSource: "asr", onScreenText: "好物分享" }), row(2), row(3), row(4)] }), [1, 2, 3, 4], false);
        const rows = videoTeardownStoryboardRows(bundle(), analysis.rows);
        expect(rows.map((item) => [item.shotNumber, item.sourceStartMs, item.sourceEndMs, item.keyframeTimeMs, item.durationSeconds])).toEqual([
            [1, 0, 1800, 900, 2],
            [2, 1800, 4200, 3000, 2],
            [3, 4200, 6600, 5400, 2],
            [4, 6600, 9000, 7800, 2],
        ]);
        expect(rows[0].sourceAnalysis).toEqual({ boundary: "start", onScreenText: "好物分享", production: "实拍", productionConfidence: "中", dialogueSource: "asr", keyframeResourceId: "kf-1" });
        expect(rows[0].imageGenerationPrompt).toBe("画面 1");
        const table = videoTeardownBatchTable(rows, { title: "杯子种草", sourceNodeId: "video-1", keyframeNodeIds: ["f1", "f2", "f3", "f4"] });
        expect(table.contentKind).toBe("storyboard");
        expect(table.storyboardSourceNodeIds).toEqual(["video-1"]);
        expect(table.rows.map((item) => item.inputNodeIds)).toEqual([["f1"], ["f2"], ["f3"], ["f4"]]);
        expect(table.rows[0].cells?.["teardown-time"]).toBe("0:00.0–0:01.8");
        expect(table.rows[0].cells?.["teardown-production"]).toBe("实拍（把握中）");
        expect(table.rows[0].cells?.["teardown-onScreenText"]).toBe("好物分享");
    });

    test("writes a report with beats, warnings and the usage note", () => {
        const analysis = parseVideoTeardownAnalysis(
            JSON.stringify({
                title: "杯子种草",
                summary: { genre: "口播种草", hook: "开头直接喊人", beats: [{ name: "钩子", shots: [1, 2], purpose: "留人" }], whyItWorks: ["节奏快"], replicationTips: ["换成自己的产品"] },
                rows: [row(1), row(2), row(3), row(4)],
            }),
            [1, 2, 3, 4],
            true,
        );
        const report = videoTeardownReportMarkdown(bundle({ warnings: ["未配置转写服务"] }), analysis, videoTeardownStoryboardRows(bundle(), analysis.rows));
        expect(report).toContain("# 拆解报告：杯子种草");
        expect(report).toContain("| 钩子 | 1、2 | 0:00.0–0:04.2 | 留人 |");
        expect(report).toContain("- 未配置转写服务");
        expect(report).toContain("不要搬运原视频");
    });
});
