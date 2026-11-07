import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCompactCredits } from "@/constant/credits";
import { systemModelQuoteRequest } from "@/lib/model-pricing";
import { taskBillingSummary } from "@/lib/generation-task-billing";
import type { ModelRequirements } from "@/lib/model-selection";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { queryGenerationTask } from "@/services/api/task-center";
import type { AiConfig, ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

/** 使用服务端实际分组与 SKU 报价，不把报价失败或未配置价格当免费。 */
export function GenerationCostNotice({ config, model, capability, requirements, count = 1, label = "本次操作" }: { config: AiConfig; model: string; capability: ModelCapability; requirements?: ModelRequirements; count?: number; label?: string }) {
    const enabled = useUserStore((state) => state.features.creditsEnabled);
    const userId = useUserStore((state) => state.user?.id || "");
    const [quote, setQuote] = useState<LogicalModelQuote>();
    const [error, setError] = useState("");
    const request = useMemo(() => systemModelQuoteRequest(config, model, capability, requirements), [config, model, capability, requirements]);
    const key = JSON.stringify(request);
    useEffect(() => {
        setQuote(undefined);
        setError("");
        if (!enabled || !model) return;
        if (!request) {
            setError("当前模型无法取得平台报价");
            return;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void quoteModel(request, controller.signal)
                .then(({ quote: value }) => {
                    if (!controller.signal.aborted) setQuote(value);
                })
                .catch((cause) => {
                    if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "报价服务暂不可用");
                });
        }, 400);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [enabled, key, model, userId]);
    if (!enabled || !model) return null;
    const notice = error ? "暂无法估算积分" : quote ? `预计约 ${formatCompactCredits(quote.amountMicrocredits * count)} 积分` : "正在估算积分…";
    return (
        <span className="generation-cost-notice" role="status" aria-label={`${label}：${notice}`} style={{ fontSize: "var(--fs-caption)", lineHeight: 1.5, color: "var(--muted-foreground)" }}>
            {notice}
        </span>
    );
}

/** 读取任务的真实账务状态，历史页面同样可恢复，不根据余额差计算收费。 */
export function TaskSettlement({ ids }: { ids: readonly string[] }) {
    const user = useUserStore((state) => state.user?.id || "");
    const enabled = useUserStore((state) => state.features.creditsEnabled);
    const key = [...new Set(ids.filter(Boolean))];
    const query = useQuery({
        queryKey: ["task-settlement", user, key],
        enabled: enabled && Boolean(user) && key.length > 0,
        queryFn: async ({ signal }) => {
            const tasks = [];
            for (let start = 0; start < key.length; start += 8) tasks.push(...(await Promise.all(key.slice(start, start + 8).map((id) => queryGenerationTask(id, { signal })))));
            return tasks;
        },
        refetchInterval: (query) => (query.state.data?.some((task) => task.status === "queued" || task.status === "running" || task.billing?.status === "reserved" || task.billing?.status === "running") ? 5000 : false),
    });
    if (!enabled || !key.length) return null;
    const summary = taskBillingSummary(query.data?.flatMap((task) => (task.billing ? [task.billing] : [])) || []);
    if (!summary) return null;
    return (
        <div className="task-settlement" role="status" style={{ fontSize: "var(--fs-caption)", lineHeight: 1.5, color: "var(--muted-foreground)" }}>
            {summary}
        </div>
    );
}
