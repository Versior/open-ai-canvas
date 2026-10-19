import { nanoid } from "nanoid";

import type { CanvasBatchOperation, CanvasBatchProductRecipe, CanvasBatchReferenceColumn, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasNodeData } from "@/types/canvas";

export const TRY_ON_BATCH_PROMPT = "参考图1是人物原图，参考图2是目标服装。保持人物身份、五官、姿态和背景不变，将人物服装替换为参考图2中的款式。准确还原服装版型、颜色、材质、纹理和装饰细节，穿着关系自然，光影与原图一致。";
export const CREATIVE_BATCH_PROMPT = "基于参考图创作一张新的商业图片，保留主体身份和关键产品细节，画面构图完整，光影自然。";

/**
 * 电商创作配方。
 *
 * 每条只写"怎么拍"——用途、构图、光线、镜头、留白。商品长什么样一律不写，
 * 那是锁定块（table.productLock）的职责。两件事混在一段里，模型就会在改构图时顺手把商品也改了。
 */
export type CanvasBatchProductRecipeDefinition = {
    id: CanvasBatchProductRecipe;
    label: string;
    /** 一句话说明这张图要解决什么，给用户看，不进提示词。 */
    hint: string;
    prompt: string;
};

export const PRODUCT_RECIPES: CanvasBatchProductRecipeDefinition[] = [
    {
        id: "main", label: "主图",
        hint: "商品完整、背景干净，用于列表首图",
        prompt: "生成一张电商主图：商品完整入画，居中或按三分构图，正面或微侧角度，纯白或浅灰棚拍背景，柔和均匀布光，保留自然接触阴影，画面干净、留白充足。",
    },
    {
        id: "scene", label: "场景图",
        hint: "商品放进真实使用环境",
        prompt: "生成一张商品场景图：把商品放进与其品类相符的真实使用场景，中景构图，自然光或环境光，背景适度虚化，商品仍是画面主体且清晰可辨，氛围真实不做摆拍感。",
    },
    {
        id: "detail", label: "细节图",
        hint: "聚焦材质、工艺或结构局部",
        prompt: "生成一张商品细节图：近景或微距，聚焦指定的材质、工艺或结构局部，浅景深，侧光突出纹理与质感，商品其余部分可自然出画。只放大参考图中已经存在的细节，不添加原图没有的结构。",
    },
    {
        id: "selling_point", label: "卖点图",
        hint: "突出单一信息，预留文案位",
        prompt: "生成一张商品卖点图：商品占据画面主体，一侧或底部预留文案与图标位置，背景简洁低对比，信息层级清晰，画面不要自行生成文字，文案位留空。",
    },
    {
        id: "model", label: "模特上身",
        hint: "人物穿着或使用商品",
        prompt: "生成一张模特上身图：模特自然穿着或使用商品，半身或全身构图，姿态放松、机位平视，光线柔和，商品是画面焦点且版型、颜色、图案清晰可辨。人物身份与商品都必须来自参考图，不虚构未展示的版型或结构。",
    },
    {
        id: "detail_page", label: "详情页模块",
        hint: "长图分段，多个信息区",
        prompt: "生成一张详情页模块图：横向长图比例，画面分出上中下不只一个信息区，商品在不同区域以不同角度出现，留出文案与图标位置，整体风格统一，画面不要自行生成文字。",
    },
    {
        id: "promo", label: "促销海报",
        hint: "主视觉强，预留价格与标题位",
        prompt: "生成一张促销海报主视觉：商品居中或偏侧占据主要画面，背景有明确的氛围与色彩倾向，四周预留标题、价格与行动引导的位置，视觉冲击力强，画面不要自行生成文字、价格或优惠信息。",
    },
    {
        id: "ugc", label: "种草图",
        hint: "生活化第一人称视角",
        prompt: "生成一张生活化种草图：以第一人称或朋友视角拍摄，商品出现在真实生活场景中，光线自然、构图随意不刻意，可有手部交互，真实感优先于精致度。",
    },
];

export const DEFAULT_PRODUCT_RECIPE: CanvasBatchProductRecipe = "main";

export function productRecipe(id: CanvasBatchProductRecipe | undefined): CanvasBatchProductRecipeDefinition {
    return PRODUCT_RECIPES.find((recipe) => recipe.id === id) ?? PRODUCT_RECIPES[0];
}

/** 建行时用的配方提示词。空 id 落到主图，与 DEFAULT_PRODUCT_RECIPE 一致。 */
export function productRecipePrompt(id: CanvasBatchProductRecipe | undefined) {
    return productRecipe(id).prompt;
}

/** 兼容旧代码：电商创作的默认配方就是主图。 */
export const PRODUCT_MAIN_IMAGE_PROMPT = PRODUCT_RECIPES[0].prompt;

/**
 * 把锁定块和配方拼成最终提示词。
 *
 * 锁定块在前、配方在后：模型先读到硬约束，再去理解拍摄要求。
 * 没有锁定块时只发配方，不塞空标题。
 */
export function composeProductPrompt(lock: string | undefined, recipePrompt: string) {
    const trimmedLock = lock?.trim();
    const trimmedRecipe = recipePrompt.trim();
    if (!trimmedLock) return trimmedRecipe;
    return `【商品锁定】以下特征必须保留，不得改写、美化、替换或增减：${trimmedLock}\n\n${trimmedRecipe}`;
}

/** 铺配方时用的默认行集合：先铺最高频的几张。 */
export const DEFAULT_PRODUCT_RECIPE_IDS: CanvasBatchProductRecipe[] = ["main", "scene", "detail", "selling_point"];
export const BATCH_REFERENCE_HANDLE_PREFIX = "batch-reference:";
/** 操作栏 44 + 全局提示词 76 + 分隔 1 + 列头半高 18，对准表头中线。 */
export const BATCH_REFERENCE_HANDLE_TOP = 139;
export const BATCH_REFERENCE_HANDLE_GAP = 40;
export const MIN_BATCH_REFERENCE_COLUMNS = 1;
export const MAX_BATCH_REFERENCE_COLUMNS = 10;
const LEGACY_BATCH_TABLE_WIDTH = 900;

/** 旧默认 900 宽的批量创作表升级到当前默认尺寸，已经手动改过宽度的节点保持原样。 */
export function promoteLegacyBatchTableSize(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== "batch-table" || node.width !== LEGACY_BATCH_TABLE_WIDTH) return node;
    return { ...node, width: 1280, height: Math.max(node.height, 560) };
}

export function defaultBatchReferenceColumns(): CanvasBatchReferenceColumn[] {
    return [
        { id: "reference-1", label: "参考图 1" },
        { id: "reference-2", label: "参考图 2" },
        { id: "reference-3", label: "参考图 3" },
    ];
}

export function batchReferenceColumns(table?: CanvasBatchTableData) {
    const columns = table?.referenceColumns;
    if (!columns?.length) return defaultBatchReferenceColumns();
    return columns;
}

export function batchReferenceHandleId(columnId: string) {
    return `${BATCH_REFERENCE_HANDLE_PREFIX}${columnId}`;
}

export function batchTextColumns(table?: CanvasBatchTableData) {
    return table?.textColumns || [];
}

export function batchTextInputColumns(node: CanvasNodeData, connections: CanvasConnection[]) {
    return batchTextColumns(node.metadata?.batchTable).map((column) =>
        Array.from(new Set(connections.filter((connection) => connection.toNodeId === node.id && connection.toHandleId === `batch-text:${column.id}` && connection.relation !== "batch-output").map((connection) => connection.fromNodeId))),
    );
}

export function batchReferenceMentionToken(index: number) {
    return `@参考图${index + 1}`;
}

export function batchReferenceColumnId(handleId?: string) {
    return handleId?.startsWith(BATCH_REFERENCE_HANDLE_PREFIX) ? handleId.slice(BATCH_REFERENCE_HANDLE_PREFIX.length) : undefined;
}

export function batchReferenceHandleY(node: CanvasNodeData, handleId?: string) {
    if (node.type !== "batch-table") return undefined;
    const columnId = batchReferenceColumnId(handleId);
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    const index = columnId ? columns.findIndex((column) => column.id === columnId) : 0;
    if (index < 0) return undefined;
    return node.position.y + BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP;
}

export function batchReferenceHandleAtY(node: CanvasNodeData, worldY: number, hitRadius = 18) {
    if (node.type !== "batch-table") return undefined;
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    columns.forEach((_, index) => {
        const distance = Math.abs(worldY - (node.position.y + BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP));
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex >= 0 && nearestDistance <= hitRadius ? batchReferenceHandleId(columns[nearestIndex].id) : undefined;
}

export function removeLastBatchReferenceColumn(table: CanvasBatchTableData): CanvasBatchTableData | null {
    const columns = batchReferenceColumns(table);
    if (columns.length <= MIN_BATCH_REFERENCE_COLUMNS) return null;
    const nextColumns = columns.slice(0, -1).map((column, index) => ({ ...column, label: `参考图 ${index + 1}` }));
    return {
        ...table,
        referenceColumns: nextColumns,
        rows: table.rows.map((row) => ({ ...row, inputNodeIds: nextColumns.map((_, index) => row.inputNodeIds[index] || "") })),
    };
}

export function reorderBatchReferenceColumns(table: CanvasBatchTableData, fromColumnId: string, toColumnId: string): CanvasBatchTableData {
    const columns = batchReferenceColumns(table);
    const fromIndex = columns.findIndex((column) => column.id === fromColumnId);
    const toIndex = columns.findIndex((column) => column.id === toColumnId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return table;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    nextColumns.splice(toIndex, 0, moved);
    return {
        ...table,
        referenceColumns: nextColumns.map((column, index) => ({ ...column, label: `参考图 ${index + 1}` })),
        rows: table.rows.map((row) => ({
            ...row,
            inputNodeIds: nextColumns.map((column) => {
                const oldIndex = columns.findIndex((item) => item.id === column.id);
                return row.inputNodeIds[oldIndex] || "";
            }),
        })),
    };
}

export function moveBatchReferenceCell(table: CanvasBatchTableData, sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number): CanvasBatchTableData {
    if (sourceRowId === targetRowId && sourceColumnIndex === targetColumnIndex) return table;
    if (sourceColumnIndex < 0 || targetColumnIndex < 0) return table;
    const referenceCount = Math.max(batchReferenceColumns(table).length, sourceColumnIndex + 1, targetColumnIndex + 1);
    const sourceRow = table.rows.find((row) => row.id === sourceRowId);
    const targetRow = table.rows.find((row) => row.id === targetRowId);
    if (!sourceRow || !targetRow) return table;
    const nextRows = table.rows.map((row) => ({ ...row, inputNodeIds: Array.from({ length: referenceCount }, (_, index) => row.inputNodeIds[index] || "") }));
    const nextSource = nextRows.find((row) => row.id === sourceRowId)!;
    const nextTarget = nextRows.find((row) => row.id === targetRowId)!;
    const sourceNodeId = nextSource.inputNodeIds[sourceColumnIndex];
    if (!sourceNodeId) return table;
    const targetNodeId = nextTarget.inputNodeIds[targetColumnIndex];
    nextTarget.inputNodeIds[targetColumnIndex] = sourceNodeId;
    nextSource.inputNodeIds[sourceColumnIndex] = targetNodeId || "";
    return { ...table, rows: nextRows };
}

export function batchPromptForRow(table: CanvasBatchTableData, row: CanvasBatchRow) {
    // 电商创作：锁定块 + 配方。锁定块是叠加约束，不是覆盖，所以不走 globalPrompt 的覆盖语义。
    if (table.operation === "product") return composeProductPrompt(table.productLock, row.prompt);
    return table.globalPrompt?.trim() || row.prompt;
}

/** 表格里正在生效的提示词，供 UI 预览。 */
export function batchRowPromptPreview(table: CanvasBatchTableData, row: CanvasBatchRow) {
    return batchPromptForRow(table, row);
}

/** 任务类型的中文短名，用于输出节点标题和工作流标题。 */
export function batchOperationLabel(operation: CanvasBatchOperation) {
    if (operation === "try_on") return "换装";
    if (operation === "product") return "商品";
    return "创意";
}

export function batchRowReady(row: CanvasBatchRow, table: CanvasBatchTableData, nodes: Map<string, CanvasNodeData>) {
    if (!row.enabled || !batchPromptForRow(table, row).trim()) return false;
    const inputs = row.inputNodeIds.filter(Boolean);
    if (inputs.length < (table.operation === "try_on" ? 2 : 1)) return false;
    return inputs.every((id) => {
        const node = nodes.get(id);
        return node?.type === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
    });
}

export function batchGenerationRows(source: CanvasNodeData, nodes: CanvasNodeData[], requestedRowIds?: string[]) {
    const table = source.metadata?.batchTable;
    if (!table) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const active = new Set((source.metadata?.generationBatches || []).filter((batch) => batch.mode === "batch_image").flatMap((batch) => batch.items.filter((item) => ["waiting", "submitting", "queued", "running"].includes(item.status)).map((item) => item.nodeId)));
    const requested = requestedRowIds ? new Set(requestedRowIds) : null;
    return table.rows.filter((row) => {
        if ((requested && !requested.has(row.id)) || !batchRowReady(row, table, byId)) return false;
        const output = byId.get(row.outputNodeId || "");
        if (output && active.has(output.id)) return false;
        return Boolean(requested) || !Boolean(output?.metadata?.content || output?.metadata?.storageKey);
    });
}

export function batchInputColumns(node: CanvasNodeData, connections: CanvasConnection[]) {
    const columns = batchReferenceColumns(node.metadata?.batchTable);
    const indexById = new Map(columns.map((column, index) => [column.id, index]));
    const result = columns.map(() => [] as string[]);
    connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output" && !connection.toHandleId?.startsWith("batch-text:") && !connection.toHandleId?.startsWith("batch-cell:")).forEach((connection) => {
        const columnId = batchReferenceColumnId(connection.toHandleId);
        const index = columnId ? indexById.get(columnId) : 0;
        if (index === undefined || result[index].includes(connection.fromNodeId)) return;
        result[index].push(connection.fromNodeId);
    });
    return result;
}

export function createBatchRow(operation: CanvasBatchOperation, inputNodeIds: string[] = [], recipe?: CanvasBatchProductRecipe): CanvasBatchRow {
    if (operation === "product") {
        const resolved = recipe ?? DEFAULT_PRODUCT_RECIPE;
        return { id: `batch-row-${nanoid()}`, enabled: true, inputNodeIds, prompt: productRecipePrompt(resolved), recipe: resolved };
    }
    return {
        id: `batch-row-${nanoid()}`,
        enabled: true,
        inputNodeIds,
        prompt: operation === "try_on" ? TRY_ON_BATCH_PROMPT : CREATIVE_BATCH_PROMPT,
    };
}

/** 手工追加任务时沿用上一行的参考图，但重新使用当前任务类型的默认提示词。 */
export function createInheritedBatchRow(operation: CanvasBatchOperation, rows: CanvasBatchRow[]) {
    // 电商创作沿用上一行的配方——连续加同一类物料比每次都从主图重来更常见。
    return createBatchRow(operation, [...(rows.at(-1)?.inputNodeIds || [])], operation === "product" ? rows.at(-1)?.recipe : undefined);
}

/** 按稳定行 ID 插入，沿用前一行图片，不复制正文、任务状态或生成结果。 */
export function insertBatchRow(table: CanvasBatchTableData, afterRowId?: string) {
    const index = afterRowId === undefined ? table.rows.length - 1 : table.rows.findIndex((row) => row.id === afterRowId);
    if (afterRowId !== undefined && index < 0) return undefined;
    const row = createBatchRow(table.operation, [...(table.rows[index]?.inputNodeIds || [])]);
    row.referenceOverrides = table.rows[index]?.referenceOverrides ? [...table.rows[index].referenceOverrides!] : undefined;
    return { row, rows: [...table.rows.slice(0, index + 1), row, ...table.rows.slice(index + 1)] };
}

/**
 * Connected try-on inputs follow the reference layout: all model/person images first,
 * followed by one shared garment image. Users can still edit any row afterwards.
 */
export function createBatchRowsFromInputs(operation: CanvasBatchOperation, inputNodeIds: string[]) {
    if (operation === "creative") return inputNodeIds.map((id) => createBatchRow(operation, [id]));
    // 电商创作把全部输入当作同一件商品的多视角，合成一行；拆成多行会让模型以为是不同商品。
    if (operation === "product") return inputNodeIds.length ? [createBatchRow(operation, [...inputNodeIds])] : [];
    if (inputNodeIds.length < 2) return [];
    const garmentId = inputNodeIds.at(-1)!;
    return inputNodeIds.slice(0, -1).map((personId) => createBatchRow(operation, [personId, garmentId]));
}

/**
 * Zip equally sized columns and broadcast singleton columns across every row.
 *
 * 同步连线是增量操作：匹配到的行更新参考图，未被本次连线覆盖的手工行继续保留。
 * 这样用户在表格内追加或编辑的任务不会因为再次点击“同步连线”而被删除。
 */
export function createBatchRowsFromColumns(operation: CanvasBatchOperation, columns: string[][], previousRows: CanvasBatchRow[] = []) {
    const rowCount = Math.max(0, ...columns.map((column) => column.length));
    const unmatchedRows = [...previousRows];
    const synchronizedRows = Array.from({ length: rowCount }, (_, rowIndex) => {
        const inputNodeIds = columns.map((column) => {
            const input = column.length === 1 ? column[0] : column[rowIndex];
            return input || "";
        });
        let previousIndex = unmatchedRows.findIndex((row) => sameBatchInputs(row.inputNodeIds, inputNodeIds));
        if (previousIndex < 0 && inputNodeIds[0]) previousIndex = unmatchedRows.findIndex((row) => row.inputNodeIds[0] === inputNodeIds[0]);
        const previous = previousIndex >= 0 ? unmatchedRows.splice(previousIndex, 1)[0] : undefined;
        const inputsUnchanged = previous && previous.inputNodeIds.length === inputNodeIds.length && previous.inputNodeIds.every((id, index) => id === inputNodeIds[index]);
        return {
            ...createBatchRow(operation, inputNodeIds),
            ...(previous ? { id: previous.id, enabled: previous.enabled, prompt: previous.prompt, cells: previous.cells, textNodeIds: previous.textNodeIds } : {}),
            ...(previous?.outputNodeId ? { outputNodeId: previous.outputNodeId, ...(previous.generatedInputSignature ? { generatedInputSignature: previous.generatedInputSignature } : {}), ...(!inputsUnchanged || previous.inputChanged ? { inputChanged: true } : {}) } : {}),
            inputNodeIds,
        };
    });
    return [...synchronizedRows, ...unmatchedRows];
}

function sameBatchInputs(left: string[], right: string[]) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}
