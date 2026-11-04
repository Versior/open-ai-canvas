import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/**
 * 旧版电商画布下线后仍保留在存量数据里的节点类型，以及它们原来的名称。
 *
 * 这些类型只为打开旧画布保留：不进任何新建菜单、没有连接点、不作为素材、不参与生成，
 * 内容区统一显示「已下线」占位，节点数据原样保存。
 */
export const RETIRED_ECOMMERCE_NODE_NAMES = {
    [CanvasNodeType.EcommerceStudio]: "电商生图台",
    [CanvasNodeType.Product]: "商品",
    [CanvasNodeType.ShotRecipe]: "拍法",
    [CanvasNodeType.SellingPoint]: "卖点",
    [CanvasNodeType.Copy]: "文案",
    [CanvasNodeType.Style]: "品牌风格",
    [CanvasNodeType.Layout]: "排版",
    [CanvasNodeType.Infographic]: "信息图",
    [CanvasNodeType.Replica]: "爆款复刻",
    [CanvasNodeType.Teardown]: "竞品拆解",
    [CanvasNodeType.Delivery]: "交付",
    [CanvasNodeType.Revision]: "改稿",
    [CanvasNodeType.EcommerceVideo]: "电商视频",
    [CanvasNodeType.Aplus]: "A+ 内容",
} as const satisfies Partial<Record<CanvasNodeType, string>>;

export type RetiredEcommerceNodeType = keyof typeof RETIRED_ECOMMERCE_NODE_NAMES;

export function isRetiredEcommerceNodeType(type: string): type is RetiredEcommerceNodeType {
    return Object.prototype.hasOwnProperty.call(RETIRED_ECOMMERCE_NODE_NAMES, type);
}

/** 旧电商创作表：带 ecommerceFlowId 的批量创作表。它的行是电商套图方案，不能按普通批量表运行。 */
export function isRetiredEcommerceTable(node: Pick<CanvasNodeData, "type" | "metadata">) {
    return node.type === CanvasNodeType.BatchTable && Boolean(node.metadata?.ecommerceFlowId);
}

/** 已下线的电商节点：不可连线、不参与生成、不打开提示词面板。 */
export function isRetiredEcommerceNode(node: Pick<CanvasNodeData, "type" | "metadata"> | null | undefined): boolean {
    return Boolean(node && (isRetiredEcommerceNodeType(node.type) || isRetiredEcommerceTable(node)));
}

/** 占位里展示的原节点类型名。 */
export function retiredEcommerceNodeName(node: Pick<CanvasNodeData, "type" | "metadata">) {
    if (isRetiredEcommerceTable(node)) return "电商创作表";
    return isRetiredEcommerceNodeType(node.type) ? RETIRED_ECOMMERCE_NODE_NAMES[node.type] : node.type;
}
