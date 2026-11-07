import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { AGENT_CONTEXT_COMPACT_RATIO, formatContextTokens, type AgentContextPhase, type AgentContextUsageView } from "@/lib/canvas/agent-context-usage";
import { AGENT_USAGE_NO_READING, agentUsageDetails, agentUsageStats, agentUsageSummary, formatAgentShare, type AgentRunStatsView, type AgentUsageItem } from "@/lib/canvas/agent-run-stats";

const AGENT_USAGE_EXPANDED_KEY = "canvas:agent-usage-expanded:v1";
/** 整张卡片展开与否；默认收起成一行。 */
const AGENT_USAGE_CARD_KEY = "canvas:agent-usage-card:v1";

const PHASE_BADGE: Partial<Record<AgentContextPhase, string>> = {
    unknown: "窗口未知",
    watch: "接近压缩",
    compress: "即将压缩",
    compacting: "正在压缩",
    stale: "压缩后待刷新",
};

function readFlag(key: string) {
    try {
        return localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function writeFlag(key: string, value: boolean) {
    try {
        if (value) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
    } catch (error) {
        console.warn("Agent 用量栏偏好无法保存", error);
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
 * 输入框正上方的上下文与本轮用量。默认收起成一行：迷你进度条、已用 / 窗口、占比、阶段和本轮摘要，点一下展开整张卡片：
 * - 第一行：上下文已用 / 窗口、占比、阶段，右侧是当前模型、「明细」和收起；
 * - 进度条带自动压缩线，下方写剩余和压缩线位置（还没有读数时写下一步会发生什么）；
 * - 本轮五项：token、缓存命中、速度、耗时、工具调用，没有的项显示「—」。
 * 新一轮的读数还没回来时沿用同一对话上一轮的上下文读数并标「上一轮」；卡片和「明细」展开与否都记在本机。
 */
export function AgentUsageBar({
    view,
    stats,
    running = false,
    hasRun = false,
    carried = false,
    contextWindow,
    modelLabel,
}: {
    view: AgentContextUsageView;
    stats?: AgentRunStatsView | null;
    /** 当前轮次还在进行。 */
    running?: boolean;
    /** 当前对话已经有轮次（刷新后读数补读完成前、或首个读数前就结束的轮次）。 */
    hasRun?: boolean;
    /** view 是同一对话上一轮的读数（这一轮的还没到）。 */
    carried?: boolean;
    /** 所选模型声明的上下文窗口，没有读数时用来提示。 */
    contextWindow?: number;
    /** 当前选择的模型名；面板窄时输入框下方的模型按钮只剩图标，这里写全。 */
    modelLabel?: string;
}) {
    const [cardOpen, setCardOpen] = useState(() => readFlag(AGENT_USAGE_CARD_KEY));
    const [expanded, setExpanded] = useState(() => readFlag(AGENT_USAGE_CARD_KEY) && readFlag(AGENT_USAGE_EXPANDED_KEY));
    const detailsId = useId();
    const measured = view.phase !== "idle";
    const compacting = view.phase === "compacting";
    const windowTokens = view.contextWindowTokens ?? contextWindow;
    const ratio = view.ratio;
    const percent = ratio === undefined ? undefined : formatAgentShare(ratio);
    const fill = compacting ? 1 : Math.max(0, Math.min(1, ratio ?? 0));
    // 压缩线：有读数用读数给的位置；还没有读数但知道窗口时，按后端同一个比例画出来。
    const compactRatio = view.compactRatio ?? (windowTokens ? AGENT_CONTEXT_COMPACT_RATIO : undefined);
    const compactAt = view.compactAtTokens ?? (windowTokens ? Math.round(windowTokens * AGENT_CONTEXT_COMPACT_RATIO) : undefined);
    const marker = compactRatio && compactRatio > 0 && compactRatio < 1 ? compactRatio : undefined;
    const badge = PHASE_BADGE[view.phase];
    const tiles = agentUsageStats(stats);
    const details = agentUsageDetails(view, stats);
    const hasDetails = details.context.length > 0 || details.run.length > 0;
    const notes = usageNotes(view, stats);
    const remaining = view.remainingTokens !== undefined && view.contextWindowTokens ? `剩余 ${formatContextTokens(view.remainingTokens)}（${formatAgentShare(view.remainingTokens / view.contextWindowTokens)}）` : "";
    const scaleStart = measured ? remaining : running ? "这一轮进行中，读数稍后出现" : hasRun ? "这一轮还没有上下文读数" : "发出消息后开始统计";
    const scaleEnd = compacting ? "正在把较早的对话收成检查点" : compactAt && compactRatio ? `到 ${formatContextTokens(compactAt)}（${formatAgentShare(compactRatio)}）自动压缩` : "";
    const toggle = () => {
        setExpanded(!expanded);
        writeFlag(AGENT_USAGE_EXPANDED_KEY, !expanded);
    };
    const setCard = (open: boolean) => {
        setCardOpen(open);
        writeFlag(AGENT_USAGE_CARD_KEY, open);
        if (!open) {
            setExpanded(false);
            writeFlag(AGENT_USAGE_EXPANDED_KEY, false);
        }
    };
    const used = measured && view.inputTokens !== undefined ? formatContextTokens(view.inputTokens) : AGENT_USAGE_NO_READING;
    const meterFill = measured && (ratio !== undefined || compacting) ? <span style={{ width: `${fill * 100}%` }} /> : null;
    const alert = view.compactionError ? (
        <p className="agent-usage-alert" role="status">
            <TriangleAlert className="size-3.5" aria-hidden="true" />
            {view.compactionError}
        </p>
    ) : null;
    if (!cardOpen) {
        // 收起：一行写完上下文和本轮摘要，整行就是展开按钮。
        // 没有本轮读数时写剩余或下一步；轮次进行中已有「进行中」标签，提示只写读数稍后出现。
        const brief = agentUsageSummary(stats) || (!measured && running ? "读数稍后出现" : scaleStart);
        return (
            <section className={`agent-usage is-${view.phase} is-collapsed`} aria-label="上下文与本轮用量">
                <button
                    type="button"
                    className="agent-usage-strip"
                    aria-expanded={false}
                    title={measured ? view.detail : "展开用量卡片"}
                    aria-label={`上下文 ${used}${windowTokens ? ` / ${formatContextTokens(windowTokens)}` : ""}${percent ? `，已用 ${percent}` : ""}${brief ? `；${brief}` : ""}。展开用量卡片`}
                    onClick={() => setCard(true)}
                >
                    <span className="agent-usage-meter is-mini" aria-hidden="true">
                        {meterFill}
                        {marker ? <i style={{ left: `${marker * 100}%` }} /> : null}
                    </span>
                    <span className="agent-usage-figure">
                        <strong>{used}</strong>
                        {windowTokens ? ` / ${formatContextTokens(windowTokens)}` : null}
                    </span>
                    {percent ? <span className="agent-usage-percent">{percent}</span> : null}
                    {badge ? <span className="agent-usage-badge">{badge}</span> : null}
                    {carried ? <span className="agent-usage-tag">上一轮</span> : null}
                    {running ? <span className="agent-usage-live">进行中</span> : null}
                    <span className="agent-usage-brief">{brief}</span>
                    <ChevronDown className="agent-usage-chevron size-3.5" aria-hidden="true" />
                </button>
                {alert}
            </section>
        );
    }
    return (
        <section className={`agent-usage is-${view.phase}`} aria-label="上下文与本轮用量">
            <div className="agent-usage-head">
                <span className="agent-usage-context" title={measured ? view.detail : undefined}>
                    <span className="agent-usage-label">上下文</span>
                    <span className="agent-usage-figure">
                        <strong>{used}</strong>
                        {windowTokens ? ` / ${formatContextTokens(windowTokens)}` : null}
                    </span>
                    {percent ? <span className="agent-usage-percent">{percent}</span> : null}
                    {badge ? <span className="agent-usage-badge">{badge}</span> : null}
                    {carried ? (
                        <span className="agent-usage-tag" title="这一轮的上下文读数还没回来，先显示同一对话上一轮最后的读数">
                            上一轮
                        </span>
                    ) : null}
                    {running ? <span className="agent-usage-live">进行中</span> : null}
                </span>
                <span className="agent-usage-side">
                    {modelLabel ? (
                        <span className="agent-usage-model" title={`当前模型：${modelLabel}`}>
                            {modelLabel}
                        </span>
                    ) : null}
                    {hasDetails ? (
                        <button type="button" className="agent-usage-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={toggle}>
                            {expanded ? "收起明细" : "展开明细"}
                            {expanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
                        </button>
                    ) : null}
                    <button type="button" className="agent-usage-collapse" aria-expanded={true} aria-label="收起用量卡片" title="收起用量卡片" onClick={() => setCard(false)}>
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                    </button>
                </span>
            </div>
            {meterFill ? (
                <span className="agent-usage-meter" role="progressbar" aria-label={percent ? `上下文已用 ${percent}` : "上下文正在压缩"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio === undefined ? undefined : Math.round(ratio * 100)}>
                    {meterFill}
                    {marker ? <i style={{ left: `${marker * 100}%` }} aria-hidden="true" /> : null}
                </span>
            ) : (
                <span className="agent-usage-meter" aria-hidden="true">
                    {marker ? <i style={{ left: `${marker * 100}%` }} /> : null}
                </span>
            )}
            {scaleStart || scaleEnd ? (
                <div className="agent-usage-scale">
                    <span>{scaleStart}</span>
                    {scaleEnd ? <span>{scaleEnd}</span> : null}
                </div>
            ) : null}
            <dl className="agent-usage-stats" aria-label="本轮用量">
                {tiles.map((item) => (
                    <div key={item.key} title={item.title} data-empty={item.value === AGENT_USAGE_NO_READING ? "" : undefined}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                    </div>
                ))}
            </dl>
            {alert}
            {hasDetails && expanded ? (
                <div id={detailsId} className="agent-usage-details">
                    {details.context.length ? (
                        <div className="agent-usage-group">
                            <span className="agent-usage-eyebrow">上下文构成</span>
                            <UsageTiles items={details.context} />
                        </div>
                    ) : null}
                    {details.run.length ? (
                        <div className="agent-usage-group">
                            <span className="agent-usage-eyebrow">本轮明细</span>
                            <UsageTiles items={details.run} />
                        </div>
                    ) : null}
                    {notes.length ? <p className="agent-usage-note">{notes.join("；")}。</p> : null}
                </div>
            ) : null}
        </section>
    );
}
