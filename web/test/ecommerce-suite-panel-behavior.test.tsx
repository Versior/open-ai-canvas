import { afterEach, expect, mock, test } from "bun:test";
import React, { act, type ReactElement, type ReactNode } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasEcommerceSuitePanel, type EcommerceSuitePanelProps } from "../src/components/canvas/canvas-ecommerce-suite-panel";
import { CanvasImageSettingsPopover } from "../src/components/canvas/canvas-image-settings-popover";
import { CanvasEcommerceTableNodeContent } from "../src/components/canvas/canvas-ecommerce-table-node";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { ModelPicker } from "../src/components/model-picker";
import { createCanvasNodeGraph } from "../src/lib/canvas/canvas-node-graph";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import { ECOMMERCE_LAYOUT_PRESETS, createEcommerceLayoutFromPreset, ecommerceLayoutBlockStyle } from "../src/lib/ecommerce/ecommerce-layout";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createModelChannel, defaultConfig, useConfigStore } from "../src/stores/use-config-store";
import { useEcommerceModelLibrary } from "../src/stores/use-ecommerce-model-library";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode } from "../src/types/canvas";

const originalUseApp = App.useApp;
const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalConfig = useConfigStore.getState().config;
const originalModelLibrary = useEcommerceModelLibrary.getState();
let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    App.useApp = originalUseApp;
    if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    useConfigStore.setState({ config: originalConfig });
    useEcommerceModelLibrary.getState().reset();
    useEcommerceModelLibrary.setState(originalModelLibrary, true);
});

function findElement(tree: ReactNode, type: React.ElementType): ReactElement<Record<string, any>> | undefined {
    if (!React.isValidElement<Record<string, any>>(tree)) return;
    if (tree.type === type) return tree;
    for (const child of React.Children.toArray(tree.props.children)) {
        const found = findElement(child, type);
        if (found) return found;
    }
}

async function mountPanel(workspaceMode?: CanvasWorkspaceMode) {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    let confirmation: { onOk?: (...args: unknown[]) => unknown } | undefined;
    const messages: unknown[] = [];
    App.useApp = (() => ({
        modal: {
            confirm: (options: typeof confirmation) => {
                confirmation = options;
            },
        },
        message: {
            error: (value: unknown) => {
                messages.push(value);
            },
        },
    })) as typeof App.useApp;
    const submitted: unknown[] = [];
    const saved: unknown[] = [];
    const analyzed: unknown[] = [];
    const analysisModels: string[] = [];
    const imageModels: string[] = [];
    let props: EcommerceSuitePanelProps = {
        open: true,
        flow: ECOMMERCE_ONE_CLICK_FLOWS[0],
        suite: undefined,
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
        nodeBySlot: new Map(),
        analysisModel: "analysis",
        analysisReferenceImageCount: 0,
        imageModel: "image",
        imageSize: "",
        imageQuality: "",
        autoBind: false,
        analyzing: false,
        onAnalysisModelChange(model) {
            analysisModels.push(model);
        },
        onImageModelChange(model) {
            imageModels.push(model);
        },
        onImageOptionChange() {},
        onAutoBindChange() {},
        onClearPrompts() {},
        onAnalyze(rows) {
            analyzed.push(rows);
            return undefined;
        },
        onRowChange() {},
        onRowsChange(rows) {
            saved.push(rows);
        },
        onAddRow() {},
        onRemoveRow() {},
        onGenerate(rows) {
            submitted.push(rows);
        },
        onGenerateOne() {},
        onMoveRow() {},
        onClose() {},
    };
    let tree: ReactElement;
    function PanelProbe() {
        tree = CanvasEcommerceSuitePanel(props);
        return null;
    }
    function Probe() {
        return (
            <CanvasNodeActionContext.Provider value={{ workspaceMode }}>
                <PanelProbe />
            </CanvasNodeActionContext.Provider>
        );
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    const render = async () => {
        await act(async () => {
            reconciler.updateContainer(<Probe />, root, null, null);
        });
    };
    await render();
    unmount = async () => {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
    };
    function element(predicate: (props: Record<string, any>) => boolean): ReactElement<Record<string, any>> {
        const walk = (node: React.ReactNode): ReactElement<Record<string, any>> | undefined => {
            if (!React.isValidElement<Record<string, any>>(node)) return;
            if (predicate(node.props)) return node;
            for (const child of React.Children.toArray(node.props.children)) {
                const found = walk(child);
                if (found) return found;
            }
        };
        const found = walk(tree!);
        if (!found) throw new Error("Panel control missing");
        return found;
    }
    function find(predicate: (props: Record<string, any>) => boolean): Record<string, any> {
        return element(predicate).props;
    }
    function countType(type: React.ElementType) {
        const walk = (node: React.ReactNode): number => {
            if (!React.isValidElement<Record<string, any>>(node)) return 0;
            return Number(node.type === type) + React.Children.toArray(node.props.children).reduce((count, child) => count + walk(child), 0);
        };
        return walk(tree!);
    }
    function count(predicate: (props: Record<string, any>) => boolean) {
        const walk = (node: React.ReactNode): number => {
            if (!React.isValidElement<Record<string, any>>(node)) return 0;
            return Number(predicate(node.props)) + React.Children.toArray(node.props.children).reduce((total, child) => total + walk(child), 0);
        };
        return walk(tree!);
    }
    return {
        element,
        find,
        count,
        countType,
        analyzed,
        analysisModels,
        imageModels,
        submitted,
        saved,
        messages,
        confirmation: () => confirmation,
        rerender: async (patch: Partial<EcommerceSuitePanelProps>) => {
            props = { ...props, ...patch };
            await render();
        },
    };
}

async function openQuickDesign(panel: Awaited<ReturnType<typeof mountPanel>>, label = "First") {
    await act(async () => {
        panel.find((props) => props["aria-label"] === `${label} 文案与版式`).onClick();
    });
}

test("simple workspace hides professional model controls while both models are available", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ analysisModel: "channel::dynamic-analysis-default" });

    expect(panel.countType(ModelPicker)).toBe(0);
    expect(panel.countType(CanvasImageSettingsPopover)).toBe(0);
    const changeModel = panel.find((props) => props["aria-label"] === "打开高级设置");
    expect(changeModel["aria-expanded"]).toBe(false);
    await act(async () => {
        changeModel.onClick();
    });
    expect(panel.countType(ModelPicker)).toBe(2);
    await act(async () => {
        panel.find((props) => props.capability === "image").onChange("channel::replacement-image");
    });
    expect(panel.imageModels).toEqual(["channel::replacement-image"]);
    await act(async () => {
        panel.find((props) => props["aria-label"] === "关闭高级设置").onClick();
    });
    expect(panel.countType(ModelPicker)).toBe(0);
    const analyze = panel.find((props) => props.title === "分析商品图与参考图");
    expect(analyze.disabled).toBe(false);
    await act(async () => {
        analyze.onClick();
    });
    expect(panel.analyzed).toEqual([
        [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
    ]);
});

test("simple workspace exposes recovery when a non-empty analysis model cannot read all current references", async () => {
    const limitedProfile = defaultModelCapabilityConfig("newapi-chat", "limited-vision");
    limitedProfile.text!.references.maxImages = 1;
    const compatibleProfile = defaultModelCapabilityConfig("newapi-chat", "compatible-vision");
    compatibleProfile.text!.references.maxImages = 4;
    const channel = createModelChannel({
        id: "vision",
        models: ["limited-vision", "compatible-vision"],
        modelCosts: [
            { model: "limited-vision", capability: "text", protocol: "newapi-chat", capabilityConfig: limitedProfile, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
            { model: "compatible-vision", capability: "text", protocol: "newapi-chat", capabilityConfig: compatibleProfile, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
        ],
    });
    const limitedModel = "vision::limited-vision";
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model: limitedModel, textModel: limitedModel, textModels: [limitedModel, "vision::compatible-vision"] } });

    const panel = await mountPanel("simple");
    await panel.rerender({ analysisModel: limitedModel, analysisReferenceImageCount: 3 });

    expect(panel.countType(ModelPicker)).toBe(1);
    expect(panel.find((props) => props.capability === "text").requirements.input.imageCount).toBe(3);
    expect(String(panel.find((props) => props.role === "alert").children)).toContain("最多支持 1 张参考图");
    expect(panel.find((props) => String(props.title).includes("最多支持 1 张参考图")).disabled).toBe(true);

    await panel.rerender({ analysisReferenceImageCount: 1 });
    expect(panel.countType(ModelPicker)).toBe(0);
    expect(panel.find((props) => props.title === "分析商品图与参考图").disabled).toBe(false);
});

test("generation uses the actual reference count and blocks an incompatible image model", async () => {
    const limitedProfile = defaultModelCapabilityConfig("newapi-image", "limited-image");
    limitedProfile.image!.references.maxImages = 1;
    const compatibleProfile = defaultModelCapabilityConfig("newapi-image", "compatible-image");
    compatibleProfile.image!.references.maxImages = 4;
    const channel = createModelChannel({
        id: "image-capacity",
        models: ["limited-image", "compatible-image"],
        modelCosts: [
            { model: "limited-image", capability: "image", protocol: "newapi-image", capabilityConfig: limitedProfile, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
            { model: "compatible-image", capability: "image", protocol: "newapi-image", capabilityConfig: compatibleProfile, billingMode: "fixed_request", unitPriceMicrocredits: 1 },
        ],
    });
    const limitedModel = "image-capacity::limited-image";
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], model: limitedModel, imageModel: limitedModel, imageModels: [limitedModel, "image-capacity::compatible-image"] } });

    const panel = await mountPanel("simple");
    await panel.rerender({ imageModel: limitedModel, analysisReferenceImageCount: 1, generationReferenceImageCount: 3 });

    const picker = panel.find((props) => props.capability === "image");
    expect(picker.requirements.input.imageCount).toBe(3);
    expect(String(panel.find((props) => props.role === "alert" && String(props.children).includes("最多支持 1 张参考图")).children)).toContain("最多支持 1 张参考图");
    expect(panel.find((props) => props["aria-label"] === "生成：First")).toMatchObject({ disabled: true, title: "最多支持 1 张参考图" });
    expect(panel.find((props) => props["aria-label"] === "生成第一版")).toMatchObject({ disabled: true, title: "最多支持 1 张参考图" });
});

test("table exposes recovery props and every active product batch item", async () => {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: Object.assign(new EventTarget(), { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }),
    });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    App.useApp = (() => ({ message: { error() {} } })) as typeof App.useApp;
    const flow = ECOMMERCE_ONE_CLICK_FLOWS[0];
    const rows = [{ slotId: "first", title: "First", duty: "Hero", prompt: "Prompt" }];
    const storedModel = "removed-channel::removed-analysis";
    const node: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "Table",
        position: { x: 0, y: 0 },
        metadata: { ecommerceFlowId: flow.id, ecommerceAnalysisModel: storedModel, ecommerceSuite: { flow: flow.id, source: "draft", updatedAt: "", rows } },
    };
    const product: CanvasNodeData = {
        id: "product",
        type: CanvasNodeType.Product,
        title: "Product",
        position: { x: 0, y: 0 },
        metadata: {
            ecommerceModelId: "model-a",
            productProfile: { ...createEcommerceProductProfile("Product"), category: "服装", audience: "通勤人群", facts: "耐磨：面料测试" },
            generationBatches: [
                {
                    id: "batch",
                    projectId: "project",
                    sourceNodeId: "product",
                    mode: "batch_image",
                    status: "running",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    items: (["waiting", "submitting", "queued", "running", "succeeded"] as const).map((status, index) => ({ id: `item-${index}`, rowId: `row-${index}`, nodeId: `output-${index}`, status, retryCount: 0 })),
                },
            ],
        },
    };
    const front: CanvasNodeData = { id: "front", type: CanvasNodeType.Image, title: "Front", position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,front" } };
    const back: CanvasNodeData = { id: "back", type: CanvasNodeType.Image, title: "Back", position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,back" } };
    const style: CanvasNodeData = { id: "style", type: CanvasNodeType.Image, title: "Style", position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,style", ecommerceReferenceRole: "style" } };
    const graph = createCanvasNodeGraph(
        [node, product, front, back, style],
        [
            { id: "front-product", fromNodeId: front.id, toNodeId: product.id, toHandleId: "product-view:front" },
            { id: "back-product", fromNodeId: back.id, toNodeId: product.id, toHandleId: "product-view:back" },
            { id: "style-product", fromNodeId: style.id, toNodeId: product.id, toHandleId: "visual-reference:0" },
            { id: "product-table", fromNodeId: product.id, toNodeId: node.id },
        ],
    );
    const draftCalls: unknown[][] = [];
    let panelProps: EcommerceSuitePanelProps | undefined;
    useEcommerceModelLibrary.setState({
        models: [{ id: "model-a", name: "Model A", kind: "custom", refs: ["resource:model-front", "resource:model-side"], tags: [], createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
    });
    function Probe() {
        const element = CanvasEcommerceTableNodeContent({ node });
        const table = (element.type as (props: { node: CanvasNodeData }) => ReactNode)(element.props);
        panelProps = findElement(table, CanvasEcommerceSuitePanel)?.props as EcommerceSuitePanelProps | undefined;
        return null;
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
        reconciler.updateContainer(
            <CanvasNodeActionContext.Provider value={{ workspaceMode: "simple", draftEcommerceSuite: (...args) => draftCalls.push(args) }}>
                <CanvasNodeGraphContext.Provider value={graph}>
                    <Probe />
                </CanvasNodeGraphContext.Provider>
            </CanvasNodeActionContext.Provider>,
            root,
            null,
            null,
        );
    });

    expect(panelProps?.analysisModel).toBe("");
    expect(panelProps?.analysisReferenceImageCount).toBe(3);
    expect(panelProps?.generationReferenceImageCount).toBe(5);
    expect(panelProps?.activeGenerationNodeIds).toEqual(new Set(["output-0", "output-1", "output-2", "output-3"]));
    await act(async () => {
        panelProps?.onAnalyze(rows);
    });
    expect(draftCalls[0]?.[2]).toBe(storedModel);
});

test("simple workspace exposes analysis recovery when its model is unavailable", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ analysisModel: "" });

    expect(panel.countType(ModelPicker)).toBe(1);
    expect(panel.countType(CanvasImageSettingsPopover)).toBe(0);
    const picker = panel.find((props) => props.capability === "text");
    await act(async () => {
        picker.onChange("channel::replacement-analysis");
    });
    expect(panel.analysisModels).toEqual(["channel::replacement-analysis"]);
    expect(panel.find((props) => props.role === "alert" && props.children === "分析模型不可用，请重新选择")).toBeDefined();
    expect(panel.find((props) => props.to === "/settings?section=models")).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
    expect(panel.find((props) => props.title === "请先选择分析模型").disabled).toBe(true);
});

test("simple workspace blocks single and batch generation until an unavailable image model is replaced", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ imageModel: "" });

    expect(panel.countType(ModelPicker)).toBe(1);
    expect(panel.countType(CanvasImageSettingsPopover)).toBe(0);
    const picker = panel.find((props) => props.capability === "image");
    await act(async () => {
        picker.onChange("channel::replacement-image");
    });
    expect(panel.imageModels).toEqual(["channel::replacement-image"]);
    expect(panel.find((props) => props.role === "alert" && props.children === "生图模型不可用，请重新选择")).toBeDefined();
    expect(panel.find((props) => props.to === "/settings?section=models")).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
    expect(panel.find((props) => props["aria-label"] === "生成：First")).toMatchObject({ disabled: true, title: "请先选择生图模型" });
    expect(panel.find((props) => props.className === "ecom-suite-primary" && props.title === "请先选择生图模型")).toMatchObject({ disabled: true });
});

test("professional workspace keeps model and image controls", async () => {
    const panel = await mountPanel("professional");
    expect(panel.countType(ModelPicker)).toBe(2);
    expect(panel.countType(CanvasImageSettingsPopover)).toBe(1);
    expect(panel.find((props) => props["aria-label"] === "First 提示词").value).toBe("Old prompt");
});

test("simple workspace presents storyboard cards and hides prompt until advanced settings open", async () => {
    const panel = await mountPanel("simple");

    expect(() => panel.find((props) => props["aria-label"] === "First 提示词")).toThrow();
    expect(panel.find((props) => props.className === "ecom-suite-detail-workspace")).toBeDefined();

    await act(async () => {
        panel.find((props) => props["aria-label"] === "打开高级设置").onClick();
    });

    expect(panel.countType(ModelPicker)).toBe(2);
    expect(panel.find((props) => props["aria-label"] === "First 提示词").value).toBe("Old prompt");
});

test("simple detail flow keeps skipped screens editable but out of the continuous preview", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "", enabled: false },
        ],
    });

    expect(panel.find((props) => props.className === "ecom-suite-detail-workspace")).toBeDefined();
    expect(panel.find((props) => props["aria-label"] === "详情页屏次")).toBeDefined();
    expect(panel.find((props) => props["aria-label"] === "连续详情页预览")).toBeDefined();
    expect(panel.find((props) => props["aria-label"] === "当前屏编辑")).toBeDefined();
    expect(panel.count((props) => String(props.className).includes("ecom-suite-detail-preview-page"))).toBe(1);
    expect(panel.count((props) => String(props["aria-label"]).startsWith("编辑第 "))).toBe(2);
    expect(() => panel.find((props) => props["aria-label"] === "在编辑区打开第 2 屏：Second")).toThrow();
    expect(panel.find((props) => props["aria-label"] === "编辑第 1 屏：First")["aria-current"]).toBe("page");
    expect(panel.find((props) => props["aria-label"] === "第 1 屏：First").hidden).toBe(false);
    expect(panel.find((props) => props["aria-label"] === "第 2 屏：Second").hidden).toBe(true);

    await act(async () => {
        panel.find((props) => props["aria-label"] === "编辑第 2 屏：Second").onClick();
    });

    expect(panel.find((props) => props["aria-label"] === "编辑第 2 屏：Second")["aria-current"]).toBe("page");
    expect(panel.find((props) => props["aria-label"] === "第 1 屏：First").hidden).toBe(true);
    expect(panel.find((props) => props["aria-label"] === "第 2 屏：Second").hidden).toBe(false);
});

test("storyboard screen switch keeps its accessible name and reports the enabled state", async () => {
    const panel = await mountPanel("simple");
    expect(panel.find((props) => props.role === "group" && props["aria-label"] === "第 2 屏：Second")).toBeDefined();

    const toggle = panel.find((props) => props["aria-label"] === "启用这一屏：Second");
    expect(toggle).toMatchObject({ role: "switch", "aria-checked": true });
    await act(async () => {
        toggle.onClick();
    });
    expect(panel.find((props) => props["aria-label"] === "启用这一屏：Second")).toMatchObject({ role: "switch", "aria-checked": false });
});

test("non-embedded suite modal has an accessible name without another visible title", async () => {
    const panel = await mountPanel("simple");
    const modal = panel.find((props) => props.className === "ecom-suite-modal");
    expect(modal.title).toBe(ECOMMERCE_ONE_CLICK_FLOWS[0].name);
    expect(modal.classNames).toEqual({ header: "sr-only" });
});

test("the last storyboard screen cannot be removed", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" }] });
    expect(panel.find((props) => props["aria-label"] === "删掉这一屏：First").disabled).toBe(true);
});

test("batch generation exposes its busy state and progress copy", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ generating: true });
    const generate = panel.find((props) => props.className === "ecom-suite-primary" && props["aria-busy"] === true);
    expect(generate.children.at(-1)).toBe("正在生成 1 张…");
});

test("mobile and coarse-pointer storyboard controls keep 44px touch targets", async () => {
    const css = (await Bun.file(new URL("../src/components/canvas/canvas-ecommerce-suite-panel.css", import.meta.url)).text()).replace(/\s+/g, " ");
    expect(css).toContain('.ecom-suite-row-toggle[aria-checked="true"]');
    expect(css).toContain("@media (max-width: 760px), (pointer: coarse)");
    expect(css).toContain("grid-template-columns: 160px minmax(320px, 1fr) minmax(300px, 360px)");
    expect(css).toMatch(/\.ecom-suite-story-card \.ecom-suite-row-move, \.ecom-suite-story-card \.ecom-suite-row-remove, \.ecom-suite-row-move, \.ecom-suite-row-remove \{ width: 44px; height: 44px; opacity: 1; \}/);
    expect(css).toMatch(/\.ecom-suite-row-toggle, \.ecom-suite-row-run \{ min-width: 44px; min-height: 44px; \}/);
    expect(css).toMatch(/\.ecom-suite-missing-plan \{ [^}]*grid-area: prompt; [^}]*\}/);
    expect(css).toMatch(/\.ecom-suite-layout-preset, \.ecom-suite-copy-fields input, \.ecom-suite-missing-plan button \{ min-width: 44px; min-height: 44px; \}/);
    expect(css).toMatch(/\.ecom-suite-primary, \.ecom-suite-ghost, \.ecom-suite-icon, \.ecom-suite-library-link, \.ecom-suite-add-row, \.ecom-suite-result-select, \.ecom-suite-screen-input \{ min-height: 44px; \}/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[^]*?\.ecom-suite-story-result \{ grid-template-columns: 112px minmax\(0, 1fr\); \}/);
    expect(css).toMatch(/\.ecom-suite-result-error \{ [^}]*overflow-wrap: anywhere; [^}]*\}/);
});

test("storyboard copy stays readable and primary desktop controls keep 40px targets", async () => {
    const css = (await Bun.file(new URL("../src/components/canvas/canvas-ecommerce-suite-panel.css", import.meta.url)).text()).replace(/\s+/g, " ");

    expect(css).not.toMatch(/font-size: (?:9|10)px;/);
    expect(css).toMatch(/\.ecom-suite-story-card \.ecom-suite-row-move, \.ecom-suite-story-card \.ecom-suite-row-remove \{ [^}]*width: 40px; height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-row-toggle \{ [^}]*min-height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-story-result \.ecom-suite-row-run \{ [^}]*min-height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-candidate \{ [^}]*min-height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-copy-toggle \{ [^}]*min-height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-copy-fields input \{ [^}]*min-height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-layout-preset \{ [^}]*min-height: 40px;/);
    expect(css).toMatch(/\.ecom-suite-missing-plan button \{ [^}]*min-height: 40px;/);
});

test("simple workspace skips a screen without deleting its prompt and generates the enabled range", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ imageSize: "1024x1536", imageQuality: "hd", generationReferenceImageCount: 3, autoBind: true });

    expect(panel.find((props) => props["aria-label"] === "生成摘要").children).toBe("将生成 1 张 · 已跳过 0 张 · 缺少提示词 1 张");
    await act(async () => {
        panel.find((props) => props["aria-label"] === "启用这一屏：Second").onClick();
    });

    expect(panel.find((props) => props["aria-label"] === "生成摘要").children).toBe("将生成 1 张 · 已跳过 1 张 · 缺少提示词 0 张");
    expect(panel.find((props) => props["aria-label"] === "生成第一版")).toBeDefined();
    await act(async () => {
        panel.find((props) => props["aria-label"] === "打开高级设置").onClick();
    });
    expect(panel.find((props) => props["aria-label"] === "First 提示词").value).toBe("Old prompt");

    await act(async () => {
        panel.find((props) => props["aria-label"] === "生成第一版").onClick();
    });
    expect(panel.submitted).toEqual([
        [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Old prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "", enabled: false },
        ],
    ]);
    expect(panel.saved).toEqual(panel.submitted);
});

test("simple workspace adopts usable candidate thumbnails and disables unusable candidates", async () => {
    const panel = await mountPanel("simple");
    const first: CanvasNodeData = {
        id: "candidate-a",
        type: CanvasNodeType.Image,
        title: "A",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", content: "data:image/png;base64,a", storageKey: "image:a", status: "success" },
    };
    const loading: CanvasNodeData = { ...first, id: "candidate-loading", title: "Loading", metadata: { ...first.metadata, storageKey: "image:loading", status: "loading" } };
    const failed: CanvasNodeData = { ...first, id: "candidate-error", title: "Failed", metadata: { ...first.metadata, storageKey: "image:error", status: "error" } };
    const missing: CanvasNodeData = { ...first, id: "candidate-missing", title: "Missing", metadata: { ...first.metadata, storageKey: undefined } };
    await panel.rerender({ candidatesBySlot: new Map([["first", [first, loading, failed, missing]]]) });

    const candidate = panel.find((props) => props["aria-label"] === "采用版本 1：A");
    expect(candidate).toMatchObject({ disabled: false, "aria-pressed": false });
    expect(panel.find((props) => props.node?.id === first.id && props.previewLabel === "查看大图：版本 1 · A")).toBeDefined();
    expect(panel.find((props) => props["aria-label"] === "采用版本 2：Loading").disabled).toBe(true);
    expect(panel.find((props) => props["aria-label"] === "采用版本 3：Failed").disabled).toBe(true);
    expect(panel.find((props) => props["aria-label"] === "采用版本 4：Missing").disabled).toBe(true);
    await act(async () => {
        candidate.onClick();
    });
    expect(panel.find((props) => props["aria-label"] === "采用版本 1：A")["aria-pressed"]).toBe(true);

    await act(async () => {
        panel.find((props) => props["aria-label"] === "自动采用最新成功结果：First").onClick();
    });
    expect(panel.find((props) => props["aria-label"] === "自动采用最新成功结果：First")["aria-pressed"]).toBe(true);
});

test("stale candidates remain visible but disabled and never count as generated output", async () => {
    const panel = await mountPanel("simple");
    const row = { slotId: "first", title: "First", duty: "Hero", prompt: "Ready" };
    const stale: CanvasNodeData = {
        id: "candidate-stale",
        type: CanvasNodeType.Image,
        title: "Old",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:old", status: "success", batchResultInputSignature: "old" },
    };
    const current: CanvasNodeData = { ...stale, id: "candidate-current", title: "Current", metadata: { ...stale.metadata, storageKey: "image:current", batchResultInputSignature: "current" } };
    const exportButton = () => panel.find((props) => props.title === "下载带文字排版的 PNG 与 manifest v3 清单（ZIP）");

    await panel.rerender({
        rows: [row],
        nodeBySlot: new Map(),
        candidatesBySlot: new Map([["first", [stale]]]),
        sourceSignature: () => "current",
    });

    const staleCandidate = panel.element((props) => props["aria-label"] === "采用版本 1：Old");
    expect(staleCandidate.props.disabled).toBe(true);
    expect(renderToStaticMarkup(staleCandidate)).toContain("旧方案");
    expect(exportButton().disabled).toBe(true);

    await panel.rerender({ candidatesBySlot: new Map([["first", [stale, current]]]) });

    expect(panel.find((props) => props["aria-label"] === "采用版本 1：Old").disabled).toBe(true);
    expect(panel.find((props) => props["aria-label"] === "采用版本 2：Current").disabled).toBe(false);
    expect(exportButton().disabled).toBe(false);
});

test("storyboard thumbnails resolve storage-only nodes and clear stale images when the source changes", async () => {
    const actualImageStorage = { ...(await import("../src/services/image-storage")) };
    const calls: Array<[string | undefined, string]> = [];
    mock.module("@/services/image-storage", () => ({
        ...actualImageStorage,
        resolveImageUrl: (key?: string, fallback = "") => {
            calls.push([key, fallback]);
            if (key === "resource:stored") return Promise.resolve("https://cdn.example/stored.png");
            if (key === "resource:pending") return new Promise<string>(() => {});
            return Promise.resolve(fallback);
        },
    }));
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let thumbRoot: import("react-dom/client").Root | undefined;
    try {
        const panel = await mountPanel("simple");
        const stored: CanvasNodeData = { id: "stored", type: CanvasNodeType.Image, title: "Stored", position: { x: 0, y: 0 }, metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "resource:stored", status: "success" } };
        await panel.rerender({ candidatesBySlot: new Map([["first", [stored]]]) });
        const Thumb = panel.element((props) => props.node?.id === stored.id).type as React.ComponentType<{ node: CanvasNodeData | undefined }>;
        const { Window } = await import("happy-dom");
        const browser = new Window({ url: "http://localhost/" });
        Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
        Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser.navigator });
        const { createRoot } = await import("react-dom/client");
        const container = browser.document.createElement("div");
        browser.document.body.append(container);
        thumbRoot = createRoot(container);

        await act(async () => {
            thumbRoot!.render(<Thumb node={stored} />);
            await Promise.resolve();
        });
        expect(calls).toContainEqual(["resource:stored", ""]);
        expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/stored.png");

        const pending = { ...stored, id: "pending", metadata: { ...stored.metadata, storageKey: "resource:pending" } };
        await act(async () => {
            thumbRoot!.render(<Thumb node={pending} />);
        });
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain("待生成");

        await act(async () => {
            thumbRoot!.render(<Thumb node={undefined} />);
        });
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain("未铺");
    } finally {
        if (thumbRoot) await act(async () => thumbRoot!.unmount());
        mock.module("@/services/image-storage", () => actualImageStorage);
        if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
        else Reflect.deleteProperty(globalThis, "document");
        if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
        else Reflect.deleteProperty(globalThis, "navigator");
    }
});

test("partial generation submits the latest edited rows, never the modal close callback", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Edited prompt" } });
    });
    await act(async () => {
        panel.find((p) => p.title === "按这张表批量提交出图任务").onClick();
    });
    expect(panel.confirmation()?.onOk).toBeFunction();
    await act(async () => {
        panel.confirmation()!.onOk!(() => {});
    });
    expect(panel.submitted).toEqual([
        [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Edited prompt" },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
    ]);
    expect(panel.saved).toEqual(panel.submitted);
});

test("generation flushes and submits the latest copy draft", async () => {
    const panel = await mountPanel();
    await panel.rerender({
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: { headline: "Old", subhead: "", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("bottom-bar")! },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "" },
        ],
    });
    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "生成前最后一字" } });
    });
    expect(panel.saved).toEqual([]);
    await act(async () => {
        panel.find((props) => props.title === "按这张表批量提交出图任务").onClick();
    });
    await act(async () => {
        panel.confirmation()!.onOk!();
    });
    expect(panel.saved.at(-1)?.[0]).toMatchObject({ copy: { headline: "生成前最后一字" } });
    expect(panel.submitted.at(-1)?.[0]).toMatchObject({ copy: { headline: "生成前最后一字" } });
});

test("closing the panel saves the latest local copy draft", async () => {
    const panel = await mountPanel();
    let closed = 0;
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: { headline: "Old", subhead: "", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("bottom-bar")! }],
        onClose: () => {
            closed += 1;
        },
    });
    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "关闭前最后一字" } });
    });
    expect(panel.saved).toEqual([]);
    await act(async () => {
        panel.find((p) => p.children === "关闭").onClick();
    });
    expect(closed).toBe(1);
    expect(panel.saved.at(-1)?.[0]).toMatchObject({ copy: { headline: "关闭前最后一字" } });
});

test("suite export promises composed PNG files and a manifest v3 archive", async () => {
    const panel = await mountPanel("simple");
    const exportButton = panel.find((props) => props.title === "下载带文字排版的 PNG 与 manifest v3 清单（ZIP）");

    expect(React.Children.toArray(exportButton.children)).toContain("导出排版套图");
    expect(exportButton.title).not.toContain("原图");
    expect(exportButton.title).not.toContain("manifest v2");
});

test("export cancels stale rows or selected outputs before saving the ZIP", async () => {
    const actualExport = { ...(await import("../src/services/ecommerce-suite-export")) };
    const actualFileSaver = { ...(await import("file-saver")) };
    let finishArchive: ((archive: Blob) => void) | undefined;
    let sourceGuard: (() => void) | undefined;
    let archivedRows: EcommerceSuitePanelProps["rows"] | undefined;
    const saveCalls: unknown[][] = [];
    mock.module("@/services/ecommerce-suite-export", () => ({
        ...actualExport,
        buildEcommerceSuiteArchive: (rows: EcommerceSuitePanelProps["rows"], _nodes: unknown, options?: { assertSourceCurrent?: () => void }) => {
            archivedRows = rows;
            sourceGuard = options?.assertSourceCurrent;
            return new Promise<Blob>((resolve) => {
                finishArchive = resolve;
            });
        },
    }));
    mock.module("file-saver", () => ({
        ...actualFileSaver,
        saveAs: (...args: unknown[]) => saveCalls.push(args),
    }));

    try {
        const panel = await mountPanel("simple");
        const layout = createEcommerceLayoutFromPreset("bottom-bar")!;
        const copy = { headline: "Original", subhead: "Subhead", cta: "Buy", price: "¥99" };
        const baseRows: EcommerceSuitePanelProps["rows"] = [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy, layout },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "Ready" },
        ];
        const first: CanvasNodeData = {
            id: "first-node",
            type: CanvasNodeType.Image,
            title: "First",
            position: { x: 0, y: 0 },
            metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", ecommerceRunId: "run:first", taskId: "task:first", taskStatus: "succeeded", storageKey: "image:first", status: "success", ecommerceResultTextMode: { mode: "local", sourceStorageKey: "image:first" } },
        };
        const second: CanvasNodeData = { id: "second-node", type: CanvasNodeType.Image, title: "Second", position: { x: 0, y: 0 }, metadata: { ecommerceShotId: "second", ecommerceFlowId: "detail", storageKey: "image:second", status: "success" } };
        const baseNodes = new Map([
            ["first", first],
            ["second", second],
        ]);

        await panel.rerender({ embedded: true, rows: baseRows, nodeBySlot: baseNodes });
        await openQuickDesign(panel);
        await act(async () => {
            panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "导出前最后一字" } });
        });
        expect(panel.saved).toEqual([]);
        let latestExport!: Promise<void>;
        await act(async () => {
            latestExport = panel.find((props) => props.title === "下载带文字排版的 PNG 与 manifest v3 清单（ZIP）").onClick();
            await Promise.resolve();
        });
        expect(panel.saved.at(-1)?.[0]).toMatchObject({ copy: { headline: "导出前最后一字" } });
        expect(archivedRows?.[0]).toMatchObject({ copy: { headline: "导出前最后一字" } });
        await act(async () => {
            finishArchive!(new Blob(["latest-copy"], { type: "application/zip" }));
            await latestExport;
        });
        expect(saveCalls).toHaveLength(1);
        saveCalls.length = 0;

        const scenarios = [
            { name: "slot order", rows: [...baseRows].reverse(), nodes: baseNodes },
            { name: "copy", rows: [{ ...baseRows[0], copy: { ...copy, headline: "Changed" } }, baseRows[1]], nodes: baseNodes },
            { name: "layout", rows: [{ ...baseRows[0], layout: createEcommerceLayoutFromPreset("poster")! }, baseRows[1]], nodes: baseNodes },
            { name: "resultNodeId", rows: [{ ...baseRows[0], resultNodeId: first.id }, baseRows[1]], nodes: baseNodes },
            {
                name: "selected node id",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, id: "replacement" }],
                    ["second", second],
                ]),
            },
            {
                name: "selected storageKey",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, metadata: { ...first.metadata, storageKey: "image:replacement" } }],
                    ["second", second],
                ]),
            },
            {
                name: "selected taskId",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, metadata: { ...first.metadata, taskId: "task:replacement" } }],
                    ["second", second],
                ]),
            },
            {
                name: "selected taskStatus",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, metadata: { ...first.metadata, taskStatus: "running" } }],
                    ["second", second],
                ]),
            },
            {
                name: "selected status",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, metadata: { ...first.metadata, status: "loading" } }],
                    ["second", second],
                ]),
            },
            {
                name: "selected ecommerceRunId",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, metadata: { ...first.metadata, ecommerceRunId: "run:replacement" } }],
                    ["second", second],
                ]),
            },
            {
                // 结果图的文字模式一变，之前那层字该不该叠就变了，导出必须整批作废。
                name: "result text mode",
                rows: baseRows,
                nodes: new Map([
                    ["first", { ...first, metadata: { ...first.metadata, ecommerceResultTextMode: { mode: "model" as const, sourceStorageKey: "image:first" } } }],
                    ["second", second],
                ]),
            },
        ];

        for (const scenario of scenarios) {
            await panel.rerender({ embedded: true, rows: baseRows, nodeBySlot: baseNodes });
            let exporting!: Promise<void>;
            await act(async () => {
                exporting = panel.find((props) => props.title === "下载带文字排版的 PNG 与 manifest v3 清单（ZIP）").onClick();
                await Promise.resolve();
            });
            expect(sourceGuard).toBeFunction();
            await panel.rerender({ rows: scenario.rows, nodeBySlot: scenario.nodes });
            await act(async () => {
                finishArchive!(new Blob([scenario.name], { type: "application/zip" }));
                await exporting;
            });
            expect(saveCalls, scenario.name).toHaveLength(0);
            expect(panel.messages.at(-1), scenario.name).toContain("导出内容已变化");
        }
    } finally {
        mock.module("@/services/ecommerce-suite-export", () => actualExport);
        mock.module("file-saver", () => actualFileSaver);
    }
});

test("a previous successful preview cannot enable another submission while generating", async () => {
    const panel = await mountPanel();
    await panel.rerender({ generating: true });
    expect(panel.find((p) => p["aria-label"] === "生成：First").disabled).toBe(true);
});

test("missing quick-mode plans offer a focused manual prompt editor", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "" }] });

    expect(panel.find((props) => props.className === "ecom-suite-missing-plan").children).toBeDefined();
    await act(async () => {
        panel.find((props) => props["aria-label"] === "手动填写生成方案：First").onClick();
    });

    expect(panel.find((props) => props["aria-label"] === "First 提示词").autoFocus).toBe(true);
});

test("zero-ready quick mode starts analysis instead of opening a dead-end confirmation", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "" }] });
    const batch = panel.find((props) => props.title === "按这张表批量提交出图任务");

    expect(batch["aria-label"]).toBe("生成第一版");
    expect(React.Children.toArray(batch.children)).toContain("生成第一版");
    await act(async () => batch.onClick());
    expect(panel.analyzed).toEqual([[{ slotId: "first", title: "First", duty: "Hero", prompt: "" }]]);
    expect(panel.submitted).toHaveLength(0);
});

test("quick first version waits for analysis, preserves planned rows, and submits once", async () => {
    const panel = await mountPanel("simple");
    const ready = {
        slotId: "first",
        title: "First",
        duty: "Human direction",
        prompt: "Keep this plan",
        copy: { headline: "Keep copy", subhead: "", cta: "", price: "" },
        layout: createEcommerceLayoutFromPreset("poster")!,
    };
    const missing = { slotId: "second", title: "Second", duty: "Detail", prompt: "" };
    const analyzed = [
        { ...ready, duty: "AI rewrite", prompt: "AI replacement" },
        { ...missing, prompt: "New detail plan" },
    ];
    let finishAnalysis!: (rows: EcommerceSuitePanelProps["rows"]) => void;
    let analysisCalls = 0;
    const generated: unknown[][] = [];
    await panel.rerender({
        rows: [ready, missing],
        onAnalyze: async () => {
            analysisCalls += 1;
            return await new Promise<EcommerceSuitePanelProps["rows"]>((resolve) => {
                finishAnalysis = resolve;
            });
        },
        onGenerate: (...args) => {
            generated.push(args);
            return true;
        },
    });

    const firstVersion = panel.find((props) => props.title === "按这张表批量提交出图任务");
    expect(firstVersion["aria-label"]).toBe("生成第一版");
    await act(async () => {
        firstVersion.onClick();
        firstVersion.onClick();
        await Promise.resolve();
    });
    expect(analysisCalls).toBe(1);
    expect(generated).toHaveLength(0);
    expect(panel.find((props) => props.title === "按这张表批量提交出图任务").disabled).toBe(true);

    await act(async () => {
        finishAnalysis(analyzed);
        await Promise.resolve();
        await Promise.resolve();
    });

    expect(generated).toEqual([[[ready, analyzed[1]], undefined]]);
});

test("quick first version generates only unfinished slots and stops when analysis fails", async () => {
    const panel = await mountPanel("simple");
    const rows = [
        { slotId: "first", title: "First", duty: "Hero", prompt: "Ready" },
        { slotId: "second", title: "Second", duty: "Detail", prompt: "Ready" },
    ];
    const firstResult: CanvasNodeData = {
        id: "first-result",
        type: CanvasNodeType.Image,
        title: "First result",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:first", status: "success" },
    };
    const generated: unknown[][] = [];
    await panel.rerender({
        rows,
        nodeBySlot: new Map([["first", firstResult]]),
        onGenerate: (...args) => {
            generated.push(args);
            return true;
        },
    });

    const remaining = panel.find((props) => props.title === "按这张表批量提交出图任务");
    expect(remaining["aria-label"]).toBe("生成剩余 1 张");
    await act(async () => remaining.onClick());
    expect(generated).toEqual([[rows, ["second"]]]);

    generated.length = 0;
    await panel.rerender({
        rows: [{ ...rows[0], prompt: "" }],
        nodeBySlot: new Map(),
        onAnalyze: async () => undefined,
    });
    await act(async () => panel.find((props) => props.title === "按这张表批量提交出图任务").onClick());
    expect(generated).toHaveLength(0);
});

test("active output nodes lock batch resubmission and report real progress", async () => {
    const panel = await mountPanel("simple");
    const loading: CanvasNodeData = {
        id: "loading",
        type: CanvasNodeType.Image,
        title: "Loading",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", status: "loading" },
    };
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready" }],
        nodeBySlot: new Map([["first", loading]]),
    });

    const batch = panel.find((props) => props.title === "按这张表批量提交出图任务");
    expect(batch.disabled).toBe(true);
    expect(batch["aria-busy"]).toBe(true);
    expect(React.Children.toArray(batch.children)).toContain("正在生成 0/1");
});

test("a newer loading candidate locks its slot even when an older success stays selected", async () => {
    const panel = await mountPanel("simple");
    const succeeded: CanvasNodeData = {
        id: "succeeded",
        type: CanvasNodeType.Image,
        title: "Succeeded",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:succeeded", status: "success" },
    };
    const loading: CanvasNodeData = {
        ...succeeded,
        id: "loading",
        title: "Loading",
        metadata: { ...succeeded.metadata, storageKey: undefined, status: "loading" },
    };
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready" }],
        nodeBySlot: new Map([["first", succeeded]]),
        candidatesBySlot: new Map([["first", [succeeded, loading]]]),
    });

    const single = panel.find((props) => props["aria-label"] === "生成中：First");
    const batch = panel.find((props) => props.title === "按这张表批量提交出图任务");
    expect(single.disabled).toBe(true);
    expect(single["aria-busy"]).toBe(true);
    expect(React.Children.toArray(single.children)).toContain("生成中");
    expect(batch.disabled).toBe(true);
    expect(batch["aria-busy"]).toBe(true);
    expect(React.Children.toArray(batch.children)).toContain("正在生成 0/1");
});

test("waiting batch items block resubmission and manual binding before node status changes", async () => {
    const panel = await mountPanel("simple");
    const succeeded: CanvasNodeData = {
        id: "succeeded",
        type: CanvasNodeType.Image,
        title: "Succeeded",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:succeeded", status: "success" },
    };
    const waiting: CanvasNodeData = {
        ...succeeded,
        id: "waiting",
        title: "Waiting",
        metadata: { ...succeeded.metadata, storageKey: undefined, status: "idle" },
    };
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready" }],
        nodeBySlot: new Map([["first", succeeded]]),
        candidatesBySlot: new Map([["first", [succeeded, waiting]]]),
        activeGenerationNodeIds: new Set([waiting.id]),
        autoBindAvailable: true,
        onBind: async () => {},
    });

    expect(panel.find((props) => props["aria-label"] === "生成中：First")).toMatchObject({ disabled: true, "aria-busy": true });
    expect(panel.find((props) => props.title === "按这张表批量提交出图任务")).toMatchObject({ disabled: true, "aria-busy": true });
    expect(panel.find((props) => props.title === "按当前行顺序和采用版本拼长图").disabled).toBe(true);
});

test("professional and legacy rows expose editable default copy and flow layouts", async () => {
    const panel = await mountPanel("professional");
    await panel.rerender({ rows: [{ slotId: "detail-1", title: "Hero", duty: "Hook", prompt: "Background only" }] });

    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(1);
    expect(panel.count((props) => typeof props["aria-label"] === "string" && props["aria-label"].endsWith("文案与版式") && props.type === "button")).toBe(0);
    expect(panel.find((props) => props["aria-label"] === "Hero 主标题").value).toBe("");
    expect(panel.find((props) => props["aria-label"] === "使用版式：海报居中")["aria-pressed"]).toBe(true);
    await act(async () => {
        const headline = panel.find((props) => props["aria-label"] === "Hero 主标题");
        headline.onChange({ target: { value: "新品首发" } });
    });
    expect(panel.saved).toEqual([]);
    await act(async () => {
        panel.find((props) => props["aria-label"] === "Hero 主标题").onBlur();
    });
    expect(panel.saved.at(-1)?.[0]).toMatchObject({ copy: { headline: "新品首发", subhead: "", cta: "", price: "" }, layout: { name: "海报居中" } });

    await act(async () => {
        panel.find((props) => React.Children.toArray(props.children).includes("加一屏")).onClick();
    });
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(2);
    expect(panel.find((props) => props["aria-label"] === "detail-2 主标题").value).toBe("");
});

test("quick workspace keeps copy and layout collapsed and opens only one screen at a time", async () => {
    const panel = await mountPanel("simple");

    const firstToggle = () => panel.find((props) => props["aria-label"] === "First 文案与版式");
    const secondToggle = () => panel.find((props) => props["aria-label"] === "Second 文案与版式");
    expect(firstToggle()).toMatchObject({ type: "button", "aria-expanded": false, "aria-controls": "ecom-suite-copy-first" });
    expect(secondToggle()["aria-expanded"]).toBe(false);
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(0);

    await act(async () => firstToggle().onClick());
    expect(firstToggle()["aria-expanded"]).toBe(true);
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(1);

    await act(async () => secondToggle().onClick());
    expect(firstToggle()["aria-expanded"]).toBe(false);
    expect(secondToggle()["aria-expanded"]).toBe(true);
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(1);

    await act(async () => secondToggle().onClick());
    expect(secondToggle()["aria-expanded"]).toBe(false);
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(0);
});

test("candidate results form a named group and single-screen labels follow state", async () => {
    const panel = await mountPanel("simple");
    const success: CanvasNodeData = {
        id: "success",
        type: CanvasNodeType.Image,
        title: "Success",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:success", status: "success" },
    };
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready" }], candidatesBySlot: new Map([["first", [success]]]) });
    expect(panel.find((props) => props["aria-label"] === "First 候选结果").role).toBe("group");
    expect(panel.find((props) => props["aria-label"] === "重出：First")).toBeDefined();
});

test("failed output explains the error and keeps the single-screen retry available", async () => {
    const panel = await mountPanel("simple");
    const failed: CanvasNodeData = {
        id: "failed",
        type: CanvasNodeType.Image,
        title: "Failed",
        position: { x: 0, y: 0 },
        metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", status: "error", errorDetails: "上游服务超时" },
    };
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready" }],
        nodeBySlot: new Map([["first", failed]]),
    });

    const Thumb = panel.element((props) => props.node?.id === failed.id).type as React.ComponentType<{ node: CanvasNodeData | undefined }>;
    const html = renderToStaticMarkup(<Thumb node={failed} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("生成失败");
    expect(html).toContain("上游服务超时");
    const retry = panel.find((props) => props["aria-label"] === "重试：First");
    expect(retry.disabled).toBe(false);
    expect(React.Children.toArray(retry.children)).toContain("重试");
});
test("designed rows overlay deterministic copy only on the adopted large preview", async () => {
    const panel = await mountPanel("simple");
    const layout = createEcommerceLayoutFromPreset("top-banner")!;
    const candidate: CanvasNodeData = {
        id: "designed",
        type: CanvasNodeType.Image,
        title: "Designed",
        position: { x: 0, y: 0 },
        metadata: {
            ecommerceShotId: "first",
            ecommerceFlowId: "detail",
            storageKey: "image:designed",
            status: "success",
            ecommerceResultTextMode: { mode: "local", sourceStorageKey: "image:designed" },
        },
    };
    await panel.rerender({
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "No text in pixels", copy: { headline: "新品首发", subhead: "轻盈耐用", cta: "立即抢购", price: "¥199" }, layout },
            { slotId: "second", title: "Legacy", duty: "Detail", prompt: "Legacy row" },
        ] as EcommerceSuitePanelProps["rows"],
        candidatesBySlot: new Map([["first", [candidate]]]),
    });

    const preview = panel.find((props) => props.className === "ecom-suite-story-preview");
    expect(React.Children.toArray(preview.children).some((child) => React.isValidElement<Record<string, any>>(child) && child.props.className === "ecom-suite-layout-overlay")).toBe(true);
    expect(panel.find((props) => props["data-layout-field"] === "headline").children).toBe("新品首发");
    expect(panel.count((props) => props.className === "ecom-suite-layout-overlay")).toBe(1);
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(0);
    await openQuickDesign(panel);
    expect(panel.count((props) => props.className === "ecom-suite-copy-editor")).toBe(1);

    const candidateButton = panel.find((props) => props["aria-label"] === "采用版本 1：Designed");
    expect(React.Children.toArray(candidateButton.children).some((child) => React.isValidElement<Record<string, any>>(child) && child.props.className === "ecom-suite-layout-overlay")).toBe(false);
});

test("adopted 3:4 and 4:5 images preview in their real frame and scale the layout to it", async () => {
    const panel = await mountPanel("simple");
    const layout = createEcommerceLayoutFromPreset("top-banner")!;
    const headline = layout.blocks.find((block) => block.field === "headline")!;

    for (const [id, naturalWidth, naturalHeight, expectedWidth] of [
        ["three-four", 900, 1200, 84],
        ["four-five", 1200, 1500, 89.6],
    ] as const) {
        const candidate: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: id,
            position: { x: 0, y: 0 },
            width: naturalWidth,
            height: naturalHeight,
            metadata: {
                ecommerceShotId: "first",
                ecommerceFlowId: "detail",
                storageKey: `image:${id}`,
                status: "success",
                naturalWidth,
                naturalHeight,
                ecommerceResultTextMode: { mode: "local", sourceStorageKey: `image:${id}` },
            },
        };
        await panel.rerender({
            rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Background only", copy: { headline: "Fresh collection", subhead: "", cta: "", price: "" }, layout }] as EcommerceSuitePanelProps["rows"],
            candidatesBySlot: new Map([["first", [candidate]]]),
        });

        const preview = panel.find((props) => props.className === "ecom-suite-story-preview");
        expect(preview.style.width).toBeCloseTo(expectedWidth);
        expect(preview.style.height).toBeCloseTo(112);
        const continuousPreview = panel.find((props) => props.className === "ecom-suite-detail-preview-artboard");
        expect(panel.find((props) => props["data-layout-field"] === "headline").style).toEqual(ecommerceLayoutBlockStyle(headline, continuousPreview.style));
    }
});

test("copy fields stay local while typing, commit together on blur, and carry into a layout change", async () => {
    const panel = await mountPanel("simple");
    const layout = createEcommerceLayoutFromPreset("bottom-bar")!;
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Background only", copy: { headline: "", subhead: "", cta: "", price: "" }, layout }] as EcommerceSuitePanelProps["rows"],
    });
    await openQuickDesign(panel);

    expect(ECOMMERCE_LAYOUT_PRESETS).toHaveLength(6);
    expect(panel.count((props) => typeof props["aria-label"] === "string" && props["aria-label"].startsWith("使用版式："))).toBe(ECOMMERCE_LAYOUT_PRESETS.length);
    for (const preset of ECOMMERCE_LAYOUT_PRESETS) {
        expect(panel.find((props) => props["aria-label"] === `使用版式：${preset.layout.name}`)).toBeDefined();
    }

    for (const [field, value] of [
        ["主标题", "一秒吸睛"],
        ["副文案", "真实卖点"],
        ["行动引导", "现在下单"],
        ["价格", "¥88"],
    ] as const) {
        await act(async () => {
            panel.find((props) => props["aria-label"] === `First ${field}`).onChange({ target: { value } });
        });
    }
    expect(panel.saved).toEqual([]);
    expect(panel.find((props) => props["aria-label"] === "First 主标题").value).toBe("一秒吸睛");
    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 价格").onBlur();
    });
    expect(panel.saved).toHaveLength(1);
    expect(panel.saved[0]?.[0]).toMatchObject({ copy: { headline: "一秒吸睛", subhead: "真实卖点", cta: "现在下单", price: "¥88" } });

    const poster = ECOMMERCE_LAYOUT_PRESETS.find((preset) => preset.id === "poster")!;
    await act(async () => {
        panel.find((props) => props["aria-label"] === `使用版式：${poster.layout.name}`).onClick();
    });
    expect(panel.saved.at(-1)?.[0]).toMatchObject({ copy: { headline: "一秒吸睛" }, layout: { name: "海报居中" } });
});

test("embedded copy editing debounces one metadata commit instead of persisting every keystroke", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({
        embedded: true,
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Background only", copy: { headline: "", subhead: "", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("bottom-bar")! }],
    });
    await openQuickDesign(panel);

    for (const value of ["新", "新品", "新品首发"]) {
        await act(async () => {
            panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value } });
        });
    }
    expect(panel.saved).toEqual([]);
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(panel.saved).toHaveLength(1);
    expect(panel.saved[0]?.[0]).toMatchObject({ copy: { headline: "新品首发" } });
});

test("unmount flushes the latest copy draft before the debounce expires", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({
        embedded: true,
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Background only", copy: { headline: "", subhead: "", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("bottom-bar")! }],
    });
    await openQuickDesign(panel);

    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "最后输入" } });
    });
    expect(panel.saved).toEqual([]);

    await unmount?.();
    unmount = undefined;

    expect(panel.saved).toHaveLength(1);
    expect(panel.saved[0]?.[0]).toMatchObject({ copy: { headline: "最后输入" } });
});

test("sorting flushes the latest copy draft without dropping the last character", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: { headline: "Old", subhead: "", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("bottom-bar")! },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "Ready" },
        ],
    });
    await openQuickDesign(panel);
    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "最后一字" } });
    });
    expect(panel.saved).toEqual([]);
    await act(async () => {
        panel.find((props) => props["aria-label"] === "把「First」往后挪一格").onClick();
    });
    expect(panel.saved.at(-1)?.map((row: EcommerceSuitePanelProps["rows"][number]) => row.slotId)).toEqual(["second", "first"]);
    expect(panel.saved.at(-1)?.[1]).toMatchObject({ copy: { headline: "最后一字" } });
});

test("new analysis copy and layout replace a pending local design draft without a stale commit", async () => {
    const panel = await mountPanel("simple");
    const base = { slotId: "first", title: "First", duty: "Hero", prompt: "Background only" };
    await panel.rerender({
        rows: [{ ...base, copy: { headline: "Initial", subhead: "", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("bottom-bar")! }] as EcommerceSuitePanelProps["rows"],
    });
    await openQuickDesign(panel);
    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "Local edit" } });
    });
    expect(panel.saved).toEqual([]);

    await panel.rerender({
        rows: [{ ...base, copy: { headline: "AI refresh", subhead: "New analysis", cta: "", price: "" }, layout: createEcommerceLayoutFromPreset("poster")! }] as EcommerceSuitePanelProps["rows"],
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(panel.saved).toEqual([]);
    expect(panel.find((props) => props["aria-label"] === "First 主标题").value).toBe("AI refresh");
    expect(panel.find((props) => props["aria-label"] === "使用版式：海报居中")["aria-pressed"]).toBe(true);
});
test("local result adoption immediately updates preview and binding input before closing", async () => {
    const panel = await mountPanel();
    const first: CanvasNodeData = { id: "old", type: CanvasNodeType.Image, title: "Old", position: { x: 0, y: 0 }, metadata: { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:old" } };
    const latest = { ...first, id: "latest", title: "Latest", metadata: { ...first.metadata, storageKey: "image:latest" } };
    let bound: unknown;
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "New plan" }],
        nodeBySlot: new Map([["first", latest]]),
        candidatesBySlot: new Map([["first", [first, latest]]]),
        onBind: async (rows) => {
            bound = rows;
        },
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 采用结果").onChange({ target: { value: "old" } });
    });
    expect(panel.find((p) => p.node?.id === "old").node).toBe(first);
    await act(async () => {
        await panel.find((p) => p.title === "按当前行顺序和采用版本拼长图").onClick();
    });
    expect(bound).toEqual([expect.objectContaining({ resultNodeId: "old" })]);
    expect(panel.saved).toEqual([]);
});

test("analysis receives the edited duties and latest rows", async () => {
    const panel = await mountPanel();
    let analyzed: unknown;
    await panel.rerender({
        onAnalyze: (rows) => {
            analyzed = rows;
            return undefined;
        },
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 要解决什么").onChange({ target: { value: "New direction" } });
    });
    await act(async () => {
        panel.find((p) => p.title === "分析商品图与参考图").onClick();
    });
    expect(analyzed).toEqual([expect.objectContaining({ duty: "New direction" }), expect.anything()]);
    expect(panel.saved.at(-1)).toEqual(analyzed);
});

test("new analysis rows replace the previous local draft", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Local draft" } });
    });
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "New analysis" }] });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("New analysis");
});

test("empty prompts never offer partial generation", async () => {
    const panel = await mountPanel();
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "  " }] });
    await act(async () => {
        panel.find((p) => p.title === "按这张表批量提交出图任务").onClick();
    });
    expect(panel.confirmation()).toBeDefined();
    expect(panel.confirmation()?.onOk).toBeUndefined();
    expect(panel.submitted).toEqual([]);
    expect(panel.saved).toEqual([]);
});

test("supplementary information replaces director editing and file import", async () => {
    const panel = await mountPanel();
    await act(async () => {
        panel.find((p) => p.title === "补充平台、张数和商品信息").onClick();
    });
    expect(panel.find((p) => p.label === "发布平台").choices).toContain("Amazon");
    expect(panel.find((p) => p["aria-label"] === "计划张数")).toBeDefined();
    expect(() => panel.find((p) => p["aria-label"] === "分析提示词")).toThrow();
    expect(() => panel.find((p) => p.type === "file")).toThrow();
    let latest: unknown;
    await panel.rerender({
        onBriefChange: (value) => {
            latest = value;
        },
    });
    await act(async () => {
        panel.find((p) => p.label === "发布平台").onChange("Amazon");
    });
    expect(latest).toMatchObject({ platform: "Amazon" });
    await act(async () => {
        panel.find((p) => p.label === "发布平台").onChange("我的专属店铺");
    });
    expect(latest).toMatchObject({ platform: "我的专属店铺" });
});

test("clear prompts also clears edits when upstream prompts were already empty", async () => {
    const panel = await mountPanel();
    await panel.rerender({ rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "" }] });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "First 提示词").onChange({ target: { value: "Local draft" } });
    });
    await act(async () => {
        panel.find((p) => p.title === "清空所有提示词").onClick();
    });
    await act(async () => {
        panel.confirmation()!.onOk!();
    });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("");
});

test("selecting a template preserves edits until confirmed and saves its snapshot", async () => {
    const panel = await mountPanel();
    const template = { id: "published", name: "Template", flow: "detail" as const, category: "服装", enabled: true, style: "Warm light", source: "Custom", shots: [{ title: "Hero", duty: "Show true product" }] };
    let brief: unknown;
    await panel.rerender({
        templates: [template],
        onBriefChange: (value) => {
            brief = value;
        },
    });
    await act(async () => {
        panel.find((p) => p.title === "补充平台、张数和商品信息").onClick();
    });
    await act(async () => {
        panel.find((p) => p["aria-label"] === "套图模板").onChange({ target: { value: "published" } });
    });
    expect(panel.find((p) => p["aria-label"] === "First 提示词").value).toBe("Old prompt");
    expect(brief).toBeUndefined();
    await act(async () => {
        panel.confirmation()!.onOk!();
    });
    expect(panel.find((p) => p["aria-label"] === "Hero 提示词").value).toBe("");
    expect(brief).toEqual({ template, imageCount: 1, style: "Warm light" });
});
test("analysis locks model controls until the run ends and exposes no skill controls", async () => {
    const panel = await mountPanel("professional");
    await panel.rerender({ analyzing: true });

    expect(panel.find((props) => props["aria-label"] === "分析模型设置").disabled).toBe(true);
    expect(panel.count((props) => String(props["aria-label"] || "").includes("Skills"))).toBe(0);
});

const designedCopy = { headline: "轻盈防晒", subhead: "UPF50+\n冰感速干", cta: "立即选购", price: "¥199" };

function resultNode(mode: string | undefined, sourceStorageKey = "image:result", extraMetadata: Record<string, unknown> = {}): CanvasNodeData {
    const metadata: Record<string, unknown> = { ecommerceShotId: "first", ecommerceFlowId: "detail", storageKey: "image:result", status: "success", ...extraMetadata };
    if (mode !== undefined) metadata.ecommerceResultTextMode = { mode, sourceStorageKey };
    return { id: "result", type: CanvasNodeType.Image, title: "Result", position: { x: 0, y: 0 }, metadata: metadata as CanvasNodeData["metadata"] };
}

test("both previews overlay copy only for local results, and one overlay per preview", async () => {
    for (const [mode, expectedOverlays] of [
        ["local", 2],
        ["model", 0],
        ["unknown", 0],
        [undefined, 0],
    ] as [string | undefined, number][]) {
        const panel = await mountPanel("simple");
        await panel.rerender({
            rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: designedCopy, layout: createEcommerceLayoutFromPreset("top-banner")! }] as EcommerceSuitePanelProps["rows"],
            nodeBySlot: new Map([["first", resultNode(mode)]]),
            candidatesBySlot: new Map([["first", [resultNode(mode)]]]),
        });
        const overlays = panel.count((props) => String(props.className || "").includes("ecom-suite-layout-overlay"));
        expect({ mode, overlays }).toEqual({ mode, overlays: expectedOverlays });
    }
});

test("rows without a saved layout or copy never paint preview text the export would drop", async () => {
    const panel = await mountPanel("simple");
    await panel.rerender({
        rows: [
            { slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: designedCopy },
            { slotId: "second", title: "Second", duty: "Detail", prompt: "Ready", layout: createEcommerceLayoutFromPreset("top-banner")! },
        ] as EcommerceSuitePanelProps["rows"],
        nodeBySlot: new Map([["first", resultNode("local")], ["second", resultNode("local")]]),
        candidatesBySlot: new Map([["first", [resultNode("local")]], ["second", [resultNode("local")]]]),
    });
    expect(panel.count((props) => String(props.className || "").includes("ecom-suite-layout-overlay"))).toBe(0);
});
test("editing the subhead keeps newlines and the next generation reads the latest text without a blur", async () => {
    const panel = await mountPanel("simple");
    const generated: unknown[] = [];
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: designedCopy, layout: createEcommerceLayoutFromPreset("bottom-bar")! }] as EcommerceSuitePanelProps["rows"],
        nodeBySlot: new Map([["first", resultNode("model")]]),
        onGenerateOne: (_slotId, rows) => {
            generated.push(rows);
        },
    });
    await openQuickDesign(panel);

    const subhead = panel.find((props) => props["aria-label"] === "First 副文案");
    expect(panel.element((props) => props["aria-label"] === "First 副文案").type).toBe("textarea");
    expect(subhead.value).toBe("UPF50+\n冰感速干");

    await act(async () => {
        subhead.onChange({ target: { value: "UPF50+\n冰感速干\n轻若无物" } });
    });
    await act(async () => {
        panel.find((props) => props["aria-label"] === "重出：First").onClick();
    });
    expect(generated.at(-1)?.[0]).toMatchObject({ copy: { subhead: "UPF50+\n冰感速干\n轻若无物" } });
});

test("model results flag stale copy and layout instead of painting new text over old pixels", async () => {
    const layout = createEcommerceLayoutFromPreset("bottom-bar")!;
    const panel = await mountPanel("simple");
    const unchanged = resultNode("model", "image:result", { ecommerceCopy: designedCopy, ecommerceLayout: layout });
    await panel.rerender({
        rows: [{ slotId: "first", title: "First", duty: "Hero", prompt: "Ready", copy: designedCopy, layout }] as EcommerceSuitePanelProps["rows"],
        nodeBySlot: new Map([["first", unchanged]]),
    });
    expect(panel.count((props) => props["data-copy-stale"] === "true")).toBe(0);

    await openQuickDesign(panel);
    await act(async () => {
        panel.find((props) => props["aria-label"] === "First 主标题").onChange({ target: { value: "换了标题" } });
    });
    expect(panel.count((props) => props["data-copy-stale"] === "true")).toBe(1);
    expect(panel.count((props) => props.className === "ecom-suite-layout-overlay")).toBe(0);
});
