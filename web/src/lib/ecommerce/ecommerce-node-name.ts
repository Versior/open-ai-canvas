/**
 * 电商节点的名字存在哪。
 *
 * 每个电商节点在自己的 metadata 里各有一个名字字段（商品档案的 `name`、
 * 拍法清单的 `name`、版式的 `name`……），卡片标题优先显示它、拿 `node.title` 兜底。
 *
 * 所以**改名字必须写到那个字段上**。只改 `node.title` 的话卡片上的字一个字都不会变，
 * 用户看到的就是「节点不支持改名」——这一条踩过一次，别再踩第二次。
 */
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId } from "@/types/canvas";

/** 节点类型 → 持有 name 的 metadata 字段。没有名字字段的类型不进表。 */
const NAME_FIELD_BY_TYPE: Partial<Record<CanvasNodeTypeId, keyof CanvasNodeMetadata>> = {
    [CanvasNodeType.Product]: "productProfile",
    [CanvasNodeType.ShotRecipe]: "shotSet",
    [CanvasNodeType.Layout]: "ecommerceLayout",
    [CanvasNodeType.Replica]: "ecommerceReplica",
    [CanvasNodeType.Infographic]: "ecommerceInfographic",
    [CanvasNodeType.EcommerceVideo]: "ecommerceVideo",
    [CanvasNodeType.Delivery]: "ecommerceDelivery",
    [CanvasNodeType.Aplus]: "ecommerceAplus",
    [CanvasNodeType.Teardown]: "ecommerceTeardown",
    [CanvasNodeType.Style]: "ecommerceStyle",
    [CanvasNodeType.Copy]: "ecommerceCopy",
};

/** 卡片标题上该显示的名字。 */
export function ecommerceNodeName(node: CanvasNodeData) {
    const field = NAME_FIELD_BY_TYPE[node.type];
    const holder = field ? node.metadata?.[field] : undefined;
    const name = holder && typeof holder === "object" ? (holder as { name?: unknown }).name : undefined;
    return (typeof name === "string" && name.trim()) || (node.title || "").trim();
}

/**
 * 改名的 metadata 补丁。
 *
 * 同时给出 `title` 与领域字段：`title` 是画布上那个通用抬头（外部标题、节点清单、
 * 搜索都读它），领域字段是卡片里那个大标题。两个都写才叫「改了个名字」——
 * 只写一个，另一个地方还是旧名字，用户会以为改名没生效。
 */
export function ecommerceNodeRenamePatch(node: CanvasNodeData, title: string): { title?: string; metadata?: CanvasNodeMetadata } {
    const clean = title.trim();
    if (!clean) return {};
    const field = NAME_FIELD_BY_TYPE[node.type];
    const holder = field ? node.metadata?.[field] : undefined;
    if (field && holder && typeof holder === "object") {
        return { title: clean, metadata: { [field]: { ...holder, name: clean } } as CanvasNodeMetadata };
    }
    return { title: clean };
}
