import { afterEach, expect, test } from "bun:test";
import React, { act, useState, type ReactElement, type ReactNode } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import localforage from "localforage";

import { CanvasNodeActionContext, type CanvasNodeActionContextValue } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { CanvasEcommerceSuitePanel, type EcommerceSuitePanelProps } from "../src/components/canvas/canvas-ecommerce-suite-panel";
import { ProductNodeContent } from "../src/components/canvas/nodes/product-node";
import { CanvasEcommerceTableNodeContent } from "../src/components/canvas/canvas-ecommerce-table-node";
import { openEcommerceTable } from "../src/lib/ecommerce/ecommerce-table";
import { createCanvasNodeGraph } from "../src/lib/canvas/canvas-node-graph";
import { canvasThemes } from "../src/lib/canvas-theme";
import type { EcommerceSuiteRow } from "../src/lib/ecommerce/ecommerce-suite";
import { setActiveUserScope } from "../src/lib/user-scope";
import { apiClient } from "../src/services/api/request";
import { useEcommerceModelLibrary } from "../src/stores/use-ecommerce-model-library";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

type ControlProps = {
    children?: ReactNode;
    className?: string;
    "aria-label"?: string;
    title?: string;
    disabled?: boolean;
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    onClick?: () => void;
};

function findElement(tree: ReactNode, predicate: (element: ReactElement<ControlProps>) => boolean): ReactElement<ControlProps> | undefined {
    if (!React.isValidElement<ControlProps>(tree)) return;
    if (predicate(tree)) return tree;
    for (const child of React.Children.toArray(tree.props.children)) {
        const found = findElement(child, predicate);
        if (found) return found;
    }
}

function deferred() {
    let resolve!: (value: boolean) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const initialRows: EcommerceSuiteRow[] = [
    { slotId: "detail-1", title: "Hero", duty: "Show the product", prompt: "Original hero prompt" },
    { slotId: "detail-2", title: "Detail", duty: "Show the texture", prompt: "Original detail prompt" },
];
const editedRows: EcommerceSuiteRow[] = [
    { slotId: "detail-1", title: "Edited hero", duty: "Show the edited composition", prompt: "Edited hero prompt" },
    { slotId: "detail-2", title: "Detail", duty: "Show the texture", prompt: "Original detail prompt" },
];

let cleanup: (() => Promise<void>) | undefined;
let sequence = 0;
afterEach(async () => {
    try { await cleanup?.(); }
    finally { cleanup = undefined; }
});

async function mountProduct(rows = initialRows) {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const originalUseApp = App.useApp;
    const originalRequest = apiClient.request;
    const originalGetItem = localforage.getItem;
    const originalSetItem = localforage.setItem;
    const originalModels = useEcommerceModelLibrary.getState();
    const storage = new Map<string, string>();
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    let confirmation: { onOk?: (...args: unknown[]) => unknown } | undefined;
    const app = {
        message: { error: (error: unknown) => { errors.push(error); }, warning: (warning: unknown) => { warnings.push(warning); } },
        modal: { confirm: (options: typeof confirmation) => { confirmation = options; } },
    };
    const product: CanvasNodeData = {
        id: "product", type: CanvasNodeType.Product, title: "Test product", position: { x: 0, y: 0 },
        metadata: { ecommerceAnalysisModel: "analysis-model", ecommerceImageModel: "image-model",
            ecommerceSuite: { flow: "detail", source: "draft", updatedAt: "", rows: rows.map((row) => ({ ...row })) } },
    };
    const image: CanvasNodeData = {
        id: "product-photo", type: CanvasNodeType.Image, title: "Product photo", position: { x: 0, y: 0 },
        metadata: { content: "/product-photo.png" },
    };
    const calls: Parameters<NonNullable<CanvasNodeActionContextValue["generateEcommerceSuite"]>>[] = [];
    let next = deferred();
    let productTree: ReactNode;
    let panelTree: ReactNode;
    let currentNodes = [product, image];
    let currentEdges = [{ id: "front", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front" }];
    let currentNode = product;
    let activeId = "";
    let panelProps: EcommerceSuitePanelProps | undefined;
    let unmount: (() => Promise<void>) | undefined;
    cleanup = async () => {
        try { await unmount?.(); }
        finally {
            apiClient.request = originalRequest;
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            App.useApp = originalUseApp;
            useEcommerceModelLibrary.getState().reset();
            useEcommerceModelLibrary.setState(originalModels, true);
            if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
            else Reflect.deleteProperty(globalThis, "window");
            if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
            else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        }
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
    } }) });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    setActiveUserScope("product-actions-" + ++sequence);
    // Keep real catalog and model hydration; only HTTP and browser storage are external.
    apiClient.request = (async (config) => {
        if (config.method !== "get" || config.url !== "/skills/added") throw new Error("Unexpected HTTP request: " + config.method + " " + config.url);
        return { data: { code: 0, data: { skills: [] }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    localforage.getItem = (async (key: string) => storage.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => { storage.set(key, value); return value; }) as typeof localforage.setItem;
    App.useApp = (() => app) as unknown as typeof App.useApp;
    useEcommerceModelLibrary.getState().reset();

    function PanelProbe(props: EcommerceSuitePanelProps) {
        panelTree = CanvasEcommerceSuitePanel(props);
        return null;
    }
    function ProductProbe() {
        productTree = ProductNodeContent({ node: product, theme: canvasThemes.dark });
        expect(findElement(productTree, element => element.type === CanvasEcommerceSuitePanel)).toBeUndefined();
        return null;
    }
    function TableProbe() {
        const element = CanvasEcommerceTableNodeContent({ node: currentNode });
        const tableTree = (element.type as (props: { node: CanvasNodeData }) => ReactNode)(element.props);
        const panel = findElement(tableTree, element => element.type === CanvasEcommerceSuitePanel);
        panelProps = panel?.props as EcommerceSuitePanelProps | undefined;
        expect(panelProps?.embedded).toBe(true);
        return panelProps ? <PanelProbe {...panelProps} /> : null;
    }
    function Fixture() {
        const [, publish] = useState(0);
        const actions: CanvasNodeActionContextValue = {
            openEcommerceTable: (node, flow) => {
                const plan = openEcommerceTable(currentNodes, currentEdges, node.id, flow);
                currentNodes = plan.nodes;
                currentEdges = plan.connections as typeof currentEdges;
                activeId = plan.table.id;
                currentNode = plan.table;
                publish(value => value + 1);
            },
            updateMetadata: (id, patch) => {
                currentNodes = currentNodes.map(node => node.id === id ? { ...node, metadata: { ...node.metadata, ...patch } } : node);
                currentNode = currentNodes.find(node => node.id === activeId)!;
                publish(value => value + 1);
            },
            draftEcommerceSuite: () => undefined,
            generateEcommerceSuite: (...args) => { calls.push(args); return next.promise; },
        };
        return <CanvasNodeActionContext.Provider value={actions}><CanvasNodeGraphContext.Provider value={createCanvasNodeGraph(currentNodes, currentEdges)}><ProductProbe />{activeId ? <TableProbe key={activeId} /> : null}</CanvasNodeGraphContext.Provider></CanvasNodeActionContext.Provider>;
    }
    const fail = (error: unknown) => { throw error; };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    unmount = async () => { await act(async () => { reconciler.updateContainer(null, root, null, null); }); };
    await act(async () => { reconciler.updateContainer(<Fixture />, root, null, null); });

    function control(tree: ReactNode, predicate: (props: ControlProps) => boolean) {
        const found = findElement(tree, (element) => predicate(element.props));
        if (!found) throw new Error("Product or suite control missing");
        return found.props;
    }
    const batchButton = () => control(panelTree, (props) => props.title === "按这张表批量提交出图任务");
    const open = async (flowName?: string) => {
        await act(async () => {
            const candidates: ReactElement<ControlProps>[] = [];
            const walk = (tree: ReactNode) => {
                if (!React.isValidElement<ControlProps>(tree)) return;
                if (tree.props.className === "ecom-oneclick") candidates.push(tree);
                React.Children.forEach(tree.props.children, walk);
            };
            walk(productTree);
            const text = (node: ReactNode): string => typeof node === 'string' || typeof node === 'number' ? String(node) : React.isValidElement<ControlProps>(node) ? React.Children.toArray(node.props.children).map(text).join('') : '';
            const candidate = flowName ? candidates.find(item => text(item).includes(flowName)) : candidates[0];
            if (!candidate) throw new Error('Flow button missing');
            candidate.props.onClick!();
        });
        expect(panelProps?.open).toBe(true);
    };
    await open();
    expect(panelProps?.skillsLoading).toBe(false);
    expect(useEcommerceModelLibrary.getState().hydrated).toBe(true);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    return {
        calls, errors, open, batchButton, isOpen: () => Boolean(panelProps?.open),
        tables: () => currentNodes.filter(node => node.type === CanvasNodeType.BatchTable),
        props: () => panelProps!, node: () => currentNode, confirmation: () => confirmation,
        edit: async (label: string, value: string) => { await act(async () => { control(panelTree, (props) => props["aria-label"] === label).onChange!({ target: { value } }); }); },
        click: async (label: string) => { await act(async () => { control(panelTree, (props) => props["aria-label"] === label).onClick!(); }); },
        submit: async () => { const button = batchButton(); expect(button.disabled).toBe(false); await act(async () => { button.onClick!(); }); },
        settle: async (result: boolean | Error) => { await act(async () => { if (result instanceof Error) next.reject(result); else next.resolve(result); }); },
        retry: () => { next = deferred(); },

    };
}

test('switching purposes creates separate connected tables and preserves edits', async () => {
    const product = await mountProduct();
    await editHero(product);
    await product.open('主图');
    const mainSlot = product.props().rows[0].slotId;
    await act(async () => { product.props().onRowsChange([{ ...product.props().rows[0], prompt: 'Main draft' }]); });
    await product.open('详情页');
    expect(product.props().rows).toEqual(editedRows);
    expect(product.tables()).toHaveLength(2);
    expect(product.tables().find(node => node.metadata?.ecommerceFlowId === 'main')?.metadata?.ecommerceSuite?.rows[0]).toMatchObject({ slotId: mainSlot, prompt: 'Main draft' });
});

async function editHero(product: Awaited<ReturnType<typeof mountProduct>>) {
    await product.edit("第 1 屏的标题", "Edited hero");
    await product.edit("Edited hero 要解决什么", "Show the edited composition");
    await product.edit("Edited hero 提示词", "Edited hero prompt");
}

for (const outcome of [true, false, new Error("Queue unavailable")]) {
    test("product suite " + (outcome === true ? "remains on canvas after successful enqueue" : outcome === false ? "stays open on false enqueue" : "stays open on rejected enqueue") + " and submits edited draft rows", async () => {
        const product = await mountProduct();
        await editHero(product);
        expect(product.node().metadata?.ecommerceSuite?.rows).toEqual(editedRows);
        await product.submit();
        expect(product.calls).toHaveLength(1);
        expect(product.calls[0]).toEqual([expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", undefined, editedRows]);
        expect(product.node().metadata?.ecommerceSuite?.rows).toEqual(editedRows);
        expect(product.isOpen()).toBe(true);
        expect(product.props().generating).toBe(true);
        expect(product.batchButton().disabled).toBe(true);
        await product.settle(outcome);
        expect(product.isOpen()).toBe(true);
        expect(product.errors).toEqual(outcome instanceof Error ? ["Queue unavailable"] : []);
        if (outcome === true) {
            await product.open();
        } else {
            expect(product.props().generating).toBe(false);
            expect(product.batchButton().disabled).toBe(false);
            product.retry();
            await product.submit();
            expect(product.calls).toHaveLength(2);
            expect(product.calls[1]?.[3]).toEqual(editedRows);
            await product.settle(true);
            expect(product.isOpen()).toBe(true);
            await product.open();
        }
        expect(product.props().rows).toEqual(editedRows);
        expect(product.tables()).toHaveLength(1);
    });
}

test("partial-generation confirmation forwards the current draft, not the modal close callback", async () => {
    const product = await mountProduct([{ ...initialRows[0] }, { ...initialRows[1], prompt: "" }]);
    await editHero(product);
    await product.submit();
    expect(product.calls).toEqual([]);
    expect(product.props().generating).toBe(false);
    expect(product.confirmation()?.onOk).toBeFunction();
    const modalClose = () => { throw new Error("Modal close callback must not be submitted as draft rows"); };
    await act(async () => { product.confirmation()!.onOk!(modalClose); });
    const expected = [
        { slotId: "detail-1", title: "Edited hero", duty: "Show the edited composition", prompt: "Edited hero prompt" },
        { slotId: "detail-2", title: "Detail", duty: "Show the texture", prompt: "" },
    ];
    expect(product.calls).toHaveLength(1);
    expect(product.calls[0]).toEqual([expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", undefined, expected]);
    expect(product.node().metadata?.ecommerceSuite?.rows).toEqual(expected);
    expect(product.isOpen()).toBe(true);
    await product.settle(true);
    expect(product.isOpen()).toBe(true);
});

test("single-row generation forwards its slot and reordered draft, and suppresses another enqueue while pending", async () => {
    const product = await mountProduct();
    await editHero(product);
    await product.click("把「Edited hero」往后挪一格");
    await product.click("只出这一张：Edited hero");
    const expected = [
        { slotId: "detail-2", title: "Detail", duty: "Show the texture", prompt: "Original detail prompt" },
        { slotId: "detail-1", title: "Edited hero", duty: "Show the edited composition", prompt: "Edited hero prompt" },
    ];
    expect(product.calls).toHaveLength(1);
    expect(product.calls[0]).toEqual([expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", ["detail-1"], expected]);
    expect(product.node().metadata?.ecommerceSuite?.rows).toEqual(expected);
    await product.click("只出这一张：Detail");
    expect(product.calls).toHaveLength(1);
    expect(product.isOpen()).toBe(true);
    await product.settle(false);
    expect(product.isOpen()).toBe(true);
    expect(product.props().generating).toBe(false);
    product.retry();
    await product.click("只出这一张：Detail");
    expect(product.calls).toHaveLength(2);
    expect(product.calls[1]?.[2]).toEqual(["detail-2"]);
    expect(product.calls[1]?.[3]).toEqual(expected);
    await product.settle(true);
    expect(product.isOpen()).toBe(true);
});
