import { expect, test } from "bun:test";
import React, { act, useState, type ReactNode, type ReactElement } from "react";
import { reconciler } from "@react-three/fiber";
import { App, Tabs, Checkbox, InputNumber } from "antd";
import { EcommerceStudioNodeContent } from "../src/components/canvas/nodes/ecommerce-studio-node";
import { CanvasEcommerceWorkbench } from "../src/components/canvas/canvas-ecommerce-workbench";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { ECOMMERCE_CAPABILITIES, DEFAULT_ECOMMERCE_BRIEF, ECOMMERCE_IMAGE_TYPES, type EcommerceCapability } from "../src/lib/ecommerce/ecommerce-capabilities";
import { createCanvasNodeGraph } from "../src/lib/canvas/canvas-node-graph";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { ecommerceStudioShotSignature } from "../src/lib/ecommerce/ecommerce-studio";
import { CachedResourceImage } from "../src/components/cached-resource-image";
import { canvasThemes } from "../src/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { apiClient } from "../src/services/api/request";
import { DEFAULT_ECOMMERCE_SETTING } from "../src/services/api/ecommerce";
import { useEcommerceSettings } from "../src/stores/use-ecommerce-settings";

type Props = { children?: ReactNode; activeKey?: string; disabled?: boolean; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; value?: string; id?: string; hidden?: boolean; "aria-pressed"?: boolean };
function find(tree: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
    if (Array.isArray(tree)) {
        for (const child of tree) {
            const match = find(child, predicate);
            if (match) return match;
        }
        return;
    }
    if (!React.isValidElement<Props>(tree)) return;
    if (predicate(tree)) return tree;
    for (const child of React.Children.toArray(tree.props.children)) {
        const match = find(child, predicate);
        if (match) return match;
    }
}

test("studio tools open all eight matching workbench tabs and locked controls cannot modify metadata", async () => {
    const originalApp = App.useApp;
    const originalRequest = apiClient.request;
    const originalSettings = useEcommerceSettings.getState();
    const descriptors = ["window", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: { getItem: () => null, setItem() {} } }) });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    App.useApp = (() => ({ message: { success() {}, error() {} } })) as unknown as typeof App.useApp;
    apiClient.request = (async (config) => {
        if (config.method !== "get") throw new Error("Unexpected write");
        const data = config.url === "/skills/added" ? { skills: [] } : config.url === "/ecommerce/settings" ? { setting: structuredClone(DEFAULT_ECOMMERCE_SETTING) } : undefined;
        if (!data) throw new Error("Unexpected request: " + config.url);
        return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    let node: CanvasNodeData = { id: "studio", type: CanvasNodeType.EcommerceStudio, title: "Studio", position: { x: 0, y: 0 }, metadata: { ecommerceStudio: { brief: { ...structuredClone(DEFAULT_ECOMMERCE_BRIEF), name: "Product" } } } };
    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, position: { x: 0, y: 0 }, metadata: { productProfile: createEcommerceProductProfile("Product") } };
    const photo: CanvasNodeData = { id: "photo", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { storageKey: "test-photo", status: "success" } };
    const edges = [{ id: "photo-product", fromNodeId: photo.id, toNodeId: product.id, toHandleId: "product-view:front" }, { id: "product-studio", fromNodeId: product.id, toNodeId: node.id }];
    let outputs: CanvasNodeData[] = [];
    const focused: string[] = [];
    let nodeTree: ReactNode, panelTree: ReactNode;
    let refresh!: () => void;
    let writes = 0;
    const opened: EcommerceCapability[] = [];
    const requests: import("../src/lib/ecommerce/ecommerce-capabilities").EcommerceWorkbenchRequest[] = [];
    function NodeProbe() {
        nodeTree = EcommerceStudioNodeContent({ node, theme: canvasThemes.dark });
        return null;
    }
    function PanelProbe({ capability, open }: { capability: EcommerceCapability; open: boolean }) {
        panelTree = CanvasEcommerceWorkbench({
            studioId: node.id,
            initialCapability: capability,
            open,
            onClose() {},
            nodes: [node, product, photo],
            connections: edges,
            selectedIds: new Set(),
            busy: false,
            onRun: async (request) => { requests.push(request); return node.id; },
            onStop() {},
            onLayers() {},
            onFocus() {},
            onAssets() {},
        });
        return null;
    }
    function Fixture() {
        const [, publish] = useState(0);
        const [capability, setCapability] = useState<EcommerceCapability>("planning");
        const [open, setOpen] = useState(false);
        refresh = () => publish((value) => value + 1);
        return (
            <CanvasNodeActionContext.Provider
                value={{
                    updateMetadata: (_id, metadata) => {
                        writes++;
                        node = { ...node, metadata: { ...node.metadata, ...metadata } };
                        refresh();
                    },
                    runEcommerceWorkbench: async (request) => { requests.push(request); return node.id; },
                    focusNode: (id) => { focused.push(id); },
                    openEcommerceWorkbench: (source, next = "planning") => {
                        expect(source.id).toBe("studio");
                        opened.push(next);
                        setCapability(next);
                        setOpen(true);
                    },
                }}
            >
                <CanvasNodeGraphContext.Provider value={createCanvasNodeGraph([node, product, photo, ...outputs], [...edges, ...outputs.map((output) => ({ id: output.id + "-edge", fromNodeId: node.id, toNodeId: output.id }))])}>
                    <NodeProbe />
                </CanvasNodeGraphContext.Provider>
                <PanelProbe capability={capability} open={open} />
            </CanvasNodeActionContext.Provider>
        );
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const tool = (name: string) => find(nodeTree, (element) => element.type === "button" && Boolean(find(element.props.children, (child) => child.type === "strong" && child.props.children === name)));
    const commands = ["AI 规划方案", "反推套图与视觉锁", "生成多姿态参考", "从商品图提取花型", "根据事实与图片生成 Listing", "生成 300DPI 规格包", "验缝 → 规格包 → Listing", "导出 PNG 图层、PSD 与 ZIP"];
    try {
        await act(async () => {
            reconciler.updateContainer(<Fixture />, root, null, null);
        });
        expect(find(nodeTree, (element) => element.props.id === "studio-studio-brief")?.props.hidden).toBe(false);
        expect(find(nodeTree, (element) => element.props.id === "studio-studio-tools")?.props.hidden).toBe(true);
        expect(find(nodeTree, (element) => element.props.children === "已连接 1 张图片 · 含商品档案")).toBeDefined();
        await act(async () => {
            find(nodeTree, (element) => element.type === "button" && element.props.children === "电商工具")!.props.onClick!();
        });
        expect(find(nodeTree, (element) => element.props.id === "studio-studio-brief")?.props.hidden).toBe(true);
        expect(find(nodeTree, (element) => element.props.id === "studio-studio-tools")?.props.hidden).toBe(false);
        for (const [index, item] of ECOMMERCE_CAPABILITIES.entries()) {
            expect(tool(item.name)?.props.disabled).toBe(false);
            await act(async () => {
                tool(item.name)!.props.onClick!();
            });
            expect(find(panelTree, (element) => element.type === Tabs)?.props.activeKey).toBe(item.id);
            expect(find(panelTree, (element) => element.props.children === commands[index])).toBeDefined();
        }
        expect(opened).toEqual(ECOMMERCE_CAPABILITIES.map((item) => item.id));
        await act(async () => {
            find(nodeTree, (element) => element.type === "button" && element.props.children === "商品信息")!.props.onClick!();
        });
        const nameInput = () => find(nodeTree, (element) => element.props.value === node.metadata!.ecommerceStudio!.brief.name && Boolean(element.props.onChange));
        await act(async () => {
            nameInput()!.props.onChange!({ target: { value: "Edited" } });
        });
        expect(writes).toBe(1);
        const generate = find(nodeTree, (element) => Array.isArray(element.props.children) && element.props.children[0] === "规划并生成图片 · ");
        expect(generate?.props.disabled).toBe(false);
        await act(async () => { generate!.props.onClick!(); });
        expect(requests[0]?.action).toBe("planning");
        expect(requests[0]?.generateAfterPlanning).toBe(true);
        expect(requests[0]?.sourceIds).toEqual(["product"]);
        node = { ...node, metadata: { ...node.metadata, ecommerceWorkbench: { capability: "planning", brief: node.metadata!.ecommerceStudio!.brief, sourceIds: ["product"], inputSignature: "current-input", request: requests[0], steps: [{ id: "planning", status: "failed", taskId: "old-task", error: "bad json" }] } } };
        await act(async () => { refresh(); });
        const resume = find(nodeTree, (element) => element.props.children === "恢复已有任务与后续步骤");
        expect(resume).toBeDefined();
        await act(async () => { resume!.props.onClick!(); });
        expect(requests[1]).toEqual({ ...requests[0], resumeReceiptId: node.id, retryFailed: false });
        const retry = find(nodeTree, (element) => element.props.children === "重试失败步骤并继续");
        await act(async () => { retry!.props.onClick!(); });
        expect(requests[2]).toEqual({ ...requests[0], resumeReceiptId: node.id, retryFailed: true });
        const imageTypes = ECOMMERCE_IMAGE_TYPES.slice(0, 7).map(([, label]) => label);
        const typePicker = find(nodeTree, (element) => element.type === Checkbox.Group && Array.isArray(element.props.value) && element.props.value.includes("商品主图"));
        await act(async () => { (typePicker!.props.onChange as unknown as (values: string[]) => void)(imageTypes); });
        expect(node.metadata!.ecommerceStudio!.brief.count).toBe(7);
        expect(find(nodeTree, (element) => element.type === InputNumber && element.props.value === 7)).toBeDefined();
        await act(async () => {
            find(nodeTree, (element) => element.type === "button" && element.props.children === "商品信息")!.props.onClick!();
        });
        expect(find(nodeTree, (element) => Array.isArray(element.props.children) && element.props.children[0] === "规划并生成图片 · " && element.props.children[1] === 7)).toBeDefined();
        await act(async () => {
            find(nodeTree, (element) => element.type === "button" && element.props.children === "图片结果")!.props.onClick!();
        });
        expect(find(nodeTree, (element) => element.props.id === "studio-studio-results")?.props.hidden).toBe(false);
        expect(find(nodeTree, (element) => element.props.id === "studio-studio-plan")?.props.hidden).toBe(true);
        expect(find(nodeTree, (element) => element.props.children === "导出采用结果与清单")?.props.disabled).toBe(true);
        await act(async () => { tool(ECOMMERCE_CAPABILITIES[0].name)!.props.onClick!(); });
        const panelTypePicker = find(panelTree, (element) => element.type === Checkbox.Group && Array.isArray(element.props.value) && element.props.value.includes("商品主图"));
        await act(async () => { (panelTypePicker!.props.onChange as unknown as (values: string[]) => void)(ECOMMERCE_IMAGE_TYPES.slice(0, 8).map(([, label]) => label)); });
        expect(find(panelTree, (element) => element.type === InputNumber && element.props.value === 8)).toBeDefined();
        const panelGenerate = find(panelTree, (element) => Array.isArray(element.props.children) && element.props.children[0] === "规划并生成图片 · " && element.props.children[1] === 8);
        await act(async () => { panelGenerate!.props.onClick!(); });
        expect(requests.at(-1)?.brief.count).toBe(8);
        expect(requests.at(-1)?.brief.imageTypes.length).toBe(8);
        const plan = { name: "Product", style: "Studio", shots: [{ title: "主图", duty: "展示外观", prompt: "White background" }] };
        node = { ...node, metadata: { ...node.metadata, ecommerceStudio: { ...node.metadata!.ecommerceStudio!, plan } } };
        outputs = ["old", "latest"].map((id) => ({ id, type: CanvasNodeType.Image, position: { x: 0, y: 0 }, metadata: { status: "success", storageKey: id + "-image", ecommerceStudioOutput: { studioId: node.id, shotIndex: 0, signature: ecommerceStudioShotSignature(plan, 0, node.metadata!.ecommerceStudio!.brief) } } }));
        await act(async () => { refresh(); });
        expect(find(nodeTree, (element) => element.type === CachedResourceImage && (element.props as { storageKey?: string }).storageKey === "latest-image")).toBeDefined();
        const preview = () => find(nodeTree, (element) => (element.props as { "aria-label"?: string })["aria-label"] === "定位第 1 张结果");
        await act(async () => { preview()!.props.onClick!(); });
        expect(focused).toEqual(["latest"]);
        const adoption = find(nodeTree, (element) => (element.props as { "aria-label"?: string })["aria-label"] === "第 1 张采用结果");
        await act(async () => { (adoption!.props.onChange as unknown as (id: string) => void)("old"); });
        await act(async () => { preview()!.props.onClick!(); });
        expect(focused.at(-1)).toBe("old");
        expect(node.metadata!.ecommerceStudio!.adoptedResults?.["0"]).toBe("old");
        expect(find(nodeTree, (element) => element.props.children === "导出采用结果与清单")?.props.disabled).toBe(false);
        node = { ...node, metadata: { ...node.metadata, ecommerceStudio: { ...node.metadata!.ecommerceStudio!, adoptedResults: { "0": "missing" } } } };
        await act(async () => { refresh(); });
        expect(preview()?.props.disabled).toBe(true);
        expect(find(nodeTree, (element) => element.props.children === "采用版本已失效")).toBeDefined();
        expect(find(nodeTree, (element) => element.props.children === "导出采用结果与清单")?.props.disabled).toBe(true);
        expect(find(nodeTree, (element) => element.props.children === "第 1 张采用版本已失效，请重新选择")).toBeDefined();
        const writesBeforeLock = writes;
        node = { ...node, metadata: { ...node.metadata, locked: true } };
        await act(async () => {
            refresh();
        });
        for (const item of ECOMMERCE_CAPABILITIES) expect(tool(item.name)?.props.disabled).toBe(true);
        await act(async () => {
            nameInput()!.props.onChange!({ target: { value: "Blocked" } });
        });
        expect(writes).toBe(writesBeforeLock);
    } finally {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
        App.useApp = originalApp;
        apiClient.request = originalRequest;
        useEcommerceSettings.setState(originalSettings, true);
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
