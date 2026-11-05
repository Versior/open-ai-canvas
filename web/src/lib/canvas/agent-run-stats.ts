// 画布助手的本轮统计：把 Agent 事件流归约成按轮次的模型用量、耗时与工具调用合计。
//
// 数据只来自持久事件（seq > 0）：model_usage（每个模型步骤的上游用量与耗时，后端取自上游调用日志）、
// tool_completed / tool_failed（工具调用）和 assistant_message（回复时间）。快照合成的事件用的是本机时间，
// 不参与统计。断线重放、补读会让同一事件重复到达，按序号去重；合计按 taskId / callId 覆盖写入。
// 序号必须从 1 连续：本机没见过这一轮的开头或中间缺事件时合计不完整，展示层直接不给数字。

import type { AgentEvent } from "@/services/api/agent";
import { formatContextBytes, formatContextTokens, type AgentContextUsageView } from "@/lib/canvas/agent-context-usage";

/** 一个模型步骤的上游用量（model_usage 事件）；usageAvailable=false 时没有 token 数。 */
export type AgentModelUsage = {
    taskId: string;
    model?: string;
    usageAvailable: boolean;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    /** 这一步等待上游模型的耗时；没有可靠来源时缺省。 */
    durationMs?: number;
};

export type AgentRunToolCall = { toolName: string; durationMs?: number };

export type AgentRunStatsRun = {
    runId: string;
    /** 1..seqFloor 的事件都已归约。 */
    seqFloor: number;
    /** seqFloor 之后零散到达的序号（升序）；非空表示中间还缺事件。 */
    seqAhead: number[];
    firstEventAt?: number;
    lastEventAt?: number;
    /** 按步骤任务 ID 去重的模型用量。 */
    steps: Record<string, AgentModelUsage>;
    /** 按工具调用 ID 去重的工具调用。 */
    tools: Record<string, AgentRunToolCall>;
    model?: string;
    modelSeq: number;
};

export type AgentRunReply = { runId: string; createdAt: string };

export type AgentRunStats = {
    conversationId: string;
    runs: Record<string, AgentRunStatsRun>;
    /** 助手回复 messageId → 所属轮次与服务端落库时间。 */
    replies: Record<string, AgentRunReply>;
};

/** 展示层读数：只有对应数据真实存在时字段才有值。 */
export type AgentRunStatsView = {
    runId: string;
    steps: number;
    usageSteps: number;
    model?: string;
    totalTokens?: number;
    /** 未命中缓存的输入。 */
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cacheHitRate?: number;
    tokensPerSecond?: number;
    elapsedMs?: number;
    modelMs?: number;
    modelShare?: number;
    toolMs?: number;
    toolShare?: number;
    toolCalls: number;
    toolKinds: number;
};

// 用户在轮次结束后的操作（撤销画布写入）也记在这一轮的事件里，不算这一轮的耗时。
const AFTERMATH_EVENTS = new Set(["canvas_undone"]);

export function emptyAgentRunStats(conversationId: string): AgentRunStats {
    return { conversationId, runs: {}, replies: {} };
}

/** 换了对话就从空统计开始，与上下文读数按轮次隔离同理。 */
export function scopeAgentRunStats(current: AgentRunStats, conversationId: string): AgentRunStats {
    return current.conversationId === conversationId ? current : emptyAgentRunStats(conversationId);
}

/** 这一轮 1..untilSeq 的事件是否都已归约（决定续接时要不要补读前缀）。 */
export function agentRunStatsCovers(stats: AgentRunStats, conversationId: string, runId: string, untilSeq: number) {
    return stats.conversationId === conversationId && (stats.runs[runId]?.seqFloor ?? 0) >= untilSeq;
}

function finiteNonNegative(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function trimmedString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function parseAgentModelUsage(payload: Record<string, unknown> | undefined): AgentModelUsage | null {
    const taskId = trimmedString(payload?.taskId);
    if (!payload || !taskId) return null;
    const usage: AgentModelUsage = { taskId, usageAvailable: payload.usageAvailable === true };
    const model = trimmedString(payload.model);
    if (model) usage.model = model;
    if (usage.usageAvailable) {
        usage.inputTokens = finiteNonNegative(payload.inputTokens);
        usage.outputTokens = finiteNonNegative(payload.outputTokens);
        usage.cachedTokens = finiteNonNegative(payload.cachedTokens);
    }
    const durationMs = finiteNonNegative(payload.durationMs);
    if (durationMs) usage.durationMs = durationMs;
    return usage;
}

/**
 * 一步的提示 token 与输出 token。上游对缓存的口径不同：OpenAI / Gemini 的输入数已含缓存读取
 * （与计费的 input − cached 一致），Anthropic 口径的输入不含缓存读取。缓存数大于输入数只可能是后者，
 * 此时按输入 + 缓存还原提示总量。用量全为 0 视为没有回传。
 */
export function agentModelUsageTokens(usage: AgentModelUsage | undefined) {
    if (!usage?.usageAvailable) return undefined;
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cached = usage.cachedTokens ?? 0;
    const prompt = cached > input ? input + cached : input;
    const total = prompt + output;
    return total > 0 ? { prompt, cached, output, total } : undefined;
}

/** 单条回复的页脚读数：模型、这一步的 token 合计与生成速度。 */
export function presentAgentModelUsage(usage: AgentModelUsage | undefined): { model?: string; totalTokens?: number; tokensPerSecond?: number } {
    if (!usage) return {};
    const tokens = agentModelUsageTokens(usage);
    const seconds = (usage.durationMs ?? 0) / 1000;
    return {
        model: usage.model,
        totalTokens: tokens?.total,
        tokensPerSecond: tokens && tokens.output > 0 && seconds > 0 ? tokens.output / seconds : undefined,
    };
}

function persistedSeq(event: AgentEvent): number | undefined {
    return Number.isSafeInteger(event.seq) && event.seq > 0 ? event.seq : undefined;
}

function markSeq(run: AgentRunStatsRun, seq: number): Pick<AgentRunStatsRun, "seqFloor" | "seqAhead"> {
    if (seq !== run.seqFloor + 1) {
        const index = run.seqAhead.findIndex((item) => item > seq);
        return { seqFloor: run.seqFloor, seqAhead: index < 0 ? [...run.seqAhead, seq] : [...run.seqAhead.slice(0, index), seq, ...run.seqAhead.slice(index)] };
    }
    let seqFloor = seq;
    let consumed = 0;
    while (run.seqAhead[consumed] === seqFloor + 1) {
        seqFloor += 1;
        consumed += 1;
    }
    return { seqFloor, seqAhead: consumed ? run.seqAhead.slice(consumed) : run.seqAhead };
}

function toolCallFromPayload(payload: Record<string, unknown>): ({ callId: string } & AgentRunToolCall) | null {
    const callId = trimmedString(payload.callId);
    const toolName = trimmedString(payload.toolName);
    // 没有 callId 的是服务端自己的记录（例如技能目录装载），不是模型发起的调用；
    // 本轮提前结束时被跳过、没有执行的调用也不计入。
    if (!callId || !toolName) return null;
    const result = payload.result;
    if (result && typeof result === "object" && (result as { skipped?: unknown }).skipped === true) return null;
    const durationMs = finiteNonNegative(payload.durationMs);
    return durationMs === undefined ? { callId, toolName } : { callId, toolName, durationMs };
}

/** 逐条归约 Agent 事件；重复或没有持久序号的事件原样返回当前状态。 */
export function reduceAgentRunStats(current: AgentRunStats, event: AgentEvent): AgentRunStats {
    const seq = persistedSeq(event);
    if (seq === undefined || !event.runId) return current;
    const previous = current.runs[event.runId] ?? { runId: event.runId, seqFloor: 0, seqAhead: [], steps: {}, tools: {}, modelSeq: 0 };
    if (seq <= previous.seqFloor || previous.seqAhead.includes(seq)) return current;
    const run: AgentRunStatsRun = { ...previous, ...markSeq(previous, seq) };
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const at = Date.parse(event.createdAt);
    if (Number.isFinite(at) && !AFTERMATH_EVENTS.has(event.type)) {
        run.firstEventAt = run.firstEventAt === undefined ? at : Math.min(run.firstEventAt, at);
        run.lastEventAt = run.lastEventAt === undefined ? at : Math.max(run.lastEventAt, at);
    }
    let replies = current.replies;
    if (event.type === "model_usage") {
        const usage = parseAgentModelUsage(payload);
        if (usage) {
            run.steps = { ...run.steps, [usage.taskId]: usage };
            // 补读与实时事件可能乱序到达：模型取序号最大的那一步。
            if (usage.model && seq > run.modelSeq) {
                run.model = usage.model;
                run.modelSeq = seq;
            }
        }
    } else if (event.type === "tool_completed" || event.type === "tool_failed") {
        const call = toolCallFromPayload(payload);
        if (call) {
            const { callId, ...tool } = call;
            run.tools = { ...run.tools, [callId]: tool };
        }
    } else if (event.type === "assistant_message") {
        const messageId = String(payload.messageId || event.eventId);
        replies = { ...replies, [messageId]: { runId: event.runId, createdAt: event.createdAt } };
    }
    return { ...current, runs: { ...current.runs, [event.runId]: run }, replies };
}

/** 本轮读数。事件不完整（没见过第 1 条或中间有缺口）时返回 null：宁可不显示，也不给残缺的合计。 */
export function presentAgentRunStats(run: AgentRunStatsRun | undefined): AgentRunStatsView | null {
    if (!run || run.seqFloor === 0 || run.seqAhead.length > 0) return null;
    const steps = Object.values(run.steps);
    let prompt = 0;
    let cached = 0;
    let output = 0;
    let usageSteps = 0;
    let timedSteps = 0;
    let modelMs = 0;
    let timedOutput = 0;
    let timedOutputMs = 0;
    for (const step of steps) {
        if (step.durationMs !== undefined) {
            timedSteps += 1;
            modelMs += step.durationMs;
        }
        const tokens = agentModelUsageTokens(step);
        if (!tokens) continue;
        usageSteps += 1;
        prompt += tokens.prompt;
        cached += tokens.cached;
        output += tokens.output;
        if (step.durationMs) {
            timedOutput += tokens.output;
            timedOutputMs += step.durationMs;
        }
    }
    const tools = Object.values(run.tools);
    const timedTools = tools.filter((tool) => tool.durationMs !== undefined);
    const toolMs = timedTools.length ? timedTools.reduce((sum, tool) => sum + (tool.durationMs ?? 0), 0) : undefined;
    const span = run.firstEventAt !== undefined && run.lastEventAt !== undefined ? run.lastEventAt - run.firstEventAt : 0;
    const elapsedMs = span > 0 ? span : undefined;
    const share = (value: number | undefined) => (value !== undefined && elapsedMs ? value / elapsedMs : undefined);
    const view: AgentRunStatsView = {
        runId: run.runId,
        steps: steps.length,
        usageSteps,
        model: run.model,
        elapsedMs,
        toolMs,
        toolShare: share(toolMs),
        toolCalls: tools.length,
        toolKinds: new Set(tools.map((tool) => tool.toolName)).size,
    };
    if (timedSteps) {
        view.modelMs = modelMs;
        view.modelShare = share(modelMs);
    }
    if (usageSteps) {
        view.totalTokens = prompt + output;
        view.inputTokens = prompt - cached;
        view.outputTokens = output;
        view.cachedTokens = cached;
        if (prompt > 0) view.cacheHitRate = cached / prompt;
    }
    if (timedOutput > 0 && timedOutputMs > 0) view.tokensPerSecond = timedOutput / (timedOutputMs / 1000);
    return view;
}

/** 耗时：10 秒内保留一位小数，之后按「42s」「8m 36s」「1h 5m」。 */
export function formatAgentDuration(ms: number | undefined): string | undefined {
    if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
    if (ms < 10_000) return `${Math.round(ms / 100) / 10}s`;
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

export function formatAgentTokenSpeed(tokensPerSecond: number | undefined): string | undefined {
    if (tokensPerSecond === undefined || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return undefined;
    return `${tokensPerSecond < 10 ? Math.round(tokensPerSecond * 10) / 10 : Math.round(tokensPerSecond)} tokens/s`;
}

export function formatAgentShare(share: number | undefined): string | undefined {
    if (share === undefined || !Number.isFinite(share) || share < 0) return undefined;
    const percent = share * 100;
    return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

/** 回复时间按本机时区显示 HH:mm:ss。 */
export function formatAgentClockTime(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

/** 用量栏里的一项读数；只有对应数据真实存在时才生成。 */
export type AgentUsageItem = { key: string; label: string; value: string; detail?: string; title?: string };

/** 输入框上方常显的本轮读数：token 合计、生成速度、耗时、工具调用次数。 */
export function agentUsageHeadline(stats: AgentRunStatsView | null | undefined): AgentUsageItem[] {
    if (!stats) return [];
    const items: AgentUsageItem[] = [];
    if (stats.totalTokens !== undefined) items.push({ key: "total", label: "本轮", value: `${formatContextTokens(stats.totalTokens)} tokens`, title: `${stats.steps} 次模型调用的合计` });
    const speed = formatAgentTokenSpeed(stats.tokensPerSecond);
    if (speed) items.push({ key: "speed", label: "速度", value: speed });
    const elapsed = formatAgentDuration(stats.elapsedMs);
    if (elapsed) items.push({ key: "elapsed", label: "耗时", value: elapsed, title: "本轮第一条到最后一条事件的时间" });
    if (stats.toolCalls > 0) items.push({ key: "tools", label: "工具", value: `${stats.toolCalls} 次`, title: `${stats.toolKinds} 种工具 · ${stats.toolCalls} 次调用` });
    return items;
}

/** 展开后的明细：上下文剩余、压缩线与构成；本轮模型调用、输入输出与缓存、模型和工具耗时、工具种类。 */
export function agentUsageDetails(view: AgentContextUsageView, stats: AgentRunStatsView | null | undefined): { context: AgentUsageItem[]; run: AgentUsageItem[] } {
    const context: AgentUsageItem[] = [];
    const contextWindow = view.contextWindowTokens;
    if (contextWindow && view.remainingTokens !== undefined) context.push({ key: "remaining", label: "剩余", value: formatContextTokens(view.remainingTokens), detail: formatAgentShare(view.remainingTokens / contextWindow) });
    if (view.compactAtTokens) context.push({ key: "compact-at", label: "压缩线", value: formatContextTokens(view.compactAtTokens), detail: formatAgentShare(view.compactRatio), title: "上下文到这里会自动把较早的对话收成检查点" });
    for (const item of view.breakdown) context.push({ key: `bucket-${item.key}`, label: item.label, value: formatContextTokens(item.tokens) });
    if (view.protocolBytes !== undefined) context.push({ key: "envelope", label: "协议外壳", value: formatContextBytes(view.protocolBytes) });
    const run: AgentUsageItem[] = [];
    if (!stats) return { context, run };
    if (stats.steps) run.push({ key: "steps", label: "模型调用", value: `${stats.steps} 次` });
    if (stats.totalTokens !== undefined) {
        run.push({ key: "input", label: "输入", value: formatContextTokens(stats.inputTokens), title: "没有命中缓存的输入" });
        run.push({ key: "output", label: "输出", value: formatContextTokens(stats.outputTokens) });
        const hitRate = formatAgentShare(stats.cacheHitRate);
        run.push({ key: "cached", label: "缓存读取", value: formatContextTokens(stats.cachedTokens), detail: hitRate ? `命中 ${hitRate}` : undefined });
    }
    const modelTime = formatAgentDuration(stats.modelMs);
    if (modelTime) run.push({ key: "model-time", label: "模型耗时", value: modelTime, detail: formatAgentShare(stats.modelShare) });
    const toolTime = formatAgentDuration(stats.toolMs);
    if (toolTime) run.push({ key: "tool-time", label: "工具耗时", value: toolTime, detail: formatAgentShare(stats.toolShare) });
    if (stats.toolCalls > 0) run.push({ key: "tools", label: "工具调用", value: `${stats.toolKinds} 种 · ${stats.toolCalls} 次` });
    return { context, run };
}
