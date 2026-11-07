import { describe, expect, test } from "bun:test";
import { planStudioArtwork, studioReadableInk, wrapStudioText } from "@/lib/ecommerce-studio/typeset";
import { studioCopyPair } from "@/lib/ecommerce-studio/typography";

const canvas = { width: 1200, height: 1600 };
const zone = { x: 0.07, y: 0.48, width: 0.86, height: 0.46, align: "left" as const, vAlign: "top" as const };
const measure = (text: string, size: number) => Array.from(text).length * size * 0.8;
const content = { headline: "看得见的细节", subline: "透明前框，柔灰收边", lines: ["前框｜透明浅灰", "镜腿：柔灰绿", "形状:圆角框型"] };

describe("商品成品排版", () => {
    test("实际底图与预设相反时调整字色，有足够对比时保留品牌色", () => {
        expect(studioReadableInk("#4A4F57", [24, 28, 32])).toBe("#FFFFFF");
        expect(studioReadableInk("#FFFFFF", [246, 244, 239])).toBe("#182028");
        expect(studioReadableInk("#334155", [246, 244, 239])).toBe("#334155");
    });
    test("宋体标题与黑体正文、轻标题与粗标题在同一文案上产生不同字形和节奏", () => {
        const oriental = planStudioArtwork({ canvas, zone, content: { ...content, lines: [] }, measure, tone: "oriental" });
        const editorial = planStudioArtwork({ canvas, zone, content: { ...content, lines: [] }, measure, tone: "editorial" });
        expect(oriental.text[0].family).toContain("Noto Serif");
        expect(oriental.text[0].tracking).toBeGreaterThan(0);
        expect(editorial.text[0].weight).toBeGreaterThan(oriental.text[0].weight);
        expect(editorial.text[0].size).toBeGreaterThan(oriental.text[0].size);
        expect(oriental.text.find((op) => op.text === content.subline)?.family).toBeUndefined();
        expect(editorial.text.find((op) => op.text === content.subline)!.size / editorial.text[0].size).toBeCloseTo(0.28);
    });
    test("手工分行不被吞掉，英文单词与中文仍可自动换行", () => {
        expect(wrapStudioText("清透前框\n柔灰收边", 600, (text) => text.length * 20)).toEqual(["清透前框", "柔灰收边"]);
        expect(wrapStudioText("New season fit", 120, (text) => text.length * 20)).toEqual(["New", "season", "fit"]);
        expect(wrapStudioText("看得清 结构在这里", 100, (text) => text.length * 20)).toEqual(["看得清", "结构在这里"]);
    });
    test("规格表保留完整值并分列，卖点网格横向排布，没有新增页码或丢字", () => {
        const spec = planStudioArtwork({ canvas, zone, content, layout: "spec", measure });
        const icons = planStudioArtwork({ canvas, zone, content, layout: "icons", measure });
        const labels = ["前框", "镜腿", "形状"];
        const labelOps = icons.text.filter((op) => labels.includes(op.text));
        expect(new Set(labelOps.map((op) => op.x)).size).toBe(3);
        expect(new Set(labelOps.map((op) => op.y)).size).toBe(1);
        for (const op of spec.text.filter((op) => labels.includes(op.text))) expect(op.x).toBeCloseTo(84);
        expect(spec.text.map((op) => op.text).join("")).toContain("柔灰绿");
        expect(icons.text.some((op) => /^0[123]/.test(op.text))).toBe(false);
        for (const artwork of [icons, spec]) {
            for (const op of artwork.text) {
                expect(op.x).toBeGreaterThanOrEqual(zone.x * canvas.width);
                expect(op.y + op.size).toBeLessThanOrEqual((zone.y + zone.height) * canvas.height);
            }
        }
    });
    test("窄侧栏自动改为单列，不把三条卖点塞进窄小的三列", () => {
        const artwork = planStudioArtwork({ canvas, zone: { ...zone, width: 0.36 }, content, layout: "icons", measure });
        expect(new Set(artwork.rules.map((rule) => rule.y1)).size).toBe(3);
    });
    test("长参数值中的分隔符不丢失，过量文案明确失败", () => {
        expect(studioCopyPair("尺寸：53mm｜22mm｜150mm")).toEqual(["尺寸", "53mm｜22mm｜150mm"]);
        expect(() => planStudioArtwork({ canvas, zone: { ...zone, height: 0.05 }, content: { ...content, headline: "很长".repeat(30), lines: [] }, measure })).toThrow("文案超出");
    });
});
