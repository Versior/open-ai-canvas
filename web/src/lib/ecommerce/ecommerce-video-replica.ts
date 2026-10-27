/**
 * 爆款视频复刻——照着别人的爆款视频做自己的。
 *
 * 图片侧的复刻（ecommerce-replica.ts）复刻的是构图与布光；视频侧复刻的是
 * **结构、动作、镜头运动、节奏与氛围**。WeShop 的官方描述最准确：
 * 「在保留原始动作和时序的同时改变风格、背景、角色」。
 *
 * 三种模式覆盖了绝大多数真实用法：
 * - 保留主体换场景：模特/商品不动，换环境
 * - 保留场景换主体：环境不动，换成自己的商品
 * - 只借结构：节奏与转场照搬，画面全新
 *
 * 硬边界和图片侧一样，而且视频更严重：**音乐与角色是不能复刻的**。
 * 视频平台的音频指纹稽查比图像指纹更成熟，搬运音乐是直接的侵权。
 */

/** 复刻模式。 */
export type EcommerceVideoReplicaMode = "keep-subject-swap-scene" | "keep-scene-swap-subject" | "structure-only";

export const ECOMMERCE_VIDEO_REPLICA_MODES: { id: EcommerceVideoReplicaMode; name: string; hint: string }[] = [
    { id: "keep-subject-swap-scene", name: "留主体换场景", hint: "商品与动作不动，换掉环境。适合同一款商品换季节、换使用场景" },
    { id: "keep-scene-swap-subject", name: "留场景换主体", hint: "环境与镜头不动，换成自己的商品。适合同一场景下对标竞品的展示方式" },
    { id: "structure-only", name: "只借结构", hint: "节奏、镜头切换与转场照搬，画面全新。跨品类参考时用这个" },
];

/** 可以复刻的维度。音乐不在其中——它是硬边界，不是选项。 */
export type EcommerceVideoReplicaAspect = "rhythm" | "cuts" | "camera" | "pacing" | "mood" | "text-placement";

export const ECOMMERCE_VIDEO_REPLICA_ASPECTS: { id: EcommerceVideoReplicaAspect; label: string; hint: string }[] = [
    { id: "rhythm", label: "节奏", hint: "每一段停多久、快慢怎么变化" },
    { id: "cuts", label: "切点", hint: "在第几秒切、切在动作的哪个瞬间" },
    { id: "camera", label: "运镜", hint: "推拉摇移的幅度与速度" },
    { id: "pacing", label: "段落结构", hint: "开场几秒、卖点在第几秒出现、结尾怎么收" },
    { id: "mood", label: "氛围", hint: "色调、光线、情绪倾向" },
    { id: "text-placement", label: "字幕位置", hint: "字幕出现在画面的哪个位置、什么时候出现" },
];

/**
 * 不可复刻清单。
 *
 * 视频比图片更危险：**音频指纹稽查比图像指纹更成熟**，搬音乐是直接的侵权；
 * 平台对搬运视频的判罚也比图片重。所以这份清单是常量，不可编辑。
 */
export const ECOMMERCE_VIDEO_REPLICA_NEVER = [
    "参考视频的背景音乐与音效——音频指纹稽查比图像更成熟，搬音乐是直接侵权",
    "参考视频里的人物面孔、声音与可辨识形象",
    "参考视频里的品牌标识、片头片尾与店铺水印",
    "参考视频的画面素材本身（不是把参考视频换个商品贴上去）",
] as const;

export type EcommerceVideoReplica = {
    name: string;
    mode: EcommerceVideoReplicaMode;
    aspects: EcommerceVideoReplicaAspect[];
    /** 从参考视频里读出来的结构笔记：几段、每段几秒、切在哪。 */
    notes: string;
    /** The source fingerprint is kept only for plans imported from AI results; manual edits clear it. */
    planSourceSignature?: string;
    /** 额外不复刻项。 */
    extraExclude: string;
};

export function createEcommerceVideoReplica(name = "未命名视频复刻"): EcommerceVideoReplica {
    return { name, mode: "structure-only", aspects: ["rhythm", "cuts", "pacing"], notes: "", extraExclude: "" };
}

export function ecommerceVideoReplicaReady(replica: EcommerceVideoReplica | undefined) {
    if (!replica) return false;
    return replica.aspects.length > 0;
}

const MODE_DIRECTION: Record<EcommerceVideoReplicaMode, string> = {
    "keep-subject-swap-scene": "商品与动作保持不变，只替换环境与背景；商品的外观、颜色、标识一律不动。",
    "keep-scene-swap-subject": "环境、机位与运镜保持不变，把画面里的商品换成我们自己的；换进来的商品必须与参考图一致。",
    "structure-only": "只沿用节奏、切点与段落结构，画面内容全部重新拍摄或生成。",
};

/**
 * 复刻块。
 *
 * 和图片侧同一个顺序：先说「参考视频给的是结构不是素材」，再说不复刻清单，
 * 最后才是模式。边界必须排在模式前面——模型读到「留主体换场景」会倾向于
 * 把参考视频的整段画面留下来。
 */
export function ecommerceVideoReplicaBlock(replica: EcommerceVideoReplica | undefined) {
    if (!ecommerceVideoReplicaReady(replica)) return "";
    const replicaValue = replica!;
    const aspects = ECOMMERCE_VIDEO_REPLICA_ASPECTS.filter((aspect) => replicaValue.aspects.includes(aspect.id)).map((aspect) => aspect.label);
    const lines = ["参考视频给的是**结构**，不是素材。只沿用节奏与镜头语言，不搬运任何画面、声音与人物。"];
    if (aspects.length) lines.push(`复刻维度：${aspects.join("、")}`);
    lines.push("绝对不复刻：");
    for (const never of ECOMMERCE_VIDEO_REPLICA_NEVER) lines.push(`- ${never}`);
    if (replicaValue.extraExclude.trim()) lines.push(`- ${replicaValue.extraExclude.trim()}`);
    lines.push(`模式：${MODE_DIRECTION[replicaValue.mode]}`);
    if (replicaValue.notes.trim()) lines.push(`结构笔记：${replicaValue.notes.trim()}`);
    return [`【视频复刻】${replicaValue.name.trim() || "未命名视频复刻"}`, ...lines].join("\n");
}

/**
 * 视频提示词反推指令。
 *
 * 和图片反推的区别：视频要拆的是**时间结构**，不是画面描述。
 * 所以指令明确要求按秒输出段落、标出切点与运镜，而不是写一段画面描述——
 * 后者对复刻毫无用处，因为画面本来就要换掉。
 */
export function buildEcommerceVideoTeardownPrompt(input?: { aspects?: EcommerceVideoReplicaAspect[] }) {
    const aspects = ECOMMERCE_VIDEO_REPLICA_ASPECTS.filter((aspect) => (input?.aspects || ECOMMERCE_VIDEO_REPLICA_ASPECTS.map((item) => item.id)).includes(aspect.id));
    return [
        "请分析这段电商短视频，只拆解它的**结构与节奏**，不要描述画面内容、不要复述文案。",
        "",
        "按以下格式逐段输出：",
        "第 N 段（第 X–Y 秒）：这一段在做什么、镜头怎么运动、切点切在什么位置、字幕出现在哪里。",
        "",
        "需要覆盖的维度：",
        ...aspects.map((aspect) => `- ${aspect.label}：${aspect.hint}`),
        "",
        "最后另起一段，给出总时长、段落数量与整体节奏判断（快剪还是慢叙）。",
        "",
        "注意：不要描述商品长什么样、不要复述字幕原文——我们要复刻的是结构，不是内容。",
    ].join("\n");
}

/** 从结构笔记里粗估段落数，用于卡片上给一个「读出来了没有」的信号。 */
export function ecommerceVideoReplicaBeatCount(replica: EcommerceVideoReplica | undefined) {
    if (!replica?.notes.trim()) return 0;
    return replica.notes.split("\n").filter((line) => /第\s*\d+|段|\d+\s*[-–~]\s*\d+\s*秒/.test(line)).length;
}
