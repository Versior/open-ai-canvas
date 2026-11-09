import { createClientId } from "@/lib/client-id";
import { normalizeProductVideoJob, normalizeProductVideoSegment, type ProductVideoJob, type ProductVideoSegment } from "@/lib/product-video/job";
import { normalizeRemakeJob, REMAKE_VERSION, type RemakeJob } from "@/lib/remake/job";
import { http } from "./request";
import type { GenerationTask } from "./task-center";

/** 作品已在其他窗口修改；details.revision 是服务端当前的作品修订号。 */
export const PRODUCT_VIDEO_CONFLICT = "product_video_conflict";

/** 作品列表里有两种记录：复刻工作台的作品（version 2）和元素替换的旧作品（没有 version）。 */
export type StoredWork = ProductVideoJob | RemakeJob;

export function normalizeStoredWork(value: unknown): StoredWork | undefined {
    if (value && typeof value === "object" && ["fashion", "fashion-video"].includes(String((value as { kind?: unknown }).kind))) return undefined;
    const version = value && typeof value === "object" ? (value as { version?: unknown }).version : undefined;
    return version === REMAKE_VERSION ? normalizeRemakeJob(value) : normalizeProductVideoJob(value);
}

export async function listProductVideos(signal?: AbortSignal): Promise<StoredWork[]> {
    const data = await http.get<{ revision: number; items: unknown[] }>("/ecommerce/product-videos", { signal, timeout: 15000 });
    return (Array.isArray(data.items) ? data.items : []).map(normalizeStoredWork).filter((item): item is StoredWork => Boolean(item));
}

export async function getProductVideo(id: string, signal?: AbortSignal): Promise<StoredWork> {
    const data = await http.get<{ revision: number; item: unknown }>(`/ecommerce/product-videos/${encodeURIComponent(id)}`, { signal });
    const item = normalizeStoredWork(data.item);
    if (!item) throw new Error("服务端返回的作品数据无法识别");
    return item;
}

/** 按 expectedRevision 比较交换保存整条作品；返回服务端写入后的版本（带新的 revision）。 */
export async function saveProductVideo(job: StoredWork, expectedRevision: number): Promise<StoredWork> {
    const { revision: _revision, ...item } = job;
    const data = await http.put<{ revision: number; item: unknown }>(`/ecommerce/product-videos/${encodeURIComponent(job.id)}`, { item, expectedRevision });
    const saved = normalizeStoredWork(data.item);
    if (!saved) throw new Error("服务端返回的作品数据无法识别");
    return saved;
}

export async function deleteProductVideo(id: string) {
    await http.delete<{ revision: number }>(`/ecommerce/product-videos/${encodeURIComponent(id)}`);
}

/** ranges 不为空时按给定的几段原样切（复刻工作台的换元素单元），不检测切点。 */
export type ProductVideoSplitRequest = { resourceId: string; startMs: number; endMs: number; maxSegmentSeconds: number; ranges?: { startMs: number; endMs: number }[] };

/** 创建参考视频切段任务。idempotencyKey 由调用方先记进作品再提交，刷新后重放拿回同一个任务。 */
export async function createProductVideoSplit(payload: ProductVideoSplitRequest, idempotencyKey = createClientId(), signal?: AbortSignal): Promise<GenerationTask> {
    return http.post<GenerationTask>("/ecommerce/product-videos/splits", payload, { signal, headers: { "X-Idempotency-Key": idempotencyKey } });
}

export type ProductVideoSplitResult = { startMs: number; endMs: number; hasAudio: boolean; segments: ProductVideoSegment[]; warnings: string[] };

export function parseProductVideoSplitResult(task: GenerationTask): ProductVideoSplitResult {
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(task.resultJson || "") as Record<string, unknown>;
    } catch {
        throw new Error("参考视频切段结果无效");
    }
    const segments = (Array.isArray(raw.segments) ? raw.segments : []).map(normalizeProductVideoSegment).filter((item): item is ProductVideoSegment => Boolean(item));
    if (!segments.length) throw new Error("参考视频没有切出可用的片段");
    const source = raw.source && typeof raw.source === "object" ? (raw.source as Record<string, unknown>) : {};
    return {
        startMs: Number(raw.startMs) || 0,
        endMs: Number(raw.endMs) || 0,
        hasAudio: source.hasAudio === true,
        segments,
        warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((item): item is string => typeof item === "string") : [],
    };
}
