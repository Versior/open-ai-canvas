import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

const dom = new Window({ url: "http://localhost/" });
const resizeCallbacks = new Set<() => void>();
class ControlledResizeObserver {
    constructor(private callback: () => void) {
        resizeCallbacks.add(callback);
    }
    observe() {}
    disconnect() {
        resizeCallbacks.delete(this.callback);
    }
}
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Image: dom.Image,
    ResizeObserver: ControlledResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, value });
mock.module("@/components/canvas/live2d-avatar", () => ({ Live2DAvatar: () => null }));
mock.module("@/components/canvas/canvas-cloud-agent-chat-ui", () => ({
    AgentChatMessage: ({ item }: { item: CloudAgentChatMessage }) => <p>{item.content}</p>,
    AgentOperationFeed: () => null,
    AgentReasoningFeed: () => null,
    AgentWorkingMessage: () => <p>正在思考</p>,
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentConversation } = await import("@/components/canvas/canvas-cloud-agent-panel-parts");
afterAll(() => dom.happyDOM.abort());

async function conversation() {
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    let messages: CloudAgentChatMessage[] = [{ id: "reply-1", role: "assistant", content: "第一条回复" }];
    const render = async () => {
        await act(async () =>
            root.render(
                <AgentConversation
                    theme={canvasThemes.light}
                    messages={messages}
                    references={[]}
                    busy={false}
                    approval={null}
                    approvalSubmitting={false}
                    nodeCount={0}
                    installedSkillCount={0}
                    onOpenSkillRecommendations={() => {}}
                    onDraftPrompt={() => {}}
                    onApprovalReasonChange={() => {}}
                    onApprove={() => {}}
                    onReject={() => {}}
                />,
            ),
        );
    };
    await render();
    const scroller = host.querySelector<HTMLDivElement>("[data-agent-conversation]")!;
    let height = 300;
    let top = 100;
    Object.defineProperties(scroller, {
        scrollHeight: { get: () => height },
        clientHeight: { get: () => 200 },
        scrollTop: {
            get: () => top,
            set: (value: number) => {
                top = Math.max(0, Math.min(value, height - 200));
            },
        },
    });
    scroller.scrollTo = ((options: ScrollToOptions) => {
        scroller.scrollTop = options.top ?? top;
    }) as typeof scroller.scrollTo;
    const scroll = async (position: number, intent = false) => {
        await act(async () => {
            if (intent) scroller.dispatchEvent(new dom.WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
            top = position;
            scroller.dispatchEvent(new dom.Event("scroll"));
        });
    };
    const resize = async (newHeight: number) => {
        height = newHeight;
        await act(async () => {
            resizeCallbacks.forEach((callback) => callback());
            await new Promise<void>((resolve) => dom.requestAnimationFrame(() => resolve()));
        });
    };
    return {
        host,
        scroller,
        scroll,
        resize,
        setHeight: (value: number) => {
            height = value;
        },
        append: async (role: "user" | "assistant") => {
            messages = [...messages, { id: `message-${messages.length}`, role, content: "新消息" }];
            await render();
        },
        stream: async (content: string) => {
            messages = messages.map((message, index) => (index === messages.length - 1 ? { ...message, content } : message));
            await render();
        },
        cleanup: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

test("layout-induced scroll before resize keeps following new content", async () => {
    const view = await conversation();
    try {
        view.setHeight(500);
        await view.scroll(100);
        await view.resize(500);
        expect(view.scroller.scrollTop).toBe(300);
        expect(view.host.querySelector(".agent-scroll-latest")).toBeNull();
    } finally {
        await view.cleanup();
    }
});

test("reading history holds position; bottom button and sending resume following", async () => {
    const view = await conversation();
    try {
        await view.scroll(0, true);
        await view.append("assistant");
        await view.resize(600);
        expect(view.scroller.scrollTop).toBe(0);
        expect(view.host.querySelector(".agent-scroll-latest")?.textContent).toBe("1 条新消息");
        await act(async () => view.host.querySelector<HTMLButtonElement>(".agent-scroll-latest")!.click());
        await view.scroll(160);
        await view.resize(600);
        expect(view.scroller.scrollTop).toBe(400);
        await view.scroll(0, true);
        await view.append("user");
        expect(view.scroller.scrollTop).toBe(400);
        await view.resize(800);
        expect(view.scroller.scrollTop).toBe(600);
    } finally {
        await view.cleanup();
    }
});

test("touch, keyboard and scrollbar navigation pause; scrolling back down resumes", async () => {
    for (const input of ["touch", "keyboard", "scrollbar"]) {
        const view = await conversation();
        try {
            await act(async () => {
                if (input === "keyboard") view.scroller.dispatchEvent(new dom.KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
                if (input === "scrollbar") view.scroller.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, clientX: 0 }));
                if (input === "touch") {
                    for (const [type, y] of [
                        ["touchstart", 100],
                        ["touchmove", 150],
                    ] as const) {
                        const event = new dom.Event(type, { bubbles: true });
                        Object.defineProperty(event, "touches", { value: [{ clientY: y }] });
                        view.scroller.dispatchEvent(event);
                    }
                }
            });
            await view.scroll(0);
            await view.resize(500);
            expect(view.scroller.scrollTop).toBe(0);
            expect(view.host.querySelector(".agent-scroll-latest")).not.toBeNull();
            await view.scroll(300);
            await view.resize(700);
            expect(view.scroller.scrollTop).toBe(500);
        } finally {
            await view.cleanup();
        }
    }
});

test("unmount cancels a scheduled resize follow", async () => {
    const view = await conversation();
    await act(async () => resizeCallbacks.forEach((callback) => callback()));
    await view.cleanup();
    expect(resizeCallbacks.size).toBe(0);
});

test("long streaming content and delayed media growth retain follow and history intent", async () => {
    const view = await conversation();
    try {
        for (let chunk = 1; chunk <= 40; chunk++) {
            await view.stream("这是一段不断增加的流式回复。\n".repeat(chunk * 5));
            await view.resize(300 + chunk * 100);
            expect(view.scroller.scrollTop).toBe(100 + chunk * 100);
        }
        await view.scroll(900, true);
        await view.resize(12000);
        expect(view.scroller.scrollTop).toBe(900);
        await act(async () => view.host.querySelector<HTMLButtonElement>(".agent-scroll-latest")!.click());
        await view.resize(18000);
        expect(view.scroller.scrollTop).toBe(17800);
    } finally {
        await view.cleanup();
    }
});
