import type { ReplicaShotPlan, VideoReplicaPlan } from "./video-replica-plan";
import { REPLICA_METHODS, REPLICA_NARRATIVES, REPLICA_PLATFORM_PLAYBOOKS, replicaMethodGuidance, replicaPlatformGuidance } from "./replica-director-knowledge";

export type ReplicaCampaign = {
    platform: keyof typeof REPLICA_PLATFORM_PLAYBOOKS;
    goal: "conversion" | "education" | "brand" | "consideration" | "engagement" | "launch";
    style: keyof typeof REPLICA_METHODS;
    continuity: string;
    audience?: string;
    focus?: string;
    narrative?: keyof typeof REPLICA_NARRATIVES;
};
export type ReplicaDirection = {
    beat: "hook" | "problem" | "demo" | "proof" | "action" | "context" | "objection" | "reveal";
    framing: "wide" | "medium" | "close" | "macro";
    camera: "locked" | "push" | "pan" | "handheld" | "pull" | "track" | "tilt" | "orbit" | "topdown";
    action: string;
    evidence: string;
    sound: string;
    transition: "cut" | "match" | "dissolve";
    purpose?: string;
    start?: string;
    end?: string;
    lighting?: string;
};
export type ReplicaStrategy = {
    audience: string;
    insight: string;
    proposition: string;
    hook: string;
    method: Exclude<ReplicaCampaign["style"], "auto">;
    narrative: Exclude<NonNullable<ReplicaCampaign["narrative"]>, "auto">;
    rationale: string;
    visual: string;
    sound: string;
    cta: string;
    missing: string[];
};

export function readReplicaStrategy(value: unknown): ReplicaStrategy | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const method = readChoice(raw.method, REPLICA_DIRECTOR_OPTIONS.style);
    const narrative = readChoice(raw.narrative, REPLICA_NARRATIVES);
    const fields = ["audience", "insight", "proposition", "hook", "rationale", "visual", "sound", "cta"] as const;
    if (!method || method === "auto" || !narrative || narrative === "auto" || fields.some((key) => typeof raw[key] !== "string" || !raw[key].trim() || [...(raw[key] as string)].length > 400)) return undefined;
    if (raw.missing !== undefined && (!Array.isArray(raw.missing) || raw.missing.length > 8 || raw.missing.some((item) => typeof item !== "string" || [...item].length > 200))) return undefined;
    return {
        method,
        narrative,
        ...(Object.fromEntries(fields.map((key) => [key, (raw[key] as string).trim()])) as Pick<ReplicaStrategy, (typeof fields)[number]>),
        missing: Array.isArray(raw.missing) ? raw.missing.map((item: string) => item.trim()) : [],
    };
}
export const DEFAULT_REPLICA_CAMPAIGN: ReplicaCampaign = { platform: "douyin", goal: "conversion", style: "auto", narrative: "auto", continuity: "商品包装、颜色和尺寸一致；人物、手部、光线方向与动作衔接一致" };
export const DEFAULT_REPLICA_DIRECTION: ReplicaDirection = { beat: "demo", framing: "close", camera: "locked", action: "", evidence: "", sound: "", transition: "cut" };
export const REPLICA_DIRECTOR_OPTIONS = {
    platform: Object.fromEntries(Object.entries(REPLICA_PLATFORM_PLAYBOOKS).map(([key, value]) => [key, value.name])) as Record<ReplicaCampaign["platform"], string>,
    goal: { conversion: "购买决策", education: "使用 / 选购说明", brand: "品牌记忆", consideration: "消除选购顾虑", engagement: "收藏 / 讨论", launch: "新品介绍" },
    style: Object.fromEntries(Object.entries(REPLICA_METHODS).map(([key, value]) => [key, value.name])) as Record<ReplicaCampaign["style"], string>,
    narrative: REPLICA_NARRATIVES,
    beat: { hook: "开头钩子", problem: "问题 / 场景", demo: "使用演示", proof: "细节证明", action: "下一步行动", context: "适用情境", objection: "回答顾虑", reveal: "揭示细节" },
    framing: { wide: "全景", medium: "中景", close: "近景", macro: "微距" },
    camera: { locked: "固定机位", push: "缓慢推近", pan: "水平摇镜", handheld: "克制手持", pull: "拉远交代环境", track: "横向跟拍", tilt: "上下摇镜", orbit: "小幅环绕", topdown: "俯拍固定机位" },
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
    const narrative = readChoice(record.narrative, REPLICA_NARRATIVES);
    return platform && goal && style
        ? {
              platform,
              goal,
              style,
              continuity: text(record.continuity, 300),
              ...(text(record.audience, 200) ? { audience: text(record.audience, 200) } : {}),
              ...(text(record.focus, 200) ? { focus: text(record.focus, 200) } : {}),
              ...(narrative ? { narrative } : {}),
          }
        : undefined;
}

export function readReplicaDirection(value: unknown): ReplicaDirection | undefined {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const beat = readChoice(record.beat, REPLICA_DIRECTOR_OPTIONS.beat),
        framing = readChoice(record.framing, REPLICA_DIRECTOR_OPTIONS.framing),
        camera = readChoice(record.camera, REPLICA_DIRECTOR_OPTIONS.camera),
        transition = readChoice(record.transition, REPLICA_DIRECTOR_OPTIONS.transition);
    return beat && framing && camera && transition
        ? {
              beat,
              framing,
              camera,
              transition,
              action: text(record.action, 300),
              evidence: text(record.evidence, 200),
              sound: text(record.sound, 120),
              ...(text(record.purpose, 200) ? { purpose: text(record.purpose, 200) } : {}),
              ...(text(record.start, 200) ? { start: text(record.start, 200) } : {}),
              ...(text(record.end, 200) ? { end: text(record.end, 200) } : {}),
              ...(text(record.lighting, 200) ? { lighting: text(record.lighting, 200) } : {}),
          }
        : undefined;
}

export function replicaCampaignPrompt(campaign: ReplicaCampaign) {
    return [
        `目标平台：${REPLICA_DIRECTOR_OPTIONS.platform[campaign.platform]}。目标：${REPLICA_DIRECTOR_OPTIONS.goal[campaign.goal]}。`,
        campaign.audience ? `目标观众：${campaign.audience}` : "目标观众：根据商品资料判断，说明依据，不虚构市场调查。",
        campaign.focus ? `本片重点：${campaign.focus}` : "本片重点：从商品资料选一个可展示的核心价值。",
        `平台观看与创作建议（不是审核规则或流量保证）：\n${replicaPlatformGuidance(campaign.platform)}`,
        `表现方式：${REPLICA_DIRECTOR_OPTIONS.style[campaign.style]}。${replicaMethodGuidance(campaign.style)}`,
        `叙事组织：${REPLICA_NARRATIVES[campaign.narrative || "auto"]}；按商品、人群与实际镜头时长选择顺序，不固定套五段模板。`,
        `连续性：${campaign.continuity}。每镜一个可执行动作，写清开始、过程、结束。证明依据只引用商品原文，没资料不写实验结果；儿童商品依据真实外观与用途选择友好氛围，不默认灰调。`,
    ].join("\n");
}

export function replicaDirectionDescription(d: ReplicaDirection) {
    return [
        REPLICA_DIRECTOR_OPTIONS.framing[d.framing],
        REPLICA_DIRECTOR_OPTIONS.camera[d.camera],
        d.purpose ? `叙事作用：${d.purpose}` : "",
        d.start ? `初始状态：${d.start}` : "",
        `动作：${d.action}`,
        d.end ? `结束状态：${d.end}` : "",
        d.evidence ? `证明依据：${d.evidence}` : "",
        d.lighting ? `布光与色调：${d.lighting}` : "",
        d.sound ? `声音意图：${d.sound}` : "",
        `衔接：${REPLICA_DIRECTOR_OPTIONS.transition[d.transition]}`,
    ]
        .filter(Boolean)
        .join("；");
}

/** 两种生成使用同一导演方案；文字层交给剪辑，不让视频模型伪造字幕。 */
export function compileReplicaDirection(shot: ReplicaShotPlan, campaign?: ReplicaCampaign) {
    if (!shot.director) return { imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt };
    const d = shot.director;
    const continuity = campaign?.continuity ? `连续性：${campaign.continuity}。` : "";
    return {
        imagePrompt: `${shot.imagePrompt}\n【导演首帧】${REPLICA_DIRECTOR_OPTIONS.framing[d.framing]}，表现动作开始前的姿态：${d.start || d.action}。${d.lighting ? `布光与色调：${d.lighting}。` : ""}${continuity}仅画首帧，不拼多格，不生成字幕或花字。`,
        videoPrompt: `${shot.videoPrompt}\n【导演执行】${replicaDirectionDescription(d)}。${continuity}声音意图须服从实际音频设置，不支持音频的模型交给后期；不在本镜生成跨场景转场，不生成字幕。`,
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
    const selected = plan.scripts.find((script) => script.id === plan.activeScriptId);
    if (plan.campaign && kept.length > 1 && !selected?.strategy?.hook && !kept[0]?.director?.purpose && !kept.some((s) => s.director?.beat === "hook")) findings.push("请说明第一镜让观众看见什么、为何值得继续看。");
    return findings;
}
