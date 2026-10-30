import { afterEach, expect, test } from "bun:test";
import React, { act, useMemo, useRef, useState } from "react";
import { reconciler } from "@react-three/fiber";
import { App } from "antd";

import { createCanvasBatchInputSnapshot } from "@/lib/canvas/canvas-batch-input-snapshot";
import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR, ECOMMERCE_MISSING_DETAIL_ROW_ERROR } from "@/lib/ecommerce/ecommerce-canvas";
import { useCanvasGenerationExecutor } from "@/pages/canvas/use-canvas-generation-executor";
import { apiClient } from "@/services/api/request";
import { setActiveUserScope } from "@/lib/user-scope";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

// 真实 hook 构造 execution 的行为测试：直接调 executeImageGeneration 只能证明字段被消费，
// 证明不了接线。这里走 generateNode → execution → POST /tasks，读真正发出去的 metadata。

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
const originalUseApp = App.useApp;
const originalRequest = apiClient.request;
const originalConfig = useConfigStore.getState().config;
const originalUserState = useUserStore.getState();
let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    App.useApp = originalUseApp;
    apiClient.request = originalRequest;
    useConfigStore.setState({ config: originalConfig });
    useUserStore.setState(originalUserState);
    for (const [key, descriptor] of [
        ["window", originalWindow],
        ["IS_REACT_ACT_ENVIRONMENT", originalAct],
    ] as const) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const connections: CanvasConnection[] = [
    { id: "product-output", fromNodeId: "product", toNodeId: "output" },
    { id: "table-output", fromNodeId: "table", toNodeId: "output" },
];

// 默认用一条**真实的合规详情行**：新合同版本号 + 结构化文案 + 画面段。
// 旧行要单独构造，不能反过来把生产校验放松来迁就测试。
const detailRow = { slotId: "detail-1", title: "首屏", duty: "开场", prompt: "画面构成：竖版商业详情页首屏，通勤包居中偏右，柔和侧光勾勒包型轮廓，浅灰渐变背景留出标题空间；不出现文字、LOGO 贴图与水印", copy: { headline: "轻盈随行", subhead: "通勤不费力", price: "¥199", cta: "立即购买" }, imagePromptContractVersion: 1 as const };

function ecommerceGraph(options: { legacyRow?: { prompt: string } } = {}) {
    const product: CanvasNodeData = {
        id: "product",
        type: CanvasNodeType.Product,
        title: "通勤包",
        position: { x: 0, y: 0 },
        width: 200,
        height: 200,
        metadata: { productProfile: createEcommerceProductProfile("通勤包") },
    };
    const table: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "详情表",
        position: { x: 0, y: 300 },
        width: 600,
        height: 300,
        metadata: { ecommerceFlowId: "detail", ecommerceSuite: { flow: "detail", rows: [options.legacyRow ? { slotId: "detail-1", title: "首屏", duty: "开场", ...options.legacyRow } : detailRow] } as never },
    };
    const output: CanvasNodeData = {
        id: "output",
        type: CanvasNodeType.Image,
        title: "第1屏",
        position: { x: 400, y: 0 },
        width: 300,
        height: 400,
        metadata: {
            ecommerceProductId: "product",
            ecommerceFlowId: "detail",
            ecommerceShotId: "detail-1",
            batchSourceNodeId: "table",
        },
    };
    return { nodes: [product, table, output], output };
}

async function mountExecutor(initial: CanvasNodeData[]) {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    storage.set(key, value);
                },
                removeItem: (key: string) => {
                    storage.delete(key);
                },
            },
            setInterval: () => 0,
            clearInterval: () => {},
            dispatchEvent: () => true,
        },
    });
    setActiveUserScope("user-a");
    const errors: string[] = [];
    App.useApp = (() => ({
        message: {
            warning() {},
            info() {},
            success() {},
            error(value: string) {
                errors.push(value);
            },
        },
        modal: { confirm() {} },
    })) as typeof App.useApp;
    useConfigStore.setState({
        config: {
            ...defaultConfig,
            channels: [
                {
                    id: "test",
                    name: "Test",
                    scope: "system",
                    baseUrl: "/api",
                    apiKey: "test-boundary",
                    apiFormat: "openai",
                    models: ["gpt-image-2"],
                    modelCosts: [{ model: "gpt-image-2", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
                },
            ],
            imageModel: "test::gpt-image-2",
        },
    });
    useUserStore.setState({ runtimeLimits: { activeTaskLimit: 9, resourceUploadMB: 50 } });

    const submitted: Array<{ id: string; prompt?: string; inputPrompt?: string; metadata?: Record<string, unknown> }> = [];
    apiClient.request = (async (request: { url?: string; method?: string; data?: { prompt?: string; input?: { prompt?: string; metadata?: Record<string, unknown> } } }) => {
        if (request.url === "/tasks" && request.method?.toLowerCase() === "post") {
            submitted.push({ id: String(request.data?.input?.metadata?.nodeId), prompt: request.data?.prompt, inputPrompt: request.data?.input?.prompt, metadata: request.data?.input?.metadata });
            // 记录到发车边界就停，不进入轮询。
            throw new Error("stop at transport");
        }
        return { data: { code: 0, data: [], msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;

    let generateNode!: ReturnType<typeof useCanvasGenerationExecutor>;
    function Probe() {
        const ref = useRef(initial);
        const [nodes, publish] = useState(ref.current);
        const writer = useMemo(
            () => ((update: CanvasNodeData[] | ((current: CanvasNodeData[]) => CanvasNodeData[])) => publish((current) => (ref.current = typeof update === "function" ? update(current) : update))),
            [],
        );
        const options = useMemo<Parameters<typeof useCanvasGenerationExecutor>[0]>(
            () => ({
                projectId: "test-project",
                addedSkills: [],
                assets: [],
                nodesRef: ref,
                connectionsRef: { current: connections },
                setNodes: writer,
                setConnections() {},
                setSelectedNodeIds() {},
                setSelectedConnectionId() {},
                setDialogNodeId() {},
                setRunningNodeId() {},
                startGenerationRequest(target, _origin, _running, controller = new AbortController()) {
                    return controller;
                },
                finishGenerationRequest() {},
                bindGenerationTask() {},
                async applyGenerationTaskResult() {},
            }),
            [ref, writer],
        );
        generateNode = useCanvasGenerationExecutor(options);
        return null;
    }
    const fail = (error: unknown) => {
        throw error;
    };
    const root = reconciler.createContainer({} as never, 1, null, false, null, "", fail, fail, fail, null);
    await act(async () => {
        reconciler.updateContainer(React.createElement(Probe), root, null, null);
    });
    unmount = async () => {
        await act(async () => {
            reconciler.updateContainer(null, root, null, null);
        });
    };
    return {
        submitted,
        errors,
        generateNode: () => generateNode,
    };
}

test("hook 把当前输入确定的详情页模式作为 model 发给任务", async () => {
    const graph = ecommerceGraph();
    const harness = await mountExecutor(graph.nodes);
    await act(async () => {
        await harness.generateNode()("output", "image", "第1屏", { skipDuplicateConfirmation: true });
    });
    expect(harness.submitted).toHaveLength(1);
    expect(harness.submitted[0].metadata?.ecommerceTextMode).toBe("model");
});

test("有快照时即使画布已改回详情页，也只用快照冻结的 local", async () => {
    const graph = ecommerceGraph();
    graph.output.metadata!.ecommerceFlowId = "main";
    const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
    expect(snapshot.ecommerceTextMode).toBe("local");
    // 入队之后画布又改回详情页——重试不能跟着漂。
    graph.output.metadata!.ecommerceFlowId = "detail";
    const harness = await mountExecutor(graph.nodes);
    await act(async () => {
        await harness.generateNode()("output", "image", snapshot.prompt, { skipDuplicateConfirmation: true, inputSnapshot: snapshot });
    });
    expect(harness.submitted[0].metadata?.ecommerceTextMode).toBe("local");
});

test("快照缺模式时 metadata 不出现该字段，不按当前画布补", async () => {
    const graph = ecommerceGraph();
    const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
    delete snapshot.ecommerceTextMode;
    const harness = await mountExecutor(graph.nodes);
    await act(async () => {
        await harness.generateNode()("output", "image", snapshot.prompt, { skipDuplicateConfirmation: true, inputSnapshot: snapshot });
    });
    expect(harness.submitted[0].metadata).not.toHaveProperty("ecommerceTextMode");
});

test("快照冻结的拒绝原因在 hook 层就拦住，不发任务", async () => {
    // 旧自由文本行：没有合同版本号，读得出来但不能生成。
    const graph = ecommerceGraph({ legacyRow: { prompt: "白色背景，居中构图" } });
    const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
    expect(snapshot.ecommerceIssue).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
    // 画布后来把那一行改成合规也不能改变已入队结论。
    (graph.nodes[1].metadata!.ecommerceSuite as { rows: Array<{ imagePromptContractVersion?: 1 }> }).rows[0].imagePromptContractVersion = 1;
    const harness = await mountExecutor(graph.nodes);
    await act(async () => {
        await harness.generateNode()("output", "image", snapshot.prompt, { skipDuplicateConfirmation: true, inputSnapshot: snapshot });
    });
    expect(harness.submitted).toHaveLength(0);
    expect(harness.errors).toContain(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
});

test("同一个快照重试两次，画布来回改也不漂移", async () => {
    const graph = ecommerceGraph();
    graph.output.metadata!.ecommerceFlowId = "main";
    const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
    const harness = await mountExecutor(graph.nodes);
    const retry = { skipDuplicateConfirmation: true, inputSnapshot: snapshot } as const;
    await act(async () => {
        await harness.generateNode()("output", "image", snapshot.prompt, retry);
    });
    graph.output.metadata!.ecommerceFlowId = "detail";
    await act(async () => {
        await harness.generateNode()("output", "image", snapshot.prompt, retry);
    });
    expect(harness.submitted.map((item) => item.metadata?.ecommerceTextMode)).toEqual(["local", "local"]);
});

for (const frozen of [false, true]) {
    test(`${frozen ? "冻结" : "实时"}输入的最终任务只带当前文案与平台，不回注画面段里的营销字`, async () => {
        const graph = ecommerceGraph();
        const visual = "画面构成：VISUAL_CURRENT；主标题：RAW_MARKETING_ONLY；产品摆放：PLACEMENT_CURRENT；副标题：RAW_SUBHEAD_ONLY；视觉风格：STYLE_CURRENT；负面提示词：NEGATIVE_CURRENT";
        const suite = graph.nodes[1].metadata!.ecommerceSuite!;
        suite.rows = [{ ...detailRow, prompt: visual, copy: { headline: "COPY_CONFIRMED", subhead: "", price: "", cta: "" } }];
        graph.nodes[1].metadata!.ecommercePlatform = "PLATFORM_CONFIRMED";
        Object.assign(graph.output.metadata!, { prompt: visual, composerContent: visual, ecommerceCopy: { headline: "NODE_COPY_STALE", subhead: "", price: "", cta: "" } });
        const snapshot = frozen ? createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []) : undefined;
        if (frozen) {
            suite.rows = [{ ...suite.rows[0], copy: { headline: "COPY_AFTER_QUEUE", subhead: "", price: "", cta: "" } }];
            graph.nodes[1].metadata!.ecommercePlatform = "PLATFORM_AFTER_QUEUE";
        }
        const harness = await mountExecutor(graph.nodes);
        await act(async () => {
            await harness.generateNode()("output", "image", visual, { skipDuplicateConfirmation: true, inputSnapshot: snapshot });
        });
        expect(harness.submitted).toHaveLength(1);
        const request = harness.submitted[0];
        expect(request.inputPrompt).toBe(request.prompt);
        expect(request.inputPrompt).toContain("主标题：COPY_CONFIRMED");
        expect(request.inputPrompt).toContain("PLATFORM_CONFIRMED");
        expect(request.inputPrompt).toContain("画面构成：VISUAL_CURRENT");
        for (const stale of ["RAW_MARKETING_ONLY", "RAW_SUBHEAD_ONLY", "NODE_COPY_STALE", "COPY_AFTER_QUEUE", "PLATFORM_AFTER_QUEUE"]) expect(request.inputPrompt).not.toContain(stale);
        expect(request.metadata?.ecommerceTextMode).toBe("model");
    });
}

for (const removeTable of [false, true]) {
    test(`详情${removeTable ? "表已删除" : "行已删除"}时真实执行器拒绝新生成`, async () => {
        const graph = ecommerceGraph();
        if (removeTable) graph.nodes = graph.nodes.filter((node) => node.id !== "table");
        else graph.nodes[1].metadata!.ecommerceSuite!.rows = [];
        Object.assign(graph.output.metadata!, { storageKey: "resource:old", content: "data:image/png;base64,b2xk", status: "success" });
        const harness = await mountExecutor(graph.nodes);
        await act(async () => {
            await harness.generateNode()("output", "image", "旧图仍可查看", { skipDuplicateConfirmation: true });
        });
        expect(harness.submitted).toHaveLength(0);
        expect(harness.errors).toContain(ECOMMERCE_MISSING_DETAIL_ROW_ERROR);
        expect(graph.output.metadata?.storageKey).toBe("resource:old");
    });
}

