import type { StudioCompiledPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import type { StudioOutput } from "@/lib/ecommerce-studio/types";
import { STUDIO_DETAIL_EDGE_DEPTH, STUDIO_DETAIL_OVERLAP, studioDetailEdgeColors } from "@/lib/ecommerce-studio/detail-seams";
import { getResourceBlob, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { commerceReferenceCropBounds } from "@/pages/ecommerce/long-reference-media";

function drawBackgroundSample(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, bitmap: ImageBitmap) {
    const rows = Math.ceil(bitmap.height * STUDIO_DETAIL_EDGE_DEPTH);
    const width = Math.min(bitmap.width, 768);
    canvas.width = width;
    canvas.height = rows;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, rows);
    context.drawImage(bitmap, 0, bitmap.height - rows, bitmap.width, rows, 0, 0, width, rows);
    const { data } = context.getImageData(0, 0, width, rows);
    const colors = studioDetailEdgeColors(data, width, rows);
    canvas.width = 640;
    canvas.height = 160;
    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    colors.forEach((color, index) => gradient.addColorStop((index + 0.5) / colors.length, `rgb(${color.join(", ")})`));
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
}

export async function studioContinuityReference(output: StudioOutput, continuity: NonNullable<StudioCompiledPrompt["continuity"]>, scope: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const source = await getResourceBlob(resourceStorageKey(output.resourceId), "ecommerce-export", signal);
    signal.throwIfAborted();
    if (!source) throw new Error("上一屏成品无法读取，不能准备衔接参考");
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    try {
        signal.throwIfAborted();
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法处理衔接参考图");
        const background = continuity.guide === "background";
        const positioned = continuity.guide === "positioned";
        const edge = continuity.guide === "edge";
        const scene = continuity.guide === "context";
        let anchor: typeof continuity.anchor;
        if (background) {
            drawBackgroundSample(canvas, context, bitmap);
            anchor = { sourceResourceId: output.resourceId };
        } else {
            const { y, cropHeight, width, height } = commerceReferenceCropBounds(bitmap.width, bitmap.height, scene ? 0.5 : edge || continuity.overlap ? 1 - STUDIO_DETAIL_OVERLAP : 0.75, 1);
            canvas.width = width;
            canvas.height = positioned ? Math.round((bitmap.height * width) / bitmap.width) : height;
            context.drawImage(bitmap, 0, y, bitmap.width, cropHeight, 0, 0, width, height);
            if (positioned) anchor = { sourceResourceId: output.resourceId, height };
            if (edge || scene) anchor = { sourceResourceId: output.resourceId };
        }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("衔接参考图导出失败"))), "image/png"));
        const name = `第 ${continuity.previousScreen} 屏${scene ? "下半幅" : background ? "衔接色样" : positioned ? "下缘底稿" : "下缘"}.png`;
        const version = scene ? "v7" : background ? "v6" : edge ? "v5" : positioned ? "v3" : continuity.overlap ? "v2" : "v1";
        const resource = await uploadResourceFile(blob, "image", { width: canvas.width, height: canvas.height, fileName: name, idempotencyKey: `studio-detail-edge-${version}:${output.resourceId}` }, undefined, { expectedScope: scope, signal });
        if (!resource.id || resource.kind !== "image" || resource.status !== "ready") throw new Error("衔接参考图尚未保存，请重试");
        return {
            reference: { id: `continuity-${continuity.previousScreen}`, resourceId: resource.id, name, width: canvas.width, height: canvas.height, url: "", view: "other" as const, truth: false, addedAt: "" },
            ...(anchor ? { anchor } : {}),
        };
    } finally {
        bitmap.close();
        canvas.width = canvas.height = 0;
    }
}
