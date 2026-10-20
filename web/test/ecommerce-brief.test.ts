import { expect, test } from "bun:test";
import { ecommerceBriefBlock, ecommerceBriefRows, ecommerceBriefSlicePlatform } from "../src/lib/ecommerce/ecommerce-brief";
import { ECOMMERCE_ONE_CLICK_FLOWS } from "../src/lib/ecommerce/ecommerce-oneclick";
import { ecommerceSuiteDraftPrompt } from "../src/lib/ecommerce/ecommerce-suite";

test("supplementary information enters analysis with real line breaks", () => {
    const brief = { platform: "Amazon", imageCount: 6, language: "English", sellingPoints: "confirmed capacity", forbidden: "no certifications", style: "warm light" };
    const block = ecommerceBriefBlock(brief);
    expect(block.split(String.fromCharCode(10)).length).toBeGreaterThan(7);
    expect(block).toContain("纯白 #FFFFFF");
    expect(block).toContain("仅用于画面规划");
    for (const value of ["Amazon", "6", "English", "confirmed capacity", "no certifications", "warm light"]) expect(block).toContain(value);
});

test("image count preserves existing edits and adds unique slots", () => {
    const flow = ECOMMERCE_ONE_CLICK_FLOWS[0];
    const rows = [{ slotId: "detail-extra-2", title: "My title", duty: "My duty", prompt: "Edited" }];
    const expanded = ecommerceBriefRows(flow, rows, { imageCount: 3 });
    expect(expanded).toHaveLength(3);
    expect(expanded[0]).toBe(rows[0]);
    expect(new Set(expanded.map((row) => row.slotId)).size).toBe(3);
    expect(ecommerceBriefRows(flow, expanded, { imageCount: 1 })).toEqual(rows);
    for (const imageCount of [0, 31, 1.5, NaN]) expect(() => ecommerceBriefRows(flow, rows, { imageCount })).toThrow();
});

test("server-injected analysis omits director text but retains the output contract", () => {
    const prompt = ecommerceSuiteDraftPrompt(ECOMMERCE_ONE_CLICK_FLOWS[0], undefined, [], null);
    expect(prompt).not.toContain("你是电商出图导演");
    expect(prompt).toContain("槽位id");
});

test("slice specifications use explicit delivery settings separately from analysis platform text", () => {
    expect(ecommerceBriefSlicePlatform({ platform: "Amazon", slicePlatform: "jd" }, "taobao")).toBe("jd");
    expect(ecommerceBriefSlicePlatform({ platform: "Amazon" }, "douyin")).toBe("douyin");
    expect(ecommerceBriefSlicePlatform()).toBe("taobao");
    expect(() => ecommerceBriefSlicePlatform(undefined, "unknown")).toThrow("切片规格");
});
