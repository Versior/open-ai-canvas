import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { AgentRun } from "../../src/services/api/agent";
import type { CloudAgentChatMessage } from "../../src/components/canvas/canvas-cloud-agent-chat-ui";
import type { AgentMemoryDocRevision, AgentMemoryDocument } from "../../src/services/api/agent-memory";

const dom = new Window({ url: "http://localhost/settings" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    DocumentFragment: dom.DocumentFragment,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { onlineManager, QueryClientProvider } = await import("@tanstack/react-query");
const { appQueryClient } = await import("../../src/lib/query-client");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { MotionConfig } = await import("motion/react");
const { i18nReady } = await import("../../src/i18n");
await i18nReady;
const { default: AgentMemoryPane } = await import("../../src/pages/settings/agent-memory-pane");
const { AgentMemoryUpdateCard } = await import("../../src/components/canvas/canvas-cloud-agent-memory-cards");
const { AgentConversation } = await import("../../src/components/canvas/canvas-cloud-agent-panel-parts");
const { loadCloudAgentConversation } = await import("../../src/services/cloud-agent-history");
const { canvasThemes } = await import("../../src/lib/canvas-theme");
const { ApiError, http } = await import("../../src/services/api/request");

const original: AgentMemoryDocRevision = {
    id: "proposal",
    actor: "agent",
    status: "pending",
    summary: "将工作笔记改成冷色",
    baseRevision: 1,
    revision: 1,
    canUndo: false,
    createdAt: "2026-01-01T00:00:00Z",
    reviewHash: "view-original",
    changes: [
        { id: "target", kind: "replace", section: "notes", before: "暖色原文", after: "冷色方案" },
        ...Array.from({ length: 7 }, (_, index) => ({ id: `add-${index}`, kind: "add" as const, section: "notes" as const, after: `附加修改 ${index + 1}` })),
    ],
};
const revised: AgentMemoryDocRevision = { ...original, reviewHash: "view-reloaded", changes: [{ ...original.changes[0], before: "用户后来改成黑白", beforeSection: "user" }, ...original.changes.slice(1)] };
const blocked: AgentMemoryDocRevision = { ...original, id: "unavailable", summary: "目标已不存在", reviewHash: undefined, reviewError: "这项记忆已删除，请拒绝此提案", changes: [{ id: "missing", kind: "remove", section: "notes", before: "旧条目" }] };
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let get: ReturnType<typeof spyOn>, post: ReturnType<typeof spyOn>;
let revisions: AgentMemoryDocRevision[];
const documentState = (): AgentMemoryDocument => ({ mode: "review", capacity: 1000, charCount: 0, revision: 3, entries: [], pendingCount: revisions.length, updatedAt: "2026-01-01T00:00:00Z" });
beforeEach(() => {
    setActiveUserScope("memory-review-user");
    revisions = [original, blocked];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    get = spyOn(http, "get").mockImplementation(async (path, config) => {
        if (path === "/agent/memory") return documentState();
        if (path === "/agent/memory/revisions" && config?.params?.status === "pending") return { revisions: revisions.slice() };
        throw new Error(`Unexpected GET ${path}`);
    });
    post = spyOn(http, "post").mockImplementation(async (path, body) => {
        if (path === "/agent/memory/revisions/proposal/decide" && body?.decision === "approve") {
            if (revisions.includes(original)) {
                revisions = [revised, blocked];
                throw new ApiError("记忆原文或分区已变化，请重新核对", { status: 409, reason: "conflict" });
            }
            if (body.reviewHash !== revised.reviewHash) throw new Error("未使用新预览的哈希");
            revisions = [blocked];
            return documentState();
        }
        if (path === "/agent/memory/revisions/unavailable/decide" && body?.decision === "reject") {
            revisions = [original];
            return documentState();
        }
        throw new Error(`Unexpected POST ${path}`);
    });
});
afterEach(async () => {
    await act(async () => root.unmount());
    appQueryClient.clear();
    host.remove();
    post.mockRestore();
    get.mockRestore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
});

async function render(node: ReactNode) {
    await act(async () => {
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <MotionConfig skipAnimations>
                    <QueryClientProvider client={appQueryClient}>
                        <App>{node}</App>
                    </QueryClientProvider>
                </MotionConfig>
            </ConfigProvider>,
        );
    });
}
function proposal(title: string) {
    const summary = [...host.querySelectorAll("p")].find((item) => item.textContent === title);
    if (!summary?.parentElement?.parentElement) throw new Error(`未展示提案：${title}`);
    return summary.parentElement.parentElement;
}
function choice(card: Element, label: string) {
    const button = [...card.querySelectorAll("button")].find((item) => item.textContent?.replace(/\s/g, "") === label);
    if (!button) throw new Error(`没有按钮：${label}`);
    return button;
}
const decisions = () => post.mock.calls.map(([path, body]) => [path, body]);

test("设置显示所有待审差异；409刷新原文与分区，第二次明确点击才提交新审阅哈希", async () => {
    await render(<AgentMemoryPane />);
    const card = proposal(original.summary);
    expect(card.querySelectorAll("li")).toHaveLength(8);
    expect(card.textContent).toContain("附加修改 7");
    expect(card.textContent).toContain("暖色原文 → 冷色方案");
    expect(proposal(blocked.summary).textContent).toContain(blocked.reviewError!);
    await act(async () => choice(card, "采纳").click());
    const current = proposal(original.summary);
    expect(current.textContent).not.toContain("暖色原文");
    expect(current.querySelector("li")?.textContent).toContain("关于用户 → 工作笔记");
    expect(current.querySelector("li")?.textContent).toContain("用户后来改成黑白 → 冷色方案");
    expect(get.mock.calls.filter(([path]) => path === "/agent/memory/revisions")).toHaveLength(2);
    expect(decisions()).toEqual([["/agent/memory/revisions/proposal/decide", { decision: "approve", reviewHash: original.reviewHash }]]);
    expect(document.body.textContent).not.toContain("已采纳，下一条消息起生效");
    await act(async () => choice(current, "采纳").click());
    expect(decisions()).toEqual([
        ["/agent/memory/revisions/proposal/decide", { decision: "approve", reviewHash: original.reviewHash }],
        ["/agent/memory/revisions/proposal/decide", { decision: "approve", reviewHash: revised.reviewHash }],
    ]);
    expect(host.textContent).not.toContain(original.summary);
    expect(proposal(blocked.summary).textContent).toContain(blocked.reviewError!);
});

test("目标已不存在：显示原因，采纳按钮不可点，但能单独拒绝", async () => {
    await render(<AgentMemoryPane />);
    const card = proposal(blocked.summary);
    expect(card.querySelector('[role="alert"]')?.textContent).toBe(blocked.reviewError);
    const approve = choice(card, "采纳");
    expect(approve.disabled).toBe(true);
    await act(async () => approve.click());
    expect(decisions()).toEqual([]);
    const reject = choice(card, "拒绝");
    expect(reject.disabled).toBe(false);
    await act(async () => reject.click());
    expect(decisions()).toEqual([["/agent/memory/revisions/unavailable/decide", { decision: "reject", reviewHash: undefined }]]);
    expect(host.textContent).not.toContain(blocked.summary);
    expect(host.textContent).toContain(original.summary);
});

test("旧服务端只给历史快照未确认当前差异时，不能无指纹采纳", async () => {
    revisions = [{ ...original, reviewHash: undefined }];
    await render(<AgentMemoryPane />);
    const card = proposal(original.summary);
    expect(card.querySelector('[role="alert"]')?.textContent).toContain("服务端未确认当前差异");
    const approve = choice(card, "采纳");
    expect(approve.disabled).toBe(true);
    await act(async () => approve.click());
    expect(decisions()).toEqual([]);
    expect(choice(card, "拒绝").disabled).toBe(false);
});

test.each([
    ["rejected", "已拒绝"],
    ["undone", "已撤销这次记忆修改"],
] as const)("聊天卡重放 %s 显示真实终态，不能撤销也不报已更新", async (status, expected) => {
    const update = { revisionId: "fixture", status: "applied" as const, summary: "验收提案", changes: [] };
    await render(<AgentMemoryUpdateCard update={update} currentStatus="applied" theme={canvasThemes.light} />);
    expect(host.textContent).toContain("长期记忆已更新");
    expect(choice(host, "撤销").disabled).toBe(false);
    await render(<AgentMemoryUpdateCard update={{ ...update, status }} currentStatus={status} theme={canvasThemes.light} />);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(expected);
    expect(host.textContent).not.toContain("长期记忆已更新");
    expect(host.querySelector("button")).toBeNull();
    expect(post).not.toHaveBeenCalled();
});

test("撤销被服务端拒绝时展示原因，保留原状和可重试入口", async () => {
    const reason = "这条修改之后相关记忆又变化了，无法自动撤销；请在记忆列表里手动调整";
    post.mockRejectedValueOnce(new ApiError(reason, { status: 409, reason: "conflict" }));
    const update = { revisionId: "undo-conflict", status: "applied" as const, summary: "曾经生效的记忆", changes: [] };
    await render(<AgentMemoryUpdateCard update={update} currentStatus="applied" theme={canvasThemes.light} />);
    await act(async () => choice(host, "撤销").click());
    expect(decisions()).toEqual([["/agent/memory/revisions/undo-conflict/undo", {}]]);
    expect(document.body.textContent).toContain(reason);
    expect(host.querySelector('[role="status"]')?.textContent).not.toContain("已撤销这次记忆修改");
    expect(choice(host, "撤销").disabled).toBe(false);
});

const statusPath = "/agent/memory/revisions/statuses";
const conversationId = "memory-history";
const noApproval = () => {
    throw new Error("本用例没有需要审批的工具");
};
function serveMemoryHistory(ids: string[]) {
    const stamp = "2026-01-01T00:00:00Z";
    const run: AgentRun = {
        id: "memory-run",
        conversationId,
        canvasId: "",
        status: "completed",
        permissionMode: "auto",
        createdAt: stamp,
        updatedAt: stamp,
        revision: 1,
        eventCount: ids.length,
        events: ids.map((id, index) => ({ eventId: `memory-run:${index + 1}`, runId: "memory-run", seq: index + 1, type: "memory_updated", payload: { status: "applied", revisionId: id, summary: `合成修订 ${id}` }, createdAt: stamp })),
    };
    get.mockImplementation(async (path) => {
        if (path === `/agent/conversations/${conversationId}/runs`) return { items: [structuredClone(run)] };
        throw new Error(`Unexpected GET ${path}`);
    });
    const statuses = new Map(ids.map((id) => [id, "applied"]));
    const batches: string[][] = [];
    post.mockImplementation(async (path, body) => {
        if (path === statusPath) {
            batches.push([...body.revisionIds]);
            return { statuses: Object.fromEntries(body.revisionIds.map((id: string) => [id, statuses.get(id) ?? "unavailable"])) };
        }
        if (path === `/agent/memory/revisions/${ids[0]}/undo` && statuses.get(ids[0]) === "applied") {
            statuses.set(ids[0], "undone");
            return documentState();
        }
        throw new Error(`Unexpected POST ${path}`);
    });
    return { statuses, batches };
}

function renderConversation(messages: CloudAgentChatMessage[]) {
    return render(<AgentConversation theme={canvasThemes.light} messages={messages} references={[]} busy={false} approval={null} approvalSubmitting={false} onApprovalReasonChange={noApproval} onApprove={noApproval} onReject={noApproval} />);
}
async function renderHistory() {
    const snapshot = await loadCloudAgentConversation(conversationId);
    await renderConversation(snapshot.messages);
}
function receipt(id: string) {
    const summary = [...host.querySelectorAll("span")].find((item) => item.textContent === `合成修订 ${id}`);
    const card = summary?.closest('[role="status"]');
    if (!card) throw new Error(`未展示记忆卡：${id}`);
    return card;
}
const undoButton = (card: Element) => [...card.querySelectorAll("button")].find((button) => button.textContent?.trim() === "撤销" && !button.disabled);
async function until(observe: () => boolean) {
    const deadline = Date.now() + 1000;
    while (!observe() && Date.now() < deadline)
        await act(async () => {
            await Bun.sleep(10);
        });
    expect(observe(), host.textContent || "对话未显示").toBe(true);
}

test("同屏两卡只批查一次；成功撤销后卸载并重新读取未变化的运行历史，仍是已撤销且没有按钮", async () => {
    const { batches } = serveMemoryHistory(["first", "second"]);
    await renderHistory();
    await until(() => Boolean(undoButton(receipt("first")) && undoButton(receipt("second"))));
    expect(batches.map((ids) => [...ids].sort())).toEqual([["first", "second"]]);
    await act(async () => undoButton(receipt("first"))!.click());
    await until(() => Boolean(receipt("first").textContent?.includes("已撤销这次记忆修改")));
    expect(undoButton(receipt("first"))).toBeUndefined();
    expect(undoButton(receipt("second"))).toBeDefined();
    await render(null);
    appQueryClient.clear();
    await renderHistory();
    await until(() => Boolean(receipt("first").textContent?.includes("已撤销这次记忆修改")));
    expect(undoButton(receipt("first"))).toBeUndefined();
    expect(undoButton(receipt("second"))).toBeDefined();
    expect(get.mock.calls.every(([path]) => path === `/agent/conversations/${conversationId}/runs`)).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.filter(([path]) => path.endsWith("/undo"))).toHaveLength(1);
});

test("状态查询失联不可沿用历史撤销；可手动重试，已找不到的修订不能伪装成已撤销或已更新", async () => {
    const { statuses } = serveMemoryHistory(["available", "missing"]);
    statuses.delete("missing");
    post.mockRejectedValueOnce(new Error("临时网络中断"));
    await renderHistory();
    const retry = () => [...host.querySelectorAll("button")].find((button) => /重试|重新核对|重新检查|重新读取/.test(`${button.textContent} ${button.getAttribute("aria-label")}`) && !button.disabled);
    await until(() => Boolean(retry()));
    for (const id of ["available", "missing"]) {
        expect(undoButton(receipt(id))).toBeUndefined();
        expect(receipt(id).textContent).not.toContain("长期记忆已更新");
    }
    await act(async () => retry()!.click());
    await until(() => Boolean(undoButton(receipt("available"))));
    expect(undoButton(receipt("missing"))).toBeUndefined();
    expect(receipt("missing").textContent).not.toMatch(/长期记忆已更新|已撤销这次记忆修改/);
    expect(receipt("missing").textContent).toContain("修订记录已不可用");
    expect(post.mock.calls.map(([path]) => path)).toEqual([statusPath, statusPath]);
});

test("带着已生效的热缓存重开：复核慢时不显示陈旧按钮，复核失败不冒称成功，重试后认领新终态", async () => {
    const { statuses } = serveMemoryHistory(["warm"]);
    await renderHistory();
    await until(() => Boolean(undoButton(receipt("warm"))));
    await render(null);
    const checking = Promise.withResolvers<never>();
    post.mockImplementationOnce(() => checking.promise);
    await renderHistory();
    await until(() => Boolean(receipt("warm").textContent?.includes("正在核对记忆状态")));
    expect(undoButton(receipt("warm"))).toBeUndefined();
    await act(async () => checking.reject(new Error("临时失联")));
    await until(() => Boolean(receipt("warm").textContent?.includes("记忆状态未能核实")));
    expect(undoButton(receipt("warm"))).toBeUndefined();
    expect(receipt("warm").textContent).not.toMatch(/长期记忆已更新|已撤销这次记忆修改/);
    statuses.set("warm", "undone");
    await act(async () => choice(receipt("warm"), "重试").click());
    await until(() => Boolean(receipt("warm").textContent?.includes("已撤销这次记忆修改")));
    expect(undoButton(receipt("warm"))).toBeUndefined();
    expect(post.mock.calls.map(([path]) => path)).toEqual([statusPath, statusPath, statusPath]);
});

test("离线重开已缓存的记忆卡：复核暂停期间不提供撤销，恢复联网后只展示服务端新状态", async () => {
    const { statuses, batches } = serveMemoryHistory(["offline"]);
    const { messages } = await loadCloudAgentConversation(conversationId);
    await renderConversation(messages);
    await until(() => Boolean(undoButton(receipt("offline"))));
    await render(null);
    const previouslyOnline = onlineManager.isOnline();
    try {
        await act(async () => onlineManager.setOnline(false));
        statuses.set("offline", "undone");
        await renderConversation(messages);
        expect(
            appQueryClient
                .getQueryCache()
                .getAll()
                .some((query) => query.state.fetchStatus === "paused"),
        ).toBe(true);
        expect(batches).toEqual([["offline"]]);
        expect(Boolean(undoButton(receipt("offline")))).toBe(false);
        expect(receipt("offline").textContent).not.toMatch(/长期记忆已更新|已撤销这次记忆修改/);
        await act(async () => onlineManager.setOnline(true));
        await until(() => Boolean(receipt("offline").textContent?.includes("已撤销这次记忆修改")));
        expect(Boolean(undoButton(receipt("offline")))).toBe(false);
        expect(batches).toEqual([["offline"], ["offline"]]);
    } finally {
        await act(async () => onlineManager.setOnline(previouslyOnline));
    }
});

test("长对话只核对正在展示的记忆卡，展开更早记录时才读取那一批", async () => {
    const { batches } = serveMemoryHistory(["earlier", "recent"]);
    const { messages } = await loadCloudAgentConversation(conversationId);
    const between = Array.from({ length: 80 }, (_, index) => ({ id: `notice-${index}`, role: "system" as const, text: "会话记录" }));
    await renderConversation([messages[0], ...between, ...messages.slice(1)]);
    await until(() => Boolean(undoButton(receipt("recent"))));
    expect(batches).toEqual([["recent"]]);
    expect(host.textContent).not.toContain("合成修订 earlier");
    const earlier = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("查看更早的"));
    expect(earlier).toBeDefined();
    await act(async () => earlier!.click());
    await until(() => Boolean(undoButton(receipt("earlier"))));
    expect(batches.slice(1).flat()).toContain("earlier");
});
