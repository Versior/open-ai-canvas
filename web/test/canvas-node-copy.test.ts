import { describe, expect, test } from "bun:test";

import { isolateCopiedNodeMetadata, nextCopiedNodeTitle } from "@/lib/canvas/canvas-node-copy";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas node copy title", () => {
    test("首次复制使用 copy1，后续按已有最大序号递增", () => {
        expect(nextCopiedNodeTitle("女明星角色三视图", ["女明星角色三视图"])).toBe("女明星角色三视图_copy1");
        expect(nextCopiedNodeTitle("女明星角色三视图", ["女明星角色三视图", "女明星角色三视图_copy1"])).toBe("女明星角色三视图_copy2");
        expect(nextCopiedNodeTitle("女明星角色三视图", ["女明星角色三视图_copy1", "女明星角色三视图_copy3"])).toBe("女明星角色三视图_copy4");
    });

    test("复制已有副本时仍使用原始名称计算下一序号", () => {
        expect(nextCopiedNodeTitle("女明星角色三视图_copy1", ["女明星角色三视图", "女明星角色三视图_copy1"])).toBe("女明星角色三视图_copy2");
    });

    test("兼容旧版空格 Copy 后缀", () => {
        expect(nextCopiedNodeTitle("女明星角色三视图 Copy", ["女明星角色三视图", "女明星角色三视图 Copy"])).toBe("女明星角色三视图_copy1");
    });

    test("同一批粘贴可以通过预留标题连续分配序号", () => {
        const titles = new Set(["节点", "节点_copy1"]);
        const first = nextCopiedNodeTitle("节点", titles);
        titles.add(first);
        const second = nextCopiedNodeTitle("节点", titles);
        expect([first, second]).toEqual(["节点_copy2", "节点_copy3"]);
    });
});

describe("canvas generation copy metadata", () => {
    test("媒体副本保留提示词与参考字段，并明确原地回填生成结果", () => {
        const source: CanvasNodeData = {
            id: "source",
            type: CanvasNodeType.Video,
            title: "镜头",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "video-url",
                prompt: "相同提示词",
                videoStartFrameNodeId: "reference-start",
                videoEndFrameNodeId: "reference-end",
                generationResultPlacement: "new-version",
                generationEffectKeys: ["attach-node:source-task:source:0"],
            },
        };

        const metadata = isolateCopiedNodeMetadata(source, new Map([[source.id, "copy"]]));

        expect(metadata.prompt).toBe("相同提示词");
        expect(metadata.videoStartFrameNodeId).toBe("reference-start");
        expect(metadata.videoEndFrameNodeId).toBe("reference-end");
        expect(metadata.copiedFromNodeId).toBe("source");
        expect(metadata.generationResultPlacement).toBe("replace-node");
        expect(metadata.generationEffectKeys).toBeUndefined();
        expect(source.metadata?.generationEffectKeys).toEqual(["attach-node:source-task:source:0"]);
    });

    test("复制套图产物时只移除正式槽位身份，保留图片、文案与排版", () => {
        const source: CanvasNodeData = {
            id: "official-result",
            type: CanvasNodeType.Image,
            title: "详情页首屏",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "official.png",
                prompt: "用户修改后的首屏提示词",
                ecommerceProductId: "product-1",
                ecommerceFlowId: "detail",
                ecommerceShotId: "detail-1",
                ecommerceRunId: "run-1",
                ecommerceCopy: { headline: "轻盈保温", subhead: "通勤随行", cta: "立即查看", price: "¥99" },
                ecommerceLayout: { name: "用户版式", blocks: [] },
            },
        };

        const copied = isolateCopiedNodeMetadata(
            source,
            new Map([
                [source.id, "copy-result"],
                ["product-1", "product-copy"],
            ]),
        );

        expect(copied.ecommerceProductId).toBeUndefined();
        expect(copied.ecommerceFlowId).toBeUndefined();
        expect(copied.ecommerceShotId).toBeUndefined();
        expect(copied.ecommerceRunId).toBeUndefined();
        expect(copied.content).toBe("official.png");
        expect(copied.prompt).toBe("用户修改后的首屏提示词");
        expect(copied.ecommerceCopy).toEqual(source.metadata?.ecommerceCopy);
        expect(copied.ecommerceLayout).toEqual(source.metadata?.ecommerceLayout);
    });

    test("preserves a standalone ecommerce shot marker on ordinary copied media", () => {
        const source: CanvasNodeData = {
            id: "material",
            type: CanvasNodeType.Image,
            title: "Material",
            position: { x: 0, y: 0 },
            metadata: { content: "material.png", ecommerceShotId: "detail-1" },
        };

        const copied = isolateCopiedNodeMetadata(source, new Map([[source.id, "material-copy"]]));

        expect(copied.ecommerceShotId).toBe("detail-1");
    });

    test("复制到副本的入边继续解析为同一张参考图", () => {
        const reference: CanvasNodeData = {
            id: "reference",
            type: CanvasNodeType.Image,
            title: "角色参考",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: { content: "reference-url", mimeType: "image/png" },
        };
        const copy: CanvasNodeData = {
            id: "copy",
            type: CanvasNodeType.Image,
            title: "结果_copy1",
            position: { x: 400, y: 0 },
            width: 340,
            height: 240,
            metadata: { content: "old-result", prompt: "保持角色一致", copiedFromNodeId: "source", generationResultPlacement: "replace-node" },
        };

        const context = buildNodeGenerationContext(copy.id, [reference, copy], [{ id: "copy-reference", fromNodeId: reference.id, toNodeId: copy.id }], copy.metadata!.prompt!, []);

        expect(context.prompt).toBe("保持角色一致");
        expect(context.referenceImages.map((image) => image.id)).toEqual([reference.id]);
    });
});

describe("batch table copy references", () => {
    const suite = {
        flow: "main",
        source: "draft" as const,
        updatedAt: "",
        rows: [{ slotId: "row-1", title: "主图", duty: "展示商品", prompt: "保持人物一致", resultNodeId: "result" }],
    };
    const table: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "批量创作",
        position: { x: 0, y: 0 },
        width: 1280,
        height: 560,
        metadata: {
            ecommerceProductId: "product",
            ecommerceSuite: suite,
            ecommerceSuitesByFlow: { main: suite },
            batchTable: {
                operation: "creative",
                concurrency: 2,
                referenceMode: "cells",
                aiGenerated: true,
                referenceColumns: [
                    { id: "portrait", label: "人物" },
                    { id: "scene", label: "场景" },
                    { id: "style", label: "风格" },
                ],
                textColumns: [{ id: "requirements", label: "要求", type: "text" }],
                rows: [
                    {
                        id: "row-1",
                        enabled: true,
                        inputNodeIds: ["portrait-image", "", "portrait-image"],
                        textNodeIds: ["note"],
                        prompt: "保持人物一致",
                        outputNodeId: "result",
                        generatedInputSignature: "old-generation",
                        cells: { requirements: "近景" },
                    },
                ],
            },
        },
    };

    test("只复制表格保留外部素材及空列，但不接管原表的生成结果", () => {
        const metadata = isolateCopiedNodeMetadata(table, new Map([["table", "table-copy"]]));
        const copied = metadata.batchTable!;

        expect(metadata.ecommerceProductId).toBe("product");
        expect(copied.referenceMode).toBe("cells");
        expect(copied.rows[0].inputNodeIds).toEqual(["portrait-image", "", "portrait-image"]);
        expect(copied.rows[0].textNodeIds).toEqual(["note"]);
        expect(copied.rows[0].outputNodeId).toBeUndefined();
        expect(copied.rows[0].generatedInputSignature).toBeUndefined();
        expect(metadata.ecommerceSuite?.rows[0].resultNodeId).toBeUndefined();
        expect(metadata.ecommerceSuitesByFlow?.main?.rows[0].resultNodeId).toBeUndefined();
        expect(table.metadata?.batchTable?.rows[0].outputNodeId).toBe("result");
        expect(table.metadata?.batchTable?.rows[0].generatedInputSignature).toBe("old-generation");
        expect(table.metadata?.ecommerceSuite?.rows[0].resultNodeId).toBe("result");
        expect(table.metadata?.ecommerceSuitesByFlow?.main?.rows[0].resultNodeId).toBe("result");
    });

    test("同时复制表、素材和结果后，列位置、格子与输出归属全部指向同组副本", () => {
        const idMap = new Map([
            ["table", "table-copy"],
            ["product", "product-copy"],
            ["portrait-image", "portrait-copy"],
            ["note", "note-copy"],
            ["result", "result-copy"],
        ]);
        const copiedMetadata = isolateCopiedNodeMetadata(table, idMap);
        const copied = copiedMetadata.batchTable!;
        const result: CanvasNodeData = {
            id: "result",
            type: CanvasNodeType.Image,
            title: "成品",
            position: { x: 1400, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "result.png",
                batchSourceNodeId: "table",
                batchRowId: "row-1",
                batchOperation: "creative",
                batchInputNodeIds: ["portrait-image", "", "portrait-image"],
                ecommerceProductId: "product",
                ecommerceFlowId: "main",
                ecommerceShotId: "row-1",
                ecommerceRunId: "run-1",
            },
        };
        const copiedResult = isolateCopiedNodeMetadata(result, idMap);

        expect(copiedMetadata.ecommerceProductId).toBe("product-copy");
        expect(copied.rows[0].id).toBe("row-1");
        expect(copied.referenceColumns?.map((column) => column.id)).toEqual(["portrait", "scene", "style"]);
        expect(copied.rows[0].inputNodeIds).toEqual(["portrait-copy", "", "portrait-copy"]);
        expect(copied.rows[0].textNodeIds).toEqual(["note-copy"]);
        expect(copied.rows[0].outputNodeId).toBe("result-copy");
        expect(copiedMetadata.ecommerceSuite?.rows[0].resultNodeId).toBe("result-copy");
        expect(copiedMetadata.ecommerceSuitesByFlow?.main?.rows[0].resultNodeId).toBe("result-copy");
        expect(copiedResult.batchSourceNodeId).toBe("table-copy");
        expect(copiedResult.batchRowId).toBe("row-1");
        expect(copiedResult.ecommerceProductId).toBe("product-copy");
        expect(copiedResult.ecommerceFlowId).toBe("main");
        expect(copiedResult.ecommerceShotId).toBe("row-1");
        expect(copiedResult.ecommerceRunId).toBeUndefined();
        expect(copiedResult.batchInputNodeIds).toEqual(["portrait-copy", "", "portrait-copy"]);

        copied.referenceColumns![0].label = "副本人物";
        copied.rows[0].cells!.requirements = "远景";
        copied.rows[0].inputNodeIds[0] = "new-image";
        expect(table.metadata?.batchTable?.referenceColumns?.[0].label).toBe("人物");
        expect(table.metadata?.batchTable?.rows[0].cells?.requirements).toBe("近景");
        expect(table.metadata?.batchTable?.rows[0].inputNodeIds[0]).toBe("portrait-image");
    });

    test("单独复制成品不再归属原任务行，仍保留素材引用", () => {
        const result: CanvasNodeData = {
            id: "result",
            type: CanvasNodeType.Image,
            title: "成品",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "result.png",
                batchSourceNodeId: "table",
                batchRowId: "row-1",
                batchOperation: "creative",
                batchInputNodeIds: ["portrait-image"],
                ecommerceProductId: "product",
                ecommerceFlowId: "main",
                ecommerceShotId: "row-1",
                ecommerceRunId: "run-1",
            },
        };
        const copied = isolateCopiedNodeMetadata(result, new Map([["result", "result-copy"]]));

        expect(copied.batchSourceNodeId).toBeUndefined();
        expect(copied.batchRowId).toBeUndefined();
        expect(copied.batchOperation).toBeUndefined();
        expect(copied.ecommerceProductId).toBeUndefined();
        expect(copied.ecommerceFlowId).toBeUndefined();
        expect(copied.ecommerceShotId).toBeUndefined();
        expect(copied.ecommerceRunId).toBeUndefined();
        expect(copied.batchInputNodeIds).toEqual(["portrait-image"]);
        expect(copied.content).toBe("result.png");
    });
});
