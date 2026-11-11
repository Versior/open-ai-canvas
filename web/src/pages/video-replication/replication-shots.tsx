import { Copy, Play } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { teardownTimeRange, videoTeardownProductLabel, type VideoTeardownAnalysisRow } from "@/lib/canvas/video-teardown";
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
/** 模型对「没有运镜」之类常写成「无」，做成标签没有信息量，不显示。 */
const EMPTY_VALUE = /^(无|没有|暂无|none|n\/a|-|—)$/i;
/** 用户自己滚动后，这么久之内不自动跟随播放进度。 */
const FOLLOW_PAUSE_MS = 2500;
/** 整页滚动时吸顶的分镜 / 结构切换栏高度，被它盖住的镜头不算在视野里。 */
const STICKY_TABS_PX = 60;
/** 提示词超过这么多字时先收起，点「展开」看全文；复制总是复制全文。 */
const PROMPT_FOLD_CHARS = 120;

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

    // 已经滚进分镜列表在看时，播放到的镜头不在视野里就把它滚到可视区顶部。
    // 还停在页面上方看时间线、或刚自己滚过页面，都先不动。
    useEffect(() => {
        const list = listRef.current;
        if (!list || !playing || !activeIndex || Date.now() - userScrollAt.current < FOLLOW_PAUSE_MS) return;
        const item = list.querySelector<HTMLElement>(`[data-shot="${activeIndex}"]`);
        if (!item) return;
        // 宽屏下分镜在右栏自己的滚动区里；窄屏是整页滚动，要让开吸顶的切换栏。
        const panel = list.closest<HTMLElement>("[data-vr-scroll]");
        const ownScroll = Boolean(panel && panel.scrollHeight > panel.clientHeight + 1);
        const bounds = (ownScroll ? panel : list.closest(".app-workspace-scroll"))?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
        const top = bounds.top + (ownScroll ? 0 : STICKY_TABS_PX);
        if (list.getBoundingClientRect().top > top) return;
        // 这一镜的顶端落在可视区上半部分就算看得见，不用滚。
        const rect = item.getBoundingClientRect();
        if (rect.top >= top && rect.top <= top + (bounds.bottom - top) * 0.55) return;
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
    const tags = [row?.shotSize, row?.motion, row?.production ? `${row.production}${row.productionConfidence ? ` · 把握${row.productionConfidence}` : ""}` : "", shot.boundary === "split" ? "长镜头切开" : ""].filter((tag): tag is string =>
        Boolean(tag && !EMPTY_VALUE.test(tag.trim())),
    );
    const dialogueSource = row ? DIALOGUE_SOURCE_LABELS[row.dialogueSource] : "";
    const details = [
        ["镜头设计", row?.camera],
        [dialogueSource ? `口播 · ${dialogueSource}` : "口播", row?.dialogue],
        ["画面文字", row?.onScreenText],
        ["商品", videoTeardownProductLabel(row)],
        ["关键颜色", row?.keyColors],
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
                <details className="vr-shot-details">
                    <summary>镜头细节与提示词</summary>
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
                </details>
            </div>
        </li>
    );
}

function Prompt({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string) => void }) {
    const [open, setOpen] = useState(false);
    if (!text) return null;
    const foldable = text.length > PROMPT_FOLD_CHARS;
    return (
        <div className="vr-prompt">
            <div className="vr-prompt-head">
                <span className="vr-prompt-label">{label}</span>
                <button type="button" className="vr-icon-button" aria-label={`复制${label}`} title={`复制${label}`} onClick={() => onCopy(text)}>
                    <Copy aria-hidden />
                </button>
            </div>
            <p className="vr-prompt-text" data-folded={foldable && !open ? true : undefined}>
                {text}
            </p>
            {foldable ? (
                <button type="button" className="vr-text-button vr-prompt-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                    {open ? "收起" : "展开"}
                </button>
            ) : null}
        </div>
    );
}
