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
    normalizeEcommerceProductName,
    type EcommerceProductProfile,
    type EcommerceShotSet,
} from "@/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_SHOT_PRESETS, ECOMMERCE_STYLE_PRESETS, createEcommerceShotFromPreset, createEcommerceStyleFromPreset, ecommerceShotPreset, ecommerceShotPresetsByGroup } from "@/lib/ecommerce/ecommerce-recipes";

describe("ecommerce creation contract", () => {
    test("new product profiles do not invent a placeholder name", () => {
        expect(createEcommerceProductProfile().name).toBe("");
        expect(createEcommerceProductProfile("  星云随行杯  ").name).toBe("星云随行杯");
        expect(createEcommerceProductProfile("  未命名商品  ").name).toBe("");
        expect(normalizeEcommerceProductName("  星云随行杯  ")).toBe("星云随行杯");
        expect(normalizeEcommerceProductName("  未命名商品  ")).toBe("");
    });

    test("lock block omits the legacy placeholder but preserves a real product name", () => {
        const legacy = { ...createEcommerceProductProfile("未命名商品"), category: "保温杯" };
        const named = { ...legacy, name: "星云随行杯" };

        expect(ecommerceProductLockBlock(legacy)).not.toContain("未命名商品");
        expect(ecommerceProductLockBlock(named)).toContain("产品名称：星云随行杯");
    });

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

    test("lock block preserves the full product identity including its own logo", () => {
        const profile = {
            ...createEcommerceProductProfile("星云随行杯"),
            englishBrandName: "NEBULA",
            chineseBrandName: "星云",
            logoText: '杯身正面白色 "NEBULA" Logo',
            brandStyle: "深蓝银色、几何无衬线字体、金属质感",
            category: "随行杯",
            productModel: "NX-500",
            appearance: "深蓝色圆柱杯身；银色杯盖；侧面硅胶提环",
            marks: "杯底镭雕型号 NX-500",
        };

        const block = ecommerceProductLockBlock(profile);

        expect(block).toContain("中文品牌：星云");
        expect(block).toContain("英文品牌：NEBULA");
        expect(block).toContain('LOGO文字：杯身正面白色 "NEBULA" Logo');
        expect(block).toContain("产品型号：NX-500");
        expect(block).toContain("严格还原参考图中的产品外观、颜色、LOGO、结构和细节");
        expect(block).toContain("商品自带的 Logo、品牌名、包装文字与铭牌必须保持原样");
    });

    test("legacy profiles without structured report fields remain loadable", () => {
        const legacy = {
            name: "旧商品",
            category: "保温杯",
            appearance: "白色杯身",
            marks: "杯身 LOGO",
            forbidden: "",
            audience: "",
            facts: "",
            price: "",
            views: {},
        } as EcommerceProductProfile;

        expect(ecommerceProductLockBlock(legacy)).toContain("外观：白色杯身");
        expect(ecommerceProductReady(legacy)).toBe(true);
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

    test("事实只约束与验证，不得变成图上新增文字", () => {
        const points = [createEcommerceSellingPoint("保温 12 小时", "第三方检测报告")];
        const block = ecommerceSellingPointsBlock(points);
        // 旧措辞是「以下主张可以出现在画面信息里」——那等于给模型发了一张加字许可证。
        expect(block).not.toContain("可以出现在画面");
        expect(block).toContain("不得");
        expect(block).toContain("保温 12 小时（依据：第三方检测报告）");

        // 有确认文案时，文案是图上文字的唯一来源；卖点只用来核对画面说得对不对。
        const detail = compileEcommercePrompt({ copy: { ...createEcommerceCopy(), headline: "通勤一路温热" }, sellingPoints: points });
        expect(detail).toContain("标题：通勤一路温热");
        expect(detail).not.toContain("可以出现在画面");

        // copy 为空时更不能靠事实补字。
        const bare = compileEcommercePrompt({ sellingPoints: points });
        expect(bare).not.toContain("【文案】");
        expect(bare).not.toContain("可以出现在画面");
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
        expect(reserved).toContain("不要自行生成额外文案");
        expect(reserved).not.toContain("逐字准确");
        // 编译器的透传：renderCopyText 必须真的走到文案块，不能只停在类型上
        const profile = { ...createEcommerceProductProfile("杯子"), category: "随行杯", logoText: "杯身正面 NEBULA" };
        const fallbackPrompt = compileEcommercePrompt({ profile, copy, renderCopyText: false });
        expect(fallbackPrompt).toContain("不要自行生成额外文案");
        expect(fallbackPrompt).toContain("商品自身已有的 Logo、品牌名、包装文字和铭牌必须保留");
        expect(fallbackPrompt).not.toContain("无 Logo");
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

    test("七项逐段精确：每项内容与画面段原文逐字相等，绝不串到下一个标签", () => {
        // 上一版用带负向断言的正则取段，会回溯把下一行标签的前半截吞进来
        // （实测 画面构成 = "COMPOSE_MARK；产品摆"）。这条用例把四段钉死在原文上。
        const visualPrompt = [
            "画面构成：COMPOSE_MARK",
            "产品摆放：PLACE_MARK",
            "视觉风格：STYLE_MARK",
            "负面提示词：NEGATIVE_MARK",
        ].join("；\n");
        const prompt = compileEcommercePrompt({
            visualPrompt,
            copy: { headline: "TITLE_MARK", subhead: "SUB_MARK\nSELL_MARK", price: "", cta: "" },
            renderCopyText: true,
        });
        const line = (label: string) => prompt.split("\n").find((item) => item.startsWith(`${label}：`));

        expect(line("画面构成")).toBe("画面构成：COMPOSE_MARK");
        expect(line("产品摆放")).toBe("产品摆放：PLACE_MARK");
        expect(line("视觉风格")).toBe("视觉风格：STYLE_MARK");
        expect(line("负面提示词")).toBe("负面提示词：NEGATIVE_MARK");
        expect(line("主标题")).toBe("主标题：TITLE_MARK");
        expect(line("副标题")).toBe("副标题：SUB_MARK");
        expect(line("卖点模块")).toBe("卖点模块：SELL_MARK");
        // 七项顺序固定：画面 → 摆放 → 文案三项 → 风格 → 负面
        const order = ["画面构成：", "产品摆放：", "主标题：", "副标题：", "卖点模块：", "视觉风格：", "负面提示词："].map((label) => prompt.indexOf(label));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // 文案块与七项各说一遍等于给模型两次改字机会
        expect(prompt).not.toContain("【文案】");
    });

    test("画面段里的营销文字行被剔掉：图上文字只有 copy 一个来源", () => {
        // 老提示词里可能还留着「主标题：…」；合同版本号对、内容没重规划时也不能靠它画字。
        const prompt = compileEcommercePrompt({
            visualPrompt: "画面构成：暖窗光台面\n主标题：模型自己编的标题\n产品摆放：杯子居中",
            copy: undefined,
            renderCopyText: true,
        });
        expect(prompt).not.toContain("模型自己编的标题");
        expect(prompt).toContain("主标题：不生成主标题文字");
        expect(prompt).toContain("画面构成：暖窗光台面");
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
