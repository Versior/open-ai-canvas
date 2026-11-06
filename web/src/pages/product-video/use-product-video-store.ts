import { create } from "zustand";
import { getActiveUserScope } from "@/lib/user-scope";
import type { ProductVideoJob } from "@/lib/product-video/job";
import { deleteProductVideo, getProductVideo, listProductVideos, PRODUCT_VIDEO_CONFLICT, saveProductVideo } from "@/services/api/product-video";

/**
 * 商品视频作品列表。每次修改记成一个操作（updater），本地立刻显示，再按作品逐个排队保存：
 * 保存时把还没确认的操作套在服务端最后确认的版本上，按 revision 比较交换。另一个窗口先写了会收到冲突，
 * 这时取回最新版本把操作重新套上去再保存，双方的修改都保留。
 */

type Updater = (job: ProductVideoJob) => ProductVideoJob;

type State = {
    scope: string;
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
    jobs: ProductVideoJob[];
};

export const useProductVideoStore = create<State>(() => ({ scope: "", status: "idle", jobs: [] }));

const MAX_CONFLICT_RETRIES = 3;
/** 服务端最后确认的版本；新建还没保存过的作品没有。 */
const confirmed = new Map<string, ProductVideoJob>();
const pending = new Map<string, Updater[]>();
const saving = new Map<string, Promise<void>>();
let loading: Promise<void> | undefined;

function reason(error: unknown) {
    return (error as { reason?: string } | null)?.reason;
}

/** 新作品还没保存过时的初始版本。 */
const drafts = new Map<string, ProductVideoJob>();

function fold(id: string, updaters = pending.get(id) || []): ProductVideoJob | undefined {
    const base = confirmed.get(id) || drafts.get(id);
    return base ? updaters.reduce((job, updater) => updater(job), base) : undefined;
}

function publish(id: string) {
    const next = fold(id);
    useProductVideoStore.setState((state) => {
        const exists = state.jobs.some((job) => job.id === id);
        if (!next) return { jobs: state.jobs.filter((job) => job.id !== id) };
        return { jobs: exists ? state.jobs.map((job) => (job.id === id ? next : job)) : [next, ...state.jobs] };
    });
}

function resetIfScopeChanged() {
    const scope = getActiveUserScope();
    if (useProductVideoStore.getState().scope === scope) return scope;
    confirmed.clear();
    drafts.clear();
    pending.clear();
    saving.clear();
    loading = undefined;
    useProductVideoStore.setState({ scope, status: "idle", error: undefined, jobs: [] });
    return scope;
}

export function loadProductVideos(force = false) {
    const scope = resetIfScopeChanged();
    if (loading && !force) return loading;
    useProductVideoStore.setState({ status: "loading", error: undefined });
    loading = listProductVideos()
        .then((items) => {
            if (getActiveUserScope() !== scope) return;
            for (const item of items) confirmed.set(item.id, item);
            const ids = new Set(items.map((item) => item.id));
            // 还没保存完的本地新作品保留在列表里。
            const local = useProductVideoStore.getState().jobs.filter((job) => !ids.has(job.id) && pending.get(job.id)?.length);
            const merged = [...items.map((item) => fold(item.id) || item), ...local];
            merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            useProductVideoStore.setState({ status: "ready", jobs: merged });
        })
        .catch((error) => {
            loading = undefined;
            if (getActiveUserScope() !== scope) return;
            useProductVideoStore.setState({ status: "error", error: error instanceof Error ? error.message : "作品列表读取失败" });
        });
    return loading;
}

export function readProductVideo(id: string) {
    return useProductVideoStore.getState().jobs.find((job) => job.id === id);
}

async function persist(id: string, scope: string) {
    for (let conflicts = 0; ;) {
        const updaters = pending.get(id) || [];
        const next = fold(id, updaters);
        if (!next || (!updaters.length && confirmed.has(id))) return;
        try {
            const saved = await saveProductVideo(next, confirmed.get(id)?.revision ?? 0);
            if (getActiveUserScope() !== scope) return;
            confirmed.set(id, saved);
            drafts.delete(id);
            pending.set(id, (pending.get(id) || []).slice(updaters.length));
            publish(id);
        } catch (error) {
            if (getActiveUserScope() !== scope) return;
            if (reason(error) === PRODUCT_VIDEO_CONFLICT && conflicts < MAX_CONFLICT_RETRIES) {
                conflicts += 1;
                confirmed.set(id, await getProductVideo(id));
                continue;
            }
            throw error;
        }
    }
}

/**
 * 修改一条作品并保存到服务端；返回的 Promise 在这次修改落到服务端后完成，保存失败时抛错
 * （本地仍显示修改，下一次修改会连同它一起再保存）。
 */
export function updateProductVideo(id: string, updater: Updater): Promise<void> {
    const scope = resetIfScopeChanged();
    const stamped: Updater = (job) => ({ ...updater(job), updatedAt: new Date().toISOString() });
    pending.set(id, [...(pending.get(id) || []), stamped]);
    publish(id);
    const previous = saving.get(id) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => persist(id, scope));
    saving.set(id, next);
    return next;
}

/** 新建作品：先记成草稿版本，保存时 expectedRevision 为 0。 */
export function createProductVideo(job: ProductVideoJob) {
    resetIfScopeChanged();
    drafts.set(job.id, job);
    return updateProductVideo(job.id, (value) => value);
}

export async function removeProductVideo(id: string) {
    const scope = resetIfScopeChanged();
    await (saving.get(id) || Promise.resolve()).catch(() => undefined);
    await deleteProductVideo(id);
    if (getActiveUserScope() !== scope) return;
    confirmed.delete(id);
    drafts.delete(id);
    pending.delete(id);
    saving.delete(id);
    useProductVideoStore.setState((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
}
