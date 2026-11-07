import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AgentPet } from "@/services/api/agent-pets";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Image: dom.Image, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentWindowPerch } = await import("@/components/canvas/agent-window-perch");
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
        if (delay !== 4000) return timeout(callback, delay, ...args);
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
    expect(expanded()).toBe("true");
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
