import { Button, Input, Select } from "antd";
import { DEFAULT_REPLICA_CAMPAIGN, DEFAULT_REPLICA_DIRECTION, REPLICA_DIRECTOR_OPTIONS, replicaDirectorReview, type ReplicaCampaign, type ReplicaDirection } from "@/lib/canvas/replica-director";
import type { ReplicaShotPlan, VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

export function ReplicaCampaignEditor({ plan, bundle, onChange }: { plan: VideoReplicaPlan; bundle: VideoTeardownBundle; onChange: (campaign: ReplicaCampaign) => void }) {
    const seconds = new Map(bundle.shots.map((shot) => [shot.index, (shot.endMs - shot.startMs) / 1000]));
    return (
        <section className="vr-panel vr-plan-section" aria-label="导演与平台策略">
            <h2 className="vr-plan-section-title">导演与平台策略</h2>
            <p className="vr-plan-muted">启用后，改写同时产生新商品的首帧、动作和叙事方案。选择版本会一起更新逐镜提示词。</p>
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
                {(["platform", "goal", "style"] as const).map((key) => (
                    <label key={key} className="vr-plan-field">
                        <span>{{ platform: "发布平台", goal: "视频目标", style: "表现方式" }[key]}</span>
                        <Select
                            aria-label={{ platform: "发布平台", goal: "视频目标", style: "表现方式" }[key]}
                            disabled={disabled || !value}
                            value={campaign[key]}
                            options={Object.entries(REPLICA_DIRECTOR_OPTIONS[key]).map(([value, label]) => ({ value, label }))}
                            onChange={(value) => onChange({ ...campaign, [key]: value })}
                        />
                    </label>
                ))}
                <label className="vr-plan-field">
                    <span>全片连续性</span>
                    <Input.TextArea aria-label="全片连续性" maxLength={300} value={campaign.continuity} disabled={disabled || !value} onChange={(event) => onChange({ ...campaign, continuity: event.target.value })} />
                </label>
            </div>
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
                    ] as const
                ).map((field) => (
                    <label key={field.key} className="vr-plan-field">
                        <span>{field.label}</span>
                        <Input.TextArea disabled={disabled} aria-label={`镜头 ${shot.shotNumber} ${field.label}`} value={director[field.key]} maxLength={field.max} onChange={(event) => onChange({ ...director, [field.key]: event.target.value })} />
                    </label>
                ))}
            </div>
        </details>
    );
}
