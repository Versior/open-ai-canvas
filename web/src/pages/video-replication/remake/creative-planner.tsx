import { App, Button, Checkbox, Input, InputNumber, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { applyCreativePlan, CREATIVE_ENTRY_SCENES, CREATIVE_SCENES, CREATIVE_TONES, creativeFactsInput, creativePlanInput, creativePlanReferences, creativeReadyError, isCommercialCreativeScene } from "@/lib/remake/creative";
import type { RemakeJob } from "@/lib/remake/job";
import type { AiConfig } from "@/stores/use-config-store";
import { ReplicaStrategyView } from "../replication-director";
import { DEFAULT_REPLICA_CAMPAIGN, REPLICA_DIRECTOR_OPTIONS, type ReplicaCampaign } from "@/lib/canvas/replica-director";
import { replicaScriptImageCount } from "../replication-script";
import type { RemakeEdit } from "./remake-recipe";
import { executeCreativeRun } from "./creative-runner";
import { updateRemake } from "../replace/use-product-video-store";

export function CreativePlanner({ job, config, edit, disabled, running = false, flush, onBusy }: { job: RemakeJob; config: AiConfig; edit: RemakeEdit; disabled: boolean; running?: boolean; flush: () => Promise<void>; onBusy: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const creative = job.creative!;
    const [model, setModel] = useState(creative.run?.model || config.textModel);
    const [count, setCount] = useState(creative.run?.count || 4);
    const [busy, setBusy] = useState(false);
    const controller = useRef<AbortController | undefined>(undefined);
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        if (!model && config.textModel) setModel(config.textModel);
    }, [config.textModel, model]);
    useEffect(() => {
        if (running && creative.run) {
            setModel(creative.run.model);
            setCount(creative.run.count);
        }
    }, [running, creative.run]);
    const unsettled = Boolean(creative.run && !creative.run.settled);
    const processing = busy || running;
    const locked = disabled || processing || unsettled;
    const factsInput = creativeFactsInput(job);
    const planInput = creativePlanInput(job);
    const imageCount = replicaScriptImageCount(config, model, job.product.images.length);
    const referenceCount = creativePlanReferences(job).length;
    const planImageCount = replicaScriptImageCount(config, model, referenceCount);
    const campaign = job.campaign || DEFAULT_REPLICA_CAMPAIGN;
    const patchCampaign = (patch: Partial<ReplicaCampaign>) => edit((value) => ({ ...value, campaign: { ...campaign, ...patch } }));
    const patchBrief = (patch: Partial<typeof creative.brief>) =>
        edit((value) => ({
            ...value,
            creative: { ...value.creative!, brief: { ...value.creative!.brief, ...patch } },
            campaign: patch.scene && !isCommercialCreativeScene(patch.scene) && value.campaign?.goal === "conversion" ? { ...value.campaign, goal: "engagement" } : value.campaign,
        }));
    const run = async (kind?: "analysis" | "plan") => {
        if (processing || disabled) return;
        const current = new AbortController();
        controller.current = current;
        setBusy(true);
        onBusy(true);
        try {
            await flush();
            await executeCreativeRun(job.id, config, current.signal, kind ? { kind, model, count } : undefined);
        } catch (error) {
            if (!current.signal.aborted) message.error(error instanceof Error ? error.message : "策划失败");
        } finally {
            if (controller.current === current) {
                controller.current = undefined;
                setBusy(false);
                onBusy(false);
            }
        }
    };
    const apply = async (plan: (typeof creative.plans)[number]) => {
        setBusy(true);
        onBusy(true);
        try {
            await flush();
            await updateRemake(job.id, (value) => applyCreativePlan(value, plan));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "选用失败");
        } finally {
            setBusy(false);
            onBusy(false);
        }
    };
    return (
        <div className="cv-planner" aria-label="视频策划" aria-busy={processing}>
            <section className="rw-card">
                <header className="rw-card-head">
                    <h3>1. 核对素材</h3>
                </header>
                <ModelPicker config={config} capability="text" value={model} onChange={setModel} fullWidth placeholder="素材分析与策划模型" modelDisabledReason={() => (locked ? "正在处理作品" : "")} />
                <div className="cv-actions">
                    <Button disabled={locked || !imageCount || !model} onClick={() => void run("analysis")}>
                        分析素材
                    </Button>
                    <span className="rw-hint">按所选文本模型计费</span>
                </div>
                <p className="rw-hint">{imageCount ? `素材分析参考 ${imageCount} 张主体图；导演策划需要接收全部 ${referenceCount} 张主体、人物与场景图。` : "素材分析与导演策划需要选择能看图的模型。"}</p>
                {planImageCount < referenceCount ? <p className="rw-warn">当前模型无法接收全部参考图，请减少参考图或更换模型。</p> : null}
                {creative.analysis ? (
                    <div className="cv-analysis">
                        <p>{creative.analysis.observation}</p>
                        {creative.analysis.missing.length ? (
                            <ul>
                                {creative.analysis.missing.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        ) : null}
                        {creative.analysis.input !== factsInput ? <p className="rw-warn">主体资料已改变，这份分析仅供回查。</p> : null}
                    </div>
                ) : null}
                <Checkbox
                    disabled={locked || !job.product.name.trim() || !job.product.images.length}
                    checked={creative.confirmedInput === factsInput}
                    onChange={(event) => edit((value) => ({ ...value, creative: { ...value.creative!, confirmedInput: event.target.checked ? creativeFactsInput(value) : undefined } }))}
                >
                    资料已核对，只使用图片和确认信息
                </Checkbox>
            </section>
            <section className="rw-card">
                <header className="rw-card-head">
                    <h3>2. 创作设置</h3>
                </header>
                <div className="cv-fields">
                    <label>
                        内容类型
                        <Select
                            aria-label="内容类型"
                            disabled={locked}
                            value={creative.brief.scene}
                            onChange={(scene) => patchBrief({ scene })}
                            options={[...CREATIVE_ENTRY_SCENES, ...(!CREATIVE_ENTRY_SCENES.some((item) => item.id === creative.brief.scene) ? CREATIVE_SCENES.filter((item) => item.id === creative.brief.scene) : [])].map((item) => ({
                                value: item.id,
                                label: item.name,
                            }))}
                        />
                    </label>
                    <label>
                        视觉风格
                        <Select aria-label="视觉风格" disabled={locked} value={creative.brief.tone} onChange={(tone) => patchBrief({ tone })} options={Object.entries(CREATIVE_TONES).map(([value, item]) => ({ value, label: item.name }))} />
                    </label>
                    <label>
                        目标片长（秒）
                        <InputNumber
                            aria-label="目标片长"
                            disabled={locked}
                            value={creative.brief.seconds}
                            min={4}
                            max={60}
                            precision={0}
                            onChange={(seconds) => {
                                if (seconds !== null) patchBrief({ seconds });
                            }}
                        />
                    </label>
                    <label>
                        目标观众
                        <Input aria-label="目标观众" disabled={locked} value={creative.brief.audience} maxLength={300} placeholder="例如：通勤人群、第一次使用的新手" onChange={(event) => patchBrief({ audience: event.target.value })} />
                    </label>
                    <label>
                        希望观众做什么
                        <Input aria-label="创作目标" disabled={locked} value={creative.brief.objective} maxLength={300} placeholder="记住商品、看懂用法、了解套餐…" onChange={(event) => patchBrief({ objective: event.target.value })} />
                    </label>
                    <label>
                        视觉与配色要求
                        <Input aria-label="视觉与配色要求" disabled={locked} value={creative.brief.brand} maxLength={300} placeholder="主体颜色、场景主色、光线与语气" onChange={(event) => patchBrief({ brand: event.target.value })} />
                    </label>
                </div>
                <div className="cv-fields">
                    {(["platform", "goal", "style", "narrative"] as const).map((key) => (
                        <label key={key}>
                            {{ platform: "发布平台", goal: "视频目标", style: "拍摄方式", narrative: "叙事组织" }[key]}
                            <Select
                                aria-label={{ platform: "发布平台", goal: "视频目标", style: "拍摄方式", narrative: "叙事组织" }[key]}
                                disabled={locked}
                                value={campaign[key] || "auto"}
                                options={Object.entries(REPLICA_DIRECTOR_OPTIONS[key]).map(([value, label]) => ({ value, label: key === "style" && value === "auto" ? "根据主体与目标选择" : label }))}
                                onChange={(value) => patchCampaign({ [key]: value })}
                            />
                        </label>
                    ))}
                </div>
                <label>
                    全片连续性
                    <Input.TextArea aria-label="全片连续性" disabled={locked} value={campaign.continuity} maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => patchCampaign({ continuity: event.target.value })} />
                </label>
                {creative.brief.topic ? (
                    <p>
                        选题：{creative.brief.topic.title} ·{" "}
                        <a href={creative.brief.topic.url} target="_blank" rel="noreferrer">
                            查看来源
                        </a>
                        <Button size="small" disabled={locked} onClick={() => patchBrief({ topic: undefined })}>
                            移除选题
                        </Button>
                    </p>
                ) : null}
            </section>
            <section className="rw-card">
                <header className="rw-card-head">
                    <h3>3. 比较完整脚本</h3>
                    <span>先选用，再生成</span>
                </header>
                <div className="cv-actions">
                    <Select aria-label="脚本方案数量" disabled={locked} value={count} onChange={setCount} options={[2, 3, 4, 5, 6].map((value) => ({ value, label: `${value} 个创意方向` }))} />
                    <Button type="primary" loading={processing} disabled={locked || !model || planImageCount < referenceCount || Boolean(creativeReadyError(job))} onClick={() => void run("plan")}>
                        生成脚本方案
                    </Button>
                </div>
                {creativeReadyError(job) ? <p className="rw-hint">{creativeReadyError(job)}</p> : null}
                {running || (busy && unsettled) ? (
                    <p className="rw-hint" role="status">
                        {creative.run?.kind === "analysis" ? "正在分析参考素材…" : "导演正在结合素材、用途与创作要求策划完整脚本…"}
                    </p>
                ) : unsettled ? (
                    <div className="cv-recover" role="status">
                        <p>上次{creative.run?.kind === "analysis" ? "素材分析" : "脚本策划"}尚未确认结果。恢复会先查询已有任务。</p>
                        <Button disabled={processing || disabled} onClick={() => void run()}>
                            恢复上次策划
                        </Button>
                    </div>
                ) : null}
                {creative.run?.error ? (
                    <p className="rw-warn" role="alert">
                        {creative.run.error}
                    </p>
                ) : null}
                {creative.plans.map((plan) => (
                    <details className="cv-plan" key={plan.id} open={creative.activePlanId === plan.id}>
                        <summary>
                            {plan.title}
                            {creative.activePlanId === plan.id ? " · 正在使用" : ""} · {plan.shots.length} 镜头 · {plan.shots.at(-1)!.endMs / 1000} 秒
                        </summary>
                        <ReplicaStrategyView strategy={plan.strategy} creative />
                        <ol>
                            {plan.shots.map((shot) => (
                                <li key={shot.index}>
                                    <strong>
                                        {shot.startMs / 1000}–{shot.endMs / 1000} 秒 · {shot.director?.purpose}
                                    </strong>
                                    <p>{shot.plot}</p>
                                    <p>{shot.director?.action}</p>
                                    {shot.dialogue ? <blockquote>{shot.dialogue}</blockquote> : null}
                                    {shot.onScreenText ? <small>后期文字：{shot.onScreenText}</small> : null}
                                </li>
                            ))}
                        </ol>
                        {plan.input !== planInput ? <p className="rw-warn">商品或设置已变化，请重新策划。</p> : null}
                        <Button disabled={locked || plan.input !== planInput || creative.activePlanId === plan.id} onClick={() => void apply(plan)}>
                            选用这份脚本
                        </Button>
                    </details>
                ))}
            </section>
        </div>
    );
}
