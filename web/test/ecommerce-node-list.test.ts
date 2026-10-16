import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ECOMMERCE_NODE_GROUPS, ecommerceNodeGroup, ecommerceNodeSummary } from "@/lib/ecommerce/ecommerce-node-summary";
import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceShotSet } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceSellingPoint } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceCopy } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceLayout } from "@/lib/ecommerce/ecommerce-layout";
import { createEcommerceInfographic, createEcommerceInfographicCallout } from "@/lib/ecommerce/ecommerce-infographic";
import { createEcommerceReplica } from "@/lib/ecommerce/ecommerce-replica";
import { createEcommerceTeardown, createEcommerceTeardownOutlineRow } from "@/lib/ecommerce/ecommerce-teardown";
import { createEcommerceAplus, createEcommerceAplusBlock } from "@/lib/ecommerce/ecommerce-aplus";
import { createEcommerceVideo, createEcommerceVideoShot } from "@/lib/ecommerce/ecommerce-video";
import { createEcommerceRevision } from "@/lib/ecommerce/ecommerce-revision";
import { createEcommerceDelivery } from "@/lib/ecommerce/ecommerce-delivery";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

function node(type: CanvasNodeType, metadata: CanvasNodeMetadata = {}, title = "节点"): CanvasNodeData {
    return { id: `${type}-1`, type, title, position: { x: 0, y: 0 }, width: 400, height: 400, metadata };
}

describe("电商节点清单：分组按工作流阶段", () => {
    test("每个电商节点都有归属分组", () => {
        const types = [
            CanvasNodeType.Product, CanvasNodeType.SellingPoint, CanvasNodeType.Copy, CanvasNodeType.Style,
            CanvasNodeType.ShotRecipe, CanvasNodeType.Image, CanvasNodeType.Layout, CanvasNodeType.Infographic, CanvasNodeType.Replica,
            CanvasNodeType.Teardown,
            CanvasNodeType.EcommerceVideo, CanvasNodeType.Aplus, CanvasNodeType.Revision, CanvasNodeType.Delivery,
        ];
        for (const type of types) {
            expect(ecommerceNodeGroup(node(type))).not.toBeNull();
        }
        // 通用节点不属于任何电商分组——自由画布的节点不该被塞进电商的阶段里
        expect(ecommerceNodeGroup(node(CanvasNodeType.Text))).toBeNull();
        expect(ecommerceNodeGroup(node(CanvasNodeType.Script))).toBeNull();
    });

    test("分组顺序就是工作流顺序：事实 → 成图 → 收尾", () => {
        const ids = ECOMMERCE_NODE_GROUPS.map((group) => group.id);
        expect(ids).toEqual(["facts", "media", "reference", "finish"]);
        // 商品在事实组，拍法在成图组，交付在收尾组
        expect(ecommerceNodeGroup(node(CanvasNodeType.Product))).toBe("facts");
        expect(ecommerceNodeGroup(node(CanvasNodeType.ShotRecipe))).toBe("media");
        expect(ecommerceNodeGroup(node(CanvasNodeType.Delivery))).toBe("finish");
    });
});

describe("电商节点清单：摘要说能不能往下走", () => {
    test("商品说档案完成度与视角数，缺东西时标 warn", () => {
        const empty = ecommerceNodeSummary(node(CanvasNodeType.Product, { productProfile: createEcommerceProductProfile("保温杯") }));
        expect(empty.text).toContain("档案 0/4");
        expect(empty.text).toContain("未绑视角");
        expect(empty.flag).toBe("warn");
        expect(empty.incomplete).toBe(true);

        const filled = ecommerceNodeSummary(node(CanvasNodeType.Product, {
            productProfile: { ...createEcommerceProductProfile("保温杯"), category: "保温杯", appearance: "哑光黑" },
        }));
        expect(filled.text).toContain("档案 2/4");
        // 档案齐了但没绑视角，仍然要提醒——没有视角参考就没有商品一致性
        expect(filled.flag).toBe("warn");
    });

    test("拍法说清单张数与整组要求", () => {
        const summary = ecommerceNodeSummary(node(CanvasNodeType.ShotRecipe, {
            shotSet: { ...createEcommerceShotSet("主图五张"), shots: [] },
        }));
        expect(summary.text).toBe("清单为空");
        expect(summary.flag).toBe("warn");
    });

    test("卖点缺依据时标 warn 并报出条数", () => {
        const summary = ecommerceNodeSummary(node(CanvasNodeType.SellingPoint, {
            sellingPoints: [createEcommerceSellingPoint("保温 12 小时", ""), createEcommerceSellingPoint("304 不锈钢", "检测报告")],
        }));
        expect(summary.text).toContain("2 条");
        expect(summary.text).toContain("1 条缺依据");
        expect(summary.flag).toBe("warn");
        expect(summary.incomplete).toBe(true);
    });

    test("文案说价格是留空还是填了", () => {
        expect(ecommerceNodeSummary(node(CanvasNodeType.Copy, { ecommerceCopy: createEcommerceCopy() })).text).toContain("价格留空");
        const priced = ecommerceNodeSummary(node(CanvasNodeType.Copy, { ecommerceCopy: { ...createEcommerceCopy(), price: "¥199" } }));
        expect(priced.text).toBe("含价格");
        expect(priced.incomplete).toBe(false);
    });

    test("品牌风格说色板色数", () => {
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Style, { ecommerceStyle: { ...createEcommerceStyle("极简白"), palette: ["#FFFFFF", "#1A1A1A"] } }));
        expect(summary.text).toContain("极简白");
        expect(summary.text).toContain("2 色");
        expect(summary.flag).toBe("ok");
    });

    test("排版说版式名、画幅与文字块数", () => {
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Layout, { ecommerceLayout: createEcommerceLayout("底部信息条"), ecommerceAspectRatio: "4:5" }));
        expect(summary.text).toContain("底部信息条");
        expect(summary.text).toContain("4:5");
    });

    test("信息图说标题、标注数与有没有表格", () => {
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Infographic, {
            ecommerceInfographic: { ...createEcommerceInfographic("卖点标注"), headline: "保温 12 小时", callouts: [createEcommerceInfographicCallout("真空层")] },
        }));
        expect(summary.text).toContain("保温 12 小时");
        expect(summary.text).toContain("1 条标注");
        // 没有表格时整段省略，不写「无表格」占位——清单要短
        expect(summary.text).not.toContain("含表格");
    });

    test("复刻区分复刻与溶图", () => {
        expect(ecommerceNodeSummary(node(CanvasNodeType.Replica, { ecommerceReplica: createEcommerceReplica("对标爆款") })).text).toContain("复刻爆款");
        const compose = ecommerceNodeSummary(node(CanvasNodeType.Replica, { ecommerceReplica: { ...createEcommerceReplica("客厅实景"), purpose: "compose" } }));
        expect(compose.text).toContain("溶图合成");
        // 溶图不勾维度也算就绪
        expect(compose.incomplete).toBe(false);
    });

    test("拆解说结论数与大钢行数", () => {
        const teardown = { ...createEcommerceTeardown("对标"), outline: [createEcommerceTeardownOutlineRow("首屏", "整体展示")] };
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Teardown, { ecommerceTeardown: teardown }));
        expect(summary.text).toContain("1 行");
        expect(summary.text).toContain("1 行跟着做");
    });

    test("视频说镜数、秒数与平台，拦截时标 block", () => {
        const video = { ...createEcommerceVideo("主图视频"), shots: [{ ...createEcommerceVideoShot("img-1"), seconds: 5 }] };
        const summary = ecommerceNodeSummary(node(CanvasNodeType.EcommerceVideo, { ecommerceVideo: video }));
        expect(summary.text).toContain("1 镜");
        expect(summary.text).toContain("5s");
    });

    test("A+ 说块数，超字数时标 block", () => {
        const over = { ...createEcommerceAplus("A+"), blocks: [{ ...createEcommerceAplusBlock("image-text-overlay"), headline: "标".repeat(80) }] };
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Aplus, { ecommerceAplus: over }));
        expect(summary.text).toContain("1 块");
        expect(summary.text).toContain("1 项超限");
        expect(summary.flag).toBe("block");
    });

    test("改稿说当前版本与总版数", () => {
        // createEcommerceRevision 默认 current: true，所以新建一版时要把旧版标成非当前
        // ——这与画布上的分叉操作一致，不能只 new 一个就完事
        const v1 = createEcommerceRevision({ version: 1, kind: "first", change: "初版", basedOn: null, imageNodeId: "img-1" });
        const v2 = createEcommerceRevision({ version: 2, kind: "local", change: "换背景", basedOn: null, imageNodeId: "img-2" });
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Revision, { ecommerceRevisions: [{ ...v1, current: false }, v2] }));
        expect(summary.text).toContain("v2 在采用");
        expect(summary.text).toContain("共 2 版");
    });

    test("交付说商品编码、投放平台与版本", () => {
        const delivery = { ...createEcommerceDelivery("交付"), code: "THERMO-500", version: 3 };
        const summary = ecommerceNodeSummary(node(CanvasNodeType.Delivery, { ecommerceDelivery: delivery }));
        expect(summary.text).toContain("THERMO-500");
        expect(summary.text).toContain("淘宝");
        expect(summary.text).toContain("v3");
    });

    test("产物图说有没有认领清单行——没认领的图只用整组统一", () => {
        const claimed = ecommerceNodeSummary(node(CanvasNodeType.Image, { content: "data:image/png;base64,x", ecommerceShotId: "s1" }));
        expect(claimed.text).toBe("已认领清单行");
        expect(claimed.flag).toBe("ok");

        const orphan = ecommerceNodeSummary(node(CanvasNodeType.Image, { content: "data:image/png;base64,x" }));
        expect(orphan.text).toBe("未认领清单行");
        expect(orphan.flag).toBe("warn");

        const pending = ecommerceNodeSummary(node(CanvasNodeType.Image, { ecommerceShotId: "s1" }));
        expect(pending.text).toBe("待生成（已认领）");
        expect(pending.incomplete).toBe(true);
    });

    test("非电商节点不给摘要，退回通用摘要", () => {
        expect(ecommerceNodeSummary(node(CanvasNodeType.Text)).text).toBe("");
        expect(ecommerceNodeSummary(node(CanvasNodeType.Script)).text).toBe("");
        expect(ecommerceNodeSummary(node(CanvasNodeType.Video)).text).toBe("");
    });

    test("电商节点缺 metadata 时不炸，返回空摘要", () => {
        for (const type of [CanvasNodeType.Product, CanvasNodeType.ShotRecipe, CanvasNodeType.Layout, CanvasNodeType.Aplus, CanvasNodeType.Delivery]) {
            expect(ecommerceNodeSummary(node(type)).text).toBe("");
        }
    });
});

describe("节点清单面板接上了分组与筛选", () => {
    const panel = readFileSync(new URL("../src/components/canvas/canvas-workspace-node-list-panel.tsx", import.meta.url), "utf8");

    test("按画布种类决定分不分组", () => {
        expect(panel).toContain('const ecommerce = canvasKind === "ecommerce"');
        // 自由画布节点类型杂且没有固定阶段，硬分组反而更难找
        expect(panel).toContain('if (!ecommerce) return [{ id: "all", label: "", hint: "", items: visible }]');
    });

    test("有「只看没配齐」筛选", () => {
        expect(panel).toContain("onlyIncomplete");
        expect(panel).toContain("只看没配齐");
        expect(panel).toContain("显示全部");
    });

    test("有问题的节点点一个标记，block 与 warn 用不同图标", () => {
        expect(panel).toContain("FLAG_COLOR");
        expect(panel).toContain("AlertTriangle");
        expect(panel).toContain("有拦截项");
    });

    test("缩略图用注册表图标，不是清一色的文件图标", () => {
        // 商品/拍法/信息图/交付在一列里长得一样，等于没缩略图
        expect(panel).toContain("getNodeIcon(node.type)");
    });

    test("头部报出待补数量", () => {
        expect(panel).toContain("待补");
        expect(panel).toContain("incompleteCount");
    });
});

describe("添加节点菜单按分组呈现", () => {
    const menu = readFileSync(new URL("../src/components/canvas/canvas-create-menu.tsx", import.meta.url), "utf8");
    const commands = readFileSync(new URL("../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx", import.meta.url), "utf8");

    test("电商画布只放商品节点——其余十二个暂时从菜单里去掉了", () => {
        // 它们把「一步能做完的事」拆成十几个节点让用户自己接：铺九屏、连文案、连排版、
        // 逐张点生成、等九张出完、再逐张叠字、再拼长图、再切片。每一步都「可配置」，
        // 合起来是一条没人走得完的流水线。内容改挂在商品节点上，入口收成两个一键按钮。
        expect(commands).toContain('group: "电商"');
        const matches = commands.match(/group: "/g) || [];
        expect(matches).toHaveLength(1);
        for (const type of ["ShotRecipe", "SellingPoint", "Copy", "Style", "Layout", "Infographic", "Replica", "Teardown", "Delivery", "Revision", "EcommerceVideo", "Aplus"]) {
            expect(commands).not.toContain(`CanvasNodeType.${type}, {`);
        }
        // 节点实现都还在——老画布照常渲染，要放回来只改这张表
        expect(commands).toContain("nodeCommand(CanvasNodeType.Product");
    });

    test("无分组的通用节点排到最后，不会出现两个同名的「创作节点」段", () => {
        // 通用节点的 defaultOrder 被电商节点夹在中间，直接按出现顺序聚拢会得到两段同名
        expect(menu).toContain('const rest = groups.get("")');
        expect(menu).toContain("return rest?.length ? [...named, { title: \"\", commands: rest }] : named;");
    });

    test("分组标题就是导航，不再是一张平铺的四列网格", () => {
        expect(menu).toContain("groupedNodeCommands.map");
        expect(menu).toContain('title={group.title || "创作节点"}');
    });
});
