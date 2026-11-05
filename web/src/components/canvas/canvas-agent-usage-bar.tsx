import { ChevronDown, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { formatContextTokens, type AgentContextPhase, type AgentContextUsageView } from "@/lib/canvas/agent-context-usage";
import { agentUsageDetails, agentUsageHeadline, formatAgentShare, type AgentRunStatsView, type AgentUsageItem } from "@/lib/canvas/agent-run-stats";

const AGENT_USAGE_EXPANDED_KEY = "canvas:agent-usage-expanded:v1";

const PHASE_BADGE: Partial<Record<AgentContextPhase, string>> = {
    unknown: "窗口未知",
    watch: "接近压缩",
    compress: "即将压缩",
    compacting: "正在压缩",
    stale: "压缩后待刷新",
};

function readExpanded() {
    try {
        return localStorage.getItem(AGENT_USAGE_EXPANDED_KEY) === "1";
    } catch {
        return false;
    }
}

/** 明细底部的来源说明：读数各自从哪来，哪些调用没有回传用量。 */
function usageNotes(view: AgentContextUsageView, stats: AgentRunStatsView | null | undefined) {
    const notes: string[] = [];
    if (view.tokenSource === "pi") notes.push("上下文是 Pi 会话估算，不是计费 Token");
    if (stats?.totalTokens !== undefined) notes.push("本轮用量与速度来自上游调用记录");
    const missing = stats ? stats.steps - stats.usageSteps : 0;
    if (stats && missing > 0) notes.push(stats.usageSteps ? `有 ${missing} 次模型调用上游没有回传用量，合计不含这些调用` : "上游没有回传这一轮的 token 用量");
    if (view.lastCompaction) notes.push("本轮已压缩过一次上下文，下一次读数会刷新");
    return notes;
}

function UsageTiles({ items }: { items: AgentUsageItem[] }) {
    return (
        <dl className="agent-usage-tiles">
            {items.map((item) => (
                <div key={item.key} title={item.title}>
                    <dt>{item.label}</dt>
                    <dd>
                        <strong>{item.value}</strong>
                        {item.detail ? <em>{item.detail}</em> : null}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * 输入框正上方的上下文与本轮用量。概览一直显示：上下文占用和本轮 token、速度、耗时、工具调用；
 * 「明细」展开剩余、压缩线、输入输出与缓存、模型与工具耗时。展开与否记在本机。还没有任何读数时不占位置。
 */
export function AgentUsageBar({ view, stats }: { view: AgentContextUsageView; stats?: AgentRunStatsView | null }) {
    const [expanded, setExpanded] = useState(readExpanded);
    const detailsId = useId();
    const headline = agentUsageHeadline(stats);
    const showContext = view.phase !== "idle";
    if (!showContext && !headline.length) return null;
    const details = agentUsageDetails(view, stats);
    const hasDetails = details.context.length > 0 || details.run.length > 0;
    const notes = usageNotes(view, stats);
    const ratio = view.ratio;
    const percent = ratio === undefined ? undefined : formatAgentShare(ratio);
    const fill = view.phase === "compacting" ? 1 : Math.max(0, Math.min(1, ratio ?? 0));
    const marker = view.compactRatio && view.compactRatio > 0 && view.compactRatio < 1 ? view.compactRatio : undefined;
    const badge = PHASE_BADGE[view.phase];
    const toggle = () => {
        const next = !expanded;
        setExpanded(next);
        try {
            if (next) localStorage.setItem(AGENT_USAGE_EXPANDED_KEY, "1");
            else localStorage.removeItem(AGENT_USAGE_EXPANDED_KEY);
        } catch (error) {
            console.warn("Agent 用量明细偏好无法保存", error);
        }
    };
    return (
        <section className={`agent-usage is-${view.phase}`} aria-label="上下文与本轮用量">
            <div className={`agent-usage-summary${showContext ? "" : " is-run-only"}`}>
                {showContext ? (
                    <span className="agent-usage-context" title={view.detail}>
                        <span>上下文</span>
                        {view.inputTokens !== undefined ? (
                            <span className="agent-usage-figure">
                                <strong>{formatContextTokens(view.inputTokens)}</strong>
                                {view.contextWindowTokens ? ` / ${formatContextTokens(view.contextWindowTokens)}` : null}
                            </span>
                        ) : null}
                        {ratio !== undefined || view.phase === "compacting" ? (
                            <span
                                className="agent-usage-meter"
                                role="progressbar"
                                aria-label={percent ? `上下文已用 ${percent}` : "上下文正在压缩"}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={ratio === undefined ? undefined : Math.round(ratio * 100)}
                            >
                                <span style={{ width: `${fill * 100}%` }} />
                                {marker ? <i style={{ left: `${marker * 100}%` }} aria-hidden="true" /> : null}
                            </span>
                        ) : null}
                        {percent ? <strong>{percent}</strong> : null}
                        {badge ? <span className="agent-usage-badge">{badge}</span> : null}
                    </span>
                ) : null}
                {headline.length ? (
                    <span className="agent-usage-metrics">
                        {headline.map((item) => (
                            <span key={item.key} className="agent-usage-metric" title={item.title}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                            </span>
                        ))}
                    </span>
                ) : null}
                {hasDetails ? (
                    <button type="button" className="agent-usage-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={toggle}>
                        明细
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                    </button>
                ) : null}
            </div>
            {view.compactionError ? (
                <p className="agent-usage-alert" role="status">
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                    {view.compactionError}
                </p>
            ) : null}
            {hasDetails ? (
                <div id={detailsId} className="agent-usage-details" hidden={!expanded}>
                    {details.context.length ? (
                        <div className="agent-usage-group">
                            <span className="agent-usage-eyebrow">上下文</span>
                            <UsageTiles items={details.context} />
                        </div>
                    ) : null}
                    {details.run.length ? (
                        <div className="agent-usage-group">
                            <span className="agent-usage-eyebrow">本轮</span>
                            <UsageTiles items={details.run} />
                        </div>
                    ) : null}
                    {notes.length ? <p className="agent-usage-note">{notes.join("；")}。</p> : null}
                </div>
            ) : null}
        </section>
    );
}
