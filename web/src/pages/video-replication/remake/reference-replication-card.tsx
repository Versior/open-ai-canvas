import { App, Button, Input, InputNumber } from "antd";
import { useState } from "react";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { videoTeardownTextRequirements, formatTeardownTime } from "@/lib/canvas/video-teardown";
import type { RemakeJob } from "@/lib/remake/job";
import { applyReferenceReplicationPlan, REFERENCE_STYLE_FIELDS, REPLICATION_MODE_LABEL, referenceReplicationInput, type ReferenceReplicationMode } from "@/lib/remake/reference-replication";
import type { AiConfig } from "@/stores/use-config-store";
import { updateRemake } from "../replace/use-product-video-store";
import { productVideoThumbUrl } from "../replace/product-video-assets";
import type { RemakeEdit } from "./remake-recipe";
import { changeReferenceReplicationMode, generateReferenceReplicationPlan } from "./reference-replication-runner";

export function ReferenceReplicationCard({ job, config, edit, disabled, flush, onBusyChange }: { job: RemakeJob; config: AiConfig; edit: RemakeEdit; disabled?: boolean; flush: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const [model, setModel] = useState(config.textModel);
    const r = job.replication;
    const mode = r?.mode || "elements";
    const stale = Boolean(r?.plan && r.plan.input !== referenceReplicationInput(job));
    const perform = async (action: () => Promise<unknown>) => {
        setBusy(true);
        onBusyChange(true);
        try {
            await flush();
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考方案处理失败");
        } finally {
            setBusy(false);
            onBusyChange(false);
        }
    };
    return (
        <section className="rw-card rw-reference-replication" aria-label="参考复刻方式">
            <header className="rw-card-head">
                <h3>参考复刻方式</h3>
            </header>
            <SegmentedControl<"elements" | ReferenceReplicationMode>
                ariaLabel="参考复刻方式"
                value={mode}
                block
                size="sm"
                disabled={disabled || busy || Boolean(r?.run)}
                options={Object.entries(REPLICATION_MODE_LABEL).map(([value, label]) => ({ value: value as "elements" | ReferenceReplicationMode, label }))}
                onChange={(next) => void perform(() => changeReferenceReplicationMode(job.id, next))}
            />
            <p className="rw-hint">
                {mode === "elements"
                    ? "沿用原片动作与机位换商品、人物或场景；逐镜也可选择重新拍。"
                    : mode === "structure"
                      ? "保留原镜头的叙事作用、顺序与时长；为新主体重新设计动作。例如摇椅改扶手椅，细节镜头改拍新椅子实际拥有的部件。"
                      : "借用色调、布光、质感、构图、运镜与剪辑语言；重新设计内容和节奏，使用独立目标时长。"}
            </p>
            {r ? (
                <>
                    {mode === "style" ? (
                        <label className="rw-reference-duration">
                            目标时长（秒）
                            <InputNumber
                                aria-label="风格复刻目标时长"
                                min={5}
                                max={180}
                                precision={0}
                                value={r.targetDurationMs / 1000}
                                disabled={disabled || busy || Boolean(r.run)}
                                onChange={(seconds) => {
                                    if (typeof seconds === "number") edit((value) => (value.replication ? { ...value, replication: { ...value.replication, targetDurationMs: seconds * 1000 } } : value));
                                }}
                            />
                        </label>
                    ) : null}
                    <Input.TextArea
                        aria-label="参考改编要求"
                        placeholder="新主体与原片有什么区别，需要保留什么表达，例如：强调扶手细节，不展示摇动"
                        maxLength={800}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        value={r.brief}
                        disabled={disabled || busy || Boolean(r.run)}
                        onChange={(event) => edit((value) => (value.replication ? { ...value, replication: { ...value.replication, brief: event.target.value } } : value))}
                    />
                    <ModelPicker
                        config={config}
                        capability="text"
                        value={r.run?.model || model}
                        onChange={setModel}
                        fullWidth
                        requirements={videoTeardownTextRequirements(config, 2)}
                        modelDisabledReason={() => (disabled || busy || r.run ? "正在处理参考方案" : "")}
                    />
                    <div className="rw-inspector-actions">
                        <Button loading={busy} disabled={disabled || !model} onClick={() => void perform(() => generateReferenceReplicationPlan(job.id, config, r.run?.model || model))}>
                            {r.run ? "恢复参考规划任务" : r.plan ? "重新分析与规划" : "分析参考并规划目标分镜"}
                        </Button>
                    </div>
                    <p className="rw-hint">按所选文本模型计费；关键帧只用于分析，不作为视频动作或人物身份参考。先比较原镜头作用与目标动作，应用后再生成视频。</p>
                    {r.plan ? (
                        <div className="rw-reference-plan">
                            <h4>{r.plan.title}</h4>
                            <dl>
                                {Object.entries(REFERENCE_STYLE_FIELDS).map(([key, label]) => (
                                    <div key={key}>
                                        <dt>{label}</dt>
                                        <dd>{r.plan!.style[key as keyof typeof REFERENCE_STYLE_FIELDS]}</dd>
                                    </div>
                                ))}
                            </dl>
                            <details>
                                <summary>原镜头作用与迁移依据</summary>
                                <ol>
                                    {r.plan.beats.map((beat) => (
                                        <li key={beat.shotNumber}>
                                            <strong>
                                                原镜头 {beat.shotNumber} · {beat.purpose}
                                            </strong>
                                            <p>{beat.adaptation}</p>
                                        </li>
                                    ))}
                                </ol>
                            </details>
                            <ol className="rw-reference-shots">
                                {r.plan.shots.map((shot) => (
                                    <li key={shot.index}>
                                        {shot.keyframeResourceId ? <img src={productVideoThumbUrl(shot.keyframeResourceId)} alt={`原镜头 ${shot.index} 参考`} loading="lazy" /> : null}
                                        <div>
                                            <strong>
                                                目标镜头 {shot.index} · {formatTeardownTime(shot.startMs)}–{formatTeardownTime(shot.endMs)}
                                            </strong>
                                            <p>{shot.director?.purpose}</p>
                                            <p>
                                                {shot.director?.start} → {shot.director?.action} → {shot.director?.end}
                                            </p>
                                            {shot.dialogue ? <p>新台词：{shot.dialogue}</p> : null}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                            {stale ? (
                                <p className="rw-warn" role="status">
                                    资料已变化，旧方案保留供回查；请重新规划。
                                </p>
                            ) : null}
                            <Button type="primary" disabled={disabled || busy || stale || r.confirmed || Boolean(r.run)} onClick={() => void perform(() => updateRemake(job.id, applyReferenceReplicationPlan))}>
                                {r.confirmed && !stale ? "已应用目标分镜" : "应用方案，进入目标分镜"}
                            </Button>
                        </div>
                    ) : null}
                </>
            ) : null}
        </section>
    );
}
