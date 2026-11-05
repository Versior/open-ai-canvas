import { Copy, Play } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

import { teardownTimeRange, type VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
import { resourceFileUrl } from "@/services/api/resources";
import type { VideoTeardownBundle, VideoTeardownShot } from "@/services/api/video-replication";

type Props = {
    bundle: VideoTeardownBundle;
    rows: Map<number, VideoTeardownAnalysisRow>;
    activeIndex: number;
    playing: boolean;
    onPlay: (shot: VideoTeardownShot) => void;
    onCopy: (text: string) => void;
};

const DIALOGUE_SOURCE_LABELS: Record<VideoTeardownAnalysisRow["dialogueSource"], string> = { asr: "语音转写", subtitle: "画面字幕", none: "" };
/** 用户自己滚动后，这么久之内不自动跟随播放进度。 */
const FOLLOW_PAUSE_MS = 2500;

/** 逐镜分镜：一张面板里按镜头排开，正在播放的那一镜提亮；播放时列表跟着走。 */
export function ReplicationShots({ bundle, rows, activeIndex, playing, onPlay, onCopy }: Props) {
    const listRef = useRef<HTMLOListElement>(null);
    const userScrollAt = useRef(0);

    useEffect(() => {
        const mark = () => {
            userScrollAt.current = Date.now();
        };
        window.addEventListener("wheel", mark, { passive: true });
        window.addEventListener("touchmove", mark, { passive: true });
        return () => {
            window.removeEventListener("wheel", mark);
            window.removeEventListener("touchmove", mark);
        };
    }, []);

    // 播放时当前镜头不在视野里，就把它滚到可视区顶部；用户刚滚过页面则先不动。
    useEffect(() => {
        if (!playing || !activeIndex || Date.now() - userScrollAt.current < FOLLOW_PAUSE_MS) return;
        const item = listRef.current?.querySelector<HTMLElement>(`[data-shot="${activeIndex}"]`);
        if (!item) return;
        const rect = item.getBoundingClientRect();
        const bounds = item.closest(".app-workspace-scroll")?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
        if (rect.top >= bounds.top && rect.top <= bounds.bottom - 96) return;
        item.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }, [activeIndex, playing]);

    return (
        <ol ref={listRef} className="vr-panel vr-shots" aria-label="逐镜分镜">
            {bundle.shots.map((shot) => (
                <ShotRow key={shot.index} shot={shot} row={rows.get(shot.index)} ratio={`${shot.keyframeWidth || bundle.source.width} / ${shot.keyframeHeight || bundle.source.height}`} active={shot.index === activeIndex} onPlay={onPlay} onCopy={onCopy} />
            ))}
        </ol>
    );
}

function ShotRow({ shot, row, ratio, active, onPlay, onCopy }: { shot: VideoTeardownShot; row: VideoTeardownAnalysisRow | undefined; ratio: string; active: boolean; onPlay: (shot: VideoTeardownShot) => void; onCopy: (text: string) => void }) {
    const seconds = ((shot.endMs - shot.startMs) / 1000).toFixed(1);
    const tags = [row?.shotSize, row?.motion, row?.production ? `${row.production}${row.productionConfidence ? ` · 把握${row.productionConfidence}` : ""}` : "", shot.boundary === "split" ? "长镜头切开" : ""].filter(Boolean);
    const dialogueSource = row ? DIALOGUE_SOURCE_LABELS[row.dialogueSource] : "";
    const details = [
        ["镜头设计", row?.camera],
        [dialogueSource ? `口播 · ${dialogueSource}` : "口播", row?.dialogue],
        ["画面文字", row?.onScreenText],
        ["光影情绪", [row?.lightingAndAtmosphere, row?.emotion].filter(Boolean).join("；")],
        ["声音线索", row?.audioEffects],
    ].filter((item): item is [string, string] => Boolean(item[1]));
    return (
        <li className="vr-shot" data-shot={shot.index} data-active={active}>
            <button type="button" className="vr-shot-thumb" style={{ aspectRatio: ratio }} aria-label={`从镜头 ${shot.index} 开始播放`} onClick={() => onPlay(shot)}>
                <img src={resourceFileUrl(shot.keyframeResourceId)} alt={`镜头 ${shot.index} 关键帧`} loading="lazy" draggable={false} />
                <span className="vr-shot-play" aria-hidden>
                    <Play />
                </span>
                <span className="vr-shot-duration" aria-hidden>{`${seconds}s`}</span>
            </button>
            <div className="vr-shot-content">
                <div className="vr-shot-head">
                    <h3 className="vr-shot-index">{`镜头 ${String(shot.index).padStart(2, "0")}`}</h3>
                    <span className="vr-shot-time">{`${teardownTimeRange(shot)} · ${seconds} 秒`}</span>
                </div>
                {tags.length ? (
                    <div className="vr-tags">
                        {tags.map((tag) => (
                            <span key={tag} className="vr-tag">
                                {tag}
                            </span>
                        ))}
                    </div>
                ) : null}
                <p className="vr-shot-plot" data-empty={!row?.plotDescription || undefined}>
                    {row?.plotDescription || "还没有模型分析"}
                </p>
                {details.length ? (
                    <dl className="vr-dl">
                        {details.map(([label, value]) => (
                            <Fragment key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </Fragment>
                        ))}
                    </dl>
                ) : null}
                {row?.imageGenerationPrompt || row?.videoMotionPrompt ? (
                    <div className="vr-prompts">
                        <Prompt label="首帧提示词" text={row.imageGenerationPrompt} onCopy={onCopy} />
                        <Prompt label="视频提示词" text={row.videoMotionPrompt} onCopy={onCopy} />
                    </div>
                ) : null}
            </div>
        </li>
    );
}

function Prompt({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string) => void }) {
    if (!text) return null;
    return (
        <div className="vr-prompt">
            <div className="vr-prompt-head">
                <span className="vr-prompt-label">{label}</span>
                <button type="button" className="vr-icon-button" aria-label={`复制${label}`} title={`复制${label}`} onClick={() => onCopy(text)}>
                    <Copy aria-hidden />
                </button>
            </div>
            <p className="vr-prompt-text">{text}</p>
        </div>
    );
}
