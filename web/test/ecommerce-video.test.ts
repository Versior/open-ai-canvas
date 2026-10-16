import { describe, expect, test } from "bun:test";

import {
    ECOMMERCE_VIDEO_KINDS,
    ECOMMERCE_VIDEO_LANGUAGES,
    createEcommerceVideo,
    createEcommerceVideoShot,
    ecommerceVideoPrompt,
} from "@/lib/ecommerce/ecommerce-video";
import {
    ECOMMERCE_VIDEO_REPLICA_NEVER,
    buildEcommerceVideoTeardownPrompt,
    createEcommerceVideoReplica,
    ecommerceVideoReplicaBeatCount,
    ecommerceVideoReplicaBlock,
    ecommerceVideoReplicaReady,
} from "@/lib/ecommerce/ecommerce-video-replica";
import {
    ECOMMERCE_VIDEO_TEMPLATES,
    ecommerceVideoTemplate,
    ecommerceVideoTemplateBeats,
    ecommerceVideoTemplateSeconds,
    ecommerceVideoTemplatesForPlatform,
} from "@/lib/ecommerce/ecommerce-video-templates";

describe("viral video replica", () => {
    test("the never-copy list leads with music — audio fingerprinting is stricter than image", () => {
        // 视频比图片更危险：音频指纹稽查比图像更成熟，搬音乐是直接侵权
        expect(ECOMMERCE_VIDEO_REPLICA_NEVER[0]).toContain("背景音乐");
        expect(ECOMMERCE_VIDEO_REPLICA_NEVER.join(" ")).toContain("音频指纹");
        expect(ECOMMERCE_VIDEO_REPLICA_NEVER.join(" ")).toContain("人物面孔");
    });

    test("the block puts the boundary before the mode", () => {
        const block = ecommerceVideoReplicaBlock(createEcommerceVideoReplica("对标爆款"));
        expect(block).toContain("【视频复刻】");
        expect(block).toContain("参考视频给的是**结构**，不是素材");
        // 模型读到「留主体换场景」会倾向于把参考视频的整段画面留下来，边界必须先立
        expect(block.indexOf("绝对不复刻")).toBeLessThan(block.indexOf("模式："));
        expect(block).toContain("复刻维度：节奏、切点、段落结构");
    });

    test("each mode changes the direction sentence", () => {
        expect(ecommerceVideoReplicaBlock({ ...createEcommerceVideoReplica(), mode: "keep-subject-swap-scene" })).toContain("只替换环境与背景");
        expect(ecommerceVideoReplicaBlock({ ...createEcommerceVideoReplica(), mode: "keep-scene-swap-subject" })).toContain("把画面里的商品换成我们自己的");
        expect(ecommerceVideoReplicaBlock({ ...createEcommerceVideoReplica(), mode: "structure-only" })).toContain("画面内容全部重新拍摄或生成");
    });

    test("no aspects selected means nothing to compile", () => {
        expect(ecommerceVideoReplicaReady({ ...createEcommerceVideoReplica(), aspects: [] })).toBe(false);
        expect(ecommerceVideoReplicaBlock({ ...createEcommerceVideoReplica(), aspects: [] })).toBe("");
    });

    test("the teardown prompt asks for timing, not a scene description", () => {
        const prompt = buildEcommerceVideoTeardownPrompt();
        expect(prompt).toContain("只拆解它的**结构与节奏**");
        expect(prompt).toContain("第 N 段（第 X–Y 秒）");
        // 画面本来就要换掉，描述画面对复刻毫无用处
        expect(prompt).toContain("不要描述画面内容");
        expect(prompt).toContain("不要复述字幕原文");
    });

    test("only the checked aspects are asked about", () => {
        const prompt = buildEcommerceVideoTeardownPrompt({ aspects: ["rhythm"] });
        expect(prompt).toContain("节奏");
        expect(prompt).not.toContain("字幕位置");
    });

    test("beat count reads the structure notes", () => {
        const replica = { ...createEcommerceVideoReplica(), notes: "第 1–3 秒痛点\n第 3 秒切商品\n第 4–8 秒演示" };
        expect(ecommerceVideoReplicaBeatCount(replica)).toBe(3);
        expect(ecommerceVideoReplicaBeatCount(createEcommerceVideoReplica())).toBe(0);
    });

    test("the replica block rides along with the video prompt", () => {
        const shots = [{ ...createEcommerceVideoShot("img-1"), seconds: 3 }];
        const prompt = ecommerceVideoPrompt({ ...createEcommerceVideo("主图视频"), shots, replica: createEcommerceVideoReplica("对标爆款") });
        expect(prompt).toContain("【电商视频】");
        expect(prompt).toContain("【视频复刻】");
    });
});

describe("video template library", () => {
    test("covers the eight structures the trade settled on", () => {
        expect(ECOMMERCE_VIDEO_TEMPLATES.map((template) => template.id)).toEqual(["pain-point", "unboxing", "demo", "talking-head", "ugc", "reaction", "short-drama", "tvc"]);
        for (const template of ECOMMERCE_VIDEO_TEMPLATES) {
            expect(template.hint.trim()).not.toBe("");
            // 「靠什么起作用」和素材要求是模板的立身之本——没有它们就只是一个风格标签
            expect(template.logic.trim()).not.toBe("");
            expect(template.needs.trim()).not.toBe("");
            expect(template.beats.length).toBeGreaterThanOrEqual(4);
            for (const beat of template.beats) {
                expect(beat.label.trim()).not.toBe("");
                expect(beat.purpose.trim()).not.toBe("");
                expect(beat.seconds).toBeGreaterThan(0);
            }
        }
    });

    test("pain-point puts empathy before the product — that is the whole mechanism", () => {
        const template = ecommerceVideoTemplate("pain-point")!;
        expect(template.beats[0].label).toBe("痛点");
        expect(template.beats[0].purpose).toContain("不要提商品");
        expect(template.logic).toContain("先共情再给方案");
    });

    test("TVC runs opposite to the hook-driven templates", () => {
        const tvc = ecommerceVideoTemplate("tvc")!;
        expect(tvc.logic).toContain("不卖货，卖质感");
        expect(tvc.beats[0].purpose).toContain("不露商品全貌");
    });

    test("UGC's logic is realism, not polish", () => {
        const ugc = ecommerceVideoTemplate("ugc")!;
        expect(ugc.logic).toContain("不像广告");
        expect(ugc.beats[0].label).toBe("场景");
        expect(ugc.beats[0].purpose).toContain("不要先给商品");
    });

    test("templates are filtered by platform — 9:16 structures have no place on taobao", () => {
        const douyin = ecommerceVideoTemplatesForPlatform("douyin").map((template) => template.id);
        const taobao = ecommerceVideoTemplatesForPlatform("taobao").map((template) => template.id);
        expect(douyin).toContain("ugc");
        expect(douyin).toContain("short-drama");
        expect(taobao).not.toContain("ugc");
        expect(taobao).not.toContain("short-drama");
        expect(taobao).toContain("demo");
    });

    test("over-length templates compress instead of dropping beats", () => {
        const template = ecommerceVideoTemplate("tvc")!;
        expect(ecommerceVideoTemplateSeconds(template)).toBe(18);
        // 砍掉「收尾」会让片子断在半空，砍掉「痛点」会让整条逻辑垮掉
        const compressed = ecommerceVideoTemplateBeats(template, "taobao", 9);
        expect(compressed).toHaveLength(template.beats.length);
        expect(compressed.reduce((sum, beat) => sum + beat.seconds, 0)).toBeLessThanOrEqual(9);
        // 够长就不动
        expect(ecommerceVideoTemplateBeats(template, "taobao", 60)).toEqual(template.beats);
    });

    test("every template names a kind that exists", () => {
        for (const template of ECOMMERCE_VIDEO_TEMPLATES) {
            expect(ECOMMERCE_VIDEO_KINDS.some((kind) => kind.id === template.kind)).toBe(true);
            expect(template.platforms.length).toBeGreaterThan(0);
        }
    });
});

describe("video language", () => {
    test("the seven cross-border languages carry market notes", () => {
        expect(ECOMMERCE_VIDEO_LANGUAGES.map((language) => language.id)).toEqual(["zh", "en", "ja", "ko", "es", "pt", "ar"]);
        for (const language of ECOMMERCE_VIDEO_LANGUAGES) {
            expect(language.name.trim()).not.toBe("");
            expect(language.note.trim()).not.toBe("");
        }
        expect(ECOMMERCE_VIDEO_LANGUAGES.find((language) => language.id === "ar")!.note).toContain("右起");
    });

    test("a non-Chinese target adds a market line to the prompt", () => {
        const shots = [{ ...createEcommerceVideoShot("img-1"), seconds: 3 }];
        const zh = ecommerceVideoPrompt({ ...createEcommerceVideo(), shots, language: "zh" });
        expect(zh).not.toContain("目标市场语言");
        const en = ecommerceVideoPrompt({ ...createEcommerceVideo(), shots, language: "en" });
        expect(en).toContain("目标市场语言：英语");
        expect(en).toContain("卖点排序按当地偏好调整");
    });

    test("new videos default to Chinese", () => {
        expect(createEcommerceVideo().language).toBe("zh");
    });
});
