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

test("selected pet takes precedence over the private avatar, which uses the private manifest and clip URLs", async () => {
    const { useUserStore } = await import("@/stores/use-user-store");
    const { useAppearancePreferencesStore } = await import("@/stores/use-appearance-preferences-store");
    const originalFetch = globalThis.fetch;
    const originalUser = useUserStore.getState().user;
    const originalPreferences = useAppearancePreferencesStore.getState().byUser;
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return Response.json({ version: 1, width: 64, height: 64, clips: { idle: "idle.mp4" } });
    }) as typeof fetch;
    useUserStore.setState({ user: { id: "perch-user", username: "perch", displayName: "测试", role: "user", status: "active" } });
    useAppearancePreferencesStore.getState().update("perch-user", { avatar: "custom", customAvatar: { type: "bundle", resourceId: "perch-bundle" } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AgentWindowPerch pet={pet} status="idle" reducedMotion />));
        expect(requests).toEqual([]);
        expect(host.querySelector(".agent-perch-character")?.getAttribute("aria-label")).toContain(pet.name);
        await act(async () => root.render(<AgentWindowPerch pet={null} status="idle" reducedMotion />));
        expect(requests.map((url) => new URL(url, document.baseURI).pathname)).toEqual(["/api/appearance/avatar/perch-bundle/avatar.json"]);
        expect(new URL(host.querySelector("video")!.src).pathname).toBe("/api/appearance/avatar/perch-bundle/idle.mp4");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        globalThis.fetch = originalFetch;
        useUserStore.setState({ user: originalUser });
        useAppearancePreferencesStore.setState({ byUser: originalPreferences });
    }
});

test("window dock stays in the composer positioning context", async () => {
    const composer = dom.document.createElement("div");
    composer.className = "relative";
    dom.document.body.append(composer);
    const root = createRoot(composer);
    await act(async () =>
        root.render(
            <AgentWindowDock>
                <span>角色</span>
            </AgentWindowDock>,
        ),
    );
    const dock = composer.querySelector<HTMLElement>(".agent-window-dock");
    expect(dock).not.toBeNull();
    expect(dock?.parentElement).toBe(composer);
    expect(dock?.hasAttribute("data-side")).toBeFalse();
    expect(composer.querySelector(".agent-perch-anchor")).toBeNull();
    await act(async () => root.unmount());
    expect(composer.querySelector(".agent-window-dock")).toBeNull();
    composer.remove();
    await dom.happyDOM.abort();
});
