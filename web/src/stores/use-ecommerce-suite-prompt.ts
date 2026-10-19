/**
 * 电商分析提示词的持久化。
 *
 * 用户级、跨画布：**「只要我没改回默认，就一直用我这份」**——这是用户的原话，
 * 也是真实的用法。调好一版写法的店铺，上新每个商品都该用它，而不是每开一个画布
 * 重设一遍。
 *
 * 与模特库同一个理由挂在账号上而不是画布上（换画布就没了）。scope 在**每次读写时**
 * 解析，不在模块初始化时定死——否则切换账号后新账号会读到上一个账号的提示词。
 */
import { create } from "zustand";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";

const STORE_KEY = "ecommerce-suite-prompt";

type SuitePromptState = {
    /** 用户自己那份分析提示词。空串 = 用代码里那一份默认。 */
    director: string;
    hydrated: boolean;
    scope: string;
};

type SuitePromptActions = {
    hydrate: () => Promise<void>;
    /** 存成用户级默认。传空串就是「回到默认那一份」。 */
    setDirector: (value: string) => Promise<void>;
    reset: () => void;
};

export type EcommerceSuitePromptStore = SuitePromptState & SuitePromptActions;

export const useEcommerceSuitePrompt = create<EcommerceSuitePromptStore>()((set, get) => {
    let generation = 0;
    let loading: { scope: string; promise: Promise<void> } | null = null;
    let writes: Promise<void> = Promise.resolve();
    return {
        director: "",
        hydrated: false,
        scope: "",
        reset: () => {
            generation += 1;
            loading = null;
            set({ director: "", hydrated: false, scope: "" });
        },
        hydrate: async () => {
            const scope = getActiveUserScope();
            if (get().hydrated && get().scope === scope) return;
            if (loading?.scope === scope) return loading.promise;
            const epoch = ++generation;
            set({ director: "", hydrated: false, scope });
            const promise = (async () => {
                const stored = await localForageStorageForScope(scope).getItem(STORE_KEY);
                if (epoch === generation && scope === getActiveUserScope()) set({ director: typeof stored === "string" ? stored : "", hydrated: true, scope });
            })();
            loading = { scope, promise };
            try {
                await promise;
            } finally {
                if (loading?.promise === promise) loading = null;
            }
        },
        setDirector: (value) => {
            const scope = getActiveUserScope();
            const next = typeof value === "string" ? value : "";
            const operation = writes.catch(() => undefined).then(async () => {
                if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新保存提示词");
                await get().hydrate();
                if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新保存提示词");
                await localForageStorageForScope(scope).setItem(STORE_KEY, next);
                if (scope === getActiveUserScope()) set({ director: next });
            });
            writes = operation.catch(() => undefined);
            return operation;
        },
    };
});
