import { getActiveUserScope } from "@/lib/user-scope";
import { observeCanvasGestureActive } from "@/lib/canvas/canvas-live-viewport";

const MAX_ACTIVE_IMAGE_PREPARATIONS = 4;
const IMAGE_PREPARATION_TIMEOUT_MS = 60_000;
const MAX_CACHED_IMAGES = 48;
const MAX_CACHED_PIXELS = 16_000_000;
const IMAGE_CACHE_TTL_MS = 60_000;

export type CanvasImagePriority = "visible" | "background";
type SharedPreparation = { controller: AbortController; work: ImagePreparationJob; promise: Promise<HTMLImageElement>; consumers: number; visibleConsumers: number };
const preparations = new Map<string, SharedPreparation>();
const preparedImages = new Map<string, { image: HTMLImageElement; pixels: number; expiresAt: number }>();
let preparedPixels = 0;
let preparationScope = "";

/** Share work across nodes and LOD remounts without letting one consumer cancel the others. */
export function prepareCanvasImage(src: string, signal: AbortSignal, timeoutMs = IMAGE_PREPARATION_TIMEOUT_MS, priority: CanvasImagePriority = "visible"): Promise<HTMLImageElement> {
    if (signal.aborted) return Promise.reject(abortError());
    const scope = getActiveUserScope();
    if (scope !== preparationScope) {
        preparationScope = scope;
        preparedImages.clear();
        preparedPixels = 0;
        for (const pending of preparations.values()) pending.controller.abort();
        preparations.clear();
    }
    for (const [key, value] of preparedImages) {
        if (value.expiresAt <= Date.now()) {
            preparedPixels -= value.pixels;
            preparedImages.delete(key);
        }
    }
    const cached = preparedImages.get(src);
    if (cached) {
        preparedImages.delete(src);
        preparedImages.set(src, cached);
        return Promise.resolve(cached.image);
    }
    let pending = preparations.get(src);
    if (!pending) {
        const controller = new AbortController();
        const { work, promise } = enqueueCanvasImage(src, controller.signal, timeoutMs, priority);
        const entry: SharedPreparation = { controller, work, consumers: 0, visibleConsumers: 0, promise };
        entry.promise = entry.promise
            .then((image) => {
                if (controller.signal.aborted || scope !== getActiveUserScope() || preparations.get(src) !== entry) throw abortError();
                const pixels = image.naturalWidth * image.naturalHeight;
                if (pixels > 0 && pixels <= MAX_CACHED_PIXELS && !src.startsWith("blob:")) {
                    while (preparedImages.size >= MAX_CACHED_IMAGES || preparedPixels + pixels > MAX_CACHED_PIXELS) {
                        const oldest = preparedImages.keys().next().value;
                        if (oldest === undefined) break;
                        preparedPixels -= preparedImages.get(oldest)!.pixels;
                        preparedImages.delete(oldest);
                    }
                    preparedImages.set(src, { image, pixels, expiresAt: Date.now() + IMAGE_CACHE_TTL_MS });
                    preparedPixels += pixels;
                }
                return image;
            })
            .finally(() => {
                if (preparations.get(src) === entry) preparations.delete(src);
            });
        pending = entry;
        preparations.set(src, pending);
    }
    const shared = pending;
    shared.consumers += 1;
    if (priority === "visible" && ++shared.visibleConsumers === 1) setQueuedPriority(shared.work, "visible");
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (image?: HTMLImageElement, error?: unknown) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            shared.consumers -= 1;
            if (priority === "visible" && --shared.visibleConsumers === 0 && shared.consumers) setQueuedPriority(shared.work, "background");
            if (error !== undefined) reject(error);
            else resolve(image!);
        };
        const onAbort = () => {
            finish(undefined, abortError());
            // React can immediately remount the same image. Allow that consumer
            // to join before cancelling an otherwise unreferenced job.
            queueMicrotask(() => {
                if (shared.consumers === 0 && preparations.get(src) === shared) {
                    preparations.delete(src);
                    shared.controller.abort();
                }
            });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        shared.promise.then(
            (image) => finish(image),
            (error) => finish(undefined, error),
        );
    });
}

type ImagePreparationJob = {
    src: string;
    signal: AbortSignal;
    resolve: (image: HTMLImageElement) => void;
    reject: (error: unknown) => void;
    started: boolean;
    settled: boolean;
    image?: HTMLImageElement;
    timeout?: ReturnType<typeof setTimeout>;
    timeoutMs: number;
    priority: CanvasImagePriority;
    onAbort: () => void;
};

const queues = { visible: new Set<ImagePreparationJob>(), background: new Set<ImagePreparationJob>() };
let activePreparations = 0;
let pumpScheduled = false;
let gestureActive = false;
let observingGestures = false;

// 正在真正下载/解码的图片地址（受并发上限约束，最多 MAX_ACTIVE_IMAGE_PREPARATIONS 个）。
// 加载骨架只给这些节点播放微光：排队中的上百个节点若同时播放整块尺寸的动画图层，平移缩放会明显掉帧。
const activeSources = new Map<string, number>();
const activeListeners = new Map<string, Set<() => void>>();

function markActiveSource(src: string, delta: 1 | -1) {
    const previous = activeSources.get(src) || 0;
    const next = previous + delta;
    if (next > 0) activeSources.set(src, next);
    else activeSources.delete(src);
    if (Boolean(previous) !== Boolean(next)) activeListeners.get(src)?.forEach((listener) => listener());
}

export function subscribeCanvasImageActivity(src: string, listener: () => void) {
    if (!src) return () => {};
    const listeners = activeListeners.get(src) ?? new Set<() => void>();
    listeners.add(listener);
    activeListeners.set(src, listeners);
    return () => {
        listeners.delete(listener);
        if (!listeners.size) activeListeners.delete(src);
    };
}

export function isCanvasImageActive(src: string) {
    return Boolean(src && activeSources.has(src));
}

function setQueuedPriority(job: ImagePreparationJob, priority: CanvasImagePriority) {
    if (job.priority === priority || job.started || job.settled) return;
    queues[job.priority].delete(job);
    job.priority = priority;
    queues[priority].add(job);
}

function enqueueCanvasImage(src: string, signal: AbortSignal, timeoutMs: number, priority: CanvasImagePriority) {
    if (!observingGestures && typeof document !== "undefined") {
        observingGestures = true;
        observeCanvasGestureActive(document, (active) => {
            gestureActive = active;
            if (!active) schedulePump();
        });
    }
    let job!: ImagePreparationJob;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
        job = { src, signal, resolve, reject, started: false, settled: false, priority, timeoutMs, onAbort: () => {} };
        job.onAbort = () => {
            if (job.settled) return;
            if (!job.started) {
                queues[job.priority].delete(job);
                settle(job, undefined, abortError());
                return;
            }
            job.image?.removeAttribute("src");
            settle(job, undefined, abortError());
        };
        signal.addEventListener("abort", job.onAbort, { once: true });
        queues[priority].add(job);
        schedulePump();
    });
    return { work: job, promise };
}

export function canvasImagePreparationStats() {
    return { active: activePreparations, queued: queues.visible.size + queues.background.size, limit: MAX_ACTIVE_IMAGE_PREPARATIONS };
}

function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(pump);
}

function pump() {
    pumpScheduled = false;
    const limit = gestureActive ? 1 : MAX_ACTIVE_IMAGE_PREPARATIONS;
    while (activePreparations < limit) {
        const queue = queues.visible.size ? queues.visible : queues.background;
        const job = queue.values().next().value;
        if (!job) break;
        queue.delete(job);
        if (job.settled || job.signal.aborted) {
            settle(job, undefined, abortError());
            continue;
        }
        job.started = true;
        activePreparations += 1;
        markActiveSource(job.src, 1);
        job.timeout = setTimeout(() => {
            job.image?.removeAttribute("src");
            settle(job, undefined, new Error("图片加载或解码超时"));
        }, job.timeoutMs);

        try {
            const image = new Image();
            job.image = image;
            image.decoding = "async";
            image.onload = () => {
                if (job.settled || job.signal.aborted) return;
                image.onload = null;
                void image.decode().then(
                    () => settle(job, image),
                    (error) => settle(job, undefined, error),
                );
            };
            image.onerror = () => settle(job, undefined, new Error("图片加载失败"));
            image.src = job.src;
            if (image.complete && image.naturalWidth > 0) image.onload?.call(image, new Event("load"));
        } catch (error) {
            settle(job, undefined, error);
        }
    }
}

function settle(job: ImagePreparationJob, image?: HTMLImageElement, error?: unknown) {
    if (job.settled) return;
    job.settled = true;
    job.signal.removeEventListener("abort", job.onAbort);
    if (job.timeout) clearTimeout(job.timeout);
    if (job.image) {
        job.image.onload = null;
        job.image.onerror = null;
    }
    if (job.started) {
        activePreparations = Math.max(0, activePreparations - 1);
        markActiveSource(job.src, -1);
        schedulePump();
    }
    if (error !== undefined) job.reject(error);
    else if (image) job.resolve(image);
    else job.reject(new Error("图片准备未完成"));
}

function abortError() {
    return new DOMException("图片准备已取消", "AbortError");
}
