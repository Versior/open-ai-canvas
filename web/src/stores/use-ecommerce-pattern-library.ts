import { create } from "zustand";
import { canonicalize } from "json-canonicalize";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";

export type EcommercePrivatePattern = { id: string; name: string; storageKey: string; tags: string[]; createdAt: string };

const key = "ecommerce-pattern-library";
type State = { patterns: EcommercePrivatePattern[]; scope: string; hydrate: () => Promise<void>; replace: (patterns: EcommercePrivatePattern[], expected?: EcommercePrivatePattern[]) => Promise<void>; save: (pattern: EcommercePrivatePattern) => Promise<void>; remove: (id: string) => Promise<void> };
export const useEcommercePatternLibrary = create<State>((set, get) => {
    let epoch = 0;
    let loading: { scope: string; promise: Promise<void> } | undefined;
    let writes = Promise.resolve();
    const mutate = (update: (patterns: EcommercePrivatePattern[]) => EcommercePrivatePattern[]) => {
        const scope = getActiveUserScope();
        const operation = writes.catch(() => undefined).then(async () => {
            if (scope !== getActiveUserScope()) throw new Error("账号已切换");
            await get().hydrate();
            if (scope !== getActiveUserScope() || get().scope !== scope) throw new Error("账号已切换");
            const patterns = update(get().patterns);
            if (patterns.length > 500 || patterns.some((item) => !item.id || !item.name.trim() || item.name.length > 100 || !item.storageKey)) throw new Error("花型库字段无效或超过 500 个");
            await localForageStorageForScope(scope).setItem(key, JSON.stringify({ version: 1, patterns }));
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，花型已保存到原账号");
            set({ patterns, scope });
        });
        writes = operation.catch(() => undefined);
        return operation;
    };
    return {
        patterns: [], scope: "",
        hydrate: async () => {
            const scope = getActiveUserScope();
            if (get().scope === scope) return;
            if (loading?.scope === scope) return loading.promise;
            const current = ++epoch;
            set({ patterns: [], scope: "" });
            const promise = (async () => {
                const raw = await localForageStorageForScope(scope).getItem(key);
                const parsed = raw ? JSON.parse(raw) : { version: 1, patterns: [] };
                if (parsed.version !== 1 || !Array.isArray(parsed.patterns)) throw new Error("私人花型库无法读取");
                if (current === epoch && scope === getActiveUserScope()) set({ patterns: parsed.patterns, scope });
            })();
            loading = { scope, promise };
            try { await promise; } finally { if (loading?.promise === promise) loading = undefined; }
        },
        replace: (patterns, expected) => mutate((current) => {
            if (expected && canonicalize(current) !== canonicalize(expected)) throw new Error("本机花型已修改，未覆盖新编辑，请重新核对");
            return structuredClone(patterns);
        }),
        save: (pattern) => mutate((patterns) => [structuredClone(pattern), ...patterns.filter((item) => item.id !== pattern.id)]),
        remove: (id) => mutate((patterns) => patterns.filter((item) => item.id !== id)),
    };
});
