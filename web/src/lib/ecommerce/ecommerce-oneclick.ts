/**
 * 电商创作：一键出整套。
 *
 * 这个模块存在的理由，是前面几版都踩过的同一个坑：
 * **把「一步能做完的事」拆成十几个节点让用户自己接。**
 *
 * 铺十屏、连文案、连排版、逐张点生成、等整套出完、再拼长图、再切片——
 * 每一步都「可配置」，合起来就是一条没人走得完的流水线。行业里真正在用的工具
 * 只有一个按钮：给它商品图，它给你一整套能上传的片。
 *
 * 所以这里的职责是：**把「一键」拆成一份可执行的清单**——
 * 出哪几张、每张什么职责、用哪个版式、画幅多大、最后怎么装订。
 * 清单是纯数据，执行在页面层（分析提示词、铺节点、批量生成、装订）。
 *
 * 详情页把确认文案与画面一起交给图片模型；结构化文案与版式仍独立保存，作为本地编辑和排版回退。
 * 其他入口可继续按平台要求生成无字底图。
 */
import { ECOMMERCE_DETAIL_PAGE_SET, ECOMMERCE_MAIN_IMAGE_SET, ECOMMERCE_MODEL_WEARING_SET, ECOMMERCE_SEED_CONTENT_SET, type EcommerceDeliverableSet } from "./ecommerce-deliverables";

export type EcommerceOneClickFlowId = "detail" | "main" | "wear" | "seed";

export type EcommerceOneClickFlow = {
    id: EcommerceOneClickFlowId;
    name: string;
    /** 卡片上的副标题：说清这一键出的是什么。 */
    hint: string;
    /** 产物槽位来自哪套行业标准交付物。 */
    set: EcommerceDeliverableSet;
    /** 整套做完之后要不要装订成长图 + 切片。详情页要，种草秀不要。 */
    bind: boolean;
};

export const ECOMMERCE_ONE_CLICK_FLOWS: EcommerceOneClickFlow[] = [
    {
        id: "detail",
        name: "一键详情页",
        hint: "十屏商业详情页，从品牌主视觉到购买理由总结；出完拼长图并按平台切片",
        set: ECOMMERCE_DETAIL_PAGE_SET,
        bind: true,
    },
    {
        id: "main",
        name: "一键主图",
        hint: "行业标准五张：核心展示 / 卖点 / 场景 / 细节 / 规格，决定搜索页的点击率",
        set: ECOMMERCE_MAIN_IMAGE_SET,
        bind: false,
    },
    {
        id: "wear",
        name: "一键模特上身",
        hint: "正面全身 / 半身细节 / 背面，回答「穿在我身上是什么样」",
        set: ECOMMERCE_MODEL_WEARING_SET,
        bind: false,
    },
    {
        id: "seed",
        name: "一键种草秀",
        hint: "小红书 / 抖音图文四张：封面 + 场景 + 上身 + 细节，求真实感不求精致",
        set: ECOMMERCE_SEED_CONTENT_SET,
        bind: false,
    },
];

export function ecommerceOneClickFlow(id: string | undefined) {
    return ECOMMERCE_ONE_CLICK_FLOWS.find((flow) => flow.id === id);
}

/**
 * 每一屏用哪个版式。
 *
 * 详情页十屏不能全用同一个版式：首屏是海报，收尾是压底版式，
 * 中间各屏再按商品、平台与主题动态规划。
 */
const LAYOUT_BY_SLOT: Record<string, string> = {
    "detail-1": "poster",
    "detail-10": "bottom-bar",
    // 种草封面是内容流的门面：文字让在侧面，商品不占满，像随手拍的
    "seed-1": "side-notes",
};

const LAYOUT_FALLBACK: Record<EcommerceOneClickFlowId, string> = {
    detail: "detail-screen",
    main: "bottom-bar",
    wear: "side-notes",
    seed: "side-notes",
};

export function ecommerceOneClickLayoutPreset(flowId: EcommerceOneClickFlowId, slotId: string) {
    return LAYOUT_BY_SLOT[slotId] || LAYOUT_FALLBACK[flowId];
}

/** 产物槽位 + 各自的版式与画幅，按顺序。铺节点、分析提示词、提交生成都读它。 */
export type EcommerceOneClickScreen = {
    slotId: string;
    /** 节点标题，例如「详情01 · 痛点共情」。 */
    title: string;
    /** 这一屏要解决什么，来自行业套路。 */
    duty: string;
    layoutPresetId: string;
    /** 这一张的拍法预设 id。分析没跑时靠它铺一份能用的提示词底子。 */
    presetId: string;
    /** 画幅。详情页是 3:4（淘宝详情屏的常见比例），种草是 4:5（小红书竖版）。 */
    aspectRatio: string;
};

/** 每一套的画幅。淘宝详情屏 3:4、列表主图 1:1、上身与种草是竖版。 */
export const ECOMMERCE_FLOW_ASPECT: Record<EcommerceOneClickFlowId, string> = {
    detail: "3:4",
    main: "1:1",
    wear: "3:4",
    seed: "4:5",
};

export function ecommerceOneClickScreens(flow: EcommerceOneClickFlow): EcommerceOneClickScreen[] {
    return flow.set.slots.map((slot) => ({
        slotId: slot.id,
        title: slot.title,
        duty: slot.duty,
        layoutPresetId: ecommerceOneClickLayoutPreset(flow.id, slot.id),
        presetId: slot.presetId,
        aspectRatio: ECOMMERCE_FLOW_ASPECT[flow.id] || "1:1",
    }));
}
