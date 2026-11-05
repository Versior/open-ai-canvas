import { describe, expect, test } from "bun:test";

import { applyReplicaScript, buildReplicaScriptPrompt, defaultReplicaPlan, parseReplicaScripts, readReplicaPlan, replicaPlanIssues, resetReplicaShot } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

const bundle = {
    version: 1,
    source: { resourceId: "res-src", durationMs: 9000, width: 1080, height: 1920, hasAudio: true },
    shots: [1, 2, 3].map((index) => ({ index, startMs: (index - 1) * 3000, endMs: index * 3000, boundary: "cut", keyframeTimeMs: (index - 1) * 3000 + 1500, keyframeResourceId: `kf-${index}`, keyframeWidth: 288, keyframeHeight: 512 })),
    grids: [],
    transcript: { source: "none", language: "", segments: [] },
    warnings: [],
} as unknown as VideoTeardownBundle;
const row = (shotNumber: number, product: string, productRole: string, dialogue = "") => ({
    shotNumber,
    plotDescription: `画面 ${shotNumber}`,
    dialogue,
    dialogueSource: dialogue ? "subtitle" : "none",
    onScreenText: shotNumber === 1 ? "原片标题" : "",
    shotSize: "",
    camera: "",
    motion: "推近",
    lightingAndAtmosphere: "",
    emotion: "",
    audioEffects: "",
    production: "",
    productionConfidence: "",
    imageGenerationPrompt: `首帧 ${shotNumber}`,
    videoMotionPrompt: "",
    continuityOut: "",
    product,
    productRole,
    keyColors: "",
});
const analysis = {
    title: "纸巾测评",
    summary: { genre: "开箱测评", product: "绿色包装纸巾", hook: "先撕一张给你看", beats: [{ name: "钩子", shots: [1], purpose: "抓人" }], whyItWorks: [], music: "", textStyle: "", replicationTips: [] },
    rows: [row(1, "手拿一包绿色纸巾", "hero_real", "这纸巾真的厚"), row(2, "", "none"), row(3, "纸巾堆在桌上", "")],
} as unknown as VideoTeardownAnalysis;

describe("复刻方案", () => {
    test("default plan swaps product shots and copies analysis text", () => {
        const plan = defaultReplicaPlan(bundle, analysis);
        expect(plan.shots.map((shot) => shot.treatment)).toEqual(["product", "remake", "product"]);
        expect(plan.shots[0]).toMatchObject({ dialogue: "这纸巾真的厚", onScreenText: "原片标题", imagePrompt: "首帧 1" });
        // 分析没有视频提示词时用画面加运镜。
        expect(plan.shots[1].videoPrompt).toBe("画面 2；推近");
    });

    test("reading a saved plan keeps edits, drops bad shots and refuses unauthorized reuse", () => {
        const saved = {
            version: 1,
            authorized: false,
            product: { name: "保温杯", images: [{ resourceId: "p1", width: 800, height: 800 }, { resourceId: "" }] },
            scripts: [
                {
                    id: "s1",
                    angle: "痛点",
                    lines: [
                        { shotNumber: 1, dialogue: "冬天水凉得快" },
                        { shotNumber: 9, dialogue: "越界" },
                    ],
                },
            ],
            activeScriptId: "missing",
            shots: [
                { shotNumber: 1, treatment: "original", dialogue: "" },
                { shotNumber: 2, treatment: "skip" },
                { shotNumber: 7, treatment: "remake" },
            ],
        };
        const plan = readReplicaPlan(saved, bundle, analysis);
        expect(plan.product.images.map((image) => image.resourceId)).toEqual(["p1"]);
        expect(plan.scripts[0].lines).toEqual([{ shotNumber: 1, dialogue: "冬天水凉得快", onScreenText: "" }]);
        expect(plan.activeScriptId).toBe("");
        expect(plan.shots.map((shot) => shot.treatment)).toEqual(["remake", "skip", "product"]);
        // 用户清空的口播保持为空，不拿分析补回去。
        expect(plan.shots[0].dialogue).toBe("");
        expect(readReplicaPlan({ version: 2 }, bundle, analysis)).toEqual(defaultReplicaPlan(bundle, analysis));
    });

    test("issues block all-skipped and unauthorized plans and warn about missing product photos", () => {
        const plan = defaultReplicaPlan(bundle, analysis);
        expect(replicaPlanIssues({ ...plan, shots: plan.shots.map((shot) => ({ ...shot, treatment: "skip" })) }).errors).toContain("至少保留一个镜头");
        expect(replicaPlanIssues({ ...plan, shots: plan.shots.map((shot) => ({ ...shot, treatment: "original" })) }).errors[0]).toContain("授权");
        const { errors, warnings } = replicaPlanIssues(plan);
        expect(errors).toEqual([]);
        expect(warnings[0]).toContain("镜头 1、3");
    });

    test("script prompt carries the product, beats and per-shot word limits, and skips skipped shots", () => {
        const plan = defaultReplicaPlan(bundle, analysis);
        const prompt = buildReplicaScriptPrompt(
            bundle,
            analysis,
            { ...plan, product: { ...plan.product, name: "保温杯", sellingPoints: "- 保温 12 小时\n2. 一只手开盖" }, shots: plan.shots.map((shot) => (shot.shotNumber === 2 ? { ...shot, treatment: "skip" } : shot)) },
            3,
        );
        expect(prompt).toContain("3 个切入角度不同的版本");
        expect(prompt).toContain("  - 保温 12 小时");
        expect(prompt).toContain("  - 一只手开盖");
        expect(prompt).toContain("钩子（镜头 1）");
        expect(prompt).toContain("镜头 1｜0:00.0–0:03.0｜约 3 秒，口播最多 15 字");
        expect(prompt).not.toContain("镜头 2｜");
        expect(prompt).toContain("原口播：这纸巾真的厚");
    });

    test("parsing scripts keeps only versions covering every shot, and applying one fills dialogue", () => {
        const text = `好的：\n\`\`\`json\n${JSON.stringify({
            scripts: [
                {
                    angle: "痛点",
                    hook: "水总是凉",
                    lines: [
                        { shotNumber: 1, dialogue: "冬天水凉得快", onScreenText: "保温 12 小时" },
                        { shotNumber: 3, dialogue: "一只手就能开" },
                    ],
                },
                { angle: "缺镜头", lines: [{ shotNumber: 1, dialogue: "只写了一镜" }] },
            ],
        })}\n\`\`\``;
        const scripts = parseReplicaScripts(text, [1, 3], { model: "m", createdAt: "t", idPrefix: "x" });
        expect(scripts.map((script) => script.angle)).toEqual(["痛点"]);
        expect(() => parseReplicaScripts("不是 JSON", [1], { model: "m", createdAt: "t", idPrefix: "x" })).toThrow("改写脚本");

        const plan = applyReplicaScript(defaultReplicaPlan(bundle, analysis), scripts[0]);
        expect(plan.activeScriptId).toBe("x-1");
        expect(plan.shots.map((shot) => shot.dialogue)).toEqual(["冬天水凉得快", "", "一只手就能开"]);
        expect(plan.shots[0].onScreenText).toBe("保温 12 小时");
        const reset = resetReplicaShot({ ...plan.shots[0], treatment: "skip" }, analysis.rows[0]);
        expect(reset).toMatchObject({ treatment: "skip", dialogue: "这纸巾真的厚", onScreenText: "原片标题" });
    });
});
