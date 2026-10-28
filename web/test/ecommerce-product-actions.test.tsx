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
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { createCanvasNodeGraph } from "../src/lib/canvas/canvas-node-graph";
import { canvasThemes } from "../src/lib/canvas-theme";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { EcommerceSuiteRow } from "../src/lib/ecommerce/ecommerce-suite";
import { setActiveUserScope } from "../src/lib/user-scope";
import { apiClient } from "../src/services/api/request";
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from "../src/stores/use-config-store";
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
    const promise = new Promise<boolean>((yes, no) => {
        resolve = yes;
        reject = no;
    });
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
const recognizedProfile = {
    category: "保温杯",
    appearance: "哑光黑色杯身",
    marks: "杯身中部 THERMO",
    forbidden: "不要改变杯盖结构",
    audience: "通勤携带；办公室饮水",
    facts: "便于携带：杯盖顶部有可见提手",
    unsure: "材质和目标人群由图片推测",
};
const copyReadyProfile = {
    ...createEcommerceProductProfile("Test product"),
    category: "保温杯",
    audience: "通勤携带；办公室饮水",
    facts: "便于携带：杯盖顶部有可见提手",
};
type RecognizedProfileDraft = Partial<typeof recognizedProfile>;

function modelFixture(id: string) {
    const names = {
        analysisDefault: "analysis-default",
        analysisOverride: "analysis-override",
        imageDefault: "image-default",
        imageOverride: "image-override",
    };
    const channel = createModelChannel({
        id,
        scope: "system",
        models: Object.values(names),
        modelCosts: [
            ...[names.analysisDefault, names.analysisOverride].map((model) => {
                const capabilityConfig = defaultModelCapabilityConfig("newapi-chat", model);
                capabilityConfig.text!.references.maxImages = 5;
                return {
                    model,
                    capability: "text" as const,
                    protocol: "newapi-chat" as const,
                    capabilityConfig,
                    billingMode: "token" as const,
                    unitPriceMicrocredits: 1,
                    inputTokenPriceMicrocredits: 1,
                    outputTokenPriceMicrocredits: 1,
                    cachedTokenPriceMicrocredits: 1,
                };
            }),
            ...[names.imageDefault, names.imageOverride].map((model) => ({ model, capability: "image" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 1 })),
        ],
    });
    const encoded = Object.fromEntries(Object.entries(names).map(([key, model]) => [key, encodeChannelModel(id, model)])) as Record<keyof typeof names, string>;
    return {
        ...encoded,
        config: {
            ...defaultConfig,
            channels: [channel],
            model: encoded.imageDefault,
            textModel: encoded.analysisDefault,
            imageModel: encoded.imageDefault,
            textModels: [encoded.analysisDefault, encoded.analysisOverride],
            imageModels: [encoded.imageDefault, encoded.imageOverride],
        },
    };
}

const configuredModels = modelFixture("ecommerce-actions");

let cleanup: (() => Promise<void>) | undefined;
let sequence = 0;
afterEach(async () => {
    try {
        await cleanup?.();
    } finally {
        cleanup = undefined;
    }
});

async function mountProduct(
    rows = initialRows,
    models: { analysisModel?: string; imageModel?: string } = { analysisModel: configuredModels.analysisOverride, imageModel: configuredModels.imageOverride },
    profileDraft: RecognizedProfileDraft | Promise<RecognizedProfileDraft> | ((node: CanvasNodeData) => RecognizedProfileDraft | Promise<RecognizedProfileDraft>) = recognizedProfile,
    initialProfile = copyReadyProfile,
    initialFlow: string | false = "详情页",
    withProductImage = true,
) {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    const originalUseApp = App.useApp;
    const originalRequest = apiClient.request;
    const originalGetItem = localforage.getItem;
    const originalSetItem = localforage.setItem;
    const originalModels = useEcommerceModelLibrary.getState();
    const originalConfig = useConfigStore.getState().config;
    const storage = new Map<string, string>();
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    let confirmation: { onOk?: (...args: unknown[]) => unknown } | undefined;
    const app = {
        message: {
            error: (error: unknown) => {
                errors.push(error);
            },
            warning: (warning: unknown) => {
                warnings.push(warning);
            },
        },
        modal: {
            confirm: (options: typeof confirmation) => {
                confirmation = options;
            },
        },
    };
    const product: CanvasNodeData = {
        id: "product",
        type: CanvasNodeType.Product,
        title: "Test product",
        position: { x: 0, y: 0 },
        metadata: {
            ...("analysisModel" in models ? { ecommerceAnalysisModel: models.analysisModel } : {}),
            ...("imageModel" in models ? { ecommerceImageModel: models.imageModel } : {}),
            productProfile: initialProfile,
            ecommerceSuite: { flow: "detail", source: "draft", updatedAt: "", rows: rows.map((row) => ({ ...row })) },
        },
    };
    const image: CanvasNodeData = {
        id: "product-photo",
        type: CanvasNodeType.Image,
        title: "Product photo",
        position: { x: 0, y: 0 },
        metadata: { content: "/product-photo.png" },
    };
    const calls: Parameters<NonNullable<CanvasNodeActionContextValue["generateEcommerceSuite"]>>[] = [];
    const draftCalls: Parameters<NonNullable<CanvasNodeActionContextValue["draftEcommerceSuite"]>>[] = [];
    const reverseCalls: Parameters<NonNullable<CanvasNodeActionContextValue["reverseEcommerceSuite"]>>[] = [];
    const profileCalls: CanvasNodeData[] = [];
    let next = deferred();
    let productTree: ReactNode;
    let panelTree: ReactNode;
    let currentNodes = withProductImage ? [product, image] : [product];
    let currentEdges = withProductImage ? [{ id: "front", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front" }] : [];
    let currentNode = product;
    let activeId = "";
    let panelProps: EcommerceSuitePanelProps | undefined;
    let rerender = () => {};
    let unmount: (() => Promise<void>) | undefined;
    cleanup = async () => {
        try {
            await unmount?.();
        } finally {
            apiClient.request = originalRequest;
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            App.useApp = originalUseApp;
            useEcommerceModelLibrary.getState().reset();
            useEcommerceModelLibrary.setState(originalModels, true);
            useConfigStore.setState({ config: originalConfig });
            if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
            else Reflect.deleteProperty(globalThis, "window");
            if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
            else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        }
    };
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: Object.assign(new EventTarget(), {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    storage.set(key, value);
                },
                removeItem: (key: string) => {
                    storage.delete(key);
                },
            },
        }),
    });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    setActiveUserScope("product-actions-" + ++sequence);
    // Keep real catalog and model hydration; only HTTP and browser storage are external.
    apiClient.request = (async (config) => {
        if (config.method !== "get" || config.url !== "/skills/added") throw new Error("Unexpected HTTP request: " + config.method + " " + config.url);
        return { data: { code: 0, data: { skills: [] }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;
    localforage.getItem = (async (key: string) => storage.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        storage.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    App.useApp = (() => app) as unknown as typeof App.useApp;
    useEcommerceModelLibrary.getState().reset();
    useConfigStore.setState({ config: configuredModels.config });

    function PanelProbe(props: EcommerceSuitePanelProps) {
        panelTree = CanvasEcommerceSuitePanel(props);
        return null;
    }
    function ProductProbe() {
        productTree = ProductNodeContent({ node: product, theme: canvasThemes.dark });
        expect(findElement(productTree, (element) => element.type === CanvasEcommerceSuitePanel)).toBeUndefined();
        return null;
    }
    function TableProbe() {
        const element = CanvasEcommerceTableNodeContent({ node: currentNode });
        const tableTree = (element.type as (props: { node: CanvasNodeData }) => ReactNode)(element.props);
        const panel = findElement(tableTree, (element) => element.type === CanvasEcommerceSuitePanel);
        panelProps = panel?.props as EcommerceSuitePanelProps | undefined;
        expect(panelProps?.embedded).toBe(true);
        return panelProps ? <PanelProbe {...panelProps} /> : null;
    }
    function Fixture() {
        const [, publish] = useState(0);
        rerender = () => publish((value) => value + 1);
        const actions: CanvasNodeActionContextValue = {
            openEcommerceTable: (node, flow) => {
                const plan = openEcommerceTable(currentNodes, currentEdges, node.id, flow);
                currentNodes = plan.nodes;
                currentEdges = plan.connections as typeof currentEdges;
                activeId = plan.table.id;
                currentNode = plan.table;
                publish((value) => value + 1);
            },
            updateMetadata: (id, patch) => {
                currentNodes = currentNodes.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, ...patch } } : node));
                currentNode = currentNodes.find((node) => node.id === activeId)!;
                publish((value) => value + 1);
            },
            draftEcommerceSuite: (...args) => {
                draftCalls.push(args);
            },
            reverseEcommerceSuite: (...args) => {
                reverseCalls.push(args);
            },
            draftEcommerceProfile: async (node) => {
                profileCalls.push(node);
                return typeof profileDraft === "function" ? profileDraft(node) : profileDraft;
            },
            generateEcommerceSuite: (...args) => {
                calls.push(args);
                return next.promise;
            },
        };
        return (
            <CanvasNodeActionContext.Provider value={actions}>
                <CanvasNodeGraphContext.Provider value={createCanvasNodeGraph(currentNodes, currentEdges)}>
                    <ProductProbe />
                    {activeId ? <TableProbe key={activeId} /> : null}
                </CanvasNodeGraphContext.Provider>
            </CanvasNodeActionContext.Provider>
        );
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    unmount = async () => {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
    };
    await act(async () => {
        reconciler.updateContainer(<Fixture />, root, null, null);
    });

    function control(tree: ReactNode, predicate: (props: ControlProps) => boolean) {
        const found = findElement(tree, (element) => predicate(element.props));
        if (!found) throw new Error("Product or suite control missing");
        return found.props;
    }
    const batchButton = () => control(panelTree, (props) => props.title === "按这张表批量提交出图任务");
    const productControl = (label: string) => control(productTree, (props) => props["aria-label"] === label);
    const clickFlow = async (flowName?: string) => {
        await act(async () => {
            const candidates: ReactElement<ControlProps>[] = [];
            const walk = (tree: ReactNode) => {
                if (!React.isValidElement<ControlProps>(tree)) return;
                if (tree.props.className === "ecom-oneclick") candidates.push(tree);
                React.Children.forEach(tree.props.children, walk);
            };
            walk(productTree);
            const text = (node: ReactNode): string => (typeof node === "string" || typeof node === "number" ? String(node) : React.isValidElement<ControlProps>(node) ? React.Children.toArray(node.props.children).map(text).join("") : "");
            const candidate = candidates.find((item) => text(item).includes(flowName || "详情"));
            if (!candidate) throw new Error("Flow button missing");
            candidate.props.onClick!();
        });
    };
    const open = async (flowName?: string) => {
        await clickFlow(flowName);
        expect(panelProps?.open).toBe(true);
    };
    if (initialFlow) await open(initialFlow);
    if (initialFlow) expect(panelProps?.skillsLoading).toBe(false);
    expect(useEcommerceModelLibrary.getState().hydrated).toBe(true);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    return {
        calls,
        draftCalls,
        reverseCalls,
        profileCalls,
        errors,
        warnings,
        open,
        clickFlow,
        batchButton,
        isOpen: () => Boolean(panelProps?.open),
        tables: () => currentNodes.filter((node) => node.type === CanvasNodeType.BatchTable),
        props: () => panelProps!,
        node: () => currentNode,
        product: () => currentNodes.find((node) => node.id === product.id)!,
        confirmation: () => confirmation,
        edit: async (label: string, value: string) => {
            await act(async () => {
                control(panelTree, (props) => props["aria-label"] === label).onChange!({ target: { value } });
            });
        },
        click: async (label: string) => {
            await act(async () => {
                control(panelTree, (props) => props["aria-label"] === label).onClick!();
            });
        },
        analyze: async () => {
            const button = control(panelTree, (props) => props.title === "分析商品图与参考图");
            expect(button.disabled).toBe(false);
            await act(async () => {
                button.onClick!();
            });
        },
        reverse: async () => {
            const button = control(panelTree, (props) => props.title === "根据商品节点的参考图规划套图");
            expect(button.disabled).toBe(false);
            await act(async () => {
                button.onClick!();
            });
        },
        identify: async () => {
            await act(async () => {
                productControl("AI 识别商品信息").onClick!();
            });
        },
        productControl,
        panelControl: (title: string) => control(panelTree, (props) => props.title === title),
        editProductDraft: async (label: string, value: string) => {
            await act(async () => {
                productControl(label).onChange!({ target: { value } });
            });
        },
        clickProduct: async (label: string) => {
            await act(async () => {
                productControl(label).onClick!();
            });
        },
        hasProductControl: (label: string) => Boolean(findElement(productTree, (element) => element.props["aria-label"] === label)),
        productText: () => {
            const text = (tree: ReactNode): string => (typeof tree === "string" || typeof tree === "number" ? String(tree) : React.isValidElement<ControlProps>(tree) ? React.Children.toArray(tree.props.children).map(text).join("") : "");
            return text(productTree);
        },
        changeProductImage: async (patch: { id?: string; title?: string; content?: string }) => {
            await act(async () => {
                const edge = currentEdges.find((item) => item.toNodeId === product.id && item.toHandleId?.startsWith("product-view:"));
                const currentImage = currentNodes.find((item) => item.id === edge?.fromNodeId)!;
                const nextImage = {
                    ...currentImage,
                    ...(patch.id ? { id: patch.id } : {}),
                    ...(patch.title !== undefined ? { title: patch.title } : {}),
                    metadata: { ...currentImage.metadata, ...(patch.content !== undefined ? { content: patch.content } : {}) },
                };
                currentNodes = currentNodes.map((item) => (item.id === currentImage.id ? nextImage : item));
                if (patch.id) currentEdges = currentEdges.map((item) => (item === edge ? { ...item, fromNodeId: patch.id! } : item));
                rerender();
            });
        },
        removeProductImage: async () => {
            await act(async () => {
                currentEdges = currentEdges.filter((item) => item.fromNodeId !== image.id);
                currentNodes = currentNodes.filter((item) => item.id !== image.id);
                rerender();
            });
        },
        submit: async () => {
            const button = batchButton();
            expect(button.disabled).toBe(false);
            await act(async () => {
                button.onClick!();
            });
        },
        settle: async (result: boolean | Error) => {
            await act(async () => {
                if (result instanceof Error) next.reject(result);
                else next.resolve(result);
            });
        },
        retry: () => {
            next = deferred();
        },
    };
}

for (const flow of ["详情页", "种草秀"]) {
    test(`${flow} 缺少已核实事实时展开商品资料并阻止进入创作表`, async () => {
        const profile = { ...createEcommerceProductProfile("Test product"), category: "保温杯" };
        const product = await mountProduct(initialRows, undefined, recognizedProfile, profile, false);

        await product.clickFlow(flow);

        expect(product.tables()).toHaveLength(0);
        expect(product.warnings).toEqual(["请先补充商品资料：卖点与依据、目标人群与场景"]);
        expect(product.hasProductControl("本次识别草稿，请核对后应用")).toBe(true);
        expect(product.productText()).toContain("当前用途还缺：卖点与依据、目标人群与场景");
    });
}

test("主图缺少有依据卖点时展开商品资料并阻止进入创作表", async () => {
    const profile = { ...createEcommerceProductProfile("Test product"), category: "保温杯" };
    const product = await mountProduct(initialRows, undefined, recognizedProfile, profile, false);

    await product.clickFlow("主图");

    expect(product.tables()).toHaveLength(0);
    expect(product.warnings).toEqual(["请先补充商品资料：卖点与依据、目标人群与场景"]);
    expect(product.productText()).toContain("当前用途还缺：卖点与依据、目标人群与场景");
});

test("主图缺少品类时展开商品资料并明确缺失项", async () => {
    const product = await mountProduct(initialRows, undefined, recognizedProfile, createEcommerceProductProfile("Test product"), false);

    await product.clickFlow("主图");

    expect(product.tables()).toHaveLength(0);
    expect(product.warnings).toEqual(["请先补充商品资料：品类、卖点与依据、目标人群与场景"]);
    expect(product.productText()).toContain("当前用途还缺：品类、卖点与依据、目标人群与场景");
});

test("主图缺少商品视觉证据时不进入创作表", async () => {
    const product = await mountProduct(initialRows, undefined, recognizedProfile, copyReadyProfile, false, false);

    await product.clickFlow("主图");

    expect(product.tables()).toHaveLength(0);
    expect(product.warnings).toEqual(["请先补充商品资料：商品视觉证据"]);
    expect(product.productText()).toContain("当前用途还缺：商品视觉证据");
});

test("模特上身缺少商品视觉证据时不进入创作表", async () => {
    const product = await mountProduct(initialRows, undefined, recognizedProfile, copyReadyProfile, false, false);

    await product.clickFlow("模特上身");

    expect(product.tables()).toHaveLength(0);
    expect(product.warnings).toEqual(["请先补充商品资料：商品视觉证据"]);
    expect(product.productText()).toContain("当前用途还缺：商品视觉证据");
});

test("AI product identification keeps an editable draft local until confirmation", async () => {
    const product = await mountProduct();
    const metadataBeforeDraft = structuredClone(product.product().metadata);
    await product.identify();
    expect(product.profileCalls.map((node) => node.id)).toEqual(["product"]);
    expect(product.product().metadata).toEqual(metadataBeforeDraft);
    expect(product.productControl("草稿品类").value).toBe("保温杯");
    expect(product.productControl("草稿外观").value).toBe("哑光黑色杯身");
    expect(product.productControl("草稿标识").value).toBe("杯身中部 THERMO");
    expect(product.productControl("草稿禁止项").value).toBe("不要改变杯盖结构");
    expect(product.productControl("草稿目标人群与场景").value).toBe("通勤携带；办公室饮水");
    expect(product.productControl("草稿卖点与依据").value).toBe("便于携带：杯盖顶部有可见提手");
    expect(product.productControl("草稿真实价格").value).toBe("");
    expect(product.hasProductControl("本次识别草稿，请核对后应用")).toBe(true);

    await product.editProductDraft("草稿品类", "随行杯");
    await product.editProductDraft("草稿真实价格", "129 元");
    await product.clickProduct("确认并应用商品草稿");
    expect(product.product().metadata?.productProfile).toMatchObject({
        name: "Test product",
        category: "随行杯",
        appearance: "哑光黑色杯身",
        marks: "杯身中部 THERMO",
        forbidden: "不要改变杯盖结构",
        audience: "通勤携带；办公室饮水",
        facts: "便于携带：杯盖顶部有可见提手",
        price: "129 元",
    });
    expect(product.product().metadata?.productProfile).not.toHaveProperty("unsure");
    expect(product.hasProductControl("草稿品类")).toBe(false);
});

test("partial AI profile drafts preserve confirmed fields and only replace them with meaningful values", async () => {
    const initialProfile = {
        ...createEcommerceProductProfile("Test product"),
        category: "旧品类",
        appearance: "银色金属杯身",
        marks: "旧 LOGO",
        forbidden: "不要改变杯盖",
        audience: "旧人群",
        facts: "旧卖点：旧依据",
        price: "99 元",
    };
    const product = await mountProduct(initialRows, undefined, { category: "保温杯", appearance: "   " }, initialProfile);

    await product.identify();
    expect(product.productControl("草稿品类").value).toBe("保温杯");
    expect(product.productControl("草稿外观").value).toBe("银色金属杯身");
    expect(product.productControl("草稿标识").value).toBe("旧 LOGO");
    expect(product.productControl("草稿禁止项").value).toBe("不要改变杯盖");
    expect(product.productControl("草稿目标人群与场景").value).toBe("旧人群");
    expect(product.productControl("草稿卖点与依据").value).toBe("旧卖点：旧依据");
    expect(product.productControl("草稿真实价格").value).toBe("99 元");

    await product.editProductDraft("草稿标识", "新 LOGO");
    await product.clickProduct("确认并应用商品草稿");
    expect(product.product().metadata?.productProfile).toEqual({
        ...initialProfile,
        category: "保温杯",
        marks: "新 LOGO",
    });
});

test("discarding an old draft allows a new identification that rejects replaced image evidence", async () => {
    let call = 0;
    let resolveDraft!: (value: RecognizedProfileDraft) => void;
    const pendingDraft = new Promise<RecognizedProfileDraft>((resolve) => {
        resolveDraft = resolve;
    });
    const product = await mountProduct(initialRows, undefined, () => (call++ === 0 ? recognizedProfile : pendingDraft));
    const metadataBeforeDraft = structuredClone(product.product().metadata);

    await product.identify();
    expect(product.hasProductControl("草稿品类")).toBe(true);
    await product.clickProduct("放弃商品草稿");
    await product.identify();
    expect(product.hasProductControl("草稿品类")).toBe(false);

    await product.changeProductImage({ id: "replacement-photo", content: "/replacement-photo.png" });
    await act(async () => {
        resolveDraft(recognizedProfile);
        await pendingDraft;
    });

    expect(product.hasProductControl("草稿品类")).toBe(false);
    expect(product.product().metadata).toEqual(metadataBeforeDraft);
    expect(product.warnings).toContain("商品图片已变化，请重新识别");
});

test("renaming the same image does not invalidate an in-flight product identification", async () => {
    let resolveDraft!: (value: RecognizedProfileDraft) => void;
    const pendingDraft = new Promise<RecognizedProfileDraft>((resolve) => {
        resolveDraft = resolve;
    });
    const product = await mountProduct(initialRows, undefined, pendingDraft);

    await product.identify();
    await product.changeProductImage({ title: "Renamed product photo" });
    await act(async () => {
        resolveDraft(recognizedProfile);
        await pendingDraft;
    });

    expect(product.hasProductControl("草稿品类")).toBe(true);
    expect(product.warnings).toEqual([]);
});

test("confirming a product draft rejects changed image evidence", async () => {
    const product = await mountProduct();
    const metadataBeforeDraft = structuredClone(product.product().metadata);
    await product.identify();

    await product.changeProductImage({ id: "replacement-photo", content: "/replacement-photo.png" });
    await product.clickProduct("确认并应用商品草稿");

    expect(product.product().metadata).toEqual(metadataBeforeDraft);
    expect(product.hasProductControl("草稿品类")).toBe(false);
    expect(product.warnings).toContain("商品图片已变化，请重新识别");
});

test("discarding an AI product draft leaves metadata unchanged", async () => {
    const product = await mountProduct();
    const metadataBeforeDraft = structuredClone(product.product().metadata);
    await product.identify();
    expect(product.hasProductControl("草稿品类")).toBe(true);

    await product.clickProduct("放弃商品草稿");
    expect(product.product().metadata).toEqual(metadataBeforeDraft);
    expect(product.hasProductControl("草稿品类")).toBe(false);
});

test("an existing product draft must be resolved before starting another identification", async () => {
    const product = await mountProduct();

    await product.clickProduct("编辑商品信息");
    await product.editProductDraft("草稿品类", "用户编辑的品类");
    await product.editProductDraft("草稿真实价格", "129 元");

    expect(product.productControl("AI 识别商品信息").disabled).toBe(true);
    expect(product.productControl("草稿品类").value).toBe("用户编辑的品类");
    expect(product.productControl("草稿真实价格").value).toBe("129 元");
});

test("AI product identification shows progress and ignores repeated clicks", async () => {
    let resolveDraft!: (value: typeof recognizedProfile) => void;
    const pendingDraft = new Promise<typeof recognizedProfile>((resolve) => {
        resolveDraft = resolve;
    });
    const product = await mountProduct(initialRows, { analysisModel: configuredModels.analysisOverride, imageModel: configuredModels.imageOverride }, pendingDraft);

    await product.identify();
    const pendingButton = product.productControl("AI 识别商品信息");
    expect(pendingButton.disabled).toBe(true);
    expect(product.productControl("编辑商品信息").disabled).toBe(true);
    pendingButton.onClick!();
    expect(product.profileCalls).toHaveLength(1);

    await act(async () => {
        resolveDraft(recognizedProfile);
        await pendingDraft;
    });
    expect(product.productControl("AI 识别商品信息").disabled).toBe(true);
    expect(product.productControl("编辑商品信息").disabled).toBe(false);
    expect(product.hasProductControl("草稿品类")).toBe(true);
});

test("table follows effective default models without persisting them and analyzes with the derived text model", async () => {
    const product = await mountProduct(initialRows, {});
    const metadata = structuredClone(product.node().metadata);
    expect(product.props()).toMatchObject({ analysisModel: configuredModels.analysisDefault, imageModel: configuredModels.imageDefault });

    const nextModels = modelFixture("ecommerce-actions-next");
    await act(async () => {
        useConfigStore.setState({ config: nextModels.config });
    });
    expect(product.props()).toMatchObject({ analysisModel: nextModels.analysisDefault, imageModel: nextModels.imageDefault });
    expect(product.node().metadata).toEqual(metadata);

    await product.analyze();
    expect(product.draftCalls).toEqual([[expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", nextModels.analysisDefault, initialRows]]);
});

test("table keeps valid explicit model overrides", async () => {
    const product = await mountProduct();
    expect(product.props()).toMatchObject({ analysisModel: configuredModels.analysisOverride, imageModel: configuredModels.imageOverride });
    await product.analyze();
    expect(product.draftCalls[0]?.[2]).toBe(configuredModels.analysisOverride);
});

test("table never falls back when a non-empty explicit model no longer matches its capability", async () => {
    const product = await mountProduct(initialRows, { analysisModel: configuredModels.imageOverride, imageModel: configuredModels.analysisOverride });
    expect(product.props()).toMatchObject({ analysisModel: "", imageModel: "" });

    expect(product.panelControl("请先选择分析模型").disabled).toBe(true);
    expect(product.panelControl("根据商品节点的参考图规划套图").disabled).toBe(true);
    expect(product.draftCalls).toEqual([]);
    expect(product.reverseCalls).toEqual([]);
});

test("已存在的详情页创作表在商品事实被清空后也阻止分析和生产", async () => {
    const product = await mountProduct();
    await product.clickProduct("编辑商品信息");
    await product.editProductDraft("草稿目标人群与场景", "");
    await product.editProductDraft("草稿卖点与依据", "");
    await product.clickProduct("确认并应用商品草稿");

    await product.analyze();
    await product.submit();

    expect(product.draftCalls).toEqual([]);
    expect(product.calls).toEqual([]);
    expect(product.warnings).toEqual(["请先回到商品节点补充商品资料：卖点与依据、目标人群与场景", "请先回到商品节点补充商品资料：卖点与依据、目标人群与场景"]);
});

test("已存在的主图创作表在商品事实被清空后也阻止分析和生产", async () => {
    const product = await mountProduct(initialRows, undefined, recognizedProfile, copyReadyProfile, "主图");
    await act(async () => product.props().onRowsChange(product.props().rows.map((row, index) => (index ? row : { ...row, prompt: "Verified prompt" }))));
    await product.clickProduct("编辑商品信息");
    await product.editProductDraft("草稿目标人群与场景", "");
    await product.editProductDraft("草稿卖点与依据", "");
    await product.clickProduct("确认并应用商品草稿");

    await product.analyze();
    await product.submit();
    await act(async () => {
        product.confirmation()!.onOk!();
    });

    expect(product.draftCalls).toEqual([]);
    expect(product.calls).toEqual([]);
    expect(product.warnings).toEqual(["请先回到商品节点补充商品资料：卖点与依据、目标人群与场景", "请先回到商品节点补充商品资料：卖点与依据、目标人群与场景"]);
});

test("已存在的模特上身创作表在商品图被移除后也阻止分析和生产", async () => {
    const product = await mountProduct(initialRows, undefined, recognizedProfile, copyReadyProfile, "模特上身");
    await act(async () => product.props().onRowsChange(product.props().rows.map((row, index) => (index ? row : { ...row, prompt: "Verified prompt" }))));
    await product.removeProductImage();

    await product.analyze();
    await product.submit();
    await act(async () => {
        product.confirmation()!.onOk!();
    });

    expect(product.draftCalls).toEqual([]);
    expect(product.calls).toEqual([]);
    expect(product.warnings).toEqual(["请先回到商品节点补充商品资料：商品视觉证据", "请先回到商品节点补充商品资料：商品视觉证据"]);
});

test("switching purposes creates separate connected tables and preserves edits", async () => {
    const product = await mountProduct();
    await editHero(product);
    await product.open("主图");
    const mainSlot = product.props().rows[0].slotId;
    await act(async () => {
        product.props().onRowsChange([{ ...product.props().rows[0], prompt: "Main draft" }]);
    });
    await product.open("详情页");
    expect(product.props().rows).toEqual(editedRows);
    expect(product.tables()).toHaveLength(2);
    expect(product.tables().find((node) => node.metadata?.ecommerceFlowId === "main")?.metadata?.ecommerceSuite?.rows[0]).toMatchObject({ slotId: mainSlot, prompt: "Main draft" });
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
        expect(product.calls[0]).toEqual([expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", undefined, editedRows, true]);
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
    const modalClose = () => {
        throw new Error("Modal close callback must not be submitted as draft rows");
    };
    await act(async () => {
        product.confirmation()!.onOk!(modalClose);
    });
    const expected = [
        { slotId: "detail-1", title: "Edited hero", duty: "Show the edited composition", prompt: "Edited hero prompt" },
        { slotId: "detail-2", title: "Detail", duty: "Show the texture", prompt: "" },
    ];
    expect(product.calls).toHaveLength(1);
    expect(product.calls[0]).toEqual([expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", undefined, expected, true]);
    expect(product.node().metadata?.ecommerceSuite?.rows).toEqual(expected);
    expect(product.isOpen()).toBe(true);
    await product.settle(true);
    expect(product.isOpen()).toBe(true);
});

test("single-row generation forwards its slot and reordered draft, and suppresses another enqueue while pending", async () => {
    const product = await mountProduct();
    await editHero(product);
    await product.click("把「Edited hero」往后挪一格");
    await product.click("生成：Edited hero");
    const expected = [
        { slotId: "detail-2", title: "Detail", duty: "Show the texture", prompt: "Original detail prompt" },
        { slotId: "detail-1", title: "Edited hero", duty: "Show the edited composition", prompt: "Edited hero prompt" },
    ];
    expect(product.calls).toHaveLength(1);
    expect(product.calls[0]).toEqual([expect.objectContaining({ type: CanvasNodeType.BatchTable }), "detail", ["detail-1"], expected, false]);
    expect(product.node().metadata?.ecommerceSuite?.rows).toEqual(expected);
    await product.click("生成：Detail");
    expect(product.calls).toHaveLength(1);
    expect(product.isOpen()).toBe(true);
    await product.settle(false);
    expect(product.isOpen()).toBe(true);
    expect(product.props().generating).toBe(false);
    product.retry();
    await product.click("生成：Detail");
    expect(product.calls).toHaveLength(2);
    expect(product.calls[1]?.[2]).toEqual(["detail-2"]);
    expect(product.calls[1]?.[3]).toEqual(expected);
    await product.settle(true);
    expect(product.isOpen()).toBe(true);
});
