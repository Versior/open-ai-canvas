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
    /**
     * 电商画布现在只有一个节点：商品。
     *
     * 另外十二个（拍法 / 卖点 / 文案 / 风格 / 排版 / 信息图 / 复刻 / 拆解 / A+ /
     * 视频 / 改稿 / 交付）暂时从菜单里去掉了。原因不是它们不好，是**它们把
     * 「一步能做完的事」拆成了十几个节点让用户自己接**：铺九屏、连文案、连排版、
     * 逐张点生成、等九张出完、再逐张叠字、再拼长图、再切片。每一步都「可配置」，
     * 合起来是一条没人走得完的流水线。
     *
     * 它们的内容改挂在商品节点上（套图提示词表 `ecommerceSuite`、流程状态
     * `ecommerceOneClick`、版式按屏给），入口收成商品节点上的一排套图按钮：
     * 点开一张表，一行一张图一条完整提示词，核对过再批量生成。
     * 节点实现都还在，老画布照常渲染——要放回来只改这张表。
     */
    nodeCommand(CanvasNodeType.Product, { badge: "电商", defaultOrder: 67, applicable: ecommerceOnly, group: "电商", run: (ctx) => ctx.handlers.onAddExtensionNode(CanvasNodeType.Product) }),
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
