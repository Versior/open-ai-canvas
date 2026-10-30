import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createCanvasBatchInputSnapshot, resolveFrozenEcommerceTextMode } from "@/lib/canvas/canvas-batch-input-snapshot";
import { adoptMediaVersion, createNodeFromMediaVersion, listMediaVersions, mediaVersionPreviewNode, recordCommittedMediaVersion } from "@/lib/canvas/canvas-media-versions";
import { applyGeneratedMediaResultMetadata, buildGenerationTaskNodeResult } from "@/lib/canvas/canvas-generation-task-sync";
import { commitCanvasGenerationResult } from "@/lib/canvas/canvas-generation-result";
import { batchOutputResultPending } from "@/lib/canvas/canvas-batch-references";
import { createEcommerceProductProfile } from "@/lib/ecommerce/ecommerce-contract";
import { ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR, ECOMMERCE_PROMPT_PLACEHOLDER_ERROR } from "@/lib/ecommerce/ecommerce-canvas";
import { ecommerceGenerationSourceSignature, ecommerceResultSourceCurrent, ecommerceTableResults } from "@/lib/ecommerce/ecommerce-table";
import type { EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import { executeImageGeneration } from "@/pages/canvas/canvas-image-generation-executor";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { apiClient } from "@/services/api/request";
import { clearResourceAccessCache } from "@/services/api/resources";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type EcommerceTextMode } from "@/types/canvas";

// 结果投影会为 resource: storageKey 换签名地址；测试只关心节点 metadata，固定一个假地址。
const originalAdapter = apiClient.defaults.adapter;
beforeEach(() => {
    clearResourceAccessCache();
    apiClient.defaults.adapter = async (config) => ({ config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [{ access: { url: "/api/resources/fake/file" } }] } } });
});
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    clearResourceAccessCache();
});

const connections: CanvasConnection[] = [{ id: "product-output", fromNodeId: "product", toNodeId: "output" }];

function ecommerceGraph(flowId: string | undefined) {
    const product: CanvasNodeData = {
        id: "product",
        type: CanvasNodeType.Product,
        title: "通勤包",
        position: { x: 0, y: 0 },
        width: 200,
        height: 200,
        metadata: { productProfile: createEcommerceProductProfile("通勤包") },
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
            ecommerceFlowId: flowId,
            ecommerceCopy: { headline: "轻盈随行", subhead: "通勤不费力", price: "¥199", cta: "立即购买" },
        },
    };
    return { nodes: [product, output], output };
}

describe("ecommerce text mode freeze", () => {
    test("详情页冻结 model，其他一键入口冻结 local", () => {
        const detail = ecommerceGraph("detail");
        const main = ecommerceGraph("main");
        expect(createCanvasBatchInputSnapshot(detail.output, detail.nodes, connections, []).ecommerceTextMode).toBe("model");
        expect(createCanvasBatchInputSnapshot(main.output, main.nodes, connections, []).ecommerceTextMode).toBe("local");
    });

    test("非电商节点不猜模式，保持 unknown", () => {
        const node: CanvasNodeData = { id: "plain", type: CanvasNodeType.Image, title: "图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: "白底" } };
        expect(createCanvasBatchInputSnapshot(node, [node], [], []).ecommerceTextMode).toBeUndefined();
    });

    test("旧快照缺 mode 时保持 unknown，不回读当前画布猜", () => {
        const graph = ecommerceGraph("local" as unknown as string);
        const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
        const legacy = JSON.parse(JSON.stringify({ ...snapshot, ecommerceTextMode: undefined }));
        let liveReads = 0;
        const mode = resolveFrozenEcommerceTextMode(legacy, () => {
            liveReads += 1;
            return "model";
        });
        expect(mode).toBeUndefined();
        expect(liveReads).toBe(0);
    });

    test("有快照时忽略画布后续改动，沿用冻结值", () => {
        const graph = ecommerceGraph("main");
        const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
        graph.output.metadata!.ecommerceFlowId = "detail";
        let liveReads = 0;
        const mode = resolveFrozenEcommerceTextMode(snapshot, () => {
            liveReads += 1;
            return "model";
        });
        expect(mode).toBe("local");
        expect(liveReads).toBe(0);
    });

    test("无快照时才向实时输入要到模式", () => {
        expect(resolveFrozenEcommerceTextMode(undefined, () => "model")).toBe("model");
    });
});

async function captureTaskMetadata(ecommerceTextMode: EcommerceTextMode | undefined, snapshotMissing = false) {
    const graph = ecommerceGraph("detail");
    const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
    if (snapshotMissing) delete snapshot.ecommerceTextMode;
    const nodes = graph.nodes;
    const captured: Array<Record<string, unknown> | undefined> = [];
    const controller = new AbortController();
    const noop = () => {};
    await executeImageGeneration(
        {
            projectId: "",
            nodeId: graph.output.id,
            sourceNode: graph.output,
            canvasNodes: nodes,
            canvasConnections: connections,
            prompt: snapshot.prompt,
            effectivePrompt: snapshot.context.prompt,
            generationConfig: { ...defaultConfig, model: defaultConfig.imageModel, count: "1" },
            generationContext: snapshot.context,
            controller,
            expectedUserScope: "",
            editingTextNode: false,
            ecommerceTextMode,
            styleMetadata: {},
            skillMetadata: {},
            setNodes: (update) => {
                nodes.splice(0, nodes.length, ...(typeof update === "function" ? update(nodes) : update));
            },
            setConnections: noop,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setDialogNodeId: noop,
            startGenerationRequest: () => controller,
            finishGenerationRequest: noop,
            registerPendingNodeIds: noop,
            bindGenerationTask: noop,
            applyGenerationTaskResult: async () => {},
            showError: noop,
        },
        async (options) => {
            captured.push(options.metadata as Record<string, unknown> | undefined);
            throw new Error("stop before transport");
        },
    );
    return captured[0];
}

describe("ecommerce text mode in task metadata", () => {
    test("单图生成把冻结的 mode 写进任务 metadata", async () => {
        expect((await captureTaskMetadata("model"))?.ecommerceTextMode).toBe("model");
        expect((await captureTaskMetadata("local"))?.ecommerceTextMode).toBe("local");
    });

    test("mode 为 unknown 时 metadata 不出现该字段，不用默认值兜底", async () => {
        expect(await captureTaskMetadata(undefined)).not.toHaveProperty("ecommerceTextMode");
        expect(await captureTaskMetadata(undefined, true)).not.toHaveProperty("ecommerceTextMode");
    });
});

function imageTask(id: string, storageKey: string, inputMode?: string) {
    return {
        id,
        type: "canvas_image",
        status: "succeeded" as const,
        prompt: "第1屏",
        attempts: 1,
        createdAt: "",
        updatedAt: "",
        inputJson: JSON.stringify({ mode: "image", metadata: { nodeId: "output", ...(inputMode ? { ecommerceTextMode: inputMode } : {}) } }),
        resultJson: JSON.stringify({ images: [{ dataUrl: "/new.png", storageKey, width: 900, height: 1200 }] }),
    };
}

describe("ecommerce result text mode", () => {
    test("成功媒体把任务输入的合法 mode 绑定到实际 storageKey", async () => {
        const node: CanvasNodeData = { id: "output", type: CanvasNodeType.Image, title: "第1屏", position: { x: 0, y: 0 }, width: 300, height: 400, metadata: { content: "/old.png", storageKey: "resource:old" } };
        const result = await buildGenerationTaskNodeResult(node, imageTask("task-local", "resource:result-local", "local"));
        expect(result.metadata?.ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:result-local" });
        const modelResult = await buildGenerationTaskNodeResult(node, imageTask("task-model", "resource:result-model", "model"));
        expect(modelResult.metadata?.ecommerceResultTextMode).toEqual({ mode: "model", sourceStorageKey: "resource:result-model" });
    });

    test("缺失或非法 mode 的新成功媒体清除旧标签", async () => {
        const stale: CanvasNodeData = {
            id: "output",
            type: CanvasNodeType.Image,
            title: "第1屏",
            position: { x: 0, y: 0 },
            width: 300,
            height: 400,
            metadata: { content: "/old.png", storageKey: "resource:old", ecommerceResultTextMode: { mode: "model", sourceStorageKey: "resource:old" } },
        };
        const missing = await buildGenerationTaskNodeResult(stale, imageTask("task-missing", "resource:result-missing"));
        expect(missing.metadata?.ecommerceResultTextMode).toBeUndefined();
        const illegal = await buildGenerationTaskNodeResult(stale, imageTask("task-illegal", "resource:result-illegal", "guess"));
        expect(illegal.metadata?.ecommerceResultTextMode).toBeUndefined();
    });

    test("失败、取消与准备中都不动旧图的模式标记，extra 带空值或新值也不行", () => {
        const stale: CanvasNodeData = {
            id: "output",
            type: CanvasNodeType.Image,
            title: "第1屏",
            position: { x: 0, y: 0 },
            width: 300,
            height: 400,
            metadata: { content: "/old.png", storageKey: "resource:old", status: "success", ecommerceResultTextMode: { mode: "model", sourceStorageKey: "resource:old" } },
        };
        const kept = { mode: "model", sourceStorageKey: "resource:old" } as const;
        // 失败/取消/准备中不是新媒体落地：旧图连同它的模式一起保留。
        expect(applyGeneratedMediaResultMetadata(stale, { status: "error" }, { ecommerceResultTextMode: undefined }).ecommerceResultTextMode).toEqual(kept);
        expect(applyGeneratedMediaResultMetadata(stale, { status: "error" }, { ecommerceResultTextMode: { mode: "local", sourceStorageKey: "resource:ghost" } }).ecommerceResultTextMode).toEqual(kept);
        expect(applyGeneratedMediaResultMetadata(stale, { status: "idle" }, { ecommerceResultTextMode: undefined }).ecommerceResultTextMode).toEqual(kept);
        expect(applyGeneratedMediaResultMetadata(stale, { status: "loading" }, { ecommerceResultTextMode: undefined }).ecommerceResultTextMode).toEqual(kept);
        // 声称 success 却没有新媒体落地，也不是一次真实结果。
        expect(applyGeneratedMediaResultMetadata(stale, { status: "success" }, { ecommerceResultTextMode: undefined }).ecommerceResultTextMode).toEqual(kept);
    });

    test("版本保存、采用与预览都能带回结果模式", () => {
        const node: CanvasNodeData = { id: "output", type: CanvasNodeType.Image, title: "第1屏", position: { x: 0, y: 0 }, width: 300, height: 400, metadata: { content: "/a.png", storageKey: "resource:a", status: "success", ecommerceResultTextMode: { mode: "local", sourceStorageKey: "resource:a" } } };
        const saved = recordCommittedMediaVersion(node);
        const [version] = listMediaVersions(saved);
        expect(version.media.ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:a" });
        expect(mediaVersionPreviewNode(saved, version).metadata?.ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:a" });

        const switched: CanvasNodeData = { ...saved, metadata: { ...saved.metadata, content: "/b.png", storageKey: "resource:b", taskId: undefined, ecommerceResultTextMode: { mode: "model", sourceStorageKey: "resource:b" } } };
        const withB = recordCommittedMediaVersion(switched);
        const adopted = adoptMediaVersion(withB, version.id);
        expect(adopted?.metadata?.ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:a" });
        expect(adopted?.metadata?.storageKey).toBe("resource:a");
    });

    test("旧版本本身没有模式标记时，采用与预览都不继承当前标记", () => {
        const unmarked: CanvasNodeData = { id: "output", type: CanvasNodeType.Image, title: "第1屏", position: { x: 0, y: 0 }, width: 300, height: 400, metadata: { content: "/a.png", storageKey: "resource:a", status: "success" } };
        const withA = recordCommittedMediaVersion(unmarked);
        const [versionA] = listMediaVersions(withA);
        expect(versionA.media.ecommerceResultTextMode).toBeUndefined();
        // 之后这张图被 model 任务替换成 b，模式标记只属于 b。
        const withB = recordCommittedMediaVersion({ ...withA, metadata: { ...withA.metadata, content: "/b.png", storageKey: "resource:b", ecommerceResultTextMode: { mode: "model", sourceStorageKey: "resource:b" } } });
        expect(mediaVersionPreviewNode(withB, versionA).metadata?.ecommerceResultTextMode).toBeUndefined();
        const adopted = adoptMediaVersion(withB, versionA.id);
        expect(adopted?.metadata?.ecommerceResultTextMode).toBeUndefined();
        expect(adopted?.metadata?.storageKey).toBe("resource:a");
    });

    test("取消或迟到的结果不动旧图的模式标记", () => {
        const stale: CanvasNodeData = {
            id: "output",
            type: CanvasNodeType.Image,
            title: "第1屏",
            position: { x: 0, y: 0 },
            width: 300,
            height: 400,
            metadata: { content: "/old.png", storageKey: "resource:old", status: "success", taskId: "task-old", ecommerceResultTextMode: { mode: "local", sourceStorageKey: "resource:old" } },
        };
        // 取消/准备下一轮只改状态，不重绑模式。
        expect(applyGeneratedMediaResultMetadata(stale, { status: "idle" }).ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:old" });
        expect(applyGeneratedMediaResultMetadata(stale, { status: "loading" }).ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:old" });
        // 迟到任务已绑在另一个 taskId 上，结果必须被拒，旧媒体连同模式一起保留。
        const late = { ...stale, metadata: { ...stale.metadata, content: "/late.png", storageKey: "resource:late", ecommerceResultTextMode: undefined } };
        expect(() => commitCanvasGenerationResult([{ ...stale, metadata: { ...stale.metadata, taskId: "task-new" } }], stale, late, "task-late")).toThrow("旧任务结果不能覆盖当前节点");
        expect(stale.metadata?.ecommerceResultTextMode).toEqual({ mode: "local", sourceStorageKey: "resource:old" });
    });
});

describe("ecommerce media version signature binding", () => {
    const v1Row: EcommerceSuiteRow = { slotId: "detail-1", title: "首屏", duty: "开场", prompt: "浅灰背景，通勤包居中" };
    const v2Row: EcommerceSuiteRow = {
        slotId: "detail-1",
        title: "首屏",
        duty: "开场",
        prompt: "浅灰背景，通勤包居中偏右",
        copy: { headline: "轻盈随行", subhead: "通勤不费力", price: "¥199", cta: "立即购买" },
        imagePromptContractVersion: 1,
    };

    function signatureHarness() {
        const product: CanvasNodeData = {
            id: "sig-product",
            type: CanvasNodeType.Product,
            title: "通勤包",
            position: { x: 0, y: 0 },
            width: 200,
            height: 200,
            metadata: { productProfile: createEcommerceProductProfile("通勤包") },
        };
        const table: CanvasNodeData = {
            id: "sig-table",
            type: CanvasNodeType.BatchTable,
            title: "详情表",
            position: { x: 0, y: 300 },
            width: 600,
            height: 300,
            metadata: { ecommerceFlowId: "detail", ecommerceSuite: { flow: "detail", rows: [v1Row] } as never },
        };
        const base: CanvasNodeData = {
            id: "sig-output",
            type: CanvasNodeType.Image,
            title: "第1屏",
            position: { x: 400, y: 0 },
            width: 300,
            height: 400,
            metadata: { ecommerceProductId: product.id, ecommerceFlowId: "detail", ecommerceShotId: "detail-1", batchSourceNodeId: table.id, status: "success" },
        };
        const graphConnections: CanvasConnection[] = [
            { id: "sig-p-t", fromNodeId: product.id, toNodeId: table.id },
            { id: "sig-t-o", fromNodeId: table.id, toNodeId: base.id },
        ];
        const config: AiConfig = {
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
        };
        const signature = (row: EcommerceSuiteRow, candidate: CanvasNodeData) =>
            ecommerceGenerationSourceSignature({ source: table, row, target: candidate, nodes: [product, table, candidate], connections: graphConnections, config });
        return { base, signature };
    }

    test("V1 图采用回来后，当前 V2 行把它当旧方案：不选中，也不是结果未落地", () => {
        const { base, signature } = signatureHarness();
        const v1Signature = signature(v1Row, base)!;
        expect(v1Signature).toBeTruthy();
        const withV1 = recordCommittedMediaVersion({
            ...base,
            metadata: { ...base.metadata, content: "/v1.png", storageKey: "resource:v1", batchInputSignature: v1Signature, batchResultInputSignature: v1Signature, ecommerceResultTextMode: { mode: "local", sourceStorageKey: "resource:v1" } },
        });
        const v2Signature = signature(v2Row, withV1)!;
        expect(v2Signature).not.toBe(v1Signature);
        const withV2 = recordCommittedMediaVersion({
            ...withV1,
            metadata: { ...withV1.metadata, content: "/v2.png", storageKey: "resource:v2", batchInputSignature: v2Signature, batchResultInputSignature: v2Signature, ecommerceResultTextMode: { mode: "model", sourceStorageKey: "resource:v2" } },
        });

        const adopted = adoptMediaVersion(withV2, listMediaVersions(withV2)[0].id)!;
        // 签名回到 V1 自己那一份，不能留着 V2 的。
        expect(adopted.metadata?.batchResultInputSignature).toBe(v1Signature);
        expect(adopted.metadata?.batchInputSignature).toBe(v1Signature);
        // 成对恢复后不是「结果未落地」，也不需要重试。
        expect(batchOutputResultPending(adopted.metadata)).toBe(false);
        // 对当前 V2 行来说它是旧方案：不选中、明确 stale。
        expect(ecommerceResultSourceCurrent(adopted, signature(v2Row, adopted))).toBe(false);
        const results = ecommerceTableResults([v2Row], [adopted], "detail", signature);
        expect(results.selected.get("detail-1")).toBeUndefined();
        expect(results.stale.get("detail-1")).toEqual([adopted]);

        // 再采用回 V2，仍然认得出当前方案。
        const back = adoptMediaVersion(withV2, listMediaVersions(withV2)[1].id)!;
        expect(back.metadata?.batchResultInputSignature).toBe(v2Signature);
        expect(batchOutputResultPending(back.metadata)).toBe(false);
        expect(ecommerceResultSourceCurrent(back, signature(v2Row, back))).toBe(true);
    });

    test("旧版本没有签名时，采用、预览与取出都不继承当前签名", () => {
        const { base, signature } = signatureHarness();
        const withLegacy = recordCommittedMediaVersion({ ...base, metadata: { ...base.metadata, content: "/a.png", storageKey: "resource:a" } });
        const [legacyVersion] = listMediaVersions(withLegacy);
        const v2Signature = signature(v2Row, withLegacy)!;
        const withV2 = recordCommittedMediaVersion({
            ...withLegacy,
            metadata: { ...withLegacy.metadata, content: "/b.png", storageKey: "resource:b", batchInputSignature: v2Signature, batchResultInputSignature: v2Signature },
        });

        const adopted = adoptMediaVersion(withV2, legacyVersion.id)!;
        expect(adopted.metadata?.batchInputSignature).toBeUndefined();
        expect(adopted.metadata?.batchResultInputSignature).toBeUndefined();
        expect(batchOutputResultPending(adopted.metadata)).toBe(false);
        const preview = mediaVersionPreviewNode(withV2, legacyVersion);
        expect(preview.metadata?.batchInputSignature).toBeUndefined();
        expect(preview.metadata?.batchResultInputSignature).toBeUndefined();
        const extracted = createNodeFromMediaVersion(withV2, legacyVersion.id)!;
        expect(extracted.metadata?.batchInputSignature).toBeUndefined();
        expect(extracted.metadata?.batchResultInputSignature).toBeUndefined();
    });
});

describe("ecommerce row issue gate", () => {
    test("入队快照冻结表行的拒绝原因，执行前不再读画布重算", () => {
        const product: CanvasNodeData = {
            id: "product",
            type: CanvasNodeType.Product,
            title: "通勤包",
            position: { x: 0, y: 0 },
            width: 200,
            height: 200,
            metadata: { productProfile: createEcommerceProductProfile("通勤包") },
        };
        // 认领了详情行，但那行是旧自由文本（没有合同版本号）。
        const table: CanvasNodeData = {
            id: "table",
            type: CanvasNodeType.BatchTable,
            title: "详情表",
            position: { x: 0, y: 300 },
            width: 600,
            height: 300,
            metadata: {
                ecommerceFlowId: "detail",
                ecommerceSuite: { flow: "detail", rows: [{ slotId: "detail-1", title: "首屏", duty: "开场", prompt: "白色背景，居中构图" }] } as never,
            },
        };
        const output: CanvasNodeData = {
            id: "output",
            type: CanvasNodeType.Image,
            title: "第1屏",
            position: { x: 400, y: 0 },
            width: 300,
            height: 400,
            metadata: { ecommerceProductId: "product", ecommerceFlowId: "detail", ecommerceShotId: "detail-1", batchSourceNodeId: "table" },
        };
        const snapshot = createCanvasBatchInputSnapshot(output, [product, table, output], [{ id: "p-o", fromNodeId: "product", toNodeId: "output" }], []);
        expect(snapshot.ecommerceIssue).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
        // 画布后续把那一行改成合规也无法改变已入队任务的拒绝结论。
        (table.metadata!.ecommerceSuite as { rows: Array<{ imagePromptContractVersion?: 1 }> }).rows[0].imagePromptContractVersion = 1;
        expect(snapshot.ecommerceIssue).toBe(ECOMMERCE_LEGACY_DETAIL_PROMPT_ERROR);
    });

    test("执行阶段在 provider 前拒绝 issue，不创建任务", async () => {
        const graph = ecommerceGraph("detail");
        const snapshot = createCanvasBatchInputSnapshot(graph.output, graph.nodes, connections, []);
        const nodes = graph.nodes;
        const controller = new AbortController();
        const errors: string[] = [];
        let submitted = 0;
        await executeImageGeneration(
            {
                projectId: "",
                nodeId: graph.output.id,
                sourceNode: graph.output,
                canvasNodes: nodes,
                canvasConnections: connections,
                prompt: snapshot.prompt,
                effectivePrompt: snapshot.context.prompt,
                generationConfig: { ...defaultConfig, model: defaultConfig.imageModel, count: "1" },
                generationContext: snapshot.context,
                controller,
                expectedUserScope: "",
                editingTextNode: false,
                ecommerceTextMode: "model",
                ecommerceIssue: ECOMMERCE_PROMPT_PLACEHOLDER_ERROR,
                styleMetadata: {},
                skillMetadata: {},
                setNodes: () => {},
                setConnections: () => {},
                setSelectedNodeIds: () => {},
                setSelectedConnectionId: () => {},
                setDialogNodeId: () => {},
                startGenerationRequest: () => controller,
                finishGenerationRequest: () => {},
                registerPendingNodeIds: () => {},
                bindGenerationTask: () => {},
                applyGenerationTaskResult: async () => {},
                showError: (content) => errors.push(content),
            },
            async () => {
                submitted += 1;
                throw new Error("must not submit");
            },
        );
        expect(submitted).toBe(0);
        expect(errors).toEqual([ECOMMERCE_PROMPT_PLACEHOLDER_ERROR]);
    });
});
