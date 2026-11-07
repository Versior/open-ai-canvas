import type { ReplicaShotPlan, VideoReplicaPlan } from "./video-replica-plan";

export type ReplicaCampaign = { platform: "douyin" | "xiaohongshu" | "amazon"; goal: "conversion" | "education" | "brand"; style: "demo" | "story" | "studio"; continuity: string };
export type ReplicaDirection = {
    beat: "hook" | "problem" | "demo" | "proof" | "action";
    framing: "wide" | "medium" | "close" | "macro";
    camera: "locked" | "push" | "pan" | "handheld";
    action: string;
    evidence: string;
    sound: string;
    transition: "cut" | "match" | "dissolve";
};
export const DEFAULT_REPLICA_CAMPAIGN: ReplicaCampaign = { platform: "douyin", goal: "conversion", style: "demo", continuity: "商品包装、颜色和尺寸一致；人物、手部、光线方向与动作衔接一致" };
export const DEFAULT_REPLICA_DIRECTION: ReplicaDirection = { beat: "demo", framing: "close", camera: "locked", action: "", evidence: "", sound: "", transition: "cut" };
export const REPLICA_DIRECTOR_OPTIONS = {
    platform: { douyin: "抖音", xiaohongshu: "小红书", amazon: "亚马逊商品视频" },
    goal: { conversion: "购买决策", education: "使用 / 选购说明", brand: "品牌记忆" },
    style: { demo: "真实演示", story: "生活故事", studio: "商业棚拍" },
    beat: { hook: "开头钩子", problem: "问题 / 场景", demo: "使用演示", proof: "细节证明", action: "下一步行动" },
    framing: { wide: "全景", medium: "中景", close: "近景", macro: "微距" },
    camera: { locked: "固定机位", push: "缓慢推近", pan: "横向跟拍", handheld: "克制手持" },
    transition: { cut: "直接剪切", match: "动作匹配剪切", dissolve: "叠化" },
} as const;

function readChoice<T extends string>(value: unknown, choices: Record<T, string>): T | undefined {
    return typeof value === "string" && Object.hasOwn(choices, value) ? (value as T) : undefined;
}
function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function readReplicaCampaign(value: unknown): ReplicaCampaign | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const platform = readChoice(record.platform, REPLICA_DIRECTOR_OPTIONS.platform),
        goal = readChoice(record.goal, REPLICA_DIRECTOR_OPTIONS.goal),
        style = readChoice(record.style, REPLICA_DIRECTOR_OPTIONS.style);
    return platform && goal && style ? { platform, goal, style, continuity: text(record.continuity, 300) } : undefined;
}

export function readReplicaDirection(value: unknown): ReplicaDirection | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const beat = readChoice(record.beat, REPLICA_DIRECTOR_OPTIONS.beat),
        framing = readChoice(record.framing, REPLICA_DIRECTOR_OPTIONS.framing),
        camera = readChoice(record.camera, REPLICA_DIRECTOR_OPTIONS.camera),
        transition = readChoice(record.transition, REPLICA_DIRECTOR_OPTIONS.transition);
    return beat && framing && camera && transition ? { beat, framing, camera, transition, action: text(record.action, 300), evidence: text(record.evidence, 200), sound: text(record.sound, 120) } : undefined;
}

export function replicaCampaignPrompt(campaign: ReplicaCampaign) {
    const platform = { douyin: "前几秒用具体动作提出购买问题，演示先于口号，短句口播。", xiaohongshu: "问题式开场，展开真实使用细节与选购条件，不伪装素人评价。", amazon: "围绕商品用途、结构、操作和尺寸，不写虚构折扣、排名或评论。" }[campaign.platform];
    return `目标平台：${REPLICA_DIRECTOR_OPTIONS.platform[campaign.platform]}。目标：${REPLICA_DIRECTOR_OPTIONS.goal[campaign.goal]}。视觉：${REPLICA_DIRECTOR_OPTIONS.style[campaign.style]}。${platform}\n连续性：${campaign.continuity}。每镜一个能拍出来的动作，写清初始姿态、动作过程和结束状态；证明镜头只引用商品档案的事实，没资料就不要写实验结果。开头、展开、证明和行动组成叙事，避免每镜重复卖点。`;
}

/** 两种生成使用同一导演方案；文字层交给剪辑，不让视频模型伪造字幕。 */
export function compileReplicaDirection(shot: ReplicaShotPlan, campaign?: ReplicaCampaign) {
    if (!shot.director) return { imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt };
    const d = shot.director;
    const continuity = campaign?.continuity ? `连续性：${campaign.continuity}。` : "";
    return {
        imagePrompt: `${shot.imagePrompt}\n【导演首帧】${REPLICA_DIRECTOR_OPTIONS.framing[d.framing]}，表现动作开始前的姿态；${d.action}。${continuity}仅画首帧，不拼多格，不生成字幕或花字。`,
        videoPrompt: `${shot.videoPrompt}\n【导演执行】${REPLICA_DIRECTOR_OPTIONS.camera[d.camera]}，单镜只完成这个动作：${d.action}。${continuity}${d.sound ? `声音意图：${d.sound}，不支持音频的模型交给后期。` : ""}结束状态为${REPLICA_DIRECTOR_OPTIONS.transition[d.transition]}预留衔接；不在本镜生成跨场景转场，不生成字幕。`,
    };
}

export function replicaDirectorReview(plan: VideoReplicaPlan, seconds: Map<number, number>) {
    const kept = plan.shots.filter((shot) => shot.treatment !== "skip");
    const findings: string[] = [];
    for (const shot of kept) {
        const duration = seconds.get(shot.shotNumber) || 0;
        if (duration && [...shot.dialogue.replace(/\s/g, "")].length > Math.floor(duration * 5)) findings.push(`镜头 ${shot.shotNumber} 口播超出约 ${duration.toFixed(1)} 秒的承载量，请删句或在剪辑时延长。`);
        if (shot.director && !shot.director.action.trim()) findings.push(`镜头 ${shot.shotNumber} 还没有具体动作。`);
        if (shot.director?.beat === "proof" && !shot.director.evidence.trim()) findings.push(`镜头 ${shot.shotNumber} 缺少证明依据，不能把概念演示当实测。`);
    }
    if (plan.campaign && kept.length > 1 && !kept.some((s) => s.director?.beat === "hook")) findings.push("缺少开头钩子，请指定第一镜要让观众看见什么。");
    return findings;
}
