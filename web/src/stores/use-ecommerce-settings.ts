import { create } from "zustand";
import { DEFAULT_ECOMMERCE_SETTING, ECOMMERCE_FLOW_IDS, getEcommerceSetting, type EcommerceSetting } from "@/services/api/ecommerce";
import { getActiveUserScope } from "@/lib/user-scope";
type State = { setting: EcommerceSetting; scope: string; loadedAt: number; load: () => Promise<EcommerceSetting>; commit: (setting: EcommerceSetting) => void };
export const useEcommerceSettings = create<State>((set, get) => {
    let pending: { scope: string; promise: Promise<EcommerceSetting> } | undefined;
    let generation = 0;
    return {
        setting: DEFAULT_ECOMMERCE_SETTING,
        scope: "",
        loadedAt: 0,
        commit: (setting) => {
            generation++;
            pending = undefined;
            const publicSetting = structuredClone(setting);
            for (const id of ECOMMERCE_FLOW_IDS) publicSetting.flows[id].directorPrompt = "";
            for (const item of Object.values(publicSetting.capabilities || {})) item.directorPrompt = "";
            publicSetting.models = publicSetting.enabled && publicSetting.modelLibraryEnabled ? publicSetting.models.filter((model) => model.enabled) : [];
            publicSetting.templates = publicSetting.enabled ? publicSetting.templates.filter((item) => item.enabled && publicSetting.flows[item.flow].enabled) : [];
            set({ setting: publicSetting, scope: getActiveUserScope(), loadedAt: Date.now() });
        },
        load: async () => {
            const scope = getActiveUserScope();
            if (get().scope === scope && Date.now() - get().loadedAt < 30000) return get().setting;
            if (pending?.scope === scope) return pending.promise;
            if (get().scope !== scope) set({ setting: DEFAULT_ECOMMERCE_SETTING, scope, loadedAt: 0 });
            const requestGeneration = ++generation;
            const promise = getEcommerceSetting().then((setting) => {
                if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重试");
                if (requestGeneration !== generation) return get().setting;
                set({ setting, scope, loadedAt: Date.now() });
                return setting;
            });
            pending = { scope, promise };
            try {
                return await promise;
            } finally {
                if (pending?.promise === promise) pending = undefined;
            }
        },
    };
});
