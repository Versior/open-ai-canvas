import { orientationLabel } from "@/lib/canvas/video-teardown";
import { resourceFileUrl } from "@/services/api/resources";
import type { VideoTeardownBundle } from "@/services/api/video-replication";

type Props = {
    bundle: VideoTeardownBundle;
    videoRef: (element: HTMLVideoElement | null) => void;
};

/** 左栏：原视频（外框按原画幅收紧，不留黑边）、四个基本数据，以及口播来源和拆解时的提示。宽屏下随页面吸顶。 */
export function ReplicationPlayer({ bundle, videoRef }: Props) {
    const { source, shots } = bundle;
    const seconds = source.durationMs / 1000;
    return (
        <aside className="vr-player" aria-label="原视频">
            <div className="vr-video">
                <video ref={videoRef} src={resourceFileUrl(source.resourceId)} controls playsInline preload="metadata" aria-label="原视频" />
            </div>
            <dl className="vr-stats">
                <Stat label="时长" value={`${seconds.toFixed(1)} 秒`} />
                <Stat label="镜头" value={`${shots.length} 个`} />
                <Stat label="平均每镜" value={`${shots.length ? (seconds / shots.length).toFixed(1) : "0"} 秒`} />
                <Stat label="画幅" value={`${orientationLabel(source.width, source.height)} ${source.width}×${source.height}`} />
            </dl>
            <ul className="vr-footnote">
                <li>{bundle.transcript.source === "asr" ? "口播来自语音转写。" : source.hasAudio ? "没有语音转写，口播从画面字幕读。" : "视频没有音轨，口播从画面字幕读。"}</li>
                {bundle.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                ))}
            </ul>
        </aside>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="vr-stat">
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
        </div>
    );
}
