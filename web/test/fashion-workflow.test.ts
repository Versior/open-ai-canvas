import { describe, expect, test } from "bun:test";
import { emptyFashionDraft, fashionDraftProblem, planFashion, fashionVideoPrompt, newFashionVersion, type FashionWork } from "@/lib/fashion/workflow";
import { parseFashionWork } from "@/services/api/fashion";
import { normalizeStoredWork } from "@/services/api/product-video";

const image = (resourceId: string) => ({ resourceId, name: resourceId });
const id = (() => {
    let n = 0;
    return () => `unit_${++n}`;
})();

describe("fashion operations", () => {
    test("same garment stays fixed while each model gets one independent task", () => {
        const draft = { ...emptyFashionDraft(), tool: "multi-model" as const, models: [image("model-a"), image("model-b")], garments: [image("garment-a")] };
        const units = planFashion(draft, id);
        expect(units.map((u) => u.references.map((r) => r.resourceId))).toEqual([
            ["model-a", "garment-a"],
            ["model-b", "garment-a"],
        ]);
        expect(new Set(units.map((unit) => unit.id)).size).toBe(2);
    });
    test("same model stays fixed while each garment gets its own task", () => {
        const units = planFashion({ ...emptyFashionDraft(), tool: "multi-garment", models: [image("person")], garments: [image("coat"), image("shirt")] }, id);
        expect(units.map((u) => u.references.map((r) => r.resourceId))).toEqual([
            ["person", "coat"],
            ["person", "shirt"],
        ]);
    });
    test("cannot silently pick the first garment in an ambiguous matrix", () => {
        const draft = { ...emptyFashionDraft(), tool: "multi-model" as const, models: [image("a"), image("b")], garments: [image("c"), image("d")] };
        expect(fashionDraftProblem(draft)).toContain("一件服装");
        expect(() => planFashion(draft, id)).toThrow();
    });
    test("face and head have different preservation boundaries", () => {
        const base = { ...emptyFashionDraft(), models: [image("target")], faces: [image("identity")] };
        expect(planFashion({ ...base, tool: "face" }, id)[0].prompt).toContain("保留图1的发型");
        expect(planFashion({ ...base, tool: "head" }, id)[0].prompt).toContain("包括脸型、耳朵与发型");
    });
    test("print extraction takes one reference and makes no claim about unseen art", () => {
        const unit = planFashion({ ...emptyFashionDraft(), tool: "print", garments: [image("print-photo")] }, id)[0];
        expect(unit.references).toHaveLength(1);
        expect(unit.prompt).toContain("不补造不可见区域");
    });
    test("missing target and incomplete uploads are rejected", () => {
        expect(() => planFashion({ ...emptyFashionDraft(), garments: [image("coat")] }, id)).toThrow();
        expect(() => planFashion({ ...emptyFashionDraft(), models: [image("")], garments: [image("coat")] }, id)).toThrow();
    });
    test("fashion history cannot appear as a broken video replacement work", () => {
        expect(normalizeStoredWork({ kind: "fashion", id: "fashion_a", units: [] })).toBeUndefined();
    });
    test("video motion preserves the confirmed identity and print", () => {
        expect(fashionVideoPrompt("向左转身")).toContain("不换脸不换装");
        expect(fashionVideoPrompt("向左转身")).toContain("向左转身");
    });
    test("print video uses confirmed flat artwork without inventing a model", () => {
        expect(fashionVideoPrompt("慢速平移", true)).toContain("不添加人物或服装");
    });
    test("history rejects broken fashion records while skipping other document kinds", () => {
        expect(parseFashionWork({ id: "video" })).toBeUndefined();
        expect(() => parseFashionWork({ kind: "fashion", id: "fashion_a", draft: {}, units: [] })).toThrow("数据损坏");
        const draft = { ...emptyFashionDraft(), models: [image("model")], garments: [image("garment")] };
        const work: FashionWork = { kind: "fashion", id: "fashion_a", revision: 1, title: "换装", createdAt: new Date().toISOString(), model: "model", draft, units: planFashion(draft, id) };
        expect(parseFashionWork(work)).toEqual(work);
        expect(() => parseFashionWork({ ...work, units: [{ ...work.units[0], status: "succeeded" }] })).toThrow();
        expect(() => newFashionVersion(work, work.units[0], id)).toThrow("原任务状态");
        const finished = { ...work.units[0], status: "succeeded" as const, resourceId: "finished" };
        const next = newFashionVersion(work, finished, id);
        expect(next.id).not.toBe(work.id);
        expect(next.units[0].id).not.toBe(finished.id);
        expect(next.units[0].resourceId).toBeUndefined();
        expect(next.units[0].references).toEqual(finished.references);
        expect(work.revision).toBe(1);
    });
});
