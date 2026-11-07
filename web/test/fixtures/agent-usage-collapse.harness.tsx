import { expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentUsageBar } = await import("@/components/canvas/canvas-agent-usage-bar");
const { emptyAgentRunStats, reduceAgentRunStats, presentAgentRunStats } = await import("@/lib/canvas/agent-run-stats");
const { emptyAgentContextUsage, presentAgentContextUsage } = await import("@/lib/canvas/agent-context-usage");

test("usage details return to the summary and card collapse survives remount", async () => {
    let data = emptyAgentRunStats("conversation");
    data = reduceAgentRunStats(data, {
        eventId: "run:1",
        runId: "run",
        seq: 1,
        type: "model_usage",
        payload: { taskId: "step", model: "test", inputTokens: 1200, outputTokens: 300, cachedTokens: 800, usageAvailable: true, durationMs: 2000 },
        createdAt: "2026-05-01T10:00:00Z",
    });
    const stats = presentAgentRunStats(data.runs.run);
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    let root = createRoot(host);
    const render = () => root.render(<AgentUsageBar view={presentAgentContextUsage(emptyAgentContextUsage("conversation"))} stats={stats} contextWindow={128000} hasRun />);
    const click = async (selector: string) => {
        const button = host.querySelector<HTMLButtonElement>(selector);
        expect(button).not.toBeNull();
        await act(async () => button!.click());
    };
    await act(async () => render());
    expect(host.querySelector(".agent-usage.is-collapsed")).not.toBeNull();
    await click(".agent-usage-strip");
    const summary = host.innerHTML;
    await click(".agent-usage-toggle");
    expect(host.querySelector(".agent-usage-details")).not.toBeNull();
    expect(host.textContent).toContain("收起明细");
    await click(".agent-usage-toggle");
    expect(host.querySelector(".agent-usage-details")).toBeNull();
    expect(host.innerHTML).toBe(summary);
    await click(".agent-usage-toggle");
    await click(".agent-usage-collapse");
    expect(dom.localStorage.getItem("canvas:agent-usage-expanded:v1")).toBeNull();
    await click(".agent-usage-strip");
    expect(host.querySelector(".agent-usage-details")).toBeNull();
    await click(".agent-usage-collapse");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => render());
    expect(host.querySelector(".agent-usage.is-collapsed")).not.toBeNull();
    await click(".agent-usage-strip");
    expect(host.querySelector(".agent-usage-details")).toBeNull();
    await act(async () => root.unmount());
    await dom.happyDOM.abort();
});
