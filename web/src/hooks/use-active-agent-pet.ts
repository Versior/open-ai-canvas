import { useQuery, type QueryClient } from "@tanstack/react-query";

import { getAgentPetSelection, type AgentPet } from "@/services/api/agent-pets";
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
