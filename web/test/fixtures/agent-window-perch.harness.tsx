import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AgentPet } from "@/services/api/agent-pets";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Image: dom.Image,
    MutationObserver: dom.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentWindowPerch } = await import("@/components/canvas/agent-window-perch");
const { AgentWindowDock } = await import("@/components/canvas/agent-window-dock");
const { useAgentPetPrefsStore } = await import("@/stores/use-agent-pet-prefs-store");
useAgentPetPrefsStore.setState({ chatter: false });

const pet: AgentPet = {
    id: "test-pet",
    name: "Test",
    description: "",
    spriteVersion: 2,
    revision: "1",
    pixelated: false,
    stateRows: {},
    access: "free",
    priceMicrocredits: 0,
    listPriceMicrocredits: 0,
    promotion: null,
    owned: true,
    memberFree: false,
    usable: true,
    purchasable: false,
    unlockMicrocredits: 0,
    claimable: false,
    category: "",
    badge: "",
    tone: "",
    lines: [],
};

test("idle timeout, active work, focus, completion and full-body entry", async () => {
    const timeout = dom.setTimeout.bind(dom);
    const clear = dom.clearTimeout.bind(dom);
    let sequence = 10000;
    const timers = new Map<number, () => void>();
    dom.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
        if (!delay || delay < 3500 || delay > 12000) return timeout(callback, delay, ...args);
        const id = sequence++;
        timers.set(id, callback);
        return id;
    }) as typeof dom.setTimeout;
    dom.clearTimeout = ((id: number) => {
        if (!timers.delete(id)) clear(id);
    }) as typeof dom.clearTimeout;
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const root = createRoot(host);
    const render = async (status: string, display: "perch" | "full" = "perch") => {
        await act(async () => root.render(<AgentWindowPerch pet={pet} status={status} reducedMotion display={display} />));
    };
    const expanded = () => host.querySelector(".agent-window-perch")?.getAttribute("data-expanded");
    const settle = async () => {
        const callbacks = [...timers.values()];
        timers.clear();
        await act(async () => callbacks.forEach((callback) => callback()));
    };
    await render("idle");
    expect(expanded()).toBe("false");
    await settle();
    expect(expanded()).toBe("false");
    const button = host.querySelector<HTMLButtonElement>(".agent-perch-character")!;
    await act(async () => button.focus());
    expect(expanded()).toBe("true");
    await settle();
    expect(expanded()).toBe("true");
    await act(async () => button.blur());
    await settle();
    expect(expanded()).toBe("false");
    await act(async () => {
        button.focus();
        button.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(expanded()).toBe("true");
    expect(dom.document.activeElement).not.toBe(button);
    await settle();
    await settle();
    expect(expanded()).toBe("false");
    for (const status of ["running", "queued", "waiting_approval"]) {
        await render(status);
        await settle();
        expect(expanded()).toBe("true");
    }
    await render("completed");
    expect(expanded()).toBe("true");
    await settle();
    expect(expanded()).toBe("false");
    await render("idle", "full");
    await settle();
    expect(expanded()).toBe("true");
    await act(async () => root.unmount());
    expect(timers.size).toBe(0);
    await dom.happyDOM.abort();
});

test("window dock uses a zero-height anchor, follows movement and respects viewport space", async () => {
    const resizeCallbacks = new Set<() => void>();
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class {
            constructor(private callback: () => void) {
                resizeCallbacks.add(callback);
            }
            observe() {}
            disconnect() {
                resizeCallbacks.delete(this.callback);
            }
        },
    });
    dom.innerWidth = 1280;
    let left = 20,
        right = 660,
        anchorTop = 580;
    const rect = (x: number, y: number, width: number, height: number) => new dom.DOMRect(x, y, width, height);
    const originalBounds = dom.HTMLElement.prototype.getBoundingClientRect;
    dom.HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.classList.contains("canvas-agent-panel")) return rect(left, 64, right - left, 640);
        if (this.classList.contains("agent-perch-anchor")) return rect(left, anchorTop, right - left, 0);
        return originalBounds.call(this);
    };
    const panel = dom.document.createElement("aside");
    panel.className = "canvas-agent-panel";
    const composer = dom.document.createElement("div");
    panel.append(composer);
    dom.document.body.append(panel);
    const root = createRoot(composer);
    await act(async () =>
        root.render(
            <AgentWindowDock>
                <span>角色</span>
            </AgentWindowDock>,
        ),
    );
    const dock = () => panel.querySelector<HTMLElement>(".agent-window-dock")!;
    expect(composer.querySelector(".agent-window-dock")).toBeNull();
    expect(composer.querySelector(".agent-perch-anchor")?.getBoundingClientRect().height).toBe(0);
    expect(dock().dataset.side).toBe("right");
    expect(dock().style.bottom).toBe("124px");
    left = 640;
    right = 1280;
    await act(async () => {
        panel.style.left = "640px";
    });
    expect(dock().dataset.side).toBe("left");
    anchorTop = 520;
    await act(async () => resizeCallbacks.forEach((callback) => callback()));
    expect(dock().style.bottom).toBe("184px");
    dom.innerWidth = 390;
    left = 0;
    right = 390;
    await act(async () => dom.dispatchEvent(new dom.Event("resize")));
    expect(dock().dataset.side).toBe("inside");
    await act(async () => root.unmount());
    expect(resizeCallbacks.size).toBe(0);
    expect(panel.querySelector(".agent-window-dock")).toBeNull();
    dom.HTMLElement.prototype.getBoundingClientRect = originalBounds;
    panel.remove();
    await dom.happyDOM.abort();
});
