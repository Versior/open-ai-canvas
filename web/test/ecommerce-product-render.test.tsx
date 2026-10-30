import { expect, test } from "bun:test";
import { act, useState } from "react";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ProductNodeContent } from "../src/components/canvas/nodes/product-node";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { canvasThemes } from "../src/lib/canvas-theme";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import { createEcommerceProductProfile } from "../src/lib/ecommerce/ecommerce-contract";
import { useEcommerceSettings } from "../src/stores/use-ecommerce-settings";
import { useEcommerceModelLibrary } from "../src/stores/use-ecommerce-model-library";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("quick product card presents a three-step guide while keeping advanced inputs folded", () => {
    const product: CanvasNodeData = {
        id: "product",
        type: CanvasNodeType.Product,
        title: "测试商品",
        position: { x: 0, y: 0 },
        width: 460,
        height: 660,
        metadata: { ecommerceOneClick: { flow: "detail", slotIds: [], nodeIds: [], status: "failed", error: "装订错误" } },
    };
    const empty: CanvasNodeData = { ...product, id: "empty", type: CanvasNodeType.Image, title: "空正面" };
    const reference: CanvasNodeData = { ...empty, id: "reference", metadata: { content: "/reference.png" } };
    const edges = [
        { id: "front", fromNodeId: empty.id, toNodeId: product.id, toHandleId: "product-view:front" },
        { id: "ref", fromNodeId: reference.id, toNodeId: product.id, toHandleId: "visual-reference:3" },
    ];
    const html = renderToStaticMarkup(
        <MemoryRouter>
            <App>
                <CanvasNodeActionContext.Provider value={{ updateMetadata: () => {} }}>
                    <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => [empty, reference], getConnections: () => edges }}>
                        <ProductNodeContent node={product} theme={canvasThemes.dark} />
                    </CanvasNodeGraphContext.Provider>
                </CanvasNodeActionContext.Provider>
            </App>
        </MemoryRouter>,
    );
    for (const name of ["正面", "侧面", "背面", "细节", "包装"]) expect(html).toContain('aria-label="连接到' + name + '"');
    expect(html).toContain('aria-label="替换正面"');
    expect(html).toContain('aria-label="查看参考 1"');
    expect(html).toContain('data-ecommerce-input="visual-reference:3"');
    expect(html).toContain('data-ecommerce-input="visual-reference:0"');
    for (const step of ["商品素材", "确认商品", "选择用途"]) expect(html).toContain(step);
    expect(html).toContain("选择用途并进入创作表，完成生成与交付");
    expect(html).not.toContain("<h4>生成交付</h4>");
    expect(html).toMatch(/<div class="ecom-card ecom-product-card"[^>]*data-canvas-no-zoom="true"[^>]*data-canvas-wheel-scroll="true"/);
    expect(html).toContain('aria-label="AI 识别商品信息"');
    expect(html).toContain("生成待核对草稿");
    expect(html).toContain("<details");
    expect(html).toContain("补充素材与模特");
    for (const flow of ECOMMERCE_ONE_CLICK_FLOWS) {
        expect(html).toContain(flow.name.replace(/^一键/, ""));
        expect(html).toContain(flow.hint);
    }
    expect(html).not.toContain("电商生图台");
    expect(html).toContain("自动装订失败：装订错误");
    expect(html).toContain("重试装订（不重新生图）");
    expect(html).toContain("取消自动装订");
    for (const removed of ["整组统一", "按行业套路铺底", "SKU", "商品档案", "材质"]) expect(html).not.toContain(removed);
});
test("professional product card keeps the generation delivery step and studio entry", () => {
    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "测试商品", position: { x: 0, y: 0 } };
    const html = renderToStaticMarkup(
        <MemoryRouter>
            <App>
                <CanvasNodeActionContext.Provider value={{ updateMetadata() {}, openEcommerceTable() {}, openEcommerceStudio() {} }}>
                    <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => [], getConnections: () => [] }}>
                        <ProductNodeContent node={product} theme={canvasThemes.dark} />
                    </CanvasNodeGraphContext.Provider>
                </CanvasNodeActionContext.Provider>
            </App>
        </MemoryRouter>,
    );
    expect(html).toContain("<h4>生成交付</h4>");
    expect(html).toContain("电商生图台");
});
test("product input pin supports keyboard activation without duplicating pointer activation", async () => {
    const { Window } = await import("happy-dom");
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
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const originalHydrate = useEcommerceModelLibrary.getState().hydrate;
    useEcommerceModelLibrary.setState({ hydrate: async () => {} });
    const { createRoot } = await import("react-dom/client");
    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "Test product", position: { x: 0, y: 0 } };
    const added: string[] = [];
    const connected: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <MemoryRouter>
                    <App>
                        <CanvasNodeActionContext.Provider
                            value={{ updateMetadata() {}, addEcommerceInput: (node, handle) => added.push(`${node.id}:${handle}`), connectEcommerceInput: (event, nodeId, handle) => connected.push(`${event.type}:${nodeId}:${handle}`) }}
                        >
                            <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => [], getConnections: () => [] }}>
                                <ProductNodeContent node={product} theme={canvasThemes.dark} />
                            </CanvasNodeGraphContext.Provider>
                        </CanvasNodeActionContext.Provider>
                    </App>
                </MemoryRouter>,
            ),
        );
        const pin = host.querySelector<HTMLButtonElement>('[aria-label="\u8fde\u63a5\u5230\u6b63\u9762"]');
        expect(pin).not.toBeNull();

        await act(async () => pin!.click());
        expect(connected).toEqual(["click:product:product-view:front"]);
        expect(added).toEqual([]);

        await act(async () => {
            pin!.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
            pin!.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, detail: 1 }));
        });
        expect(connected).toEqual(["click:product:product-view:front", "pointerdown:product:product-view:front"]);
        expect(added).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        useEcommerceModelLibrary.setState({ hydrate: originalHydrate });
        host.remove();
        dom.happyDOM.abort();
        for (const [key, value] of originals) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
test("coarse pointers keep core product actions at least 44px", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/nodes/canvas-ecommerce-node-card.css", import.meta.url)).text();
    const coarsePointerRules = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarsePointerRules).toMatch(/\.ecom-product-card \.ecom-action,\s*\.ecom-product-identify \{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/);
});

test("confirmed product profile opens as an editable draft without rerunning AI", async () => {
    const { Window } = await import("happy-dom");
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
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const originalHydrate = useEcommerceModelLibrary.getState().hydrate;
    useEcommerceModelLibrary.setState({ hydrate: async () => {} });
    const { createRoot } = await import("react-dom/client");
    const profile = {
        name: "测试商品",
        category: "保温杯",
        appearance: "哑光黑色杯身",
        marks: "杯身中部 THERMO",
        forbidden: "不要改变杯盖结构",
        audience: "通勤携带",
        facts: "杯盖顶部有提手",
        price: "129",
        views: {},
    };
    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "测试商品", position: { x: 0, y: 0 }, metadata: { productProfile: profile } };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let aiCalls = 0;
    try {
        await act(async () =>
            root.render(
                <MemoryRouter>
                    <App>
                        <CanvasNodeActionContext.Provider
                            value={{
                                updateMetadata() {},
                                draftEcommerceProfile: async () => {
                                    aiCalls += 1;
                                },
                            }}
                        >
                            <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => [], getConnections: () => [] }}>
                                <ProductNodeContent node={product} theme={canvasThemes.dark} />
                            </CanvasNodeGraphContext.Provider>
                        </CanvasNodeActionContext.Provider>
                    </App>
                </MemoryRouter>,
            ),
        );
        const edit = host.querySelector<HTMLButtonElement>('[aria-label="编辑商品信息"]');
        expect(edit).not.toBeNull();
        await act(async () => edit!.click());
        for (const [label, value] of [
            ["草稿产品名称", "测试商品"],
            ["草稿英文品牌名", ""],
            ["草稿中文品牌名", ""],
            ["草稿 LOGO 文字", ""],
            ["草稿品牌风格", ""],
            ["草稿品类", "保温杯"],
            ["草稿产品型号", ""],
            ["草稿外观", "哑光黑色杯身"],
            ["草稿主要功能", ""],
            ["草稿标识", "杯身中部 THERMO"],
            ["草稿禁止项", "不要改变杯盖结构"],
            ["草稿目标人群与场景", "通勤携带"],
            ["草稿参数与来源", ""],
            ["草稿五类卖点", ""],
            ["草稿使用痛点", ""],
            ["草稿购买理由", ""],
            ["草稿卖点与依据", "杯盖顶部有提手"],
            ["草稿逐屏建议", ""],
            ["草稿真实价格", "129"],
        ]) {
            expect(host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)?.value).toBe(value);
        }
        expect(aiCalls).toBe(0);
    } finally {
        await act(async () => root.unmount());
        useEcommerceModelLibrary.setState({ hydrate: originalHydrate });
        host.remove();
        dom.happyDOM.abort();
        for (const [key, value] of originals) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
test("product card explains admin-disabled purposes inside each disabled button", () => {
    const setting = useEcommerceSettings.getInitialState().setting;
    const originalEnabled = setting.enabled;
    const originalDetailEnabled = setting.flows.detail.enabled;
    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "测试商品", position: { x: 0, y: 0 }, width: 460, height: 660 };
    const render = () =>
        renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <CanvasNodeActionContext.Provider value={{ updateMetadata() {}, openEcommerceTable() {} }}>
                        <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => [], getConnections: () => [] }}>
                            <ProductNodeContent node={product} theme={canvasThemes.dark} />
                        </CanvasNodeGraphContext.Provider>
                    </CanvasNodeActionContext.Provider>
                </App>
            </MemoryRouter>,
        );
    try {
        setting.flows.detail.enabled = false;
        const oneFlowButtons = render().match(/<button[^>]*class="ecom-oneclick"[^>]*>[\s\S]*?<\/button>/g) || [];
        const detailButton = oneFlowButtons.find((button) => button.includes("详情页"));
        expect(detailButton).toContain('disabled=""');
        expect(detailButton).toContain("管理员已停用此用途");
        expect(oneFlowButtons.find((button) => button.includes("主图"))).toContain(ECOMMERCE_ONE_CLICK_FLOWS.find((flow) => flow.id === "main")!.hint);

        setting.flows.detail.enabled = true;
        setting.enabled = false;
        const globallyDisabledButtons = render().match(/<button[^>]*class="ecom-oneclick"[^>]*>[\s\S]*?<\/button>/g) || [];
        expect(globallyDisabledButtons).toHaveLength(ECOMMERCE_ONE_CLICK_FLOWS.length);
        for (const button of globallyDisabledButtons) {
            expect(button).toContain('disabled=""');
            expect(button).toContain("管理员已停用此用途");
        }
    } finally {
        setting.enabled = originalEnabled;
        setting.flows.detail.enabled = originalDetailEnabled;
    }
});

test("product rerenders reuse the product evidence signature until graph evidence changes", () => {
    const firstContent = "data:image/png;base64,signature-first";
    const secondContent = "data:image/png;base64,signature-second";
    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "测试商品", position: { x: 0, y: 0 } };
    const image: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "正面", position: { x: 0, y: 0 }, metadata: { content: firstContent } };
    const firstInputs = [image];
    const secondInputs = [{ ...image, metadata: { content: secondContent } }];
    const connections = [{ id: "front", fromNodeId: image.id, toNodeId: product.id, toHandleId: "product-view:front" }];
    let inputs = firstInputs;
    const originalStringify = JSON.stringify;
    let signatureCalls = 0;
    const signatures: string[] = [];
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
        const result = Reflect.apply(originalStringify, JSON, [value, ...args]);
        if (Array.isArray(value) && value.some((entry) => Array.isArray(entry) && entry[0] === image.id && String(entry[4]).startsWith("inline:"))) {
            signatureCalls += 1;
            signatures.push(result as string);
        }
        return result;
    }) as typeof JSON.stringify;
    function Probe() {
        const [phase, setPhase] = useState(0);
        inputs = phase < 2 ? firstInputs : secondInputs;
        ProductNodeContent({ node: product, theme: canvasThemes.dark });
        if (phase < 2) setPhase(phase + 1);
        return null;
    }
    try {
        renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <CanvasNodeActionContext.Provider value={{ updateMetadata() {} }}>
                        <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => inputs, getConnections: () => connections }}>
                            <Probe />
                        </CanvasNodeGraphContext.Provider>
                    </CanvasNodeActionContext.Provider>
                </App>
            </MemoryRouter>,
        );
        expect(signatureCalls).toBe(2);
        expect(new Set(signatures).size).toBe(2);
    } finally {
        JSON.stringify = originalStringify;
    }
});
test("product image identity does not concatenate full image content", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/nodes/product-node.tsx", import.meta.url)).text();
    expect(source).toContain("useMemo(() => [storageKey, content] as const, [storageKey, content])");
    expect(source).not.toContain('`${image?.id || ""}:${storageKey || ""}:${content}`');
});
test("product input anchors batch measurements and preserve last valid coordinates while pins are hidden", async () => {
    const { Window } = await import("happy-dom");
    const dom = new Window({ url: "http://localhost/" });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const frames = new Map<number, FrameRequestCallback>();
    const observers: AnchorResizeObserver[] = [];
    const zeroSizedPins = new Set<Element>();
    let frameId = 0;
    let pinOffset = 0;

    class AnchorResizeObserver {
        readonly targets = new Set<Element>();
        disconnected = false;
        constructor(readonly callback: ResizeObserverCallback) {
            observers.push(this);
        }
        observe(target: Element) {
            this.targets.add(target);
        }
        unobserve(target: Element) {
            this.targets.delete(target);
        }
        disconnect() {
            this.disconnected = true;
            this.targets.clear();
        }
    }

    const globals = {
        window: dom,
        document: dom.document,
        navigator: dom.navigator,
        HTMLElement: dom.HTMLElement,
        HTMLButtonElement: dom.HTMLButtonElement,
        Element: dom.Element,
        Node: dom.Node,
        SVGElement: dom.SVGElement,
        ShadowRoot: dom.ShadowRoot,
        MutationObserver: dom.MutationObserver,
        ResizeObserver: AnchorResizeObserver,
        Event: dom.Event,
        getComputedStyle: dom.getComputedStyle.bind(dom),
        IS_REACT_ACT_ENVIRONMENT: true,
        requestAnimationFrame: (callback: FrameRequestCallback) => {
            const id = ++frameId;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame: (id: number) => frames.delete(id),
    };
    for (const [key, value] of Object.entries(globals)) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }

    const rectDescriptor = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "getBoundingClientRect");
    Object.defineProperty(dom.HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value(this: HTMLElement) {
            if (this.matches("[data-node-id]")) return new dom.DOMRect(200, 100, 400, 800);
            if (this.matches(".ecom-input-pin")) {
                if (zeroSizedPins.has(this)) return new dom.DOMRect();
                const pins = Array.from(document.querySelectorAll(".ecom-input-pin"));
                return new dom.DOMRect(550, 150 + pins.indexOf(this) * 40 + pinOffset, 20, 20);
            }
            return new dom.DOMRect();
        },
    });

    const wrapper = document.createElement("div");
    wrapper.dataset.nodeId = "product";
    const host = document.createElement("div");
    wrapper.append(host);
    document.body.append(wrapper);
    const scrollListeners: EventListenerOrEventListenerObject[] = [];
    const removedScrollListeners: EventListenerOrEventListenerObject[] = [];
    const nativeAddEventListener = wrapper.addEventListener.bind(wrapper);
    const nativeRemoveEventListener = wrapper.removeEventListener.bind(wrapper);
    wrapper.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === "scroll" && options === true) scrollListeners.push(listener);
        nativeAddEventListener(type, listener, options);
    }) as typeof wrapper.addEventListener;
    wrapper.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        if (type === "scroll" && options === true) removedScrollListeners.push(listener);
        nativeRemoveEventListener(type, listener, options);
    }) as typeof wrapper.removeEventListener;

    const product: CanvasNodeData = { id: "product", type: CanvasNodeType.Product, title: "Product", position: { x: 0, y: 0 } };
    const anchors: Array<[string, number, number]> = [];
    let inputs: CanvasNodeData[] = [];
    let connections: Array<{ id: string; fromNodeId: string; toNodeId: string; toHandleId: string }> = [];
    const originalHydrate = useEcommerceModelLibrary.getState().hydrate;
    useEcommerceModelLibrary.setState({ hydrate: async () => {} });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(host);
    const actions = {
        updateMetadata() {},
        updateEcommerceInputAnchor(_nodeId: string, handle: string, y: number, x: number) {
            anchors.push([handle, y, x]);
        },
    };
    const render = () =>
        root.render(
            <MemoryRouter>
                <App>
                    <CanvasNodeActionContext.Provider value={actions}>
                        <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => inputs, getConnections: () => connections }}>
                            <ProductNodeContent node={product} theme={canvasThemes.dark} />
                        </CanvasNodeGraphContext.Provider>
                    </CanvasNodeActionContext.Provider>
                </App>
            </MemoryRouter>,
        );
    const flushFrames = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(0));
    };
    const notifyResize = () => observers.filter((observer) => !observer.disconnected).forEach((observer) => observer.callback([], observer as unknown as ResizeObserver));

    try {
        await act(async () => render());
        const slots = [...host.querySelectorAll<HTMLElement>("[data-ecommerce-input]")];
        const pins = [...host.querySelectorAll<HTMLElement>(".ecom-input-pin")];
        expect(slots.length).toBeGreaterThan(1);
        expect(observers).toHaveLength(1);
        expect(scrollListeners).toHaveLength(1);
        expect(observers[0].targets).toEqual(new Set<Element>([wrapper, ...slots, ...pins]));
        expect(frames).toHaveLength(1);
        flushFrames();
        expect(anchors.map(([handle]) => handle)).toEqual(slots.map((slot) => slot.dataset.ecommerceInput));

        notifyResize();
        notifyResize();
        expect(frames).toHaveLength(1);
        flushFrames();
        expect(anchors).toHaveLength(slots.length);

        const invisiblePin = pins[0];
        const zeroSizedPin = pins[1];
        const invisibleHandle = invisiblePin.closest<HTMLElement>("[data-ecommerce-input]")!.dataset.ecommerceInput!;
        const zeroSizedHandle = zeroSizedPin.closest<HTMLElement>("[data-ecommerce-input]")!.dataset.ecommerceInput!;
        const updatesFor = (handle: string) => anchors.filter(([updatedHandle]) => updatedHandle === handle);
        invisiblePin.style.visibility = "hidden";
        zeroSizedPins.add(zeroSizedPin);
        pinOffset = 10;
        notifyResize();
        flushFrames();
        expect(updatesFor(invisibleHandle)).toHaveLength(1);
        expect(updatesFor(zeroSizedHandle)).toHaveLength(1);

        invisiblePin.style.visibility = "";
        zeroSizedPins.delete(zeroSizedPin);
        pinOffset = 0;
        notifyResize();
        flushFrames();
        expect(updatesFor(invisibleHandle)).toHaveLength(1);
        expect(updatesFor(zeroSizedHandle)).toHaveLength(1);

        anchors.length = 0;
        pinOffset = 10;
        const nestedScroll = scrollListeners[0];
        if (typeof nestedScroll === "function") nestedScroll(new dom.Event("scroll"));
        else nestedScroll.handleEvent(new dom.Event("scroll"));
        expect(frames).toHaveLength(1);
        flushFrames();
        expect(anchors).toHaveLength(slots.length);

        inputs = [{ id: "reference", type: CanvasNodeType.Image, title: "Reference", position: { x: 0, y: 0 }, metadata: { content: "/reference.png" } }];
        connections = [{ id: "reference-edge", fromNodeId: "reference", toNodeId: product.id, toHandleId: "visual-reference:3" }];
        await act(async () => render());
        const updatedSlots = [...host.querySelectorAll<HTMLElement>("[data-ecommerce-input]")];
        expect(updatedSlots).toHaveLength(slots.length + 1);
        expect(observers).toHaveLength(2);
        expect(observers[0].disconnected).toBe(true);
        expect(removedScrollListeners).toHaveLength(1);
        expect(scrollListeners).toHaveLength(2);
        expect(observers[1].targets.size).toBe(1 + updatedSlots.length * 2);

        inputs = [{ id: "replacement", type: CanvasNodeType.Image, title: "Replacement", position: { x: 0, y: 0 }, metadata: { content: "/replacement.png" } }];
        connections = [{ id: "replacement-edge", fromNodeId: "replacement", toNodeId: product.id, toHandleId: "visual-reference:3" }];
        await act(async () => render());
        const replacementSlot = host.querySelector<HTMLElement>('[data-ecommerce-input="visual-reference:3"]')!;
        expect(observers).toHaveLength(3);
        expect(observers[1].disconnected).toBe(true);
        expect(observers[2].targets.has(replacementSlot)).toBe(true);
    } finally {
        await act(async () => root.unmount());
        useEcommerceModelLibrary.setState({ hydrate: originalHydrate });
        wrapper.remove();
        dom.happyDOM.abort();
        if (rectDescriptor) Object.defineProperty(dom.HTMLElement.prototype, "getBoundingClientRect", rectDescriptor);
        else Reflect.deleteProperty(dom.HTMLElement.prototype, "getBoundingClientRect");
        for (const [key, value] of originals) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
