import { create } from "zustand";
import { getActiveUserScope } from "@/lib/user-scope";
import type { ProductVideoJob } from "@/lib/product-video/job";
import { isRemakeJob, type RemakeJob } from "@/lib/remake/job";
import { deleteProductVideo, getProductVideo, listProductVideos, PRODUCT_VIDEO_CONFLICT, saveProductVideo, type StoredWork } from "@/services/api/product-video";

/**
 * 商品视频作品列表。每次修改记成一个操作（updater），本地立刻显示，再按作品逐个排队保存：
 * 保存时把还没确认的操作套在服务端最后确认的版本上，按 revision 比较交换。另一个窗口先写了会收到冲突，
 * 这时取回最新版本把操作重新套上去再保存，双方的修改都保留。
 */

type Updater = (job: StoredWork) => StoredWork;

type State = {
    scope: string;
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
    jobs: StoredWork[];
};

export const useProductVideoStore = create<State>(() => ({ scope: "", status: "idle", jobs: [] }));

const MAX_CONFLICT_RETRIES = 3;
/** 服务端最后确认的版本；新建还没保存过的作品没有。 */
const confirmed = new Map<string, StoredWork>();
const pending = new Map<string, Updater[]>();
const saving = new Map<string, Promise<unknown>>();
const itemRevisions = new Map<string, number>();
let listRevision = -1;
let listRequest = 0;
let loading: Promise<void> | undefined;

function reason(error: unknown) {
    return (error as { reason?: string } | null)?.reason;
}

/** 新作品还没保存过时的初始版本。 */
const drafts = new Map<string, StoredWork>();

function fold(id: string, updaters = pending.get(id) || []): StoredWork | undefined {
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
    itemRevisions.clear();
    listRevision = -1;
    listRequest++;
    loading = undefined;
    useProductVideoStore.setState({ scope, status: "idle", error: undefined, jobs: [] });
    return scope;
}

export function loadProductVideos(force = false) {
    const scope = resetIfScopeChanged();
    if (loading && !force) return loading;
    const request = ++listRequest;
    useProductVideoStore.setState({ status: "loading", error: undefined });
    loading = listProductVideos()
        .then(({ items, revision }) => {
            if (request !== listRequest || getActiveUserScope() !== scope) return;
            if (revision >= listRevision) {
                listRevision = revision;
                const ids = new Set(items.map((item) => item.id));
                for (const item of items) {
                    if ((itemRevisions.get(item.id) ?? -1) <= revision) confirmed.set(item.id, item);
                }
                for (const id of confirmed.keys()) if (!ids.has(id) && (itemRevisions.get(id) ?? -1) <= revision) confirmed.delete(id);
                for (const [id, itemRevision] of itemRevisions) if (itemRevision <= revision) itemRevisions.delete(id);
            }
            const merged = [...new Set([...confirmed.keys(), ...drafts.keys()])].map((id) => fold(id)).filter((item): item is StoredWork => Boolean(item));
            merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            useProductVideoStore.setState({ status: "ready", jobs: merged });
        })
        .catch((error) => {
            if (request !== listRequest || getActiveUserScope() !== scope) return;
            loading = undefined;
            useProductVideoStore.setState({ status: "error", error: error instanceof Error ? error.message : "作品列表读取失败" });
        });
    return loading;
}

export function readStoredWork(id: string) {
    return useProductVideoStore.getState().jobs.find((job) => job.id === id);
}

/** 元素替换旧作品；是复刻工作台的作品时返回 undefined。 */
export function readProductVideo(id: string): ProductVideoJob | undefined {
    const job = readStoredWork(id);
    return job && !isRemakeJob(job) ? job : undefined;
}

export function readRemake(id: string): RemakeJob | undefined {
    const job = readStoredWork(id);
    return isRemakeJob(job) ? job : undefined;
}

function acceptWork(id: string, revision: number, item?: StoredWork) {
    if (revision < Math.max(listRevision, itemRevisions.get(id) ?? -1)) return;
    itemRevisions.set(id, revision);
    if (item) confirmed.set(id, item);
    else confirmed.delete(id);
}

async function persist(id: string, scope: string, edit?: Updater) {
    for (let conflicts = 0; ;) {
        if (getActiveUserScope() !== scope) throw new DOMException("账号已切换，修改未应用", "AbortError");
        const updaters = pending.get(id) || [];
        const base = fold(id, updaters);
        if (!base || (!edit && !updaters.length && confirmed.has(id))) return;
        const next = edit ? edit(base) : base;
        try {
            const saved = await saveProductVideo(next, confirmed.get(id)?.revision ?? 0);
            if (getActiveUserScope() !== scope) throw new DOMException("账号已切换，修改未应用", "AbortError");
            acceptWork(id, saved.revision, saved.item);
            drafts.delete(id);
            pending.set(id, (pending.get(id) || []).slice(updaters.length));
            publish(id);
            if (edit) return confirmed.get(id);
        } catch (error) {
            if (getActiveUserScope() !== scope) throw new DOMException("账号已切换，修改未应用", "AbortError");
            if (reason(error) === PRODUCT_VIDEO_CONFLICT && conflicts < MAX_CONFLICT_RETRIES) {
                conflicts += 1;
                const result = await getProductVideo(id);
                if (getActiveUserScope() !== scope) throw new DOMException("账号已切换，修改未应用", "AbortError");
                acceptWork(id, result.revision, result.item);
                if (edit) publish(id);
                continue;
            }
            throw error;
        }
    }
}

function enqueueSave<T>(id: string, perform: () => Promise<T>) {
    const previous = saving.get(id) || Promise.resolve();
    const next = previous.catch(() => undefined).then(perform);
    saving.set(id, next);
    return next;
}

/** 配方草稿由编辑器展示；冲突时不把拒绝的修改留在全局队列，其他窗口的已确认版本仍可读取。 */
export function saveEditedRecipe(id: string, edit: (job: RemakeJob) => RemakeJob) {
    const scope = resetIfScopeChanged();
    return enqueueSave(id, async () => {
        const saved = await persist(id, scope, (base) => {
            if (!isRemakeJob(base)) throw new Error("作品不是复刻配方");
            return { ...edit(base), updatedAt: new Date().toISOString() };
        });
        if (!isRemakeJob(saved)) throw new Error("作品已不存在，配方未保存");
        return saved;
    });
}

/**
 * 修改一条作品并保存到服务端；返回的 Promise 在这次修改落到服务端后完成，保存失败时抛错
 * （本地仍显示修改，下一次修改会连同它一起再保存）。
 */
export function updateStoredWork(id: string, updater: Updater): Promise<void> {
    const scope = resetIfScopeChanged();
    const stamped: Updater = (job) => ({ ...updater(job), updatedAt: new Date().toISOString() });
    const updaters = [...(pending.get(id) || []), stamped];
    try {
        fold(id, updaters);
    } catch (error) {
        return Promise.reject(error);
    }
    pending.set(id, updaters);
    publish(id);
    return enqueueSave(id, async () => {
        await persist(id, scope);
    });
}

/** 改一条元素替换旧作品（复刻工作台的作品原样不动）。 */
export function updateProductVideo(id: string, updater: (job: ProductVideoJob) => ProductVideoJob) {
    return updateStoredWork(id, (job) => (isRemakeJob(job) ? job : updater(job)));
}

/** 改一条复刻工作台的作品。 */
export function updateRemake(id: string, updater: (job: RemakeJob) => RemakeJob) {
    return updateStoredWork(id, (job) => (isRemakeJob(job) ? updater(job) : job));
}

/** 新建作品：先记成草稿版本，保存时 expectedRevision 为 0。 */
export function createProductVideo(job: StoredWork) {
    resetIfScopeChanged();
    drafts.set(job.id, job);
    return updateStoredWork(job.id, (value) => value);
}

export async function removeProductVideo(id: string) {
    const scope = resetIfScopeChanged();
    await (saving.get(id) || Promise.resolve()).catch(() => undefined);
    if (getActiveUserScope() !== scope) return;
    const { revision } = await deleteProductVideo(id);
    if (getActiveUserScope() !== scope) return;
    acceptWork(id, revision);
    drafts.delete(id);
    pending.delete(id);
    saving.delete(id);
    publish(id);
}
