/**
 * 电商模特库的持久化。
 *
 * 用户级、跨画布：一个设计师手上就那么几个常合作的模特，每上新一款都用同一批人。
 * 所以它不能挂在某个画布上（换画布人就没了），要跟着账号走。
 *
 * scope 在**每次读写时**解析，不在模块初始化时定死——否则切换账号后
 * 新账号会读到上一个账号的模特库。这条和 use-asset-store 的做法一致。
 */
import { create } from "zustand";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { createEcommerceModel, type EcommerceModel } from "@/lib/ecommerce/ecommerce-models";

const STORE_KEY = "ecommerce-model-library";

type ModelLibraryState = {
    models: EcommerceModel[];
    hydrated: boolean;
};

type ModelLibraryActions = {
    hydrate: () => Promise<void>;
    addModel: (model: EcommerceModel) => string;
    updateModel: (id: string, patch: Partial<EcommerceModel>) => void;
    removeModel: (id: string) => void;
    touchModel: (id: string) => void;
};

export type EcommerceModelLibraryStore = ModelLibraryState & ModelLibraryActions;

function scopeStorage() {
    return localForageStorageForScope(getActiveUserScope());
}

/**
 * 老记录缺字段时补齐。
 *
 * 模特库是要长期留着的（一个店铺的模特可能用两年），所以读回来的数据
 * 必须能兼容早期版本——旧版本把参考图存在 `angles` 里（按全身/半身/侧面分槽），
 * 现在改成一条 `refs` 列表；不迁移的话，用户升级之后会发现自己所有的模特都空了。
 * 迁移顺序按旧枚举的固定顺序，保证同一个模特每次读出来的参考图顺序一致。
 */
const LEGACY_ANGLE_ORDER = ["full", "half", "side", "back", "face", "hand"] as const;

function normalizeModel(value: unknown): EcommerceModel | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Partial<EcommerceModel> & { angles?: Record<string, string | undefined>; cover?: string };
    if (!raw.id || !raw.name) return null;
    const refs = Array.isArray(raw.refs) ? raw.refs.filter((ref): ref is string => typeof ref === "string" && Boolean(ref)) : [];
    if (!refs.length && raw.angles && typeof raw.angles === "object") {
        for (const role of LEGACY_ANGLE_ORDER) {
            const ref = raw.angles[role];
            if (typeof ref === "string" && ref) refs.push(ref);
        }
        if (raw.cover && !refs.includes(raw.cover)) refs.unshift(raw.cover);
    }
    const fallback = createEcommerceModel(raw.name);
    return {
        id: raw.id,
        name: raw.name,
        kind: raw.kind === "preset" ? "preset" : "custom",
        refs,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
        createdAt: raw.createdAt || fallback.createdAt,
        lastUsedAt: raw.lastUsedAt || fallback.lastUsedAt,
    };
}

export const useEcommerceModelLibrary = create<EcommerceModelLibraryStore>((set, get) => ({
    models: [],
    hydrated: false,

    hydrate: async () => {
        if (get().hydrated) return;
        try {
            const raw = await scopeStorage().getItem(STORE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            const candidate: unknown = parsed?.state?.models ?? parsed?.models;
            const list: unknown[] = Array.isArray(candidate) ? candidate : [];
            const models = list.map(normalizeModel).filter((model): model is EcommerceModel => Boolean(model));
            set({ models, hydrated: true });
        } catch {
            // 读不出来就当空库，不把整个模特库变成打不开的错误页
            set({ models: [], hydrated: true });
        }
    },

    addModel: (model) => {
        set((state) => ({ models: [model, ...state.models] }));
        void persist(get());
        return model.id;
    },

    updateModel: (id, patch) => {
        set((state) => ({ models: state.models.map((model) => (model.id === id ? { ...model, ...patch } : model)) }));
        void persist(get());
    },

    removeModel: (id) => {
        set((state) => ({ models: state.models.filter((model) => model.id !== id) }));
        void persist(get());
    },

    touchModel: (id) => {
        const now = new Date().toISOString();
        set((state) => ({ models: state.models.map((model) => (model.id === id ? { ...model, lastUsedAt: now } : model)) }));
        void persist(get());
    },
}));

async function persist(state: EcommerceModelLibraryStore) {
    const storage = scopeStorage();
    await storage.setItem(STORE_KEY, JSON.stringify({ version: 2, models: state.models }));
}

/**
 * 把一张参考图存成模特。
 *
 * 「上传保存为模特」与「画布图存为模特」共用这条写路径——两处各写一遍的话，
 * 迟早会出现一处忘了校验 storageKey。
 */
export function saveModelFromImage(ref: string, name: string) {
    return useEcommerceModelLibrary.getState().addModel(createEcommerceModel(name, [ref]));
}
