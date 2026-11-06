import { create } from "zustand";
import { getActiveUserScope } from "@/lib/user-scope";
import { deleteStudioProduct, getStudioProduct, getStudioWorkspace, saveStudioProduct, STUDIO_PRODUCT_CONFLICT } from "@/services/api/ecommerce-studio";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";

/**
 * 生图台工作区状态：本地先改、去抖后按商品整体保存到服务端。
 * 保存状态逐个商品展示，"仅本地"与"已保存到服务器"必须分得清。
 *
 * 每次本地修改都记成一个操作，直到服务端确认为止。保存按商品 revision 比较交换：
 * 助手或另一个窗口先写了，保存会收到冲突，此时取回服务端最新版本，把未确认的操作
 * 重新套上去再保存——双方的修改都保留，谁也不会悄悄覆盖谁。
 */
export type StudioSaveState = "saved" | "dirty" | "saving" | "error";

type StudioStore = {
    scope: string;
    status: "idle" | "loading" | "ready" | "error";
    error: string;
    products: StudioProduct[];
    saveStates: Record<string, StudioSaveState>;
    saveErrors: Record<string, string>;
    load: (force?: boolean) => Promise<void>;
    upsert: (product: StudioProduct, options?: { immediate?: boolean }) => void;
    update: (id: string, updater: (product: StudioProduct) => StudioProduct, options?: { immediate?: boolean }) => StudioProduct | undefined;
    remove: (id: string) => Promise<void>;
    flush: (id: string) => Promise<void>;
    /** 取回服务端最新版本（助手改过商品后调用），本地未确认的修改会重新套用。 */
    refresh: (id: string) => Promise<void>;
};

type PendingOperation = { seq: number; apply: (product: StudioProduct) => StudioProduct };

const SAVE_DELAY_MS = 700;
const MAX_CONFLICT_RETRIES = 3;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<void>>();
const pending = new Map<string, PendingOperation[]>();
const confirmed = new Map<string, number>();
const conflicts = new Map<string, number>();
let sequence = 0;
let session = 0;

function sortProducts(products: StudioProduct[]) {
    return [...products].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function errorReason(error: unknown) {
    return (error as { reason?: string } | null)?.reason;
}

function errorStatus(error: unknown) {
    return (error as { status?: number } | null)?.status;
}

function replay(id: string, base: StudioProduct) {
    return (pending.get(id) || []).reduce((product, operation) => operation.apply(product), base);
}

function resetTracking() {
    session += 1;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    pending.clear();
    confirmed.clear();
    conflicts.clear();
    inflight.clear();
}

export const useStudioStore = create<StudioStore>((set, get) => {
    function forget(id: string) {
        const timer = timers.get(id);
        if (timer) clearTimeout(timer);
        timers.delete(id);
        pending.delete(id);
        confirmed.delete(id);
        conflicts.delete(id);
    }

    function dropLocal(id: string, message: string) {
        forget(id);
        set((state) => {
            const saveStates = { ...state.saveStates };
            delete saveStates[id];
            return { products: state.products.filter((item) => item.id !== id), saveStates, saveErrors: { ...state.saveErrors, [id]: message } };
        });
    }

    /** 采用服务端版本：只接受不旧于已确认版本的结果，再把未确认的本地操作套上去。 */
    function adoptServerVersion(id: string, latest: StudioProduct) {
        const known = confirmed.get(id) ?? -1;
        if (latest.revision < known) return;
        confirmed.set(id, latest.revision);
        const rebuilt = { ...replay(id, latest), revision: latest.revision };
        const unsaved = Boolean(pending.get(id)?.length) || timers.has(id);
        set((state) => ({ products: sortProducts(state.products.map((item) => (item.id === id ? rebuilt : item))), saveStates: { ...state.saveStates, [id]: unsaved ? "dirty" : "saved" } }));
    }

    async function rebase(id: string, scope: string) {
        let latest: StudioProduct;
        try {
            latest = await getStudioProduct(id);
        } catch (error) {
            if (getActiveUserScope() !== scope) return;
            if (errorStatus(error) === 404) {
                dropLocal(id, "这个商品已在其他窗口删除");
                return;
            }
            throw error;
        }
        if (getActiveUserScope() !== scope) return;
        adoptServerVersion(id, latest);
        if (pending.get(id)?.length) schedule(id, true);
    }

    async function persist(id: string) {
        const scope = get().scope;
        const generation = session;
        timers.delete(id);
        // 同一商品的保存严格排队：先登记本次，再等上一次结束，避免两次保存拿着同一个 revision 并发写入。
        const previous = inflight.get(id);
        const task = (async () => {
            if (previous) await previous.catch(() => undefined);
            if (generation !== session || getActiveUserScope() !== scope) return;
            const product = get().products.find((item) => item.id === id);
            if (!product) return;
            const operations = pending.get(id) || [];
            // 前一次保存已经带走了全部修改：没有新改动就不再发请求。
            if (!operations.length && get().saveStates[id] === "saved") return;
            const savedThrough = operations.length ? operations[operations.length - 1].seq : 0;
            const expected = confirmed.get(id) ?? product.revision;
            set((state) => ({ saveStates: { ...state.saveStates, [id]: "saving" } }));
            try {
                const result = await saveStudioProduct(product, expected);
                if (generation !== session || getActiveUserScope() !== scope) return;
                conflicts.delete(id);
                confirmed.set(id, result.product.revision);
                const remaining = (pending.get(id) || []).filter((operation) => operation.seq > savedThrough);
                pending.set(id, remaining);
                // 保存期间又有新改动：保持 dirty，由已排队的下一次保存接着写。
                const unsaved = remaining.length > 0 || timers.has(id);
                set((state) => ({
                    products: state.products.map((item) => (item.id === id ? { ...item, revision: result.product.revision } : item)),
                    saveStates: { ...state.saveStates, [id]: unsaved ? "dirty" : "saved" },
                    saveErrors: { ...state.saveErrors, [id]: "" },
                }));
            } catch (error) {
                if (generation !== session || getActiveUserScope() !== scope) return;
                const attempts = conflicts.get(id) || 0;
                if (errorReason(error) === STUDIO_PRODUCT_CONFLICT && attempts < MAX_CONFLICT_RETRIES) {
                    conflicts.set(id, attempts + 1);
                    await rebase(id, scope);
                    return;
                }
                set((state) => ({ saveStates: { ...state.saveStates, [id]: "error" }, saveErrors: { ...state.saveErrors, [id]: error instanceof Error ? error.message : "保存失败" } }));
                throw error;
            }
        })();
        inflight.set(id, task);
        try {
            await task;
        } finally {
            if (inflight.get(id) === task) inflight.delete(id);
        }
    }

    function schedule(id: string, immediate?: boolean) {
        const existing = timers.get(id);
        if (existing) clearTimeout(existing);
        if (immediate) {
            timers.delete(id);
            void persist(id).catch(() => undefined);
            return;
        }
        timers.set(
            id,
            setTimeout(() => void persist(id).catch(() => undefined), SAVE_DELAY_MS),
        );
    }

    return {
        scope: "",
        status: "idle",
        error: "",
        products: [],
        saveStates: {},
        saveErrors: {},
        async load(force) {
            const scope = getActiveUserScope();
            const state = get();
            if (!force && state.scope === scope && (state.status === "ready" || state.status === "loading")) return;
            const sameScope = state.scope === scope;
            if (!sameScope) resetTracking();
            set({ scope, status: "loading", error: "", ...(sameScope ? {} : { products: [], saveStates: {}, saveErrors: {} }) });
            try {
                const workspace = await getStudioWorkspace();
                if (getActiveUserScope() !== scope) return;
                const current = get();
                const serverIds = new Set(workspace.products.map((product) => product.id));
                // 本地新建、还没写到服务器的商品保留；服务端已有的商品采用服务端版本并套上未确认的修改。
                const localOnly = current.products.filter((product) => !serverIds.has(product.id) && !confirmed.get(product.id) && (current.saveStates[product.id] || "saved") !== "saved");
                const products = workspace.products.map((product) => {
                    confirmed.set(product.id, product.revision);
                    return pending.get(product.id)?.length ? { ...replay(product.id, product), revision: product.revision } : product;
                });
                set({
                    status: "ready",
                    products: sortProducts([...products, ...localOnly]),
                    saveStates: {
                        ...Object.fromEntries(products.map((product) => [product.id, pending.get(product.id)?.length || timers.has(product.id) ? ("dirty" as const) : ("saved" as const)])),
                        ...Object.fromEntries(localOnly.map((product) => [product.id, current.saveStates[product.id]])),
                    },
                });
                for (const product of products) if (pending.get(product.id)?.length && !timers.has(product.id)) schedule(product.id, true);
            } catch (error) {
                if (getActiveUserScope() !== scope) return;
                set({ status: "error", error: error instanceof Error ? error.message : "生图台加载失败" });
            }
        },
        upsert(product, options) {
            if (get().scope !== getActiveUserScope()) throw new DOMException("账号已切换，请重新加载生图台", "AbortError");
            const next = { ...product, updatedAt: new Date().toISOString() };
            if (!confirmed.has(product.id)) confirmed.set(product.id, product.revision);
            set((state) => ({ products: sortProducts([next, ...state.products.filter((item) => item.id !== product.id)]), saveStates: { ...state.saveStates, [product.id]: "dirty" } }));
            schedule(product.id, options?.immediate);
        },
        update(id, updater, options) {
            if (get().scope !== getActiveUserScope()) return undefined;
            const current = get().products.find((item) => item.id === id);
            if (!current) return undefined;
            const stamp = new Date().toISOString();
            // 同一个操作可能被重新套在服务端的新版本上：revision 始终取基底的值，不由操作决定。
            const apply = (product: StudioProduct) => ({ ...updater(product), id, updatedAt: stamp, revision: product.revision });
            const next = apply(current);
            pending.set(id, [...(pending.get(id) || []), { seq: ++sequence, apply }]);
            set((state) => ({ products: state.products.map((item) => (item.id === id ? next : item)), saveStates: { ...state.saveStates, [id]: "dirty" } }));
            schedule(id, options?.immediate);
            return next;
        },
        async remove(id) {
            const scope = get().scope;
            const generation = session;
            if (scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
            const timer = timers.get(id);
            if (timer) clearTimeout(timer);
            timers.delete(id);
            await inflight.get(id)?.catch(() => undefined);
            if (session !== generation || scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
            await deleteStudioProduct(id);
            if (session !== generation || scope !== getActiveUserScope()) return;
            forget(id);
            set((state) => ({ products: state.products.filter((item) => item.id !== id) }));
        },
        async flush(id) {
            const timer = timers.get(id);
            if (!timer && get().saveStates[id] !== "error" && get().saveStates[id] !== "dirty") return inflight.get(id);
            if (timer) clearTimeout(timer);
            await persist(id);
        },
        async refresh(id) {
            const scope = get().scope;
            if (!get().products.some((item) => item.id === id)) return;
            // 还没有保存成功过的新商品，服务端必然取不到，不发这次请求。
            if (!confirmed.get(id)) return;
            try {
                const latest = await getStudioProduct(id);
                if (getActiveUserScope() !== scope) return;
                adoptServerVersion(id, latest);
            } catch (error) {
                if (getActiveUserScope() !== scope) return;
                // 从没写到服务器的新商品取不到是正常的；保存过的商品取不到说明已在别处删除。
                if (errorStatus(error) === 404 && confirmed.get(id)) dropLocal(id, "这个商品已在其他窗口删除");
                else if (errorStatus(error) !== 404) throw error;
            }
        },
    };
});

export function useStudioProduct(id: string | undefined) {
    return useStudioStore((state) => (id ? state.products.find((product) => product.id === id) : undefined));
}
