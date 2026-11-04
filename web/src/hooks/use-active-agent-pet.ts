import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useCallback } from "react";

import { getAgentPetSelection, selectAgentPet, type AgentPet } from "@/services/api/agent-pets";
import { useUserStore } from "@/stores/use-user-store";

const agentPetSelectionQueryKey = (userId: string) => ["agent-pet-selection", userId] as const;
export const agentPetCatalogQueryKey = (userId: string) => ["agent-pet-catalog", userId] as const;

/**
 * 当前用户在服务端选择的智能体形象。未登录、未选择或读取失败时为 null，入口回到站点默认形象。
 * pending 只在已登录且首次读取未完成时为 true，用于避免先闪一下默认形象。
 */
export function useActiveAgentPet() {
    const userId = useUserStore((state) => state.user?.id || "");
    const query = useQuery({
        queryKey: agentPetSelectionQueryKey(userId),
        queryFn: ({ signal }) => getAgentPetSelection(signal),
        enabled: Boolean(userId),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
    return { pet: query.data ?? null, pending: Boolean(userId) && query.isPending };
}

/** 换装或购买后同步入口形象和形象列表，不必等下一次请求。 */
export function publishActiveAgentPet(queryClient: QueryClient, userId: string, pet: AgentPet | null) {
    queryClient.setQueryData(agentPetSelectionQueryKey(userId), pet);
    void queryClient.invalidateQueries({ queryKey: agentPetCatalogQueryKey(userId) });
}

/**
 * 换上形象（null 为默认形象）：保存到服务端并同步入口和列表；累计消费达标的形象在这一步领取。
 * 失败时提示原因并刷新列表。返回是否成功。
 */
export function useApplyAgentPet() {
    const userId = useUserStore((state) => state.user?.id || "");
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    return useCallback(
        async (pet: AgentPet | null) => {
            try {
                const selected = await selectAgentPet(pet?.id ?? "");
                publishActiveAgentPet(queryClient, userId, selected);
                message.success(selected ? `${pet?.claimable ? "已领取并换上" : "已换成"}「${selected.name}」` : "已恢复默认形象");
                return true;
            } catch (cause) {
                message.error(cause instanceof Error ? cause.message : "形象切换失败，请稍后重试");
                void queryClient.invalidateQueries({ queryKey: agentPetCatalogQueryKey(userId) });
                return false;
            }
        },
        [message, queryClient, userId],
    );
}
