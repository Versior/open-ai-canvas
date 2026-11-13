import { describe, expect, test } from "bun:test";

import { canvasNodeStateScale, canvasTextFontSize } from "@/lib/canvas/canvas-text-scale";

test("large node status stays readable after fitting the canvas, without overflowing thin nodes", () => {
    const visibleFontSize = 13 * canvasNodeStateScale(2720, 4480) * 0.2;
    expect(visibleFontSize).toBeCloseTo(20.8);
    expect(canvasNodeStateScale(340, 560)).toBe(1);
    expect(canvasNodeStateScale(2720, 120)).toBe(1);
});

describe("canvas text font scaling", () => {
    test("keeps the configured base size at the default node size", () => {
        expect(canvasTextFontSize(340, 240, 14)).toBe(14);
    });

    test("scales proportionally when the node grows in both directions", () => {
        expect(canvasTextFontSize(680, 480, 14)).toBeCloseTo(28);
    });

    test("responds when only one dimension changes", () => {
        expect(canvasTextFontSize(680, 240, 14)).toBeCloseTo(14 * Math.sqrt(2));
    });

    test("uses metadata font size as the base and clamps extremes", () => {
        expect(canvasTextFontSize(340, 240, 20)).toBe(20);
        expect(canvasTextFontSize(1, 1, 2)).toBe(8);
        expect(canvasTextFontSize(10_000, 10_000, 20)).toBe(72);
    });
});
