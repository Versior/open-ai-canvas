import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent, AgentRun } from "@/services/api/agent";
import {
    agentRunStatsCovers,
    agentUsageDetails,
    agentUsageHeadline,
    emptyAgentRunStats,
    formatAgentClockTime,
    formatAgentDuration,
    formatAgentShare,
    formatAgentTokenSpeed,
    presentAgentModelUsage,
    presentAgentRunStats,
    reduceAgentRunStats,
    scopeAgentRunStats,
    type AgentRunStats,
} from "@/lib/canvas/agent-run-stats";
import { applyAgentEvent } from "@/lib/canvas/cloud-agent-events";
import { emptyAgentContextUsage, presentAgentContextUsage, reduceAgentContextUsage } from "@/lib/canvas/agent-context-usage";
import { AgentChatMessage, type CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { AgentUsageBar } from "@/components/canvas/canvas-agent-usage-bar";
import { projectCloudAgentConversation } from "@/services/cloud-agent-history";
import { canvasThemes } from "@/lib/canvas-theme";

const base = Date.parse("2026-05-01T10:00:00.000Z");
const event = (seq: number, type: string, payload: Record<string, unknown>, offsetMs = seq * 1000, runId = "run-1"): AgentEvent => ({
    eventId: `${runId}:${seq}`,
    runId,
    seq,
    type,
    payload,
    createdAt: new Date(base + offsetMs).toISOString(),
});
const reduce = (events: AgentEvent[], initial: AgentRunStats = emptyAgentRunStats("conversation-1")) => events.reduce(reduceAgentRunStats, initial);

// 两个模型步骤（输入含缓存，OpenAI 口径）+ 工具调用：合计 47,683 tokens，耗时 8m 36s。
const fullRun = [
    event(1, "context_pressure", { tokenSource: "pi" }, 0),
    event(2, "tool_completed", { toolName: "skills_load", text: "装载技能目录" }, 500),
    event(3, "assistant_message", { messageId: "step-1", text: "我先看看画布" }, 4_000),
    event(4, "model_usage", { taskId: "step-1", model: "gpt-test", inputTokens: 30_000, outputTokens: 200, cachedTokens: 29_000, usageAvailable: true, durationMs: 4_000 }, 4_100),
    event(5, "tool_completed", { toolName: "canvas_get_state", callId: "call-1", arguments: "{}", result: {} }, 6_000),
    event(6, "tool_failed", { toolName: "canvas_apply_ops", callId: "call-2", arguments: "{}", result: { error: "参数错误" } }, 9_000),
    event(7, "tool_completed", { toolName: "canvas_get_state", callId: "call-3", arguments: "{}", result: {} }, 12_000),
    event(8, "tool_failed", { toolName: "canvas_apply_ops", callId: "call-4", result: { skipped: true, error: "本轮已结束" } }, 13_000),
    event(9, "assistant_message", { messageId: "step-2", text: "已完成" }, 515_000),
    event(10, "model_usage", { taskId: "step-2", model: "gpt-test-2", inputTokens: 17_200, outputTokens: 283, cachedTokens: 17_100, usageAvailable: true, durationMs: 3_000 }, 516_000),
    // 用户事后撤销不算这一轮的耗时。
    event(11, "canvas_undone", { stepId: "call-2" }, 900_000),
];

describe("Agent run stats reducer", () => {
    it("aggregates model usage, tool calls and the event span of a complete run", () => {
        const stats = reduce(fullRun);
        const view = presentAgentRunStats(stats.runs["run-1"]);
        expect(view).not.toBeNull();
        expect(view).toMatchObject({ steps: 2, usageSteps: 2, model: "gpt-test-2", totalTokens: 47_683, inputTokens: 1_100, outputTokens: 483, cachedTokens: 46_100, elapsedMs: 516_000, modelMs: 7_000, toolCalls: 3, toolKinds: 2 });
        expect(view?.cacheHitRate).toBeCloseTo(46_100 / 47_200, 6);
        expect(view?.tokensPerSecond).toBeCloseTo(483 / 7, 6);
        expect(view?.modelShare).toBeCloseTo(7_000 / 516_000, 6);
        // 后端没有给工具耗时：不能编出工具耗时与占比。
        expect(view?.toolMs).toBeUndefined();
        expect(view?.toolShare).toBeUndefined();
        expect(stats.replies["step-2"]).toEqual({ runId: "run-1", createdAt: new Date(base + 515_000).toISOString() });
    });

    it("restores the prompt size when cached tokens are reported outside the input count", () => {
        const view = presentAgentRunStats(reduce([event(1, "model_usage", { taskId: "step", inputTokens: 1_200, outputTokens: 483, cachedTokens: 46_100, usageAvailable: true, durationMs: 6_900 })]).runs["run-1"]);
        expect(view).toMatchObject({ totalTokens: 47_783, inputTokens: 1_200, cachedTokens: 46_100 });
        expect(view?.cacheHitRate).toBeCloseTo(46_100 / 47_300, 6);
    });

    it("keeps steps without upstream usage out of the token totals and speed", () => {
        const view = presentAgentRunStats(
            reduce([
                event(1, "model_usage", { taskId: "a", inputTokens: 1_000, outputTokens: 100, usageAvailable: true, durationMs: 2_000 }),
                event(2, "model_usage", { taskId: "b", inputTokens: 0, outputTokens: 0, cachedTokens: 0, usageAvailable: false, durationMs: 8_000 }),
            ]).runs["run-1"],
        );
        expect(view).toMatchObject({ steps: 2, usageSteps: 1, totalTokens: 1_100, modelMs: 10_000 });
        expect(view?.tokensPerSecond).toBeCloseTo(50, 6);
        const unavailable = presentAgentRunStats(reduce([event(1, "model_usage", { taskId: "only", usageAvailable: false })]).runs["run-1"]);
        expect(unavailable).toMatchObject({ steps: 1, usageSteps: 0 });
        expect(unavailable?.totalTokens).toBeUndefined();
        expect(unavailable?.tokensPerSecond).toBeUndefined();
        expect(unavailable?.modelMs).toBeUndefined();
    });

    it("sums tool durations only when the events carry them", () => {
        const view = presentAgentRunStats(
            reduce([event(1, "tool_completed", { toolName: "canvas_get_state", callId: "a", durationMs: 1_500 }, 0), event(2, "tool_completed", { toolName: "generate_media", callId: "b", durationMs: 8_500 }, 20_000)]).runs["run-1"],
        );
        expect(view).toMatchObject({ toolCalls: 2, toolKinds: 2, toolMs: 10_000, elapsedMs: 20_000 });
        expect(view?.toolShare).toBeCloseTo(0.5, 6);
    });

    it("ignores replays and snapshot events, and hides totals until the run prefix is complete", () => {
        const stats = reduce(fullRun.slice(0, 4));
        expect(reduceAgentRunStats(stats, fullRun[3])).toBe(stats);
        expect(reduceAgentRunStats(stats, { ...fullRun[3], seq: 0 })).toBe(stats);

        // 刷新后只从游标之后收到事件：没见过第 1 条，不给残缺的合计。
        const resumed = reduce(fullRun.slice(6));
        expect(presentAgentRunStats(resumed.runs["run-1"])).toBeNull();
        expect(agentRunStatsCovers(resumed, "conversation-1", "run-1", 6)).toBe(false);
        // 补读前缀后与按顺序收到全部事件的结果一致。
        const backfilled = reduce(fullRun.slice(0, 6), resumed);
        expect(agentRunStatsCovers(backfilled, "conversation-1", "run-1", 6)).toBe(true);
        expect(presentAgentRunStats(backfilled.runs["run-1"])).toEqual(presentAgentRunStats(reduce(fullRun).runs["run-1"]));
    });

    it("scopes statistics to one conversation", () => {
        const stats = reduce(fullRun);
        expect(scopeAgentRunStats(stats, "conversation-1")).toBe(stats);
        expect(scopeAgentRunStats(stats, "conversation-2")).toEqual(emptyAgentRunStats("conversation-2"));
        expect(agentRunStatsCovers(stats, "conversation-2", "run-1", 1)).toBe(false);
    });

    it("presents a single reply from its own model step", () => {
        expect(presentAgentModelUsage({ taskId: "t", model: "gpt-test", usageAvailable: true, inputTokens: 2_000, outputTokens: 500, durationMs: 5_000 })).toEqual({ model: "gpt-test", totalTokens: 2_500, tokensPerSecond: 100 });
        expect(presentAgentModelUsage({ taskId: "t", usageAvailable: false, durationMs: 5_000 })).toEqual({ model: undefined, totalTokens: undefined, tokensPerSecond: undefined });
        expect(presentAgentModelUsage(undefined)).toEqual({});
    });

    it("formats durations, speeds, shares and reply times", () => {
        expect(formatAgentDuration(516_000)).toBe("8m 36s");
        expect(formatAgentDuration(42_000)).toBe("42s");
        expect(formatAgentDuration(211_000)).toBe("3m 31s");
        expect(formatAgentDuration(4_250)).toBe("4.3s");
        expect(formatAgentDuration(3_725_000)).toBe("1h 2m");
        expect(formatAgentDuration(undefined)).toBeUndefined();
        expect(formatAgentTokenSpeed(70.9)).toBe("71 tokens/s");
        expect(formatAgentTokenSpeed(7.46)).toBe("7.5 tokens/s");
        expect(formatAgentTokenSpeed(0)).toBeUndefined();
        expect(formatAgentShare(0.004)).toBe("<1%");
        expect(formatAgentShare(0.0477)).toBe("5%");
        expect(formatAgentShare(undefined)).toBeUndefined();
        expect(formatAgentClockTime(new Date(2026, 4, 1, 9, 5, 7).toISOString())).toBe("09:05:07");
        expect(formatAgentClockTime("not-a-date")).toBeUndefined();
    });
});

function reduceMessages(events: AgentEvent[], initial: CloudAgentChatMessage[] = []) {
    let messages = initial;
    for (const item of events) {
        applyAgentEvent(
            item,
            (update) => {
                messages = typeof update === "function" ? update(messages) : update;
            },
            () => {},
            () => {},
        );
    }
    return messages;
}

describe("Assistant reply metadata", () => {
    it("records the run, the server time and the step usage on the reply", () => {
        const snapshot: AgentEvent = { ...event(0, "assistant_message", { messageId: "step-2", text: "已完" }), eventId: "run-1:snapshot:1", createdAt: new Date(base + 999_999).toISOString() };
        let messages = reduceMessages([snapshot]);
        // 快照合成事件用的是本机时间，不能当作回复时间。
        expect(messages[0]).toMatchObject({ id: "step-2", runId: "run-1" });
        expect(messages[0].createdAt).toBeUndefined();
        messages = reduceMessages([fullRun[8], fullRun[9]], messages);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ text: "已完成", runId: "run-1", createdAt: new Date(base + 515_000).toISOString(), usage: { taskId: "step-2", model: "gpt-test-2", outputTokens: 283, durationMs: 3_000 } });
        // 只调工具、没有正文的步骤不会凭空生成回复。
        expect(reduceMessages([event(12, "model_usage", { taskId: "tool-only", usageAvailable: true, inputTokens: 10, outputTokens: 1 })], messages)).toBe(messages);
    });

    it("keeps reply metadata when a conversation is restored from history", () => {
        const run: AgentRun = {
            id: "run-1",
            conversationId: "conversation-1",
            canvasId: "canvas-1",
            status: "completed",
            permissionMode: "auto",
            createdAt: new Date(base).toISOString(),
            updatedAt: new Date(base + 516_000).toISOString(),
            userPrompt: "分析剧情",
            events: fullRun.slice(0, 10),
        };
        const reply = projectCloudAgentConversation("conversation-1", [run]).messages.find((message) => message.id === "step-2");
        expect(reply).toMatchObject({ runId: "run-1", createdAt: new Date(base + 515_000).toISOString(), usage: { taskId: "step-2", usageAvailable: true } });
        expect(reply?.usage?.inputTokens).toBe(17_200);
    });

    it("renders the reply footer with model, speed, time, copy and retry", () => {
        const reply: CloudAgentChatMessage = { id: "step-2", role: "assistant", text: "已完成", runId: "run-1", createdAt: new Date(base).toISOString() };
        const html = renderToStaticMarkup(<AgentChatMessage item={reply} theme={canvasThemes.dark} replyModelLabel="测试模型" replyUsageLabel="69 tokens/s · 17.5K tokens" replyTimeLabel="09:05:07" replyPinned onRetry={() => {}} />);
        expect(html).toContain("agent-reply-footer is-pinned");
        expect(html).toContain("测试模型");
        expect(html).toContain("69 tokens/s · 17.5K tokens");
        expect(html).toContain("09:05:07");
        expect(html).toContain('aria-label="复制这条消息"');
        expect(html).toContain('aria-label="重试这一轮"');

        const plain = renderToStaticMarkup(<AgentChatMessage item={{ id: "old", role: "assistant", text: "旧回复" }} theme={canvasThemes.light} />);
        expect(plain).toContain("agent-reply-footer");
        expect(plain).not.toContain("is-pinned");
        expect(plain).not.toContain("agent-reply-chip");
        expect(plain).not.toContain("重试这一轮");

        const streaming = renderToStaticMarkup(<AgentChatMessage item={{ ...reply, streaming: true }} theme={canvasThemes.light} isStreaming replyModelLabel="测试模型" />);
        expect(streaming).not.toContain("agent-reply-footer");
    });
});

describe("Usage bar above the composer", () => {
    const reading = (estimatedInputTokens: number) =>
        presentAgentContextUsage(
            reduceAgentContextUsage(
                emptyAgentContextUsage("run-1"),
                event(1, "context_pressure", { tokenSource: "pi", modelLimitConfigured: true, contextWindowTokens: 1_000_000, usableInputTokens: 1_000_000, compactAtTokens: 800_000, estimatedInputTokens, pressureRatio: estimatedInputTokens / 1_000_000 }),
            ),
        );
    const contextView = reading(47_700);

    it("stays out of the way until there is a real reading", () => {
        const idle = presentAgentContextUsage(emptyAgentContextUsage(""));
        expect(agentUsageHeadline(null)).toEqual([]);
        expect(agentUsageDetails(idle, null)).toEqual({ context: [], run: [] });
        expect(renderToStaticMarkup(<AgentUsageBar view={idle} stats={null} />)).toBe("");

        expect(agentUsageDetails(contextView, null)).toEqual({
            context: [
                { key: "remaining", label: "剩余", value: "952.3K", detail: "95%" },
                { key: "compact-at", label: "压缩线", value: "800K", detail: "80%", title: "上下文到这里会自动把较早的对话收成检查点" },
            ],
            run: [],
        });
        const html = renderToStaticMarkup(<AgentUsageBar view={contextView} stats={null} />);
        expect(html).toContain("agent-usage is-ok");
        expect(html).toContain("<strong>47.7K</strong> / 1M");
        expect(html).toContain('aria-valuenow="5"');
        // 明细默认收起，但仍在页面里，切换按钮有可指向的目标。
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('hidden=""');
    });

    it("shows run totals inline and the split in the details", () => {
        const stats = presentAgentRunStats(reduce(fullRun).runs["run-1"]);
        expect(agentUsageHeadline(stats).map((item) => `${item.label} ${item.value}`)).toEqual(["本轮 47.7K tokens", "速度 69 tokens/s", "耗时 8m 36s", "工具 3 次"]);
        const run = agentUsageDetails(contextView, stats).run;
        expect(run.map((item) => item.label)).toEqual(["模型调用", "输入", "输出", "缓存读取", "模型耗时", "工具调用"]);
        const value = (key: string) => run.find((item) => item.key === key);
        expect(value("steps")?.value).toBe("2 次");
        expect(value("input")?.value).toBe("1.1K");
        expect(value("cached")).toMatchObject({ value: "46.1K", detail: "命中 98%" });
        expect(value("model-time")).toMatchObject({ value: "7s", detail: "1%" });
        expect(value("tools")?.value).toBe("2 种 · 3 次");
        const html = renderToStaticMarkup(<AgentUsageBar view={contextView} stats={stats} />);
        expect(html).toContain("<strong>69 tokens/s</strong>");
        expect(html).toContain("<strong>8m 36s</strong>");
        expect(html).toContain("本轮用量与速度来自上游调用记录");

        const timedTools = presentAgentRunStats(reduce([event(1, "tool_completed", { toolName: "generate_media", callId: "a", durationMs: 211_000 }, 0), event(2, "run_completed", {}, 516_000)]).runs["run-1"]);
        expect(agentUsageDetails(contextView, timedTools).run.find((item) => item.key === "tool-time")).toMatchObject({ label: "工具耗时", value: "3m 31s", detail: "41%" });
    });

    it("marks the context phase near the compaction line", () => {
        const html = renderToStaticMarkup(<AgentUsageBar view={reading(760_000)} stats={null} />);
        expect(html).toContain("agent-usage is-watch");
        expect(html).toContain("接近压缩");
        expect(html).toContain('aria-valuenow="76"');
    });
});
