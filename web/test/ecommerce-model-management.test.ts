import { describe, expect, test } from "bun:test";
import * as models from "../src/lib/ecommerce/ecommerce-models";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

describe("model library management", () => {
    test("ships no built-in model records", () => {
        expect(models.ECOMMERCE_MODEL_PRESETS).toEqual([]);
    });

    test("search matches names and tags without mutating the library", () => {
        const list = [
            { ...models.createEcommerceModel("Alice", ["resource:alice"]), tags: ["通勤"] },
            models.createEcommerceModel("Bob", ["resource:bob"]),
        ];
        const filter = (models as unknown as Record<string, unknown>).filterEcommerceModels;
        expect(typeof filter).toBe("function");
        const run = filter as (list: typeof list, query: string, sort: string) => typeof list;
        expect(run(list, "ALICE", "recent").map((item) => item.name)).toEqual(["Alice"]);
        expect(run(list, "通勤", "recent").map((item) => item.name)).toEqual(["Alice"]);
        expect(list).toHaveLength(2);
    });

    test("sorts names without changing the stored order", () => {
        const list = [models.createEcommerceModel("Zoe"), models.createEcommerceModel("Alice")];
        const filter = (models as unknown as Record<string, unknown>).filterEcommerceModels;
        expect(typeof filter).toBe("function");
        expect((filter as (list: typeof list, query: string, sort: string) => typeof list)(list, "", "name").map((item) => item.name)).toEqual(["Alice", "Zoe"]);
        expect(list[0].name).toBe("Zoe");
    });

    test("only saved image nodes can be added as models", () => {
        const canSave = (models as unknown as Record<string, unknown>).canSaveCanvasImageAsModel;
        expect(typeof canSave).toBe("function");
        const run = canSave as (node: CanvasNodeData) => boolean;
        const image: CanvasNodeData = { id: "image", type: CanvasNodeType.Image, title: "生成图", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { storageKey: "resource:generated" } };
        expect(run(image)).toBe(true);
        expect(run({ ...image, metadata: {} })).toBe(false);
        expect(run({ ...image, type: CanvasNodeType.Video })).toBe(false);
    });
});
