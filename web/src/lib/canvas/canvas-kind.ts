/**
 * 画布的种类。
 *
 * 影策有两类画布，它们**互不影响**：
 * - `freeform`：自由画布。影视、短剧、通用创作走这条，节点是文本/图片/视频/剧本/预演台那一套。
 * - `ecommerce`：电商创作画布。商品、拍法、卖点、排版、A+ 那十三个节点只在这里出现。
 *
 * 为什么必须分开，而不是「都能用」：
 *
 * 两边的节点集不是同一个产品的子集，是**两套工作流**。自由画布上摆一个「商品」节点，
 * 用户会以为要先填商品档案才能出图；电商画布上摆「预演台」，用户会以为要搭 3D 场景。
 * 混在一起不是「功能更多」，是把两条流程的入口都搞模糊了。
 *
 * 所以隔离是双向的：电商节点不进自由画布的菜单，预演台/剧本/分镜也不进电商画布。
 * 判据只有一个来源——这张画布的 `kind`，不靠节点数量或标题猜。
 */
export type CanvasKind = "freeform" | "ecommerce";

/** 缺省是自由画布：老数据没有 kind 字段，它们是自由画布。 */
export function resolveCanvasKind(kind: CanvasKind | undefined): CanvasKind {
    return kind === "ecommerce" ? "ecommerce" : "freeform";
}

export function isEcommerceCanvas(kind: CanvasKind | undefined) {
    return resolveCanvasKind(kind) === "ecommerce";
}
