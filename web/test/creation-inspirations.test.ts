import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { curatedInspirations, inspirationSources } from "../src/lib/inspirations/catalog";

describe("curated creation inspirations", () => {
    test("all templates have unique titles, usable prompts and local cover assets", () => {
        expect(curatedInspirations.length).toBeGreaterThan(0);
        expect(new Set(curatedInspirations.map((item) => item.title)).size).toBe(curatedInspirations.length);
        for (const item of curatedInspirations) {
            expect(["image", "video", "text"]).toContain(item.mode);
            expect(item.prompt.length).toBeGreaterThan(35);
            expect(existsSync(resolve(import.meta.dir, "../public", item.image.slice(1)))).toBe(true);
        }
    });

    test("adapted prompts retain provenance and the data license", () => {
        const adaptedItems = curatedInspirations.filter((item) => item.sourceId === "chatgpt-prompts");
        const source = inspirationSources["chatgpt-prompts"];
        expect(adaptedItems.length).toBe(8);
        expect(adaptedItems.every((item) => item.credit)).toBe(true);
        expect(source.license).toBe("CC0-1.0");
        expect(source.revision).toMatch(/^[a-f0-9]{40}$/);
        expect(source.notice).toContain("不代表实际生成结果");
    });
});
