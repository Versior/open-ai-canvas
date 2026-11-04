import { expect, test } from "bun:test";
import { DEFAULT_ECOMMERCE_SETTING, ecommerceSettingsEqual, parseEcommerceSetting } from "../src/services/api/ecommerce-canvas";
test("settings comparison ignores JSON key order and only optionally ignores revisions", () => {
    const value = structuredClone(DEFAULT_ECOMMERCE_SETTING);
    const reordered = { ...value, flows: { wear: value.flows.wear, seed: value.flows.seed, main: value.flows.main, detail: value.flows.detail }, revision: "saved" };
    expect(ecommerceSettingsEqual(value, reordered, true)).toBe(true);
    expect(ecommerceSettingsEqual(value, reordered)).toBe(false);
    reordered.flows.detail = { ...value.flows.detail, enabled: false };
    expect(ecommerceSettingsEqual(value, reordered, true)).toBe(false);
});

test("settings parser rejects incomplete, duplicate and enabled empty models", () => {
    const model = { id: "public", name: "Test", enabled: true, tags: [], resourceIds: ["image"] };
    expect(parseEcommerceSetting(DEFAULT_ECOMMERCE_SETTING)).toEqual(DEFAULT_ECOMMERCE_SETTING);
    for (const models of [null, [model, model], [{ ...model, resourceIds: [] }], [{ ...model, tags: null }]]) {
        expect(() => parseEcommerceSetting({ ...DEFAULT_ECOMMERCE_SETTING, models })).toThrow();
    }
});
