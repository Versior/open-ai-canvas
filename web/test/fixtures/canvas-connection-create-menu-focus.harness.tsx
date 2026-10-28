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
type CanvasKind = import("../../src/types/canvas").CanvasKind;
type CanvasWorkspaceMode = import("../../src/types/canvas").CanvasWorkspaceMode;

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

function MenuHarness({ canvas, allDisabled = false, canvasKind = "freeform", workspaceMode = "professional", onClose }: { canvas: HTMLDivElement; allDisabled?: boolean; canvasKind?: CanvasKind; workspaceMode?: CanvasWorkspaceMode; onClose: () => void }) {
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
            canvasKind={canvasKind}
            workspaceMode={workspaceMode}
            getDisabledReason={(type) => (allDisabled || type === CanvasNodeType.Text ? "暂不可用" : "")}
            onCreate={() => {}}
            onClose={close}
        />
    );
}

test("连接后菜单在快捷电商只保留商品入口，专业与自由画布不受误伤", async () => {
    const surface = setupSurface();
    const labels = () => new Set(Array.from(surface.host.querySelectorAll<HTMLElement>("[data-create-option]"), (option) => option.getAttribute("aria-label")));
    const render = async (canvasKind: CanvasKind, workspaceMode: CanvasWorkspaceMode) => {
        await act(async () => surface.root.render(<MenuHarness key={`${canvasKind}-${workspaceMode}`} canvas={surface.canvas} canvasKind={canvasKind} workspaceMode={workspaceMode} onClose={() => {}} />));
        return labels();
    };
    try {
        const simple = await render("ecommerce", "simple");
        expect(simple.has("商品")).toBe(true);
        for (const label of ["卖点", "电商生图台", "批量创作表", "生成配置", "音频参考"]) expect(simple.has(label)).toBe(false);

        const professional = await render("ecommerce", "professional");
        for (const label of ["商品", "卖点", "电商生图台", "批量创作表", "生成配置"]) expect(professional.has(label)).toBe(true);
        expect(professional.has("音频参考")).toBe(false);

        const freeform = await render("freeform", "simple");
        expect(freeform.has("商品")).toBe(false);
        expect(freeform.has("批量创作表")).toBe(true);
        expect(freeform.has("生成配置")).toBe(true);
        expect(freeform.has("音频参考")).toBe(false);

        expect((await render("freeform", "professional")).has("音频参考")).toBe(true);
    } finally {
        await act(async () => surface.root.unmount());
        surface.host.remove();
        surface.canvas.remove();
        surface.trigger.remove();
        surface.outside.remove();
    }
});

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
