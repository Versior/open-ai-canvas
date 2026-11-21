import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { appQueryClient } from "@/lib/query-client";
import { getActiveUserScope } from "@/lib/user-scope";
import { getAgentMemoryRevisionStatuses, type AgentMemoryRevisionStatus } from "@/services/api/agent-memory";

const statusKey = (scope: string) => ["agent-memory-revision-statuses", scope] as const;
export type MemoryCardStatus = AgentMemoryRevisionStatus | "checking" | "error";

export function useAgentMemoryRevisionStatuses(ids: string[]) {
    const scope = getActiveUserScope();
    const query = useQuery(
        {
            queryKey: [...statusKey(scope), ids],
            queryFn: ({ signal }) => getAgentMemoryRevisionStatuses(ids, signal),
            enabled: ids.length > 0,
            staleTime: 0,
            refetchOnMount: "always",
            refetchOnWindowFocus: "always",
            refetchInterval: (query) => (Object.values(query.state.data ?? {}).some((status) => status === "pending" || status === "applied") ? 30_000 : false),
        },
        appQueryClient,
    );
    const { refetch } = query;
    const retry = useCallback(() => {
        void refetch({ cancelRefetch: false });
    }, [refetch]);
    const statusFor = (id: string): MemoryCardStatus => {
        if (!id) return "unavailable";
        if (query.isError || query.isPaused) return "error";
        if (!query.isFetchedAfterMount && query.isFetching) return "checking";
        return query.data?.[id] ?? "checking";
    };
    return { statusFor, retry };
}

export async function publishMemoryRevisionStatus(scope: string, id: string, status: "applied" | "undone" | "rejected") {
    if (getActiveUserScope() !== scope) return;
    const matching = { queryKey: statusKey(scope), predicate: (query: { queryKey: readonly unknown[] }) => Array.isArray(query.queryKey[2]) && query.queryKey[2].includes(id) };
    await appQueryClient.cancelQueries(matching);
    appQueryClient.setQueriesData<Record<string, AgentMemoryRevisionStatus>>(matching, (current) => (current ? { ...current, [id]: status } : undefined));
    void appQueryClient.invalidateQueries(matching);
}
