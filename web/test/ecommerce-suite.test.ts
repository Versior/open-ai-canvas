import { describe, expect, test } from "bun:test";

import { ECOMMERCE_ONE_CLICK_FLOWS, ecommerceOneClickFlow, ecommerceOneClickLayoutPreset, ecommerceOneClickScreens } from "@/lib/ecommerce/ecommerce-oneclick";
import {
    ECOMMERCE_SUITE_DIRECTOR_PROMPT,
    ecommerceSuiteDirectorPrompt,
    ecommerceSuiteDraftPrompt,
    ecommerceSuiteFromPresets,
    ecommerceSuiteMissing,
    ecommerceSuiteReady,
    ecommerceSuiteRows,
    ecommerceSuiteSkeleton,
    reconcileEcommerceSuiteDraftRows,
    parseEcommerceSuiteDraft,
} from "@/lib/ecommerce/ecommerce-suite";
import { ecommerceShotPreset } from "@/lib/ecommerce/ecommerce-recipes";
import { createEcommerceCopy, createEcommerceProductProfile, ecommerceSevenItemBlock } from "@/lib/ecommerce/ecommerce-contract";

describe("四个套图入口", () => {
    test("详情页 / 主图 / 模特上身 / 种草秀，各自对应一套行业标准交付物", () => {
        expect(ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => flow.id)).toEqual(["detail", "main", "wear", "seed"]);
        // 旧画布持久化的是这个 id；十屏升级只改内容，不在没有迁移器时破坏兼容键。
        expect(ecommerceOneClickFlow("detail")?.set.id).toBe("detail-nine");
        expect(ecommerceOneClickFlow("main")?.set.id).toBe("main-five");
        expect(ecommerceOneClickFlow("seed")?.set.id).toBe("seed-content");
        expect(ecommerceOneClickFlow("nope")).toBeUndefined();
    });

    test("详情页默认十屏按商品信息结构起稿，但构图与摆放由商品和平台动态决定", () => {
        const screens = ecommerceOneClickScreens(ecommerceOneClickFlow("detail")!);
        expect(screens).toHaveLength(10);
        expect(screens.map((screen) => screen.title.replace(/^[^·]*·\s*/, ""))).toEqual(["品牌主视觉", "核心卖点一", "核心卖点二", "核心卖点三", "多场景展示", "产品细节", "参数可视化", "适用人群", "品质背书", "购买理由总结"]);
        expect(screens.every((screen) => screen.duty.includes("动态决定画面构成和产品摆放"))).toBe(true);
    });

    test("只有详情页要装订成长图——其余三套是发内容、上架的图，不是长图", () => {
        expect(ecommerceOneClickFlow("detail")?.bind).toBe(true);
        for (const id of ["main", "wear", "seed"]) expect(ecommerceOneClickFlow(id)?.bind).toBe(false);
    });

    test("每张都有槽位、标题、职责、版式、拍法预设、画幅", () => {
        for (const flow of ECOMMERCE_ONE_CLICK_FLOWS) {
            const screens = ecommerceOneClickScreens(flow);
            expect(screens.length).toBeGreaterThan(0);
            for (const screen of screens) {
                expect(screen.slotId.trim()).toBeTruthy();
                expect(screen.title.trim()).toBeTruthy();
                expect(screen.duty.trim()).toBeTruthy();
                expect(screen.layoutPresetId.trim()).toBeTruthy();
                expect(screen.presetId.trim()).toBeTruthy();
                expect(screen.aspectRatio).toMatch(/^\d+:\d+$/);
            }
        }
    });

    test("画幅按平台给：详情 3:4、主图 1:1、上身 3:4、种草 4:5", () => {
        expect(ecommerceOneClickScreens(ecommerceOneClickFlow("detail")!).every((screen) => screen.aspectRatio === "3:4")).toBe(true);
        expect(ecommerceOneClickScreens(ecommerceOneClickFlow("main")!).every((screen) => screen.aspectRatio === "1:1")).toBe(true);
        expect(ecommerceOneClickScreens(ecommerceOneClickFlow("seed")!).every((screen) => screen.aspectRatio === "4:5")).toBe(true);
    });

    test("首屏用海报版式、收尾用压底版式——全用一个版式看起来像同一张复制了十遍", () => {
        expect(ecommerceOneClickLayoutPreset("detail", "detail-1")).toBe("poster");
        expect(ecommerceOneClickLayoutPreset("detail", "detail-10")).toBe("bottom-bar");
        expect(ecommerceOneClickLayoutPreset("detail", "detail-5")).toBe("detail-screen");
        expect(ecommerceOneClickLayoutPreset("seed", "seed-1")).toBe("side-notes");
    });
});
describe("套图表：一张图一条提示词", () => {
    test("缺几条按张数算——从没分析过时缺的是全部，不是零", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const total = ecommerceOneClickScreens(flow).length;
        expect(ecommerceSuiteMissing(undefined, total)).toBe(total);
        expect(ecommerceSuiteReady(undefined)).toBe(false);
    });

    test("按行业套路铺底：每一张都拿到一条非空提示词，而且互不相同", () => {
        // 兜底存在的意义是「分析没跑或跑砸时这一套仍然出得了图」
        for (const flow of ECOMMERCE_ONE_CLICK_FLOWS) {
            const rows = ecommerceSuiteFromPresets(flow);
            expect(rows).toHaveLength(ecommerceOneClickScreens(flow).length);
            for (const row of rows) {
                expect(row.slotId.trim()).toBeTruthy();
                expect(row.duty.trim()).toBeTruthy();
                expect(row.prompt.trim()).toBeTruthy();
            }
            expect(ecommerceSuiteMissing({ flow: flow.id, rows, source: "preset", updatedAt: "" }, rows.length)).toBe(0);
            expect(ecommerceSuiteReady({ flow: flow.id, rows, source: "preset", updatedAt: "" })).toBe(true);
        }
    });

    test("铺底不是把同一句话复制十遍——十屏的职责不同，提示词必须不同", () => {
        const rows = ecommerceSuiteFromPresets(ecommerceOneClickFlow("detail")!);
        expect(new Set(rows.map((row) => row.prompt)).size).toBe(rows.length);
    });

    test("详情页铺底只写画面四段，编译后才是可出图的完整七项", () => {
        const rows = ecommerceSuiteFromPresets(ecommerceOneClickFlow("detail")!);
        for (const row of rows) {
            // 第九段就是画面段：营销三项不在里面，否则文案会绕过 copy 自己长出来。
            for (const field of ["画面构成：", "产品摆放：", "视觉风格：", "负面提示词："]) expect(row.prompt).toContain(field);
            for (const field of ["主标题：", "副标题：", "卖点模块："]) expect(row.prompt).not.toContain(field);
            expect(row.prompt).toContain("严格还原产品外观、颜色、LOGO、结构和细节");
            expect(row.prompt).not.toContain("待补充");
            expect(row.prompt).not.toContain("不生成任何文字");
            expect(row.imagePromptContractVersion).toBe(1);

            // 编译之后才是出图用的七项：画面四段来自这一行，营销三项来自 copy。
            const compiled = ecommerceSevenItemBlock({ visualPrompt: row.prompt, copy: { ...createEcommerceCopy(), headline: "通勤一路温热" } });
            const order = ["画面构成：", "产品摆放：", "主标题：", "副标题：", "卖点模块：", "视觉风格：", "负面提示词："].map((label) => compiled.indexOf(label));
            expect(order.every((index) => index >= 0)).toBe(true);
            expect([...order].sort((a, b) => a - b)).toEqual(order);
            expect(compiled).toContain("主标题：通勤一路温热");
            expect(compiled).not.toContain("待补充");
        }
    });

    test("非详情页入口仍可使用无字底图合同，避免主图平台规则被顺手改坏", () => {
        const rows = ECOMMERCE_ONE_CLICK_FLOWS.filter((flow) => flow.id !== "detail").flatMap(ecommerceSuiteFromPresets);
        expect(rows.some((row) => row.prompt.includes("不生成任何文字"))).toBe(true);
    });

    test("四个入口的拍法预设全部存在——缺一个就会退化成只剩一句职责", () => {
        for (const flow of ECOMMERCE_ONE_CLICK_FLOWS) {
            for (const screen of ecommerceOneClickScreens(flow)) {
                expect(ecommerceShotPreset(screen.presetId)).toBeDefined();
            }
        }
    });

    test("重新分析只接受请求快照里的启用槽位与顺序，并保留跳过行", () => {
        const previous = [
            { slotId: "main-1", title: "旧主图", duty: "旧职责", prompt: "旧主图提示词", resultNodeId: "result-1" },
            { slotId: "main-2", title: "已跳过", duty: "保留职责", prompt: "保留提示词", enabled: false, resultNodeId: "result-2" },
            { slotId: "main-3", title: "旧场景", duty: "旧职责", prompt: "旧场景提示词", resultNodeId: "result-3" },
        ];
        const parsed = [
            { slotId: "main-1", title: "新主图", duty: "新职责 1", prompt: "新提示词 1" },
            { slotId: "main-3", title: "新场景", duty: "新职责 3", prompt: "新提示词 3" },
        ];

        // 结构归用户、内容归模型：启用槽位与顺序照请求快照校验，跳过行原位保留；
        // 屏名与职责是用户核对过的信息结构，重新分析只刷新提示词。
        const reconciled = reconcileEcommerceSuiteDraftRows(previous, parsed)!;
        expect(reconciled.map((row) => row.slotId)).toEqual(["main-1", "main-2", "main-3"]);
        expect(reconciled[1]).toEqual(previous[1]);
        expect(reconciled[0]).toEqual({ ...parsed[0], title: "旧主图", duty: "旧职责", resultNodeId: "result-1" });
        expect(reconciled[2]).toEqual({ ...parsed[1], title: "旧场景", duty: "旧职责", resultNodeId: "result-3" });
    });

    test("未动过的默认骨架采纳模型给的动态主题，改过的屏名与职责仍归用户", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const untouched = ecommerceSuiteSkeleton(flow)[0];
        const edited = { ...ecommerceSuiteSkeleton(flow)[1], title: "我改的屏名", duty: "我改的职责" };
        const generated = { ...ecommerceSuiteSkeleton(flow)[2], prompt: "已经出过图的提示词" };
        const parsed = [
            { slotId: untouched.slotId, title: "通勤保温场景", duty: "用真实通勤痛点开场", prompt: "画面构成：A" },
            { slotId: edited.slotId, title: "模型想改掉的名字", duty: "模型想改掉的职责", prompt: "画面构成：B" },
            { slotId: generated.slotId, title: "模型想改掉的名字", duty: "模型想改掉的职责", prompt: "画面构成：C" },
        ];

        const reconciled = reconcileEcommerceSuiteDraftRows([untouched, edited, generated], parsed)!;
        // 默认骨架 + 空提示词 = 用户还没表态，主题听模型的
        expect(reconciled[0].title).toBe("通勤保温场景");
        expect(reconciled[0].duty).toBe("用真实通勤痛点开场");
        expect(reconciled[0].prompt).toBe("画面构成：A");
        // 用户亲手改过的结构不动，只刷新内容
        expect(reconciled[1].title).toBe("我改的屏名");
        expect(reconciled[1].duty).toBe("我改的职责");
        expect(reconciled[1].prompt).toBe("画面构成：B");
        // 已经有提示词的行是完成品，主题不再跟着模型漂
        expect(reconciled[2].title).toBe(generated.title);
        expect(reconciled[2].duty).toBe(generated.duty);
        expect(reconciled[2].prompt).toBe("画面构成：C");
    });

    test("旧四段或两段分析结果不会清空用户已经编辑的文案与版式", () => {
        const flow = ecommerceOneClickFlow("main")!;
        const previous = parseEcommerceSuiteDraft("main-1 | 旧标题 | 旧职责 | 用户标题 | 用户副文案 | ¥199 | 立即购买 | poster | 旧底图提示词", flow)![0];

        for (const legacy of [parseEcommerceSuiteDraft("main-1 | 新标题 | 新职责 | 新底图提示词", flow)![0], parseEcommerceSuiteDraft("main-1 | 新底图提示词", flow)![0]]) {
            const reconciled = reconcileEcommerceSuiteDraftRows([previous], [legacy]);
            expect(reconciled?.[0].copy).toEqual(previous.copy);
            expect(reconciled?.[0].layout).toEqual(previous.layout);
        }
    });

    test("模型漏行、换序或改槽位时拒绝整份结果，不能据此删掉用户屏次", () => {
        const previous = [
            { slotId: "main-1", title: "主图", duty: "旧职责", prompt: "旧提示词" },
            { slotId: "main-2", title: "跳过", duty: "保留", prompt: "保留", enabled: false },
            { slotId: "main-3", title: "场景", duty: "旧职责", prompt: "旧提示词" },
        ];
        const row = (slotId: string) => ({ slotId, title: "新标题", duty: "新职责", prompt: "新提示词" });

        expect(reconcileEcommerceSuiteDraftRows(previous, [row("main-1")])).toBeUndefined();
        expect(reconcileEcommerceSuiteDraftRows(previous, [row("main-3"), row("main-1")])).toBeUndefined();
        expect(reconcileEcommerceSuiteDraftRows(previous, [row("main-1"), row("main-new")])).toBeUndefined();
        expect(reconcileEcommerceSuiteDraftRows(previous, [row("main-1"), row("main-2"), row("main-3")])).toBeUndefined();
    });
});
describe("分析结果的解析", () => {
    const flow = () => ecommerceOneClickFlow("detail")!;

    test("九段合同保留 copy/layout，并把七类详情字段完整收进最后 Prompt", () => {
        const completePrompt = "画面构成：3:4 竖版暖窗光 | 产品摆放：商品居中 | 主标题：通勤一路温热 | 副标题：真空杯体，随手带走 | 卖点模块：杯盖提手 | 视觉风格：暖色商业详情页 | 负面提示词：错色、LOGO 错误";
        const parsed = parseEcommerceSuiteDraft(`detail-1 | 痛点共情 | 说出买家正在遇到的问题 | 通勤一路温热 | 真空杯体，随手带走 | | 立即了解 | poster | ${completePrompt}`, flow());

        expect(parsed).toHaveLength(1);
        expect(parsed![0].copy).toEqual({ headline: "通勤一路温热", subhead: "真空杯体，随手带走", price: "", cta: "立即了解" });
        expect(parsed![0].layout?.name).toBe("海报居中");
        expect(parsed![0].prompt).toBe(completePrompt);
        expect(reconcileEcommerceSuiteDraftRows([{ ...ecommerceSuiteSkeleton(flow())[0], resultNodeId: "result-1" }], parsed!)).toEqual([{ ...parsed![0], resultNodeId: "result-1" }]);
    });

    test("中文和下划线未知版式不会降级成旧四段提示词", () => {
        for (const [price, unknownPreset] of [
            ["¥199", "未知版式"],
            ["", "custom_layout"],
        ]) {
            expect(parseEcommerceSuiteDraft(`detail-1 | 标题 | 职责 | 主标题 | 副文案 | ${price} | 去看看 | ${unknownPreset} | 无字底图`, flow())).toBeUndefined();
        }
    });

    test("四段一行：槽位 | 标题 | 职责 | 完整提示词", () => {
        const parsed = parseEcommerceSuiteDraft("detail-1 | 痛点共情 | 说出买家正在遇到的问题 | 商品居中摆放在纯白背景，45 度俯拍，柔光箱从左前方打光，右上角一行字「12 小时还热着」", flow());
        expect(parsed).toHaveLength(1);
        expect(parsed![0].slotId).toBe("detail-1");
        expect(parsed![0].title).toBe("痛点共情");
        expect(parsed![0].duty).toBe("说出买家正在遇到的问题");
        expect(parsed![0].prompt).toContain("12 小时还热着");
    });

    test("旧四段提示词即使含五个以上竖线也按旧格式完整保留", () => {
        const prompt = "商品居中 | 45 度俯拍 | 左前柔光 | 暖灰背景 | 右侧留白 | 景深自然";
        const parsed = parseEcommerceSuiteDraft(`detail-1 | 痛点共情 | 说出问题 | ${prompt}`, flow());

        expect(parsed).toHaveLength(1);
        expect(parsed![0].prompt).toBe(prompt);
        expect(parsed![0].copy).toBeUndefined();
        expect(parsed![0].layout).toBeUndefined();
    });

    test("旧的两段格式也吃——用户手里那套自定义提示词可能还在用", () => {
        const parsed = parseEcommerceSuiteDraft("detail-1 | 商品居中，纯白背景，正面平视", flow());
        expect(parsed).toHaveLength(1);
        expect(parsed![0].prompt).toBe("商品居中，纯白背景，正面平视");
        // 标题与职责退回行业套路给的那一份
        expect(parsed![0].title).toBe("品牌主视觉");
        expect(parsed![0].duty.trim()).toBeTruthy();
    });

    test("解析器可读任意行数，结构契约由合并阶段校验", () => {
        const six = ["痛点", "卖点", "场景", "细节", "参数", "售后"].map((name, index) => `detail-${index + 1} | ${name} | 这一屏解决${name} | 提示词${index + 1}`).join("\n");
        const parsed = parseEcommerceSuiteDraft(six, flow());
        expect(parsed).toHaveLength(6);
        expect(parsed!.map((row) => row.title)).toEqual(["痛点", "卖点", "场景", "细节", "参数", "售后"]);
    });

    test("容忍模型的坏习惯：序号、全角竖线、代码块、加粗、结尾的职责说明", () => {
        const messy = ["```", "1. detail-1｜**痛点共情**｜说出问题｜**商品居中，纯白背景，正面平视**", "- detail-2 | 场景代入 | 有生活痕迹 | 模特手持商品走在街上，侧逆光，中景", "以上是九屏提示词，请核对。", "这条不是屏次 | 也不该进表 | 更不该出图"].join(
            "\n",
        );
        const parsed = parseEcommerceSuiteDraft(messy, flow());
        expect(parsed!.map((row) => row.slotId)).toEqual(["detail-1", "detail-2"]);
        expect(parsed![0].title).toBe("痛点共情");
        expect(parsed![0].prompt).toBe("商品居中，纯白背景，正面平视");
        expect(parsed![1].prompt).toBe("模特手持商品走在街上，侧逆光，中景");
    });

    test("提示词里本来就有竖线时不会被切碎", () => {
        const parsed = parseEcommerceSuiteDraft("detail-1 | 三分构图 | 画面感 | 左三分构图 | 商品在右，文字在左", flow());
        expect(parsed![0].prompt).toBe("左三分构图 | 商品在右，文字在左");
    });

    test("详情页分析提示词完整序列化商品识别报告字段", () => {
        const profile = {
            ...createEcommerceProductProfile("随行杯"),
            englishBrandName: "THERMO",
            chineseBrandName: "暖行",
            logoText: "THERMO，杯身正面",
            brandStyle: "无衬线字体；薄荷绿配色；磨砂材质感",
            category: "保温杯",
            productModel: "T500",
            appearance: "薄荷绿杯身",
            functions: "保温；便携",
            parameters: [
                { name: "容量", value: "500 mL", source: "包装正面" },
                { name: "材质", value: "304 不锈钢", source: "杯底铭牌" },
            ],
            sellingPoints: [
                { type: "功能卖点" as const, content: "长效保温", visualization: "温度时间轴" },
                { type: "体验卖点" as const, content: "单手开盖", visualization: "通勤手持" },
                { type: "设计卖点" as const, content: "提手杯盖", visualization: "结构特写" },
                { type: "场景卖点" as const, content: "办公室与通勤", visualization: "双场景切换" },
                { type: "人群卖点" as const, content: "适合上班族", visualization: "人物使用" },
            ],
            audience: "通勤上班族",
            painPoints: "普通杯具携带不便",
            purchaseReasons: "有提手且容量清晰",
            detailPageSuggestions: [{ screen: "第1屏", theme: "品牌主视觉", visual: "商品居中，薄荷绿背景", copy: "轻装随行" }],
        };
        const prompt = ecommerceSuiteDraftPrompt(flow(), profile, ecommerceSuiteSkeleton(flow()));

        for (const expected of [
            "英文品牌名：THERMO",
            "中文品牌名：暖行",
            "LOGO文字：THERMO，杯身正面",
            "品牌视觉风格：无衬线字体；薄荷绿配色；磨砂材质感",
            "产品型号：T500",
            "主要功能：保温；便携",
            "容量：500 mL（来源：包装正面）",
            "材质：304 不锈钢（来源：杯底铭牌）",
            "功能卖点：长效保温（可视化：温度时间轴）",
            "体验卖点：单手开盖（可视化：通勤手持）",
            "设计卖点：提手杯盖（可视化：结构特写）",
            "场景卖点：办公室与通勤（可视化：双场景切换）",
            "人群卖点：适合上班族（可视化：人物使用）",
            "使用痛点：普通杯具携带不便",
            "购买理由：有提手且容量清晰",
            "第1屏 | 品牌主视觉 | 商品居中，薄荷绿背景 | 轻装随行",
        ]) {
            expect(prompt).toContain(expected);
        }
    });

    test("详情页规划忽略历史占位商品名但保留真实商品名", () => {
        const legacy = { ...createEcommerceProductProfile("未命名商品"), category: "保温杯" };
        const rows = ecommerceSuiteSkeleton(flow());

        expect(ecommerceSuiteDraftPrompt(flow(), legacy, rows)).not.toContain("未命名商品");
        expect(ecommerceSuiteDraftPrompt(flow(), { ...legacy, name: "星云随行杯" }, rows)).toContain("商品名：星云随行杯");
    });

    test("详情页导演要求文案与画面一次生图，同时保留独立字段作为本地排版回退", () => {
        const prompt = ecommerceSuiteDraftPrompt(flow(), undefined, ecommerceSuiteSkeleton(flow()));
        expect(prompt).toContain("完整生图提示词");
        for (const field of ["画面构成", "产品摆放", "主标题", "副标题", "卖点模块", "视觉风格", "负面提示词"]) expect(prompt).toContain(field);
        expect(prompt).toContain("严格还原产品外观、颜色、LOGO、结构和细节");
        expect(prompt).toContain("待补充");
        expect(prompt).toContain("一起交给图片模型");
        expect(prompt).toContain("本地编辑和排版回退");
        expect(prompt).not.toContain("无字底图提示词");
    });

    test("模型写解释的那几行不会当成屏次——id 不是短标识符就跳过", () => {
        const parsed = parseEcommerceSuiteDraft("以下是九屏提示词，请核对 | 这条不是屏次 | 也不该进表 | 更不该出图", flow());
        expect(parsed).toBeUndefined();
    });

    test("解析不出任何一行时返回 undefined，调用方据此退回拍法预设", () => {
        expect(parseEcommerceSuiteDraft("模型今天不想干活。", flow())).toBeUndefined();
        expect(parseEcommerceSuiteDraft("", flow())).toBeUndefined();
    });
});
describe("整组统一与结构可调", () => {
    test("模型必须照请求快照返回槽位；改屏数先改表格或计划张数", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteRows(flow, undefined));
        expect(prompt).toContain("不得增删、换序或改槽位 id");
        expect(prompt).toContain("调整屏数必须先由用户修改表格或计划张数");
        expect(prompt).not.toContain("你返回几行，这一套就是几行");
        // 表里的屏次与职责进了提示词，模型知道现在是怎么分的
        expect(prompt).toContain("【这一套现在按这几屏走】");
    });

    test("详情页只注入详情或辅图平台规则，主图规则不会冲突", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const rows = ecommerceSuiteRows(flow, undefined);
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, rows, undefined, {
            platformId: "amazon",
            languageId: "en",
            style: { name: "极简白", palette: ["#FFFFFF", "#1A1A1A"], tone: "中性白", mood: "干净克制", typography: "无衬线，字重对比强" },
            styleReferenceName: "参考图A",
        });
        expect(prompt).toContain("第 2–9 位放场景、卖点、尺寸、细节、对比、包装");
        expect(prompt).not.toContain("纯白 RGB(255,255,255)");
        expect(prompt).not.toContain("主图文字");
        expect(prompt).toContain("【图上文字的语言】");
        expect(prompt).toContain("一律用英文");
        expect(prompt).toContain("【色彩美学】极简白");
        expect(prompt).toContain("#FFFFFF");
        expect(prompt).toContain("【字体风格】无衬线，字重对比强");
        // 参考图要说清是哪一张：那几张图本来就都送进模型了
        expect(prompt).toContain("「参考图A」");
        expect(prompt).toContain("不要复刻它的构图、商品和文字");
    });

    test("主图、种草和上身流程各自选择匹配的平台角色规则", () => {
        const prompt = (flowId: "main" | "seed" | "wear", platformId: "amazon" | "xiaohongshu") => {
            const flow = ecommerceOneClickFlow(flowId)!;
            return ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteRows(flow, undefined), undefined, { platformId });
        };

        const main = prompt("main", "amazon");
        expect(main).toContain("纯白 RGB(255,255,255)");
        expect(main).not.toContain("第 2–9 位放场景、卖点、尺寸、细节、对比、包装");

        const seedWithCover = prompt("seed", "xiaohongshu");
        expect(seedWithCover).toContain("1242×1660，文字面积 ≤30%");
        expect(seedWithCover).not.toContain("商品核心信息避开封面底部 15%");

        const seedWithoutCover = prompt("seed", "amazon");
        expect(seedWithoutCover).toContain("纯白 RGB(255,255,255)");
        expect(seedWithoutCover).not.toContain("第 2–9 位放场景、卖点、尺寸、细节、对比、包装");

        const wear = prompt("wear", "amazon");
        expect(wear).toContain("第 2–9 位放场景、卖点、尺寸、细节、对比、包装");
        expect(wear).not.toContain("纯白 RGB(255,255,255)");
    });

    test("没设任何整组统一时不往提示词里塞空段", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const bare = ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteRows(flow, undefined), undefined, {});
        expect(bare).not.toContain("【投放平台】");
        expect(bare).not.toContain("【色彩美学】");
        expect(bare).not.toContain("【风格参考图】");
    });

    test("整组提示词与独立视觉参考进入分析，不套固定色板", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteRows(flow, undefined), undefined, {
            prompt: "参考暖窗光，商品原色不变",
            styleReferenceNames: ["窗边视觉参考"],
        });
        expect(prompt).toContain("参考暖窗光，商品原色不变");
        expect(prompt).toContain("窗边视觉参考");
        expect(prompt).not.toContain("【色彩美学】");
        expect(prompt).not.toContain("【字体风格】");
    });
});
describe("分析指令：默认导演提示词与可改范围", () => {
    test("详情页分析提示词按商品与平台动态规划完整画面，不复制固定构图", () => {
        const prompt = ecommerceSuiteDraftPrompt(ecommerceOneClickFlow("detail")!, undefined, ecommerceSuiteRows(ecommerceOneClickFlow("detail")!, undefined));
        expect(prompt).toContain("根据商品形态、投放平台、已确认事实和本屏主题动态决定");
        expect(prompt).toContain("不得把同一构图复制到十屏");
        expect(prompt).toContain("不要把同一套描述复制到每一张");
        expect(prompt).toContain("只学习参考图的信息层级、氛围和排版逻辑");
    });

    test("「怎么写」可以改，「写哪些」改不掉", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const screens = ecommerceOneClickScreens(flow);
        const mine = "按我店里那套写法来：一件商品只讲一个卖点，画面里不许出现人手。";
        const prompt = ecommerceSuiteDraftPrompt(flow, { ...createEcommerceProductProfile("保温杯"), category: "杯具", facts: "保温 12 小时" }, screens, mine);
        // 用户那一段原样在，默认那一段不在
        expect(prompt).toContain(mine);
        expect(prompt).not.toContain("你是电商出图导演");
        // 商品事实、屏次清单、输出格式仍然由系统追加——少了它们，
        // 自定义的提示词会产出解析不了的东西，而用户不会觉得是自己少写了格式
        expect(prompt).toContain("【商品事实】");
        expect(prompt).toContain("保温 12 小时");
        for (const screen of screens) {
            expect(prompt).toContain(screen.slotId);
            expect(prompt).toContain(screen.duty);
        }
        expect(prompt).toContain("【输出格式】每行一条，九段竖线分隔");
    });

    test("空串代表没改过——回到默认那一份", () => {
        const flow = ecommerceOneClickFlow("main")!;
        const screens = ecommerceOneClickScreens(flow);
        const rows = ecommerceSuiteRows(flow, undefined);
        const byDefault = ecommerceSuiteDraftPrompt(flow, undefined, rows);
        for (const empty of ["", "   ", undefined]) {
            expect(ecommerceSuiteDraftPrompt(flow, undefined, rows, empty)).toBe(byDefault);
        }
        expect(ecommerceSuiteDirectorPrompt("")).toBe(ECOMMERCE_SUITE_DIRECTOR_PROMPT);
        expect(ecommerceSuiteDirectorPrompt("   ")).toBe(ECOMMERCE_SUITE_DIRECTOR_PROMPT);
        expect(ecommerceSuiteDirectorPrompt("我的写法")).toBe("我的写法");
    });

    test("four ecommerce flows have distinct default director prompts", () => {
        const prompts = ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => ecommerceSuiteDirectorPrompt(undefined, flow));
        expect(new Set(prompts).size).toBe(ECOMMERCE_ONE_CLICK_FLOWS.length);
        expect(prompts[1]).toContain("搜索列表");
        expect(prompts[2]).toContain("穿着");
        expect(prompts[3]).toContain("内容平台");
    });
});
