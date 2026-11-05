import { Fragment } from "react";

import { teardownTimeRange, type VideoTeardownSummary } from "@/lib/canvas/video-teardown";
import { resourceFileUrl } from "@/services/api/resources";
import type { VideoTeardownBundle, VideoTeardownShot } from "@/services/api/video-replication";

type Props = {
    bundle: VideoTeardownBundle;
    summary: VideoTeardownSummary;
    onPlay: (shot: VideoTeardownShot) => void;
};

const BEAT_THUMBS = 4;

/** 全片结构：开头钩子、节拍（点缩略图从那一镜播放）、为什么能吸引人、复刻建议，以及节奏和花字。 */
export function ReplicationStructure({ bundle, summary, onPlay }: Props) {
    const sound = [summary.music ? ["节奏与配乐", summary.music] : null, summary.textStyle ? ["字幕与花字", summary.textStyle] : null].filter((item): item is [string, string] => Boolean(item));
    return (
        <div className="vr-panel vr-structure">
            {summary.product ? (
                <section aria-labelledby="vr-structure-product">
                    <h3 id="vr-structure-product" className="vr-list-title">
                        原片商品
                    </h3>
                    <p className="vr-structure-text">{summary.product}</p>
                </section>
            ) : null}
            {summary.hook ? (
                <section aria-labelledby="vr-structure-hook">
                    <h3 id="vr-structure-hook" className="vr-list-title">
                        开头钩子
                    </h3>
                    <p className="vr-hook-text">{summary.hook}</p>
                </section>
            ) : null}
            {summary.beats.length ? (
                <section aria-labelledby="vr-structure-beats">
                    <h3 id="vr-structure-beats" className="vr-list-title">
                        节拍结构
                    </h3>
                    <ol className="vr-beat-list">
                        {summary.beats.map((beat, index) => {
                            const shots = beat.shots.map((number) => bundle.shots[number - 1]).filter((shot): shot is VideoTeardownShot => Boolean(shot));
                            const first = shots[0];
                            const last = shots[shots.length - 1];
                            return (
                                <li key={`${index}-${beat.name}`} className="vr-beat-row">
                                    <span className="vr-beat-no" aria-hidden>
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="vr-beat-name">
                                            {beat.name}
                                            {first && last ? (
                                                <span className="vr-beat-time">{`${teardownTimeRange({ startMs: first.startMs, endMs: last.endMs })} · 镜头 ${first.index === last.index ? first.index : `${first.index}–${last.index}`}`}</span>
                                            ) : null}
                                        </p>
                                        {beat.purpose ? <p className="vr-beat-purpose">{beat.purpose}</p> : null}
                                    </div>
                                    <span className="vr-beat-thumbs">
                                        {shots.slice(0, BEAT_THUMBS).map((shot) => (
                                            <button key={shot.index} type="button" aria-label={`从镜头 ${shot.index} 开始播放`} title={`镜头 ${shot.index}`} onClick={() => onPlay(shot)}>
                                                <img src={resourceFileUrl(shot.keyframeResourceId)} alt="" loading="lazy" draggable={false} />
                                            </button>
                                        ))}
                                        {shots.length > BEAT_THUMBS ? <span className="vr-beat-more">{`+${shots.length - BEAT_THUMBS}`}</span> : null}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </section>
            ) : null}
            {summary.whyItWorks.length || summary.replicationTips.length ? (
                <div className="vr-structure-grid">
                    {summary.whyItWorks.length ? <NumberedList id="vr-structure-why" title="为什么能吸引人" items={summary.whyItWorks} /> : null}
                    {summary.replicationTips.length ? <NumberedList id="vr-structure-tips" title="复刻建议" items={summary.replicationTips} /> : null}
                </div>
            ) : null}
            {sound.length ? (
                <section aria-labelledby="vr-structure-sound">
                    <h3 id="vr-structure-sound" className="vr-list-title">
                        声音与花字
                    </h3>
                    <dl className="vr-dl">
                        {sound.map(([label, value]) => (
                            <Fragment key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </Fragment>
                        ))}
                    </dl>
                </section>
            ) : null}
        </div>
    );
}

function NumberedList({ id, title, items }: { id: string; title: string; items: string[] }) {
    return (
        <section aria-labelledby={id}>
            <h3 id={id} className="vr-list-title">
                {title}
            </h3>
            <ol className="vr-numbered">
                {items.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                ))}
            </ol>
        </section>
    );
}
