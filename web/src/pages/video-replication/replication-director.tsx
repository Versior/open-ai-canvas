import { Button, Input, Select } from "antd";
import { DEFAULT_REPLICA_CAMPAIGN, DEFAULT_REPLICA_DIRECTION, REPLICA_DIRECTOR_OPTIONS, replicaDirectorReview, type ReplicaCampaign, type ReplicaDirection, type ReplicaStrategy } from "@/lib/canvas/replica-director";
import { REPLICA_PLATFORM_SOURCES, replicaMethodGuidance, replicaPlatformGuidance } from "@/lib/canvas/replica-director-knowledge";
import type { ReplicaShotPlan, VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

export function ReplicaCampaignEditor({ plan, bundle, onChange }: { plan: VideoReplicaPlan; bundle: VideoTeardownBundle; onChange: (campaign: ReplicaCampaign) => void }) {
    const seconds = new Map(bundle.shots.map((shot) => [shot.index, (shot.endMs - shot.startMs) / 1000]));
    return (
        <section className="vr-panel vr-plan-section" aria-label="导演与平台策略">
            <h2 className="vr-plan-section-title">导演与平台策略</h2>
            <p className="vr-plan-muted">启用后，改写同时产生全片策略、首帧、动作与口播。支持看图的模型会结合商品实拍；纯文本模型依据文字档案与拆解。选择版本会更新逐镜提示词。</p>
            <ReplicaCampaignControls value={plan.campaign} onChange={onChange} />
            {replicaDirectorReview(plan, seconds).map((finding) => (
                <p key={finding} className="vr-plan-muted" role="status">
                    {finding}
                </p>
            ))}
        </section>
    );
}

export function ReplicaCampaignControls({ value, onChange, disabled = false }: { value?: ReplicaCampaign; onChange: (value: ReplicaCampaign) => void; disabled?: boolean }) {
    const campaign = value || DEFAULT_REPLICA_CAMPAIGN;
    return (
        <>
            {!value ? (
                <Button disabled={disabled} onClick={() => onChange({ ...DEFAULT_REPLICA_CAMPAIGN })}>
                    启用导演策划
                </Button>
            ) : null}
            <div className="vr-plan-fields">
                {(["platform", "goal", "style", "narrative"] as const).map((key) => (
                    <label key={key} className="vr-plan-field">
                        <span>{{ platform: "发布平台", goal: "视频目标", style: "表现方式", narrative: "叙事组织" }[key]}</span>
                        <Select
                            aria-label={{ platform: "发布平台", goal: "视频目标", style: "表现方式", narrative: "叙事组织" }[key]}
                            disabled={disabled || !value}
                            value={campaign[key] || "auto"}
                            options={Object.entries(REPLICA_DIRECTOR_OPTIONS[key]).map(([value, label]) => ({ value, label }))}
                            onChange={(value) => onChange({ ...campaign, [key]: value })}
                        />
                    </label>
                ))}
                {(
                    [
                        { key: "audience", label: "目标观众与购买角色", hint: "例如：为孩子挑眼镜的家长，关心佩戴舒适" },
                        { key: "focus", label: "本片要解决的问题", hint: "例如：让家长看清鼻托如何调节" },
                    ] as const
                ).map((field) => (
                    <label key={field.key} className="vr-plan-field">
                        <span>{field.label}</span>
                        <Input.TextArea aria-label={field.label} maxLength={200} placeholder={field.hint} value={campaign[field.key] || ""} disabled={disabled || !value} onChange={(event) => onChange({ ...campaign, [field.key]: event.target.value })} />
                    </label>
                ))}
                <label className="vr-plan-field">
                    <span>全片连续性</span>
                    <Input.TextArea aria-label="全片连续性" maxLength={300} value={campaign.continuity} disabled={disabled || !value} onChange={(event) => onChange({ ...campaign, continuity: event.target.value })} />
                </label>
            </div>
            {value ? (
                <details className="vr-plan-muted">
                    <summary>当前平台与拍法依据</summary>
                    <p style={{ whiteSpace: "pre-line" }}>{replicaPlatformGuidance(campaign.platform)}</p>
                    <p>{replicaMethodGuidance(campaign.style)}</p>
                    <p>这些是创作建议。具体发布入口、类目和广告规格须另行核对。</p>
                    {(REPLICA_PLATFORM_SOURCES[campaign.platform] || []).map((source) => (
                        <p key={source.url}>
                            <a href={source.url} target="_blank" rel="noreferrer">
                                {source.title}
                            </a>
                            ：{source.scope}
                        </p>
                    ))}
                </details>
            ) : null}
        </>
    );
}

export function ReplicaShotDirector({ shot, onChange, disabled = false }: { shot: Pick<ReplicaShotPlan, "shotNumber" | "director">; onChange: (director: ReplicaDirection) => void; disabled?: boolean }) {
    const director = shot.director || DEFAULT_REPLICA_DIRECTION;
    return (
        <details>
            <summary>导演镜头设计{shot.director ? ` · ${REPLICA_DIRECTOR_OPTIONS.beat[director.beat]}` : ""}</summary>
            <div className="vr-plan-fields">
                {(["beat", "framing", "camera", "transition"] as const).map((key) => (
                    <label key={key} className="vr-plan-field">
                        <span>{{ beat: "叙事职责", framing: "景别", camera: "运镜", transition: "剪辑衔接" }[key]}</span>
                        <Select
                            aria-label={`镜头 ${shot.shotNumber} ${{ beat: "叙事职责", framing: "景别", camera: "运镜", transition: "剪辑衔接" }[key]}`}
                            disabled={disabled}
                            value={director[key]}
                            options={Object.entries(REPLICA_DIRECTOR_OPTIONS[key]).map(([value, label]) => ({ value, label }))}
                            onChange={(value) => onChange({ ...director, [key]: value })}
                        />
                    </label>
                ))}
                {(
                    [
                        { key: "action", label: "单镜动作（开始 → 过程 → 结束）", max: 300 },
                        { key: "evidence", label: "证明依据（商品档案中的事实）", max: 200 },
                        { key: "sound", label: "声音意图", max: 120 },
                        { key: "purpose", label: "本镜解决的问题", max: 200 },
                        { key: "start", label: "动作前状态", max: 200 },
                        { key: "end", label: "动作后状态", max: 200 },
                        { key: "lighting", label: "布光与色调", max: 200 },
                    ] as const
                ).map((field) => (
                    <label key={field.key} className="vr-plan-field">
                        <span>{field.label}</span>
                        <Input.TextArea disabled={disabled} aria-label={`镜头 ${shot.shotNumber} ${field.label}`} value={director[field.key] || ""} maxLength={field.max} onChange={(event) => onChange({ ...director, [field.key]: event.target.value })} />
                    </label>
                ))}
            </div>
        </details>
    );
}

export function ReplicaStrategyView({ strategy, creative = false }: { strategy: ReplicaStrategy; creative?: boolean }) {
    return (
        <div className="vr-plan-fields" aria-label="全片策划依据">
            {(
                [
                    { key: "audience", label: "观众与购买角色" },
                    { key: "insight", label: "观众顾虑" },
                    { key: "proposition", label: "核心主张" },
                    { key: "hook", label: "开头可见的钩子" },
                    { key: "rationale", label: creative ? "创意与拍法理由" : "选法理由与原片取舍" },
                    { key: "visual", label: "场景、布光与色调" },
                    { key: "sound", label: "声音与剪辑" },
                    { key: "cta", label: "收束与下一步" },
                ] as const
            ).map(({ key, label }) => (
                <div key={key} className="vr-plan-field">
                    <strong>{label}</strong>
                    <p>{strategy[key]}</p>
                </div>
            ))}
            <p className="vr-plan-muted">
                拍法：{REPLICA_DIRECTOR_OPTIONS.style[strategy.method]} · 叙事：{REPLICA_DIRECTOR_OPTIONS.narrative[strategy.narrative]}
            </p>
            {strategy.missing.length ? (
                <p className="vr-plan-muted" role="status">
                    待补资料：{strategy.missing.join("；")}
                </p>
            ) : null}
        </div>
    );
}
