import { createZip } from "@/lib/zip";
import { downloadName } from "@/lib/media-package";
import { getImageBlob } from "@/services/image-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { EcommerceSuiteRow } from "@/lib/ecommerce/ecommerce-suite";
import type { EcommerceCopy } from "@/lib/ecommerce/ecommerce-contract";
import { ecommerceLayoutVisibleBlocks, type EcommerceLayout } from "@/lib/ecommerce/ecommerce-layout";
import { ecommerceResultTextMode, rasterizeEcommerceComposition } from "@/lib/ecommerce/ecommerce-rasterize";
import type { CanvasNodeData } from "@/types/canvas";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";

type ComposeSuiteImage = (blob: Blob, copy: EcommerceCopy, layout: EcommerceLayout) => Promise<Blob>;
type EcommerceSuiteArchiveOptions = {
    readBlob?: typeof getImageBlob;
    readTask?: typeof queryGenerationTask;
    compose?: ComposeSuiteImage;
    assertSourceCurrent?: () => void;
};
// createZip 会同时持有源 Blob、Uint8Array 与 ZIP 输出，限制输入以避免浏览器内存峰值失控。
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

async function composeSuiteImage(blob: Blob, copy: EcommerceCopy, layout: EcommerceLayout) {
    const sourceUrl = URL.createObjectURL(blob);
    try {
        const dataUrl = await rasterizeEcommerceComposition({ imageUrl: sourceUrl, copy, layout });
        const composed = await (await fetch(dataUrl)).blob();
        if (composed.type !== "image/png") throw new Error("排版合成结果不是 PNG");
        return composed;
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

/** Export only the chosen outputs and explicit metadata; never serialize node config. */
export async function buildEcommerceSuiteArchive(rows: EcommerceSuiteRow[], nodeBySlot: Map<string, CanvasNodeData>, options: EcommerceSuiteArchiveOptions = {}) {
    const { readBlob = getImageBlob, readTask = queryGenerationTask, compose = composeSuiteImage, assertSourceCurrent } = options;
    const scope = getActiveUserScope();
    const validateSource = () => {
        if (scope !== getActiveUserScope()) throw new Error("账号已切换，已取消导出");
        assertSourceCurrent?.();
    };
    validateSource();
    const files: { name: string; data: BlobPart }[] = [];
    const entries: {
        slotId: string;
        title: string;
        planning: { duty: string; prompt: string };
        generation: { status: "verified-task" | "unavailable"; taskId?: string; prompt?: string; model?: string; completedAt?: string; runId?: string };
        file: string;
        nodeId: string;
        width?: number;
        height?: number;
        bytes: number;
        copy?: EcommerceCopy;
        layout?: EcommerceLayout;
        composition: { applied: boolean };
        review: string;
    }[] = [];
    const tasks = new Map<string, GenerationTask>();
    let totalBytes = 0;
    for (const [index, row] of rows.filter((item) => item.enabled !== false).entries()) {
        const node = nodeBySlot.get(row.slotId);
        if (row.resultNodeId && node?.id !== row.resultNodeId) throw new Error(`第 ${index + 1} 张所选结果已变化，请重新选择`);
        if (!node?.metadata?.storageKey || node.metadata.status === "loading" || node.metadata.status === "error") throw new Error(`第 ${index + 1} 张尚无可导出的成功图片，请完成生成或选择有效结果`);
        const taskId = node.metadata.taskId;
        let task: GenerationTask | undefined;
        if (taskId) {
            task = tasks.get(taskId);
            if (!task) {
                task = await readTask(taskId);
                validateSource();
            }
            if (task.id !== taskId || task.status !== "succeeded") throw new Error(`第 ${index + 1} 张的生成任务未成功，请刷新结果后重试`);
            tasks.set(taskId, task);
        }
        const original = await readBlob(node.metadata.storageKey);
        validateSource();
        if (!original || !["image/png", "image/jpeg", "image/webp"].includes(original.type)) throw new Error(`第 ${index + 1} 张原图缺失或格式不支持`);
        if (totalBytes + original.size > MAX_ARCHIVE_BYTES) throw new Error("套图超过 64MB，请分批导出");
        const { copy, layout } = row;
        // 只有明确 local 才本地叠字；model 的像素里已有字，unknown 不敢动。
        // 版式一个字都排不出来时合成只是把原图转一次 PNG，空转还掉画质，按未合成交付。
        const applied = Boolean(copy && layout) && ecommerceResultTextMode(node) === "local" && ecommerceLayoutVisibleBlocks(layout, copy).length > 0;
        let blob = original;
        if (copy && layout && applied) {
            blob = await compose(original, copy, layout);
            validateSource();
        }
        if (applied && blob.type !== "image/png") throw new Error(`第 ${index + 1} 张排版合成结果不是 PNG`);
        totalBytes += blob.size;
        if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error("套图超过 64MB，请分批导出");
        const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
        const file = `images/${String(index + 1).padStart(2, "0")}_${downloadName(row.title)}.${extension}`;
        files.push({ name: file, data: blob });
        entries.push({
            slotId: row.slotId,
            title: row.title,
            planning: { duty: row.duty, prompt: row.prompt },
            generation: task ? { status: "verified-task", taskId: task.id, prompt: task.prompt, model: task.model, completedAt: task.completedAt, runId: node.metadata.ecommerceRunId } : { status: "unavailable", runId: node.metadata.ecommerceRunId },
            file,
            nodeId: node.id,
            width: node.metadata.naturalWidth,
            height: node.metadata.naturalHeight,
            bytes: blob.size,
            copy,
            layout,
            composition: { applied },
            review: "待人工核对商品真实性、文案和平台要求",
        });
    }
    if (!entries.length) throw new Error("没有可导出的图片");
    files.push({ name: "manifest.json", data: JSON.stringify({ format: "yingce.ecommerce-suite", version: 3, exportedAt: new Date().toISOString(), entries }, null, 2) });
    validateSource();
    const archive = await createZip(files);
    validateSource();
    return archive;
}
