import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
const preference = Object.assign(new dom.EventTarget(), { matches: false });
dom.matchMedia = (() => preference) as typeof dom.matchMedia;
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    Node: dom.Node,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    CSS: dom.CSS,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    CustomEvent: dom.CustomEvent,
    Event: dom.Event,
    PointerEvent: dom.PointerEvent,
    Document: dom.Document,
    ShadowRoot: dom.ShadowRoot,
    CSSStyleSheet: dom.CSSStyleSheet,
    HTMLMediaElement: dom.HTMLMediaElement,
    HTMLVideoElement: dom.HTMLVideoElement,
    HTMLAudioElement: dom.HTMLAudioElement,
    customElements: dom.customElements,
    screen: dom.screen,
    IntersectionObserver: dom.IntersectionObserver,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: class {
        observe() {}
        disconnect() {}
    },
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const animations: Array<{ update: (progress: number) => void; complete: () => void; stopped: boolean }> = [];
mock.module("motion", () => ({
    animate: (_from: number, _to: number, options: { onUpdate: (progress: number) => void; onComplete: () => void }) => {
        const animation = { update: options.onUpdate, complete: options.onComplete, stopped: false };
        animations.push(animation);
        return {
            stop: () => {
                animation.stopped = true;
            },
        };
    },
}));

const { act, Profiler } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasNode } = await import("../../src/components/canvas/canvas-node");
const { ConnectionPath, canvasConnectionPath } = await import("../../src/components/canvas/canvas-connections");
const { CanvasNodeResizeMotionProvider } = await import("../../src/components/canvas/canvas-node-resize-motion");
const { applyNodeConfigPatch } = await import("../../src/lib/canvas/canvas-project-domain");
const { CanvasNodeType } = await import("../../src/types/canvas");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const noop = () => {};
const target: CanvasNodeData = { id: "target", type: CanvasNodeType.Image, title: "目标", position: { x: 1300, y: 200 }, width: 520, height: 520 };
const connection = { id: "connection", fromNodeId: "image", toNodeId: target.id };

test("pointer resize previews once per frame and commits only on pointerup", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let node: CanvasNodeData = { id: "resize", type: CanvasNodeType.Image, title: "Resize", position: { x: 100, y: 200 }, width: 520, height: 520, metadata: { size: "1:1" } };
    const commits: Array<[string, number, number, { x: number; y: number } | undefined]> = [];
    let contentRenders = 0;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const flushFrames = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(performance.now()));
    };
    try {
        const render = () =>
            root.render(
                <CanvasNodeResizeMotionProvider nodes={[node]}>
                    <Profiler id="resize-content" onRender={() => contentRenders++}>
                        <CanvasNode
                            data={node}
                            scale={0.5}
                            isSelected
                            isRelated={false}
                            isFocusRelated={false}
                            isConnectionTarget={false}
                            showImageInfo={false}
                            onMouseDown={noop}
                            onHoverStart={noop}
                            onHoverEnd={noop}
                            onConnectStart={noop}
                            onResize={(...args) => commits.push(args)}
                            onContentChange={noop}
                            onContextMenu={noop}
                        />
                    </Profiler>
                    <svg>
                        <ConnectionPath connection={{ ...connection, fromNodeId: node.id }} from={node} to={target} active={false} onSelect={noop} />
                    </svg>
                </CanvasNodeResizeMotionProvider>,
            );
        await act(async () => render());
        window.requestAnimationFrame = (callback) => {
            const id = nextFrame++;
            frames.set(id, callback);
            return id;
        };
        window.cancelAnimationFrame = (id) => frames.delete(id);

        const box = host.querySelector<HTMLElement>("[data-node-id=resize]")!;
        const handle = box.querySelector<HTMLElement>("[data-resize-corner=bottom-right]")!;
        const path = () => host.querySelector("[data-connection-id=connection]")!.getAttribute("d");
        const rendersBeforeGesture = contentRenders;
        await act(async () => handle.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, pointerType: "touch", clientX: 0, clientY: 0 })));
        frames.clear();
        await act(async () => {
            handle.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: 20, clientY: 10 }));
            handle.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: 40, clientY: 20 }));
        });
        expect(frames).toHaveLength(1);
        expect(commits).toHaveLength(0);

        await act(async () => flushFrames());
        const preview = { ...node, width: 600, height: 600 };
        expect(box.style.width).toBe("600px");
        expect(box.style.height).toBe("600px");
        expect(path()).toBe(canvasConnectionPath({ ...connection, fromNodeId: node.id }, preview, target).pathD);
        expect(contentRenders).toBe(rendersBeforeGesture);
        expect(commits).toHaveLength(0);

        await act(async () => {
            handle.dispatchEvent(new dom.PointerEvent("pointermove", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: 45, clientY: 25 }));
            handle.dispatchEvent(new dom.PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch", clientX: 50, clientY: 30 }));
        });
        expect(frames).toHaveLength(0);
        expect(commits).toEqual([[node.id, 620, 620, node.position]]);
        expect(box.style.width).toBe("620px");
        expect(box.style.height).toBe("620px");

        node = { ...node, position: { x: 120, y: 220 }, width: 700, height: 700 };
        await act(async () => render());
        expect(commits).toHaveLength(1);
        expect(box.style.transform).toBe("translate(120px, 220px)");
        expect(box.style.width).toBe("700px");
        expect(box.style.height).toBe("700px");
        expect(path()).toBe(canvasConnectionPath({ ...connection, fromNodeId: node.id }, node, target).pathD);
    } finally {
        window.requestAnimationFrame = originalRequestAnimationFrame;
        window.cancelAnimationFrame = originalCancelAnimationFrame;
        if (host.childNodes.length) await act(async () => root.unmount());
        host.remove();
    }
});

test("真实节点 DOM 与 SVG 连线同步；中断、禁用动效和卸载清理", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let node: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 100, y: 200 }, width: 520, height: 520, metadata: { size: "1:1" } };
    let contentRenders = 0;
    const recordContentRender = () => {
        contentRenders++;
    };
    const render = () =>
        root.render(
            <CanvasNodeResizeMotionProvider nodes={[node]}>
                <Profiler id="node-content" onRender={recordContentRender}>
                    <CanvasNode
                        data={node}
                        scale={0.5}
                        isSelected
                        isRelated={false}
                        isFocusRelated={false}
                        isConnectionTarget={false}
                        showImageInfo={false}
                        onMouseDown={noop}
                        onHoverStart={noop}
                        onHoverEnd={noop}
                        onConnectStart={noop}
                        onResize={noop}
                        onContentChange={noop}
                        onContextMenu={noop}
                    />
                </Profiler>
                <svg>
                    <ConnectionPath connection={connection} from={node} to={target} active={false} onSelect={noop} />
                </svg>
            </CanvasNodeResizeMotionProvider>,
        );
    const box = () => host.querySelector<HTMLElement>("[data-node-id=image]")!;
    const path = () => host.querySelector("[data-connection-id=connection]")!.getAttribute("d");
    try {
        await act(async () => render());
        node = applyNodeConfigPatch(node, { size: "16:9" });
        await act(async () => render());
        expect(box().style.width).toBe("520px");
        const rendersBeforeFrame = contentRenders;
        expect(rendersBeforeFrame).toBeGreaterThan(0);
        await act(async () => animations[0].update(0.5));
        const display: CanvasNodeData = { ...node, width: 620, height: 462.5, position: { x: 50, y: 228.75 } };
        expect(box().style.width).toBe(`${display.width}px`);
        expect(box().style.height).toBe(`${display.height}px`);
        expect(box().style.transform).toBe(`translate(${display.position.x}px, ${display.position.y}px)`);
        expect(path()).toBe(canvasConnectionPath(connection, display, target).pathD);
        expect(contentRenders).toBe(rendersBeforeFrame);

        node = applyNodeConfigPatch(node, { size: "9:16" });
        await act(async () => render());
        expect(animations[0].stopped).toBe(true);
        expect(box().style.width).toBe(`${display.width}px`);
        await act(async () => box().dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, button: 0 })));
        expect(animations[1].stopped).toBe(true);
        expect(box().style.width).toBe(`${node.width}px`);
        expect(path()).toBe(canvasConnectionPath(connection, node, target).pathD);

        node = applyNodeConfigPatch(node, { size: "1:1" });
        await act(async () => render());
        await act(async () => {
            preference.matches = true;
            preference.dispatchEvent(new dom.Event("change"));
        });
        expect(animations[2].stopped).toBe(true);
        expect(box().style.width).toBe(`${node.width}px`);
        node = applyNodeConfigPatch(node, { size: "16:9" });
        await act(async () => render());
        expect(animations).toHaveLength(3);

        await act(async () => {
            preference.matches = false;
            preference.dispatchEvent(new dom.Event("change"));
        });
        node = applyNodeConfigPatch(node, { size: "9:16" });
        await act(async () => render());
        expect(animations).toHaveLength(4);
        await act(async () => {
            document.documentElement.classList.add("no-motion");
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
        expect(animations[3].stopped).toBe(true);
        expect(box().style.width).toBe(`${node.width}px`);
        await act(async () => {
            document.documentElement.classList.remove("no-motion");
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
        node = applyNodeConfigPatch(node, { size: "1:1" });
        await act(async () => render());
        await act(async () => root.unmount());
        expect(animations[4].stopped).toBe(true);
    } finally {
        if (host.childNodes.length) await act(async () => root.unmount());
        host.remove();
    }
});
