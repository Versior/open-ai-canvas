import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { formatTeardownTime, teardownTimeRange, type VideoTeardownSummary } from "@/lib/canvas/video-teardown";
import { resourceFileUrl } from "@/services/api/resources";
import type { VideoTeardownBundle, VideoTeardownShot } from "@/services/api/video-replication";

type Props = {
    bundle: VideoTeardownBundle;
    summary: VideoTeardownSummary | null | undefined;
    /** 正在播放的镜头序号（从 1 开始），0 表示还没开始。 */
    activeIndex: number;
    video: HTMLVideoElement | null;
    onPick: (shot: VideoTeardownShot) => void;
};

const TICK_STEPS_S = [1, 2, 5, 10, 15, 30, 60];

/** 整秒的「分:秒」，刻度和卡片时长角标用。 */
export function formatClock(ms: number) {
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 按真实时长定位；左右各让 1px，相邻镜头之间留出 2px 缝。 */
function placement(startMs: number, endMs: number, totalMs: number): CSSProperties {
    return { left: `calc(${(startMs / totalMs) * 100}% + 1px)`, width: `max(calc(${((endMs - startMs) / totalMs) * 100}% - 2px), 2px)` };
}

/**
 * 镜头时间线：每个镜头按真实时长铺在一条轨道上（快切一眼能看出来），上面是模型给的节拍，下面是时间刻度。
 * 播放头跟随左侧原视频，点镜头从这一镜开始播放。
 */
export function ReplicationTimeline({ bundle, summary, activeIndex, video, onPick }: Props) {
    const { shots } = bundle;
    const totalMs = Math.max(bundle.source.durationMs, shots[shots.length - 1]?.endMs || 0, 1);
    const playheadRef = useRef<HTMLSpanElement>(null);
    const clockRef = useRef<HTMLSpanElement>(null);

    const ticks = useMemo(() => {
        const step = (TICK_STEPS_S.find((seconds) => totalMs / 1000 / seconds <= 8) || 60) * 1000;
        const list: number[] = [];
        // 最后一格离结尾太近就不画，免得和右端挤在一起。
        for (let ms = 0; ms <= totalMs - step * 0.4; ms += step) list.push(ms);
        return list;
    }, [totalMs]);

    const beats = useMemo(
        () =>
            (summary?.beats || []).flatMap((beat, order) => {
                const first = shots[Math.min(...beat.shots) - 1];
                const last = shots[Math.max(...beat.shots) - 1];
                return first && last ? [{ ...beat, order, startMs: first.startMs, endMs: last.endMs }] : [];
            }),
        [shots, summary?.beats],
    );

    // 播放头和时间读数每帧跟着 currentTime 走，直接写 DOM，不触发重渲染。
    useEffect(() => {
        if (!video) return;
        let frame = 0;
        const draw = () => {
            const ms = video.currentTime * 1000;
            if (playheadRef.current) playheadRef.current.style.left = `${(Math.min(ms, totalMs) / totalMs) * 100}%`;
            if (clockRef.current) clockRef.current.textContent = formatTeardownTime(ms);
        };
        const loop = () => {
            draw();
            frame = requestAnimationFrame(loop);
        };
        const start = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(loop);
        };
        const stop = () => {
            cancelAnimationFrame(frame);
            draw();
        };
        draw();
        if (!video.paused) start();
        video.addEventListener("play", start);
        video.addEventListener("pause", stop);
        video.addEventListener("ended", stop);
        video.addEventListener("seeked", draw);
        video.addEventListener("timeupdate", draw);
        return () => {
            cancelAnimationFrame(frame);
            video.removeEventListener("play", start);
            video.removeEventListener("pause", stop);
            video.removeEventListener("ended", stop);
            video.removeEventListener("seeked", draw);
            video.removeEventListener("timeupdate", draw);
        };
    }, [video, totalMs]);

    const averageSeconds = shots.length ? totalMs / shots.length / 1000 : 0;
    return (
        <section className="vr-panel vr-timeline" aria-label="镜头时间线">
            <header className="vr-timeline-head">
                <div className="vr-timeline-heading">
                    <h2 className="vr-timeline-title">镜头时间线</h2>
                    <span className="vr-timeline-meta">{`${shots.length} 个镜头 · 平均 ${averageSeconds.toFixed(1)} 秒一镜`}</span>
                </div>
                <span className="vr-timeline-clock" aria-hidden>
                    <span ref={clockRef}>0:00.0</span>
                    <span className="vr-timeline-total">{` / ${formatTeardownTime(totalMs)}`}</span>
                </span>
            </header>
            <div className="vr-track-scroll">
                <div className="vr-track" style={{ minWidth: Math.max(560, shots.length * 16) }}>
                    {beats.length ? (
                        <ol className="vr-beats" aria-label="节拍">
                            {beats.map((beat) => (
                                <li
                                    key={`${beat.order}-${beat.name}`}
                                    className="vr-beat"
                                    data-tone={beat.order % 2 ? "even" : "odd"}
                                    style={placement(beat.startMs, beat.endMs, totalMs)}
                                    title={`${beat.name} · ${teardownTimeRange(beat)}${beat.purpose ? `\n${beat.purpose}` : ""}`}
                                >
                                    <span className="vr-beat-label">{beat.name}</span>
                                </li>
                            ))}
                        </ol>
                    ) : null}
                    <div className="vr-strip-wrap">
                        <ol className="vr-strip" aria-label="镜头">
                            {shots.map((shot) => (
                                <li key={shot.index} className="vr-seg-item" style={placement(shot.startMs, shot.endMs, totalMs)}>
                                    <button
                                        type="button"
                                        className="vr-seg"
                                        data-active={shot.index === activeIndex}
                                        aria-current={shot.index === activeIndex ? "true" : undefined}
                                        aria-label={`镜头 ${shot.index}，${teardownTimeRange(shot)}，从这一镜开始播放`}
                                        title={`镜头 ${shot.index} · ${teardownTimeRange(shot)}`}
                                        onClick={() => onPick(shot)}
                                    >
                                        <img src={resourceFileUrl(shot.keyframeResourceId)} alt="" loading="lazy" draggable={false} />
                                        <span className="vr-seg-label">{shot.index}</span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                        <span ref={playheadRef} className="vr-playhead" aria-hidden />
                    </div>
                    <div className="vr-ruler" aria-hidden>
                        {ticks.map((ms) => (
                            <span key={ms} className="vr-tick" style={{ left: `${(ms / totalMs) * 100}%` }}>
                                {formatClock(ms)}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
