import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { createEcommerceCopy, createEcommerceProductProfile, createEcommerceShotSet, createEcommerceStyle } from "@/lib/ecommerce/ecommerce-contract";
import { createEcommerceDelivery } from "@/lib/ecommerce/ecommerce-delivery";
import { createEcommerceVideo } from "@/lib/ecommerce/ecommerce-video";
import { createEcommerceAplus } from "@/lib/ecommerce/ecommerce-aplus";
import { createEcommerceSizeChart } from "@/lib/ecommerce/ecommerce-size-chart";
import { createEcommerceInfographic } from "@/lib/ecommerce/ecommerce-infographic";
import { createEcommerceLayout } from "@/lib/ecommerce/ecommerce-layout";
import { createEcommerceReplica } from "@/lib/ecommerce/ecommerce-replica";
import { createEcommerceTeardown } from "@/lib/ecommerce/ecommerce-teardown";

type CanvasNodeSpec = {
    width: number;
    height: number;
    title: string;
    metadata?: CanvasNodeMetadata;
};

export const NODE_DEFAULT_SIZE = {
    [CanvasNodeType.Image]: { width: 720, height: 405, title: "图片" },
    [CanvasNodeType.Text]: { width: 340, height: 240, title: "Note" },
    [CanvasNodeType.Drawing]: { width: 440, height: 300, title: "绘图" },
    [CanvasNodeType.Script]: { width: 920, height: 360, title: "分镜脚本" },
    [CanvasNodeType.Skill]: { width: 360, height: 220, title: "技能" },
    // 配置节点同时承载模式、渠道、工作流和参数；预留稳定空间，避免控件和错误状态互相挤压。
    [CanvasNodeType.Config]: { width: 480, height: 390, title: "生成配置" },
    [CanvasNodeType.Video]: { width: 720, height: 405, title: "视频" },
    [CanvasNodeType.Audio]: { width: 340, height: 120, title: "Audio" },
    [CanvasNodeType.Frame]: { width: 760, height: 520, title: "未命名背板" },
    [CanvasNodeType.Markdown]: { width: 420, height: 320, title: "Markdown" },
    [CanvasNodeType.Svg]: { width: 420, height: 320, title: "SVG" },
    [CanvasNodeType.Html]: { width: 520, height: 380, title: "HTML" },
    [CanvasNodeType.Panorama]: { width: 520, height: 300, title: "全景" },
    [CanvasNodeType.Compare]: { width: 520, height: 320, title: "对比" },
    [CanvasNodeType.Chart]: { width: 480, height: 320, title: "图表" },
    [CanvasNodeType.ColorGrade]: { width: 420, height: 360, title: "调色" },
    [CanvasNodeType.MediaConversion]: { width: 480, height: 460, title: "转换" },
    [CanvasNodeType.BatchTable]: { width: 1280, height: 560, title: "批量创作表" },
    [CanvasNodeType.Product]: { width: 460, height: 660, title: "商品" },
    [CanvasNodeType.ShotRecipe]: { width: 420, height: 580, title: "拍法" },
    [CanvasNodeType.SellingPoint]: { width: 400, height: 440, title: "卖点" },
    [CanvasNodeType.Copy]: { width: 380, height: 400, title: "文案" },
    [CanvasNodeType.Style]: { width: 400, height: 460, title: "品牌风格" },
    [CanvasNodeType.Layout]: { width: 560, height: 620, title: "排版" },
    [CanvasNodeType.Infographic]: { width: 560, height: 660, title: "信息图" },
    [CanvasNodeType.Replica]: { width: 460, height: 560, title: "爆款复刻" },
    [CanvasNodeType.Teardown]: { width: 560, height: 620, title: "竞品拆解" },
    [CanvasNodeType.Delivery]: { width: 620, height: 640, title: "交付" },
    [CanvasNodeType.Revision]: { width: 460, height: 620, title: "改稿" },
    [CanvasNodeType.EcommerceVideo]: { width: 640, height: 660, title: "电商视频" },
    [CanvasNodeType.Aplus]: { width: 600, height: 660, title: "A+ 内容" },
} satisfies Record<CanvasNodeType, { width: number; height: number; title: string }>;

export const NODE_SPECS = {
    [CanvasNodeType.Image]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Image],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Text]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Text],
        metadata: { content: "", status: "idle", fontSize: 14 },
    },
    [CanvasNodeType.Drawing]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Drawing],
        metadata: { status: "success" },
    },
    [CanvasNodeType.Script]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Script],
        metadata: {
            status: "idle",
            workflowKind: "script",
            storyboard: {
                rows: [],
                visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
                referenceNodeIds: [],
            },
        },
    },
    [CanvasNodeType.Skill]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Skill],
        metadata: { status: "success" },
    },
    [CanvasNodeType.Config]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Config],
        metadata: { content: "", status: "idle", generationMode: "image" },
    },
    [CanvasNodeType.Video]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Video],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Audio]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Audio],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Frame]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Frame],
        metadata: { frame: { collapsed: false, expandedWidth: NODE_DEFAULT_SIZE[CanvasNodeType.Frame].width, expandedHeight: NODE_DEFAULT_SIZE[CanvasNodeType.Frame].height } },
    },
    [CanvasNodeType.Markdown]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Markdown],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Svg]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Svg],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Html]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Html],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Panorama]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Panorama],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.Compare]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Compare],
        metadata: { status: "idle" },
    },
    [CanvasNodeType.Chart]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Chart],
        metadata: { content: "", status: "idle" },
    },
    [CanvasNodeType.ColorGrade]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.ColorGrade],
        metadata: { status: "idle" },
    },
    [CanvasNodeType.MediaConversion]: { ...NODE_DEFAULT_SIZE[CanvasNodeType.MediaConversion], metadata: { status: "idle" } },
    [CanvasNodeType.BatchTable]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.BatchTable],
        metadata: {
            status: "idle",
            batchTable: {
                referenceMode: "cells",
                operation: "try_on",
                concurrency: 10,
                referenceColumns: [
                    { id: "reference-1", label: "参考图 1" },
                    { id: "reference-2", label: "参考图 2" },
                    { id: "reference-3", label: "参考图 3" },
                ],
                rows: [],
            },
        },
    },
    [CanvasNodeType.Product]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Product],
        metadata: { status: "idle", productProfile: createEcommerceProductProfile() },
    },
    [CanvasNodeType.ShotRecipe]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.ShotRecipe],
        metadata: { status: "idle", shotSet: createEcommerceShotSet() },
    },
    [CanvasNodeType.SellingPoint]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.SellingPoint],
        metadata: { status: "idle", sellingPoints: [] },
    },
    [CanvasNodeType.Copy]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Copy],
        metadata: { status: "idle", ecommerceCopy: createEcommerceCopy() },
    },
    [CanvasNodeType.Style]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Style],
        metadata: { status: "idle", ecommerceStyle: createEcommerceStyle() },
    },
    [CanvasNodeType.Layout]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Layout],
        metadata: { status: "idle", ecommerceLayout: createEcommerceLayout(), ecommerceAspectRatio: "1:1" },
    },
    [CanvasNodeType.Infographic]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Infographic],
        metadata: { status: "idle", ecommerceInfographic: createEcommerceInfographic(), ecommerceAspectRatio: "1:1", ecommerceSizeChart: createEcommerceSizeChart("top") },
    },
    [CanvasNodeType.Aplus]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Aplus],
        metadata: { status: "idle", ecommerceAplus: createEcommerceAplus() },
    },
    [CanvasNodeType.Replica]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Replica],
        metadata: { status: "idle", ecommerceReplica: createEcommerceReplica() },
    },
    [CanvasNodeType.Teardown]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Teardown],
        metadata: { status: "idle", ecommerceTeardown: createEcommerceTeardown() },
    },
    [CanvasNodeType.Delivery]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Delivery],
        metadata: { status: "idle", ecommerceDelivery: createEcommerceDelivery() },
    },
    [CanvasNodeType.Revision]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.Revision],
        metadata: { status: "idle", ecommerceRevisions: [] },
    },
    [CanvasNodeType.EcommerceVideo]: {
        ...NODE_DEFAULT_SIZE[CanvasNodeType.EcommerceVideo],
        metadata: { status: "idle", ecommerceVideo: createEcommerceVideo() },
    },
} satisfies Record<CanvasNodeType, CanvasNodeSpec>;

export function getNodeSpec(type: CanvasNodeType) {
    return NODE_SPECS[type];
}
