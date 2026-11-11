import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import { Package, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ModelPicker } from "@/components/model-picker";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { formatTeardownTime } from "@/lib/canvas/video-teardown";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { ProductVideoImage } from "@/lib/product-video/job";
import {
    addRemakeModels,
    REMAKE_AUDIO_LABEL,
    REMAKE_AUDIOS,
    REMAKE_RISK_LABEL,
    REMAKE_TREATMENT_HINT,
    REMAKE_TREATMENT_LABEL,
    REMAKE_TREATMENTS,
    type RemakeAudio,
    type RemakeJob,
    type RemakeLanguage,
    type RemakePeople,
    type RemakeShot,
    type RemakeTreatment,
} from "@/lib/remake/job";
import { remakeDialogueBudget, remakeReferenceImages } from "@/lib/remake/prompts";
import { remakeRecommendReason } from "@/lib/remake/recommend";
import type { AiConfig } from "@/stores/use-config-store";
import { ProductVideoImageSlot, productVideoThumbUrl } from "../replace/product-video-assets";
import { remakeLimitsFor } from "./remake-config";
import { RemakePersonaModal } from "./remake-persona";
import { RemakeProductPicker } from "./remake-product-picker";
import { RemakeFinishCard, RemakeLanguageField, RemakeVoiceFields, RemakeVoiceReference } from "./remake-sound";
import { RemakeContinuityCard } from "./remake-continuity";
import { ReplicaCampaignControls, ReplicaShotDirector } from "../replication-director";
import { RemakeDirectorPlanner } from "./remake-director";
import { isCommercialCreativeScene } from "@/lib/remake/creative";
import { ReferenceReplicationCard } from "./reference-replication-card";

export type RemakeEdit = (updater: (job: RemakeJob) => RemakeJob) => void;

const PEOPLE_OPTIONS: { value: RemakePeople; label: string }[] = [
    { value: "model", label: "换成模特" },
    { value: "original", label: "保留原人物" },
    { value: "none", label: "不出人" },
];
const AUDIO_HINT: Record<RemakeAudio, string> = {
    rewrite: "按镜头时间说新台词，同时生成声音和口型。多段口播请提供同一份音色参考，避免每段换声音。",
    voice: "新口播由配音模型用同一个音色朗读，视频模型不出声；音色稳定，适合旁白类视频，说话镜头不对口型",
    original: "保留整条原声。说话镜头须参考原视频换元素，不能仅凭图片重拍口型；原声中的品牌、参数和卖点也会保留。",
    mute: "成片不带人声，适合后期另配口播或音乐",
};

/** 这个口播方式要不要写新口播。 */
export function remakeWritesDialogue(audio: RemakeAudio) {
    return audio === "rewrite" || audio === "voice";
}

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
export function RemakeRecipeCards({
    job,
    config,
    edit,
    disabled,
    onPlanningChange,
    onUploadingChange,
    flush,
}: {
    job: RemakeJob;
    config: AiConfig;
    edit: RemakeEdit;
    disabled?: boolean;
    onPlanningChange: (busy: boolean) => void;
    onUploadingChange?: (busy: boolean) => void;
    flush: () => Promise<void>;
}) {
    const [picking, setPicking] = useState(false);
    const [persona, setPersona] = useState(false);
    const [uploads, setUploads] = useState({ products: false, models: false, backgrounds: false, continuity: false, voice: false });
    const uploading = Object.values(uploads).some(Boolean);
    useEffect(() => {
        onUploadingChange?.(uploading);
    }, [uploading, onUploadingChange]);
    const profile = useMemo(() => (job.model ? modelCapabilityConfigFor(config, job.model).video : undefined), [config, job.model]);
    const limits = useMemo(() => remakeLimitsFor(config, job.model, job.shots), [config, job.model, job.shots]);
    const imageCount = remakeReferenceImages(job).images.length;
    const patchImages = (key: "models" | "backgrounds", next: (images: ProductVideoImage[]) => ProductVideoImage[]) => edit((value) => ({ ...value, [key]: next(value[key]) }));
    const needsAuth = job.audio === "original" || job.people === "original" || job.shots.some((shot) => shot.treatment === "keep");
    const subject = job.creative && !isCommercialCreativeScene(job.creative.brief.scene);
    return (
        <div className="rw-recipe">
            {job.source ? <ReferenceReplicationCard job={job} config={config} edit={edit} disabled={disabled || uploading} flush={flush} onBusyChange={onPlanningChange} /> : null}
            {!job.creative && !job.replication ? (
                <details className="rw-strategy">
                    <summary>导演与平台策略</summary>
                    <Card title="策划设置">
                        <ReplicaCampaignControls value={job.campaign} disabled={disabled} onChange={(campaign) => edit((value) => ({ ...value, campaign }))} />
                        {job.campaign ? <RemakeDirectorPlanner job={job} config={config} edit={edit} disabled={disabled} onBusyChange={onPlanningChange} /> : null}
                        <p className="rw-shot-reason">重拍镜头按导演动作生成；换元素保留原片动作与机位。</p>
                    </Card>
                </details>
            ) : null}
            <Card
                title={subject ? "主体参考" : "我的商品"}
                extra={
                    subject ? undefined : (
                        <Button size="small" icon={<Package size={14} />} disabled={disabled} onClick={() => setPicking(true)}>
                            从电商生图台选
                        </Button>
                    )
                }
            >
                <div className="rw-fields">
                    <Input
                        value={job.product.name}
                        maxLength={60}
                        placeholder={subject ? "主体名称，例如：城市街景、陶艺师、橘猫" : "商品名称，例如：绿色纸巾 整箱装"}
                        disabled={disabled}
                        onChange={(event) => edit((value) => ({ ...value, product: { ...value.product, name: event.target.value } }))}
                        aria-label={subject ? "主体名称" : "商品名称"}
                    />
                    <Input.TextArea
                        value={job.product.sellingPoints}
                        maxLength={400}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        placeholder={subject ? "已确认的信息，一行一条" : "卖点，一行一条：厚实不掉屑、一提 24 包…"}
                        disabled={disabled}
                        onChange={(event) => edit((value) => ({ ...value, product: { ...value.product, sellingPoints: event.target.value } }))}
                        aria-label={subject ? "主体资料" : "商品卖点"}
                    />
                </div>
                <ProductVideoImageSlot
                    slot="products"
                    displayLabel={subject ? "主体参考图" : undefined}
                    hint={job.creative ? "主体外观与细节参考" : undefined}
                    onPendingChange={(pending) => setUploads((value) => ({ ...value, products: pending }))}
                    items={job.product.images}
                    disabled={disabled}
                    onAdd={(images) => edit((value) => ({ ...value, product: { ...value.product, images: [...value.product.images, ...images].slice(0, 4) } }))}
                    onRemove={(id) => edit((value) => ({ ...value, product: { ...value.product, images: value.product.images.filter((image) => image.id !== id) } }))}
                />
            </Card>
            <Card title="人物">
                <SegmentedControl<RemakePeople>
                    ariaLabel="人物"
                    value={job.people}
                    block
                    size="sm"
                    disabled={disabled}
                    onChange={(people) => edit((value) => ({ ...value, people }))}
                    options={job.creative || job.replication ? PEOPLE_OPTIONS.filter((item) => item.value !== "original").map((item) => ({ ...item, label: item.value === "model" ? "人物出镜" : item.label })) : PEOPLE_OPTIONS}
                />
                {job.people === "model" ? (
                    <ProductVideoImageSlot
                        slot="models"
                        onPendingChange={(pending) => setUploads((value) => ({ ...value, models: pending }))}
                        items={job.models}
                        disabled={disabled}
                        onAdd={(images) => patchImages("models", (current) => addRemakeModels(current, images))}
                        onRemove={(id) => patchImages("models", (current) => current.filter((image) => image.id !== id))}
                        generate={{ label: "AI 生成", onClick: () => setPersona(true) }}
                    />
                ) : (
                    <p className="rw-hint">{job.people === "original" ? "保留原片里的人，需要你有肖像使用授权。" : "画面里不出现人脸，需要时只出现手。"}</p>
                )}
                {job.people === "model" && !job.models.length ? <p className="rw-hint">多镜头有人出镜时，先上传同一人物的人脸或全身图，也可生成一张模特图。每段共用这张身份参考。</p> : null}
                {job.people === "model" ? <p className="rw-hint">人脸定长相，模特定整个人，二选一；姿势只参考动作。{job.creative ? "脚本决定镜头动作与节奏。" : "换元素的动作与节奏仍跟随原片。"}</p> : null}
            </Card>
            <Card title="场景">
                <ProductVideoImageSlot
                    slot="backgrounds"
                    hint={job.creative ? "场景光线、构图与环境参考" : undefined}
                    onPendingChange={(pending) => setUploads((value) => ({ ...value, backgrounds: pending }))}
                    items={job.backgrounds}
                    disabled={disabled}
                    onAdd={(images) => patchImages("backgrounds", (current) => [...current, ...images].slice(0, 3))}
                    onRemove={(id) => patchImages("backgrounds", (current) => current.filter((image) => image.id !== id))}
                />
                {!job.backgrounds.length ? <p className="rw-hint">{job.creative ? "没有场景参考时按脚本与视觉风格设计环境。" : "换元素沿用参考视频的场景；跨段人物、商品与色调以确认后的目标定妆图为基准。"}</p> : null}
            </Card>
            {job.source ? <RemakeContinuityCard job={job} config={config} disabled={disabled || uploading} flush={flush} onBusyChange={(continuity) => setUploads((value) => ({ ...value, continuity }))} /> : null}
            <Card title="口播">
                <SegmentedControl<RemakeAudio>
                    ariaLabel="口播"
                    value={job.audio}
                    block
                    size="sm"
                    disabled={disabled}
                    onChange={(audio) => edit((value) => ({ ...value, audio }))}
                    options={REMAKE_AUDIOS.filter((value) => !(job.creative || job.replication) || value !== "original").map((value) => ({
                        value,
                        label: job.creative && value === "rewrite" ? "原生口播" : REMAKE_AUDIO_LABEL[value],
                        disabled: value === "original" && !job.source?.hasAudio,
                    }))}
                />
                <p className="rw-hint">{job.creative && job.audio === "rewrite" ? "按脚本生成口播与人物口型，需要支持声音的视频模型。" : AUDIO_HINT[job.audio]}</p>
                {remakeWritesDialogue(job.audio) ? <RemakeLanguageField job={job} edit={edit} disabled={disabled} /> : null}
                {job.audio === "voice" ? <RemakeVoiceFields job={job} config={config} edit={edit} disabled={disabled} /> : null}
                {job.audio === "rewrite" ? <RemakeVoiceReference job={job} edit={edit} disabled={disabled} onBusyChange={(voice) => setUploads((value) => ({ ...value, voice }))} /> : null}
                {job.audio === "rewrite" && typeof limits !== "string" && !limits.generateAudio ? <p className="rw-warn">所选视频模型不能生成声音，换一个能出声的模型，或改用「统一旁白」。</p> : null}
            </Card>
            <RemakeFinishCard job={job} edit={edit} disabled={disabled} />
            <Card title="生成设置">
                <div className="rw-fields">
                    <fieldset disabled={disabled} className="rw-model-field">
                        <ModelPicker
                            config={config}
                            capability="video"
                            value={job.model}
                            onChange={(model) => edit((value) => ({ ...value, model, ratio: "", resolution: "" }))}
                            fullWidth
                            showSelectedPrice={false}
                            placeholder="选择复刻视频模型"
                            modelFilter={(model) => typeof remakeLimitsFor(config, model, job.shots) !== "string"}
                            modelDisabledReason={(model) => {
                                const value = remakeLimitsFor(config, model, job.shots);
                                return typeof value !== "string" && imageCount > value.maxImages ? `一次最多参考 ${value.maxImages} 张图` : "";
                            }}
                        />
                    </fieldset>
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
            {!job.creative ? (
                <label className="rw-auth" data-required={needsAuth || undefined}>
                    <Checkbox checked={job.authorized} disabled={disabled} onChange={(event) => edit((value) => ({ ...value, authorized: event.target.checked }))} />
                    <span>
                        我对原片有使用授权
                        <small>保留原片画面、原人物或原声时需要。只借结构不用原片内容时不用勾。</small>
                    </span>
                </label>
            ) : null}
            {persona ? <RemakePersonaModal config={config} left={3 - job.models.length} onClose={() => setPersona(false)} onAdd={(image) => patchImages("models", (current) => addRemakeModels(current, [image]))} /> : null}
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

function ShotRow({ shot, audio, language, disabled, edit, creative, reference }: { shot: RemakeShot; audio: RemakeAudio; language: RemakeLanguage; disabled?: boolean; edit: RemakeEdit; creative?: boolean; reference?: boolean }) {
    const patch = (next: Partial<RemakeShot>) => edit((value) => ({ ...value, shots: value.shots.map((item) => (item.index === shot.index ? { ...item, ...next } : item)) }));
    const budget = remakeDialogueBudget(shot, language);
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
                {shot.treatment === "remake" ? <ReplicaShotDirector shot={{ shotNumber: shot.index, director: shot.director }} disabled={disabled} onChange={(director) => patch({ director })} /> : null}
                <SegmentedControl<RemakeTreatment>
                    ariaLabel={`镜头 ${shot.index} 的做法`}
                    size="sm"
                    value={shot.treatment}
                    disabled={disabled}
                    onChange={(treatment) => patch({ treatment })}
                    options={REMAKE_TREATMENTS.filter((value) => (reference ? value === "remake" : !creative || value === "remake" || value === "skip")).map((value) => ({
                        value,
                        label: `${TREATMENT_SHORT[value]}${value === shot.recommended ? " ·荐" : ""}`,
                        title: REMAKE_TREATMENT_HINT[value],
                    }))}
                />
                {reason ? <span className="rw-shot-reason">{reason}</span> : null}
            </div>
            <div className="rw-shot-voice">
                {!creative ? shot.originalDialogue ? <span className="rw-shot-original">原：{shot.originalDialogue}</span> : <span className="rw-shot-original">原片这一镜没有口播</span> : null}
                {remakeWritesDialogue(audio) && shot.treatment !== "skip" ? (
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
                            {shot.speaker && audio === "rewrite" ? "对口型 · " : ""}
                            {length}/{budget} {language === "zh" ? "字" : "字符"}
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
                    {remakeWritesDialogue(job.audio) && !job.creative ? (
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
                    <ShotRow key={shot.index} shot={shot} audio={job.audio} language={job.language} disabled={disabled} edit={edit} creative={Boolean(job.creative)} reference={Boolean(job.replication)} />
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
