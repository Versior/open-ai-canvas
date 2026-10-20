import { expect, test } from "bun:test";
import { parseEcomgenTemplate, ecommerceTemplateRows } from "../src/lib/ecommerce/ecomgen-template";
import { parseEcommerceSetting, DEFAULT_ECOMMERCE_SETTING } from "../src/services/api/ecommerce";
import { ecommerceBriefBlock } from "../src/lib/ecommerce/ecommerce-brief";

const suite = {
    schemaVersion: 1,
    kind: "ecomgen.suite",
    id: "test-suite",
    name: "Test",
    category: { l1: "服装", l2: "上衣" },
    styleLock: { lockText: "Consistent light" },
    shots: [
        { order: 2, displayName: "Detail", intent: "Show verified details", camera: "macro" },
        { order: 1, displayName: "Hero", intent: "Show product", promptTemplate: "{product} on a white backdrop" },
    ],
};
test("EcomGen import orders shots and retains editable visual guidance without inventing facts", () => {
    const template = parseEcomgenTemplate(JSON.stringify(suite), "main");
    expect(template.enabled).toBe(false);
    expect(template.category).toBe("服装 / 上衣");
    expect(template.shots[0].title).toBe("Hero");
    expect(template.shots[1].duty).toContain("macro");
    const rows = ecommerceTemplateRows(template);
    expect(rows.map((row) => row.prompt)).toEqual(["", ""]);
    expect(new Set(rows.map((row) => row.slotId)).size).toBe(2);
    expect(ecommerceTemplateRows(template)[0].slotId).not.toBe(rows[0].slotId);
    expect(ecommerceBriefBlock({ template, style: template.style, imageCount: rows.length })).toContain("Consistent light");
    template.shots[0].title = "Later admin edit";
    expect(rows[0].title).toBe("Hero");
});
test("malformed shots report a validation error instead of a native property access error", () => {
    expect(() => parseEcomgenTemplate(JSON.stringify({ ...suite, shots: [null] }), "main")).toThrow("镜头");
    expect(() => parseEcomgenTemplate(JSON.stringify({ ...suite, shots: [suite.shots[0], suite.shots[0]] }), "main")).toThrow("顺序");
    const template = parseEcomgenTemplate(JSON.stringify(suite), "main");
    expect(() => parseEcommerceSetting({ ...DEFAULT_ECOMMERCE_SETTING, templates: [{ ...template, shots: [null] }] })).toThrow("模板格式");
});
test("invalid formats, duplicate IDs and empty shots are rejected", () => {
    for (const value of [
        { ...suite, schemaVersion: 2 },
        { ...suite, shots: [] },
        { ...suite, shots: [{ displayName: "", intent: "test" }] },
    ])
        expect(() => parseEcomgenTemplate(JSON.stringify(value), "main")).toThrow();
    const template = parseEcomgenTemplate(JSON.stringify(suite), "detail");
    expect(() => parseEcommerceSetting({ ...DEFAULT_ECOMMERCE_SETTING, templates: [template, template] })).toThrow();
});
