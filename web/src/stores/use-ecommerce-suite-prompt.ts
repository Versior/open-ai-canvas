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
};

type SuitePromptActions = {
    hydrate: () => Promise<void>;
    /** 存成用户级默认。传空串就是「回到默认那一份」。 */
    setDirector: (value: string) => void;
};

export type EcommerceSuitePromptStore = SuitePromptState & SuitePromptActions;

function scopeStorage() {
    return localForageStorageForScope(getActiveUserScope());
}

export const useEcommerceSuitePrompt = create<EcommerceSuitePromptStore>()((set, get) => ({
    director: "",
    hydrated: false,
    hydrate: async () => {
        if (get().hydrated) return;
        try {
            const stored = await scopeStorage().getItem(STORE_KEY);
            set({ director: typeof stored === "string" ? stored : "", hydrated: true });
        } catch {
            // 读不出来就当没存过：提示词丢一份不影响出图，卡住整个面板才是问题。
            set({ hydrated: true });
        }
    },
    setDirector: (value) => {
        const next = typeof value === "string" ? value : "";
        set({ director: next });
        void Promise.resolve(scopeStorage().setItem(STORE_KEY, next)).catch(() => undefined);
    },
}));
