import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { VideoChatContext } from "@/lib/remake/video-chat";
const dom = new Window({ url: "http://localhost/" });
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
    expect(requests).toHaveLength(1);
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
    await act(async () => requests[1].resolve({ text: "无法输出JSON" }));
    expect(results).toHaveLength(1);
    expect(chat.error).toBeTruthy();
    expect(chat.busy).toBe(false);
    await render();
    expect(requests).toHaveLength(2);
    await act(async () => {
        void chat.send("再改一次");
    });
    expect(chat.turns.filter((turn) => turn.text === "再改一次")).toHaveLength(1);
    await act(async () => requests[2].reject(new Error("任务失败")));
    expect(chat.error).toBe("任务失败");
    expect(results).toHaveLength(1);
});
test("新建对话中止旧回填，不影响新请求的状态", async () => {
    await act(async () => {
        void chat.send("旧请求");
    });
    await act(async () => chat.reset());
    expect(requests[3].input.signal?.aborted).toBe(true);
    expect(chat.turns).toHaveLength(0);
    await act(async () => {
        void chat.send("新请求");
        requests[3].resolve(output);
    });
    expect(chat.busy).toBe(true);
    expect(results).toHaveLength(1);
    await act(async () => requests[4].resolve(output));
    expect(results).toHaveLength(2);
});
test("账号切换或卸载拒绝旧结果，访客不创建计费任务", async () => {
    await act(async () => {
        void chat.send("账号A请求");
    });
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
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: new Proxy(dom.localStorage, {
            get: (target, key) =>
                key === "setItem"
                    ? () => {
                          throw new Error("test quota exceeded");
                      }
                    : Reflect.get(target, key),
        }),
    });
    try {
        await act(async () => chat.say("user", "保存失败也不能丢掉这句话"));
        await settle();
        expect(history.error).toContain("未能保存");
        expect(chat.turns).toHaveLength(1);
    } finally {
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
    }
    await act(async () => history.retrySave());
    await settle();
    expect(history.error).toBe("");
    await act(() => root.render(null));
    await render();
    expect(chat.turns[0].text).toBe("保存失败也不能丢掉这句话");
});
