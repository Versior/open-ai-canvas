import { Folder, FolderOpen, Layers3, Palette, UploadCloud, UserRound, Workflow } from "lucide-react";

import { getNodeIcon, getNodeLabel } from "@/lib/canvas/node-registry";
import type { CanvasKind } from "@/lib/canvas/canvas-kind";
import { registerAddNodeMenuCommands, type AddNodeMenuCommand, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";
import { CanvasNodeType } from "@/types/canvas";

/** 真正创建节点的命令，文案与图标统一取自节点注册表。 */
function nodeCommand(type: CanvasNodeType, rest: Omit<AddNodeMenuCommand, "id" | "label" | "icon" | "section">): AddNodeMenuCommand {
    return { id: type, label: getNodeLabel(type), icon: getNodeIcon(type), section: "node", ...rest };
}

/**
 * 电商节点只在电商创作画布里出现。
 *
 * 两边不是同一个产品的子集，是两套工作流：自由画布上摆一个「商品」节点，
 * 用户会以为要先填商品档案才能出图。缺省（ctx.canvasKind 未提供）按自由画布处理——
 * 宁可少显示，也不该把电商节点漏进自由画布。
 */
const ecommerceOnly = (ctx: AddNodeMenuContext) => ctx.canvasKind === "ecommerce";

/** 影视侧的节点与工作台不进电商画布：预演台是 3D 场景，对商品不适用。 */
const filmOnly = (ctx: AddNodeMenuContext) => ctx.canvasKind !== "ecommerce";

export const addNodeMenuCommands: AddNodeMenuCommand[] = [
    // 项目级动作不占用节点网格，创作节点保持统一排列。
    { id: "style", label: "项目画风", icon: <Palette />, section: "project", defaultOrder: 10, applicable: (ctx) => !ctx.isProjectLinked && filmOnly(ctx), run: (ctx) => ctx.handlers.onChooseStyle() },
    // 创作节点
    nodeCommand(CanvasNodeType.Text, { defaultOrder: 10, run: (ctx) => ctx.handlers.onAddText() }),
    nodeCommand(CanvasNodeType.Drawing, { defaultOrder: 20, run: (ctx) => ctx.handlers.onAddDrawing() }),
    nodeCommand(CanvasNodeType.Script, { badge: "核心", defaultOrder: 30, applicable: filmOnly, run: (ctx) => ctx.handlers.onAddScript() }),
    nodeCommand(CanvasNodeType.Frame, { defaultOrder: 40, applicable: (ctx) => ctx.workspaceMode !== "simple", run: (ctx) => ctx.handlers.onAddFrame() }),
    { id: "folder", label: "文件夹", icon: <Folder />, badge: "6 款", section: "node", defaultOrder: 45, run: (ctx) => ctx.handlers.onAddFolder() },
    nodeCommand(CanvasNodeType.Image, { defaultOrder: 50, run: (ctx) => ctx.handlers.onAddImage() }),
    { id: "project-character", label: "角色卡", icon: <UserRound />, section: "node", defaultOrder: 55, applicable: filmOnly, run: (ctx) => ctx.handlers.onOpenProjectCharacters() },
    nodeCommand(CanvasNodeType.Video, { defaultOrder: 60, run: (ctx) => ctx.handlers.onAddVideo() }),
    nodeCommand(CanvasNodeType.BatchTable, { defaultOrder: 66, run: (ctx) => ctx.handlers.onAddExtensionNode(CanvasNodeType.BatchTable) }),
    nodeCommand(CanvasNodeType.EcommerceStudio, { defaultOrder: 67, applicable: ecommerceOnly, run: (ctx) => ctx.handlers.onAddExtensionNode(CanvasNodeType.EcommerceStudio) }),
    // 商品与创作表承担套图主流程；专业节点按需添加，不自动铺满画布。
    ...(
        [
            [CanvasNodeType.Product, "商品信息"],
            [CanvasNodeType.SellingPoint, "商品信息"],
            [CanvasNodeType.Copy, "商品信息"],
            [CanvasNodeType.Style, "商品信息"],
            [CanvasNodeType.ShotRecipe, "画面制作"],
            [CanvasNodeType.Layout, "画面制作"],
            [CanvasNodeType.Infographic, "画面制作"],
            [CanvasNodeType.Aplus, "画面制作"],
            [CanvasNodeType.EcommerceVideo, "画面制作"],
            [CanvasNodeType.Replica, "参考分析"],
            [CanvasNodeType.Teardown, "参考分析"],
            [CanvasNodeType.Revision, "修改交付"],
            [CanvasNodeType.Delivery, "修改交付"],
        ] as const
    ).map(([type, group], index) => nodeCommand(type, { defaultOrder: 100 + index, applicable: ecommerceOnly, group, run: (ctx) => ctx.handlers.onAddExtensionNode(type) })),
    nodeCommand(CanvasNodeType.MediaConversion, { badge: "本地", defaultOrder: 65, run: (ctx) => ctx.handlers.onAddExtensionNode(CanvasNodeType.MediaConversion) }),
    // 预演台落在节点分区，但它开的是导演工作台、不是某种画布节点，故不走注册表。
    { id: "previs", label: "预演台", icon: <Layers3 />, badge: "3D", section: "node", defaultOrder: 70, applicable: (ctx) => ctx.workspaceMode !== "simple" && filmOnly(ctx), run: (ctx) => ctx.handlers.onOpenPrevis() },
    nodeCommand(CanvasNodeType.Audio, { defaultOrder: 80, applicable: (ctx) => ctx.workspaceMode !== "simple" && filmOnly(ctx), run: (ctx) => ctx.handlers.onAddAudio() }),
    // 云端和本地工作流共用独立配置节点，不进入基础模型节点的渠道选择。
    { id: "workflow", label: "工作流", icon: <Workflow />, section: "workflow", defaultOrder: 10, applicable: (ctx) => ctx.workspaceMode !== "simple", run: (ctx) => ctx.handlers.onAddWorkflow() },
    // 导入资源
    { id: "upload", label: "上传文件", icon: <UploadCloud />, section: "resource", defaultOrder: 10, run: (ctx) => ctx.handlers.onUpload() },
    { id: "assets", label: "素材库", icon: <FolderOpen />, section: "resource", defaultOrder: 30, applicable: (ctx) => !ctx.isProjectLinked, run: (ctx) => ctx.handlers.onOpenMyAssets() },
];

registerAddNodeMenuCommands(addNodeMenuCommands);
