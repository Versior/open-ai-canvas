import { create } from "zustand";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { DEFAULT_ECOMMERCE_SETTING, parseEcommerceSetting, type EcommerceSuiteTemplate } from "@/services/api/ecommerce";

const key = "ecommerce-template-library";
type TemplateLibrary = {
    templates: EcommerceSuiteTemplate[];
    scope: string;
    hydrated: boolean;
    reset: () => void;
    hydrate: () => Promise<void>;
    save: (template: EcommerceSuiteTemplate) => Promise<void>;
    remove: (id: string) => Promise<void>;
};

/** Local, account-scoped planning templates. Public publication remains an admin action. */
export const useEcommerceTemplateLibrary = create<TemplateLibrary>((set, get) => {
    let epoch = 0;
    let loading: { scope: string; promise: Promise<void> } | undefined;
    let writes = Promise.resolve();
    const mutate = (update: (templates: EcommerceSuiteTemplate[]) => EcommerceSuiteTemplate[]) => {
        const scope = getActiveUserScope();
        const operation = writes
            .catch(() => undefined)
            .then(async () => {
                if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新操作模板库");
                await get().hydrate();
                if (scope !== getActiveUserScope() || get().scope !== scope) throw new Error("账号已切换，请重新操作模板库");
                const templates = parseEcommerceSetting({ ...structuredClone(DEFAULT_ECOMMERCE_SETTING), templates: update(get().templates) }).templates;
                const serialized = JSON.stringify({ version: 1, templates });
                if (new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024) throw new Error("私人模板超过 2MB，请减少模板内容");
                if (typeof window === "undefined" || (!window.indexedDB && !window.localStorage)) throw new Error("浏览器存储不可用，无法保存模板");
                await localForageStorageForScope(scope).setItem(key, serialized);
                if (scope !== getActiveUserScope() || get().scope !== scope) throw new Error("账号已切换，模板已保存到原账号");
                set({ templates });
            });
        writes = operation.catch(() => undefined);
        return operation;
    };
    return {
        templates: [],
        scope: "",
        hydrated: false,
        reset: () => {
            epoch++;
            loading = undefined;
            set({ templates: [], scope: "", hydrated: false });
        },
        hydrate: async () => {
            const scope = getActiveUserScope();
            if (get().hydrated && get().scope === scope) return;
            if (loading?.scope === scope) return loading.promise;
            const current = ++epoch;
            set({ templates: [], scope, hydrated: false });
            const promise = (async () => {
                const raw = await localForageStorageForScope(scope).getItem(key);
                const parsed = raw ? JSON.parse(raw) : { version: 1, templates: [] };
                if (parsed?.version !== 1 || !Array.isArray(parsed.templates)) throw new Error("私人模板库格式异常，已停止写入");
                const templates = parseEcommerceSetting({ ...structuredClone(DEFAULT_ECOMMERCE_SETTING), templates: parsed.templates }).templates;
                if (current === epoch && scope === getActiveUserScope()) set({ templates, hydrated: true, scope });
            })();
            loading = { scope, promise };
            try {
                await promise;
            } finally {
                if (loading?.promise === promise) loading = undefined;
            }
        },
        save: (template) => mutate((templates) => [...templates.filter((item) => item.id !== template.id), structuredClone(template)]),
        remove: (id) => mutate((templates) => templates.filter((item) => item.id !== id)),
    };
});
