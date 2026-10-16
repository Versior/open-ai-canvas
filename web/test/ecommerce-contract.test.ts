import { describe, expect, test } from "bun:test";

import {
    compileEcommercePrompt,
    createEcommerceCopy,
    createEcommerceProductProfile,
    createEcommerceSellingPoint,
    createEcommerceShot,
    createEcommerceShotSet,
    createEcommerceStyle,
    ecommerceCopyBlock,
    ecommerceCopyReady,
    ecommerceProductLockBlock,
    ecommerceProductReady,
    ecommerceProductViewCount,
    ecommerceSellingPointsBlock,
    ecommerceShotSetBlock,
    ecommerceShotSetReady,
    ecommerceStyleBlock,
    ecommerceStyleReady,
    type EcommerceShotSet,
} from "@/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_SHOT_PRESETS, ECOMMERCE_STYLE_PRESETS, createEcommerceShotFromPreset, createEcommerceStyleFromPreset, ecommerceShotPreset, ecommerceShotPresetsByGroup } from "@/lib/ecommerce/ecommerce-recipes";

describe("ecommerce creation contract", () => {
    test("lock block enumerates only the confirmed facts", () => {
        const profile = { ...createEcommerceProductProfile("保温杯"), category: "保温杯", appearance: "哑光黑，304不锈钢，磨砂质感", marks: '杯身中部银色 Logo "THERMO"' };
        const block = ecommerceProductLockBlock(profile);

        expect(block).toContain("【商品锁定】");
        expect(block).toContain("品类：保温杯");
        expect(block).toContain("外观：哑光黑，304不锈钢，磨砂质感");
        expect(block).toContain('标识：杯身中部银色 Logo "THERMO"');
        expect(block).toContain("商品必须是参考图中的同一件实物");
        // 没填的禁止项不该冒出空标题，空标题会被模型当成待填的自由项
        expect(block).not.toContain("禁止：");
    });

    test("an empty profile yields no lock block at all", () => {
        expect(ecommerceProductLockBlock(createEcommerceProductProfile("空"))).toBe("");
        expect(ecommerceProductLockBlock(undefined)).toBe("");
        expect(ecommerceProductReady(createEcommerceProductProfile("空"))).toBe(false);
    });

    test("a profile counts as ready once it carries category or appearance", () => {
        expect(ecommerceProductReady({ ...createEcommerceProductProfile("x"), category: "保温杯" })).toBe(true);
        expect(ecommerceProductReady({ ...createEcommerceProductProfile("x"), appearance: "哑光黑" })).toBe(true);
        // 只有名字不算——名字不进提示词
        expect(ecommerceProductReady({ ...createEcommerceProductProfile("只有名字"), name: "只有名字" })).toBe(false);
    });

    test("view coverage drives the completeness hint", () => {
        const profile = { ...createEcommerceProductProfile("x"), views: { front: "node-1", detail: "node-2" } };
        expect(ecommerceProductViewCount(profile)).toBe(2);
        expect(ecommerceProductViewCount(undefined)).toBe(0);
    });

    test("shot block labels every filled field and skips the rest", () => {
        const set = { ...createEcommerceShotSet("白底棚拍"), shots: [{ ...createEcommerceShot("白底棚拍", "main-1"), purpose: "电商主图", composition: "商品完整入画", lens: "85mm" }] };
        const block = ecommerceShotSetBlock(set);

        expect(block).toContain("【拍摄方案】白底棚拍");
        expect(block).toContain("本张（白底棚拍）：用途：电商主图");
        expect(block).toContain("镜头：85mm");
        expect(block).not.toContain("光线：");
        expect(ecommerceShotSetReady(set)).toBe(true);
        expect(ecommerceShotSetReady(createEcommerceShotSet("空"))).toBe(false);
    });

    test("a multi-shot list expands only the row this image claimed", () => {
        const set: EcommerceShotSet = {
            ...createEcommerceShotSet("主图 5 张"),
            global: "整组保持同一布光基调",
            shots: [
                { ...createEcommerceShot("主图1 · 核心展示", "main-1"), composition: "居中，主体占七成" },
                { ...createEcommerceShot("主图3 · 场景使用", "main-3"), composition: "家居环境，商品在视觉重心" },
            ],
        };
        const first = ecommerceShotSetBlock(set, "main-1");
        expect(first).toContain("整组统一：整组保持同一布光基调");
        expect(first).toContain("本张（主图1 · 核心展示）：构图：居中，主体占七成");
        // 把五行要求全塞进一次生成，模型会试图在一张图里同时做到五件事
        expect(first).not.toContain("场景使用");

        // 清单多行又没指定行号时只输出整组统一——与其猜，不如不猜
        const unclaimed = ecommerceShotSetBlock(set);
        expect(unclaimed).toContain("整组统一");
        expect(unclaimed).not.toContain("本张");

        // 只有一行的清单不指定行号也能展开——单张主图走的就是这条路
        expect(ecommerceShotSetBlock({ ...createEcommerceShotSet("单张"), shots: [{ ...createEcommerceShot("主图", "single-1"), composition: "居中" }] })).toContain("本张（主图）");
        expect(ecommerceShotSetBlock(undefined)).toBe("");
    });

    test("compiled prompt orders blocks from hard constraints to soft direction", () => {
        const profile = { ...createEcommerceProductProfile("保温杯"), category: "保温杯", appearance: "哑光黑" };
        const shotSet = { ...createEcommerceShotSet("白底棚拍"), shots: [{ ...createEcommerceShot("白底棚拍", "main-1"), composition: "居中构图", background: "纯白背景" }] };
        const style = { ...createEcommerceStyle("极简白"), palette: ["#FFFFFF", "#1A1A1A"], mood: "干净克制" };
        const points = [createEcommerceSellingPoint("保温 12 小时", "第三方检测报告"), createEcommerceSellingPoint("容量 500ml", "")];
        const copy = { ...createEcommerceCopy(), headline: "一次装够一天的水", price: "¥ 199" };

        const prompt = compileEcommercePrompt({ profile, shotSet, style, sellingPoints: points, copy });

        const order = ["【商品锁定】", "【品牌风格】", "【商品卖点】", "【文案】", "【拍摄方案】"].map((marker) => prompt.indexOf(marker));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(prompt).toContain("品类：保温杯");
        expect(prompt).toContain("品牌色板：#FFFFFF、#1A1A1A");
        expect(prompt).toContain("保温 12 小时（依据：第三方检测报告）");
        expect(prompt).toContain("容量 500ml（尚未提供依据");
        expect(prompt).toContain("标题：一次装够一天的水");
        expect(prompt).toContain("背景：纯白背景");
    });

    test("an empty source set compiles to nothing", () => {
        expect(compileEcommercePrompt({})).toBe("");
        expect(compileEcommercePrompt({ profile: createEcommerceProductProfile("空"), shotSet: createEcommerceShotSet("空"), sellingPoints: [], copy: createEcommerceCopy(), style: createEcommerceStyle("空") })).toBe("");
    });

    test("each source can stand alone", () => {
        const profile = { ...createEcommerceProductProfile("x"), category: "保温杯" };
        const shotSet = { ...createEcommerceShotSet("白底棚拍"), shots: [{ ...createEcommerceShot("白底棚拍", "s1"), composition: "居中" }] };
        expect(compileEcommercePrompt({ profile })).toContain("【商品锁定】");
        expect(compileEcommercePrompt({ shotSet })).toContain("【拍摄方案】");
        expect(compileEcommercePrompt({ sellingPoints: [createEcommerceSellingPoint("保温", "")] })).toContain("【商品卖点】");
        expect(compileEcommercePrompt({ copy: { ...createEcommerceCopy(), cta: "立即购买" } })).toContain("【文案】");
        expect(compileEcommercePrompt({ style: { ...createEcommerceStyle("极简白"), tone: "中性白" } })).toContain("【品牌风格】");
    });

    test("copy block hands the text to the model by default", () => {
        // 电商画布的默认是「图片和文字一起交给模型」——一条提示词画完，不做二次合成。
        const block = ecommerceCopyBlock({ ...createEcommerceCopy(), headline: "标题", price: "¥ 199" });
        expect(block).toContain("逐字准确");
        expect(block).toContain("价格：¥ 199");
        expect(ecommerceCopyReady(createEcommerceCopy())).toBe(false);
        expect(ecommerceCopyReady({ ...createEcommerceCopy(), cta: "立即购买" })).toBe(true);
    });

    test("renderCopyText: false 只在文字错不起时用，让模型只留位", () => {
        // 价格、参数、认证编号错一个字就是事故，那时改走本地按像素合成，模型不画字。
        const copy = { ...createEcommerceCopy(), headline: "标题", cta: "立即购买" };
        const reserved = ecommerceCopyBlock(copy, false);
        expect(reserved).toContain("不要自行生成任何文字");
        expect(reserved).not.toContain("逐字准确");
        // 编译器的透传：renderCopyText 必须真的走到文案块，不能只停在类型上
        expect(compileEcommercePrompt({ copy, renderCopyText: false })).toContain("不要自行生成任何文字");
        expect(compileEcommercePrompt({ copy })).toContain("逐字准确");
        // 空文案在两种模式下都不该产出块，否则模型会以为有个待填的空标题
        expect(ecommerceCopyBlock(createEcommerceCopy(), false)).toBe("");
    });

    test("每一屏的文字不再走单独的文案通道——它写在那一张自己的提示词里", () => {
        // 一键流程按屏写的文字现在编译进那一张的完整提示词（见 ecommerce-suite.ts），
        // 编译链只负责约束块（商品锁定 / 模特锁定 / 拍法），提示词由节点自己带。
        // 因此这里只剩一条覆盖链：这一屏自己的文案 → 独立文案节点的文案。
        expect(compileEcommercePrompt({ copy: { ...createEcommerceCopy(), headline: "通用" }, shotId: "detail-2" })).toContain("通用");
        expect(compileEcommercePrompt({ shotId: "detail-1" })).toBe("");
    });

    test("selling points without evidence are flagged instead of silently trusted", () => {
        const block = ecommerceSellingPointsBlock([createEcommerceSellingPoint("续航 48 小时", ""), createEcommerceSellingPoint("", "有依据但没写卖点")]);
        expect(block).toContain("尚未提供依据");
        expect(block).toContain("不得编造未列出的卖点");
        // 只有依据没有主张的条目不是卖点，不该出现
        expect(block).not.toContain("有依据但没写卖点");
        expect(ecommerceSellingPointsBlock([])).toBe("");
        expect(ecommerceSellingPointsBlock(undefined)).toBe("");
    });

    test("style block carries the palette verbatim and can stand on tone alone", () => {
        const block = ecommerceStyleBlock({ ...createEcommerceStyle("科技冷感"), palette: ["#0A1628", "#4FA3D1"], typography: "几何无衬线" });
        expect(block).toContain("【品牌风格】科技冷感");
        expect(block).toContain("品牌色板：#0A1628、#4FA3D1");
        expect(block).toContain("字体气质：几何无衬线");
        expect(ecommerceStyleBlock({ ...createEcommerceStyle("只有色调"), tone: "冷调" })).toContain("色调：冷调");
        expect(ecommerceStyleReady(createEcommerceStyle("空"))).toBe(false);
    });

    test("every shot preset is a complete shot that names itself", () => {
        expect(ECOMMERCE_SHOT_PRESETS.length).toBeGreaterThanOrEqual(20);
        for (const preset of ECOMMERCE_SHOT_PRESETS) {
            const shot = createEcommerceShotFromPreset(preset.id);
            expect(shot).toBeDefined();
            expect(shot!.title).toBe(preset.name);
            expect(ecommerceShotSetReady({ ...createEcommerceShotSet(preset.name), shots: [shot!] })).toBe(true);
            expect(shot!.purpose.trim()).not.toBe("");
            expect(preset.group.trim()).not.toBe("");
            expect(preset.hint.trim()).not.toBe("");
            expect(ecommerceShotPreset(preset.id)).toBe(preset);
        }
        expect(createEcommerceShotFromPreset("不存在")).toBeUndefined();
    });

    test("shot preset ids are unique and every group is represented", () => {
        const ids = ECOMMERCE_SHOT_PRESETS.map((preset) => preset.id);
        expect(new Set(ids).size).toBe(ids.length);
        const grouped = ecommerceShotPresetsByGroup();
        expect(grouped.length).toBeGreaterThanOrEqual(5);
        expect(grouped.reduce((total, entry) => total + entry.presets.length, 0)).toBe(ECOMMERCE_SHOT_PRESETS.length);
    });

    test("every style preset carries a usable palette and names itself", () => {
        expect(ECOMMERCE_STYLE_PRESETS.length).toBeGreaterThanOrEqual(6);
        for (const preset of ECOMMERCE_STYLE_PRESETS) {
            const style = createEcommerceStyleFromPreset(preset.id);
            expect(style).toBeDefined();
            expect(ecommerceStyleReady(style)).toBe(true);
            expect(style!.palette.length).toBeGreaterThanOrEqual(3);
            for (const color of style!.palette) expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
        expect(createEcommerceStyleFromPreset("不存在")).toBeUndefined();
    });

    test("presets never leak product appearance into the shot plan", () => {
        const appearanceWords = ["颜色", "材质", "图案", "Logo"];
        for (const preset of ECOMMERCE_SHOT_PRESETS) {
            const text = Object.values(preset.shot).join(" ");
            for (const word of appearanceWords) {
                expect(text).not.toContain(`商品${word}`);
            }
        }
    });
});
