import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import { Package, Sparkles, Wand2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { formatTeardownTime } from "@/lib/canvas/video-teardown";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { ProductVideoImage } from "@/lib/product-video/job";
import { REMAKE_AUDIO_LABEL, REMAKE_RISK_LABEL, REMAKE_TREATMENT_HINT, REMAKE_TREATMENT_LABEL, REMAKE_TREATMENTS, type RemakeAudio, type RemakeJob, type RemakePeople, type RemakeShot, type RemakeTreatment } from "@/lib/remake/job";
import { remakeDialogueBudget } from "@/lib/remake/prompts";
import { remakeRecommendReason } from "@/lib/remake/recommend";
import type { AiConfig } from "@/stores/use-config-store";
import { ProductVideoImageSlot, productVideoThumbUrl } from "../replace/product-video-assets";
import { productVideoLimitsFor } from "../replace/product-video-config";
import { RemakeProductPicker } from "./remake-product-picker";

export type RemakeEdit = (updater: (job: RemakeJob) => RemakeJob) => void;

const PEOPLE_OPTIONS: { value: RemakePeople; label: string }[] = [
    { value: "model", label: "换成模特" },
    { value: "original", label: "保留原人物" },
    { value: "none", label: "不出人" },
];
const AUDIO_OPTIONS: RemakeAudio[] = ["rewrite", "original", "mute"];
const AUDIO_HINT: Record<RemakeAudio, string> = {
    rewrite: "按原片的节奏和说服结构，把口播改写成你的卖点；说话镜头由视频模型同时生成口型和声音",
    original: "成片换回原视频的声音，只替换画面；原声里可能有别人的品牌和原话",
    mute: "成片不带人声，适合后期另配口播或音乐",
};

function Card({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
    return (
        <section className="rw-card">
            <header className="rw-card-head">
                <h3>{title}</h3>
                {extra}
            </header>
            {children}
        </section>
    );
}

/** 复刻配方：我的商品、人物、场景、口播、授权与生成设置。 */
export function RemakeRecipeCards({ job, config, edit, disabled }: { job: RemakeJob; config: AiConfig; edit: RemakeEdit; disabled?: boolean }) {
    const [picking, setPicking] = useState(false);
    const profile = useMemo(() => (job.model ? modelCapabilityConfigFor(config, job.model).video : undefined), [config, job.model]);
    const limits = useMemo(() => productVideoLimitsFor(config, job.model), [config, job.model]);
    const imageCount = job.product.images.length + (job.people === "model" ? job.models.length : 0) + job.backgrounds.length;
    const patchImages = (key: "models" | "backgrounds", next: (images: ProductVideoImage[]) => ProductVideoImage[]) => edit((value) => ({ ...value, [key]: next(value[key]) }));
    const needsAuth = job.audio === "original" || job.people === "original" || job.shots.some((shot) => shot.treatment === "keep");
    return (
        <div className="rw-recipe">
            <Card
                title="我的商品"
                extra={
                    <Button size="small" icon={<Package size={14} />} disabled={disabled} onClick={() => setPicking(true)}>
                        从电商生图台选
                    </Button>
                }
            >
                <div className="rw-fields">
                    <Input
                        value={job.product.name}
                        maxLength={60}
                        placeholder="商品名称，例如：绿色纸巾 整箱装"
                        disabled={disabled}
                        onChange={(event) => edit((value) => ({ ...value, product: { ...value.product, name: event.target.value } }))}
                        aria-label="商品名称"
                    />
                    <Input.TextArea
                        value={job.product.sellingPoints}
                        maxLength={400}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        placeholder="卖点，一行一条：厚实不掉屑、一提 24 包…（改写口播会用到）"
                        disabled={disabled}
                        onChange={(event) => edit((value) => ({ ...value, product: { ...value.product, sellingPoints: event.target.value } }))}
                        aria-label="商品卖点"
                    />
                </div>
                <ProductVideoImageSlot
                    slot="products"
                    items={job.product.images}
                    disabled={disabled}
                    onAdd={(images) => edit((value) => ({ ...value, product: { ...value.product, images: [...value.product.images, ...images].slice(0, 4) } }))}
                    onRemove={(id) => edit((value) => ({ ...value, product: { ...value.product, images: value.product.images.filter((image) => image.id !== id) } }))}
                />
            </Card>
            <Card title="人物">
                <SegmentedControl<RemakePeople> ariaLabel="人物" value={job.people} block size="sm" disabled={disabled} onChange={(people) => edit((value) => ({ ...value, people }))} options={PEOPLE_OPTIONS} />
                {job.people === "model" ? (
                    <ProductVideoImageSlot
                        slot="models"
                        items={job.models}
                        disabled={disabled}
                        onAdd={(images) => patchImages("models", (current) => [...current, ...images].slice(0, 3))}
                        onRemove={(id) => patchImages("models", (current) => current.filter((image) => image.id !== id))}
                    />
                ) : (
                    <p className="rw-hint">{job.people === "original" ? "保留原片里的人，需要你有肖像使用授权。" : "画面里不出现人脸，需要时只出现手。"}</p>
                )}
                {job.people === "model" && !job.models.length ? <p className="rw-hint">不放模特图时，出镜的人会换成一位外观不同的普通人，不还原原片人物的长相。</p> : null}
            </Card>
            <Card title="场景">
                <ProductVideoImageSlot
                    slot="backgrounds"
                    items={job.backgrounds}
                    disabled={disabled}
                    onAdd={(images) => patchImages("backgrounds", (current) => [...current, ...images].slice(0, 3))}
                    onRemove={(id) => patchImages("backgrounds", (current) => current.filter((image) => image.id !== id))}
                />
                {!job.backgrounds.length ? <p className="rw-hint">不放背景图就沿用原片的场景布局，去掉原片的招牌和品牌。</p> : null}
            </Card>
            <Card title="口播">
                <SegmentedControl<RemakeAudio>
                    ariaLabel="口播"
                    value={job.audio}
                    block
                    size="sm"
                    disabled={disabled}
                    onChange={(audio) => edit((value) => ({ ...value, audio }))}
                    options={AUDIO_OPTIONS.map((value) => ({ value, label: REMAKE_AUDIO_LABEL[value], disabled: value === "original" && !job.source.hasAudio }))}
                />
                <p className="rw-hint">{AUDIO_HINT[job.audio]}</p>
                {job.audio === "rewrite" && typeof limits !== "string" && !limits.generateAudio ? <p className="rw-warn">所选视频模型不能生成声音，换一个能出声的模型才能用新口播。</p> : null}
            </Card>
            <Card title="生成设置">
                <div className="rw-fields">
                    <ModelPicker
                        config={config}
                        capability="video"
                        value={job.model}
                        onChange={(model) => edit((value) => ({ ...value, model, ratio: "", resolution: "" }))}
                        fullWidth
                        showSelectedPrice={false}
                        placeholder="选择能参考视频的模型"
                        modelFilter={(model) => typeof productVideoLimitsFor(config, model) !== "string"}
                        modelDisabledReason={(model) => {
                            const value = productVideoLimitsFor(config, model);
                            return typeof value !== "string" && imageCount > value.maxImages ? `一次最多参考 ${value.maxImages} 张图` : "";
                        }}
                    />
                    <div className="rw-field-pair">
                        <Select
                            value={job.ratio || undefined}
                            placeholder="画幅"
                            disabled={disabled || !profile?.ratios.length}
                            options={(profile?.ratios || []).map((ratio) => ({ value: ratio, label: ratio === "adaptive" ? "跟随原片" : ratio }))}
                            onChange={(ratio) => edit((value) => ({ ...value, ratio }))}
                            aria-label="画幅"
                        />
                        <Select
                            value={job.resolution || undefined}
                            placeholder="清晰度"
                            disabled={disabled || !profile?.resolutions.length}
                            options={(profile?.resolutions || []).map((resolution) => ({ value: resolution, label: resolution }))}
                            onChange={(resolution) => edit((value) => ({ ...value, resolution }))}
                            aria-label="清晰度"
                        />
                    </div>
                    <Input.TextArea
                        value={job.note}
                        maxLength={300}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        placeholder="补充要求（可选）：商品始终正面朝向镜头；模特保持微笑…"
                        disabled={disabled}
                        onChange={(event) => edit((value) => ({ ...value, note: event.target.value }))}
                        aria-label="补充要求"
                    />
                </div>
            </Card>
            <label className="rw-auth" data-required={needsAuth || undefined}>
                <Checkbox checked={job.authorized} disabled={disabled} onChange={(event) => edit((value) => ({ ...value, authorized: event.target.checked }))} />
                <span>
                    我对原片有使用授权
                    <small>保留原片画面、原人物或原声时需要。只借结构不用原片内容时不用勾。</small>
                </span>
            </label>
            {picking ? (
                <RemakeProductPicker
                    onClose={() => setPicking(false)}
                    onPick={(product) => {
                        setPicking(false);
                        edit((value) => ({ ...value, product }));
                    }}
                />
            ) : null}
        </div>
    );
}

const TREATMENT_SHORT: Record<RemakeTreatment, string> = { replace: "换元素", remake: "重拍", keep: "保留", skip: "删掉" };

function ShotRow({ shot, audio, disabled, edit }: { shot: RemakeShot; audio: RemakeAudio; disabled?: boolean; edit: RemakeEdit }) {
    const patch = (next: Partial<RemakeShot>) => edit((value) => ({ ...value, shots: value.shots.map((item) => (item.index === shot.index ? { ...item, ...next } : item)) }));
    const budget = remakeDialogueBudget(shot);
    const length = Array.from(shot.dialogue).length;
    const reason = remakeRecommendReason(shot.risks, shot.treatment);
    return (
        <li className="rw-shot" data-treatment={shot.treatment}>
            <div className="rw-shot-frame">
                {shot.keyframeResourceId ? <img src={productVideoThumbUrl(shot.keyframeResourceId)} alt={`镜头 ${shot.index}`} loading="lazy" /> : null}
                <span className="rw-shot-no">{shot.index}</span>
            </div>
            <div className="rw-shot-main">
                <div className="rw-shot-meta">
                    <span>
                        {formatTeardownTime(shot.startMs)} · {((shot.endMs - shot.startMs) / 1000).toFixed(1)} 秒
                    </span>
                    {shot.risks.map((risk) => (
                        <span key={risk} className="rw-risk" data-risk={risk}>
                            {REMAKE_RISK_LABEL[risk]}
                        </span>
                    ))}
                </div>
                <p className="rw-shot-plot">{shot.plot || "（没有 AI 解读，按原画面处理）"}</p>
                <SegmentedControl<RemakeTreatment>
                    ariaLabel={`镜头 ${shot.index} 的做法`}
                    size="sm"
                    value={shot.treatment}
                    disabled={disabled}
                    onChange={(treatment) => patch({ treatment })}
                    options={REMAKE_TREATMENTS.map((value) => ({ value, label: `${TREATMENT_SHORT[value]}${value === shot.recommended ? " ·荐" : ""}`, title: REMAKE_TREATMENT_HINT[value] }))}
                />
                {reason ? <span className="rw-shot-reason">{reason}</span> : null}
            </div>
            <div className="rw-shot-voice">
                {shot.originalDialogue ? <span className="rw-shot-original">原：{shot.originalDialogue}</span> : <span className="rw-shot-original">原片这一镜没有口播</span>}
                {audio === "rewrite" && shot.treatment !== "skip" ? (
                    <>
                        <Input.TextArea
                            value={shot.dialogue}
                            disabled={disabled}
                            autoSize={{ minRows: 1, maxRows: 3 }}
                            placeholder={shot.originalDialogue ? "新口播" : "这一镜不说话"}
                            onChange={(event) => patch({ dialogue: event.target.value })}
                            aria-label={`镜头 ${shot.index} 的新口播`}
                        />
                        <span className="rw-shot-count" data-over={length > budget || undefined}>
                            {shot.speaker ? "对口型 · " : ""}
                            {length}/{budget} 字
                        </span>
                    </>
                ) : null}
            </div>
        </li>
    );
}

/** 逐镜做法：左边原片关键帧，中间推荐做法和风险，右边原口播和新口播。 */
export function RemakeStoryboard({
    job,
    edit,
    disabled,
    config,
    textModel,
    onTextModel,
    rewriting,
    onRewrite,
}: {
    job: RemakeJob;
    edit: RemakeEdit;
    disabled?: boolean;
    config: AiConfig;
    textModel: string;
    onTextModel: (model: string) => void;
    rewriting: boolean;
    onRewrite: () => void;
}) {
    const counts = REMAKE_TREATMENTS.map((treatment) => [treatment, job.shots.filter((shot) => shot.treatment === treatment).length] as const);
    const differs = job.shots.some((shot) => shot.treatment !== shot.recommended);
    return (
        <section className="rw-board" aria-label="逐镜做法">
            <header className="rw-board-head">
                <div>
                    <h3>逐镜做法</h3>
                    <p>
                        {counts
                            .filter(([, value]) => value)
                            .map(([treatment, value]) => `${REMAKE_TREATMENT_LABEL[treatment]} ${value}`)
                            .join(" · ")}
                    </p>
                </div>
                <div className="rw-board-actions">
                    {differs ? (
                        <Button size="small" disabled={disabled} onClick={() => edit((value) => ({ ...value, shots: value.shots.map((shot) => ({ ...shot, treatment: shot.recommended })) }))}>
                            全部按推荐
                        </Button>
                    ) : null}
                    {job.audio === "rewrite" ? (
                        <>
                            <div className="rw-text-model">
                                <ModelPicker config={config} capability="text" value={textModel} onChange={onTextModel} showSelectedPrice={false} showOptionPrices placeholder="改写用的文本模型" />
                            </div>
                            <Tooltip title="按原片节奏和你的卖点改写每镜口播，按所选文本模型计费">
                                <Button size="small" icon={<Wand2 size={14} />} loading={rewriting} disabled={disabled} onClick={onRewrite}>
                                    AI 改写口播
                                </Button>
                            </Tooltip>
                        </>
                    ) : null}
                </div>
            </header>
            <ol className="rw-shots">
                {job.shots.map((shot) => (
                    <ShotRow key={shot.index} shot={shot} audio={job.audio} disabled={disabled} edit={edit} />
                ))}
            </ol>
            {!job.shots.some((shot) => shot.plot) ? (
                <p className="rw-hint rw-board-foot">
                    <Sparkles size={14} aria-hidden /> 这条拆解还没有 AI 解读，推荐做法和改写口播会不准。回到拆解记录做一次分析效果更好。
                </p>
            ) : null}
        </section>
    );
}
