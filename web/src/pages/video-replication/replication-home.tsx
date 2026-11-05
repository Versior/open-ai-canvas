import { ArrowRight, Captions, Clapperboard, LoaderCircle, ScanEye, Scissors, WandSparkles } from "lucide-react";
import type { ComponentProps } from "react";

import type { VideoReplicationRecord } from "@/services/api/video-replication";
import { ReplicationComposer } from "./replication-composer";
import { ReplicationRecent } from "./replication-recent";
import { REPLICATION_STAGE_LABELS, type ReplicationRun } from "./use-replication-runner";

const HINTS = [
    { icon: Scissors, title: "自动切镜", text: "按画面变化切出每个镜头，时间码精确到 0.1 秒" },
    { icon: ScanEye, title: "逐镜分析", text: "景别、运镜、光影和情绪，看图模型逐镜判断" },
    { icon: Captions, title: "口播与字幕", text: "语音转写口播，没有转写时从画面字幕读" },
    { icon: WandSparkles, title: "复刻提示词", text: "每镜给出首帧和视频提示词，一键铺到画布" },
];

type Props = {
    composer: ComponentProps<typeof ReplicationComposer>;
    records: VideoReplicationRecord[] | undefined;
    loading: boolean;
    error: string;
    /** 已经建好拆解任务、正在后台跑的那一次。 */
    activeRun: ReplicationRun | null;
    onOpen: (id: string) => void;
};

/** 视频复刻首页：标题、拆解入口、能力说明和最近拆解。 */
export function ReplicationHome({ composer, records, loading, error, activeRun, onOpen }: Props) {
    const activeId = activeRun?.id || "";
    return (
        <div className="vr-home">
            <header className="vr-hero">
                <span className="vr-eyebrow">
                    <Clapperboard aria-hidden />
                    视频复刻
                </span>
                <h1 className="vr-hero-title">把爆款视频拆成可复刻的分镜</h1>
                <p className="vr-hero-sub">{`${composer.linkImportEnabled ? "粘贴短视频平台的分享链接或上传视频" : "上传视频"}，自动切出每个镜头，逐镜分析画面、口播和运镜，得到能直接用的分镜表和提示词。`}</p>
            </header>
            <ReplicationComposer {...composer} />
            {activeRun && activeId ? (
                <button type="button" className="vr-run-banner" onClick={() => onOpen(activeId)}>
                    <LoaderCircle className="vr-spin" aria-hidden />
                    <span className="vr-run-banner-text">
                        <strong>{REPLICATION_STAGE_LABELS[activeRun.stage]}</strong>
                        {[activeRun.detail, activeRun.percent !== undefined ? `${activeRun.percent}%` : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span className="vr-run-banner-link">
                        查看进度
                        <ArrowRight aria-hidden />
                    </span>
                </button>
            ) : null}
            <ul className="vr-hints" aria-label="拆解能做什么">
                {HINTS.map(({ icon: Icon, title, text }) => (
                    <li key={title} className="vr-hint">
                        <span className="vr-hint-icon" aria-hidden>
                            <Icon />
                        </span>
                        <span className="min-w-0">
                            <span className="vr-hint-title">{title}</span>
                            <span className="vr-hint-text">{text}</span>
                        </span>
                    </li>
                ))}
            </ul>
            <p className="vr-home-note">识别口播需要服务端配置转写服务，没配置时从画面字幕读。拆解用于学习结构和节奏，复刻请使用你有权使用的素材和形象。</p>
            <ReplicationRecent records={records} loading={loading} error={error} runningId={activeId} onOpen={onOpen} />
        </div>
    );
}
