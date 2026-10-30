/**
 * 各平台对商品图的硬性规范，以及可机器检测的那部分校验。
 *
 * 行业现状：白底是不是 RGB(255,255,255)、主体占比够不够、文字面积超没超、尺寸对不对——
 * 全靠美工肉眼核对，出错了等平台事后驳回。这些指标全都可以机器检测。
 * 没有任何一个现有工具把「规范校验 + 合规检测 + 批量套版 + 版本管理」整合在一起。
 *
 * 注意：平台规则随时会变，这里的数值是 2026 年前后的公开口径，落地上架前应以商家后台
 * 最新提示为准。工具能保证的是「按这份规范自查」，不能保证「平台一定放行」。
 */

export type EcommercePlatformId = "taobao" | "jd" | "pdd" | "douyin" | "xiaohongshu" | "amazon" | "walmart" | "etsy" | "tiktokshop" | "shopify";

/** 一张图在整套里的角色——同一张图按不同角色上传，规范不一样。 */
export type EcommerceImageRole = "main" | "white" | "detail" | "sku" | "promo" | "cover" | "video" | "ad";

export type EcommerceRoleSpec = {
    label: string;
    /** 最小尺寸（像素）。平台按长边算，这里两轴都写出来便于直接比较。 */
    minWidth?: number;
    minHeight?: number;
    /** 建议尺寸，展示用 */
    recommended?: string;
    /** 宽高比，如 "1:1"；不填表示不限 */
    ratio?: string;
    /** 允许的比例清单；填了就不看 ratio，用于「16:9 或 9:16 都行」这种 */
    allowedRatios?: string[];
    /** 文件大小上限（字节） */
    maxBytes?: number;
    /** 主体占画面的最小比例（0–1） */
    minSubjectRatio?: number;
    /** 文字面积上限（0–1） */
    maxTextRatio?: number;
    /** 是否必须纯白底 */
    whiteBackground?: boolean;
    /** 是否禁止任何文字 */
    noText?: boolean;
    /** 一张主图最多几个角标 */
    maxBadges?: number;
    /** 必须带可见的「AI 生成」标识。TikTok Shop 对纯生成图有硬性要求。 */
    requiresAiDisclosure?: boolean;
    /** 四周留白的最大比例（0–1）。沃尔玛对边框有上限。 */
    maxBorderRatio?: number;
    /** 交付命名里这一角色用哪个词；不填走中文默认。 */
    fileNameRole?: string;
    note: string;
};

export type EcommercePlatformSpec = {
    id: EcommercePlatformId;
    name: string;
    roles: Partial<Record<EcommerceImageRole, EcommerceRoleSpec>>;
};

export const ECOMMERCE_PLATFORMS: EcommercePlatformSpec[] = [
    {
        id: "taobao", name: "淘宝 / 天猫",
        roles: {
            main: { label: "主图", minWidth: 800, minHeight: 800, recommended: "1200×1200", ratio: "1:1", maxBytes: 3 * 1024 * 1024, maxTextRatio: 0.1, maxBadges: 1, note: "文字面积建议 ≤10%；10–20% 会被警告，超过 20% 判违规。禁「包邮」「满减」等促销词与直接标价" },
            white: { label: "白底图", minWidth: 800, minHeight: 800, ratio: "1:1", maxBytes: 3 * 1024 * 1024, whiteBackground: true, noText: true, minSubjectRatio: 0.6, note: "纯白 RGB(255,255,255)，主体 ≥60%，无文字水印边框阴影。合规白底图会被手淘「猜你喜欢」自动抓取" },
            detail: { label: "详情页", minWidth: 750, maxBytes: 3 * 1024 * 1024, note: "宽 750，单张高 ≤1100，总数 ≤50 张" },
            video: {
                label: "主图视频", fileNameRole: "VIDEO",
                allowedRatios: ["3:4", "1:1", "16:9"], maxBytes: 1.5 * 1024 * 1024 * 1024,
                note: "建议 15 秒、最长 60 秒，≥720p。**9:16 上传后商详不展示**——别把抖音那版直接搬过来。最多 5 个，前 3 个且比例为 1:1 或 3:4 且审核通过才进详情页；首帧禁止全屏黑白、闪屏、水印与二维码",
            },
        },
    },
    {
        id: "jd", name: "京东",
        roles: {
            main: { label: "主图", minWidth: 800, minHeight: 800, recommended: "1200×1200", ratio: "1:1", maxBytes: 1024 * 1024, noText: true, note: "首图不额外叠加文字或 LOGO；商品本体自带的商标、包装文字属于真实商品，保留不动。品牌 LOGO 是否由平台自动叠加、占多大，以上架后台确认。拍摄色温 5500K±500K" },
            white: { label: "白底图", minWidth: 800, minHeight: 800, ratio: "1:1", whiteBackground: true, noText: true, minSubjectRatio: 0.8, note: "自营强制白底，不合格采购直接驳回；主体占比自营 ≥80%、POP ≥70%" },
            video: { label: "主图视频", fileNameRole: "VIDEO", allowedRatios: ["1:1", "3:4"], note: "主图视频 1:1 或 3:4，15–60 秒，≥720p；首帧需为商品画面，不要纯色开场" },
        },
    },
    {
        id: "pdd", name: "拼多多",
        roles: {
            main: { label: "主图", minWidth: 800, minHeight: 800, ratio: "1:1", note: "最多 10 张；活动主图 750×352、≤100KB。禁拼接、水印、促销文案、留白、边框、镂空" },
            white: { label: "白底图", minWidth: 480, minHeight: 480, ratio: "1:1", maxBytes: 3 * 1024 * 1024, whiteBackground: true, noText: true, minSubjectRatio: 0.6, note: "480×480 起，单主体、正面，无衣架与杂物。白底图审核通过能提高活动报名成功率" },
            detail: { label: "详情页", minWidth: 480, maxBytes: 1024 * 1024, note: "宽 480–1200，单张高 ≤1500，≤20 张" },
        },
    },
    {
        id: "douyin", name: "抖音（抖店）",
        roles: {
            main: { label: "主图", minWidth: 600, minHeight: 600, recommended: "1200×1200 或 750×1000", maxBytes: 3 * 1024 * 1024, noText: true, note: "第 1 张主图禁任何文字，含包邮、特价、emoji 与边框；卖点放第 2–5 张。3:4 竖图在信息流多占三分之一屏，转化更好" },
            white: { label: "白底图", minWidth: 800, minHeight: 800, whiteBackground: true, noText: true, minSubjectRatio: 0.6, note: "≥800×800" },
            detail: { label: "详情页", minWidth: 750, note: "宽 750，单张高 ≤2000，累计 ≤16000" },
            video: {
                label: "商品视频", fileNameRole: "VIDEO",
                allowedRatios: ["9:16"], minHeight: 1080, maxBytes: 1024 * 1024 * 1024,
                note: "9:16（1080×1920），3–60 秒。商品卡可关联 3–5 张主图自动合成轮播视频；首帧禁止二维码、第三方 Logo 与夸大对比图",
            },
        },
    },
    {
        id: "xiaohongshu", name: "小红书",
        roles: {
            main: { label: "商品主图", minWidth: 800, minHeight: 800, recommended: "800×800 或 750×1000", note: "商品核心信息避开封面底部 15%，会被价格条遮挡" },
            cover: { label: "笔记封面", minWidth: 1242, minHeight: 1660, ratio: "3:4", maxTextRatio: 0.3, note: "1242×1660，文字面积 ≤30%，超过判广告限流" },
            detail: { label: "详情页", minWidth: 750, note: "宽 750–1242" },
            video: { label: "笔记视频", fileNameRole: "VIDEO", allowedRatios: ["3:4", "9:16"], note: "竖版；封面仍是 3:4 的静帧，决定点不点开" },
        },
    },

    // ── 海外平台 ──────────────────────────────────────────────
    //
    // 海外规范的严格程度和国内不是一回事：亚马逊主图是「纯白 + 主体 85% + 无任何文字」
    // 三条同时卡，而且主体占比按最长边算。这几条都能机器测，所以直接进校验。
    {
        id: "amazon", name: "Amazon",
        roles: {
            main: {
                label: "主图", fileNameRole: "MAIN",
                minWidth: 1000, minHeight: 1000, recommended: "2000×2000", ratio: "1:1",
                maxBytes: 10 * 1024 * 1024,
                whiteBackground: true, noText: true, minSubjectRatio: 0.85,
                note: "纯白 RGB(255,255,255)、sRGB。主体占 85%–100%，且必须是实拍不是渲染图。不额外叠加文字、LOGO、水印、角标、边框、画中画与任何道具；商品本体自带的商标与包装文字属于真实商品，保留不动。长边 500px 才能展示，1000px 才开放大镜，1600px 以上桌面与移动端都能放大，上限 10000px",
            },
            white: {
                label: "白底图", fileNameRole: "WHITE",
                minWidth: 1000, minHeight: 1000, ratio: "1:1", maxBytes: 10 * 1024 * 1024,
                whiteBackground: true, noText: true, minSubjectRatio: 0.85,
                note: "与主图同规范。部分类目要求模特图或平铺图作首图，另有些类目禁止人台",
            },
            detail: {
                label: "附图", fileNameRole: "ALT",
                minWidth: 1000, minHeight: 1000, maxBytes: 10 * 1024 * 1024,
                note: "第 2–9 位放场景、卖点、尺寸、细节、对比、包装。非品牌备案 7 个图位，备案后 6 图 + 1 视频",
            },
            video: {
                label: "商品视频", fileNameRole: "VIDEO",
                allowedRatios: ["16:9", "9:16"], maxBytes: 5 * 1024 * 1024 * 1024,
                note: "mp4/mov，H.264 或 H.265，720p 起（1080p 上限），23.976 或 30fps，1–12 分钟。不要黑边与幻灯片式剪辑，前 5–10 秒讲清卖点，静音也要看得懂",
            },
            ad: {
                label: "品牌推广图", fileNameRole: "AD",
                minWidth: 1200, minHeight: 628, ratio: "1.91:1", maxBytes: 5 * 1024 * 1024,
                noText: true,
                note: "1200×628、1.91:1、sRGB。必须展示商品在使用中或生活场景里；不额外叠加文字、图形、LOGO、水印，商品本体自带的商标与包装文字保留不动；**不许用白底或透明底**——和主图规范正好相反，别把主图直接复用",
            },
        },
    },
    {
        id: "walmart", name: "Walmart",
        roles: {
            main: {
                label: "主图", fileNameRole: "MAIN",
                minWidth: 1500, minHeight: 1500, recommended: "2200×2200", ratio: "1:1",
                maxBytes: 5 * 1024 * 1024,
                whiteBackground: true, noText: true, minSubjectRatio: 0.5, maxBorderRatio: 0.025,
                note: "纯白 255/255/255、sRGB、300ppi。2200×2200 最佳，1500px 起才有放大镜。主体占画面 ≥50%，四周留白 ≤2.5%。最少 4 张图，禁文字与水印",
            },
            detail: {
                label: "附图", fileNameRole: "ALT",
                minWidth: 1500, minHeight: 1500, ratio: "1:1", maxBytes: 5 * 1024 * 1024,
                note: "四类图：Silo（白底）、Lifestyle（场景）、Graphics（信息图）、Detail（细节）",
            },
        },
    },
    {
        id: "etsy", name: "Etsy",
        roles: {
            main: {
                label: "首图", fileNameRole: "MAIN",
                minWidth: 635, recommended: "2000×2000", maxBytes: 1024 * 1024,
                note: "首图小于 635px 会被搜索降权，2000px 起才有放大。文件建议 ≤1MB。首图用横版或方图并留出边距，避免被裁。**不要用透明 PNG**——Etsy 会把透明区域渲染成黑色",
            },
            detail: {
                label: "附图", fileNameRole: "ALT",
                minWidth: 635, maxBytes: 1024 * 1024,
                note: "最多 10 张图 + 1 个视频，sRGB",
            },
            video: { label: "视频", fileNameRole: "VIDEO", note: "每个商品 1 个视频" },
        },
    },
    {
        id: "tiktokshop", name: "TikTok Shop",
        roles: {
            main: {
                label: "主图", fileNameRole: "MAIN",
                minWidth: 1000, minHeight: 1000, recommended: "1000×1000 以上", ratio: "1:1",
                maxBytes: 10 * 1024 * 1024,
                whiteBackground: true, noText: true,
                requiresAiDisclosure: true,
                note: "≥600×600 才能上，1000px 以上且 5 张以上才算「Good」等级。主图用纯白或中性底，禁文字、贴纸、边框。**纯 AI 生成的商品图必须带可见的「AI-generated」标识**；AI 修图（抠背景、重新打光、清理）不受此限",
            },
            cover: { label: "商品卡长图", fileNameRole: "CARD", ratio: "3:4", minWidth: 750, minHeight: 1000, note: "商品卡必须 3:4 竖图；视频用 9:16" },
            video: { label: "商品视频", fileNameRole: "VIDEO", allowedRatios: ["9:16"], note: "1080×1920 竖版" },
        },
    },
    {
        id: "shopify", name: "Shopify（独立站）",
        roles: {
            main: {
                label: "主图", fileNameRole: "MAIN",
                minWidth: 1000, minHeight: 1000, recommended: "2048×2048", ratio: "1:1",
                note: "独立站没有平台审核，规范由主题决定。2048×2048 覆盖绝大多数主题的缩放需求，也是 3D 与 AR 视图的推荐尺寸",
            },
            detail: { label: "附图", fileNameRole: "ALT", recommended: "2048×2048", note: "可上传 GLB 模型自动生成 USDZ，供 iPhone AR 查看" },
            video: { label: "视频", fileNameRole: "VIDEO", note: "主题内嵌播放，无平台硬性规范" },
        },
    },
];

function normalizeEcommercePlatformName(value: string) {
    return value.trim().toLowerCase().replace(/[\s/／_()（）-]+/g, "");
}

const ECOMMERCE_PLATFORM_ALIASES: Record<string, EcommercePlatformId> = {
    淘宝: "taobao",
    天猫: "taobao",
    tmall: "taobao",
    京东: "jd",
    京东商城: "jd",
    拼多多: "pdd",
    pinduoduo: "pdd",
    抖音: "douyin",
    抖店: "douyin",
    小红书: "xiaohongshu",
    rednote: "xiaohongshu",
    redbook: "xiaohongshu",
    亚马逊: "amazon",
    沃尔玛: "walmart",
    独立站: "shopify",
};

/** Resolve user-facing names and aliases once before platform-specific planning or delivery. */
export function resolveEcommercePlatformId(value?: string): EcommercePlatformId | undefined {
    if (!value?.trim()) return undefined;
    const normalized = normalizeEcommercePlatformName(value);
    const platform = ECOMMERCE_PLATFORMS.find((item) => normalizeEcommercePlatformName(item.id) === normalized || normalizeEcommercePlatformName(item.name) === normalized);
    return platform?.id || ECOMMERCE_PLATFORM_ALIASES[normalized];
}

export function ecommercePlatform(id: EcommercePlatformId) {
    return ECOMMERCE_PLATFORMS.find((platform) => platform.id === id);
}

export function ecommerceRoleSpec(platformId: EcommercePlatformId, role: EcommerceImageRole) {
    return ecommercePlatform(platformId)?.roles[role];
}

/**
 * 下拉里这个平台选项带什么口径：有内置角色规范才算「专属规格」，其余一律「通用建议」。
 * 没收录的平台不能假装自己有规格，也不能因此被清掉——用户填的自定义平台原样保留。
 */
export function ecommercePlatformChoiceTier(value?: string): "专属规格" | "通用建议" {
    const id = resolveEcommercePlatformId(value);
    return id && Object.keys(ecommercePlatform(id)?.roles ?? {}).length ? "专属规格" : "通用建议";
}

/** 下拉里的显示文案。只加后缀，选项值仍是用户那一串原文。 */
export function ecommercePlatformChoiceLabel(value: string) {
    return value.trim() ? `${value} · ${ecommercePlatformChoiceTier(value)}` : "";
}

// ── 校验 ────────────────────────────────────────────────────

export type EcommerceSpecIssue = {
    level: "block" | "warn";
    /** 哪个平台、哪个角色 */
    scope: string;
    message: string;
};

/** 可以判 block 的规则类别。没进 verifiedHardRules 的一律按建议处理。 */
export type EcommerceHardRule = "minSize" | "ratio" | "maxBytes" | "whiteBackground" | "minSubjectRatio" | "noText" | "maxTextRatio" | "aiDisclosure";

/**
 * 已核验的官方硬规则：来源、日期、适用范围三者齐全才能进表。
 * 空表是当前事实——内置数值都是业内公开口径，没有逐条拿到可核验的官方出处，
 * 所以只做建议（warn），不冒充平台硬性要求。补一条要先核验一条。
 */
const VERIFIED_HARD_RULES: Partial<Record<`${EcommercePlatformId}:${EcommerceImageRole}`, readonly EcommerceHardRule[]>> = {};

export type EcommerceImageFacts = {
    width: number;
    height: number;
    /** 文件字节数；未知时跳过大小校验 */
    bytes?: number;
    /** 图像检测结果；未检测时跳过依赖它的校验 */
    audit?: EcommerceImageAudit;
};

/** 图像检测结果。前端能测的都在这里，测不了的留 undefined 而不是猜。 */
export type EcommerceImageAudit = {
    /** 四角与边缘采样里纯白的比例（0–1） */
    whiteEdgeRatio?: number;
    /** 四角平均色，十六进制 */
    cornerColor?: string;
    /** 由模型判定的主体占比与文字占比；前端测不了 */
    subjectRatio?: number;
    textRatio?: number;
    /** 画面里识别到的文字 */
    detectedText?: string[];
    /** 这张图是不是模型纯生成的（不是 AI 修图）。TikTok Shop 对纯生成图有标识要求。 */
    generated?: boolean;
};

function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

/** "1.91:1" 这类小数比例按数值比较，按最简整数比永远对不上。 */
function ratioValue(label: string) {
    const [width, height] = label.split(":").map(Number);
    return width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : NaN;
}

/** 项目自己的 1% 容差：1242×1660 也算 3:4。这是本项目的判断尺度，不是平台官方事实。 */
const RATIO_TOLERANCE = 0.01;

/** 把宽高化简成最简比，用于和规范里的 "1:1"、"3:4" 比较。 */
export function aspectRatioLabel(width: number, height: number) {
    if (!width || !height) return "";
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}

/**
 * 按平台规范校验一张图。
 *
 * 只报能确定的：尺寸、比例、文件大小一定算得出来；白底、主体占比、文字占比要看
 * audit 有没有值——测不了就跳过，不用猜测填满报告。测不了的项由调用方走模型判定。
 */
export function checkImageAgainstSpec(input: { platformId: EcommercePlatformId; role: EcommerceImageRole; facts: EcommerceImageFacts }): EcommerceSpecIssue[] {
    const platform = ecommercePlatform(input.platformId);
    const spec = platform?.roles[input.role];
    if (!platform || !spec) return [];
    const scope = `${platform.name} · ${spec.label}`;
    const issues: EcommerceSpecIssue[] = [];
    const { width, height, bytes, audit } = input.facts;
    const verified = VERIFIED_HARD_RULES[`${input.platformId}:${input.role}`] ?? [];
    // 没核验过的平台口径只提醒；核验过的那条才拦。
    const severity = (rule: EcommerceHardRule): EcommerceSpecIssue["level"] => (verified.includes(rule) ? "block" : "warn");
    const measurable = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

    if (!measurable) {
        // 量不出尺寸不等于合规：NaN、Infinity、零边都只说「没核对」，不给通过。
        // 也不能把 NaN 印给用户，交付清单会直接抄这句话。
        if (spec.minWidth || spec.minHeight || spec.ratio || spec.allowedRatios?.length) issues.push({ level: "warn", scope, message: "未量到原图尺寸，无法核对最低尺寸与比例" });
    } else {
        if (spec.minWidth && width < spec.minWidth) issues.push({ level: severity("minSize"), scope, message: `宽 ${width} 小于建议的 ${spec.minWidth}` });
        if (spec.minHeight && height < spec.minHeight) issues.push({ level: severity("minSize"), scope, message: `高 ${height} 小于建议的 ${spec.minHeight}` });
        // allowedRatios 优先，两者不会同时出现在一条规范里，避免双重 block。
        const wanted = spec.allowedRatios?.length ? spec.allowedRatios : spec.ratio ? [spec.ratio] : [];
        const expected = wanted.map(ratioValue).filter((value) => Number.isFinite(value));
        if (expected.length && !expected.some((value) => Math.abs(width / height / value - 1) <= RATIO_TOLERANCE)) {
            issues.push({ level: severity("ratio"), scope, message: `比例 ${aspectRatioLabel(width, height)} 与内置规范 ${wanted.join(" 或 ")} 不符` });
        }
    }
    if (spec.maxBytes && bytes && bytes > spec.maxBytes) {
        issues.push({ level: severity("maxBytes"), scope, message: `文件 ${(bytes / 1024 / 1024).toFixed(1)}MB 超过上限 ${(spec.maxBytes / 1024 / 1024).toFixed(0)}MB` });
    }
    if (spec.whiteBackground && audit?.whiteEdgeRatio !== undefined && audit.whiteEdgeRatio < 0.98) {
        issues.push({ level: severity("whiteBackground"), scope, message: `背景不是纯白（边缘纯白占比 ${(audit.whiteEdgeRatio * 100).toFixed(0)}%，要求 ≥98%），当前四角为 ${audit.cornerColor || "未知"}` });
    }
    if (spec.minSubjectRatio && audit?.subjectRatio !== undefined && audit.subjectRatio < spec.minSubjectRatio) {
        issues.push({ level: severity("minSubjectRatio"), scope, message: `主体占画面 ${(audit.subjectRatio * 100).toFixed(0)}%，低于要求的 ${(spec.minSubjectRatio * 100).toFixed(0)}%` });
    }
    if (spec.noText && audit?.textRatio !== undefined && audit.textRatio > 0.005) {
        issues.push({ level: severity("noText"), scope, message: `该位置不允许出现文字，检测到文字面积约 ${(audit.textRatio * 100).toFixed(1)}%` });
    }
    if (!spec.noText && spec.maxTextRatio && audit?.textRatio !== undefined && audit.textRatio > spec.maxTextRatio) {
        issues.push({ level: audit.textRatio > spec.maxTextRatio * 2 ? severity("maxTextRatio") : "warn", scope, message: `文字面积 ${(audit.textRatio * 100).toFixed(1)}%，超过建议的 ${(spec.maxTextRatio * 100).toFixed(0)}%` });
    }
    // 纯 AI 生成的图在 TikTok Shop 必须带可见标识。这条测不了——它是「有没有加标识」，
    // 不是画面属性——所以只要出图是生成的，就一律提醒一次，由人来确认加没加。
    if (spec.requiresAiDisclosure && audit?.generated) {
        issues.push({ level: severity("aiDisclosure"), scope, message: "该平台要求纯 AI 生成的图带可见的「AI-generated」标识；AI 修图（抠背景、重新打光）不受此限" });
    }
    return issues;
}

/** 一张图在多个平台/角色下的全部问题。 */
export function checkImageAcrossPlatforms(facts: EcommerceImageFacts, targets: { platformId: EcommercePlatformId; role: EcommerceImageRole }[]) {
    return targets.flatMap((target) => checkImageAgainstSpec({ ...target, facts }));
}

/** 有没有硬拦项。 */
export function ecommerceSpecBlocked(issues: EcommerceSpecIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

// ── 命名 ────────────────────────────────────────────────────

/**
 * 交付命名规范：`商品编码-用途-版本-变动`。
 *
 * 行业共识里有两条硬规矩：禁用「最终版」（版本号只增不减），源文件与切图分开放。
 * 这里只生成切图名，源文件由画布自己保存。
 *
 * 用途词跟着平台走：国内平台用中文（主图/白底/详情），海外平台用规范里的英文
 * （MAIN/ALT/VIDEO）。跨境的交付清单要直接进 Amazon/Walmart 后台上传，中文名会被拒。
 */
const FILE_NAME_ROLE_FALLBACK: Record<EcommerceImageRole, string> = {
    main: "主图", white: "白底", detail: "详情", sku: "SKU", promo: "推广", cover: "封面", video: "视频", ad: "广告",
};

export function ecommerceFileName(input: { code: string; role: EcommerceImageRole; index: number; version?: number; variant?: string; platformId?: EcommercePlatformId; extension?: string }) {
    const code = input.code.trim() || "ITEM";
    const platform = input.platformId ? ecommercePlatform(input.platformId) : undefined;
    const role = platform?.roles[input.role]?.fileNameRole || FILE_NAME_ROLE_FALLBACK[input.role];
    const index = String(input.index).padStart(2, "0");
    const parts = [code, role, index];
    if (input.variant?.trim()) parts.push(input.variant.trim());
    if (input.platformId) parts.push(input.platformId);
    parts.push(`v${input.version ?? 1}`);
    return `${parts.join("_")}.${input.extension || "jpg"}`;
}
