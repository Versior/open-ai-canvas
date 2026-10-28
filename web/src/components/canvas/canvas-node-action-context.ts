import { createContext, useContext } from "react";

import type { EcommerceModelPreset } from "@/lib/ecommerce/ecommerce-models";
import type { EcommerceOneClickFlowId } from "@/lib/ecommerce/ecommerce-oneclick";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasWorkspaceMode } from "@/types/canvas";

// 批次子图操作条（下载/创建副本/删除）与主图位下载需要调用画布级动作，
// 但画布节点经 CanvasProjectWorldLayers 渲染、不便逐个透传 handler，
// 通过 Context 注入，避免改动 world-layers。无 Provider 时静默降级为 no-op。
export type CanvasNodeActionContextValue = {
    workspaceMode?: CanvasWorkspaceMode;
    stopEcommerceWorkbench?: () => void;
    isEcommerceWorkbenchRunning?: (nodeId: string) => boolean;
    runEcommerceWorkbench?: (request: import("@/lib/ecommerce/ecommerce-capabilities").EcommerceWorkbenchRequest) => Promise<string>;
    openEcommerceWorkbench?: (node: CanvasNodeData, capability?: import("@/lib/ecommerce/ecommerce-capabilities").EcommerceCapability) => void;
    openEcommerceStudio?: (product: CanvasNodeData) => void;
    upload?: (node: CanvasNodeData) => void;
    viewImage?: (node: CanvasNodeData) => void;
    focusNode?: (nodeId: string) => void;
    addEcommerceReference?: (product: CanvasNodeData) => void;
    addEcommerceInput?: (product: CanvasNodeData, handle: string) => void;
    connectEcommerceInput?: (event: React.PointerEvent, nodeId: string, handle: string) => void;
    dropEcommerceInput?: (event: React.PointerEvent, nodeId: string, handle: string) => void;
    disconnectEcommerceInput?: (nodeId: string, handle: string, sourceId: string) => void;
    updateEcommerceInputAnchor?: (nodeId: string, handle: string, anchorRatio: number, anchorXRatio: number) => void;
    download?: (node: CanvasNodeData) => void;
    duplicate?: (node: CanvasNodeData) => void;
    deleteNode?: (node: CanvasNodeData) => void;
    /** 合并式更新节点 metadata；扩展节点（如调色）在自己的面板里改参数时用。 */
    updateMetadata?: (nodeId: string, patch: CanvasNodeMetadata) => void;
    /** 更新单个节点；媒体尺寸回写使用它，避免触发全量节点时间戳归并。 */
    updateNode?: (nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => void;
    /** 合并延迟提交媒体测量结果，避免首屏图片同时解码时反复刷新画布。 */
    updateMediaNode?: (nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData) => void;
    /** 改节点宽高；图片首次量到真实尺寸后按比例校正节点用。 */
    resizeNode?: (nodeId: string, size: { width: number; height: number }) => void;
    /** 打开节点级肖像排查工作台；任务生命周期由画布页面持有。 */
    /** 打开节点级 AI 审美批改报告。 */
    openArtCritique?: (node: CanvasNodeData) => void;
    /** 全景节点导出截图：上传 dataUrl 并在源节点右侧创建派生图片节点。 */
    addPanoramaCaptureNode?: (node: CanvasNodeData, dataUrl: string, title: string) => Promise<void> | void;
    /** 电商创作：按物料方案从商品节点长出下游节点，不预铺。 */
    spawnEcommerceMaterials?: (node: CanvasNodeData, planId: string) => Promise<void> | void;
    /** 电商创作：铺一套物料并推入生成队列——铺完再一张张点生成是这条流程里最蠢的一段。 */
    generateEcommerceMaterials?: (node: CanvasNodeData, planId: string) => Promise<void> | void;
    /** 电商创作：把排版节点合成成成品图并导出为新图片节点。 */
    exportEcommerceLayout?: (node: CanvasNodeData, dataUrl: string, title: string) => Promise<void> | void;
    /**
     * 从图片节点起一条「读图 → 出结论」的支线：建一个指令文本节点 + 一个结果节点。
     * 竞品拆解用它把同一张竞品图问成结构大纲，而不是问成生图提示词。
     */
    reversePromptFromNode?: (node: CanvasNodeData, prompt: string) => Promise<void> | void;
    /**
     * 把节点交给画布助手并附上一条准备好的指令——「让助手起草档案/卖点/文案」走这条路。
     * 用户点一下就有活干，不用自己描述要助手做什么。
     */
    draftWithAgent?: (node: CanvasNodeData, instruction: string) => void;
    /** 创建或定位当前商品、用途对应的已连线创作表。 */
    openEcommerceTable?: (node: CanvasNodeData, flowId: EcommerceOneClickFlowId) => void;
    openEcommerceTableFromOutline?: (teardownNode: CanvasNodeData, productNode: CanvasNodeData, rows: import("@/lib/ecommerce/ecommerce-suite").EcommerceSuiteRow[]) => void;
    /**
     * 电商创作：按创作表出图。
     *
     * 铺产物节点（只铺表里真有提示词的那几行，保留旧图）、把每行的提示词
     * 与参数写进对应节点、提交生成。出完由装订链路接手。
     *
     * 传 `slotIds` 就只出那几行——面板里每张旁边那个「出这一张」走的就是这条路。
     *
     * 为什么节点在出图时才铺：上一版点一下先铺九屏，用户看到的是一堆还没出图的
     * 空方块，还得自己在画布上找哪块对应哪张。过程是那张表，不是画布上的方块。
     */
    generateEcommerceSuite?: (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, slotIds?: string[], rows?: import("@/lib/ecommerce/ecommerce-suite").EcommerceSuiteRow[], completeSuite?: boolean) => Promise<boolean> | boolean;
    /**
     * 电商创作：分析商品，为这一套的每一张写一条完整的出图提示词。
     *
     * 单位是**一张图一条提示词**，不是一张图一句话——主图画什么、模特上身图画什么、
     * 细节图画什么，构图光线景别全不一样。结果落进创作表节点的 `ecommerceSuite`，
     * 在画布内逐行审核。
     *
     * `analysisModel` 是面板上选的分析模型：分析要读图、出图不用，
     * 两者常常不是同一个模型，而全局配置只有一个。
     */
    draftEcommerceSuite?: (
        node: CanvasNodeData,
        flowId: EcommerceOneClickFlowId,
        analysisModel?: string,
        rows?: import("@/lib/ecommerce/ecommerce-suite").EcommerceSuiteRow[],
    ) => Promise<import("@/lib/ecommerce/ecommerce-suite").EcommerceSuiteRow[] | undefined> | void;
    reverseEcommerceSuite?: (node: CanvasNodeData, flowId: EcommerceOneClickFlowId, analysisModel?: string) => Promise<unknown> | void;
    bindEcommerceSuite?: (node: CanvasNodeData, rows: import("@/lib/ecommerce/ecommerce-suite").EcommerceSuiteRow[]) => Promise<void>;
    /**
     * 电商创作：读商品实拍起草商品档案。
     *
     * **读的是图**——所以商品实拍必须真的递进模型（见 runEcommerceTextDraft），
     * 并且要确认配置的文本模型看得了图。少了任何一条，用户拿到的都是一句
     * 「未挂载视觉查看工具」而不是档案。
     */
    draftEcommerceProfile?: (node: CanvasNodeData) => Promise<unknown> | void;
    /**
     * 电商创作：把画布上的一张图存进模特库。
     *
     * 这是模特库最主要的入口——设计师手上的人大多是从某次生成里挑出来的，
     * 不是从硬盘里找出来的。所以它挂在图片节点上，不只在库的弹窗里。
     */
    saveImageAsModel?: (node: CanvasNodeData) => void;
    /**
     * 电商创作：公共起手式出一张模特参考图。
     *
     * 在画布上落一个图片节点再提交生成，而不是在弹窗里悄悄出一张塞进库：
     * 出图要花积分，用户得看得见它、能重出、能删。
     */
    generateEcommerceModelPreset?: (preset: EcommerceModelPreset) => Promise<void> | void;
    /**
     * 电商节点走生成链路。
     *
     * 项目里所有产出都是**提示词 → API 模型**：节点负责把结构化配置编译成提示词，
     * 出图出片交给模型。上游连进来的图自动成为参考图，结果落成新的图片/视频节点。
     * 所以节点上不需要任何本地合成——合成是模型的事。
     */
    generateEcommerceNode?: (node: CanvasNodeData, mode: "image" | "video", prompt: string) => Promise<void> | void;
    /**
     * 电商创作：把拍法清单整组出图。
     *
     * 传 shotIds 只出这几行，不传就出整张清单。缺的产物节点先补齐再进队列——
     * 清单是提示词的来源，如果它不能一键出图，那这张清单就只是张好看的表格。
     */
    generateEcommerceShotSet?: (node: CanvasNodeData, shotIds?: string[]) => Promise<void> | void;
    /**
     * 电商创作：一键详情页——长图落成一张图片节点，切片各落成一张。
     *
     * 产物直接进画布而不是弹下载：用户要的是能上传的片，看得见、能逐张核对、
     * 能接着连进改稿或交付。给一句「已导出」等于把核对这一步推给用户自己找文件。
     */
    exportEcommerceDetailPage?: (node: CanvasNodeData, longImageDataUrl: string, pieces: { index: number; top: number; height: number; dataUrl: string }[], fileNames: string[], validateSource?: () => void) => Promise<void> | void;
    extractLayerMaterials?: (node: CanvasNodeData) => Promise<void> | void;
    /** 打开媒体版本面板；只读页面不提供，节点角标随之隐藏。 */
    openMediaVersions?: (node: CanvasNodeData) => void;
};

export const CanvasNodeActionContext = createContext<CanvasNodeActionContextValue>({});

export function useCanvasNodeActions() {
    return useContext(CanvasNodeActionContext);
}
