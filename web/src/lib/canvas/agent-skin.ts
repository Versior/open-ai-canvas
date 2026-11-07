import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AgentPetTone } from "@/services/api/agent-pets";

export const AGENT_SKINS = [
    { id: "auto", label: "随形象", detail: "跟随形象的性格配色" },
    { id: "cloud", label: "云朵", detail: "轻柔的漫画气泡" },
    { id: "paper", label: "手账", detail: "暖色便签与圆角对话" },
    { id: "terminal", label: "终端", detail: "清晰利落的机械风格" },
    { id: "aurora", label: "星光", detail: "紫色微光与柔和边框" },
    { id: "site", label: "默认", detail: "沿用工作台主题" },
] as const;
export type AgentSkin = (typeof AGENT_SKINS)[number]["id"];
export type ResolvedAgentSkin = Exclude<AgentSkin, "auto">;

export function resolveAgentSkin(skin: AgentSkin, tone?: AgentPetTone | ""): ResolvedAgentSkin {
    if (skin !== "auto") return skin;
    if (tone === "robot") return "terminal";
    if (tone === "mystic") return "aurora";
    if (tone === "puppy" || tone === "sunny") return "paper";
    return "cloud";
}

export function agentSkinAccent(skin: ResolvedAgentSkin) {
    return { cloud: "var(--palette-node-image)", paper: "var(--palette-status-warning)", terminal: "var(--palette-status-success)", aurora: "var(--palette-node-script)", site: "" }[skin];
}

/** 只改变对话外观，审批、错误等状态颜色继续使用原主题。 */
export function agentSkinTheme(theme: CanvasTheme, skin: ResolvedAgentSkin, palette?: string): CanvasTheme {
    const accent = palette || agentSkinAccent(skin);
    if (!accent) return theme;
    return {
        ...theme,
        node: { ...theme.node, agentUserMessage: `color-mix(in srgb, ${accent} 14%, ${theme.node.panel})` },
        accent: { ...theme.accent, primary: accent, primarySoft: `color-mix(in srgb, ${accent} 12%, transparent)` },
    };
}

/** 从不透明的彩色像素选代表色，忽略透明区、黑色轮廓和白色高光。 */
export function agentSpriteAccent(pixels: Uint8ClampedArray) {
    const buckets = new Map<string, { weight: number; r: number; g: number; b: number }>();
    for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b, a] = pixels.subarray(i, i + 4);
        const high = Math.max(r, g, b),
            low = Math.min(r, g, b);
        if (a < 128 || high < 60 || low > 235 || high - low < 35) continue;
        const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
        const weight = (high - low) / 255;
        const bucket = buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
        bucket.weight += weight;
        bucket.r += r * weight;
        bucket.g += g * weight;
        bucket.b += b * weight;
        buckets.set(key, bucket);
    }
    const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
    if (!best) return undefined;
    return `#${[best.r, best.g, best.b]
        .map((value) =>
            Math.round(value / best.weight)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}
