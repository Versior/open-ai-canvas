import { describe, expect, test } from "bun:test";

import { compileEcommercePrompt, createEcommerceCopy, createEcommerceProductProfile, createEcommerceShot, createEcommerceShotSet, createEcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import {
    ECOMMERCE_INFOGRAPHIC_ARCHETYPES,
    createEcommerceInfographic,
    createEcommerceInfographicCallout,
    createEcommerceInfographicTable,
    ecommerceInfographicBlocked,
    ecommerceInfographicBodyFontSize,
    ecommerceInfographicCalloutCount,
    ecommerceInfographicIssues,
    ecommerceInfographicLayout,
    ecommerceInfographicPromptBlock,
    ecommerceInfographicReady,
} from "@/lib/ecommerce/ecommerce-infographic";
import { ECOMMERCE_REPLICA_NEVER, createEcommerceReplica, ecommerceReplicaBlock, ecommerceReplicaReady } from "@/lib/ecommerce/ecommerce-replica";
import { buildEcommerceTeardownPrompt, createEcommerceTeardown, createEcommerceTeardownFinding, createEcommerceTeardownOutlineRow, ecommerceTeardownBlock, ecommerceTeardownReady } from "@/lib/ecommerce/ecommerce-teardown";
import { createEcommerceDelivery, createEcommerceDeliveryTarget, ecommerceDeliveryCsv, ecommerceDeliveryFileName, ecommerceDeliveryManifestName, ecommerceDeliverySummary, ecommerceNextVersion, type EcommerceDeliveryEntry } from "@/lib/ecommerce/ecommerce-delivery";
import { ECOMMERCE_MATERIAL_PLANS, ecommerceCanvasPreset, ecommerceMaterialNodes, ecommerceMaterialPlan } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { ECOMMERCE_ALL_DELIVERABLE_SETS } from "@/lib/ecommerce/ecommerce-deliverables";
import { ECOMMERCE_SHOT_PRESETS, createEcommerceShotFromPreset } from "@/lib/ecommerce/ecommerce-recipes";
import { CanvasNodeType } from "@/types/canvas";

function counter() {
    let n = 0;
    return () => `id-${++n}`;
}

describe("infographic", () => {
    test("a filled callout counts, an empty one does not", () => {
        const info = { ...createEcommerceInfographic("卖点标注"), callouts: [createEcommerceInfographicCallout("保温 12 小时"), createEcommerceInfographicCallout()] };
        expect(ecommerceInfographicCalloutCount(info)).toBe(1);
        expect(ecommerceInfographicReady(info)).toBe(true);
        expect(ecommerceInfographicReady(createEcommerceInfographic("空"))).toBe(false);
    });

    test("more than five callouts is blocked — one image tells one story", () => {
        const callouts = Array.from({ length: 6 }, (_, index) => createEcommerceInfographicCallout(`卖点 ${index + 1}`));
        const issues = ecommerceInfographicIssues({ ...createEcommerceInfographic("超量"), callouts });
        expect(ecommerceInfographicBlocked(issues)).toBe(true);
        expect(issues[0].message).toContain("超过上限 5 条");

        // 五条以内不拦
        expect(ecommerceInfographicBlocked(ecommerceInfographicIssues({ ...createEcommerceInfographic("正好"), callouts: callouts.slice(0, 4) }))).toBe(false);
    });

    test("a single callout is warned, not blocked", () => {
        const issues = ecommerceInfographicIssues({ ...createEcommerceInfographic("只有一条"), callouts: [createEcommerceInfographicCallout("唯一")] });
        expect(issues[0].level).toBe("warn");
        expect(issues[0].message).toContain("只有一条标注");
    });

    test("body text below the mobile-readable floor is warned with the actual number", () => {
        // 2000px 画布上正文 32px 是行业下限
        expect(ecommerceInfographicBodyFontSize(2000)).toBe(32);
        const issues = ecommerceInfographicIssues({ ...createEcommerceInfographic("小字"), callouts: [createEcommerceInfographicCallout("a"), createEcommerceInfographicCallout("b")] }, 1200);
        expect(issues.some((issue) => issue.message.includes("低于手机端可读的 32px"))).toBe(true);
        // 画布够大就不报
        expect(ecommerceInfographicIssues({ ...createEcommerceInfographic("大字"), callouts: [createEcommerceInfographicCallout("a"), createEcommerceInfographicCallout("b")] }, 2000).some((issue) => issue.message.includes("32px"))).toBe(false);
    });

    test("a spec table always asks the user to verify the numbers", () => {
        const table = { ...createEcommerceInfographicTable(), rows: [["容量", "500ml"]] };
        const issues = ecommerceInfographicIssues({ ...createEcommerceInfographic("参数表"), table });
        expect(issues.some((issue) => issue.message.includes("必须来自实测或官方参数"))).toBe(true);
    });

    test("naming a competitor in a comparison table is blocked", () => {
        const table = { ...createEcommerceInfographicTable(), rows: [["对比竞品 A", "更好"]] };
        const issues = ecommerceInfographicIssues({ ...createEcommerceInfographic("对比"), archetype: "comparison", table });
        expect(ecommerceInfographicBlocked(issues)).toBe(true);
        expect(issues.some((issue) => issue.message.includes("不正当竞争"))).toBe(true);
    });

    test("every archetype is named and hinted", () => {
        // 六种常规骨架 + 尺码表。尺码表单独列出来是因为它的约束不一样：
        // 它整张就是表格，不用标注，所以「标注太少」那条对它不适用。
        expect(ECOMMERCE_INFOGRAPHIC_ARCHETYPES.length).toBe(7);
        expect(ECOMMERCE_INFOGRAPHIC_ARCHETYPES.some((archetype) => archetype.id === "sizechart")).toBe(true);
        for (const archetype of ECOMMERCE_INFOGRAPHIC_ARCHETYPES) {
            expect(archetype.name.trim()).not.toBe("");
            expect(archetype.hint.trim()).not.toBe("");
        }
    });

    test("a size chart needs no callouts", () => {
        const issues = ecommerceInfographicIssues({ ...createEcommerceInfographic("尺码表"), archetype: "sizechart" });
        // 尺码表整张就是表格，不该因为它没有标注而报警
        expect(issues.some((issue) => issue.message.includes("只有一条标注"))).toBe(false);
    });

    test("layout keeps every box inside the canvas at any aspect ratio", () => {
        const info = {
            ...createEcommerceInfographic("满配"),
            headline: "保温 12 小时",
            subhead: "304 不锈钢",
            footer: "数据来自第三方检测报告",
            callouts: [
                { ...createEcommerceInfographicCallout("真空层", "双层"), side: "left" as const },
                { ...createEcommerceInfographicCallout("杯口", "食品级"), side: "left" as const },
                { ...createEcommerceInfographicCallout("杯身", "304"), side: "right" as const },
            ],
            table: { ...createEcommerceInfographicTable(), rows: [["容量", "500ml"], ["重量", "320g"]] },
        };
        for (const canvas of [{ width: 1600, height: 1600 }, { width: 1200, height: 1600 }, { width: 1600, height: 900 }]) {
            const layout = ecommerceInfographicLayout(info, canvas);
            const boxes = [layout.headline, layout.subhead, layout.table, layout.footer, ...layout.callouts.map((item) => item.box)].filter(Boolean);
            for (const box of boxes) {
                expect(box!.left).toBeGreaterThanOrEqual(0);
                expect(box!.top).toBeGreaterThanOrEqual(0);
                expect(box!.left + box!.width).toBeLessThanOrEqual(canvas.width + 0.01);
                expect(box!.top + box!.height).toBeLessThanOrEqual(canvas.height + 0.01);
            }
            // 引线端点都落在画布内
            for (const { leader } of layout.callouts) {
                expect(leader.toX).toBeGreaterThanOrEqual(0);
                expect(leader.toX).toBeLessThanOrEqual(canvas.width);
                expect(leader.toY).toBeGreaterThanOrEqual(0);
                expect(leader.toY).toBeLessThanOrEqual(canvas.height);
            }
        }
    });

    test("the prompt block hands the annotation text to the model verbatim", () => {
        const block = ecommerceInfographicPromptBlock({ ...createEcommerceInfographic("卖点标注"), headline: "保温 12 小时", callouts: [createEcommerceInfographicCallout("真空层")] });
        expect(block).toContain("【信息图】");
        // 项目里所有产出都是提示词走 API：标注文字逐字进提示词，交给模型画
        expect(block).toContain("主标题（画面顶部）：「保温 12 小时」");
        expect(block).toContain("- 「真空层」，标注框在画面右侧");
        // 位置用方位词而不是坐标——坐标对模型没有意义
        expect(block).toContain("标注框在画面右侧");
        expect(block).not.toMatch(/\d+%/);
        expect(ecommerceInfographicPromptBlock(createEcommerceInfographic("空"))).toBe("");
    });

    test("the table goes in as a markdown table with a no-rewrite rule", () => {
        const table = { ...createEcommerceInfographicTable(), columns: ["项目", "数值"], rows: [["容量", "500ml"]] };
        const block = ecommerceInfographicPromptBlock({ ...createEcommerceInfographic("参数表"), table });
        expect(block).toContain("| 项目 | 数值 |");
        expect(block).toContain("| 容量 | 500ml |");
        // 参数图最要命的错是模型顺手把 500ml 写成「约 500ml」或自己补一列
        expect(block).toContain("不得改写、四舍五入、补充或增删行列");
    });
});

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

describe("delivery", () => {
    const entry = (overrides: Partial<EcommerceDeliveryEntry> = {}): EcommerceDeliveryEntry => ({
        nodeId: "img-1", title: "主图1", fileName: "A001_主图_01_v1.jpg", width: 1200, height: 1200, issues: [], ...overrides,
    });

    test("summary splits clean / warned / blocked and never double counts", () => {
        const summary = ecommerceDeliverySummary([
            entry(),
            entry({ nodeId: "img-2", issues: [{ level: "warn", scope: "淘宝", message: "文字超了", targetId: "t1" }] }),
            entry({ nodeId: "img-3", issues: [{ level: "block", scope: "淘宝", message: "尺寸不够", targetId: "t1" }] }),
        ]);
        expect(summary).toEqual({ total: 3, clean: 1, warned: 1, blocked: 1 });
    });

    test("the manifest CSV carries a BOM so Excel does not mangle Chinese", () => {
        const csv = ecommerceDeliveryCsv([entry()]);
        // 这一条是交付件能不能用的分水岭
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        expect(csv).toContain("节点,标题,文件名,宽,高,大小KB,校验");
        expect(csv).toContain("A001_主图_01_v1.jpg");
        expect(csv).toContain("通过");
    });

    test("issues are escaped and prefixed by severity", () => {
        const csv = ecommerceDeliveryCsv([entry({ title: '带"引号"的标题', issues: [{ level: "block", scope: "淘宝 · 主图", message: "宽 600 小于最低 800", targetId: "t1" }] })]);
        expect(csv).toContain('"带""引号""的标题"');
        expect(csv).toContain("拦:淘宝 · 主图");
    });

    test("version only increases and never says final", () => {
        expect(ecommerceNextVersion(1)).toBe(2);
        expect(ecommerceNextVersion(0)).toBe(1);
        expect(ecommerceNextVersion(-3)).toBe(1);
        expect(ecommerceDeliveryManifestName({ ...createEcommerceDelivery(), code: "A001", version: 3 })).toBe("A001_交付清单_v3.csv");
        expect(ecommerceDeliveryManifestName(createEcommerceDelivery())).toBe("ITEM_交付清单_v1.csv");
    });

    test("filenames only carry the platform when there is more than one target", () => {
        const target = createEcommerceDeliveryTarget("taobao", "main");
        const single = { ...createEcommerceDelivery(), code: "A001", targets: [target] };
        expect(ecommerceDeliveryFileName(single, target, 1)).toBe("A001_主图_01_v1.jpg");

        const overseas = createEcommerceDeliveryTarget("amazon", "main");
        const multi = { ...createEcommerceDelivery(), code: "A001", targets: [target, overseas] };
        expect(ecommerceDeliveryFileName(multi, target, 1)).toBe("A001_主图_01_taobao_v1.jpg");
        expect(ecommerceDeliveryFileName(multi, overseas, 1)).toBe("A001_MAIN_01_amazon_v1.jpg");
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
        // 每个 id 唯一，且 ecommerceMaterialPlan 找得到
        expect(new Set(ECOMMERCE_MATERIAL_PLANS.map((plan) => plan.id)).size).toBe(ECOMMERCE_MATERIAL_PLANS.length);
        for (const id of ids) expect(ecommerceMaterialPlan(id)).toBeDefined();
    });

    test("video sets grow a video node wired to every shot", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        for (const planId of ["main-video", "carousel-video"]) {
            const { nodes, connections } = ecommerceMaterialNodes(product, ecommerceMaterialPlan(planId)!, counter());
            const video = nodes.find((node) => node.type === CanvasNodeType.EcommerceVideo);
            expect(video).toBeDefined();
            const images = nodes.filter((node) => node.type === CanvasNodeType.Image);
            expect(images.length).toBeGreaterThanOrEqual(4);
            // 这套图就是视频的镜头素材，每一张都要连进成片节点
            for (const image of images) {
                expect(connections.some((connection) => connection.fromNodeId === image.id && connection.toNodeId === video!.id)).toBe(true);
            }
        }
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

    test("a set that ships a delivery node wires every image into it", () => {
        const product = ecommerceCanvasPreset().nodes[0];
        const { nodes, connections } = ecommerceMaterialNodes(product, ecommerceMaterialPlan("overseas-listing")!, counter());
        const delivery = nodes.find((node) => node.type === CanvasNodeType.Delivery)!;
        expect(delivery).toBeDefined();
        const images = nodes.filter((node) => node.type === CanvasNodeType.Image);
        for (const image of images) {
            expect(connections.some((connection) => connection.fromNodeId === image.id && connection.toNodeId === delivery.id)).toBe(true);
        }
        // 小套不铺交付节点——那点量自己看就行
        const light = ecommerceMaterialNodes(product, ecommerceMaterialPlan("single")!, counter());
        expect(light.nodes.some((node) => node.type === CanvasNodeType.Delivery)).toBe(false);
    });
});
