import { Button, Input, Progress, Spin } from "antd";
import { Film, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTeardownTime } from "@/lib/canvas/video-teardown";
import { REMAKE_TREATMENT_LABEL, type RemakeJob, type RemakeUnit } from "@/lib/remake/job";
import { remakeLines, remakePieces, remakeSourceTime } from "@/lib/remake/timeline";
import { remakeUnitTake } from "@/lib/remake/units";
import { resourceFileUrl } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";
import { productVideoThumbUrl } from "../replace/product-video-assets";
import { chooseRemakeTake, redoRemakeUnit, useRemakeRuntime } from "./remake-runner";

type Selection = { kind: "final" } | { kind: "unit"; key: string };

function seconds(ms: number) {
    return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} 秒`;
}

function unitTitle(unit: RemakeUnit) {
    const shots = unit.shotIndexes.length > 1 ? `镜头 ${unit.shotIndexes[0]}–${unit.shotIndexes[unit.shotIndexes.length - 1]}` : `镜头 ${unit.shotIndexes[0]}`;
    return `${shots} · ${REMAKE_TREATMENT_LABEL[unit.treatment]} · ${seconds(unit.endMs - unit.startMs)}`;
}

const STATUS_TEXT: Record<RemakeUnit["status"], string> = { pending: "等待生成", running: "生成中", succeeded: "已生成", failed: "没有生成成功" };

/**
 * 出片对比：上面原片和新片并排同步播放，下面双轨时间线（按原片时间对齐：上轨原片各镜，下轨每个生成单元），
 * 右边是选中这一段的候选、定向重做。
 */
export function RemakeProduce({ job, config, onEditRecipe }: { job: RemakeJob; config: AiConfig; onEditRecipe: () => void }) {
    const progress = useRemakeRuntime((state) => state.progress[job.id]);
    const active = useRemakeRuntime((state) => Boolean(state.active[job.id]));
    const finalId = job.render?.resourceId;
    const [selection, setSelection] = useState<Selection>(() => (finalId ? { kind: "final" } : job.units[0] ? { kind: "unit", key: job.units[0].key } : { kind: "final" }));
    const unit = selection.kind === "unit" ? job.units.find((item) => item.key === selection.key) : undefined;
    const take = unit ? remakeUnitTake(unit) : undefined;
    const pieces = useMemo(() => remakePieces(job), [job]);
    const lines = useMemo(() => remakeLines(job), [job]);
    const leftRef = useRef<HTMLVideoElement>(null);
    const rightRef = useRef<HTMLVideoElement>(null);
    const [hearOriginal, setHearOriginal] = useState(false);
    const [fix, setFix] = useState("");
    const duration = Math.max(1, job.source.durationMs);

    useEffect(() => {
        if (selection.kind === "final" && !finalId && job.units[0]) setSelection({ kind: "unit", key: job.units[0].key });
    }, [finalId, job.units, selection.kind]);
    useEffect(() => setFix(unit?.fix || ""), [unit?.key, unit?.fix]);

    // 新片在播到哪，就把原片拨到对应的位置；偏差超过 0.25 秒才拨，避免卡顿。
    const toSource = (ms: number) => {
        if (selection.kind === "final") return remakeSourceTime(pieces, ms);
        if (!unit) return 0;
        const origin = unit.treatment === "replace" ? unit.clipStartMs : unit.startMs;
        return origin + ms;
    };
    const sync = () => {
        const right = rightRef.current;
        const left = leftRef.current;
        if (!right || !left) return;
        const target = toSource(right.currentTime * 1000) / 1000;
        if (Math.abs(left.currentTime - target) > 0.25) left.currentTime = target;
    };
    const rightSrc = selection.kind === "final" ? (finalId ? resourceFileUrl(finalId) : "") : take ? resourceFileUrl(take.resourceId) : "";
    const startOffset = unit ? Math.max(0, unit.startMs - (unit.treatment === "replace" ? unit.clipStartMs : unit.startMs)) / 1000 : 0;

    return (
        <div className="rw-produce">
            <section className="rw-compare" aria-label="原片和新片对比">
                <div className="rw-compare-head">
                    <div className="rw-compare-tabs" role="tablist" aria-label="对比内容">
                        <button type="button" role="tab" aria-selected={selection.kind === "final"} disabled={!finalId} onClick={() => setSelection({ kind: "final" })}>
                            整条成片
                        </button>
                        <button type="button" role="tab" aria-selected={selection.kind === "unit"} disabled={!job.units.length} onClick={() => job.units[0] && setSelection({ kind: "unit", key: unit?.key || job.units[0].key })}>
                            逐段对比
                        </button>
                    </div>
                    <span>{selection.kind === "final" ? (finalId ? `成片 ${seconds(job.render?.durationMs || pieces[pieces.length - 1]?.endMs || 0)}` : "还没有拼成片") : unit ? unitTitle(unit) : ""}</span>
                    <Button size="small" type="text" icon={hearOriginal ? <Volume2 size={14} /> : <VolumeX size={14} />} onClick={() => setHearOriginal((value) => !value)}>
                        {hearOriginal ? "听原片" : "原片静音"}
                    </Button>
                </div>
                <div className="rw-compare-panes">
                    <figure className="rw-pane">
                        <video ref={leftRef} src={resourceFileUrl(job.source.resourceId)} muted={!hearOriginal} playsInline preload="metadata" aria-label="原片" />
                        <figcaption>原片</figcaption>
                    </figure>
                    <figure className="rw-pane" data-empty={!rightSrc || undefined}>
                        {rightSrc ? (
                            <video
                                key={rightSrc}
                                ref={rightRef}
                                src={rightSrc}
                                controls
                                playsInline
                                preload="metadata"
                                muted={hearOriginal}
                                aria-label="新片"
                                onLoadedMetadata={(event) => {
                                    if (selection.kind === "unit") event.currentTarget.currentTime = startOffset;
                                    sync();
                                }}
                                onPlay={() => void leftRef.current?.play().catch(() => undefined)}
                                onPause={() => leftRef.current?.pause()}
                                onSeeked={sync}
                                onTimeUpdate={(event) => {
                                    // 逐段对比只播这一段在成片里用到的部分，播完回到开头。
                                    if (unit && selection.kind === "unit" && event.currentTarget.currentTime > startOffset + (unit.endMs - unit.startMs) / 1000) event.currentTarget.currentTime = startOffset;
                                    sync();
                                }}
                            />
                        ) : (
                            <div className="rw-pane-empty">
                                {active || unit?.status === "running" ? <Spin /> : <Film size={22} aria-hidden />}
                                <span>{unit ? STATUS_TEXT[unit.status] : "还没有拼成片"}</span>
                                {unit?.status === "running" && progress?.units?.[unit.key] !== undefined ? <Progress percent={progress.units[unit.key]} size="small" showInfo={false} /> : null}
                            </div>
                        )}
                        <figcaption>{selection.kind === "final" ? "成片" : take ? `候选 ${unit!.chosen + 1}/${unit!.takes.length}` : "新片"}</figcaption>
                    </figure>
                </div>
            </section>

            <aside className="rw-inspector" aria-label="这一段">
                {unit ? (
                    <>
                        <h3>{unitTitle(unit)}</h3>
                        <p className="rw-hint">
                            原片 {formatTeardownTime(unit.startMs)}–{formatTeardownTime(unit.endMs)} · {STATUS_TEXT[unit.status]}
                            {unit.attempt > 1 ? ` · 第 ${unit.attempt} 次` : ""}
                        </p>
                        {unit.error ? <p className="rw-warn">{unit.error}</p> : null}
                        {unit.takes.length ? (
                            <div className="rw-takes" role="radiogroup" aria-label="候选">
                                {unit.takes.map((item, index) => (
                                    <button key={item.taskId || item.resourceId} type="button" role="radio" aria-checked={unit.chosen === index} className="rw-take" onClick={() => void chooseRemakeTake(job.id, unit.key, index)}>
                                        <video src={`${resourceFileUrl(item.resourceId)}#t=0.5`} muted playsInline preload="metadata" aria-hidden />
                                        <span>{unit.chosen === index ? "✓ 用这条" : `候选 ${index + 1}`}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <label className="rw-fix">
                            <span>这一段哪里不对？</span>
                            <Input.TextArea value={fix} maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：包装上的字糊了，保持正面文字清晰；模特转头时脸变了" onChange={(event) => setFix(event.target.value)} />
                        </label>
                        <div className="rw-inspector-actions">
                            <Button icon={<RotateCcw size={14} />} disabled={unit.status === "running" || unit.status === "pending"} onClick={() => void redoRemakeUnit(job.id, unit.key, fix, config)}>
                                {unit.takes.length ? "再出一条" : "重做"}
                            </Button>
                            <Button type="text" onClick={onEditRecipe}>
                                改做法
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <h3>整条成片</h3>
                        <p className="rw-hint">点下面时间线里的一段，看它和原片的对比、挑候选或定向重做。</p>
                    </>
                )}
            </aside>

            <section className="rw-timeline" aria-label="时间线">
                <div className="rw-timeline-head">
                    <h3>时间线</h3>
                    <span>上轨原片 · 下轨新片 · 按原片时间对齐</span>
                    {progress?.stage ? <span className="rw-timeline-stage">{progress.stage}</span> : null}
                </div>
                <div className="rw-tracks">
                    <span className="rw-track-label">原片</span>
                    <div className="rw-track">
                        {job.shots.map((shot) => (
                            <div
                                key={shot.index}
                                className="rw-block rw-block-source"
                                data-treatment={shot.treatment}
                                style={{
                                    left: `${(shot.startMs / duration) * 100}%`,
                                    width: `${((shot.endMs - shot.startMs) / duration) * 100}%`,
                                    backgroundImage: shot.keyframeResourceId ? `url(${productVideoThumbUrl(shot.keyframeResourceId)})` : undefined,
                                }}
                                title={`镜头 ${shot.index} · ${REMAKE_TREATMENT_LABEL[shot.treatment]}`}
                            >
                                <span>{shot.index}</span>
                            </div>
                        ))}
                    </div>
                    <span className="rw-track-label">新片</span>
                    <div className="rw-track">
                        {job.units.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                className="rw-block rw-block-unit"
                                data-treatment={item.treatment}
                                data-status={item.status}
                                aria-pressed={selection.kind === "unit" && selection.key === item.key}
                                style={{ left: `${(item.startMs / duration) * 100}%`, width: `${((item.endMs - item.startMs) / duration) * 100}%` }}
                                onClick={() => setSelection({ kind: "unit", key: item.key })}
                                title={unitTitle(item)}
                            >
                                <span>{item.status === "running" && progress?.units?.[item.key] !== undefined ? `${progress.units[item.key]}%` : item.takes.length > 1 ? `${item.takes.length} 条` : STATUS_TEXT[item.status]}</span>
                            </button>
                        ))}
                        {job.shots
                            .filter((shot) => shot.treatment === "keep" || shot.treatment === "skip")
                            .map((shot) => (
                                <div key={`fixed-${shot.index}`} className="rw-block rw-block-fixed" data-treatment={shot.treatment} style={{ left: `${(shot.startMs / duration) * 100}%`, width: `${((shot.endMs - shot.startMs) / duration) * 100}%` }}>
                                    <span>{shot.treatment === "keep" ? "原片" : "删掉"}</span>
                                </div>
                            ))}
                    </div>
                </div>
                {lines.length || job.music ? (
                    <div className="rw-voice-track">
                        {lines.length ? (
                            <span>
                                {job.audio === "voice" ? `配音 ${job.voiceLines.filter((line) => line.status === "succeeded").length}/${lines.length} 句：` : job.audio === "original" ? "原声：" : "口播："}
                                {lines.map((line) => `「${line.text}」`).join(" ")}
                            </span>
                        ) : null}
                        {job.music ? (
                            <span>
                                背景音乐：{job.music.name || "已选"} · 音量 {Math.round(job.music.volume * 100)}%
                            </span>
                        ) : null}
                        {job.subtitles.burn && lines.length ? <span>字幕烧进成片</span> : null}
                    </div>
                ) : null}
            </section>
        </div>
    );
}
