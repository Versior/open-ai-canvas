import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { systemModelQuoteRequest, formatPriceRange, modelQuoteDescription, priceTiersForCurrentSelection } from "@/lib/model-pricing";
import { taskBillingLabel, taskBillingTotals } from "@/lib/generation-task-billing";
import type { ModelRequirements } from "@/lib/model-selection";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { queryGenerationTask } from "@/services/api/task-center";
import { modelDisplayName, modelOptionName, resolveModelChannel, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
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
    if (!enabled) return null;
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const tiers = cost?.pricePolicy === "channel" ? priceTiersForCurrentSelection(cost.logicalPriceTiers || [], capability, config, requirements) : cost ? [cost] : [];
    const tokenTiers = tiers.filter((item) => item.billingMode === "token");
    const rates = (field: "inputTokenPriceMicrocredits" | "outputTokenPriceMicrocredits") =>
        tokenTiers
            .map((tier) => tier[field])
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
            .map((value) => value / 1_000_000);
    const input = rates("inputTokenPriceMicrocredits"),
        output = rates("outputTokenPriceMicrocredits");
    return (
        <div className="generation-cost-notice" role="status" style={{ fontSize: "var(--fs-caption)", lineHeight: 1.6, padding: "var(--space-2) 0", color: "inherit", overflowWrap: "anywhere" }}>
            <div>
                {label} · {model ? modelDisplayName(config, model) : "请选择模型"} · {count} {capability === "image" ? "张" : capability === "video" ? "个片段" : "次"}
            </div>
            <div>{error ? `无法估算：${error}` : quote ? `预计总积分 ${((quote.amountMicrocredits * count) / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })}${quote.estimated ? "（估算）" : ""}` : "正在计算积分…"}</div>
            {capability === "text" && tokenTiers.length ? (
                <div>
                    每百万 Token：输入 {input.length ? formatPriceRange(input, "积分") : "单价未配置"} · 输出 {output.length ? formatPriceRange(output, "积分") : "单价未配置"}
                </div>
            ) : null}
            <details>
                <summary>计费依据与退回说明</summary>
                {capability === "text" ? <div>预算按服务端预授权规则估算，完整上下文、输出长度与工具调用尚未确定。</div> : null}
                <div>{quote ? modelQuoteDescription(quote) : "报价不可用不代表 0 积分。"} 最终实收、失败退回和差额退回以任务结算为准。</div>
            </details>
        </div>
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
    const billings = query.data?.flatMap((task) => (task.billing ? [task.billing] : [])) || [];
    return (
        <div className="task-settlement" role="status" style={{ fontSize: "var(--fs-caption)", lineHeight: 1.6, padding: "var(--space-2) 0", color: "inherit" }}>
            {query.isError ? (
                "结算状态暂时无法读取"
            ) : query.data ? (
                <>
                    {taskBillingTotals(billings).map((label) => (
                        <div key={label}>{label}</div>
                    ))}
                    {billings.length < query.data.length ? <div>{query.data.length - billings.length} 个任务未返回平台结算信息</div> : null}
                    {query.data.length > 1 ? (
                        <details>
                            <summary>逐个任务结算</summary>
                            {query.data.map((task, index) => (
                                <div key={task.id}>
                                    任务 {index + 1} · {task.billing ? taskBillingLabel(task.billing) : "未返回平台结算信息"}
                                </div>
                            ))}
                        </details>
                    ) : null}
                </>
            ) : (
                "正在读取实际结算…"
            )}
        </div>
    );
}
