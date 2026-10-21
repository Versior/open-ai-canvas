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
import { canonicalize } from "json-canonicalize";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { createEcommerceModel, type EcommerceModel } from "@/lib/ecommerce/ecommerce-models";

const STORE_KEY = "ecommerce-model-library";
export type EcommerceModelPatch = Partial<EcommerceModel> | ((current: EcommerceModel) => Partial<EcommerceModel>);

type ModelLibraryState = {
    models: EcommerceModel[];
    hydrated: boolean;
    scope: string;
};

type ModelLibraryActions = {
    hydrate: () => Promise<void>;
    reset: () => void;
    addModel: (model: EcommerceModel) => Promise<string>;
    updateModel: (id: string, patch: EcommerceModelPatch) => Promise<void>;
    removeModel: (id: string) => Promise<void>;
    removeModels: (ids: string[]) => Promise<void>;
    touchModel: (id: string) => Promise<void>;
    replace: (models: EcommerceModel[], expected?: EcommerceModel[]) => Promise<void>;
};

export type EcommerceModelLibraryStore = ModelLibraryState & ModelLibraryActions;

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
    if (raw.kind === "preset") return null;
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
        kind: "custom",
        refs,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
        createdAt: raw.createdAt || fallback.createdAt,
        lastUsedAt: raw.lastUsedAt || fallback.lastUsedAt,
    };
}

export const useEcommerceModelLibrary = create<EcommerceModelLibraryStore>((set, get) => {
    let generation = 0;
    let loading: { scope: string; promise: Promise<void> } | null = null;
    let writes: Promise<void> = Promise.resolve();

    const mutate = (update: (models: EcommerceModel[]) => EcommerceModel[]) => {
        const scope = getActiveUserScope();
        const operation = writes.catch(() => undefined).then(async () => {
            if (scope !== getActiveUserScope()) throw new Error("账号已切换，请重新操作模特库");
            await get().hydrate();
            if (scope !== getActiveUserScope() || get().scope !== scope) throw new Error("账号已切换，请重新操作模特库");
            const models = update(get().models);
            await localForageStorageForScope(scope).setItem(STORE_KEY, JSON.stringify({ version: 2, models }));
            if (scope !== getActiveUserScope() || get().scope !== scope) throw new Error("账号已切换，模特已保存到原账号");
            set({ models });
        });
        writes = operation.catch(() => undefined);
        return operation;
    };

    return {
        models: [],
        hydrated: false,
        scope: "",
        reset: () => {
            generation += 1;
            loading = null;
            set({ models: [], hydrated: false, scope: "" });
        },
        hydrate: async () => {
            const scope = getActiveUserScope();
            if (get().hydrated && get().scope === scope) return;
            if (loading?.scope === scope) return loading.promise;
            const epoch = ++generation;
            set({ models: [], hydrated: false, scope });
            const promise = (async () => {
                const storage = localForageStorageForScope(scope);
                const raw = await storage.getItem(STORE_KEY);
                const parsed = raw ? JSON.parse(raw) : null;
                const candidate: unknown = parsed?.state?.models ?? parsed?.models;
                if (candidate !== undefined && !Array.isArray(candidate)) throw new Error("模特库数据格式异常，已停止写入");
                const list: unknown[] = Array.isArray(candidate) ? candidate : [];
                const models = list.map(normalizeModel).filter((model): model is EcommerceModel => Boolean(model));
                if (epoch !== generation || scope !== getActiveUserScope()) return;
                if (list.some((item) => item && typeof item === "object" && (item as { kind?: string }).kind === "preset")) {
                    await storage.setItem(STORE_KEY, JSON.stringify({ version: 2, models }));
                }
                if (epoch === generation && scope === getActiveUserScope()) set({ models, hydrated: true, scope });
            })();
            loading = { scope, promise };
            try {
                await promise;
            } finally {
                if (loading?.promise === promise) loading = null;
            }
        },
        addModel: async (model) => {
            await mutate((models) => [model, ...models.filter((item) => item.id !== model.id)]);
            return model.id;
        },
        updateModel: (id, patch) => mutate((models) => models.map((model) => model.id === id ? { ...model, ...(typeof patch === "function" ? patch(model) : patch), id: model.id, kind: "custom" } : model)),
        removeModel: (id) => mutate((models) => models.filter((model) => model.id !== id)),
        removeModels: (ids) => {
            const removed = new Set(ids);
            return mutate((models) => models.filter((model) => !removed.has(model.id)));
        },
        touchModel: (id) => mutate((models) => models.map((model) => model.id === id ? { ...model, lastUsedAt: new Date().toISOString() } : model)),
        replace: (models, expected) => mutate((current) => {
            if (expected && canonicalize(current) !== canonicalize(expected)) throw new Error("本机模特已修改，未覆盖新编辑，请重新核对");
            return structuredClone(models);
        }),
    };
});

/**
 * 把一张参考图存成模特。
 *
 * 「上传保存为模特」与「画布图存为模特」共用这条写路径——两处各写一遍的话，
 * 迟早会出现一处忘了校验 storageKey。
 */
export async function saveModelFromImage(ref: string, name: string) {
    if (!ref.trim()) throw new Error("图片还没有保存，无法加入模特库");
    return useEcommerceModelLibrary.getState().addModel(createEcommerceModel(name, [ref]));
}
