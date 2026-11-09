import { expect, test } from "bun:test";
import { canvasThemes } from "@/lib/canvas-theme";
import { agentSkinTheme, agentSpriteAccent, resolveAgentSkin } from "@/lib/canvas/agent-skin";

test("automatic skin follows personality, while manual selection stays fixed", () => {
    expect(resolveAgentSkin("auto", "robot")).toBe("terminal");
    expect(resolveAgentSkin("auto", "mystic")).toBe("aurora");
    expect(resolveAgentSkin("paper", "robot")).toBe("paper");
});
test("sprite palette ignores transparent pixels, outlines and highlights", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 240, 180, 20, 255, 240, 180, 20, 255, 20, 180, 200, 255]);
    expect(agentSpriteAccent(pixels)).toBe("#f0b414");
    expect(agentSpriteAccent(new Uint8ClampedArray([0, 0, 0, 0]))).toBeUndefined();
});
test("custom dialog skin preserves danger and status semantics and never mutates canvas", () => {
    const original = JSON.stringify(canvasThemes.dark);
    const skin = agentSkinTheme(canvasThemes.dark, "aurora", "#a040d0");
    expect(skin.accent.primary).toBe("#a040d0");
    expect(skin.accent.danger).toBe(canvasThemes.dark.accent.danger);
    expect(skin.node.text).toBe(canvasThemes.dark.node.text);
    expect(JSON.stringify(canvasThemes.dark)).toBe(original);
    expect(agentSkinTheme(canvasThemes.dark, "site")).toBe(canvasThemes.dark);
});
