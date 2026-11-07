import { describe, expect, it } from "bun:test";
import { createRemakeJob, duplicateRemakeJob, normalizeRemakeJob, remakeJobError, remakeSpokenText, type RemakeJob, type RemakeTreatment } from "../src/lib/remake/job";
import { buildRemakePersonaPrompt, REMAKE_PERSONA_DEFAULT, remakePersonaLabel } from "../src/lib/remake/persona";
import { buildRemakeDialoguePrompt, buildRemakeUnitPrompt, parseRemakeDialogue, remakeDialogueBudget } from "../src/lib/remake/prompts";
import { remakeLines, remakeSubtitleLayout, remakeSubtitleSignature, remakeSubtitleSRT, remakeTimeline, remakeVoicePlan, remakeVoiceSignature, remakeWrapText } from "../src/lib/remake/timeline";
import { planRemakeUnits } from "../src/lib/remake/units";
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

function produced(treatments: RemakeTreatment[], audio: RemakeJob["audio"]): RemakeJob {
    const value = createRemakeJob("remake_x", { teardownId: "vt1", bundle, analysis: null, sourceName: "原片.mp4" }, new Date("2026-11-06T08:00:00Z"));
    value.model = "seedance";
    value.audio = audio;
    value.authorized = true;
    value.product = { name: "绿色纸巾", sellingPoints: "厚实不掉屑", images: [{ id: "p1", resourceId: "res-p1", name: "p1" }] };
    value.shots = value.shots.map((shot, index) => ({ ...shot, treatment: treatments[index], dialogue: index === 0 ? "看这包纸" : index === 2 ? "擦桌子不掉屑" : "" }));
    value.units = planRemakeUnits(value.shots, { maxMs: 15_000, sourceDurationMs: 12_000 }).map((unit, index) => ({
        ...unit,
        status: "succeeded" as const,
        takes: [{ taskId: `t${index}`, resourceId: `gen-${index}`, createdAt: "", width: 720, height: 1280 }],
    }));
    return value;
}

function voiced(value: RemakeJob, durations: Record<number, number>) {
    value.voice = { model: "tts-1", voice: "nova", speed: "1.1" };
    value.voiceLines = remakeVoicePlan(value).map((line) => ({ ...line, status: "succeeded" as const, attempt: 1, resourceId: `voice-${line.shotIndex}`, durationMs: durations[line.shotIndex] }));
    return value;
}

describe("remake voice-over", () => {
    it("plans one line per spoken shot and invalidates it when the voice or text changes", () => {
        const value = voiced(produced(["replace", "replace", "replace", "replace", "replace"], "voice"), { 1: 1200, 3: 2500 });
        expect(remakeVoicePlan(value).map((line) => [line.shotIndex, line.text])).toEqual([
            [1, "看这包纸"],
            [3, "擦桌子不掉屑"],
        ]);
        expect(remakeVoiceSignature(value, "看这包纸")).toBe("tts-1|nova|1.1|zh|看这包纸");
        const changed = { ...value, voice: { ...value.voice, voice: "alloy" } };
        expect(remakeLines(changed).every((line) => !line.voice)).toBe(true);
        expect(remakeJobError({ ...value, voice: { model: "", voice: "", speed: "1" } })).toBe("请选择配音模型");
    });

    it("places voice clips at the shot start, uses the real voice length and mutes the generated video", () => {
        const value = voiced(produced(["replace", "skip", "replace", "replace", "replace"], "voice"), { 1: 2200, 3: 1800 });
        // 镜头 1 的配音 2.2 秒，但镜头 3 在成片里从 1.5 秒开始：截到 1.5 秒。
        expect(remakeLines(value).map((line) => [line.shotIndex, line.startMs, line.endMs])).toEqual([
            [1, 0, 1500],
            [3, 1500, 3300],
        ]);
        const timeline = remakeTimeline(value, { width: 720, height: 1280 });
        expect(timeline.tracks.find((track) => track.id === "gen")?.muted).toBe(true);
        expect(timeline.clips.filter((clip) => clip.trackId === "voice").map((clip) => [clip.startMs, clip.durationMs, clip.directMedia?.storageKey])).toEqual([
            [0, 1500, "resource:voice-1"],
            [1500, 1800, "resource:voice-3"],
        ]);
        expect(remakeSubtitleSRT(value)).toContain("00:00:01,500 --> 00:00:03,300\n擦桌子不掉屑");
        expect(() => remakeTimeline({ ...value, voiceLines: [] }, { width: 720, height: 1280 })).toThrow("配音没有生成好");
    });

    it("tells the video model to stay silent and keeps the speaking lines for lip sync in rewrite mode", () => {
        const value = voiced(produced(["replace", "replace", "replace", "replace", "replace"], "voice"), {});
        const prompt = buildRemakeUnitPrompt(value, value.units[0], value.shots, 12);
        expect(prompt).toContain("不要人声和旁白（成片会另配旁白配音）");
        expect(prompt).not.toContain("台词（");
        const english = { ...value, audio: "rewrite" as const, language: "en" as const };
        expect(buildRemakeUnitPrompt(english, english.units[0], english.shots, 12)).toContain("台词（英语");
    });
});

describe("remake music and subtitles", () => {
    it("loops the music over the whole film with a fade out", () => {
        const value = produced(["replace", "replace", "replace", "replace", "replace"], "mute");
        value.music = { resourceId: "bgm", name: "轻快.mp3", durationMs: 3000, volume: 0.3 };
        const music = remakeTimeline(value, { width: 720, height: 1280 }).clips.find((clip) => clip.trackId === "music");
        expect(music).toMatchObject({ startMs: 0, durationMs: 12_000, loop: true, volume: 0.3, fadeOutMs: 1500 });
    });

    it("burns subtitle images only when they were drawn for the same text and size", () => {
        const value = produced(["replace", "replace", "replace", "replace", "replace"], "rewrite");
        value.subtitles = { burn: true };
        const size = { width: 720, height: 1280 };
        expect(() => remakeTimeline(value, size)).toThrow("字幕图");
        const lines = remakeLines(value);
        value.subtitleImages = { signature: remakeSubtitleSignature(lines, size), items: lines.map((line) => ({ shotIndex: line.shotIndex, resourceId: `sub-${line.shotIndex}` })) };
        const timeline = remakeTimeline(value, size);
        expect(timeline.clips.filter((clip) => clip.trackId === "burn").map((clip) => [clip.kind, clip.overlay, clip.startMs, clip.durationMs, clip.directMedia?.storageKey])).toEqual([
            ["image", true, 0, 1500, "resource:sub-1"],
            ["image", true, 4000, 3000, "resource:sub-3"],
        ]);
        expect(timeline.clips.filter((clip) => clip.kind === "subtitle").map((clip) => clip.text)).toEqual(["看这包纸", "擦桌子不掉屑"]);
        expect(() => remakeTimeline(value, { width: 1080, height: 1920 })).toThrow("字幕图");
    });

    it("uses the original lines when keeping the original sound and none when muted", () => {
        const value = produced(["replace", "replace", "replace", "replace", "replace"], "original");
        value.shots[0].originalDialogue = "家人们看这包纸";
        expect(remakeSpokenText(value, value.shots[0])).toBe("家人们看这包纸");
        expect(remakeLines({ ...value, audio: "mute" })).toEqual([]);
    });

    it("wraps CJK by character and latin text by word, shrinking before truncating", () => {
        const measure = (text: string) => Array.from(text).length * 10;
        expect(remakeWrapText("这包纸巾真的很厚实", 40, measure)).toEqual(["这包纸巾", "真的很厚", "实"]);
        expect(remakeWrapText("this tissue is soft", 100, measure)).toEqual(["this", "tissue is", "soft"]);
        const layout = remakeSubtitleLayout("一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十", { width: 720, height: 1280 }, (text, size) => Array.from(text).length * size);
        expect(layout.fontSize).toBe(Math.round(Math.round(720 * 0.055) * 0.82));
        expect(layout.lines).toHaveLength(2);
        expect(layout.lines[1].endsWith("…")).toBe(true);
        expect(layout.bottomY).toBe(1024);
    });
});

describe("remake languages, copies and personas", () => {
    it("budgets characters per language and asks for natural lines in that language", () => {
        const value = produced(["replace", "replace", "replace", "replace", "replace"], "rewrite");
        expect(remakeDialogueBudget(value.shots[0], "en")).toBe(21);
        const english = { ...value, language: "en" as const };
        expect(buildRemakeDialoguePrompt(english)).toContain("新口播一律用英语写（面向当地观众的自然口语，不是逐字翻译）");
        expect(buildRemakeDialoguePrompt(english)).toContain("最多 21 个字符");
        const parsed = parseRemakeDialogue('{"lines":[' + value.shots.map((shot) => `{"shotNumber":${shot.index},"dialogue":"Try this cup."}`).join(",") + "]}", value.shots, "en");
        expect(parsed.get(1)).toBe("Try this cup.");
        expect(() => parseRemakeDialogue('{"lines":[' + value.shots.map((shot) => `{"shotNumber":${shot.index},"dialogue":"${"a".repeat(80)}"}`).join(",") + "]}", value.shots, "en")).toThrow("镜头时长");
    });

    it("copies a job as another version keeping takes, or for another product clearing lines and takes", () => {
        const value = voiced(produced(["replace", "replace", "replace", "replace", "replace"], "voice"), { 1: 1000 });
        value.render = { resourceId: "final" };
        const version = duplicateRemakeJob(value, "copy1", { title: "复刻 · 版本 2" }, new Date("2026-11-07T00:00:00Z"));
        expect(version).toMatchObject({ id: "copy1", revision: 0, status: "draft", title: "复刻 · 版本 2", variantOf: { id: "remake_x" } });
        expect(version.render).toBeUndefined();
        expect(version.units[0].takes).toHaveLength(1);
        expect(version.voiceLines).toHaveLength(value.voiceLines.length);
        const other = duplicateRemakeJob(value, "copy2", { title: "复刻 · 白色纸巾", product: { name: "白色纸巾", sellingPoints: "", images: [] } });
        expect(other.product.name).toBe("白色纸巾");
        expect(other.shots.every((shot) => !shot.dialogue)).toBe(true);
        expect(other.units.every((unit) => unit.status === "pending" && !unit.takes.length)).toBe(true);
        expect(other.voiceLines).toEqual([]);
    });

    it("reads the new fields back and falls back for old jobs", () => {
        const value = voiced(produced(["replace", "replace", "replace", "replace", "replace"], "voice"), { 1: 1000 });
        value.language = "ja";
        value.subtitles = { burn: true };
        value.music = { resourceId: "bgm", name: "a.mp3", volume: 3 };
        const read = normalizeRemakeJob(JSON.parse(JSON.stringify(value)));
        expect(read).toMatchObject({ audio: "voice", language: "ja", subtitles: { burn: true }, voice: { model: "tts-1", voice: "nova", speed: "1.1" }, music: { resourceId: "bgm", volume: 1 } });
        expect(read?.voiceLines[0]).toMatchObject({ shotIndex: 1, status: "succeeded", resourceId: "voice-1", durationMs: 1000 });
        const legacy = JSON.parse(JSON.stringify(value));
        delete legacy.language;
        delete legacy.voice;
        delete legacy.voiceLines;
        delete legacy.subtitles;
        expect(normalizeRemakeJob(legacy)).toMatchObject({ language: "zh", voice: { model: "", speed: "1" }, voiceLines: [], subtitles: { burn: false } });
    });

    it("writes an adult, original persona prompt", () => {
        const prompt = buildRemakePersonaPrompt({ ...REMAKE_PERSONA_DEFAULT, gender: "male", age: "35-44", look: "latin", note: "短发" });
        expect(prompt).toContain("一位 35-44 岁的成年男性，拉丁裔长相");
        expect(prompt).toContain("不要模仿任何真人");
        expect(prompt).toContain("补充：短发");
        expect(remakePersonaLabel(REMAKE_PERSONA_DEFAULT)).toBe("女 · 25–34 岁 · 东亚 · 匀称 · 日常休闲");
    });
});
