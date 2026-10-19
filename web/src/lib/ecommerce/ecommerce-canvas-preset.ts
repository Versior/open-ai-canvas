/**
 * 电商创作画布的开局与生长。
 *
 * 一条硬规矩：**不预铺节点。**
 *
 * 用户只要一张主图时，铺七个节点是荒谬的。所以新建画布只放一个商品节点——它是唯一的
 * 必需输入；其余节点由用户在商品节点上选「要什么」再长出来。要一张就长三个节点，
 * 要一套就长一套，要完整控制就自己往画布上加风格、卖点、文案、排版。
 *
 * 节点数量因此始终等于「用户真正要的东西」，不多不少。
 */
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createEcommerceCopy, createEcommerceProductProfile, createEcommerceStyle } from "./ecommerce-contract";
import { createEcommerceDelivery } from "./ecommerce-delivery";
import { ECOMMERCE_ALL_DELIVERABLE_SETS, ECOMMERCE_SINGLE_SLOT, type EcommerceDeliverableSet } from "./ecommerce-deliverables";
import { createEcommerceLayout } from "./ecommerce-layout";
import { ECOMMERCE_FLOW_ASPECT, ecommerceOneClickScreens, type EcommerceOneClickFlow } from "./ecommerce-oneclick";
import type { EcommerceSuite, EcommerceSuiteRow } from "./ecommerce-suite";
import { createEcommerceVideo } from "./ecommerce-video";
import { createEcommerceShotSetFromSlots, createEcommerceStyleFromPreset } from "./ecommerce-recipes";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/** 商品节点下方的横排间距，与产物节点纵向间距。 */
const SIBLING_GAP = 440;
const ROW_GAP = 620;

/**
 * 开局：只有一个商品节点。
 *
 * 用户先连商品图、填事实，再决定要出什么。反过来先铺一堆节点会让人以为
 * 「必须先配齐这些才能出图」——那不是事实，也不该是事实。
 */
export function ecommerceCanvasPreset(): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const product = createCanvasNode(CanvasNodeType.Product, { x: 0, y: 0 }, { status: "idle", productProfile: createEcommerceProductProfile("商品") });
    product.title = "商品";
    return { nodes: [product], connections: [] };
}

export function createEcommerceStyleReference(product: CanvasNodeData, existing: CanvasNodeData[], handle = "visual-reference:0") {
    const node = createCanvasNode(CanvasNodeType.Image, { x: product.position.x - 600, y: product.position.y - 360 }, { status: "idle", ecommerceReferenceRole: "style" });
    node.title = "视觉参考";
    for (let attempt = 0; attempt <= existing.length; attempt += 1) {
        const overlaps = existing.some((item) => Math.abs(item.position.x - node.position.x) < (item.width + node.width) / 2 + 32 && Math.abs(item.position.y - node.position.y) < (item.height + node.height) / 2 + 32);
        if (!overlaps) break;
        node.position.y -= node.height + 48;
    }
    return { node, connection: { id: `reference-${node.id}`, fromNodeId: node.id, toNodeId: product.id, toHandleId: handle } };
}
/**
 * 一次要出多少东西。
 *
 * 直接采用行业标准的交付物结构（见 ecommerce-deliverables.ts），不自创分类：
 * 主图五张有固定构成，详情页是九屏金字塔，海外 listing 是七图位。用户选的是
 * 「交什么活」，不是「填几个格子」。
 */
export type EcommerceMaterialPlan = EcommerceDeliverableSet;

export const ECOMMERCE_MATERIAL_PLANS: EcommerceMaterialPlan[] = [
    ECOMMERCE_SINGLE_SLOT,
    ...ECOMMERCE_ALL_DELIVERABLE_SETS,
];

export function ecommerceMaterialPlan(id: string) {
    return ECOMMERCE_MATERIAL_PLANS.find((plan) => plan.id === id);
}

/**
 * 按一个物料方案，从商品节点长出下游。
 *
 * **一套交付物配一个拍法节点，不是一张图配一个。** 五张主图的差异是清单上的五行，
 * 不是五个节点——五个节点意味着同一套布光基准要填五遍，还要在画布上四处找哪份对应哪张。
 * 拍法节点里是一张拍摄清单，一行一张，一眼看完。
 *
 * 产物图片节点带上 ecommerceShotId，认领清单里的哪一行；生成时按那一行展开提示词。
 * 辅助节点（风格 / 卖点 / 文案 / 排版）摆在更下面一行，只连需要它们的产物。
 */
export function ecommerceMaterialNodes(product: CanvasNodeData, plan: EcommerceMaterialPlan, createId: () => string) {
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const slots = plan.slots;
    // 一套最多十六张，排成一条长龙在画布上没法看。每行最多五张，折行摆放。
    const columns = Math.min(slots.length, 5);
    const rows = Math.ceil(slots.length / columns);
    const startX = product.position.x - ((columns - 1) * SIBLING_GAP) / 2;
    const outputY = product.position.y + ROW_GAP;
    const rowGap = 300;
    const recipeY = outputY - 260;

    const slotPosition = (index: number) => ({
        x: startX + (index % columns) * SIBLING_GAP,
        y: outputY + Math.floor(index / columns) * rowGap,
    });

    // 一套交付物只有一个拍法节点，摆在产物上方居中。
    const recipe = createCanvasNode(CanvasNodeType.ShotRecipe, { x: product.position.x, y: recipeY }, { status: "idle", shotSet: createEcommerceShotSetFromSlots(plan.name, slots) });
    recipe.title = plan.name;
    nodes.push(recipe);
    // 商品也连到拍法上：这条边不是为了拍法自己（它不描述商品），而是为了让
    // 约束链能穿过去——清单后补出来的产物图只连拍法，少了这条边商品锁定就断了。
    connections.push({ id: createId(), fromNodeId: product.id, toNodeId: recipe.id });

    // 辅助约束节点摆在产物下面一行，只连需要它们的产物
    const extras: Partial<Record<NonNullable<EcommerceMaterialPlan["extras"]>[number], CanvasNodeData>> = {};
    const extrasY = outputY + rows * rowGap + 120;
    (plan.extras || []).forEach((kind, index) => {
        const x = product.position.x - ((Math.min((plan.extras || []).length, 5) - 1) * SIBLING_GAP) / 2 + index * SIBLING_GAP;
        const y = extrasY;
        let node: CanvasNodeData;
        if (kind === "style") {
            node = createCanvasNode(CanvasNodeType.Style, { x, y }, { status: "idle", ecommerceStyle: createEcommerceStyleFromPreset("minimal-white") || createEcommerceStyle("极简白") });
            node.title = "品牌风格";
            extras.style = node;
        } else if (kind === "sellingPoints") {
            node = createCanvasNode(CanvasNodeType.SellingPoint, { x, y }, { status: "idle", sellingPoints: [] });
            node.title = "卖点";
            extras.sellingPoints = node;
        } else if (kind === "copy") {
            node = createCanvasNode(CanvasNodeType.Copy, { x, y }, { status: "idle", ecommerceCopy: createEcommerceCopy() });
            node.title = "文案";
            extras.copy = node;
        } else if (kind === "delivery") {
            node = createCanvasNode(CanvasNodeType.Delivery, { x, y }, { status: "idle", ecommerceDelivery: createEcommerceDelivery(plan.name) });
            node.title = `${plan.name} · 交付`;
            extras.delivery = node;
        } else if (kind === "video") {
            node = createCanvasNode(CanvasNodeType.EcommerceVideo, { x, y }, { status: "idle", ecommerceVideo: createEcommerceVideo(plan.name) });
            node.title = `${plan.name} · 成片`;
            extras.video = node;
        } else {
            node = createCanvasNode(CanvasNodeType.Layout, { x, y }, { status: "idle", ecommerceLayout: createEcommerceLayout(), ecommerceAspectRatio: "1:1" });
            node.title = "排版";
            extras.layout = node;
        }
        nodes.push(node);
        // 排版与视频自己会出图出片，商品锁定必须能走到它们身上——只连产物图是不够的，
        // 用户可能只点「生成成品图」而不重新生成底图。
        if (kind === "layout" || kind === "video") connections.push({ id: createId(), fromNodeId: product.id, toNodeId: node.id });
    });

    slots.forEach((slot, index) => {
        const { x, y } = slotPosition(index);

        const image = createCanvasNode(CanvasNodeType.Image, { x, y }, { content: "", status: "idle", ecommerceShotId: slot.id });
        image.title = slot.title;
        nodes.push(image);

        connections.push({ id: createId(), fromNodeId: recipe.id, toNodeId: image.id });
        connections.push({ id: createId(), fromNodeId: product.id, toNodeId: image.id });
        if (extras.style) connections.push({ id: createId(), fromNodeId: extras.style.id, toNodeId: image.id });
        if (extras.sellingPoints) connections.push({ id: createId(), fromNodeId: extras.sellingPoints.id, toNodeId: image.id });
        // 文案只连需要文字的那几张（卖点图与详情屏），不连纯白底
        if (extras.copy && (slot.presetId === "selling-point" || slot.id.startsWith("detail-"))) connections.push({ id: createId(), fromNodeId: extras.copy.id, toNodeId: image.id });
        if (extras.layout && slot.id.startsWith("detail-")) connections.push({ id: createId(), fromNodeId: extras.layout.id, toNodeId: image.id });
        // 交付节点连每一张：它要汇总的正是这一整套
        if (extras.delivery) connections.push({ id: createId(), fromNodeId: image.id, toNodeId: extras.delivery.id });
        // 视频节点连每一张：这套图就是它的镜头素材
        if (extras.video) connections.push({ id: createId(), fromNodeId: image.id, toNodeId: extras.video.id });
    });

    return { nodes, connections };
}

/** 专属画布的名字，按已有数量递增，避免同名。 */
export function ecommerceCanvasTitle(existingTitles: string[]) {
    const base = "电商创作";
    if (!existingTitles.includes(base)) return base;
    let index = 2;
    while (existingTitles.includes(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
}

/**
 * 按套图提示词铺产物节点——**只为还没有节点的那几行铺**。
 *
 * 上一版是「点一下先铺九屏」，用户看到的是一堆还没出图的空方块，
 * 还得自己在画布上找哪块对应哪张。现在铺节点这一步并进「批量生成」里，
 * 而且按槽位复用：重出这一套不会在画布上再堆九个方块。
 *
 * **按表铺，不按行业套路铺。** 几张、每张叫什么，由那一张表决定——
 * 用户删了两行就是七张，加了行就是十张。画幅整组一致，由入口给。
 *
 * 传 `slotIds` 就只铺那几行——单张出图走的就是这条路，不该顺手把另外八张也铺出来。
 */
export function ecommerceSuiteNodes(product: CanvasNodeData, flow: EcommerceOneClickFlow, rows: EcommerceSuiteRow[], existingSlotIds: Set<string>, createId: () => string, slotIds?: string[]) {
    const wanted = slotIds?.length ? new Set(slotIds) : undefined;
    const missing = rows.filter((row) => !existingSlotIds.has(row.slotId) && (!wanted || wanted.has(row.slotId)));
    if (!missing.length) return { nodes: [] as CanvasNodeData[], connections: [] as CanvasConnection[] };
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const aspectRatio = ECOMMERCE_FLOW_ASPECT[flow.id] || "1:1";
    const columns = Math.min(Math.max(missing.length, 1), 5);
    const startX = product.position.x - ((columns - 1) * SIBLING_GAP) / 2;
    const outputY = product.position.y + ROW_GAP;

    missing.forEach((row, index) => {
        const image = createCanvasNode(
            CanvasNodeType.Image,
            { x: startX + (index % columns) * SIBLING_GAP, y: outputY + Math.floor(index / columns) * 320 },
            { content: "", status: "idle", ecommerceShotId: row.slotId, ecommerceAspectRatio: aspectRatio },
        );
        image.title = row.title;
        nodes.push(image);
        connections.push({ id: createId(), fromNodeId: product.id, toNodeId: image.id });
    });

    return { nodes, connections };
}

/**
 * 一次出图的调动计划：**哪些行要出、哪些节点复用、哪些要新铺**。
 *
 * 这段逻辑原来长在页面层的 `generateEcommerceSuite` 里，结果出了一个查了很久的 bug：
 * 写提示词的那段循环只走画布上**已有**的节点，新铺的节点是作为 `...spawned`
 * 直接追加进去的，进不了那个循环——每一张新图都是空提示词，调度器把整批标成
 * 「生成提示词为空」，而用户看到的是节点铺了一地、一个都不出图。
 *
 * 抽成纯函数就是为了让这件事可测：`spawned` 里的每一个节点**必须自带 prompt**，
 * 这是这条链路的硬约定，不是调用方记得去补的一件事。
 */
export type EcommerceSuiteTargets = {
    /** 本次要出的行（表里有提示词，且在 slotIds 范围内）。 */
    rows: EcommerceSuiteRow[];
    /** 复用已有节点：槽位、节点 id、这一张的提示词。调用方据此写进节点。 */
    reuse: { slotId: string; nodeId: string; prompt: string }[];
    /** 本次新铺的产物节点——**已经带上自己的提示词与出图参数**。 */
    spawned: CanvasNodeData[];
    /** 新铺节点要连的边。 */
    connections: CanvasConnection[];
    /**
     * 认回来的产物节点与商品节点之间缺的边。
     *
     * 认领不看连接（下面解释了为什么），所以认回来的节点可能根本没连到商品——
     * 少了这条边，生成时约束链走不上去，商品锁定块静默丢失，出来的图看着正常
     * 却不是同一件商品。这里把缺的补上，而不是让那种图悄悄出街。
     */
    reconnect: CanvasConnection[];
    /** 本次的目标节点 id，按表里的顺序。 */
    nodeIds: string[];
};

export function ecommerceSuiteTargets(
    product: CanvasNodeData,
    flow: EcommerceOneClickFlow,
    suite: EcommerceSuite | undefined,
    canvas: { nodes: CanvasNodeData[]; connections: CanvasConnection[] },
    patch: { model?: string; size?: string; quality?: string },
    createId: () => string,
    slotIds?: string[],
): EcommerceSuiteTargets {
    const empty: EcommerceSuiteTargets = { rows: [], reuse: [], spawned: [], connections: [], reconnect: [], nodeIds: [] };
    // 表要认自己那一套：商品节点上只存一份 suite，跨入口（详情页 → 主图）读串了
    // 会让槽位对不上，然后一个节点都调不动。
    if (suite?.flow !== flow.id) return empty;
    const wanted = slotIds?.length ? new Set(slotIds) : undefined;
    const rows = suite.rows.filter((row) => row.prompt.trim() && (!wanted || wanted.has(row.slotId)));
    if (!rows.length) return empty;

    // **按槽位在全画布认领，不只看连接。** 只看连接的话，连接被删过一次、
    // 或上一次铺节点时连接没落盘，重出就会在画布上再堆一遍一模一样的九张——
    // 用户看到的是「重复出一样的图」。认领靠的是槽位这个稳定标识，连接缺了补上就是。
    const { nodes: spawnedRaw, connections } = ecommerceSuiteNodes(product, flow, rows, new Set(), createId, rows.map((row) => row.slotId));
    const promptBySlot = new Map(rows.map((row) => [row.slotId, row.prompt.trim()]));
    const spawned = spawnedRaw.map((item) => {
        const prompt = item.metadata?.ecommerceShotId ? promptBySlot.get(item.metadata.ecommerceShotId) : undefined;
        const slotId = item.metadata?.ecommerceShotId;
        const priorRuns = slotId ? canvas.nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.ecommerceShotId === slotId).length : 0;
        return { ...item, position: { ...item.position, y: item.position.y + priorRuns * 360 }, metadata: { ...item.metadata, ...(prompt ? { prompt, composerContent: prompt } : {}), ...patch } };
    });

    return {
        rows,
        reuse: [],
        spawned,
        connections,
        reconnect: [],
        nodeIds: spawned.map((item) => item.id),
    };
}



/**
 * 从拍法节点补齐这一组图。
 *
 * 与 `ecommerceMaterialNodes` 的分工：那个是「从商品节点按方案铺一整套」（含辅助节点），
 * 这个是「从已有的拍法节点按当前清单补齐缺的产物」。
 *
 * 两者不能合并，因为清单会被改：用户加一行、删一行、换个拍法之后，画布上产物节点与
 * 清单行就对不上了。按方案重铺会把改过的清单冲掉，按清单对账才不会。
 *
 * 只补 `unclaimed` 的行——已认领的行说明产物节点已经在了，重复生成是浪费。
 * 新节点的 `ecommerceShotId` 就是那一行的 id，生成时据此展开该行的提示词。
 */
export function ecommerceShotSetOutputs(recipe: CanvasNodeData, claimedShotIds: Set<string>, createId: () => string, shotIds?: string[]) {
    const set = recipe.metadata?.shotSet;
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    if (!set) return { nodes, connections };
    // 传了 shotIds 就只补那几行——「只出这一张」时不该顺手把别的行也铺出来
    const wanted = shotIds?.length ? new Set(shotIds) : undefined;
    const missing = set.shots.filter((shot) => !claimedShotIds.has(shot.id) && (!wanted || wanted.has(shot.id)));
    if (!missing.length) return { nodes, connections };
    // 产物按清单顺序排在拍法节点下方，一行一张；超过五张折行，与铺方案时的观感一致。
    const columns = Math.min(missing.length, 5);
    const startX = recipe.position.x - ((columns - 1) * SIBLING_GAP) / 2;
    const outputY = recipe.position.y + 300;
    missing.forEach((shot, index) => {
        const image = createCanvasNode(CanvasNodeType.Image, {
            x: startX + (index % columns) * SIBLING_GAP,
            y: outputY + Math.floor(index / columns) * 300,
        }, { content: "", status: "idle", ecommerceShotId: shot.id });
        image.title = shot.title.trim() || "未命名";
        nodes.push(image);
        connections.push({ id: createId(), fromNodeId: recipe.id, toNodeId: image.id });
    });
    return { nodes, connections };
}
