import { ecommerceVideoReplicaBlock, type EcommerceVideoReplica } from "./ecommerce-video-replica";

/**
 * 电商视频——主图视频、轮播视频、卖点视频。
 *
 * 这一块之前完全没做，而它是现在电商的第一梯队需求：
 * 淘宝主图视频权重高、审核不过就不展示；抖音商品视频是流量入口；
 * 亚马逊的品牌备案后是「6 图 + 1 视频」，视频直接进图片轮播。
 *
 * 和内容创作视频的区别在于：**电商视频有硬性规格，而且素材是现成的**。
 * 一套图已经出好了，视频要做的不是「从零生成」，而是**把已有的图编排成片**——
 * 哪个镜头用哪张图、停多久、怎么运动、配什么字幕。
 *
 * 所以这一层不写视频模型提示词，只做两件事：
 * 1. **编排**——把一套图排成镜头表，每个镜头有图、时长、运动、字幕
 * 2. **守规格**——比例、时长、码率、首帧限制，全部按平台卡
 */

export type EcommerceVideoKind =
    | "main"        // 主图视频：挂在商品主图位
    | "carousel"    // 轮播视频：几张主图合成轮播，抖音商品卡的「一键制作」
    | "selling"     // 卖点视频：逐条讲卖点
    | "demo"        // 使用演示
    | "seed";       // 种草短视频

export const ECOMMERCE_VIDEO_KINDS: { id: EcommerceVideoKind; name: string; hint: string; platform: EcommerceVideoPlatform }[] = [
    { id: "main", name: "主图视频", hint: "挂在商品主图位，15 秒讲清一件商品", platform: "taobao" },
    { id: "carousel", name: "轮播视频", hint: "3–5 张主图合成轮播，抖音商品卡的一键制作就是这种", platform: "douyin" },
    { id: "selling", name: "卖点视频", hint: "逐条讲卖点，适合详情页与 A+ 视频位", platform: "taobao" },
    { id: "demo", name: "使用演示", hint: "展示怎么用，降低「买回来不会用」的退货", platform: "taobao" },
    { id: "seed", name: "种草短视频", hint: "9:16 竖版，发抖音/视频号", platform: "douyin" },
];

/** 镜头运动。电商视频基本靠这几种撑住节奏，不需要复杂运镜。 */
export type EcommerceVideoMotion = "still" | "push" | "pull" | "pan-left" | "pan-right" | "tilt-up";

export const ECOMMERCE_VIDEO_MOTIONS: { id: EcommerceVideoMotion; name: string; hint: string }[] = [
    { id: "still", name: "静止", hint: "不动。配字幕时最稳，观众能读完" },
    { id: "push", name: "推近", hint: "缓慢推近，把注意力收到主体上" },
    { id: "pull", name: "拉远", hint: "从局部拉到全貌，适合开场" },
    { id: "pan-left", name: "左摇", hint: "横向平移，展示长条或成组商品" },
    { id: "pan-right", name: "右摇", hint: "同上，方向相反" },
    { id: "tilt-up", name: "上摇", hint: "从下往上，显高显体量" },
];

/** 平台视频规格。全部来自公开口径，落地上架前应以商家后台最新提示为准。 */
export type EcommerceVideoPlatform = "taobao" | "jd" | "douyin" | "amazon";

export type EcommerceVideoSpec = {
    id: EcommerceVideoPlatform;
    name: string;
    /** 允许的比例。注意淘宝不收 9:16——上传后商详不展示。 */
    allowedRatios: string[];
    /** 建议时长（秒）。 */
    recommendedSeconds: number;
    /** 最长时长（秒）。 */
    maxSeconds: number;
    /** 最短时长（秒）。 */
    minSeconds: number;
    /** 清晰度下限。 */
    minHeight: number;
    /** 文件大小上限（字节）。 */
    maxBytes: number;
    /** 首帧限制。 */
    firstFrameRule: string;
    note: string;
};

export const ECOMMERCE_VIDEO_SPECS: EcommerceVideoSpec[] = [
    {
        id: "taobao", name: "淘宝 / 天猫",
        allowedRatios: ["3:4", "1:1", "16:9"],
        recommendedSeconds: 15, maxSeconds: 60, minSeconds: 1,
        minHeight: 720, maxBytes: 1.5 * 1024 * 1024 * 1024,
        firstFrameRule: "首帧禁止全屏黑白、禁止闪屏、禁止水印与二维码",
        note: "**9:16 上传后商详不展示**，别把抖音那版直接搬过来。最多 5 个视频，前 3 个且比例为 1:1 或 3:4 且审核通过才进详情页",
    },
    {
        id: "jd", name: "京东",
        allowedRatios: ["1:1", "3:4"],
        recommendedSeconds: 15, maxSeconds: 60, minSeconds: 1,
        minHeight: 720, maxBytes: 1024 * 1024 * 1024,
        firstFrameRule: "首帧需为商品画面，不要纯色开场",
        note: "主图视频 1:1 或 3:4，15–60 秒",
    },
    {
        id: "douyin", name: "抖音（抖店）",
        allowedRatios: ["9:16"],
        recommendedSeconds: 15, maxSeconds: 60, minSeconds: 3,
        minHeight: 1080, maxBytes: 1024 * 1024 * 1024,
        firstFrameRule: "首帧禁止二维码、第三方 Logo 与夸大对比图",
        note: "商品视频 9:16（1080×1920）。商品卡可以关联 3–5 张主图自动合成轮播视频",
    },
    {
        id: "amazon", name: "Amazon",
        allowedRatios: ["16:9", "9:16"],
        recommendedSeconds: 45, maxSeconds: 720, minSeconds: 60,
        minHeight: 720, maxBytes: 5 * 1024 * 1024 * 1024,
        firstFrameRule: "不要黑边与幻灯片式剪辑，前 5–10 秒讲清卖点，静音也要看得懂",
        note: "mp4/mov，H.264 或 H.265，720p 起（1080p 上限），23.976 或 30fps，1–12 分钟。视频进图片轮播，商品图少于 6 张时才有视频位",
    },
];

export function ecommerceVideoSpec(platform: EcommerceVideoPlatform) {
    return ECOMMERCE_VIDEO_SPECS.find((spec) => spec.id === platform);
}

/** 一个镜头：用哪张图、停多久、怎么动、配什么字幕。 */
export type EcommerceVideoShot = {
    id: string;
    /** 上游图片节点的 id。空表示还没配图。 */
    imageNodeId: string;
    /** 秒。 */
    seconds: number;
    motion: EcommerceVideoMotion;
    /** 字幕。空则不显示。 */
    caption: string;
    /** 转场：硬切最常用，叠化用于换场景。 */
    transition: "cut" | "fade";
};

export function createEcommerceVideoShot(imageNodeId = ""): EcommerceVideoShot {
    return { id: `vshot-${Math.random().toString(36).slice(2, 10)}`, imageNodeId, seconds: 3, motion: "push", caption: "", transition: "cut" };
}

export type EcommerceVideo = {
    name: string;
    kind: EcommerceVideoKind;
    platform: EcommerceVideoPlatform;
    shots: EcommerceVideoShot[];
    /** 背景音乐风格。空表示不加。 */
    music: string;
    /** 是否烧字幕。 */
    burnCaptions: boolean;
    /** 用的哪个爆款模板。空表示自己排的。 */
    templateId?: string;
    /** 爆款视频复刻配置。有值时按复刻结构走。 */
    replica?: EcommerceVideoReplica;
    /** 目标市场语言。跨境要多语言时，字幕与文案按这个走。 */
    language: EcommerceVideoLanguage;
};

/**
 * 目标市场语言。
 *
 * 跨境多语言是正在变成标配的一块：美图的爆款视频支持中英日韩西葡阿七种，
 * 看往有图片多语言翻译。语言影响的不只是字幕文字——同一支片子给不同市场看，
 * 卖点的排序都该变（欧美重参数、东南亚重价格）。
 */
export type EcommerceVideoLanguage = "zh" | "en" | "ja" | "ko" | "es" | "pt" | "ar";

export const ECOMMERCE_VIDEO_LANGUAGES: { id: EcommerceVideoLanguage; name: string; note: string }[] = [
    { id: "zh", name: "中文", note: "国内平台" },
    { id: "en", name: "英语", note: "Amazon 美英站、独立站；卖点排序偏参数与认证" },
    { id: "ja", name: "日语", note: "Amazon 日本站、乐天；偏好细节与售后说明" },
    { id: "ko", name: "韩语", note: "Coupang 等" },
    { id: "es", name: "西语", note: "Amazon 西站、拉美" },
    { id: "pt", name: "葡语", note: "Amazon 巴西站" },
    { id: "ar", name: "阿语", note: "中东；画面需注意阅读方向为右起" },
];

export function createEcommerceVideo(name = "未命名视频"): EcommerceVideo {
    return { name, kind: "main", platform: "taobao", shots: [], music: "", burnCaptions: true, language: "zh" };
}

export function ecommerceVideoSeconds(video: EcommerceVideo | undefined) {
    if (!video) return 0;
    return video.shots.reduce((total, shot) => total + Math.max(0, shot.seconds), 0);
}

export function ecommerceVideoReady(video: EcommerceVideo | undefined) {
    if (!video) return false;
    return video.shots.some((shot) => shot.imageNodeId && shot.seconds > 0);
}

/**
 * 从一套图铺出镜头表。
 *
 * 默认每张停 3 秒、缓慢推近——这是电商主图视频最稳的起手式：
 * 够观众看清商品，又不至于让人等。总时长超平台上限时按比例压缩，
 * 而不是砍掉后面的镜头（砍掉会让「一套图」不完整）。
 */
export function ecommerceVideoShotsFromImages(imageNodeIds: string[], input?: { kind?: EcommerceVideoKind; platform?: EcommerceVideoPlatform }): EcommerceVideoShot[] {
    const shots = imageNodeIds.map((imageNodeId) => createEcommerceVideoShot(imageNodeId));
    const spec = ecommerceVideoSpec(input?.platform || "taobao");
    if (!spec || !shots.length) return shots;
    const total = shots.length * 3;
    if (total <= spec.maxSeconds) return shots;
    const each = Math.max(1, Math.floor((spec.maxSeconds / shots.length) * 10) / 10);
    return shots.map((shot) => ({ ...shot, seconds: each }));
}

// ── 校验 ────────────────────────────────────────────────────

export type EcommerceVideoIssue = { level: "block" | "warn"; message: string };

/**
 * 视频能不能出。
 *
 * 全部能机器判定：比例、时长、镜头缺图、字幕长度、首帧限制。
 * 这是电商视频相对内容视频最不一样的地方——它有硬性规格。
 */
export function ecommerceVideoIssues(video: EcommerceVideo | undefined): EcommerceVideoIssue[] {
    if (!video) return [];
    const spec = ecommerceVideoSpec(video.platform);
    if (!spec) return [];
    const issues: EcommerceVideoIssue[] = [];
    const seconds = ecommerceVideoSeconds(video);
    const usable = video.shots.filter((shot) => shot.imageNodeId);

    if (!usable.length) {
        issues.push({ level: "block", message: "还没有镜头——连入图片或从一套图铺出镜头表" });
        return issues;
    }

    if (seconds > spec.maxSeconds) {
        issues.push({ level: "block", message: `总时长 ${seconds} 秒超过 ${spec.name} 上限 ${spec.maxSeconds} 秒` });
    }
    if (seconds < spec.minSeconds) {
        issues.push({ level: "block", message: `总时长 ${seconds} 秒低于 ${spec.name} 下限 ${spec.minSeconds} 秒` });
    } else if (seconds < spec.recommendedSeconds * 0.6) {
        issues.push({ level: "warn", message: `总时长 ${seconds} 秒偏短，${spec.name} 建议 ${spec.recommendedSeconds} 秒左右` });
    }

    const empty = video.shots.filter((shot) => !shot.imageNodeId);
    if (empty.length) {
        issues.push({ level: "warn", message: `有 ${empty.length} 个镜头没配图，生成时会跳过` });
    }

    const tooLongCaptions = usable.filter((shot) => shot.caption.trim().length > 16);
    if (tooLongCaptions.length) {
        issues.push({ level: "warn", message: `有 ${tooLongCaptions.length} 条字幕超过 16 字——一个镜头读不完，观众会漏掉后半句` });
    }

    const stills = usable.filter((shot) => shot.motion === "still" && shot.caption.trim());
    if (stills.length === usable.length && usable.length > 1) {
        issues.push({ level: "warn", message: "所有镜头都是静止——这是幻灯片不是视频，至少给开场加一点运动" });
    }

    // 平台比例是硬约束，而且要在这里拦，不能等上传后才发现商详不展示
    if (video.platform === "taobao" && video.kind === "seed") {
        issues.push({ level: "block", message: "种草短视频是 9:16，淘宝不收 9:16——发抖音，或改成 3:4 的主图视频" });
    }
    if (video.platform === "douyin" && video.kind === "main") {
        issues.push({ level: "warn", message: "抖音商品视频用 9:16；如果你要的是淘宝那种 1:1 主图视频，把平台换成淘宝" });
    }

    return issues;
}

export function ecommerceVideoBlocked(issues: EcommerceVideoIssue[]) {
    return issues.some((issue) => issue.level === "block");
}

/** 首帧限制提示。展示在节点上，避免用户第一帧放个纯色开场被驳回。 */
export function ecommerceVideoFirstFrameRule(video: EcommerceVideo | undefined) {
    if (!video) return "";
    return ecommerceVideoSpec(video.platform)?.firstFrameRule || "";
}

/**
 * 把镜头表编译成视频生成的提示词。
 *
 * 关键是把「哪张图、停多久、怎么动、写什么字」逐镜说清楚——视频模型最容易犯的错
 * 是自己加运镜、自己加字，所以每一句都要显式约束。
 */
export function ecommerceVideoPrompt(video: EcommerceVideo | undefined) {
    if (!ecommerceVideoReady(video)) return "";
    const videoValue = video!;
    const spec = ecommerceVideoSpec(videoValue.platform);
    const lines: string[] = [];
    if (spec) lines.push(`投放平台：${spec.name}；画幅 ${spec.allowedRatios.join(" 或 ")}；总时长约 ${ecommerceVideoSeconds(videoValue)} 秒`);
    if (spec) lines.push(`首帧要求：${spec.firstFrameRule}`);
    lines.push("按以下镜头顺序剪辑，不要自行增加镜头、不要自行添加字幕文字、不要改变每个镜头的时长：");
    videoValue.shots.forEach((shot, index) => {
        if (!shot.imageNodeId) return;
        const motion = ECOMMERCE_VIDEO_MOTIONS.find((item) => item.id === shot.motion)?.name || "静止";
        const parts = [`第 ${index + 1} 镜：${shot.seconds} 秒`, `运镜：${motion}`];
        if (shot.transition === "fade") parts.push("转场：叠化");
        if (shot.caption.trim()) parts.push(`字幕内容：「${shot.caption.trim()}」（由后期添加，不要画进画面）`);
        lines.push(parts.join("；"));
    });
    if (videoValue.music.trim()) lines.push(`配乐风格：${videoValue.music.trim()}`);
    // 跨境多市场：语言不只影响字幕文字，卖点排序也该跟着当地偏好变
    const language = ECOMMERCE_VIDEO_LANGUAGES.find((item) => item.id === videoValue.language);
    if (language && language.id !== "zh") lines.push(`目标市场语言：${language.name}——字幕与口播按这个语言，卖点排序按当地偏好调整`);
    lines.push("画面里不要出现任何文字、水印、二维码与第三方标识。");
    const parts = [`【电商视频】${videoValue.name.trim() || "未命名视频"}`, ...lines];
    // 复刻块排在最后：它约束的是「结构从哪来」，要在镜头表说清楚之后才生效
    const replica = ecommerceVideoReplicaBlock(videoValue.replica);
    if (replica) parts.push(replica);
    return parts.join("\n");
}

/** 按平台比例算导出分辨率。 */
export function ecommerceVideoResolution(platform: EcommerceVideoPlatform, ratio: string) {
    const spec = ecommerceVideoSpec(platform);
    const height = spec?.minHeight || 720;
    const [width, heightRatio] = ratio.split(":").map(Number);
    if (!width || !heightRatio) return { width: height, height };
    return ratio === "9:16" || ratio === "3:4"
        ? { width: Math.round((height * width) / heightRatio), height }
        : { width: Math.round((height * width) / heightRatio), height };
}
