import { describe, expect, it } from "bun:test";
import type { VideoTeardownAnalysisRow } from "../src/lib/canvas/video-teardown";
import { createRemakeJob, normalizeRemakeJob, remakeJobError, remakeKeptDurationMs, type RemakeJob, type RemakeShot, type RemakeTreatment } from "../src/lib/remake/job";
import { buildRemakeDialoguePrompt, buildRemakeUnitPrompt, parseRemakeDialogue, remakeDialogueBudget, remakeReferenceImages } from "../src/lib/remake/prompts";
import { remakeOutputTime, remakePieces, remakeSourceTime, remakeSubtitleSRT, remakeTimeline } from "../src/lib/remake/timeline";
import { applyRemakeCreativeSignature, planRemakeUnits, remakeClipRange } from "../src/lib/remake/units";
import { DEFAULT_REPLICA_CAMPAIGN, DEFAULT_REPLICA_DIRECTION } from "@/lib/canvas/replica-director";
import type { VideoTeardownBundle } from "../src/services/api/video-replication";

const bundle: VideoTeardownBundle = {
    version: 1,
    source: { resourceId: "res-src", durationMs: 12_000, width: 720, height: 1280, hasAudio: true },
    shots: [
        [0, 1500],
        [1500, 4000],
        [4000, 7000],
        [7000, 8000],
        [8000, 12_000],
    ].map(([startMs, endMs], index) => ({ index: index + 1, startMs, endMs, boundary: index ? "cut" : "start", keyframeTimeMs: startMs + 200, keyframeResourceId: `kf-${index + 1}`, keyframeWidth: 288, keyframeHeight: 512 })),
    grids: [],
    transcript: { source: "asr", segments: [] },
    warnings: [],
};

function row(shotNumber: number, patch: Partial<VideoTeardownAnalysisRow> = {}): VideoTeardownAnalysisRow {
    const empty = Object.fromEntries(
        [
            "plotDescription",
            "dialogue",
            "onScreenText",
            "product",
            "keyColors",
            "shotSize",
            "camera",
            "motion",
            "lightingAndAtmosphere",
            "emotion",
            "audioEffects",
            "production",
            "productionConfidence",
            "imageGenerationPrompt",
            "videoMotionPrompt",
            "continuityOut",
            "people",
            "brandText",
        ].map((key) => [key, ""]),
    ) as Record<string, string>;
    return { ...(empty as unknown as VideoTeardownAnalysisRow), shotNumber, dialogueSource: "none", productRole: "none", ...patch };
}

const analysis = {
    title: "纸巾测评",
    summary: { genre: "测评", product: "原品牌纸巾", hook: "撕开一整包", beats: [], whyItWorks: [], music: "", textStyle: "", replicationTips: [] },
    rows: [
        row(1, { plotDescription: "女生拿起一包纸巾", productRole: "dynamic", product: "一包纸巾", people: "speaker", dialogue: "家人们看这包纸", dialogueSource: "asr" }),
        row(2, { plotDescription: "撕开包装", productRole: "hero_real", product: "纸巾特写" }),
        row(3, { plotDescription: "纸巾擦桌子", brandText: "某某牌", onScreenText: "超厚" }),
        row(4, { plotDescription: "空镜" }),
        row(5, { plotDescription: "举起整箱", productRole: "package_text", people: "presenter", dialogue: "一箱二十四包", dialogueSource: "asr" }),
    ],
};

function job(treatments?: RemakeTreatment[]): RemakeJob {
    const value = createRemakeJob("remake_abc", { teardownId: "vt1", bundle, analysis, sourceName: "原片.mp4" }, new Date("2026-11-06T08:00:00Z"));
    value.model = "seedance";
    value.product = { name: "绿色纸巾", sellingPoints: "厚实不掉屑", images: [{ id: "p1", resourceId: "res-p1", name: "p1" }] };
    if (treatments) value.shots = value.shots.map((shot, index) => ({ ...shot, treatment: treatments[index] }));
    return value;
}

describe("remake job", () => {
    it("tags risks from the analysis and recommends remaking branded shots", () => {
        const shots = job().shots;
        expect(shots[0]).toMatchObject({ risks: ["product", "face", "speech"], speaker: true, recommended: "replace" });
        expect(shots[2].risks).toEqual(["brand", "text"]);
        expect(shots[2].recommended).toBe("remake");
        expect(shots[4]).toMatchObject({ speaker: false, recommended: "replace" });
        expect(job().title).toBe("复刻 · 纸巾测评");
    });

    it("requires materials, authorization for original content and a model that can speak", () => {
        expect(remakeJobError(job())).toBe("");
        expect(remakeJobError({ ...job(), product: { name: "", sellingPoints: "", images: [] } })).toContain("商品图");
        expect(remakeJobError(job(["keep", "replace", "replace", "replace", "replace"]))).toContain("授权");
        expect(remakeJobError({ ...job(["keep", "replace", "replace", "replace", "replace"]), authorized: true })).toBe("");
        expect(remakeJobError(job(["skip", "skip", "skip", "skip", "skip"]))).toContain("至少保留");
        const speaking = { ...job(), shots: job().shots.map((shot) => ({ ...shot, dialogue: "新口播" })) };
        expect(remakeJobError(speaking, { maxImages: 9, generateAudio: false })).toContain("不能生成声音");
        expect(remakeKeptDurationMs(job(["replace", "skip", "replace", "skip", "replace"]))).toBe(8500);
    });

    it("normalizes stored jobs and rejects legacy items", () => {
        const stored = normalizeRemakeJob(JSON.parse(JSON.stringify({ ...job(), status: "bogus", units: [{ key: "replace:0-4000", takes: [{ resourceId: "r1" }, { taskId: "t" }], chosen: 5 }] })));
        expect(stored?.status).toBe("failed");
        expect(stored?.units[0]).toMatchObject({ treatment: "replace", takes: [{ resourceId: "r1" }], chosen: 0 });
        expect(normalizeRemakeJob({ id: "legacy", title: "旧版" })).toBeUndefined();
    });
});

describe("remake units", () => {
    it("merges adjacent shots with the same treatment and keeps keep/skip out", () => {
        const units = planRemakeUnits(job(["replace", "replace", "remake", "skip", "replace"]).shots, { maxMs: 15_000, sourceDurationMs: 12_000 });
        expect(units.map((unit) => [unit.treatment, unit.shotIndexes, unit.startMs, unit.endMs, unit.clipStartMs, unit.clipEndMs])).toEqual([
            ["replace", [1, 2], 0, 4000, 0, 4000],
            ["remake", [3], 4000, 7000, 4000, 7000],
            ["replace", [5], 8000, 12_000, 8000, 12_000],
        ]);
    });

    it("splits a run that exceeds the limit, pads short clips and reuses unchanged units", () => {
        const units = planRemakeUnits(job(["replace", "replace", "replace", "replace", "replace"]).shots, { maxMs: 8000, sourceDurationMs: 12_000 });
        expect(units.map((unit) => [unit.startMs, unit.endMs])).toEqual([
            [0, 8000],
            [8000, 12_000],
        ]);
        expect(remakeClipRange(7000, 8000, 12_000, 15_000)).toEqual({ clipStartMs: 5500, clipEndMs: 9500 });
        expect(remakeClipRange(0, 1000, 12_000, 15_000)).toEqual({ clipStartMs: 0, clipEndMs: 4000 });
        expect(remakeClipRange(11_500, 12_000, 12_000, 15_000)).toEqual({ clipStartMs: 8000, clipEndMs: 12_000 });
        const withTake = units.map((unit, index) => (index === 0 ? { ...unit, status: "succeeded" as const, takes: [{ taskId: "t1", resourceId: "r1", createdAt: "" }] } : unit));
        const replanned = planRemakeUnits(job(["replace", "replace", "replace", "replace", "remake"]).shots, { maxMs: 8000, sourceDurationMs: 12_000 }, withTake);
        expect(replanned[0].takes).toHaveLength(1);
        expect(replanned[1]).toMatchObject({ treatment: "remake", startMs: 8000, endMs: 12_000, takes: [] });
    });
});

describe("remake timeline", () => {
    function produced(treatments: RemakeTreatment[], audio: RemakeJob["audio"] = "rewrite") {
        const value = { ...job(treatments), audio, authorized: true };
        value.units = planRemakeUnits(value.shots, { maxMs: 15_000, sourceDurationMs: 12_000 }).map((unit, index) => ({
            ...unit,
            status: "succeeded" as const,
            takes: [{ taskId: `t${index}`, resourceId: `gen-${index}`, createdAt: "", width: 720, height: 1280 }],
        }));
        return value;
    }

    it("lays pieces end to end, skipping deleted shots and mapping times both ways", () => {
        const value = produced(["replace", "replace", "keep", "skip", "remake"]);
        const pieces = remakePieces(value);
        expect(pieces.map((piece) => [piece.kind, piece.startMs, piece.endMs, piece.sourceStartMs])).toEqual([
            ["unit", 0, 4000, 0],
            ["keep", 4000, 7000, 4000],
            ["unit", 7000, 11_000, 8000],
        ]);
        expect(remakeSourceTime(pieces, 7500)).toBe(8500);
        expect(remakeOutputTime(pieces, 7500)).toBeUndefined();
        expect(remakeOutputTime(pieces, 9000)).toBe(8000);
    });

    it("trims padded clips, mutes original footage and lays back the original sound when kept", () => {
        const value = produced(["replace", "skip", "skip", "replace", "skip"], "original");
        const timeline = remakeTimeline(value, { width: 720, height: 1280 });
        const second = timeline.clips.find((clip) => clip.id === "unit-1");
        // 第 4 镜只有 1 秒，参考片段补成 5.5–9.5 秒，成片用 7–8 秒那一段：从候选的第 1.5 秒开始。
        expect(second).toMatchObject({ startMs: 1500, durationMs: 1000, sourceStartMs: 1500 });
        expect(timeline.tracks.find((track) => track.id === "gen")?.muted).toBe(true);
        expect(timeline.clips.filter((clip) => clip.kind === "audio").map((clip) => [clip.startMs, clip.durationMs, clip.sourceStartMs])).toEqual([
            [0, 1500, 0],
            [1500, 1000, 7000],
        ]);
        const rewrite = remakeTimeline(produced(["replace", "replace", "keep", "replace", "replace"]), { width: 720, height: 1280 });
        expect(rewrite.tracks.find((track) => track.id === "gen")?.muted).toBe(false);
        expect(rewrite.tracks.find((track) => track.id === "keep")?.muted).toBe(true);
        expect(rewrite.clips.some((clip) => clip.kind === "audio")).toBe(false);
    });

    it("writes subtitles at the new positions", () => {
        const value = produced(["replace", "skip", "replace", "replace", "replace"]);
        value.shots = value.shots.map((shot) => ({ ...shot, dialogue: shot.index === 1 ? "看这包纸" : shot.index === 5 ? "一箱二十四包" : "" }));
        expect(remakeSubtitleSRT(value)).toBe("1\n00:00:00,000 --> 00:00:01,500\n看这包纸\n\n2\n00:00:05,500 --> 00:00:09,500\n一箱二十四包\n");
    });
});

describe("remake prompts", () => {
    it("binds references by role and writes new lines with lip sync for speakers", () => {
        const value = { ...job(), models: [{ id: "m1", resourceId: "res-m1", name: "m" }], backgrounds: [{ id: "b1", resourceId: "res-b1", name: "b" }] };
        value.shots = value.shots.map((shot) => ({ ...shot, dialogue: shot.index === 1 ? "看看这包纸" : "" }));
        expect(remakeReferenceImages(value)).toMatchObject({ product: "@图片1", model: "@图片2", background: "@图片3" });
        const units = planRemakeUnits(value.shots, { maxMs: 15_000, sourceDurationMs: 12_000 });
        const replace = buildRemakeUnitPrompt(value, units[0], value.shots.slice(0, 2), 5);
        expect(replace).toContain("以@视频1为动作");
        expect(replace).toContain("@图片1里的「绿色纸巾」");
        expect(replace).toContain("@图片2里的模特");
        expect(replace).toContain("@图片3的场景");
        expect(replace).toContain("镜头 1：人物对着镜头说「看看这包纸」");
        const remake = buildRemakeUnitPrompt({ ...value, audio: "mute" }, { ...units[1], treatment: "remake" }, value.shots.slice(2, 3), 4);
        expect(remake).toContain("共 1 个镜头");
        expect(remake).toContain("纸巾擦桌子");
        expect(remake).not.toContain("@视频1");
        expect(remake).toContain("不要人声");
    });

    it("asks for dialogue within each shot budget and parses it back", () => {
        const value = job();
        expect(remakeDialogueBudget(value.shots[0])).toBe(6);
        const prompt = buildRemakeDialoguePrompt(value);
        expect(prompt).toContain("我的商品：绿色纸巾");
        expect(prompt).toContain("镜头 1｜1.5 秒｜最多 6 个字｜有人对着镜头说话｜原口播：家人们看这包纸");
        const lines = parseRemakeDialogue('{"lines":[{"shotNumber":1,"dialogue":"看看纸巾"},{"shotNumber":2,"dialogue":""},{"shotNumber":3,"dialogue":""},{"shotNumber":4,"dialogue":""},{"shotNumber":5,"dialogue":"一箱二十四包"}]}', value.shots);
        expect(lines.get(1)).toBe("看看纸巾");
        expect(() =>
            parseRemakeDialogue('{"lines":[{"shotNumber":1,"dialogue":"看看这包纸巾厚不厚呀真的厚"},{"shotNumber":2,"dialogue":""},{"shotNumber":3,"dialogue":""},{"shotNumber":4,"dialogue":""},{"shotNumber":5,"dialogue":"一箱二十四包"}]}', value.shots),
        ).toThrow("镜头时长");
        expect(lines.get(5)).toBe("一箱二十四包");
        expect(() => parseRemakeDialogue('{"lines":[{"shotNumber":1,"dialogue":"x"}]}', value.shots)).toThrow("完整");
    });
});

export type { RemakeShot };

describe("直接出片的导演输入", () => {
    it("保存导演方案，导演修改重生成且保留旧候选", () => {
        const value = job();
        value.campaign = { ...DEFAULT_REPLICA_CAMPAIGN };
        value.shots[0] = { ...value.shots[0], treatment: "remake", director: { ...DEFAULT_REPLICA_DIRECTION, beat: "hook", action: "手从杯盖上方下压到开盖" } };
        const initial = applyRemakeCreativeSignature(value, planRemakeUnits(value.shots, { maxMs: 15000, sourceDurationMs: 12000 }));
        const old = { ...initial[0], status: "succeeded" as const, takes: [{ taskId: "old-task", resourceId: "old-clip", createdAt: "now" }] };
        const changed = { ...value, campaign: { ...value.campaign, style: "studio" as const } };
        const updated = applyRemakeCreativeSignature(changed, [old])[0];
        expect(updated.status).toBe("pending");
        expect(updated.takes[0].resourceId).toBe("old-clip");
        expect(applyRemakeCreativeSignature(changed, [updated])[0]).toEqual(updated);
        expect(() => applyRemakeCreativeSignature(changed, [{ ...old, status: "running", taskId: "pending-task" }])).toThrow("确认结束");
        expect(() => applyRemakeCreativeSignature(changed, [{ ...old, status: "failed", taskId: "unconfirmed-cancel" }])).toThrow("确认结束");
        const saved = normalizeRemakeJob({ ...value, units: initial });
        expect(saved?.campaign).toEqual(value.campaign);
        expect(saved?.shots[0].director).toEqual(value.shots[0].director);
        expect(saved?.units[0].creativeSignature).toBe(initial[0].creativeSignature);
        expect(initial[0].creativeSignature!.length).toBeLessThan(32);
        expect(applyRemakeCreativeSignature(value, [{ ...old, fix: "修正上一版手部形变" }])[0].status).toBe("succeeded");
        expect(buildRemakeUnitPrompt(value, initial[0], [value.shots[0]], 1.5)).toContain("手从杯盖上方下压到开盖");
    });
    it("换元素只受连续性约束影响，重拍证明须有明确商品依据", () => {
        const value = job(["replace", "skip", "skip", "skip", "skip"]);
        value.campaign = { ...DEFAULT_REPLICA_CAMPAIGN };
        const initial = applyRemakeCreativeSignature(value, planRemakeUnits(value.shots, { maxMs: 15000, sourceDurationMs: 12000 }));
        const old = { ...initial[0], status: "succeeded" as const, takes: [{ taskId: "old", resourceId: "clip", createdAt: "now" }] };
        expect(applyRemakeCreativeSignature({ ...value, campaign: { ...value.campaign, style: "studio" } }, [old])[0].status).toBe("succeeded");
        value.shots[0] = { ...value.shots[0], treatment: "remake", director: { ...DEFAULT_REPLICA_DIRECTION, beat: "proof", action: "演示纸巾擦桌子", evidence: "吸水量提高两倍" } };
        expect(remakeJobError(value)).toContain("逐字引用");
        value.shots[0].director!.evidence = "厚实不掉屑";
        expect(remakeJobError(value)).toBe("");
    });
    it("不足一秒的镜头不获得额外的一秒口播容量", () => {
        expect(remakeDialogueBudget({ startMs: 0, endMs: 500 }, "zh")).toBe(2);
        expect(() => parseRemakeDialogue('{"lines":[{"shotNumber":1,"dialogue":"这句太长了"}]}', [{ index: 1, startMs: 0, endMs: 500 }])).toThrow("镜头时长");
    });
});
