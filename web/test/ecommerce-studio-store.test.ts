import { describe, expect, mock, test } from "bun:test";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";

// 假服务端：按商品 revision 比较交换，和后端 SaveEcommerceStudioProduct 的规则一致。
const server = new Map<string, StudioProduct>();
const saves: { id: string; expected: number }[] = [];
const copy = <T>(value: T): T => structuredClone(value);

mock.module("@/services/api/ecommerce-studio", () => ({
    STUDIO_PRODUCT_CONFLICT: "studio_product_conflict",
    getStudioWorkspace: async () => ({ revision: 1, products: [...server.values()].map(copy) }),
    getStudioProduct: async (id: string) => {
        const product = server.get(id);
        if (!product) throw Object.assign(new Error("商品不存在"), { status: 404 });
        return copy(product);
    },
    saveStudioProduct: async (product: StudioProduct, expected: number) => {
        saves.push({ id: product.id, expected });
        const current = server.get(product.id)?.revision ?? 0;
        if (current !== expected) throw Object.assign(new Error("商品已被修改"), { status: 409, reason: "studio_product_conflict" });
        const saved = { ...copy(product), revision: current + 1 };
        server.set(product.id, saved);
        return { revision: 1, product: copy(saved) };
    },
    deleteStudioProduct: async (id: string) => {
        server.delete(id);
        return { revision: 1 };
    },
}));

const { useStudioStore } = await import("../src/pages/ecommerce-studio/use-studio-store");

function seed(id: string, patch: Partial<StudioProduct> = {}) {
    const product = { ...createStudioProduct(id, "2026-11-01T00:00:00.000Z"), name: "陶瓷马克杯", revision: 1, ...patch };
    server.set(id, product);
    return product;
}

/** 模拟助手在服务端直接改商品：revision 加一。 */
function agentWrites(id: string, mutate: (product: StudioProduct) => StudioProduct) {
    const current = server.get(id)!;
    server.set(id, { ...mutate(copy(current)), revision: current.revision + 1 });
}

async function settle(check: () => boolean) {
    for (let index = 0; index < 100 && !check(); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(check()).toBe(true);
}

const local = (id: string) => useStudioStore.getState().products.find((product) => product.id === id);
const state = (id: string) => useStudioStore.getState().saveStates[id];

describe("ecommerce studio store", () => {
    test("a save that lost the race replays local edits on top of the agent's version", async () => {
        seed("store_race");
        await useStudioStore.getState().load(true);
        useStudioStore.getState().update("store_race", (product) => ({ ...product, sellerNotes: "卖家补充：容量 500ml" }));
        agentWrites("store_race", (product) => ({ ...product, dossier: { name: "陶瓷马克杯", category: "马克杯", family: "home", summary: "", facts: [], invariants: [], questions: [] } }));
        await useStudioStore.getState().flush("store_race");
        await settle(() => server.get("store_race")?.revision === 3 && state("store_race") === "saved");
        const saved = server.get("store_race")!;
        expect(saved.sellerNotes).toBe("卖家补充：容量 500ml");
        expect(saved.dossier?.category).toBe("马克杯");
        expect(local("store_race")?.revision).toBe(3);
        expect(saves.filter((save) => save.id === "store_race").map((save) => save.expected)).toEqual([1, 2]);
    });

    test("refresh adopts the agent's change and keeps edits that are not saved yet", async () => {
        seed("store_refresh");
        await useStudioStore.getState().load(true);
        useStudioStore.getState().update("store_refresh", (product) => ({ ...product, name: "陶瓷马克杯 350ml" }));
        agentWrites("store_refresh", (product) => ({ ...product, style: "warm" }));
        await useStudioStore.getState().refresh("store_refresh");
        expect(local("store_refresh")?.style).toBe("warm");
        expect(local("store_refresh")?.name).toBe("陶瓷马克杯 350ml");
        expect(local("store_refresh")?.revision).toBe(2);
        expect(state("store_refresh")).toBe("dirty");
        await useStudioStore.getState().flush("store_refresh");
        await settle(() => state("store_refresh") === "saved");
        expect(server.get("store_refresh")).toMatchObject({ name: "陶瓷马克杯 350ml", style: "warm", revision: 3 });
    });

    test("refresh without local edits simply shows the server version", async () => {
        seed("store_clean");
        await useStudioStore.getState().load(true);
        agentWrites("store_clean", (product) => ({ ...product, platform: "jd" }));
        await useStudioStore.getState().refresh("store_clean");
        expect(local("store_clean")).toMatchObject({ platform: "jd", revision: 2 });
        expect(state("store_clean")).toBe("saved");
    });

    test("a product deleted in another window is dropped instead of resurrected", async () => {
        seed("store_gone");
        await useStudioStore.getState().load(true);
        useStudioStore.getState().update("store_gone", (product) => ({ ...product, name: "改个名字" }));
        server.delete("store_gone");
        await useStudioStore.getState().flush("store_gone");
        await settle(() => !local("store_gone"));
        expect(server.has("store_gone")).toBe(false);
        expect(useStudioStore.getState().saveErrors.store_gone).toContain("删除");
    });

    test("a brand-new product is created with revision 0 and is not treated as deleted", async () => {
        await useStudioStore.getState().load(true);
        useStudioStore.getState().upsert(createStudioProduct("store_new"));
        await useStudioStore.getState().refresh("store_new");
        expect(local("store_new")).toBeDefined();
        await useStudioStore.getState().flush("store_new");
        await settle(() => state("store_new") === "saved");
        expect(saves.find((save) => save.id === "store_new")?.expected).toBe(0);
        expect(server.get("store_new")?.revision).toBe(1);
    });
});
