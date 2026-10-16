import { ChevronDown, Clapperboard, Film, LoaderCircle, ShieldAlert, Trash2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { EcommerceNodeTitle } from "./canvas-ecommerce-node-title";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import {
    ECOMMERCE_VIDEO_KINDS,
    ECOMMERCE_VIDEO_LANGUAGES,
    ECOMMERCE_VIDEO_MOTIONS,
    ECOMMERCE_VIDEO_SPECS,
    createEcommerceVideo,
    createEcommerceVideoShot,
    ecommerceVideoBlocked,
    ecommerceVideoFirstFrameRule,
    ecommerceVideoIssues,
    ecommerceVideoPrompt,
    ecommerceVideoSeconds,
    ecommerceVideoShotsFromImages,
    ecommerceVideoSpec,
    type EcommerceVideo,
    type EcommerceVideoKind,
    type EcommerceVideoLanguage,
    type EcommerceVideoMotion,
    type EcommerceVideoPlatform,
} from "@/lib/ecommerce/ecommerce-video";
import {
    ECOMMERCE_VIDEO_REPLICA_ASPECTS,
    ECOMMERCE_VIDEO_REPLICA_MODES,
    ECOMMERCE_VIDEO_REPLICA_NEVER,
    buildEcommerceVideoTeardownPrompt,
    createEcommerceVideoReplica,
    ecommerceVideoReplicaBeatCount,
    type EcommerceVideoReplica,
    type EcommerceVideoReplicaAspect,
    type EcommerceVideoReplicaMode,
} from "@/lib/ecommerce/ecommerce-video-replica";
import { ECOMMERCE_VIDEO_TEMPLATES, ecommerceVideoTemplate, ecommerceVideoTemplateBeats } from "@/lib/ecommerce/ecommerce-video-templates";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import "./canvas-ecommerce-node-card.css";

type EcommerceVideoNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

function isImageNode(node: CanvasNodeData) {
    return getNodeResourceKind(node) === "image" && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

/** 视频素材：视频节点也行——复刻的参考片就是一段视频。 */
function isVideoNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.content || node.metadata?.storageKey);
}

/**
 * 电商视频节点——把一套图编排成片。
 *
 * 卡片主体是**时间轴**：每格一个镜头，格宽按秒数分配，扫一眼就知道节奏对不对。
 * 图片看单张，视频看节奏，而节奏只能靠时间轴表达。
 *
 * 三块能力按「从省事到费力」排：
 * - **模板库**：八种跑通的结构（痛点解决/开箱/演示/口播/UGC/反应/短剧/TVC），
 *   点一下就铺成镜头表。视频的成败在结构，只给一个「痛点风格」的标签没用
 * - **复刻**：连一段爆款视频，拆它的节奏与切点，换自己的商品
 * - **自己排**：逐镜调时长、运镜、字幕
 */
export function EcommerceVideoNodeContent({ node, theme }: EcommerceVideoNodeContentProps) {
    const { updateMetadata, reversePromptFromNode, generateEcommerceNode } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id);
    const [editing, setEditing] = useState(false);
    const [activeShotId, setActiveShotId] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const video: EcommerceVideo = node.metadata?.ecommerceVideo || createEcommerceVideo(node.title || "未命名视频");
    const editable = Boolean(updateMetadata);
    const images = upstream.filter(isImageNode);
    const referenceVideo = upstream.find(isVideoNode);
    const spec = ecommerceVideoSpec(video.platform);
    const seconds = ecommerceVideoSeconds(video);
    const issues = ecommerceVideoIssues(video);
    const blocked = ecommerceVideoBlocked(issues);
    const template = video.templateId ? ecommerceVideoTemplate(video.templateId as never) : undefined;
    const replica = video.replica;

    const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
    const usableShots = video.shots.filter((shot) => shot.imageNodeId);
    const activeShot = video.shots.find((shot) => shot.id === activeShotId) || usableShots[0];

    const patch = (next: Partial<EcommerceVideo>) => updateMetadata?.(node.id, { ecommerceVideo: { ...video, ...next } });
    const commitShots = (next: EcommerceVideo["shots"]) => patch({ shots: next });
    const patchShot = (id: string, next: Partial<EcommerceVideo["shots"][number]>) => commitShots(video.shots.map((shot) => (shot.id === id ? { ...shot, ...next } : shot)));
    const patchReplica = (next: Partial<EcommerceVideoReplica>) => patch({ replica: { ...(replica || createEcommerceVideoReplica(video.name)), ...next } });

    /** 应用模板：按骨架铺镜头，并把骨架的 purpose 写进字幕位。 */
    const applyTemplate = (templateId: string) => {
        const picked = ecommerceVideoTemplate(templateId as never);
        if (!picked) return;
        const beats = ecommerceVideoTemplateBeats(picked, video.platform, spec?.maxSeconds || 60);
        const shots = beats.map((beat, index) => ({
            ...createEcommerceVideoShot(images[index % Math.max(1, images.length)]?.id || ""),
            seconds: beat.seconds,
            motion: beat.motion as EcommerceVideoMotion,
            caption: beat.label,
        }));
        patch({ templateId, kind: picked.kind, shots });
        setActiveShotId(shots[0]?.id || null);
    };

    const totalWeight = Math.max(1, usableShots.reduce((total, shot) => total + Math.max(0.5, shot.seconds), 0));

    return (
        <div className="ecom-card" style={{ color: theme.node.text }}>
            <header className="ecom-card-header">
                <div className="ecom-card-kicker">
                    <span className="ecom-card-mark"><Film className="size-3.5" /></span>
                    <span>电商 / 视频</span>
                </div>
                <span className={blocked ? "ecom-card-status ecom-card-status-warn" : "ecom-card-status"}>
                    {seconds}s{spec ? ` / ${spec.maxSeconds}s` : ""}
                </span>
            </header>

            <EcommerceNodeTitle
                node={node}
                fallback="未命名视频"
                subtitle={`${template ? template.name : "自己排的"} · ${spec ? spec.name : "未选平台"} · ${usableShots.length} 镜`}
            />

            {usableShots.length ? (
                <div className="ecom-video-timeline" role="list" aria-label="镜头时间轴">
                    {usableShots.map((shot, index) => {
                        const image = imageById.get(shot.imageNodeId);
                        const motion = ECOMMERCE_VIDEO_MOTIONS.find((item) => item.id === shot.motion);
                        return (
                            <button
                                key={shot.id}
                                type="button"
                                role="listitem"
                                className="ecom-video-cell"
                                aria-pressed={activeShot?.id === shot.id}
                                style={{ flexGrow: Math.max(0.5, shot.seconds) / totalWeight }}
                                title={`第 ${index + 1} 镜 · ${shot.seconds}s · ${motion?.name || ""}${shot.caption ? ` · ${shot.caption}` : ""}`}
                                onClick={() => setActiveShotId(shot.id)}
                            >
                                {image?.metadata?.content
                                    ? <img src={image.metadata.content} alt="" draggable={false} />
                                    : <span className="ecom-video-cell-empty">{index + 1}</span>}
                                <span className="ecom-video-cell-meta">
                                    <span className="ecom-video-cell-index">{index + 1}</span>
                                    <span className="ecom-video-cell-seconds">{shot.seconds}s</span>
                                </span>
                                {shot.caption.trim() ? <span className="ecom-video-cell-caption">{shot.caption.trim()}</span> : null}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="ecom-card-stage">
                    <span className="ecom-card-stage-empty">
                        {images.length ? "还没有镜头——点「编排」选一个爆款结构，或自己排" : "连入一套图当镜头素材"}
                    </span>
                </div>
            )}

            {spec ? (
                <div className="ecom-video-gauge" title={`${seconds} / ${spec.maxSeconds} 秒`}>
                    <span className="ecom-video-gauge-fill" data-over={seconds > spec.maxSeconds ? "true" : "false"} style={{ width: `${Math.min(100, (seconds / spec.maxSeconds) * 100)}%` }} />
                    <span className="ecom-video-gauge-recommended" style={{ left: `${Math.min(100, (spec.recommendedSeconds / spec.maxSeconds) * 100)}%` }} title={`建议 ${spec.recommendedSeconds} 秒`} />
                </div>
            ) : null}

            {issues.length ? (
                <div className="ecom-info-issues">
                    {issues.slice(0, 2).map((issue, index) => (
                        <span key={index} className="ecom-card-subtitle" style={{ whiteSpace: "normal", color: issue.level === "block" ? "#d97706" : undefined }}>{issue.message}</span>
                    ))}
                </div>
            ) : null}

            {/* 主操作常驻可见，不折叠在「编排」里——出片是这个节点的目的，
                藏在展开区等于把主操作变成彩蛋。上游连进来的图就是镜头素材，
                会作为参考图一起送进去：项目里所有产出都是提示词走 API。 */}
            <div className="ecom-action-row">
                <button
                    type="button"
                    className="ecom-action ecom-action-primary"
                    disabled={!generateEcommerceNode || !usableShots.length || blocked || generating}
                    title={blocked ? "先解决上面的拦截项" : !usableShots.length ? "先铺镜头——点「编排」选一个爆款结构，或从这套图铺" : `把 ${usableShots.length} 个镜头编译成提示词，交给视频模型出片`}
                    onClick={async () => {
                        setGenerating(true);
                        try {
                            await generateEcommerceNode?.(node, "video", ecommerceVideoPrompt(video));
                        } finally {
                            setGenerating(false);
                        }
                    }}
                >
                    {generating ? <LoaderCircle className="size-3 animate-spin" /> : <Film className="size-3" />}
                    {generating ? "提交中…" : usableShots.length ? `生成成片（${seconds} 秒）` : "生成成片"}
                </button>
                {replica?.notes?.trim() ? <span className="ecom-card-status">已读复刻结构</span> : null}
            </div>

            {editing && editable ? (
                <div className="ecom-card-editor">
                    {/* 模板库：每种模板先给结构，再给名字。视频的成败在结构 */}
                    <div className="ecom-field">
                        <span className="ecom-field-label">爆款结构 · 点一下铺成镜头</span>
                        <div className="ecom-video-templates">
                            {ECOMMERCE_VIDEO_TEMPLATES.map((item) => {
                                const beats = ecommerceVideoTemplateBeats(item, video.platform, spec?.maxSeconds || 60);
                                const total = beats.reduce((sum, beat) => sum + beat.seconds, 0);
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="ecom-video-template"
                                        aria-pressed={video.templateId === item.id}
                                        title={`${item.hint}\n\n靠什么起作用：${item.logic}\n素材要求：${item.needs}`}
                                        onClick={() => applyTemplate(item.id)}
                                    >
                                        <span className="ecom-video-template-head">
                                            <span className="ecom-video-template-name">{item.name}</span>
                                            <span className="ecom-video-template-seconds">{Math.round(total)}s</span>
                                        </span>
                                        {/* 结构条：每段的宽度按时长分配，一眼看出节奏 */}
                                        <span className="ecom-video-template-beats" aria-hidden>
                                            {beats.map((beat, index) => (
                                                <span key={index} className="ecom-video-template-beat" style={{ flexGrow: beat.seconds }} title={`${beat.label} · ${beat.seconds}s · ${beat.purpose}`} />
                                            ))}
                                        </span>
                                        <span className="ecom-video-template-labels" aria-hidden>
                                            {beats.map((beat, index) => <span key={index}>{beat.label}</span>)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 复刻：连一段爆款视频，拆它的节奏与切点 */}
                    <div className="ecom-field">
                        <span className="ecom-field-label">爆款视频复刻</span>
                        {referenceVideo ? (
                            <>
                                <div className="ecom-video-replica-source">
                                    <Clapperboard className="size-3.5" />
                                    <span>{referenceVideo.title || "参考视频"}</span>
                                    {replica ? <span className="ecom-card-status">{ecommerceVideoReplicaBeatCount(replica) || 0} 段已读</span> : null}
                                </div>
                                <div className="ecom-chip-row">
                                    {ECOMMERCE_VIDEO_REPLICA_MODES.map((mode) => (
                                        <button key={mode.id} type="button" className="ecom-chip" aria-pressed={(replica?.mode || "structure-only") === mode.id} title={mode.hint} onClick={() => patchReplica({ mode: mode.id as EcommerceVideoReplicaMode })}>
                                            {mode.name}
                                        </button>
                                    ))}
                                </div>
                                <div className="ecom-chip-row">
                                    {ECOMMERCE_VIDEO_REPLICA_ASPECTS.map((aspect) => (
                                        <button
                                            key={aspect.id}
                                            type="button"
                                            className="ecom-chip"
                                            aria-pressed={(replica?.aspects || []).includes(aspect.id)}
                                            title={aspect.hint}
                                            onClick={() => {
                                                const current = replica?.aspects || [];
                                                patchReplica({ aspects: current.includes(aspect.id) ? current.filter((item) => item !== aspect.id) : [...current, aspect.id as EcommerceVideoReplicaAspect] });
                                            }}
                                        >
                                            {aspect.label}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    className="ecom-action ecom-action-primary"
                                    onClick={() => reversePromptFromNode?.(referenceVideo, buildEcommerceVideoTeardownPrompt({ aspects: replica?.aspects }))}
                                >
                                    <Wand2 className="size-3" />
                                    拆解这段视频的结构
                                </button>
                                <textarea
                                    className="ecom-field-input thin-scrollbar"
                                    rows={3}
                                    value={replica?.notes || ""}
                                    placeholder="结构笔记：第 1–3 秒痛点，第 3 秒切商品，第 4–8 秒演示…"
                                    onChange={(event) => patchReplica({ notes: event.target.value })}
                                />
                                <div className="ecom-replica-never">
                                    <span className="ecom-replica-never-title"><ShieldAlert className="size-3" /> 绝对不复刻</span>
                                    {ECOMMERCE_VIDEO_REPLICA_NEVER.map((item) => <span key={item} className="ecom-replica-never-item">{item}</span>)}
                                </div>
                            </>
                        ) : (
                            <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                                连一段爆款视频进本节点，就能拆它的节奏、切点与运镜，再换成自己的商品。音乐与人物不能复刻——音频指纹稽查比图像更成熟。
                            </span>
                        )}
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">片子类型</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_VIDEO_KINDS.map((kind) => (
                                <button key={kind.id} type="button" className="ecom-chip" aria-pressed={video.kind === kind.id} title={kind.hint} onClick={() => patch({ kind: kind.id as EcommerceVideoKind, platform: kind.platform })}>
                                    {kind.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">投放平台 · 决定比例与时长上限</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_VIDEO_SPECS.map((item) => (
                                <button key={item.id} type="button" className="ecom-chip" aria-pressed={video.platform === item.id} title={item.note} onClick={() => patch({ platform: item.id as EcommerceVideoPlatform })}>
                                    {item.name}
                                </button>
                            ))}
                        </div>
                        {spec ? (
                            <span className="ecom-card-subtitle" style={{ whiteSpace: "normal" }}>
                                {spec.note}
                                <br />首帧：{ecommerceVideoFirstFrameRule(video)}
                            </span>
                        ) : null}
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">目标市场语言 · 跨境多市场</span>
                        <div className="ecom-chip-row">
                            {ECOMMERCE_VIDEO_LANGUAGES.map((language) => (
                                <button key={language.id} type="button" className="ecom-chip" aria-pressed={video.language === language.id} title={language.note} onClick={() => patch({ language: language.id as EcommerceVideoLanguage })}>
                                    {language.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="ecom-field">
                        <span className="ecom-field-label">镜头</span>
                        <div className="ecom-chip-row">
                            <button type="button" className="ecom-action" disabled={!images.length} onClick={() => commitShots(ecommerceVideoShotsFromImages(images.map((image) => image.id), { kind: video.kind, platform: video.platform }))}>
                                <Clapperboard className="size-3" />
                                从这套图铺镜头（{images.length} 张）
                            </button>
                            <button type="button" className="ecom-chip" onClick={() => { const shot = createEcommerceVideoShot(); commitShots([...video.shots, shot]); setActiveShotId(shot.id); }}>
                                + 空镜头
                            </button>
                        </div>
                        {video.shots.map((shot, index) => (
                            <div key={shot.id} className="ecom-video-shot-editor">
                                <div className="ecom-chip-row">
                                    <span className="ecom-point-index">{index + 1}</span>
                                    <select
                                        className="ecom-field-input w-auto py-0.5"
                                        value={shot.imageNodeId}
                                        aria-label={`第 ${index + 1} 镜用哪张图`}
                                        onChange={(event) => patchShot(shot.id, { imageNodeId: event.target.value })}
                                    >
                                        <option value="">（未配图）</option>
                                        {images.map((image) => <option key={image.id} value={image.id}>{image.title || image.id}</option>)}
                                    </select>
                                    <label className="ecom-chip flex items-center gap-1">
                                        时长
                                        <input type="number" min={0.5} max={30} step={0.5} value={shot.seconds} aria-label="时长（秒）" className="w-10 bg-transparent text-[10px] tabular-nums outline-none" onChange={(event) => patchShot(shot.id, { seconds: Number(event.target.value) || shot.seconds })} />
                                        s
                                    </label>
                                    <button type="button" className="ecom-chip" aria-label={`删除第 ${index + 1} 镜`} onClick={() => commitShots(video.shots.filter((item) => item.id !== shot.id))}>
                                        <Trash2 className="size-3" />
                                    </button>
                                </div>
                                <div className="ecom-chip-row">
                                    {ECOMMERCE_VIDEO_MOTIONS.map((motion) => (
                                        <button key={motion.id} type="button" className="ecom-chip" aria-pressed={shot.motion === motion.id} title={motion.hint} onClick={() => patchShot(shot.id, { motion: motion.id as EcommerceVideoMotion })}>
                                            {motion.name}
                                        </button>
                                    ))}
                                    <button type="button" className="ecom-chip" aria-pressed={shot.transition === "fade"} onClick={() => patchShot(shot.id, { transition: shot.transition === "fade" ? "cut" : "fade" })}>叠化</button>
                                </div>
                                <input
                                    className="ecom-field-input"
                                    value={shot.caption}
                                    placeholder="字幕，16 字以内一个镜头才读得完"
                                    onChange={(event) => patchShot(shot.id, { caption: event.target.value })}
                                />
                            </div>
                        ))}
                    </div>

                    <label className="ecom-field">
                        <span className="ecom-field-label">配乐风格</span>
                        <input className="ecom-field-input" value={video.music} placeholder="轻快电子 / 温暖钢琴 / 不加" onChange={(event) => patch({ music: event.target.value })} />
                    </label>

                    <label className="ecom-chip-row" style={{ alignItems: "center" }}>
                        <input type="checkbox" checked={video.burnCaptions} onChange={(event) => patch({ burnCaptions: event.target.checked })} />
                        <span className="ecom-field-label">烧字幕进画面</span>
                    </label>
                </div>
            ) : null}

            <footer className="ecom-card-footer">
                <span>{usableShots.length ? <>共 <b>{seconds}</b> 秒{spec ? `，上限 ${spec.maxSeconds}` : ""}</> : "还没有镜头"}</span>
                {editable ? (
                    <button type="button" className="ecom-card-footer-action ecom-action" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
                        {editing ? "收起" : "编排"}
                        <ChevronDown className="size-3" style={{ transform: editing ? "rotate(180deg)" : undefined, transition: "transform 140ms cubic-bezier(.16,1,.3,1)" }} />
                    </button>
                ) : null}
            </footer>
        </div>
    );
}
