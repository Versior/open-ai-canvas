import { expect, spyOn, test } from "bun:test";
import React, { act, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { reconciler } from "@react-three/fiber";

import { CanvasNodeActionContext, type CanvasNodeActionContextValue } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { LayoutNodeContent } from "../src/components/canvas/nodes/layout-node";
import { canvasThemes } from "../src/lib/canvas-theme";
import * as ecommerceRasterize from "../src/lib/ecommerce/ecommerce-rasterize";
import * as imageStorage from "../src/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

type ElementProps = {
    children?: ReactNode;
    className?: string;
    disabled?: boolean;
    title?: string;
    onClick?: () => Promise<void> | void;
    role?: string;
    src?: string;
    style?: CSSProperties;
};

function findElement(tree: ReactNode, predicate: (element: ReactElement<ElementProps>) => boolean): ReactElement<ElementProps> | undefined {
    if (Array.isArray(tree)) {
        for (const child of tree) {
            const match = findElement(child, predicate);
            if (match) return match;
        }
        return;
    }
    if (!React.isValidElement<ElementProps>(tree)) return;
    if (predicate(tree)) return tree;
    for (const child of React.Children.toArray(tree.props.children)) {
        const match = findElement(child, predicate);
        if (match) return match;
    }
}

test("layout main action exports the current-ratio local composition without image generation", async () => {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const context = {
        fillStyle: "",
        font: "",
        textBaseline: "",
        fillRect() {},
        beginPath() {},
        roundRect() {},
        fill() {},
        fillText() {},
        measureText(text: string) {
            return { width: text.length * 10 };
        },
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL: () => "data:image/png;base64,bGF5b3V0",
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });

    const node: CanvasNodeData = {
        id: "layout",
        type: CanvasNodeType.Layout,
        title: "主图排版",
        position: { x: 0, y: 0 },
        metadata: {
            ecommerceAspectRatio: "4:5",
            ecommerceLayout: {
                name: "主图版式",
                blocks: [{ id: "headline", field: "headline", anchor: "top-left", size: 7, color: "#1A1A1A", plate: "#FFFFFFCC", align: "left", inset: 6, bold: true }],
            },
        },
    };
    const copy: CanvasNodeData = {
        id: "copy",
        type: CanvasNodeType.Copy,
        title: "文案",
        position: { x: 0, y: 0 },
        metadata: { ecommerceCopy: { headline: "轻盈随行", subhead: "", cta: "", price: "" } },
    };
    const exports: Array<{ dataUrl: string; title: string }> = [];
    let generations = 0;
    let tree: ReactNode;
    function Probe() {
        tree = LayoutNodeContent({ node, theme: canvasThemes.dark });
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);

    try {
        await act(async () =>
            reconciler.updateContainer(
                <CanvasNodeActionContext.Provider
                    value={{
                        exportEcommerceLayout: async (_source, dataUrl, title) => {
                            exports.push({ dataUrl, title });
                        },
                        generateEcommerceNode: async () => {
                            generations++;
                        },
                    }}
                >
                    <CanvasNodeGraphContext.Provider value={{ getUpstreamNodes: () => [copy] }}>
                        <Probe />
                    </CanvasNodeGraphContext.Provider>
                </CanvasNodeActionContext.Provider>,
                root,
                null,
                null,
            ),
        );

        const action = findElement(tree!, (element) => element.type === "button" && element.props.className?.includes("ecom-action-primary") === true);
        expect(action).toBeDefined();
        expect(action!.props.disabled).toBe(false);
        expect(action!.props.title).toContain("预览即导出效果");
        expect(action!.props.title).toContain("改字不重新生图");
        expect(action!.props.children).toContain("导出当前画幅");

        await act(async () => {
            await action!.props.onClick?.();
        });

        expect(exports).toEqual([{ dataUrl: "data:image/png;base64,bGF5b3V0", title: "主图排版 · 4:5" }]);
        expect(generations).toBe(0);
    } finally {
        await act(async () => reconciler.updateContainer(null, root, null, null));
        if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
});

function elementText(tree: ReactNode): string {
    if (typeof tree === "string" || typeof tree === "number") return String(tree);
    if (Array.isArray(tree)) return tree.map(elementText).join("");
    if (!React.isValidElement<ElementProps>(tree)) return "";
    return React.Children.toArray(tree.props.children).map(elementText).join("");
}

function layoutFixtureNode(): CanvasNodeData {
    return {
        id: "layout-fixture",
        type: CanvasNodeType.Layout,
        title: "主图排版",
        position: { x: 0, y: 0 },
        metadata: {
            ecommerceAspectRatio: "1:1",
            ecommerceLayout: {
                name: "主图版式",
                blocks: [{ id: "headline", field: "headline", anchor: "top-left", size: 7, color: "#1A1A1A", plate: "#FFFFFFCC", align: "left", inset: 6, bold: true }],
            },
        },
    };
}

const layoutFixtureCopy: CanvasNodeData = {
    id: "copy-fixture",
    type: CanvasNodeType.Copy,
    title: "文案",
    position: { x: 0, y: 0 },
    metadata: { ecommerceCopy: { headline: "轻盈随行", subhead: "", cta: "", price: "" } },
};

async function mountLayoutFixture(upstream: CanvasNodeData[], actions: CanvasNodeActionContextValue) {
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let tree: ReactNode;
    function Probe() {
        tree = LayoutNodeContent({ node: layoutFixtureNode(), theme: canvasThemes.dark });
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    await act(async () =>
        reconciler.updateContainer(
            <CanvasNodeActionContext.Provider value={actions}>
                <CanvasNodeGraphContext.Provider value={{ getUpstreamNodes: () => upstream }}>
                    <Probe />
                </CanvasNodeGraphContext.Provider>
            </CanvasNodeActionContext.Provider>,
            root,
            null,
            null,
        ),
    );
    return {
        tree: () => tree!,
        unmount: async () => {
            await act(async () => reconciler.updateContainer(null, root, null, null));
            if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
            else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        },
    };
}

test("layout resolves a storage-only source once for both preview and export", async () => {
    const source: CanvasNodeData = {
        id: "stored-image",
        type: CanvasNodeType.Image,
        title: "持久化商品图",
        position: { x: 0, y: 0 },
        metadata: { storageKey: "resource:stored-image" },
    };
    const resolved = "data:image/png;base64,c3RvcmVk";
    const image = spyOn(imageStorage, "imageToDataUrl").mockResolvedValue(resolved);
    const rasterImages: string[] = [];
    const raster = spyOn(ecommerceRasterize, "rasterizeEcommerceLayout").mockImplementation(async (input) => {
        rasterImages.push(input.imageUrl);
        return "data:image/png;base64,bGF5b3V0";
    });
    const exported: string[] = [];
    const view = await mountLayoutFixture([source, layoutFixtureCopy], {
        exportEcommerceLayout: async (_node, dataUrl) => {
            exported.push(dataUrl);
        },
    });

    try {
        await act(async () => {
            await Promise.resolve();
        });
        expect(findElement(view.tree(), (element) => element.type === "img")?.props.src).toBe(resolved);

        const action = findElement(view.tree(), (element) => element.type === "button" && element.props.className?.includes("ecom-action-primary") === true);
        await act(async () => {
            await action!.props.onClick?.();
        });

        expect(image).toHaveBeenCalledTimes(1);
        expect(image).toHaveBeenCalledWith({ url: undefined, storageKey: "resource:stored-image", name: "持久化商品图" });
        expect(rasterImages).toEqual([resolved]);
        expect(exported).toEqual(["data:image/png;base64,bGF5b3V0"]);
    } finally {
        await view.unmount();
        image.mockRestore();
        raster.mockRestore();
    }
});

test("layout announces export failures and leaves the action retryable", async () => {
    const raster = spyOn(ecommerceRasterize, "rasterizeEcommerceLayout").mockResolvedValue("data:image/png;base64,bGF5b3V0");
    const view = await mountLayoutFixture([layoutFixtureCopy], {
        exportEcommerceLayout: async () => {
            throw new Error("保存产物失败");
        },
    });

    try {
        const action = findElement(view.tree(), (element) => element.type === "button" && element.props.className?.includes("ecom-action-primary") === true);
        await act(async () => {
            await action!.props.onClick?.().catch(() => undefined);
        });

        const alert = findElement(view.tree(), (element) => element.props.role === "alert");
        expect(elementText(alert)).toContain("导出失败");
        expect(elementText(alert)).toContain("保存产物失败");
        expect(findElement(view.tree(), (element) => element.type === "button" && element.props.className?.includes("ecom-action-primary") === true)?.props.disabled).toBe(false);
    } finally {
        await view.unmount();
        raster.mockRestore();
    }
});

test("layout disclosure arrow has no motion transition", async () => {
    const view = await mountLayoutFixture([layoutFixtureCopy], { updateMetadata: () => undefined });
    try {
        const arrow = findElement(view.tree(), (element) => element.type === ChevronDown);
        expect(arrow).toBeDefined();
        expect(arrow!.props.style?.transition).toBeUndefined();
    } finally {
        await view.unmount();
    }
});
