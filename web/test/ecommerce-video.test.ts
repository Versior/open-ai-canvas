import { describe, expect, test } from "bun:test";

import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import { getNodeAcceptedInputKinds } from "@/lib/canvas/node-registry";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import {
    ECOMMERCE_VIDEO_KINDS,
    ECOMMERCE_VIDEO_LANGUAGES,
    applyEcommerceVideoCreativePlan,
    buildEcommerceVideoCreativePlanPrompt,
    createEcommerceVideo,
    createEcommerceVideoShot,
    ecommerceVideoCreativePlanSourceSignature,
    ecommerceVideoPrompt,
    parseEcommerceVideoCreativePlan,
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

describe("ecommerce video inputs", () => {
    test("accepts image, text and video inputs without allowing audio", () => {
        const target: CanvasNodeData = { id: "ecommerce-video", type: CanvasNodeType.EcommerceVideo, position: { x: 0, y: 0 } };
        const source = (type: CanvasNodeType): CanvasNodeData => ({ id: type, type, position: { x: 0, y: 0 } });
        const nodes = [source(CanvasNodeType.Image), source(CanvasNodeType.Text), source(CanvasNodeType.Video), source(CanvasNodeType.Audio), target];
        const errorFrom = (type: CanvasNodeType) => canvasConnectionError(defaultConfig, nodes, [], { fromNodeId: type, toNodeId: target.id });

        expect(getNodeAcceptedInputKinds(CanvasNodeType.EcommerceVideo)).toEqual(["image", "text", "video"]);
        expect(errorFrom(CanvasNodeType.Image)).toBe("");
        expect(errorFrom(CanvasNodeType.Text)).toBe("");
        expect(errorFrom(CanvasNodeType.Video)).toBe("");
        expect(errorFrom(CanvasNodeType.Audio)).not.toBe("");
    });
});

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

    test("a structured creative plan is parsed before explicit application replaces shots", () => {
        const video = createEcommerceVideo("复刻草案");
        const raw = `\`\`\`json
{
  "hook": "前 2 秒点明痛点",
  "rhythm": "2 秒 Hook 后切 3 秒演示",
  "shots": [
    { "startSeconds": 0, "endSeconds": 2, "purpose": "痛点 Hook", "motion": "push", "caption": "每天都在浪费时间？", "transition": "cut" },
    { "startSeconds": 2, "endSeconds": 5, "purpose": "商品演示与 CTA", "motion": "pan-right", "caption": "现在就试试", "transition": "fade" }
  ],
  "cta": "现在就试试"
}
\`\`\``;

        const plan = parseEcommerceVideoCreativePlan(raw);
        expect(plan).toEqual({
            hook: "前 2 秒点明痛点",
            rhythm: "2 秒 Hook 后切 3 秒演示",
            shots: [
                { startSeconds: 0, endSeconds: 2, purpose: "痛点 Hook", motion: "push", caption: "每天都在浪费时间？", transition: "cut" },
                { startSeconds: 2, endSeconds: 5, purpose: "商品演示与 CTA", motion: "pan-right", caption: "现在就试试", transition: "fade" },
            ],
            cta: "现在就试试",
        });
        expect(video.shots).toEqual([]);

        const applied = applyEcommerceVideoCreativePlan(video, plan!, ["image-1", "image-2"]);
        expect(applied.shots.map(({ imageNodeId, seconds, motion, description, caption, transition }) => ({ imageNodeId, seconds, motion, description, caption, transition }))).toEqual([
            { imageNodeId: "image-1", seconds: 2, motion: "push", description: "痛点 Hook", caption: "每天都在浪费时间？", transition: "cut" },
            { imageNodeId: "image-2", seconds: 3, motion: "pan-right", description: "商品演示与 CTA", caption: "现在就试试", transition: "fade" },
        ]);
    });

    test("creative-plan shots must start at zero and form one continuous timeline", () => {
        const plan = (shots: unknown[]) => JSON.stringify({ hook: "Hook", rhythm: "快节奏", shots, cta: "立即购买" });
        const shot = (startSeconds: number, endSeconds: number) => ({ startSeconds, endSeconds, purpose: "镜头任务", motion: "push", caption: "字幕", transition: "cut" });

        expect(parseEcommerceVideoCreativePlan(plan([shot(1, 2)]))).toBeUndefined();
        expect(parseEcommerceVideoCreativePlan(plan([shot(0, 2), shot(1.5, 3)]))).toBeUndefined();
        expect(parseEcommerceVideoCreativePlan(plan([shot(0, 2), shot(2.5, 3)]))).toBeUndefined();
    });

    test("the creative-plan request requires platform-aware JSON without inheriting competitor facts", () => {
        const prompt = buildEcommerceVideoCreativePlanPrompt({ aspects: ["rhythm"], platform: "douyin", language: "en" });
        expect(prompt).toContain('"hook"');
        expect(prompt).toContain('"rhythm"');
        expect(prompt).toContain('"shots"');
        expect(prompt).toContain('"caption"');
        expect(prompt).toContain('"cta"');
        expect(prompt).toContain("只输出一个 JSON 对象");
        expect(prompt).toContain("目标平台：抖音");
        expect(prompt).toContain("目标语言：英语");
        expect(prompt).toContain("禁止继承参考视频的品牌、价格、参数、人物、字幕、音乐或商品事实");
    });

    test("creative-plan source signatures change with every source but never persist media URLs or bytes", () => {
        const target: CanvasNodeData = { id: "video-target", type: CanvasNodeType.EcommerceVideo, position: { x: 0, y: 0 }, metadata: { ecommerceVideo: { ...createEcommerceVideo(), platform: "douyin", language: "en" } } };
        const reference: CanvasNodeData = { id: "reference", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, metadata: { content: "https://cdn.example.test/reference.mp4?token=secret" } };
        const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, position: { x: 0, y: 0 }, metadata: { productProfile: { name: "保温杯", category: "杯具", appearance: "白色", marks: "YINGCE", forbidden: "不可改色", audience: "通勤", facts: "210g", price: "99 元", views: {} } } };
        const image: CanvasNodeData = { id: "product-image", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,raw-product-bytes" } };
        const signature = ecommerceVideoCreativePlanSourceSignature({ target, referenceVideo: reference, product, productImages: [image] });

        expect(signature).not.toContain("secret");
        expect(signature).not.toContain("raw-product-bytes");
        expect(ecommerceVideoCreativePlanSourceSignature({ target: { ...target, metadata: { ...target.metadata, ecommerceVideo: { ...target.metadata!.ecommerceVideo!, language: "ja" } } }, referenceVideo: reference, product, productImages: [image] })).not.toBe(signature);
        expect(ecommerceVideoCreativePlanSourceSignature({ target, referenceVideo: { ...reference, metadata: { content: "/other.mp4" } }, product, productImages: [image] })).not.toBe(signature);
        expect(ecommerceVideoCreativePlanSourceSignature({ target, referenceVideo: reference, product: { ...product, metadata: { ...product.metadata, productProfile: { ...product.metadata!.productProfile!, facts: "300g" } } }, productImages: [image] })).not.toBe(signature);
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

    test("a template beat keeps its purpose in the final generation prompt", () => {
        const shot = createEcommerceVideoShot("img-1", "说出买家正在遇到的问题，不要提商品");
        const prompt = ecommerceVideoPrompt({ ...createEcommerceVideo("痛点视频"), templateId: "pain-point", shots: [{ ...shot, caption: "痛点" }] });
        expect(prompt).toContain("镜头目的：说出买家正在遇到的问题，不要提商品");
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
