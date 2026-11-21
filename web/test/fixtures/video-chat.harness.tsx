import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { VideoChatContext } from "@/lib/remake/video-chat";
const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(dom, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: IDBKeyRange });
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "Event", "MutationObserver"])
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useVideoChat, videoChatDependencies } = await import("@/pages/video-replication/use-video-chat");
const { useVideoChatHistory, emptyVideoChatDraft, VIDEO_CHAT_HISTORY_KEY } = await import("@/pages/video-replication/use-video-chat-history");
const { localForageStorageForScope } = await import("@/lib/localforage-storage");
const { defaultConfig, createModelChannel, encodeChannelModel } = await import("@/stores/use-config-store");
const { setActiveUserScope, getActiveUserScope } = await import("@/lib/user-scope");
const channel = createModelChannel({ id: "test-text", name: "测试", interfaceType: "openai", baseUrl: "/api", apiKey: "", models: ["gpt-4o"] });
const model = encodeChannelModel(channel.id, "gpt-4o");
const config = { ...defaultConfig, channels: [channel], textModel: model };
const context: VideoChatContext = {
    intent: "creative",
    brief: { scene: "showcase", tone: "natural", seconds: 15, audience: "", objective: "", brand: "" },
    ratio: "9:16",
    note: "不要音乐",
    subject: { name: "蓝色杯", facts: "蓝色外观", images: 1 },
    reference: "无原片",
};
const results: unknown[] = [];
const requests: Array<{ input: Parameters<typeof videoChatDependencies.run>[0]; resolve: (value: BackendGenerationResult) => void; reject: (error: Error) => void }> = [];
videoChatDependencies.run = (input) => new Promise((resolve, reject) => requests.push({ input, resolve, reject }));
const output = { text: JSON.stringify({ reply: "好，改成20秒，保持静音。", intent: "creative", scene: "showcase", tone: "natural", seconds: 20, ratio: "9:16", note: "不要音乐" }) };
let chat: ReturnType<typeof useVideoChat>;
let history: ReturnType<typeof useVideoChatHistory>;
let setDraft: (draft: ReturnType<typeof emptyVideoChatDraft>) => void;
function Harness() {
    const [draft, updateDraft] = useState(() => emptyVideoChatDraft(model));
    setDraft = updateDraft;
    history = useVideoChatHistory(draft, updateDraft);
    chat = useVideoChat(config, model, context, (value) => results.push(value), history);
    return <span>{chat.error}</span>;
}
const root = createRoot(document.createElement("div"));
const settle = async () => {
    for (let i = 0; i < 4; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
};
const waitSubmitted = async (count: number) => {
    for (let step = 0; step < 50 && requests.length < count; step++) await act(() => Bun.sleep(2));
    expect(requests).toHaveLength(count);
};
const render = async () => {
    await act(async () => root.render(<Harness key={getActiveUserScope()} />));
    await settle();
};
afterAll(async () => {
    await act(async () => root.unmount());
    await dom.happyDOM.abort();
});
test("同时两次发送只创建一项文本任务，返回后才更新草稿", async () => {
    setActiveUserScope("chat_user_a");
    await render();
    let pending!: Promise<boolean>;
    await act(async () => {
        pending = chat.send("改成20秒");
        expect(await chat.send("再发一次")).toBe(false);
    });
    await waitSubmitted(1);
    expect(results).toHaveLength(0);
    expect(chat.busy).toBe(true);
    expect(requests[0].input).toMatchObject({ mode: "text", expectedUserScope: "chat_user_a", metadata: { source: "video-creation-chat" } });
    await act(async () => {
        requests[0].resolve(output);
        expect(await pending).toBe(true);
    });
    expect(results).toHaveLength(1);
    expect(chat.turns).toHaveLength(2);
    expect(chat.busy).toBe(false);
});
test("无效回复不修改草稿，显式重试不重复添加同一句话", async () => {
    await act(async () => {
        void chat.send("再改一次");
    });
    await waitSubmitted(2);
    await act(async () => requests[1].resolve({ text: "无法输出JSON" }));
    expect(results).toHaveLength(1);
    expect(chat.error).toBeTruthy();
    expect(chat.busy).toBe(false);
    await render();
    expect(requests).toHaveLength(2);
    await act(async () => {
        void chat.send("再改一次");
    });
    await waitSubmitted(3);
    expect(chat.turns.filter((turn) => turn.text === "再改一次")).toHaveLength(1);
    await act(async () => requests[2].reject(new Error("任务失败")));
    expect(chat.error).toBe("任务失败");
    expect(results).toHaveLength(1);
});
test("新建对话中止旧回填，不影响新请求的状态", async () => {
    await act(async () => {
        void chat.send("旧请求");
    });
    await waitSubmitted(4);
    await act(async () => chat.reset());
    expect(requests[3].input.signal?.aborted).toBe(true);
    expect(chat.turns).toHaveLength(0);
    await act(async () => {
        void chat.send("新请求");
        requests[3].resolve(output);
    });
    await waitSubmitted(5);
    expect(chat.busy).toBe(true);
    expect(results).toHaveLength(1);
    await act(async () => requests[4].resolve(output));
    expect(results).toHaveLength(2);
});
test("账号切换或卸载拒绝旧结果，访客不创建计费任务", async () => {
    await act(async () => {
        void chat.send("账号A请求");
    });
    await waitSubmitted(6);
    setActiveUserScope("chat_user_b");
    await render();
    expect(requests[5].input.signal?.aborted).toBe(true);
    expect(chat.turns).toHaveLength(0);
    await act(async () => requests[5].resolve(output));
    expect(results).toHaveLength(2);
    setActiveUserScope(null);
    await render();
    await act(async () => expect(await chat.send("未登录")).toBe(false));
    expect(requests).toHaveLength(6);
    setActiveUserScope("chat_user_b");
    await render();
    await act(async () => {
        void chat.send("离开页面");
    });
    await waitSubmitted(7);
    await act(async () => root.render(null));
    expect(requests[6].input.signal?.aborted).toBe(true);
    await act(async () => requests[6].resolve(output));
    expect(results).toHaveLength(2);
});

test("卸载刷新后恢复对话和草稿，新建保留历史并可切回", async () => {
    setActiveUserScope("history_owner");
    await render();
    expect(history.ready).toBe(true);
    expect(history.error).toBe("");
    const first = history.activeId;
    const draft = { ...emptyVideoChatDraft(model), note: "不要音乐", text: "还没发送的要求", referenceId: "saved-reference", product: { name: "测试杯", sellingPoints: "蓝色", images: [{ id: "photo", resourceId: "test-image", name: "正面" }] } };
    await act(async () => {
        setDraft(draft);
        chat.say("user", "拍一条杯子视频");
        chat.say("assistant", "好，保留蓝色杯身。");
    });
    await settle();
    await act(() => root.render(null));
    await render();
    expect(chat.turns.map((turn) => turn.text)).toEqual(["拍一条杯子视频", "好，保留蓝色杯身。"]);
    expect(history.sessions.find((s) => s.id === first)?.draft).toEqual(draft);
    await act(async () => chat.reset());
    expect(chat.turns).toHaveLength(0);
    expect(history.sessions).toHaveLength(2);
    await act(async () => chat.say("user", "另一条视频"));
    await act(async () => chat.open(first));
    expect(chat.turns).toHaveLength(2);
    await settle();
    await act(() => root.render(null));
    await render();
    expect(history.activeId).toBe(first);
    expect(chat.turns).toHaveLength(2);
    expect(history.sessions).toHaveLength(2);
});

test("历史损坏时显示读取失败，不能用空会话覆盖原记录", async () => {
    setActiveUserScope("corrupt_history");
    const storage = localForageStorageForScope("corrupt_history");
    await storage.setItem(VIDEO_CHAT_HISTORY_KEY, "broken-json");
    await render();
    expect(history.ready).toBe(false);
    expect(history.error).toContain("原记录未覆盖");
    await act(async () => chat.say("user", "不能覆盖"));
    expect(await storage.getItem(VIDEO_CHAT_HISTORY_KEY)).toBe("broken-json");
});

test("存储写入失败明确提示，重试后保留内存里的消息", async () => {
    setActiveUserScope("write_failure");
    await render();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
        throw new Error("test quota exceeded");
    };
    try {
        await act(async () => chat.say("user", "保存失败也不能丢掉这句话"));
        await settle();
        expect(history.error).toContain("未能保存");
        expect(chat.turns).toHaveLength(1);
    } finally {
        IDBObjectStore.prototype.put = put;
    }
    await act(async () => history.retrySave());
    await settle();
    expect(history.error).toBe("");
    await act(() => root.render(null));
    await render();
    expect(chat.turns[0].text).toBe("保存失败也不能丢掉这句话");
});

test("两个页面保存不同会话不覆盖，同一会话冲突保留两版并可继续编辑", async () => {
    setActiveUserScope("concurrent_history");
    const histories: Array<ReturnType<typeof useVideoChatHistory>> = [];
    function Page({ index }: { index: number }) {
        const [draft, updateDraft] = useState(() => emptyVideoChatDraft(model));
        histories[index] = useVideoChatHistory(draft, updateDraft);
        return null;
    }
    const roots = [createRoot(document.createElement("div")), createRoot(document.createElement("div"))];
    const storage = localForageStorageForScope("concurrent_history");
    try {
        await act(async () => roots.forEach((page, index) => page.render(<Page index={index} />)));
        await settle();
        const ids = histories.map((item) => item.activeId);
        await act(async () => histories.forEach((item, index) => item.setTurns(() => [{ role: "user", text: `页面${index}` }])));
        await settle();
        const saved = JSON.parse((await storage.getItem(VIDEO_CHAT_HISTORY_KEY))!);
        expect(saved.sessions.map((item: { id: string }) => item.id).sort()).toEqual(ids.sort());
        await act(async () => {
            histories[0].reset();
            histories[1].setTurns((turns) => [...turns, { role: "user", text: "新建期间编辑旧会话" }]);
        });
        await settle();
        expect(JSON.parse((await storage.getItem(VIDEO_CHAT_HISTORY_KEY))!).sessions).toHaveLength(3);
        await act(async () => roots.forEach((page) => page.render(null)));
        await act(async () => roots.forEach((page, index) => page.render(<Page index={index} />)));
        await settle();
        expect(histories[0].activeId).toBe(histories[1].activeId);
        await act(async () => histories.forEach((item, index) => item.setTurns((turns) => [...turns, { role: "user", text: `并发${index}` }])));
        await settle();
        expect(histories[0].activeId).not.toBe(histories[1].activeId);
        await act(async () => histories[1].setTurns((turns) => [...turns, { role: "assistant", text: "继续编辑分支" }]));
        await settle();
        const final = JSON.parse((await storage.getItem(VIDEO_CHAT_HISTORY_KEY))!);
        expect(final.sessions).toHaveLength(4);
        const text = final.sessions.flatMap((item: { turns: Array<{ text: string }> }) => item.turns.map((turn) => turn.text));
        expect(text).toContain("并发0");
        expect(text).toContain("并发1");
        expect(text).toContain("新建期间编辑旧会话");
        expect(text).toContain("继续编辑分支");
    } finally {
        await act(async () => roots.forEach((page) => page.unmount()));
    }
});

test("先持久化导演操作；丢回执并刷新时沿用旧操作，显式重新生成才更换", async () => {
    setActiveUserScope("director_replay");
    await render();
    const storage = localForageStorageForScope("director_replay");
    const inputs: Array<Parameters<typeof videoChatDependencies.run>[0]> = [];
    const original = videoChatDependencies.run;
    videoChatDependencies.run = async (input) => {
        const archive = JSON.parse((await storage.getItem(VIDEO_CHAT_HISTORY_KEY)) || "null");
        expect(input.clientOperationId).toBeTruthy();
        expect(archive.sessions.find((session: { id: string }) => session.id === archive.activeId).turns.at(-1).operation.id).toBe(input.clientOperationId);
        inputs.push(input);
        throw new Error("创建回执丢失");
    };
    try {
        await act(async () => expect(await chat.send("保留杯身颜色")).toBe(false));
        expect(inputs).toHaveLength(1);
        await act(() => root.render(null));
        await render();
        await act(async () => expect(await chat.send("保留杯身颜色")).toBe(false));
        expect(inputs[1].clientOperationId).toBe(inputs[0].clientOperationId);
        expect(inputs[1].prompt).toBe(inputs[0].prompt);
        await act(async () => expect(await chat.send("保留杯身颜色", true)).toBe(false));
        expect(inputs[2].clientOperationId).not.toBe(inputs[1].clientOperationId);
        expect(chat.turns).toHaveLength(1);
        expect(inputs[2].prompt).not.toContain(inputs[0].clientOperationId!);
    } finally {
        videoChatDependencies.run = original;
    }
});

test("操作号存档失败不发送计费请求", async () => {
    setActiveUserScope("director_no_storage");
    await render();
    const put = IDBObjectStore.prototype.put;
    const original = videoChatDependencies.run;
    let submitted = 0;
    videoChatDependencies.run = async () => {
        submitted++;
        return output;
    };
    IDBObjectStore.prototype.put = () => {
        throw new Error("测试存储写满");
    };
    try {
        await act(async () => expect(await chat.send("不能发送这条")).toBe(false));
        expect(submitted).toBe(0);
        expect(chat.error).toContain("保存");
    } finally {
        IDBObjectStore.prototype.put = put;
        videoChatDependencies.run = original;
    }
});

test("升级前没有操作号的末条用户消息不能被悄悄重提", async () => {
    setActiveUserScope("old_director_turn");
    await render();
    await act(async () => chat.say("user", "旧消息"));
    await settle();
    const original = videoChatDependencies.run;
    let submissions = 0;
    videoChatDependencies.run = async () => {
        submissions++;
        return output;
    };
    try {
        await act(async () => expect(await chat.send("旧消息")).toBe(false));
        expect(chat.error).toContain("重新生成");
        expect(submissions).toBe(0);
        await act(async () => expect(await chat.send("旧消息", true)).toBe(true));
        expect(submissions).toBe(1);
    } finally {
        videoChatDependencies.run = original;
    }
});
