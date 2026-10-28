import { expect, test } from "bun:test";
import type { Root } from "react-dom/client";
import type { CanvasNodeActionContextValue } from "../src/components/canvas/canvas-node-action-context";

import {
    ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE,
    createEcommerceTeardown,
    ecommerceTeardownPlanSourceSignature,
    parseEcommerceTeardownPlanRequest,
} from "../src/lib/ecommerce/ecommerce-teardown";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../src/types/canvas";

const plan = JSON.stringify({
    findings: [
        { dimension: "structure", finding: "六屏，由痛点进入证据。" },
        { dimension: "evidence", finding: "第三屏用实测数据支撑。" },
    ],
    outline: [{ title: "痛点开场", brief: "让目标用户认出问题。", stance: "follow" }],
});

const source: CanvasNodeData = {
    id: "reference-image",
    type: CanvasNodeType.Image,
    title: "竞品详情页",
    position: { x: 0, y: 0 },
    metadata: { content: "/reference.png" },
};

function product(facts = "净重 210g"): CanvasNodeData {
    return {
        id: "confirmed-product",
        type: CanvasNodeType.Product,
        title: "轻量保温杯",
        position: { x: 0, y: 0 },
        metadata: {
            productProfile: {
                name: "轻量保温杯",
                category: "保温杯",
                appearance: "雾白色杯身",
                marks: "YINGCE 标识",
                forbidden: "不得改变杯盖结构",
                audience: "通勤人群",
                facts,
                price: "99 元",
                views: {},
            },
        },
    };
}

function target(dimensions: ReturnType<typeof createEcommerceTeardown>["dimensions"] = ["structure", "evidence"]): CanvasNodeData {
    return {
        id: "teardown-target",
        type: CanvasNodeType.Teardown,
        title: "竞品详情页拆解",
        position: { x: 0, y: 0 },
        metadata: {
            ecommerceTeardown: {
                ...createEcommerceTeardown("竞品详情页拆解"),
                dimensions,
                findings: [{ id: "manual-finding", dimension: "trust", finding: "保留我的人工结论" }],
                outline: [{ id: "manual-row", title: "人工大纲", brief: "暂不覆盖", stance: "differentiate" }],
            },
        },
    };
}

function productSignature(item: CanvasNodeData | undefined) {
    return ecommerceTeardownPlanSourceSignature({ target: target(), referenceImage: source, product: item });
}

function resultNode(content: string, signature: string, item = product(), id = "teardown-plan-result"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: ECOMMERCE_TEARDOWN_PLAN_RESULT_TITLE,
        position: { x: 0, y: 0 },
        metadata: {
            status: "success",
            content,
            ecommerceTeardownPlanSource: {
                targetNodeId: "teardown-target",
                referenceImageId: source.id,
                productNodeId: item.id,
                signature,
            },
        } as CanvasNodeMetadata,
    };
}

type MountedTeardown = {
    host: HTMLElement;
    root: Root;
    render: (node: CanvasNodeData, inputs: CanvasNodeData[], actions: CanvasNodeActionContextValue) => Promise<void>;
    dispose: () => Promise<void>;
};

async function mountTeardown(node: CanvasNodeData, inputs: CanvasNodeData[], actions: CanvasNodeActionContextValue): Promise<MountedTeardown> {
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
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { CanvasNodeActionContext } = await import("../src/components/canvas/canvas-node-action-context");
    const { CanvasNodeGraphContext } = await import("../src/components/canvas/canvas-node-graph-context");
    const { TeardownNodeContent } = await import("../src/components/canvas/nodes/teardown-node");
    const { canvasThemes } = await import("../src/lib/canvas-theme");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = async (currentNode: CanvasNodeData, currentInputs: CanvasNodeData[], currentActions: CanvasNodeActionContextValue) =>
        act(async () =>
            root.render(
                <CanvasNodeActionContext.Provider value={currentActions}>
                    <CanvasNodeGraphContext.Provider value={{ getInputNodes: () => currentInputs }}>
                        <TeardownNodeContent node={currentNode} theme={canvasThemes.dark} />
                    </CanvasNodeGraphContext.Provider>
                </CanvasNodeActionContext.Provider>,
            ),
        );
    await render(node, inputs, actions);
    return {
        host,
        root,
        render,
        dispose: async () => {
            await act(async () => root.unmount());
            host.remove();
            dom.happyDOM.abort();
            for (const [key, value] of originals) {
                if (value) Object.defineProperty(globalThis, key, value);
                else Reflect.deleteProperty(globalThis, key);
            }
        },
    };
}

function button(host: HTMLElement, label: string) {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(label));
}

test("zero teardown dimensions block model requests with a visible reason", async () => {
    const fixture = await mountTeardown(target([]), [source, product()], { reversePromptFromNode() {} });
    try {
        const request = button(fixture.host, "拆解这张竞品图");
        expect(request?.disabled).toBe(true);
        expect(request?.title).toContain("至少选择一个拆解维度");
    } finally {
        await fixture.dispose();
    }
});

test("valid structured output loads as a draft and only replaces formal content after confirmation", async () => {
    const item = product();
    const node = target();
    const updates: Array<{ nodeId: string; patch: CanvasNodeMetadata }> = [];
    const requests: string[] = [];
    const result = resultNode(plan, productSignature(item), item);
    const fixture = await mountTeardown(node, [source, item, result], {
        updateMetadata(nodeId, patch) {
            updates.push({ nodeId, patch });
        },
        reversePromptFromNode(_source, prompt) {
            requests.push(prompt);
        },
    });
    const { act } = await import("react");
    try {
        await act(async () => button(fixture.host, "拆解这张竞品图")!.click());
        const request = parseEcommerceTeardownPlanRequest(requests[0]);
        expect(request?.targetNodeId).toBe(node.id);
        expect(request?.prompt).toContain("页面结构");
        expect(request?.prompt).not.toContain("配色体系");

        await act(async () => button(fixture.host, "载入最新拆解")!.click());
        expect(updates).toHaveLength(0);
        expect(fixture.host.textContent).toContain("保留我的人工结论");
        expect(fixture.host.textContent).toContain("已载入草稿：2 条结论 / 1 屏");

        const apply = button(fixture.host, "确认应用");
        expect(apply?.disabled).toBe(false);
        await act(async () => apply!.click());
        const applied = updates.at(-1)?.patch.ecommerceTeardown;
        expect(applied?.findings.map((finding) => finding.finding)).toEqual(["六屏，由痛点进入证据。", "第三屏用实测数据支撑。"]);
        expect(applied?.outline.map((row) => row.title)).toEqual(["痛点开场"]);
    } finally {
        await fixture.dispose();
    }
});

test("a loaded draft becomes stale when the parsed result content or result node changes", async () => {
    const item = product();
    const node = target();
    const actions: CanvasNodeActionContextValue = { updateMetadata() {} };
    const signature = productSignature(item);
    const changedPlan = plan.replace("痛点开场", "证据开场");
    const fixture = await mountTeardown(node, [source, item, resultNode(plan, signature, item)], actions);
    const { act } = await import("react");
    try {
        await act(async () => button(fixture.host, "载入最新拆解")!.click());
        await fixture.render(node, [source, item, resultNode(changedPlan, signature, item)], actions);
        expect(fixture.host.textContent).toContain("方案已过期");
        expect(button(fixture.host, "确认应用")?.disabled).toBe(true);

        await act(async () => button(fixture.host, "载入最新拆解")!.click());
        expect(button(fixture.host, "确认应用")?.disabled).toBe(false);
        await fixture.render(node, [source, item, resultNode(changedPlan, signature, item, "replacement-result")], actions);
        expect(fixture.host.textContent).toContain("方案已过期");
        expect(button(fixture.host, "确认应用")?.disabled).toBe(true);
    } finally {
        await fixture.dispose();
    }
});
test("confirmed outline is converted into detail table rows", async () => {
    const item = product();
    const node = target();
    const opened: Array<{ teardownNode: CanvasNodeData; productNode: CanvasNodeData; rows: unknown[] }> = [];
    const fixture = await mountTeardown(node, [source, item], {
        openEcommerceTableFromOutline(teardownNode, productNode, rows) {
            opened.push({ teardownNode, productNode, rows });
        },
    });
    const { act } = await import("react");
    try {
        const openTable = button(fixture.host, "写入详情页创作表");
        expect(openTable?.disabled).toBe(false);
        await act(async () => openTable!.click());
        expect(opened).toEqual([
            {
                teardownNode: node,
                productNode: item,
                rows: [
                    {
                        slotId: "detail-1",
                        enabled: true,
                        title: "人工大纲",
                        duty: "差异化处理，不照搬竞品结构：暂不覆盖",
                        prompt: "",
                        stance: "differentiate",
                    },
                ],
            },
        ]);
    } finally {
        await fixture.dispose();
    }
});

test("invalid or stale output cannot enter the draft", async () => {
    const item = product();
    const invalid = await mountTeardown(target(), [source, item, resultNode("not json", productSignature(item), item)], { updateMetadata() {} });
    try {
        expect(invalid.host.textContent).toContain("拆解结果不是完整方案");
        expect(button(invalid.host, "载入最新拆解")?.disabled).toBe(true);
        expect(button(invalid.host, "确认应用")?.disabled).toBe(true);
    } finally {
        await invalid.dispose();
    }

    const changedProduct = product("净重 999g");
    const stale = await mountTeardown(target(), [source, changedProduct, resultNode(plan, productSignature(item), item)], { updateMetadata() {} });
    try {
        expect(stale.host.textContent).toContain("方案已过期");
        expect(button(stale.host, "载入最新拆解")?.disabled).toBe(true);
        expect(button(stale.host, "确认应用")?.disabled).toBe(true);
    } finally {
        await stale.dispose();
    }
});
