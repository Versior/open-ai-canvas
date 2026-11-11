import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLMediaElement", "Element", "Node", "Event", "MutationObserver", "ResizeObserver"]) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : key === "document" ? dom.document : dom[key as keyof Window] });
}
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: dom.requestAnimationFrame.bind(dom) });
Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: dom.cancelAnimationFrame.bind(dom) });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentPetSprite } = await import("@/components/canvas/agent-pet-sprite");
const { useAgentAvatarMotion } = await import("@/hooks/use-agent-avatar-motion");
const { AgentAvatarVideo } = await import("@/components/canvas/agent-avatar-video");
const { useAgentLauncherPosition } = await import("@/components/canvas/use-agent-launcher-position");
const { AGENT_LAUNCHER_POSITION_KEY } = await import("@/lib/canvas/agent-launcher-position");

afterAll(() => dom.happyDOM.abort());

test("鼠标持续移动超过一秒仍保持视线跟随，停下才恢复动作", async () => {
    const originalNow = Date.now;
    const originalRAF = dom.requestAnimationFrame;
    const originalCancel = dom.cancelAnimationFrame;
    const callbacks = new Map<number, FrameRequestCallback>();
    let time = 1000;
    let sequence = 0;
    Date.now = () => time;
    dom.requestAnimationFrame = (callback) => {
        const id = ++sequence;
        callbacks.set(id, callback);
        return id;
    };
    dom.cancelAnimationFrame = (id) => {
        callbacks.delete(id);
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AgentPetSprite src="" version={2} state="idle" width={96} height={104} ambient lookAtPointer />));
        host.firstElementChild!.getBoundingClientRect = () => ({ x: 300, y: 300, left: 300, top: 300, right: 396, bottom: 404, width: 96, height: 104, toJSON: () => ({}) });
        const move = async (x: number, y: number) => {
            await act(async () => dom.dispatchEvent(new dom.PointerEvent("pointermove", { clientX: x, clientY: y, pointerType: "mouse" })));
            await act(async () => {
                for (const [id, callback] of [...callbacks]) {
                    callbacks.delete(id);
                    callback(time);
                }
            });
        };
        await move(700, 200);
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("look");
        time += 1100;
        await move(100, 200);
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("look");
        time += 2000;
        await move(100, 600);
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("look");
        await act(async () => root.render(<AgentPetSprite src="" version={2} state="running" width={96} height={104} ambient lookAtPointer />));
        expect(host.firstElementChild!.getAttribute("data-pet-row")).toBe("running");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        Date.now = originalNow;
        dom.requestAnimationFrame = originalRAF;
        dom.cancelAnimationFrame = originalCancel;
    }
});

test("桌面拖拽位置不进入窄屏，窄屏移动与返回桌面各自恢复", async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const originalWidth = dom.innerWidth;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
    dom.localStorage.setItem(AGENT_LAUNCHER_POSITION_KEY, JSON.stringify({ right: 140, bottom: 80 }));
    dom.innerWidth = 1280;
    let launcher: ReturnType<typeof useAgentLauncherPosition>;
    function Harness() {
        launcher = useAgentLauncherPosition(() => {}, 70, 76);
        return <button onKeyDown={launcher.handlers.onKeyDown} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<Harness />));
        expect(launcher!.position).toEqual({ right: 140, bottom: 80 });
        dom.innerWidth = 390;
        await act(async () => dom.dispatchEvent(new Event("resize")));
        expect(launcher!.position).toEqual({ right: 20, bottom: 20 });
        await act(async () => host.querySelector("button")!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
        expect(launcher!.position).toEqual({ right: 30, bottom: 20 });
        expect(JSON.parse(dom.localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY)!)).toEqual({ right: 140, bottom: 80 });
        dom.innerWidth = 1280;
        await act(async () => dom.dispatchEvent(new Event("resize")));
        expect(launcher!.position).toEqual({ right: 140, bottom: 80 });
        dom.innerWidth = 390;
        await act(async () => dom.dispatchEvent(new Event("resize")));
        expect(launcher!.position).toEqual({ right: 30, bottom: 20 });
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.innerWidth = originalWidth;
        dom.localStorage.clear();
        if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
        else delete (globalThis as unknown as Record<string, unknown>).localStorage;
    }
});

test("视频页面隐藏时停止解码，返回可见后恢复，减少动效不自动播放", async () => {
    const proto = dom.HTMLVideoElement.prototype;
    const originalPlay = proto.play;
    const originalPause = proto.pause;
    const originalReady = Object.getOwnPropertyDescriptor(proto, "readyState");
    const originalMediaReady = Object.getOwnPropertyDescriptor(dom.HTMLMediaElement, "HAVE_CURRENT_DATA");
    const originalContext = dom.HTMLCanvasElement.prototype.getContext;
    let plays = 0;
    let pauses = 0;
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    proto.play = async () => {
        plays++;
    };
    proto.pause = () => {
        pauses++;
    };
    Object.defineProperty(proto, "readyState", { configurable: true, get: () => 0 });
    Object.defineProperty(dom.HTMLMediaElement, "HAVE_CURRENT_DATA", { configurable: true, value: 2 });
    dom.HTMLCanvasElement.prototype.getContext = (() => ({})) as typeof originalContext;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<AgentAvatarVideo src="test-avatar.mp4" />));
        expect(plays).toBeGreaterThan(0);
        hidden = true;
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        expect(pauses).toBeGreaterThan(0);
        const before = plays;
        hidden = false;
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        expect(plays).toBeGreaterThan(before);
        await act(async () => root.render(<AgentAvatarVideo src="test-avatar.mp4" reducedMotion />));
        expect(host.querySelector("video")!.autoplay).toBe(false);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        proto.play = originalPlay;
        proto.pause = originalPause;
        if (originalReady) Object.defineProperty(proto, "readyState", originalReady);
        else delete (proto as unknown as Record<string, unknown>).readyState;
        if (originalMediaReady) Object.defineProperty(dom.HTMLMediaElement, "HAVE_CURRENT_DATA", originalMediaReady);
        else delete (dom.HTMLMediaElement as unknown as Record<string, unknown>).HAVE_CURRENT_DATA;
        dom.HTMLCanvasElement.prototype.getContext = originalContext;
        delete (document as unknown as Record<string, unknown>).hidden;
        delete (document as unknown as Record<string, unknown>).visibilityState;
    }
});

test("视频形象轮换真实动作，任务优先，结束回待机，隐藏和减少动效停止调度", async () => {
    const originalSet = dom.setTimeout;
    const originalClear = dom.clearTimeout;
    const timers = new Map<number, () => void>();
    let sequence = 0;
    dom.setTimeout = ((callback: () => void) => {
        const id = ++sequence;
        timers.set(id, callback);
        return id;
    }) as typeof dom.setTimeout;
    dom.clearTimeout = ((id: number) => timers.delete(id)) as typeof dom.clearTimeout;
    const manifest = { version: 1 as const, width: 480, height: 432, clips: { idle: "idle.mp4", think: "think.mp4", wave: "wave.mp4", talk: "talk.mp4", jump: "jump.mp4", working_loop: "work.mp4" } };
    let motion: ReturnType<typeof useAgentAvatarMotion>;
    function Harness({ state = "idle", paused = false, reducedMotion = false, engaged = false }: { state?: "idle" | "running" | "completed" | "waiting_approval"; paused?: boolean; reducedMotion?: boolean; engaged?: boolean }) {
        motion = useAgentAvatarMotion({ manifest, state, stateClip: state === "running" ? "working_loop" : state === "completed" ? "wave" : state === "waiting_approval" ? "think" : "idle", idleClip: "idle", paused, reducedMotion, engaged });
        return <span data-clip={motion.clip} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const tick = async () => {
        const [id, callback] = [...timers][0];
        timers.delete(id);
        await act(async () => callback());
    };
    try {
        await act(async () => root.render(<Harness />));
        expect(motion!.clip).toBe("idle");
        const observed = new Set<string>();
        for (let index = 0; index < 4; index++) {
            await tick();
            observed.add(motion!.clip);
            expect(motion!.loop).toBe(false);
            await act(async () => motion.onEnded());
            expect(motion!.clip).toBe("idle");
        }
        expect([...observed]).toEqual(["think", "wave", "talk"]);
        await act(async () => root.render(<Harness engaged />));
        expect(motion!.clip).not.toBe("idle");
        await act(async () => root.render(<Harness state="running" engaged />));
        expect(motion!.clip).toBe("working_loop");
        expect(timers.size).toBe(0);
        await act(async () => motion.interact());
        expect(motion!.clip).toBe("working_loop");
        await act(async () => root.render(<Harness state="waiting_approval" />));
        expect(motion!.clip).toBe("think");
        expect(timers.size).toBe(0);
        await act(async () => root.render(<Harness state="completed" />));
        expect(motion!.clip).toBe("wave");
        expect(motion!.loop).toBe(false);
        await act(async () => motion.onEnded());
        expect(motion!.clip).toBe("idle");
        expect(motion!.loop).toBe(true);
        await act(async () => root.render(<Harness paused />));
        expect(timers.size).toBe(0);
        await act(async () => root.render(<Harness reducedMotion />));
        expect(timers.size).toBe(0);
        expect(motion!.clip).toBe("idle");
    } finally {
        await act(async () => root.unmount());
        expect(timers.size).toBe(0);
        host.remove();
        dom.setTimeout = originalSet;
        dom.clearTimeout = originalClear;
    }
});

test("视频形象自动躺下、睡眠和起身，工作随时接管", async () => {
    const originalSet = dom.setTimeout;
    const originalClear = dom.clearTimeout;
    const timers = new Map<number, () => void>();
    let sequence = 0;
    dom.setTimeout = ((callback: () => void) => {
        const id = ++sequence;
        timers.set(id, callback);
        return id;
    }) as typeof dom.setTimeout;
    dom.clearTimeout = ((id: number) => timers.delete(id)) as typeof dom.clearTimeout;
    const manifest = { version: 1 as const, width: 480, height: 432, clips: { idle: "idle.mp4", lie_down: "lie.mp4", sleep_loop: "sleep.mp4", wake_up: "wake.mp4", working_loop: "work.mp4", run: "run.mp4" } };
    let motion: ReturnType<typeof useAgentAvatarMotion>;
    function Harness({ state = "idle" }: { state?: "idle" | "running" }) {
        motion = useAgentAvatarMotion({ manifest, state, stateClip: state === "running" ? "working_loop" : "idle", idleClip: "idle", paused: false, reducedMotion: false, engaged: false });
        return <span data-clip={motion.clip} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const tick = async () => {
        const [id, callback] = [...timers][0];
        timers.delete(id);
        await act(async () => callback());
    };
    try {
        await act(async () => root.render(<Harness />));
        await tick();
        expect(motion!.clip).toBe("lie_down");
        expect(motion!.loop).toBe(false);
        await act(async () => motion.onEnded());
        expect(motion!.clip).toBe("sleep_loop");
        expect(motion!.loop).toBe(false);
        await act(async () => motion.onEnded());
        expect(motion!.clip).toBe("wake_up");
        await act(async () => motion.onEnded());
        expect(motion!.clip).toBe("idle");
        await tick();
        expect(motion!.clip).toBe("lie_down");
        await act(async () => motion.onEnded());
        await act(async () => root.render(<Harness state="running" />));
        expect(motion!.clip).toBe("working_loop");
        expect(timers.size).toBe(0);
        await act(async () => motion.onEnded());
        expect(motion!.clip).toBe("working_loop");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        dom.setTimeout = originalSet;
        dom.clearTimeout = originalClear;
    }
});

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
        expect(observed.has("jumping")).toBe(false);
        expect(observed.has("running-left")).toBe(false);
        expect(observed.has("running-right")).toBe(false);
        expect(observed.has("failed")).toBe(false);
        await render("idle", { id: 1, row: "jumping" });
        expect(row()).toBe("jumping");
        await tick();
        await render("idle", { id: 2, row: "jumping" });
        expect(host.firstElementChild!.getAttribute("style")).toContain("background-position: 0px");
        for (let index = 0; index < 8 && row() !== "idle"; index++) await tick();
        expect(row()).toBe("idle");
        expect([...timers.values()][0].delay).toBe(1800);
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
