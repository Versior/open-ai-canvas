import { describe, expect, test } from "bun:test";

import { canvasThemes } from "../src/lib/canvas-theme";
import { getAntThemeConfig } from "../src/lib/app-theme";

function contrast(foreground: string, background: string) {
    const luminance = (hex: string) =>
        hex
            .slice(1)
            .match(/../g)!
            .map((channel) => parseInt(channel, 16) / 255)
            .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("canvas visual contrast", () => {
    test("dark auxiliary text stays readable on node surfaces", () => {
        for (const ink of [canvasThemes.dark.node.muted, canvasThemes.dark.node.faint, canvasThemes.dark.node.placeholder]) {
            expect(contrast(ink, canvasThemes.dark.node.fill)).toBeGreaterThanOrEqual(4.5);
        }
    });
    test("light auxiliary text stays readable on white and selected surfaces", () => {
        for (const ink of [canvasThemes.light.node.muted, canvasThemes.light.node.faint, canvasThemes.light.node.placeholder]) {
            for (const surface of ["#ffffff", "#eaeaea"]) expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(getAntThemeConfig(false).components!.Segmented!.itemColor as string, "#f7f7f7")).toBeGreaterThanOrEqual(4.5);
    });
    test("uses white light surfaces and contrasting dark canvas surfaces", () => {
        expect(canvasThemes.light.canvas.background.toLowerCase()).toBe(canvasThemes.light.node.fill.toLowerCase());
        expect(canvasThemes.dark.canvas.background.toLowerCase()).not.toBe(canvasThemes.dark.node.fill.toLowerCase());
        expect(canvasThemes.light.node.panel.toLowerCase()).toBe(canvasThemes.light.canvas.background.toLowerCase());
        expect(canvasThemes.dark.node.panel.toLowerCase()).not.toBe(canvasThemes.dark.canvas.background.toLowerCase());
    });

    test("changes only the canvas substrate while retaining original surfaces", () => {
        expect(canvasThemes.light.canvas.background).toBe("#FFFFFF");
        expect(canvasThemes.light.node.fill).toBe("#ffffff");
        expect(canvasThemes.light.node.edge).toBe("rgba(15,23,42,.16)");
        expect(canvasThemes.light.node.shadow).toBe("0 6px 18px rgba(15,23,42,.08)");
        expect(canvasThemes.light.node.hoverShadow).toBe("0 10px 24px rgba(15,23,42,.12)");
        expect(canvasThemes.light.toolbar.panel).toBe("rgba(255,255,255,.94)");
        expect(canvasThemes.light.spatial.elevated).toBe("rgba(255,255,255,.94)");

        expect(canvasThemes.dark.canvas.background).toBe("#000000");
        expect(canvasThemes.dark.node.fill).toBe("#181818");
        expect(canvasThemes.dark.node.edge).toBe("rgba(255,255,255,.18)");
        expect(canvasThemes.dark.node.shadow).toBe("0 8px 24px rgba(0,0,0,.34)");
        expect(canvasThemes.dark.node.hoverShadow).toBe("0 12px 30px rgba(0,0,0,.46)");
        expect(canvasThemes.dark.toolbar.panel).toBe("rgba(20,20,20,.97)");
        expect(canvasThemes.dark.toolbar.border).toBe("rgba(255,255,255,.1)");
        expect(canvasThemes.dark.spatial.elevated).toBe("rgba(15,15,15,.97)");
    });

    test("pins intentional grid tokens while retaining canvas grid opacity", async () => {
        expect(canvasThemes.light.canvas.dot).toBe("rgba(0,0,0,.80)");
        expect(canvasThemes.light.canvas.line).toBe("rgba(0,0,0,.80)");
        expect(canvasThemes.dark.canvas.dot).toBe("rgba(255,255,255,.32)");
        expect(canvasThemes.dark.canvas.line).toBe("rgba(255,255,255,.32)");

        const source = await Bun.file(new URL("../src/components/canvas/canvas-viewport.tsx", import.meta.url)).text();
        expect(source).toContain('opacity: mode === "dots" ? 0.62 : 0.4');
    });

    test("separates white nodes from the canvas without adding borders to media", async () => {
        const source = await Bun.file(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url)).text();

        expect(contrast(canvasThemes.light.node.border, canvasThemes.light.canvas.background)).toBeGreaterThanOrEqual(1.5);
        expect(canvasThemes.dark.node.border).toBe("transparent");
        expect(source).toContain('hasImageContent || hasVideoContent ? "transparent" : theme.node.border');
    });
});
