import { expect, test } from "bun:test";
import React, { act, useState, type ReactNode, type ReactElement } from "react";
import { reconciler } from "@react-three/fiber";
import { App, Tabs } from "antd";
import { EcommerceStudioNodeContent } from "../src/components/canvas/nodes/ecommerce-studio-node";
import { CanvasEcommerceWorkbench } from "../src/components/canvas/canvas-ecommerce-workbench";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { ECOMMERCE_CAPABILITIES, DEFAULT_ECOMMERCE_BRIEF, type EcommerceCapability } from "../src/lib/ecommerce/ecommerce-capabilities";
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
    let nodeTree: ReactNode, panelTree: ReactNode;
    let refresh!: () => void;
    let writes = 0;
    const opened: EcommerceCapability[] = [];
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
            nodes: [node],
            connections: [],
            selectedIds: new Set(),
            busy: false,
            onRun: async () => "",
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
                    updateMetadata: () => {
                        writes++;
                    },
                    openEcommerceWorkbench: (source, next = "planning") => {
                        expect(source.id).toBe("studio");
                        opened.push(next);
                        setCapability(next);
                        setOpen(true);
                    },
                }}
            >
                <NodeProbe />
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
        const nameInput = () => find(nodeTree, (element) => element.props.value === "Product" && Boolean(element.props.onChange));
        await act(async () => {
            nameInput()!.props.onChange!({ target: { value: "Edited" } });
        });
        expect(writes).toBe(1);
        node = { ...node, metadata: { ...node.metadata, locked: true } };
        await act(async () => {
            refresh();
        });
        for (const item of ECOMMERCE_CAPABILITIES) expect(tool(item.name)?.props.disabled).toBe(true);
        await act(async () => {
            nameInput()!.props.onChange!({ target: { value: "Blocked" } });
        });
        expect(writes).toBe(1);
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
