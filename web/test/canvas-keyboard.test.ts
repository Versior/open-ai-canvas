import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { hasCanvasTextSelection, useCanvasKeyboard } from "../src/pages/canvas/use-canvas-keyboard";

test("Canvas copy shortcut yields to a real browser text selection", () => {
    expect(hasCanvasTextSelection(null)).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: true, rangeCount: 1, toString: () => "Agent 文本" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 0, toString: () => "Agent 文本" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 1, toString: () => "" })).toBe(false);
    expect(hasCanvasTextSelection({ isCollapsed: false, rangeCount: 1, toString: () => "Agent 文本" })).toBe(true);
});

test("Canvas keyboard keeps node copy as the fallback when no text is selected", async () => {
    const source = await Bun.file(new URL("../src/pages/canvas/use-canvas-keyboard.ts", import.meta.url)).text();
    expect(source).toContain("if (hasCanvasTextSelection(window.getSelection())) return;");
    expect(source.replace(/\r\n/g, "\n")).toContain("event.preventDefault();\n                copySelectedNodes();");
});

const dom = new Window({ url: "http://localhost/" });
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLSelectElement: dom.HTMLSelectElement,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originalGlobals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function keyboardFixture() {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const counts = { in: 0, out: 0, actual: 0 };
    const noop = () => undefined;

    function Harness() {
        useCanvasKeyboard({
            nodesRef: { current: [] },
            selectedNodeIdsRef: { current: new Set<string>() },
            selectedConnectionId: null,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setContextMenu: noop,
            setShortcutRequestNonce: noop,
            setInfoNodeId: noop,
            setCropNodeId: noop,
            setRegionEditNodeId: noop,
            setAnnotationNodeId: noop,
            saveCanvasProject: noop,
            zoomToActualSize: () => {
                counts.actual += 1;
            },
            fitCanvasContent: noop,
            fitCanvasSelection: noop,
            undoCanvas: noop,
            redoCanvas: noop,
            cancelSelectionBox: noop,
            copySelectedNodes: noop,
            pasteCopiedNodes: () => false,
            restoreCopiedNodesFromText: () => false,
            shouldPreferCopiedNodes: () => false,
            pasteSystemClipboard: () => false,
            deleteNodes: noop,
            deleteConnection: noop,
            deselectCanvas: noop,
            zoomCanvasIn: () => {
                counts.in += 1;
            },
            zoomCanvasOut: () => {
                counts.out += 1;
            },
            focusMode: false,
            exitFocusMode: noop,
            toggleFocusMode: noop,
            onOpenSearch: noop,
            beginBatchConnection: noop,
        });
        return null;
    }

    await act(async () => root.render(createElement(Harness)));
    return {
        counts,
        press(target: Element, key: string, code: string, modifier: "ctrl" | "meta" = "ctrl") {
            const event = new dom.KeyboardEvent("keydown", {
                key,
                code,
                bubbles: true,
                cancelable: true,
                ctrlKey: modifier === "ctrl",
                metaKey: modifier === "meta",
            });
            target.dispatchEvent(event);
            return event;
        },
        dispose: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

test("Canvas zoom shortcuts yield to the browser while editing text", async () => {
    const fixture = await keyboardFixture();
    try {
        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "true");
        const targets = [document.createElement("input"), document.createElement("textarea"), document.createElement("select"), editable];
        for (const target of targets) {
            document.body.append(target);
            for (const modifier of ["ctrl", "meta"] as const) {
                for (const [key, code] of [
                    ["+", "Equal"],
                    ["-", "Minus"],
                    ["0", "Digit0"],
                ] as const) {
                    expect(fixture.press(target, key, code, modifier).defaultPrevented).toBe(false);
                }
            }
            target.remove();
        }
        expect(fixture.counts).toEqual({ in: 0, out: 0, actual: 0 });
    } finally {
        await fixture.dispose();
    }
});

test("Canvas zoom shortcuts still control the canvas outside text editors", async () => {
    const fixture = await keyboardFixture();
    const target = document.createElement("div");
    document.body.append(target);
    try {
        expect(fixture.press(target, "+", "Equal").defaultPrevented).toBe(true);
        expect(fixture.press(target, "-", "Minus").defaultPrevented).toBe(true);
        expect(fixture.press(target, "0", "Digit0").defaultPrevented).toBe(true);
        expect(fixture.counts).toEqual({ in: 1, out: 1, actual: 1 });
    } finally {
        target.remove();
        await fixture.dispose();
    }
});
