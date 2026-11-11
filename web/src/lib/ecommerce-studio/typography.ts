import type { StudioDesignToneId, StudioStylePresetId } from "./types";

export const STUDIO_SANS = '"Noto Sans SC Variable", sans-serif';
export const STUDIO_SERIF = '"Noto Serif SC Variable", serif';
export type StudioTypography = { family: string; headlineWeight: 300 | 400 | 500 | 600 | 700 | 800; headlineScale: number; tracking: number; lineHeight: number; sublineScale?: number };

/** 没经过策划的单张图也沿用卖家所选质感的字体体系。 */
export const STUDIO_STYLE_TONES: Record<StudioStylePresetId, StudioDesignToneId> = {
    mist: "global-minimal",
    warm: "lifestyle",
    noir: "global-minimal",
    fresh: "lifestyle",
    vivid: "hot-seller",
    pure: "global-minimal",
    wood: "lifestyle",
    cream: "lifestyle",
    tech: "tech",
    oriental: "oriental",
    luxe: "global-minimal",
    sport: "editorial",
    candy: "playful",
    organic: "lifestyle",
    editorial: "editorial",
};

/** 策划、提示词与导出共用；字体文件本地分片加载，不向字体服务发送商品文案。 */
export const STUDIO_TYPOGRAPHY: Record<StudioDesignToneId, StudioTypography & { instruction: string }> = {
    "global-minimal": { family: STUDIO_SANS, headlineWeight: 400, headlineScale: 1.05, tracking: 0.03, lineHeight: 1.16, instruction: "现代黑体常规字重，用大小、明暗与留白建立清楚层级；标题与摄影边界对齐，说明就近成组，不全部加粗" },
    editorial: {
        family: STUDIO_SANS,
        headlineWeight: 800,
        headlineScale: 1.5,
        tracking: -0.015,
        lineHeight: 1.06,
        sublineScale: 0.28,
        instruction: "杂志标题可用结构清晰的黑体或宋体，与常规黑体说明搭配；字重和字面按内容选择，语义分行与摄影共同构图，标题可醒目但不强制窄长、错位或特殊展示字",
    },
    oriental: {
        family: STUDIO_SERIF,
        headlineWeight: 500,
        headlineScale: 1.05,
        tracking: 0.08,
        lineHeight: 1.3,
        instruction: "标题用中等字重宋体，横细竖粗、收笔与小衬线清晰；正文用黑体，分行与字距服从语义和空间，标题与说明有明确呼吸间距，不加伪书法或印章",
    },
    lifestyle: {
        family: STUDIO_SANS,
        headlineWeight: 500,
        headlineScale: 0.88,
        tracking: 0.035,
        lineHeight: 1.25,
        instruction: "生活杂志中黑体标题，字面舒展、笔画均匀；以真实动作和可见细节组织图文，说明按手机阅读设置足够字号，层级靠字重、位置和留白共同形成",
    },
    tech: { family: STUDIO_SANS, headlineWeight: 500, headlineScale: 1.15, tracking: 0, lineHeight: 1.12, instruction: "利落黑体标题，已确认的关键数值可强调，单位和条件保持清晰并紧邻数值；参数标签与值分列，数字只取商品依据" },
    care: { family: STUDIO_SERIF, headlineWeight: 600, headlineScale: 1.02, tracking: 0.025, lineHeight: 1.2, instruction: "中宋体标题配黑体正文，结论紧邻适用条件，标签与依据清楚分组；层级克制、阅读连贯，不把每屏画成同一个信息卡" },
    "hot-seller": { family: STUDIO_SANS, headlineWeight: 800, headlineScale: 1.2, tracking: 0, lineHeight: 1.1, instruction: "粗黑体短标题配常规黑体说明，一个核心利益点与可见证明形成主焦点；强调色承担一个信息角色，用尺度和邻近组织阅读，不堆泛口号" },
    playful: { family: STUDIO_SANS, headlineWeight: 700, headlineScale: 1.12, tracking: 0.025, lineHeight: 1.16, instruction: "明快中粗黑体标题配常规正文，短句与真实动作或场景就近成组；几何点缀仅在有构成用途时使用，字重、间距和色彩保持清楚主次" },
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
