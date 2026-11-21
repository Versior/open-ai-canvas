import { afterAll, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { Window } from "happy-dom";
import type { CloudAgentConversation } from "@/services/cloud-agent-conversations";

const browser = new Window({ url: "http://localhost/" });
Object.defineProperty(browser, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: browser.localStorage });
const { localForageStorageForScope } = await import("@/lib/localforage-storage");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { loadCloudAgentConversations, saveCloudAgentConversations, saveCloudAgentPendingSubmission, loadCloudAgentPendingSubmission } = await import("@/services/cloud-agent-conversations");
const { default: localforage } = await import("localforage");
afterAll(() => browser.happyDOM.abort());
const oldKey = "cloud-agent-conversations-v2:global";

function oldWindowWrite(conversations: CloudAgentConversation[], activeId = conversations[0].id) {
    return localForageStorageForScope().setItem(oldKey, JSON.stringify({ version: 1, activeId, conversations }));
}

function chat(id: string, draft = id): CloudAgentConversation {
    const stamp = "2026-01-01T00:00:00Z";
    return { id, draft, title: id, messages: [], run: null, permissionMode: "read_only", createdAt: stamp, updatedAt: stamp };
}

test("旧账号快照按会话一次迁移，保留草稿、活动位置与账号边界", async () => {
    setActiveUserScope("migration");
    const cache = localForageStorageForScope("migration");
    const first = chat("one"),
        second = chat("two");
    const old = { version: 1, activeId: second.id, conversations: [first, second] };
    await cache.setItem(oldKey, JSON.stringify(old));
    expect(await loadCloudAgentConversations()).toEqual(old);
    expect(await cache.getItem(oldKey)).toBeNull();
    expect(await loadCloudAgentConversations()).toEqual(old);
    setActiveUserScope("someone-else");
    expect(await loadCloudAgentConversations()).toEqual({ version: 1, activeId: null, conversations: [] });
});

test("交错写不同对话不覆盖；删除标记能拒绝已加载旧会话的迟到写入", async () => {
    setActiveUserScope("windows");
    const first = chat("one"),
        second = chat("two");
    await Promise.all([saveCloudAgentConversations(first.id, first), saveCloudAgentConversations(second.id, second)]);
    await saveCloudAgentConversations(first.id, { ...first, draft: "new first" });
    await saveCloudAgentConversations(second.id, { ...second, draft: "new second" });
    expect((await loadCloudAgentConversations()).conversations.map(({ draft }) => draft).sort()).toEqual(["new first", "new second"]);
    await saveCloudAgentConversations(second.id, undefined, undefined, [first.id]);
    await expect(saveCloudAgentConversations(first.id, first)).rejects.toThrow("另一个窗口删除");
    expect((await loadCloudAgentConversations()).conversations.map(({ id }) => id)).toEqual([second.id]);
});

test("损坏旧缓存会报错，保留原始数据而不是迁移成空会话", async () => {
    setActiveUserScope("corrupt");
    const cache = localForageStorageForScope(),
        key = "cloud-agent-conversations-v2:global";
    await cache.setItem(key, "invalid");
    await expect(loadCloudAgentConversations()).rejects.toThrow("已损坏");
    expect(await cache.getItem(key)).toBe("invalid");
});

test("排队等待的旧账号写入不能在切换账号后执行", async () => {
    setActiveUserScope("old-account");
    const late = saveCloudAgentConversations("old", chat("old"));
    setActiveUserScope("new-account");
    await expect(late).rejects.toThrow();
    expect((await loadCloudAgentConversations()).conversations).toBeEmpty();
    setActiveUserScope("old-account");
    expect((await loadCloudAgentConversations()).conversations).toBeEmpty();
});

test("旧窗口在迁移后继续改稿时接续原会话；后台保存的时间不等于本地改稿", async () => {
    setActiveUserScope("mixed-version-forward");
    const first = chat("one", "最初的草稿");
    const other = chat("other");
    await oldWindowWrite([first, other]);
    await loadCloudAgentConversations();
    const messages = [{ id: "progress", role: "assistant" as const, text: "新窗口收到的进度", streaming: false }];
    await saveCloudAgentConversations(first.id, { ...first, updatedAt: "2026-01-04T00:00:00Z", messages });
    const changed = { ...first, draft: "旧窗口后来输入的新稿", updatedAt: "2026-01-03T00:00:00Z" };
    const extra = chat("新增旧会话");
    await oldWindowWrite([changed, extra]);
    const read = await loadCloudAgentConversations();
    expect(read.activeId).toBe(first.id);
    expect(read.conversations.map(({ id }) => id).sort()).toEqual([first.id, other.id, extra.id].sort());
    const continued = read.conversations.find(({ id }) => id === first.id)!;
    expect(continued.draft).toBe(changed.draft);
    expect(continued.messages).toEqual(messages);
    expect(continued.draftEditId).toBeTruthy();
    await oldWindowWrite([first, other]);
    expect((await loadCloudAgentConversations()).conversations.find(({ id }) => id === first.id)?.draft).toBe(changed.draft);
    expect(await localForageStorageForScope().getItem(oldKey)).toBeNull();
});

test("新旧窗口确有分叉才产生独立草稿；连续旧编辑接着同一份，删除后不复活，也不复制待确认身份", async () => {
    setActiveUserScope("mixed-version-fork");
    const first = { ...chat("one", "起点"), serverConversationId: "existing-cloud-id" };
    const removed = chat("removed");
    await oldWindowWrite([first, removed]);
    await loadCloudAgentConversations();
    const local = { ...first, draft: "新窗口正在写", draftEditId: "new-local-edit", updatedAt: "2026-01-02T00:00:00Z" };
    await saveCloudAgentConversations(first.id, local, undefined, [removed.id]);
    const pending = { key: "previous-paid-request", fingerprint: "same-draft", draftEditId: local.draftEditId };
    await saveCloudAgentPendingSubmission(first.id, pending);
    await oldWindowWrite([{ ...first, updatedAt: "2026-01-03T00:00:00Z" }, removed]);
    expect((await loadCloudAgentConversations()).conversations).toEqual([local]);
    const prefill = { displayText: "原分镜", text: "旧页面请求全文", target: { canvasId: "original-canvas" } };
    const branched = { ...first, draft: prefill.displayText, draftPrefill: prefill, updatedAt: "2026-01-04T00:00:00Z" };
    await oldWindowWrite([branched, removed]);
    const read = await loadCloudAgentConversations();
    expect(read.activeId).toBe(first.id);
    expect(read.conversations).toHaveLength(2);
    expect(read.conversations.find(({ id }) => id === first.id)).toEqual(local);
    const recovered = read.conversations.find(({ id }) => id !== first.id)!;
    expect(recovered.draft).toBe(prefill.displayText);
    expect(recovered.draftPrefill).toEqual(prefill);
    expect(recovered.serverConversationId).toBeUndefined();
    expect(recovered.runs).toBeUndefined();
    expect(recovered.run).toBeNull();
    expect(recovered.messages).toBeEmpty();
    expect(await loadCloudAgentPendingSubmission(recovered.id)).toBeNull();
    expect(await loadCloudAgentPendingSubmission(first.id)).toMatchObject(pending);
    await oldWindowWrite([{ ...branched, draft: "旧窗口继续输入", draftPrefill: undefined, updatedAt: "2026-01-05T00:00:00Z" }, removed]);
    const again = await loadCloudAgentConversations();
    expect(again.conversations).toHaveLength(2);
    expect(again.conversations.find(({ id }) => id === recovered.id)?.draft).toBe("旧窗口继续输入");
    await saveCloudAgentConversations(first.id, local, undefined, [recovered.id]);
    await oldWindowWrite([{ ...branched, updatedAt: "2026-01-06T00:00:00Z" }, removed]);
    expect((await loadCloudAgentConversations()).conversations).toEqual([local]);
});

test("localforage 回退到 localStorage 时展示同账号只读原档，写入报错且不会删改旧档", async () => {
    setActiveUserScope("localstorage-recovery");
    await localforage.setDriver(localforage.LOCALSTORAGE);
    try {
        const first = chat("old-local", "只能复制的原文"),
            second = chat("second");
        await oldWindowWrite([second, first], first.id);
        const cache = localForageStorageForScope(),
            raw = await cache.getItem(oldKey);
        expect(await loadCloudAgentConversations()).toMatchObject({ readOnly: true, activeId: first.id, conversations: [second, first] });
        await expect(saveCloudAgentConversations(null, undefined, undefined, [first.id])).rejects.toThrow("IndexedDB");
        expect(await cache.getItem(oldKey)).toBe(raw);
        setActiveUserScope("localstorage-other");
        expect(await loadCloudAgentConversations()).toMatchObject({ readOnly: true, conversations: [] });
    } finally {
        await localforage.setDriver(localforage.INDEXEDDB);
    }
});
