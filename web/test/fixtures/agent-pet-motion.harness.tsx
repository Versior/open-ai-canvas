import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver", "ResizeObserver"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentPetSprite } = await import("@/components/canvas/agent-pet-sprite");

afterAll(() => dom.happyDOM.abort());

test("空闲轮换多种动作，主动动作只播一次且不覆盖工作与审批", async () => {
    const originalSet = dom.setTimeout;
    const originalClear = dom.clearTimeout;
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let sequence = 0;
    dom.setTimeout = ((callback: () => void, delay: number) => {
        const id = ++sequence;
        timers.set(id, { callback, delay });
        return id;
    }) as typeof dom.setTimeout;
    dom.clearTimeout = ((id: number) => timers.delete(id)) as typeof dom.clearTimeout;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const row = () => host.firstElementChild!.getAttribute("data-pet-row");
    const tick = async () => {
        const [id, timer] = [...timers][0];
        timers.delete(id);
        await act(async () => timer.callback());
    };
    const render = async (state: "idle" | "running" | "waiting_approval", action?: { id: number; row: "jumping" | "waving" }, paused = false) => {
        await act(async () => root.render(<AgentPetSprite src="" version={1} state={state} width={96} height={104} ambient action={action} paused={paused} />));
    };
    try {
        await render("idle");
        const observed = new Set([row()]);
        for (let index = 0; index < 60; index++) {
            await tick();
            observed.add(row());
        }
        expect(observed.has("review")).toBe(true);
        expect(observed.has("waving")).toBe(true);
        expect(observed.has("waiting")).toBe(true);
        expect(observed.has("jumping")).toBe(true);
        expect(observed.has("failed")).toBe(false);
        await render("idle", { id: 1, row: "jumping" });
        expect(row()).toBe("jumping");
        await tick();
        await render("idle", { id: 2, row: "jumping" });
        expect(host.firstElementChild!.getAttribute("style")).toContain("background-position: 0px");
        for (let index = 0; index < 8 && row() !== "idle"; index++) await tick();
        expect(row()).toBe("idle");
        expect([...timers.values()][0].delay).toBe(8000);
        await render("running", { id: 3, row: "waving" });
        expect(row()).toBe("running");
        await tick();
        expect(row()).toBe("running");
        await render("waiting_approval", { id: 4, row: "jumping" });
        expect(row()).toBe("waiting");
        await render("idle", { id: 4, row: "jumping" });
        expect(row()).toBe("idle");
        await render("idle", { id: 5, row: "waving" }, true);
        expect(row()).toBe("idle");
        expect(timers.size).toBe(0);
        await render("idle");
        expect(row()).toBe("idle");
        await render("idle", { id: 6, row: "jumping" });
        expect(row()).toBe("jumping");
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="idle" width={96} height={104} ambient action={{ id: 6, row: "jumping" }} dragging />));
        expect(row()).toBe("running-right");
        await render("idle", { id: 6, row: "jumping" });
        expect(row()).toBe("idle");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.setTimeout = originalSet;
        dom.clearTimeout = originalClear;
    }
});

test("终态动作播放一次后回到安静待机，强制动作仍可循环", async () => {
    const originalSet = dom.setTimeout;
    const originalClear = dom.clearTimeout;
    const timers = new Map<number, { callback: () => void; delay: number }>();
    let sequence = 0;
    dom.setTimeout = ((callback: () => void, delay: number) => {
        const id = ++sequence;
        timers.set(id, { callback, delay });
        return id;
    }) as typeof dom.setTimeout;
    dom.clearTimeout = ((id: number) => {
        timers.delete(id);
    }) as typeof dom.clearTimeout;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="idle" width={96} height={104} />));
        expect([...timers.values()][0].delay).toBe(8000);
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="failed" width={96} height={104} />));
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("failed");
        for (let index = 0; index < 16 && host.firstElementChild!.getAttribute("data-pet-row") !== "idle"; index++) {
            const [id, timer] = [...timers][0];
            timers.delete(id);
            await act(async () => timer.callback());
        }
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("idle");
        expect([...timers.values()][0].delay).toBe(8000);
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="idle" width={96} height={104} row="jumping" />));
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("jumping");
        expect([...timers.values()][0].delay).toBeLessThan(8000);
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="completed" width={96} height={104} />));
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("jumping");
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="completed" width={96} height={104} row="running" />));
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("running");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.setTimeout = originalSet;
        dom.clearTimeout = originalClear;
    }
});

test("待机首帧应安静停留，工作动作照常播放，减少动效始终静止", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="idle" width={96} height={104} lookAtPointer={false} />));
        const initial = host.firstElementChild!.getAttribute("style");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 450));
        });
        expect(host.firstElementChild!.getAttribute("style")).toBe(initial);
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="running" width={96} height={104} lookAtPointer={false} />));
        const working = host.firstElementChild!.getAttribute("style");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 160));
        });
        expect(host.firstElementChild!.getAttribute("style")).not.toBe(working);
        await act(async () => root.render(<AgentPetSprite src="" version={1} state="running" width={96} height={104} reducedMotion />));
        const still = host.firstElementChild!.getAttribute("style");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 160));
        });
        expect(host.firstElementChild!.getAttribute("style")).toBe(still);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
