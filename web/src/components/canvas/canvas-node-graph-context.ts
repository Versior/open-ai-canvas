import { createContext, useContext } from "react";

import type { CanvasNodeData } from "@/types/canvas";

// 扩展节点（对比/图表/调色等）要读自己的上游才能工作，但节点经 CanvasProjectWorldLayers
// 渲染、CanvasNodeContentProps 里只有 node 本身，没有 nodes/connections。
// 与 canvas-node-action-context 同一个理由：通过 Context 注入，避免改动 world-layers 的透传链。
// 无 Provider 时静默降级为「没有上游」，节点自行显示空状态而不是崩。
export type CanvasNodeGraphContextValue = {
    getUpstreamNodes?: (nodeId: string) => CanvasNodeData[];
    /**
     * 该节点下游的素材节点。
     *
     * 改稿节点要用它：生成的下一版落在**下游**（改稿自己不产出媒体），
     * 而版本链要记的正是那些新图。只读上游的话，用户出完图回来发现
     * 下拉框里没有刚出的那张，只能手动再连一次线。
     */
    getDownstreamNodes?: (nodeId: string) => CanvasNodeData[];
};

export const CanvasNodeGraphContext = createContext<CanvasNodeGraphContextValue>({});

/** 取该节点的直接上游素材节点；无 Provider 或无上游时返回空数组。 */
export function useUpstreamNodes(nodeId: string) {
    const { getUpstreamNodes } = useContext(CanvasNodeGraphContext);
    return getUpstreamNodes?.(nodeId) ?? [];
}

/** 取该节点的直接下游素材节点；无 Provider 或无下游时返回空数组。 */
export function useDownstreamNodes(nodeId: string) {
    const { getDownstreamNodes } = useContext(CanvasNodeGraphContext);
    return getDownstreamNodes?.(nodeId) ?? [];
}
