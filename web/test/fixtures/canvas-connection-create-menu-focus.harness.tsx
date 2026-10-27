import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { HTMLAttributes, RefObject } from "react";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    KeyboardEvent: dom.KeyboardEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act, forwardRef, useCallback, useState } = await import("react");
const { mock } = await import("bun:test");
mock.module("motion/react", () => ({
    motion: {
        div: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { initial?: unknown; animate?: unknown; transition?: unknown }>(({ initial: _initial, animate: _animate, transition: _transition, ...props }, ref) => <div ref={ref} {...props} />),
    },
    useReducedMotion: () => true,
}));
const { createRoot } = await import("react-dom/client");
const { CanvasConnectionCreateMenu } = await import("../../src/components/canvas/canvas-workspace-overlays");
const { CanvasNodeType } = await import("../../src/types/canvas");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function setupSurface() {
    const host = document.createElement("div");
    const canvas = document.createElement("div");
    const trigger = document.createElement("button");
    const outside = document.createElement("button");
    document.body.append(trigger, outside, canvas, host);
    Object.defineProperties(canvas, {
        clientWidth: { configurable: true, value: 1280 },
        clientHeight: { configurable: true, value: 800 },
    });
    const root = createRoot(host);
    trigger.focus();
    return { host, canvas, trigger, outside, root };
}

function MenuHarness({ canvas, allDisabled = false, onClose }: { canvas: HTMLDivElement; allDisabled?: boolean; onClose: () => void }) {
    const [open, setOpen] = useState(true);
    const close = useCallback(() => {
        onClose();
        setOpen(false);
    }, [onClose]);
    if (!open) return null;
    return (
        <CanvasConnectionCreateMenu
            pending={{ connection: { nodeId: "source", handleType: "source" }, position: { x: 40, y: 40 } }}
            viewport={{ x: 0, y: 0, k: 1 }}
            viewportSize={{ width: 1280, height: 800 }}
            containerRef={{ current: canvas } as RefObject<HTMLDivElement>}
            canCreateDrawing={false}
            getDisabledReason={(type) => (allDisabled || type === CanvasNodeType.Text ? "暂不可用" : "")}
            onCreate={() => {}}
            onClose={close}
        />
    );
}

test("连接创建弹层接管焦点，Escape 在焦点移出后仍关闭并恢复触发焦点", async () => {
    const surface = setupSurface();
    let closeCount = 0;
    try {
        await act(async () => surface.root.render(<MenuHarness canvas={surface.canvas} onClose={() => closeCount++} />));
        const dialog = document.querySelector<HTMLElement>("[data-connection-create-menu]")!;
        const options = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[data-create-option]"));
        expect(dialog.getAttribute("role")).toBe("dialog");
        expect(options[0].getAttribute("aria-disabled")).toBe("true");
        expect(document.activeElement === options.find((option) => option.getAttribute("aria-disabled") !== "true")).toBe(true);

        await act(async () => {
            surface.outside.focus();
        });
        await act(async () => {
            document.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        });
        expect(closeCount).toBe(1);
        expect(document.querySelector("[data-connection-create-menu]")).toBeNull();
        expect(document.activeElement === surface.trigger).toBe(true);
    } finally {
        await act(async () => surface.root.unmount());
        surface.host.remove();
        surface.canvas.remove();
        surface.trigger.remove();
        surface.outside.remove();
    }
});

test("连接创建弹层没有可用选项时聚焦弹层容器", async () => {
    const surface = setupSurface();
    try {
        await act(async () => surface.root.render(<MenuHarness canvas={surface.canvas} allDisabled onClose={() => {}} />));
        const dialog = document.querySelector<HTMLElement>("[data-connection-create-menu]")!;
        expect(dialog.tabIndex).toBe(-1);
        expect(document.activeElement === dialog).toBe(true);
    } finally {
        await act(async () => surface.root.unmount());
        expect(document.activeElement === surface.trigger).toBe(true);
        surface.host.remove();
        surface.canvas.remove();
        surface.trigger.remove();
        surface.outside.remove();
    }
});
