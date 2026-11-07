import type { StudioDesignToneId } from "./types";

export const STUDIO_SANS = '"Noto Sans SC Variable", sans-serif';
export const STUDIO_SERIF = '"Noto Serif SC Variable", serif';
export type StudioTypography = { family: string; headlineWeight: 300 | 400 | 500 | 600 | 700 | 800; headlineScale: number; tracking: number; lineHeight: number; sublineScale?: number };

/** 策划、提示词与导出共用；字体文件本地分片加载，不向字体服务发送商品文案。 */
export const STUDIO_TYPOGRAPHY: Record<StudioDesignToneId, StudioTypography & { instruction: string }> = {
    "global-minimal": { family: STUDIO_SANS, headlineWeight: 400, headlineScale: 1.05, tracking: 0.03, lineHeight: 1.16, instruction: "现代黑体常规字重，标题约短边 8%，微宽字距，正文约标题 36%；用尺寸与留白建立层级，不全部加粗" },
    editorial: { family: STUDIO_SANS, headlineWeight: 800, headlineScale: 1.5, tracking: -0.015, lineHeight: 1.06, sublineScale: 0.28, instruction: "杂志粗黑标题，约短边 11%，紧凑行距；标题最多两行，说明用常规细黑体约标题 28%，大胆裁切摄影配小字题签" },
    oriental: { family: STUDIO_SERIF, headlineWeight: 500, headlineScale: 1.05, tracking: 0.08, lineHeight: 1.3, instruction: "标题用中等字重宋体，约短边 8%，宽字距；正文用黑体，标题与说明有明确呼吸间距，不加伪书法或印章" },
    lifestyle: { family: STUDIO_SANS, headlineWeight: 500, headlineScale: 0.88, tracking: 0.035, lineHeight: 1.25, instruction: "生活杂志中黑体标题，约短边 6.5%，自然宽字距；正文约标题 40%，用具体动作和材质描述，避免空洞态度口号" },
    tech: { family: STUDIO_SANS, headlineWeight: 500, headlineScale: 1.15, tracking: 0, lineHeight: 1.12, instruction: "利落黑体标题，关键数值约短边 15%，单位和条件用小号常规字；参数表标签与值分列，数字只取商品依据" },
    care: { family: STUDIO_SERIF, headlineWeight: 600, headlineScale: 1.02, tracking: 0.025, lineHeight: 1.2, instruction: "中宋体标题配黑体正文，约短边 7.5%；标签与依据说明分开，结论紧邻适用条件，不把每屏画成同一个信息卡" },
    "hot-seller": { family: STUDIO_SANS, headlineWeight: 800, headlineScale: 1.2, tracking: 0, lineHeight: 1.1, instruction: "粗黑体短标题，约短边 9%，正文常规黑体约标题 34%；一个核心利益点配可见证明，强调只用一个色彩角色，信息模块不用一串泛口号" },
    playful: { family: STUDIO_SANS, headlineWeight: 700, headlineScale: 1.12, tracking: 0.025, lineHeight: 1.16, instruction: "明快中粗黑体标题，约短边 8.5%，正文常规字；短句有动作和场景，每屏只选一个几何点缀，不重复堆圆角卡" },
};

export function studioTypography(tone?: StudioDesignToneId) {
    return STUDIO_TYPOGRAPHY[tone || "hot-seller"];
}

export function studioTypeInstruction(tone?: StudioDesignToneId) {
    return `${studioTypography(tone).instruction}。文字只使用提供的文案；缩到手机宽度仍须清晰，文字与底色有强对比，避开商品和人物五官。`;
}

/** 参数允许卖家常用的三种分隔符，保留值内的其余符号。 */
export function studioCopyPair(line: string): [string, string] {
    const match = /[｜：:]/.exec(line);
    return match ? [line.slice(0, match.index).trim(), line.slice(match.index + 1).trim()] : [line.trim(), ""];
}
