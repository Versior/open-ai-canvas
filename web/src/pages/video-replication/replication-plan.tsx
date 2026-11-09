import { App, Button, Checkbox, Input, Select } from "antd";
import { ArrowRight, Check, Clapperboard, ExternalLink, ImagePlus, LoaderCircle, RotateCcw, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { ModelPicker } from "@/components/model-picker";
import { addReplicaCanvas, applyReplicaScript, REPLICA_LIMITS, REPLICA_TREATMENTS, replicaPlanIssues, resetReplicaShot, type ReplicaShotPlan, type ReplicaShotTreatment, type VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import { formatTeardownTime, teardownTimeRange, videoTeardownProductLabel, videoTeardownTextRequirements, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getActiveUserScope } from "@/lib/user-scope";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { uploadImage } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { replicaScriptModelError, rewriteReplicaScripts } from "./replication-script";
import type { ReplicaPlanSaveState } from "./use-replica-plan";
import { ReplicaCampaignEditor, ReplicaShotDirector, ReplicaStrategyView } from "./replication-director";

const MAX_PRODUCT_BYTES = 20 * 1024 * 1024;
const CHARS_PER_SECOND = 5;

type Props = {
    bundle: VideoTeardownBundle;
    analysis: VideoTeardownAnalysis & { model: string };
    plan: VideoReplicaPlan;
    update: (change: (current: VideoReplicaPlan) => VideoReplicaPlan) => void;
    save: ReplicaPlanSaveState;
    flush: () => Promise<boolean>;
    config: AiConfig;
    model: string;
    onModelChange: (model: string) => void;
    opening: boolean;
    /** 按方案新建画布；成功返回画布 ID 和标题，失败时已提示，返回 null。 */
    onOpenCanvas: (plan: VideoReplicaPlan) => Promise<{ id: string; title: string } | null>;
};

const STEPS = [
    { id: "vr-plan-product", label: "商品档案" },
    { id: "vr-plan-script", label: "改写脚本" },
    { id: "vr-plan-shots", label: "逐镜计划" },
];

/**
 * 复刻方案：商品档案 → 按商品改写口播（多个版本挑一个）→ 逐镜决定怎么做、改台词和提示词。
 * 整页滚动，左侧小节导航吸顶；改动自动保存到服务端。做完点「下一步」去画布生成。
 */
export function ReplicationPlan(props: Props & { onNext: () => void }) {
    const { plan, save } = props;
    const issues = useMemo(() => replicaPlanIssues(plan), [plan]);
    const done = [Boolean(plan.product.name || plan.product.images.length), Boolean(plan.activeScriptId), plan.shots.some((shot) => shot.treatment !== "skip") && !issues.errors.length];
    return (
        <div className="vr-plan">
            <nav className="vr-plan-rail" aria-label="复刻方案的小节">
                <ol>
                    {STEPS.map((step, index) => (
                        <li key={step.id}>
                            <button type="button" className="vr-plan-step" data-done={done[index] || undefined} onClick={() => document.getElementById(step.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                                <span className="vr-plan-step-index">{done[index] ? <Check aria-hidden /> : index + 1}</span>
                                {step.label}
                            </button>
                        </li>
                    ))}
                </ol>
                <SaveStatus save={save} onRetry={() => void props.flush()} />
            </nav>
            <div className="vr-plan-main">
                <ProductSection {...props} />
                <ReplicaCampaignEditor plan={plan} bundle={props.bundle} onChange={(campaign) => props.update((current) => ({ ...current, campaign }))} />
                <ScriptSection {...props} />
                <ShotsSection {...props} />
                <div className="vr-plan-next">
                    <span className="vr-plan-muted">{issues.errors[0] || "方案会自动保存。下一步按这份方案建画布，在画布里出首帧和视频。"}</span>
                    <Button type="primary" size="large" disabled={Boolean(issues.errors.length)} onClick={props.onNext}>
                        下一步：画布生成
                        <ArrowRight className="size-4" aria-hidden />
                    </Button>
                </div>
            </div>
        </div>
    );
}

function SaveStatus({ save, onRetry }: { save: ReplicaPlanSaveState; onRetry: () => void }) {
    if (save.status === "saving")
        return (
            <p className="vr-plan-save" role="status">
                <LoaderCircle className="animate-spin" aria-hidden /> 正在保存
            </p>
        );
    if (save.status === "error")
        return (
            <div className="vr-plan-save" data-tone="error" role="alert">
                <p>{save.error || "保存失败"}</p>
                <Button size="small" onClick={onRetry}>
                    重新保存
                </Button>
            </div>
        );
    return (
        <p className="vr-plan-save" role="status">
            {save.status === "saved" ? "方案已保存" : "改动会自动保存"}
        </p>
    );
}

function Section({ id, index, title, description, children, extra }: { id: string; index: number; title: string; description: string; children: ReactNode; extra?: ReactNode }) {
    return (
        <section id={id} className="vr-panel vr-plan-section" aria-labelledby={`${id}-title`}>
            <header className="vr-plan-section-head">
                <div>
                    <h2 id={`${id}-title`} className="vr-plan-section-title">
                        <span>{index}</span>
                        {title}
                    </h2>
                    <p className="vr-plan-section-text">{description}</p>
                </div>
                {extra}
            </header>
            {children}
        </section>
    );
}

function ProductSection({ plan, update }: Props) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(0);
    const { product } = plan;
    const setProduct = (patch: Partial<VideoReplicaPlan["product"]>) => update((current) => ({ ...current, product: { ...current.product, ...patch } }));

    const addFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const accepted = images.filter((file) => file.size <= MAX_PRODUCT_BYTES).slice(0, Math.max(REPLICA_LIMITS.images - product.images.length - uploading, 0));
        if (images.length > accepted.length) message.info(`商品图最多 ${REPLICA_LIMITS.images} 张，每张不超过 20 MB`);
        for (const file of accepted) {
            setUploading((count) => count + 1);
            try {
                const uploaded = await uploadImage(file);
                const resourceId = resourceIdFromStorageKey(uploaded.storageKey);
                if (uploaded.pendingRemoteUpload || !resourceId) throw new Error(uploaded.remoteUploadError || "没有传到服务器");
                update((current) =>
                    current.product.images.length >= REPLICA_LIMITS.images
                        ? current
                        : { ...current, product: { ...current.product, images: [...current.product.images, { resourceId, width: uploaded.width, height: uploaded.height, mimeType: uploaded.mimeType, bytes: uploaded.bytes }] } },
                );
            } catch (error) {
                message.error(`${file.name} 上传失败：${error instanceof Error ? error.message : "请重试"}`);
            } finally {
                setUploading((count) => count - 1);
            }
        }
    };

    return (
        <Section id="vr-plan-product" index={1} title="商品档案" description="写清楚卖什么。改写脚本只用这里的卖点，不会替你编功效；商品图用来生成换商品镜头的首帧。">
            <div className="vr-plan-product">
                <div className="vr-plan-fields">
                    <label className="vr-plan-field">
                        <span>商品名称</span>
                        <Input value={product.name} maxLength={REPLICA_LIMITS.productName} placeholder="例如：316 不锈钢保温杯 500ml" onChange={(event) => setProduct({ name: event.target.value })} />
                    </label>
                    <label className="vr-plan-field">
                        <span>外观</span>
                        <Input value={product.look} maxLength={REPLICA_LIMITS.look} placeholder="例如：奶白色磨砂杯身、木纹杯盖、杯身印着品牌字" onChange={(event) => setProduct({ look: event.target.value })} />
                    </label>
                    <label className="vr-plan-field">
                        <span>卖点（一行一条）</span>
                        <Input.TextArea
                            value={product.sellingPoints}
                            maxLength={REPLICA_LIMITS.sellingPoints}
                            autoSize={{ minRows: 3, maxRows: 6 }}
                            placeholder={"保温 12 小时\n一只手就能开盖\n杯盖可以拆洗"}
                            onChange={(event) => setProduct({ sellingPoints: event.target.value })}
                        />
                    </label>
                    <label className="vr-plan-field">
                        <span>目标人群</span>
                        <Input value={product.audience} maxLength={REPLICA_LIMITS.audience} placeholder="例如：通勤上班族、学生" onChange={(event) => setProduct({ audience: event.target.value })} />
                    </label>
                </div>
                <div className="vr-plan-images">
                    <p className="vr-plan-field-label">商品实拍图</p>
                    <div className="vr-dialog-products">
                        {product.images.map((image) => (
                            <figure key={image.resourceId} className="vr-dialog-product">
                                <img src={resourceFileUrl(image.resourceId)} alt="商品图" />
                                <button type="button" aria-label="移除这张商品图" onClick={() => setProduct({ images: product.images.filter((item) => item.resourceId !== image.resourceId) })}>
                                    <X aria-hidden />
                                </button>
                            </figure>
                        ))}
                        {Array.from({ length: uploading }, (_, index) => (
                            <span key={`uploading-${index}`} className="vr-dialog-product vr-plan-uploading" role="status">
                                <LoaderCircle className="animate-spin" aria-hidden />
                                <span className="sr-only">正在上传</span>
                            </span>
                        ))}
                        {product.images.length + uploading < REPLICA_LIMITS.images ? (
                            <button type="button" className="vr-dialog-add" onClick={() => inputRef.current?.click()}>
                                <ImagePlus aria-hidden />
                                <span>{product.images.length ? "再加一张" : "上传商品图"}</span>
                            </button>
                        ) : null}
                    </div>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(event) => {
                            void addFiles(event.target.files);
                            event.target.value = "";
                        }}
                    />
                    <p className="vr-dialog-hint">用实拍照片：AI 画不出你的真品，包装上的字也画不准。正面一张、细节一张效果最好。</p>
                </div>
            </div>
        </Section>
    );
}

function ScriptSection({ bundle, analysis, plan, update, config, model, onModelChange }: Props) {
    const { message } = App.useApp();
    const [count, setCount] = useState(3);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const modelError = replicaScriptModelError(config, model);
    const ready = Boolean(plan.product.name || plan.product.sellingPoints);

    const run = async () => {
        if (running || modelError) return;
        if (!ready) {
            message.warning("先在商品档案里写商品名称或卖点");
            return;
        }
        const current = new AbortController();
        controller.current = current;
        setRunning(true);
        setError("");
        try {
            const scripts = await rewriteReplicaScripts(bundle, analysis, plan, { config, model, count, signal: current.signal, expectedScope: getActiveUserScope() });
            update((latest) => ({ ...latest, scripts: [...scripts, ...latest.scripts].slice(0, REPLICA_LIMITS.scripts) }));
        } catch (caught) {
            if (!current.signal.aborted) setError(caught instanceof Error ? caught.message : "改写失败");
        } finally {
            if (controller.current === current) controller.current = null;
            setRunning(false);
        }
    };

    return (
        <Section
            id="vr-plan-script"
            index={2}
            title="改写脚本"
            description={
                plan.campaign
                    ? "保持逐镜时长，为新商品重新策划首帧、动作和口播。一次比较几个切入角度，选用后一起更新逐镜方案。"
                    : "保留原片的镜头数、节拍和每镜时长，把口播和画面字改成卖你的商品。一次出几个不同角度的版本，挑一个用；用了以后还能在逐镜计划里逐句改。"
            }
        >
            <div className="vr-plan-script-bar">
                <div className="vr-plan-script-model">
                    <ModelPicker config={config} capability="text" value={model} onChange={onModelChange} requirements={videoTeardownTextRequirements(config, 0)} fullWidth placeholder="选择文本模型" />
                </div>
                <Select value={count} onChange={setCount} aria-label="版本数" options={[2, 3, 4].map((value) => ({ value, label: `${value} 个版本` }))} disabled={running} style={{ width: 112 }} />
                <Button type="primary" icon={<Sparkles className="size-4" />} loading={running} disabled={Boolean(modelError)} onClick={() => void run()}>
                    {plan.scripts.length ? "再改写一批" : "开始改写"}
                </Button>
                <span className="vr-plan-muted">按所选模型计费</span>
            </div>
            {modelError ? <p className="vr-field-error">{modelError}</p> : null}
            {error ? (
                <p role="alert" className="vr-field-error">
                    {error}
                </p>
            ) : null}
            {plan.scripts.length ? (
                <ul className="vr-plan-scripts">
                    {plan.scripts.map((script) => {
                        const active = script.id === plan.activeScriptId;
                        return (
                            <li key={script.id} className="vr-plan-script" data-active={active || undefined}>
                                <div className="vr-plan-script-head">
                                    <strong>{script.angle}</strong>
                                    {active ? <span className="vr-plan-pill">正在用</span> : null}
                                    <button
                                        type="button"
                                        className="vr-plan-icon"
                                        aria-label={`删除版本「${script.angle}」`}
                                        onClick={() => update((current) => ({ ...current, scripts: current.scripts.filter((item) => item.id !== script.id), activeScriptId: current.activeScriptId === script.id ? "" : current.activeScriptId }))}
                                    >
                                        <Trash2 aria-hidden />
                                    </button>
                                </div>
                                {script.hook ? <p className="vr-plan-script-hook">{script.hook}</p> : null}
                                {script.strategy ? (
                                    <details>
                                        <summary>查看全片策划与选法依据</summary>
                                        <ReplicaStrategyView strategy={script.strategy} />
                                    </details>
                                ) : null}
                                <ol className="vr-plan-script-lines">
                                    {script.lines.map((line) => (
                                        <li key={line.shotNumber}>
                                            <span>{line.shotNumber}</span>
                                            <p>{line.dialogue || <em>（不说话）</em>}</p>
                                        </li>
                                    ))}
                                </ol>
                                <Button
                                    type={active ? "default" : "primary"}
                                    ghost={!active}
                                    disabled={active}
                                    onClick={() => {
                                        update((current) => applyReplicaScript(current, script));
                                        message.success(`已用「${script.angle}」的口播和画面字`);
                                    }}
                                >
                                    {active ? "已用这个版本" : "用这个版本"}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className="vr-plan-empty">还没有改写版本。不改写也可以，直接在逐镜计划里自己写口播。</p>
            )}
        </Section>
    );
}

function ShotsSection({ bundle, analysis, plan, update }: Props) {
    const rows = useMemo(() => new Map(analysis.rows.map((row) => [row.shotNumber, row])), [analysis.rows]);
    const setShot = (shotNumber: number, patch: Partial<ReplicaShotPlan>) => update((current) => ({ ...current, shots: current.shots.map((shot) => (shot.shotNumber === shotNumber ? { ...shot, ...patch } : shot)) }));
    const setAll = (from: (shot: ReplicaShotPlan) => boolean, treatment: ReplicaShotTreatment) => update((current) => ({ ...current, shots: current.shots.map((shot) => (from(shot) ? { ...shot, treatment } : shot)) }));
    const counts = Object.fromEntries(REPLICA_TREATMENTS.map((item) => [item.value, plan.shots.filter((shot) => shot.treatment === item.value).length])) as Record<ReplicaShotTreatment, number>;

    return (
        <Section
            id="vr-plan-shots"
            index={3}
            title="逐镜计划"
            description="每一镜决定怎么做，口播和画面字可以直接改。左边是原片，右边是复刻版。"
            extra={
                <div className="vr-plan-bulk">
                    <Button size="small" onClick={() => setAll((shot) => shot.treatment !== "skip", "remake")}>
                        全部按描述重做
                    </Button>
                    <Button size="small" disabled={!plan.authorized} title={plan.authorized ? undefined : "先勾选下面的授权确认"} onClick={() => setAll((shot) => shot.treatment === "remake", "original")}>
                        没商品的镜头沿用原片
                    </Button>
                </div>
            }
        >
            <Checkbox
                className="vr-plan-auth"
                checked={plan.authorized}
                onChange={(event) =>
                    update((current) => ({ ...current, authorized: event.target.checked, shots: event.target.checked ? current.shots : current.shots.map((shot) => (shot.treatment === "original" ? { ...shot, treatment: "remake" } : shot)) }))
                }
            >
                这是我自己的视频，或者我已获得原作者授权（勾选后才能沿用原片画面；换商品的镜头会保持原片构图）
            </Checkbox>
            <p className="vr-plan-counts">
                {REPLICA_TREATMENTS.filter((item) => counts[item.value]).map((item) => (
                    <span key={item.value} data-treatment={item.value}>
                        {item.label} {counts[item.value]}
                    </span>
                ))}
            </p>
            <ol className="vr-plan-shots">
                {plan.shots.map((shot) => {
                    const source = bundle.shots[shot.shotNumber - 1];
                    const row = rows.get(shot.shotNumber);
                    const seconds = source ? Math.max(1, Math.round((source.endMs - source.startMs) / 1000)) : 0;
                    const limit = seconds * CHARS_PER_SECOND;
                    const over = Boolean(limit) && shot.dialogue.length > limit;
                    const productLabel = videoTeardownProductLabel(row);
                    const skipped = shot.treatment === "skip";
                    return (
                        <li key={shot.shotNumber} className="vr-plan-shot" data-skip={skipped || undefined}>
                            <div className="vr-plan-shot-source">
                                {source ? <img src={resourceFileUrl(source.keyframeResourceId)} alt={`镜头 ${shot.shotNumber} 原片关键帧`} loading="lazy" /> : null}
                                <div className="vr-plan-shot-copy">
                                    <p className="vr-plan-shot-title">
                                        镜头 {shot.shotNumber}
                                        <span>{source ? `${teardownTimeRange(source)} · ${seconds} 秒` : ""}</span>
                                    </p>
                                    <p className="vr-plan-shot-plot">{row?.plotDescription || "（没有画面描述）"}</p>
                                    {row?.dialogue ? <p className="vr-plan-shot-orig">原口播：{row.dialogue}</p> : null}
                                    {productLabel ? <p className="vr-plan-shot-orig">原片商品：{productLabel}</p> : null}
                                </div>
                            </div>
                            <div className="vr-plan-shot-edit">
                                {!skipped ? <ReplicaShotDirector shot={shot} onChange={(director) => setShot(shot.shotNumber, { director })} /> : null}
                                <div className="vr-plan-shot-tools">
                                    <Select
                                        size="small"
                                        value={shot.treatment}
                                        aria-label={`镜头 ${shot.shotNumber} 怎么做`}
                                        style={{ width: 148 }}
                                        onChange={(treatment: ReplicaShotTreatment) => setShot(shot.shotNumber, { treatment })}
                                        options={REPLICA_TREATMENTS.map((item) => ({ value: item.value, label: item.label, title: item.hint, disabled: item.value === "original" && !plan.authorized }))}
                                    />
                                    <button type="button" className="vr-plan-link" onClick={() => setShot(shot.shotNumber, resetReplicaShot(shot, row))}>
                                        <RotateCcw aria-hidden />
                                        改回原样
                                    </button>
                                </div>
                                {skipped ? (
                                    <p className="vr-plan-muted">这一镜不放进画布。</p>
                                ) : (
                                    <>
                                        <label className="vr-plan-field">
                                            <span>
                                                口播
                                                {limit ? (
                                                    <em data-over={over || undefined}>
                                                        {shot.dialogue.length}/{limit} 字
                                                    </em>
                                                ) : null}
                                            </span>
                                            <Input.TextArea
                                                value={shot.dialogue}
                                                maxLength={REPLICA_LIMITS.dialogue}
                                                autoSize={{ minRows: 1, maxRows: 4 }}
                                                placeholder="这一镜不说话就留空"
                                                onChange={(event) => setShot(shot.shotNumber, { dialogue: event.target.value })}
                                            />
                                        </label>
                                        <label className="vr-plan-field">
                                            <span>画面字</span>
                                            <Input value={shot.onScreenText} maxLength={REPLICA_LIMITS.onScreenText} placeholder="标题、卖点花字，没有就留空" onChange={(event) => setShot(shot.shotNumber, { onScreenText: event.target.value })} />
                                        </label>
                                        <details className="vr-plan-prompts">
                                            <summary>首帧和视频提示词</summary>
                                            <label className="vr-plan-field">
                                                <span>{shot.treatment === "original" ? "首帧（沿用原片，不用生成）" : "首帧"}</span>
                                                <Input.TextArea
                                                    value={shot.imagePrompt}
                                                    maxLength={REPLICA_LIMITS.prompt}
                                                    autoSize={{ minRows: 2, maxRows: 8 }}
                                                    disabled={shot.treatment === "original"}
                                                    onChange={(event) => setShot(shot.shotNumber, { imagePrompt: event.target.value })}
                                                />
                                            </label>
                                            <label className="vr-plan-field">
                                                <span>视频</span>
                                                <Input.TextArea value={shot.videoPrompt} maxLength={REPLICA_LIMITS.prompt} autoSize={{ minRows: 2, maxRows: 8 }} onChange={(event) => setShot(shot.shotNumber, { videoPrompt: event.target.value })} />
                                            </label>
                                        </details>
                                    </>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </Section>
    );
}

/**
 * 第三步「画布生成」：按方案建画布，列出之前按这条拆解建过的画布。
 * 新建的画布记进方案（只记 ID、标题和时间），保存后再跳过去。
 */
export function ReplicationCanvasStep({ bundle, plan, update, opening, flush, onOpenCanvas, onBack }: Props & { onBack: () => void }) {
    const navigate = useNavigate();
    const issues = useMemo(() => replicaPlanIssues(plan), [plan]);
    const kept = plan.shots.filter((shot) => shot.treatment !== "skip");
    const duration = kept.reduce((total, shot) => {
        const source = bundle.shots[shot.shotNumber - 1];
        return total + (source ? source.endMs - source.startMs : 0);
    }, 0);
    const count = (treatment: ReplicaShotTreatment) => kept.filter((shot) => shot.treatment === treatment).length;
    // 方案没存上（网络问题）也照样建画布：画布按页面上的方案铺，保存失败在页面上照实提示，可以重试。
    const create = async () => {
        await flush();
        const created = await onOpenCanvas(plan);
        if (!created) return;
        update((current) => addReplicaCanvas(current, { id: created.id, title: created.title, createdAt: new Date().toISOString(), shots: kept.length }));
        await flush();
        navigate(`/canvas/${created.id}`);
    };
    return (
        <div className="vr-canvas-step">
            <section className="vr-panel vr-plan-section" aria-labelledby="vr-canvas-new-title">
                <header className="vr-plan-section-head">
                    <div>
                        <h2 id="vr-canvas-new-title" className="vr-plan-section-title">
                            按方案新建画布
                        </h2>
                        <p className="vr-plan-section-text">画布里放原视频、关键帧、复刻分镜、商品图和拆解报告。在复刻分镜的「更多」里先「生成未完成分镜图」做首帧，检查后「生成未完成视频」，最后「合并成片」。</p>
                    </div>
                    <Button onClick={onBack}>检查方案</Button>
                </header>
                <dl className="vr-plan-summary">
                    <div>
                        <dt>镜头</dt>
                        <dd>
                            {kept.length} / {bundle.shots.length}
                        </dd>
                    </div>
                    <div>
                        <dt>成片约</dt>
                        <dd>{formatTeardownTime(duration)}</dd>
                    </div>
                    <div>
                        <dt>换商品</dt>
                        <dd>{count("product")} 镜</dd>
                    </div>
                    <div>
                        <dt>按描述重做</dt>
                        <dd>{count("remake")} 镜</dd>
                    </div>
                    <div>
                        <dt>沿用原片</dt>
                        <dd>{count("original")} 镜</dd>
                    </div>
                </dl>
                {[...issues.errors, ...issues.warnings].length ? (
                    <ul className="vr-plan-issues">
                        {issues.errors.map((item) => (
                            <li key={item} data-tone="error">
                                <TriangleAlert aria-hidden />
                                {item}
                            </li>
                        ))}
                        {issues.warnings.map((item) => (
                            <li key={item}>
                                <TriangleAlert aria-hidden />
                                {item}
                            </li>
                        ))}
                    </ul>
                ) : null}
                <div className="vr-plan-canvas-actions">
                    <Button type="primary" size="large" icon={<Clapperboard className="size-4" />} loading={opening} disabled={Boolean(issues.errors.length)} onClick={() => void create()}>
                        创建画布并打开
                    </Button>
                    <span className="vr-plan-muted">创建画布不扣费；在画布里生成首帧和视频时按所选模型计费。</span>
                </div>
            </section>
            <section className="vr-panel vr-plan-section" aria-labelledby="vr-canvas-list-title">
                <header className="vr-plan-section-head">
                    <div>
                        <h2 id="vr-canvas-list-title" className="vr-plan-section-title">
                            建过的画布
                        </h2>
                        <p className="vr-plan-section-text">每次创建都是一块新画布，之前的不会被覆盖。在画布里删掉的画布，这里的链接会打不开。</p>
                    </div>
                </header>
                {plan.canvases.length ? (
                    <ul className="vr-canvas-list">
                        {plan.canvases.map((canvas) => (
                            <li key={canvas.id}>
                                <span className="vr-canvas-list-copy">
                                    <strong>{canvas.title || "复刻画布"}</strong>
                                    <small>
                                        {canvas.createdAt ? <RelativeTime value={canvas.createdAt} /> : null}
                                        {canvas.shots ? <span>{canvas.shots} 镜</span> : null}
                                    </small>
                                </span>
                                <Button icon={<ExternalLink className="size-4" />} onClick={() => navigate(`/canvas/${canvas.id}`)}>
                                    打开
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="vr-plan-empty">还没有按这份方案建过画布。</p>
                )}
            </section>
        </div>
    );
}
