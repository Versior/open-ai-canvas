import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { PRODUCT_VIDEO_AUDIO_LABEL, PRODUCT_VIDEO_LIMITS, productVideoImageCount, type ProductVideoAudio, type ProductVideoInputs, type ProductVideoSlot } from "@/lib/product-video/job";
import { formatProductVideoSeconds, plannedProductVideoSegments } from "@/lib/product-video/media";
import { assessProductVideo } from "@/lib/product-video/prompt";
import type { AiConfig } from "@/stores/use-config-store";
import { ProductVideoImageSlot } from "./product-video-assets";
import { productVideoLimitsFor } from "./product-video-config";
import { ProductVideoReferencePanel } from "./product-video-reference";
import { formatProductVideoCredits, useProductVideoEstimate } from "./use-product-video-estimate";

const SLOTS: ProductVideoSlot[] = ["products", "models", "backgrounds"];
const AUDIOS: ProductVideoAudio[] = ["original", "model", "mute"];
const AUDIO_HINT: Record<ProductVideoAudio, string> = {
    original: "成片换回原视频的声音，只替换画面",
    model: "让模型按新画面生成声音（需要模型支持）",
    mute: "成片不带声音，适合后期另配音乐或口播",
};

export function ProductVideoComposer({
    config,
    inputs,
    editing,
    starting,
    error,
    onChange,
    onStart,
    onReset,
}: {
    config: AiConfig;
    inputs: ProductVideoInputs;
    /** 正在编辑的作品名称（从作品列表点「编辑」带回来的参数）。 */
    editing?: string;
    starting: boolean;
    error: string;
    /** 传函数时按最新的表单计算修改（连续上传多张图时不会互相覆盖）。 */
    onChange: (patch: Partial<ProductVideoInputs> | ((current: ProductVideoInputs) => Partial<ProductVideoInputs>)) => void;
    /** credits 是当前的报价（拿到了才有），记进作品方便对账。 */
    onStart: (credits?: number) => void;
    onReset: () => void;
}) {
    const limits = useMemo(() => productVideoLimitsFor(config, inputs.model), [config, inputs.model]);
    const usable = typeof limits === "string" ? undefined : limits;
    const profile = useMemo(() => (inputs.model ? modelCapabilityConfigFor(config, inputs.model).video : undefined), [config, inputs.model]);
    const imageCount = productVideoImageCount(inputs);
    const rangeMs = inputs.reference ? inputs.endMs - inputs.startMs : 0;
    const segments = useMemo(() => (usable && rangeMs > 0 ? plannedProductVideoSegments(rangeMs, usable.maxSegmentSeconds) : []), [rangeMs, usable]);
    const estimate = useProductVideoEstimate({ model: inputs.model, ratio: inputs.ratio, resolution: inputs.resolution, audio: inputs.audio, imageCount, segments, limits: usable });
    const assessment = imageCount && inputs.reference ? assessProductVideo(inputs, Math.max(1, segments.length)) : undefined;

    return (
        <div className="pv-composer">
            <div className="pv-composer-scroll">
                {editing ? (
                    <div className="pv-banner" role="status">
                        <span>正在按「{editing}」的参数编辑，开始生成会新建一条作品，原作品保留。</span>
                        <Button size="small" type="text" onClick={onReset}>
                            清空
                        </Button>
                    </div>
                ) : null}
                <section className="pv-section" aria-label="素材">
                    <header className="pv-section-head">
                        <h3>素材</h3>
                        <span>放哪一类就替换哪一类，没放的保持原视频不变</span>
                    </header>
                    <div className="pv-slots">
                        {SLOTS.map((slot) => (
                            <ProductVideoImageSlot
                                key={slot}
                                slot={slot}
                                items={inputs[slot]}
                                disabled={starting}
                                onAdd={(images) => onChange((current) => ({ [slot]: [...current[slot], ...images].slice(0, PRODUCT_VIDEO_LIMITS[slot]) }))}
                                onRemove={(id) => onChange((current) => ({ [slot]: current[slot].filter((image) => image.id !== id) }))}
                            />
                        ))}
                    </div>
                </section>
                <ProductVideoReferencePanel
                    reference={inputs.reference}
                    startMs={inputs.startMs}
                    endMs={inputs.endMs}
                    disabled={starting}
                    onReference={(reference) => onChange(reference ? { reference, ratio: "" } : { reference: undefined, startMs: 0, endMs: 0 })}
                    onRange={(range) => onChange(range)}
                />
                <section className="pv-section" aria-label="生成设置">
                    <header className="pv-section-head">
                        <h3>生成设置</h3>
                        {usable ? <span>每段最长参考 {usable.maxSegmentSeconds} 秒，长视频按镜头分段生成再拼接</span> : null}
                    </header>
                    <div className="pv-fields">
                        <label className="pv-field pv-field-wide">
                            <span className="pv-field-label">视频模型</span>
                            <ModelPicker
                                config={config}
                                capability="video"
                                value={inputs.model}
                                onChange={(model) => onChange({ model })}
                                fullWidth
                                showSelectedPrice={false}
                                placeholder="选择能参考视频的模型"
                                modelFilter={(model) => typeof productVideoLimitsFor(config, model) !== "string"}
                                modelDisabledReason={(model) => {
                                    const value = productVideoLimitsFor(config, model);
                                    return typeof value !== "string" && imageCount > value.maxImages ? `一次最多参考 ${value.maxImages} 张图` : "";
                                }}
                            />
                            {typeof limits === "string" && inputs.model ? <span className="pv-field-error">这个模型{limits}，请换一个能参考视频的模型</span> : null}
                        </label>
                        <label className="pv-field">
                            <span className="pv-field-label">画幅</span>
                            <Select
                                value={inputs.ratio || undefined}
                                placeholder="跟随模型"
                                disabled={!profile?.ratios.length}
                                options={(profile?.ratios || []).map((ratio) => ({ value: ratio, label: ratio === "adaptive" ? "跟随参考视频" : ratio }))}
                                onChange={(ratio) => onChange({ ratio })}
                                aria-label="画幅"
                            />
                        </label>
                        <label className="pv-field">
                            <span className="pv-field-label">清晰度</span>
                            <Select
                                value={inputs.resolution || undefined}
                                placeholder="跟随模型"
                                disabled={!profile?.resolutions.length}
                                options={(profile?.resolutions || []).map((resolution) => ({ value: resolution, label: resolution }))}
                                onChange={(resolution) => onChange({ resolution })}
                                aria-label="清晰度"
                            />
                        </label>
                        <div className="pv-field pv-field-wide">
                            <span className="pv-field-label">声音</span>
                            <SegmentedControl<ProductVideoAudio>
                                ariaLabel="声音"
                                value={inputs.audio}
                                onChange={(audio) => onChange({ audio })}
                                options={AUDIOS.map((value) => ({ value, label: PRODUCT_VIDEO_AUDIO_LABEL[value], disabled: value === "model" && usable ? !usable.generateAudio : false, title: AUDIO_HINT[value] }))}
                            />
                            <span className="pv-field-hint">{AUDIO_HINT[inputs.audio]}</span>
                        </div>
                        <label className="pv-field pv-field-wide">
                            <span className="pv-field-label">补充要求（可选）</span>
                            <Input.TextArea value={inputs.note} maxLength={500} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="例如：商品始终正面朝向镜头；模特保持微笑；不要改变手部动作" onChange={(event) => onChange({ note: event.target.value })} />
                        </label>
                        <div className="pv-field pv-field-wide">
                            <Checkbox checked={inputs.preview} onChange={(event) => onChange({ preview: event.target.checked })}>
                                先生成第一段预览，满意后再生成其余段
                            </Checkbox>
                        </div>
                    </div>
                </section>
                {assessment ? (
                    <section className="pv-section pv-assess" aria-label="难度与预期" data-level={assessment.difficulty}>
                        <header className="pv-section-head">
                            <h3>
                                难度与预期 <span className="pv-level">{assessment.difficulty}</span>
                            </h3>
                        </header>
                        <p>{assessment.summary}</p>
                        {assessment.risks.length ? (
                            <ul>
                                {assessment.risks.map((risk) => (
                                    <li key={risk}>{risk}</li>
                                ))}
                            </ul>
                        ) : null}
                    </section>
                ) : null}
            </div>
            <footer className="pv-composer-foot">
                <div className="pv-estimate">
                    {estimate.enabled && estimate.state !== "idle" ? (
                        <strong>
                            <Sparkles size={14} aria-hidden />
                            {estimate.state === "ready" && estimate.credits !== null ? `${formatProductVideoCredits(estimate.credits)} 积分起` : estimate.state === "loading" ? "正在计算积分…" : "暂时算不出积分"}
                        </strong>
                    ) : null}
                    <span>成片时长跟随参考视频{rangeMs > 0 ? `（${formatProductVideoSeconds(rangeMs)}${segments.length > 1 ? `，约分 ${segments.length} 段` : ""}）` : ""}</span>
                </div>
                <Tooltip title={error || undefined}>
                    <Button type="primary" size="large" loading={starting} disabled={Boolean(error)} onClick={() => onStart(estimate.state === "ready" && estimate.credits !== null ? estimate.credits : undefined)}>
                        开始生成
                    </Button>
                </Tooltip>
            </footer>
            {error && (imageCount || inputs.reference) ? <p className="pv-foot-error">{error}</p> : null}
        </div>
    );
}
