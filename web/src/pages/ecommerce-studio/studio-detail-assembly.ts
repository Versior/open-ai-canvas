import { STUDIO_DETAIL_EDGE_DEPTH, STUDIO_DETAIL_OVERLAP, studioBackgroundJoin, studioDetailJoinGuide, verifiedStudioOverlap, type StudioEdgeStatus } from "@/lib/ecommerce-studio/detail-seams";
import type { StudioComposedShot } from "./studio-delivery";

export type StudioDetailJoin = { afterScreen: number; status: StudioEdgeStatus; removedRows: number };

async function readBitmap(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("详情页成品读取失败");
    return createImageBitmap(await response.blob());
}

function readBands(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, before: ImageBitmap, after: ImageBitmap, width: number, height: number, bottomRows: number, topRows: number) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(before, 0, before.height - bottomRows, before.width, bottomRows, 0, 0, width, height);
    const bottom = context.getImageData(0, 0, width, height).data;
    context.clearRect(0, 0, width, height);
    context.drawImage(after, 0, 0, after.width, topRows, 0, 0, width, height);
    return { bottom, top: context.getImageData(0, 0, width, height).data };
}

async function inspectJoin(previous: StudioComposedShot, current: StudioComposedShot, guide: ReturnType<typeof studioDetailJoinGuide>, signal?: AbortSignal): Promise<Omit<StudioDetailJoin, "afterScreen"> & { blob?: Blob }> {
    const before = await readBitmap(previous.url, signal);
    let after: ImageBitmap | undefined;
    const canvas = document.createElement("canvas");
    try {
        after = await readBitmap(current.url, signal);
        signal?.throwIfAborted();
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("浏览器无法读取详情页的衔接像素");
        let removedRows = 0;
        if (guide?.kind === "positioned" && before.width === after.width) {
            const rows = Math.round((guide.height * after.width) / guide.width);
            if (rows >= 8 && after.width >= 16 && rows <= Math.ceil(Math.min(before.height, after.height) * STUDIO_DETAIL_OVERLAP) + 1) {
                const { bottom, top } = readBands(canvas, context, before, after, after.width, rows, rows, rows);
                if (verifiedStudioOverlap(bottom, top, after.width, rows)) removedRows = rows;
            }
        }
        if (!removedRows) {
            const edgeRows = Math.min(48, Math.floor(after.height * STUDIO_DETAIL_EDGE_DEPTH), Math.floor((before.height * STUDIO_DETAIL_EDGE_DEPTH * after.width) / before.width));
            const originalRows = Math.round((edgeRows * before.width) / after.width);
            if (edgeRows < 8 || originalRows < 8 || after.width < 16) return { status: "unmatched", removedRows: 0 };
            const { bottom, top } = readBands(canvas, context, before, after, after.width, edgeRows, originalRows, edgeRows);
            return { ...studioBackgroundJoin(bottom, top, after.width, edgeRows), removedRows: 0 };
        }
        canvas.width = after.width;
        canvas.height = after.height - removedRows;
        context.drawImage(after, 0, removedRows, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("详情页衔接像素导出失败"))), "image/png"));
        signal?.throwIfAborted();
        return { status: "matched", removedRows, blob };
    } finally {
        before.close();
        after?.close();
        canvas.width = canvas.height = 0;
    }
}

export async function prepareStudioDetailAssembly(shots: readonly StudioComposedShot[], signal?: AbortSignal, inspectAll = false) {
    const imageUrls = shots.map((shot) => shot.url);
    const joins: StudioDetailJoin[] = [];
    const created: string[] = [];
    const release = () => created.forEach((url) => URL.revokeObjectURL(url));
    try {
        for (let index = 1; index < shots.length; index++) {
            signal?.throwIfAborted();
            const previous = shots[index - 1];
            const current = shots[index];
            if (previous.composed || current.composed) continue;
            const guide = studioDetailJoinGuide(current.shot, current.output.resourceId, previous.output.resourceId, index);
            if (!guide && !inspectAll) continue;
            const { blob, ...join } = await inspectJoin(previous, current, guide, signal);
            joins.push({ afterScreen: index, ...join });
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            created.push(url);
            imageUrls[index] = url;
        }
        return { imageUrls, joins, release };
    } catch (error) {
        release();
        throw error;
    }
}
