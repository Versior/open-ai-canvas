import { describe, expect, test } from "bun:test";
import { compileEcommercePrompt, createEcommerceProductProfile, createEcommerceShot, createEcommerceShotSet, createEcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_REPLICA_NEVER, createEcommerceReplica, ecommerceReplicaBlock, ecommerceReplicaReady } from "@/lib/ecommerce/ecommerce-replica";
import { buildEcommerceTeardownPrompt, createEcommerceTeardown, createEcommerceTeardownFinding, createEcommerceTeardownOutlineRow, ecommerceTeardownBlock, ecommerceTeardownReady } from "@/lib/ecommerce/ecommerce-teardown";
import { ECOMMERCE_ALL_DELIVERABLE_SETS } from "@/lib/ecommerce/ecommerce-deliverables";
import { ECOMMERCE_SHOT_PRESETS, createEcommerceShotFromPreset } from "@/lib/ecommerce/ecommerce-recipes";
describe("replica", () => {
    test("the never-copy list is a constant that cannot be emptied", () => {
        // 抄画面是侵权，平台有图像指纹稽查——清空它不该是「设置」，是「事故」
        expect(ECOMMERCE_REPLICA_NEVER.length).toBeGreaterThanOrEqual(4);
        expect(ECOMMERCE_REPLICA_NEVER.join(" ")).toContain("品牌标识");
        expect(ECOMMERCE_REPLICA_NEVER.join(" ")).toContain("模特面孔");
        expect(ECOMMERCE_REPLICA_NEVER.join(" ")).toContain("原创文案");
    });

    test("the block states the formula-not-picture rule before anything else", () => {
        const block = ecommerceReplicaBlock(createEcommerceReplica("对标爆款"));
        expect(block).toContain("【复刻参考】");
        // 边界必须立在「复刻强度」前面——模型读到「贴近」会倾向于照抄
        expect(block.indexOf("爆款公式")).toBeLessThan(block.indexOf("复刻维度"));
        expect(block.indexOf("绝对不复刻")).toBeLessThan(block.indexOf("方向："));
        for (const never of ECOMMERCE_REPLICA_NEVER) expect(block).toContain(never);
        expect(block).toContain("复刻维度：构图、布光、配色");
    });

    test("fidelity changes the direction sentence", () => {
        expect(ecommerceReplicaBlock({ ...createEcommerceReplica(), fidelity: "high" })).toContain("结构尽量贴近参考图");
        expect(ecommerceReplicaBlock({ ...createEcommerceReplica(), fidelity: "low" })).toContain("只取参考图的氛围");
    });

    test("no aspects selected means nothing to compile", () => {
        expect(ecommerceReplicaReady({ ...createEcommerceReplica(), aspects: [] })).toBe(false);
        expect(ecommerceReplicaBlock({ ...createEcommerceReplica(), aspects: [] })).toBe("");
    });

    test("extra exclusions append after the hard boundary", () => {
        const block = ecommerceReplicaBlock({ ...createEcommerceReplica(), extraExclude: "参考图里的道具摆法" });
        expect(block).toContain("参考图里的道具摆法");
        expect(block.indexOf("原创文案")).toBeLessThan(block.indexOf("参考图里的道具摆法"));
    });
});
describe("teardown", () => {
    test("the analysis prompt asks for structure and forbids restating the copy", () => {
        const prompt = buildEcommerceTeardownPrompt(createEcommerceTeardown("拆竞品"));
        expect(prompt).toContain("只拆解它的**结构**");
        expect(prompt).toContain("不要复述它的文案");
        // 复述竞品原文会把别人的文案带进我们的提示词
        expect(prompt).toContain("不要抄它的文案原文");
        expect(prompt).toContain("页面结构");
        expect(prompt).toContain("卖点顺序");
    });

    test("only checked dimensions are asked about", () => {
        const prompt = buildEcommerceTeardownPrompt({ ...createEcommerceTeardown("窄拆"), dimensions: ["structure"] });
        expect(prompt).toContain("页面结构");
        expect(prompt).not.toContain("配色体系");
    });

    test("differentiate rows are excluded from the prompt", () => {
        const teardown = {
            ...createEcommerceTeardown("拆竞品"),
            findings: [createEcommerceTeardownFinding("structure", "六屏，首屏是痛点")],
            outline: [
                { ...createEcommerceTeardownOutlineRow("首屏 · 痛点", "说出买家的问题"), stance: "follow" as const },
                { ...createEcommerceTeardownOutlineRow("首屏 · 直接上产品", "不铺垫"), stance: "differentiate" as const },
            ],
        };
        const block = ecommerceTeardownBlock(teardown);
        expect(block).toContain("页面结构：六屏，首屏是痛点");
        expect(block).toContain("1. 首屏 · 痛点");
        // 标了「反着来」的行是刻意要和竞品拉开距离的，写进提示词会把竞品结构又搬回来
        expect(block).not.toContain("直接上产品");
        expect(ecommerceTeardownBlock(createEcommerceTeardown("空"))).toBe("");
        expect(ecommerceTeardownReady(teardown)).toBe(true);
    });
});
describe("the compiler carries the new constraint blocks", () => {
    test("replica and teardown sit between the product lock and the brand style", () => {
        const prompt = compileEcommercePrompt({
            profile: { ...createEcommerceProductProfile("保温杯"), category: "保温杯" },
            replica: createEcommerceReplica("对标爆款"),
            teardown: { ...createEcommerceTeardown("拆竞品"), findings: [createEcommerceTeardownFinding("structure", "六屏")] },
            style: { ...createEcommerceStyle("极简白"), mood: "干净" },
            shotSet: { ...createEcommerceShotSet("单张"), shots: [{ ...createEcommerceShot("主图", "s1"), composition: "居中" }] },
        });
        const order = ["【商品锁定】", "【复刻参考】", "【竞品参考】", "【品牌风格】", "【拍摄方案】"].map((marker) => prompt.indexOf(marker));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // 参照在前、自我在后，模型才不会把参考图的调性当成自己的
        expect(prompt.indexOf("【复刻参考】")).toBeLessThan(prompt.indexOf("【品牌风格】"));
    });
});
describe("the expanded deliverable library", () => {
    test("covers the content, infographic, overseas and video sets the research called out", () => {
        const ids = ECOMMERCE_ALL_DELIVERABLE_SETS.map((set) => set.id);
        expect(ids).toEqual(["main-five", "detail-nine", "model-wearing", "seed-content", "buyer-show", "infographic", "overseas-listing", "main-video", "carousel-video", "full-listing"]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("every slot in every set names a preset that actually exists", () => {
        const known = new Set(ECOMMERCE_SHOT_PRESETS.map((preset) => preset.id));
        for (const set of ECOMMERCE_ALL_DELIVERABLE_SETS) {
            for (const slot of set.slots) {
                expect(known.has(slot.presetId)).toBe(true);
                expect(slot.duty.trim()).not.toBe("");
            }
        }
    });

    test("seed content and buyer show are built for realism, not polish", () => {
        const seed = ECOMMERCE_ALL_DELIVERABLE_SETS.find((set) => set.id === "seed-content")!;
        // 种草图的拍法必须都是「不像拍出来的」
        expect(seed.slots.map((slot) => slot.presetId)).toEqual(["plog-desk", "checkin", "ootd", "macro-material"]);
        for (const presetId of ["plog-desk", "ootd", "checkin", "buyer-show"]) {
            const shot = createEcommerceShotFromPreset(presetId)!;
            // 真实感的关键写在排除项里：影棚感、摆拍痕迹、过度精致
            expect(shot.negative).toMatch(/影棚|棚拍|摆拍|过度精致|精修感/);
        }
    });

    test("the overseas listing follows Amazon's seven-slot order", () => {
        const listing = ECOMMERCE_ALL_DELIVERABLE_SETS.find((set) => set.id === "overseas-listing")!;
        expect(listing.slots).toHaveLength(7);
        // 第 1 位白底主图，第 2 位才是场景
        expect(listing.slots[0].title).toContain("白底主图");
        expect(listing.slots[0].duty).toContain("85%");
        expect(listing.slots[1].title).toContain("生活场景");
        // 信息图那几位的拍法描述的是**完整信息图**（含文字），不是零文字底图——
        // 项目里出图都走提示词，文字由模型按提示词渲染，不再走本地合成
        for (const presetId of ["info-feature", "info-dimension", "info-material", "info-specs"]) {
            const shot = createEcommerceShotFromPreset(presetId)!;
            expect(shot.copyZone).toMatch(/标注|尺寸线|材质名|表格/);
            expect(shot.copyZone).not.toContain("不要出现任何文字");
        }
    });

    test("the infographic set only carries the selling points it needs", () => {
        const set = ECOMMERCE_ALL_DELIVERABLE_SETS.find((item) => item.id === "infographic")!;
        expect(set.extras).toEqual(["sellingPoints"]);
    });
});
