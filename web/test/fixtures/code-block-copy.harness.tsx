import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AiMessageCodeBlock } = await import("@/components/ai/ai-message-code-block");
afterAll(async () => {
    await dom.happyDOM.abort();
});

test("copy feedback follows clipboard success, rejection and missing API", async () => {
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<AiMessageCodeBlock isStreaming>example</AiMessageCodeBlock>));
    const button = host.querySelector("button")!;
    let finish!: () => void;
    Object.defineProperty(dom.navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        },
    });
    await act(async () => button.click());
    expect(button.getAttribute("aria-label")).toBe("复制代码");
    await act(async () => finish());
    expect(button.getAttribute("aria-label")).toBe("已复制");
    Object.defineProperty(dom.navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: async () => {
                throw new Error("denied");
            },
        },
    });
    await act(async () => button.click());
    expect(button.getAttribute("aria-label")).toBe("复制失败，请手动选中复制");
    Object.defineProperty(dom.navigator, "clipboard", { configurable: true, value: undefined });
    await act(async () => button.click());
    expect(button.textContent).toContain("复制失败");
    await act(async () => root.unmount());
});
