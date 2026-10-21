import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ECOMMERCE_ONE_CLICK_FLOWS, ecommerceOneClickFlow, ecommerceOneClickLayoutPreset, ecommerceOneClickScreens } from "@/lib/ecommerce/ecommerce-oneclick";
import {
    ECOMMERCE_SUITE_DIRECTOR_PROMPT,
    ecommerceSuiteDirectorPrompt,
    ecommerceSuiteDraftPrompt,
    ecommerceSuiteFromPresets,
    ecommerceSuiteMissing,
    ecommerceSuiteReady,
    ecommerceSuiteRowId,
    ecommerceSuiteRows,
    ecommerceSuiteSkeleton,
    parseEcommerceSuiteDraft,
} from "@/lib/ecommerce/ecommerce-suite";
import { ecommerceShotPreset } from "@/lib/ecommerce/ecommerce-recipes";
import { ecommerceSuiteNodes, ecommerceSuiteTargets } from "@/lib/ecommerce/ecommerce-canvas-preset";
import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { parseEcommerceProfileDraft } from "@/lib/ecommerce/ecommerce-draft";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const product = (metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    ...createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { status: "idle", productProfile: createEcommerceProductProfile("保温杯"), ...metadata }),
    id: "product-1",
});

describe("四个套图入口", () => {
    test("详情页 / 主图 / 模特上身 / 种草秀，各自对应一套行业标准交付物", () => {
        expect(ECOMMERCE_ONE_CLICK_FLOWS.map((flow) => flow.id)).toEqual(["detail", "main", "wear", "seed"]);
        expect(ecommerceOneClickFlow("detail")?.set.id).toBe("detail-nine");
        expect(ecommerceOneClickFlow("main")?.set.id).toBe("main-five");
        expect(ecommerceOneClickFlow("seed")?.set.id).toBe("seed-content");
        expect(ecommerceOneClickFlow("nope")).toBeUndefined();
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

    test("首屏用海报版式、收尾用压底版式——全用一个版式看起来像同一张复制了九遍", () => {
        expect(ecommerceOneClickLayoutPreset("detail", "detail-1")).toBe("poster");
        expect(ecommerceOneClickLayoutPreset("detail", "detail-9")).toBe("bottom-bar");
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

    test("铺底不是把同一句话复制九遍——九屏的职责不同，提示词必须不同", () => {
        const rows = ecommerceSuiteFromPresets(ecommerceOneClickFlow("detail")!);
        expect(new Set(rows.map((row) => row.prompt)).size).toBe(rows.length);
    });

    test("铺底里不留「不生成任何文字」——那是本地叠字那套留下的说法", () => {
        // 照抄那句会得到一张干净但没字的图，而用户以为自己已经点过「铺底」了。
        // 而且它不报错，用户只会觉得模型没听话。
        // 预设里另有「不预留文案位」——那是这一张真的不该有字（细节、使用中），保留原样。
        for (const flow of ECOMMERCE_ONE_CLICK_FLOWS) {
            for (const row of ecommerceSuiteFromPresets(flow)) {
                expect(row.prompt).not.toContain("不生成任何文字");
            }
        }
        // 留了文案位的行必须换成「以逐字引号为准」的说法
        expect(ecommerceSuiteFromPresets(ecommerceOneClickFlow("detail")!).some((row) => row.prompt.includes("不要自己编字"))).toBe(true);
    });

    test("四个入口的拍法预设全部存在——缺一个就会退化成只剩一句职责", () => {
        for (const flow of ECOMMERCE_ONE_CLICK_FLOWS) {
            for (const screen of ecommerceOneClickScreens(flow)) {
                expect(ecommerceShotPreset(screen.presetId)).toBeDefined();
            }
        }
    });

    test("缺一条就不算齐——没提示词的行出不了图", () => {
        const rows = ecommerceSuiteFromPresets(ecommerceOneClickFlow("seed")!);
        const suite = { flow: "seed", rows, source: "preset" as const, updatedAt: "" };
        expect(ecommerceSuiteReady(suite)).toBe(true);
        const partial = { ...suite, rows: rows.map((row, index) => (index ? row : { ...row, prompt: "" })) };
        expect(ecommerceSuiteMissing(partial, rows.length)).toBe(1);
        expect(ecommerceSuiteReady(partial)).toBe(false);
    });
});

describe("分析结果的解析", () => {
    const flow = () => ecommerceOneClickFlow("detail")!;

    test("四段一行：槽位 | 标题 | 职责 | 完整提示词", () => {
        const parsed = parseEcommerceSuiteDraft("detail-1 | 痛点共情 | 说出买家正在遇到的问题 | 商品居中摆放在纯白背景，45 度俯拍，柔光箱从左前方打光，右上角一行字「12 小时还热着」", flow());
        expect(parsed).toHaveLength(1);
        expect(parsed![0].slotId).toBe("detail-1");
        expect(parsed![0].title).toBe("痛点共情");
        expect(parsed![0].duty).toBe("说出买家正在遇到的问题");
        expect(parsed![0].prompt).toContain("12 小时还热着");
    });

    test("旧的两段格式也吃——用户手里那套自定义提示词可能还在用", () => {
        const parsed = parseEcommerceSuiteDraft("detail-1 | 商品居中，纯白背景，正面平视", flow());
        expect(parsed).toHaveLength(1);
        expect(parsed![0].prompt).toBe("商品居中，纯白背景，正面平视");
        // 标题与职责退回行业套路给的那一份
        expect(parsed![0].title).toBe("痛点共情");
        expect(parsed![0].duty.trim()).toBeTruthy();
    });

    test("模型返回几行就是几行——屏数不固定，可以由提示词要求", () => {
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

    test("模型写解释的那几行不会当成屏次——id 不是短标识符就跳过", () => {
        const parsed = parseEcommerceSuiteDraft("以下是九屏提示词，请核对 | 这条不是屏次 | 也不该进表 | 更不该出图", flow());
        expect(parsed).toBeUndefined();
    });

    test("解析不出任何一行时返回 undefined，调用方据此退回拍法预设", () => {
        expect(parseEcommerceSuiteDraft("模型今天不想干活。", flow())).toBeUndefined();
        expect(parseEcommerceSuiteDraft("", flow())).toBeUndefined();
    });
});

describe("铺产物节点", () => {
    const counter = () => {
        let i = 0;
        return () => `c${++i}`;
    };
    const rowsOf = (flowId: "detail" | "main" | "seed" | "wear" = "detail") => ecommerceSuiteFromPresets(ecommerceOneClickFlow(flowId)!);

    test("只为还没有节点的那几行铺——重出这一套不该在画布上再堆一遍", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const rows = rowsOf();
        const all = rows.map((row) => row.slotId);
        const { nodes } = ecommerceSuiteNodes(product(), flow, rows, new Set(all.slice(0, 7)), counter());
        expect(nodes.map((node) => node.metadata?.ecommerceShotId)).toEqual(all.slice(7));
    });

    test("单张出图只铺那一行——不该顺手把另外八张也铺出来", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const { nodes, connections } = ecommerceSuiteNodes(product(), flow, rowsOf(), new Set(), counter(), ["detail-5"]);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].metadata?.ecommerceShotId).toBe("detail-5");
        expect(connections).toHaveLength(1);
    });

    test("单张出图时那一行已经有节点就不铺，返回空", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const { nodes } = ecommerceSuiteNodes(product(), flow, rowsOf(), new Set(["detail-5"]), counter(), ["detail-5"]);
        expect(nodes).toHaveLength(0);
    });

    test("几张由表决定，不由行业套路决定", () => {
        // 用户删到三行就只铺三张，加了行就铺十张——「九屏」只是一个起点。
        const flow = ecommerceOneClickFlow("detail")!;
        const trimmed = rowsOf().slice(0, 3);
        const three = ecommerceSuiteNodes(product(), flow, trimmed, new Set(), counter());
        expect(three.nodes.map((node) => node.metadata?.ecommerceShotId)).toEqual(trimmed.map((row) => row.slotId));

        const ten = ecommerceSuiteNodes(product(), flow, [...rowsOf(), { slotId: "detail-10", title: "第十屏", duty: "补一屏", prompt: "" }], new Set(), counter());
        expect(ten.nodes).toHaveLength(10);
        expect(ten.nodes[9].title).toBe("第十屏");
    });

    test("一张都没铺时铺满，每张认领自己那一行、带自己的画幅", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const { nodes, connections } = ecommerceSuiteNodes(product(), flow, rowsOf(), new Set(), counter());
        expect(nodes).toHaveLength(9);
        expect(connections).toHaveLength(9);
        for (const node of nodes) {
            expect(node.type).toBe(CanvasNodeType.Image);
            expect(node.metadata?.ecommerceAspectRatio).toBe("3:4");
            expect(node.title.trim()).toBeTruthy();
        }
        // 商品节点连到每一张：约束链要能把商品锁定带到每一张上
        for (const connection of connections) expect(connection.fromNodeId).toBe("product-1");
    });

    test("铺出来的节点不挂本地叠字配方——图片和文字一条提示词一起交给模型", () => {
        const { nodes } = ecommerceSuiteNodes(product(), ecommerceOneClickFlow("seed")!, rowsOf("seed"), new Set(), counter());
        for (const node of nodes) {
            expect(node.metadata?.ecommerceComposite).toBeUndefined();
            expect(node.metadata?.pendingComposite).toBeUndefined();
        }
    });
});

describe("出图调动计划", () => {
    const counter = () => {
        let i = 0;
        return () => `c${++i}`;
    };
    const suiteOf = (flowId: "detail" | "main" | "seed" | "wear" = "detail") => {
        const flow = ecommerceOneClickFlow(flowId)!;
        return { flow: flowId, rows: ecommerceSuiteFromPresets(flow), source: "preset" as const, updatedAt: "" };
    };

    test("新铺的节点自带自己的提示词——不是空手进画布", () => {
        // 上一版把新节点直接追加，它们进不了「写提示词」那个只走已有节点的循环，
        // 于是每一张都是空提示词，调度器把整批标成「生成提示词为空」，
        // 用户看到的是节点铺了一地、一个都不出图。
        const flow = ecommerceOneClickFlow("detail")!;
        const plan = ecommerceSuiteTargets(product(), flow, suiteOf(), { nodes: [], connections: [] }, {}, counter());
        expect(plan.spawned).toHaveLength(9);
        expect(plan.nodeIds).toHaveLength(9);
        const promptBySlot = new Map(plan.rows.map((row) => [row.slotId, row.prompt]));
        for (const node of plan.spawned) {
            const slotId = node.metadata?.ecommerceShotId;
            expect(node.metadata?.prompt).toBe(promptBySlot.get(slotId!));
            expect(node.metadata?.composerContent).toBe(node.metadata?.prompt);
            expect(node.metadata?.prompt?.trim()).toBeTruthy();
        }
    });

    test("出图模型与参数跟着新节点一起落地", () => {
        const plan = ecommerceSuiteTargets(product(), ecommerceOneClickFlow("main")!, suiteOf("main"), { nodes: [], connections: [] }, { model: "CHANNEL_000001::gpt-image-2", size: "3:4", quality: "high" }, counter());
        for (const node of plan.spawned) {
            expect(node.metadata?.model).toBe("CHANNEL_000001::gpt-image-2");
            expect(node.metadata?.size).toBe("3:4");
            expect(node.metadata?.quality).toBe("high");
        }
    });

    test("重复生图保留旧图，并为同一槽位创建新节点", () => {
        // 只看连接的话，连接被删过一次、或上一次铺节点时连接没落盘，重出就会在画布上
        // 再堆一遍一模一样的九张，用户看到的是「重复出一样的图」。
        const flow = ecommerceOneClickFlow("detail")!;
        const already = { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceShotId: "detail-3" }), id: "img-1" };
        const plan = ecommerceSuiteTargets(product(), flow, suiteOf(), { nodes: [already], connections: [] }, {}, counter());
        expect(plan.spawned).toHaveLength(9);
        const replacement = plan.spawned.find((node) => node.metadata?.ecommerceShotId === "detail-3");
        expect(replacement).toBeDefined();
        expect(replacement?.id).not.toBe("img-1");
        expect(replacement?.position.y).toBeGreaterThan(already.position.y);
        expect(plan.reuse).toEqual([]);
        expect(plan.nodeIds).toHaveLength(9);
        expect(plan.reconnect).toEqual([]);
    });

    test("已经连到商品节点的不用补边", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const already = { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ecommerceShotId: "detail-3" }), id: "img-1" };
        const link = { id: "l1", fromNodeId: "product-1", toNodeId: "img-1" };
        const plan = ecommerceSuiteTargets(product(), flow, suiteOf(), { nodes: [already], connections: [link] }, {}, counter());
        expect(plan.spawned).toHaveLength(9);
        expect(plan.reconnect).toEqual([]);
    });

    test("repeat generation creates a distinct image node below the previous result", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const suite = suiteOf();
        const first = ecommerceSuiteTargets(product(), flow, suite, { nodes: [], connections: [] }, {}, counter(), ["detail-3"]);
        const previous = first.spawned.find((node) => node.metadata?.ecommerceShotId === "detail-3")!;
        const next = ecommerceSuiteTargets(product(), flow, suite, { nodes: [previous], connections: first.connections }, {}, counter(), ["detail-3"]);
        const replacement = next.spawned.find((node) => node.metadata?.ecommerceShotId === "detail-3")!;
        expect(replacement.id).not.toBe(previous.id);
        expect(replacement.position.y).toBeGreaterThan(previous.position.y);
        expect(next.reuse).toEqual([]);
    });

    test("单张出图只动那一行", () => {
        const plan = ecommerceSuiteTargets(product(), ecommerceOneClickFlow("detail")!, suiteOf(), { nodes: [], connections: [] }, {}, counter(), ["detail-7"]);
        expect(plan.rows.map((row) => row.slotId)).toEqual(["detail-7"]);
        expect(plan.spawned).toHaveLength(1);
        expect(plan.spawned[0].metadata?.prompt.trim()).toBeTruthy();
        expect(plan.nodeIds).toHaveLength(1);
    });

    test("表要认自己那一套——跨入口读串了会一个节点都调不动", () => {
        // 商品节点上只存一份 suite。先跑过详情页、再点主图，槽位对不上，
        // 上一版这里返回空 → 静默什么都不做。
        const plan = ecommerceSuiteTargets(product(), ecommerceOneClickFlow("main")!, suiteOf("detail"), { nodes: [], connections: [] }, {}, counter());
        expect(plan.rows).toEqual([]);
        expect(plan.nodeIds).toEqual([]);
    });

    test("表里的行没有提示词时不出节点——宁可什么都不铺，也不要铺一地的空方块", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const bare = { flow: "detail", rows: ecommerceSuiteSkeleton(flow), source: "preset" as const, updatedAt: "" };
        const plan = ecommerceSuiteTargets(product(), flow, bare, { nodes: [], connections: [] }, {}, counter());
        expect(plan.spawned).toEqual([]);
        expect(plan.nodeIds).toEqual([]);
    });

    test("每一张都连到商品节点——约束链要能把商品锁定带下去", () => {
        const plan = ecommerceSuiteTargets(product(), ecommerceOneClickFlow("seed")!, suiteOf("seed"), { nodes: [], connections: [] }, {}, counter());
        expect(plan.connections).toHaveLength(4);
        for (const connection of plan.connections) expect(connection.fromNodeId).toBe("product-1");
    });
});

describe("套图面板的接线", () => {
    const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    const preset = readFileSync(new URL("../src/lib/ecommerce/ecommerce-canvas-preset.ts", import.meta.url), "utf8");
    const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-suite-panel.tsx", import.meta.url), "utf8");

    test("商品节点上一排套图入口，不是九套方案", () => {
        const product = readFileSync(new URL("../src/components/canvas/nodes/product-node.tsx", import.meta.url), "utf8");
        expect(product).toContain("ECOMMERCE_ONE_CLICK_FLOWS.map");
        // 点入口开的是套图面板——表里逐条核对过才出图
        expect(product).toContain("actions.openEcommerceTable?.(node, flow)");
        expect(node).toContain("<CanvasEcommerceSuitePanel");
        expect(product).toContain("ecom-oneclick");
    });

    test("分析模型和出图模型独立保存在创作表上", () => {
        // 分析要读图、出图不用，两者常常不是同一个模型，而全局配置只有一个
        expect(panel).toContain('capability="text"');
        expect(panel).toContain('capability="image"');
        expect(node).toContain("ecommerceAnalysisModel");
        expect(node).toContain("ecommerceImageModel");
        expect(project).toContain("analysisModel?: string");
    });

    test("分析要带图，模型看不了图就说清楚而不是静默降级", () => {
        expect(project).toContain("const productReferenceImages = useCallback(");
        expect(project).toContain("ecommerceProductReferenceImages(product, nodesRef.current, connectionsRef.current)");
        expect(project).toContain("buildEcommerceAnalysisGeneration(effectiveConfig, modelOverride, requirements.input)");
    });

    test("批量生成：把每行的提示词写进那一张的节点，再一次提交整批", () => {
        expect(project).toContain("const generateEcommerceSuite = useCallback(");
        expect(project).toMatch(/enqueueGenerationBatch\(\s*productNode\.id,\s*"batch_image"/);
        // 提示词写进节点自己的 prompt：点开那一屏能看见它、能改它、能单独重出
        expect(project).toContain("prompt, composerContent: prompt");
        // 按槽位复用已铺的节点，重出不在画布上再堆一遍
        expect(project).toContain("...plan.spawned.map((item) => ({ ...item, metadata: { ...item.metadata, ecommerceRunId: runId } }))");
        expect(preset).toContain("reuse: [],");
    });

    test("批量生图提交后重新选择整批输出，避免聚焦首张时虚拟化卸载其余节点", () => {
        const generation = project.slice(project.indexOf("const generateEcommerceSuite = useCallback("), project.indexOf("// \u52a8\u4f5c Context", project.indexOf("const generateEcommerceSuite = useCallback(")));
        const viewport = readFileSync(new URL("../src/pages/canvas/use-canvas-viewport-controller.ts", import.meta.url), "utf8");
        expect(generation).toMatch(/setNodes\(\(current\) => \[[\s\S]*?\.\.\.plan\.spawned\.map\([\s\S]*?ecommerceRunId: runId[\s\S]*?\]\);/);
        expect(generation).toMatch(/focusCanvasImageNodes\(nodeIds\);[\s\S]*?batchId = enqueueGenerationBatch/);
        expect(viewport).toMatch(/const focusCanvasImageNodes = useCallback\([\s\S]*?getCanvasNodesBounds\(targets\)[\s\S]*?viewportForBounds\(bounds, size/);
    });

    test("物料一键生图在显示入队提示前把新建图节点带入画布视野", () => {
        const generation = project.slice(project.indexOf("const generateEcommerceMaterials = useCallback("), project.indexOf("// \u8282\u70b9\u52a8\u4f5c Context", project.indexOf("const generateEcommerceMaterials = useCallback(")));
        expect(generation).toMatch(/spawnEcommerceMaterials\(node, planId\)/);
        expect(generation).toMatch(/focusCanvasImageNodes\(imageNodeIds\);[\s\S]*?enqueueGenerationBatch\(\s*node\.id,[\s\S]*?imageNodeIds\.map/);
        expect(generation).toMatch(/if \(!imageNodeIds\.length\) return/);
    });

    test("重出用的是表里那一版提示词——不能被节点上旧的 generationSpec 盖住", () => {
        // 节点上可能已经有一份 generationSpec（用户单独生成过，或上一次批量生成写进去的），
        // 它的 prompt 和 options 会盖住 metadata 里的同名字段——那样「重出」用的还是
        // 上一版提示词、上一版尺寸，用户改了表却看不出任何变化。
        expect(project).toContain("synchronizeGenerationSpec(item, { prompt, composerContent: prompt");
    });

    test("新铺的节点也要拿到自己的提示词——那段循环只走画布上已有的节点", () => {
        // 上一版把新节点作为 `...spawned` 直接追加，它们进不了那个 `current.map`，
        // 于是每一张都拿到空提示词，调度器把整批标成「生成提示词为空」——用户看到的是
        // 节点铺了一地、一个都不出图，批量生成和单张出图都是这样。
        // 现在这件事由 ecommerceSuiteTargets 保证（见「出图调动计划」那一组），
        // 页面层只负责把 plan.spawned 原样追加进去。
        expect(project).toContain("...plan.spawned.map((item) => ({ ...item, metadata: { ...item.metadata, ecommerceRunId: runId } }))");
        expect(project).toMatch(/connectEcommerceTableOutputs\(\s*ecommerceSuiteTargets\(/);
    });

    test("提交路上 buildGenerationConfig 抛错不能静默冲出去", () => {
        // 批次调度那条路接了，单次提交这条路也要接——节点状态会停在「提交中」，
        // 用户看到的是点了没反应。
        const executor = readFileSync(new URL("../src/pages/canvas/use-canvas-generation-executor.ts", import.meta.url), "utf8");
        expect(executor).toContain("generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);");
        expect(executor).toMatch(/catch \(error\) \{\s*failPreflight\(error\);\s*return;/);
        expect(executor).toContain("generationFailureMetadata(error, prompt)");
    });

    test("单张出图：面板每行一个按钮，只出那一张", () => {
        expect(panel).toContain("onGenerateOne");
        expect(panel).toContain("ecom-suite-row-run");
        // 没有提示词的行不给按——出了也是一张空图
        expect(panel).toContain('disabled={!hasPrompt || generating || status === "loading"}');
        expect(project).toContain("generateEcommerceSuiteRef.current?.(node, flowId, slotIds, rows)");
        // 单张出图或关闭自动装订时清除旧失败计划，不触发装订。
        expect(project).toContain("if (single || !autoBind) return { ...item, metadata: { ...item.metadata, ecommerceShotSet: undefined, ecommerceOneClick: undefined } }");
    });

    test("尺寸与画质在面板上选，写进每一张产物节点", () => {
        expect(panel).toContain("CanvasImageSettingsPopover");
        expect(panel).toContain("onImageOptionChange");
        expect(project).toContain("ecommerceImageSize");
        expect(project).toContain("ecommerceImageQuality");
        // 参数要跟着出图模型算能力，否则面板上换了模型就看不到它的档位
        expect(panel).toContain("const settingsConfig: AiConfig = {");
        expect(panel).toContain("...(imageModel ? { model: imageModel, imageModel } : {})");
    });

    test("一条提示词都没有时不给「只出有的」——那等于出 0 张，面板关掉什么都没发生", () => {
        expect(panel).toContain("const empty = missing >= total;");
        expect(panel).toContain('okText: empty ? "去补提示词" : "只出有的"');
        // 空表时确认框里不该有 onOk：点了只关弹窗，留在面板里
        expect(panel).toContain('...(empty ? { cancelButtonProps: { style: { display: "none" } } } : { cancelText: "回去补", onOk: generateDraft })');
    });

    test("每一条提前退出的路都要说话——静默 return 是「点了没反应」的成因", () => {
        expect(project).toContain("这一套的产物节点没能铺出来");
        expect(project).toContain("还没有提示词，请先分析商品或编辑提示词表");
        // 批次调度里 buildGenerationConfig 抛错不能冲出整个循环
        const batches = readFileSync(new URL("../src/pages/canvas/use-canvas-generation-batches.ts", import.meta.url), "utf8");
        expect(batches).toContain("generationConfig = buildGenerationConfig(effectiveConfig, node, generationMode);");
        expect(batches).toContain("} catch (error) {");
        expect(batches).toContain("发起生成的节点已经不在画布上了");
    });

    test("表要认自己那一套——跨入口读串了会让槽位对不上然后什么都不做", () => {
        // 判定收在 ecommerceSuiteTargets 里（见「出图调动计划」），页面层把
        // 商品节点上那份 suite 原样递进去，由它决定要不要用。
        expect(project).toContain("suiteNode.metadata?.ecommerceSuite,");
        expect(preset).toContain("if (suite?.flow !== flow.id) return empty;");
    });

    test("不再挂通用拍法清单——每一张的拍法已经写在那一张自己的提示词里", () => {
        // 再挂一份通用清单，编译时会作为「本张：构图…光线…」前置到提示词之前，
        // 与用户核对过的那条打架（用户改成俯拍，清单还写着平视）。
        expect(project).toContain("ecommerceShotSet: undefined");
        expect(project).not.toContain("ecommerceShotSet: shotSet");
        // 流程状态仍然要挂：全屏出完要自动装订，得记住这一批是哪几张
        expect(project).toContain("ecommerceOneClick: { flow: flow.id");
        expect(preset).toContain("ecommerceShotId: row.slotId");
    });

    test("全屏出完自动装订成长图并切片", () => {
        expect(project).toContain("rasterizeEcommerceDetailPage");
        expect(project).toContain("bindingRef");
        // 缺屏就不装订——缺屏的长图交出去比不交更糟
        expect(project).toContain("ecommerceBindingImages(plan, nodes)");
        expect(project).toContain("if (!ready) continue");
    });

    test("本地叠字那套从一键流程里去掉了", () => {
        expect(project).not.toContain("compositeEcommerceImage");
        expect(preset).not.toContain("pendingComposite");
    });
});

describe("整组统一与结构可调", () => {
    const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-suite-panel.tsx", import.meta.url), "utf8");

    test("屏次与职责可改，张数可增删——九屏只是起点", () => {
        // 面板那两列从静态文字改成输入框
        expect(panel).toContain("setDraftRows((current) => current.map");
        expect(panel).toContain("onRowsChange(draftRows)");
        expect(panel).toContain("moveDraftRow(current, row.slotId, -1)");
        expect(panel).toContain("onAddRow");
        expect(panel).toContain("onRemoveRow");
        expect(panel).toContain("加一屏");
        expect(node).toContain("onAddRow=");
        expect(node).toContain("onRemoveRow=");
        // 新行的槽位 id 是可读的「前缀 + 序号」，不是一串随机字符
        expect(node).toContain("ecommerceSuiteRowId(flow, rows)");
    });

    test("行顺序可调——顺序决定叙事，也决定长图怎么接", () => {
        expect(panel).toContain("moveDraftRow(current, row.slotId, -1)");
        expect(panel).toContain("moveDraftRow(current, row.slotId, 1)");
    });

    test("屏数可以由提示词要求——模型返回几行就是几行", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, ecommerceSuiteRows(flow, undefined));
        expect(prompt).toContain("你返回几行，这一套就是几行");
        // 表里的屏次与职责进了提示词，模型知道现在是怎么分的
        expect(prompt).toContain("【这一套现在按这几屏走】");
    });

    test("平台 / 语言 / 色彩美学 / 字体风格 / 风格参考图都进分析提示词", () => {
        const flow = ecommerceOneClickFlow("detail")!;
        const rows = ecommerceSuiteRows(flow, undefined);
        const prompt = ecommerceSuiteDraftPrompt(flow, undefined, rows, undefined, {
            platformId: "taobao",
            languageId: "en",
            style: { name: "极简白", palette: ["#FFFFFF", "#1A1A1A"], tone: "中性白", mood: "干净克制", typography: "无衬线，字重对比强" },
            styleReferenceName: "参考图A",
        });
        expect(prompt).toContain("【投放平台】淘宝 / 天猫");
        // 平台口径是硬规范，不是审美偏好——写进去是为了让模型一次画对
        expect(prompt).toContain("主图口径：");
        expect(prompt).toContain("【图上文字的语言】");
        expect(prompt).toContain("一律用英文");
        expect(prompt).toContain("【色彩美学】极简白");
        expect(prompt).toContain("#FFFFFF");
        expect(prompt).toContain("【字体风格】无衬线，字重对比强");
        // 参考图要说清是哪一张：那几张图本来就都送进模型了
        expect(prompt).toContain("「参考图A」");
        expect(prompt).toContain("不要复刻它的构图、商品和文字");
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

    test("商品卡片保留图片槽位，去除整组统一与行业铺底", () => {
        const node = readFileSync(new URL("../src/components/canvas/nodes/product-node.tsx", import.meta.url), "utf8");
        expect(node).toContain("ProductInputSlot");
        expect(node).toContain("visual-reference:");
        expect(node).not.toContain("CanvasEcommerceUniformDialog");
        expect(node).not.toContain("onSeedPresets");
        expect(panel).not.toContain("按行业套路铺底");
    });

    test("创作表能一键清空所有提示词——结构留着", () => {
        expect(panel).toContain("清空提示词");
        expect(panel).toContain("onClearPrompts");
        expect(node).toContain("onClearPrompts=");
        // 只抹 prompt，屏次与职责留着：想重来一遍时通常还要原来那套结构
        expect(node).toContain('rows.map((row) => ({ ...row, prompt: "" }))');
    });

    test("分析能选技能，选了才注入", () => {
        expect(panel).toContain("SkillRuntimePicker");
        expect(panel).toContain("onSkillIdsChange");
        expect(node).toContain("ecommerceAnalysisSkills");
        // 与出图那条链路同一套注入：prepare 把技能正文与关联文件拼进提示词
        expect(project).toContain("listAddedSkills({ force: true })");
        expect(project).toContain("selectedSkillIds: skillIds");
        expect(project).toContain("skillMetadata = skillExecution.metadata");
        // 没选就不注入——库里可能有二十个，全塞进去会把提示词顶爆
        expect(project).toContain("if (skillIds?.length) {");
    });

    test("按在按钮上不会启动画布拖拽——否则按钮要点两次", () => {
        // mousedown 冒泡到节点的落点处理器，画布当成拖拽开始，随后的 click 就被吃掉
        expect(node).toContain("onMouseDown={stopCanvasDragFromInteractive}");
        const interaction = readFileSync(new URL("../src/lib/canvas/node-interaction.ts", import.meta.url), "utf8");
        expect(interaction).toContain("isCanvasNodeInteractiveTarget");
        // 判据只此一份，面板与卡片都读它
        const promptPanel = readFileSync(new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url), "utf8");
        expect(promptPanel).toContain("isCanvasNodeInteractiveTarget");
    });

    test("装订可关——关掉之后出图照出，只是不拼长图", () => {
        expect(panel).toContain("出完自动拼长图");
        expect(panel).toContain("onAutoBindChange");
        expect(node).toContain("ecommerceAutoBind: value");
        // 装订链路只认 ecommerceOneClick，不写它就不会自动拼
        expect(project).toContain("if (single || !autoBind)");
    });
});

describe("读图起草：图必须真的递进模型", () => {
    const project = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    const draft = readFileSync(new URL("../src/lib/ecommerce/ecommerce-draft.ts", import.meta.url), "utf8");
    const suite = readFileSync(new URL("../src/lib/ecommerce/ecommerce-suite.ts", import.meta.url), "utf8");

    test("商品实拍放进 referenceImages 传给文本模型", () => {
        // 上一版没传 referenceImages，模型收到的只有一段文字，
        // 于是它只能回一句「系统未传入图片节点的画面像素数据」
        expect(project).toMatch(/referenceImages,\s*streamText: false,/);
    });

    test("读图起草不走云 agent——那边没有取图工具", () => {
        const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
        expect(node).toContain("draftEcommerceSuite");
        expect(node).not.toContain("draftWithAgent?.(node");
    });

    test("档案起草的提示词明说「图就在这次请求里」", () => {
        expect(draft).toContain("图就在这次请求里，直接看图，不要说自己看不到");
        expect(draft).toContain("unsure");
    });

    test("分析提示词要求「一条里说清四件事」", () => {
        const prompt = ecommerceSuiteDraftPrompt(ecommerceOneClickFlow("detail")!, undefined, ecommerceSuiteRows(ecommerceOneClickFlow("detail")!, undefined));
        expect(prompt).toContain("画面主体与状态");
        expect(prompt).toContain("场景与背景");
        expect(prompt).toContain("光线与镜头");
        expect(prompt).toContain("图上文字");
        expect(prompt).toContain("不要把同一套描述复制到每一张");
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
        expect(prompt).toContain("【输出格式】每行一条，四段竖线分隔");
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

    test("创作表以补充信息代替分析指令编辑，指令由服务端注入", () => {
        const panel = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-suite-panel.tsx", import.meta.url), "utf8");
        const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
        expect(panel).toContain("补充平台、张数和商品信息");
        expect(panel).toContain("onBriefChange");
        expect(node).toContain("ecommerceBrief: value");
        expect(project).not.toContain("suiteNode.metadata?.ecommerceSuitePrompts?.[flowId]");
        expect(project).toContain("ecommerceAnalysisFlow");
    });

    test("Skills 按四种 flow 独立保存并传入分析", () => {
        const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
        expect(node).toContain("ecommerceAnalysisSkillsByFlow?.[activeFlow.id]");
        expect(node).toContain("ecommerceAnalysisSkillsByFlow: { ...node.metadata?.ecommerceAnalysisSkillsByFlow, [activeFlow.id]: value }");
        expect(project).toContain("suiteNode.metadata?.ecommerceAnalysisSkillsByFlow?.[flowId]");
    });

    test("生成后创作表保持在画布中", () => {
        const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
        expect(node).not.toContain("setSuiteFlow");
        expect(node).toMatch(/CanvasEcommerceSuitePanel\s+embedded/);
        expect(project).toContain("batchId = enqueueGenerationBatch(");
        expect(project).toContain("return Boolean(batchId);");
    });

    test("阻止重复提交、默认不自动装订，并要求显式选择分析和生图模型", () => {
        const node = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-table-node.tsx", import.meta.url), "utf8");
        const panel = readFileSync(new URL("../src/components/canvas/canvas-ecommerce-suite-panel.tsx", import.meta.url), "utf8");
        expect(node).toContain("generationInFlight.current");
        expect(node).toContain("ecommerceAutoBind === true");
        expect(panel).toContain("分析模型");
        expect(node).toContain("ecommerceAnalysisModel");
        expect(node).toContain("ecommerceImageModel");
        expect(node).toContain("const [generating, setGenerating] = useState(false)");
        expect(node).toContain("autoBind={node.metadata?.ecommerceAutoBind === true}");
        expect(project).toContain("未选择分析模型");
        expect(project).toContain("未选择生图模型");
        expect(project).toContain("rowsOverride?: EcommerceSuiteRow[]");
        expect(panel).toContain("onGenerate(draftRows)");
    });

    test("图上文字要逐字写出来并用引号包住——不让模型自己发挥", () => {
        expect(suite).toContain("逐字用引号写进提示词");
    });

    test("档案草稿按行解析，容忍序号与全角竖线", () => {
        const parsed = parseEcommerceProfileDraft("1. category｜保温杯\n- appearance | 哑光黑；304 不锈钢\nmarks | 杯身中部 THERMO\nunsure | 材质是推测的");
        expect(parsed.category).toBe("保温杯");
        expect(parsed.appearance).toBe("哑光黑；304 不锈钢");
        expect(parsed.marks).toBe("杯身中部 THERMO");
        expect(parsed.unsure).toBe("材质是推测的");
    });

    test("「无」「看不清」这类占位不当成内容写进档案", () => {
        const parsed = parseEcommerceProfileDraft("category | 保温杯\nmarks | 看不清\nforbidden | 无");
        expect(parsed.category).toBe("保温杯");
        expect(parsed.marks).toBeUndefined();
        expect(parsed.forbidden).toBeUndefined();
    });
});
